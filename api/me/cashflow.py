"""GET /api/me/cashflow — 司令室の収支スナップショット（投資余力の素データ）。認証必須・読取専用。

→ {"cashflow": [ {period, total_income, ..., balance, savings_rate, is_complete, breakdown, pulled_at}, ... ]}
業務 math は持たない（投資余力の算出は money-rules.js cashflowViewModel が担う＝単一源）。
書込は ETL（GitHub Actions）のみ＝この endpoint に PUT は無い（state.py の LWW 同期に乗せない）。
セッション無効は 401。テーブル未適用/読取失敗は cashflow:[] で degrade（フロントは未連携 CTA を出す）。
専用 endpoint にした理由（D1）= 安定 state.py を無改造に保ち、cashflow 読取失敗が中核 sync を巻き込まない（故障隔離）。
"""
from http.server import BaseHTTPRequestHandler
from decimal import Decimal
import hashlib
import json
import os
import sys

import psycopg

COOKIE = "wc_session"
MAX_MONTHS = 60  # 直近5年分（月次・payload を抑制）

COLUMNS = ("period", "total_income", "salary_income", "misc_income", "fixed_expense",
           "variable_expense", "total_expense", "balance", "savings_rate",
           "is_complete", "breakdown", "pulled_at")


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
    period, pulled = rec[0], rec[11]
    return {
        "period": period.isoformat() if hasattr(period, "isoformat") else period,
        "total_income": _num(rec[1]), "salary_income": _num(rec[2]), "misc_income": _num(rec[3]),
        "fixed_expense": _num(rec[4]), "variable_expense": _num(rec[5]), "total_expense": _num(rec[6]),
        "balance": _num(rec[7]), "savings_rate": _num(rec[8]), "is_complete": rec[9],
        "breakdown": rec[10],
        "pulled_at": pulled.isoformat() if hasattr(pulled, "isoformat") else pulled,
    }


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        token = _cookie_token(self.headers)
        try:
            with _conn() as conn, conn.cursor() as cur:
                if not _valid_session(cur, token):
                    return self._json(401, {"error": "unauthorized"})
                # テーブル未適用/読取失敗は空配列で degrade（500 にしない＝UI は未連携 CTA）。
                try:
                    cur.execute(
                        "SELECT " + ", ".join(COLUMNS) + " FROM me.cashflow_snapshots "
                        "ORDER BY period DESC LIMIT %s",
                        (MAX_MONTHS,),
                    )
                    rows = [_row_to_dict(rec) for rec in cur.fetchall()]
                except Exception as e:  # noqa: BLE001
                    # テーブル未適用等は [] へ degrade（UI=未連携CTA）。実バグ秘匿を避けログは厚く。
                    print(f"me/cashflow read degraded: {e!r}", file=sys.stderr)
                    rows = []
                return self._json(200, {"cashflow": rows})
        except Exception as e:  # noqa: BLE001
            print(f"me/cashflow do_GET error: {e!r}", file=sys.stderr)
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
