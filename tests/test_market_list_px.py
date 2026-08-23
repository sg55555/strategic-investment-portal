"""W1 ポータル一目パック — list.py の価格集計 純関数テスト（DB 非依存）。

_px_row / _normalize_spark / _market_of / _market_asof のみを検証する。
SQL 自体は別レーン（実 DB での疎通は scratchpad/w1-payload-check.py）。
pytest でも `python tests/test_market_list_px.py` 直実行でも動く。
"""
import datetime
import importlib.util
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

_spec = importlib.util.spec_from_file_location(
    "market_list", os.path.join(ROOT, "api", "market", "list.py"))
market_list = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(market_list)

D = datetime.date(2026, 8, 21)


def _row(**kw):
    """(ticker,last,last_date,prev,base5,last_vol,avg20,hi52,lo52,spark,n) の既定行。"""
    base = dict(ticker="AAA", last=110.0, last_date=D, prev=100.0, base5=100.0,
                last_vol=2_000_000, avg20=1_000_000.0, hi52=120.0, lo52=80.0,
                spark=[100.0, 105.0, 110.0], n=300)
    base.update(kw)
    return (base["ticker"], base["last"], base["last_date"], base["prev"], base["base5"],
            base["last_vol"], base["avg20"], base["hi52"], base["lo52"], base["spark"], base["n"])


def test_px_row_basic():
    px = market_list._px_row(_row())
    assert px["last"] == 110.0
    assert px["date"] == "2026-08-21"
    assert px["c1"] == 10.0          # 110/100 - 1
    assert px["c5"] == 10.0
    assert px["vr"] == 2.0           # 2,000,000 / 1,000,000
    assert px["dh"] == -8.33         # 110/120 - 1 = -8.333...
    assert px["hi52"] == 120.0 and px["lo52"] == 80.0
    assert px["pos52"] == 75         # (110-80)/(120-80)


def test_px_row_returns_none_when_history_too_short():
    assert market_list._px_row(_row(n=5)) is None


def test_px_row_52w_fields_null_when_window_too_small():
    px = market_list._px_row(_row(n=59))
    assert px is not None
    assert px["hi52"] is None and px["lo52"] is None
    assert px["dh"] is None and px["pos52"] is None
    assert px["c1"] == 10.0          # 52週系以外は出る


def test_px_row_null_denominators():
    assert market_list._px_row(_row(prev=0))["c1"] is None
    assert market_list._px_row(_row(prev=None))["c1"] is None
    assert market_list._px_row(_row(base5=0))["c5"] is None
    assert market_list._px_row(_row(avg20=0))["vr"] is None
    assert market_list._px_row(_row(avg20=None))["vr"] is None


def test_px_row_flat_52w_range():
    px = market_list._px_row(_row(last=100.0, hi52=100.0, lo52=100.0))
    assert px["pos52"] == 50         # hi==lo は中央に置く
    assert px["dh"] == 0.0


def test_normalize_spark_endpoints_and_flat():
    assert market_list._normalize_spark([10.0, 20.0, 15.0]) == [0, 100, 50]
    assert market_list._normalize_spark([7.0, 7.0, 7.0]) == [50, 50, 50]
    assert market_list._normalize_spark([1.0]) is None
    assert market_list._normalize_spark([]) is None


def test_market_of_prefers_country_then_suffix():
    assert market_list._market_of("7203.T", {"country": "JP"}) == "JP"
    assert market_list._market_of("AAPL", {"country": "US"}) == "US"
    assert market_list._market_of("7203.T", {}) == "JP"      # country 欠落は末尾 .T
    assert market_list._market_of("AAPL", {}) == "US"


def test_market_asof_takes_max_date_per_market():
    stocks = {
        "7203.T": {"country": "JP", "px": {"date": "2026-08-20"}},
        "6758.T": {"country": "JP", "px": {"date": "2026-08-19"}},
        "AAPL": {"country": "US", "px": {"date": "2026-08-21"}},
        "EA": {"country": "US", "px": {"date": "2026-08-10"}},
        "NOPX": {"country": "US"},                            # px 無しは無視
    }
    assert market_list._market_asof(stocks) == {"JP": "2026-08-20", "US": "2026-08-21"}


if __name__ == "__main__":
    import sys
    import pytest
    sys.exit(pytest.main([__file__, "-v"]))
