#!/usr/bin/env python3
"""W1「ポータル一目パック」本実装スモーク用モック鯖。

    .venv/bin/python scratchpad/w1-mock-server.py      # → http://127.0.0.1:8210/

仕組み（リポの index.html は無改変。serve 時の差し替えは /api/market/list のみ）:
  - /api/market/list は scratchpad/w1-mock-data.json（Neon 実データの dump・px 込み）を返す。
  - それ以外の /api/* GET は本番へそのままプロキシ（詳細ビューも実データで開ける）。

⚠ モック3案（案①②③の実物比較）用だった IIFE フック注入（HOOKS）と
  </body> 直前の w1-variants.js <script> 注入は本実装スモークでは不要（本実装コードは
  index.html にそのまま組み込み済み・px は dump JSON 側にすでに乗っている）ため撤去済み。
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DATA = os.path.join(ROOT, "scratchpad", "w1-mock-data.json")
PROD = "https://strategic-investment-portal.vercel.app"
PORT = int(os.environ.get("W1_PORT", "8210"))

_CT = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
       ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
       ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
       ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8"}

def patched_index() -> bytes:
    """index.html は無改変でそのまま返す（/api/market/list の差し替えだけで本実装コードが動く）。"""
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        return f.read().encode("utf-8")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path in ("/", "/index.html", "/index"):
                return self._send(200, patched_index(), _CT[".html"])
            if path == "/api/market/list":
                with open(DATA, "rb") as f:
                    return self._send(200, f.read(), _CT[".json"])
            if path.startswith("/api/"):
                return self._proxy()
            if path in ("/w1-variants.js", "/w1-mock-data.json"):
                return self._file(os.path.join(ROOT, "scratchpad", path.lstrip("/")))
            return self._file(os.path.join(ROOT, path.lstrip("/")))
        except FileNotFoundError:
            self._send(404, b"not found", "text/plain")
        except Exception as e:  # noqa: BLE001
            self._send(500, str(e).encode(), "text/plain")

    def do_POST(self):  # noqa: N802
        # 認証(POST /api/auth/login)等はモックでは扱わない（司令室は未ログイン表示のままで良い）
        self._send(501, b'{"ok":false,"error":"mock server: POST not supported"}', _CT[".json"])

    def _proxy(self):
        req = urllib.request.Request(PROD + self.path, headers={"Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read()
                ctype = r.headers.get("Content-Type", _CT[".json"])
            self._send(200, body, ctype)
        except Exception as e:  # noqa: BLE001
            self._send(502, json.dumps({"error": f"proxy: {e}"}).encode(), _CT[".json"])

    def _file(self, abs_path):
        abs_path = os.path.abspath(abs_path)
        if not abs_path.startswith(ROOT) or not os.path.isfile(abs_path):
            raise FileNotFoundError(abs_path)
        with open(abs_path, "rb") as f:
            body = f.read()
        self._send(200, body, _CT.get(os.path.splitext(abs_path)[1], "application/octet-stream"))

    def _send(self, status, body, ctype):
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):  # 静音
        pass


def main():
    if not os.path.isfile(DATA):
        raise SystemExit("scratchpad/w1-mock-data.json がありません → 先に w1-dump.py を実行")
    patched_index()  # 起動時に index.html が読めるか検査（失敗なら即終了）
    # ⚠ bind してから print する。先に print すると、他 worktree の古いモック鯖が同じポートを
    #    握っていても「起動した」ように見え、別ツリーの index.html を検証してしまう。
    try:
        srv = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    except OSError as e:
        raise SystemExit(f"[w1-mock] ポート {PORT} を bind できません（別プロセスが使用中？）: {e}") from e
    print(f"[w1-mock] http://127.0.0.1:{PORT}/  （Ctrl+C で停止・cwd={ROOT}）")
    srv.serve_forever()


if __name__ == "__main__":
    sys.exit(main())
