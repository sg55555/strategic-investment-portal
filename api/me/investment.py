"""GET /api/me/investment — 司令室の投資スナップショット（投資台帳の素データ）。認証必須・読取専用。

→ {"investment": [ {period, invest_cash_flow, principal_core_delta, principal_sat_delta,
                    realized_gain, is_complete, holdings, pulled_at}, ... ]}
業務 math は持たない（元本/実現益/investable の算出は money-rules.js investmentDerived が担う＝単一源）。
書込は ETL（GitHub Actions / scripts/etl_investment.py）のみ＝この endpoint に PUT は無い（state.py の LWW 同期に乗せない）。
セッション無効は 401。テーブル未適用/読取失敗は investment:[] で degrade（保有ゼロ/未配線でも UI/Mode A は investable=0 で正常）。
cashflow.py と同形・別ファイル＝投資読取失敗が収支/中核 sync を巻き込まない（故障隔離・D1）。
"""
from http.server import BaseHTTPRequestHandler
from decimal import Decimal
import hashlib
import json
import os
import sys

import psycopg

COOKIE = "wc_session"
MAX_MONTHS = 120  # 直近10年分（月次・元本累積は全期間だが payload を抑制）

COLUMNS = ("period", "invest_cash_flow", "principal_core_delta", "principal_sat_delta",
           "realized_gain", "is_complete", "holdings", "pulled_at")


def _conn():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg.connect(url)


def _cookie_token(headers, name=COOKIE):
    cookie = headers.get("Cookie", "") or ""
    for part in cookie.split(";"):
        p = part.strip()
        if p.startswith(name + "="):
            return p[len(name) + 1:]
    return None


def _valid_session(cur, token) -> bool:
    if not token:
        return False
    cur.execute(
        "SELECT 1 FROM me.sessions WHERE token = %s AND expires_at > now()",
        (hashlib.sha256(token.encode("utf-8")).hexdigest(),),
    )
    return cur.fetchone() is not None


def _num(v):
    if isinstance(v, Decimal):
        return int(v) if v == v.to_integral_value() else float(v)
    return v


def _row_to_dict(rec):
    period, pulled = rec[0], rec[7]
    return {
        "period": period.isoformat() if hasattr(period, "isoformat") else period,
        "invest_cash_flow": _num(rec[1]),
        "principal_core_delta": _num(rec[2]),
        "principal_sat_delta": _num(rec[3]),
        "realized_gain": _num(rec[4]),
        "is_complete": rec[5],
        "holdings": rec[6],
        "pulled_at": pulled.isoformat() if hasattr(pulled, "isoformat") else pulled,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        token = _cookie_token(self.headers)
        try:
            with _conn() as conn, conn.cursor() as cur:
                if not _valid_session(cur, token):
                    return self._json(401, {"error": "unauthorized"})
                # テーブル未適用/保有ゼロ/読取失敗は空配列で degrade（500 にしない＝investable=0 で正常）。
                try:
                    cur.execute(
                        "SELECT " + ", ".join(COLUMNS) + " FROM me.investment_snapshots "
                        "ORDER BY period DESC LIMIT %s",
                        (MAX_MONTHS,),
                    )
                    rows = [_row_to_dict(rec) for rec in cur.fetchall()]
                except Exception as e:  # noqa: BLE001
                    print(f"me/investment read degraded: {e!r}", file=sys.stderr)
                    rows = []
                return self._json(200, {"investment": rows})
        except Exception as e:  # noqa: BLE001
            print(f"me/investment do_GET error: {e!r}", file=sys.stderr)
            return self._json(500, {"error": "internal"})

    def _json(self, status: int, data):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
