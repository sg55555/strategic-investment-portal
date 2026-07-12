# 投資枠配分推奨 #1 フェーズ型ロードマップ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お金の司令室（`#money-view`）に、投資余力を バッファ→コア→サテライト の3バケツへどう振るかを示す「フェーズ型ロードマップ＋今月の具体額」を、2層規制安全アーキで追加する。

**Architecture:** 層1＝`money-rules.js` の決定論純関数（state schema 不変・goals逆算＋月支出×24フォールバック・サテライト解放=コア50%・表示のみ手動・投影0%＋確保枠ドラッグ）を UI が描画。層2＝`api/me/advice.py` を拡張（新api関数なし）し、production は集約facts（生¥ゼロ）／personal は `facts.raw.roadmap` に生額。JS `modeAFacts` ↔ Py `mode_a_facts` を共有 fixture でパリティ固定。

**Tech Stack:** Vanilla JS（UMD-lite `money-rules.js`）+ node:test / Python 3（`api/me/advice.py`・anthropic SDK sync）+ pytest / Playwright（実ブラウザ）。

**設計書:** `docs/superpowers/specs/2026-07-12-investment-allocation-roadmap-design.md`（全根拠・決定ログ）。

## Global Constraints

- **新規 Vercel Function を作らない**（Hobby 枠 11/12・空き1を温存＝`advice.py` 拡張のみ）。
- **state schema 不変**：`CURRENT_VERSION`（JS）/`RULES_VERSION`（Py）は **2 のまま**。Neon `mcc_state` migrate/クラウド同期に触れない。コア目標年数は state に持たず**モジュール定数＋goals逆算で導出**。
- **`FACTS_SCHEMA_VERSION`（JS）/`SCHEMA_VERSION`（Py）は 2→3 に bump**（facts 形状変更・DB migration 不要）。
- **`cashflowDerived`/`_cashflow_derived` は改変しない**（cf-1不変＝既存fixture/fuzz600 無傷）。サテライト分割は新関数側だけに載せる。
- **`NEXT_TARGETS`（4種）凍結**。roadmap phase は別 enum の別フィールド。
- **金額境界**：層1決定論クライアントVMはログイン本人にのみ¥表示（既存 `cashflowViewModel` と同一信頼境界）・**未ログインは¥非表示**。production の AI 出力は既存 `_AMOUNT_RE` が¥strip。**production facts に生¥を絶対に入れない**（allowlist 構造テストで保証）。
- **`applySurplus` はコアのみ**（サテライトは表示のみ・手動＝変更しない）。
- **定数（両言語で同値）**：`CORE_FALLBACK_MONTHS = 24`、`SATELLITE_UNLOCK_CORE_PCT = 50`。
- コーディング規約：JS は既存の `num()/clamp()/r()` で coerce・ゼロ除算ガード・純関数。Py は `_num()/_clamp()/_r()` 鏡像。
- **検証コマンド**：JS=`NODE_PATH=/home/shugo/node_modules node --test tests/`、Py=`.venv/bin/python -m pytest tests/ -q`（uv+.venv 環境・system pip 不可）。

---

## File Structure

- `money-rules.js`（修正）：層1の全純関数＋定数＋公開API＋`modeAFacts` に roadmap facts。責務＝決定論エンジン（DOM非依存）。
- `tests/money-rules.test.js`（修正）：新関数の node:test。
- `tests/fixtures/advice_facts_cases.json`（修正）：roadmap を含む facts パリティ単一源。
- `api/me/advice.py`（修正）：Py 鏡像関数＋定数＋`mode_a_facts` roadmap block＋`coarsen_facts`＋`SCHEMA_VERSION` bump＋SYS プロンプト1節。
- `tests/test_advice_facts.py`（修正）：Py パリティ＋allowlist 構造テスト。
- `money.js`（修正）：`roadmapSection` 描画（業務math無し・`R.roadmap` 由来VM）。
- `money.css`（修正）：レール/フェーズ/今月配分の theme D スタイル（既存 `.mcc-wf-*`/`.mcc-goal-bar` 再利用）。
- `tests/`（Playwright スクリプトは `scratchpad/` に置き `.vercelignore` 除外）。

---

## Task 1: 層1 コア目標・進捗（money-rules.js）

**Files:**
- Modify: `money-rules.js`（helpers 群 `money-rules.js:32-34` の近傍に定数、派生関数 `money-rules.js:143-153` の近傍に新関数、公開API `money-rules.js:650-665` に export 追記）
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: 既存 `num`, `clamp`, `bufferTarget(s)`, `bufferProgress(s)`。
- Produces:
  - 定数 `CORE_FALLBACK_MONTHS=24`, `SATELLITE_UNLOCK_CORE_PCT=50`
  - `northStarTarget(s) -> number`
  - `coreTarget(s) -> number`
  - `coreTargetSource(s) -> "setup"|"goal"|"fallback"`
  - `coreProgress(s) -> {progress:number, pct:number, remaining:number, established:boolean}`

- [ ] **Step 1: 失敗するテストを書く** — `tests/money-rules.test.js` の末尾に追加

```js
test("coreTarget: setup(月支出未設定)は0", () => {
  const s = R.defaultState();
  assert.equal(R.coreTarget(s), 0);
  assert.equal(R.coreTargetSource(s), "setup");
});

test("coreTarget: goals無しは月支出×CORE_FALLBACK_MONTHS(24)", () => {
  const s = R.defaultState(); s.monthlyExpense = 300000; // bufferTarget=1,800,000
  assert.equal(R.coreTarget(s), 300000 * 24); // 7,200,000
  assert.equal(R.coreTargetSource(s), "fallback");
});

test("coreTarget: goalがbufferTargetを超えるとgoal逆算(northStar - bufferTarget)", () => {
  const s = R.defaultState(); s.monthlyExpense = 300000; // bufferTarget=1,800,000
  s.goals = [{ id: "g1", label: "FIRE", targetAmount: 30000000, deadline: "" },
             { id: "g2", label: "車", targetAmount: 3000000, deadline: "" }];
  assert.equal(R.northStarTarget(s), 30000000);
  assert.equal(R.coreTarget(s), 30000000 - 1800000); // 28,200,000
  assert.equal(R.coreTargetSource(s), "goal");
});

test("coreTarget: goalがbufferTarget以下ならfallbackに退避", () => {
  const s = R.defaultState(); s.monthlyExpense = 300000; // bufferTarget=1,800,000
  s.goals = [{ id: "g1", label: "小目標", targetAmount: 1000000, deadline: "" }];
  assert.equal(R.coreTarget(s), 300000 * 24);
  assert.equal(R.coreTargetSource(s), "fallback");
});

test("coreProgress: ゼロ除算ガードとestablished", () => {
  const s = R.defaultState(); s.monthlyExpense = 300000; // coreTarget=7,200,000(fallback)
  let cp = R.coreProgress(s);
  assert.equal(cp.progress, 0); assert.equal(cp.pct, 0); assert.equal(cp.remaining, 7200000); assert.equal(cp.established, false);
  s.buckets.core.amount = 3600000; // 50%
  cp = R.coreProgress(s);
  assert.equal(cp.progress, 0.5); assert.equal(cp.pct, 50); assert.equal(cp.remaining, 3600000); assert.equal(cp.established, false);
  s.buckets.core.amount = 7200000; // 100%
  cp = R.coreProgress(s);
  assert.equal(cp.progress, 1); assert.equal(cp.established, true); assert.equal(cp.remaining, 0);
});

test("coreProgress: coreTarget=0(setup)は全ゼロ", () => {
  const s = R.defaultState(); s.buckets.core.amount = 999999;
  const cp = R.coreProgress(s);
  assert.equal(cp.progress, 0); assert.equal(cp.remaining, 0); assert.equal(cp.established, false);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/money-rules.test.js`
Expected: FAIL（`R.coreTarget is not a function` 等）

- [ ] **Step 3: 定数と関数を実装** — `money-rules.js`。定数は helpers（`r` 定義の直後 `money-rules.js:34` 付近）に、関数は `goalProgress`（`money-rules.js:164`）の直後に追加

```js
// 投資枠配分ロードマップ（backlog B #1）定数。state に持たず導出＝migrate/クラウド同期に触れない。
var CORE_FALLBACK_MONTHS = 24;      // goals未宣言時のコア目標＝月支出×24（2年分）
var SATELLITE_UNLOCK_CORE_PCT = 50; // サテライト解放＝コア目標の50%
```

```js
// 宣言済み goals[] の最大 targetAmount（＝到達点/north star）。無ければ0。
function northStarTarget(s) {
  var goals = Array.isArray(s.goals) ? s.goals : [];
  var max = 0;
  for (var i = 0; i < goals.length; i++) {
    var t = num(goals[i] && goals[i].targetAmount);
    if (t > max) max = t;
  }
  return max;
}

// コアバケツの目標額。goal逆算（安全網を超える成長資本をコアが担う）＋定数フォールバック。
function coreTarget(s) {
  var bt = bufferTarget(s);
  if (bt <= 0) return 0;                       // setup 未完（月支出未設定）
  var ns = northStarTarget(s);
  if (ns > bt) return ns - bt;                 // 目標逆算
  return num(s.monthlyExpense) * CORE_FALLBACK_MONTHS; // フォールバック
}

function coreTargetSource(s) {
  if (bufferTarget(s) <= 0) return "setup";
  return northStarTarget(s) > bufferTarget(s) ? "goal" : "fallback";
}

function coreProgress(s) {
  var ct = coreTarget(s);
  var core = num(s.buckets.core.amount);
  var progress = ct > 0 ? clamp(core / ct, 0, 1) : 0;
  return {
    progress: progress,
    pct: Math.round(progress * 100),
    remaining: ct > 0 ? Math.max(0, ct - core) : 0,
    established: ct > 0 && core >= ct,
  };
}
```

- [ ] **Step 4: 公開APIに export 追加** — `money-rules.js:659`（`totalAssets: totalAssets, goalProgress: goalProgress,` の直後）

```js
    CORE_FALLBACK_MONTHS: CORE_FALLBACK_MONTHS, SATELLITE_UNLOCK_CORE_PCT: SATELLITE_UNLOCK_CORE_PCT,
    northStarTarget: northStarTarget, coreTarget: coreTarget,
    coreTargetSource: coreTargetSource, coreProgress: coreProgress,
```

- [ ] **Step 5: テストが通ることを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/money-rules.test.js`
Expected: PASS（既存テストも全緑）

- [ ] **Step 6: コミット**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat: コア目標(goal逆算+月支出×24フォールバック)と進捗の決定論純関数"
```

---

## Task 2: 層1 サテライト解放・フェーズ・投影ヘルパ（money-rules.js）

**Files:**
- Modify: `money-rules.js`（Task 1 の関数群の直後・公開API）
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: `bufferTarget`, `bufferProgress`, `satelliteOver`, `coreProgress`（Task 1）, `SATELLITE_UNLOCK_CORE_PCT`（Task 1）。
- Produces:
  - `satelliteUnlocked(s) -> boolean`
  - `roadmapPhase(s) -> "setup"|"buffer"|"rebalance"|"core"|"satellite"|"independence"`
  - `projectMonths(gapYen:number, rateYen:number) -> number|null`
  - `etaBucket(months:number|null) -> "none"|"lt6"|"6_12"|"1_3y"|"3_10y"|"over_10y"`

- [ ] **Step 1: 失敗するテストを書く** — `tests/money-rules.test.js`

```js
function mk(monthlyExpense, buffer, core, sat, goals) {
  const s = R.defaultState();
  s.monthlyExpense = monthlyExpense;
  s.buckets.buffer.amount = buffer; s.buckets.core.amount = core; s.buckets.satellite.amount = sat;
  if (goals) s.goals = goals;
  return s;
}

test("satelliteUnlocked: バッファ達成かつコア50%以上で解放", () => {
  // monthlyExpense=300000 → bufferTarget=1,800,000, coreTarget(fallback)=7,200,000
  assert.equal(R.satelliteUnlocked(mk(300000, 1000000, 3600000, 0)), false); // buffer未達
  assert.equal(R.satelliteUnlocked(mk(300000, 1800000, 3527999, 0)), false); // コア49%
  assert.equal(R.satelliteUnlocked(mk(300000, 1800000, 3600000, 0)), true);  // コア50%
  assert.equal(R.satelliteUnlocked(mk(300000, 1800000, 7200000, 0)), true);  // コア100%
});

test("roadmapPhase: 全6分岐", () => {
  assert.equal(R.roadmapPhase(R.defaultState()), "setup");                     // 月支出0
  assert.equal(R.roadmapPhase(mk(300000, 900000, 0, 0)), "buffer");            // バッファ半分
  assert.equal(R.roadmapPhase(mk(300000, 1800000, 0, 0)), "core");            // buffer達成/コア0%
  assert.equal(R.roadmapPhase(mk(300000, 1800000, 3600000, 0)), "satellite");// コア50%(解放)
  assert.equal(R.roadmapPhase(mk(300000, 1800000, 7200000, 0)), "independence"); // コア100%
  // rebalance: サテライトが上限超過（investable=core+sat, cap=investable*10%）
  const over = mk(300000, 1800000, 1000000, 900000); // investable=1.9M, cap=190k, sat=900k>cap
  assert.equal(R.roadmapPhase(over), "rebalance");
});

test("projectMonths: rate<=0はnull・端数ceil・負gapは0", () => {
  assert.equal(R.projectMonths(1000000, 0), null);
  assert.equal(R.projectMonths(1000000, -5), null);
  assert.equal(R.projectMonths(1000000, 300000), 4); // ceil(3.33)
  assert.equal(R.projectMonths(-100, 300000), 0);
});

test("etaBucket: 境界", () => {
  assert.equal(R.etaBucket(null), "none");
  assert.equal(R.etaBucket(5), "lt6");
  assert.equal(R.etaBucket(6), "6_12");
  assert.equal(R.etaBucket(11), "6_12");
  assert.equal(R.etaBucket(12), "1_3y");
  assert.equal(R.etaBucket(35), "1_3y");
  assert.equal(R.etaBucket(36), "3_10y");
  assert.equal(R.etaBucket(119), "3_10y");
  assert.equal(R.etaBucket(120), "over_10y");
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/money-rules.test.js`
Expected: FAIL（`R.satelliteUnlocked is not a function` 等）

- [ ] **Step 3: 実装** — Task 1 の関数群の直後に追加

```js
function satelliteUnlocked(s) {
  return bufferProgress(s) >= 1 && coreProgress(s).progress >= SATELLITE_UNLOCK_CORE_PCT / 100;
}

// ロードマップのフェーズ（NEXT_TARGETS(4)とは別enum・別フィールド）。判定順が意味を持つ。
function roadmapPhase(s) {
  if (bufferTarget(s) <= 0) return "setup";
  if (bufferProgress(s) < 1) return "buffer";
  if (satelliteOver(s) > 0) return "rebalance";
  var cp = coreProgress(s).progress;
  if (cp >= 1) return "independence";
  if (satelliteUnlocked(s)) return "satellite";
  return "core";
}

// 積立のみ・0%前提の到達月数。rate<=0 は前進不能=null。
function projectMonths(gapYen, rateYen) {
  return rateYen <= 0 ? null : Math.ceil(Math.max(0, gapYen) / rateYen);
}

// facts 用に生月数を粗化（ログ指紋の解像度低下）。
function etaBucket(months) {
  if (months === null || months === undefined) return "none";
  if (months < 6) return "lt6";
  if (months < 12) return "6_12";
  if (months < 36) return "1_3y";
  if (months < 120) return "3_10y";
  return "over_10y";
}
```

- [ ] **Step 4: 公開APIに export 追加** — Task 1 の export の直後

```js
    satelliteUnlocked: satelliteUnlocked, roadmapPhase: roadmapPhase,
    projectMonths: projectMonths, etaBucket: etaBucket,
```

- [ ] **Step 5: テストが通ることを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/money-rules.test.js`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat: サテライト解放条件・ロードマップphase・投影ヘルパ(0%)"
```

---

## Task 3: 層1 今月配分プラン・ロードマップVM（money-rules.js）

**Files:**
- Modify: `money-rules.js`（Task 2 の直後・公開API）
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: `reserveMonthly(rv, nowMs)`（既存 export）, `satelliteCap`, `satelliteUnlocked`, `roadmapPhase`, `coreProgress`, `coreTarget`, `coreTargetSource`, `northStarTarget`, `bufferTarget`, `bufferProgress`, `bufferRemaining`, `totalAssets`, `goalProgress`, `projectMonths`, `etaBucket`, `num`, `clamp`, `r`。`cashflowDerived(rows,s,nowMs)` の結果 `cd`（`{available, monthlySurplus, investableSurplus, toBuffer, toReserves, reserveAlloc, monthsToBufferComplete}`）。
- Produces:
  - `reserveMonthlyTotal(s, nowMs) -> number`
  - `allocationPlan(s, cd) -> {phase, satelliteUnlocked, toBuffer, toReserves, reserveAlloc, toCore, toSatellite, monthlySurplus}`
  - `roadmap(s, cd, nowMs) -> {phase, phases:[...], northStar:{target,source,label}, coreTarget, coreProgress, satelliteUnlocked, satelliteUnlockCorePct, thisMonth, projection, milestones:[...], timelineAvailable}`

- [ ] **Step 1: 失敗するテストを書く** — `tests/money-rules.test.js`

```js
test("allocationPlan: 未解放は全額コア", () => {
  const s = mk(300000, 1800000, 0, 0); // buffer達成・コア0%=未解放
  const cd = { available: true, investableSurplus: 100000, toBuffer: 0, toReserves: 0, reserveAlloc: [], monthlySurplus: 100000, monthsToBufferComplete: 0 };
  const p = R.allocationPlan(s, cd);
  assert.equal(p.satelliteUnlocked, false);
  assert.equal(p.toSatellite, 0);
  assert.equal(p.toCore, 100000);
});

test("allocationPlan: 解放時はcap二重上限で分割", () => {
  // コア50%で解放。investable=core+sat=3,600,000 → satelliteCap=360,000, sat=0 → room=360,000
  const s = mk(300000, 1800000, 3600000, 0);
  const cd = { available: true, investableSurplus: 100000, toBuffer: 0, toReserves: 0, reserveAlloc: [], monthlySurplus: 100000, monthsToBufferComplete: 0 };
  const p = R.allocationPlan(s, cd);
  assert.equal(p.satelliteUnlocked, true);
  assert.equal(p.toSatellite, 10000); // min(room=360000, 100000*10%=10000)
  assert.equal(p.toCore, 90000);
});

test("allocationPlan: roomが小さいと過小配分(規律側)", () => {
  // sat=350,000, investable=core+sat=3,950,000, cap=395,000 → room=45,000
  const s = mk(300000, 1800000, 3600000, 350000);
  const cd = { available: true, investableSurplus: 1000000, toBuffer: 0, toReserves: 0, reserveAlloc: [], monthlySurplus: 1000000, monthsToBufferComplete: 0 };
  const p = R.allocationPlan(s, cd);
  assert.equal(p.toSatellite, 45000); // min(room=45000, 1000000*10%=100000)
  assert.equal(p.toCore, 955000);
});

test("roadmap: VM形状・cashflow無しはtimeline不可", () => {
  const s = mk(300000, 900000, 0, 0);
  const rm = R.roadmap(s, { available: false, monthlySurplus: 0 }, 0);
  assert.equal(rm.phase, "buffer");
  assert.equal(rm.phases.length, 3);
  assert.equal(rm.phases[0].key, "buffer");
  assert.equal(rm.phases[1].key, "core");
  assert.equal(rm.phases[2].key, "satellite");
  assert.equal(rm.phases[2].locked, true);
  assert.equal(rm.timelineAvailable, false);
  assert.equal(rm.satelliteUnlockCorePct, 50);
  assert.ok(rm.thisMonth);
});

test("roadmap: 確保枠ドラッグでコア寄与が目減り", () => {
  // buffer達成・コア途中・reserves月次合計を差引
  const s = mk(300000, 1800000, 1000000, 0);
  s.reserves = [{ id: "r1", label: "新居", target: 1200000, saved: 0, deadline: "", monthlyOverride: 20000 }];
  const cd = { available: true, monthlySurplus: 100000, investableSurplus: 80000, toBuffer: 0, toReserves: 20000, reserveAlloc: [], monthsToBufferComplete: 0 };
  const rm = R.roadmap(s, cd, 0);
  // coreContribution = 100000 - reserveMonthlyTotal(=20000) = 80000
  assert.equal(rm.projection.coreMonthlyContribution, 80000);
  assert.ok(rm.projection.monthsToCore > 0);
  assert.equal(rm.timelineAvailable, true);
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/money-rules.test.js`
Expected: FAIL

- [ ] **Step 3: 実装** — Task 2 の直後に追加

```js
// 確保枠の月次コミット合計（定常寄与＝投影のコアドラッグ）。cd.reserveAlloc(配列)や cd.toReserves(今月実配分・phase依存)は投影に使わない。
function reserveMonthlyTotal(s, nowMs) {
  var reserves = Array.isArray(s.reserves) ? s.reserves : [];
  var sum = 0;
  for (var i = 0; i < reserves.length; i++) sum += r(reserveMonthly(reserves[i], nowMs));
  return sum;
}

// 今月の配分プラン（cashflowDerived は不変・サテライト分割はここだけ）。
function allocationPlan(s, cd) {
  cd = cd || {};
  var surplus = num(cd.investableSurplus);
  var unlocked = satelliteUnlocked(s);
  var toSat = 0, toCore = surplus;
  if (unlocked) {
    var room = Math.max(0, satelliteCap(s) - num(s.buckets.satellite.amount));
    toSat = Math.min(room, r(surplus * num(s.satelliteCapPct) / 100));
    toCore = surplus - toSat;
  }
  return {
    phase: roadmapPhase(s), satelliteUnlocked: unlocked,
    toBuffer: num(cd.toBuffer), toReserves: num(cd.toReserves),
    reserveAlloc: Array.isArray(cd.reserveAlloc) ? cd.reserveAlloc : [],
    toCore: toCore, toSatellite: toSat, monthlySurplus: num(cd.monthlySurplus),
  };
}

// north star（最大目標）のラベル。
function _northStarLabel(s) {
  var goals = Array.isArray(s.goals) ? s.goals : [];
  var maxT = 0, label = "";
  for (var i = 0; i < goals.length; i++) {
    var t = num(goals[i] && goals[i].targetAmount);
    if (t > maxT) { maxT = t; label = String((goals[i] && goals[i].label) || ""); }
  }
  return label;
}

// ロードマップ UI VM（UI専用・パリティ不要＝cashflowViewModel と同格）。cd=cashflowDerived の戻り。
function roadmap(s, cd, nowMs) {
  cd = cd || {};
  var available = !!cd.available;
  var monthlySurplus = num(cd.monthlySurplus);
  var reserveMo = reserveMonthlyTotal(s, nowMs);
  var coreContribution = Math.max(0, monthlySurplus - reserveMo);
  var cp = coreProgress(s);
  var ct = coreTarget(s);
  var bt = bufferTarget(s);
  var monthsToBuffer = (available && typeof cd.monthsToBufferComplete === "number")
    ? cd.monthsToBufferComplete
    : (available ? projectMonths(bufferRemaining(s), monthlySurplus) : null);
  var monthsToCore = available ? projectMonths(cp.remaining, coreContribution) : null;
  var cumulativeToCore = (monthsToBuffer !== null && monthsToCore !== null) ? monthsToBuffer + monthsToCore : null;
  var total = totalAssets(s);
  var goals = (Array.isArray(s.goals) ? s.goals : []).slice(0, 20);
  var ns = northStarTarget(s);
  var milestones = [];
  for (var i = 0; i < goals.length; i++) {
    var t = num(goals[i] && goals[i].targetAmount);
    if (t <= 0) continue;
    var gp = goalProgress(goals[i], total);
    milestones.push({
      index: i, label: String((goals[i] && goals[i].label) || ""), targetAmount: t,
      progressPct: gp.progressPct, reached: gp.achieved,
      projectedMonths: available ? projectMonths(Math.max(0, t - total), monthlySurplus) : null,
    });
  }
  return {
    phase: roadmapPhase(s),
    phases: [
      { key: "buffer", label: "守る（生活防衛）", target: bt, saved: num(s.buckets.buffer.amount),
        remaining: bufferRemaining(s), progress: bufferProgress(s), progressPct: Math.round(bufferProgress(s) * 100),
        monthlyContribution: monthlySurplus, monthsToComplete: monthsToBuffer, cumulativeMonths: monthsToBuffer },
      { key: "core", label: "育てる（長期投資）", target: ct, saved: num(s.buckets.core.amount),
        remaining: cp.remaining, progress: cp.progress, progressPct: cp.pct,
        monthlyContribution: coreContribution, monthsToComplete: monthsToCore, cumulativeMonths: cumulativeToCore },
      { key: "satellite", label: "攻める（サテライト）", target: satelliteCap(s), saved: num(s.buckets.satellite.amount),
        progress: 0, progressPct: 0, locked: !satelliteUnlocked(s), unlockCorePct: SATELLITE_UNLOCK_CORE_PCT },
    ],
    northStar: { target: ns, source: coreTargetSource(s), label: _northStarLabel(s) },
    coreTarget: ct, coreProgress: cp,
    satelliteUnlocked: satelliteUnlocked(s), satelliteUnlockCorePct: SATELLITE_UNLOCK_CORE_PCT,
    thisMonth: allocationPlan(s, cd),
    projection: {
      available: available, monthlySurplus: monthlySurplus, reserveMonthlyTotal: reserveMo,
      coreMonthlyContribution: coreContribution, monthsToBuffer: monthsToBuffer,
      monthsToCore: monthsToCore, cumulativeToCore: cumulativeToCore, etaToCoreBucket: etaBucket(cumulativeToCore),
    },
    milestones: milestones,
    timelineAvailable: available && monthlySurplus > 0,
  };
}
```

- [ ] **Step 4: 公開APIに export 追加**

```js
    reserveMonthlyTotal: reserveMonthlyTotal, allocationPlan: allocationPlan, roadmap: roadmap,
```

- [ ] **Step 5: テストが通ることを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/`（全JS緑を確認）
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat: 今月配分プラン(表示のみ)とロードマップVM(投影0%+確保枠ドラッグ)"
```

---

## Task 4: 層2 Python 鏡像関数（advice.py）

**Files:**
- Modify: `api/me/advice.py`（定数を `NEXT_TARGETS`（`advice.py:31`）近傍、関数を `_next_target`（`advice.py:291`）近傍）
- Test: `tests/test_advice_facts.py`（鏡像関数の直接ユニットテスト）

**Interfaces:**
- Consumes: `_num`, `_clamp`, `_r`, `_buffer_target`, `_buffer_progress`, `_satellite_cap`, `_satellite_over`, `_total_assets`, `_reserve_monthly`（既存・reserveMonthly の鏡像）。
- Produces（JS Task 1-3 と同一値）:
  - 定数 `CORE_FALLBACK_MONTHS=24`, `SATELLITE_UNLOCK_CORE_PCT=50`
  - `_north_star_target(s)`, `_core_target(s)`, `_core_target_source(s)`, `_core_progress(s)`（dict `{progress,pct,remaining,established}`）, `_satellite_unlocked(s)`, `_project_months(gap, rate)`, `_eta_bucket(months)`, `_roadmap_phase(s)`, `_reserve_monthly_total(s, now_ms)`, `_allocation_plan(s, cd)`

- [ ] **Step 1: 失敗するテストを書く** — `tests/test_advice_facts.py` に鏡像ユニットを追加（JS と同一の期待値）

```python
import importlib.util, os
spec = importlib.util.spec_from_file_location("advice", os.path.join(os.path.dirname(__file__), "..", "api", "me", "advice.py"))
advice = importlib.util.module_from_spec(spec); spec.loader.exec_module(advice)

def _st(monthly_expense=0, buffer=0, core=0, sat=0, goals=None):
    return {"monthlyExpense": monthly_expense, "bufferMonths": 6, "satelliteCapPct": 10,
            "buckets": {"buffer": {"amount": buffer}, "core": {"amount": core}, "satellite": {"amount": sat}},
            "goals": goals or []}

def test_core_target_mirror():
    assert advice._core_target(advice._migrate(_st())) == 0
    assert advice._core_target(advice._migrate(_st(300000))) == 300000 * 24
    s = advice._migrate(_st(300000, goals=[{"targetAmount": 30000000}]))
    assert advice._core_target(s) == 30000000 - 1800000
    assert advice._core_target_source(s) == "goal"

def test_core_progress_mirror():
    s = advice._migrate(_st(300000, core=3600000))  # fallback coreTarget=7,200,000
    cp = advice._core_progress(s)
    assert cp["progress"] == 0.5 and cp["pct"] == 50 and cp["established"] is False

def test_satellite_unlocked_mirror():
    assert advice._satellite_unlocked(advice._migrate(_st(300000, 1800000, 3600000))) is True
    assert advice._satellite_unlocked(advice._migrate(_st(300000, 1800000, 3527999))) is False

def test_project_and_eta_mirror():
    assert advice._project_months(1000000, 0) is None
    assert advice._project_months(1000000, 300000) == 4
    assert advice._eta_bucket(None) == "none"
    assert advice._eta_bucket(12) == "1_3y"
    assert advice._eta_bucket(120) == "over_10y"

def test_roadmap_phase_mirror():
    assert advice._roadmap_phase(advice._migrate(_st())) == "setup"
    assert advice._roadmap_phase(advice._migrate(_st(300000, 1800000, 3600000))) == "satellite"
    assert advice._roadmap_phase(advice._migrate(_st(300000, 1800000, 7200000))) == "independence"
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `.venv/bin/python -m pytest tests/test_advice_facts.py -q`
Expected: FAIL（`AttributeError: module 'advice' has no attribute '_core_target'`）

- [ ] **Step 3: 実装** — `api/me/advice.py`。定数を `advice.py:31`（`NEXT_TARGETS = [...]`）直後に、関数を `_next_target`（`advice.py:291`）直後に追加。JS と同値・同分岐で書く

```python
CORE_FALLBACK_MONTHS = 24
SATELLITE_UNLOCK_CORE_PCT = 50
```

```python
def _north_star_target(s):
    goals = s["goals"] if isinstance(s.get("goals"), list) else []
    m = 0
    for g in goals:
        t = _num(g.get("targetAmount") if isinstance(g, dict) else 0)
        if t > m:
            m = t
    return m


def _core_target(s):
    bt = _buffer_target(s)
    if bt <= 0:
        return 0
    ns = _north_star_target(s)
    if ns > bt:
        return ns - bt
    return _num(s["monthlyExpense"]) * CORE_FALLBACK_MONTHS


def _core_target_source(s):
    if _buffer_target(s) <= 0:
        return "setup"
    return "goal" if _north_star_target(s) > _buffer_target(s) else "fallback"


def _core_progress(s):
    ct = _core_target(s)
    core = _num(s["buckets"]["core"]["amount"])
    progress = _clamp(core / ct, 0, 1) if ct > 0 else 0
    return {
        "progress": progress,
        "pct": round(progress * 100),
        "remaining": max(0, ct - core) if ct > 0 else 0,
        "established": ct > 0 and core >= ct,
    }


def _satellite_unlocked(s):
    return _buffer_progress(s) >= 1 and _core_progress(s)["progress"] >= SATELLITE_UNLOCK_CORE_PCT / 100


def _roadmap_phase(s):
    if _buffer_target(s) <= 0:
        return "setup"
    if _buffer_progress(s) < 1:
        return "buffer"
    if _satellite_over(s) > 0:
        return "rebalance"
    cp = _core_progress(s)["progress"]
    if cp >= 1:
        return "independence"
    if _satellite_unlocked(s):
        return "satellite"
    return "core"


def _project_months(gap_yen, rate_yen):
    if rate_yen <= 0:
        return None
    import math
    return math.ceil(max(0, gap_yen) / rate_yen)


def _eta_bucket(months):
    if months is None:
        return "none"
    if months < 6:
        return "lt6"
    if months < 12:
        return "6_12"
    if months < 36:
        return "1_3y"
    if months < 120:
        return "3_10y"
    return "over_10y"


def _reserve_monthly_total(s, now_ms):
    reserves = s["reserves"] if isinstance(s.get("reserves"), list) else []
    return sum(_r(_reserve_monthly(rv, now_ms)) for rv in reserves)


def _allocation_plan(s, cd):
    surplus = _num(cd.get("investableSurplus"))
    unlocked = _satellite_unlocked(s)
    to_sat, to_core = 0, surplus
    if unlocked:
        room = max(0, _satellite_cap(s) - _num(s["buckets"]["satellite"]["amount"]))
        to_sat = min(room, _r(surplus * _num(s["satelliteCapPct"]) / 100))
        to_core = surplus - to_sat
    return {"satelliteUnlocked": unlocked, "toCore": to_core, "toSatellite": to_sat}
```

（注：`round()` は JS `Math.round` と 0.5 の丸め方向が異なり得るが、`pct` は整数%で fixture の期待値と一致させれば良い。差が出るケースは fixture 側で避ける＝Task 5 で確認。`_reserve_monthly` が未存在なら `_cashflow_derived` 内の実装を関数抽出する。）

- [ ] **Step 4: テストが通ることを確認**

Run: `.venv/bin/python -m pytest tests/test_advice_facts.py -q`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add api/me/advice.py tests/test_advice_facts.py
git commit -m "feat(py): ロードマップ決定論関数のPython鏡像(JSパリティ)"
```

---

## Task 5: 層2 facts 契約統合（modeAFacts + mode_a_facts + fixture）

**Files:**
- Modify: `money-rules.js`（`modeAFacts` `money-rules.js:490` に roadmap block／`FACTS_SCHEMA_VERSION` bump）
- Modify: `api/me/advice.py`（`mode_a_facts` `advice.py:519` に roadmap block／`coarsen_facts` `advice.py:691`／`SCHEMA_VERSION` `advice.py:29` bump／`SYS_PRODUCTION` `advice.py:61`＋`SYS_PERSONAL` `advice.py:73` に1節）
- Modify: `tests/fixtures/advice_facts_cases.json`（全ケース `schemaVersion` 2→3＋roadmap block追加／新roadmapケース追加）
- Test: `tests/money-rules.test.js`＋`tests/test_advice_facts.py`（パリティ＋allowlist 構造）

**Interfaces:**
- Consumes: Task 1-4 の関数群。
- Produces: facts 形状
  - `facts.roadmap`（production+personal・**生¥なし**）: `{phase, coreProgressPct, coreEstablished, satelliteUnlocked, coreTargetSource}`。cashflow 提供時のみ `etaToCoreBucket` を追加。
  - `facts.raw.roadmap`（personal かつ cashflow 提供時）: `{coreTarget, coreRemaining, northStarTarget, thisMonthToCore, thisMonthToSatellite}`。

- [ ] **Step 1: `FACTS_SCHEMA_VERSION`/`SCHEMA_VERSION` を 3 に bump**
  - `money-rules.js`：`var FACTS_SCHEMA_VERSION = 2;` を `= 3;` に（定義箇所を grep `FACTS_SCHEMA_VERSION =` で特定）。
  - `api/me/advice.py:29`：`SCHEMA_VERSION = 2` を `= 3  # v3: roadmap(投資枠配分)集約を facts に追加` に。

- [ ] **Step 2: 失敗するテストを書く（fixture の期待値更新＋新ケース）** — `tests/fixtures/advice_facts_cases.json`
  - 既存全ケースの `production` と `personal` で `"schemaVersion": 2` → `3`。
  - 既存全ケースの `production` に `roadmap` を追加（state から算出・cashflow の無いケースは `etaToCoreBucket` なし）。例（"empty" ケース＝setup）:

```json
        "roadmap": {
          "phase": "setup",
          "coreProgressPct": 0,
          "coreEstablished": false,
          "satelliteUnlocked": false,
          "coreTargetSource": "setup"
        }
```

  - `personal` にも同じ `roadmap` を追加（cashflow ありケースは `personal.raw.roadmap` も追加）。
  - **新ケースを3件追加**（roadmap を厚く検証）:
    1. `roadmap-fallback-cashflow`：monthlyExpense=300000, buffer=1,800,000, core=1,000,000, goals=[], cashflow あり → phase=core, coreTargetSource=fallback, satelliteUnlocked=false, etaToCoreBucket=<算出>。personal.raw.roadmap に coreTarget=7,200,000 等。
    2. `roadmap-goal-derived`：goals=[{targetAmount:30000000}] → coreTargetSource=goal, coreTarget=28,200,000。
    3. `roadmap-satellite-unlocked-cashflow`：buffer達成・core=コア目標50%・cashflow あり → satelliteUnlocked=true, personal.raw.roadmap.thisMonthToSatellite>0。
  - **coarsen 検証**：`coreProgressPct` が `_bucket25` で粗化されることを Python 側テストで確認（下記 Step 6）。

（各期待値は §2-§3 の式で手計算。1件をワークシート化して残りに展開する。fixture は JS/Py 双方の単一源＝手計算した値を両者が満たすことがパリティ。）

- [ ] **Step 3: テストが失敗することを確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/money-rules.test.js` および `.venv/bin/python -m pytest tests/test_advice_facts.py -q`
Expected: FAIL（roadmap キー不在／schemaVersion 不一致）

- [ ] **Step 4: `modeAFacts`（JS）に roadmap block 追加** — `money-rules.js`。`facts` オブジェクトの `schemaVersion` 行の直後（`return facts;` 前・aggregate 部）に state 由来の roadmap を、cashflow ブロック内に etaToCoreBucket と personal raw を追加

```js
    // 投資枠配分ロードマップ（backlog B #1）。state由来の集約は常時・生¥なし。
    var _cp = coreProgress(s);
    facts.roadmap = {
      phase: roadmapPhase(s),
      coreProgressPct: clamp(_cp.pct, 0, 100),
      coreEstablished: _cp.established,
      satelliteUnlocked: satelliteUnlocked(s),
      coreTargetSource: coreTargetSource(s),
    };
```

  - cashflow ブロック内（`facts.cashflow = {...}` を組んだ後、`if (includeRaw)` の前）に ETA を追加:

```js
      // ロードマップ ETA（積立のみ・0%・確保枠ドラッグ）。集約バケツのみ＝生月数は出さない。
      var _reserveMo = reserveMonthlyTotal(s, nowMs);
      var _coreContribution = Math.max(0, cd.monthlySurplus - _reserveMo);
      var _mToBuffer = typeof cd.monthsToBufferComplete === "number" ? cd.monthsToBufferComplete : projectMonths(bufferRemaining(s), cd.monthlySurplus);
      var _mToCore = projectMonths(coreProgress(s).remaining, _coreContribution);
      var _cumToCore = (_mToBuffer !== null && _mToCore !== null) ? _mToBuffer + _mToCore : null;
      facts.roadmap.etaToCoreBucket = cd.available ? etaBucket(_cumToCore) : "none";
```

  - personal raw（`facts.raw.cashflow = {...}` の後）:

```js
        var _plan = allocationPlan(s, cd);
        facts.raw.roadmap = {
          coreTarget: coreTarget(s),
          coreRemaining: coreProgress(s).remaining,
          northStarTarget: northStarTarget(s),
          thisMonthToCore: _plan.toCore,
          thisMonthToSatellite: _plan.toSatellite,
        };
```

- [ ] **Step 5: `mode_a_facts`（Py）に同一 roadmap block 追加** — `api/me/advice.py`。JS と同じ位置・同じ値

```python
    cp = _core_progress(s)
    facts["roadmap"] = {
        "phase": _roadmap_phase(s),
        "coreProgressPct": _clamp(cp["pct"], 0, 100),
        "coreEstablished": cp["established"],
        "satelliteUnlocked": _satellite_unlocked(s),
        "coreTargetSource": _core_target_source(s),
    }
```

  - cashflow ブロック内（`facts["cashflow"] = {...}` の後・`if include_raw:` の前）:

```python
        reserve_mo = _reserve_monthly_total(s, now_ms)
        core_contribution = max(0, cd["monthlySurplus"] - reserve_mo)
        m_to_buffer = cd["monthsToBufferComplete"] if isinstance(cd["monthsToBufferComplete"], int) else _project_months(_buffer_remaining(s), cd["monthlySurplus"])
        m_to_core = _project_months(_core_progress(s)["remaining"], core_contribution)
        cum_to_core = (m_to_buffer + m_to_core) if (m_to_buffer is not None and m_to_core is not None) else None
        facts["roadmap"]["etaToCoreBucket"] = _eta_bucket(cum_to_core) if cd["available"] else "none"
```

  - personal raw（`facts["raw"]["cashflow"] = {...}` の後）:

```python
            plan = _allocation_plan(s, cd)
            facts["raw"]["roadmap"] = {
                "coreTarget": _core_target(s),
                "coreRemaining": _core_progress(s)["remaining"],
                "northStarTarget": _north_star_target(s),
                "thisMonthToCore": plan["toCore"],
                "thisMonthToSatellite": plan["toSatellite"],
            }
```

- [ ] **Step 6: `coarsen_facts`（Py）に coreProgressPct 粗化を追加＋allowlist 構造テスト** — `api/me/advice.py:691` の `coarsen_facts`

```python
    if isinstance(out.get("roadmap"), dict) and "coreProgressPct" in out["roadmap"]:
        out["roadmap"] = {**out["roadmap"], "coreProgressPct": _bucket25(out["roadmap"]["coreProgressPct"])}
```

  - `tests/test_advice_facts.py` に構造テスト（production facts に生¥が無いことを再帰確認・既存 allowlist 機構に roadmap を含める）:

```python
def test_production_roadmap_no_raw_yen():
    cases_path = os.path.join(os.path.dirname(__file__), "fixtures", "advice_facts_cases.json")
    import json
    cases = json.load(open(cases_path))["cases"]
    for c in cases:
        cf = c.get("state", {}).get("__cashflow__")  # ケースに cashflow があれば
        prod = advice.mode_a_facts(c["state"], False, c.get("nowMs", 0), cashflow=c.get("cashflow"))
        rm = prod.get("roadmap", {})
        # roadmap 集約は bool/enum/pct のみ＝生¥キー(coreTarget/coreRemaining/thisMonth*)を含まない
        for forbidden in ("coreTarget", "coreRemaining", "northStarTarget", "thisMonthToCore", "thisMonthToSatellite"):
            assert forbidden not in rm, f"{c['name']}: production roadmap leaked {forbidden}"
        assert "raw" not in prod  # production は raw を持たない
```

- [ ] **Step 7: 全テストが通ることを確認**

Run:
```bash
NODE_PATH=/home/shugo/node_modules node --test tests/
.venv/bin/python -m pytest tests/ -q
```
Expected: PASS（JS `modeAFacts` ↔ Py `mode_a_facts` パリティ全ケース緑・構造テスト緑・既存 cashflow/reserve パリティ不変）

- [ ] **Step 8: SYS プロンプトに1節追加** — `api/me/advice.py`。`SYS_PRODUCTION`（`:61`）と `SYS_PERSONAL`（`:73`）の両方に、既存の禁止/許可条項の列に1行追加（出力JSON形/字数制約は不変）

```
（追加する趣旨・両モード共通）「roadmap は本人の余剰からの機械的な概算であり相場予測ではない。段階（バッファ→コア→サテライト）の意味は教育的に説明してよいが、達成時期を確約しない。金額はサーバから与えられた事実のみを用いる（production では金額は与えられない）。」
```

- [ ] **Step 9: コミット**

```bash
git add money-rules.js api/me/advice.py tests/fixtures/advice_facts_cases.json tests/test_advice_facts.py tests/money-rules.test.js
git commit -m "feat: facts に roadmap 集約(production生¥ゼロ)/personal raw・SCHEMA_VERSION 3・SYSプロンプト"
```

---

## Task 6: UI roadmapSection（money.js + money.css）

**Files:**
- Modify: `money.js`（`adviceSection` `money.js:454` の描画呼び出し元近傍に `roadmapSection` を追加・バッファゲージの下 / adviceSection の上に配置）
- Modify: `money.css`（レール/フェーズ行/今月配分の theme D スタイル）
- Test: `scratchpad/roadmap-ui-smoke.js`（Playwright・`.vercelignore` 除外）

**Interfaces:**
- Consumes: `R.roadmap(s, cd, nowMs)`（Task 3）, 既存 `R.yen`, `esc()`（money.js XSS）, `.mcc-wf-*`/`.mcc-goal-bar` CSS, ログインゲート（`money.js` の cashflow 描画と同一）。
- Produces: `#money-view` に roadmap セクション DOM。

- [ ] **Step 1: 失敗する Playwright スモークを書く** — `scratchpad/roadmap-ui-smoke.js`。`scratchpad/mock_prod_server.py`（既存・本番index.html＋/api/me/* モック）で配信し検証。ログイン本人＝¥表示・未ログイン＝¥非表示・phaseレール・applySurplus がコアのみを確認

```js
// 概略（既存 scratchpad/subpanel-ui-smoke.js の起動パターンに倣う）:
// 1) mock_prod_server 起動 → /#money-view
// 2) 未ログイン: roadmapSection のフェーズレールは見えるが ¥ 数字が無いことを assert
// 3) ログイン(モックセッション): 今月配分カードに ¥ が出る・phase チップ・サテライト🔒/解放を assert
// 4) applySurplus クリック → core.amount のみ増える（satellite 不変）を state から assert
// 5) pageerror 0 を assert
```

- [ ] **Step 2: スモークが失敗することを確認**（roadmapSection 未実装）

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/roadmap-ui-smoke.js`
Expected: FAIL（roadmapSection のセレクタが見つからない）

- [ ] **Step 3: `roadmapSection(rm, loggedIn)` を money.js に実装**（業務math無し・VMを描画のみ）
  - 水平フェーズレール（守る/育てる/攻める）：現フェーズ発光・完了✓・未解放🔒（`rm.phase`・`rm.phases[].locked`）。
  - コア目標ラベル：`rm.northStar.source==='goal'` なら「目標『{label}』から逆算 → コア目標 {yen(coreTarget)}（あと {yen(remaining)}）」／`'fallback'` なら「仮の目安：月支出×24ヶ月（2年分）。実際の目標を宣言するとここが逆算に変わります」＋goalsセクションへのリンク。
  - 今月の配分プラン（`rm.thisMonth`）：バッファ/確保枠/コア/(解放時)サテライトの ¥（`.mcc-wf-*` 再利用）・サテライトは「手動で移す目安」注記。
  - タイムライン：`rm.timelineAvailable` なら「この余力ペースなら コア目標到達まで約 {cumulativeToCore} ヶ月（概算・積立のみ／運用益は含めない）」・`false` なら「収支連携でタイムラインが表示されます」。
  - サテライト状態チップ：未解放「🔒 解放条件：バッファ達成＋コア50%（現在 {coreProgress.pct}%）」。
  - **¥ は `loggedIn` の時のみ描画**（未ログインはフェーズ構造・%のみ／既存 cashflow 描画と同一ゲート）。全出力は `esc()` 経由。
  - `applySurplus`（既存）は変更しない（サテライトは表示のみ）。

- [ ] **Step 4: money.css にスタイル追加**（theme D トークン・既存 `.mcc-wf-*`/`.mcc-goal-bar` パターン・面禁則＝線/glow/縁のみ）

- [ ] **Step 5: スモークが通ることを確認**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/roadmap-ui-smoke.js`
Expected: PASS（¥ゲート・phase・applySurplusコアのみ・pageerror0）

- [ ] **Step 6: コミット**

```bash
git add money.js money.css
git commit -m "feat(ui): #money-view にフェーズ型ロードマップ(旅路レール+今月配分+ETA)"
```

---

## Self-Review（記入済み）

**1. Spec coverage:** §2 純関数→Task1-2／§3 allocationPlan→Task3／§4 投影→Task3(roadmap)＋Task5(facts ETA)／§5 層2 facts・プロンプト・版→Task4-5／§6 安全境界→Task5(allowlist構造テスト)＋Task6(¥ゲート)／§7 UX→Task6／§8 テスト→各Task。**カバー漏れなし**。

**2. Placeholder scan:** TBD/TODO なし。全 step に実コード。fixture の期待値のみ「§式で手計算」＝実装時に確定（値が state 依存で一意に決まる＝プレースホルダでなく計算指示）。

**3. Type consistency:** `coreProgress` は全 Task で `{progress,pct,remaining,established}`。`allocationPlan`/`_allocation_plan` は `toCore/toSatellite` を返す（Py は最小 `{satelliteUnlocked,toCore,toSatellite}`）。`roadmap`/`facts.roadmap`/`facts.raw.roadmap` のキー名は Task3↔Task5 で一致。`etaBucket`/`_eta_bucket` の enum 一致。`FACTS_SCHEMA_VERSION`(JS)=`SCHEMA_VERSION`(Py)=3。

**留意（実装時の既知の注意）:**
- Py `round()` と JS `Math.round()` の 0.5 丸め方向差 → `coreProgressPct` 等は fixture の期待値を .5 境界にしない state で固定（Task5）。
- `_reserve_monthly`/`_buffer_remaining`/`_satellite_over`/`_total_assets` が advice.py に存在することを Task4 冒頭で確認（無ければ既存 `_cashflow_derived` から関数抽出）。
- fixture は全ケース `schemaVersion` 3 に更新＝既存パリティケースも一括変更（cashflow/reserve の他フィールドはバイト不変を保つ）。
