"""GET /api/market/ohlcv?ticker=XXXX — 1銘柄の日足OHLCV全件。

旧 STOCK_DATA[ticker].prices と同型の配列を返す:
  [{ "time":"YYYY-MM-DD", "open":float, "high":float, "low":float,
     "close":float, "volume":int }, ...]  ※ time 昇順（チャートの辞書順比較に必須）
認証不要・個人データゼロ。
"""
from http.server import BaseHTTPRequestHandler
import json
import os
from urllib.parse import urlparse, parse_qs

import psycopg


def _conn():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg.connect(url)


def fetch_ohlcv(ticker: str) -> dict:
    prices = []
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT date, open, high, low, close, volume FROM market.ohlcv "
            "WHERE ticker = %s ORDER BY date ASC",
            (ticker,),
        )
        for date, o, h, low, c, vol in cur.fetchall():
            prices.append({
                "time": date.isoformat(),  # YYYY-MM-DD
                "open": o, "high": h, "low": low, "close": c,
                "volume": int(vol) if vol is not None else 0,
            })
    return {"ticker": ticker, "prices": prices}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            ticker = (qs.get("ticker") or [""])[0].strip()
            if not ticker:
                self._json(400, {"error": "ticker required"})
                return
            self._json(200, fetch_ohlcv(ticker))
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    def _json(self, status: int, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
