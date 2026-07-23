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

def test_nisa_gate_order_production_403_before_killswitch():
    # production は killswitch ON でも 403（状態を探れない＝killswitch 評価前に遮断）
    assert insight.nisa_gate(True, "production", True, True) == ("403", "personal-only")
    # 未認証は最優先で 401
    assert insight.nisa_gate(False, "personal", True, True) == ("401", "unauthorized")
    # personal + 鍵無は 503
    assert insight.nisa_gate(True, "personal", False, True) == ("503", "not configured")
    # personal + 鍵あり + killswitch off は nisa-advice-disabled（403）
    assert insight.nisa_gate(True, "personal", True, False) == ("403", "nisa-advice-disabled")
    # 全通過
    assert insight.nisa_gate(True, "personal", True, True) == ("ok", None)


def test_coarsen_nisa_facts_clamps_over_contribution_and_no_yen_leak():
    # over-contribution: 125% of caps must clamp to bucket 100, never exceed the {0,25,50,75,100} set.
    raw = {"tsumitateThisYear": 1500000, "growthThisYear": 3000000, "tsumitateLifetime": 1500000,
           "growthLifetime": 15000000, "soldThisYearAtCost": 0,
           "annualTsumitateRemaining": 0, "annualGrowthRemaining": 0,
           "lifetimeRemaining": 0, "growthCapRemaining": 0,
           "monthlyToFillTsumitate": 0, "restoresYear": 2027}
    c = insight.coarsen_nisa_facts(raw)
    for k in ("annualTsumitateUsedBucket", "annualGrowthUsedBucket", "lifetimeUsedBucket", "growthCapUsedBucket"):
        assert c[k] in (0, 25, 50, 75, 100), (k, c[k])   # clamped — never 125
    assert c["annualTsumitateUsedBucket"] == 100 and c["growthCapUsedBucket"] == 100
    import json as _j
    blob = _j.dumps(c)
    for yen in ("1500000", "3000000", "15000000"):       # over-cap raw ¥ must not leak either
        assert yen not in blob, yen


def test_build_nisa_response_resolves_refs_and_injects_conditional():
    out = insight.build_eligible_products([_ts(1, "つみA")], [_gw("AAPL", "US", "conditional")])
    elig = insight.eligible_ids(out["products"])
    ai = {"headline": "h", "newMoneyNote": "新規のみ",
          "tsumitate_plan": {"note": "n", "refs": ["ts:1"]},
          "growth_candidates": {"note": "g", "refs": ["gw:AAPL"], "conditionalDisclaimer": ""},
          "taxable_note": "t", "cautions": ["損益通算不可"]}
    resp = insight.build_nisa_response({"text": "x"}, ai, "ok", out["products"], elig,
                                       {"tsumitate_truncated": False, "growth_truncated": False})
    byid = {r["id"]: r for r in resp["resolvedRefs"]}
    assert byid["ts:1"]["name"] == "つみA" and byid["gw:AAPL"]["status"] == "conditional"
    assert resp["ai"]["growth_candidates"]["conditionalDisclaimer"] == insight.NISA_CONDITIONAL_DISCLAIMER

def test_build_nisa_response_truncation_appends_caution():
    out = insight.build_eligible_products([_ts(1, "A")], [])
    elig = insight.eligible_ids(out["products"])
    ai = {"headline": "h", "newMoneyNote": "新規のみ", "tsumitate_plan": {"note": "n", "refs": ["ts:1"]},
          "growth_candidates": {"note": "", "refs": [], "conditionalDisclaimer": ""},
          "taxable_note": "", "cautions": ["損益通算不可"]}
    resp = insight.build_nisa_response({}, ai, "ok", out["products"], elig,
                                       {"tsumitate_truncated": True, "growth_truncated": False})
    assert any("網羅" in c or "全" in c for c in resp["ai"]["cautions"])   # 非網羅注記が追加される

def test_build_nisa_response_degrade_null_ai():
    resp = insight.build_nisa_response({"x": 1}, None, "degraded", [], set(), {"tsumitate_truncated": False, "growth_truncated": False})
    assert resp["ai"] is None and resp["resolvedRefs"] == [] and resp["aiStatus"] == "degraded"


# ---- planB Task11: E2E 捏造貫通ゼロ パイプライン受入テスト（offline）----
def test_e2e_fabrication_zero_and_conditional_injected():
    out = insight.build_eligible_products([_ts(1, "つみA"), _ts(2, "つみB")],
                                          [_gw("7203", "JP", "eligible"), _gw("AAPL", "US", "conditional")])
    products, elig = out["products"], insight.eligible_ids(out["products"])
    # 擬似 LLM 応答: 実在 ts:1 / gw:AAPL + 捏造 ts:999・gw:FAKE・prefix 不整合 gw:1
    llm = json.dumps({
        "headline": "新規資金の配分",
        "newMoneyNote": "新規資金の配分のみで売却指示ではありません",
        "tsumitate_plan": {"note": "つみたて枠を優先的に埋めます", "refs": ["ts:1", "ts:999"]},
        "growth_candidates": {"note": "成長枠の候補です", "refs": ["gw:AAPL", "gw:FAKE", "gw:1"], "conditionalDisclaimer": ""},
        "taxable_note": "課税口座は損益通算ができます",
        "cautions": ["損益通算・繰越控除ができません", "下振れ時の税務救済はありません"],
    }, ensure_ascii=False)
    parsed = insight.parse_nisa_ai(llm, elig)
    assert parsed is not None
    assert parsed["newMoneyNote"] == insight.NISA_NEW_MONEY_NOTE  # topFix #1: サーバ固定文注入（売却動詞ガードと非衝突）
    assert parsed["tsumitate_plan"]["refs"] == ["ts:1"]        # ts:999 捏造を drop
    assert parsed["growth_candidates"]["refs"] == ["gw:AAPL"]  # gw:FAKE 捏造 / gw:1 prefix 不整合を drop
    assert insight.nisa_prose_clean(parsed, {"tickers": set(), "names": []}) is True
    resp = insight.build_nisa_response({}, parsed, "ok", products, elig, out)
    ids = {r["id"] for r in resp["resolvedRefs"]}
    assert ids == {"ts:1", "gw:AAPL"}                          # 実在適格のみ解決（捏造ゼロ）
    assert {r["name"] for r in resp["resolvedRefs"]} == {"つみA", "AAPL社"}  # id→name join
    assert resp["ai"]["growth_candidates"]["conditionalDisclaimer"] == insight.NISA_CONDITIONAL_DISCLAIMER
    assert resp["ai"]["cautions"]                               # cautions 描画

def test_e2e_sell_verb_slips_in_degrades():
    out = insight.build_eligible_products([_ts(1, "つみA")], [])
    elig = insight.eligible_ids(out["products"])
    llm = json.dumps({
        "headline": "配分", "newMoneyNote": "新規資金のみ",
        "tsumitate_plan": {"note": "含み損の課税口座分を売却してNISAへ移し替えます", "refs": ["ts:1"]},
        "growth_candidates": {"note": "", "refs": [], "conditionalDisclaimer": ""},
        "taxable_note": "", "cautions": ["損益通算不可"]}, ensure_ascii=False)
    parsed = insight.parse_nisa_ai(llm, elig)
    assert parsed is not None                                   # 構造は通る
    assert insight.nisa_prose_clean(parsed, {"tickers": set(), "names": []}) is False  # 売却語で degrade


# ---- planB 全ブランチレビュー I1: advice.py/insight.py 逐語複製の検出器パリティ固定 ----
import inspect

def test_detectors_source_parity_advice_vs_insight():
    for name in ("_security_market_hit", "_market_terms"):
        a = inspect.getsource(getattr(advice, name))
        b = inspect.getsource(getattr(insight, name))
        assert a == b, name + " drifted between advice.py and insight.py"


# ---- planB 全ブランチレビュー C1: 第2抜け穴（cautions / conditionalDisclaimer）を閉じる受入テスト ----
def test_caution_with_product_name_degrades():
    TERMS2 = {"tickers": {"7203"}, "names": ["トヨタ自動車"]}
    # fabricated/real fund word in a caution must degrade (name leak)
    assert insight.nisa_prose_clean({"headline": "配分", "newMoneyNote": "x",
        "tsumitate_plan": {"note": "枠優先", "refs": []},
        "growth_candidates": {"note": "候補", "refs": [], "conditionalDisclaimer": ""},
        "taxable_note": "課税", "cautions": ["eMAXIS Slim を推奨します"]}, TERMS2) is False
    # real ticker in a caution must degrade
    assert insight.nisa_prose_clean({"headline": "配分", "newMoneyNote": "x",
        "tsumitate_plan": {"note": "枠優先", "refs": []},
        "growth_candidates": {"note": "候補", "refs": [], "conditionalDisclaimer": ""},
        "taxable_note": "課税", "cautions": ["7203を非課税枠に"]}, TERMS2) is False

def test_caution_with_legit_sell_education_stays_clean():
    TERMS2 = {"tickers": set(), "names": []}
    # sell-verb in a caution is legitimate education (no product name) -> NOT degraded
    assert insight.nisa_prose_clean({"headline": "配分", "newMoneyNote": "x",
        "tsumitate_plan": {"note": "枠優先", "refs": []},
        "growth_candidates": {"note": "候補", "refs": [], "conditionalDisclaimer": ""},
        "taxable_note": "課税", "cautions": ["近く売却予定の資産は非課税枠に不向きです"]}, TERMS2) is True

def test_conditional_disclaimer_llm_value_never_survives():
    import json as _j
    # LLM injects a malicious conditionalDisclaimer (sell-verb + fake fund); parse must drop it entirely.
    llm = _j.dumps({"headline": "h", "newMoneyNote": "x",
        "tsumitate_plan": {"note": "n", "refs": []},
        "growth_candidates": {"note": "g", "refs": [], "conditionalDisclaimer": "オルカンを売却して乗り換えを"},
        "taxable_note": "t", "cautions": ["損益通算不可"]}, ensure_ascii=False)
    parsed = insight.parse_nisa_ai(llm, set())
    assert parsed is not None
    assert parsed["growth_candidates"]["conditionalDisclaimer"] == ""   # LLM value dropped
    # and through build_nisa_response with NO conditional resolved -> still "" (never the LLM text)
    resp = insight.build_nisa_response({}, parsed, "ok", [], set(),
        {"tsumitate_truncated": False, "growth_truncated": False})
    assert resp["ai"]["growth_candidates"]["conditionalDisclaimer"] == ""
    assert "売却" not in resp["ai"]["growth_candidates"]["conditionalDisclaimer"]
