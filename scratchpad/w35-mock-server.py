#!/usr/bin/env python3
# scratchpad/w35-mock-server.py — W3.5「月次パック」モック比較用サーバ（Python3 標準ライブラリのみ）。
#
# 使い方（この1行で1コマンド）:
#   python3 scratchpad/w35-mock-server.py --port 8250
#
# 何をするか（w3-mock-server.py と同型）:
#   ① リポ root（このワークツリー）を静的配信する。実 index.html / money.js / money-rules.js / money.css は
#      1バイトも改変しない（本番と同じコードパスを通す）。
#   ② `/` と `/index.html` だけは、`</body>` の直前に
#      `<script src="/scratchpad/w35-variants.js"></script>` を注入して返す（他は無改変）。
#   ③ 司令室が叩く API を JSON でモックする（合成データ・本人の実データは一切含まない）。
#
# W3 fixture との差分:
#   - breakdown.categories を 12費目に拡張（固定費4＋変動費9のうち固定費側の合計＝fixed_expense、
#     変動費側の合計＝variable_expense。最後の1費目「書籍・教育」で帳尻を合わせる）。
#   - state に `budgets`（月の支出予算・合計＋費目）を追加（本実装の migrate にはまだ無い＝
#     オーバーレイが /api/me/state を自分で読む前提のダミー）。
#   - 進行中月 2026-08 は「2026-08-29（月の 94% 経過）」で見て 外食費=超過 / 食費=watch になる値。
#   - 直近の確定月 2026-07 は支出合計が予算 260,000 をわずかに超過（266,000）。
#
# 検証 URL:
#   http://127.0.0.1:8250/?w35variant=A&w35now=2026-08-29      （B / C も同様）

import argparse
import json
import os
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
INJECT_TAG = '<script src="/scratchpad/w35-variants.js"></script>'

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
JULY_PERIOD = "2026-07-01"   # 直近の確定月（支出合計を予算 260,000 のわずか超過に固定）
JULY_TOTAL_EXPENSE = 266000

# money-rules.js の CURRENT_VERSION（v2: goals＋クラウド同期）
STATE_VERSION = 2

# 月の支出予算（W3.5 で新設する state キー。合計と費目の2階建て）。
# 「旧・雑貨」＝直近12ヶ月に実績が出ない費目（設定カードの末尾行「直近12ヶ月に実績なし」の検証用）。
BUDGETS = {
    "total": 260000,
    "items": [
        {"name": "食費", "amount": 45000},
        {"name": "外食費", "amount": 20000},
        {"name": "日用品・雑貨", "amount": 12000},
        {"name": "光熱費", "amount": 15000},
        {"name": "通信・デジタル", "amount": 9000},
        {"name": "サブスク・娯楽", "amount": 8000},
        {"name": "交通費", "amount": 10000},
        {"name": "賃貸費用", "amount": 85000},
        {"name": "旧・雑貨", "amount": 3000},
    ],
}

# 固定費の内訳（賃貸費用・保険は定額、通信/サブスクは月ごとに小さく揺らす）。
FIXED_RENT = 85000
FIXED_INSURANCE = 12000

# 変動費の内訳。最後の「書籍・教育」は帳尻合わせ（variable − 上8費目の合計）。
VAR_CATS = [
    ("食費", 0.33),
    ("外食費", 0.15),
    ("日用品・雑貨", 0.08),
    ("光熱費", 0.10),
    ("交通費", 0.07),
    ("車・ガソリン", 0.09),
    ("医療・健康・美容", 0.05),
    ("衣服", 0.07),
]
VAR_TAIL = "書籍・教育"

# 進行中月（2026-08）の内訳。合計 fixed=114,000 / variable=127,300 / total=241,300。
# 2026-08-29（29/31＝月の 94% 経過）で見て：外食費 24,500/20,000＝超過、食費 41,600/45,000＝92%（watch）、
# 予算のない費目（車・ガソリン/医療・健康・美容/衣服/書籍・教育/保険）にも実績あり。
PARTIAL_FIXED = [
    ("賃貸費用", 85000),
    ("保険", 12000),
    ("通信・デジタル", 9000),
    ("サブスク・娯楽", 8000),
]
PARTIAL_VAR = [
    ("食費", 41600),
    ("外食費", 24500),
    ("日用品・雑貨", 9800),
    ("光熱費", 13200),
    ("交通費", 8300),
    ("車・ガソリン", 12000),
    ("医療・健康・美容", 6400),
    ("衣服", 8900),
    ("書籍・教育", 2600),
]


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


def _split_variable(variable, rnd):
    """変動費を9費目へ決定論分解（合計は必ず variable と一致）。"""
    cats = []
    used = 0
    for (name, prop) in VAR_CATS:
        f = 0.97 + rnd(7) * 0.01                 # ±3%（合計が variable を超えない範囲）
        amt = int(round(variable * prop * f / 100.0)) * 100
        if amt < 0:
            amt = 0
        cats.append((name, amt))
        used += amt
    tail = variable - used
    if tail < 0:                                  # 保険（理論上は起きない）: 末尾を 0 にして食費で吸収
        cats[0] = (cats[0][0], cats[0][1] + tail)
        tail = 0
    cats.append((VAR_TAIL, tail))
    return cats


def build_cashflow_rows(pulled_at):
    rnd = _lcg(20260829)
    rows = []
    for (y, m) in _months(FIRST_YM, LAST_YM):
        period = "%04d-%02d-01" % (y, m)
        partial = (period == PARTIAL_PERIOD)

        salary = 330000 + rnd(5) * 5000              # 330,000 〜 350,000
        misc = 200000 if m in (6, 12) else 0         # 6月/12月＝賞与
        comm = 9000 + rnd(3) * 500                   # 通信・デジタル 9,000 / 9,500 / 10,000
        subs = 6000 + rnd(4) * 1000                  # サブスク・娯楽 6,000 〜 9,000
        fixed = FIXED_RENT + FIXED_INSURANCE + comm + subs   # 112,000 〜 116,000
        variable = 105000 + rnd(15) * 5000           # 105,000 〜 175,000

        # 赤字月を2つ仕込む（グラフが単調増加にならない＝形の検証になる）。
        if period == "2025-03-01":
            variable = 380000                        # アンカーより前（後方逆算側の谷）
        elif period == "2026-02-01":
            variable = 420000                        # アンカーより後（前方累積側の谷）
        elif period == JULY_PERIOD:
            variable = JULY_TOTAL_EXPENSE - fixed    # 直近の確定月＝支出合計 266,000（予算 260,000 の微超過）

        if partial:
            salary, misc = 340000, 0
            fixed = sum(a for (_n, a) in PARTIAL_FIXED)
            variable = sum(a for (_n, a) in PARTIAL_VAR)
            cats = [{"name": n, "amount": a} for (n, a) in PARTIAL_FIXED + PARTIAL_VAR]
        else:
            fixed_cats = [("賃貸費用", FIXED_RENT), ("保険", FIXED_INSURANCE),
                          ("通信・デジタル", comm), ("サブスク・娯楽", subs)]
            cats = [{"name": n, "amount": a} for (n, a) in fixed_cats + _split_variable(variable, rnd)]

        total_income = salary + misc
        total_expense = fixed + variable
        balance = total_income - total_expense
        savings_rate = round(balance / total_income * 100, 1) if total_income else 0.0

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
            "breakdown": {"categories": cats},
            "pulled_at": pulled_at,
        })
    return rows


def build_state():
    st = {
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
        # W3.5 新設（本実装の migrate にはまだ無い＝オーバーレイが自分で読む）。
        "budgets": BUDGETS,
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
    # 受入 S1（未設定）用: W35_BUDGETS=0 なら予算を空にする（state の他フィールドは触らない）。
    if os.environ.get("W35_BUDGETS", "1") == "0":
        st["budgets"] = {"total": 0, "items": []}
    return st


PULLED_AT = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
FIXTURE_STATE = build_state()
CASHFLOW_ROWS = build_cashflow_rows(PULLED_AT)


def _row(period):
    for r in CASHFLOW_ROWS:
        if r["period"] == period:
            return r
    return None


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


def budget_summary():
    """進行中月／直近確定月の予算まわりを起動時に出す（fixture が仕様どおりかの自己申告）。"""
    out = []
    bmap = {b["name"]: b["amount"] for b in BUDGETS["items"] if b["amount"] > 0}
    for period, elapsed in ((PARTIAL_PERIOD, 29.0 / 31.0 * 100.0), (JULY_PERIOD, 100.0)):
        r = _row(period)
        if not r:
            continue
        cats = r["breakdown"]["categories"]
        over = [c for c in cats if bmap.get(c["name"], 0) and c["amount"] > bmap[c["name"]]]
        nobud = sorted([c for c in cats if not bmap.get(c["name"], 0)], key=lambda c: -c["amount"])
        out.append({
            "period": period,
            "expense": r["total_expense"],
            "income": r["total_income"],
            "balance": r["balance"],
            "savings_rate": r["savings_rate"],
            "pct": r["total_expense"] / BUDGETS["total"] * 100.0,
            "elapsed": elapsed,
            "cats": len(cats),
            "over": [(c["name"], c["amount"], bmap[c["name"]]) for c in over],
            "nobudget": [(c["name"], c["amount"]) for c in nobud[:5]],
        })
    return out


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
        # W35_VARIANTS=0 なら比較用オーバーレイ（w35-variants.js）を注入しない＝本実装の money.js だけを検証する。
        if os.environ.get("W35_VARIANTS", "1") != "0":
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
        # 受入 S6（未ログイン）用: W35_AUTH=0 ならセッションと /api/me/* を 401 にする。
        if os.environ.get("W35_AUTH", "1") == "0" and (path == "/api/auth/session" or path.startswith("/api/me/")):
            self._drain_body()
            self._json({"error": "unauthorized"}, status=401)
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
            raw = b"/* w35 mock: no-op */\n"
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
    ap.add_argument("--port", type=int, default=8250)
    ap.add_argument("--verbose", action="store_true")
    args = ap.parse_args()
    Handler.quiet = not args.verbose

    d = derived_summary()
    print("W3.5 mock server  http://127.0.0.1:%d/?w35variant=A&w35now=2026-08-29" % args.port, flush=True)
    print("  root      : %s" % ROOT, flush=True)
    print("  cashflow  : %d rows (%s .. %s / partial=%s)"
          % (d["rows"], CASHFLOW_ROWS[0]["period"], CASHFLOW_ROWS[-1]["period"], PARTIAL_PERIOD), flush=True)
    print("  anchor    : %s Y%s  / 確定%dヶ月" % (ANCHOR_DATE, format(ANCHOR_AMOUNT, ","), d["monthsCovered"]), flush=True)
    print("  derivedCash(ヒーロー確定額) = Y%s   totalAssets = Y%s"
          % (format(d["derivedCash"], ","), format(d["totalAssets"], ",")), flush=True)
    print("  budget    : total Y%s / items %d（うち amount>0 は %d）"
          % (format(BUDGETS["total"], ","), len(BUDGETS["items"]),
             len([b for b in BUDGETS["items"] if b["amount"] > 0])), flush=True)
    for b in budget_summary():
        print("  %s : 支出 Y%s（予算比 %.0f%% / 経過 %.0f%%）収入 Y%s 収支 Y%s 貯蓄率 %.1f%% 費目%d"
              % (b["period"][:7], format(b["expense"], ","), b["pct"], b["elapsed"],
                 format(b["income"], ","), format(b["balance"], ","), b["savings_rate"], b["cats"]), flush=True)
        print("      超過: %s" % (", ".join("%s Y%s/Y%s" % (n, format(a, ","), format(bd, ","))
                                            for (n, a, bd) in b["over"]) or "なし"), flush=True)
        print("      予算なし(上位5): %s" % ", ".join("%s Y%s" % (n, format(a, ",")) for (n, a) in b["nobudget"]),
              flush=True)

    srv = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()
