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


def test_upsert_nisa_status_touches_only_nisa_columns():
    from scripts.refresh_nisa import upsert_nisa_status
    captured = {}
    class Cur:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def execute(self, sql, params): captured["sql"] = sql; captured["params"] = params
    class Conn:
        def cursor(self): return Cur()
    upsert_nisa_status(Conn(), "7203.T", "eligible", "jp-negative-list")
    s = captured["sql"].replace(" ", "").lower()
    assert "updatemarket.ticker_master" in s
    assert "nisa_growth_status=%s" in s and "nisa_source=%s" in s
    assert "nisa_checked_at=now()" in s
    # 書き手分離: 市場データ列を絶対に触らない
    for forbidden in ("market_cap", "per=", "pbr", "company_name"):
        assert forbidden not in s
    assert captured["params"] == ("eligible", "jp-negative-list", "7203.T")


def test_run_classifies_all_rows(monkeypatch):
    from scripts import refresh_nisa as R
    rows = [("7203.T", "JP", "stock", "トヨタ"),
            ("AAPL", "US", "stock", "Apple"),
            ("1306.T", "JP", "etf", "NEXT FUNDS TOPIX連動型上場投信"),
            ("9999.T", "JP", "etf", "架空ETF")]
    monkeypatch.setattr(R, "load_ticker_rows", lambda conn: rows)
    seen = []
    monkeypatch.setattr(R, "upsert_nisa_status",
                        lambda conn, t, st, src: seen.append((t, st, src)))
    res = R.run(None, {"1306"})
    assert res["updated"] == 4
    assert ("7203.T", "eligible", "jp-negative-list") in seen
    assert ("1306.T", "eligible", "imaj-listed") in seen
    assert ("9999.T", "unknown", "") in seen
    assert res["by_status"]["conditional"] == 1


def test_main_loud_fails_when_no_rows(monkeypatch):
    from scripts import refresh_nisa as R
    class _NullConn:
        def __enter__(self): return self
        def __exit__(self, *a): return False
    monkeypatch.setattr(R, "_connect", lambda: _NullConn())
    monkeypatch.setattr(R, "_imaj_codes", lambda: {"1306"} | {str(9000 + i) for i in range(400)})
    monkeypatch.setattr(R, "load_ticker_rows", lambda conn: [])
    assert R.main([]) != 0   # 0 更新は非ゼロ終了
