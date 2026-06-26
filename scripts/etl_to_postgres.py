#!/usr/bin/env python3
"""お金の司令室 v2 / Slice 1 — data.js → Neon Postgres ETL（seed投入）。

data.js は STOCK_DATA に「銘柄情報＋株価日足＋財務年次＋AIコメント」を全部持つ
生成物なので、これ1つを源に market スキーマへ冪等投入する（investment.db /
analysis_cache.json には依存しない）。再実行は ON CONFLICT で上書き。

使い方:
    export DATABASE_URL='postgres://...'        # Neon の接続文字列
    psql "$DATABASE_URL" -f db/schema.sql        # 先にスキーマ適用
    python scripts/etl_to_postgres.py            # data.js を seed 投入
    python scripts/etl_to_postgres.py --data-js path/to/data.js
依存: psycopg>=3  (pip install 'psycopg[binary]')
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path


def parse_data_js(path: Path) -> dict:
    """data.js の `const STOCK_DATA = {...};` を抽出して dict で返す。"""
    text = path.read_text(encoding="utf-8")
    m = re.search(r"const\s+STOCK_DATA\s*=\s*", text)
    if not m:
        sys.exit(f"STOCK_DATA が見つかりません: {path}")
    body = text[m.end():].strip()
    if body.endswith(";"):
        body = body[:-1].rstrip()
    try:
        return json.loads(body)
    except json.JSONDecodeError as e:
        sys.exit(f"STOCK_DATA を JSON として解釈できません: {e}")


def num(v):
    if v is None or v == "":
        return None
    try:
        f = float(v)
        return f if f == f else None  # NaN除外
    except (TypeError, ValueError):
        return None


def upsert(stock: dict) -> tuple[list, list, list, list]:
    """STOCK_DATA → (master_rows, ohlcv_rows, fin_rows, ai_rows)。"""
    master, ohlcv, fins, ai = [], [], [], []
    for ticker, d in stock.items():
        master.append((
            ticker, d.get("company_name"), d.get("industry"), d.get("currency"),
            d.get("country"), d.get("type"),
            num(d.get("marketCap")), num(d.get("per")), num(d.get("pbr")),
        ))
        for p in d.get("prices", []) or []:
            day = (p.get("time") or "")[:10]
            if not day:
                continue
            ohlcv.append((
                ticker, day, num(p.get("open")), num(p.get("high")),
                num(p.get("low")), num(p.get("close")),
                int(p["volume"]) if num(p.get("volume")) is not None else None,
            ))
        for year, f in (d.get("financials_trend") or {}).items():
            try:
                fy = int(year)
            except (TypeError, ValueError):
                continue
            period = f.get("period") or "FY"
            fins.append((
                ticker, fy, period,
                num(f.get("current_assets")), num(f.get("non_current_assets")),
                num(f.get("current_liabilities")), num(f.get("non_current_liabilities")),
                num(f.get("net_assets")),
                num(f.get("net_sales")), num(f.get("gross_profit")),
                num(f.get("operating_income")), num(f.get("ordinary_income")),
                num(f.get("income_before_taxes")), num(f.get("net_income")),
                num(f.get("operating_cf")), num(f.get("investing_cf")),
                num(f.get("financing_cf")), num(f.get("cf_cash_start")),
                num(f.get("cf_cash_end")),
            ))
            comment = (f.get("ai_analysis") or "").strip()
            if comment:
                ai.append((ticker, fy, comment))
    return master, ohlcv, fins, ai


SQL_MASTER = """
INSERT INTO market.ticker_master
  (ticker, company_name, industry, currency, country, type, market_cap, per, pbr, updated_at)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
ON CONFLICT (ticker) DO UPDATE SET
  company_name=EXCLUDED.company_name, industry=EXCLUDED.industry,
  currency=EXCLUDED.currency, country=EXCLUDED.country, type=EXCLUDED.type,
  market_cap=EXCLUDED.market_cap, per=EXCLUDED.per, pbr=EXCLUDED.pbr,
  updated_at=now();
"""
SQL_OHLCV = """
INSERT INTO market.ohlcv (ticker, date, open, high, low, close, volume)
VALUES (%s,%s,%s,%s,%s,%s,%s)
ON CONFLICT (ticker, date) DO UPDATE SET
  open=EXCLUDED.open, high=EXCLUDED.high, low=EXCLUDED.low,
  close=EXCLUDED.close, volume=EXCLUDED.volume;
"""
SQL_FIN = """
INSERT INTO market.financials_annual
  (ticker, fiscal_year, fiscal_period, current_assets, non_current_assets,
   current_liabilities, non_current_liabilities, net_assets, net_sales,
   gross_profit, operating_income, ordinary_income, income_before_taxes,
   net_income, operating_cf, investing_cf, financing_cf, cf_cash_start, cf_cash_end)
VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
ON CONFLICT (ticker, fiscal_year, fiscal_period) DO UPDATE SET
  current_assets=EXCLUDED.current_assets, non_current_assets=EXCLUDED.non_current_assets,
  current_liabilities=EXCLUDED.current_liabilities,
  non_current_liabilities=EXCLUDED.non_current_liabilities, net_assets=EXCLUDED.net_assets,
  net_sales=EXCLUDED.net_sales, gross_profit=EXCLUDED.gross_profit,
  operating_income=EXCLUDED.operating_income, ordinary_income=EXCLUDED.ordinary_income,
  income_before_taxes=EXCLUDED.income_before_taxes, net_income=EXCLUDED.net_income,
  operating_cf=EXCLUDED.operating_cf, investing_cf=EXCLUDED.investing_cf,
  financing_cf=EXCLUDED.financing_cf, cf_cash_start=EXCLUDED.cf_cash_start,
  cf_cash_end=EXCLUDED.cf_cash_end;
"""
SQL_AI = """
INSERT INTO market.ai_comments (ticker, fiscal_year, comment, generated_at)
VALUES (%s,%s,%s, now())
ON CONFLICT (ticker, fiscal_year) DO UPDATE SET
  comment=EXCLUDED.comment, generated_at=now();
"""


def main() -> None:
    ap = argparse.ArgumentParser()
    here = Path(__file__).resolve().parent.parent
    ap.add_argument("--data-js", default=str(here / "data.js"))
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL", ""))
    args = ap.parse_args()
    if not args.database_url:
        sys.exit("DATABASE_URL を環境変数か --database-url で指定してください")
    try:
        import psycopg
    except ImportError:
        sys.exit("psycopg(v3) が必要です: pip install 'psycopg[binary]'")

    stock = parse_data_js(Path(args.data_js))
    master, ohlcv, fins, ai = upsert(stock)
    print(f"parsed: {len(master)} tickers / {len(ohlcv)} ohlcv / "
          f"{len(fins)} financials / {len(ai)} ai_comments")

    with psycopg.connect(args.database_url) as conn:
        with conn.cursor() as cur:
            cur.executemany(SQL_MASTER, master)
            for i in range(0, len(ohlcv), 5000):
                cur.executemany(SQL_OHLCV, ohlcv[i:i + 5000])
            cur.executemany(SQL_FIN, fins)
            cur.executemany(SQL_AI, ai)
        conn.commit()
    print("ETL 完了（冪等・再実行で上書き）")


if __name__ == "__main__":
    main()
