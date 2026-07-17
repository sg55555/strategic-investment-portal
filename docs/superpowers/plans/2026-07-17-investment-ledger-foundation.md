# 投資台帳基盤（ETL＋口座/枠タグ＋NISA Stage3 fold）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notion の投資取引を口座/枠タグ付きで Neon へ流す ETL を新設し、NISA 枠を投資台帳から自動導出できる状態（`nisa.source='ledger'`）を、台帳データ0件のまま inert で完成させる。

**Architecture:** ETL（`scripts/etl_investment.py`）が Notion「投資取引」DB を日付昇順に読み、`(ティッカー × 口座区分)` 単位の移動平均で売却簿価を按分して **per-period delta のみ** を `me.investment_snapshots` へ upsert する（累積は書かない＝純関数側が単一源）。フロントは既に保持している `_investmentRows` を `nisaDerive` の第3引数に渡し、`nisaLedgerFold` が月次 delta を年別に集計して **既存 `nisaHistoryFold` に委譲**する（制度モデルを二重実装しない）。Python は `advice.py` が同テーブルを SELECT して鏡像を回す。

**Tech Stack:** Python 3.13（`urllib` + `psycopg` のみ・追加依存ゼロ）／Vanilla JS（`money-rules.js` 純関数）／Neon Postgres／GitHub Actions／node:test・pytest

**Spec:** `docs/superpowers/specs/2026-07-17-investment-ledger-foundation-design.md`

## Global Constraints

- **責務境界**：ETL が出すのは **per-period delta のみ**。累積（principal 残高／investable／realizedGainTtm／生涯簿価残）を ETL で計算して列に入れない（`db/schema_me.sql:98`）。**移動平均（売却時の按分原価）だけは ETL 側の責務**。
- **追加依存ゼロ**：ETL は `urllib` ＋標準ライブラリ ＋ `psycopg` のみ。**root `requirements.txt` に一切触らない**（Vercel は全 `api/*` 関数に全依存を install するため）。新依存が要る場合のみ `scripts/requirements.txt` と GHA の `pip install` 行に足す。
- **loud-fail**：ETL は欠落/rename/型崩れ/口座区分の空・未知値/売却の数量欠落/取得失敗を必ず `SystemExit("ETL ABORT: …")`。**silent 0化・silent 既定化を作らない**。読み手側だけが `investment: []` で degrade。
- **別失敗ドメイン**：`investment-pull.yml` は `cashflow-pull.yml` と別ファイル・別 `concurrency.group`。同一ジョブに相乗りさせない。
- **SCHEMA bump 禁止**：`FACTS_SCHEMA_VERSION`（`money-rules.js:15` / `advice.py:30`）は **5 据え置き**。`RULES_VERSION`（`advice.py:31`）/ `CURRENT_VERSION`（`money-rules.js:11`）も据え置き。facts 形状も state 形状も変わらないため。**bump したらこの計画は誤って実装されている。**
- **鏡像同時変更**：`money-rules.js` の NISA 純関数を変えたら `api/me/advice.py` の対応関数を**同じコミットで**変える。fixture の期待値は**手で書く**（片方の実装から生成しない）。
- **単位系の不変条件**：NISA 4列と5スカラーは「円・簿価（取得価額）・非負」。ledger 側で負値を作らない。
- **手数料の別建て（`約定金額 A`・`手数料 F`）**：枠消費・元本・簿価（移動平均）は **`A` のみ**（手数料を含めない）。現金流出（購入）＝`−(A+F)`／現金流入（売却）＝`+(A−F)`／実現益（売却）＝`(A−F)−簿価`／配当の現金・実現益＝`+(A−F)`。期初保有は現金影響ゼロ。配当は枠不消費。
- **売却の戦略区分は holdings の保有側**を使う（行の値でなく・買=コア/売=サテライトの記帳ミスで principal が負化するのを防ぐ）。
- **負値ガード**：`約定金額`／`手数料`／`数量` が負なら loud-fail（`num()` が静かに0へ潰し NISA 枠を水増しするため）。
- **軸の直交**：戦略区分（コア/サテライト）と口座区分は直交＝1購入が `principal_core_delta` と `nisa_growth_delta` の**両方**に載る。**戦略区分が空・未知値（コア/サテライト以外）は loud-fail**（口座区分の空と対称）。
- **Anthropic 課金ゼロ**（純 ETL・Claude API を叩かない）／**Vercel 関数を増やさない**。
- **node テストの罠**：`node --test tests/`（末尾スラッシュ）はこの環境で `Cannot find module tests`。必ず `node --test 'tests/*.test.js'`。
- **ユーザーデータを補間する inline onclick を新規に作らない**（`detail.js:47/81` の既存 XSS は検索結果を onclick 文字列に補間しているのが原因）。**リテラル引数のみの inline onclick は注入面ゼロゆえ該当しない**＝NISA トグルは既存2ボタンと同じイディオムで足す（Task 9・2026-07-17 ユーザー確定）。

**検証3点セット（各タスクの締め）**
```bash
node --test 'tests/*.test.js'
PYTHONPATH=api/me .venv/bin/python -m pytest tests/ -q
```

---

## File Structure

| ファイル | 責務 | Task |
|---|---|---|
| `db/migrations/2026-07-17-investment-nisa-columns.sql`（新規） | NISA 4列の additive 追加 | 1 |
| `db/schema_me.sql`（修正:100-112） | 新規適用時に列が揃うよう CREATE TABLE 側も同期 | 1 |
| `api/me/investment.py`（修正:23 COLUMNS / `_row_to_dict`） | 4列を読み手に流す（math は持たない） | 1 |
| `scripts/etl_investment.py`（新規） | Notion→Neon の書込経路。純関数（validate/build/hash）＋ IO（取得/upsert/CLI） | 2,3 |
| `tests/test_etl_investment.py`（新規） | ETL 純関数のテスト（DB/Notion 不要） | 2 |
| `.github/workflows/investment-pull.yml`（新規） | 別失敗ドメインの起動配線（`workflow_dispatch` のみ） | 4 |
| `money-rules.js`（修正） | `nisaLedgerYear` / `nisaLedgerFold` 新規、`nisaEffective`/`nisaDerive`/`nisaViewModel`/`modeAFacts` に ledger 対応 | 5,6,7,8 |
| `api/me/advice.py`（修正） | 上記の鏡像＋`me.investment_snapshots` の SELECT | 5,6,7 |
| `tests/money-rules.test.js`（修正） | JS 側の単体・回帰 | 5,6,8 |
| `tests/test_advice_facts.py`（修正） | Py 側の単体・回帰 | 5,6,7 |
| `tests/fixtures/advice_facts_cases.json`（修正） | JS↔Py 共有 fixture（期待値は手書き） | 6,7 |
| `money.js`（修正:366 / :1556 / nisaSection） | ledger トグル・loggedIn ゲート・年select 出し分け | 9 |
| `scratchpad/b2-parity-fuzz.js`（修正） | ledger rows 生成器 | 10 |

---

## Task 1: DB スキーマに NISA 枠別 delta 4列を足す

**Files:**
- Create: `db/migrations/2026-07-17-investment-nisa-columns.sql`
- Modify: `db/schema_me.sql:100-112`
- Modify: `api/me/investment.py:23`（`COLUMNS`）と `_row_to_dict`

**Interfaces:**
- Consumes: なし（起点）
- Produces: `me.investment_snapshots` に `nisa_tsumitate_delta` / `nisa_growth_delta` / `nisa_tsumitate_sold_at_cost` / `nisa_growth_sold_at_cost`（全て `NUMERIC(16,0) NOT NULL DEFAULT 0`）。`GET /api/me/investment` のレスポンス各行に同名キー（int）が増える。

- [ ] **Step 1: migration SQL を書く**

`db/migrations/2026-07-17-investment-nisa-columns.sql`:
```sql
-- B#3 Stage3（投資台帳ledger連携）: NISA 枠別の per-period delta を追加。
-- 単位＝円・簿価(取得価額)・非負。累積（生涯簿価残）は書かない＝nisaLedgerFold が単一源。
-- 既存0行＋DEFAULT 0 ゆえ再適用・後追い適用とも安全（.vercelignore で自動適用されない＝手動適用）。
ALTER TABLE me.investment_snapshots
  ADD COLUMN IF NOT EXISTS nisa_tsumitate_delta        NUMERIC(16,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nisa_growth_delta           NUMERIC(16,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nisa_tsumitate_sold_at_cost NUMERIC(16,0) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS nisa_growth_sold_at_cost    NUMERIC(16,0) NOT NULL DEFAULT 0;
```

- [ ] **Step 2: `db/schema_me.sql` の CREATE TABLE を同期**

`db/schema_me.sql` の `me.investment_snapshots` 定義内、`holdings JSONB,` の**直後**に挿入：
```sql
  nisa_tsumitate_delta NUMERIC(16,0) NOT NULL DEFAULT 0, -- B#3 Stage3: 当期のつみたて投資枠 拠出(簿価・非負)
  nisa_growth_delta    NUMERIC(16,0) NOT NULL DEFAULT 0, -- B#3 Stage3: 当期の成長投資枠 拠出(簿価・非負)
  nisa_tsumitate_sold_at_cost NUMERIC(16,0) NOT NULL DEFAULT 0, -- B#3 Stage3: 当期のつみたて枠 売却の簿価(非負)
  nisa_growth_sold_at_cost    NUMERIC(16,0) NOT NULL DEFAULT 0, -- B#3 Stage3: 当期の成長枠 売却の簿価(非負)
```

- [ ] **Step 3: `api/me/investment.py` の COLUMNS を拡張**

`api/me/investment.py:23-24` を置換：
```python
COLUMNS = ("period", "invest_cash_flow", "principal_core_delta", "principal_sat_delta",
           "realized_gain", "is_complete", "holdings", "pulled_at",
           # B#3 Stage3: NISA 枠別 per-period delta（nisaLedgerFold の入力・業務 math はここに持たない）。
           "nisa_tsumitate_delta", "nisa_growth_delta",
           "nisa_tsumitate_sold_at_cost", "nisa_growth_sold_at_cost")
```

`_row_to_dict` を、位置インデックス依存をやめて `COLUMNS` 駆動にする（列追加で壊れないようにする）。既存実装を次で置換：
```python
def _row_to_dict(rec):
    """COLUMNS 順の tuple → dict。period/pulled_at は isoformat、Decimal は int/float へ。"""
    out = {}
    for name, val in zip(COLUMNS, rec):
        if name in ("period", "pulled_at"):
            out[name] = val.isoformat() if hasattr(val, "isoformat") else val
        else:
            out[name] = _num(val)
    return out
```

- [ ] **Step 4: SELECT が COLUMNS を使っていることを確認**

`api/me/investment.py` の SELECT 文が `", ".join(COLUMNS)` を使っていなければ、使うよう書き換える（列名のハードコードを残さない）。確認：
```bash
grep -n "SELECT\|COLUMNS" api/me/investment.py
```
期待：SELECT が `COLUMNS` から組み立てられている。

- [ ] **Step 5: 検証**

```bash
PYTHONPATH=api/me .venv/bin/python -c "
import importlib.util, os
s = importlib.util.spec_from_file_location('inv', 'api/me/investment.py')
m = importlib.util.module_from_spec(s); s.loader.exec_module(m)
assert len(m.COLUMNS) == 12, m.COLUMNS
assert 'nisa_growth_sold_at_cost' in m.COLUMNS
rec = ('2026-07-01', 0, 0, 0, 0, True, None, '2026-07-01T00:00:00', 1, 2, 3, 4)
d = m._row_to_dict(rec)
assert d['nisa_growth_delta'] == 2 and d['nisa_growth_sold_at_cost'] == 4, d
print('OK', len(m.COLUMNS))
"
```
期待：`OK 12`

- [ ] **Step 6: Commit**

```bash
git add db/migrations/2026-07-17-investment-nisa-columns.sql db/schema_me.sql api/me/investment.py
git commit -m "feat(ledger): investment_snapshots に NISA 枠別 delta 4列を追加（Task1）"
```

---

## Task 2: ETL の純関数（検証＋会計）と、そのテスト

**Files:**
- Create: `scripts/etl_investment.py`（このタスクでは純関数まで。IO は Task 3）
- Create: `tests/test_etl_investment.py`

**Interfaces:**
- Consumes: Task 1 の列名
- Produces:
  - `ACCOUNTS = ("NISAつみたて", "NISA成長", "課税")` / `NISA_TSUMITATE` / `NISA_GROWTH` / `STRATEGY_CORE = "コア"`
  - `KIND_BUY="購入"` / `KIND_SELL="売却"` / `KIND_DIV="配当"` / `KIND_SEED="期初保有"`
  - `validate_investment(pages: list[dict]) -> None`（loud-fail）
  - `build_investment(pages: list[dict], cur_ym: tuple[int,int]) -> dict[str, dict]`（period文字列 → 行 dict）
  - `_source_hash(row: dict) -> str`
  - `_i(x) -> int` / `_holdings_snapshot(holdings) -> dict`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_etl_investment.py`（新規・全文）:
```python
"""投資台帳 ETL の純関数テスト（DB/Notion 不要）。

loud-fail（口座区分の空/未知値・売却の数量欠落・プロパティ欠落/型崩れ）・source_hash 決定性・
移動平均が (ticker × 口座区分) 単位で独立すること・戦略区分と口座区分の直交・配当が枠を消費しないこと・
期初保有が「日付」の年に計上されることを固定。
pytest でも `.venv/bin/python tests/test_etl_investment.py` 直実行でも動く。
"""
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("etl_investment", os.path.join(ROOT, "scripts", "etl_investment.py"))
etl = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(etl)

CUR_YM = (2027, 1)  # 「当月」＝2027-01。それ以前は is_complete=True


def _page(iso, kind, account, ticker="VOO", qty=1, amount=100000, strategy="コア", fee=0):
    return {"properties": {
        "日付": {"type": "date", "date": {"start": iso}},
        "種別": {"type": "select", "select": {"name": kind}},
        "戦略区分": {"type": "select", "select": {"name": strategy}},
        "ティッカー": {"type": "select", "select": {"name": ticker}},
        "口座区分": {"type": "select", "select": {"name": account}},
        "数量": {"type": "number", "number": qty},
        "約定金額": {"type": "number", "number": amount},
        "手数料": {"type": "number", "number": fee},
        "名前": {"type": "title", "title": []},
    }}


def _expect_systemexit(fn):
    try:
        fn()
    except SystemExit:
        return True
    return False


# ── loud-fail ──
def test_validate_empty_aborts():
    assert _expect_systemexit(lambda: etl.validate_investment([]))


def test_validate_missing_prop_aborts():
    page = _page("2026-05-10", etl.KIND_BUY, "課税")
    del page["properties"]["口座区分"]
    assert _expect_systemexit(lambda: etl.validate_investment([page]))


def test_validate_wrong_type_aborts():
    page = _page("2026-05-10", etl.KIND_BUY, "課税")
    page["properties"]["口座区分"] = {"type": "rich_text", "rich_text": []}
    assert _expect_systemexit(lambda: etl.validate_investment([page]))


def test_build_empty_account_aborts():
    """口座区分が空＝silent に課税扱いせず中止（NISA 枠の静かな過少計上を防ぐ）。"""
    page = _page("2026-05-10", etl.KIND_BUY, "課税")
    page["properties"]["口座区分"]["select"] = None
    assert _expect_systemexit(lambda: etl.build_investment([page], CUR_YM))


def test_build_unknown_account_aborts():
    page = _page("2026-05-10", etl.KIND_BUY, "NISA")  # 3値のいずれでもない
    assert _expect_systemexit(lambda: etl.build_investment([page], CUR_YM))


def test_build_sell_without_qty_aborts():
    """売却に数量が無いと簿価按分ができない＝中止。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=None, amount=600000)]
    assert _expect_systemexit(lambda: etl.build_investment(pages, CUR_YM))


def test_build_row_without_date_is_dropped():
    """write-only-good-rows: 約定日が無い行は捨てる（0 を格納しない）。"""
    page = _page("2026-05-10", etl.KIND_BUY, "課税")
    page["properties"]["日付"]["date"] = None
    assert etl.build_investment([page], CUR_YM) == {}


# ── 会計 ──
def test_buy_nisa_growth_fills_both_axes():
    """戦略区分（コア）と口座区分（NISA成長）は直交＝1購入が両方の列に載る。"""
    out = etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000)], CUR_YM)
    r = out["2026-05-01"]
    assert r["principal_core_delta"] == 1000000
    assert r["nisa_growth_delta"] == 1000000
    assert r["nisa_tsumitate_delta"] == 0
    assert r["invest_cash_flow"] == -1000000
    assert r["is_complete"] is True


def test_taxable_buy_has_zero_nisa_delta():
    out = etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "課税", qty=10, amount=1000000)], CUR_YM)
    r = out["2026-05-01"]
    assert r["principal_core_delta"] == 1000000
    assert r["nisa_growth_delta"] == 0 and r["nisa_tsumitate_delta"] == 0


def test_sell_uses_moving_average_cost():
    """簿価按分＝avg_cost × 数量。100万で10株→@10万。6株売却で簿価60万・売値70万→実現益10万。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=6, amount=700000)]
    out = etl.build_investment(pages, CUR_YM)
    r = out["2026-06-01"]
    assert r["nisa_growth_sold_at_cost"] == 600000
    assert r["realized_gain"] == 100000
    assert r["principal_core_delta"] == -600000
    assert r["invest_cash_flow"] == 700000


def test_moving_average_is_independent_per_account():
    """同一銘柄を NISA成長 と 課税 で持つ時、片方の売却が他方の avg_cost を汚さない。"""
    pages = [
        _page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),   # @10万
        _page("2026-05-11", etl.KIND_BUY, "課税", qty=10, amount=2000000),        # @20万
        _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=5, amount=600000),     # 簿価 50万
        _page("2026-06-11", etl.KIND_SELL, "課税", qty=5, amount=1100000),        # 簿価 100万
    ]
    out = etl.build_investment(pages, CUR_YM)
    r = out["2026-06-01"]
    assert r["nisa_growth_sold_at_cost"] == 500000       # 課税の@20万に汚染されていない
    assert r["realized_gain"] == 100000 + 100000
    h = out["2026-06-01"]["holdings"]
    assert h["VOO|NISA成長"]["avg_cost"] == 100000
    assert h["VOO|課税"]["avg_cost"] == 200000


def test_dividend_does_not_consume_quota():
    """配当は現金+/実現益+/元本不変/NISA 枠不消費。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_DIV, "NISA成長", qty=0, amount=30000)]
    r = etl.build_investment(pages, CUR_YM)["2026-06-01"]
    assert r["nisa_growth_delta"] == 0
    assert r["principal_core_delta"] == 0
    assert r["invest_cash_flow"] == 30000
    assert r["realized_gain"] == 30000


def test_seed_holding_counts_in_its_date_year_and_moves_no_cash():
    """期初保有は「日付」＝実取得日の年の拠出として計上し、現金は動かさない（schema: 期初保有=0）。"""
    r = etl.build_investment(
        [_page("2025-03-04", etl.KIND_SEED, "NISAつみたて", qty=5, amount=500000)], CUR_YM)["2025-03-01"]
    assert r["nisa_tsumitate_delta"] == 500000
    assert r["principal_core_delta"] == 500000
    assert r["invest_cash_flow"] == 0


def test_fee_is_separate_from_amount():
    """約定金額 A・手数料 F は別建て：枠消費/元本は A のみ・現金流出は A+F（購入）。"""
    r = etl.build_investment(
        [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000, fee=5000)], CUR_YM)["2026-05-01"]
    assert r["nisa_growth_delta"] == 1000000       # 枠は約定金額のみ（手数料を食わない）
    assert r["principal_core_delta"] == 1000000    # 元本も約定金額のみ
    assert r["invest_cash_flow"] == -1005000       # 現金流出は手数料込み


def test_sell_fee_reduces_proceeds_and_gain():
    """売却の手取り＝A−F、実現益＝(A−F)−簿価。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=6, amount=700000, fee=3000)]
    r = etl.build_investment(pages, CUR_YM)["2026-06-01"]
    assert r["invest_cash_flow"] == 697000
    assert r["realized_gain"] == 700000 - 3000 - 600000   # 97000
    assert r["nisa_growth_sold_at_cost"] == 600000        # 簿価は手数料を含めない


def test_dividend_fee_reduces_cash_and_gain():
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_DIV, "NISA成長", qty=0, amount=30000, fee=500)]
    r = etl.build_investment(pages, CUR_YM)["2026-06-01"]
    assert r["invest_cash_flow"] == 29500
    assert r["realized_gain"] == 29500
    assert r["nisa_growth_delta"] == 0


# ── loud-fail 追加（負値・戦略区分）──
def test_negative_amount_aborts():
    """負の約定金額は num() が静かに 0 へ潰し NISA 枠を水増しするため中止。"""
    assert _expect_systemexit(
        lambda: etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", amount=-1000000)], CUR_YM))


def test_negative_fee_aborts():
    assert _expect_systemexit(
        lambda: etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", fee=-100)], CUR_YM))


def test_negative_qty_aborts():
    assert _expect_systemexit(
        lambda: etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=-5)], CUR_YM))


def test_empty_strategy_aborts():
    """戦略区分の空＝silent にサテライト扱いせず中止（口座区分と対称）。"""
    page = _page("2026-05-10", etl.KIND_BUY, "NISA成長")
    page["properties"]["戦略区分"]["select"] = None
    assert _expect_systemexit(lambda: etl.build_investment([page], CUR_YM))


def test_unknown_strategy_aborts():
    assert _expect_systemexit(
        lambda: etl.build_investment([_page("2026-05-10", etl.KIND_BUY, "NISA成長", strategy="foo")], CUR_YM))


def test_sell_uses_holding_strategy_not_row():
    """売却の元本は holdings 保有側の strategy で戻す＝買=コア/売=サテライトの記帳ミスで負化しない（M-1）。"""
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000, strategy="コア"),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=5, amount=600000, strategy="サテライト")]
    r = etl.build_investment(pages, CUR_YM)["2026-06-01"]
    assert r["principal_core_delta"] == -500000   # コア（保有側）から減る
    assert r["principal_sat_delta"] == 0          # サテライト（行の誤値）は動かない


def test_source_hash_same_day_buy_sell_order_independent():
    """同日の購入+売却をページ逆順で与えても hash 一致（sort が load-bearing なことの検証）。"""
    buy = _page("2026-05-10", etl.KIND_BUY, "NISA成長", ticker="VOO", qty=10, amount=1000000)
    sell = _page("2026-05-10", etl.KIND_SELL, "NISA成長", ticker="VOO", qty=4, amount=500000)
    r1 = etl.build_investment([buy, sell], CUR_YM)["2026-05-01"]
    r2 = etl.build_investment([sell, buy], CUR_YM)["2026-05-01"]
    assert etl._source_hash(r1) == etl._source_hash(r2)
    assert r1["nisa_growth_sold_at_cost"] == 400000   # 買→売 の順で処理＝簿価 @10万 × 4


def test_current_month_is_incomplete():
    r = etl.build_investment([_page("2027-01-10", etl.KIND_BUY, "課税")], CUR_YM)["2027-01-01"]
    assert r["is_complete"] is False


# ── source_hash / holdings ──
def test_source_hash_is_page_order_independent():
    """Notion のページ返却順に依存せず hash 安定（etl-5）。"""
    a = _page("2026-05-10", etl.KIND_BUY, "NISA成長", ticker="VOO", qty=10, amount=1000000)
    b = _page("2026-05-11", etl.KIND_BUY, "課税", ticker="VTI", qty=5, amount=500000)
    h1 = etl._source_hash(etl.build_investment([a, b], CUR_YM)["2026-05-01"])
    h2 = etl._source_hash(etl.build_investment([b, a], CUR_YM)["2026-05-01"])
    assert h1 == h2


def test_fully_sold_position_leaves_holdings():
    pages = [_page("2026-05-10", etl.KIND_BUY, "NISA成長", qty=10, amount=1000000),
             _page("2026-06-10", etl.KIND_SELL, "NISA成長", qty=10, amount=1200000)]
    out = etl.build_investment(pages, CUR_YM)
    assert "VOO|NISA成長" not in out["2026-06-01"]["holdings"]


def test_i_coerces_none_and_garbage_to_zero():
    assert etl._i(None) == 0 and etl._i("x") == 0 and etl._i(1234.6) == 1235


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

- [ ] **Step 2: テストが失敗することを確認**

```bash
PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_etl_investment.py -q
```
期待：FAIL（`FileNotFoundError` / `scripts/etl_investment.py` が存在しない）

- [ ] **Step 3: 純関数を実装する**

`scripts/etl_investment.py`（新規・このタスクでは純関数まで）:
```python
"""データ基盤Phase2 / B#3 Stage3 — Notion「投資取引」DB を Neon me.investment_snapshots へ片方向 push。

設計（docs/superpowers/specs/2026-07-17-investment-ledger-foundation-design.md）:
  - 責務境界: 出すのは per-period delta のみ。累積（principal 残高/生涯簿価残）は書かない
    ＝money-rules.js の investmentDerived / nisaLedgerFold が単一源。
    移動平均（売却時の按分原価）だけは ETL 側の責務＝holdings に期末状態を残す。
  - 移動平均の粒度は (ティッカー × 口座区分)。同一銘柄を NISA成長 と 課税 で持てるため、
    口座をまたぐと簿価が混ざる。
  - 直交: 戦略区分(コア/サテライト)と口座区分(NISAつみたて/NISA成長/課税)は独立軸＝
    1購入が principal_core_delta と nisa_growth_delta の両方に載る。
  - 枠消費は約定金額のみ（手数料は枠を消費しない）。配当は枠不消費。
  - loud-fail: 欠落/rename/型崩れ/口座区分の空・未知値/売却の数量欠落は握り潰さず中止（garbage 非格納）。
  - 冪等 upsert: period(月初DATE)主キー。source_hash 無変化はスキップ。
  - cashflow ETL とは別失敗ドメイン（etl_cashflow.py を巻き込まない）。

実行: NOTION_TOKEN（読取専用 integration・対象DBに共有）と DATABASE_URL を env に置いて
      `python scripts/etl_investment.py [--months N] [--dry-run]`
GitHub Actions（.github/workflows/investment-pull.yml）から手動 dispatch。
Claude API は叩かない純 ETL。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, date
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Json

NOTION_VERSION = "2022-06-28"
NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")

# 投資取引DB（2026-06-30 作成・plans/2026-06-29-data-foundation-and-discipline-model.md §9）。
INVESTMENT_DB_ID = "38eda3f0c01c8142b8e3db02c921916b"

# 口座区分（B#3 Stage3）＝「どの口座で持つか」の軸。制度と1:1（NISA口座は1人1口座・中に2枠）。
NISA_TSUMITATE = "NISAつみたて"
NISA_GROWTH = "NISA成長"
TAXABLE = "課税"
ACCOUNTS = (NISA_TSUMITATE, NISA_GROWTH, TAXABLE)

# 種別。KIND_ORDER は同日内の決定論的処理順（seed→購入→配当→売却＝買う前に売らない）。
KIND_SEED = "期初保有"
KIND_BUY = "購入"
KIND_DIV = "配当"
KIND_SELL = "売却"
KIND_ORDER = {KIND_SEED: 0, KIND_BUY: 1, KIND_DIV: 2, KIND_SELL: 3}

STRATEGY_CORE = "コア"
STRATEGY_SAT = "サテライト"
STRATEGIES = (STRATEGY_CORE, STRATEGY_SAT)  # 空/未知値は loud-fail（口座区分と対称）

REQUIRED_INVESTMENT_PROPS = ("日付", "種別", "戦略区分", "ティッカー", "数量", "約定金額", "口座区分")
SELECT_INVESTMENT_PROPS = ("種別", "戦略区分", "ティッカー", "口座区分")
NUMBER_INVESTMENT_PROPS = ("数量", "約定金額")

DELTA_KEYS = ("invest_cash_flow", "principal_core_delta", "principal_sat_delta", "realized_gain",
              "nisa_tsumitate_delta", "nisa_growth_delta",
              "nisa_tsumitate_sold_at_cost", "nisa_growth_sold_at_cost")

JST = ZoneInfo("Asia/Tokyo")


# ── property getters（etl_cashflow.py と同一意味）──
def _select(prop: dict) -> str:
    sel = prop.get("select")
    return sel.get("name", "") if sel else ""


def _date(prop: dict) -> str:
    d = prop.get("date")
    return d.get("start", "") if d else ""


def _i(x) -> int:
    """円は整数。None/欠落は 0。"""
    try:
        return int(round(float(x or 0)))
    except (TypeError, ValueError):
        return 0


# ── loud-fail 検証 ──
def validate_investment(pages: list[dict]) -> None:
    """投資取引DB に期待プロパティが存在し型も合うか検証。欠落/rename/型崩れは中止（silent 0化を廃）。
    Notion は DB 単位でスキーマ均一ゆえ pages[0] の検査で全行を代表できる。"""
    if not pages:
        raise SystemExit("ETL ABORT: 投資取引DB が空（共有/権限を確認）")
    sample = pages[0].get("properties", {})
    missing = [name for name in REQUIRED_INVESTMENT_PROPS if name not in sample]
    if missing:
        raise SystemExit(
            f"ETL ABORT: 投資取引DB に期待プロパティ欠落 {missing}. "
            f"Notion 側の rename か integration 共有漏れ。garbage を格納せず中止。"
        )
    wrong = []
    for name in SELECT_INVESTMENT_PROPS:
        if sample.get(name, {}).get("type") != "select":
            wrong.append(f"{name}:{sample.get(name, {}).get('type')}")
    for name in NUMBER_INVESTMENT_PROPS:
        if sample.get(name, {}).get("type") != "number":
            wrong.append(f"{name}:{sample.get(name, {}).get('type')}")
    if sample.get("日付", {}).get("type") != "date":
        wrong.append(f"日付:{sample.get('日付', {}).get('type')}")
    if wrong:
        raise SystemExit(
            f"ETL ABORT: 投資取引DB の型不一致 {wrong}（select/number/date 期待）。"
            f"プロパティの型変更/差替を検知。garbage を格納せず中止。"
        )


# ── 会計（純粋）──
def _zero_delta() -> dict:
    return {k: 0.0 for k in DELTA_KEYS}


def _holdings_snapshot(holdings: dict) -> dict:
    """期末の移動平均状態。キーの厳密全順序ソート＝Notion ページ返却順に依存せず source_hash 安定（etl-5）。
    全部売却済み（qty<=0）は落とす。値に ticker/account を冗長に持つ（将来 Slice5 の時価 join 用）。"""
    return {
        k: {"ticker": h["ticker"], "account": h["account"],
            "qty": round(h["qty"], 8), "avg_cost": round(h["avg_cost"], 4),
            "strategy": h["strategy"]}
        for k, h in sorted(holdings.items()) if h["qty"] > 1e-9
    }


def _parse_tx(page: dict) -> dict | None:
    """1ページ → 取引 dict。約定日が無い行は None（write-only-good-rows）。口座区分の異常は loud-fail。"""
    p = page.get("properties", {})
    iso = _date(p.get("日付", {}))
    if not iso or len(iso) < 10:
        return None  # write-only-good-rows: 約定日が確定しない行は捨てる（0格納しない）
    try:
        d = date(int(iso[0:4]), int(iso[5:7]), int(iso[8:10]))
    except ValueError:
        return None
    kind = _select(p.get("種別", {}))
    account = _select(p.get("口座区分", {}))
    if account not in ACCOUNTS:
        raise SystemExit(
            f"ETL ABORT: 口座区分が空/未知値 date={iso} 種別='{kind}' 値='{account}'. "
            f"期待={list(ACCOUNTS)}. silent に課税扱いすると NISA 枠が静かに過少計上されるため中止。"
        )
    strategy = _select(p.get("戦略区分", {}))
    # 戦略区分の空/未知値は loud-fail（口座区分と対称・silent に「サテライト」へ落とさない）。
    # 売却は holdings 保有側の strategy を使うため行の値は検証しない（購入/期初保有時に検証済み）。
    if kind in (KIND_BUY, KIND_SEED) and strategy not in STRATEGIES:
        raise SystemExit(
            f"ETL ABORT: 戦略区分が空/未知値 date={iso} 種別='{kind}' 値='{strategy}'. "
            f"期待={list(STRATEGIES)}. silent にサテライト扱いすると元本の分類が歪むため中止。"
        )
    qty = p.get("数量", {}).get("number")
    if kind == KIND_SELL and (qty is None or qty <= 0):
        raise SystemExit(
            f"ETL ABORT: 売却行に数量が無い date={iso} ticker='{_select(p.get('ティッカー', {}))}'. "
            f"簿価按分（avg_cost × 数量）ができないため中止。"
        )
    amount = float(p.get("約定金額", {}).get("number") or 0)
    fee = float(p.get("手数料", {}).get("number") or 0)
    qty_f = float(qty or 0)
    # 負値は num() が静かに 0 へ潰し NISA 生涯枠を水増しする（口座区分の loud-fail と同じ害の裏返し）。
    if amount < 0 or fee < 0 or qty_f < 0:
        raise SystemExit(
            f"ETL ABORT: 負の値 date={iso} 種別='{kind}' 約定金額={amount} 手数料={fee} 数量={qty_f}. "
            f"下流が負値を静かに 0 へ丸め枠が水増しされるため中止。"
        )
    return {
        "date": d,
        "kind": kind,
        "account": account,
        "ticker": _select(p.get("ティッカー", {})) or "UNKNOWN",
        "strategy": strategy,
        "qty": qty_f,
        "amount": amount,
        "fee": fee,
    }


def _period_str(d: date) -> str:
    return date(d.year, d.month, 1).isoformat()


def build_investment(pages: list[dict], cur_ym: tuple[int, int]) -> dict[str, dict]:
    """取引行 → period(YYYY-MM-01 str) → per-period delta + 期末 holdings。

    日付昇順に移動平均を (ticker × 口座区分) 単位で回す。累積は書かない（純関数側が単一源）。
    当月(部分月)は is_complete=False。
    """
    txs = [t for t in (_parse_tx(pg) for pg in pages) if t is not None]
    # 同日内の決定論的順序（seed→購入→配当→売却）。ページ返却順に依存させない。
    txs.sort(key=lambda t: (t["date"], KIND_ORDER.get(t["kind"], 9), t["account"], t["ticker"]))

    by_period: dict[str, list[dict]] = {}
    for t in txs:
        by_period.setdefault(_period_str(t["date"]), []).append(t)

    holdings: dict[str, dict] = {}
    out: dict[str, dict] = {}
    for period in sorted(by_period.keys()):
        d = _zero_delta()
        for t in by_period[period]:
            key = f'{t["ticker"]}|{t["account"]}'
            h = holdings.setdefault(key, {"ticker": t["ticker"], "account": t["account"],
                                          "qty": 0.0, "avg_cost": 0.0, "strategy": t["strategy"]})
            amount, fee = t["amount"], t["fee"]  # 約定金額(取得対価)と手数料は別建て（M-5）
            if t["kind"] in (KIND_BUY, KIND_SEED):
                core = t["strategy"] == STRATEGY_CORE  # 空/未知値は _parse_tx で loud-fail 済み
                # 元本（戦略区分軸）＝約定金額のみ（手数料は簿価に含めない）
                d["principal_core_delta" if core else "principal_sat_delta"] += amount
                if t["kind"] == KIND_BUY:
                    d["invest_cash_flow"] -= amount + fee  # 現金流出は手数料込み（期初保有は現金を動かさない）
                # 移動平均（口座別に独立）＝約定金額ベース（手数料を含めない＝元本/枠と一貫）
                new_qty = h["qty"] + t["qty"]
                if new_qty > 0:
                    h["avg_cost"] = (h["qty"] * h["avg_cost"] + amount) / new_qty
                h["qty"] = new_qty
                h["strategy"] = t["strategy"]
                # NISA 枠（口座区分軸・直交）。枠消費は約定金額のみ＝手数料は含めない。
                if t["account"] == NISA_TSUMITATE:
                    d["nisa_tsumitate_delta"] += amount
                elif t["account"] == NISA_GROWTH:
                    d["nisa_growth_delta"] += amount
            elif t["kind"] == KIND_SELL:
                cost = h["avg_cost"] * t["qty"]  # 簿価按分
                if t["qty"] > h["qty"] + 1e-9:
                    print(f"[etl_investment] ⚠ 売却数量が保有を超過 {key} date={t['date']} "
                          f"qty={t['qty']} held={h['qty']}（記帳漏れの可能性・reconcile で差が出ます）")
                # 元本は holdings 保有側の strategy で戻す（行の値でなく＝記帳ミスで principal が負化しない・M-1）
                sell_core = h["strategy"] == STRATEGY_CORE
                d["principal_core_delta" if sell_core else "principal_sat_delta"] -= cost
                d["invest_cash_flow"] += amount - fee     # 手取り＝約定金額−手数料
                d["realized_gain"] += (amount - fee) - cost  # 実現益は手数料を差し引く
                h["qty"] -= t["qty"]
                if t["account"] == NISA_TSUMITATE:
                    d["nisa_tsumitate_sold_at_cost"] += cost
                elif t["account"] == NISA_GROWTH:
                    d["nisa_growth_sold_at_cost"] += cost
            elif t["kind"] == KIND_DIV:
                # 配当＝現金+/実現益+/元本不変/NISA 枠不消費。手数料があれば差し引く。
                d["invest_cash_flow"] += amount - fee
                d["realized_gain"] += amount - fee
        pd = date.fromisoformat(period)
        out[period] = {
            "period": pd,
            **{k: _i(v) for k, v in d.items()},
            "is_complete": (pd.year, pd.month) < cur_ym,  # 当月以降は未確定
            "holdings": _holdings_snapshot(holdings),
        }
    return out


def _source_hash(row: dict) -> str:
    """正規化済元データの sha256。無変化スキップ＆改ざん検知。"""
    payload = {k: (v.isoformat() if isinstance(v, date) else v)
               for k, v in row.items() if k != "source_hash"}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
```

- [ ] **Step 4: テストが通ることを確認**

```bash
PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_etl_investment.py -q
```
期待：PASS（27 passed）

- [ ] **Step 5: Commit**

```bash
git add scripts/etl_investment.py tests/test_etl_investment.py
git commit -m "feat(ledger): etl_investment.py の検証と会計（純関数）＋テスト（Task2）"
```

---

## Task 3: ETL の IO（Notion 取得・diagnose・upsert・CLI）

**Files:**
- Modify: `scripts/etl_investment.py`（Task 2 の末尾に追記）

**Interfaces:**
- Consumes: Task 2 の `validate_investment` / `build_investment` / `_source_hash` / `INVESTMENT_DB_ID`
- Produces: `main() -> int`（`--months N` / `--dry-run`）。`diagnose()` / `_all_pages()`

- [ ] **Step 1: IO を追記**

`scripts/etl_investment.py` の**末尾**に追記（`_source_hash` の後）：
```python
# ── Notion 取得（etl_cashflow.py と同型・追加依存ゼロ）──
def _query(database_id: str, body_extra: dict, cursor: str | None) -> dict:
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    body: dict = {"page_size": 100, **body_extra}
    if cursor:
        body["start_cursor"] = cursor
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:  # Notion のエラー本文（共有漏れ等の具体的メッセージ）を surface
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"Notion {e.code} db={database_id[:8]}… {detail}") from None


def _api(url: str, body: dict | None = None):
    headers = {"Authorization": f"Bearer {NOTION_TOKEN}", "Notion-Version": NOTION_VERSION}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def diagnose() -> None:
    """トークン妥当性と integration がアクセス可能な database を表示（共有漏れ切り分け・秘密は出さない）。"""
    try:
        me = _api("https://api.notion.com/v1/users/me")
        print(f"[diag] token OK: bot='{me.get('name')}' type={me.get('type')}")
    except Exception as e:  # noqa: BLE001
        print(f"[diag] /users/me 失敗: {e!r}（NOTION_TOKEN 無効の可能性）")
        return
    try:
        res = _api("https://api.notion.com/v1/search",
                   {"filter": {"property": "object", "value": "database"}, "page_size": 50})
        dbs = res.get("results", [])
        target = INVESTMENT_DB_ID.replace("-", "")
        seen = set()
        print(f"[diag] このintegrationがアクセス可能な database 数={len(dbs)}:")
        for d in dbs:
            did = (d.get("id") or "").replace("-", "")
            seen.add(did)
            title = "".join(t.get("plain_text", "") for t in (d.get("title") or []))
            mark = "  <== TARGET" if did == target else ""
            print(f"  - {did[:8]}… '{title}'{mark}")
        if target not in seen:
            print(f"[diag] ⚠ 未共有のターゲットDB（このintegrationに未接続）: {target[:8]}…")
        else:
            print("[diag] ターゲット投資取引DBはアクセス可能。")
    except Exception as e:  # noqa: BLE001
        print(f"[diag] /search 失敗: {e!r}")


def _all_pages(database_id: str, body_extra: dict | None = None) -> list[dict]:
    pages: list[dict] = []
    cursor = None
    while True:
        data = _query(database_id, body_extra or {}, cursor)
        pages.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return pages


# ── upsert ──
UPSERT_SQL = """
INSERT INTO me.investment_snapshots
  (period, invest_cash_flow, principal_core_delta, principal_sat_delta, realized_gain,
   is_complete, holdings, nisa_tsumitate_delta, nisa_growth_delta,
   nisa_tsumitate_sold_at_cost, nisa_growth_sold_at_cost, source, source_hash, pulled_at)
VALUES
  (%(period)s, %(invest_cash_flow)s, %(principal_core_delta)s, %(principal_sat_delta)s,
   %(realized_gain)s, %(is_complete)s, %(holdings)s, %(nisa_tsumitate_delta)s,
   %(nisa_growth_delta)s, %(nisa_tsumitate_sold_at_cost)s, %(nisa_growth_sold_at_cost)s,
   'investment-notion', %(source_hash)s, now())
ON CONFLICT (period) DO UPDATE SET
  invest_cash_flow = EXCLUDED.invest_cash_flow,
  principal_core_delta = EXCLUDED.principal_core_delta,
  principal_sat_delta = EXCLUDED.principal_sat_delta,
  realized_gain = EXCLUDED.realized_gain,
  is_complete = EXCLUDED.is_complete,
  holdings = EXCLUDED.holdings,
  nisa_tsumitate_delta = EXCLUDED.nisa_tsumitate_delta,
  nisa_growth_delta = EXCLUDED.nisa_growth_delta,
  nisa_tsumitate_sold_at_cost = EXCLUDED.nisa_tsumitate_sold_at_cost,
  nisa_growth_sold_at_cost = EXCLUDED.nisa_growth_sold_at_cost,
  source_hash = EXCLUDED.source_hash, pulled_at = now();
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=0, help="直近Nヶ月のみ upsert（0=全期間）")
    ap.add_argument("--dry-run", action="store_true", help="Neon に書かず件数だけ表示")
    args = ap.parse_args()

    if not NOTION_TOKEN:
        raise SystemExit("ETL ABORT: NOTION_TOKEN 未設定")
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url and not args.dry_run:
        raise SystemExit("ETL ABORT: DATABASE_URL 未設定")

    diagnose()  # トークン妥当性＋アクセス可能DBを先に表示（共有漏れの切り分け）

    now = datetime.now(JST)
    cur_ym = (now.year, now.month)

    try:
        pages = _all_pages(INVESTMENT_DB_ID, {"sorts": [{"property": "日付", "direction": "ascending"}]})
    except Exception as e:  # noqa: BLE001
        # 取得失敗なら中止（部分データで Neon を汚染しない）。cashflow ETL とは別失敗ドメイン。
        raise SystemExit(f"ETL ABORT: Notion 取得失敗 {e!r}") from None

    validate_investment(pages)  # loud-fail

    built = build_investment(pages, cur_ym)

    periods = sorted(built.keys())
    if args.months and args.months > 0:
        periods = periods[-args.months:]

    rows = []
    for period in periods:
        r = dict(built[period])
        r["holdings"] = Json(r["holdings"])
        r["source_hash"] = _source_hash(built[period])
        rows.append(r)

    print(f"[etl_investment] 月数={len(rows)} (全{len(built)}・window={args.months or 'all'}) "
          f"取引数={len(pages)} now(JST)={now:%Y-%m} dry_run={args.dry_run}")

    if args.dry_run:
        for period in periods[-3:]:
            r = built[period]
            print(f"  {r['period']} cash={r['invest_cash_flow']} core={r['principal_core_delta']} "
                  f"sat={r['principal_sat_delta']} gain={r['realized_gain']} "
                  f"nisa_t={r['nisa_tsumitate_delta']} nisa_g={r['nisa_growth_delta']} "
                  f"sold_t={r['nisa_tsumitate_sold_at_cost']} sold_g={r['nisa_growth_sold_at_cost']} "
                  f"complete={r['is_complete']} holdings={len(r['holdings'])} "
                  f"hash={_source_hash(r)[:8]}")
        return 0

    written = skipped = 0
    with psycopg.connect(db_url, autocommit=True) as conn, conn.cursor() as curs:
        curs.execute("SELECT period, source_hash FROM me.investment_snapshots")
        existing = {p.isoformat(): h for p, h in curs.fetchall()}
        for r in rows:
            if existing.get(r["period"].isoformat()) == r["source_hash"]:
                skipped += 1
                continue
            curs.execute(UPSERT_SQL, r)
            written += 1
    print(f"[etl_investment] upsert={written} skip(unchanged)={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 2: 純関数テストが壊れていないことを確認**

```bash
PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_etl_investment.py -q
```
期待：PASS（27 passed）

- [ ] **Step 3: env 未設定の loud-fail を確認**

```bash
env -u NOTION_TOKEN -u DATABASE_URL .venv/bin/python scripts/etl_investment.py --dry-run; echo "exit=$?"
```
期待：`ETL ABORT: NOTION_TOKEN 未設定` と `exit=1`

- [ ] **Step 4: root requirements.txt を汚していないことを確認**

```bash
git diff --name-only HEAD | grep -c '^requirements.txt$'
```
期待：`0`

- [ ] **Step 5: Commit**

```bash
git add scripts/etl_investment.py
git commit -m "feat(ledger): etl_investment.py の Notion 取得・diagnose・upsert・CLI（Task3）"
```

---

## Task 4: GitHub Actions の起動配線（別失敗ドメイン）

**Files:**
- Create: `.github/workflows/investment-pull.yml`

**Interfaces:**
- Consumes: `scripts/etl_investment.py` の `main()`
- Produces: 手動 dispatch 可能な workflow（`schedule` はコメントアウト）

- [ ] **Step 1: workflow を書く**

`.github/workflows/investment-pull.yml`（新規・全文）:
```yaml
# 投資台帳 ETL — Notion「投資取引」DB → Neon me.investment_snapshots。
# 必要 Secrets: NOTION_TOKEN（読取専用 integration・対象DBに共有必須）/ DATABASE_URL（Neon）。
#   ※既存2本を再利用＝新設しない。
# cashflow-pull.yml とは別ファイル・別 concurrency group（別失敗ドメイン＝投資 ETL の失敗が
#   収支 pull を巻き込まない・db/schema_me.sql:97 の要求）。
# Claude API は叩かない純 ETL（課金ゼロ）。
#
# schedule は台帳にデータが入る（初購入）まで無効。初購入後に手動 dispatch でサニティを取ってから
# 下の schedule を有効化し、有効化日をここにコメントで残すこと（cashflow-pull.yml の慣習）。
name: investment-pull

on:
  workflow_dispatch:
  # schedule:
  #   - cron: "0 21 2 * *"  # 毎月 2 日 21:00 UTC = JST 翌 06:00 頃（前月確定後）。初購入後に有効化。

permissions:
  contents: read

concurrency:
  group: investment-pull
  cancel-in-progress: false

jobs:
  pull:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - name: Install deps
        run: pip install "psycopg[binary]>=3"
      - name: Run investment ETL
        env:
          NOTION_TOKEN: ${{ secrets.NOTION_TOKEN }}
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: python scripts/etl_investment.py
```

- [ ] **Step 2: cashflow と別 group であることを確認**

```bash
grep -h "group:" .github/workflows/cashflow-pull.yml .github/workflows/investment-pull.yml
```
期待：`group: cashflow-pull` と `group: investment-pull`（異なる2行）

- [ ] **Step 3: schedule が無効であることを確認**

```bash
grep -n "^  schedule:" .github/workflows/investment-pull.yml; echo "active_schedule=$?"
```
期待：`active_schedule=1`（コメントアウト済みゆえヒットしない）

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/investment-pull.yml
git commit -m "feat(ledger): investment-pull workflow（別失敗ドメイン・schedule は初購入後に有効化）（Task4）"
```

---

## Task 5: `nisaLedgerFold`（JS＋Py 鏡像）

**Files:**
- Modify: `money-rules.js`（`nisaHistoryFold` の直後 = :479 付近に挿入。exports :1308 付近）
- Modify: `api/me/advice.py`（`_nisa_history_fold` の直後 = :918 付近に挿入）
- Modify: `tests/money-rules.test.js`
- Modify: `tests/test_advice_facts.py`

**Interfaces:**
- Consumes: 既存 `nisaHistoryFold(history, currentYear)` / `_nisa_history_fold(history, current_year)`、`num` / `_num`、`NISA_MIN_YEAR`、`NISA_HISTORY_MAX`
- Produces:
  - JS: `nisaLedgerYear(period) -> number`、`nisaLedgerFold(rows, currentYear) -> {tsumitateThisYear, growthThisYear, tsumitateLifetime, growthLifetime, soldThisYearAtCost}`（`R.nisaLedgerFold` / `R.nisaLedgerYear` として export）
  - Py: `_nisa_ledger_year(period) -> int`、`_nisa_ledger_fold(rows, current_year) -> dict`（同一キー）
  - 入力行の形＝`{period: "YYYY-MM-01", nisa_tsumitate_delta, nisa_growth_delta, nisa_tsumitate_sold_at_cost, nisa_growth_sold_at_cost}`

- [ ] **Step 1: 失敗するテストを書く（JS）**

`tests/money-rules.test.js` の NISA ブロック末尾に追記：
```js
// --- B#3 Stage3: 投資台帳 ledger fold（月次delta → 年別 → nisaHistoryFold へ委譲）---
const _lrow = (period, t, g, st, sg) => ({
  period, nisa_tsumitate_delta: t, nisa_growth_delta: g,
  nisa_tsumitate_sold_at_cost: st, nisa_growth_sold_at_cost: sg,
});

test("nisaLedgerFold: 行0は全0へ degrade", () => {
  assert.deepEqual(R.nisaLedgerFold([], 2026), {
    tsumitateThisYear: 0, growthThisYear: 0, soldThisYearAtCost: 0,
    tsumitateLifetime: 0, growthLifetime: 0,
  });
});

test("nisaLedgerFold: 同一年の月次delta を合算して当年拠出にする", () => {
  const f = R.nisaLedgerFold([
    _lrow("2026-01-01", 100000, 0, 0, 0),
    _lrow("2026-02-01", 100000, 200000, 0, 0),
  ], 2026);
  assert.equal(f.tsumitateThisYear, 200000);
  assert.equal(f.growthThisYear, 200000);
  assert.equal(f.tsumitateLifetime, 200000);
  assert.equal(f.growthLifetime, 200000);
});

test("nisaLedgerFold: 当年の売却は生涯枠から控除しない（復活は翌年1/1）", () => {
  const f = R.nisaLedgerFold([_lrow("2026-03-01", 500000, 0, 200000, 0)], 2026);
  assert.equal(f.tsumitateLifetime, 500000);   // 売却分を引かない
  assert.equal(f.soldThisYearAtCost, 200000);
});

test("nisaLedgerFold: 過去年の売却は生涯枠から控除済み", () => {
  const f = R.nisaLedgerFold([_lrow("2025-03-01", 500000, 0, 200000, 0)], 2026);
  assert.equal(f.tsumitateLifetime, 300000);
  assert.equal(f.soldThisYearAtCost, 0);
});

test("nisaLedgerFold: 未来年の行は無視", () => {
  const f = R.nisaLedgerFold([_lrow("2027-01-01", 900000, 0, 0, 0)], 2026);
  assert.equal(f.tsumitateLifetime, 0);
});

test("nisaLedgerFold: period 不正・年域外・非オブジェクトは捨てる", () => {
  const f = R.nisaLedgerFold([
    _lrow("2023-01-01", 900000, 0, 0, 0),   // NISA_MIN_YEAR 未満
    _lrow("xxxx-01-01", 900000, 0, 0, 0),   // 不正
    _lrow("", 900000, 0, 0, 0),
    null, 42, [1, 2],
    { period: "2026-01-01", nisa_tsumitate_delta: "abc", nisa_growth_delta: NaN,
      nisa_tsumitate_sold_at_cost: [5], nisa_growth_sold_at_cost: -100 },
  ], 2026);
  assert.deepEqual(f, {
    tsumitateThisYear: 0, growthThisYear: 0, soldThisYearAtCost: 0,
    tsumitateLifetime: 0, growthLifetime: 0,
  });
});

test("nisaLedgerFold は nisaHistoryFold と同値（委譲の証明）", () => {
  // 同じ年別実績を history 入力と ledger 入力で与えると5スカラーが一致する。
  const hist = [
    { year: 2025, tsumitate: 400000, growth: 900000, soldTsumitate: 100000, soldGrowth: 300000 },
    { year: 2026, tsumitate: 600000, growth: 500000, soldTsumitate: 50000, soldGrowth: 20000 },
  ];
  const rows = [
    _lrow("2025-04-01", 400000, 900000, 100000, 300000),
    _lrow("2026-05-01", 300000, 200000, 50000, 0),
    _lrow("2026-06-01", 300000, 300000, 0, 20000),
  ];
  assert.deepEqual(R.nisaLedgerFold(rows, 2026), R.nisaHistoryFold(hist, 2026));
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
node --test 'tests/*.test.js' 2>&1 | grep -c "nisaLedgerFold"
```
期待：0 より大きい（`R.nisaLedgerFold is not a function` で複数 FAIL）

- [ ] **Step 3: JS を実装する**

`money-rules.js` の `nisaHistoryFold` の閉じ括弧の**直後**（`nisaEffective` のコメントの直前）に挿入：
```js
  // B#3 Stage3: 投資台帳の period("YYYY-MM-01") → 年。NISA_MIN_YEAR 未満/9999超/不正は 0（＝捨てる）。
  // 基底 coerce は num()（scalar-safe＝配列/bool/hex 文字列も 0）。normalizeNisaYear と同じ Math.floor 規律。
  function nisaLedgerYear(period) {
    if (typeof period !== "string" || period.length < 4) return 0;
    var y = Math.floor(num(period.slice(0, 4)));
    return (y >= NISA_MIN_YEAR && y <= 9999) ? y : 0;
  }
  // B#3 Stage3: 投資台帳（月次 per-period delta）→ 年別行 → nisaHistoryFold へ委譲。
  // 制度モデル（当年売却は生涯枠から非控除／過去年は控除／枠別に持つ＝成長内数cap）を**再実装しない**。
  // 単一源は nisaHistoryFold＝ledger と history の制度ロジックが構造的にドリフトしない。
  function nisaLedgerFold(rows, currentYear) {
    var arr = Array.isArray(rows) ? rows : [];
    var byYear = {}, i;
    for (i = 0; i < arr.length; i++) {
      var row = arr[i];
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      var y = nisaLedgerYear(row.period);
      if (y === 0) continue;
      if (!byYear[y]) byYear[y] = { year: y, tsumitate: 0, growth: 0, soldTsumitate: 0, soldGrowth: 0 };
      byYear[y].tsumitate += num(row.nisa_tsumitate_delta);
      byYear[y].growth += num(row.nisa_growth_delta);
      byYear[y].soldTsumitate += num(row.nisa_tsumitate_sold_at_cost);
      byYear[y].soldGrowth += num(row.nisa_growth_sold_at_cost);
    }
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    var folded = years.slice(0, NISA_HISTORY_MAX).map(function (y) { return byYear[y]; });
    return nisaHistoryFold(folded, currentYear);
  }
```

`money-rules.js` の exports、`nisaHistoryFold: nisaHistoryFold, nisaEffective: nisaEffective,` の行を次で置換：
```js
    nisaHistoryFold: nisaHistoryFold, nisaEffective: nisaEffective,
    nisaLedgerFold: nisaLedgerFold, nisaLedgerYear: nisaLedgerYear,
```

- [ ] **Step 4: JS テストが通ることを確認**

```bash
node --test 'tests/*.test.js' 2>&1 | tail -8
```
期待：`# fail 0`

- [ ] **Step 5: 失敗するテストを書く（Py 鏡像）**

`tests/test_advice_facts.py` の末尾付近（NISA ブロック）に追記：
```python
def _lrow(period, t, g, st, sg):
    return {"period": period, "nisa_tsumitate_delta": t, "nisa_growth_delta": g,
            "nisa_tsumitate_sold_at_cost": st, "nisa_growth_sold_at_cost": sg}


def test_nisa_ledger_fold_empty_degrades_to_zero():
    assert advice._nisa_ledger_fold([], 2026) == {
        "tsumitateThisYear": 0, "growthThisYear": 0, "soldThisYearAtCost": 0,
        "tsumitateLifetime": 0, "growthLifetime": 0,
    }


def test_nisa_ledger_fold_sums_months_into_year():
    f = advice._nisa_ledger_fold([_lrow("2026-01-01", 100000, 0, 0, 0),
                                 _lrow("2026-02-01", 100000, 200000, 0, 0)], 2026)
    assert f["tsumitateThisYear"] == 200000
    assert f["growthLifetime"] == 200000


def test_nisa_ledger_fold_current_year_sale_not_deducted():
    f = advice._nisa_ledger_fold([_lrow("2026-03-01", 500000, 0, 200000, 0)], 2026)
    assert f["tsumitateLifetime"] == 500000
    assert f["soldThisYearAtCost"] == 200000


def test_nisa_ledger_fold_past_year_sale_is_deducted():
    f = advice._nisa_ledger_fold([_lrow("2025-03-01", 500000, 0, 200000, 0)], 2026)
    assert f["tsumitateLifetime"] == 300000


def test_nisa_ledger_fold_drops_invalid_rows():
    f = advice._nisa_ledger_fold([
        _lrow("2023-01-01", 900000, 0, 0, 0), _lrow("xxxx-01-01", 900000, 0, 0, 0),
        _lrow("", 900000, 0, 0, 0), None, 42, [1, 2],
        {"period": "2026-01-01", "nisa_tsumitate_delta": "abc", "nisa_growth_delta": float("nan"),
         "nisa_tsumitate_sold_at_cost": [5], "nisa_growth_sold_at_cost": -100},
    ], 2026)
    assert f == {"tsumitateThisYear": 0, "growthThisYear": 0, "soldThisYearAtCost": 0,
                 "tsumitateLifetime": 0, "growthLifetime": 0}


def test_nisa_ledger_fold_equals_history_fold():
    """委譲の証明＝同じ年別実績を history 入力と ledger 入力で与えると5スカラーが一致。"""
    hist = [
        {"year": 2025, "tsumitate": 400000, "growth": 900000, "soldTsumitate": 100000, "soldGrowth": 300000},
        {"year": 2026, "tsumitate": 600000, "growth": 500000, "soldTsumitate": 50000, "soldGrowth": 20000},
    ]
    rows = [_lrow("2025-04-01", 400000, 900000, 100000, 300000),
            _lrow("2026-05-01", 300000, 200000, 50000, 0),
            _lrow("2026-06-01", 300000, 300000, 0, 20000)]
    assert advice._nisa_ledger_fold(rows, 2026) == advice._nisa_history_fold(hist, 2026)
```

- [ ] **Step 6: Py テストが失敗することを確認**

```bash
PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q -k nisa_ledger
```
期待：FAIL（`AttributeError: module 'advice' has no attribute '_nisa_ledger_fold'`）

- [ ] **Step 7: Py 鏡像を実装する**

`api/me/advice.py` の `_nisa_history_fold` の**直後**（`_nisa_effective` の直前）に挿入：
```python
def _nisa_ledger_year(period):
    """money-rules.js nisaLedgerYear の鏡像。"YYYY-MM-01" の先頭4桁・域外/不正は 0。"""
    if not isinstance(period, str) or len(period) < 4:
        return 0
    y = math.floor(_num(period[0:4]))
    return y if NISA_MIN_YEAR <= y <= 9999 else 0


def _nisa_ledger_fold(rows, current_year):
    """money-rules.js nisaLedgerFold の鏡像。月次 delta を年別に畳み _nisa_history_fold へ委譲。
    制度モデルは _nisa_history_fold が単一源＝ledger と history でドリフトしない。"""
    arr = rows if isinstance(rows, list) else []
    by_year = {}
    for row in arr:
        if not isinstance(row, dict):
            continue
        y = _nisa_ledger_year(row.get("period"))
        if y == 0:
            continue
        acc = by_year.setdefault(y, {"year": y, "tsumitate": 0.0, "growth": 0.0,
                                     "soldTsumitate": 0.0, "soldGrowth": 0.0})
        acc["tsumitate"] += _num(row.get("nisa_tsumitate_delta"))
        acc["growth"] += _num(row.get("nisa_growth_delta"))
        acc["soldTsumitate"] += _num(row.get("nisa_tsumitate_sold_at_cost"))
        acc["soldGrowth"] += _num(row.get("nisa_growth_sold_at_cost"))
    folded = [by_year[y] for y in sorted(by_year.keys())][:NISA_HISTORY_MAX]
    return _nisa_history_fold(folded, current_year)
```

`api/me/advice.py` の import に `math` が無ければ足す（先頭の import ブロック）:
```bash
grep -n "^import math" api/me/advice.py || sed -i '0,/^import /s//import math\nimport /' api/me/advice.py
```

- [ ] **Step 8: 検証3点セット**

```bash
node --test 'tests/*.test.js' 2>&1 | tail -4
PYTHONPATH=api/me .venv/bin/python -m pytest tests/ -q 2>&1 | tail -3
```
期待：両方とも fail 0

- [ ] **Step 9: Commit**

```bash
git add money-rules.js api/me/advice.py tests/money-rules.test.js tests/test_advice_facts.py
git commit -m "feat(nisa): nisaLedgerFold（月次delta→年別→nisaHistoryFold 委譲）JS＋Py 鏡像（Task5）"
```

---

## Task 6: `nisaEffective` / `nisaDerive` に ledger 枝＋破れ穴2件の修正

**Files:**
- Modify: `money-rules.js:482`（`nisaEffective`）、`:494-504`（`nisaDerive` 冒頭・`configured`）、`:527`（`staleAnchorYear`）
- Modify: `api/me/advice.py:923`（`_nisa_effective`）、`:934-945`（`_nisa_derive`・`configured`）、`:969`（`staleAnchorYear`）
- Modify: `tests/money-rules.test.js`、`tests/test_advice_facts.py`

**Interfaces:**
- Consumes: Task 5 の `nisaLedgerFold` / `_nisa_ledger_fold`
- Produces:
  - `nisaEffective(n, currentYear, ledgerRows)` / `_nisa_effective(n, current_year, ledger_rows)`（第3引数は省略可・既定 `[]`）
  - `nisaDerive(state, nowMs, ledgerRows)` / `_nisa_derive(state, now_ms, ledger_rows)`（第3引数は省略可）
  - `configured` が source 別3分岐、`staleAnchorYear` が manual 限定になる

- [ ] **Step 1: 失敗するテストを書く（JS）**

`tests/money-rules.test.js` に追記：
```js
// --- B#3 Stage3: ledger 枝と破れ穴の修正 ---
const _ledgerState = (extra) => ({ nisa: Object.assign({ source: "ledger" }, extra || {}) });
const _MS_2026 = Date.UTC(2026, 5, 15);  // 2026-06-15

test("nisaDerive: source=ledger は台帳行から5スカラーを導出する", () => {
  const d = R.nisaDerive(_ledgerState(), _MS_2026, [_lrow("2026-02-01", 1200000, 0, 0, 0)]);
  assert.equal(d.atUsed, 1200000);
  assert.equal(d.annualTsumitateUsedPct, 100);
  assert.equal(d.configured, true);
});

test("nisaDerive: source=ledger で行0なら configured:false（facts.nisa が省かれる）", () => {
  assert.equal(R.nisaDerive(_ledgerState(), _MS_2026, []).configured, false);
});

test("nisaDerive: source=ledger で課税のみの行でも configured:true・枠は全0（枠が丸々空いていると正しく言う）", () => {
  const d = R.nisaDerive(_ledgerState(), _MS_2026, [_lrow("2026-02-01", 0, 0, 0, 0)]);
  assert.equal(d.configured, true);
  assert.equal(d.lifetimeUsedPct, 0);
  assert.equal(d.annualTotalUsedPct, 0);
});

test("nisaDerive: source=ledger は手入力スカラーを読まない（台帳が源）", () => {
  const d = R.nisaDerive(_ledgerState({ tsumitateLifetime: 8000000 }), _MS_2026,
                         [_lrow("2026-02-01", 500000, 0, 0, 0)]);
  assert.equal(d.n.tsumitateLifetime, 500000);
  assert.equal(d.stored.tsumitateLifetime, 8000000);  // 参照値としては保持（reconcile が使う）
});

test("nisaDerive: staleAnchorYear は ledger では常に false（自動導出＝アンカー概念が無い）", () => {
  const d = R.nisaDerive(_ledgerState({ anchorYear: 2024 }), _MS_2026, [_lrow("2026-02-01", 1, 0, 0, 0)]);
  assert.equal(d.staleAnchorYear, false);
});

test("nisaDerive: staleAnchorYear は manual では従来どおり true", () => {
  const d = R.nisaDerive({ nisa: { source: "manual", anchorYear: 2024, tsumitateThisYear: 1 } }, _MS_2026);
  assert.equal(d.staleAnchorYear, true);
});

test("nisaDerive: 第3引数の省略は manual/history の既存挙動を変えない", () => {
  const s = { nisa: { source: "history", history: [{ year: 2026, tsumitate: 500000, growth: 0, soldTsumitate: 0, soldGrowth: 0 }] } };
  assert.deepEqual(R.nisaDerive(s, _MS_2026), R.nisaDerive(s, _MS_2026, []));
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
node --test 'tests/*.test.js' 2>&1 | grep -E "^# (pass|fail)"
```
期待：`# fail` が 0 より大きい

- [ ] **Step 3: JS を実装する**

`money-rules.js` の `nisaEffective` 全体（:482-491）を次で置換：
```js
  function nisaEffective(n, currentYear, ledgerRows) {
    if (n.source === "ledger") {
      var lf = nisaLedgerFold(ledgerRows, currentYear);
      return {
        source: n.source, anchorYear: n.anchorYear, history: n.history,
        tsumitateThisYear: lf.tsumitateThisYear, growthThisYear: lf.growthThisYear,
        tsumitateLifetime: lf.tsumitateLifetime, growthLifetime: lf.growthLifetime,
        soldThisYearAtCost: lf.soldThisYearAtCost,
      };
    }
    if (n.source !== "history") return n;
    var f = nisaHistoryFold(n.history, currentYear);
    return {
      source: n.source, anchorYear: n.anchorYear, history: n.history,
      tsumitateThisYear: f.tsumitateThisYear, growthThisYear: f.growthThisYear,
      tsumitateLifetime: f.tsumitateLifetime, growthLifetime: f.growthLifetime,
      soldThisYearAtCost: f.soldThisYearAtCost,
    };
  }
```

`money-rules.js` の `nisaDerive` 冒頭（:494-504）を次で置換：
```js
  function nisaDerive(state, nowMs, ledgerRows) {
    var stored = normalizeNisa(state && state.nisa);
    var rows = Array.isArray(ledgerRows) ? ledgerRows : [];
    var now = nisaNow(nowMs);
    var n = nisaEffective(stored, now.year, rows);   // Stage2: history / Stage3: ledger なら畳み込みに差替（下流は無改修）
    // configured は「今有効な入力源にデータがあるか」＝source 別（spec §4）。source 非依存にすると
    // 「履歴モードで記録→手入力へ戻す」状態（スカラー全0・履歴残存）で「枠を全く使っていない」と
    // facts が嘘をつく。'ledger' は台帳行の有無で判定（manual スカラーを読まないため else 枝では永久に false）。
    var configured = stored.source === "history" ? stored.history.length > 0
                   : stored.source === "ledger" ? rows.length > 0
                   : (stored.anchorYear > 0 || stored.tsumitateThisYear > 0 || stored.growthThisYear > 0 ||
                      stored.tsumitateLifetime > 0 || stored.growthLifetime > 0 || stored.soldThisYearAtCost > 0);
```

`money-rules.js:527` の `staleAnchorYear` 行を次で置換：
```js
      // 古アンカー警告は manual 限定。history/ledger は年ロールオーバーが自動解決する＝誤警報にしない。
      staleAnchorYear: n.source === "manual" && now.valid && n.anchorYear > 0 && n.anchorYear < now.year,
```

- [ ] **Step 4: JS テストが通ることを確認**

```bash
node --test 'tests/*.test.js' 2>&1 | tail -4
```
期待：`# fail 0`

- [ ] **Step 5: Py 鏡像を実装する**

`api/me/advice.py` の `_nisa_effective` 全体（:923-932）を次で置換：
```python
def _nisa_effective(n, current_year, ledger_rows=None):
    """money-rules.js nisaEffective の鏡像（history/ledger なら5スカラーを畳み込みで差替・下流は無改修）。"""
    if n["source"] == "ledger":
        lf = _nisa_ledger_fold(ledger_rows if isinstance(ledger_rows, list) else [], current_year)
        return {
            "source": n["source"], "anchorYear": n["anchorYear"], "history": n["history"],
            "tsumitateThisYear": lf["tsumitateThisYear"], "growthThisYear": lf["growthThisYear"],
            "tsumitateLifetime": lf["tsumitateLifetime"], "growthLifetime": lf["growthLifetime"],
            "soldThisYearAtCost": lf["soldThisYearAtCost"],
        }
    if n["source"] != "history":
        return n
    f = _nisa_history_fold(n["history"], current_year)
    return {
        "source": n["source"], "anchorYear": n["anchorYear"], "history": n["history"],
        "tsumitateThisYear": f["tsumitateThisYear"], "growthThisYear": f["growthThisYear"],
        "tsumitateLifetime": f["tsumitateLifetime"], "growthLifetime": f["growthLifetime"],
        "soldThisYearAtCost": f["soldThisYearAtCost"],
    }
```

`api/me/advice.py` の `_nisa_derive` 冒頭（:934-945）を次で置換：
```python
def _nisa_derive(state, now_ms, ledger_rows=None):
    """money-rules.js nisaDerive の鏡像（単一計算源）。"""
    stored = _normalize_nisa(state.get("nisa") if isinstance(state, dict) else None)
    rows = ledger_rows if isinstance(ledger_rows, list) else []
    now = _nisa_now(now_ms)
    n = _nisa_effective(stored, now["year"], rows)  # Stage2: history / Stage3: ledger なら畳み込みに差替
    # configured は「今有効な入力源にデータがあるか」＝source 別（spec §4・JS nisaDerive と同一分岐）。
    if stored["source"] == "history":
        configured = len(stored["history"]) > 0
    elif stored["source"] == "ledger":
        configured = len(rows) > 0
    else:
        configured = (stored["anchorYear"] > 0 or stored["tsumitateThisYear"] > 0 or stored["growthThisYear"] > 0
                      or stored["tsumitateLifetime"] > 0 or stored["growthLifetime"] > 0
                      or stored["soldThisYearAtCost"] > 0)
```

`api/me/advice.py:969` 付近の `staleAnchorYear` を JS と同じ規律に置換（`!= "history"` → `== "manual"`）：
```python
        # 古アンカー警告は manual 限定。history/ledger は年ロールオーバーが自動解決する＝誤警報にしない。
        "staleAnchorYear": n["source"] == "manual" and now["valid"] and n["anchorYear"] > 0
        and n["anchorYear"] < now["year"],
```

- [ ] **Step 6: Py 側の同型テストを追記**

`tests/test_advice_facts.py` に追記：
```python
_MS_2026 = 1781568000000  # 2026-06-15T00:00:00Z


def test_nisa_derive_ledger_source_derives_from_rows():
    d = advice._nisa_derive({"nisa": {"source": "ledger"}}, _MS_2026,
                            [_lrow("2026-02-01", 1200000, 0, 0, 0)])
    assert d["configured"] is True
    assert d["annualTsumitateUsedPct"] == 100


def test_nisa_derive_ledger_empty_rows_not_configured():
    assert advice._nisa_derive({"nisa": {"source": "ledger"}}, _MS_2026, [])["configured"] is False


def test_nisa_derive_ledger_stale_anchor_always_false():
    d = advice._nisa_derive({"nisa": {"source": "ledger", "anchorYear": 2024}}, _MS_2026,
                            [_lrow("2026-02-01", 1, 0, 0, 0)])
    assert d["staleAnchorYear"] is False


def test_nisa_derive_manual_stale_anchor_still_true():
    d = advice._nisa_derive({"nisa": {"source": "manual", "anchorYear": 2024, "tsumitateThisYear": 1}}, _MS_2026)
    assert d["staleAnchorYear"] is True
```

- [ ] **Step 7: 検証3点セット**

```bash
node --test 'tests/*.test.js' 2>&1 | tail -4
PYTHONPATH=api/me .venv/bin/python -m pytest tests/ -q 2>&1 | tail -3
```
期待：両方とも fail 0（**既存の manual/history fixture が全て緑のまま＝第3引数の既定が既存挙動を変えていない証明**）

- [ ] **Step 8: SCHEMA が bump されていないことを確認**

```bash
grep -n "FACTS_SCHEMA_VERSION = 5" money-rules.js && grep -n "^SCHEMA_VERSION = 5" api/me/advice.py
```
期待：両方ヒット（bump されていない）

- [ ] **Step 9: Commit**

```bash
git add money-rules.js api/me/advice.py tests/money-rules.test.js tests/test_advice_facts.py
git commit -m "feat(nisa): nisaDerive に ledger 枝＋configured 3分岐＋staleAnchorYear を manual 限定へ（Task6）"
```

---

## Task 7: facts 経路に台帳行を通す（`modeAFacts` / `mode_a_facts` / `advice.py` の SELECT）

**Files:**
- Modify: `money-rules.js:1077`（`modeAFacts` の opts）、`:1198`（`lifetimeFillEtaBucket` の `nisaDerive` 呼び出し）、`:1140` 付近（`nisaFacts`）、`:1165` 付近（`nisaRaw`）
- Modify: `api/me/advice.py:1031`（`mode_a_facts` シグネチャ）、`:1086` / `:1119` / `:1155` 付近、`:1414` 付近（SELECT 追加）
- Modify: `tests/fixtures/advice_facts_cases.json`、`tests/money-rules.test.js`、`tests/test_advice_facts.py`

**Interfaces:**
- Consumes: Task 6 の `nisaDerive(state, nowMs, rows)` / `_nisa_derive(state, now_ms, rows)`
- Produces:
  - JS: `modeAFacts(rawState, opts)` の `opts.investmentRows`（配列・既定 `[]`）
  - Py: `mode_a_facts(raw_state, include_raw, now_ms, cashflow=None, investment=None)`
  - `nisaFacts(s, nowMs, rows)` / `nisaRaw(s, nowMs, rows)` / `_nisa_facts(s, now_ms, rows)` / `_nisa_raw(s, now_ms, rows)`
  - fixture ケース `nisa-ledger-*` が `investment` 入力を持てる

- [ ] **Step 1: fixture に ledger ケースを追加（期待値は手書き）**

`tests/fixtures/advice_facts_cases.json`（現在 58 ケース）に7ケース追加する。**既存ケースの形は `name` / `state` / `nowIso` / `production` / `personal`**（`nowMs` ではなく **`nowIso`**）。新たに `investment` キー（配列・省略時 `[]`）を持たせる。

全ケース共通：`"state": { "nisa": { "source": "ledger" } }` ／ `"nowIso": "2026-06-10T00:00:00Z"`。
**NISA 以外の facts キー（`mode`/`currency`/`buffer*`/`satellite*`/`roadmap`/`goals`/`rulesVersion:2`/`schemaVersion:5`/`raw` の非 nisa 部分）は既存 `nisa-b-annual-tsumitate-full` から丸ごとコピーする**（state の非 nisa 部分が同じ＝全て同値）。以下は各ケースで**異なる部分だけ**を示す。

`nowIso = 2026-06-10` ゆえ `monthsLeft = 12 - 5 = 7`、`restoresYear = 2027`（全ケース共通）。

**`nisa-ledger-a`（行0）**
```json
{ "name": "nisa-ledger-a-no-rows", "state": { "nisa": { "source": "ledger" } },
  "nowIso": "2026-06-10T00:00:00Z", "investment": [] }
```
→ `configured:false` ゆえ **`production.nisa` キー無し／`personal.nisa` キー無し／`personal.raw.nisa` キー無し**。

**`nisa-ledger-c`（当年つみたて満額）＝完全な作業例**
```json
{
  "name": "nisa-ledger-c-annual-tsumitate-full",
  "state": { "nisa": { "source": "ledger" } },
  "nowIso": "2026-06-10T00:00:00Z",
  "investment": [
    { "period": "2026-02-01", "nisa_tsumitate_delta": 1200000, "nisa_growth_delta": 0,
      "nisa_tsumitate_sold_at_cost": 0, "nisa_growth_sold_at_cost": 0 }
  ],
  "production": {
    "…既存 nisa-b からコピー…": null,
    "nisa": {
      "source": "ledger",
      "annualTsumitateUsedPct": 100,
      "annualGrowthUsedPct": 0,
      "annualTotalUsedPct": 33,
      "lifetimeUsedPct": 7,
      "growthCapUsedPct": 0,
      "annualRoomRemaining": true,
      "lifetimeRoomRemaining": true,
      "growthCapRoomRemaining": true,
      "overContribution": false,
      "hasRestorationPending": false,
      "staleAnchorYear": false,
      "lifetimeFillEtaBucket": "none"
    }
  },
  "personal": {
    "…既存 nisa-b からコピー（nisa ブロックは production と同一）…": null,
    "raw": {
      "…既存 nisa-b の raw 非 nisa 部分をコピー…": null,
      "nisa": {
        "tsumitateThisYear": 1200000, "growthThisYear": 0,
        "tsumitateLifetime": 1200000, "growthLifetime": 0,
        "soldThisYearAtCost": 0,
        "annualTsumitateRemaining": 0, "annualGrowthRemaining": 2400000,
        "lifetimeRemaining": 16800000, "growthCapRemaining": 12000000,
        "monthlyToFillTsumitate": 0, "restoresYear": 2027
      }
    }
  }
}
```
**手計算の根拠**：fold は 2026 が当年ゆえ `tThis=tLife=1200000`。`annualTotalUsedPct = r(1200000/3600000*100) = r(33.33) = 33`。`lifetimeUsedPct = r(1200000/18000000*100) = r(6.67) = 7`。`monthlyToFillTsumitate = ceil(0/7) = 0`。
**注**：`nisa-b`（手入力・同じ 120 万）は `lifetimeUsedPct:0` だが、ledger-c は **7**。手入力は生涯簿価残を別途入れる必要があるのに対し、ledger は拠出から生涯枠が自動で埋まる——**この差が Stage3 の価値そのもの**。

**残り4ケースの `nisa` ブロック期待値（他は上と同型）**

| case | `investment` の行 | `nisa` の非既定値 | `raw.nisa` の非既定値 |
|---|---|---|---|
| `nisa-ledger-b-taxable-only` | `{"period":"2026-02-01", 4値すべて 0}` | 全 `*UsedPct`:0 / 3つの `*RoomRemaining`:true / `source`:"ledger" | `annualTsumitateRemaining`:1200000 / `annualGrowthRemaining`:2400000 / `lifetimeRemaining`:18000000 / `growthCapRemaining`:12000000 / `monthlyToFillTsumitate`:171429 / `restoresYear`:2027 / 他は 0 |
| `nisa-ledger-d-growth-cap-full` | `{"period":"2025-04-01", "nisa_growth_delta":12000000, 他 0}` | `lifetimeUsedPct`:67 / `growthCapUsedPct`:100 / **`growthCapRoomRemaining`:false** / `annualRoomRemaining`:true / `lifetimeRoomRemaining`:true / `overContribution`:false | `growthLifetime`:12000000 / `lifetimeRemaining`:6000000 / **`growthCapRemaining`:0** / `annualGrowthRemaining`:2400000 / `annualTsumitateRemaining`:1200000 / `monthlyToFillTsumitate`:171429 |
| `nisa-ledger-e-current-year-sale` | `{"period":"2026-05-01", "nisa_growth_delta":1000000, "nisa_growth_sold_at_cost":300000, 他 0}` | `annualGrowthUsedPct`:42 / `annualTotalUsedPct`:28 / `lifetimeUsedPct`:6 / `growthCapUsedPct`:8 / **`hasRestorationPending`:true** | **`growthLifetime`:1000000（売却分を引かない＝復活は翌年1/1）** / `growthThisYear`:1000000 / `soldThisYearAtCost`:300000 / `annualGrowthRemaining`:1400000 / `lifetimeRemaining`:17000000 / `growthCapRemaining`:11000000 / `monthlyToFillTsumitate`:171429 / `restoresYear`:2027 |
| `nisa-ledger-f-past-year-sale` | `{"period":"2025-05-01", "nisa_growth_delta":1000000, "nisa_growth_sold_at_cost":300000, 他 0}` | `lifetimeUsedPct`:4 / `growthCapUsedPct`:6 / `hasRestorationPending`:false | **`growthLifetime`:700000（過去年の売却＝控除済み）** / `growthThisYear`:0 / `soldThisYearAtCost`:0 / `lifetimeRemaining`:17300000 / `growthCapRemaining`:11300000 / `monthlyToFillTsumitate`:171429 |
| `nisa-ledger-g-adversarial` | `[{"period":"xxxx-01-01","nisa_tsumitate_delta":900000,…}, {"period":"2023-01-01",…}, null, 42, [1,2]]` | **`nisa-ledger-b` と完全に同一**（全行が fold に捨てられる。ただし `rows.length > 0` ゆえ `configured:true`＝「台帳に行はある」は事実） | `nisa-ledger-b` と同一 |

**`nisa-ledger-e` と `-f` の対比が制度モデルの核心**（同じ拠出100万・同じ売却30万で、当年なら生涯枠 100万・過去年なら 70万）。これが委譲経由で効いていることの fixture 上の証明。

**`nisa-ledger-h`（`nisaLedgerFold` と `nisaHistoryFold` の同値性）は fixture ではなく Task 5 の単体テストで担保済み**（JS `nisaLedgerFold は nisaHistoryFold と同値` / Py `test_nisa_ledger_fold_equals_history_fold`）。ここでは追加不要。

- [ ] **Step 2: fixture ランナーが `investment` を渡すようにする（両言語）**

まず現行の呼び出しを確認する（`nowIso`→ms の変換や cashflow 行の渡し方が既にあるので、**壊さず最小差分で `investment` だけ足す**）：
```bash
grep -n "modeAFacts(" tests/money-rules.test.js
grep -n "mode_a_facts(" tests/test_advice_facts.py
```

`tests/money-rules.test.js` の fixture ループの `modeAFacts` 呼び出しに、opts の**最後に1行だけ**足す：
```js
        investmentRows: c.investment || [],
```

`tests/test_advice_facts.py` の fixture ループの `mode_a_facts` 呼び出しに、**第5引数だけ**足す：
```python
        c.get("investment")
```
（既存の第4引数が `c.get("cashflow")` 相当でない場合は、現行の実引数をそのまま残して末尾に追加すること。既存 58 ケースは `investment` キーを持たないので `None`→`[]` に落ち、**出力はバイト不変**でなければならない。）

- [ ] **Step 3: テストが失敗することを確認**

```bash
node --test 'tests/*.test.js' 2>&1 | grep -c "nisa-ledger"
```
期待：0 より大きい（新 fixture が RED）

- [ ] **Step 4: JS を実装する**

`money-rules.js` の `nisaFacts` / `nisaRaw` / `nisaViewModel` が内部で `nisaDerive(s, nowMs)` を呼んでいる箇所に第3引数を通す。まず現行を確認：
```bash
grep -n "nisaDerive(" money-rules.js
```

`nisaFacts` と `nisaRaw` のシグネチャを `(s, nowMs, ledgerRows)` にし、内部の `nisaDerive(s, nowMs)` を `nisaDerive(s, nowMs, ledgerRows)` に置換する。

`modeAFacts`（:1077 付近）の冒頭、`var nowMs = num(opts.nowMs);` の直後に追加：
```js
    // B#3 Stage3: 投資台帳の月次行（state の外＝API 由来）。cashflow と同型で opts から受ける。
    var investmentRows = Array.isArray(opts.investmentRows) ? opts.investmentRows : [];
```

`:1140-1141` の `nisaFacts` 呼び出しを置換：
```js
    var niFacts = nisaFacts(s, nowMs, investmentRows);
    if (niFacts) facts.nisa = niFacts;
```

`:1165-1166` の `nisaRaw` 呼び出しを置換：
```js
      var niRaw = nisaRaw(s, nowMs, investmentRows);
      if (niRaw) facts.raw.nisa = niRaw;
```
（実際のキー名・変数名は現行コードに合わせること）

`:1198` の ETA 上書き行を置換：
```js
      if (facts.nisa) facts.nisa.lifetimeFillEtaBucket = cd.available ? etaBucket(projectMonths(nisaDerive(s, nowMs, investmentRows).lifetimeRemaining, cd.investableSurplus)) : "none";
```

- [ ] **Step 5: Py を実装する**

`api/me/advice.py` の `mode_a_facts` シグネチャ（:1031）を置換：
```python
def mode_a_facts(raw_state, include_raw, now_ms, cashflow=None, investment=None):
```
docstring の直後に追加：
```python
    inv_rows = investment if isinstance(investment, list) else []
```
`_nisa_facts` / `_nisa_raw` のシグネチャに `ledger_rows=None` を足し、内部の `_nisa_derive(s, now_ms)` を `_nisa_derive(s, now_ms, ledger_rows)` に置換。`mode_a_facts` 内の呼び出し（:1086 / :1119 / :1155 付近）に `inv_rows` を渡す。

- [ ] **Step 6: `advice.py` に investment_snapshots の SELECT を足す**

`api/me/advice.py` の `cf_rows` ブロック（:1399-1412）の**直後**に追加：
```python
                # B#3 Stage3: 投資台帳を server-side で読む（ledger モードの NISA 枠導出の入力）。
                # 生額は LLM へ渡さず Mode A 集約のみ。テーブル未適用/読取失敗は inv_rows=None で degrade
                # （autocommit ゆえ後続クエリは無傷・投資読取失敗が助言全体を落とさない）。
                inv_rows = None
                try:
                    cur.execute(
                        "SELECT period, nisa_tsumitate_delta, nisa_growth_delta, "
                        "nisa_tsumitate_sold_at_cost, nisa_growth_sold_at_cost "
                        "FROM me.investment_snapshots ORDER BY period DESC LIMIT 120"  # 直近10年
                    )
                    inv_rows = [{
                        "period": rec[0].isoformat() if hasattr(rec[0], "isoformat") else rec[0],
                        "nisa_tsumitate_delta": rec[1], "nisa_growth_delta": rec[2],
                        "nisa_tsumitate_sold_at_cost": rec[3], "nisa_growth_sold_at_cost": rec[4],
                    } for rec in cur.fetchall()]
                except Exception:
                    inv_rows = None
```
`facts = mode_a_facts(raw_state, include_raw, now_ms, cf_rows)` を置換：
```python
                facts = mode_a_facts(raw_state, include_raw, now_ms, cf_rows, inv_rows)
```

- [ ] **Step 7: 検証3点セット**

```bash
node --test 'tests/*.test.js' 2>&1 | tail -4
PYTHONPATH=api/me .venv/bin/python -m pytest tests/ -q 2>&1 | tail -3
```
期待：両方とも fail 0（新 fixture が GREEN・既存 58 ケースがバイト不変）

- [ ] **Step 8: Vercel 関数が増えていないことを確認**

```bash
ls api/**/*.py | wc -l; grep -c '"src"' vercel.json
```
期待：Task 開始前と同数（新 endpoint を作っていない）

- [ ] **Step 9: Commit**

```bash
git add money-rules.js api/me/advice.py tests/
git commit -m "feat(nisa): facts 経路に投資台帳行を通す（modeAFacts opts / mode_a_facts 第5引数 / advice.py SELECT）（Task7）"
```

---

## Task 8: reconcile を ledger に広げる＋`nisaViewModel` の第4引数

**Files:**
- Modify: `money-rules.js:584`（`nisaViewModel`）、`:606-612`（`reconcile`）
- Modify: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: Task 6 の `nisaDerive(state, nowMs, rows)`
- Produces: `nisaViewModel(state, cd, nowMs, ledgerRows)`（第4引数・省略可）。`reconcile.available` が history と ledger の両方で true になり得る。`reconcile.sourceLabel`（`"history"` | `"ledger"` | `""`）を追加し UI が文言を出し分けられるようにする。

- [ ] **Step 1: 失敗するテストを書く**

`tests/money-rules.test.js` に追記：
```js
test("nisaViewModel: reconcile は ledger でも available（記帳漏れ検出）", () => {
  const vm = R.nisaViewModel(
    { nisa: { source: "ledger", tsumitateLifetime: 8000000 } },
    { available: false }, _MS_2026,
    [_lrow("2026-02-01", 7500000, 0, 0, 0)]
  );
  assert.equal(vm.reconcile.available, true);
  assert.equal(vm.reconcile.sourceLabel, "ledger");
  assert.equal(vm.reconcile.manualLifetime, 8000000);
  assert.equal(vm.reconcile.derivedLifetime, 7500000);
  assert.equal(vm.reconcile.diff, 500000);   // 50万分の取引が台帳に未記録
  assert.equal(vm.reconcile.matched, false);
});

test("nisaViewModel: reconcile は手入力が一度も無ければ ledger でも available:false", () => {
  const vm = R.nisaViewModel({ nisa: { source: "ledger" } }, { available: false }, _MS_2026,
                             [_lrow("2026-02-01", 7500000, 0, 0, 0)]);
  assert.equal(vm.reconcile.available, false);
});

test("nisaViewModel: reconcile は history で従来どおり（sourceLabel=history）", () => {
  const vm = R.nisaViewModel(
    { nisa: { source: "history", tsumitateLifetime: 1000000,
              history: [{ year: 2026, tsumitate: 900000, growth: 0, soldTsumitate: 0, soldGrowth: 0 }] } },
    { available: false }, _MS_2026);
  assert.equal(vm.reconcile.available, true);
  assert.equal(vm.reconcile.sourceLabel, "history");
  assert.equal(vm.reconcile.diff, 100000);
});

test("nisaViewModel: reconcile は manual では available:false（差を語らない）", () => {
  const vm = R.nisaViewModel({ nisa: { source: "manual", tsumitateLifetime: 1000000 } },
                             { available: false }, _MS_2026);
  assert.equal(vm.reconcile.available, false);
  assert.equal(vm.reconcile.sourceLabel, "");
});
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
node --test 'tests/*.test.js' 2>&1 | grep -E "^# fail"
```
期待：`# fail` が 0 より大きい

- [ ] **Step 3: 実装する**

`money-rules.js` の `nisaViewModel` シグネチャを `function nisaViewModel(state, cd, nowMs, ledgerRows) {` にし、内部の `nisaDerive(state, nowMs)` を `nisaDerive(state, nowMs, ledgerRows)` に置換。

`:605-613` の reconcile ブロックを次で置換：
```js
      // Stage2/3 リコンサイル：手入力の生涯簿価残（参照値・stored）と導出値（lifeUsed）の突き合わせ。
      // 「数字が落ちた」を「埋めるべき残り」に変える＝手入力が一度も無ければ available:false（差を語らない）。
      // ledger では意味が変わる＝差は「台帳への記帳漏れ」を指す（データ完全性チェック）。UI が文言を出し分ける。
      reconcile: {
        available: (d.n.source === "history" || d.n.source === "ledger") &&
          (d.stored.tsumitateLifetime + d.stored.growthLifetime) > 0,
        sourceLabel: (d.n.source === "history" || d.n.source === "ledger") ? d.n.source : "",
        manualLifetime: d.stored.tsumitateLifetime + d.stored.growthLifetime,
        derivedLifetime: d.lifeUsed,
        diff: (d.stored.tsumitateLifetime + d.stored.growthLifetime) - d.lifeUsed,
        matched: (d.stored.tsumitateLifetime + d.stored.growthLifetime) - d.lifeUsed === 0,
      },
```

- [ ] **Step 4: テストが通ることを確認**

```bash
node --test 'tests/*.test.js' 2>&1 | tail -4
```
期待：`# fail 0`

- [ ] **Step 5: Commit**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(nisa): reconcile を ledger に拡張（記帳漏れ検出）＋nisaViewModel 第4引数（Task8）"
```

---

## Task 9: money.js の UI（ledger トグル・loggedIn ゲート・年select 出し分け）

**Files:**
- Modify: `money.js:366-384`（`setNisaSource`）、`:1295-1302` 付近（入力源トグル）、`:1556`（`nisaSection` 呼び出し）、reconcile 文言

**Interfaces:**
- Consumes: Task 8 の `R.nisaViewModel(state, cd, nowMs, ledgerRows)`、`vm.reconcile.sourceLabel`、既存 `_investmentRows`（`money.js:34`）
- Produces: 3タブの入力源トグル（手入力 / 年別履歴 / 投資台帳）。UI のみ（業務 math を持たない）。

- [ ] **Step 1: `nisaSection` に台帳行を渡す**

`money.js:1556` の `nisaSection(R.nisaViewModel(state, cd, Date.now()))` を置換：
```js
nisaSection(R.nisaViewModel(state, cd, Date.now(), _investmentRows))
```

- [ ] **Step 2: `setNisaSource` に ledger の fail-closed ゲートを足す**

`money.js:369` の `if (R.NISA_SOURCES.indexOf(src) < 0) return;` の**直後**に挿入：
```js
    // 台帳は認証の向こう側にある＝未ログインでは行が 0 → configured:false になるので選択させない（fail-closed）。
    if (src === "ledger" && !sync.loggedIn) return;
```
**ledger 枝は他に足さない**。`history` の初回転記ブロック（:370-382）は `src === "history"` で守られているので ledger では動かない＝**ledger は初回転記なし**（台帳が源）。手入力スカラーも履歴も**消さない**＝manual へ戻せる（可逆）＋ reconcile の参照値になる。

- [ ] **Step 3: トグルを3タブにする**

`money.js:1294-1302` のトグルブロック全体を次で置換（既存の inline onclick イディオムに合わせる＝新方式を混在させない）：
```js
    // 入力源トグル（手入力/年別履歴/投資台帳）＝本PJ初の入力源切替UI。以降（B#2/B#4）の先例になる。
    // ledger は台帳が認証の向こう側にあるため未ログインでは選べない（setNisaSource 側と二重防衛）。
    var canLedger = sync.loggedIn;
    var srcToggle =
      '<div class="mcc-nisa-srctoggle">' +
        '<button class="mcc-nisa-srcbtn' + (vm.source === "manual" ? " on" : "") + '" ' +
          'onclick="MCC.setNisaSource(\'manual\')">手入力</button>' +
        '<button class="mcc-nisa-srcbtn' + (vm.source === "history" ? " on" : "") + '" ' +
          'onclick="MCC.setNisaSource(\'history\')">年別履歴</button>' +
        '<button class="mcc-nisa-srcbtn' + (vm.source === "ledger" ? " on" : "") + '"' +
          (canLedger ? "" : " disabled") + ' ' +
          'onclick="MCC.setNisaSource(\'ledger\')">投資台帳</button>' +
        (canLedger ? "" : '<span class="mcc-nisa-srcnote">投資台帳から自動導出するにはログインしてください</span>') +
      '</div>';
```

`money.css` に、既存 `.mcc-nisa-srcbtn` の隣へ追加：
```css
.mcc-nisa-srcbtn[disabled] { opacity: .45; cursor: not-allowed; }
.mcc-nisa-srcnote { font-size: .72rem; opacity: .7; align-self: center; margin-left: .5rem; }
```

- [ ] **Step 4: 年 select と reconcile 文言を出し分ける**

`nisaSection` の年別テーブル／`availableYears` の年 select を `vm.source === "history"` の時だけ描画する（ledger では無意味）。
reconcile の見出し文言を `vm.reconcile.sourceLabel` で出し分ける：
- `"history"`：既存の Stage2 文言（3分岐）のまま
- `"ledger"`：差が正なら「手入力より台帳が **¥X** 少ない＝台帳への記帳漏れの可能性があります」、負なら「台帳が手入力より **¥X** 多い＝手入力の生涯簿価残が古い可能性があります」、0なら「手入力と台帳が一致しています」

- [ ] **Step 5: 実ブラウザで確認**

```bash
python -m http.server 8765 >/dev/null 2>&1 &
```
ブラウザで `http://localhost:8765/money.html`（実パスは `ls *.html` で確認）を開き、確認：
- 入力源トグルが3タブ出る
- 未ログインで「投資台帳」が disabled＋理由表示
- `<details>` を開いた状態で他の入力を確定しても開いたまま（`money-js-render-focus-details-restore` の機構が生きている）
- Console に pageerror 0

- [ ] **Step 6: 検証3点セット**

```bash
node --test 'tests/*.test.js' 2>&1 | tail -4
PYTHONPATH=api/me .venv/bin/python -m pytest tests/ -q 2>&1 | tail -3
```
期待：両方とも fail 0

- [ ] **Step 7: Commit**

```bash
git add money.js money.css
git commit -m "feat(nisa): 入力源トグルに投資台帳を追加（loggedIn ゲート・reconcile 文言の出し分け）（Task9）"
```

---

## Task 10: parity fuzz に ledger 生成器を足す

**Files:**
- Modify: `scratchpad/b2-parity-fuzz.js`

**Interfaces:**
- Consumes: Task 7 の `modeAFacts(state, {investmentRows})` / `mode_a_facts(..., investment)`
- Produces: `genLedgerRows(rng)` が生成する台帳行を JS↔Py 双方に食わせ、`mismatches: 0` を実証する

- [ ] **Step 1: 生成器を足す**

`scratchpad/b2-parity-fuzz.js` の `genNisa` 相当の隣に追加：
```js
// B#3 Stage3: 台帳行の生成器。period の不正・年域外・非有限・配列も混ぜて両言語の coerce 対称性を突く。
function genLedgerRows(rng) {
  const n = Math.floor(rng() * 6);           // 0〜5行（0行＝configured:false 経路も踏む）
  const rows = [];
  for (let i = 0; i < n; i++) {
    const bad = rng() < 0.25;
    const year = 2023 + Math.floor(rng() * 6);          // 2023(域外) 〜 2028(未来)
    const month = 1 + Math.floor(rng() * 12);
    rows.push({
      period: bad && rng() < 0.5 ? "xxxx-01-01"
            : `${year}-${String(month).padStart(2, "0")}-01`,
      nisa_tsumitate_delta: bad ? [5] : Math.floor(rng() * 1500000),
      nisa_growth_delta: bad ? NaN : Math.floor(rng() * 2500000),
      nisa_tsumitate_sold_at_cost: bad ? "abc" : Math.floor(rng() * 400000),
      nisa_growth_sold_at_cost: bad ? -100 : Math.floor(rng() * 400000),
    });
  }
  return rows;
}
```
生成した state の `nisa.source` を `["manual", "history", "ledger"]` から引くようにし（`genNisa` 側）、ケースに `investment: genLedgerRows(rng)` を載せて JS 側 `modeAFacts` と Py 側 `mode_a_facts` の双方へ渡す（既存の cashflow 行の渡し方に合わせる）。

- [ ] **Step 2: fuzz を回す**

```bash
node scratchpad/b2-parity-fuzz.js 2>&1 | tail -5
```
期待：`mismatches: 0`

- [ ] **Step 3: seed を変えてもう一度**

既存の慣習（seed 42/7）に合わせて2種で回す。
期待：両方とも `mismatches: 0`

- [ ] **Step 4: Commit**

```bash
git add scratchpad/b2-parity-fuzz.js
git commit -m "test(nisa): parity fuzz に ledger 行の生成器を追加（Task10）"
```

---

## Task 11: 実 Notion に対する `--dry-run` サニティ（受入基準 §9-2・本人作業）

**Files:** なし（実行のみ）。結果を `docs/superpowers/plans/2026-07-17-investment-ledger-foundation.md` の末尾に追記する。

**Interfaces:**
- Consumes: Task 3 の `main()`、Task 2 の `validate_investment`
- Produces: 実プロパティ名・実 select 値・移動平均・枠別 delta が実データ構造で動く証拠

**このタスクは太田さんの手元作業が要る**（Notion への一時行投入と削除・`NOTION_TOKEN` の read 共有）。実施は3ステップ。

- [ ] **Step 1: Notion 側の準備（太田さんの作業）**

1. Notion「投資取引（Investment Transactions）」DB に **`口座区分`** プロパティ（select）を追加し、options に `NISAつみたて` / `NISA成長` / `課税` の3つを作る
2. 使い捨てのテスト行を3行入れる（後で削除する）:
   - `日付=2026-02-10` / `種別=購入` / `戦略区分=コア` / `ティッカー=VOO` / `数量=10` / `約定金額=1000000` / `口座区分=NISA成長`
   - `日付=2026-03-10` / `種別=購入` / `戦略区分=コア` / `ティッカー=VOO` / `数量=5` / `約定金額=600000` / `口座区分=課税`
   - `日付=2026-06-10` / `種別=売却` / `戦略区分=コア` / `ティッカー=VOO` / `数量=4` / `約定金額=500000` / `口座区分=NISA成長`
3. read-only integration（GitHub Actions の `NOTION_TOKEN`）に本DB（または親ページ「収支一覧」）を共有する

- [ ] **Step 2: dry-run を回す（この1行全体で1コマンド・Neon には接続しません）**

```bash
NOTION_TOKEN='<read-only integration のトークン>' .venv/bin/python scripts/etl_investment.py --dry-run
```

期待する出力：
- `[diag] token OK: bot=…` と `[diag] ターゲット投資取引DBはアクセス可能。`
- `[etl_investment] 月数=3 (全3・window=all) 取引数=3 … dry_run=True`
- 2026-06 の行に `nisa_growth_sold_at_cost=400000`（＝avg_cost 10万 × 4株）と `gain=100000`
- 2026-02 の行に `nisa_g=1000000`、2026-03 の行に `nisa_g=0`（課税ゆえ枠を消費しない）
- `holdings` に `VOO|NISA成長` と `VOO|課税` が別キーで存在

- [ ] **Step 3: loud-fail を実データで1回踏む**

テスト行の1つで `口座区分` を空にして、もう一度 Step 2 のコマンドを実行。
期待：`ETL ABORT: 口座区分が空/未知値 date=… silent に課税扱いすると NISA 枠が静かに過少計上されるため中止。` と exit 1
確認後、`口座区分` を元に戻す。

- [ ] **Step 4: テスト行を削除する（太田さんの作業）**

Notion のテスト行3件を削除する。**本番 Neon には一度も書いていない**（`--dry-run` は DB 非接続）ため後始末は Notion 側だけ。

- [ ] **Step 5: 結果を記録して Commit**

この計画ファイルの末尾に「## dry-run サニティ結果（YYYY-MM-DD）」として出力の要点を追記し、commit する。

---

## 完了後（この計画のスコープ外・引き継ぎ）

- **merge 前**：spec §8.6 の whole-branch 敵対検証 wf（7観点）を回す
- **migration の適用**：`db/migrations/2026-07-17-investment-nisa-columns.sql` は `.vercelignore` ゆえ自動適用されない。初購入前の任意タイミングで Neon に手動適用する
- **`schedule` の有効化**：初購入後、手動 dispatch でサニティを取ってから `investment-pull.yml` の schedule を有効化し、有効化日をコメントに残す
- **e2e**：実 Notion→本番 Neon→API→UI は台帳にデータが入ってから（本計画の受入基準に含めない）
- **別 spec（C）**：`investmentDerived` の viewModel 配線／`investmentSource` 二軸トグル UI／Mode A 投資 facts
