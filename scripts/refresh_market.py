"""GitHub Actions/手動用: yfinance → Neon market スキーマ更新。

純関数（map_*）は network 非依存で fixture テスト可能。IO(fetch/upsert)は下部。
--prices: 日次 EOD 株価バッチ＋info(marketCap/per/pbr)。
--financials: 週次 財務(yfinance)。既存 source='edinet' 行は upsert で保護。
"""
from __future__ import annotations
import math
import os
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

# 中断耐性: 成功件数がこの倍数に達するたびに中間 commit（GHA timeout 等での kill でも
# 完了分は永続化。upsert は冪等なので部分 commit は安全）。
_COMMIT_EVERY = 25

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


def fetch_prices(tickers, download_fn=None, period="10d"):
    if download_fn is None:
        import yfinance as yf
        def download_fn(tks):
            df = yf.download(tks, period=period, group_by="ticker", threads=True,
                             progress=False, auto_adjust=True)
            out = {}
            for tk in tks:
                try:
                    sub = df[tk] if len(tks) > 1 else df
                    hist = []
                    for idx, row in sub.dropna().iterrows():
                        hist.append({"date": idx.strftime("%Y-%m-%d"),
                                     "open": row["Open"], "high": row["High"],
                                     "low": row["Low"], "close": row["Close"],
                                     "volume": row.get("Volume", 0)})
                except Exception as e:  # noqa: BLE001 - 部分/空フレームで1銘柄が KeyError 等でも他銘柄を継続
                    print(f"[WARN] fetch_prices reshape {tk}: {e}", file=sys.stderr)
                    hist = []
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


def run_prices(conn, tickers, download_fn=None, info_fn=None, period="10d"):
    hist_map = fetch_prices(tickers, download_fn, period)
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
            if ok % _COMMIT_EVERY == 0:
                conn.commit()
        except Exception as e:  # noqa: BLE001
            print(f"[WARN] prices {tk}: {e}", file=sys.stderr)
            failed.append(tk)
    return {"ok": ok, "failed": failed}


def _live_info(ticker):
    import yfinance as yf
    return yf.Ticker(ticker).info


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
            if ok % _COMMIT_EVERY == 0:
                conn.commit()
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
    do_backfill = "--backfill" in argv          # 初回フル履歴（新規銘柄の5年チャート用）
    do_prices = "--prices" in argv or "--all" in argv or do_backfill
    do_fin = "--financials" in argv or "--all" in argv
    if not (do_prices or do_fin):
        print("usage: refresh_market.py [--prices|--financials|--all|--backfill]", file=sys.stderr)
        return 2
    with _connect() as conn:
        tickers = _load_tickers(conn)
        total_ok = 0
        if do_prices:
            period = "max" if do_backfill else "10d"   # backfill=全履歴 / 通常=直近10日
            r = run_prices(conn, tickers, period=period)
            label = "prices backfill" if do_backfill else "prices"
            print(f"[{label}] ok={r['ok']} failed={len(r['failed'])}", file=sys.stderr)
            total_ok += r["ok"]
        if do_fin:
            r = run_financials(conn, tickers)
            print(f"[financials] ok={r['ok']} failed={len(r['failed'])}", file=sys.stderr)
            total_ok += r["ok"]
        # psycopg3 の `with connection:` は正常終了時に自動 commit（例外時は rollback）するため
        # 明示的 conn.commit() は不要（テストダブル _NullConn は commit を持たない前提とも整合）。
    return 0 if total_ok > 0 else 1   # loud-fail: 全失敗は非ゼロ


def missing_holdings(universe: set, holdings: set) -> list:
    """保有(holdings)だがユニバース(universe)に無い ticker を昇順で返す。
    nexus のウォッチ/保有をユニバースへ自動追加はしない（人手判断・spec §3.7）。"""
    return sorted(holdings - universe)


if __name__ == "__main__":
    raise SystemExit(main())
