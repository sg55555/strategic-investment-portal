# NISA Stage4a Eligibility Data Foundation Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: superpowers:subagent-driven-development でtask毎に実装

## Goal

Stage4b（口座振り分け助言）が「実在の適格商品名」を捏造なしで参照できるよう、**公開データのみ・完全 inert・規制非該当**の適格判定データ基盤を作る。成果物＝(1) `market.ticker_master` へ NISA 成長枠 4 列追加＋`market.nisa_tsumitate` 新テーブル（migration + `db/schema.sql`）、(2) 成長枠フラグ更新スクリプト `scripts/refresh_nisa.py`、(3) FSA つみたて対象取込スクリプト `scripts/refresh_nisa_tsumitate.py`（openpyxl・loud-fail）、(4) ETL 書き手分離ガードと本番投入 SQL 検証。助言・LLM・個人 state には一切触れない（それは plan B）。

## Architecture

- 本番＝Vercel serverless Python (BaseHTTPRequestHandler) + Neon Postgres + psycopg3。ただし本 plan の成果物は**すべて `scripts/`（GHA/手動 ETL）と `db/`（DDL）**で、Vercel 関数は増やさない。
- 取込は既存 `scripts/seed_universe.py` / `scripts/refresh_market.py` と同型＝純関数（parse/classify/map）は network 非依存で fixture テスト可、IO（fetch/upsert）は下部に分離。
- 書き手分離（絶対）＝NISA 列/テーブルは専用 updater（`refresh_nisa*.py`）のみが書く。既存 GHA 書き手（`seed_universe.py` の `ON CONFLICT ... DO UPDATE SET`、`refresh_market.py` の `upsert_ticker_info`）に NISA 列を**足さない**（financials `source='edinet'` 保護と同型）。
- 適格判定は 2 系統：**成長枠**＝`ticker_master`（ティッカーあり 289 銘柄）にフラグ付与／**つみたて枠**＝`market.nisa_tsumitate`（証券コードなし投信 約360本）を別テーブルで完全分離（`ticker_master`/`ohlcv`/screener 経路に混ぜない）。

## Tech Stack

- Python 3.14（元 main の venv を絶対パスで使用＝worktree に `.venv` は無い）。
- 依存追加＝`openpyxl`（FSA/IMAJ xlsx を読む）。`scripts/requirements.txt` にのみ追加（Vercel 非配信）。
- テスト＝pytest（実 xlsx fixture を読む純関数テスト＋psycopg モックで SQL 形状検証）。

## Global Constraints

- **テスト実行（厳守）**：
  - Python＝`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_X.py -v`
  - （`.venv` は worktree に無く元 main の venv を絶対パスで使う。cwd は必ず worktree root＝`scripts.` import が解決する。）
- **破壊系 migration は手動適用**：`.vercelignore` が `db/` と `*.sql` を配信除外＝自動適用されない。本番 DB への適用は人手（§本 plan Task 7 の検証手順に沿って）。
- **本番読取専用検証**：共有 singleton state（`id=1`）には破壊テストをしない。適格判定は `market` スキーマ（公開データ）のみで個人 state 非依存＝inert。
- **書き手分離の破壊禁止**：`scripts/seed_universe.py` の `ON CONFLICT(ticker) DO UPDATE SET(6列)` と `scripts/refresh_market.py::upsert_ticker_info` の `UPDATE market.ticker_master SET(market_cap,per,pbr)` に NISA 列を**絶対足さない**（GHA `market-refresh` が平日日次で NISA 判定をクロバーするのを防ぐ）。Task 7 のガードテストで機械的に固定する。
- **enum 値（一字一句・plan B が Consumes）**：
  - `nisa_growth_status ∈ {'eligible','excluded','conditional','unknown'}`（default `'unknown'`）
  - `market_alert ∈ {'none','supervision','liquidation'}`（default `'none'`）
  - `nisa_source` 値＝`'jp-negative-list'` / `'us-broker-conditional'` / `'imaj-listed'` / `'etf-rule-excluded'` / `'jpx-alert'`（JP 監理・整理＝当面 dead branch・§1-11／topFix #5） / `''`（unknown 時）
  - `nisa_tsumitate.category ∈ {'index','active','etf'}`／`nisa_tsumitate.nisa_source = 'fsa-tsumitate-xlsx'`
- **実データ確定値（本 plan 作成時に元 main の venv + openpyxl で実測済み）**：
  - universe（`data/universe.csv` 289 行）＝JP stock 100・JP etf 5（`1306.T`/`1321.T`/`1343.T`/`1348.T`/`2558.T`）・US stock 166・US etf 18。
  - `scratchpad/nisa_shisan.xlsx`（FSA つみたて対象・実ファイルは main リポ `/home/shugo/apps/investment-portal/scratchpad/`）＝3 シート：`指定インデックス投資信託`（データ 286 本・r4 ヘッダ・fund 列 index 3・mgmt 列 index 4・指数名 index 2・国内海外 index 1・単一複数区分 index 0）／`指定インデックス投資信託以外の投資信託（アクティブ運用投信等）`（データ 65 本・r4 ヘッダ・fund index 2・mgmt index 3・国内海外 index 0）／`上場株式投資信託（ETF）`（データ 9 本・r4 ヘッダ・fund index 1・mgmt index 2・指数名 index 0）。**r0–r3 はメタ行**（r0 に Excel 日付シリアル `46219`＝`datetime(1899,12,30)+46219日 = 2026-07-16`）。col A/B/C は縦結合セル＝先頭行のみ値・以降 None＝**forward-fill 必須**。
  - `scratchpad/imaj_listed.xlsx`（成長枠上場対象・IMAJ）＝シート `対象商品一覧`（r0 タイトル・r1 ヘッダ・データ r2 以降 417 本）。列＝`銘柄コード`(index 3・5 桁 int/str, 例 `13060`)・`ファンド名称`(index 4)・`決算回数`(index 8)。universe の 5 ETF は全て 5 桁コード先頭 4 桁で一致（`13060→1306` 等）＝全て `eligible`（決算回数に「毎月」該当なし）。

---

### Task 1: Migration SQL＋schema.sql に NISA 4 列と nisa_tsumitate テーブル

**Files:**
- Create: `db/migrations/2026-07-21-nisa-eligibility.sql`
- Modify: `db/schema.sql`（`market.ticker_master` に 4 列・末尾に `market.nisa_tsumitate` CREATE）
- Test: `tests/test_nisa_migration.py`

**Interfaces:**
- Consumes: なし（起点）。
- Produces: DDL 契約（plan B が SELECT で Consumes）＝
  - `market.ticker_master` 追加列＝`nisa_growth_status TEXT default 'unknown'`, `market_alert TEXT default 'none'`, `nisa_source TEXT default ''`, `nisa_checked_at TIMESTAMPTZ default null`。
  - `market.nisa_tsumitate(id serial PK, fund_name TEXT NOT NULL UNIQUE, mgmt_company TEXT, category TEXT, index_name TEXT, domestic_foreign TEXT, fund_code TEXT, etf_ticker TEXT, list_updated_at DATE, nisa_source TEXT default 'fsa-tsumitate-xlsx')`。

**TDD steps:**

- [ ] Step 1: 失敗テストを書く（DDL ファイルの構造契約を検証）。`tests/test_nisa_migration.py`:
```python
import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MIG = os.path.join(ROOT, "db", "migrations", "2026-07-21-nisa-eligibility.sql")
SCHEMA = os.path.join(ROOT, "db", "schema.sql")


def _sql(path):
    return open(path, encoding="utf-8").read()


def test_migration_adds_four_ticker_master_columns_idempotent():
    s = _sql(MIG).lower()
    assert "alter table market.ticker_master" in s
    for col, default in [
        ("nisa_growth_status", "'unknown'"),
        ("market_alert", "'none'"),
        ("nisa_source", "''"),
        ("nisa_checked_at", "null"),
    ]:
        assert re.search(rf"add column if not exists\s+{col}\b", s), f"missing add {col}"
    assert s.count("add column if not exists") >= 4


def test_migration_creates_nisa_tsumitate_with_unique_fund_name():
    s = _sql(MIG).lower()
    assert "create table if not exists market.nisa_tsumitate" in s
    assert "fund_name" in s and "unique" in s
    assert "nisa_source" in s and "'fsa-tsumitate-xlsx'" in s
    for col in ("mgmt_company", "category", "index_name", "domestic_foreign",
                "fund_code", "etf_ticker", "list_updated_at"):
        assert col in s, f"missing column {col}"


def test_schema_sql_carries_same_ddl_for_fresh_creates():
    s = _sql(SCHEMA).lower()
    assert "nisa_growth_status" in s and "market_alert" in s
    assert "create table if not exists market.nisa_tsumitate" in s
```
- [ ] Step 2: 失敗を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_nisa_migration.py -v` → 期待 FAIL（ファイル不在で `FileNotFoundError`／全 assert 未達）。
- [ ] Step 3: 最小実装。`db/migrations/2026-07-21-nisa-eligibility.sql`:
```sql
-- B#3 Stage4a（適格判定データ基盤・公開データ・inert・規制非該当）。
-- 冪等: ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS ゆえ後追い/再適用安全。
-- .vercelignore が db/ と *.sql を配信除外 → 自動適用されない = 手動適用。
ALTER TABLE market.ticker_master
  ADD COLUMN IF NOT EXISTS nisa_growth_status TEXT NOT NULL DEFAULT 'unknown',  -- 'eligible'|'excluded'|'conditional'|'unknown'
  ADD COLUMN IF NOT EXISTS market_alert       TEXT NOT NULL DEFAULT 'none',     -- 'none'|'supervision'|'liquidation'（将来 JPX 監理整理差込点）
  ADD COLUMN IF NOT EXISTS nisa_source        TEXT NOT NULL DEFAULT '',         -- 判定根拠
  ADD COLUMN IF NOT EXISTS nisa_checked_at    TIMESTAMPTZ DEFAULT NULL;         -- 判定鮮度

-- つみたて対象投信（金融庁公表・約360本＝証券コードなし・価格系列なし）。
-- ticker_master/ohlcv/screener 経路に混ぜない（PK=serial・投信は証券コード無し）。
CREATE TABLE IF NOT EXISTS market.nisa_tsumitate (
  id               SERIAL PRIMARY KEY,
  fund_name        TEXT NOT NULL UNIQUE,   -- 自然キー。ON CONFLICT(fund_name) で serial 安定（refs 参照先を版間保持）
  mgmt_company     TEXT,
  category         TEXT,                   -- 'index' | 'active' | 'etf'
  index_name       TEXT,
  domestic_foreign TEXT,
  fund_code        TEXT,                   -- IMAJ left-join 補完（null 許容）
  etf_ticker       TEXT,                   -- ETF 区分のみ（null 許容）
  list_updated_at  DATE,                   -- FSA リスト改定日（r0 Excel シリアル由来）
  nisa_source      TEXT NOT NULL DEFAULT 'fsa-tsumitate-xlsx'
);
```
  同じ DDL を `db/schema.sql` にも反映（fresh create 用）。`market.ticker_master` の `CREATE TABLE` 内 `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()` 行の直後に 4 列を追加：
```sql
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  nisa_growth_status TEXT NOT NULL DEFAULT 'unknown',  -- 'eligible'|'excluded'|'conditional'|'unknown'
  market_alert       TEXT NOT NULL DEFAULT 'none',     -- 'none'|'supervision'|'liquidation'
  nisa_source        TEXT NOT NULL DEFAULT '',
  nisa_checked_at    TIMESTAMPTZ DEFAULT NULL
```
  （既存の `updated_at ... DEFAULT now()` は `ticker_master` 定義の最終列＝末尾カンマ調整に注意。）さらに `db/schema.sql` 末尾に上記 `CREATE TABLE IF NOT EXISTS market.nisa_tsumitate (...)` を追記。
- [ ] Step 4: 成功を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_nisa_migration.py -v` → 期待 PASS（3 tests passed）。
- [ ] Step 5: commit。
```bash
cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
git add db/migrations/2026-07-21-nisa-eligibility.sql db/schema.sql tests/test_nisa_migration.py
git commit -m "Add NISA eligibility DDL: ticker_master 4 cols + market.nisa_tsumitate"
```

---

### Task 2: IMAJ 成長枠上場リストの銘柄コード集合パーサ（openpyxl・loud-fail）

**Files:**
- Create: `scripts/refresh_nisa.py`（`parse_imaj_growth_codes` のみ）
- Create: `tests/fixtures/imaj_listed.xlsx`（main リポ scratchpad から複製）
- Modify: `scripts/requirements.txt`（`openpyxl` 追加）
- Test: `tests/test_refresh_nisa.py`

**Interfaces:**
- Consumes: なし。
- Produces: `parse_imaj_growth_codes(path_or_wb) -> set[str]`（4 桁銘柄コード集合。IMAJ 5 桁コードの先頭 4 桁）。Task 3 の `classify_growth_status` が `imaj_codes` 引数として Consumes。

**TDD steps:**

- [ ] Step 1: fixture を複製（read-only source＝非破壊・再生成可能）。
```bash
cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
mkdir -p tests/fixtures
cp /home/shugo/apps/investment-portal/scratchpad/imaj_listed.xlsx tests/fixtures/imaj_listed.xlsx
```
- [ ] Step 2: 失敗テストを書く。`tests/test_refresh_nisa.py`:
```python
import os
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAJ = os.path.join(ROOT, "tests", "fixtures", "imaj_listed.xlsx")


def test_parse_imaj_growth_codes_returns_4digit_set_and_matches_universe_etfs():
    from scripts.refresh_nisa import parse_imaj_growth_codes
    codes = parse_imaj_growth_codes(IMAJ)
    assert isinstance(codes, set)
    assert 380 <= len(codes) <= 460   # 実測 417 本
    # universe の 5 JP ETF は全て 4 桁先頭一致（13060→'1306' 等）
    for c in ("1306", "1321", "1343", "1348", "2558"):
        assert c in codes


def test_parse_imaj_growth_codes_loud_fails_on_out_of_range(tmp_path):
    import openpyxl
    from scripts.refresh_nisa import parse_imaj_growth_codes
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "対象商品一覧"
    ws.append(["タイトル"])                                  # r0
    ws.append(["リスト更新日", "追加・変更の別", "別", "銘柄コード", "ファンド名称"])  # r1 header
    ws.append([20230621, "追加", "上場投信", "13060", "X"])   # r2 データ1件のみ = レンジ外
    p = tmp_path / "tiny.xlsx"
    wb.save(p)
    with pytest.raises(RuntimeError):
        parse_imaj_growth_codes(str(p))
```
- [ ] Step 3: 失敗を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa.py -v` → 期待 FAIL（`ModuleNotFoundError: scripts.refresh_nisa` / 関数不在）。
- [ ] Step 4: 最小実装。`scripts/refresh_nisa.py`:
```python
"""NISA 成長投資枠フラグ更新（market.ticker_master の NISA 列のみ・非破壊）。

公開データのみ・inert・規制非該当。既存 GHA 書き手（seed_universe/refresh_market）は
NISA 列に触れない（書き手分離）。
使い方: DATABASE_URL=... IMAJ_XLSX=/path/imaj_listed.xlsx python scripts/refresh_nisa.py
"""
from __future__ import annotations
import os
import re
import sys

# 成長枠除外パターン（レバレッジ/インバース/毎月分配等）。現ユニバース該当0＝将来混入ガード。
EXCLUDE_RE = re.compile(r"レバレッジ|インバース|ブル|ベア|ダブル|2倍|日々|毎月")

# IMAJ 「対象商品一覧」レンジ（実測 417 本）。構造変更で無言破損を防ぐ loud-fail。
_IMAJ_MIN, _IMAJ_MAX = 380, 460


def parse_imaj_growth_codes(path_or_wb) -> set[str]:
    """IMAJ 成長投資枠上場対象リストの銘柄コード先頭4桁集合を返す。"""
    import openpyxl
    if isinstance(path_or_wb, str):
        wb = openpyxl.load_workbook(path_or_wb, read_only=True, data_only=True)
    else:
        wb = path_or_wb
    ws = wb["対象商品一覧"]
    codes: set[str] = set()
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 2:            # r0=タイトル・r1=ヘッダ
            continue
        code = row[3] if len(row) > 3 else None
        if code is None or not str(code).strip():
            continue
        codes.add(str(code).strip()[:4])
    if not (_IMAJ_MIN <= len(codes) <= _IMAJ_MAX):
        raise RuntimeError(
            f"[refresh_nisa] IMAJ growth codes out of range: {len(codes)} "
            f"(expected {_IMAJ_MIN}-{_IMAJ_MAX}) — FSA/IMAJ layout changed?")
    return codes
```
  `scripts/requirements.txt` に 1 行追加：
```
openpyxl>=3.1
```
- [ ] Step 5: 成功を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa.py -v` → 期待 PASS（2 tests passed）。
- [ ] Step 6: commit。
```bash
cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
git add scripts/refresh_nisa.py scripts/requirements.txt tests/fixtures/imaj_listed.xlsx tests/test_refresh_nisa.py
git commit -m "Add IMAJ growth-code parser (openpyxl, loud-fail range guard)"
```

---

### Task 3: 成長枠適格判定の純関数 `classify_growth_status`

**Files:**
- Modify: `scripts/refresh_nisa.py`（`classify_growth_status` 追加）
- Test: `tests/test_refresh_nisa.py`（判定分岐を追加）

**Interfaces:**
- Consumes: `parse_imaj_growth_codes(...) -> set[str]`（Task 2）。
- Produces: `classify_growth_status(ticker: str, country: str, sec_type: str, name: str, imaj_codes: set[str], market_alert: str='none') -> tuple[str, str]`＝`(nisa_growth_status, nisa_source)`。Task 4 の DB writer が Consumes。

**TDD steps:**

- [ ] Step 1: 失敗テストを追記。`tests/test_refresh_nisa.py` に:
```python
def test_classify_growth_status_all_branches():
    from scripts.refresh_nisa import classify_growth_status
    imaj = {"1306", "1321", "1343", "1348", "2558"}
    # JP 個別株 → eligible
    assert classify_growth_status("7203.T", "JP", "stock", "トヨタ自動車", imaj) \
        == ("eligible", "jp-negative-list")
    # US 個別株・US ETF → conditional（全 184）
    assert classify_growth_status("AAPL", "US", "stock", "Apple", imaj) \
        == ("conditional", "us-broker-conditional")
    assert classify_growth_status("SPY", "US", "etf", "S&P 500 ETF (SPY)", imaj) \
        == ("conditional", "us-broker-conditional")
    # JP ETF：IMAJ 該当 → eligible / 非該当 → unknown
    assert classify_growth_status("1306.T", "JP", "etf", "NEXT FUNDS TOPIX連動型上場投信", imaj) \
        == ("eligible", "imaj-listed")
    assert classify_growth_status("9999.T", "JP", "etf", "架空ETF", imaj) \
        == ("unknown", "")
    # レバ/インバ/毎月分配 ETF → excluded（type=etf のみ・name パターン）
    assert classify_growth_status("1570.T", "JP", "etf", "日経レバレッジ指数ETF", imaj) \
        == ("excluded", "etf-rule-excluded")
    # 将来 JP 監理整理（market_alert!=none）→ excluded（nisa_source は契約 enum の 'jpx-alert' に寄せる・topFix #5）
    assert classify_growth_status("7203.T", "JP", "stock", "トヨタ", imaj, market_alert="supervision") \
        == ("excluded", "jpx-alert")
    assert classify_growth_status("7203.T", "JP", "stock", "トヨタ", imaj, market_alert="liquidation") \
        == ("excluded", "jpx-alert")
    # その他（未知の country）→ unknown 安全側
    assert classify_growth_status("XX", "GB", "stock", "Foo", imaj) == ("unknown", "")
```
- [ ] Step 2: 失敗を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa.py::test_classify_growth_status_all_branches -v` → 期待 FAIL（関数不在）。
- [ ] Step 3: 最小実装。`scripts/refresh_nisa.py` の `parse_imaj_growth_codes` の下に:
```python
def classify_growth_status(ticker, country, sec_type, name, imaj_codes,
                           market_alert="none"):
    """成長投資枠の適格性を (status, nisa_source) で返す。判定順序を固定（決定論）。"""
    name = name or ""
    # 1) ファンド(ETF)のレバ/インバ/毎月分配は市場問わず除外（将来混入ガード）
    if sec_type == "etf" and EXCLUDE_RE.search(name):
        return ("excluded", "etf-rule-excluded")
    # 2) JP 個別株：監理整理が付けば除外・それ以外は一律 eligible（現該当0＝§1-11 割り切り）
    if country == "JP" and sec_type == "stock":
        if market_alert != "none":
            # topFix #5: nisa_source は契約 enum に含まれる 'jpx-alert' に寄せる（supervision/liquidation の別は
            # market_alert 列が保持する）。当面 refresh_nisa は market_alert='none' 固定ゆえ dead branch。
            return ("excluded", "jpx-alert")
        return ("eligible", "jp-negative-list")
    # 3) US 個別株・US ETF（全184）：成長枠取扱いは証券会社依存 → conditional
    if country == "US":
        return ("conditional", "us-broker-conditional")
    # 4) JP ETF：IMAJ 成長枠上場リストに銘柄コード突合で該当 → eligible
    if country == "JP" and sec_type == "etf":
        code4 = ticker.split(".")[0]
        if code4 in imaj_codes:
            return ("eligible", "imaj-listed")
        return ("unknown", "")
    # 5) 判定不能 → unknown（安全側）
    return ("unknown", "")
```
- [ ] Step 4: 成功を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa.py -v` → 期待 PASS（3 tests passed）。
- [ ] Step 5: commit。
```bash
cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
git add scripts/refresh_nisa.py tests/test_refresh_nisa.py
git commit -m "Add classify_growth_status pure fn (JP/US/JP-ETF/excluded/unknown)"
```

---

### Task 4: `refresh_nisa.py` の DB 層（NISA 3 列のみ UPDATE）＋ main／loud-fail

**Files:**
- Modify: `scripts/refresh_nisa.py`（`load_ticker_rows`/`upsert_nisa_status`/`run`/`main` 追加）
- Test: `tests/test_refresh_nisa.py`（SQL 形状・書き手範囲・loud-fail）

**Interfaces:**
- Consumes: `classify_growth_status(...) -> (status, source)`（Task 3）、`parse_imaj_growth_codes(...) -> set[str]`（Task 2）。
- Produces: `upsert_nisa_status(conn, ticker, status, source)`（`UPDATE market.ticker_master SET nisa_growth_status,nisa_source,nisa_checked_at=now() WHERE ticker=%s`＝NISA 列のみ）、`run(conn, imaj_codes) -> dict`（`{'updated': int, 'by_status': {...}}`）、`main(argv=None) -> int`（全 0 更新は非ゼロ loud-fail）。

**TDD steps:**

- [ ] Step 1: 失敗テストを追記。`tests/test_refresh_nisa.py` に:
```python
def test_upsert_nisa_status_touches_only_nisa_columns():
    from scripts.refresh_nisa import upsert_nisa_status
    captured = {}
    class Cur:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def execute(self, sql, params): captured["sql"] = sql; captured["params"] = params
    class Conn:
        def cursor(self): return Cur()
    upsert_nisa_status(Conn(), "7203.T", "eligible", "jp-negative-list")
    s = captured["sql"].replace(" ", "").lower()
    assert "updatemarket.ticker_master" in s
    assert "nisa_growth_status=%s" in s and "nisa_source=%s" in s
    assert "nisa_checked_at=now()" in s
    # 書き手分離: 市場データ列を絶対に触らない
    for forbidden in ("market_cap", "per=", "pbr", "company_name"):
        assert forbidden not in s
    assert captured["params"] == ("eligible", "jp-negative-list", "7203.T")


def test_run_classifies_all_rows(monkeypatch):
    from scripts import refresh_nisa as R
    rows = [("7203.T", "JP", "stock", "トヨタ"),
            ("AAPL", "US", "stock", "Apple"),
            ("1306.T", "JP", "etf", "NEXT FUNDS TOPIX連動型上場投信"),
            ("9999.T", "JP", "etf", "架空ETF")]
    monkeypatch.setattr(R, "load_ticker_rows", lambda conn: rows)
    seen = []
    monkeypatch.setattr(R, "upsert_nisa_status",
                        lambda conn, t, st, src: seen.append((t, st, src)))
    res = R.run(None, {"1306"})
    assert res["updated"] == 4
    assert ("7203.T", "eligible", "jp-negative-list") in seen
    assert ("1306.T", "eligible", "imaj-listed") in seen
    assert ("9999.T", "unknown", "") in seen
    assert res["by_status"]["conditional"] == 1


def test_main_loud_fails_when_no_rows(monkeypatch):
    from scripts import refresh_nisa as R
    class _NullConn:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(R, "_connect", lambda: _NullConn())
    monkeypatch.setattr(R, "_imaj_codes", lambda: {"1306"} | {str(9000 + i) for i in range(400)})
    monkeypatch.setattr(R, "load_ticker_rows", lambda conn: [])
    assert R.main([]) != 0   # 0 更新は非ゼロ終了
```
- [ ] Step 2: 失敗を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa.py -v` → 期待 FAIL（`upsert_nisa_status`/`run`/`main` 不在）。
- [ ] Step 3: 最小実装。`scripts/refresh_nisa.py` 末尾に:
```python
def load_ticker_rows(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT ticker, country, type, company_name "
                    "FROM market.ticker_master ORDER BY ticker")
        return list(cur.fetchall())


def upsert_nisa_status(conn, ticker, status, source):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE market.ticker_master SET nisa_growth_status=%s, nisa_source=%s, "
            "nisa_checked_at=now() WHERE ticker=%s",
            (status, source, ticker))


def run(conn, imaj_codes):
    rows = load_ticker_rows(conn)
    by_status = {}
    for ticker, country, sec_type, name in rows:
        status, source = classify_growth_status(ticker, country, sec_type, name, imaj_codes)
        upsert_nisa_status(conn, ticker, status, source)
        by_status[status] = by_status.get(status, 0) + 1
    return {"updated": len(rows), "by_status": by_status}


def _connect():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set")
    import psycopg
    return psycopg.connect(url)


def _imaj_codes():
    path = os.environ.get("IMAJ_XLSX")
    if not path or not os.path.exists(path):
        raise SystemExit("IMAJ_XLSX not set or file missing (成長枠上場対象リスト xlsx)")
    return parse_imaj_growth_codes(path)


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    imaj = _imaj_codes()
    with _connect() as conn:
        res = run(conn, imaj)
    print(f"[refresh_nisa] updated={res['updated']} by_status={res['by_status']}",
          file=sys.stderr)
    return 0 if res["updated"] > 0 else 1   # loud-fail: 0 更新は非ゼロ


if __name__ == "__main__":
    raise SystemExit(main())
```
- [ ] Step 4: 成功を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa.py -v` → 期待 PASS（6 tests passed）。
- [ ] Step 5: commit。
```bash
cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
git add scripts/refresh_nisa.py tests/test_refresh_nisa.py
git commit -m "Add refresh_nisa DB layer: NISA-only UPDATE + run + loud-fail main"
```

---

### Task 5: FSA つみたて対象 xlsx パーサ `parse_fsa_tsumitate`（3 シート・forward-fill・日付シリアル・loud-fail）

**Files:**
- Create: `scripts/refresh_nisa_tsumitate.py`（`parse_fsa_tsumitate`＋`_fsa_list_date` のみ）
- Create: `tests/fixtures/nisa_shisan.xlsx`（main リポ scratchpad から複製）
- Test: `tests/test_refresh_nisa_tsumitate.py`

**Interfaces:**
- Consumes: なし。
- Produces: `parse_fsa_tsumitate(path_or_wb) -> list[dict]`＝各 dict キー `fund_name, mgmt_company, category, index_name, domestic_foreign, list_updated_at`（`category ∈ {'index','active','etf'}`・`list_updated_at` は `datetime.date`）。Task 6 の upsert が Consumes。

**TDD steps:**

- [ ] Step 1: fixture を複製（read-only source＝非破壊）。
```bash
cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
cp /home/shugo/apps/investment-portal/scratchpad/nisa_shisan.xlsx tests/fixtures/nisa_shisan.xlsx
```
- [ ] Step 2: 失敗テストを書く。`tests/test_refresh_nisa_tsumitate.py`:
```python
import datetime
import os
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FSA = os.path.join(ROOT, "tests", "fixtures", "nisa_shisan.xlsx")


def test_parse_fsa_tsumitate_counts_and_categories():
    from scripts.refresh_nisa_tsumitate import parse_fsa_tsumitate
    rows = parse_fsa_tsumitate(FSA)
    cats = {}
    for r in rows:
        cats[r["category"]] = cats.get(r["category"], 0) + 1
    assert cats["index"] == 286
    assert cats["active"] == 65
    assert cats["etf"] == 9
    assert len(rows) == 360


def test_parse_fsa_tsumitate_fields_and_forward_fill():
    from scripts.refresh_nisa_tsumitate import parse_fsa_tsumitate
    rows = parse_fsa_tsumitate(FSA)
    first = next(r for r in rows if r["category"] == "index")
    assert first["fund_name"] == "SBI・iシェアーズ・TOPIXインデックス"
    assert first["mgmt_company"].startswith("SBIアセットマネジメント")
    assert first["index_name"] == "TOPIX"
    assert first["domestic_foreign"] == "国内型"
    # 縦結合セルの2行目以降も forward-fill されている
    second = [r for r in rows if r["category"] == "index"][1]
    assert second["index_name"] == "TOPIX" and second["domestic_foreign"] == "国内型"
    # list_updated_at = r0 Excel シリアル 46219 = 2026-07-16
    assert first["list_updated_at"] == datetime.date(2026, 7, 16)
    # ETF シートは index_name あり・domestic_foreign なし
    etf = next(r for r in rows if r["category"] == "etf")
    assert etf["fund_name"].startswith("iFreeETF")
    assert etf["index_name"] == "TOPIX"


def test_parse_fsa_tsumitate_loud_fails_on_short_index_sheet(tmp_path):
    import openpyxl
    from scripts.refresh_nisa_tsumitate import parse_fsa_tsumitate
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "指定インデックス投資信託"
    for i in range(4):
        ws.append([None, None, None, None, 46219 if i == 0 else None, None])
    ws.append(["単一指数", "国内型", "TOPIX", "ファンドA", "運用A", None])  # データ1件のみ=レンジ外
    p = tmp_path / "short.xlsx"
    wb.save(p)
    with pytest.raises(RuntimeError):
        parse_fsa_tsumitate(str(p))
```
- [ ] Step 3: 失敗を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa_tsumitate.py -v` → 期待 FAIL（`ModuleNotFoundError: scripts.refresh_nisa_tsumitate`）。
- [ ] Step 4: 最小実装。`scripts/refresh_nisa_tsumitate.py`:
```python
"""FSA つみたて投資枠対象商品リスト取込 → market.nisa_tsumitate（非破壊 upsert）。

公開データのみ・inert・規制非該当。openpyxl で 3 シートを正規化し ON CONFLICT(fund_name)。
使い方: DATABASE_URL=... FSA_XLSX=/path/nisa_shisan.xlsx [IMAJ_XLSX=...] \
        python scripts/refresh_nisa_tsumitate.py
"""
from __future__ import annotations
import datetime
import os
import sys

# シート名 → (category, fund_col, mgmt_col, index_col, df_col)。index/df 無しは None。
# col は 0 始まり列インデックス。r0-r3 メタ・r4 ヘッダ・r5 以降データ。
_SHEETS = {
    "指定インデックス投資信託": ("index", 3, 4, 2, 1),
    "指定インデックス投資信託以外の投資信託（アクティブ運用投信等）": ("active", 2, 3, None, 0),
    "上場株式投資信託（ETF）": ("etf", 1, 2, 0, None),
}
# loud-fail レンジ（実測 index286/active65/etf9）。
_RANGES = {"index": (260, 320), "active": (50, 90), "etf": (5, 15)}
_DATA_START = 5   # r0-3 メタ・r4 ヘッダ・r5 からデータ


def _fsa_list_date(ws) -> datetime.date:
    """r0 の Excel 日付シリアル（最初の数値セル）を date に変換。"""
    for cell in next(ws.iter_rows(min_row=1, max_row=1, values_only=True)):
        if isinstance(cell, (int, float)) and cell > 40000:
            return (datetime.datetime(1899, 12, 30)
                    + datetime.timedelta(days=int(cell))).date()
    raise RuntimeError("[refresh_nisa_tsumitate] r0 date serial not found — FSA layout changed?")


def parse_fsa_tsumitate(path_or_wb) -> list[dict]:
    import openpyxl
    if isinstance(path_or_wb, str):
        wb = openpyxl.load_workbook(path_or_wb, read_only=True, data_only=True)
    else:
        wb = path_or_wb
    out: list[dict] = []
    for title, (category, fcol, mcol, icol, dcol) in _SHEETS.items():
        if title not in wb.sheetnames:
            raise RuntimeError(f"[refresh_nisa_tsumitate] missing sheet {title!r} — FSA layout changed?")
        ws = wb[title]
        list_date = _fsa_list_date(ws)
        ff = {"index_name": None, "domestic_foreign": None}   # 縦結合セルの forward-fill 状態
        n = 0
        for i, row in enumerate(ws.iter_rows(values_only=True)):
            if i < _DATA_START:
                continue
            fund = row[fcol] if len(row) > fcol else None
            if not fund or not str(fund).strip():
                continue
            if icol is not None and len(row) > icol and row[icol] and str(row[icol]).strip():
                ff["index_name"] = str(row[icol]).strip()
            if dcol is not None and len(row) > dcol and row[dcol] and str(row[dcol]).strip():
                ff["domestic_foreign"] = str(row[dcol]).strip()
            mgmt = row[mcol] if len(row) > mcol and row[mcol] else None
            out.append({
                "fund_name": str(fund).strip(),
                "mgmt_company": str(mgmt).strip() if mgmt else None,
                "category": category,
                "index_name": ff["index_name"] if icol is not None else None,
                "domestic_foreign": ff["domestic_foreign"] if dcol is not None else None,
                "list_updated_at": list_date,
            })
            n += 1
        lo, hi = _RANGES[category]
        if not (lo <= n <= hi):
            raise RuntimeError(
                f"[refresh_nisa_tsumitate] {category} count {n} out of range "
                f"({lo}-{hi}) — FSA sheet {title!r} layout changed?")
    return out
```
- [ ] Step 5: 成功を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa_tsumitate.py -v` → 期待 PASS（3 tests passed）。
- [ ] Step 6: commit。
```bash
cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
git add scripts/refresh_nisa_tsumitate.py tests/fixtures/nisa_shisan.xlsx tests/test_refresh_nisa_tsumitate.py
git commit -m "Add FSA tsumitate xlsx parser (3 sheets, forward-fill, date serial, loud-fail)"
```

---

### Task 6: `refresh_nisa_tsumitate.py` の DB 層（ON CONFLICT(fund_name) upsert）＋IMAJ 補完＋main

**Files:**
- Modify: `scripts/refresh_nisa_tsumitate.py`（`_norm_name`/`imaj_code_by_name`/`enrich_with_imaj`/`upsert_tsumitate`/`main` 追加）
- Test: `tests/test_refresh_nisa_tsumitate.py`（upsert SQL 形状・IMAJ 補完・main loud-fail）

**Interfaces:**
- Consumes: `parse_fsa_tsumitate(...) -> list[dict]`（Task 5）、`parse_imaj_growth_codes` は使わず IMAJ 名寄せ用に別途 workbook を読む。
- Produces: `upsert_tsumitate(conn, rows) -> int`（`INSERT ... ON CONFLICT(fund_name) DO UPDATE SET` で serial 保持）、`enrich_with_imaj(rows, imaj_wb_or_path) -> None`（`fund_code`/`etf_ticker` を name 正規化 join で best-effort 補完）、`main(argv=None) -> int`。

**TDD steps:**

- [ ] Step 1: 失敗テストを追記。`tests/test_refresh_nisa_tsumitate.py` に:
```python
def test_upsert_tsumitate_on_conflict_fund_name_preserves_serial():
    from scripts.refresh_nisa_tsumitate import upsert_tsumitate
    captured = {}
    class Cur:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def executemany(self, sql, rows): captured["sql"] = sql; captured["rows"] = rows
    class Conn:
        def cursor(self): return Cur()
    import datetime
    rows = [{"fund_name": "F1", "mgmt_company": "M", "category": "index",
             "index_name": "TOPIX", "domestic_foreign": "国内型",
             "fund_code": None, "etf_ticker": None,
             "list_updated_at": datetime.date(2026, 7, 16)}]
    n = upsert_tsumitate(Conn(), rows)
    s = captured["sql"].replace(" ", "").lower()
    assert "insertintomarket.nisa_tsumitate" in s
    assert "onconflict(fund_name)doupdateset" in s
    assert "'fsa-tsumitate-xlsx'" in s.replace("'", "'")  # nisa_source 定数
    assert n == 1


def test_enrich_with_imaj_fills_etf_ticker_by_normalized_name(tmp_path):
    import openpyxl
    from scripts.refresh_nisa_tsumitate import enrich_with_imaj
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "対象商品一覧"
    ws.append(["タイトル"])
    ws.append(["リスト更新日", "別", "別", "銘柄コード", "ファンド名称"])
    ws.append([20230621, "追加", "上場投信", "13060", "ＮＥＸＴ ＦＵＮＤＳ ＴＯＰＩＸ連動型上場投信"])
    rows = [{"fund_name": "NEXT FUNDS TOPIX連動型上場投信", "category": "etf",
             "fund_code": None, "etf_ticker": None}]
    enrich_with_imaj(rows, wb)
    assert rows[0]["fund_code"] == "13060"
    assert rows[0]["etf_ticker"] == "1306"


def test_main_loud_fails_when_no_rows(monkeypatch):
    from scripts import refresh_nisa_tsumitate as R
    class _NullConn:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(R, "_connect", lambda: _NullConn())
    monkeypatch.setattr(R, "_fetch_rows", lambda: [])
    assert R.main([]) != 0
```
- [ ] Step 2: 失敗を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa_tsumitate.py -v` → 期待 FAIL（`upsert_tsumitate`/`enrich_with_imaj`/`main` 不在）。
- [ ] Step 3: 最小実装。`scripts/refresh_nisa_tsumitate.py` 末尾に:
```python
import unicodedata

_TS_COLS = ("fund_name", "mgmt_company", "category", "index_name",
            "domestic_foreign", "fund_code", "etf_ticker", "list_updated_at")


def _norm_name(s) -> str:
    """全角/半角・空白差を吸収した名寄せキー。"""
    if not s:
        return ""
    return unicodedata.normalize("NFKC", str(s)).replace(" ", "").replace("　", "").lower()


def imaj_code_by_name(path_or_wb) -> dict:
    """IMAJ ファンド名称(正規化) → 5桁銘柄コード の map。"""
    import openpyxl
    if isinstance(path_or_wb, str):
        wb = openpyxl.load_workbook(path_or_wb, read_only=True, data_only=True)
    else:
        wb = path_or_wb
    ws = wb["対象商品一覧"]
    out = {}
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 2:
            continue
        code = row[3] if len(row) > 3 else None
        name = row[4] if len(row) > 4 else None
        if code and name:
            out[_norm_name(name)] = str(code).strip()
    return out


def enrich_with_imaj(rows, path_or_wb) -> None:
    """fund_code / etf_ticker を IMAJ 名寄せで best-effort 補完（null 許容）。"""
    code_map = imaj_code_by_name(path_or_wb)
    for r in rows:
        code = code_map.get(_norm_name(r["fund_name"]))
        if code:
            r["fund_code"] = code
            if r.get("category") == "etf":
                r["etf_ticker"] = code[:4]


def upsert_tsumitate(conn, rows) -> int:
    if not rows:
        return 0
    for r in rows:                       # 欠けキーを null 埋め（IMAJ 未補完でも INSERT 可）
        r.setdefault("fund_code", None)
        r.setdefault("etf_ticker", None)
    cols = ",".join(_TS_COLS) + ",nisa_source"
    ph = ",".join([f"%({c})s" for c in _TS_COLS]) + ",'fsa-tsumitate-xlsx'"
    setexpr = ", ".join(f"{c}=EXCLUDED.{c}" for c in _TS_COLS if c != "fund_name")
    sql = (f"INSERT INTO market.nisa_tsumitate ({cols}) VALUES ({ph}) "
           f"ON CONFLICT (fund_name) DO UPDATE SET {setexpr}")
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


def _connect():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set")
    import psycopg
    return psycopg.connect(url)


def _fetch_rows():
    path = os.environ.get("FSA_XLSX")
    if not path or not os.path.exists(path):
        raise SystemExit("FSA_XLSX not set or file missing (つみたて投資枠対象商品 xlsx)")
    rows = parse_fsa_tsumitate(path)
    imaj = os.environ.get("IMAJ_XLSX")
    if imaj and os.path.exists(imaj):
        enrich_with_imaj(rows, imaj)     # IMAJ は fund_code/etf_ticker 補完のみ（任意）
    return rows


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    rows = _fetch_rows()
    with _connect() as conn:
        n = upsert_tsumitate(conn, rows)
    print(f"[refresh_nisa_tsumitate] upserted={n}", file=sys.stderr)
    return 0 if n > 0 else 1   # loud-fail: 0 件は非ゼロ


if __name__ == "__main__":
    raise SystemExit(main())
```
- [ ] Step 4: 成功を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_refresh_nisa_tsumitate.py -v` → 期待 PASS（6 tests passed）。
- [ ] Step 5: commit。
```bash
cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
git add scripts/refresh_nisa_tsumitate.py tests/test_refresh_nisa_tsumitate.py
git commit -m "Add nisa_tsumitate upsert (ON CONFLICT fund_name) + IMAJ enrich + main"
```

---

### Task 7: 書き手分離ガードテスト＋本番投入 SQL 検証手順

**Files:**
- Test: `tests/test_nisa_writer_separation.py`
- Modify: `db/migrations/2026-07-21-nisa-eligibility.sql`（末尾に検証クエリをコメント追記）

**Interfaces:**
- Consumes: なし（既存 `scripts/seed_universe.py`・`scripts/refresh_market.py` のソースを静的に読むだけ）。
- Produces: なし（回帰ガード＋手動投入手順）。

**TDD steps:**

- [ ] Step 1: 失敗テストを書く（既存書き手に NISA 列が混入しないことを機械固定）。`tests/test_nisa_writer_separation.py`:
```python
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _src(rel):
    return open(os.path.join(ROOT, rel), encoding="utf-8").read()


def test_seed_universe_never_writes_nisa_columns():
    s = _src("scripts/seed_universe.py")
    for forbidden in ("nisa_growth_status", "market_alert", "nisa_source",
                      "nisa_checked_at", "nisa_tsumitate"):
        assert forbidden not in s, f"{forbidden} must not be in seed_universe.py (GHA クロバー防止)"


def test_refresh_market_never_writes_nisa_columns():
    s = _src("scripts/refresh_market.py")
    for forbidden in ("nisa_growth_status", "market_alert", "nisa_source",
                      "nisa_checked_at", "nisa_tsumitate"):
        assert forbidden not in s, f"{forbidden} must not be in refresh_market.py (GHA クロバー防止)"


def test_migration_has_production_verification_queries():
    s = _src("db/migrations/2026-07-21-nisa-eligibility.sql").lower()
    assert "select distinct nisa_growth_status" in s   # §3.6 検証クエリを migration 内に記録
```
- [ ] Step 2: 失敗を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_nisa_writer_separation.py -v` → 期待 FAIL（`test_migration_has_production_verification_queries` が検証クエリ未記載で FAIL・他 2 件は現状 PASS）。
- [ ] Step 3: 最小実装。`db/migrations/2026-07-21-nisa-eligibility.sql` 末尾に検証クエリをコメントで追記:
```sql

-- ── 本番投入 SQL 検証（手動適用後・inert・読取のみ・§3.6）──
-- 適用（破壊系は手動）:
--   psql "$DATABASE_URL" -f db/migrations/2026-07-21-nisa-eligibility.sql
--   DATABASE_URL=... IMAJ_XLSX=... python scripts/refresh_nisa.py
--   DATABASE_URL=... FSA_XLSX=... IMAJ_XLSX=... python scripts/refresh_nisa_tsumitate.py
-- 検証:
--   SELECT distinct nisa_growth_status FROM market.ticker_master;
--     期待: JP stock=eligible / US=conditional / 該当 JP ETF=eligible(imaj-listed) / 他=unknown
--   SELECT nisa_growth_status, count(*) FROM market.ticker_master GROUP BY 1;
--   SELECT category, count(*) FROM market.nisa_tsumitate GROUP BY 1;
--     期待: index≈286 / active≈65 / etf≈9（loud-fail レンジ内）
--   SELECT max(list_updated_at) FROM market.nisa_tsumitate;  -- FSA r0 シリアル由来の改定日
--   -- 再取込で serial 不変（UNIQUE upsert）:
--   SELECT id, fund_name FROM market.nisa_tsumitate ORDER BY id LIMIT 3;  -- 再実行前後で id 一致
--   -- 書き手分離: GHA market-refresh 実行後も NISA 列が保持されることを確認:
--   SELECT ticker, nisa_growth_status, nisa_checked_at FROM market.ticker_master
--     WHERE nisa_checked_at IS NOT NULL ORDER BY nisa_checked_at DESC LIMIT 5;
```
- [ ] Step 4: 成功を確認。`cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4; /home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_nisa_writer_separation.py -v` → 期待 PASS（3 tests passed）。加えて plan A 全体回帰＝`/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_nisa_migration.py tests/test_refresh_nisa.py tests/test_refresh_nisa_tsumitate.py tests/test_nisa_writer_separation.py tests/test_seed_universe.py tests/test_refresh_market.py -v` → 期待 全 PASS。
- [ ] Step 5: commit。
```bash
cd /home/shugo/apps/investment-portal/.claude/worktrees/nisa-stage4
git add tests/test_nisa_writer_separation.py db/migrations/2026-07-21-nisa-eligibility.sql
git commit -m "Add writer-separation guard tests + production verification queries"
```
