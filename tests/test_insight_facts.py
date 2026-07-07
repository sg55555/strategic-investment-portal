import importlib.util, json, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
_spec = importlib.util.spec_from_file_location("insight", os.path.join(ROOT, "api", "me", "insight.py"))
insight = importlib.util.module_from_spec(_spec); _spec.loader.exec_module(insight)
with open(os.path.join(HERE, "fixtures", "insight_facts_cases.json"), encoding="utf-8") as f:
    FIN_CASES = json.load(f)["finCases"]

def _approx(a, b):
    if a is None or b is None: return a == b
    return abs(a - b) < 1e-9

def test_python_finance_mirror():
    for c in FIN_CASES:
        f, e = c["fin"], c["expect"]
        d = insight.dupont(f)
        assert _approx(d["net_margin"], e["net_margin"]), c["name"] + " net_margin"
        assert _approx(d["asset_turnover"], e["asset_turnover"]), c["name"] + " asset_turnover"
        assert _approx(d["equity_multiplier"], e["equity_multiplier"]), c["name"] + " equity_multiplier"
        assert _approx(d["roe"], e["roe"]), c["name"] + " roe"
        assert _approx(insight.fcf(f), e["fcf"]), c["name"] + " fcf"
        assert _approx(insight.fcf_margin(f), e["fcf_margin"]), c["name"] + " fcf_margin"
        assert _approx(insight.cash_conversion(f), e["cash_conversion"]), c["name"] + " cash_conversion"

def test_stock_series_trend_direction():
    trend = {
        "2023": {"net_sales":1000000,"net_income":80000,"net_assets":500000,"current_assets":600000,"non_current_assets":400000,"operating_cf":90000,"investing_cf":-20000},
        "2024": {"net_sales":1000000,"net_income":100000,"net_assets":520000,"current_assets":600000,"non_current_assets":400000,"operating_cf":100000,"investing_cf":-20000},
    }
    out = insight.stock_series(trend)
    assert [s["year"] for s in out["series"]] == [2023, 2024]
    assert out["latest"]["year"] == 2024
    # roe 2023≈16.0 → 2024≈19.23 improving
    assert out["direction"]["roe"] == "improving"

def test_stock_series_empty():
    out = insight.stock_series({})
    assert out["series"] == [] and out["latest"] is None
    assert out["direction"] == {"roe": None, "fcf_margin": None, "cash_conversion": None}

def test_percentile_and_median():
    assert insight.median([3, 1, 2]) == 2
    assert insight.median([]) is None
    # x=30 が [10,20,30,40] の中で midrank → 上位 (2.5/4)*100 = 62.5
    pr = insight.percentile_rank([10, 20, 30, 40], 30)
    assert abs(pr - 62.5) < 1e-9

def test_peer_context():
    rows = [
        {"ticker":"A","industry":"車","per":10,"pbr":1.0,"net_income":100,"net_sales":1000,"net_assets":500,"operating_income":150},
        {"ticker":"B","industry":"車","per":20,"pbr":2.0,"net_income":50,"net_sales":1000,"net_assets":500,"operating_income":80},
        {"ticker":"C","industry":"車","per":30,"pbr":3.0,"net_income":10,"net_sales":1000,"net_assets":500,"operating_income":20},
        {"ticker":"D","industry":"薬","per":40,"pbr":4.0,"net_income":5,"net_sales":1000,"net_assets":500,"operating_income":10},
    ]
    pc = insight.peer_context("A", "JP", rows)
    assert pc["market_n"] == 4
    assert pc["sector"] == "車" and pc["sector_n"] == 3
    # A の roe=20 は分布[20,10,2,1]で midrank: below=3,equal=1 → (3+0.5)/4*100 = 87.5（100 ではない）
    assert abs(pc["roe_percentile"] - 87.5) < 1e-9
    # per=10 は[10,20,30,40]で最安→midrank (0.5/4)*100=12.5
    assert abs(pc["per_percentile"] - 12.5) < 1e-9

def test_build_facts_shape_and_no_personal_keys():
    meta = {"ticker":"7203.T","name":"トヨタ","industry":"車","currency":"JPY","market":"JP","per":10.2,"pbr":1.1}
    trend = {"2024":{"net_sales":1000000,"net_income":100000,"net_assets":500000,"current_assets":600000,"non_current_assets":400000,"operating_cf":90000,"investing_cf":-20000}}
    peer = {"market_n":4,"roe_percentile":100,"sector":"車","sector_n":3,"sector_median":{"roe":9.8}}
    facts = insight.build_facts(meta, trend, peer, [{"ticker":"6758.T","per":18}], "中立コメント")
    assert facts["ticker"] == "7203.T" and facts["market"] == "JP"
    assert facts["dupont_latest"]["year"] == 2024
    assert facts["peer"]["market_n"] == 4
    assert facts["schema_version"] == 1
    import json as _j
    blob = _j.dumps(facts, ensure_ascii=False)
    for forbidden in ("buffer", "satellite", "monthlyExpense", "core_amount", "goals"):
        assert forbidden not in blob, "personal money key leaked: " + forbidden

def test_facts_hash_stable():
    f = {"a": 1, "b": 2}
    assert insight.facts_hash(f) == insight.facts_hash({"b": 2, "a": 1})  # sort_keys
