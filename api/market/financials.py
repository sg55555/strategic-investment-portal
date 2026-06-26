"""GET /api/market/financials?ticker=XXXX — 1銘柄の財務3表（全年度）＋AIコメント。

旧 STOCK_DATA[ticker].financials_trend と同型を返す:
  { "financials_trend": { "<year>": { year, period, ...財務各項目..., ai_analysis } } }
- 年度キーは数値文字列（Object.keys→Number ソート前提）。
- ai_analysis は各年度オブジェクト内にネスト（トップレベルでは index.html が読まない）。
- 旧 data.js が持たなかった欠損項目は None を省いて出さない（元の形状を忠実に再現）。
認証不要・個人データゼロ。
"""
from http.server import BaseHTTPRequestHandler
import json
import os
from urllib.parse import urlparse, parse_qs

import psycopg

# 年度オブジェクトに載せる財務項目（DBカラム名＝data.jsフィールド名で1:1）。None は省く。
_FIN_FIELDS = (
    "current_assets", "non_current_assets", "current_liabilities",
    "non_current_liabilities", "net_assets", "net_sales", "gross_profit",
    "operating_income", "ordinary_income", "income_before_taxes", "net_income",
    "operating_cf", "investing_cf", "financing_cf", "cf_cash_start", "cf_cash_end",
)


def _conn():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg.connect(url)


def fetch_financials(ticker: str) -> dict:
    trend: dict[str, dict] = {}
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT f.fiscal_year, f.fiscal_period, "
            + ", ".join("f." + c for c in _FIN_FIELDS) + ", a.comment "
            "FROM market.financials_annual f "
            "LEFT JOIN market.ai_comments a "
            "  ON a.ticker = f.ticker AND a.fiscal_year = f.fiscal_year "
            "WHERE f.ticker = %s",
            (ticker,),
        )
        for row in cur.fetchall():
            fy, period = row[0], row[1]
            fin_vals = row[2:2 + len(_FIN_FIELDS)]
            comment = row[2 + len(_FIN_FIELDS)]
            year_obj = {"year": fy, "period": period or "FY"}
            for name, val in zip(_FIN_FIELDS, fin_vals):
                if val is not None:
                    year_obj[name] = val
            if comment:
                year_obj["ai_analysis"] = comment
            trend[str(fy)] = year_obj
    return {"ticker": ticker, "financials_trend": trend}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            qs = parse_qs(urlparse(self.path).query)
            ticker = (qs.get("ticker") or [""])[0].strip()
            if not ticker:
                self._json(400, {"error": "ticker required"})
                return
            self._json(200, fetch_financials(ticker))
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
