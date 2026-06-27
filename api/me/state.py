"""GET/PUT /api/me/state — 司令室 state（mcc_state JSON）の読み書き。認証必須。

GET → {"state": {...}} または {"state": null}（未保存）
PUT body {"state": {...}} → me.mcc_state(id=1) に UPSERT → {"ok": true}
セッション無効は 401。フロントと同一オリジンなので CORS ヘッダは付けない。
"""
from http.server import BaseHTTPRequestHandler
import hashlib
import json
import os
import sys

import psycopg
from psycopg.types.json import Jsonb

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


def _valid_session(cur, token) -> bool:
    if not token:
        return False
    cur.execute(
        "SELECT 1 FROM me.sessions WHERE token = %s AND expires_at > now()",
        (hashlib.sha256(token.encode("utf-8")).hexdigest(),),
    )
    return cur.fetchone() is not None


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        token = _cookie_token(self.headers)
        try:
            with _conn() as conn, conn.cursor() as cur:
                if not _valid_session(cur, token):
                    return self._json(401, {"error": "unauthorized"})
                cur.execute("SELECT state FROM me.mcc_state WHERE id = 1")
                row = cur.fetchone()
                return self._json(200, {"state": row[0] if row else None})
        except Exception as e:  # noqa: BLE001
            print(f"me/state do_GET error: {e!r}", file=sys.stderr)
            return self._json(500, {"error": "internal"})

    def do_PUT(self):
        token = _cookie_token(self.headers)
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8", "replace"))
            state = body.get("state") if isinstance(body, dict) else None
        except Exception:
            return self._json(400, {"error": "bad json"})
        if not isinstance(state, dict):
            return self._json(400, {"error": "state must be object"})
        try:
            with _conn() as conn, conn.cursor() as cur:
                if not _valid_session(cur, token):
                    return self._json(401, {"error": "unauthorized"})
                cur.execute(
                    "INSERT INTO me.mcc_state (id, state, updated_at) "
                    "VALUES (1, %s, now()) "
                    "ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()",
                    (Jsonb(state),),
                )
            return self._json(200, {"ok": True})
        except Exception as e:  # noqa: BLE001
            print(f"me/state do_PUT error: {e!r}", file=sys.stderr)
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
