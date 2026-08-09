#!/usr/bin/env python3
"""テーマCSS注入プロキシ（mock_prod_server.py のラッパ・リポ無改変）。

リポ /home/shugo/apps/investment-portal/scratchpad/mock_prod_server.py を import で流用し、
実 index.html＋/api/market/*（実財務 SQLite data/investment.db）をそのまま配信しつつ、
THEME_CSS で指定した CSS ファイルの内容を
  - index.html … </head> 直前に <style>…</style> として挿入
  - money.css  … ファイル末尾に連結
して返す。THEME_CSS が空/未指定なら完全素通し（現行テーマ確認用）。

受け取り（引数が環境変数より優先）:
  PORT      … 環境変数 PORT または --port（既定 8228）
  THEME_CSS … 環境変数 THEME_CSS または --theme-css（CSSファイルパス）

例:
  THEME_CSS=/path/to/theme.css PORT=8229 python3 theme-proxy.py
  python3 theme-proxy.py --port 8229 --theme-css /path/to/theme.css
  python3 theme-proxy.py --port 8229            # 素通し（現行テーマ）

注入 CSS は毎リクエストでディスクから読む＝編集が即反映（mock 本体と同じ思想）。
"""
import argparse
import os
import sys

_MOCK_DIR = "/home/shugo/apps/investment-portal/scratchpad"
sys.path.insert(0, _MOCK_DIR)
import mock_prod_server as mps  # noqa: E402  (リポは読み取りのみ・無改変)

_THEME_CSS_PATH = ""  # main() で確定。空なら素通し。


def _theme_bytes() -> bytes:
    """毎リクエストで THEME_CSS を読む（編集即反映）。空/読めない場合は b"" ＝素通し。"""
    if not _THEME_CSS_PATH:
        return b""
    try:
        with open(_THEME_CSS_PATH, "rb") as f:
            return f.read()
    except OSError as e:
        print(f"[theme-proxy] warn: THEME_CSS 読み込み失敗: {e}", file=sys.stderr)
        return b""


class ThemeHandler(mps.Handler):
    """mock_prod_server.Handler の静的ファイル送出だけ注入付きに差し替える。

    _handle_static / _handle_api / パストラバーサル防御などは親をそのまま流用。
    """

    def _send_file(self, abs_path: str, ctype: str):  # override
        with open(abs_path, "rb") as f:  # 毎リクエストでディスクから読む（親と同じ）
            body = f.read()

        css = _theme_bytes()
        if css:
            name = os.path.basename(abs_path)
            if name == "index.html":
                # </head> 直前に <style>…</style> を挿入（既存 CSS より後＝上書き優先）。
                marker = b"</head>"
                idx = body.find(marker)
                if idx != -1:
                    inject = (
                        b"<style data-theme-proxy=\"1\">\n" + css + b"\n</style>\n"
                    )
                    body = body[:idx] + inject + body[idx:]
            elif name == "money.css":
                # ファイル末尾に連結（後勝ちカスケードで上書き）。
                body = body + b"\n\n/* === theme-proxy injected === */\n" + css + b"\n"

        self._send_bytes(200, body, ctype)


def main():
    ap = argparse.ArgumentParser(description="テーマCSS注入プロキシ（mock_prod_server ラッパ）")
    ap.add_argument("--port", type=int, default=None, help="待受ポート（env PORT より優先・既定 8228）")
    ap.add_argument("--theme-css", default=None, help="注入する CSS ファイルパス（env THEME_CSS より優先・省略で素通し）")
    args = ap.parse_args()

    global _THEME_CSS_PATH
    port = args.port if args.port is not None else int(os.environ.get("PORT") or 8228)
    _THEME_CSS_PATH = (args.theme_css if args.theme_css is not None
                       else os.environ.get("THEME_CSS") or "").strip()

    if _THEME_CSS_PATH and not os.path.isfile(_THEME_CSS_PATH):
        print(f"[theme-proxy] error: THEME_CSS が見つかりません: {_THEME_CSS_PATH}", file=sys.stderr)
        sys.exit(1)

    mode = f"inject: {_THEME_CSS_PATH}" if _THEME_CSS_PATH else "pass-through（素通し）"
    print(f"[theme-proxy] http://127.0.0.1:{port}  ({mode})", flush=True)

    server = mps.ThreadingHTTPServer(("127.0.0.1", port), ThemeHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
