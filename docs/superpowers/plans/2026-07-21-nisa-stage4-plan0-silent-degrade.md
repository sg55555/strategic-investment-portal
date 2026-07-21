# NISA Stage4 plan0 — Silent Degrade 修正 Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development でtask毎に実装

## Goal

spec `2026-07-21-nisa-stage4-account-allocation-design.md` §5 の「既存 silent degrade（Stage3 残・NISA 助言と無関係）」を独立小 PR で潰す。具体的には:

1. NISA 4 列 migration（`db/migrations/2026-07-17-investment-nisa-columns.sql`）の本番適用と、それが冪等・非破壊であることのガードテスト。
2. `api/me/investment.py` と `api/me/advice.py` の `me.investment_snapshots` SELECT の `except` を「**列/テーブル不在（migration 未適用）**」と「**その他読取失敗**」と「**本当に 0 件（正常）**」の 3 状態に分岐し、silent に空へ潰さない。
3. 「列/テーブルが正常か」の**診断軸を 1 本追加して可視化**する（investment.py は 200 レスポンスに `schemaOk`、advice.py は分類済み stderr ログ）。

Stage4a/4b（plan A / plan B）とは独立で、NISA 助言ロジックには一切触れない。blast radius を分離するための先行小 PR。

## Architecture

- 本番＝Vercel serverless Python（`BaseHTTPRequestHandler`）+ Neon Postgres + psycopg3。
- `api/me/investment.py`＝`GET /api/me/investment`（認証必須・読取専用・`{"investment":[...]}` を返す）。money.js が投資台帳素データを読む。現状は `me.investment_snapshots` の SELECT が失敗すると `except Exception` で `rows=[]` に潰し 200 を返す（silent degrade）。
- `api/me/advice.py`＝`POST /api/me/advice`（Slice3 AI 規律コーチ）。do_POST 内で `me.investment_snapshots` の NISA 列を読み `inv_rows` にし、失敗時は `except` で `inv_rows=None` に潰す（silent degrade・autocommit ゆえ後続クエリは無傷）。
- 修正方針＝各ファイルに DB 非依存で単体テスト可能な**純ヘルパ**（cursor を引数に取り例外を投げず `(rows, schema_ok)` を返す）を切り出し、psycopg の `UndefinedColumn`/`UndefinedTable`（SQLSTATE 42703 / 42P01）を明示 catch で分類する。既存の接続ハンドリング（investment.py は非 autocommit・advice.py は autocommit）と degrade 挙動（rows=[] / inv_rows=None）は不変に保ち、分類ロジックと診断出力だけを足す。

## Tech Stack

- Python 3.14（`/home/shugo/apps/investment-portal/.venv/bin/python`。worktree に .venv は無く元 main の .venv を絶対パスで使う）。
- psycopg3 3.3.4（`from psycopg import errors as pg_errors`・`pg_errors.UndefinedColumn` / `pg_errors.UndefinedTable` は instantiate 可能・`isinstance(e, psycopg.Error)` True で確認済み）。
- pytest（純ヘルパを fake cursor で検証・DB / Anthropic 不要）。既存 `tests/test_etl_investment.py` の `importlib.util.spec_from_file_location` 直ロード方式に倣う。

## Global Constraints

- **cross-file import 回避**（me/ グループ規約・`insight.py:254`）。investment.py と advice.py に同型ヘルパを**各自定義**し共有モジュール化しない。
- **書き手分離は本 plan では非対象**（ETL writer=`seed_universe.py`/`refresh_market.py` は触らない）。読取側 endpoint のみ変更。
- **facts / レスポンススキーマのパリティ**：advice.py の `mode_a_facts` / coarsen / facts_hash / `_respond` の形は**変えない**（JS↔Py パリティと SCHEMA_VERSION 据置を維持）。advice.py の診断軸は stderr ログのみで、facts・200 レスポンス body には足さない。investment.py の 200 レスポンスにのみ新フィールド `schemaOk` を足す（money.js 側は既存 `investment` を読むだけで後方互換）。
- **migration は手動適用**（`.vercelignore` が `db/` と `*.sql` を配信除外＝自動適用されない）。本番 DB への適用は破壊系として日本語で安全根拠を併記。
- **本番読取専用検証**（共有 singleton state=id=1 に破壊テスト禁止）。検証は `SELECT`・GET `/api/me/investment` の読取のみ。
- テスト実行:
  - Python= `cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_X.py -v`
  - （本 plan は Python のみ。JS 変更なし。）
- **No Placeholders**：全 code step は実コードブロック。TBD/TODO/「エラー処理を追加」等は書かない。

---

## Task 1: NISA 4 列 migration の本番適用 + 冪等ガードテスト

`db/migrations/2026-07-17-investment-nisa-columns.sql` は既に存在し `ADD COLUMN IF NOT EXISTS`（4 列）で冪等・非破壊。plan0 のゴールはこれを**本番 Neon に適用**して investment.py/advice.py の `schemaOk` が本番で true になる前提を作ること。あわせて、この migration の契約（4 列・冪等）が将来の誤編集で壊れないことをガードするテストを追加する。

Files:
- Test: `tests/test_migration_nisa_columns.py`（Create）
- 参照（変更しない）: `db/migrations/2026-07-17-investment-nisa-columns.sql`

Interfaces:
- Consumes: なし（先行タスク）。
- Produces: 本番 `me.investment_snapshots` に 4 列 `nisa_tsumitate_delta` / `nisa_growth_delta` / `nisa_tsumitate_sold_at_cost` / `nisa_growth_sold_at_cost`（`NUMERIC(16,0) NOT NULL DEFAULT 0`）が存在する状態。Task 2 / Task 3 の本番 `schemaOk=true` 検証がこれに依存。

TDD steps:

- [ ] Step1: 失敗テストを書く。`tests/test_migration_nisa_columns.py` を作成:
  ```python
  """plan0: NISA 4 列 migration の契約ガード（冪等・非破壊・4 列宣言）。

  db/migrations/2026-07-17-investment-nisa-columns.sql が将来の誤編集で
  ADD COLUMN IF NOT EXISTS（冪等）や 4 列のいずれかを失わないことを固定する。
  DB 不要（ファイル内容の静的検査のみ）。pytest でも直実行でも動く。
  """
  import os

  HERE = os.path.dirname(os.path.abspath(__file__))
  ROOT = os.path.dirname(HERE)
  SQL_PATH = os.path.join(ROOT, "db", "migrations", "2026-07-17-investment-nisa-columns.sql")

  NISA_COLUMNS = (
      "nisa_tsumitate_delta",
      "nisa_growth_delta",
      "nisa_tsumitate_sold_at_cost",
      "nisa_growth_sold_at_cost",
  )


  def _sql():
      with open(SQL_PATH, encoding="utf-8") as f:
          return f.read()


  def test_migration_targets_investment_snapshots():
      assert "ALTER TABLE me.investment_snapshots" in _sql()


  def test_migration_declares_four_nisa_columns_idempotently():
      text = _sql()
      for col in NISA_COLUMNS:
          assert f"ADD COLUMN IF NOT EXISTS {col}" in text, col


  def test_migration_columns_are_non_negative_defaulted_numeric():
      text = _sql()
      for col in NISA_COLUMNS:
          # 各列が NUMERIC(16,0) NOT NULL DEFAULT 0 で宣言される（生額・簿価・非負）。
          idx = text.index(f"ADD COLUMN IF NOT EXISTS {col}")
          decl = text[idx:idx + 120]
          assert "NUMERIC(16,0) NOT NULL DEFAULT 0" in decl, col


  if __name__ == "__main__":
      import sys
      fails = 0
      for name, fn in sorted(globals().items()):
          if name.startswith("test_") and callable(fn):
              try:
                  fn()
                  print(f"  ok  {name}")
              except Exception as e:  # noqa: BLE001
                  fails += 1
                  print(f"  FAIL {name}: {e!r}")
      print(f"{'FAILED' if fails else 'PASSED'} ({fails} failures)")
      sys.exit(1 if fails else 0)
  ```

- [ ] Step2: 失敗確認（この時点では `.sql` が既に契約を満たすため 3 テストは PASS するはずだが、まず「テストが実在の SQL を読めている」ことを確認するため、故意に存在しない列名を混ぜて 1 度 FAIL させる）。一時的に `NISA_COLUMNS` に `"nisa_bogus_delta"` を 5 番目として足して実行:
  ```
  cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_migration_nisa_columns.py -v
  ```
  期待 FAIL: `test_migration_declares_four_nisa_columns_idempotently` が `AssertionError: nisa_bogus_delta`。

- [ ] Step3: 一時追加した `"nisa_bogus_delta"` を `NISA_COLUMNS` から削除し、実際の 4 列のみに戻す（上記 Step1 の最終形）。`.sql` 本体は変更しない（既に契約を満たしているため実装差分はテストのみ）。

- [ ] Step4: 成功確認:
  ```
  cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_migration_nisa_columns.py -v
  ```
  期待 PASS: 3 tests passed。

  **本番適用（手動・破壊系＝日本語で安全根拠併記）**：本番 Neon に対し以下を 1 回だけ実行する。「`psql "$DATABASE_URL" -f db/migrations/2026-07-17-investment-nisa-columns.sql` を実行します。理由：NISA 4 列を本番 `me.investment_snapshots` に追加し investment.py/advice.py の `schemaOk` を true にするため。`ADD COLUMN IF NOT EXISTS`＋`DEFAULT 0` で既存 0 行・再適用とも無害（列があれば no-op・データ書換なし）＝非破壊。」適用後の読取専用検証:
  ```
  psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_schema='me' AND table_name='investment_snapshots' AND column_name LIKE 'nisa_%' ORDER BY column_name;"
  ```
  期待 4 行（`nisa_growth_delta` / `nisa_growth_sold_at_cost` / `nisa_tsumitate_delta` / `nisa_tsumitate_sold_at_cost`）。

- [ ] Step5: commit:
  ```
  cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
  git add tests/test_migration_nisa_columns.py
  git commit -m "test(nisa): guard 4-column investment migration is idempotent (plan0 Task1)"
  ```

---

## Task 2: investment.py の silent degrade を分岐 + schemaOk 診断軸

`api/me/investment.py` do_GET の SELECT `except Exception` を、`me.investment_snapshots` の**列/テーブル不在（migration 未適用）**・**その他読取失敗**・**本当に 0 件**の 3 状態に分類する純ヘルパ `_read_snapshots(cur)` に切り出し、200 レスポンスに診断軸 `schemaOk`（true / false / null）を追加する。degrade 時に空配列を返す挙動そのものは不変（後方互換）。

Files:
- Modify: `api/me/investment.py`
- Test: `tests/test_me_investment.py`（Create）

Interfaces:
- Consumes: Task 1 が本番 DB に 4 列を用意していること（本番 `schemaOk=true` の前提。コードは列が無くても安全に degrade する）。
- Produces: 純関数 `_read_snapshots(cur) -> tuple[list[dict], bool | None]`。返り値 `(rows, schema_ok)`。`schema_ok=True`＝列/テーブル存在（`rows` 空は真のデータ 0 件）／`False`＝`UndefinedColumn`|`UndefinedTable`（migration 未適用）／`None`＝その他読取失敗。例外を投げない。200 レスポンス body に `"schemaOk": bool|None` を追加（Task 3 と同じ分類語彙）。

TDD steps:

- [ ] Step1: 失敗テストを書く。`tests/test_me_investment.py` を作成:
  ```python
  """plan0: api/me/investment.py の _read_snapshots 分類（DB 不要・fake cursor）。

  列/テーブル不在（migration 未適用）= schema_ok False、その他読取失敗 = None、
  本当に 0 件 = True（空配列だが schema は正常）を固定。silent に空へ潰さない。
  """
  import datetime as dt
  import importlib.util
  import os
  from decimal import Decimal

  import psycopg
  from psycopg import errors as pg_errors

  HERE = os.path.dirname(os.path.abspath(__file__))
  ROOT = os.path.dirname(HERE)
  _spec = importlib.util.spec_from_file_location(
      "me_investment", os.path.join(ROOT, "api", "me", "investment.py"))
  inv = importlib.util.module_from_spec(_spec)
  _spec.loader.exec_module(inv)


  class FakeCur:
      """execute で例外を投げるか、fetchall で固定 rows を返す最小 cursor。"""
      def __init__(self, rows=None, exc=None):
          self._rows = [] if rows is None else rows
          self._exc = exc

      def execute(self, *a, **k):
          if self._exc is not None:
              raise self._exc

      def fetchall(self):
          return self._rows


  def _full_row():
      # COLUMNS 順（12 要素）: period, invest_cash_flow, principal_core_delta, principal_sat_delta,
      # realized_gain, is_complete, holdings, pulled_at, nisa_tsumitate_delta, nisa_growth_delta,
      # nisa_tsumitate_sold_at_cost, nisa_growth_sold_at_cost
      return (
          dt.date(2026, 5, 1), Decimal("-1000000"), Decimal("1000000"), Decimal("0"),
          Decimal("0"), True, {"VOO|NISA成長": {"qty": 10}},
          dt.datetime(2026, 5, 10, tzinfo=dt.timezone.utc),
          Decimal("0"), Decimal("1000000"), Decimal("0"), Decimal("0"),
      )


  def test_missing_column_flags_schema_false():
      rows, ok = inv._read_snapshots(FakeCur(exc=pg_errors.UndefinedColumn("column ... does not exist")))
      assert rows == [] and ok is False


  def test_missing_table_flags_schema_false():
      rows, ok = inv._read_snapshots(FakeCur(exc=pg_errors.UndefinedTable("relation ... does not exist")))
      assert rows == [] and ok is False


  def test_generic_read_failure_flags_schema_none():
      rows, ok = inv._read_snapshots(FakeCur(exc=ValueError("boom")))
      assert rows == [] and ok is None


  def test_empty_is_schema_ok_true():
      rows, ok = inv._read_snapshots(FakeCur(rows=[]))
      assert rows == [] and ok is True


  def test_rows_parsed_and_schema_ok():
      rows, ok = inv._read_snapshots(FakeCur(rows=[_full_row()]))
      assert ok is True
      r = rows[0]
      assert r["period"] == "2026-05-01"
      assert r["nisa_growth_delta"] == 1000000
      assert r["invest_cash_flow"] == -1000000
      assert r["is_complete"] is True
      assert r["holdings"] == {"VOO|NISA成長": {"qty": 10}}


  if __name__ == "__main__":
      import sys
      fails = 0
      for name, fn in sorted(globals().items()):
          if name.startswith("test_") and callable(fn):
              try:
                  fn()
                  print(f"  ok  {name}")
              except Exception as e:  # noqa: BLE001
                  fails += 1
                  print(f"  FAIL {name}: {e!r}")
      print(f"{'FAILED' if fails else 'PASSED'} ({fails} failures)")
      sys.exit(1 if fails else 0)
  ```

- [ ] Step2: 失敗確認（`_read_snapshots` 未実装ゆえ import/attribute で失敗）:
  ```
  cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_me_investment.py -v
  ```
  期待 FAIL: `AttributeError: module 'me_investment' has no attribute '_read_snapshots'`（全テスト error）。

- [ ] Step3: 最小実装。`api/me/investment.py` の import に psycopg errors を足す。`import psycopg`（20 行目）の直後に追加:
  ```python
  import psycopg
  from psycopg import errors as pg_errors
  ```
  `_row_to_dict`（64-72 行）の直後、`class handler` の前に純ヘルパを追加:
  ```python
  def _read_snapshots(cur):
      """me.investment_snapshots を読み (rows, schema_ok) を返す。例外は投げない。

      schema_ok=True  → 列/テーブルが存在（rows が空でも「本当にデータ 0 件」＝正常）。
      schema_ok=False → UndefinedColumn/UndefinedTable＝NISA 列 migration 未適用（silent 化せず可視化）。
      schema_ok=None  → その他の読取失敗（未知・degrade）。
      いずれも呼び出し側は 200 で degrade（空配列）を返せる。
      """
      try:
          cur.execute(
              "SELECT " + ", ".join(COLUMNS) + " FROM me.investment_snapshots "
              "ORDER BY period DESC LIMIT %s",
              (MAX_MONTHS,),
          )
          return [_row_to_dict(rec) for rec in cur.fetchall()], True
      except (pg_errors.UndefinedColumn, pg_errors.UndefinedTable) as e:
          print(f"me/investment schema not applied (migration pending): {e!r}", file=sys.stderr)
          return [], False
      except Exception as e:  # noqa: BLE001
          print(f"me/investment read degraded: {e!r}", file=sys.stderr)
          return [], None
  ```
  do_GET（76-96 行）の inline try/except（83-92 行）とその後の 200 返却を差し替える。`if not _valid_session(...)` の 401 return の後を:
  ```python
                  if not _valid_session(cur, token):
                      return self._json(401, {"error": "unauthorized"})
                  # 列/テーブル不在（migration 未適用）・読取失敗・0 件を _read_snapshots が分類し
                  # schemaOk で可視化（false=migration 未適用の silent degrade を露出）。
                  rows, schema_ok = _read_snapshots(cur)
                  return self._json(200, {"investment": rows, "schemaOk": schema_ok})
  ```

- [ ] Step4: 成功確認:
  ```
  cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_me_investment.py -v
  ```
  期待 PASS: 5 tests passed。

- [ ] Step5: commit:
  ```
  cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
  git add api/me/investment.py tests/test_me_investment.py
  git commit -m "fix(me/investment): classify schema-missing vs read failure, expose schemaOk (plan0 Task2)"
  ```

---

## Task 3: advice.py の投資台帳読取 silent degrade を分岐 + 診断ログ

`api/me/advice.py` do_POST 内の inline な investment_snapshots 読取（1461-1474 行・失敗時 `inv_rows=None`）を純ヘルパ `_read_investment_ledger(cur)` に切り出し、Task 2 と同じ語彙で列/テーブル不在を分類して stderr に**診断ログ**を出す。degrade 挙動（失敗時 `inv_rows=None` で `mode_a_facts` に渡す）は不変。facts / レスポンススキーマは変えない（パリティ据置）。

Files:
- Modify: `api/me/advice.py`
- Test: `tests/test_advice_ledger_read.py`（Create）

Interfaces:
- Consumes: Task 2 が確立した分類語彙 `schema_ok ∈ {True, False, None}`（True=列/テーブルあり・空は真の 0 件／False=`UndefinedColumn|UndefinedTable`／None=その他失敗）。
- Produces: 純関数 `_read_investment_ledger(cur) -> tuple[list[dict] | None, bool | None]`。成功時 `(rows, True)`（`rows` は `period` / `nisa_tsumitate_delta` / `nisa_growth_delta` / `nisa_tsumitate_sold_at_cost` / `nisa_growth_sold_at_cost` の dict リスト）、列/テーブル不在時 `(None, False)`、その他失敗時 `(None, None)`。do_POST は `inv_rows`（list|None）を従来どおり `mode_a_facts` に渡す。

TDD steps:

- [ ] Step1: 失敗テストを書く。`tests/test_advice_ledger_read.py` を作成:
  ```python
  """plan0: api/me/advice.py の _read_investment_ledger 分類（DB 不要・fake cursor）。

  列/テーブル不在（migration 未適用）= (None, False)、その他読取失敗 = (None, None)、
  本当に 0 件 = ([], True) を固定。degrade は従来どおり inv_rows=None に潰すが、
  分類（schema_ok）で silent 化を露出する。
  """
  import datetime as dt
  import importlib.util
  import os

  import psycopg
  from psycopg import errors as pg_errors

  HERE = os.path.dirname(os.path.abspath(__file__))
  ROOT = os.path.dirname(HERE)
  _spec = importlib.util.spec_from_file_location(
      "advice", os.path.join(ROOT, "api", "me", "advice.py"))
  advice = importlib.util.module_from_spec(_spec)
  _spec.loader.exec_module(advice)


  class FakeCur:
      def __init__(self, rows=None, exc=None):
          self._rows = [] if rows is None else rows
          self._exc = exc

      def execute(self, *a, **k):
          if self._exc is not None:
              raise self._exc

      def fetchall(self):
          return self._rows


  def test_missing_column_returns_none_and_schema_false():
      rows, ok = advice._read_investment_ledger(FakeCur(exc=pg_errors.UndefinedColumn("column ... does not exist")))
      assert rows is None and ok is False


  def test_missing_table_returns_none_and_schema_false():
      rows, ok = advice._read_investment_ledger(FakeCur(exc=pg_errors.UndefinedTable("relation ... does not exist")))
      assert rows is None and ok is False


  def test_generic_read_failure_returns_none_and_schema_none():
      rows, ok = advice._read_investment_ledger(FakeCur(exc=ValueError("boom")))
      assert rows is None and ok is None


  def test_empty_returns_empty_list_and_schema_true():
      rows, ok = advice._read_investment_ledger(FakeCur(rows=[]))
      assert rows == [] and ok is True


  def test_rows_parsed_and_schema_true():
      rec = (dt.date(2026, 5, 1), 120000, 0, 0, 0)
      rows, ok = advice._read_investment_ledger(FakeCur(rows=[rec]))
      assert ok is True
      assert rows[0]["period"] == "2026-05-01"
      assert rows[0]["nisa_tsumitate_delta"] == 120000
      assert rows[0]["nisa_growth_delta"] == 0


  if __name__ == "__main__":
      import sys
      fails = 0
      for name, fn in sorted(globals().items()):
          if name.startswith("test_") and callable(fn):
              try:
                  fn()
                  print(f"  ok  {name}")
              except Exception as e:  # noqa: BLE001
                  fails += 1
                  print(f"  FAIL {name}: {e!r}")
      print(f"{'FAILED' if fails else 'PASSED'} ({fails} failures)")
      sys.exit(1 if fails else 0)
  ```

- [ ] Step2: 失敗確認（`_read_investment_ledger` 未実装）:
  ```
  cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_advice_ledger_read.py -v
  ```
  期待 FAIL: `AttributeError: module 'advice' has no attribute '_read_investment_ledger'`（全テスト error）。

- [ ] Step3: 最小実装。`api/me/advice.py` の import に psycopg errors を足す。`import psycopg`（23 行目）の直後に追加:
  ```python
  import psycopg
  from psycopg import errors as pg_errors
  ```
  モジュールレベル（`class` handler の外・他の純ヘルパ群と同じ層）に純ヘルパを追加:
  ```python
  def _read_investment_ledger(cur):
      """me.investment_snapshots の NISA 枠別 delta を読み (rows, schema_ok) を返す。例外は投げない。

      schema_ok=True  → 列/テーブルが存在（rows が空でも真のデータ 0 件）。
      schema_ok=False → UndefinedColumn/UndefinedTable＝NISA 列 migration 未適用（可視化）。
      schema_ok=None  → その他の読取失敗（未知・degrade）。
      失敗時 rows=None（従来どおり mode_a_facts が None を吸収）。autocommit ゆえ後続クエリは無傷。
      """
      try:
          cur.execute(
              "SELECT period, nisa_tsumitate_delta, nisa_growth_delta, "
              "nisa_tsumitate_sold_at_cost, nisa_growth_sold_at_cost "
              "FROM me.investment_snapshots ORDER BY period DESC LIMIT 120"  # 直近10年
          )
          rows = [{
              "period": rec[0].isoformat() if hasattr(rec[0], "isoformat") else rec[0],
              "nisa_tsumitate_delta": rec[1], "nisa_growth_delta": rec[2],
              "nisa_tsumitate_sold_at_cost": rec[3], "nisa_growth_sold_at_cost": rec[4],
          } for rec in cur.fetchall()]
          return rows, True
      except (pg_errors.UndefinedColumn, pg_errors.UndefinedTable) as e:
          print(f"advice ledger schema not applied (migration pending): {e!r}", file=sys.stderr)
          return None, False
      except Exception as e:  # noqa: BLE001
          print(f"advice ledger read degraded: {type(e).__name__}", file=sys.stderr)
          return None, None
  ```
  do_POST の inline ブロック（1458-1474 行の `inv_rows = None` ～ `inv_rows = None` の try/except 全体）を差し替える:
  ```python
                  # B#3 Stage3: 投資台帳を server-side で読む（ledger モードの NISA 枠導出の入力）。
                  # 生額は LLM へ渡さず Mode A 集約のみ。plan0: 列/テーブル不在（migration 未適用）と
                  # その他読取失敗を分類し診断ログで可視化（inv_rows=None の silent degrade を露出）。
                  inv_rows, inv_schema_ok = _read_investment_ledger(cur)
                  if inv_schema_ok is False:
                      print("advice diagnostic: nisa ledger columns/table missing (migration pending)", file=sys.stderr)
  ```
  直後の `facts = mode_a_facts(raw_state, include_raw, now_ms, cf_rows, inv_rows)`（1476 行）は不変。

- [ ] Step4: 成功確認（新テスト＋既存パリティテスト回帰なし）:
  ```
  cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_advice_ledger_read.py tests/test_advice_facts.py -v
  ```
  期待 PASS: `test_advice_ledger_read.py` 5 tests passed かつ `test_advice_facts.py` 全 pass（facts / パリティ回帰なし）。

- [ ] Step5: commit:
  ```
  cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
  git add api/me/advice.py tests/test_advice_ledger_read.py
  git commit -m "fix(me/advice): classify ledger schema-missing vs read failure, add diagnostic log (plan0 Task3)"
  ```
