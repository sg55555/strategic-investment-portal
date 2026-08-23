#!/usr/bin/env python3
"""W1「ポータル一目パック」モック鯖（実アプリのシェル上で案①②③を実物比較する）。

    .venv/bin/python scratchpad/w1-mock-server.py      # → http://127.0.0.1:8210/

仕組み（リポの index.html は**一切改変しない**。serve 時にメモリ上でパッチする）:
  1. IIFE 末尾に「フック」を注入 → _makePortalRow / _makePortalSection / filterAndRenderPortal を
     window.__W1.* から差し替え可能にする（本体は無改変・モック時だけ挙動が変わる）。
  2. item 構築の直後に decorate フックを注入 → item に px（前日比等）を合流させ、既存の setSort が
     価格列でもそのまま効くようにする。
  3. </body> 直前に scratchpad/w1-variants.js を読み込む <script> を追加。
  4. /api/market/list は scratchpad/w1-mock-data.json（Neon 実データの dump）を返す。
     それ以外の /api/* GET は本番へそのままプロキシ（詳細ビューも実データで開ける）。
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

# ── 注入するフック（IIFE 内・Object.assign(window,…) の直前に置く） ──
HOOKS = r"""
      /* === W1 モック専用フック（scratchpad/w1-mock-server.py が serve 時に注入。リポの index.html は無改変） === */
      var __w1_origRow = _makePortalRow, __w1_origSection = _makePortalSection, __w1_origFilter = filterAndRenderPortal;
      _makePortalRow = function (item) { var h = window.__W1 && window.__W1.row; return h ? h(item, __w1_origRow) : __w1_origRow(item); };
      _makePortalSection = function (ind, count) { var h = window.__W1 && window.__W1.section; return h ? h(ind, count, __w1_origSection) : __w1_origSection(ind, count); };
      filterAndRenderPortal = function () { __w1_origFilter(); var h = window.__W1 && window.__W1.afterRender; if (h) h(); };
      window.__w1host = {
        rerender: function () { filterAndRenderPortal(); },
        setSector: function (s) { setSectorFilter(s); },
        sortState: function () { return { key: sortKey, asc: sortAsc }; },
        setSort: function (k) { setSort(k); },
      };
"""

ANCHOR_HOOKS = "      Object.assign(window, {"
ANCHOR_DECORATE = "          if (!ScreenerRules.passesScreening(item, screeningCriteria)) continue;"
DECORATE = ("          if (window.__W1 && window.__W1.decorate) window.__W1.decorate(item, company);\n"
            + ANCHOR_DECORATE)
ANCHOR_SCRIPT = "  </body>"
SCRIPT_TAG = '    <script src="/w1-variants.js"></script>\n  </body>'


def patched_index() -> bytes:
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        html = f.read()
    for anchor, repl, label in (
        (ANCHOR_HOOKS, HOOKS + ANCHOR_HOOKS, "hooks"),
        (ANCHOR_DECORATE, DECORATE, "decorate"),
        (ANCHOR_SCRIPT, SCRIPT_TAG, "script"),
    ):
        if html.count(anchor) != 1:
            raise SystemExit(f"[w1-mock] アンカー {label} が {html.count(anchor)} 箇所（1でない）＝注入中止")
        html = html.replace(anchor, repl, 1)
    return html.encode("utf-8")


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
    patched_index()  # 起動時にアンカー健全性を検査（失敗なら即終了）
    print(f"[w1-mock] http://127.0.0.1:{PORT}/  （Ctrl+C で停止）")
    ThreadingHTTPServer(("127.0.0.1", PORT), handler).serve_forever()


if __name__ == "__main__":
    sys.exit(main())
