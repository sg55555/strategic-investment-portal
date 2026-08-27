#!/usr/bin/env python3
# scratchpad/w3-mock-server.py — W3「司令室PFMパック」モック比較用サーバ（Python3 標準ライブラリのみ）。
#
# 使い方（この1行で1コマンド）:
#   python3 scratchpad/w3-mock-server.py --port 8240
#
# 何をするか:
#   ① リポ root（このワークツリー）を静的配信する。実 index.html / money.js / money-rules.js / money.css は
#      1バイトも改変しない（本番と同じコードパスを通す）。
#   ② `/` と `/index.html` だけは、`</body>` の直前に
#      `<script src="/scratchpad/w3-variants.js"></script>` を注入して返す（他は無改変）。
#   ③ 司令室が叩く API を JSON でモックする（合成データ・本人の実データは一切含まない）。
#
# 検証 URL:
#   http://127.0.0.1:8240/?w3variant=A      （B / C も同様）
#   http://127.0.0.1:8240/?w3variant=A&w3now=2026-11-15   （リマインド帯の warn を再現）

import argparse
import json
import os
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INJECT_TAG = '<script src="/scratchpad/w3-variants.js"></script>'

# --------------------------------------------------------------------------------------
# フィクスチャ（すべて合成・決定論）。本人の実データは一切使わない。
# --------------------------------------------------------------------------------------
ANCHOR_DATE = "2025-09-01"
ANCHOR_AMOUNT = 1450000
CORE_AMOUNT = 600000
SAT_AMOUNT = 0
MONTHLY_EXPENSE = 220000
BUFFER_MONTHS = 6

FIRST_YM = (2024, 3)
LAST_YM = (2026, 8)          # 当月（is_complete=False の部分月）
PARTIAL_PERIOD = "2026-08-01"

# money-rules.js の CURRENT_VERSION（v2: goals＋クラウド同期）
STATE_VERSION = 2


def _lcg(seed):
    """決定論の簡易 LCG（seed 固定＝毎回同じ数字が出る）。"""
    st = {"v": seed}

    def nxt(mod):
        st["v"] = (st["v"] * 1103515245 + 12345) & 0x7FFFFFFF
        return st["v"] % mod
    return nxt


def _months(a, b):
    y, m = a
    out = []
    while (y, m) <= b:
        out.append((y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1
    return out


def build_cashflow_rows(pulled_at):
    rnd = _lcg(20260827)
    rows = []
    for (y, m) in _months(FIRST_YM, LAST_YM):
        period = "%04d-%02d-01" % (y, m)
        partial = (period == PARTIAL_PERIOD)

        salary = 330000 + rnd(5) * 5000              # 330,000 〜 350,000
        misc = 200000 if m in (6, 12) else 0         # 6月/12月＝賞与
        fixed = 140000
        variable = 90000 + rnd(15) * 5000            # 90,000 〜 160,000

        # 赤字月を2つ仕込む（グラフが単調増加にならない＝形の検証になる）。
        if period == "2025-03-01":
            variable = 380000                        # アンカーより前（後方逆算側の谷）
        elif period == "2026-02-01":
            variable = 420000                        # アンカーより後（前方累積側の谷）

        if partial:
            # 当月＝月半ばの部分集計。収支は小さめ（確定値と参考値が食い違う状態を作る）。
            salary, misc, fixed, variable = 340000, 0, 140000, 175000

        total_income = salary + misc
        total_expense = fixed + variable
        balance = total_income - total_expense
        savings_rate = round(balance / total_income * 100, 1) if total_income else 0.0

        # 変動費の内訳（合計＝variable）。
        food = int(variable * 0.45)
        daily = int(variable * 0.25)
        social = variable - food - daily
        rows.append({
            "period": period,
            "total_income": total_income,
            "salary_income": salary,
            "misc_income": misc,
            "fixed_expense": fixed,
            "variable_expense": variable,
            "total_expense": total_expense,
            "balance": balance,
            "savings_rate": savings_rate,
            "is_complete": not partial,
            "breakdown": {"categories": [
                {"name": "食費", "amount": food},
                {"name": "日用品", "amount": daily},
                {"name": "交際費", "amount": social},
            ]},
            "pulled_at": pulled_at,
        })
    return rows


def build_state():
    return {
        "version": STATE_VERSION,
        "currency": "JPY",
        "monthlyExpense": MONTHLY_EXPENSE,
        "bufferMonths": BUFFER_MONTHS,
        "buckets": {
            "buffer": {"amount": 0},          # anchor 連動で実効値に差し替わる（保存値は使われない）
            "core": {"amount": CORE_AMOUNT},
            "satellite": {"amount": SAT_AMOUNT},
        },
        "satelliteCapPct": 10,
        "anchor": {"date": ANCHOR_DATE, "amount": ANCHOR_AMOUNT},
        "goals": [
            {"id": "goal-house", "label": "住宅の頭金", "targetAmount": 5000000, "deadline": "2028-03-31"},
            {"id": "goal-3m", "label": "総資産300万", "targetAmount": 3000000, "deadline": ""},
        ],
        "reserves": [
            {"id": "rsv-shaken", "label": "車検・保険", "target": 300000, "saved": 120000,
             "deadline": "2026-11-30", "monthlyOverride": 0},
            {"id": "rsv-hikkoshi", "label": "引越し予備", "target": 200000, "saved": 200000,
             "deadline": "", "monthlyOverride": 0},
        ],
        "lastAppliedCashflowPeriod": "",
        "cashSource": "anchor",
        "investmentSource": "manual",
        "assetSource": "manual",
        "birthYear": 1994,
        "assetHoldings": {
            "buffer": {"cash": 0, "jpEq": 0, "devEq": 0, "emEq": 0, "bond": 0, "reit": 0, "gold": 0},
            "core": {"cash": 0, "jpEq": 90000, "devEq": 360000, "emEq": 90000, "bond": 0, "reit": 60000, "gold": 0},
            "satellite": {"cash": 0, "jpEq": 0, "devEq": 0, "emEq": 0, "bond": 0, "reit": 0, "gold": 0},
        },
        # normalizeNisa の固定形状（manual／2026年 つみたて 300,000・成長 0・生涯 300,000）
        "nisa": {
            "source": "manual",
            "anchorYear": 2026,
            "tsumitateThisYear": 300000,
            "growthThisYear": 0,
            "tsumitateLifetime": 300000,
            "growthLifetime": 0,
            "soldThisYearAtCost": 0,
            "history": [],
        },
        "history": [],
        "updatedAt": 2000000000000,   # 2033年＝ローカル既定(0)より必ず新しい→reconcile で cloud 採用
    }


PULLED_AT = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
FIXTURE_STATE = build_state()
CASHFLOW_ROWS = build_cashflow_rows(PULLED_AT)


def derived_summary():
    """起動時に出す整合チェック用の要約（ヒーローの『確定額』と一致するはずの数）。"""
    anchor_ym = ANCHOR_DATE[:7]
    total = 0
    covered = 0
    for r in CASHFLOW_ROWS:
        if r["period"][:7] < anchor_ym:
            continue
        if r["is_complete"]:
            total += r["balance"]
            covered += 1
    cash = ANCHOR_AMOUNT + total
    return {
        "derivedCash": cash,
        "monthsCovered": covered,
        "totalAssets": cash + CORE_AMOUNT + SAT_AMOUNT,
        "rows": len(CASHFLOW_ROWS),
    }


# --------------------------------------------------------------------------------------
# HTTP ハンドラ
# --------------------------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    quiet = True

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    # ---- helpers ----
    def _json(self, body, status=200):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _drain_body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 0:
            self.rfile.read(n)

    def _send_index(self):
        with open(os.path.join(ROOT, "index.html"), "rb") as f:
            html = f.read().decode("utf-8")
        # W3_VARIANTS=0 なら比較用オーバーレイ（w3-variants.js）を注入しない＝本実装の money.js だけを検証する（受入用）。
        if os.environ.get("W3_VARIANTS", "1") != "0":
            i = html.rfind("</body>")
            html = (html[:i] + "  " + INJECT_TAG + "\n" + html[i:]) if i >= 0 else (html + INJECT_TAG)
        raw = html.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _api(self, method, path):
        """API モック。処理したら True。"""
        if not path.startswith("/api/"):
            return False
        if path.startswith("/api/market/"):
            self._drain_body()
            self._json({"stocks": {}, "updated_at": ""})
            return True
        if path == "/api/auth/session" and method == "GET":
            self._json({"ok": True, "insightEnabled": False, "nisaAdviceEnabled": False})
            return True
        if path == "/api/auth/login" and method == "POST":
            self._drain_body()
            self._json({"ok": True})
            return True
        if path == "/api/auth/logout" and method == "POST":
            self._drain_body()
            self._json({"ok": True})
            return True
        if path == "/api/me/state":
            if method == "GET":
                self._json({"state": FIXTURE_STATE})
                return True
            if method in ("PUT", "POST"):
                self._drain_body()
                self._json({"ok": True})
                return True
        if path == "/api/me/cashflow" and method == "GET":
            self._json({"cashflow": CASHFLOW_ROWS})
            return True
        if path == "/api/me/investment" and method == "GET":
            self._json({"investment": []})
            return True
        # AI 系（advice / insight / nisa-advice …）はモックでは常に無効。
        self._drain_body()
        self._json({"error": "disabled"}, status=503)
        return True

    # ---- verbs ----
    def do_GET(self):
        path = urlparse(self.path).path
        if self._api("GET", path):
            return
        if path in ("/", "/index.html"):
            self._send_index()
            return
        if path == "/_vercel/insights/script.js":
            # 本番だけに存在する計測スクリプト。ローカルでは 404 になり console に無関係な赤が出るので空で返す。
            raw = b"/* w3 mock: no-op */\n"
            self.send_response(200)
            self.send_header("Content-Type", "text/javascript; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        super().do_GET()

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            return
        super().do_HEAD()

    def do_POST(self):
        self._api("POST", urlparse(self.path).path)

    def do_PUT(self):
        self._api("PUT", urlparse(self.path).path)

    def log_message(self, fmt, *args):
        if not Handler.quiet:
            super().log_message(fmt, *args)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8240)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    Handler.quiet = not args.verbose

    d = derived_summary()
    print("W3 mock server  http://127.0.0.1:%d/?w3variant=A" % args.port, flush=True)
    print("  root      : %s" % ROOT, flush=True)
    print("  cashflow  : %d rows (%s .. %s / partial=%s)"
          % (d["rows"], CASHFLOW_ROWS[0]["period"], CASHFLOW_ROWS[-1]["period"], PARTIAL_PERIOD), flush=True)
    print("  anchor    : %s Y%s  / 確定%dヶ月" % (ANCHOR_DATE, format(ANCHOR_AMOUNT, ","), d["monthsCovered"]), flush=True)
    print("  derivedCash(ヒーロー確定額) = Y%s   totalAssets = Y%s"
          % (format(d["derivedCash"], ","), format(d["totalAssets"], ",")), flush=True)

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
