"""NISA 成長投資枠フラグ更新（market.ticker_master の NISA 列のみ・非破壊）。

公開データのみ・inert・規制非該当。既存 GHA 書き手（seed_universe/refresh_market）は
NISA 列に触れない（書き手分離）。
使い方: DATABASE_URL=... IMAJ_XLSX=/path/imaj_listed.xlsx python scripts/refresh_nisa.py
"""
from __future__ import annotations
import os
import re
import sys

# 成長枠除外パターン（レバレッジ/インバース/毎月分配等）。現ユニバース該当0＝将来混入ガード。
EXCLUDE_RE = re.compile(r"レバレッジ|インバース|ブル|ベア|ダブル|2倍|日々|毎月")

# IMAJ 「対象商品一覧」レンジ（実測 417 本）。構造変更で無言破損を防ぐ loud-fail。
_IMAJ_MIN, _IMAJ_MAX = 380, 460


def parse_imaj_growth_codes(path_or_wb) -> set[str]:
    """IMAJ 成長投資枠上場対象リストの銘柄コード先頭4桁集合を返す。"""
    import openpyxl
    if isinstance(path_or_wb, str):
        wb = openpyxl.load_workbook(path_or_wb, read_only=True, data_only=True)
    else:
        wb = path_or_wb
    ws = wb["対象商品一覧"]
    codes: set[str] = set()
    for i, row in enumerate(ws.iter_rows(values_only=True)):
        if i < 2:            # r0=タイトル・r1=ヘッダ
            continue
        code = row[3] if len(row) > 3 else None
        if code is None or not str(code).strip():
            continue
        codes.add(str(code).strip()[:4])
    if not (_IMAJ_MIN <= len(codes) <= _IMAJ_MAX):
        raise RuntimeError(
            f"[refresh_nisa] IMAJ growth codes out of range: {len(codes)} "
            f"(expected {_IMAJ_MIN}-{_IMAJ_MAX}) — FSA/IMAJ layout changed?")
    return codes


def classify_growth_status(ticker, country, sec_type, name, imaj_codes,
                           market_alert="none"):
    """成長投資枠の適格性を (status, nisa_source) で返す。判定順序を固定（決定論）。"""
    name = name or ""
    # 1) ファンド(ETF)のレバ/インバ/毎月分配は市場問わず除外（将来混入ガード）
    if sec_type == "etf" and EXCLUDE_RE.search(name):
        return ("excluded", "etf-rule-excluded")
    # 2) JP 個別株：監理整理が付けば除外・それ以外は一律 eligible（現該当0＝§1-11 割り切り）
    if country == "JP" and sec_type == "stock":
        if market_alert != "none":
            # topFix #5: nisa_source は契約 enum に含まれる 'jpx-alert' に寄せる（supervision/liquidation の別は
            # market_alert 列が保持する）。当面 refresh_nisa は market_alert='none' 固定ゆえ dead branch。
            return ("excluded", "jpx-alert")
        return ("eligible", "jp-negative-list")
    # 3) US 個別株・US ETF（全184）：成長枠取扱いは証券会社依存 → conditional
    if country == "US":
        return ("conditional", "us-broker-conditional")
    # 4) JP ETF：IMAJ 成長枠上場リストに銘柄コード突合で該当 → eligible
    if country == "JP" and sec_type == "etf":
        code4 = ticker.split(".")[0]
        if code4 in imaj_codes:
            return ("eligible", "imaj-listed")
        return ("unknown", "")
    # 5) 判定不能 → unknown（安全側）
    return ("unknown", "")


def load_ticker_rows(conn):
    with conn.cursor() as cur:
        cur.execute("SELECT ticker, country, type, company_name "
                    "FROM market.ticker_master ORDER BY ticker")
        return list(cur.fetchall())


def upsert_nisa_status(conn, ticker, status, source):
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE market.ticker_master SET nisa_growth_status=%s, nisa_source=%s, "
            "nisa_checked_at=now() WHERE ticker=%s",
            (status, source, ticker))


def run(conn, imaj_codes):
    rows = load_ticker_rows(conn)
    by_status = {}
    for ticker, country, sec_type, name in rows:
        status, source = classify_growth_status(ticker, country, sec_type, name, imaj_codes)
        upsert_nisa_status(conn, ticker, status, source)
        by_status[status] = by_status.get(status, 0) + 1
    return {"updated": len(rows), "by_status": by_status}


def _connect():
    url = os.environ.get("DATABASE_URL") or os.environ.get("POSTGRES_URL")
    if not url:
        raise SystemExit("DATABASE_URL not set")
    import psycopg
    return psycopg.connect(url)


def _imaj_codes():
    path = os.environ.get("IMAJ_XLSX")
    if not path or not os.path.exists(path):
        raise SystemExit("IMAJ_XLSX not set or file missing (成長枠上場対象リスト xlsx)")
    return parse_imaj_growth_codes(path)


def main(argv=None):
    argv = argv if argv is not None else sys.argv[1:]
    imaj = _imaj_codes()
    with _connect() as conn:
        res = run(conn, imaj)
    print(f"[refresh_nisa] updated={res['updated']} by_status={res['by_status']}",
          file=sys.stderr)
    return 0 if res["updated"] > 0 else 1   # loud-fail: 0 更新は非ゼロ


if __name__ == "__main__":
    raise SystemExit(main())
