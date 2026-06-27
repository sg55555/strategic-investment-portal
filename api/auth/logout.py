"""POST /api/auth/logout — 現在のセッションを失効させ cookie を消す。"""
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


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        token = _cookie_token(self.headers)
        try:
            if token:
                tok_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
                with _conn() as conn, conn.cursor() as cur:
                    cur.execute("DELETE FROM me.sessions WHERE token = %s", (tok_hash,))
        except Exception:
            pass  # ログアウトは失敗しても cookie 削除で実質ログアウト

        cookie = f"{COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict; Secure"
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", cookie)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode())

    def log_message(self, *args):
        pass
