# NISA枠（B#3 Stage 1）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お金の司令室 `#money-view` に新NISA(2024)の非課税枠トラッキング（当年枠/生涯枠/成長内数cap/売却枠復活/積立接続）を層1フルで本番化し、`facts.nisa` を AI規律コーチに配線する。

**Architecture:** 純コア `nisaDerive(state,nowMs)` を単一計算源に、`nisaFacts`(production %/bool/enum) / `nisaRaw`(personal 生¥) / `nisaViewModel`(UI描画) の薄いアダプタで分岐。`money-rules.js`(JS) ↔ `api/me/advice.py`(Py) を byte-parity 鏡像にし、共有 fixture でパリティ固定。UIは theme D レイアウトD（HUD＋生涯枠ヒーロードーナツ＋2段バー＋当年ゲージ）。

**Tech Stack:** Vanilla JS(IIFE window.MCC / MCCRules)、Python 3.14(Vercel serverless)、node --test、pytest、共有JSON fixture パリティ、theme D CSS。

**Spec:** `docs/superpowers/specs/2026-07-16-nisa-quota-design.md`（§参照）。

## Global Constraints

各タスクの要件はこの節を暗黙に含む（spec由来・値は逐語）：

- **2層規制安全**：production facts に生¥ゼロ。`facts.nisa` の全数値leafは **整数かつ[-100,150]**（%/enum/bool/件数のみ）。生¥は `facts.raw.nisa`（personal＝includeRaw時）のみ。
- **JS↔Py byte-parity**：`money-rules.js` と `api/me/advice.py` を同じ向きに変更。共有 fixture `tests/fixtures/advice_facts_cases.json` が契約。num入力は共有 `num()`/`_num()`（scalar-safe・ASCII `_DECIMAL_RE`）のみ。`Number()`/`float()` 直呼び・配列unbox禁止。
- **SCHEMA lockstep**：`FACTS_SCHEMA_VERSION`(money-rules.js:15) + `SCHEMA_VERSION`(advice.py:30) + テスト assertion(money-rules.test.js:347 / test_advice_facts.py:220) + fixture 全80箇所(40ケース×production/personal) を 4→5 同時。`CURRENT_VERSION`/`RULES_VERSION` は据置。
- **coarsen_facts は非再帰**：`facts.nisa` の明示走査ブロックを追加（忘れると advice_log に生% 指紋残）。
- **money.js に業務math禁止**：全数値は `R.nisa*()` 由来。money.js は表示専用集計/色計算のみ（コメント明記）。
- **¥ゲート**：`sync.loggedIn` 時のみ ¥readout。%/バー/構造/入力欄は常時（readout gate であって input gate でない）。
- **state三所**：新フィールドは `defaultState()` + `migrate()`(money-rules.js) + `_migrate()`(advice.py) の三所へ同型追加（片方漏れ＝無言消失）。
- **UTC年導出の[1,9999]ガード**：nowMs→年/月は glidePath と同一の UTC 導出＋`cy∈[1,9999]` ガード（JS Date ↔ Py datetime のライブラリ差を対称化）。fuzz で極値 nowMs を検証。
- **theme D**：色/glow CSS は必ず `[data-theme="D"] #money-view .mcc-nisa-*` 配下。baseline は構造/寸法のみ。面禁則（線/グロー/縁）。
- **node test 実行**：`node --test 'tests/*.test.js'`（グロブ・末尾スラッシュ `tests/` は `Cannot find module` で不可）。
- **pytest 実行**：`PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q`。
- **Vercel関数を増やさない**：Stage 1 は `advice.py` 拡張のみ（新endpoint無し）。
- **新規inline onclick XSS回避**：UIの新規ハンドラは委譲/textContent（既存 detail.js:47/81 の轍を踏まない）。

## 定数・命名（全タスク共通・型整合の単一源）

**state.nisa フィールド**（全フィールド名固定）：
`source`(enum 'manual'|'history'|'ledger') / `anchorYear`(int) / `tsumitateThisYear`(¥) / `growthThisYear`(¥) / `tsumitateLifetime`(¥) / `growthLifetime`(¥) / `soldThisYearAtCost`(¥)

**法定枠定数**（module const・facts非出力）：
`NISA_ANNUAL_TSUMITATE=1200000` / `NISA_ANNUAL_GROWTH=2400000` / `NISA_ANNUAL_TOTAL=3600000` / `NISA_LIFETIME=18000000` / `NISA_GROWTH_LIFETIME_CAP=12000000`

**純関数**：`normalizeNisa(raw)` / `nisaNow(nowMs)` / `nisaDerive(state,nowMs)` / `nisaFacts(state,nowMs)` / `nisaRaw(state,nowMs)` / `nisaViewModel(state,cd,nowMs)`（Py鏡像 `_normalize_nisa`/`_nisa_now`/`_nisa_derive`/`_nisa_facts`/`_nisa_raw`・nisaViewModelはUI専用ゆえPy不要）

**facts.nisa（production・両モード同値）キー**：`source`,`annualTsumitateUsedPct`,`annualGrowthUsedPct`,`annualTotalUsedPct`,`lifetimeUsedPct`,`growthCapUsedPct`,`annualRoomRemaining`,`lifetimeRoomRemaining`,`growthCapRoomRemaining`,`overContribution`,`hasRestorationPending`,`staleAnchorYear`,`lifetimeFillEtaBucket`

**facts.raw.nisa（personal のみ）キー**：`tsumitateThisYear`,`growthThisYear`,`tsumitateLifetime`,`growthLifetime`,`soldThisYearAtCost`,`annualTsumitateRemaining`,`annualGrowthRemaining`,`lifetimeRemaining`,`growthCapRemaining`,`monthlyToFillTsumitate`,`restoresYear`

---

## File Structure

- `money-rules.js`（modify）：定数・`normalizeNisa`・`nisaNow`・`nisaDerive`・`nisaFacts`・`nisaRaw`・`nisaViewModel`・`GLOSSARY`追記・`defaultState`/`migrate`追記・`modeAFacts`配線・`FACTS_SCHEMA_VERSION 4→5`・exports追記。
- `api/me/advice.py`（modify）：定数・`_normalize_nisa`・`_nisa_now`・`_nisa_derive`・`_nisa_facts`・`_nisa_raw`・`_migrate`追記・`mode_a_facts`配線・`coarsen_facts`追記・`SYS_*`1節・`SCHEMA_VERSION 4→5`。
- `money.js`（modify）：`nisaSection(vm)`・色/名前const・`render()`連結・`_JUMP_TARGETS`追記。
- `money.css`（modify）：baseline `.mcc-nisa-*` ＋ theme D `[data-theme="D"] #money-view .mcc-nisa-*`。
- `tests/money-rules.test.js`（modify）：nisa unit群・`PROD_TOP_KEYS`追記・schema assertion 4→5。
- `tests/test_advice_facts.py`（modify）：nisa unit群・`ALLOW`追記・schema assertion 4→5。
- `tests/fixtures/advice_facts_cases.json`（modify）：schemaVersion 4→5 一括・nisa-a〜h 追加。
- `scratchpad/b2-parity-fuzz.js`（modify）：`genState` に nisa 生成追加。

---

## Task 1: NISA定数 + normalizeNisa + state三所配線（JS）

**Files:**
- Modify: `money-rules.js`（定数を FACTS_SCHEMA_VERSION 付近／`normalizeNisa` を normalizeAssetHoldings 付近／`defaultState`:223-243／`migrate`:256-293／exports:1043-1071）
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Produces: `R.normalizeNisa(raw)→{source,anchorYear,tsumitateThisYear,growthThisYear,tsumitateLifetime,growthLifetime,soldThisYearAtCost}`（固定形状・全¥は num非負・anchorYear num・source enum既定'manual'）。`R.defaultState().nisa`。定数 `R.NISA_ANNUAL_TSUMITATE` 等。

- [ ] **Step 1: Write failing tests**（`tests/money-rules.test.js` 末尾付近に追記）

```javascript
test("normalizeNisa: 非オブジェクト入力→全0既定・source=manual", () => {
  const z = R.normalizeNisa(null);
  assert.deepEqual(z, { source:"manual", anchorYear:0, tsumitateThisYear:0, growthThisYear:0,
    tsumitateLifetime:0, growthLifetime:0, soldThisYearAtCost:0 });
  assert.deepEqual(R.normalizeNisa("x"), z);
  assert.deepEqual(R.normalizeNisa([1,2]), z);
});
test("normalizeNisa: scalar-only coerce・未知キー破棄・enum・負/配列→0", () => {
  const n = R.normalizeNisa({ source:"history", anchorYear:2026, tsumitateThisYear:"600000",
    growthThisYear:[1], growthLifetime:-5, soldThisYearAtCost:"0x10", XXX:9 });
  assert.equal(n.source, "history");
  assert.equal(n.anchorYear, 2026);
  assert.equal(n.tsumitateThisYear, 600000);   // 数値文字列OK
  assert.equal(n.growthThisYear, 0);            // 配列→0
  assert.equal(n.growthLifetime, 0);            // 負→0
  assert.equal(n.soldThisYearAtCost, 0);        // hex文字列→0
  assert.equal("XXX" in n, false);              // 未知キー破棄
  assert.equal(R.normalizeNisa({ source:"bogus" }).source, "manual"); // enum外→manual
  assert.equal(R.normalizeNisa({ source:"ledger" }).source, "ledger");
});
test("defaultState/migrate: nisa 骨格が常在（三所配線）", () => {
  assert.deepEqual(R.defaultState().nisa, R.normalizeNisa(null));
  assert.deepEqual(R.migrate({}).nisa, R.normalizeNisa(null));
  assert.equal(R.migrate({ nisa:{ tsumitateThisYear:"120000", source:"ledger" } }).nisa.tsumitateThisYear, 120000);
  assert.equal(R.migrate({ nisa:{ source:"ledger" } }).nisa.source, "ledger");
});
```

- [ ] **Step 2: Run to verify fail**

Run: `node --test tests/money-rules.test.js`
Expected: FAIL（`R.normalizeNisa is not a function` 等）

- [ ] **Step 3: 定数を追加**（`money-rules.js` の `var FACTS_SCHEMA_VERSION = 4;` 行の直後）

```javascript
  // B#3 NISA枠（非課税枠）法定枠定数（2024新NISA・facts非出力＝公開既知値。年度改定時はここを更新）。
  var NISA_ANNUAL_TSUMITATE = 1200000;   // つみたて投資枠 年間上限
  var NISA_ANNUAL_GROWTH = 2400000;      // 成長投資枠 年間上限
  var NISA_ANNUAL_TOTAL = 3600000;       // 年間合計上限（= つみたて+成長）
  var NISA_LIFETIME = 18000000;          // 生涯非課税保有限度額（簿価）
  var NISA_GROWTH_LIFETIME_CAP = 12000000; // うち成長投資枠の生涯内数上限
  var NISA_SOURCES = ["manual", "history", "ledger"]; // 二軸source（Stage1=manual・Stage2/3で拡張）
```

- [ ] **Step 4: normalizeNisa を追加**（`normalizeAssetHoldings`(money-rules.js:50-59) の直後・同流儀）

```javascript
  // B#3: NISA使用状況の固定形状を常に返す（非オブジェクト入力→全0骨格・allowlist キーのみ・scalar-only coerce・未知キー破棄）。
  function normalizeNisa(raw) {
    var s = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
    return {
      source: NISA_SOURCES.indexOf(s.source) >= 0 ? s.source : "manual",
      anchorYear: num(s.anchorYear),
      tsumitateThisYear: num(s.tsumitateThisYear),
      growthThisYear: num(s.growthThisYear),
      tsumitateLifetime: num(s.tsumitateLifetime),
      growthLifetime: num(s.growthLifetime),
      soldThisYearAtCost: num(s.soldThisYearAtCost),
    };
  }
```

- [ ] **Step 5: defaultState/migrate に配線**（両方とも `assetSource:` 行の直後に追記）

`defaultState()` の return 内、`assetSource: "manual",` の直後：
```javascript
      nisa: normalizeNisa(null), // B#3 NISA枠：非課税枠トラッキング（Stage1手入力・全0骨格）
```
`migrate()` の return 内、`assetSource: raw.assetSource === "ledger" ? "ledger" : "manual",` の直後：
```javascript
      nisa: normalizeNisa(raw.nisa), // B#3 NISA枠（前方互換・normalizeで固定形状）
```

- [ ] **Step 6: exports に追記**（`assetClassesFacts: assetClassesFacts,` の直後）

```javascript
    normalizeNisa: normalizeNisa,
    NISA_ANNUAL_TSUMITATE: NISA_ANNUAL_TSUMITATE, NISA_ANNUAL_GROWTH: NISA_ANNUAL_GROWTH,
    NISA_ANNUAL_TOTAL: NISA_ANNUAL_TOTAL, NISA_LIFETIME: NISA_LIFETIME,
    NISA_GROWTH_LIFETIME_CAP: NISA_GROWTH_LIFETIME_CAP,
```

- [ ] **Step 7: Run tests**

Run: `node --test tests/money-rules.test.js`
Expected: PASS（新規3テスト緑・既存も緑）

- [ ] **Step 8: Commit**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(nisa): NISA定数 + normalizeNisa + state三所配線（JS・Task1）"
```

---

## Task 2: nisaNow + nisaDerive（JS純コア）

**Files:**
- Modify: `money-rules.js`（`projectMonths`/`etaBucket`:372-386 の直後）
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: 定数・`normalizeNisa`・`num`/`clamp`/`r`（Task1/既存）。
- Produces: `R.nisaNow(nowMs)→{year,monthIndex,valid}`（UTC・[1,9999]ガード）。`R.nisaDerive(state,nowMs)→{configured,n,year,monthIndex,valid,atUsed,agUsed,atTotal,annualTsumitateRemaining,annualGrowthRemaining,annualTotalRemaining,lifeUsed,lifetimeRemaining,growthCapRemaining,annualTsumitateUsedPct,annualGrowthUsedPct,annualTotalUsedPct,lifetimeUsedPct,growthCapUsedPct,overContribution,hasRestorationPending,staleAnchorYear,monthsLeft,monthlyToFillTsumitate,monthlyToFillGrowth,restoresYear}`。

- [ ] **Step 1: Write failing tests**

```javascript
test("nisaNow: UTC年/月0基・[1,9999]ガード", () => {
  const a = R.nisaNow(Date.UTC(2026,6,15)); // 7月
  assert.deepEqual(a, { year:2026, monthIndex:6, valid:true });
  assert.deepEqual(R.nisaNow(1e300), { year:0, monthIndex:0, valid:false }); // 域外→invalid
});
test("nisaDerive: 未設定は configured=false", () => {
  const d = R.nisaDerive(R.migrate({}), Date.UTC(2026,6,15));
  assert.equal(d.configured, false);
});
test("nisaDerive: 枠計算・%clamp・残・over・復活・stale・積立接続", () => {
  const st = R.migrate({ nisa:{ anchorYear:2026, tsumitateThisYear:600000, growthThisYear:1000000,
    tsumitateLifetime:2200000, growthLifetime:3000000, soldThisYearAtCost:800000 } });
  const d = R.nisaDerive(st, Date.UTC(2026,6,15)); // 7月→残6ヶ月(12-6)
  assert.equal(d.configured, true);
  assert.equal(d.annualTsumitateUsedPct, 50);  // 60万/120万
  assert.equal(d.annualGrowthUsedPct, 42);     // 100万/240万=41.67→42
  assert.equal(d.lifetimeUsedPct, 29);         // 520万/1800万=28.9→29
  assert.equal(d.growthCapUsedPct, 25);        // 300万/1200万
  assert.equal(d.annualTsumitateRemaining, 600000);
  assert.equal(d.lifetimeRemaining, 12800000);
  assert.equal(d.growthCapRemaining, 9000000);
  assert.equal(d.overContribution, false);
  assert.equal(d.hasRestorationPending, true);
  assert.equal(d.staleAnchorYear, false);
  assert.equal(d.monthsLeft, 6);
  assert.equal(d.monthlyToFillTsumitate, 100000); // 60万/6
  assert.equal(d.restoresYear, 2027);
});
test("nisaDerive: over-contribution と staleAnchorYear", () => {
  const st = R.migrate({ nisa:{ anchorYear:2025, tsumitateThisYear:1500000, growthLifetime:13000000 } });
  const d = R.nisaDerive(st, Date.UTC(2026,0,10));
  assert.equal(d.overContribution, true);          // つみたて>120万 & 成長生涯>1200万
  assert.equal(d.annualTsumitateUsedPct, 100);     // clamp
  assert.equal(d.growthCapUsedPct, 100);           // clamp
  assert.equal(d.staleAnchorYear, true);           // 2025<2026
});
```

- [ ] **Step 2: Run to verify fail** — `node --test tests/money-rules.test.js` → FAIL

- [ ] **Step 3: Implement nisaNow + nisaDerive**（`etaBucket` の直後）

```javascript
  // B#3: nowMs から UTC 年/月(0基)を導出（glidePath と同一の [1,9999] ガードで Py datetime と対称化）。
  function nisaNow(nowMs) {
    var d = new Date(num(nowMs));
    var y = d.getUTCFullYear();
    if (!isFinite(y) || y < 1 || y > 9999) return { year: 0, monthIndex: 0, valid: false };
    return { year: y, monthIndex: d.getUTCMonth(), valid: true };
  }

  // B#3: NISA使用状況の全導出（単一計算源＝nisaFacts/nisaRaw/nisaViewModel が参照）。
  function nisaDerive(state, nowMs) {
    var n = normalizeNisa(state && state.nisa);
    var configured = n.anchorYear > 0 || n.tsumitateThisYear > 0 || n.growthThisYear > 0 ||
      n.tsumitateLifetime > 0 || n.growthLifetime > 0 || n.soldThisYearAtCost > 0;
    var now = nisaNow(nowMs);
    var atUsed = n.tsumitateThisYear, agUsed = n.growthThisYear, atTotal = atUsed + agUsed;
    var lifeUsed = n.tsumitateLifetime + n.growthLifetime;
    var annualTsumitateRemaining = Math.max(0, NISA_ANNUAL_TSUMITATE - atUsed);
    var annualGrowthRemaining = Math.max(0, NISA_ANNUAL_GROWTH - agUsed);
    var annualTotalRemaining = Math.max(0, NISA_ANNUAL_TOTAL - atTotal);
    var lifetimeRemaining = Math.max(0, NISA_LIFETIME - lifeUsed);
    var growthCapRemaining = Math.max(0, NISA_GROWTH_LIFETIME_CAP - n.growthLifetime);
    var monthsLeft = now.valid ? (12 - now.monthIndex) : 0;
    return {
      configured: configured, n: n, year: now.year, monthIndex: now.monthIndex, valid: now.valid,
      atUsed: atUsed, agUsed: agUsed, atTotal: atTotal,
      annualTsumitateRemaining: annualTsumitateRemaining, annualGrowthRemaining: annualGrowthRemaining,
      annualTotalRemaining: annualTotalRemaining, lifeUsed: lifeUsed,
      lifetimeRemaining: lifetimeRemaining, growthCapRemaining: growthCapRemaining,
      annualTsumitateUsedPct: clamp(r(atUsed / NISA_ANNUAL_TSUMITATE * 100), 0, 100),
      annualGrowthUsedPct: clamp(r(agUsed / NISA_ANNUAL_GROWTH * 100), 0, 100),
      annualTotalUsedPct: clamp(r(atTotal / NISA_ANNUAL_TOTAL * 100), 0, 100),
      lifetimeUsedPct: clamp(r(lifeUsed / NISA_LIFETIME * 100), 0, 100),
      growthCapUsedPct: clamp(r(n.growthLifetime / NISA_GROWTH_LIFETIME_CAP * 100), 0, 100),
      overContribution: atUsed > NISA_ANNUAL_TSUMITATE || agUsed > NISA_ANNUAL_GROWTH ||
        atTotal > NISA_ANNUAL_TOTAL || lifeUsed > NISA_LIFETIME || n.growthLifetime > NISA_GROWTH_LIFETIME_CAP,
      hasRestorationPending: n.soldThisYearAtCost > 0,
      staleAnchorYear: now.valid && n.anchorYear > 0 && n.anchorYear < now.year,
      monthsLeft: monthsLeft,
      monthlyToFillTsumitate: monthsLeft > 0 ? Math.ceil(annualTsumitateRemaining / monthsLeft) : 0,
      monthlyToFillGrowth: monthsLeft > 0 ? Math.ceil(annualGrowthRemaining / monthsLeft) : 0,
      restoresYear: now.valid ? now.year + 1 : 0,
    };
  }
```

- [ ] **Step 4: exports に追記**（Task1 で足した NISA定数の後）

```javascript
    nisaNow: nisaNow, nisaDerive: nisaDerive,
```

- [ ] **Step 5: Run tests** — `node --test tests/money-rules.test.js` → PASS

- [ ] **Step 6: Commit**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(nisa): nisaNow + nisaDerive 純コア（JS・Task2）"
```

---

## Task 3: nisaFacts + nisaRaw アダプタ（JS）

**Files:**
- Modify: `money-rules.js`（`nisaDerive` の直後）
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: `nisaDerive`（Task2）・`etaBucket`（既存）。
- Produces: `R.nisaFacts(state,nowMs)→undefined|{...productionキー...}`（configured判定・`lifetimeFillEtaBucket` 既定'none'）。`R.nisaRaw(state,nowMs)→undefined|{...rawキー...}`。

- [ ] **Step 1: Write failing tests**

```javascript
test("nisaFacts: 未設定は undefined／設定時は production キーのみ（生¥なし・[-100,150]）", () => {
  assert.equal(R.nisaFacts(R.migrate({}), Date.UTC(2026,6,15)), undefined);
  const st = R.migrate({ nisa:{ anchorYear:2026, tsumitateThisYear:600000, growthThisYear:1000000,
    tsumitateLifetime:2200000, growthLifetime:3000000, soldThisYearAtCost:800000 } });
  const f = R.nisaFacts(st, Date.UTC(2026,6,15));
  assert.deepEqual(f, {
    source:"manual", annualTsumitateUsedPct:50, annualGrowthUsedPct:42, annualTotalUsedPct:44,
    lifetimeUsedPct:29, growthCapUsedPct:25, annualRoomRemaining:true, lifetimeRoomRemaining:true,
    growthCapRoomRemaining:true, overContribution:false, hasRestorationPending:true,
    staleAnchorYear:false, lifetimeFillEtaBucket:"none",
  });
  // 生¥キーが production に無い
  assert.equal("lifetimeRemaining" in f, false);
  assert.equal("tsumitateThisYear" in f, false);
  // 全数値leafが整数[-100,150]
  Object.values(f).forEach(v => { if (typeof v === "number") assert.ok(Number.isInteger(v) && v>=-100 && v<=150); });
});
test("nisaRaw: 未設定は undefined／設定時は生¥ブロック", () => {
  assert.equal(R.nisaRaw(R.migrate({}), Date.UTC(2026,6,15)), undefined);
  const st = R.migrate({ nisa:{ anchorYear:2026, tsumitateThisYear:600000, growthThisYear:1000000,
    tsumitateLifetime:2200000, growthLifetime:3000000, soldThisYearAtCost:800000 } });
  const rw = R.nisaRaw(st, Date.UTC(2026,6,15));
  assert.deepEqual(rw, {
    tsumitateThisYear:600000, growthThisYear:1000000, tsumitateLifetime:2200000, growthLifetime:3000000,
    soldThisYearAtCost:800000, annualTsumitateRemaining:600000, annualGrowthRemaining:1400000,
    lifetimeRemaining:12800000, growthCapRemaining:9000000, monthlyToFillTsumitate:100000, restoresYear:2027,
  });
});
```

- [ ] **Step 2: Run to verify fail** — FAIL

- [ ] **Step 3: Implement nisaFacts + nisaRaw**（`nisaDerive` の直後）

```javascript
  // B#3: production 集約facts（両モード同値・生¥ゼロ・全数値leaf整数[-100,150]）。未設定は undefined＝キー省略。
  // lifetimeFillEtaBucket は cashflow ペース由来ゆえ既定'none'＝modeAFacts の cashflow ブロックが上書き（roadmap.etaToCoreBucket と同型）。
  function nisaFacts(state, nowMs) {
    var d = nisaDerive(state, nowMs);
    if (!d.configured) return undefined;
    return {
      source: d.n.source,
      annualTsumitateUsedPct: d.annualTsumitateUsedPct,
      annualGrowthUsedPct: d.annualGrowthUsedPct,
      annualTotalUsedPct: d.annualTotalUsedPct,
      lifetimeUsedPct: d.lifetimeUsedPct,
      growthCapUsedPct: d.growthCapUsedPct,
      annualRoomRemaining: d.annualTotalRemaining > 0,
      lifetimeRoomRemaining: d.lifetimeRemaining > 0,
      growthCapRoomRemaining: d.growthCapRemaining > 0,
      overContribution: d.overContribution,
      hasRestorationPending: d.hasRestorationPending,
      staleAnchorYear: d.staleAnchorYear,
      lifetimeFillEtaBucket: "none",
    };
  }

  // B#3: personal のみの生¥ブロック（facts.raw.nisa）。未設定は undefined＝キー省略。
  function nisaRaw(state, nowMs) {
    var d = nisaDerive(state, nowMs);
    if (!d.configured) return undefined;
    return {
      tsumitateThisYear: d.atUsed, growthThisYear: d.agUsed,
      tsumitateLifetime: d.n.tsumitateLifetime, growthLifetime: d.n.growthLifetime,
      soldThisYearAtCost: d.n.soldThisYearAtCost,
      annualTsumitateRemaining: d.annualTsumitateRemaining,
      annualGrowthRemaining: d.annualGrowthRemaining,
      lifetimeRemaining: d.lifetimeRemaining,
      growthCapRemaining: d.growthCapRemaining,
      monthlyToFillTsumitate: d.monthlyToFillTsumitate,
      restoresYear: d.restoresYear,
    };
  }
```

- [ ] **Step 4: exports に追記**（`nisaDerive: nisaDerive,` の後）

```javascript
    nisaFacts: nisaFacts, nisaRaw: nisaRaw,
```

- [ ] **Step 5: Run tests** — PASS

- [ ] **Step 6: Commit**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(nisa): nisaFacts + nisaRaw アダプタ（JS・Task3）"
```

---

## Task 4: nisaViewModel（JS・UI専用）

**Files:**
- Modify: `money-rules.js`（`nisaRaw` の直後）
- Test: `tests/money-rules.test.js`

**Interfaces:**
- Consumes: `nisaDerive`（Task2）・`projectMonths`/`etaBucket`（既存）。`cd`＝`cashflowDerived` 戻り（`.investableSurplus`）。
- Produces: `R.nisaViewModel(state,cd,nowMs)→{configured, annual:{tsumitate,growth,total}, lifetime:{cap,used,remaining,usedPct,over,tsumitatePortion,growthPortion}, growthCap:{cap,used,remaining,usedPct,over}, restoration:{sold,restoresYear,hasPending}, staleYear, monthlyPace, fillEta, monthlyToFillTsumitate, monthlyToFillGrowth, monthsLeft, year}`（¥＋%・UI描画専用・パリティ不要）。

- [ ] **Step 1: Write failing test**

```javascript
test("nisaViewModel: UI用VM（枠¥+%・fillEta・積立接続）", () => {
  const st = R.migrate({ nisa:{ anchorYear:2026, tsumitateThisYear:600000, growthThisYear:1000000,
    tsumitateLifetime:2200000, growthLifetime:3000000, soldThisYearAtCost:800000 } });
  const cd = { investableSurplus: 150000 };
  const vm = R.nisaViewModel(st, cd, Date.UTC(2026,6,15));
  assert.equal(vm.configured, true);
  assert.equal(vm.annual.tsumitate.cap, 1200000);
  assert.equal(vm.annual.tsumitate.used, 600000);
  assert.equal(vm.annual.tsumitate.remaining, 600000);
  assert.equal(vm.annual.tsumitate.usedPct, 50);
  assert.equal(vm.lifetime.used, 5200000);
  assert.equal(vm.lifetime.tsumitatePortion, 2200000);
  assert.equal(vm.lifetime.growthPortion, 3000000);
  assert.equal(vm.growthCap.cap, 12000000);
  assert.equal(vm.restoration.restoresYear, 2027);
  assert.equal(vm.restoration.hasPending, true);
  assert.equal(vm.monthlyPace, 150000);
  assert.equal(vm.fillEta, "over_10y");          // 1280万/15万=86ヶ月<120→"3_10y"? 86<120 → "3_10y"
  assert.equal(vm.monthlyToFillTsumitate, 100000);
});
```
> 注：1280万/15万=85.3→ceil86ヶ月。etaBucket(86)= 36<=86<120 → "3_10y"。上の期待値を "3_10y" に修正して記載すること（実装後に実値で確定）。

- [ ] **Step 2: Run to verify fail** — FAIL

- [ ] **Step 3: Implement nisaViewModel**（`nisaRaw` の直後）

```javascript
  // B#3: UI描画専用VM（¥+%・パリティ不要＝money.js が描く。業務mathはここに集約）。
  function nisaViewModel(state, cd, nowMs) {
    var d = nisaDerive(state, nowMs);
    var pace = (cd && cd.investableSurplus > 0) ? cd.investableSurplus : 0;
    var fillEta = etaBucket(projectMonths(d.lifetimeRemaining, pace));
    return {
      configured: d.configured,
      annual: {
        tsumitate: { cap: NISA_ANNUAL_TSUMITATE, used: d.atUsed, remaining: d.annualTsumitateRemaining, usedPct: d.annualTsumitateUsedPct, over: d.atUsed > NISA_ANNUAL_TSUMITATE },
        growth: { cap: NISA_ANNUAL_GROWTH, used: d.agUsed, remaining: d.annualGrowthRemaining, usedPct: d.annualGrowthUsedPct, over: d.agUsed > NISA_ANNUAL_GROWTH },
        total: { cap: NISA_ANNUAL_TOTAL, used: d.atTotal, remaining: d.annualTotalRemaining, usedPct: d.annualTotalUsedPct, over: d.atTotal > NISA_ANNUAL_TOTAL },
      },
      lifetime: { cap: NISA_LIFETIME, used: d.lifeUsed, remaining: d.lifetimeRemaining, usedPct: d.lifetimeUsedPct, over: d.lifeUsed > NISA_LIFETIME, tsumitatePortion: d.n.tsumitateLifetime, growthPortion: d.n.growthLifetime },
      growthCap: { cap: NISA_GROWTH_LIFETIME_CAP, used: d.n.growthLifetime, remaining: d.growthCapRemaining, usedPct: d.growthCapUsedPct, over: d.n.growthLifetime > NISA_GROWTH_LIFETIME_CAP },
      restoration: { sold: d.n.soldThisYearAtCost, restoresYear: d.restoresYear, hasPending: d.hasRestorationPending },
      staleYear: d.staleAnchorYear, monthlyPace: pace, fillEta: fillEta,
      monthlyToFillTsumitate: d.monthlyToFillTsumitate, monthlyToFillGrowth: d.monthlyToFillGrowth,
      monthsLeft: d.monthsLeft, year: d.year,
    };
  }
```

- [ ] **Step 4: exports に追記**（`nisaRaw: nisaRaw,` の後）

```javascript
    nisaViewModel: nisaViewModel,
```

- [ ] **Step 5: Run tests** — PASS（fillEta 実値を "3_10y" で確定）

- [ ] **Step 6: Commit**

```bash
git add money-rules.js tests/money-rules.test.js
git commit -m "feat(nisa): nisaViewModel UI用VM（JS・Task4）"
```

---

## Task 5: Python 鏡像（_normalize_nisa/_nisa_now/_nisa_derive/_nisa_facts/_nisa_raw + _migrate配線）

**Files:**
- Modify: `api/me/advice.py`（定数を SCHEMA_VERSION 付近／ヘルパを `_asset_classes_facts`:827 付近／`_migrate`:416-458）
- Test: `tests/test_advice_facts.py`

**Interfaces:**
- Produces: `advice._nisa_facts(state, now_ms)` / `advice._nisa_raw(state, now_ms)` / `advice._normalize_nisa(raw)` — JS `nisaFacts`/`nisaRaw`/`normalizeNisa` の byte-parity 鏡像。`_migrate(raw)["nisa"]`。

- [ ] **Step 1: Write failing tests**（`tests/test_advice_facts.py` に追記）

```python
def test_normalize_nisa_shape():
    z = advice._normalize_nisa(None)
    assert z == {"source":"manual","anchorYear":0,"tsumitateThisYear":0,"growthThisYear":0,
                 "tsumitateLifetime":0,"growthLifetime":0,"soldThisYearAtCost":0}
    n = advice._normalize_nisa({"source":"bogus","tsumitateThisYear":"600000","growthThisYear":[1],"XXX":9})
    assert n["source"] == "manual"
    assert n["tsumitateThisYear"] == 600000
    assert n["growthThisYear"] == 0
    assert "XXX" not in n

def test_nisa_facts_mirror():
    st = advice._migrate({"nisa":{"anchorYear":2026,"tsumitateThisYear":600000,"growthThisYear":1000000,
        "tsumitateLifetime":2200000,"growthLifetime":3000000,"soldThisYearAtCost":800000}})
    now = 1784073600000  # 2026-07 UTC 相当（JS Date.UTC(2026,6,15) と同月）
    f = advice._nisa_facts(st, now)
    assert f["annualTsumitateUsedPct"] == 50
    assert f["lifetimeUsedPct"] == 29
    assert f["hasRestorationPending"] is True
    assert f["lifetimeFillEtaBucket"] == "none"
    assert advice._nisa_facts(advice._migrate({}), now) is None  # 未設定→None

def test_nisa_raw_mirror():
    st = advice._migrate({"nisa":{"anchorYear":2026,"tsumitateThisYear":600000,"growthThisYear":1000000,
        "tsumitateLifetime":2200000,"growthLifetime":3000000,"soldThisYearAtCost":800000}})
    rw = advice._nisa_raw(st, 1784073600000)
    assert rw["lifetimeRemaining"] == 12800000
    assert rw["restoresYear"] == 2027
```
> `now_ms` は JS の `Date.UTC(2026,6,15)` と同じ月(7月)になる epoch を使う（`_case_now` 経由でも可）。月ズレると monthlyToFillTsumitate/staleAnchorYear が食い違うので JS テストと同月を厳守。

- [ ] **Step 2: Run to verify fail** — `PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q` → FAIL

- [ ] **Step 3: 定数を追加**（`SCHEMA_VERSION = 4` 付近・`SATELLITE_UNLOCK_CORE_PCT = 50` の後）

```python
NISA_ANNUAL_TSUMITATE = 1200000
NISA_ANNUAL_GROWTH = 2400000
NISA_ANNUAL_TOTAL = 3600000
NISA_LIFETIME = 18000000
NISA_GROWTH_LIFETIME_CAP = 12000000
NISA_SOURCES = ("manual", "history", "ledger")
```

- [ ] **Step 4: ヘルパを追加**（`_asset_classes_facts`(advice.py:827) の直前 or 直後）

```python
def _normalize_nisa(raw):
    """money-rules.js normalizeNisa の鏡像（固定形状・非オブジェクト→全0骨格・scalar-only coerce・未知キー破棄）。"""
    s = raw if isinstance(raw, dict) else {}
    return {
        "source": s.get("source") if s.get("source") in NISA_SOURCES else "manual",
        "anchorYear": _num(s.get("anchorYear")),
        "tsumitateThisYear": _num(s.get("tsumitateThisYear")),
        "growthThisYear": _num(s.get("growthThisYear")),
        "tsumitateLifetime": _num(s.get("tsumitateLifetime")),
        "growthLifetime": _num(s.get("growthLifetime")),
        "soldThisYearAtCost": _num(s.get("soldThisYearAtCost")),
    }


def _nisa_now(now_ms):
    """money-rules.js nisaNow の鏡像（UTC 年/月0基・[1,9999] ガード）。"""
    ms = _num(now_ms)
    try:
        d = datetime.datetime.utcfromtimestamp(ms / 1000.0)
    except (OverflowError, OSError, ValueError):
        return {"year": 0, "monthIndex": 0, "valid": False}
    y = d.year
    if not (1 <= y <= 9999):
        return {"year": 0, "monthIndex": 0, "valid": False}
    return {"year": y, "monthIndex": d.month - 1, "valid": True}


def _nisa_derive(state, now_ms):
    """money-rules.js nisaDerive の鏡像（単一計算源）。"""
    n = _normalize_nisa(state.get("nisa") if isinstance(state, dict) else None)
    configured = (n["anchorYear"] > 0 or n["tsumitateThisYear"] > 0 or n["growthThisYear"] > 0
                  or n["tsumitateLifetime"] > 0 or n["growthLifetime"] > 0 or n["soldThisYearAtCost"] > 0)
    now = _nisa_now(now_ms)
    at, ag = n["tsumitateThisYear"], n["growthThisYear"]
    at_total = at + ag
    life_used = n["tsumitateLifetime"] + n["growthLifetime"]
    at_rem = max(0.0, NISA_ANNUAL_TSUMITATE - at)
    ag_rem = max(0.0, NISA_ANNUAL_GROWTH - ag)
    at_total_rem = max(0.0, NISA_ANNUAL_TOTAL - at_total)
    life_rem = max(0.0, NISA_LIFETIME - life_used)
    gcap_rem = max(0.0, NISA_GROWTH_LIFETIME_CAP - n["growthLifetime"])
    months_left = (12 - now["monthIndex"]) if now["valid"] else 0
    return {
        "configured": configured, "n": n, "year": now["year"], "monthIndex": now["monthIndex"], "valid": now["valid"],
        "atUsed": at, "agUsed": ag, "atTotal": at_total,
        "annualTsumitateRemaining": at_rem, "annualGrowthRemaining": ag_rem, "annualTotalRemaining": at_total_rem,
        "lifeUsed": life_used, "lifetimeRemaining": life_rem, "growthCapRemaining": gcap_rem,
        "annualTsumitateUsedPct": _clamp(_r(at / NISA_ANNUAL_TSUMITATE * 100), 0, 100),
        "annualGrowthUsedPct": _clamp(_r(ag / NISA_ANNUAL_GROWTH * 100), 0, 100),
        "annualTotalUsedPct": _clamp(_r(at_total / NISA_ANNUAL_TOTAL * 100), 0, 100),
        "lifetimeUsedPct": _clamp(_r(life_used / NISA_LIFETIME * 100), 0, 100),
        "growthCapUsedPct": _clamp(_r(n["growthLifetime"] / NISA_GROWTH_LIFETIME_CAP * 100), 0, 100),
        "overContribution": (at > NISA_ANNUAL_TSUMITATE or ag > NISA_ANNUAL_GROWTH or at_total > NISA_ANNUAL_TOTAL
                             or life_used > NISA_LIFETIME or n["growthLifetime"] > NISA_GROWTH_LIFETIME_CAP),
        "hasRestorationPending": n["soldThisYearAtCost"] > 0,
        "staleAnchorYear": now["valid"] and n["anchorYear"] > 0 and n["anchorYear"] < now["year"],
        "monthsLeft": months_left,
        "monthlyToFillTsumitate": math.ceil(at_rem / months_left) if months_left > 0 else 0,
        "monthlyToFillGrowth": math.ceil(ag_rem / months_left) if months_left > 0 else 0,
        "restoresYear": (now["year"] + 1) if now["valid"] else 0,
    }


def _nisa_facts(state, now_ms):
    """money-rules.js nisaFacts の鏡像（production 集約・未設定は None）。"""
    d = _nisa_derive(state, now_ms)
    if not d["configured"]:
        return None
    return {
        "source": d["n"]["source"],
        "annualTsumitateUsedPct": d["annualTsumitateUsedPct"],
        "annualGrowthUsedPct": d["annualGrowthUsedPct"],
        "annualTotalUsedPct": d["annualTotalUsedPct"],
        "lifetimeUsedPct": d["lifetimeUsedPct"],
        "growthCapUsedPct": d["growthCapUsedPct"],
        "annualRoomRemaining": d["annualTotalRemaining"] > 0,
        "lifetimeRoomRemaining": d["lifetimeRemaining"] > 0,
        "growthCapRoomRemaining": d["growthCapRemaining"] > 0,
        "overContribution": d["overContribution"],
        "hasRestorationPending": d["hasRestorationPending"],
        "staleAnchorYear": d["staleAnchorYear"],
        "lifetimeFillEtaBucket": "none",
    }


def _nisa_raw(state, now_ms):
    """money-rules.js nisaRaw の鏡像（personal 生¥・未設定は None）。"""
    d = _nisa_derive(state, now_ms)
    if not d["configured"]:
        return None
    return {
        "tsumitateThisYear": d["atUsed"], "growthThisYear": d["agUsed"],
        "tsumitateLifetime": d["n"]["tsumitateLifetime"], "growthLifetime": d["n"]["growthLifetime"],
        "soldThisYearAtCost": d["n"]["soldThisYearAtCost"],
        "annualTsumitateRemaining": d["annualTsumitateRemaining"],
        "annualGrowthRemaining": d["annualGrowthRemaining"],
        "lifetimeRemaining": d["lifetimeRemaining"],
        "growthCapRemaining": d["growthCapRemaining"],
        "monthlyToFillTsumitate": d["monthlyToFillTsumitate"],
        "restoresYear": d["restoresYear"],
    }
```
> `import datetime`/`import math` は既存（advice.py 冒頭）を確認して使う（未importなら追加）。`_num`/`_r`/`_clamp` は既存（169-224）。

- [ ] **Step 5: _migrate に配線**（`_migrate` の return dict の `"assetSource": ...` の直後）

```python
        "nisa": _normalize_nisa(raw.get("nisa")),
```

- [ ] **Step 6: Run tests** — PASS（新規Py 3テスト緑）

- [ ] **Step 7: Commit**

```bash
git add api/me/advice.py tests/test_advice_facts.py
git commit -m "feat(nisa): Python鏡像 _normalize_nisa/_nisa_derive/_nisa_facts/_nisa_raw + _migrate（Task5）"
```

---

## Task 6: SCHEMA lockstep bump 4→5

**Files:**
- Modify: `money-rules.js:15` / `api/me/advice.py:30` / `tests/money-rules.test.js:347` / `tests/test_advice_facts.py:220` / `tests/fixtures/advice_facts_cases.json`（全80箇所）

**Interfaces:** 出力形状は不変・版番号のみ 4→5。既存テストは緑のまま（version文字列一致更新）。

- [ ] **Step 1: money-rules.js の版定数を更新**（:15）

```javascript
  var FACTS_SCHEMA_VERSION = 5; // v5: NISA枠（backlog B #3）nisa 集約を facts に追加
```

- [ ] **Step 2: advice.py の版定数を更新**（:30）

```python
SCHEMA_VERSION = 5  # v5: NISA枠（backlog B #3）nisa 集約を facts に追加
```

- [ ] **Step 3: テスト assertion を更新**

`tests/money-rules.test.js:347-349`：
```javascript
test("FACTS_SCHEMA_VERSION は 5（NISA枠 nisa 集約追加で bump）", () => {
  assert.equal(R.FACTS_SCHEMA_VERSION, 5);
});
```
`tests/test_advice_facts.py:220-221`：
```python
def test_schema_version_5():
    assert advice.SCHEMA_VERSION == 5
```

- [ ] **Step 4: fixture の schemaVersion を一括置換**（40ケース×production/personal＝80箇所・機械置換）

Run:
```bash
python3 -c "import json,io; p='tests/fixtures/advice_facts_cases.json'; d=json.load(open(p,encoding='utf-8'));
import sys
for c in d['cases']:
    for m in ('production','personal'):
        if isinstance(c.get(m),dict) and c[m].get('schemaVersion')==4: c[m]['schemaVersion']=5
open(p,'w',encoding='utf-8').write(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
print('bumped')"
grep -c '"schemaVersion": 5' tests/fixtures/advice_facts_cases.json
```
Expected: `80`（漏れゼロ）。
> ⚠️ 上記は JSON を再整形する。既存 fixture の整形と差分が大きくなる場合は `sed -i 's/"schemaVersion": 4/"schemaVersion": 5/g' tests/fixtures/advice_facts_cases.json` で最小差分置換に切替（その後 `grep -c` で 80 を確認）。

- [ ] **Step 5: Run both suites**

Run: `node --test 'tests/*.test.js'`
Expected: PASS（全緑・schemaVersion=5）
Run: `PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add money-rules.js api/me/advice.py tests/money-rules.test.js tests/test_advice_facts.py tests/fixtures/advice_facts_cases.json
git commit -m "chore(nisa): FACTS_SCHEMA_VERSION 4→5 lockstep bump（Task6）"
```

---

## Task 7: facts.nisa を modeAFacts/mode_a_facts に配線 + coarsen + allowlist + fixture + SYS（RED-first）

**Files:**
- Modify: `money-rules.js`（modeAFacts:896-933 配線・cashflow ブロックの roadmap.etaToCoreBucket 付近）
- Modify: `api/me/advice.py`（mode_a_facts:879-923 配線・coarsen_facts:1060-1096・SYS_*:64-90）
- Modify: `tests/money-rules.test.js`（PROD_TOP_KEYS）/ `tests/test_advice_facts.py`（ALLOW）
- Modify: `tests/fixtures/advice_facts_cases.json`（nisa-a〜h 追加）

**Interfaces:**
- Consumes: `nisaFacts`/`nisaRaw`（Task3）・`_nisa_facts`/`_nisa_raw`（Task5）。
- Produces: `facts.nisa`（configured時・両モード同値）・`facts.raw.nisa`（personal時）・`coarsen_facts` が nisa の *UsedPct を _bucket25。

- [ ] **Step 1: allowlist に nisa キーを追加（両言語）**

`tests/money-rules.test.js` の `PROD_TOP_KEYS` に `// Task5 B#2` 行の直後（`]);` の前）へ追記：
```javascript
  "nisa", "annualTsumitateUsedPct", "annualGrowthUsedPct", "annualTotalUsedPct",
  "lifetimeUsedPct", "growthCapUsedPct", "annualRoomRemaining", "lifetimeRoomRemaining",
  "growthCapRoomRemaining", "overContribution", "hasRestorationPending", "staleAnchorYear",
  "lifetimeFillEtaBucket", // B#3 NISA（source は既存キー名と衝突しないため別途: 下行）
  "source",
```
`tests/test_advice_facts.py` の `ALLOW` に `# Task5 B#2` の直後へ同一キーを追記：
```python
    "nisa", "annualTsumitateUsedPct", "annualGrowthUsedPct", "annualTotalUsedPct",
    "lifetimeUsedPct", "growthCapUsedPct", "annualRoomRemaining", "lifetimeRoomRemaining",
    "growthCapRoomRemaining", "overContribution", "hasRestorationPending", "staleAnchorYear",
    "lifetimeFillEtaBucket", "source",  # B#3 NISA
```

- [ ] **Step 2: fixture に nisa-a〜h ケースを追加（RED-first の核）**

`tests/fixtures/advice_facts_cases.json` の `cases` 配列末尾に8ケースを追加。各ケースの `state` は最小 state（他フィールドは migrate 既定で補完される形＝既存の cashflow-smoothed ケースのような部分 state 可）＋ `nisa` サブオブジェクト、`production`/`personal` は期待出力。**期待値は先に「概算」で書き RED を出し、Step 3-5 実装後に実出力で確定する**（B#2 と同じ運用）。ケース一覧（spec §9.2）：
```
nisa-a-unconfigured        : nisa 全0 → production/personal に "nisa" キー無し
nisa-b-annual-tsumitate-full: tsumitateThisYear=1200000 → annualTsumitateUsedPct=100, annualRoomRemaining=true
nisa-c-lifetime-near-full  : tsumitateLifetime=17000000 → lifetimeUsedPct=94, lifetimeRoomRemaining=true
nisa-d-growthcap-hit       : growthLifetime=12000000 → growthCapUsedPct=100, growthCapRoomRemaining=false
nisa-e-restoration         : soldThisYearAtCost=500000 → hasRestorationPending=true, personal.raw.nisa.restoresYear=年+1
nisa-f-stale-year          : anchorYear=2025, nowMs=2026年1月 → staleAnchorYear=true
nisa-g-adversarial-coerce  : tsumitateThisYear=[1], growthLifetime="0x10", source="bogus" → 全て0/manual, "nisa"キー無し（全0ゆえ未configured）
nisa-h-over-contribution   : tsumitateThisYear=1500000 → overContribution=true, annualTsumitateUsedPct=100
```
各ケースは `nowMs` を明示（JS `caseNow` と Py `_case_now` が吸収）。personal は production と同じ `nisa` ブロック＋末尾 `raw.nisa`。

- [ ] **Step 3: Run to verify RED** — `node --test 'tests/*.test.js'` → FAIL（`nisa mismatch` / `unexpected key 'nisa'` 等）。RED を確認（実装前ゆえ facts に nisa が無い or 期待値ズレ）。

- [ ] **Step 4: modeAFacts に配線（JS）**（`money-rules.js` の assetClasses 配線 `if (acFacts) facts.assetClasses = acFacts;` の直後）

```javascript
    // B#3: NISA枠（backlog B #3）。未設定は nisa キー自体を省く（assetClasses と同型・両モード同値）。
    var niFacts = nisaFacts(s, nowMs);
    if (niFacts) facts.nisa = niFacts;
```
`if (includeRaw) { facts.raw = {...}; }` ブロックの **raw オブジェクト構築後**（`};` の直後）に raw.nisa を追加：
```javascript
      var niRaw = nisaRaw(s, nowMs);
      if (niRaw) facts.raw.nisa = niRaw;
```
cashflow ブロックの `facts.roadmap.etaToCoreBucket = ...`（roadmap ETA 上書き行）の直後に nisa ETA 上書きを追加（同じ rate 変数を使う）：
```javascript
      // B#3: 生涯枠充填 ETA も cashflow ペースで上書き（roadmap.etaToCoreBucket と同型・既定'none'を実バケツへ）。
      if (facts.nisa) facts.nisa.lifetimeFillEtaBucket = etaBucket(projectMonths(nisaDerive(s, nowMs).lifetimeRemaining, <roadmap ETA と同じ rate 変数>));
```
> `<roadmap ETA と同じ rate 変数>`＝既存 `facts.roadmap.etaToCoreBucket = etaBucket(projectMonths(gap, RATE))` 行の `RATE` に相当する変数（月次投資余力）をそのまま使う。実ファイルで該当行を確認して同一変数を入れる。

- [ ] **Step 5: mode_a_facts に配線（Py）**（`api/me/advice.py` の `if ac is not None: facts["assetClasses"] = ac` の直後）

```python
    # B#3: NISA枠（backlog B #3）。未設定は nisa キー自体を省く（両モード同値）。
    ni = _nisa_facts(s, now_ms)
    if ni is not None:
        facts["nisa"] = ni
```
`if include_raw:` の `facts["raw"] = {...}` 構築後に raw.nisa を追加：
```python
        ni_raw = _nisa_raw(s, now_ms)
        if ni_raw is not None:
            facts["raw"]["nisa"] = ni_raw
```
cashflow ブロックの roadmap ETA 上書き（`facts["roadmap"]["etaToCoreBucket"] = ...`）の直後：
```python
        # B#3: 生涯枠充填 ETA を cashflow ペースで上書き（roadmap と同型）。
        if "nisa" in facts:
            facts["nisa"]["lifetimeFillEtaBucket"] = _eta_bucket(_project_months(_nisa_derive(s, now_ms)["lifetimeRemaining"], <roadmap ETA と同じ rate 変数>))
```
> `_eta_bucket`/`_project_months` の実関数名は advice.py の該当（roadmap ETA 行）を確認して合わせる。rate 変数も同上。

- [ ] **Step 6: coarsen_facts に nisa 走査を追加（Py）**（`coarsen_facts` の assetClasses ブロックの直後）

```python
    # B#3: NISA は非再帰 allowlist の対象外ゆえ明示走査（*UsedPct を 25刻み・enum/bool は透過・source は非粗化）。
    if isinstance(out.get("nisa"), dict):
        ni = dict(out["nisa"])
        for k in ("annualTsumitateUsedPct", "annualGrowthUsedPct", "annualTotalUsedPct",
                  "lifetimeUsedPct", "growthCapUsedPct"):
            if k in ni:
                ni[k] = _bucket25(ni[k])
        out["nisa"] = ni
```

- [ ] **Step 7: SYS_PRODUCTION / SYS_PERSONAL に nisa 説明1節を追加（Py）**（両定数の⑦roadmap説明の直後の文字列リテラルとして・カンマ無し連結）

`SYS_PRODUCTION` に追記（⑦の文字列の後・出力JSON説明の前）：
```python
    "⑧nisa は本人のNISA枠設定からの集計であり相場予測ではない。非課税枠の消化率・残枠の意味は"
    "教育的に説明してよいが、具体的な銘柄選定や購入指示はしない。金額は与えられない。"
```
`SYS_PERSONAL` に追記（同位置）：
```python
    "⑥nisa は本人のNISA枠設定からの集計。非課税枠の活用（つみたて/成長の使い分け・課税口座との比較）は"
    "教育的に助言してよいが、断定的な将来利益の保証はしない。"
```

- [ ] **Step 8: 実出力で fixture 期待値を確定 → GREEN**

Run（JS 実出力を出して nisa-* の production/personal を確定・目視で範囲/キーを確認しながら fixture を修正）:
```bash
node --test 'tests/*.test.js'
```
mismatch メッセージの diff を見て fixture の nisa-* 期待値を実出力に合わせる（生¥が production に漏れていないか・数値[-100,150]・キー allowlist を必ず確認）。合ったら：
Run: `node --test 'tests/*.test.js'` → PASS
Run: `PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q` → PASS

- [ ] **Step 9: coarsen テストを追加（Py）**（nisa の生% が advice_log 用に 25刻みへ）

```python
def test_coarsen_nisa_buckets_pct():
    st = advice._migrate({"nisa":{"anchorYear":2026,"tsumitateThisYear":600000}})
    f = advice.mode_a_facts(st, False, 1784073600000)
    c = advice.coarsen_facts(f)
    assert c["nisa"]["annualTsumitateUsedPct"] in (0,25,50,75,100)
    assert "raw" not in c
```
Run: pytest → PASS

- [ ] **Step 10: Commit**

```bash
git add money-rules.js api/me/advice.py tests/money-rules.test.js tests/test_advice_facts.py tests/fixtures/advice_facts_cases.json
git commit -m "feat(nisa): facts.nisa を modeAFacts/mode_a_facts に配線 + coarsen + allowlist + fixture + SYS（Task7）"
```

---

## Task 8: パリティ fuzz（genNisa）

**Files:**
- Modify: `scratchpad/b2-parity-fuzz.js`（`genState`:162-185）

**Interfaces:** state に nisa を adversarial 生成で乗せるだけ（modeAFacts が両モードで拾う・配線変更不要）。

- [ ] **Step 1: genState に nisa 生成を追加**（`return s;` の直前）

```javascript
  if (maybe(0.7)) {
    const ni = {};
    if (maybe(0.8)) ni.anchorYear = genScalarAdversarial();
    if (maybe(0.85)) ni.tsumitateThisYear = genScalarAdversarial();
    if (maybe(0.85)) ni.growthThisYear = genScalarAdversarial();
    if (maybe(0.8)) ni.tsumitateLifetime = genScalarAdversarial();
    if (maybe(0.8)) ni.growthLifetime = genScalarAdversarial();
    if (maybe(0.6)) ni.soldThisYearAtCost = genScalarAdversarial();
    if (maybe(0.4)) ni.source = pick(["manual","history","ledger","bogus",123]);
    s.nisa = ni;
  }
```

- [ ] **Step 2: Run fuzz**

Run: `node scratchpad/b2-parity-fuzz.js 800 42`
Expected: `mismatches: 0`（800ケース×2モード＝1600比較・0 mismatch）
> mismatch が出たら `scratchpad/b2-parity-fuzz-mismatches.json` を見て JS/Py の nisa 導出差（特に nisaNow の極値 nowMs・math.ceil vs Math.ceil）を修正。

- [ ] **Step 3: Commit**

```bash
git add scratchpad/b2-parity-fuzz.js
git commit -m "test(nisa): パリティ fuzz に genNisa 追加（0 mismatch・Task8）"
```

---

## Task 9: UI（GLOSSARY + nisaSection + theme D CSS）

**Files:**
- Modify: `money-rules.js`（GLOSSARY:21-31 に NISA 語彙）
- Modify: `money.js`（`nisaSection(vm)` + 色/名前const + `render()` 連結 + `_JUMP_TARGETS`）
- Modify: `money.css`（baseline `.mcc-nisa-*` + theme D）
- Test: Playwright smoke（`scratchpad/nisa-ui-smoke.js`）

**Interfaces:**
- Consumes: `R.nisaViewModel(state, cd, nowMs)`（Task4）・`termHelp`・`moneyInput`/`setField`（既存）。
- Produces: `#mcc-sec-nisa` セクション（レイアウトD）。

- [ ] **Step 1: GLOSSARY に NISA 語彙を追加**（`money-rules.js` GLOSSARY 配列末尾・`資産クラス` エントリの後）

```javascript
    { term: "NISA枠", read: "非課税で投資できる枠", def: "NISA口座で買うと運用益が非課税になる投資の上限枠。当年枠(つみたて120万/成長240万)と生涯枠(1800万・簿価)があります。" },
    { term: "つみたて投資枠", read: "年120万の積立枠", def: "新NISAの積立専用枠。年間120万円まで、金融庁指定の投信を積み立てられます。" },
    { term: "成長投資枠", read: "年240万の成長枠", def: "新NISAの成長枠。年間240万円まで、上場株やETF・投信を購入できます(生涯内数1200万まで)。" },
    { term: "生涯投資枠", read: "生涯1800万の非課税枠", def: "NISAで非課税に保有できる生涯上限(簿価1800万円)。売却すると翌年に枠が復活します。" },
```

- [ ] **Step 2: money.js に色/名前 const と nisaSection を追加**（`assetClassSection` 付近・同流儀）

nisaSection は `R.nisaViewModel(state, cd, now)` を受け、レイアウトD（HUD＋生涯枠ヒーロードーナツ＋生涯総枠/成長内数の2段バー＋当年2ゲージ＋アクションチップ＋入力アコーディオン）の HTML 文字列を返す。確定 mock は `.superpowers/brainstorm/107523-1784134765/content/nisa-layout-v2.html` の OPTION D を実装基準にする。要点：
- ¥は `sync.loggedIn` 時のみ `R.yen()` で表示（%/バー/構造/入力欄は常時）。
- 業務mathは money.js に書かない（全数値は vm 由来）。表示専用の幅clamp/色ストップ/conic-gradient stop のみ money.js 可（コメント明記）。
- 入力欄は `moneyInput('...', 'nisa.tsumitateThisYear', vm...)` 等 or 直書き `<input onchange="MCC.setField('nisa.anchorYear', this.value)">`（`setField` はドットパスで nisa.* を辿る＝Task1 の state 構造で動く）。over/staleYear はチップ/色で警告。
- theme D 面禁則（半透明地＋ネオン縁＋glow）。色トークン流用（cyan=つみたて/データ, emerald=成長, violet=生涯ヒーロー, amber=残/積立, danger=over）。

```javascript
  // B#3 NISA枠セクション（レイアウトD）。業務math無し＝vm(R.nisaViewModel)由来のみ描画。
  function nisaSection(vm) {
    if (!vm) return "";
    var loggedIn = sync.loggedIn;
    var yen = function (n) { return loggedIn ? R.yen(n) : ""; };
    // …（レイアウトD の HTML を組む：section-title[NISA_QUOTA/非課税枠 + termHelp('NISA枠')] +
    //    HUD(年間残/生涯残/成長内数残/充填/来年復活) + hero(donut lifetimeUsedPct + 生涯総枠2段バー) +
    //    当年 grid2(つみたて/成長 gauge) + chips(monthlyToFillTsumitate/restoration/staleYear/over) +
    //    入力 details(6+1 input → MCC.setField('nisa.<field>', ...)))。mock OPTION D を忠実移植。…）
    return html;
  }
```
> nisaSection の完全 HTML は mock（nisa-layout-v2 OPTION D）を1:1移植する。moneyInput/termHelp/mcc-section-title/mcc-section-desc の既存ヘルパを使い、新規クラスは `.mcc-nisa-*` 命名。

- [ ] **Step 3: render() の連結に挿入**（`assetClassSection(...)` の直後・`money.js` の root.innerHTML 連結行）

```javascript
      nisaSection(R.nisaViewModel(state, cd, now)) +
```

- [ ] **Step 4: _JUMP_TARGETS に登録**（`money.js:1068` 付近）

`"mcc-sec-nisa"` を配列に追加（jumpTo 対応）。

- [ ] **Step 5: money.css に baseline + theme D を追加**

baseline（構造/寸法）に `.mcc-nisa`, `.mcc-nisa-hud`, `.mcc-nisa-hero`, `.mcc-nisa-donut`, `.mcc-nisa-bar`, `.mcc-nisa-seg`, `.mcc-nisa-gauge`, `.mcc-nisa-chip`, `.mcc-nisa-fields` 等の寸法/grid/flex。theme D（`[data-theme="D"] #money-view .mcc-nisa-*`）に色/glow/blur/等幅。mock v2 の CSS を移植（トークンは money.css の `:root[data-theme="D"]` を参照＝`var(--c-cyan)` 等）。面禁則遵守。

- [ ] **Step 6: Playwright smoke**（`scratchpad/nisa-ui-smoke.js`・mock server で money.js を実配信）

検証項目（pageerror0）：`#mcc-sec-nisa` が存在／未ログインで %表示あり・¥非表示（readout gate）／ログインで ¥表示／入力欄が存在し `MCC.setField('nisa.*')` で state 反映→再描画／jumpTo('mcc-sec-nisa') が動く。
Run: `node scratchpad/nisa-ui-smoke.js`
Expected: 全アサート緑・console pageerror 0。

- [ ] **Step 7: Commit**

```bash
git add money-rules.js money.js money.css scratchpad/nisa-ui-smoke.js
git commit -m "feat(nisa): UI nisaSection（レイアウトD・theme D）+ GLOSSARY（Task9）"
```

---

## Task 10: 統合検証ゲート（全緑 + 敵対検証wf + 実機/本番）

**Files:** なし（検証のみ）

- [ ] **Step 1: 検証3点セット**

```bash
node --test 'tests/*.test.js'
PYTHONPATH=api/me .venv/bin/python -m pytest tests/test_advice_facts.py -q
node scratchpad/b2-parity-fuzz.js 800 42
```
Expected: node 全緑／pytest 全緑／fuzz `mismatches: 0`。

- [ ] **Step 2: whole-branch 敵対検証 wf（ultracode）**

観点＝規制境界(生¥非漏洩/production数値範囲)・JS↔Pyパリティ(byte一致)・送信ゼロ(client空body)・cf-1不変(既存機能非破壊)・stale描画(full re-render整合)・coarsen漏れ(nisa走査)・configured契約(未設定キー省略)。confirmed を微修正で潰し再検証。

- [ ] **Step 3: 実機サニティ + 本番反映**（worktree統合→push後）

- theme D の glow/glass/ドーナツ発色は太田さん実機で確認（GPU依存・headless非authoritative）。
- push 後 **本番ルート `/`** を curl（`/index.html` は15Bスタブ）／**通常URL と persona の両デプロイ**を curl で反映確認（money.js/money-rules.js に nisaSection マーカー・facts schemaVersion=5）。

---

## Self-Review（plan 完成後・spec 突合）

**1. Spec coverage:** §2 state.nisa=Task1／§3.1 定数=Task1／§3.2 nisaViewModel=Task4／§3.3 nisaFacts=Task3・Task7／§3.4 復活/年アンカー=Task2(nisaDerive)／§3.5 免責=既存DISCLAIMER(UI Task9)／§4.1 mode_a_facts配線=Task5・Task7／§4.2 層2 dormant=実装せず(spec設計のみ・本plan対象外)／§5 UI=Task9／§6 デザイン=Task9(mock基準)／§7 パリティ=Task5-8／§8 段階=Stage1のみ本plan／§9 テスト=各Task+Task10／§10 リスク=Global Constraints反映／§11 Non-goals=対象外。**全カバー**。

**2. Placeholder scan:** Task9 Step2 の nisaSection HTML本体は「mock OPTION D を1:1移植」と指示（mockが完全な視覚仕様＝実体あり）。`<roadmap ETA と同じ rate 変数>`(Task7 Step4/5) は実ファイル該当行から取得する明示指示＝実装者が現物から確定（既存 etaToCoreBucket 行が単一の参照先）。他にプレースホルダ無し。

**3. Type consistency:** state.nisa 7フィールド名・facts.nisa 13キー・raw.nisa 11キー・純関数6本の名称を「定数・命名」節で固定し全Taskで同一使用。JS `nisaFacts`↔Py `_nisa_facts`・`nisaRaw`↔`_nisa_raw`・`nisaDerive`↔`_nisa_derive` の対応一致。allowlist(PROD_TOP_KEYS/ALLOW)は Task7 で両言語同一キー。**整合**。
