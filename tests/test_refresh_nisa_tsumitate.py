import datetime
import os
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FSA = os.path.join(ROOT, "tests", "fixtures", "nisa_shisan.xlsx")


def test_parse_fsa_tsumitate_counts_and_categories():
    from scripts.refresh_nisa_tsumitate import parse_fsa_tsumitate
    rows = parse_fsa_tsumitate(FSA)
    cats = {}
    for r in rows:
        cats[r["category"]] = cats.get(r["category"], 0) + 1
    assert cats["index"] == 286
    assert cats["active"] == 65
    assert cats["etf"] == 9
    assert len(rows) == 360


def test_parse_fsa_tsumitate_fields_and_forward_fill():
    from scripts.refresh_nisa_tsumitate import parse_fsa_tsumitate
    rows = parse_fsa_tsumitate(FSA)
    first = next(r for r in rows if r["category"] == "index")
    assert first["fund_name"] == "SBI・iシェアーズ・TOPIXインデックス・ファンド"
    assert first["mgmt_company"].startswith("SBIアセットマネジメント")
    assert first["index_name"] == "TOPIX"
    assert first["domestic_foreign"] == "国内型"
    # 縦結合セルの2行目以降も forward-fill されている
    second = [r for r in rows if r["category"] == "index"][1]
    assert second["index_name"] == "TOPIX" and second["domestic_foreign"] == "国内型"
    # list_updated_at = r0 Excel シリアル 46219 = 2026-07-16
    assert first["list_updated_at"] == datetime.date(2026, 7, 16)
    # ETF シートは index_name あり・domestic_foreign なし
    etf = next(r for r in rows if r["category"] == "etf")
    assert etf["fund_name"].startswith("iFreeETF")
    assert etf["index_name"] == "TOPIX"


def test_parse_fsa_tsumitate_loud_fails_on_short_index_sheet(tmp_path):
    import openpyxl
    from scripts.refresh_nisa_tsumitate import parse_fsa_tsumitate
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "指定インデックス投資信託"
    for i in range(4):
        ws.append([None, None, None, None, 46219 if i == 0 else None, None])
    ws.append(["単一指数", "国内型", "TOPIX", "ファンドA", "運用A", None])  # データ1件のみ=レンジ外
    p = tmp_path / "short.xlsx"
    wb.save(p)
    with pytest.raises(RuntimeError):
        parse_fsa_tsumitate(str(p))
