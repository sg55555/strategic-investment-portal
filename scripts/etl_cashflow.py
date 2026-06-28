"""Slice4 収支連携 ETL — kakeibo(Notion) の月次収支を Neon me.cashflow_snapshots へ片方向 push。

設計（docs/superpowers/plans/2026-06-28-v2-slice4-cashflow.md）:
  - ハイブリッド粒度: 見出し数値(income/expense/balance)は月別集計DB(権威・式プロパティ済)、
    breakdown JSONB は生取引DB(変動費/固定費)から集計した自由なカテゴリ別内訳。
  - loud-fail: 期待プロパティが欠落/rename していたら握り潰さず中止（garbage 非格納）。
  - 冪等 upsert: period(月初DATE)主キーで ON CONFLICT DO UPDATE。source_hash 無変化はスキップ。
  - write-only-good-rows: パース成功した月のみ書く。
  - 司令室/advice は実行時に Notion を叩かず Neon のみ読む（実行時 kakeibo 非依存）。

実行: NOTION_TOKEN（読取専用 integration・対象DBに共有）と DATABASE_URL を env に置いて
      `python scripts/etl_cashflow.py [--months N] [--dry-run]`
GitHub Actions（.github/workflows/cashflow-pull.yml）から月次 schedule / 手動 dispatch。
Claude API は叩かない純 ETL。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import threading
import urllib.error
import urllib.request
from datetime import datetime, date
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Json

NOTION_VERSION = "2022-06-28"
NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")

# kakeibo の Notion DB（api/dashboard.py と同一 ID）。
MONTHLY_DB_ID = "d05a2ae093814083b862d56e72031a88"   # 月別集計（権威・式プロパティ）
VARIABLE_DB_ID = "d4b5b08c48924d8ea4f0272fe2ae179b"  # 変動費（生取引）
FIXED_DB_ID = "a47cf9270df544878dd963feb8150088"     # 固定費（生取引）

# 月別集計DB に存在を必須とするプロパティ（loud-fail 検証対象）。
REQUIRED_MONTHLY_PROPS = (
    "日付", "収入合計", "支出合計", "固定支出", "変動支出",
    "収支", "貯蓄率", "給与収入", "雑収入",
)
# 型も検証する見出し（数値=formula・日付=date）。rename だけでなく型崩れ/formula差替も abort（etl-1）。
NUMERIC_MONTHLY_PROPS = (
    "収入合計", "支出合計", "固定支出", "変動支出", "収支", "貯蓄率", "給与収入", "雑収入",
)

# Notion source → 表示ラベル（dashboard.py の移行漏れフォールバックを踏襲）。
CATEGORY_DISPLAY: dict[str, str] = {
    "車・ガソリン": "車両維持費・燃料費", "車": "車両本体・ローン",
    "書籍": "書籍・教育", "教育": "書籍・教育",
    "日用品": "日用品・雑貨", "雑貨": "日用品・雑貨", "zakka": "日用品・雑貨", "食器": "日用品・雑貨",
    "家具": "家具・家電・機器", "家電": "家具・家電・機器", "PC備品": "家具・家電・機器", "カメラ備品": "家具・家電・機器",
    "道具・機材": "機器・道具", "税金": "税金・公的費用",
    "医薬品": "医療・健康・美容", "散髪代": "医療・健康・美容", "ガソリン代": "車両維持費・燃料費",
}

JST = ZoneInfo("Asia/Tokyo")


# ── Notion 取得 ──
def _query(database_id: str, body_extra: dict, cursor: str | None) -> dict:
    url = f"https://api.notion.com/v1/databases/{database_id}/query"
    headers = {
        "Authorization": f"Bearer {NOTION_TOKEN}",
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
    }
    body: dict = {"page_size": 100, **body_extra}
    if cursor:
        body["start_cursor"] = cursor
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:  # Notion のエラー本文（共有漏れ等の具体的メッセージ）を surface
        detail = ""
        try:
            detail = e.read().decode("utf-8", "replace")[:300]
        except Exception:  # noqa: BLE001
            pass
        raise RuntimeError(f"Notion {e.code} db={database_id[:8]}… {detail}") from None


def _api(url: str, body: dict | None = None):
    headers = {"Authorization": f"Bearer {NOTION_TOKEN}", "Notion-Version": NOTION_VERSION}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read())


def diagnose() -> None:
    """トークン妥当性と integration がアクセス可能な database を表示（共有漏れ切り分け・秘密は出さない）。"""
    try:
        me = _api("https://api.notion.com/v1/users/me")
        print(f"[diag] token OK: bot='{me.get('name')}' type={me.get('type')}")
    except Exception as e:  # noqa: BLE001
        print(f"[diag] /users/me 失敗: {e!r}（NOTION_TOKEN 無効の可能性）")
        return
    try:
        res = _api("https://api.notion.com/v1/search",
                   {"filter": {"property": "object", "value": "database"}, "page_size": 50})
        dbs = res.get("results", [])
        targets = {MONTHLY_DB_ID, VARIABLE_DB_ID, FIXED_DB_ID}
        seen = set()
        print(f"[diag] このintegrationがアクセス可能な database 数={len(dbs)}:")
        for d in dbs:
            did = (d.get("id") or "").replace("-", "")
            seen.add(did)
            title = "".join(t.get("plain_text", "") for t in (d.get("title") or []))
            mark = "  <== TARGET" if did in targets else ""
            print(f"  - {did[:8]}… '{title}'{mark}")
        miss = [t[:8] + "…" for t in targets if t not in seen]
        if miss:
            print(f"[diag] ⚠ 未共有のターゲットDB（このintegrationに未接続）: {miss}")
        else:
            print("[diag] ターゲット3DBは全てアクセス可能。")
    except Exception as e:  # noqa: BLE001
        print(f"[diag] /search 失敗: {e!r}")


def _all_pages(database_id: str, body_extra: dict | None = None) -> list[dict]:
    pages: list[dict] = []
    cursor = None
    while True:
        data = _query(database_id, body_extra or {}, cursor)
        pages.extend(data.get("results", []))
        if not data.get("has_more"):
            break
        cursor = data.get("next_cursor")
    return pages


# ── property getters（dashboard.py と同一意味）──
def _title(prop: dict) -> str:
    return "".join(t.get("plain_text", "") for t in prop.get("title", []))


def _text(prop: dict) -> str:
    return "".join(t.get("plain_text", "") for t in prop.get("rich_text", []))


def _select(prop: dict) -> str:
    sel = prop.get("select")
    return sel.get("name", "") if sel else ""


def _date(prop: dict) -> str:
    d = prop.get("date")
    return d.get("start", "") if d else ""


def _rollup_select(prop: dict) -> str:
    arr = prop.get("rollup", {}).get("array", [])
    if arr and arr[0].get("type") == "select":
        return (arr[0].get("select") or {}).get("name", "")
    return ""


def _formula_number(prop: dict):
    f = prop.get("formula", {})
    t = f.get("type")
    if t == "number":
        return f.get("number")
    if t == "string":
        s = f.get("string", "")
        try:
            return float(s.replace("%", "").replace(",", "").strip()) / (100 if "%" in s else 1)
        except ValueError:
            return None
    return None


def _i(x) -> int:
    """円は整数。None/欠落は 0。"""
    try:
        return int(round(float(x or 0)))
    except (TypeError, ValueError):
        return 0


# ── loud-fail 検証 ──
def validate_monthly(pages: list[dict]) -> None:
    """月別集計DB に期待プロパティが存在し型も合うか検証。欠落/rename/型崩れは中止（silent 0化を廃）。
    Notion は DB 単位でスキーマ均一ゆえ pages[0] の検査で全行を代表できる。"""
    if not pages:
        raise SystemExit("ETL ABORT: 月別集計DB が空（共有/権限を確認）")
    sample = pages[0].get("properties", {})
    missing = [name for name in REQUIRED_MONTHLY_PROPS if name not in sample]
    if missing:
        raise SystemExit(
            f"ETL ABORT: 月別集計DB に期待プロパティ欠落 {missing}. "
            f"Notion 側の rename か integration 共有漏れ。garbage を格納せず中止。"
        )
    wrong = []
    for name in NUMERIC_MONTHLY_PROPS:
        if sample.get(name, {}).get("type") != "formula":
            wrong.append(f"{name}:{sample.get(name, {}).get('type')}")
    if sample.get("日付", {}).get("type") != "date":
        wrong.append(f"日付:{sample.get('日付', {}).get('type')}")
    if wrong:
        raise SystemExit(
            f"ETL ABORT: 月別集計DB の型不一致 {wrong}（数値=formula/日付=date 期待）。"
            f"プロパティの型変更/差替を検知。garbage を格納せず中止。"
        )


# ── 見出し（権威）──
def _period_from_row(p: dict) -> date | None:
    """日付 → 月初。日付が無ければ 年/月 から構築。"""
    iso = _date(p.get("日付", {}))
    if iso and len(iso) >= 7:
        try:
            y, m = int(iso[0:4]), int(iso[5:7])
            return date(y, m, 1)
        except ValueError:
            pass
    yr = _select(p.get("年", {}))
    mo = _text(p.get("月", {}))
    try:
        return date(int(yr), int(mo), 1)
    except (TypeError, ValueError):
        return None


def build_headline(pages: list[dict], cur_ym: tuple[int, int]) -> dict[str, dict]:
    """period(YYYY-MM-01 str) → 見出し dict。当月(進行中)は is_complete=False。"""
    out: dict[str, dict] = {}
    for page in pages:
        p = page.get("properties", {})
        period = _period_from_row(p)
        if period is None:
            continue  # write-only-good-rows: 月が確定しない行は捨てる
        income_raw = _formula_number(p.get("収入合計", {}))
        balance_raw = _formula_number(p.get("収支", {}))
        if income_raw is None and balance_raw is None:
            continue  # 権威フィールドが両方 None＝formula エラー/空の placeholder 月＝捨てる（0格納しない）
        sr_raw = _formula_number(p.get("貯蓄率", {}))
        savings_rate = sr_raw * 100 if (sr_raw is not None and abs(sr_raw) <= 1) else sr_raw
        is_complete = (period.year, period.month) < cur_ym  # 当月以降は未確定
        out[period.isoformat()] = {
            "period": period,
            "total_income": _i(income_raw),
            "salary_income": _i(_formula_number(p.get("給与収入", {}))),
            "misc_income": _i(_formula_number(p.get("雑収入", {}))),
            "fixed_expense": _i(_formula_number(p.get("固定支出", {}))),
            "variable_expense": _i(_formula_number(p.get("変動支出", {}))),
            "total_expense": _i(_formula_number(p.get("支出合計", {}))),
            "balance": _i(balance_raw),
            "savings_rate": round(float(savings_rate), 2) if savings_rate is not None else None,
            "is_complete": is_complete,
        }
    return out


# ── 内訳（自由・生取引から集計）──
def _row_period(p: dict) -> str | None:
    iso = p.get("日付", {}).get("date")
    start = iso.get("start") if iso else None
    if start and len(start) >= 7:
        try:
            return date(int(start[0:4]), int(start[5:7]), 1).isoformat()
        except ValueError:
            return None
    return None


def build_breakdown(var_pages: list[dict], fix_pages: list[dict]) -> dict[str, dict]:
    """period → {categories:[{name,amount}...]} 。変動費＋固定費の生取引をカテゴリ別集計。"""
    acc: dict[str, dict[str, float]] = {}
    for page in var_pages + fix_pages:
        p = page.get("properties", {})
        period = _row_period(p)
        if not period:
            continue
        amount = p.get("金額", {}).get("number") or 0
        if amount <= 0:
            continue
        cat = _rollup_select(p.get("系統_LINK", {}))
        cat = CATEGORY_DISPLAY.get(cat, cat) or "未分類"
        acc.setdefault(period, {})
        acc[period][cat] = acc[period].get(cat, 0) + amount
    out: dict[str, dict] = {}
    for period, cats in acc.items():
        # (-amount, name) で厳密全順序＝Notion ページ返却順に依存せず source_hash 安定（etl-5）。
        cat_list = sorted(
            ({"name": k, "amount": int(round(v))} for k, v in cats.items()),
            key=lambda x: (-x["amount"], x["name"]),
        )
        out[period] = {"categories": cat_list, "source": "variable+fixed transactions"}
    return out


def _source_hash(headline: dict, breakdown: dict | None) -> str:
    """正規化済元データの sha256。無変化スキップ＆改ざん検知。"""
    payload = {
        "h": {k: (v.isoformat() if isinstance(v, date) else v) for k, v in sorted(headline.items())},
        "b": breakdown,
    }
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


# ── upsert ──
UPSERT_SQL = """
INSERT INTO me.cashflow_snapshots
  (period, total_income, salary_income, misc_income, fixed_expense, variable_expense,
   total_expense, balance, savings_rate, is_complete, breakdown, source, source_hash, pulled_at)
VALUES
  (%(period)s, %(total_income)s, %(salary_income)s, %(misc_income)s, %(fixed_expense)s,
   %(variable_expense)s, %(total_expense)s, %(balance)s, %(savings_rate)s, %(is_complete)s,
   %(breakdown)s, 'kakeibo-notion-hybrid', %(source_hash)s, now())
ON CONFLICT (period) DO UPDATE SET
  total_income = EXCLUDED.total_income, salary_income = EXCLUDED.salary_income,
  misc_income = EXCLUDED.misc_income, fixed_expense = EXCLUDED.fixed_expense,
  variable_expense = EXCLUDED.variable_expense, total_expense = EXCLUDED.total_expense,
  balance = EXCLUDED.balance, savings_rate = EXCLUDED.savings_rate,
  is_complete = EXCLUDED.is_complete, breakdown = EXCLUDED.breakdown,
  source_hash = EXCLUDED.source_hash, pulled_at = now();
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--months", type=int, default=0, help="直近Nヶ月のみ upsert（0=全期間）")
    ap.add_argument("--dry-run", action="store_true", help="Neon に書かず件数だけ表示")
    args = ap.parse_args()

    if not NOTION_TOKEN:
        raise SystemExit("ETL ABORT: NOTION_TOKEN 未設定")
    db_url = os.environ.get("DATABASE_URL", "")
    if not db_url and not args.dry_run:
        raise SystemExit("ETL ABORT: DATABASE_URL 未設定")

    diagnose()  # トークン妥当性＋アクセス可能DBを先に表示（共有漏れの切り分け）

    now = datetime.now(JST)
    cur_ym = (now.year, now.month)

    # 3系統を並列取得（dashboard.py に倣う）。
    fetched: dict = {}
    err: dict = {}

    def run(key, fn):
        try:
            fetched[key] = fn()
        except Exception as e:  # noqa: BLE001
            err[key] = e

    threads = [
        threading.Thread(target=run, args=("monthly", lambda: _all_pages(
            MONTHLY_DB_ID, {"sorts": [{"property": "日付", "direction": "ascending"}]}))),
        threading.Thread(target=run, args=("var", lambda: _all_pages(VARIABLE_DB_ID))),
        threading.Thread(target=run, args=("fix", lambda: _all_pages(FIXED_DB_ID))),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if err:
        # どれか1系統でも取得失敗なら中止（部分データで Neon を汚染しない）。
        raise SystemExit(f"ETL ABORT: Notion 取得失敗 {[(k, str(v)) for k, v in err.items()]}")

    monthly_pages = fetched["monthly"]
    validate_monthly(monthly_pages)  # loud-fail

    headline = build_headline(monthly_pages, cur_ym)
    breakdown = build_breakdown(fetched["var"], fetched["fix"])

    periods = sorted(headline.keys())
    if args.months and args.months > 0:
        periods = periods[-args.months:]

    rows = []
    for period in periods:
        h = headline[period]
        b = breakdown.get(period)
        rows.append({
            **{k: v for k, v in h.items()},
            "period": h["period"],
            "breakdown": Json(b) if b is not None else None,
            "source_hash": _source_hash(h, b),
        })

    print(f"[etl_cashflow] 月数={len(rows)} (全{len(headline)}・window={args.months or 'all'}) "
          f"now(JST)={now:%Y-%m} dry_run={args.dry_run}")

    if args.dry_run:
        for r in rows[-3:]:
            print(f"  {r['period']} income={r['total_income']} expense={r['total_expense']} "
                  f"balance={r['balance']} complete={r['is_complete']} hash={r['source_hash'][:8]}")
        return 0

    written = skipped = 0
    with psycopg.connect(db_url, autocommit=True) as conn, conn.cursor() as curs:
        curs.execute("SELECT period, source_hash FROM me.cashflow_snapshots")
        existing = {p.isoformat(): h for p, h in curs.fetchall()}
        for r in rows:
            if existing.get(r["period"].isoformat()) == r["source_hash"]:
                skipped += 1
                continue
            curs.execute(UPSERT_SQL, r)
            written += 1
    print(f"[etl_cashflow] upsert={written} skip(unchanged)={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
