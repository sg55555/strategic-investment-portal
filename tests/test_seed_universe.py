import pytest
from scripts.seed_universe import parse_universe_csv


def test_parse_skips_comments_and_validates():
    text = ("ticker,company_name,industry,currency,country,type\n"
            "# コメント行\n"
            "\n"
            "7203.T,トヨタ自動車,自動車・輸送機器,JPY,JP,stock\n"
            "AAPL,Apple,テクノロジー・家電,USD,US,stock\n")
    rows = parse_universe_csv(text)
    assert len(rows) == 2
    assert rows[0]["ticker"] == "7203.T" and rows[0]["country"] == "JP"
    assert rows[1]["ticker"] == "AAPL"


def test_parse_missing_column_raises():
    with pytest.raises(ValueError):
        parse_universe_csv("ticker,company_name\nAAPL,Apple\n")
