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
