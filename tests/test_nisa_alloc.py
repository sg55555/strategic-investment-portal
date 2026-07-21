import importlib.util, json, os
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)

def _load(name, rel):
    spec = importlib.util.spec_from_file_location(name, os.path.join(ROOT, *rel))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod); return mod

advice = _load("advice", ("api", "me", "advice.py"))
insight = _load("insight", ("api", "me", "insight.py"))

with open(os.path.join(HERE, "fixtures", "advice_facts_cases.json"), encoding="utf-8") as f:
    CASES = json.load(f)["cases"]
NISA_CASES = [c for c in CASES if c["name"].startswith("nisa")]

def _now(c):
    if c.get("nowMs") is not None: return c["nowMs"]
    iso = c.get("nowIso")
    if iso:
        import datetime as dt
        return dt.datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000
    return 0

RAW_FIELDS = ("tsumitateThisYear", "growthThisYear", "tsumitateLifetime", "growthLifetime",
              "soldThisYearAtCost", "annualTsumitateRemaining", "annualGrowthRemaining",
              "lifetimeRemaining", "growthCapRemaining", "monthlyToFillTsumitate", "restoresYear")

def test_nisa_raw_parity_advice_vs_insight():
    assert NISA_CASES, "no nisa fixture cases"
    for c in NISA_CASES:
        a = advice._nisa_raw(c["state"], _now(c), c.get("investment"))
        b = insight._nisa_raw(c["state"], _now(c), c.get("investment"))
        assert (a is None) == (b is None), c["name"] + " None-parity"
        if a is None: continue
        for k in RAW_FIELDS:
            assert a[k] == b[k], "%s field %s: advice=%r insight=%r" % (c["name"], k, a[k], b[k])

def test_nisa_constants_parity():
    for k in ("NISA_ANNUAL_TSUMITATE","NISA_ANNUAL_GROWTH","NISA_ANNUAL_TOTAL","NISA_LIFETIME",
              "NISA_GROWTH_LIFETIME_CAP","NISA_MIN_YEAR","NISA_HISTORY_MAX"):
        assert getattr(advice, k) == getattr(insight, k), k
