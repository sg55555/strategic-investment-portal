import math
import pytest
from scripts.refresh_market import map_ohlcv_rows, map_info_fields, map_financials_rows


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
