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
