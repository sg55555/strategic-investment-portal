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
