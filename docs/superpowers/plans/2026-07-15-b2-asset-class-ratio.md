# B#2 資産クラス比率 実装プラン

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お金の司令室（#money-view）に「投資を7資産クラスでどう割るか」を年齢グライドパス目標＋現状ドリフトで可視化する層1機能を、money-rules.js↔advice.py 鏡像パリティを保って追加する。

**Architecture:** 純関数は `money-rules.js`（UMD-lite・`var`/function 体裁）、その Python 鏡像は `api/me/advice.py`、パリティは共有 fixture `tests/fixtures/advice_facts_cases.json` で byte 一致固定。UI は `money.js`（`window.MCC` IIFE）＋`money.css`（theme D）で、業務 math は一切書かず純関数を呼ぶ。視覚は `scratchpad/b2-asset-class-mock.html`（実機確認済）が参照実装。

**Tech Stack:** Vanilla JS（ES5-ish UMD）、Python 3、node --test、pytest、CSS（theme D ネオン）。

## Global Constraints

- **spec が唯一の真実**: `docs/superpowers/specs/2026-07-14-asset-class-ratio-design.md`（decision-complete・敵対検証2ラウンド反映済）。各タスクは着手前に該当 § を読む。
- **版**: `CURRENT_VERSION=2`・`RULES_VERSION=2` **据え置き**／`FACTS_SCHEMA_VERSION`（money-rules.js:15）と `SCHEMA_VERSION`（advice.py:29）を **3→4 に両側同時 bump**。
- **年齢A案**: age は公開教育値。`riskAssetPct`/`targetPct` をトップレベル両モードで出す。**ageBucket フィールドは持たない**。portfolio を露わにする `currentPct`/`driftPct` のみ coarsen。
- **7クラス allowlist 順（タイブレーク基準・不変）**: `cash, jpEq, devEq, emEq, bond, reit, gold`（spec §2.1）。
- **鏡像同時変更**: money-rules.js を変えたら同ターンで advice.py 鏡像＋fixture を同方向に変える。
- **業務 math 禁止 in money.js**: 計算は必ず money-rules.js 純関数経由。
- **既存回帰を壊さない**: `cf-1`(バッファ→コア)/`cf-2`(trend rb<=0 絶対比較)/`par-2`(単一丸め) の fixture ケース維持。`cashflowDerived`/`_cashflow_derived` 無改変。
- **新 Vercel 関数ゼロ**（Hobby 枠 11/12 維持）＝advice.py 拡張で収める。
- **テスト実行**: `node --test tests/*.test.js`（**末尾スラッシュ不可**＝本 Node 環境 gotcha）＋`python -m pytest tests/test_advice_facts.py -q`。ローカルは uv+.venv（`.venv/bin/python`）。
- **面禁則**: UI は線/グロー/縁のみ（§6 の alpha0.4+screen+saturate1.55/brightness1.5+glow の発光塗りは許容例外）。
- **免責**: 既存 `DISCLAIMER`（money-rules.js:17）踏襲。production は %のみ・生額¥/個別銘柄名を出さない。

---

## File Structure

- `money-rules.js`（863行・修正）: 新純関数群を `cfNum`(:418) 付近と `modeAFacts`(:656) に追加。`defaultState`(:85)/`migrate`(:115) に state 3フィールド。window export ブロック(:842) に公開関数追加。
- `api/me/advice.py`（修正）: 上記の Python 鏡像を `_migrate`(:223)/`mode_a_facts`(:630)/`coarsen_facts`(:828) に追加。
- `money.js`（修正）: `assetClassSection(vm)` を新設し `render()` の `roadmapSection` 直後に挿入。`_JUMP_TARGETS`(:824) に `assets` 追加。
- `money.css`（修正）: `.mcc-ac-*` を mock の `<style>` から移設（baseline + `[data-theme="D"] #money-view` 二層）。
- `tests/money-rules.test.js`（修正）: 純関数 unit。
- `tests/test_advice_facts.py`（修正）: Python 鏡像 unit＋共有 fixture パリティ。
- `tests/fixtures/advice_facts_cases.json`（3781行・修正）: 既存46ケースの `schemaVersion` 3→4＋新 assetClasses ケース(a)-(m)。
- 検証ハーネス（scratchpad・非追跡でよい）: `scratchpad/b2-parity-fuzz.js`、`scratchpad/b2-ui-smoke.js`。

---

## Task 1: state 層（scalar coerce・normalizeAssetHoldings・birthYear・assetSource）＋ Python 鏡像

**Files:**
- Modify: `money-rules.js`（`normalizeReserve`:57 と `normalizeAnchor`:107 付近に新関数、`defaultState`:85 と `migrate`:115 に3フィールド、export:842）
- Modify: `api/me/advice.py`（`_num`:155 付近に `_num_scalar`、`_migrate`:223 に3フィールド鏡像）
- Test: `tests/money-rules.test.js`（新 describe "assetHoldings state"）、`tests/test_advice_facts.py`（新 test 関数）

**Interfaces:**
- Produces（JS）:
  - `numScalar(v) -> number`（**配列/オブジェクト/NaN/null/負値→0**。number は `isFinite(v)&&v>=0?v:0`。数値文字列は `isFinite(+v)&&+v>=0?+v:0`。それ以外 0）
  - `normalizeAssetHoldings(raw) -> {buffer:{cash,jpEq,devEq,emEq,bond,reit,gold}, core:{...}, satellite:{...}}`（**常に完全骨格**・各値 numScalar・未知キー破棄・非オブジェクト入力→全0骨格）
  - `defaultState()` に追加: `birthYear:0`, `assetHoldings:<全0骨格>`, `assetSource:"manual"`
  - `migrate(raw)` に追加: `birthYear` を整数 coerce（有限・整数・0<=by<=9999 以外は 0。**上限の意味検証は Task2 glidePath の age gate が担う**）、`assetHoldings:normalizeAssetHoldings(raw.assetHoldings)`, `assetSource: raw.assetSource==="ledger"?"ledger":"manual"`
- Produces（Py 鏡像・byte 一致）: `_num_scalar(v)`, `_normalize_asset_holdings(raw)`, `_migrate` に同3フィールド。
- 7クラスキー配列は単一定数 `ASSET_CLASSES = ["cash","jpEq","devEq","emEq","bond","reit","gold"]`（JS）／`ASSET_CLASSES = [...]`（Py）を新設し全 Task で参照。

- [ ] **Step 1: 失敗するテストを書く（JS numScalar / normalizeAssetHoldings）**

```javascript
// tests/money-rules.test.js に追加
const R = require("../money-rules.js");
test("numScalar: scalar受理・配列/オブジェクトは0（_num([5])との発散を排除）", () => {
  assert.equal(R.numScalar(5), 5);
  assert.equal(R.numScalar("5"), 5);
  assert.equal(R.numScalar([5]), 0);        // ← num([5])=5 だが numScalar=0
  assert.equal(R.numScalar(["5"]), 0);
  assert.equal(R.numScalar(-3), 0);
  assert.equal(R.numScalar(NaN), 0);
  assert.equal(R.numScalar(null), 0);
  assert.equal(R.numScalar({a:1}), 0);
});
test("normalizeAssetHoldings: 常に3バケツ×7クラス完全骨格・未知キー破棄", () => {
  const h = R.normalizeAssetHoldings({core:{jpEq:100,XXX:9}, junk:1});
  assert.deepEqual(Object.keys(h), ["buffer","core","satellite"]);
  assert.deepEqual(Object.keys(h.core).sort(), ["bond","cash","devEq","emEq","gold","jpEq","reit"]);
  assert.equal(h.core.jpEq, 100);
  assert.equal(h.core.cash, 0);
  assert.equal(h.core.XXX, undefined);
  assert.deepEqual(R.normalizeAssetHoldings([1,2,3]), R.normalizeAssetHoldings(null)); // 非オブジェクト→空骨格
});
```

- [ ] **Step 2: 実行して失敗を確認**

Run: `node --test tests/money-rules.test.js`
Expected: FAIL（`R.numScalar is not a function`）

- [ ] **Step 3: money-rules.js に実装**

```javascript
// ASSET_CLASSES は num/clamp/r 付近（:32 周辺）に
var ASSET_CLASSES = ["cash","jpEq","devEq","emEq","bond","reit","gold"];
var ASSET_BUCKETS = ["buffer","core","satellite"];
function numScalar(v) {
  if (typeof v === "number") return isFinite(v) && v >= 0 ? v : 0;
  if (typeof v === "string") { var n = +v; return isFinite(n) && n >= 0 ? n : 0; }
  return 0;
}
function normalizeAssetHoldings(raw) {
  var src = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  var out = {};
  for (var b = 0; b < ASSET_BUCKETS.length; b++) {
    var bk = ASSET_BUCKETS[b], inner = (src[bk] && typeof src[bk] === "object" && !Array.isArray(src[bk])) ? src[bk] : {};
    out[bk] = {};
    for (var c = 0; c < ASSET_CLASSES.length; c++) out[bk][ASSET_CLASSES[c]] = numScalar(inner[ASSET_CLASSES[c]]);
  }
  return out;
}
function normalizeBirthYear(v) {
  var n = Number(v);
  if (!isFinite(n)) return 0;
  n = Math.floor(n);
  return (n >= 1900 && n <= 9999) ? n : 0; // 意味的な妥当性(未来年/2桁typo)は glidePath の age gate が担う
}
```
`defaultState()`（:85 の return object）に `birthYear: 0, assetHoldings: normalizeAssetHoldings(null), assetSource: "manual",` を追加。
`migrate(raw)`（:115 の return object）に `birthYear: normalizeBirthYear(raw.birthYear), assetHoldings: normalizeAssetHoldings(raw.assetHoldings), assetSource: raw.assetSource === "ledger" ? "ledger" : "manual",` を追加。
export ブロック(:842)に `numScalar: numScalar, normalizeAssetHoldings: normalizeAssetHoldings, ASSET_CLASSES: ASSET_CLASSES,` を追加。

- [ ] **Step 4: 実行して合格を確認**

Run: `node --test tests/money-rules.test.js`
Expected: PASS

- [ ] **Step 5: Python 鏡像 + テスト**

```python
# advice.py の _num(:155) 付近
ASSET_CLASSES = ["cash", "jpEq", "devEq", "emEq", "bond", "reit", "gold"]
ASSET_BUCKETS = ["buffer", "core", "satellite"]

def _num_scalar(v):
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)):
        return v if math.isfinite(v) and v >= 0 else 0
    if isinstance(v, str):
        try:
            n = float(v)
        except ValueError:
            return 0
        return n if math.isfinite(n) and n >= 0 else 0
    return 0

def _normalize_asset_holdings(raw):
    src = raw if isinstance(raw, dict) else {}
    out = {}
    for bk in ASSET_BUCKETS:
        inner = src.get(bk) if isinstance(src.get(bk), dict) else {}
        out[bk] = {c: _num_scalar(inner.get(c)) for c in ASSET_CLASSES}
    return out

def _normalize_birth_year(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(n):
        return 0
    n = int(n // 1)
    return n if 1900 <= n <= 9999 else 0
```
`_migrate`(:223) の返す dict に `birthYear`/`assetHoldings`/`assetSource` を同3フィールドで追加。`import math` が無ければ追加。
```python
# tests/test_advice_facts.py に追加
def test_num_scalar_parity():
    import advice
    assert advice._num_scalar([5]) == 0        # JS numScalar([5]) と一致（num([5])=5 の発散を排除）
    assert advice._num_scalar("5") == 5
    assert advice._num_scalar(-3) == 0
    assert advice._num_scalar(True) == 0
def test_normalize_asset_holdings_skeleton():
    import advice
    h = advice._normalize_asset_holdings({"core": {"jpEq": 100, "XXX": 9}})
    assert set(h.keys()) == {"buffer", "core", "satellite"}
    assert set(h["core"].keys()) == set(advice.ASSET_CLASSES)
    assert h["core"]["jpEq"] == 100 and h["core"]["cash"] == 0 and "XXX" not in h["core"]
```

- [ ] **Step 6: Python テスト実行**

Run: `.venv/bin/python -m pytest tests/test_advice_facts.py -q`（PYTHONPATH に advice.py の親を通す＝`PYTHONPATH=api/me`）
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add money-rules.js api/me/advice.py tests/money-rules.test.js tests/test_advice_facts.py
git commit -m "feat(b2): state層 numScalar/normalizeAssetHoldings/birthYear + Python鏡像"
```

---

## Task 2: グライドパス＋地域内訳（core 目標の心臓部・currentYear degrade・端数吸収）

**Files:** Modify `money-rules.js`（`cfNum`:418 付近に純関数）／`api/me/advice.py`（鏡像）／Test 両テスト。

**Interfaces:**
- `glidePath(birthYear, nowMs) -> {configured:true, age, R, D}` または `{configured:false}`
  - currentYear は **UTC**: JS `var nd=new Date(num(nowMs)); if(!isFinite(nd.getTime())) return {configured:false}; var cy=nd.getUTCFullYear();`／Py `try: cy=datetime.fromtimestamp(_num(now_ms)/1000, tz=timezone.utc).year except (OverflowError,OSError,ValueError): return {"configured":False}`
  - `age = cy - birthYear`（Math.floor 不要）
  - gate: `birthYear<=0 || !isFinite(age) || age<0 || age>120` → `{configured:false}`
  - `R = clamp(110-age,30,90)`, `D = 100-R`
- `regionBreakdown(R) -> {cash:0, jpEq, devEq, emEq, bond, reit, gold}`（整数・Σ=100・端数を argmax(cash除く6)へ・タイは ASSET_CLASSES 順先勝ち）

- [ ] **Step 1: 失敗テスト（glidePath 境界・未設定・巨大nowMs degrade）**

```javascript
test("glidePath: 40歳→R70/D30、未設定/未来/巨大nowMs→configured:false", () => {
  const ms2026 = Date.UTC(2026, 6, 15); // 2026-07-15
  assert.deepEqual(R.glidePath(1986, ms2026), {configured:true, age:40, R:70, D:30});
  assert.deepEqual(R.glidePath(1996, ms2026), {configured:true, age:30, R:80, D:20});
  assert.deepEqual(R.glidePath(1946, ms2026), {configured:true, age:80, R:30, D:70});
  assert.equal(R.glidePath(0, ms2026).configured, false);       // 未設定
  assert.equal(R.glidePath(2100, ms2026).configured, false);    // 未来（age<0）
  assert.equal(R.glidePath(90, ms2026).configured, false);      // 2桁typo（age>120）
  assert.equal(R.glidePath(1986, 1e300).configured, false);     // 巨大nowMs（NaN age を !isFinite で捕捉）
});
test("regionBreakdown: R70で Σ=100・bond=D近似・タイブレークは allowlist順", () => {
  const b = R.regionBreakdown(70);
  assert.equal(Object.values(b).reduce((a,c)=>a+c,0), 100);
  assert.equal(b.cash, 0);
  assert.deepEqual(b, {cash:0, jpEq:12, devEq:36, emEq:12, bond:30, reit:6, gold:4}); // dev=eq*.6=35.7→36吸収
});
```

- [ ] **Step 2: 失敗確認** — Run: `node --test tests/money-rules.test.js` → FAIL

- [ ] **Step 3: 実装（money-rules.js）**

```javascript
function glidePath(birthYear, nowMs) {
  var nd = new Date(num(nowMs));
  if (!isFinite(nd.getTime())) return { configured: false };
  var cy = nd.getUTCFullYear();
  var by = num(birthYear);
  var age = cy - by;
  if (by <= 0 || !isFinite(age) || age < 0 || age > 120) return { configured: false };
  var Rr = clamp(110 - age, 30, 90);
  return { configured: true, age: age, R: Rr, D: 100 - Rr };
}
function regionBreakdown(Rr) {
  var D = 100 - Rr, eq = Rr * 0.85, alt = Rr * 0.15;
  var raw = { cash: 0, jpEq: eq * 0.20, devEq: eq * 0.60, emEq: eq * 0.20, bond: D, reit: alt * 0.60, gold: alt * 0.40 };
  return _absorbTo100(raw); // Task共通ヘルパ（下記）
}
// 端数吸収ヘルパ（regionBreakdown・総資産集約で共用）：r()整数化→残余を argmax(cash除く)へ・タイは ASSET_CLASSES 順
function _absorbTo100(rawMap) {
  var out = {}, sum = 0;
  for (var i = 0; i < ASSET_CLASSES.length; i++) { var k = ASSET_CLASSES[i]; out[k] = r(rawMap[k] || 0); sum += out[k]; }
  var rem = 100 - sum;
  if (rem !== 0) {
    var best = null;
    for (var j = 0; j < ASSET_CLASSES.length; j++) {
      var k2 = ASSET_CLASSES[j]; if (k2 === "cash") continue;
      if (best === null || out[k2] > out[best]) best = k2; // > ゆえ同値は先勝ち＝allowlist順
    }
    out[best] += rem;
  }
  return out;
}
```
export に `glidePath`, `regionBreakdown` 追加。

- [ ] **Step 4: 合格確認** — Run: `node --test tests/money-rules.test.js` → PASS

- [ ] **Step 5: Python 鏡像＋テスト**

```python
def _glide_path(birth_year, now_ms):
    try:
        cy = datetime.fromtimestamp(_num(now_ms) / 1000, tz=timezone.utc).year
    except (OverflowError, OSError, ValueError):
        return {"configured": False}
    by = _num(birth_year)
    age = cy - by
    if by <= 0 or not math.isfinite(age) or age < 0 or age > 120:
        return {"configured": False}
    rr = _clamp(110 - age, 30, 90)  # 既存 _clamp を使用（無ければ追加）
    return {"configured": True, "age": age, "R": rr, "D": 100 - rr}

def _absorb_to_100(raw_map):
    out, s = {}, 0
    for k in ASSET_CLASSES:
        out[k] = _r(raw_map.get(k, 0)); s += out[k]  # 既存 _r half-up
    rem = 100 - s
    if rem != 0:
        best = None
        for k in ASSET_CLASSES:
            if k == "cash":
                continue
            if best is None or out[k] > out[best]:
                best = k
        out[best] += rem
    return out

def _region_breakdown(rr):
    d, eq, alt = 100 - rr, rr * 0.85, rr * 0.15
    return _absorb_to_100({"cash": 0, "jpEq": eq*0.20, "devEq": eq*0.60, "emEq": eq*0.20, "bond": d, "reit": alt*0.60, "gold": alt*0.40})
```
`from datetime import datetime, timezone` を確認。`_r`/`_clamp` が無ければ既存 half-up/clamp 鏡像を確認して使用。テストは JS と同値（age40→R70、Σ=100、巨大 now_ms→configured False）を pytest で。

- [ ] **Step 6: pytest** — Run: `PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q` → PASS

- [ ] **Step 7: Commit** — `git commit -m "feat(b2): glidePath+regionBreakdown（currentYear UTC degrade・Σ=100端数吸収）+ 鏡像"`

---

## Task 3: バケツ目標（buffer/core/satellite）＋ 成長/守り

**Files:** Modify `money-rules.js`／`advice.py`／両テスト。

**Interfaces:**
- `bucketTargets(bucketKey, R) -> {7クラス整数%}`（buffer→cash100 他0／core→regionBreakdown(R)／satellite→devEq60/jpEq20/emEq20 他0）
- `growDef(classMap) -> {g, d}`（g = devEq+jpEq+emEq+reit+gold, d = 100-g）

- [ ] **Step 1: 失敗テスト**

```javascript
test("bucketTargets: buffer=cash100 / satellite=株集中 / core=glidepath", () => {
  assert.deepEqual(R.bucketTargets("buffer", 70), {cash:100,jpEq:0,devEq:0,emEq:0,bond:0,reit:0,gold:0});
  assert.deepEqual(R.bucketTargets("satellite", 70), {cash:0,jpEq:20,devEq:60,emEq:20,bond:0,reit:0,gold:0});
  assert.deepEqual(R.bucketTargets("core", 70), R.regionBreakdown(70));
});
test("growDef: core(R70)は成長70/守り30", () => {
  assert.deepEqual(R.growDef(R.bucketTargets("core",70)), {g:70, d:30});
});
```

- [ ] **Step 2-4:** 失敗確認 → 実装 → 合格。

```javascript
var GROWTH_CLASSES = ["devEq","jpEq","emEq","reit","gold"];
function bucketTargets(bucketKey, Rr) {
  var z = {cash:0,jpEq:0,devEq:0,emEq:0,bond:0,reit:0,gold:0};
  if (bucketKey === "buffer") { z.cash = 100; return z; }
  if (bucketKey === "satellite") { z.devEq = 60; z.jpEq = 20; z.emEq = 20; return z; }
  return regionBreakdown(Rr); // core
}
function growDef(m) { var g = 0; for (var i=0;i<GROWTH_CLASSES.length;i++) g += (m[GROWTH_CLASSES[i]]||0); return { g: g, d: 100 - g }; }
```
export 追加。Python 鏡像 `_bucket_targets`/`_grow_def` 同型＋pytest。

- [ ] **Step 5-7:** Python 鏡像＋pytest＋commit `feat(b2): bucketTargets/growDef + 鏡像`。

---

## Task 4: 現状集計・総資産集約・符号付きドリフト（パリティ最難所）

**Files:** Modify `money-rules.js`／`advice.py`／両テスト。**spec §3.3/§3.4/§7 を熟読**（現状側ウェイト＝assetHoldings実額・目標側＝目標額ウェイト・rSigned・zero-weight fallback）。

**Interfaces:**
- `rSigned(x) -> number`（`x=cfNum(x); return x<0 ? -r(-x) : r(x);`）
- `bucketCurrentPct(holdings, bucketKey) -> {classPct:{7クラス整数}, unclassifiedPct}`（分類済み合計>0 なら holding/合計*100 を `_absorbTo100`／合計0 は全0＋unclassifiedPct=0。**UI 用・facts 非対象**）
- `totalTargetPct(R, weights) -> {7クラス整数 Σ=100}`（weights={buffer,core,satellite} 目標額。Σweight=0 は **core 分布へ fallback**）
- `totalCurrentPct(holdings) -> {7クラス整数 Σ=100} | null`（**各クラス Σ_bucket 実額 / Σ_all 実額**を `_absorbTo100`。全 assetHoldings=0 は `null`）
- `assetClassDrift(targetMap, currentMap) -> [{key, targetPct, currentPct, driftPct}]`（driftPct=rSigned(current-target)・|drift|降順・currentMap=null 時は currentPct=0/drift=-target）

- [ ] **Step 1: 失敗テスト（rSigned・zero-weight・partial-funding Σ=100・drift整数）**

```javascript
test("rSigned: 符号付き half-up・±0", () => {
  assert.equal(R.rSigned(2.5), 3); assert.equal(R.rSigned(-2.5), -3);
  assert.equal(R.rSigned(0), 0); assert.equal(R.rSigned(-0.4), 0);
});
test("totalTargetPct: 全ウェイト0は core分布へ fallback（空ドーナツにしない）", () => {
  const t = R.totalTargetPct(70, {buffer:0,core:0,satellite:0});
  assert.deepEqual(t, R.regionBreakdown(70));
});
test("totalCurrentPct: partial-funding（一部バケツ空）でも Σ=100", () => {
  const h = R.normalizeAssetHoldings({buffer:{cash:60}, core:{}, satellite:{devEq:40}});
  const c = R.totalCurrentPct(h);
  assert.equal(Object.values(c).reduce((a,x)=>a+x,0), 100);
  assert.equal(c.cash, 60); assert.equal(c.devEq, 40);
});
test("totalCurrentPct: 全0は null（drift側で -target 化）", () => {
  assert.equal(R.totalCurrentPct(R.normalizeAssetHoldings(null)), null);
});
test("assetClassDrift: current=null は各クラス drift=-target・整数", () => {
  const t = R.regionBreakdown(70);
  const rows = R.assetClassDrift(t, null);
  const bond = rows.find(x=>x.key==="bond");
  assert.equal(bond.currentPct, 0); assert.equal(bond.driftPct, -t.bond);
  rows.forEach(x=>assert.equal(x.driftPct, Math.trunc(x.driftPct))); // 常に整数
});
```

- [ ] **Step 2-4:** 失敗確認 → 実装 → 合格。

```javascript
function rSigned(x) { x = cfNum(x); return x < 0 ? -r(-x) : r(x); }
function bucketCurrentPct(holdings, bucketKey) {
  var inner = (holdings && holdings[bucketKey]) || {}, sum = 0, i, k;
  for (i=0;i<ASSET_CLASSES.length;i++) sum += (inner[ASSET_CLASSES[i]]||0);
  var pct = {cash:0,jpEq:0,devEq:0,emEq:0,bond:0,reit:0,gold:0};
  if (sum <= 0) return { classPct: pct, unclassifiedPct: 0 };
  var rawMap = {}; for (i=0;i<ASSET_CLASSES.length;i++){ k=ASSET_CLASSES[i]; rawMap[k]=(inner[k]||0)/sum*100; }
  return { classPct: _absorbTo100(rawMap), unclassifiedPct: 0 };
}
function totalTargetPct(Rr, weights) {
  var w = weights || {}, wb = num(w.buffer), wc = num(w.core), ws = num(w.satellite), tot = wb+wc+ws;
  if (tot <= 0) return regionBreakdown(Rr); // zero-weight fallback = core分布
  var bt = bucketTargets("buffer",Rr), ct = bucketTargets("core",Rr), st = bucketTargets("satellite",Rr);
  var rawMap = {};
  for (var i=0;i<ASSET_CLASSES.length;i++){ var k=ASSET_CLASSES[i]; rawMap[k]=(bt[k]*wb + ct[k]*wc + st[k]*ws)/tot; }
  return _absorbTo100(rawMap);
}
function totalCurrentPct(holdings) {
  var totals = {}, grand = 0, b, i, k;
  for (i=0;i<ASSET_CLASSES.length;i++) totals[ASSET_CLASSES[i]] = 0;
  for (b=0;b<ASSET_BUCKETS.length;b++){ var inner=(holdings&&holdings[ASSET_BUCKETS[b]])||{};
    for (i=0;i<ASSET_CLASSES.length;i++){ k=ASSET_CLASSES[i]; var v=inner[k]||0; totals[k]+=v; grand+=v; } }
  if (grand <= 0) return null;
  var rawMap = {}; for (i=0;i<ASSET_CLASSES.length;i++){ k=ASSET_CLASSES[i]; rawMap[k]=totals[k]/grand*100; }
  return _absorbTo100(rawMap);
}
function assetClassDrift(t, c) {
  var rows = [];
  for (var i=0;i<ASSET_CLASSES.length;i++){ var k=ASSET_CLASSES[i]; var tp=t[k]||0; var cp=c?(c[k]||0):0;
    rows.push({ key:k, targetPct:tp, currentPct:cp, driftPct: rSigned(cp - tp) }); }
  rows.sort(function(a,b){ return Math.abs(b.driftPct)-Math.abs(a.driftPct); });
  return rows;
}
```
export 追加。**注意**: 現状側 total は目標額ウェイトでなく assetHoldings 実額ウェイト（spec §3.3 現状側）。目標側 total のみ目標額ウェイト。

- [ ] **Step 5-7:** Python 鏡像 `_r_signed`/`_bucket_current_pct`/`_total_target_pct`/`_total_current_pct`/`_asset_class_drift`＋pytest（JS と同値を数値で固定）＋commit `feat(b2): 現状集計・総資産集約・符号付きdrift + 鏡像（パリティ）`。

---

## Task 5: facts.assetClasses（modeAFacts）＋ advice.py 鏡像 ＋ coarsen ＋ 版bump ＋ 共有fixture

**Files:** Modify `money-rules.js`（`modeAFacts`:656・`FACTS_SCHEMA_VERSION`:15）／`api/me/advice.py`（`mode_a_facts`:630・`coarsen_facts`:828・`SCHEMA_VERSION`:29）／`tests/fixtures/advice_facts_cases.json`／両テスト。**spec §7 熟読**。

**Interfaces:**
- `assetClassesFacts(state, nowMs) -> {riskAssetPct, classes:[{key,targetPct,currentPct,driftPct}]} | undefined`
  - `gp = glidePath(state.birthYear, nowMs)`; `if (!gp.configured) return undefined;`（**birthYear 未設定は assetClasses キー自体を省く**）
  - weights = 既存 B#1 目標額（`bufferTarget`/`coreTarget`/`satelliteCap`）を viewModel/roadmap 由来で取得（**実装者は money-rules.js で該当関数を確認**。無い場合は本タスクで純導出ヘルパを足し spec §3.3 に沿う）
  - `target = totalTargetPct(gp.R, weights)`, `current = totalCurrentPct(normalizeAssetHoldings(state.assetHoldings))`
  - `classes = assetClassDrift(target, current)`（drift 降順）; `riskAssetPct = gp.R`
- `modeAFacts` の返り値に **`if (acFacts) facts.assetClasses = acFacts;`**（undefined 時はキー無し）。両モードトップレベル同値。生額¥は `facts.raw` のみ（age は公開ゆえ raw 隔離不要）。
- `coarsen_facts`（Py）に **assetClasses ノードの明示走査**を追加＝`currentPct` を `_bucket25`・`driftPct` を `sign*_bucket25(abs(d))`。**`riskAssetPct`/`targetPct` は age 由来公開ゆえ非粗化**。
- 版: `FACTS_SCHEMA_VERSION 3→4`, `SCHEMA_VERSION 3→4`。

- [ ] **Step 1: 失敗テスト（facts 形・未設定でキー省略・両モード同値）**

```javascript
test("assetClassesFacts: 未設定は undefined／設定時は riskAssetPct+classes7本", () => {
  const s = R.migrate({birthYear:0}); // 未設定
  assert.equal(R.assetClassesFacts(s, Date.UTC(2026,6,15)), undefined);
  const s2 = R.migrate({birthYear:1986, assetHoldings:{buffer:{cash:100}}});
  const f = R.assetClassesFacts(s2, Date.UTC(2026,6,15));
  assert.equal(f.riskAssetPct, 70);
  assert.equal(f.classes.length, 7);
  f.classes.forEach(x=>assert.equal(x.driftPct, Math.trunc(x.driftPct)));
});
test("modeAFacts: schemaVersion=4・未設定 birthYear で assetClasses キー不在", () => {
  const f = R.modeAFacts(R.migrate({birthYear:0}), {nowMs: Date.UTC(2026,6,15)});
  assert.equal(f.schemaVersion, 4);
  assert.equal("assetClasses" in f, false);
});
```

- [ ] **Step 2-4:** 失敗確認 → 実装（`FACTS_SCHEMA_VERSION=4`、`assetClassesFacts` 追加、`modeAFacts` に条件付き代入）→ 合格。weights の取得元は money-rules.js を読んで確定（B#1 の `bufferTarget`/`coreTarget`/`satelliteCap` 相当）。

- [ ] **Step 5: advice.py 鏡像＋coarsen＋版bump**
  - `SCHEMA_VERSION=4`、`mode_a_facts`(:630) に `_asset_classes_facts` を同方向で追加（`include_raw` 無関係にトップレベル同値）。
  - `coarsen_facts`(:828) に assetClasses 走査を追加（currentPct=_bucket25、driftPct=sign×_bucket25(abs)、targetPct/riskAssetPct は非粗化）。

- [ ] **Step 6: 共有 fixture 更新（パリティの核心）**
  - 既存46ケースの `"schemaVersion": 3` → `4` を一括置換（rulesVersion=2 据置）。
  - 新 assetClasses ケース (a)-(m) を追加（spec §7 の一覧）: (a)age一致=drift0 (b)half-up境界(.5)/±0/負drift (c)classes未入力=現状0（全0→drift=-target） (d)floor30/ceil90 (e)birthYear未設定＝assetClassesキー省略 (f)zero-weight core-fallback (g)端数吸収タイブレーク(age55/age80) (h)年境界UTC (i)adversarial-coercion([5]=両言語0) (j)coarsen出力に生の非25刻みゼロ件 (k)巨大/負nowMs→両言語 configured:false (l)partial-funding Σ=100 (m)集約blendタイ。各ケース production/personal トップレベル同値・差は raw のみ。
  - `tests/test_advice_facts.py` の既存パリティランナーが新ケースも回す（JS 期待値生成は既存の生成スクリプトを踏襲＝実装者が確認）。

- [ ] **Step 7: 両テスト＋commit**

Run: `node --test tests/*.test.js` かつ `PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q`
Expected: 全 PASS（既存46＋新ケース）
`git commit -m "feat(b2): facts.assetClasses + advice.py鏡像 + coarsen + SCHEMA 3→4 + 共有fixture(a-m)"`

---

## Task 6: UI（money.js assetClassSection ＋ money.css .mcc-ac-*）

**Files:** Modify `money.js`（`roadmapSection`:804 の後に `assetClassSection`、`render()` の連結、`_JUMP_TARGETS`:824）／`money.css`（`.mcc-ac-*` 追加）。**参照実装＝`scratchpad/b2-asset-class-mock.html`（実機確認済・B案既定）**。業務 math 禁止＝すべて money-rules.js 純関数を呼ぶ。

**Interfaces:**
- `assetClassSection(vm)` → HTML 文字列。`vm` は viewModel 拡張（Task5 の facts と同じ純関数を UI 用に呼ぶ）。`id="mcc-sec-assets"`。
- CSS は mock の `<style>` 内 `.mcc-ac-*` と `.neonb` を money.css へ移設（baseline + `[data-theme="D"] #money-view` 二層）。§6 確定値（alpha0.4/glow100%/saturate1.55/brightness1.5/screen・conic は `circle closest-side`）。7hue＋未分類 `#64748b`。

- [ ] **Step 1: 失敗テスト（DOM smoke・Playwright）**

`scratchpad/b2-ui-smoke.js` を書く（mock_prod_server.py で本番 money.js を配信 or 直接 money.js を jsdom 無しで実ブラウザ）: 年齢入力→ドーナツ更新／目標・現状バー描画／ドリフト行7／未ログインで手入力欄が消えない（¥readout のみゲート）／pageerror0。

- [ ] **Step 2-4:** mock の描画ロジック（`render`/`buildDonut`/`stack`/drift rail/bands）を money.js の `assetClassSection` に移植。**conic mask を `circle closest-side at 50% 50%` に修正**（mock も同修正）。目標ドーナツは7クラスのみ（未分類グレーは現在地バー限定）。`render()` 連結列に `assetClassSection(vm)` を `roadmapSection` の後で挿入。`_JUMP_TARGETS` に `assets:"mcc-sec-assets"`。CSS を money.css へ。実ブラウザで smoke 緑・pageerror0。

- [ ] **Step 5: Commit** — `git commit -m "feat(b2): 資産クラス比率UI（money.js assetClassSection + money.css theme D・closest-side mask）"`

---

## Task 7: 統合スモーク＋回帰＋パリティ fuzz

**Files:** `scratchpad/b2-parity-fuzz.js`（JS↔Py 乱数入力比較）／既存テスト全実行。

- [ ] **Step 1:** `node --test tests/*.test.js` 全緑を確認（末尾スラッシュ不可）。
- [ ] **Step 2:** `PYTHONPATH=api/me .venv/bin/python -m pytest tests/ -q` 全緑（cf-1/cf-2/par-2 回帰維持）。
- [ ] **Step 3:** パリティ fuzz（birthYear/assetHoldings/nowMs をランダム生成し modeAFacts の JS 出力と mode_a_facts の Py 出力のトップレベルが byte 一致・巨大/負 nowMs・[5] coercion も含む）を数百件回し 0 mismatch。
- [ ] **Step 4:** UI 統合スモーク（Playwright 実ブラウザ）＝司令室全体を描画し #money-view に資産クラスセクションが出る／既存セクション（ロードマップ/収支/バケツ）が壊れていない／pageerror0／theme D 発色。
- [ ] **Step 5: Commit** — `git commit -m "test(b2): 統合スモーク＋JS↔Pyパリティfuzz＋回帰確認"`

---

## Self-Review（spec 突合）

- **§2 state**: Task1（birthYear/assetHoldings/assetSource・normalize・numScalar）✓ 三所（defaultState/migrate/_migrate）✓
- **§3.1 glidePath**: Task2（currentYear UTC degrade・!isFinite(age) gate・configured:false）✓
- **§3.2 regionBreakdown**: Task2（6:2:2・reit:gold=3:2・Σ=100端数吸収タイブレーク）✓
- **§3.3 bucketTargets/総資産集約**: Task3＋Task4（buffer/core/satellite・目標側=目標額ウェイト・現状側=assetHoldings実額・zero-weight core-fallback）✓
- **§3.4 現状ドリフト**: Task4（rSigned・未分類はfacts非出力・全0→drift=-target・¥ゲートはUI Task6）✓
- **§3.5 教育/A案**: Task5（age公開・ageBucket無し）＋Task6（免責）✓
- **§4 層2**: 本 spec の layer1 スコープ＝facts 出力まで（Task5）。SYS_PRODUCTION 条項追記は Task5 で advice.py に含める。personal 具体化は dormant（別途）。
- **§5 UI**: Task6（9項目構成・目標ドーナツ7クラス・未分類は現在地バー限定・¥readout ゲート）✓
- **§6 デザイン**: Task6（§6.1 パレット＋#64748b・§6.2 alpha0.4/glow100%・§6.3 closest-side mask）✓ 実機確認済
- **§7 パリティ**: Task5（型確定・版bump・coarsen・fixture a-m・現状/目標ウェイト非対称）✓
- **§9 テスト**: 各 Task の unit＋Task7 fuzz/smoke ✓
- **§10 リスク**: migrate三所（Task1）・符号付きdrift（Task4）・LWW（state追加は加算のみ・注意）・conic closest-side（Task6）✓

**型整合**: `ASSET_CLASSES` 単一定数を全 Task 参照。`glidePath`/`regionBreakdown`/`bucketTargets`/`totalTargetPct`/`totalCurrentPct`/`assetClassDrift`/`rSigned`/`numScalar`/`normalizeAssetHoldings` の名前を Task 間で一貫使用。Python は同名 snake_case 鏡像（`_glide_path` 等）。

**未確定の実装時解決事項**（subagent が該当コードを読んで確定）:
- Task5 の総資産集約ウェイト源（`bufferTarget`/`coreTarget`/`satelliteCap` の既存関数名）＝money-rules.js の B#1 実装を読んで配線。無ければ spec §3.3 に沿う純導出を足す。
- fixture の JS 期待値生成手順＝既存 `advice_facts_cases.json` の生成/更新ハーネス（scratchpad fuzz）を踏襲。
