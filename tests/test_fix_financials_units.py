"""fix_financials_units.py の純関数（対象行の判定）。DB には触らない。"""
from scripts.fix_financials_units import classify, is_raw_unit_leak, MILLION
from scripts.refresh_market import _FIN_COLS


def _row(ticker, fy, **vals):
    cols = [vals.get(c) for c in _FIN_COLS]
    return (ticker, fy, "FY", *cols)


def test_raw_leak_detected_per_currency():
    # 実際に起きた行（7203.T FY2026・円のまま）
    assert is_raw_unit_leak([50684952000000.0, 39918854000000.0, None], "JPY")
    # 正当な最大級は通す（MUFG 総資産 413兆円 = 4.13e8 百万円 / JPMorgan 4兆ドル = 4e6 百万ドル）
    assert not is_raw_unit_leak([413113501.0, 6838439.0], "JPY")
    assert not is_raw_unit_leak([4000000.0, 330000.0], "USD")
    # USD の小型株の生単位（売上 $1.2 億）も拾う＝USD はしきい値が低い
    assert is_raw_unit_leak([120000000.0, 40000000.0], "USD")
    # 通貨不明は JPY 側（緩い方）で判定
    assert is_raw_unit_leak([50684952000000.0], None)
    assert not is_raw_unit_leak([120000000.0], None)
    # 負値は絶対値で見る／NULL は無視
    assert is_raw_unit_leak([-50684952000000.0, None], "JPY")
    assert not is_raw_unit_leak([None, None], "JPY")


def test_classify_picks_only_leaked_rows_and_is_idempotent():
    rows = [
        _row("7203.T", 2026, net_sales=50684952000000.0, net_assets=39918854000000.0),   # 漏れ
        _row("7203.T", 2025, net_sales=48036704.0, net_assets=36878913.0),               # 百万単位（正常）
        _row("AAPL", 2025, net_sales=416161000000.0, current_assets=147957000000.0),      # 漏れ（USD）
        _row("JPM", 2025, non_current_assets=4000000.0, net_assets=330000.0),            # 正常（巨大だが百万単位）
    ]
    cur = {"7203.T": "JPY", "AAPL": "USD", "JPM": "USD"}
    targets = classify(rows, lambda t: cur.get(t))
    assert [(t["ticker"], t["fy"]) for t in targets] == [("7203.T", 2026), ("AAPL", 2025)]
    # 直した後の行（/1e6 済み）はもう対象にならない＝二度割りしない
    fixed = [(r[0], r[1], r[2], *[None if v is None else v / MILLION for v in r[3:]]) for r in rows]
    assert classify(fixed, lambda t: cur.get(t)) == []
