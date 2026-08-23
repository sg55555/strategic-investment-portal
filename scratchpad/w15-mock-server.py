#!/usr/bin/env python3
"""W1.5「セクターヒートマップ」案の実物比較モック鯖（実アプリのシェル上で A/B/C を見比べる）。

    .venv/bin/python scratchpad/w15-mock-server.py      # → http://127.0.0.1:8215/

仕組み（リポの index.html は**一切改変しない**。serve 時にメモリ上でパッチする）:
  1. IIFE 末尾（Object.assign(window,…) の直前）にフックを注入 → filterAndRenderPortal の後で
     window.__W15.afterRender(lastPortalList) を呼ぶ＝表と同じ母集合をモックへ渡す。
  2. </body> 直前に scratchpad/w15-variants.js を読み込む <script> を追加。
  3. /api/market/list は scratchpad/w1-mock-data.json（Neon 実データ dump・292銘柄・px 込み）を返す。
     それ以外の /api/* GET は本番へそのままプロキシ（詳細ビューも実データで開ける）。
  4. dump は market_asof 実装前に採取された世代のため market_asof を持たない。dump 自体は改変せず
     （実データ記録として不変）、レスポンス生成時だけ api/market/list.py の _market_of/_market_asof と
     同じ規則で合成して差し込む（Task 4 レビュー Ruling 4）。

W1 の w1-mock-server.py と同型（そちらは本実装スモーク用にフック撤去済みのため別ファイルにした）。
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
import json
import os
import sys
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
# W15_DATA で差し替え可能（既定は W1 dump と同じ実データ）。相対パスは ROOT 起点。
# ⚠ レスポンスはモジュール変数にキャッシュする（market_list_body）ため、差し替えは鯖の再起動が要る。
DATA = os.path.abspath(os.path.join(ROOT, os.environ.get("W15_DATA", os.path.join("scratchpad", "w1-mock-data.json"))))
PROD = "https://strategic-investment-portal.vercel.app"
PORT = int(os.environ.get("W15_PORT", "8215"))


def _market_of(ticker, entry):
    """api/market/list.py の _market_of と同一規則（country 優先・末尾 .T で JP）。"""
    country = (entry or {}).get("country")
    if country:
        return country
    return "JP" if str(ticker).endswith(".T") else "US"


def _market_asof(stocks):
    """api/market/list.py の _market_asof と同一規則。市場ごとの最新終値日（ISO文字列の辞書順=日付順で最大）。"""
    asof = {}
    for ticker, entry in (stocks or {}).items():
        px = (entry or {}).get("px")
        date = (px or {}).get("date")
        if not date:
            continue
        market = _market_of(ticker, entry)
        if date > asof.get(market, ""):
            asof[market] = date
    return asof


_market_list_cache = None


def market_list_body() -> bytes:
    """DATA を読み、market_asof が無い/空なら本番と同じ規則で合成して差し込む（dump 自体は無改変）。"""
    global _market_list_cache
    if _market_list_cache is not None:
        return _market_list_cache
    with open(DATA, encoding="utf-8") as f:
        raw = json.load(f)
    if not raw.get("market_asof"):
        raw["market_asof"] = _market_asof(raw.get("stocks"))
        print(f"[w15-mock] dump に market_asof が無いため合成: {raw['market_asof']}")
    _market_list_cache = json.dumps(raw).encode("utf-8")
    return _market_list_cache


_CT = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
       ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
       ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon",
       ".webmanifest": "application/manifest+json", ".txt": "text/plain; charset=utf-8"}

# ── 注入するフック（IIFE 内・Object.assign(window,…) の直前に置く） ──
HOOKS = r"""
      /* === W1.5 モック専用フック（scratchpad/w15-mock-server.py が serve 時に注入・リポは無改変） === */
      var __w15_origFilter = filterAndRenderPortal;
      filterAndRenderPortal = function () {
        __w15_origFilter();
        var h = window.__W15 && window.__W15.afterRender;
        if (h) h(lastPortalList || []);
      };
      window.__w15host = {
        rerender: function () { filterAndRenderPortal(); },
        setSector: function (s) { setSectorFilter(s); },
        list: function () { return lastPortalList || []; },
      };
"""

ANCHOR_HOOKS = "      Object.assign(window, {"
ANCHOR_SCRIPT = "  </body>"
SCRIPT_TAG = '    <script src="/w15-variants.js"></script>\n  </body>'


def patched_index() -> bytes:
    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        html = f.read()
    for anchor, repl, label in (
        (ANCHOR_HOOKS, HOOKS + ANCHOR_HOOKS, "hooks"),
        (ANCHOR_SCRIPT, SCRIPT_TAG, "script"),
    ):
        if html.count(anchor) != 1:
            raise SystemExit(f"[w15-mock] アンカー {label} が {html.count(anchor)} 箇所（1でない）＝注入中止")
        html = html.replace(anchor, repl, 1)
    return html.encode("utf-8")


class handler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        path = urlparse(self.path).path
        try:
            if path in ("/", "/index.html", "/index"):
                return self._send(200, patched_index(), _CT[".html"])
            if path == "/api/market/list":
                return self._send(200, market_list_body(), _CT[".json"])
            if path.startswith("/api/"):
                return self._proxy()
            if path in ("/w15-variants.js", "/w1-mock-data.json"):
                return self._file(os.path.join(ROOT, "scratchpad", path.lstrip("/")))
            return self._file(os.path.join(ROOT, path.lstrip("/")))
        except FileNotFoundError:
            self._send(404, b"not found", "text/plain")
        except Exception as e:  # noqa: BLE001
            self._send(500, str(e).encode(), "text/plain")

    def do_POST(self):  # noqa: N802
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


if __name__ == "__main__":
    if not os.path.isfile(DATA):
        sys.exit(f"[w15-mock] {DATA} が無い（scratchpad/w1-dump.py で作る）")
    patched_index()   # 起動時にアンカー健全性を検査（壊れていたらここで落ちる）
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    print(f"[w15-mock] http://127.0.0.1:{PORT}/  (data={os.path.basename(DATA)} / proxy={PROD})")
    srv.serve_forever()
