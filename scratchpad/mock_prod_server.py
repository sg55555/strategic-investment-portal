#!/usr/bin/env python3
"""検証用モック本番サーバ（Task 0 ハーネス専用・stdlib のみ）。

`127.0.0.1:8200` で待受け、以下を配信する:
  - worktree の index.html を **バイトそのまま**（注入・改変なし）
  - /dataClient.js /finance-rules.js /money-rules.js /money.js /money.css 等の
    worktree ルート配下ファイルを **毎リクエストでディスクから**（各 Task の変更が即反映）
  - /api/market/{list,ohlcv,financials} を SQLite 実財務 + 合成決定論 OHLCV でモック

本番の api/market/{list,financials,ohlcv}.py と同型の JSON を返すが、Postgres の代わりに
コピー済み SQLite（data/investment.db）を読み、market_cap/per/pbr と価格は完全決定論で合成する。
無シード乱数は使わない（実行ごとにバイト同一）。
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, unquote
import datetime
import hashlib
import json
import math
import os
import sqlite3

# scratchpad/ にあるので worktree ルートは一つ上。
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_DB_PATH = os.path.join(_ROOT, "data", "investment.db")

# list.py の _GRID_FIN_FIELDS（grid が financials_trend[year] から読む7項目）。
_GRID_FIN_FIELDS = (
    "net_sales", "net_assets", "current_assets", "non_current_assets",
    "current_liabilities", "operating_income", "net_income",
)
# financials.py の _FIN_FIELDS（財務3表・DB列名＝キーで1:1）。
_FIN_FIELDS = (
    "current_assets", "non_current_assets", "current_liabilities",
    "non_current_liabilities", "net_assets", "net_sales", "gross_profit",
    "operating_income", "ordinary_income", "income_before_taxes", "net_income",
    "operating_cf", "investing_cf", "financing_cf", "cf_cash_start", "cf_cash_end",
)

_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".map": "application/json; charset=utf-8",
}

_OHLCV_BARS = 600          # ≥550（MA75/BB20/RSI14/MACD/ZigZag に十分）
_OHLCV_END = datetime.date(2026, 6, 30)   # 終端日を固定（決定論）


def _db():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _ticker_hash(ticker: str) -> int:
    return int(hashlib.sha256(ticker.encode("utf-8")).hexdigest(), 16)


def _synth_marketcap_per_pbr(ticker: str):
    """ticker から決定論的に (marketCap:int, per:float, pbr:float) を合成。同一 ticker で常に同値。"""
    h = _ticker_hash(ticker)
    per = round(8 + (h % 2200) / 100.0, 2)                 # ≒ 8.00〜30.00
    pbr = round(0.5 + ((h >> 8) % 250) / 100.0, 2)         # ≒ 0.50〜3.00
    market_cap = 10 ** 11 + (h >> 16) % (49 * 10 ** 11)    # ≒ 1e11〜5e12
    return market_cap, per, pbr


# ---- /api/market/list --------------------------------------------------------

def build_list() -> dict:
    """list.py fetch_list と同型 {stocks, updated_at}。SQLite 実マスタ + 合成 marketCap/per/pbr。"""
    stocks: dict[str, dict] = {}
    with _db() as conn:
        for row in conn.execute(
            "SELECT ticker, company_name, industry, currency, country, type "
            "FROM ticker_master"
        ):
            ticker = row["ticker"]
            market_cap, per, pbr = _synth_marketcap_per_pbr(ticker)
            stocks[ticker] = {
                "company_name": row["company_name"],
                "industry": row["industry"],
                "currency": row["currency"],
                "country": row["country"],
                "type": row["type"],
                "marketCap": market_cap,
                "per": per,
                "pbr": pbr,
                "prices": [],
                "financials_trend": {},
            }

        # 各銘柄の直近3会計年度のみ（fiscal_year DESC で上位3）。
        cols = ", ".join(_GRID_FIN_FIELDS)
        for tkr in stocks:
            for frow in conn.execute(
                f"SELECT fiscal_year, {cols} FROM financial_data_v2 "
                "WHERE ticker = ? ORDER BY fiscal_year DESC LIMIT 3",
                (tkr,),
            ):
                fy = frow["fiscal_year"]
                year_obj = {f: frow[f] for f in _GRID_FIN_FIELDS if frow[f] is not None}
                year_obj["year"] = fy
                stocks[tkr]["financials_trend"][str(fy)] = year_obj

    return {"stocks": stocks, "updated_at": "2026-07-01 00:00"}


# ---- /api/market/financials --------------------------------------------------

def build_financials(ticker: str) -> dict:
    """financials.py fetch_financials と同型。全年度・非null項目 + 決定論 ai_analysis。"""
    trend: dict[str, dict] = {}
    with _db() as conn:
        for row in conn.execute(
            "SELECT * FROM financial_data_v2 WHERE ticker = ?", (ticker,)
        ):
            fy = row["fiscal_year"]
            year_obj = {"year": fy, "period": (row["fiscal_period"] or "FY")}
            for name in _FIN_FIELDS:
                val = row[name]
                if val is not None:
                    year_obj[name] = val
            # DB に AI コメント列は無い → 決定論の固定文字列（AIコメントカード経路を励起）。
            year_obj["ai_analysis"] = f"{fy}年度の財務ハイライト（検証用ダミー）。"
            trend[str(fy)] = year_obj
    return {"ticker": ticker, "financials_trend": trend}


# ---- /api/market/ohlcv -------------------------------------------------------

def _ticker_known(ticker: str) -> bool:
    with _db() as conn:
        return conn.execute(
            "SELECT 1 FROM ticker_master WHERE ticker = ? LIMIT 1", (ticker,)
        ).fetchone() is not None


def build_ohlcv(ticker: str) -> dict:
    """合成の決定論 OHLCV（time 昇順・≥550本・トレンド＋レンジ・実行ごとバイト同一）。"""
    if not _ticker_known(ticker):        # 未知 ticker は空配列を 200（本番 ohlcv.py と同挙動）。
        return {"ticker": ticker, "prices": []}
    h = _ticker_hash(ticker)
    base = 1000.0 + (h % 4000)          # 銘柄別ベース価格 1000〜5000
    n = _OHLCV_BARS
    start = _OHLCV_END - datetime.timedelta(days=n - 1)

    prices = []
    prev_close = None
    for i in range(n):
        # 決定論的疑似ノイズ（ticker+i の sha256 由来・無シード乱数を使わない）。
        nh = int(hashlib.sha256(f"{ticker}:{i}".encode("utf-8")).hexdigest()[:8], 16)
        noise = ((nh % 1000) / 1000.0 - 0.5) * base * 0.012   # ±0.6%

        # 遅い正弦（上げ→下げの大波＝ZigZag ピボット）＋中周期＋速周期（MACD クロス）。
        slow = base * 0.30 * math.sin(i / (n / 1.5))
        med = base * 0.06 * math.sin(i / 21.0)
        fast = base * 0.025 * math.sin(i / 6.5)
        close = base + slow + med + fast + noise

        if prev_close is None:
            open_ = round(close - base * 0.003, 2)
        else:
            open_ = prev_close
        close = round(close, 2)

        # ヒゲは決定論の正のオフセット → low ≤ open,close ≤ high を保証。
        up_wick = round(base * 0.003 * (0.5 + (nh >> 8 & 0xFF) / 255.0), 2)
        dn_wick = round(base * 0.003 * (0.5 + (nh >> 16 & 0xFF) / 255.0), 2)
        high = round(max(open_, close) + up_wick, 2)
        low = round(min(open_, close) - dn_wick, 2)

        volume = int(500_000 + (nh % 4_500_000) + abs(fast) * 1000)

        prices.append({
            "time": (start + datetime.timedelta(days=i)).isoformat(),
            "open": open_, "high": high, "low": low, "close": close,
            "volume": volume,
        })
        prev_close = close

    return {"ticker": ticker, "prices": prices}


# ---- HTTP handler ------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        try:
            parsed = urlparse(self.path)
            path = unquote(parsed.path)
            if path.startswith("/api/"):
                self._handle_api(path, parse_qs(parsed.query))
            else:
                self._handle_static(path)
        except BrokenPipeError:
            pass
        except Exception as e:  # noqa: BLE001
            self._json(500, {"error": str(e)})

    # -- API --
    def _handle_api(self, path: str, qs: dict):
        if path == "/api/market/list":
            self._json(200, build_list())
            return
        if path == "/api/market/ohlcv":
            ticker = (qs.get("ticker") or [""])[0].strip()
            if not ticker:
                self._json(400, {"error": "ticker required"})
                return
            self._json(200, build_ohlcv(ticker))
            return
        if path == "/api/market/financials":
            ticker = (qs.get("ticker") or [""])[0].strip()
            if not ticker:
                self._json(400, {"error": "ticker required"})
                return
            self._json(200, build_financials(ticker))
            return
        self._json(404, {"error": "not found"})

    # -- 静的ファイル --
    def _handle_static(self, path: str):
        if path in ("/", "/index.html"):
            self._send_file(os.path.join(_ROOT, "index.html"), "text/html; charset=utf-8")
            return

        # パストラバーサル防御: 正規化後に root 外へ出るなら拒否。
        rel = path.lstrip("/")
        abs_path = os.path.normpath(os.path.join(_ROOT, rel))
        if abs_path != _ROOT and not abs_path.startswith(_ROOT + os.sep):
            self._send_bytes(403, b"forbidden", "text/plain; charset=utf-8")
            return
        if not os.path.isfile(abs_path):
            self._send_bytes(404, b"not found", "text/plain; charset=utf-8")
            return
        ext = os.path.splitext(abs_path)[1].lower()
        ctype = _CONTENT_TYPES.get(ext, "application/octet-stream")
        self._send_file(abs_path, ctype)

    # -- 送出ヘルパ --
    def _send_file(self, abs_path: str, ctype: str):
        with open(abs_path, "rb") as f:      # 毎リクエストでディスクから読む
            body = f.read()
        self._send_bytes(200, body, ctype)

    def _json(self, status: int, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, status: int, body: bytes, ctype: str):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 静音
        pass


def main():
    server = ThreadingHTTPServer(("127.0.0.1", 8200), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
