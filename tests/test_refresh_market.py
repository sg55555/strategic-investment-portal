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


import json
from pathlib import Path

# 実物の yfinance 出力（2026-08-25 録音・生の通貨単位・直近2期）。架空ラベルで書いたテストは
# 本番で全滅していても緑になる（実際に流動資産が全行 null のまま1ヶ月気づかなかった）ので、
# ラベルは必ずこの録音と突き合わせる。yfinance のラベルが変わったらこのファイルを録音し直す。
_YF_SAMPLE = json.loads((Path(__file__).parent / "fixtures" / "yf_financials_sample.json").read_text())


def _cols():
    from scripts.refresh_market import _FIN_COLS
    return {c: i + 3 for i, c in enumerate(_FIN_COLS)}   # (ticker, fy, period) の後に並ぶ


def test_map_financials_rows_real_labels_and_million_units():
    """実物ラベルが全部拾われ、値が百万単位に換算される（テーブル規約＝百万円/百万ドル）。"""
    fin = {int(fy): items for fy, items in _YF_SAMPLE["tickers"]["7203.T"].items()}
    rows = map_financials_rows("7203.T", fin)
    by_fy = {r[1]: r for r in rows}
    r, c = by_fy[2026], _cols()
    assert r[c["net_sales"]] == 50684952.0             # 50,684,952,000,000 円 → 百万円
    assert r[c["current_assets"]] == 42824081.0        # 旧ラベル "Total Current Assets" では拾えなかった列
    assert r[c["current_liabilities"]] == 33605019.0
    assert r[c["non_current_liabilities"]] == 30897244.0
    assert r[c["non_current_assets"]] is not None and r[c["net_assets"]] is not None
    assert r[c["operating_cf"]] == 5472920.0
    assert r[c["ordinary_income"]] is None             # yfinance に経常利益は無い＝欠損は捏造しない
    # 実物ラベル15本のうち欠損なく拾えた列数（US も同じ写像で通ること）
    a = map_financials_rows("AAPL", {int(fy): it for fy, it in _YF_SAMPLE["tickers"]["AAPL"].items()})
    ra = {r[1]: r for r in a}[2025]
    assert ra[c["net_sales"]] == 416161.0 and ra[c["current_assets"]] == 147957.0
    assert all(r[-1] == "yfinance" for r in rows)     # source タグ


def test_map_financials_rows_accepts_legacy_labels():
    """旧 yfinance のラベル（"Total Current Assets" 系）でも同じ列に落ちる（版ずれの予備）。"""
    rows = map_financials_rows("X", {2025: {"Total Current Assets": 5e8, "Total Current Liabilities": 2e8,
                                             "Total Non Current Liabilities": 3e8, "Total Revenue": 1e9}})
    r, c = rows[0], _cols()
    assert r[c["current_assets"]] == 500.0 and r[c["current_liabilities"]] == 200.0
    assert r[c["non_current_liabilities"]] == 300.0 and r[c["net_sales"]] == 1000.0


def test_map_financials_rows_rejects_raw_unit_leak():
    """換算後もなお桁違い（百万単位で 1e9 以上＝1000兆円/1兆ドル超）なら書かずに落とす。
    どの企業も到達しない水準なので、これは「生単位が漏れた」以外に説明がつかない。"""
    with pytest.raises(ValueError):
        map_financials_rows("X", {2025: {"Total Revenue": 5e16}})   # 換算後 5e10 百万


def test_map_financials_rows_tags_source_and_keeps_none():
    rows = map_financials_rows("MSFT", {2025: {"Total Revenue": 1e9, "Gross Profit": 3e8}})
    r, c = rows[0], _cols()
    assert r[0] == "MSFT" and r[1] == 2025 and r[2] == "FY"
    assert r[c["net_sales"]] == 1000.0 and r[c["gross_profit"]] == 300.0
    assert r[c["net_income"]] is None                   # 無いラベルは None のまま（0 で埋めない）
    assert r[-1] == "yfinance"


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
