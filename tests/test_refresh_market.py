import math
import pytest
from scripts.refresh_market import map_ohlcv_rows, map_info_fields, map_financials_rows


class _NullConn:
    def __enter__(self): return self
    def __exit__(self, *a): return False


def test_map_ohlcv_rows_filters_non_finite():
    hist = [
        {"date": "2026-07-10", "open": 100.0, "high": 110.0, "low": 99.0, "close": 105.0, "volume": 1000},
        {"date": "2026-07-11", "open": float("nan"), "high": 1, "low": 1, "close": 1, "volume": 1},  # 除外
    ]
    rows = map_ohlcv_rows("AAA.T", hist)
    assert rows == [("AAA.T", "2026-07-10", 100.0, 110.0, 99.0, 105.0, 1000)]


def test_map_info_fields_per_fallback():
    assert map_info_fields({"marketCap": 5e11, "trailingPE": None, "forwardPE": 18.2, "priceToBook": 1.4}) \
        == {"market_cap": 5e11, "per": 18.2, "pbr": 1.4}
    # 全欠損は None（0 で埋めない＝欠損を捏造しない）
    assert map_info_fields({}) == {"market_cap": None, "per": None, "pbr": None}


def test_map_financials_rows_maps_and_tags_source():
    fin = {
        2025: {"Total Revenue": 1000.0, "Gross Profit": 300.0, "Operating Income": 120.0,
               "Net Income": 80.0, "Total Current Assets": 500.0, "Total Non Current Assets": 700.0,
               "Total Current Liabilities": 200.0, "Total Non Current Liabilities": 300.0,
               "Stockholders Equity": 700.0, "Operating Cash Flow": 150.0,
               "Investing Cash Flow": -50.0, "Financing Cash Flow": -40.0,
               "Beginning Cash Position": 400.0, "End Cash Position": 460.0},
    }
    rows = map_financials_rows("MSFT", fin)
    assert len(rows) == 1
    r = rows[0]
    assert r[0] == "MSFT" and r[1] == 2025 and r[2] == "FY"
    assert r[8] == 1000.0   # net_sales
    assert r[9] == 300.0    # gross_profit
    assert r[-1] == "yfinance"   # source タグ


def test_run_prices_partial_failure(monkeypatch):
    from scripts import refresh_market as R

    def fake_download(tickers):
        # AAA は成功・BBB は空（取得不能）を模す
        return {"AAA.T": [{"date": "2026-07-10", "open": 1, "high": 2, "low": 1, "close": 2, "volume": 5}],
                "BBB.T": []}

    def fake_info(tk):
        return {"marketCap": 1e9, "trailingPE": 10, "priceToBook": 1}

    calls = {"ohlcv": [], "info": []}
    class FakeConn:  # upsert を捕捉する軽量ダブル
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def commit(self): pass  # 中間commit(FIX3)を許容する no-op
    monkeypatch.setattr(R, "upsert_ohlcv", lambda conn, rows: calls["ohlcv"].append(rows) or len(rows))
    monkeypatch.setattr(R, "upsert_ticker_info", lambda conn, tk, f: calls["info"].append((tk, f)))

    res = R.run_prices(FakeConn(), ["AAA.T", "BBB.T"], download_fn=fake_download, info_fn=fake_info)
    assert res["ok"] == 1 and res["failed"] == ["BBB.T"]        # BBB は足0で失敗計上
    assert calls["info"][0][0] == "AAA.T"


def test_upsert_financials_protects_edinet(monkeypatch):
    from scripts import refresh_market as R
    captured = {}
    class Cur:
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def executemany(self, sql, rows): captured["sql"] = sql; captured["rows"] = rows
    class Conn:
        def cursor(self): return Cur()
    rows = R.map_financials_rows("NEW", {2025: {"Total Revenue": 100.0}})
    R.upsert_financials(Conn(), rows)
    # EDINET 行を守るガードが SQL に入っている
    assert "source='yfinance'" in captured["sql"].replace(" ", "") or \
           "source = 'yfinance'" in captured["sql"]
    assert captured["rows"][0][0] == "NEW"


def test_main_loud_fail_when_all_fail(monkeypatch):
    from scripts import refresh_market as R
    monkeypatch.setattr(R, "_connect", lambda: _NullConn())
    monkeypatch.setattr(R, "run_prices", lambda conn, tks, **k: {"ok": 0, "failed": tks})
    monkeypatch.setattr(R, "_load_tickers", lambda conn: ["X", "Y"])
    rc = R.main(["--prices"])
    assert rc != 0   # 全失敗は非ゼロ終了


def test_missing_holdings():
    from scripts.refresh_market import missing_holdings
    assert missing_holdings({"AAA", "BBB"}, {"AAA", "ZZZ"}) == ["ZZZ"]
    assert missing_holdings({"AAA"}, {"AAA"}) == []


def test_backfill_uses_max_period(monkeypatch):
    from scripts import refresh_market as R
    captured = {}
    monkeypatch.setattr(R, "_connect", lambda: _NullConn())
    monkeypatch.setattr(R, "_load_tickers", lambda conn: ["X"])
    monkeypatch.setattr(R, "run_prices",
                        lambda conn, tks, **k: captured.update(k) or {"ok": 1, "failed": []})
    rc = R.main(["--backfill"])
    assert captured.get("period") == "max"   # backfill は全履歴を取りに行く
    assert rc == 0


def test_prices_default_period_is_10d(monkeypatch):
    from scripts import refresh_market as R
    captured = {}
    monkeypatch.setattr(R, "_connect", lambda: _NullConn())
    monkeypatch.setattr(R, "_load_tickers", lambda conn: ["X"])
    monkeypatch.setattr(R, "run_prices",
                        lambda conn, tks, **k: captured.update(k) or {"ok": 1, "failed": []})
    R.main(["--prices"])
    assert captured.get("period") == "10d"   # 通常更新は直近のみ
