#!/usr/bin/env python3
"""W2「詳細の時間軸パック」案の実物比較モック鯖（実アプリのシェル上で A/B/C を見比べる）。

    .venv/bin/python scratchpad/w2-mock-server.py      # → http://127.0.0.1:8220/
    （W2_PORT で上書き可。例: W2_PORT=8221 .venv/bin/python scratchpad/w2-mock-server.py）

仕組み（リポの index.html は**一切改変しない**。serve 時にメモリ上でパッチする）:
  1. </body> の直前に <script src="/scratchpad/w2-variants.js"></script> を差し込む。
     w15 のような filterAndRenderPortal フック注入は W2 では使わない（不要）。
  2. /api/* は GET に限り本番（https://strategic-investment-portal.vercel.app）へそのまま
     プロキシする。W1.5 と違いローカル dump への差し替えは行わない＝5Y/MAX の長期履歴や
     52週レンジの実 px など、期間切替の検証に要る実データをそのまま使うため。
     プロキシは読み取り専用（GET のみ）＝本番へ書き込む経路は無い。POST 等は 405 で拒否する。
  3. 本番 API はどれも公開の市場データ（銘柄一覧・詳細）であり、認証や本人専用のお金の
     司令室データには一切触れない（Cookie 等の認証情報も転送しない）。
  4. index.html / *.js / *.css / manifest.json などリポ直下の静的ファイルと、
     scratchpad/*.js（w2-variants.js 含む）を配信する。パストラバーサル（..）は
     解決後の絶対パスが ROOT 配下か検査して弾く。

w15 の w15-mock-server.py と同型（詳細は scratchpad/w15-mock-server.py 参照）。
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import json
import os
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
PROD = "https://strategic-investment-portal.vercel.app"
PORT = int(os.environ.get("W2_PORT", "8220"))

_CT = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
       ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
       ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
       ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8"}

ANCHOR_SCRIPT = "  </body>"
SCRIPT_TAG = '    <script src="/scratchpad/w2-variants.js"></script>\n  </body>'


def patched_index() -> bytes:
    """本実装の index.html に </body> 直前の <script> 注入だけ行って返す（それ以外は無改変）。"""
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        html = f.read()
    if html.count(ANCHOR_SCRIPT) != 1:
        raise SystemExit(f"[w2-mock] アンカー </body> が {html.count(ANCHOR_SCRIPT)} 箇所（1でない）＝注入中止")
    html = html.replace(ANCHOR_SCRIPT, SCRIPT_TAG, 1)
    return html.encode("utf-8")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path in ("/", "/index.html", "/index"):
                return self._send(200, patched_index(), _CT[".html"])
            if path.startswith("/api/"):
                return self._proxy()
            return self._file(os.path.join(ROOT, path.lstrip("/")))
        except FileNotFoundError:
            self._send(404, b"not found", "text/plain")
        except Exception as e:  # noqa: BLE001
            self._send(500, str(e).encode(), "text/plain")

    def _reject_write(self):
        """GET 以外は全て 405（/api/* への書き込みを防ぐ安全側の既定。本番へは何も書かない）。"""
        self._send(405, b'{"ok":false,"error":"mock server: read-only (GET only)"}', _CT[".json"])

    do_POST = do_PUT = do_DELETE = do_PATCH = _reject_write

    def _proxy(self):
        """本番へ GET のみプロキシ（読み取り専用・認証情報は転送しない）。"""
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


if __name__ == "__main__":
    patched_index()   # 起動時にアンカー健全性を検査（壊れていたらここで落ちる）
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    print(f"[w2-mock] http://127.0.0.1:{PORT}/ を開いてください（?v=a|b|c で案を切替 / proxy={PROD}）")
    srv.serve_forever()
