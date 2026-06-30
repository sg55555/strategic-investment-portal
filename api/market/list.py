"""GET /api/market/list — 全銘柄の軽量サマリ（grid/検索/フィルタ用・prices無し）。

旧 data.js の STOCK_DATA を「ticker → エントリ」の辞書として再現するが、
prices は空配列・financials_trend は grid が読む直近3期×7項目だけに絞る
（初回ロード 21MB→数十KB）。詳細(prices/全財務)は ohlcv/financials で遅延取得。
認証不要・個人データゼロ（public market データのみ）。
"""
from http.server import BaseHTTPRequestHandler
from datetime import timezone, timedelta
import json
import os

import psycopg

_JST = timezone(timedelta(hours=9))

# grid(filterAndRenderPortal) が financials_trend[year] から読む7項目だけ
_GRID_FIN_FIELDS = (
    "net_sales", "net_assets", "current_assets", "non_current_assets",
    "current_liabilities", "operating_income", "net_income",
)


def _conn():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg.connect(url)


def fetch_list() -> dict:
    """STOCK_DATA 互換の軽量辞書 + データ最終更新日時を {stocks, updated_at} で返す。

    updated_at は ticker_master.updated_at の最大値（ETL upsert が now() を入れる＝最終同期時刻）を
    JST "YYYY-MM-DD HH:MM" で整形。値が無ければ空文字（フロントはバッジ非表示にフォールバック）。
    """
    out: dict[str, dict] = {}
    updated_at = ""
    with _conn() as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT ticker, company_name, industry, currency, country, type, "
            "market_cap, per, pbr FROM market.ticker_master"
        )
        for (ticker, name, industry, currency, country, typ,
             mcap, per, pbr) in cur.fetchall():
            out[ticker] = {
                "company_name": name,
                "industry": industry,
                "currency": currency,
                "country": country,
                "type": typ,
                "marketCap": mcap if mcap is not None else 0,
                "per": per if per is not None else 0,
                "pbr": pbr if pbr is not None else 0,
                "prices": [],            # 遅延ハイドレートまで空（grid は prices を読まない）
                "financials_trend": {},  # 直近3期だけ下で詰める（ETFは空のまま）
            }

        # 各銘柄の直近3会計年度のみ（grid の最新KPI＋3期売上スパークライン用）
        cur.execute(
            "SELECT ticker, fiscal_year, "
            + ", ".join(_GRID_FIN_FIELDS) + " FROM ("
            "  SELECT *, ROW_NUMBER() OVER "
            "    (PARTITION BY ticker ORDER BY fiscal_year DESC) AS rn"
            "  FROM market.financials_annual"
            ") t WHERE rn <= 3"
        )
        for row in cur.fetchall():
            ticker, fy = row[0], row[1]
            entry = out.get(ticker)
            if entry is None:
                continue
            year_obj = {f: v for f, v in zip(_GRID_FIN_FIELDS, row[2:]) if v is not None}
            year_obj["year"] = fy
            entry["financials_trend"][str(fy)] = year_obj

        # データ最終更新日時（ETL の ON CONFLICT DO UPDATE SET updated_at=now() で前進する）
        cur.execute("SELECT MAX(updated_at) FROM market.ticker_master")
        row = cur.fetchone()
        if row and row[0] is not None:
            updated_at = row[0].astimezone(_JST).strftime("%Y-%m-%d %H:%M")
    return {"stocks": out, "updated_at": updated_at}


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        try:
            self._json(200, fetch_list())
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
