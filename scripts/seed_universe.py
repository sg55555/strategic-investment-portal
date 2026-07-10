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
