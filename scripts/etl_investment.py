"""データ基盤Phase2 / B#3 Stage3 — Notion「投資取引」DB を Neon me.investment_snapshots へ片方向 push。

設計（docs/superpowers/specs/2026-07-17-investment-ledger-foundation-design.md）:
  - 責務境界: 出すのは per-period delta のみ。累積（principal 残高/生涯簿価残）は書かない
    ＝money-rules.js の investmentDerived / nisaLedgerFold が単一源。
    移動平均（売却時の按分原価）だけは ETL 側の責務＝holdings に期末状態を残す。
  - 移動平均の粒度は (ティッカー × 口座区分)。同一銘柄を NISA成長 と 課税 で持てるため、
    口座をまたぐと簿価が混ざる。
  - 直交: 戦略区分(コア/サテライト)と口座区分(NISAつみたて/NISA成長/課税)は独立軸＝
    1購入が principal_core_delta と nisa_growth_delta の両方に載る。
  - 枠消費は約定金額のみ（手数料は枠を消費しない）。配当は枠不消費。
  - loud-fail: 欠落/rename/型崩れ/口座区分の空・未知値/売却の数量欠落は握り潰さず中止（garbage 非格納）。
  - 冪等 upsert: period(月初DATE)主キー。source_hash 無変化はスキップ。
  - cashflow ETL とは別失敗ドメイン（etl_cashflow.py を巻き込まない）。

実行: NOTION_TOKEN（読取専用 integration・対象DBに共有）と DATABASE_URL を env に置いて
      `python scripts/etl_investment.py [--months N] [--dry-run]`
GitHub Actions（.github/workflows/investment-pull.yml）から手動 dispatch。
Claude API は叩かない純 ETL。
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, date
from zoneinfo import ZoneInfo

import psycopg
from psycopg.types.json import Json

NOTION_VERSION = "2022-06-28"
NOTION_TOKEN = os.environ.get("NOTION_TOKEN", "")

# 投資取引DB（2026-06-30 作成・plans/2026-06-29-data-foundation-and-discipline-model.md §9）。
INVESTMENT_DB_ID = "38eda3f0c01c8142b8e3db02c921916b"

# 口座区分（B#3 Stage3）＝「どの口座で持つか」の軸。制度と1:1（NISA口座は1人1口座・中に2枠）。
NISA_TSUMITATE = "NISAつみたて"
NISA_GROWTH = "NISA成長"
TAXABLE = "課税"
ACCOUNTS = (NISA_TSUMITATE, NISA_GROWTH, TAXABLE)

# 種別。KIND_ORDER は同日内の決定論的処理順（seed→購入→配当→売却＝買う前に売らない）。
KIND_SEED = "期初保有"
KIND_BUY = "購入"
KIND_DIV = "配当"
KIND_SELL = "売却"
KIND_ORDER = {KIND_SEED: 0, KIND_BUY: 1, KIND_DIV: 2, KIND_SELL: 3}

STRATEGY_CORE = "コア"
STRATEGY_SAT = "サテライト"
STRATEGIES = (STRATEGY_CORE, STRATEGY_SAT)  # 空/未知値は loud-fail（口座区分と対称）

REQUIRED_INVESTMENT_PROPS = ("日付", "種別", "戦略区分", "ティッカー", "数量", "約定金額", "口座区分")
SELECT_INVESTMENT_PROPS = ("種別", "戦略区分", "ティッカー", "口座区分")
NUMBER_INVESTMENT_PROPS = ("数量", "約定金額")

DELTA_KEYS = ("invest_cash_flow", "principal_core_delta", "principal_sat_delta", "realized_gain",
              "nisa_tsumitate_delta", "nisa_growth_delta",
              "nisa_tsumitate_sold_at_cost", "nisa_growth_sold_at_cost")

JST = ZoneInfo("Asia/Tokyo")


# ── property getters（etl_cashflow.py と同一意味）──
def _select(prop: dict) -> str:
    sel = prop.get("select")
    return sel.get("name", "") if sel else ""


def _date(prop: dict) -> str:
    d = prop.get("date")
    return d.get("start", "") if d else ""


def _i(x) -> int:
    """円は整数。None/欠落は 0。"""
    try:
        return int(round(float(x or 0)))
    except (TypeError, ValueError):
        return 0


# ── loud-fail 検証 ──
def validate_investment(pages: list[dict]) -> None:
    """投資取引DB に期待プロパティが存在し型も合うか検証。欠落/rename/型崩れは中止（silent 0化を廃）。
    Notion は DB 単位でスキーマ均一ゆえ pages[0] の検査で全行を代表できる。"""
    if not pages:
        raise SystemExit("ETL ABORT: 投資取引DB が空（共有/権限を確認）")
    sample = pages[0].get("properties", {})
    missing = [name for name in REQUIRED_INVESTMENT_PROPS if name not in sample]
    if missing:
        raise SystemExit(
            f"ETL ABORT: 投資取引DB に期待プロパティ欠落 {missing}. "
            f"Notion 側の rename か integration 共有漏れ。garbage を格納せず中止。"
        )
    wrong = []
    for name in SELECT_INVESTMENT_PROPS:
        if sample.get(name, {}).get("type") != "select":
            wrong.append(f"{name}:{sample.get(name, {}).get('type')}")
    for name in NUMBER_INVESTMENT_PROPS:
        if sample.get(name, {}).get("type") != "number":
            wrong.append(f"{name}:{sample.get(name, {}).get('type')}")
    if sample.get("日付", {}).get("type") != "date":
        wrong.append(f"日付:{sample.get('日付', {}).get('type')}")
    if wrong:
        raise SystemExit(
            f"ETL ABORT: 投資取引DB の型不一致 {wrong}（select/number/date 期待）。"
            f"プロパティの型変更/差替を検知。garbage を格納せず中止。"
        )


# ── 会計（純粋）──
def _zero_delta() -> dict:
    return {k: 0.0 for k in DELTA_KEYS}


def _holdings_snapshot(holdings: dict) -> dict:
    """期末の移動平均状態。キーの厳密全順序ソート＝Notion ページ返却順に依存せず source_hash 安定（etl-5）。
    全部売却済み（qty<=0）は落とす。値に ticker/account を冗長に持つ（将来 Slice5 の時価 join 用）。"""
    return {
        k: {"ticker": h["ticker"], "account": h["account"],
            "qty": round(h["qty"], 8), "avg_cost": round(h["avg_cost"], 4),
            "strategy": h["strategy"]}
        for k, h in sorted(holdings.items()) if h["qty"] > 1e-9
    }


def _parse_tx(page: dict) -> dict | None:
    """1ページ → 取引 dict。約定日が無い行は None（write-only-good-rows）。口座区分の異常は loud-fail。"""
    p = page.get("properties", {})
    iso = _date(p.get("日付", {}))
    if not iso or len(iso) < 10:
        return None  # write-only-good-rows: 約定日が確定しない行は捨てる（0格納しない）
    try:
        d = date(int(iso[0:4]), int(iso[5:7]), int(iso[8:10]))
    except ValueError:
        return None
    kind = _select(p.get("種別", {}))
    account = _select(p.get("口座区分", {}))
    if account not in ACCOUNTS:
        raise SystemExit(
            f"ETL ABORT: 口座区分が空/未知値 date={iso} 種別='{kind}' 値='{account}'. "
            f"期待={list(ACCOUNTS)}. silent に課税扱いすると NISA 枠が静かに過少計上されるため中止。"
        )
    strategy = _select(p.get("戦略区分", {}))
    # 戦略区分の空/未知値は loud-fail（口座区分と対称・silent に「サテライト」へ落とさない）。
    # 売却は holdings 保有側の strategy を使うため行の値は検証しない（購入/期初保有時に検証済み）。
    if kind in (KIND_BUY, KIND_SEED) and strategy not in STRATEGIES:
        raise SystemExit(
            f"ETL ABORT: 戦略区分が空/未知値 date={iso} 種別='{kind}' 値='{strategy}'. "
            f"期待={list(STRATEGIES)}. silent にサテライト扱いすると元本の分類が歪むため中止。"
        )
    qty = p.get("数量", {}).get("number")
    if kind == KIND_SELL and (qty is None or qty <= 0):
        raise SystemExit(
            f"ETL ABORT: 売却行に数量が無い date={iso} ticker='{_select(p.get('ティッカー', {}))}'. "
            f"簿価按分（avg_cost × 数量）ができないため中止。"
        )
    amount = float(p.get("約定金額", {}).get("number") or 0)
    fee = float(p.get("手数料", {}).get("number") or 0)
    qty_f = float(qty or 0)
    # 負値は num() が静かに 0 へ潰し NISA 生涯枠を水増しする（口座区分の loud-fail と同じ害の裏返し）。
    if amount < 0 or fee < 0 or qty_f < 0:
        raise SystemExit(
            f"ETL ABORT: 負の値 date={iso} 種別='{kind}' 約定金額={amount} 手数料={fee} 数量={qty_f}. "
            f"下流が負値を静かに 0 へ丸め枠が水増しされるため中止。"
        )
    return {
        "date": d,
        "kind": kind,
        "account": account,
        "ticker": _select(p.get("ティッカー", {})) or "UNKNOWN",
        "strategy": strategy,
        "qty": qty_f,
        "amount": amount,
        "fee": fee,
    }


def _period_str(d: date) -> str:
    return date(d.year, d.month, 1).isoformat()


def build_investment(pages: list[dict], cur_ym: tuple[int, int]) -> dict[str, dict]:
    """取引行 → period(YYYY-MM-01 str) → per-period delta + 期末 holdings。

    日付昇順に移動平均を (ticker × 口座区分) 単位で回す。累積は書かない（純関数側が単一源）。
    当月(部分月)は is_complete=False。
    """
    txs = [t for t in (_parse_tx(pg) for pg in pages) if t is not None]
    # 同日内の決定論的順序（seed→購入→配当→売却）。ページ返却順に依存させない。
    txs.sort(key=lambda t: (t["date"], KIND_ORDER.get(t["kind"], 9), t["account"], t["ticker"]))

    by_period: dict[str, list[dict]] = {}
    for t in txs:
        by_period.setdefault(_period_str(t["date"]), []).append(t)

    holdings: dict[str, dict] = {}
    out: dict[str, dict] = {}
    for period in sorted(by_period.keys()):
        d = _zero_delta()
        for t in by_period[period]:
            key = f'{t["ticker"]}|{t["account"]}'
            h = holdings.setdefault(key, {"ticker": t["ticker"], "account": t["account"],
                                          "qty": 0.0, "avg_cost": 0.0, "strategy": t["strategy"]})
            amount, fee = t["amount"], t["fee"]  # 約定金額(取得対価)と手数料は別建て（M-5）
            if t["kind"] in (KIND_BUY, KIND_SEED):
                core = t["strategy"] == STRATEGY_CORE  # 空/未知値は _parse_tx で loud-fail 済み
                # 元本（戦略区分軸）＝約定金額のみ（手数料は簿価に含めない）
                d["principal_core_delta" if core else "principal_sat_delta"] += amount
                if t["kind"] == KIND_BUY:
                    d["invest_cash_flow"] -= amount + fee  # 現金流出は手数料込み（期初保有は現金を動かさない）
                # 移動平均（口座別に独立）＝約定金額ベース（手数料を含めない＝元本/枠と一貫）
                new_qty = h["qty"] + t["qty"]
                if new_qty > 0:
                    h["avg_cost"] = (h["qty"] * h["avg_cost"] + amount) / new_qty
                h["qty"] = new_qty
                h["strategy"] = t["strategy"]
                # NISA 枠（口座区分軸・直交）。枠消費は約定金額のみ＝手数料は含めない。
                if t["account"] == NISA_TSUMITATE:
                    d["nisa_tsumitate_delta"] += amount
                elif t["account"] == NISA_GROWTH:
                    d["nisa_growth_delta"] += amount
            elif t["kind"] == KIND_SELL:
                cost = h["avg_cost"] * t["qty"]  # 簿価按分
                if t["qty"] > h["qty"] + 1e-9:
                    print(f"[etl_investment] ⚠ 売却数量が保有を超過 {key} date={t['date']} "
                          f"qty={t['qty']} held={h['qty']}（記帳漏れの可能性・reconcile で差が出ます）")
                # 元本は holdings 保有側の strategy で戻す（行の値でなく＝記帳ミスで principal が負化しない・M-1）
                sell_core = h["strategy"] == STRATEGY_CORE
                d["principal_core_delta" if sell_core else "principal_sat_delta"] -= cost
                d["invest_cash_flow"] += amount - fee     # 手取り＝約定金額−手数料
                d["realized_gain"] += (amount - fee) - cost  # 実現益は手数料を差し引く
                h["qty"] -= t["qty"]
                if t["account"] == NISA_TSUMITATE:
                    d["nisa_tsumitate_sold_at_cost"] += cost
                elif t["account"] == NISA_GROWTH:
                    d["nisa_growth_sold_at_cost"] += cost
            elif t["kind"] == KIND_DIV:
                # 配当＝現金+/実現益+/元本不変/NISA 枠不消費。手数料があれば差し引く。
                d["invest_cash_flow"] += amount - fee
                d["realized_gain"] += amount - fee
        pd = date.fromisoformat(period)
        out[period] = {
            "period": pd,
            **{k: _i(v) for k, v in d.items()},
            "is_complete": (pd.year, pd.month) < cur_ym,  # 当月以降は未確定
            "holdings": _holdings_snapshot(holdings),
        }
    return out


def _source_hash(row: dict) -> str:
    """正規化済元データの sha256。無変化スキップ＆改ざん検知。"""
    payload = {k: (v.isoformat() if isinstance(v, date) else v)
               for k, v in row.items() if k != "source_hash"}
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode()).hexdigest()


# ── Notion 取得（etl_cashflow.py と同型・追加依存ゼロ）──
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
        target = INVESTMENT_DB_ID.replace("-", "")
        seen = set()
        print(f"[diag] このintegrationがアクセス可能な database 数={len(dbs)}:")
        for d in dbs:
            did = (d.get("id") or "").replace("-", "")
            seen.add(did)
            title = "".join(t.get("plain_text", "") for t in (d.get("title") or []))
            mark = "  <== TARGET" if did == target else ""
            print(f"  - {did[:8]}… '{title}'{mark}")
        if target not in seen:
            print(f"[diag] ⚠ 未共有のターゲットDB（このintegrationに未接続）: {target[:8]}…")
        else:
            print("[diag] ターゲット投資取引DBはアクセス可能。")
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


# ── upsert ──
UPSERT_SQL = """
INSERT INTO me.investment_snapshots
  (period, invest_cash_flow, principal_core_delta, principal_sat_delta, realized_gain,
   is_complete, holdings, nisa_tsumitate_delta, nisa_growth_delta,
   nisa_tsumitate_sold_at_cost, nisa_growth_sold_at_cost, source, source_hash, pulled_at)
VALUES
  (%(period)s, %(invest_cash_flow)s, %(principal_core_delta)s, %(principal_sat_delta)s,
   %(realized_gain)s, %(is_complete)s, %(holdings)s, %(nisa_tsumitate_delta)s,
   %(nisa_growth_delta)s, %(nisa_tsumitate_sold_at_cost)s, %(nisa_growth_sold_at_cost)s,
   'investment-notion', %(source_hash)s, now())
ON CONFLICT (period) DO UPDATE SET
  invest_cash_flow = EXCLUDED.invest_cash_flow,
  principal_core_delta = EXCLUDED.principal_core_delta,
  principal_sat_delta = EXCLUDED.principal_sat_delta,
  realized_gain = EXCLUDED.realized_gain,
  is_complete = EXCLUDED.is_complete,
  holdings = EXCLUDED.holdings,
  nisa_tsumitate_delta = EXCLUDED.nisa_tsumitate_delta,
  nisa_growth_delta = EXCLUDED.nisa_growth_delta,
  nisa_tsumitate_sold_at_cost = EXCLUDED.nisa_tsumitate_sold_at_cost,
  nisa_growth_sold_at_cost = EXCLUDED.nisa_growth_sold_at_cost,
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

    try:
        pages = _all_pages(INVESTMENT_DB_ID, {"sorts": [{"property": "日付", "direction": "ascending"}]})
    except Exception as e:  # noqa: BLE001
        # 取得失敗なら中止（部分データで Neon を汚染しない）。cashflow ETL とは別失敗ドメイン。
        raise SystemExit(f"ETL ABORT: Notion 取得失敗 {e!r}") from None

    validate_investment(pages)  # loud-fail

    built = build_investment(pages, cur_ym)

    periods = sorted(built.keys())
    if args.months and args.months > 0:
        periods = periods[-args.months:]

    rows = []
    for period in periods:
        r = dict(built[period])
        r["holdings"] = Json(r["holdings"])
        r["source_hash"] = _source_hash(built[period])
        rows.append(r)

    print(f"[etl_investment] 月数={len(rows)} (全{len(built)}・window={args.months or 'all'}) "
          f"取引数={len(pages)} now(JST)={now:%Y-%m} dry_run={args.dry_run}")

    if args.dry_run:
        for period in periods[-3:]:
            r = built[period]
            print(f"  {r['period']} cash={r['invest_cash_flow']} core={r['principal_core_delta']} "
                  f"sat={r['principal_sat_delta']} gain={r['realized_gain']} "
                  f"nisa_t={r['nisa_tsumitate_delta']} nisa_g={r['nisa_growth_delta']} "
                  f"sold_t={r['nisa_tsumitate_sold_at_cost']} sold_g={r['nisa_growth_sold_at_cost']} "
                  f"complete={r['is_complete']} holdings={len(r['holdings'])} "
                  f"hash={_source_hash(r)[:8]}")
        return 0

    written = skipped = 0
    with psycopg.connect(db_url, autocommit=True) as conn, conn.cursor() as curs:
        curs.execute("SELECT period, source_hash FROM me.investment_snapshots")
        existing = {p.isoformat(): h for p, h in curs.fetchall()}
        for r in rows:
            if existing.get(r["period"].isoformat()) == r["source_hash"]:
                skipped += 1
                continue
            curs.execute(UPSERT_SQL, r)
            written += 1
    print(f"[etl_investment] upsert={written} skip(unchanged)={skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
