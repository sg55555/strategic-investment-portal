"""POST /api/auth/login — パスワード照合してセッションを発行する。

body: {"password": "..."} → bcrypt で AUTH_PASSWORD_HASH と照合。
一致したら secrets.token_urlsafe(32) を発行し、cookie には生トークン・DB には sha256(token) を保存。
IP別の短窓失敗数で bcrypt 前に 429（総当たり/コスト増幅対策）。
未設定(AUTH_PASSWORD_HASH 空)は 401 と区別して 503 を返す。
（フロントと同一オリジンなので CORS ヘッダは付けない。cookie は SameSite=Strict/Secure。）
"""
from http.server import BaseHTTPRequestHandler
import hashlib
import json
import os
import secrets
import sys
from datetime import datetime, timedelta, timezone

import bcrypt
import psycopg

COOKIE = "wc_session"
SESSION_DAYS = 30
THROTTLE_WINDOW_MIN = 10   # 直近この分数の
THROTTLE_MAX_FAILS = 8     # 失敗がこの数以上なら 429


def _conn():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set")
    return psycopg.connect(url)


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        try:
            data = json.loads(self.rfile.read(length).decode("utf-8", "replace"))
            password = data.get("password", "") if isinstance(data, dict) else ""
        except Exception:
            password = ""

        pw_hash = os.environ.get("AUTH_PASSWORD_HASH", "")
        if not pw_hash:
            print("login: AUTH_PASSWORD_HASH not set", file=sys.stderr)
            return self._json(503, {"error": "not configured"})

        ip = (self.headers.get("X-Forwarded-For", "") or "").split(",")[0].strip() or "unknown"
        label = (self.headers.get("User-Agent", "") or "")[:200]

        try:
            with _conn() as conn, conn.cursor() as cur:
                # 古い失敗記録を掃除し、直近窓の失敗数でゲート（bcrypt の手前）。
                cur.execute(
                    "DELETE FROM me.login_attempts WHERE ts < now() - make_interval(mins => %s)",
                    (THROTTLE_WINDOW_MIN,),
                )
                cur.execute(
                    "SELECT count(*) FROM me.login_attempts "
                    "WHERE ip = %s AND ts > now() - make_interval(mins => %s)",
                    (ip, THROTTLE_WINDOW_MIN),
                )
                if cur.fetchone()[0] >= THROTTLE_MAX_FAILS:
                    return self._json(429, {"error": "too many attempts"})

                ok = False
                if password:
                    try:
                        ok = bcrypt.checkpw(password.encode("utf-8"), pw_hash.encode("utf-8"))
                    except Exception:
                        ok = False
                if not ok:
                    cur.execute("INSERT INTO me.login_attempts (ip) VALUES (%s)", (ip,))
                    return self._json(401, {"error": "unauthorized"})

                # 成功: 当該IPの失敗をクリア＋期限切れセッション掃除＋新セッション発行。
                token = secrets.token_urlsafe(32)
                tok_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
                expires = datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS)
                cur.execute("DELETE FROM me.login_attempts WHERE ip = %s", (ip,))
                cur.execute("DELETE FROM me.sessions WHERE expires_at < now()")
                cur.execute(
                    "INSERT INTO me.sessions (token, expires_at, label) VALUES (%s, %s, %s)",
                    (tok_hash, expires, label),
                )
        except Exception as e:  # noqa: BLE001
            print(f"login error: {e!r}", file=sys.stderr)
            return self._json(500, {"error": "internal"})

        cookie = (
            f"{COOKIE}={token}; HttpOnly; Path=/; "
            f"Max-Age={SESSION_DAYS * 86400}; SameSite=Strict; Secure"
        )
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", cookie)
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps({"ok": True}).encode())

    def _json(self, status: int, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass
