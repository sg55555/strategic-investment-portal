import os
import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMAJ = os.path.join(ROOT, "tests", "fixtures", "imaj_listed.xlsx")


def test_parse_imaj_growth_codes_returns_4digit_set_and_matches_universe_etfs():
    from scripts.refresh_nisa import parse_imaj_growth_codes
    codes = parse_imaj_growth_codes(IMAJ)
    assert isinstance(codes, set)
    assert 380 <= len(codes) <= 460   # 実測 417 本
    # universe の 5 JP ETF は全て 4 桁先頭一致（13060→'1306' 等）
    for c in ("1306", "1321", "1343", "1348", "2558"):
        assert c in codes


def test_parse_imaj_growth_codes_loud_fails_on_out_of_range(tmp_path):
    import openpyxl
    from scripts.refresh_nisa import parse_imaj_growth_codes
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "対象商品一覧"
    ws.append(["タイトル"])                                  # r0
    ws.append(["リスト更新日", "追加・変更の別", "別", "銘柄コード", "ファンド名称"])  # r1 header
    ws.append([20230621, "追加", "上場投信", "13060", "X"])   # r2 データ1件のみ = レンジ外
    p = tmp_path / "tiny.xlsx"
    wb.save(p)
    with pytest.raises(RuntimeError):
        parse_imaj_growth_codes(str(p))
