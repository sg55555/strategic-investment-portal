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

def _ts(i, name, cat="index"): return {"id": i, "fund_name": name, "mgmt_company": "運用A", "category": cat, "index_name": "TOPIX"}
def _gw(tk, mkt="JP", st="eligible"): return {"ticker": tk, "company_name": tk+"社", "industry": "情報", "type": "stock", "market": mkt, "nisa_growth_status": st}

def test_build_eligible_ids_and_prefix():
    out = insight.build_eligible_products([_ts(1, "A"), _ts(2, "B")], [_gw("7203"), _gw("AAPL", "US", "conditional")])
    ids = insight.eligible_ids(out["products"])
    assert "ts:1" in ids and "ts:2" in ids and "gw:7203" in ids and "gw:AAPL" in ids
    byid = {p["id"]: p for p in out["products"]}
    assert byid["ts:1"]["kind"] == "tsumitate" and byid["ts:1"]["name"] == "A"
    assert byid["gw:AAPL"]["status"] == "conditional" and byid["gw:AAPL"]["extra"]["market"] == "US"

def test_build_eligible_truncation_deterministic():
    ts_rows = [_ts(i, "F%02d" % i) for i in range(70)]      # 70 > cap 60
    out = insight.build_eligible_products(ts_rows, [], caps=(60, 60))
    tprods = [p for p in out["products"] if p["kind"] == "tsumitate"]
    assert len(tprods) == 60 and out["tsumitate_truncated"] is True
    assert [p["name"] for p in tprods] == sorted(p["name"] for p in tprods)   # fund_name 昇順で截断

def test_build_eligible_category_then_name_order():
    out = insight.build_eligible_products(
        [_ts(1, "Zzz", "index"), _ts(2, "Aaa", "active"), _ts(3, "Mmm", "etf")], [], caps=(2, 60))
    names = [p["name"] for p in out["products"] if p["kind"] == "tsumitate"]
    assert names == ["Zzz", "Aaa"] and out["tsumitate_truncated"] is True   # index(Zzz)→active(Aaa) が etf(Mmm)より優先

def test_sys_nisa_alloc_anchors_and_negative_constraint():
    s = insight.SYS_NISA_ALLOC
    assert "20.315" in s                       # 税率一律アンカー(§8)
    assert "1800" in s and "1200" in s         # 生涯枠1800万/成長内数1200万
    assert "損益通算" in s and "繰越" in s        # 損益通算・繰越控除不可
    assert "外国税額控除" in s                    # US 二重課税アンカー
    assert "売却" in s and "移し替え" in s         # 売却 negative constraint(§13)
    assert "新規資金" in s                        # 助言は新規資金配分のみ
    assert '"cautions"' in s                      # 出力スキーマ強制（cautions は LLM 生成）
    assert '"newMoneyNote"' not in s              # topFix #1: newMoneyNote はサーバ固定文＝LLM 非生成

def test_build_nisa_user_injects_counts_and_ids_not_prose_names():
    out = insight.build_eligible_products([_ts(1, "実在ファンド名")], [_gw("7203")])
    raw = {"annualTsumitateRemaining": 500000, "annualGrowthRemaining": 2400000, "lifetimeRemaining": 18000000,
           "growthCapRemaining": 12000000, "monthlyToFillTsumitate": 50000, "restoresYear": 2027,
           "tsumitateThisYear": 700000, "growthThisYear": 0, "tsumitateLifetime": 700000,
           "growthLifetime": 0, "soldThisYearAtCost": 0}
    user = insight._build_nisa_user(raw, out["products"], {"tsumitate": 360, "growth": 190})
    assert "ts:1" in user and "gw:7203" in user      # id は渡る
    assert "360" in user                              # 可変本数注入
