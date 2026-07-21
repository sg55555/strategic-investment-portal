"""GET /api/auth/session — cookie のセッションが有効か返す（常に 200・body の ok 判定）。"""
from http.server import BaseHTTPRequestHandler
import hashlib
import json
import os

import psycopg

COOKIE = "wc_session"


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


def _hash(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def insight_enabled():
    return os.environ.get("ADVICE_MODE", "production").strip().lower() == "personal"


def nisa_advice_enabled():
    # capability 論理積: personal かつ独立 killswitch ON。既定 off（未設定は off）。
    # insight_enabled() を再利用（personal 判定の単一源＝DRY・fail-closed ゲートの stale 化防止）。
    return insight_enabled() and (
        os.environ.get("NISA_ADVICE_ENABLED", "").strip().lower() in ("1", "true", "on"))


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        token = _cookie_token(self.headers)
        ok = False
        try:
            if token:
                with _conn() as conn, conn.cursor() as cur:
                    cur.execute(
                        "SELECT 1 FROM me.sessions WHERE token = %s AND expires_at > now()",
                        (_hash(token),),
                    )
                    ok = cur.fetchone() is not None
        except Exception:
            ok = False
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(
            {"ok": ok, "insightEnabled": insight_enabled(), "nisaAdviceEnabled": nisa_advice_enabled()}
        ).encode())

    def log_message(self, *args):
        pass
