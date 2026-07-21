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


def test_classify_growth_status_all_branches():
    from scripts.refresh_nisa import classify_growth_status
    imaj = {"1306", "1321", "1343", "1348", "2558"}
    # JP 個別株 → eligible
    assert classify_growth_status("7203.T", "JP", "stock", "トヨタ自動車", imaj) \
        == ("eligible", "jp-negative-list")
    # US 個別株・US ETF → conditional（全 184）
    assert classify_growth_status("AAPL", "US", "stock", "Apple", imaj) \
        == ("conditional", "us-broker-conditional")
    assert classify_growth_status("SPY", "US", "etf", "S&P 500 ETF (SPY)", imaj) \
        == ("conditional", "us-broker-conditional")
    # JP ETF：IMAJ 該当 → eligible / 非該当 → unknown
    assert classify_growth_status("1306.T", "JP", "etf", "NEXT FUNDS TOPIX連動型上場投信", imaj) \
        == ("eligible", "imaj-listed")
    assert classify_growth_status("9999.T", "JP", "etf", "架空ETF", imaj) \
        == ("unknown", "")
    # レバ/インバ/毎月分配 ETF → excluded（type=etf のみ・name パターン）
    assert classify_growth_status("1570.T", "JP", "etf", "日経レバレッジ指数ETF", imaj) \
        == ("excluded", "etf-rule-excluded")
    # 将来 JP 監理整理（market_alert!=none）→ excluded（nisa_source は契約 enum の 'jpx-alert' に寄せる・topFix #5）
    assert classify_growth_status("7203.T", "JP", "stock", "トヨタ", imaj, market_alert="supervision") \
        == ("excluded", "jpx-alert")
    assert classify_growth_status("7203.T", "JP", "stock", "トヨタ", imaj, market_alert="liquidation") \
        == ("excluded", "jpx-alert")
    # その他（未知の country）→ unknown 安全側
    assert classify_growth_status("XX", "GB", "stock", "Foo", imaj) == ("unknown", "")
