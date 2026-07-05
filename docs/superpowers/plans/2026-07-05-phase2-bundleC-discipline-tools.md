# 束C「規律の道具化」①成長率エンジン ②保存できるスクリーナー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ポータル一覧に売上/純利益の成長率（YoY＋3期CAGR）を載せ、スクリーナーを8軸＋市場複数選択＋名前付きプリセット永続化へ拡張して「規律の道具」にする。

**Architecture:** 純ロジックはテスト付きモジュール（`finance-rules.js` に成長＋欠測ゲート、新 `screener-rules.js` に軸レジストリ/述語/プリセット schema）、DOM は index.html 薄層（入力→criteria 構築→純述語→描画）。ratio 軸は欠測→null 化で統一（D1）、市場は既存チップと両系統で整合（D2）。

**Tech Stack:** Vanilla JS（UMD-lite モジュール・`window.*`）、node:test（`node --test`）、Playwright（実ブラウザ検証）、localStorage 永続化。CDN 追加なし。

## Global Constraints

- **0x0罠**：新規 LWC/Chart canvas を追加しない（成長=inline SVG バッジ＋テキスト、スクリーナー=入力UI）。既存チャート/スパークライン SVG の寸法・初期化順序は無改変。
- **F2 IIFE 隔離**：index.html inline `<script>` の新公開関数は末尾 `Object.assign(window, …)`（index.html:2262）へ追加。`currentTicker`/`currentView` 生束縛に触れない。
- **成長バッジ色**：上昇/下降とも `--ix-text-secondary` 単色＋不透明度差のみ。緑/赤/金 hue 禁止（既存セルの緑=良/赤=悪セマフォアに合わせない）。
- **facts非出力・個人データ非接触**：money/advice/収支/investment 台帳に触れない。LLM 非経由。public market データをクライアント算出。
- **既存挙動保存**：positive 軸（PER/PBR）の非対称挙動（max-only は 0以下を保持）はテストで固定。ratio(nullable) の eqRatio/opMargin は D1 で欠測 null 化（意図的変更）。
- **単一源**：`yoy` は `DetailRules.yoyBadge` と数値一致。AXIS_REGISTRY.dom を軸の DOM ID 単一源にする（key 派生で ID 生成しない）。プリセット名は `window.esc`/`textContent` で描画。
- **テスト実行**：repo ルートから `node --test tests/<file>.test.js`（`require("../<module>.js")`）。Python は `pytest`。
- **値の単位**：DB 値は百万円/百万ドル（成長率は無次元%ゆえ通貨非依存）。

---

## Task 1: finance-rules.js — yoy / cagr（純関数）

**Files:**
- Modify: `finance-rules.js`（`return {…}` の前に追加＋return に追記）
- Test: `tests/finance-rules.test.js`（末尾に追加）

**Interfaces:**
- Produces: `FinanceRules.yoy(prev, curr) → Number|null`、`FinanceRules.cagr(begin, end, periods) → Number|null`

- [ ] **Step 1: 失敗するテストを書く**（`tests/finance-rules.test.js` 末尾）

```js
test("yoy: 正常な前年比", () => {
  assert.equal(F.yoy(100, 120), 20);
  assert.equal(F.yoy(200, 150), -25);
});
test("yoy: 基準0/欠測は null", () => {
  assert.equal(F.yoy(0, 100), null);
  assert.equal(F.yoy(null, 100), null);
});
test("yoy: 負基準は abs 分母（DetailRules.yoyBadge と同式）", () => {
  assert.equal(F.yoy(-100, -50), 50);   // 赤字が半減＝+50%
  assert.equal(F.yoy(-100, -150), -50); // 赤字が拡大＝-50%
});
test("cagr: 両端正・periods>=1 のみ", () => {
  assert.equal(Math.round(F.cagr(100, 121, 2) * 100) / 100, 10); // 10%
  assert.equal(F.cagr(-100, 100, 2), null); // 基準負→null
  assert.equal(F.cagr(100, -50, 2), null);  // 末尾負→null
  assert.equal(F.cagr(100, 121, 0), null);  // periods<1→null
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/finance-rules.test.js`
Expected: FAIL（`F.yoy is not a function`）

- [ ] **Step 3: 実装**（`finance-rules.js` の `return {` 直前に追加）

```js
  // 前年比 %。基準0/欠測は null。負基準は abs 分母（DetailRules.yoyBadge と数値一致＝単一源方針）。
  function yoy(prev, curr) {
    var p = n(prev), c = n(curr);
    if (p === 0) return null;
    return ((c - p) / Math.abs(p)) * 100;
  }
  // 年平均成長率 %。両端が正・periods>=1 のときのみ（符号反転/0基準/負ratio の非実数化を根絶）。
  function cagr(begin, end, periods) {
    var b = n(begin), e = n(end);
    if (!(b > 0) || !(e > 0) || !(periods >= 1)) return null;
    return (Math.pow(e / b, 1 / periods) - 1) * 100;
  }
```

`return { … }` に `yoy: yoy, cagr: cagr,` を追加。

- [ ] **Step 4: パス確認**

Run: `node --test tests/finance-rules.test.js`
Expected: PASS（全既存＋新規）

- [ ] **Step 5: commit**

```bash
git add finance-rules.js tests/finance-rules.test.js
git commit -m "feat(bundleC): finance-rules に yoy/cagr 純関数（yoyBadge 数値一致・cagr両端正）"
```

---

## Task 2: finance-rules.js — growthRates / ratioOrNull（純関数）

**Files:**
- Modify: `finance-rules.js`
- Test: `tests/finance-rules.test.js`

**Interfaces:**
- Consumes: `yoy`/`cagr`（Task 1）、既存 `n`/`hasValue`/`equityRatio` 等
- Produces: `FinanceRules.growthRates(trend, fields) → { <field>: {yoy, cagr, beginYear, endYear} }`（fields 既定 `["net_sales","net_income"]`）、`FinanceRules.ratioOrNull(fin, fn, needKeys, denomKeys) → Number|null`

- [ ] **Step 1: 失敗するテストを書く**

```js
const TREND3 = { "2023": { net_sales: 100, net_income: 10, year: 2023 },
                 "2024": { net_sales: 110, net_income: 8,  year: 2024 },
                 "2025": { net_sales: 121, net_income: 12, year: 2025 } };
test("growthRates: 3期 売上/純利益 独立", () => {
  const g = F.growthRates(TREND3);
  assert.equal(Math.round(g.net_sales.cagr), 10);   // 100→121 / 2期
  assert.equal(Math.round(g.net_sales.yoy), 10);    // 110→121
  assert.equal(g.net_income.beginYear, 2023);
  assert.equal(Math.round(g.net_income.yoy), 50);   // 8→12
});
test("growthRates: 欠測年は非連続 yoy=null・cagr は span", () => {
  const t = { "2023": { net_sales: 100, year: 2023 }, "2025": { net_sales: 121, year: 2025 } };
  const g = F.growthRates(t, ["net_sales"]);
  assert.equal(g.net_sales.yoy, null);              // 2024 欠落＝連続でない
  assert.equal(Math.round(g.net_sales.cagr), 10);   // 100→121 / periods=2
});
test("growthRates: 有効1対→両 null / 純利益赤字基準→cagr null", () => {
  assert.equal(F.growthRates({ "2025": { net_sales: 100, year: 2025 } }, ["net_sales"]).net_sales.cagr, null);
  const t = { "2023": { net_income: -5, year: 2023 }, "2025": { net_income: 10, year: 2025 } };
  assert.equal(F.growthRates(t, ["net_income"]).net_income.cagr, null);
});
test("ratioOrNull: 欠測キー/分母≤0 は null", () => {
  assert.equal(F.ratioOrNull({}, F.equityRatio, ["net_assets"], ["current_assets"]), null);
  assert.equal(F.ratioOrNull({ net_assets: 50, current_assets: 0, non_current_assets: 0 }, F.equityRatio,
    ["net_assets","current_assets","non_current_assets"], ["current_assets","non_current_assets"]), null);
  const ok = F.ratioOrNull({ net_assets: 45, current_assets: 30, non_current_assets: 60 }, F.equityRatio,
    ["net_assets","current_assets","non_current_assets"], ["current_assets","non_current_assets"]);
  assert.equal(Math.round(ok), 50); // 45/90
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/finance-rules.test.js` → FAIL（`growthRates is not a function`）

- [ ] **Step 3: 実装**（`finance-rules.js` の `return` 直前）

```js
  // 欠測ゲート：needKeys 全て hasValue かつ denomKeys 合計>0 の時のみ fn(fin)、そうでなければ null（CrossSection._finRatio 同型）。
  function ratioOrNull(fin, fn, needKeys, denomKeys) {
    if (!fin) return null;
    for (var i = 0; i < needKeys.length; i++) { if (!hasValue(fin, needKeys[i])) return null; }
    if (denomKeys) {
      var denom = 0;
      for (var j = 0; j < denomKeys.length; j++) denom += n(fin[denomKeys[j]]);
      if (!(denom > 0)) return null;
    }
    var v = fn(fin);
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }
  // 単社の財務時系列（list の financials_trend）から field ごとの {yoy, cagr, beginYear, endYear}。
  function growthRates(trend, fields) {
    fields = fields || ["net_sales", "net_income"];
    trend = trend || {};
    var out = {};
    fields.forEach(function (field) {
      var pairs = Object.keys(trend)
        .map(function (y) { return { year: Number(y), obj: trend[y] }; })
        .filter(function (p) { return isFinite(p.year) && p.obj && p.obj[field] != null && isFinite(Number(p.obj[field])); })
        .map(function (p) { return { year: p.year, value: Number(p.obj[field]) }; })
        .sort(function (a, b) { return a.year - b.year; });
      var res = { yoy: null, cagr: null, beginYear: null, endYear: null };
      if (pairs.length >= 1) {
        var begin = pairs[0], end = pairs[pairs.length - 1];
        res.beginYear = begin.year; res.endYear = end.year;
        var prior = null;
        for (var i = 0; i < pairs.length; i++) { if (pairs[i].year === end.year - 1) prior = pairs[i]; }
        if (prior) res.yoy = yoy(prior.value, end.value);
        var periods = end.year - begin.year;
        if (periods >= 1) res.cagr = cagr(begin.value, end.value, periods);
      }
      out[field] = res;
    });
    return out;
  }
```

`return { … }` に `growthRates: growthRates, ratioOrNull: ratioOrNull,` を追加。

- [ ] **Step 4: パス確認** → `node --test tests/finance-rules.test.js` PASS

- [ ] **Step 5: commit**

```bash
git add finance-rules.js tests/finance-rules.test.js
git commit -m "feat(bundleC): finance-rules に growthRates/ratioOrNull（欠測ゲート・暦年span）"
```

---

## Task 3: screener-rules.js — AXIS_REGISTRY / passesScreening（純述語）

**Files:**
- Create: `screener-rules.js`
- Test: `tests/screener-rules.test.js`

**Interfaces:**
- Produces: `ScreenerRules.AXIS_REGISTRY`（配列・各要素 `{key,label,termKey,unit,field,kind,group,dom:{min,max}}`）、`ScreenerRules.AXIS_BY_KEY`、`ScreenerRules.passesScreening(item, criteria) → boolean`

- [ ] **Step 1: 失敗するテストを書く**（`tests/screener-rules.test.js` 新規）

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../screener-rules.js");

const STOCK = { per: 12, pbr: 1.2, opMargin: 8, roe: 10, netMargin: 5, eqRatio: 45, curRatio: 150, salesCagr: 7, country: "JP", isEtf: false };
const ETF   = { per: 0, pbr: 0, opMargin: null, roe: null, netMargin: null, eqRatio: null, curRatio: null, salesCagr: null, country: "JP", isEtf: true };

test("positive(PER): min は 0以下/未満を除外、max-only は 0以下を保持（既存挙動）", () => {
  assert.equal(S.passesScreening(STOCK, { per: { min: 10, max: null } }), true);
  assert.equal(S.passesScreening({ ...STOCK, per: 0 }, { per: { min: 10, max: null } }), false);
  assert.equal(S.passesScreening({ ...STOCK, per: 0 }, { per: { min: null, max: 15 } }), true); // max-only は per<=0 を保持
});
test("nullable(ROE): 制約時 null は除外（max-only/負min でも）", () => {
  assert.equal(S.passesScreening(STOCK, { roe: { min: 8, max: null } }), true);
  assert.equal(S.passesScreening(ETF, { roe: { min: 8, max: null } }), false);
  assert.equal(S.passesScreening(ETF, { roe: { min: null, max: 3 } }), false); // 欠測 null は max-only でも除外（D1）
  assert.equal(S.passesScreening(ETF, { opMargin: { min: -50, max: null } }), false); // 負min でも欠測除外
});
test("制約なし軸は無視", () => {
  assert.equal(S.passesScreening(ETF, {}), true);
});
```

- [ ] **Step 2: 失敗を確認** → `node --test tests/screener-rules.test.js` FAIL（Cannot find module）

- [ ] **Step 3: 実装**（`screener-rules.js` 新規・UMD-lite）

```js
// screener-rules.js — スクリーナーの純述語＋軸レジストリ＋プリセット schema。DOM非依存・副作用なし。
// item の算出済フィールドのみ読む（FinanceRules 非依存）。no-score・facts非出力。
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScreenerRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var AXIS_REGISTRY = [
    { key: "per", label: "PER", termKey: "per", unit: "倍", field: "per", kind: "positive", group: "割安", dom: { min: "scr-per-min", max: "scr-per-max" } },
    { key: "pbr", label: "PBR", termKey: "pbr", unit: "倍", field: "pbr", kind: "positive", group: "割安", dom: { min: "scr-pbr-min", max: "scr-pbr-max" } },
    { key: "opMargin", label: "営業利益率", termKey: "op-margin", unit: "%", field: "opMargin", kind: "nullable", group: "収益", dom: { min: "scr-op-min", max: "scr-op-max" } },
    { key: "roe", label: "ROE", termKey: "roe", unit: "%", field: "roe", kind: "nullable", group: "収益", dom: { min: "scr-roe-min", max: "scr-roe-max" } },
    { key: "netMargin", label: "純利益率", termKey: "net-margin", unit: "%", field: "netMargin", kind: "nullable", group: "収益", dom: { min: "scr-nm-min", max: "scr-nm-max" } },
    { key: "eqRatio", label: "自己資本比率", termKey: "equity-ratio", unit: "%", field: "eqRatio", kind: "nullable", group: "安全", dom: { min: "scr-eq-min", max: "scr-eq-max" } },
    { key: "curRatio", label: "流動比率", termKey: "current-ratio", unit: "%", field: "curRatio", kind: "nullable", group: "安全", dom: { min: "scr-cur-min", max: "scr-cur-max" } },
    { key: "salesCagr", label: "売上成長率(3期CAGR)", termKey: "cagr", unit: "%", field: "salesCagr", kind: "nullable", group: "成長", dom: { min: "scr-cagr-min", max: "scr-cagr-max" } },
  ];
  var AXIS_BY_KEY = {};
  AXIS_REGISTRY.forEach(function (a) { AXIS_BY_KEY[a.key] = a; });

  function _fin(v) { return typeof v === "number" && isFinite(v); }

  function passesScreening(item, criteria) {
    item = item || {}; criteria = criteria || {};
    for (var i = 0; i < AXIS_REGISTRY.length; i++) {
      var ax = AXIS_REGISTRY[i], c = criteria[ax.key];
      if (!c) continue;
      var hasMin = _fin(c.min), hasMax = _fin(c.max);
      if (!hasMin && !hasMax) continue;
      var v = item[ax.field];
      if (ax.kind === "positive") {
        if (hasMin && (!(v > 0) || v < c.min)) return false;
        if (hasMax && v > 0 && v > c.max) return false;
      } else { // nullable：制約あり＋欠測(null/非有限)は除外
        if (!_fin(v)) return false;
        if (hasMin && v < c.min) return false;
        if (hasMax && v > c.max) return false;
      }
    }
    return true;
  }

  return { AXIS_REGISTRY: AXIS_REGISTRY, AXIS_BY_KEY: AXIS_BY_KEY, passesScreening: passesScreening };
});
```

- [ ] **Step 4: パス確認** → `node --test tests/screener-rules.test.js` PASS

- [ ] **Step 5: commit**

```bash
git add screener-rules.js tests/screener-rules.test.js
git commit -m "feat(bundleC): screener-rules AXIS_REGISTRY + passesScreening（positive/nullable）"
```

---

## Task 4: screener-rules.js — 市場 / criteria / hasAnyConstraint（純関数）

**Files:**
- Modify: `screener-rules.js`
- Test: `tests/screener-rules.test.js`

**Interfaces:**
- Produces: `ScreenerRules.normalizeMarkets(markets) → string[]`、`passesMarket(item, markets) → boolean`、`normalizeCriteria(raw) → criteria`、`hasAnyConstraint(criteria, markets) → boolean`

- [ ] **Step 1: 失敗するテストを書く**

```js
test("normalizeMarkets: [] と [JP,US] は無制約([])", () => {
  assert.deepEqual(S.normalizeMarkets([]), []);
  assert.deepEqual(S.normalizeMarkets(["JP", "US"]), []);
  assert.deepEqual(S.normalizeMarkets(["JP"]), ["JP"]);
});
test("passesMarket: 無制約=全通過 / 市場指定時 ETF は false / 国一致", () => {
  assert.equal(S.passesMarket({ country: "US", isEtf: false }, []), true);
  assert.equal(S.passesMarket({ country: "JP", isEtf: true }, ["JP"]), false); // 市場指定＝株式のみ
  assert.equal(S.passesMarket({ country: "JP", isEtf: false }, ["JP"]), true);
  assert.equal(S.passesMarket({ country: "US", isEtf: false }, ["JP"]), false);
});
test("hasAnyConstraint: 市場のみ絞込→true / 両チェック([])→軸無ければ false", () => {
  assert.equal(S.hasAnyConstraint({}, ["JP"]), true);
  assert.equal(S.hasAnyConstraint({}, ["JP", "US"]), false);
  assert.equal(S.hasAnyConstraint({ per: { min: 10, max: null } }, []), true);
});
test("normalizeCriteria: 有限数のみ・空軸は落とす", () => {
  const c = S.normalizeCriteria({ per: { min: "10", max: "" }, roe: { min: "", max: "" } });
  assert.deepEqual(c, { per: { min: 10, max: null } });
});
```

- [ ] **Step 2: 失敗を確認** → FAIL

- [ ] **Step 3: 実装**（`screener-rules.js` の passesScreening の後・return の前）

```js
  function _num(v) { var x = parseFloat(v); return isFinite(x) ? x : null; }

  function normalizeMarkets(markets) {
    var set = {};
    (markets || []).forEach(function (m) { if (m === "JP" || m === "US") set[m] = true; });
    var keys = Object.keys(set);
    return (keys.length === 0 || keys.length === 2) ? [] : keys;
  }
  function passesMarket(item, markets) {
    var m = normalizeMarkets(markets);
    if (m.length === 0) return true;
    if ((item && item.isEtf)) return false;      // 市場指定＝株式のみ（チップと統一）
    return m.indexOf(item && item.country) !== -1;
  }
  function normalizeCriteria(raw) {
    var out = {};
    AXIS_REGISTRY.forEach(function (ax) {
      var r = (raw && raw[ax.key]) || {};
      var min = _num(r.min), max = _num(r.max);
      if (min !== null || max !== null) out[ax.key] = { min: min, max: max };
    });
    return out;
  }
  function hasAnyConstraint(criteria, markets) {
    var anyAxis = Object.keys(criteria || {}).some(function (k) {
      var c = criteria[k]; return c && (_fin(c.min) || _fin(c.max));
    });
    return anyAxis || normalizeMarkets(markets).length > 0;
  }
```

`return { … }` に `normalizeMarkets, passesMarket, normalizeCriteria, hasAnyConstraint, _num,` を追加（`_num` はプリセットで再利用）。

- [ ] **Step 4: パス確認** → PASS

- [ ] **Step 5: commit**

```bash
git add screener-rules.js tests/screener-rules.test.js
git commit -m "feat(bundleC): screener-rules 市場正規化/passesMarket/normalizeCriteria/hasAnyConstraint"
```

---

## Task 5: screener-rules.js — プリセット schema（純関数＋localStorage）

**Files:**
- Modify: `screener-rules.js`
- Test: `tests/screener-rules.test.js`

**Interfaces:**
- Produces: `validatePreset(p) → boolean`、`migratePreset(p) → Preset|null`、`loadPresets() → Preset[]`、`savePresets(list) → boolean`
- Preset = `{ name:string(trim 1..40), criteria:{axisKey:{min,max}}, markets:string[], v:1 }`

- [ ] **Step 1: 失敗するテストを書く**

```js
test("validatePreset: 空白のみ名/40字超/不正軸/不正市場は false", () => {
  assert.equal(S.validatePreset({ name: "   ", criteria: {}, markets: [] }), false);
  assert.equal(S.validatePreset({ name: "a".repeat(41), criteria: {}, markets: [] }), false);
  assert.equal(S.validatePreset({ name: "x", criteria: { bogus: { min: 1, max: null } }, markets: [] }), false);
  assert.equal(S.validatePreset({ name: "x", criteria: {}, markets: ["XX"] }), false);
  assert.equal(S.validatePreset({ name: "割安JP", criteria: { per: { min: 10, max: null } }, markets: ["JP"] }), true);
});
test("migratePreset: 旧形/未知キーを寄せる・不正は null", () => {
  const mp = S.migratePreset({ name: "v0", criteria: { per: { min: 10 }, bogus: { min: 1 } }, markets: ["JP", "US"] });
  assert.equal(mp.v, 1);
  assert.deepEqual(mp.markets, []);          // 両市場→正規化[]
  assert.ok(mp.criteria.per && !mp.criteria.bogus);
  assert.equal(S.migratePreset(null), null);
});
test("loadPresets/savePresets: round-trip・破損→[]", () => {
  const mem = {}; global.localStorage = { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
  assert.equal(S.savePresets([{ name: "x", criteria: { roe: { min: 8, max: null } }, markets: [], v: 1 }]), true);
  assert.equal(S.loadPresets().length, 1);
  mem["sip_screener_presets"] = "{bad json";
  assert.deepEqual(S.loadPresets(), []);
  delete global.localStorage;
});
```

- [ ] **Step 2: 失敗を確認** → FAIL

- [ ] **Step 3: 実装**（return の前）

```js
  var PRESET_KEY = "sip_screener_presets";
  function validatePreset(p) {
    if (!p || typeof p !== "object") return false;
    var name = typeof p.name === "string" ? p.name.trim() : "";
    if (name.length < 1 || name.length > 40) return false;
    if (!p.criteria || typeof p.criteria !== "object") return false;
    var keys = Object.keys(p.criteria);
    for (var i = 0; i < keys.length; i++) {
      if (!AXIS_BY_KEY[keys[i]]) return false;
      var c = p.criteria[keys[i]] || {};
      if (c.min != null && !isFinite(Number(c.min))) return false;
      if (c.max != null && !isFinite(Number(c.max))) return false;
    }
    if (!Array.isArray(p.markets)) return false;
    for (var j = 0; j < p.markets.length; j++) { if (p.markets[j] !== "JP" && p.markets[j] !== "US") return false; }
    return true;
  }
  function migratePreset(p) {
    if (!p || typeof p !== "object") return null;
    var mp = { name: String(p.name || "").trim(), criteria: {}, markets: normalizeMarkets(p.markets), v: 1 };
    if (p.criteria && typeof p.criteria === "object") {
      Object.keys(p.criteria).forEach(function (k) {
        if (AXIS_BY_KEY[k]) { var c = p.criteria[k] || {}; mp.criteria[k] = { min: _num(c.min), max: _num(c.max) }; }
      });
    }
    return validatePreset(mp) ? mp : null;
  }
  function loadPresets() {
    try {
      var raw = (typeof localStorage !== "undefined" && localStorage.getItem(PRESET_KEY)) || "[]";
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.map(migratePreset).filter(Boolean);
    } catch (e) { return []; }
  }
  function savePresets(list) {
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(PRESET_KEY, JSON.stringify((list || []).filter(validatePreset)));
      return true;
    } catch (e) { return false; }
  }
```

`return { … }` に `validatePreset, migratePreset, loadPresets, savePresets,` を追加。

- [ ] **Step 4: パス確認** → PASS（全 screener-rules テスト緑）

- [ ] **Step 5: commit**

```bash
git add screener-rules.js tests/screener-rules.test.js
git commit -m "feat(bundleC): screener-rules プリセット schema（validate/migrate/load/save）"
```

---

## Task 6: detail-rules.js — INDICATOR_GLOSSARY に cagr / growth-rate

**Files:**
- Modify: `detail-rules.js`（`INDICATOR_GLOSSARY` 配列・:49付近）
- Test: `tests/detail-rules.test.js`（末尾に追加）

**Interfaces:**
- Produces: `DetailRules.INDICATOR_GLOSSARY` に `term:"cagr"` と `term:"growth-rate"`（各 `{term, read, def}` 完備）

- [ ] **Step 1: 失敗するテストを書く**（`tests/detail-rules.test.js`）

```js
test("INDICATOR_GLOSSARY: cagr/growth-rate は read 付きで存在（売買/予測語なし）", () => {
  const g = require("../detail-rules.js").INDICATOR_GLOSSARY;
  const by = {}; g.forEach((e) => (by[e.term] = e));
  assert.ok(by["cagr"] && by["cagr"].read && by["cagr"].def);
  assert.ok(by["growth-rate"] && by["growth-rate"].read && by["growth-rate"].def);
  assert.doesNotMatch(by["cagr"].def + by["growth-rate"].def, /買い|売り|推奨|割安|割高/);
});
```

- [ ] **Step 2: 失敗を確認** → `node --test tests/detail-rules.test.js` FAIL

- [ ] **Step 3: 実装**（`INDICATOR_GLOSSARY` 配列に2要素追加）

```js
    { term: "cagr", read: "CAGR（年平均成長率）", def: "複数年の増減を1年あたりの平均ペースに均した成長率。" },
    { term: "growth-rate", read: "成長率", def: "売上や利益が前年（または数年平均）に対しどれだけ増減したか。将来の株価を保証するものではない。" },
```

- [ ] **Step 4: パス確認** → PASS

- [ ] **Step 5: commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(bundleC): INDICATOR_GLOSSARY に cagr/growth-rate（read 付き・中立）"
```

---

## Task 7: index.html — screener-rules.js ロード ＋ item フィールド拡張

**Files:**
- Modify: `index.html`（`<script>` 追加：1473行の後／item 構築：1806-1826／opMargin・roe・eqRatio・curRatio 算出：1779-1780,1807-1808）
- Verify: `scratchpad/bundleC-task7-verify.js`（Playwright headless）

**Interfaces:**
- Consumes: `FinanceRules.ratioOrNull`/`growthRates`（Task 1-2）、`ScreenerRules`（Task 3-5）
- Produces: item に `isEtf`、null安全な `eqRatio`/`curRatio`/`opMargin`/`roe`/`netMargin`、`salesYoY`/`salesCagr`/`niYoY`/`niCagr`

- [ ] **Step 1: `<script>` ロード追加**（1473 `cross-section-rules.js` の直後）

```html
    <script src="screener-rules.js"></script>
```

- [ ] **Step 2: item 算出を null安全化＋成長付与**（`filterAndRenderPortal` 内。既存 `const eqRatio = FinanceRules.equityRatio(fin);` 等を置換）

```js
          const eqRatio = FinanceRules.ratioOrNull(fin, FinanceRules.equityRatio, ["net_assets","current_assets","non_current_assets"], ["current_assets","non_current_assets"]);
          const curRatio = FinanceRules.ratioOrNull(fin, FinanceRules.currentRatio, ["current_assets","current_liabilities"], ["current_liabilities"]);
          // …（既存 assetType / フィルタ）…
          const opMargin = FinanceRules.ratioOrNull(fin, FinanceRules.opMargin, ["operating_income","net_sales"], ["net_sales"]);
          const roe = FinanceRules.ratioOrNull(fin, FinanceRules.roe, ["net_income","net_assets"], ["net_assets"]);
          const netMargin = FinanceRules.ratioOrNull(fin, FinanceRules.netMargin, ["net_income","net_sales"], ["net_sales"]);
          const growth = FinanceRules.growthRates(company.financials_trend, ["net_sales","net_income"]);
```

item リテラル（1809-1825）に追加：

```js
            isEtf: assetType === "etf",
            netMargin: netMargin,
            salesYoY: growth.net_sales.yoy, salesCagr: growth.net_sales.cagr,
            niYoY: growth.net_income.yoy, niCagr: growth.net_income.cagr,
```

> 表示は既に null 安全（`opText`/`roeText` は `item.opMargin !== null ? … : "--"`）＝ETF は自動で「--」。`safetyScore` は `item.hasFinData` ガード内で null→0 に coerce（既存挙動不変）。

- [ ] **Step 3: 検証スクリプト作成 → 実行**（`scratchpad/bundleC-task7-verify.js`）

ローカル `python -m http.server` ＋ Playwright で本番相当のモック（`/api/market/list` を STOCK+ETF で返す）を注入し、`window` に露出した item 生成経路を叩く代わりに、DOM 描画後に「ETF 行の営業利益率/ROE セルが `--`」「株式行に salesCagr が数値」を確認。`pageerror` 0。

Run: `node scratchpad/bundleC-task7-verify.js`
Expected: PASS（ETF op/ROE=「--」・株式 salesCagr 数値・pageerror0）

- [ ] **Step 4: 既存テスト回帰** → `node --test tests/` 全緑（純モジュール無影響）

- [ ] **Step 5: commit**

```bash
git add index.html scratchpad/bundleC-task7-verify.js
git commit -m "feat(bundleC): item に isEtf/null安全ratio/成長率（screener-rules ロード）"
```

---

## Task 8: index.html — ① 成長バッジ＋トレンド列ソート＋null-last 比較器

**Files:**
- Modify: `index.html`（トレンド列ヘッダ:1886／トレンドセル:1959-1961／sort 比較器:1838-1848）
- Verify: `scratchpad/bundleC-task8-verify.js`

**Interfaces:**
- Consumes: item.salesCagr/salesYoY/niCagr/niYoY（Task 7）

- [ ] **Step 1: トレンド列ヘッダをソート可能化**（1886 `<th style="width: 9%; cursor: default;">3期トレンド</th>` を置換）

```js
                        <th style="width: 9%;" class="${sortKey === "salesCagr" ? "active-sort" : ""}" onclick="setSort('salesCagr')" data-term="growth-rate">売上3期<span class="sort-icon">${sortKey === "salesCagr" ? (sortAsc ? "▲" : "▼") : "↕"}</span></th>
```

- [ ] **Step 2: バッジをセルに追加**（1959-1961 のトレンドセル `<td><div class="sparkline-wrapper">…</div></td>` を置換）

```js
                    <td>
                        <div class="sparkline-wrapper">${buildSparklineSVG(item.trendSales)}</div>
                        ${growthBadge(item)}
                    </td>
```

`growthBadge` を inline script に追加（`buildSparklineSVG` の近く）：

```js
      // 成長バッジ：売上3期CAGR。色は --ix-text-secondary 単色＋不透明度差のみ（緑/赤/金 禁止）。
      //  tooltip に 売上YoY/純利益CAGR/純利益YoY（数値のみ＝esc不要・欠測は「—」）。
      function growthBadge(item) {
        const fmt = (v) => (v === null || v === undefined) ? "—" : (v >= 0 ? "+" : "") + v.toFixed(1) + "%";
        const c = item.salesCagr;
        if (c === null || c === undefined) return '<span class="growth-badge muted">CAGR —</span>';
        const arrow = c >= 0 ? "↑" : "↓";
        const op = c >= 0 ? "1" : "0.62"; // 方向は不透明度差のみ（hue 不変）
        const tip = `売上YoY ${fmt(item.salesYoY)} ／ 純利益CAGR ${fmt(item.niCagr)} ／ 純利益YoY ${fmt(item.niYoY)}`;
        return `<span class="growth-badge" style="opacity:${op}" title="${tip}">CAGR ${arrow}${Math.abs(c).toFixed(1)}%</span>`;
      }
```

CSS（`<style>` に追加）：

```css
      .growth-badge { display:inline-block; margin-top:3px; font-size:0.66rem; color: var(--ix-text-secondary); letter-spacing:0.02em; }
      .growth-badge.muted { opacity:0.45; }
```

- [ ] **Step 3: null-last 比較器**（sort 1838-1848 を置換）

```js
        const NULL_LAST_KEYS = { eqRatio:1, opMargin:1, roe:1, curRatio:1, netMargin:1, salesCagr:1, niCagr:1 };
        list.sort((a, b) => {
          let valA = a[sortKey], valB = b[sortKey];
          if (NULL_LAST_KEYS[sortKey]) {
            const na = (valA === null || valA === undefined || Number.isNaN(valA));
            const nb = (valB === null || valB === undefined || Number.isNaN(valB));
            if (na && nb) return 0;
            if (na) return 1;   // null は方向に依らず常に末尾
            if (nb) return -1;
          }
          if (typeof valA === "string") return sortAsc ? valA.localeCompare(valB) : valB.localeCompare(valA);
          return sortAsc ? valA - valB : valB - valA;
        });
```

- [ ] **Step 4: 検証**（`scratchpad/bundleC-task8-verify.js`）：バッジ表示・`salesCagr` ソートで null(ETF) が末尾・tooltip・バッジ色に緑/赤 hex 無し・pageerror0。

Run: `node scratchpad/bundleC-task8-verify.js` → PASS

- [ ] **Step 5: commit**

```bash
git add index.html scratchpad/bundleC-task8-verify.js
git commit -m "feat(bundleC): ①成長バッジ(--ix-text-secondary)+トレンド列ソート+null-last比較器"
```

---

## Task 9: index.html — ② スクリーナーパネル拡張（8軸＋市場＋プリセット行＋termHelp）

**Files:**
- Modify: `index.html`（screening-panel HTML:1010-1051／CSS:598-662）
- Verify: `scratchpad/bundleC-task9-verify.js`

- [ ] **Step 1: パネル HTML を再構成**（`.screening-grid`〜`.screening-actions` を置換）。グループ見出し（割安/収益/安全/成長）＋8軸 range 入力（既存4＝scr-per/pbr/eq/op を温存、新4＝scr-roe/nm/cur/cagr）。各ラベルに `data-term`。上部に市場チェック、上部にプリセット行、末尾に中立注記。

```html
          <!-- 市場 -->
          <div class="screening-markets">
            <span class="screening-label">市場</span>
            <label><input type="checkbox" id="scr-mkt-jp" checked onchange="applyScreening()"> 日本株</label>
            <label><input type="checkbox" id="scr-mkt-us" checked onchange="applyScreening()"> 米国株</label>
          </div>
          <!-- プリセット -->
          <div class="screening-presets">
            <select id="scr-preset-select" onchange="onScreenerPresetChange()"></select>
            <button class="screening-preset-btn" onclick="saveScreenerPreset()">＋ 現在の条件を保存</button>
            <button class="screening-preset-btn del" onclick="deleteScreenerPreset()">🗑 削除</button>
          </div>
          <div class="screening-grid">
            <div class="screening-group">割安</div>
            <!-- PER（既存 id 温存） -->
            <div class="screening-item"><span class="screening-label" data-term="per">PER</span>
              <div class="screening-range"><input class="screening-input" id="scr-per-min" type="number" placeholder="最小" step="0.5" oninput="applyScreening()"><span class="screening-sep">〜</span><input class="screening-input" id="scr-per-max" type="number" placeholder="最大" step="0.5" oninput="applyScreening()"><span class="screening-sep" style="font-size:0.7rem;">倍</span></div>
            </div>
            <!-- PBR（既存）… ROE(scr-roe) 純利益率(scr-nm) 自己資本比率(scr-eq 既存) 流動比率(scr-cur) 営業利益率(scr-op 既存) 売上CAGR(scr-cagr) を同型で。各 group 見出しで区切る -->
          </div>
          <div class="screening-actions">
            <button class="screening-reset-btn" onclick="resetScreening()">✕ リセット</button>
            <span class="screening-result-count" id="screening-count"></span>
          </div>
          <div class="screening-note">スクリーニングは条件による抽出であり、売買を推奨するものではありません。</div>
```

> 実装メモ：8軸の入力 id は AXIS_REGISTRY.dom と1対1（scr-per/pbr/op/eq は温存、scr-roe/nm/cur/cagr は新）。group 見出しは `.screening-group`（grid full 幅）。

- [ ] **Step 2: CSS 追加**（`.screening-group`/`.screening-markets`/`.screening-presets`/`.screening-note`・既存トークン `var(--ix-*)` 使用・面禁則遵守）

- [ ] **Step 3: 検証**（`scratchpad/bundleC-task9-verify.js`）：パネル展開で8軸＋市場2チェック＋プリセット行＋注記が可視・モバイル幅で1列・`?`（.term-help）が各軸に注入されている（Task 10 で inject 配線後に有効化）・pageerror0。

- [ ] **Step 4: 既存テスト回帰** → `node --test tests/` 全緑

- [ ] **Step 5: commit**

```bash
git add index.html scratchpad/bundleC-task9-verify.js
git commit -m "feat(bundleC): ②スクリーナーパネル 8軸+市場+プリセット行+中立注記+data-term"
```

---

## Task 10: index.html — ② 配線（applyScreening/reset/passesScreening/badge/termHelp/空状態）

**Files:**
- Modify: `index.html`（screening state:1567／applyScreening:1577-1581／resetScreening:1583-1587／passesScreening 呼出:1827／結果数:1834／空状態:1856／描画完了後の inject）
- Verify: `scratchpad/bundleC-task10-verify.js`

**Interfaces:**
- Consumes: `ScreenerRules.*`（Task 3-5）、`window.Detail.injectTermHelp`（detail.js:578・fetch 後に解決）

- [ ] **Step 1: state を criteria ベースへ**（1567 `let screening = {…}` を置換）

```js
      let screeningCriteria = {};
      let screeningMarkets = [];   // 正規化後（[] = 無制約）
```

- [ ] **Step 2: applyScreening / resetScreening を registry 由来へ**（1577-1587 置換）

```js
      function _readScreenerRaw() {
        const g = (id) => document.getElementById(id) ? document.getElementById(id).value : "";
        const raw = {};
        ScreenerRules.AXIS_REGISTRY.forEach((ax) => { raw[ax.key] = { min: g(ax.dom.min), max: g(ax.dom.max) }; });
        return raw;
      }
      function _readMarkets() {
        const jp = document.getElementById("scr-mkt-jp"), us = document.getElementById("scr-mkt-us");
        const arr = [];
        if (jp && jp.checked) arr.push("JP");
        if (us && us.checked) arr.push("US");
        return ScreenerRules.normalizeMarkets(arr);
      }
      function applyScreening() {
        screeningCriteria = ScreenerRules.normalizeCriteria(_readScreenerRaw());
        screeningMarkets = _readMarkets();
        filterAndRenderPortal();
      }
      function resetScreening() {
        ScreenerRules.AXIS_REGISTRY.forEach((ax) => {
          [ax.dom.min, ax.dom.max].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; });
        });
        const jp = document.getElementById("scr-mkt-jp"), us = document.getElementById("scr-mkt-us");
        if (jp) jp.checked = true; if (us) us.checked = true;
        screeningCriteria = {}; screeningMarkets = [];
        filterAndRenderPortal();
      }
```

- [ ] **Step 3: passesScreening 呼出＋結果数バッジ**（1827 `if (!passesScreening(item)) continue;` を置換、1834 の hasFilter を置換）。旧 inline `passesScreening`（1589-1600）は削除。

```js
          if (!ScreenerRules.passesScreening(item, screeningCriteria)) continue;
          if (!ScreenerRules.passesMarket(item, screeningMarkets)) continue;
```

```js
          const hasFilter = ScreenerRules.hasAnyConstraint(screeningCriteria, screeningMarkets);
```

- [ ] **Step 4: termHelp inject ＋ 空状態ヒント**。`filterAndRenderPortal` の描画完了直後（groups 描画後）に：

```js
        if (window.Detail && typeof window.Detail.injectTermHelp === "function") {
          const panel = document.getElementById("screening-panel");
          if (panel) window.Detail.injectTermHelp(panel);
          const thead = document.querySelector(".portal-table thead");
          if (thead) window.Detail.injectTermHelp(thead);
        }
```

空状態（1856 `該当する企業が見つかりません`）を、市場チェック or セクターチップが効いている時は理由ヒント併記に：

```js
          const marketOn = screeningMarkets.length > 0;
          const sectorOn = (activeSectorFilter !== "all" && activeSectorFilter !== "stock_only");
          const hint = (marketOn && sectorOn) ? "<br><span style='font-size:0.8rem;color:#5a6c78'>セクター条件と市場条件が重複している可能性があります</span>" : "";
          container.innerHTML = `<div style="text-align:center; color:#6b7d8a; padding:40px;">該当する企業が見つかりません${hint}</div>`;
```

- [ ] **Step 5: 検証 → commit**（`scratchpad/bundleC-task10-verify.js`）：8軸フィルタ・max-only で ETF 除外・市場AND（JP チェック×US チップで空＋ヒント）・市場のみ絞込でバッジ表示／両チェックで非表示・`?` ツールチップ表示・pageerror0。

Run: `node scratchpad/bundleC-task10-verify.js` → PASS

```bash
git add index.html scratchpad/bundleC-task10-verify.js
git commit -m "feat(bundleC): ②配線 ScreenerRules(criteria/markets/hasAnyConstraint)+termHelp+空状態ヒント"
```

---

## Task 11: index.html — ② プリセット CRUD（clear-first・esc・confirm）＋ window 公開

**Files:**
- Modify: `index.html`（inline script にプリセット関数群＋起動時 refresh／Object.assign:2262-2266）
- Verify: `scratchpad/bundleC-task11-verify.js`

**Interfaces:**
- Consumes: `ScreenerRules.loadPresets/savePresets/validatePreset`、`window.esc`

- [ ] **Step 1: プリセット関数群を追加**（applyScreening の近く）

```js
      function refreshPresetSelect(selectedName) {
        const sel = document.getElementById("scr-preset-select");
        if (!sel) return;
        const presets = ScreenerRules.loadPresets();
        sel.innerHTML = "";
        const ph = document.createElement("option");
        ph.value = ""; ph.textContent = presets.length ? "― プリセットを選択 ―" : "― 保存済みなし ―";
        ph.disabled = false; sel.appendChild(ph);
        presets.forEach((p, i) => { const o = document.createElement("option"); o.value = String(i); o.textContent = p.name; sel.appendChild(o); }); // textContent＝esc不要
        if (selectedName) { const idx = presets.findIndex((p) => p.name === selectedName); if (idx >= 0) sel.value = String(idx); }
      }
      function saveScreenerPreset() {
        const input = prompt("プリセット名（1〜40字）");
        if (input === null) return;                 // キャンセル no-op
        const name = input.trim();
        if (name.length < 1 || name.length > 40) { alert("プリセット名は1〜40字で入力してください"); return; }
        const preset = { name: name, criteria: ScreenerRules.normalizeCriteria(_readScreenerRaw()), markets: _readMarkets(), v: 1 };
        if (!ScreenerRules.validatePreset(preset)) { alert("保存できませんでした"); return; }
        const list = ScreenerRules.loadPresets().filter((p) => p.name !== name); // 同名上書き（confirm不要）
        list.push(preset);
        ScreenerRules.savePresets(list);
        refreshPresetSelect(name);
      }
      function onScreenerPresetChange() {
        const sel = document.getElementById("scr-preset-select");
        if (!sel || sel.value === "") return;       // プレースホルダは load しない
        const p = ScreenerRules.loadPresets()[Number(sel.value)];
        if (p) loadScreenerPreset(p);
      }
      function loadScreenerPreset(preset) {
        // (1) 全軸16入力＋市場チェック＋セクターを既定へリセット（clear-first）
        ScreenerRules.AXIS_REGISTRY.forEach((ax) => { [ax.dom.min, ax.dom.max].forEach((id) => { const el = document.getElementById(id); if (el) el.value = ""; }); });
        const jp = document.getElementById("scr-mkt-jp"), us = document.getElementById("scr-mkt-us");
        // (3) markets 復元（[]→両チェック、[JP]→JPのみ）
        const m = ScreenerRules.normalizeMarkets(preset.markets);
        if (jp) jp.checked = (m.length === 0 || m.indexOf("JP") !== -1);
        if (us) us.checked = (m.length === 0 || m.indexOf("US") !== -1);
        // (2) criteria の軸だけ setValue
        Object.keys(preset.criteria).forEach((k) => {
          const ax = ScreenerRules.AXIS_BY_KEY[k]; if (!ax) return;
          const c = preset.criteria[k];
          const emin = document.getElementById(ax.dom.min), emax = document.getElementById(ax.dom.max);
          if (emin) emin.value = (c.min == null ? "" : c.min);
          if (emax) emax.value = (c.max == null ? "" : c.max);
        });
        activeSectorFilter = "all";                 // D2＝再現性（セクターチップをリセット）
        if (typeof syncSectorChips === "function") syncSectorChips(); // チップの見た目同期（無ければ initSectorFilter 再描画）
        applyScreening();
      }
      function deleteScreenerPreset() {
        const sel = document.getElementById("scr-preset-select");
        if (!sel || sel.value === "") return;
        const list = ScreenerRules.loadPresets();
        const p = list[Number(sel.value)];
        if (!p) return;
        if (!confirm(`プリセット「${p.name}」を削除しますか？`)) return; // 削除は confirm
        ScreenerRules.savePresets(list.filter((x) => x.name !== p.name));
        refreshPresetSelect();
      }
```

> `activeSectorFilter` のチップ見た目同期は既存関数を確認して結線（`initSectorFilter` の active クラス付替 or 既存 helper）。無ければ `initSectorFilter()` 再呼出で "all" を active に。

- [ ] **Step 2: 起動時に select を初期化**。ポータル初期化（データ ready 後）で `refreshPresetSelect()` を1回呼ぶ。

- [ ] **Step 3: window 公開**（2262 `Object.assign(window, {` に追加）

```js
        saveScreenerPreset, onScreenerPresetChange, deleteScreenerPreset, loadScreenerPreset,
```

- [ ] **Step 4: 検証**（`scratchpad/bundleC-task11-verify.js`）：保存→select 出現→別条件入力→呼出で **clear-first 復元（旧値残留なし・activeSectorFilter=all）**→削除（confirm）。空白名/40字超/キャンセル/0件 placeholder。プリセット名に `<img src=x onerror>` を入れて option 破損/実行なし（textContent）。localStorage 反映。pageerror0。

Run: `node scratchpad/bundleC-task11-verify.js` → PASS

- [ ] **Step 5: commit**

```bash
git add index.html scratchpad/bundleC-task11-verify.js
git commit -m "feat(bundleC): ②プリセットCRUD（clear-first復元/esc textContent/削除confirm）+window公開"
```

---

## Task 12: 統合検証（Playwright ＋ 規制 grep ＋ 回帰）

**Files:**
- Create: `scratchpad/bundleC-integration-smoke.js`
- Verify: 全 `node --test tests/` ＋ Playwright ＋ grep

- [ ] **Step 1: 統合スモークを書く**（`scratchpad/bundleC-integration-smoke.js`）。実データ相当モック（JP株/US株/ETF 混在）で：
  - ① 売上CAGRバッジ表示・トレンド列ソート（null 末尾）・tooltip・ratio列 ETF「--」・バッジ色に緑/赤 hex 無し。
  - ② 8軸フィルタ各々・max-only/負min で ETF/欠損除外・市場AND（空＋ヒント）・市場のみ絞込でバッジ表示／両チェックで非表示。
  - ② プリセット保存/呼出(clear-first)/削除・esc・0件 placeholder。
  - 回帰：既存4軸（PER/PBR min/max）挙動・money/detail ビュー遷移・`pageerror0`。

- [ ] **Step 2: 全ユニットテスト** → `node --test tests/` 全緑（finance-rules/screener-rules/detail-rules/cross-section/money-rules）＋ `pytest`（facts非流出）緑。

- [ ] **Step 3: 規制 grep（範囲/語彙/色）**。新規追加のみを対象に：
  ```bash
  # 肯定用法の売買/推奨/割安/割高/予測 が新規バッジ・注記・新グロッサリに無い（免責の否定形は除外）
  grep -nE '(買い|売り|買い時|売り時|割安|割高|予測)' screener-rules.js | grep -vE 'ではありません|しない|排除'
  # 成長バッジのインライン色に緑/赤/金 hex が無い
  grep -nE 'growthBadge' -A3 index.html | grep -E '#00e676|#ff5c7a|#ff1744|#ffd60a|#ffd84d' && echo "NG: 緑赤金 hex" || echo "OK"
  ```
  Expected: 検出0（バッジ色は `var(--ix-text-secondary)`）。

- [ ] **Step 4: Playwright 実行** → `node scratchpad/bundleC-integration-smoke.js` PASS（pageerror0）。

- [ ] **Step 5: commit**

```bash
git add scratchpad/bundleC-integration-smoke.js
git commit -m "test(bundleC): 統合スモーク（①バッジ/ソート ②8軸/市場/プリセット 回帰・規制grep）"
```

---

## 完了後（このプランの外）

- 本人実機サニティ（特に canvas 非再現の視覚＝バッジ色/密度・スクリーナー操作感・プリセット往復）。
- 最終 whole-branch 敵対レビューwf（任意・各機能は敵対検証済）。
- `ExitWorktree`（keep）→ main へ `merge`／`push`（本番 curl で反映確認）。
- Obsidian Projects/investment-portal.md ＋ MEMORY.md 更新（束C 完了・次=③規律テクニカル or 束D）。

## Self-Review（プラン↔spec 突合）

- **spec §4.1-4.3（①成長）** → Task 1,2（純関数）,7（item）,8（バッジ/ソート/null-last）。✅
- **spec §5.1-5.5（②スクリーナー）** → Task 3,4,5（純関数）,9（UI）,10（配線）,11（プリセット）。✅
- **spec §6（教育）** → Task 6（glossary）,9（data-term）,10（inject）。✅
- **spec §7（検証）** → 各 Task の verify＋Task 12。✅
- **spec §8（不可侵）＋§11（D1/D2/D3）** → Global Constraints＋Task 3(positive 非対称)/7(ratioOrNull)/8(色)/10(市場)/11(clear-first)。✅
- **型整合**：`ratioOrNull`/`growthRates`/`AXIS_REGISTRY.dom`/`normalizeMarkets`/`hasAnyConstraint`/`loadPresets` の名前・引数は Task 間で一致。✅
- **プレースホルダ**：Task 9 の HTML は代表軸のみ全記述＋「同型で残り」を明示（8軸は AXIS_REGISTRY.dom と1対1で機械的）。実装者は Task 3 の registry を参照。
