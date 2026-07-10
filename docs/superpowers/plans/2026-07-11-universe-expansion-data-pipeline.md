# Universe Expansion — データパイプライン Implementation Plan (Plan 1/2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 銘柄ユニバースを curated seed（日米〜300・段階拡張可）で自己完結管理し、GitHub Actions cron が yfinance から Neon `market` スキーマを自動更新する（Vercel 関数ゼロ増）。

**Architecture:** ①`data/universe.csv`（正データ）→ `scripts/seed_universe.py` で `market.ticker_master` upsert。②GHA `market-refresh.yml` が `scripts/refresh_market.py` を日次(--prices)/週次(--financials)実行し yfinance→Neon upsert。財務は既存 EDINET-JP を `source` 列で保護し拡張分のみ yfinance で埋める。取り込みは純関数マッピング＋IO に分離しテスト可能に。

**Tech Stack:** Python 3.13 / psycopg v3 / yfinance / pytest / GitHub Actions。

**設計書:** `docs/superpowers/specs/2026-07-11-universe-expansion-dynamic-refresh-design.md`

## Global Constraints
- **新 Vercel Function ゼロ**（取り込みは GHA 側・配信は既存 `/api/market/*` 3本のまま・関数枠 11/12 を維持）。
- **取り込み cron は Claude 非依存＝無料**。AI 財務コメントのみ手動バッチ（この Plan の対象外の既存 `analyze_financials.py` を手動実行）。
- **財務ソース**: 既存 EDINET-JP データは上書きしない。`financials_annual.source`（`'edinet'|'yfinance'`）で保護。拡張分＝yfinance。
- **Neon `market` スキーマは既存**（`ticker_master`/`ohlcv`(PK ticker,date)/`financials_annual`(PK ticker,fiscal_year,fiscal_period)/`ai_comments`）。upsert は `ON CONFLICT`。
- **冪等**（再実行安全）・**部分失敗許容**（取得失敗 ticker は skip＋stderr ログ）・**loud-fail**（全銘柄失敗はプロセス非ゼロ終了）。
- **seed は非破壊**（csv に無い ticker を既定で削除しない・削除は `--prune` 明示のみ）。
- 純関数（yfinance→schema マッピング）は DOM/network 非依存で fixture テスト。IO は薄く。
- 環境変数 `DATABASE_URL`（Neon・`market` upsert 権限）。yfinance は network（テストはモック注入）。

---

### Task 1: 依存追加＋schema に `source` 列（EDINET 保護の土台）

**Files:**
- Modify: `requirements.txt`（yfinance 追加）
- Modify: `db/schema.sql`（`financials_annual.source` 追加＋既存行 backfill）
- Create: `db/migrations/2026-07-11-financials-source.sql`（本番適用用の冪等マイグレーション）

**Interfaces:**
- Produces: `market.financials_annual.source TEXT NOT NULL DEFAULT 'edinet'`（既存行は 'edinet'・新規 yfinance 行は 'yfinance'）。Task 4 がこの列で上書き保護する。

- [ ] **Step 1: requirements.txt に yfinance 追加**

`requirements.txt` 末尾に追記（GHA と手動実行で使用・Vercel Functions は import しないので配信影響なし）:
```
yfinance>=0.2.40
```

- [ ] **Step 2: schema.sql に source 列を追記（新規適用環境向け）**

`db/schema.sql` の `financials_annual` 定義（`cf_cash_end` の次行・PRIMARY KEY の前）に追加:
```sql
  cf_cash_end             DOUBLE PRECISION,
  source                  TEXT NOT NULL DEFAULT 'edinet',   -- 'edinet'(コアJP・保護) | 'yfinance'(拡張)
  PRIMARY KEY (ticker, fiscal_year, fiscal_period)
```

- [ ] **Step 3: 冪等マイグレーション作成（既存 Neon 向け）**

Create `db/migrations/2026-07-11-financials-source.sql`:
```sql
-- financials_annual に source 列を追加し既存行(=EDINET seed 由来)を 'edinet' に確定。
-- 冪等: 既に列があれば ADD COLUMN IF NOT EXISTS が no-op。
ALTER TABLE market.financials_annual
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'edinet';
```

- [ ] **Step 4: マイグレーション適用（本人ローカル・要 DATABASE_URL）**

Run: `psql "$DATABASE_URL" -f db/migrations/2026-07-11-financials-source.sql`
Expected: `ALTER TABLE`（再実行は既存列で no-op）。適用後 `SELECT DISTINCT source FROM market.financials_annual;` が `edinet` のみを返す（既存が保護対象になった確認）。

- [ ] **Step 5: Commit**

```bash
git add requirements.txt db/schema.sql db/migrations/2026-07-11-financials-source.sql
git commit -m "feat(market): add financials_annual.source column to protect EDINET rows"
```

---

### Task 2: `refresh_market.py` 純関数マッピング（yfinance 形 → schema 行）

**Files:**
- Create: `scripts/refresh_market.py`（この Task は純関数部のみ・IO は Task 3/4）
- Create: `tests/test_refresh_market.py`

**Interfaces:**
- Produces:
  - `map_ohlcv_rows(ticker: str, hist: list[dict]) -> list[tuple]` — yfinance history（各 `{date, open, high, low, close, volume}`）→ `(ticker, date, open, high, low, close, volume)` タプル列。非有限/欠損足は除外。
  - `map_info_fields(info: dict) -> dict` — yfinance `info` → `{"market_cap", "per", "pbr"}`（per は trailingPE→forwardPE 補完・None は 0 でなく None を返し upsert 側で扱う）。
  - `map_financials_rows(ticker: str, fin: dict) -> list[tuple]` — yfinance 財務（年度→項目 dict）→ `(ticker, fiscal_year, 'FY', current_assets, non_current_assets, current_liabilities, non_current_liabilities, net_assets, net_sales, gross_profit, operating_income, ordinary_income, income_before_taxes, net_income, operating_cf, investing_cf, financing_cf, cf_cash_start, cf_cash_end, 'yfinance')` タプル列。欠損項目は None。
  - `YF_TO_SCHEMA`（dict・yfinance ラベル → schema 列名）。

- [ ] **Step 1: Write the failing test（3純関数）**

Create `tests/test_refresh_market.py`:
```python
import math
import pytest
from scripts.refresh_market import map_ohlcv_rows, map_info_fields, map_financials_rows


def test_map_ohlcv_rows_filters_non_finite():
    hist = [
        {"date": "2026-07-10", "open": 100.0, "high": 110.0, "low": 99.0, "close": 105.0, "volume": 1000},
        {"date": "2026-07-11", "open": float("nan"), "high": 1, "low": 1, "close": 1, "volume": 1},  # 除外
    ]
    rows = map_ohlcv_rows("AAA.T", hist)
    assert rows == [("AAA.T", "2026-07-10", 100.0, 110.0, 99.0, 105.0, 1000)]


def test_map_info_fields_per_fallback():
    assert map_info_fields({"marketCap": 5e11, "trailingPE": None, "forwardPE": 18.2, "priceToBook": 1.4}) \
        == {"market_cap": 5e11, "per": 18.2, "pbr": 1.4}
    # 全欠損は None（0 で埋めない＝欠損を捏造しない）
    assert map_info_fields({}) == {"market_cap": None, "per": None, "pbr": None}


def test_map_financials_rows_maps_and_tags_source():
    fin = {
        2025: {"Total Revenue": 1000.0, "Gross Profit": 300.0, "Operating Income": 120.0,
               "Net Income": 80.0, "Total Current Assets": 500.0, "Total Non Current Assets": 700.0,
               "Total Current Liabilities": 200.0, "Total Non Current Liabilities": 300.0,
               "Stockholders Equity": 700.0, "Operating Cash Flow": 150.0,
               "Investing Cash Flow": -50.0, "Financing Cash Flow": -40.0,
               "Beginning Cash Position": 400.0, "End Cash Position": 460.0},
    }
    rows = map_financials_rows("MSFT", fin)
    assert len(rows) == 1
    r = rows[0]
    assert r[0] == "MSFT" and r[1] == 2025 and r[2] == "FY"
    assert r[8] == 1000.0   # net_sales
    assert r[9] == 300.0    # gross_profit
    assert r[-1] == "yfinance"   # source タグ
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_refresh_market.py -v`
Expected: FAIL（`ModuleNotFoundError: scripts.refresh_market` または関数未定義）。

- [ ] **Step 3: 純関数を実装**

Create `scripts/refresh_market.py`（純関数部・冒頭）:
```python
"""GitHub Actions/手動用: yfinance → Neon market スキーマ更新。

純関数（map_*）は network 非依存で fixture テスト可能。IO(fetch/upsert)は下部。
--prices: 日次 EOD 株価バッチ＋info(marketCap/per/pbr)。
--financials: 週次 財務(yfinance)。既存 source='edinet' 行は upsert で保護。
"""
from __future__ import annotations
import math
import sys

# yfinance 財務ラベル → schema 列名（欠損はそのまま None）。
YF_TO_SCHEMA = {
    "Total Current Assets": "current_assets",
    "Total Non Current Assets": "non_current_assets",
    "Total Current Liabilities": "current_liabilities",
    "Total Non Current Liabilities": "non_current_liabilities",
    "Stockholders Equity": "net_assets",
    "Total Revenue": "net_sales",
    "Gross Profit": "gross_profit",
    "Operating Income": "operating_income",
    "Pretax Income": "income_before_taxes",
    "Net Income": "net_income",
    "Operating Cash Flow": "operating_cf",
    "Investing Cash Flow": "investing_cf",
    "Financing Cash Flow": "financing_cf",
    "Beginning Cash Position": "cf_cash_start",
    "End Cash Position": "cf_cash_end",
}

_FIN_COLS = (
    "current_assets", "non_current_assets", "current_liabilities",
    "non_current_liabilities", "net_assets", "net_sales", "gross_profit",
    "operating_income", "ordinary_income", "income_before_taxes", "net_income",
    "operating_cf", "investing_cf", "financing_cf", "cf_cash_start", "cf_cash_end",
)


def _finite(v):
    try:
        f = float(v)
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def map_ohlcv_rows(ticker: str, hist: list[dict]) -> list[tuple]:
    out = []
    for h in hist:
        o, hi, lo, c = _finite(h.get("open")), _finite(h.get("high")), _finite(h.get("low")), _finite(h.get("close"))
        if None in (o, hi, lo, c):
            continue
        vol = _finite(h.get("volume")) or 0
        out.append((ticker, h["date"], o, hi, lo, c, int(vol)))
    return out


def map_info_fields(info: dict) -> dict:
    per = info.get("trailingPE")
    if per is None:
        per = info.get("forwardPE")
    return {
        "market_cap": _finite(info.get("marketCap")),
        "per": _finite(per),
        "pbr": _finite(info.get("priceToBook")),
    }


def map_financials_rows(ticker: str, fin: dict) -> list[tuple]:
    rows = []
    for fy, items in fin.items():
        vals = {col: None for col in _FIN_COLS}
        for label, v in items.items():
            col = YF_TO_SCHEMA.get(label)
            if col:
                vals[col] = _finite(v)
        rows.append((ticker, int(fy), "FY", *[vals[c] for c in _FIN_COLS], "yfinance"))
    return rows
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_refresh_market.py -v`
Expected: PASS（3 tests）。

- [ ] **Step 5: Commit**

```bash
git add scripts/refresh_market.py tests/test_refresh_market.py
git commit -m "feat(market): pure yfinance->schema mappers for refresh_market"
```

---

### Task 3: `refresh_market.py --prices`（バッチ株価＋info の取得と upsert）

**Files:**
- Modify: `scripts/refresh_market.py`（IO 層追加）
- Modify: `tests/test_refresh_market.py`（upsert SQL 組立の単体＋download_fn 注入テスト）

**Interfaces:**
- Consumes: `map_ohlcv_rows`, `map_info_fields`（Task 2）。
- Produces:
  - `fetch_prices(tickers: list[str], download_fn=None) -> dict[str, list[dict]]` — `yf.download` バッチ（`download_fn` 注入でテスト可・既定 yfinance）。1リクエストで全 ticker の直近履歴。
  - `upsert_ohlcv(conn, rows: list[tuple]) -> int` / `upsert_ticker_info(conn, ticker: str, fields: dict) -> None`。
  - `run_prices(conn, tickers, download_fn=None, info_fn=None) -> dict`（`{"ok": int, "failed": [ticker,...]}`・部分失敗許容）。
  - CLI: `python scripts/refresh_market.py --prices`。

- [ ] **Step 1: Write the failing test（download_fn 注入で run_prices）**

`tests/test_refresh_market.py` に追記:
```python
def test_run_prices_partial_failure(monkeypatch):
    from scripts import refresh_market as R

    def fake_download(tickers):
        # AAA は成功・BBB は空（取得不能）を模す
        return {"AAA.T": [{"date": "2026-07-10", "open": 1, "high": 2, "low": 1, "close": 2, "volume": 5}],
                "BBB.T": []}

    def fake_info(tk):
        return {"marketCap": 1e9, "trailingPE": 10, "priceToBook": 1}

    calls = {"ohlcv": [], "info": []}
    class FakeConn:  # upsert を捕捉する軽量ダブル
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(R, "upsert_ohlcv", lambda conn, rows: calls["ohlcv"].append(rows) or len(rows))
    monkeypatch.setattr(R, "upsert_ticker_info", lambda conn, tk, f: calls["info"].append((tk, f)))

    res = R.run_prices(FakeConn(), ["AAA.T", "BBB.T"], download_fn=fake_download, info_fn=fake_info)
    assert res["ok"] == 1 and res["failed"] == ["BBB.T"]        # BBB は足0で失敗計上
    assert calls["info"][0][0] == "AAA.T"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_refresh_market.py::test_run_prices_partial_failure -v`
Expected: FAIL（`run_prices`/`upsert_*` 未定義）。

- [ ] **Step 3: IO 層を実装**

`scripts/refresh_market.py` に追記:
```python
def fetch_prices(tickers, download_fn=None):
    if download_fn is None:
        import yfinance as yf
        def download_fn(tks):
            df = yf.download(tks, period="10d", group_by="ticker", threads=True,
                             progress=False, auto_adjust=True)
            out = {}
            for tk in tks:
                sub = df[tk] if len(tks) > 1 else df
                hist = []
                for idx, row in sub.dropna().iterrows():
                    hist.append({"date": idx.strftime("%Y-%m-%d"),
                                 "open": row["Open"], "high": row["High"],
                                 "low": row["Low"], "close": row["Close"],
                                 "volume": row.get("Volume", 0)})
                out[tk] = hist
            return out
    return download_fn(tickers)


def upsert_ohlcv(conn, rows):
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO market.ohlcv (ticker,date,open,high,low,close,volume) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (ticker,date) DO UPDATE SET "
            "open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low, "
            "close=EXCLUDED.close, volume=EXCLUDED.volume", rows)
    return len(rows)


def upsert_ticker_info(conn, ticker, fields):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE market.ticker_master SET market_cap=%s, per=%s, pbr=%s, updated_at=now() "
            "WHERE ticker=%s",
            (fields["market_cap"], fields["per"], fields["pbr"], ticker))


def run_prices(conn, tickers, download_fn=None, info_fn=None):
    hist_map = fetch_prices(tickers, download_fn)
    ok, failed = 0, []
    for tk in tickers:
        try:
            rows = map_ohlcv_rows(tk, hist_map.get(tk, []))
            if not rows:
                failed.append(tk); continue
            upsert_ohlcv(conn, rows)
            info = info_fn(tk) if info_fn else _live_info(tk)
            upsert_ticker_info(conn, tk, map_info_fields(info))
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"[WARN] prices {tk}: {e}", file=sys.stderr)
            failed.append(tk)
    return {"ok": ok, "failed": failed}


def _live_info(ticker):
    import yfinance as yf
    return yf.Ticker(ticker).info
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_refresh_market.py -v`
Expected: PASS（全 test）。

- [ ] **Step 5: Commit**

```bash
git add scripts/refresh_market.py tests/test_refresh_market.py
git commit -m "feat(market): refresh_market --prices (batch ohlcv + info upsert, partial-failure tolerant)"
```

---

### Task 4: `refresh_market.py --financials`（EDINET 保護つき財務 upsert）＋ CLI/main

**Files:**
- Modify: `scripts/refresh_market.py`（financials IO＋`main()` CLI＋loud-fail）
- Modify: `tests/test_refresh_market.py`（source 保護 upsert SQL の検証）

**Interfaces:**
- Consumes: `map_financials_rows`（Task 2）。
- Produces:
  - `upsert_financials(conn, rows) -> int` — `ON CONFLICT DO UPDATE ... WHERE financials_annual.source='yfinance'`（既存 'edinet' 行は保護＝更新されない）。新規 ticker は INSERT（source='yfinance'）。
  - `run_financials(conn, tickers, fin_fn=None) -> dict`。
  - `main(argv) -> int`（`--prices`/`--financials`/`--all`・全失敗は非ゼロ返す loud-fail）。

- [ ] **Step 1: Write the failing test（source 保護 SQL）**

`tests/test_refresh_market.py` に追記:
```python
def test_upsert_financials_protects_edinet(monkeypatch):
    from scripts import refresh_market as R
    captured = {}
    class Cur:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def executemany(self, sql, rows): captured["sql"] = sql; captured["rows"] = rows
    class Conn:
        def cursor(self): return Cur()
    rows = R.map_financials_rows("NEW", {2025: {"Total Revenue": 100.0}})
    R.upsert_financials(Conn(), rows)
    # EDINET 行を守るガードが SQL に入っている
    assert "source='yfinance'" in captured["sql"].replace(" ", "") or \
           "source = 'yfinance'" in captured["sql"]
    assert captured["rows"][0][0] == "NEW"


def test_main_loud_fail_when_all_fail(monkeypatch):
    from scripts import refresh_market as R
    monkeypatch.setattr(R, "_connect", lambda: _NullConn())
    monkeypatch.setattr(R, "run_prices", lambda conn, tks, **k: {"ok": 0, "failed": tks})
    monkeypatch.setattr(R, "_load_tickers", lambda conn: ["X", "Y"])
    rc = R.main(["--prices"])
    assert rc != 0   # 全失敗は非ゼロ終了
```
（`_NullConn` はテスト冒頭に定義: `class _NullConn:\n    def __enter__(self): return self\n    def __exit__(self,*a): return False`）

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_refresh_market.py -k "financials_protects or loud_fail" -v`
Expected: FAIL（`upsert_financials`/`main` 未定義）。

- [ ] **Step 3: 実装（financials upsert＋CLI＋loud-fail）**

`scripts/refresh_market.py` に追記:
```python
import os


def upsert_financials(conn, rows):
    if not rows:
        return 0
    cols = ("ticker,fiscal_year,fiscal_period,current_assets,non_current_assets,"
            "current_liabilities,non_current_liabilities,net_assets,net_sales,"
            "gross_profit,operating_income,ordinary_income,income_before_taxes,"
            "net_income,operating_cf,investing_cf,financing_cf,cf_cash_start,"
            "cf_cash_end,source")
    setexpr = ", ".join(f"{c}=EXCLUDED.{c}" for c in
                        cols.split(",")[3:19])  # 財務16列のみ更新（PK/source は除外）
    sql = (f"INSERT INTO market.financials_annual ({cols}) VALUES "
           f"({','.join(['%s']*20)}) "
           f"ON CONFLICT (ticker,fiscal_year,fiscal_period) DO UPDATE SET {setexpr} "
           f"WHERE financials_annual.source='yfinance'")   # EDINET 行は保護
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
    return len(rows)


def run_financials(conn, tickers, fin_fn=None):
    ok, failed = 0, []
    for tk in tickers:
        try:
            fin = fin_fn(tk) if fin_fn else _live_financials(tk)
            rows = map_financials_rows(tk, fin)
            if not rows:
                failed.append(tk); continue
            upsert_financials(conn, rows)
            ok += 1
        except Exception as e:  # noqa: BLE001
            print(f"[WARN] financials {tk}: {e}", file=sys.stderr)
            failed.append(tk)
    return {"ok": ok, "failed": failed}


def _live_financials(ticker):
    import yfinance as yf
    t = yf.Ticker(ticker)
    fin = {}
    def _absorb(df, orient):
        for col in df.columns:
            fy = getattr(col, "year", None)
            if fy is None:
                continue
            fin.setdefault(fy, {})
            for label in df.index:
                fin[fy][str(label)] = df.loc[label, col]
    for df in (t.income_stmt, t.balance_sheet, t.cashflow):
        if df is not None and not df.empty:
            _absorb(df, None)
    return fin


def _connect():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set")
    import psycopg
    return psycopg.connect(url)


def _load_tickers(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT ticker FROM market.ticker_master ORDER BY ticker")
        return [r[0] for r in cur.fetchall()]


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    do_prices = "--prices" in argv or "--all" in argv
    do_fin = "--financials" in argv or "--all" in argv
    if not (do_prices or do_fin):
        print("usage: refresh_market.py [--prices|--financials|--all]", file=sys.stderr)
        return 2
    with _connect() as conn:
        tickers = _load_tickers(conn)
        total_ok = 0
        if do_prices:
            r = run_prices(conn, tickers)
            print(f"[prices] ok={r['ok']} failed={len(r['failed'])}", file=sys.stderr)
            total_ok += r["ok"]
        if do_fin:
            r = run_financials(conn, tickers)
            print(f"[financials] ok={r['ok']} failed={len(r['failed'])}", file=sys.stderr)
            total_ok += r["ok"]
        conn.commit()
    return 0 if total_ok > 0 else 1   # loud-fail: 全失敗は非ゼロ


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run tests + full suite**

Run: `python -m pytest tests/test_refresh_market.py -v`
Expected: PASS（全 test）。

- [ ] **Step 5: Commit**

```bash
git add scripts/refresh_market.py tests/test_refresh_market.py
git commit -m "feat(market): refresh_market --financials (EDINET-protected upsert) + CLI loud-fail"
```

---

### Task 5: `seed_universe.py`（csv → ticker_master・非破壊 upsert）

**Files:**
- Create: `scripts/seed_universe.py`
- Create: `tests/test_seed_universe.py`

**Interfaces:**
- Produces:
  - `parse_universe_csv(text: str) -> list[dict]` — csv テキスト → `[{ticker,company_name,industry,currency,country,type}]`（ヘッダ検証・空行/コメント`#`行 skip・必須列欠落は ValueError）。
  - `upsert_tickers(conn, rows) -> int`（`ON CONFLICT (ticker) DO UPDATE`・**削除しない**）。
  - `main(argv)`（`--prune` 明示時のみ csv 非掲載 ticker を削除）。

- [ ] **Step 1: Write the failing test**

Create `tests/test_seed_universe.py`:
```python
import pytest
from scripts.seed_universe import parse_universe_csv


def test_parse_skips_comments_and_validates():
    text = ("ticker,company_name,industry,currency,country,type\n"
            "# コメント行\n"
            "\n"
            "7203.T,トヨタ自動車,自動車・輸送機器,JPY,JP,stock\n"
            "AAPL,Apple,テクノロジー・家電,USD,US,stock\n")
    rows = parse_universe_csv(text)
    assert len(rows) == 2
    assert rows[0]["ticker"] == "7203.T" and rows[0]["country"] == "JP"
    assert rows[1]["ticker"] == "AAPL"


def test_parse_missing_column_raises():
    with pytest.raises(ValueError):
        parse_universe_csv("ticker,company_name\nAAPL,Apple\n")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_seed_universe.py -v`
Expected: FAIL（module 未作成）。

- [ ] **Step 3: 実装**

Create `scripts/seed_universe.py`:
```python
"""data/universe.csv → Neon market.ticker_master upsert（非破壊）。

使い方: DATABASE_URL=... python scripts/seed_universe.py [--prune]
--prune 指定時のみ csv 非掲載 ticker を削除（既定は追加/更新のみ＝誤削除防止）。
"""
from __future__ import annotations
import csv
import io
import os
import sys

_REQUIRED = ("ticker", "company_name", "industry", "currency", "country", "type")


def parse_universe_csv(text: str) -> list[dict]:
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("#")]
    reader = csv.DictReader(io.StringIO("\n".join(lines)))
    missing = [c for c in _REQUIRED if c not in (reader.fieldnames or [])]
    if missing:
        raise ValueError(f"universe.csv missing columns: {missing}")
    out = []
    for row in reader:
        if not (row.get("ticker") or "").strip():
            continue
        out.append({c: (row.get(c) or "").strip() for c in _REQUIRED})
    return out


def upsert_tickers(conn, rows) -> int:
    if not rows:
        return 0
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO market.ticker_master "
            "(ticker,company_name,industry,currency,country,type) "
            "VALUES (%(ticker)s,%(company_name)s,%(industry)s,%(currency)s,%(country)s,%(type)s) "
            "ON CONFLICT (ticker) DO UPDATE SET "
            "company_name=EXCLUDED.company_name, industry=EXCLUDED.industry, "
            "currency=EXCLUDED.currency, country=EXCLUDED.country, type=EXCLUDED.type, "
            "updated_at=now()", rows)
    return len(rows)


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    text = open(os.path.join(root, "data", "universe.csv"), encoding="utf-8").read()
    rows = parse_universe_csv(text)
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set")
    import psycopg
    with psycopg.connect(url) as conn:
        n = upsert_tickers(conn, rows)
        if "--prune" in argv:
            keep = tuple(r["ticker"] for r in rows)
            with conn.cursor() as cur:
                cur.execute("DELETE FROM market.ticker_master WHERE ticker <> ALL(%s)", (list(keep),))
                print(f"[prune] removed {cur.rowcount}", file=sys.stderr)
        conn.commit()
    print(f"[seed] upserted {n} tickers", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_seed_universe.py -v`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add scripts/seed_universe.py tests/test_seed_universe.py
git commit -m "feat(market): seed_universe.py (csv -> ticker_master, non-destructive upsert)"
```

---

### Task 6: `data/universe.csv` スターター生成（既存エクスポート＋検証済み拡張）

**Files:**
- Create: `data/universe.csv`
- Create: `scripts/export_current_universe.py`（既存 ticker_master → csv・スターターの土台）

**Interfaces:**
- Produces: `data/universe.csv`（現行 約95 ＋ 検証済み拡張・日米〜300目標）。**架空 ticker を掲載しない**（実在確認済みのみ・[[mistakes]]「架空パス/ID例示しない」）。

- [ ] **Step 1: 既存ユニバースを csv へエクスポート（土台・実在保証）**

Create `scripts/export_current_universe.py`:
```python
"""現行 market.ticker_master を data/universe.csv 形式で出力（スターターの土台）。
DATABASE_URL=... python scripts/export_current_universe.py > data/universe.csv
"""
import os, csv, sys, psycopg
url = os.environ["DATABASE_URL"]
w = csv.writer(sys.stdout)
w.writerow(["ticker", "company_name", "industry", "currency", "country", "type"])
with psycopg.connect(url) as conn, conn.cursor() as cur:
    cur.execute("SELECT ticker,company_name,industry,currency,country,type "
                "FROM market.ticker_master ORDER BY country, ticker")
    for r in cur.fetchall():
        w.writerow(r)
```

- [ ] **Step 2: 現行をエクスポート**

Run: `DATABASE_URL=... python scripts/export_current_universe.py > data/universe.csv`
Expected: 現行 約95行＋ヘッダ。これで**既存の実在銘柄が seed の土台**になる（架空混入ゼロ）。

- [ ] **Step 3: 拡張候補を追記（実装者=Claude が実在検証して追加）**

`data/universe.csv` に、**米国を厚く**する主要指数構成銘柄を追記する。**各 ticker は追記前に yfinance で実在＋名称＋通貨を確認**（`python -c "import yfinance as yf; print(yf.Ticker('MSFT').info.get('shortName'))"` 等）。industry は既存の束B 38分類の表記に正規化（新セクター語を作らない）。目標＝日米合計 ~300。**未検証 ticker は入れない**（欠損取得はログに出るが、そもそも実在確認を先に行う）。

（注: この Step は「実在確認しながらの手作業データ整備」。300件を一括捏造しない。まず米国主要50〜100を検証追記し、残りは段階拡張 Task として後日 csv 追記でよい＝spec §7。）

- [ ] **Step 4: seed 適用でスモーク**

Run: `DATABASE_URL=... python scripts/seed_universe.py`
Expected: `[seed] upserted N tickers`（N=csv 行数）。`SELECT count(*) FROM market.ticker_master;` が拡張後件数に。

- [ ] **Step 5: Commit**

```bash
git add data/universe.csv scripts/export_current_universe.py
git commit -m "feat(market): universe.csv seed (current export + verified US expansion)"
```

---

### Task 7: GitHub Actions `market-refresh.yml`（dispatch 先行）

**Files:**
- Create: `.github/workflows/market-refresh.yml`

**Interfaces:**
- Consumes: `scripts/refresh_market.py`（Task 2-4）。Secrets: `DATABASE_URL`。

- [ ] **Step 1: workflow 作成（dispatch＋schedule コメントアウト）**

Create `.github/workflows/market-refresh.yml`（`cashflow-pull.yml` と同型・schedule はサニティ後に有効化）:
```yaml
name: market-refresh

# yfinance → Neon market スキーマ更新。Claude 非依存の純データ ETL（無料）。
# 段階本番化: まず workflow_dispatch サニティ → 問題なければ schedule 有効化。
# Secrets: DATABASE_URL（market スキーマ upsert 権限の最小ロール推奨）。

on:
  workflow_dispatch:
    inputs:
      mode:
        description: "prices | financials | all"
        default: "prices"
  # schedule:
  #   - cron: "0 21 * * 1-5"   # 平日 UTC21:00 ≒ JST06:00（米クローズ後・日次株価）
  #   - cron: "0 22 * * 6"     # 週次 財務（土 UTC22:00）

permissions:
  contents: read

concurrency:
  group: market-refresh
  cancel-in-progress: false

jobs:
  refresh:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.13"
      - name: Install deps
        run: pip install "psycopg[binary]>=3" "yfinance>=0.2.40"
      - name: Refresh market data
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
        run: python scripts/refresh_market.py --${{ github.event.inputs.mode || 'prices' }}
```

- [ ] **Step 2: dispatch サニティ（手動）**

GitHub → Actions → market-refresh → Run workflow（mode=prices）。
Expected: ジョブ成功・ログに `[prices] ok=N failed=M`。`/api/market/list` を curl し `updated_at` が前進（本番反映）を確認。**通常URL/persona 両方**（[[investment-portal-dual-deploy-persona]]）。

- [ ] **Step 3: schedule 有効化**

サニティ成功後、workflow の `schedule:` ブロックのコメントを外して commit。

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/market-refresh.yml
git commit -m "feat(ci): market-refresh workflow (dispatch-first, yfinance->Neon)"
```

---

### Task 8: nexus 整合チェック（軽量・保有 ∖ ユニバースを警告）

**Files:**
- Modify: `scripts/refresh_market.py`（`--check-holdings` オプション追加・任意）
- Modify: `tests/test_refresh_market.py`

**Interfaces:**
- Produces: `missing_holdings(universe: set[str], holdings: set[str]) -> list[str]`（保有だがユニバース外の ticker・純関数）。

- [ ] **Step 1: Write the failing test**

`tests/test_refresh_market.py` に追記:
```python
def test_missing_holdings():
    from scripts.refresh_market import missing_holdings
    assert missing_holdings({"AAA", "BBB"}, {"AAA", "ZZZ"}) == ["ZZZ"]
    assert missing_holdings({"AAA"}, {"AAA"}) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_refresh_market.py::test_missing_holdings -v`
Expected: FAIL。

- [ ] **Step 3: 実装（純関数のみ・nexus 読取は将来・今回はログ土台）**

`scripts/refresh_market.py` に追記:
```python
def missing_holdings(universe: set, holdings: set) -> list:
    """保有(holdings)だがユニバース(universe)に無い ticker を昇順で返す。
    nexus のウォッチ/保有をユニバースへ自動追加はしない（人手判断・spec §3.7）。"""
    return sorted(holdings - universe)
```
（nexus からの holdings 取得は本 Plan の対象外＝将来。今は純関数と、呼び出し側で保有集合を渡せば警告できる土台のみ。）

- [ ] **Step 4: Run test + 全 python suite**

Run: `python -m pytest tests/ -v`
Expected: 既存＋新規すべて PASS。

- [ ] **Step 5: Commit**

```bash
git add scripts/refresh_market.py tests/test_refresh_market.py
git commit -m "feat(market): missing_holdings consistency helper (nexus watchlist subset check)"
```

---

## Self-Review

**1. Spec coverage:**
- §3.1 cron → Task 7 ✅ / §3.2 refresh_market → Task 2-4 ✅ / §3.2.1 財務ソース保護 → Task 1(source列)+Task4(WHERE guard) ✅ / §3.3 seed → Task 5-6 ✅ / §3.4 配信不変 → 変更なし（関数ゼロ増を全 Task が遵守）✅ / §3.6 AI コメント手動 → 対象外を明記（既存 analyze_financials.py 手動）✅ / §3.7 nexus 整合 → Task 8 ✅ / §5 冪等/loud-fail → Task 3(部分失敗)+Task4(loud-fail) ✅。
- **§3.5 一覧窓表示は Plan 2（別プラン・独立サブシステム）** ＝本 Plan の対象外（scope 分割）。
- §9 リスク: 財務品質(§3.2.1)＝Task6 で実在検証・source 保護で既存 EDINET 温存。info 速度＝Task7 timeout 15分＋収まらねば週次降格（運用調整）。

**2. Placeholder scan:** コード各 Step に実体あり。Task 6 Step 3 は「300件一括捏造をしない」意図的な手作業データ整備（架空 ID 例示禁止＝[[mistakes]]遵守）＝プレースホルダでなく作業指示。

**3. Type consistency:** `map_ohlcv_rows`/`map_info_fields`/`map_financials_rows`（Task2）→ `run_prices`/`run_financials`（Task3/4）で一貫。`upsert_financials` の20列順は `map_financials_rows` の出力順（ticker,fy,period,_FIN_COLS16,source）と一致。`_connect`/`_load_tickers`/`main` 名は Task4 で定義し test（Task4）が参照。

## Execution Handoff
Plan 2（一覧窓表示）は別途作成。まず本 Plan（データパイプライン）を実行する。実行方式は次メッセージで確認（subagent-driven 推奨・worktree 分離）。
