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


import json as _json
ELIG = {"ts:1", "ts:2", "gw:7203", "gw:AAPL"}
def _mk(**over):
    base = {"headline": "配分の考え方", "newMoneyNote": "新規資金の配分のみで売却指示ではありません",
            "tsumitate_plan": {"note": "つみたて枠を優先", "refs": ["ts:1"]},
            "growth_candidates": {"note": "成長枠候補", "refs": ["gw:7203"]},
            "taxable_note": "課税口座は損益通算可", "cautions": ["損益通算不可", "下振れ時の税務救済なし"]}
    base.update(over); return _json.dumps(base, ensure_ascii=False)

def test_parse_drops_nonmember_and_wrong_prefix_refs():
    p = insight.parse_nisa_ai(_mk(tsumitate_plan={"note": "x", "refs": ["ts:1", "ts:999", "gw:7203"]},
                                  growth_candidates={"note": "y", "refs": ["gw:AAPL", "gw:NOPE", "ts:1"]}), ELIG)
    assert p["tsumitate_plan"]["refs"] == ["ts:1"]      # ts:999 非member / gw:7203 prefix不整合を drop
    assert p["growth_candidates"]["refs"] == ["gw:AAPL"] # gw:NOPE 非member / ts:1 prefix不整合を drop

def test_parse_missing_cautions_degrades():
    assert insight.parse_nisa_ai(_mk(cautions=[]), ELIG) is None            # cautions 欠落は degrade

def test_parse_newmoneynote_is_server_injected_constant():
    # topFix #1: newMoneyNote は LLM 出力を無視してサーバ固定文を注入＝空/別文言でも degrade しない。
    p = insight.parse_nisa_ai(_mk(newMoneyNote=""), ELIG)
    assert p is not None and p["newMoneyNote"] == insight.NISA_NEW_MONEY_NOTE
    p2 = insight.parse_nisa_ai(_mk(newMoneyNote="LLMの勝手な文言"), ELIG)
    assert p2 is not None and p2["newMoneyNote"] == insight.NISA_NEW_MONEY_NOTE

def test_parse_char_overflow_degrades_not_truncated():
    assert insight.parse_nisa_ai(_mk(headline="あ" * 61), ELIG) is None            # headline>60
    assert insight.parse_nisa_ai(_mk(taxable_note="い" * 241), ELIG) is None        # note>240
    assert insight.parse_nisa_ai(_mk(cautions=["う" * 81, "ok"]), ELIG) is None     # caution>80

def test_parse_valid_passes():
    p = insight.parse_nisa_ai(_mk(), ELIG)
    assert p is not None and p["tsumitate_plan"]["refs"] == ["ts:1"] and p["cautions"]


TERMS = {"tickers": {"7203", "AAPL"}, "names": ["トヨタ自動車"]}
def _parsed(**o):
    base = {"headline": "配分", "newMoneyNote": "新規資金のみ",
            "tsumitate_plan": {"note": "枠を優先", "refs": []},
            "growth_candidates": {"note": "候補", "refs": [], "conditionalDisclaimer": ""},
            "taxable_note": "課税口座", "cautions": ["損益通算不可"]}
    base.update(o); return base

def test_prose_clean_passes_neutral():
    assert insight.nisa_prose_clean(_parsed(), TERMS) is True

def test_prose_ticker_or_name_hit_degrades():
    assert insight.nisa_prose_clean(_parsed(taxable_note="7203を課税口座で"), TERMS) is False   # 裸ticker
    assert insight.nisa_prose_clean(_parsed(headline="トヨタ自動車を軸に"), TERMS) is False       # 社名

def test_prose_fund_name_token_degrades():
    assert insight.nisa_prose_clean(_parsed(growth_candidates={"note": "オルカンインデックスが良い", "refs": [], "conditionalDisclaimer": ""}), TERMS) is False
    assert insight.nisa_prose_clean(_parsed(tsumitate_plan={"note": "このファンドを推す", "refs": []}), TERMS) is False

def test_prose_sell_verb_degrades():
    assert insight.nisa_prose_clean(_parsed(taxable_note="含み損の銘柄を売却して"), TERMS) is False   # taxable_note は走査対象
    assert insight.nisa_prose_clean(_parsed(tsumitate_plan={"note": "課税口座からNISAへ移し替え", "refs": []}), TERMS) is False  # tsumitate note も走査対象

def test_prose_clean_ignores_server_fixed_fields():
    # topFix #1: newMoneyNote 固定文・cautions は走査対象外＝売却/移し替え語を含んでも degrade しない（恒常 degrade 回避）。
    assert insight.nisa_prose_clean(_parsed(newMoneyNote="新規資金の配分のみで、既存保有の売却・移し替え指示ではありません。"), TERMS) is True
    assert insight.nisa_prose_clean(_parsed(cautions=["近く売却予定の資産は非課税枠に不向きです"]), TERMS) is True


def test_coarsen_nisa_facts_buckets_and_drops_raw_yen():
    raw = {"tsumitateThisYear": 700000, "growthThisYear": 0, "tsumitateLifetime": 700000,
           "growthLifetime": 0, "soldThisYearAtCost": 123456,
           "annualTsumitateRemaining": 500000, "annualGrowthRemaining": 2400000,
           "lifetimeRemaining": 17300000, "growthCapRemaining": 12000000,
           "monthlyToFillTsumitate": 55000, "restoresYear": 2027}
    c = insight.coarsen_nisa_facts(raw)
    # bucket 化された leaf は 0/25/50/75/100 のみ
    for k in ("annualTsumitateUsedBucket", "lifetimeUsedBucket", "growthCapUsedBucket"):
        assert c[k] in (0, 25, 50, 75, 100), (k, c[k])
    # 生¥ leaf は非保存（監査指紋を残さない）
    assert "monthlyToFillTsumitate" not in c and "soldThisYearAtCost" not in c
    assert "annualTsumitateRemaining" not in c and "lifetimeRemaining" not in c
    # restoresYear（年・非¥）は透過
    assert c["restoresYear"] == 2027
    # 生¥そのものが値として現れない
    import json as _j
    assert "123456" not in _j.dumps(c) and "700000" not in _j.dumps(c) and "17300000" not in _j.dumps(c)

def test_coarsen_nisa_none_is_none():
    assert insight.coarsen_nisa_facts(None) is None
