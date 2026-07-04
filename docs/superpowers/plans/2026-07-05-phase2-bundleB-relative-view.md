# Phase2 束B「相対で見る目」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 銘柄を「分布の中の現在地」で見る3面（相対位置カード／財務横並び比較テーブル／横断ランキング&散布図&セクター帯）を、共有の純関数コア `cross-section-rules.js` 1塊で駆動する。

**Architecture:** 新UMDモジュール `cross-section-rules.js`（`window.CrossSection`）を `finance-rules.js` 直後にロードし、既存 `FinanceRules` の単社getterを横断集計の部品として消費。純計算はコアに集約し、detail.js（①②描画）と index.html inline（③描画）は薄い DOM 層。母集団は**市場ベース**（日本株/米国株の各内）。

**Tech Stack:** Vanilla JS（UMD-lite）・node:test・Lightweight Charts v4.2.3（既存）・Chart.js 4.5.1（版固定・scatter）。

## Global Constraints

- **母集団=市場ベース**：percentile/median/ランキングは常に自市場内（country='JP'|'US'）で算出。JP/US を跨がない。
- **no-score**：総合売買スコア/推奨を作らない。中立の位置記述語のみ（上位/やや上位/中央値付近/やや下位/下位/データなし）。売買（買い/売り/割安=買い）・予測（上がる/下がる）語は出さない。
- **facts非出力**：money/advice の `mode_a_facts` に一切触れない。cross-section-rules は money-rules.js/advice.py を import しない。
- **免責**：`DetailRules.ANALYSIS_DISCLAIMER` を各描画層（detail.js/inline）が3面に同梱。descriptor 自身は免責文を埋め込まない（render層が付与）。
- **null→0の罠**：per/pbr/marketCap は list.py で null→0 圧潰 → **0 を欠測扱い**（`>0` のみ有効）。financials_trend はキー欠落=欠測（`FinanceRules.hasValue` ゲート）。
- **ETF除外**：`type==='etf'`（financials_trend={}）は universe/ランキング/散布/①カードから除外。②比較テーブルは行を出すが比率 N/A。
- **0x0罠**：③散布図の Chart.js canvas は `display:none→create` の寸法0固定を回避（view を active 化した後に rAF→生成/resize・破棄先行）。
- **money非改変**：median/mean は money-rules に private だが cross-section-rules に独立再実装。
- **新CDN依存なし**。**F2 IIFE公開規律**：inline新規参照関数は index.html 末尾 `Object.assign(window,…)`／detail.js 新規公開は detail.js の window ブロックへ。
- **読込順**：dataClient → finance-rules → **cross-section-rules** → detail-rules → (inline) → detail-charts → detail → money。
- **stocks はティッカーkeyのオブジェクト**（配列でない）→ `Object.entries`。
- **検証**：純関数は node:test。`scratchpad/f2-snapshot.js compare`（`NODE_PATH=/home/shugo/node_modules`・mock server 前提）で portal/detail/money+ranking 突合。Playwright は mock_prod_server。

---

## File Structure

- **Create** `cross-section-rules.js` — 横断純関数コア（`window.CrossSection`）。統計/レジストリ/universe/descriptor。
- **Create** `tests/cross-section-rules.test.js` — node:test 単体。
- **Modify** `detail-rules.js` — `INDICATOR_GLOSSARY` に横断用語4語を追記（他は無改変）。
- **Modify** `detail.js` — `renderRelativePosition` / `renderCompareTable` / compareタブ切替 / finCards登録 / 呼び出し配線 / window公開。
- **Modify** `index.html` — script追加 / `#relative-position-card` / compare-modalタブ+`#compare-table-container` / `#ranking-view`+VIEW_IDS+`navigateToRanking`+ranking UI+入口ボタン+Object.assign公開。
- **Modify** `detail.css` — nth-child拡張 / 分布バー / compareテーブル・タブ / ranking-view スタイル。

---

## Task 1: コア雛形 + 統計プリミティブ

**Files:**
- Create: `cross-section-rules.js`
- Test: `tests/cross-section-rules.test.js`

**Interfaces:**
- Produces: `CrossSection.median(vals)`, `.mean(vals)`, `.percentileRank(vals, x)`, `.quantile(vals, q)` — いずれも `number|null`（空配列→null）。

- [ ] **Step 1: Write the failing test**

`tests/cross-section-rules.test.js`:
```js
const { test } = require("node:test");
const assert = require("node:assert");
const CS = require("../cross-section-rules.js");

test("median: odd/even/empty/single", () => {
  assert.strictEqual(CS.median([3, 1, 2]), 2);
  assert.strictEqual(CS.median([1, 2, 3, 4]), 2.5);
  assert.strictEqual(CS.median([]), null);
  assert.strictEqual(CS.median([7]), 7);
});
test("mean: basic/empty", () => {
  assert.strictEqual(CS.mean([2, 4]), 3);
  assert.strictEqual(CS.mean([]), null);
});
test("percentileRank: midrank / single=50 / ties / empty", () => {
  assert.strictEqual(CS.percentileRank([10, 20, 30, 40], 30), 62.5); // (2 + 0.5)/4*100
  assert.strictEqual(CS.percentileRank([5], 5), 50);
  assert.strictEqual(CS.percentileRank([10, 10, 10], 10), 50);       // all-ties → 50
  assert.strictEqual(CS.percentileRank([], 5), null);
  assert.strictEqual(CS.percentileRank([1, 2, 3], NaN), null);
});
test("quantile: Q1/Q3 linear interp / single / empty", () => {
  assert.strictEqual(CS.quantile([1, 2, 3, 4, 5], 0.25), 2);
  assert.strictEqual(CS.quantile([1, 2, 3, 4, 5], 0.75), 4);
  assert.strictEqual(CS.quantile([9], 0.5), 9);
  assert.strictEqual(CS.quantile([], 0.5), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/shugo/apps/investment-portal && node --test tests/cross-section-rules.test.js`
Expected: FAIL（`Cannot find module '../cross-section-rules.js'`）

- [ ] **Step 3: Write minimal implementation**

`cross-section-rules.js`:
```js
// cross-section-rules.js — 銘柄横断(クロスセクション)の純関数。分布の中の現在地を返す。
// ブラウザ(window.CrossSection) と Node(require) 両対応(UMD-lite)。副作用なし・DOM非依存。
// finance-rules.js の直後にロード（FinanceRules の単社getterを横断集計の部品として消費）。
// 母集団は市場ベース(country='JP'|'US')。no-score・中立語・facts非出力。
(function (root, factory) {
  const FR = (typeof FinanceRules !== "undefined") ? FinanceRules
    : (typeof require !== "undefined") ? require("./finance-rules.js") : null;
  const api = factory(FR);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CrossSection = api;
})(typeof self !== "undefined" ? self : this, function (FR) {
  "use strict";

  // ---- 統計プリミティブ ----
  function _sorted(vals) {
    return (vals || []).filter(function (v) { return typeof v === "number" && isFinite(v); })
      .sort(function (a, b) { return a - b; });
  }
  function median(vals) {
    var s = _sorted(vals);
    if (s.length === 0) return null;
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mean(vals) {
    var s = _sorted(vals);
    if (s.length === 0) return null;
    return s.reduce(function (a, b) { return a + b; }, 0) / s.length;
  }
  // midrank: (x未満の個数 + 同値の個数/2) / n ×100。単要素=50・全同値=50。
  function percentileRank(vals, x) {
    var s = _sorted(vals);
    if (s.length === 0 || typeof x !== "number" || !isFinite(x)) return null;
    var less = 0, equal = 0;
    for (var i = 0; i < s.length; i++) { if (s[i] < x) less++; else if (s[i] === x) equal++; }
    return ((less + equal / 2) / s.length) * 100;
  }
  function quantile(vals, q) {
    var s = _sorted(vals);
    if (s.length === 0) return null;
    if (s.length === 1) return s[0];
    var pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  return { median: median, mean: mean, percentileRank: percentileRank, quantile: quantile };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cross-section-rules.test.js`
Expected: PASS（4 tests）

- [ ] **Step 5: Commit**

```bash
git add cross-section-rules.js tests/cross-section-rules.test.js
git commit -m "feat(cross-section): statistics primitives (median/mean/percentileRank/quantile)"
```

---

## Task 2: METRIC_REGISTRY + buildUniverse

**Files:**
- Modify: `cross-section-rules.js`
- Test: `tests/cross-section-rules.test.js`

**Interfaces:**
- Consumes: `FinanceRules.roe/roa/netMargin/opMargin/equityRatio/currentRatio/hasValue/fmtMagnitude`.
- Produces: `CrossSection.METRIC_REGISTRY` (array), `.METRIC_BY_KEY` (map), `.buildUniverse(stockData)` → `{ JP:{_members:[{ticker,name,industry,currency,values:{key:number|null}}], per:[…], … }, US:{…} }`, `._latestFin(raw)`.

- [ ] **Step 1: Write the failing test**

Append to `tests/cross-section-rules.test.js`:
```js
// 最新年 = 2025。7グリッド財務。per/pbr/marketCap は raw 直下。
function jpStock(over) {
  return Object.assign({
    company_name: "テスト", industry: "電気機器", currency: "JPY", country: "JP", type: "stock",
    per: 15, pbr: 1.5, marketCap: 1e12,
    financials_trend: { "2024": { year: 2024, net_sales: 900, net_assets: 500, current_assets: 400,
      non_current_assets: 600, current_liabilities: 200, operating_income: 90, net_income: 60 },
      "2025": { year: 2025, net_sales: 1000, net_assets: 600, current_assets: 500,
        non_current_assets: 500, current_liabilities: 250, operating_income: 120, net_income: 80 } },
  }, over || {});
}
test("buildUniverse: ETF除外・市場分割・0欠測・最新年採用", () => {
  const data = {
    "1.T": jpStock({ per: 10 }),
    "2.T": jpStock({ per: 20, marketCap: 0 }),        // marketCap=0 → 欠測
    "3.T": jpStock({ per: 0 }),                        // per=0 → 欠測
    "ETF.T": jpStock({ type: "etf", financials_trend: {} }),
    "AAA": jpStock({ country: "US", currency: "USD", industry: "US - Tech" }),
  };
  const u = CS.buildUniverse(data);
  assert.deepStrictEqual([...u.JP.per].sort((a, b) => a - b), [10, 15]); // 20の銘柄はper有効(20)…
  // 注: "2.T" は per=20 有効(marketCapのみ欠測)。per配列 = [10,20,15]の有効値
  assert.ok(u.JP._members.length === 3);   // ETF除外・US別 → JP stock 3件
  assert.ok(u.US._members.length === 1);
  assert.strictEqual(u.JP.marketCap.filter(v => v === 0).length, 0); // 0は入らない
  // ROE(最新2025) = 80/600*100 ≈ 13.33
  const roe = u.JP._members[0].values.roe;
  assert.ok(Math.abs(roe - 13.333) < 0.01);
});
test("_latestFin: max year / empty", () => {
  assert.strictEqual(CS._latestFin(jpStock()).year, 2025);
  assert.strictEqual(CS._latestFin({ financials_trend: {} }), null);
});
```
（上のper配列の期待は次stepの実装で `[10,15,20]` を確認できるよう修正: 下記 Step 4 で実値に合わせて `assert` を確定させる。）

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cross-section-rules.test.js`
Expected: FAIL（`CS.buildUniverse is not a function`）

- [ ] **Step 3: Write minimal implementation**

`cross-section-rules.js` の統計プリミティブの下、`return` の前に追加。`return` にも追記。
```js
  // ---- 欠測ゲート ----
  function _rawPositive(raw, key) {
    var v = Number(raw && raw[key]);
    return (isFinite(v) && v > 0) ? v : null; // 0/欠落/非有限 = 欠測(list.py null→0の罠)
  }
  function _finRatio(fin, fn, needKeys) {
    if (!fin || !FR) return null;
    for (var i = 0; i < needKeys.length; i++) { if (!FR.hasValue(fin, needKeys[i])) return null; }
    var v = fn(fin);
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }
  function _latestFin(raw) {
    var t = raw && raw.financials_trend;
    if (!t || typeof t !== "object") return null;
    var years = Object.keys(t).map(Number).filter(isFinite);
    if (years.length === 0) return null;
    return t[String(Math.max.apply(null, years))] || null;
  }

  // ---- 指標レジストリ ----
  var METRIC_REGISTRY = [
    { key: "per", label: "PER", read: "ピーイーアール", unit: "倍", currencyNeutral: true, higherIsBetter: false, termKey: "PER",
      getter: function (fin, raw) { return _rawPositive(raw, "per"); } },
    { key: "pbr", label: "PBR", read: "ピービーアール", unit: "倍", currencyNeutral: true, higherIsBetter: false, termKey: "PBR",
      getter: function (fin, raw) { return _rawPositive(raw, "pbr"); } },
    { key: "roe", label: "ROE", read: "アールオーイー", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "ROE",
      getter: function (fin) { return _finRatio(fin, FR.roe, ["net_income", "net_assets"]); } },
    { key: "roa", label: "ROA", read: "アールオーエー", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "ROA",
      getter: function (fin) { return _finRatio(fin, FR.roa, ["net_income", "current_assets", "non_current_assets"]); } },
    { key: "netMargin", label: "純利益率", read: "じゅんりえきりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "純利益率",
      getter: function (fin) { return _finRatio(fin, FR.netMargin, ["net_income", "net_sales"]); } },
    { key: "opMargin", label: "営業利益率", read: "えいぎょうりえきりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "営業利益率",
      getter: function (fin) { return _finRatio(fin, FR.opMargin, ["operating_income", "net_sales"]); } },
    { key: "equityRatio", label: "自己資本比率", read: "じこしほんひりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "自己資本比率",
      getter: function (fin) { return _finRatio(fin, FR.equityRatio, ["net_assets", "current_assets", "non_current_assets"]); } },
    { key: "currentRatio", label: "流動比率", read: "りゅうどうひりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "流動比率",
      getter: function (fin) { return _finRatio(fin, FR.currentRatio, ["current_assets", "current_liabilities"]); } },
    { key: "marketCap", label: "時価総額", read: "じかそうがく", unit: "", currencyNeutral: false, higherIsBetter: null, termKey: "時価総額",
      getter: function (fin, raw) { return _rawPositive(raw, "marketCap"); } },
  ];
  var METRIC_BY_KEY = {};
  METRIC_REGISTRY.forEach(function (m) { METRIC_BY_KEY[m.key] = m; });

  function _market(ticker, raw) {
    return raw.country || (String(ticker).slice(-2) === ".T" ? "JP" : "US");
  }
  function buildUniverse(stockData) {
    var universe = {};
    Object.keys(stockData || {}).forEach(function (ticker) {
      var raw = stockData[ticker];
      if (!raw || (raw.type || "stock") === "etf") return;
      var market = _market(ticker, raw);
      if (!universe[market]) {
        universe[market] = { _members: [] };
        METRIC_REGISTRY.forEach(function (m) { universe[market][m.key] = []; });
      }
      var fin = _latestFin(raw);
      var values = {};
      METRIC_REGISTRY.forEach(function (m) {
        var v = m.getter(fin, raw);
        values[m.key] = (typeof v === "number" && isFinite(v)) ? v : null;
        if (values[m.key] !== null) universe[market][m.key].push(values[m.key]);
      });
      universe[market]._members.push({
        ticker: ticker, name: raw.company_name || ticker, industry: raw.industry || "—",
        currency: raw.currency || "", values: values,
      });
    });
    return universe;
  }
```
`return` を更新:
```js
  return {
    median: median, mean: mean, percentileRank: percentileRank, quantile: quantile,
    METRIC_REGISTRY: METRIC_REGISTRY, METRIC_BY_KEY: METRIC_BY_KEY,
    buildUniverse: buildUniverse, _latestFin: _latestFin,
  };
```

- [ ] **Step 4: Run test, confirm actual per-array, finalize assert**

Run: `node --test tests/cross-section-rules.test.js`
実際の `u.JP.per` は `[10,20,15]`（挿入順）。テストの1行目 assert を確定:
```js
  assert.deepStrictEqual([...u.JP.per].sort((a, b) => a - b), [10, 15, 20]);
```
（"3.T" の per=0 のみ欠測で除外。marketCap=0 の "2.T" は per=20 が有効。）再実行し PASS。

- [ ] **Step 5: Commit**

```bash
git add cross-section-rules.js tests/cross-section-rules.test.js
git commit -m "feat(cross-section): METRIC_REGISTRY + buildUniverse (ETF excl, 0-as-missing, market split)"
```

---

## Task 3: peerStats + relativePosition descriptor

**Files:**
- Modify: `cross-section-rules.js`
- Test: `tests/cross-section-rules.test.js`

**Interfaces:**
- Produces: `CrossSection.peerStats(universe, market, metricKey)` → `{n,median,q1,q3,min,max}`. `CrossSection.relativePosition(ticker, stockData)` → `{market, marketLabel, marketN, groups:[{title, metrics:[{key,label,termKey,unit,value,format,percentile,n,median,min,max,band,tone,caption}]}]}` または `{etf:true}` / `null`。**中立語のみ**。

- [ ] **Step 1: Write the failing test**

Append:
```js
test("relativePosition: 中立語彙のみ・自市場内・欠測データなし・ETF", () => {
  const data = {
    "A.T": jpStock({ per: 10, roe: undefined }),   // roe は財務から算出
    "B.T": jpStock({ per: 30 }),
    "C.T": jpStock({ per: 20, financials_trend: { "2025": { year: 2025, net_sales: 1000, net_assets: 600,
      current_assets: 500, non_current_assets: 500, current_liabilities: 250, operating_income: 120 } } }), // net_income欠落
  };
  const rp = CS.relativePosition("A.T", data);
  assert.strictEqual(rp.market, "JP");
  assert.strictEqual(rp.marketLabel, "日本株");
  const per = rp.groups[0].metrics.find(m => m.key === "per");
  assert.strictEqual(per.value, 10);
  assert.ok(per.caption.includes("日本株") && per.caption.includes("パーセンタイル"));
  // C.T は net_income 欠落 → roe/netMargin は欠測(=universe に入らない)。A.T の roe は算出可。
  const roe = rp.groups[1].metrics.find(m => m.key === "roe");
  assert.ok(roe.value != null);
  // 中立語彙: どの caption/band にも売買/予測語が無い
  const BANNED = ["買い", "売り", "買う", "売る", "推奨", "割安なので", "上がる", "下がる", "狙い目", "お得"];
  const allText = JSON.stringify(rp);
  BANNED.forEach(w => assert.ok(!allText.includes(w), "banned word: " + w));
  assert.deepStrictEqual(CS.relativePosition("ETF.T", { "ETF.T": jpStock({ type: "etf", financials_trend: {} }) }), { etf: true });
  assert.strictEqual(CS.relativePosition("NOPE", data), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cross-section-rules.test.js`
Expected: FAIL（`CS.relativePosition is not a function`）

- [ ] **Step 3: Write minimal implementation**

`cross-section-rules.js` に追加（buildUniverse の下）:
```js
  var MARKET_LABEL = { JP: "日本株", US: "米国株" };

  // 中立バンド語(位置のみ・売買/予測語なし)。higherIsBetter は band には使わない(純粋に位置)。
  function _band(pctile) {
    if (pctile == null) return { label: "データなし", tone: "muted" };
    if (pctile >= 80) return { label: "上位", tone: "high" };
    if (pctile >= 60) return { label: "やや上位", tone: "midhigh" };
    if (pctile >= 40) return { label: "中央値付近", tone: "mid" };
    if (pctile >= 20) return { label: "やや下位", tone: "midlow" };
    return { label: "下位", tone: "low" };
  }
  function _fmtMetric(m, value, currency) {
    if (value == null) return "—";
    if (m.key === "marketCap") return FR && FR.fmtMagnitude ? FR.fmtMagnitude(value, currency) : String(value);
    if (m.unit === "%") return value.toFixed(1) + "%";
    if (m.unit === "倍") return value.toFixed(1) + "倍";
    return String(value);
  }
  function peerStats(universe, market, metricKey) {
    var g = universe && universe[market];
    var vals = (g && g[metricKey]) || [];
    return {
      n: vals.length, median: median(vals), q1: quantile(vals, 0.25), q3: quantile(vals, 0.75),
      min: vals.length ? Math.min.apply(null, vals) : null,
      max: vals.length ? Math.max.apply(null, vals) : null,
    };
  }
  function relativePosition(ticker, stockData) {
    var raw = stockData && stockData[ticker];
    if (!raw) return null;
    if ((raw.type || "stock") === "etf") return { etf: true };
    var universe = buildUniverse(stockData);
    var market = _market(ticker, raw);
    var g = universe[market];
    if (!g) return null;
    var self = null;
    for (var i = 0; i < g._members.length; i++) { if (g._members[i].ticker === ticker) { self = g._members[i]; break; } }
    var selfVals = self ? self.values : {};
    function entry(m) {
      var value = selfVals[m.key];
      value = (value == null) ? null : value;
      var stats = peerStats(universe, market, m.key);
      var pctile = (value == null) ? null : percentileRank(g[m.key], value);
      var band = _band(pctile);
      return {
        key: m.key, label: m.label, termKey: m.termKey, unit: m.unit,
        value: value, format: _fmtMetric(m, value, raw.currency),
        percentile: pctile, n: stats.n, median: stats.median, min: stats.min, max: stats.max,
        band: band.label, tone: band.tone,
        caption: (value == null) ? "データなし"
          : (MARKET_LABEL[market] || market) + stats.n + "銘柄中 " + band.label + "（" + Math.round(pctile) + "パーセンタイル）",
      };
    }
    function grp(title, keys) { return { title: title, metrics: keys.map(function (k) { return entry(METRIC_BY_KEY[k]); }) }; }
    return {
      market: market, marketLabel: MARKET_LABEL[market] || market, marketN: g._members.length,
      groups: [
        grp("割安度", ["per", "pbr"]),
        grp("収益性", ["roe", "roa", "netMargin", "opMargin"]),
        grp("安全性", ["equityRatio", "currentRatio"]),
        grp("規模", ["marketCap"]),
      ],
    };
  }
```
`return` に `peerStats: peerStats, relativePosition: relativePosition,` を追加。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cross-section-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add cross-section-rules.js tests/cross-section-rules.test.js
git commit -m "feat(cross-section): peerStats + relativePosition descriptor (neutral vocab, market-based)"
```

---

## Task 4: compareMetricsRows + rankByMetric + scatterPoints + sectorMedians

**Files:**
- Modify: `cross-section-rules.js`
- Test: `tests/cross-section-rules.test.js`

**Interfaces:**
- Produces: `compareMetricsRows(tickers, stockData)` → `[{ticker,name,market,currency,isEtf,cells:{key:{value,format,missing}}}]`. `rankByMetric(universe, market, metricKey, opts?)` → `[{rank,ticker,name,industry,value,format,percentile,decile}]`. `scatterPoints(universe, market, xKey, yKey)` → `{points:[{ticker,name,industry,x,y}],xMedian,yMedian,xLabel,yLabel}`. `sectorMedians(universe, market, metricKey, opts?)` → `[{sector,n,median}]`（N<minN は「その他」集約）。

- [ ] **Step 1: Write the failing test**

Append:
```js
test("compareMetricsRows: ETFはN/A・欠測—・marketCapは通貨付き", () => {
  const data = { "A.T": jpStock(), "ETF.T": jpStock({ type: "etf", financials_trend: {} }) };
  const rows = CS.compareMetricsRows(["A.T", "ETF.T", "NOPE"], data);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].cells.per.missing, false);
  assert.strictEqual(rows[1].isEtf, true);
  assert.strictEqual(rows[1].cells.roe.missing, true);
  assert.strictEqual(rows[1].cells.roe.format, "—");
  assert.strictEqual(rows[1].cells.marketCap.missing, false); // ETFでも時価総額は出す
});
test("rankByMetric: 自市場内・PER昇順(低い順)・decile", () => {
  const data = { "A.T": jpStock({ per: 10 }), "B.T": jpStock({ per: 30 }), "C.T": jpStock({ per: 20 }) };
  const u = CS.buildUniverse(data);
  const r = CS.rankByMetric(u, "JP", "per");
  assert.deepStrictEqual(r.map(x => x.ticker), ["A.T", "C.T", "B.T"]); // higherIsBetter=false → asc
  assert.strictEqual(r[0].rank, 1);
});
test("scatterPoints: 両軸欠測除外 + 中央値", () => {
  const data = { "A.T": jpStock({ per: 10 }), "B.T": jpStock({ per: 20 }) };
  const u = CS.buildUniverse(data);
  const s = CS.scatterPoints(u, "JP", "per", "roe");
  assert.strictEqual(s.points.length, 2);
  assert.strictEqual(s.xMedian, 15);
  assert.ok(s.xLabel === "PER" && s.yLabel === "ROE");
});
test("sectorMedians: N<minNはその他集約", () => {
  const mk = (sec, per) => jpStock({ industry: sec, per });
  const data = { "1.T": mk("金融", 10), "2.T": mk("金融", 12), "3.T": mk("金融", 14),
    "4.T": mk("小売", 20), "5.T": mk("食品", 22) };
  const u = CS.buildUniverse(data);
  const sm = CS.sectorMedians(u, "JP", "per", { minN: 3 });
  const fin = sm.find(x => x.sector === "金融");
  const other = sm.find(x => x.sector === "その他");
  assert.strictEqual(fin.n, 3);
  assert.strictEqual(fin.median, 12);
  assert.strictEqual(other.n, 2); // 小売+食品
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cross-section-rules.test.js`
Expected: FAIL（未定義関数）

- [ ] **Step 3: Write minimal implementation**

追加:
```js
  var COMPARE_METRICS = ["per", "pbr", "roe", "netMargin", "opMargin", "equityRatio", "currentRatio", "marketCap"];
  function compareMetricsRows(tickers, stockData) {
    return (tickers || []).map(function (ticker) {
      var raw = stockData && stockData[ticker];
      if (!raw) return null;
      var isEtf = (raw.type || "stock") === "etf";
      var fin = _latestFin(raw);
      var cells = {};
      COMPARE_METRICS.forEach(function (k) {
        var m = METRIC_BY_KEY[k];
        var v = (isEtf && k !== "marketCap") ? null : m.getter(fin, raw);
        var missing = !(typeof v === "number" && isFinite(v));
        cells[k] = { value: missing ? null : v, format: missing ? "—" : _fmtMetric(m, v, raw.currency), missing: missing };
      });
      return { ticker: ticker, name: raw.company_name || ticker, market: raw.country || "", currency: raw.currency || "", isEtf: isEtf, cells: cells };
    }).filter(Boolean);
  }
  function rankByMetric(universe, market, metricKey, opts) {
    var g = universe && universe[market];
    if (!g) return [];
    var m = METRIC_BY_KEY[metricKey];
    var dir = (opts && opts.dir) || (m && m.higherIsBetter === false ? "asc" : "desc");
    var vals = g[metricKey];
    var rows = g._members.filter(function (mem) { return mem.values[metricKey] != null; })
      .map(function (mem) { return { ticker: mem.ticker, name: mem.name, industry: mem.industry, value: mem.values[metricKey], currency: mem.currency }; });
    rows.sort(function (a, b) { return dir === "asc" ? a.value - b.value : b.value - a.value; });
    return rows.map(function (r, i) {
      var p = percentileRank(vals, r.value);
      return { rank: i + 1, ticker: r.ticker, name: r.name, industry: r.industry, value: r.value,
        format: _fmtMetric(m, r.value, r.currency), percentile: p, decile: Math.min(10, Math.floor(p / 10) + 1) };
    });
  }
  function scatterPoints(universe, market, xKey, yKey) {
    var g = universe && universe[market];
    if (!g) return { points: [], xMedian: null, yMedian: null, xLabel: "", yLabel: "" };
    var points = g._members.filter(function (mem) { return mem.values[xKey] != null && mem.values[yKey] != null; })
      .map(function (mem) { return { ticker: mem.ticker, name: mem.name, industry: mem.industry, x: mem.values[xKey], y: mem.values[yKey] }; });
    return { points: points, xMedian: median(points.map(function (p) { return p.x; })), yMedian: median(points.map(function (p) { return p.y; })),
      xLabel: (METRIC_BY_KEY[xKey] || {}).label || xKey, yLabel: (METRIC_BY_KEY[yKey] || {}).label || yKey };
  }
  function sectorMedians(universe, market, metricKey, opts) {
    var g = universe && universe[market];
    if (!g) return [];
    var minN = (opts && opts.minN) || 3, bySector = {};
    g._members.forEach(function (mem) {
      var v = mem.values[metricKey];
      if (v == null) return;
      (bySector[mem.industry] = bySector[mem.industry] || []).push(v);
    });
    var named = [], other = [];
    Object.keys(bySector).forEach(function (sec) {
      var vals = bySector[sec];
      if (vals.length >= minN) named.push({ sector: sec, n: vals.length, median: median(vals) });
      else other = other.concat(vals);
    });
    named.sort(function (a, b) { return (b.median || 0) - (a.median || 0); });
    if (other.length) named.push({ sector: "その他", n: other.length, median: median(other) });
    return named;
  }
```
`return` に `compareMetricsRows, rankByMetric, scatterPoints, sectorMedians` を追加。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cross-section-rules.test.js`
Expected: PASS（全 test）

- [ ] **Step 5: Commit**

```bash
git add cross-section-rules.js tests/cross-section-rules.test.js
git commit -m "feat(cross-section): compareRows/rankByMetric/scatterPoints/sectorMedians"
```

---

## Task 5: 配線（script追加）+ グロッサリ拡張

**Files:**
- Modify: `index.html`（`<script src="finance-rules.js">` の直後に cross-section-rules を追加）
- Modify: `detail-rules.js`（`INDICATOR_GLOSSARY` に4語追記）
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Produces: ブラウザ大域 `window.CrossSection`。`DetailRules.INDICATOR_GLOSSARY` に `パーセンタイル/中央値/四分位/同市場比較`。

- [ ] **Step 1: Write the failing test**

`tests/detail-rules.test.js` に追記:
```js
test("INDICATOR_GLOSSARY has cross-section terms", () => {
  const terms = DetailRules.INDICATOR_GLOSSARY.map(g => g.term);
  ["パーセンタイル", "中央値", "四分位", "同市場比較"].forEach(t => assert.ok(terms.includes(t), t));
});
```
(先頭で `const DetailRules = require("../detail-rules.js");` が既にある前提。無ければ既存冒頭に合わせる。)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL（term 未定義）

- [ ] **Step 3: Implement**

`detail-rules.js` の `INDICATOR_GLOSSARY` 配列末尾に4項目追加（各 def は中立・平易・売買/予測語なし）:
```js
    { term: "パーセンタイル", read: "ぱーせんたいる", def: "ある値が母集団の中で下から何%の位置かを示す指標。50なら中央、80なら下から80%（=上位20%）。順位を割合で表す。" },
    { term: "中央値", read: "ちゅうおうち", def: "値を小さい順に並べたときの真ん中の値。平均と違い極端な外れ値の影響を受けにくい。" },
    { term: "四分位", read: "しぶんい", def: "分布を4等分する位置。第1四分位(下から25%)・中央値(50%)・第3四分位(75%)。ばらつきの目安。" },
    { term: "同市場比較", read: "どうしじょうひかく", def: "同じ市場(日本株どうし/米国株どうし)の中での相対的な位置。比率は通貨に依存しないため市場内で比較できる。値が高い/低いは良し悪しを断定するものではない。" },
```

`index.html` の script 読込に1行追加（finance-rules の直後・detail-rules の前）:
```html
    <script src="finance-rules.js"></script>
    <script src="cross-section-rules.js"></script>
    <script src="detail-rules.js"></script>
```

- [ ] **Step 4: Verify**

Run: `node --test tests/detail-rules.test.js`（PASS）＋
Run: `NODE_PATH=/home/shugo/node_modules node -e "require('./cross-section-rules.js'); console.log('loads')"`（`loads`）

- [ ] **Step 5: Commit**

```bash
git add index.html detail-rules.js tests/detail-rules.test.js
git commit -m "feat(cross-section): wire script load order + INDICATOR_GLOSSARY cross-section terms"
```

---

## Task 6: ① 相対位置カード — 静的コンテナ + スタイル

**Files:**
- Modify: `index.html`（`.dashboard-stack` 内に `#relative-position-card`）
- Modify: `detail.css`（分布バー・カード・nth-child 拡張）

**Interfaces:**
- Produces: DOM `#relative-position-card`（初期 `display:none`）。CSS `.relpos-*`。

- [ ] **Step 1: Add static container**

`index.html` の `.dashboard-stack` 内、`#signal-digest-card`/`#health-trend-card` と同列に追加:
```html
<div class="card relpos-card" id="relative-position-card" style="display:none"></div>
```

- [ ] **Step 2: Add styles**

`detail.css` に追加（分布バー＝面でなく線/マーカーで表現）:
```css
.relpos-group { margin: 10px 0 4px; }
.relpos-group-title { font: 600 12px/1.4 var(--ix-mono, monospace); color: var(--c-cyan, #62f0ff); letter-spacing: .04em; margin-bottom: 6px; }
.relpos-row { display: grid; grid-template-columns: 96px 1fr 132px; gap: 10px; align-items: center; padding: 5px 0; }
.relpos-label { font: 12px/1.3 var(--ix-mono, monospace); color: #cfe8ff; }
.relpos-bar { position: relative; height: 6px; border-radius: 3px; background: linear-gradient(90deg, rgba(98,240,255,.10), rgba(98,240,255,.22)); }
.relpos-median { position: absolute; top: -3px; width: 1px; height: 12px; background: rgba(255,255,255,.45); }
.relpos-marker { position: absolute; top: -4px; width: 10px; height: 14px; margin-left: -5px; border-radius: 2px;
  background: var(--c-cyan, #62f0ff); box-shadow: 0 0 8px var(--c-cyan, #62f0ff); }
.relpos-marker.tone-low { background: #ff8fb0; box-shadow: 0 0 8px #ff8fb0; }
.relpos-marker.tone-high { background: #7CFFB0; box-shadow: 0 0 8px #7CFFB0; }
.relpos-val { font: 12px/1.3 var(--ix-mono, monospace); color: #fff; text-align: right; }
.relpos-cap { grid-column: 2 / 4; font: 11px/1.3 var(--ix-mono, monospace); color: #9fb9cc; margin-top: -2px; }
.relpos-na { color: #7d93a5; font-size: 11px; }
```

`detail.css` の `.dashboard-stack.animate-cards .card:nth-child(N)` の stagger 定義を、追加カード分だけ**1段拡張**（現状の最大 nth-child 番号 +1 まで同じ増分で追記。実ファイルの既存値を読み、末尾に1行足す）。

- [ ] **Step 3: Verify markup loads (no JS yet)**

Run（mock server 起動中）: 目視で `#relative-position-card` が DOM に存在し `display:none`。
（描画は Task 7。ここでは静的追加のみ＝スモーク。）

- [ ] **Step 4: Commit**

```bash
git add index.html detail.css
git commit -m "feat(relpos): static #relative-position-card container + distribution-bar styles"
```

---

## Task 7: ① 相対位置カード — 描画配線（detail.js）

**Files:**
- Modify: `detail.js`（`renderRelativePosition` + finCards登録 + 呼び出し + 公開）
- Test: Playwright（mock_prod_server）

**Interfaces:**
- Consumes: `CrossSection.relativePosition`, `window.esc`, `injectTermHelp`, `DetailRules.ANALYSIS_DISCLAIMER`, `currentTicker`, `STOCK_DATA`.
- Produces: `renderRelativePosition(ticker)`（detail.js window 公開）。ETF非表示。

- [ ] **Step 1: Implement render fn（renderSignalDigest 同型）**

`detail.js` に追加:
```js
function renderRelativePosition(ticker) {
  var card = document.getElementById("relative-position-card");
  if (!card) return;
  var CS = (typeof CrossSection !== "undefined") ? CrossSection : (window.CrossSection);
  var disc = (typeof DetailRules !== "undefined") && DetailRules.ANALYSIS_DISCLAIMER;
  if (!CS || !disc || !STOCK_DATA) { card.style.display = "none"; return; }
  var rp = CS.relativePosition(ticker, STOCK_DATA);
  if (!rp || rp.etf) { card.style.display = "none"; return; }
  function barRow(m) {
    if (m.value == null) {
      return '<div class="relpos-row"><div class="relpos-label" data-term="' + esc(m.termKey) + '">' + esc(m.label) +
        '</div><div class="relpos-na">データなし</div><div class="relpos-val">—</div></div>';
    }
    var lo = m.min, hi = m.max, span = (hi - lo) || 1;
    var pos = Math.max(0, Math.min(100, ((m.value - lo) / span) * 100));
    var medPos = (m.median == null) ? 50 : Math.max(0, Math.min(100, ((m.median - lo) / span) * 100));
    return '<div class="relpos-row">' +
      '<div class="relpos-label" data-term="' + esc(m.termKey) + '">' + esc(m.label) + '</div>' +
      '<div class="relpos-bar"><div class="relpos-median" style="left:' + medPos.toFixed(1) + '%"></div>' +
      '<div class="relpos-marker tone-' + esc(m.tone) + '" style="left:' + pos.toFixed(1) + '%"></div></div>' +
      '<div class="relpos-val">' + esc(m.format) + '</div>' +
      '<div class="relpos-cap">' + esc(m.caption) + '</div></div>';
  }
  var html = '<div class="card-title" data-term="同市場比較">相対ポジション <span class="relpos-sub">' +
    esc(rp.marketLabel) + esc(String(rp.marketN)) + '銘柄との比較</span></div>';
  rp.groups.forEach(function (grp) {
    if (!grp.metrics.length) return;
    html += '<div class="relpos-group"><div class="relpos-group-title">' + esc(grp.title) + '</div>' +
      grp.metrics.map(barRow).join("") + '</div>';
  });
  html += '<div class="panel-disclaimer">' + esc(disc) + '</div>';
  card.innerHTML = html;
  card.style.display = "";
  if (typeof injectTermHelp === "function") injectTermHelp(card);
}
```

- [ ] **Step 2: Register in finCards + call site**

`updateFinancialViews`（detail.js）内で、`finCards` 配列に `"relative-position-card"` を追加（ETFで非表示になる集合）。`renderRelativePosition(currentTicker)` を **`if (!fin) return` の後**（renderHealthTrend と同じ経路・ETFは早期returnで非表示）に呼ぶ。

- [ ] **Step 3: Expose**

`detail.js` の window 公開ブロックに `window.renderRelativePosition = renderRelativePosition;` を追加。

- [ ] **Step 4: Playwright verify**

`scratchpad/task7-relpos-verify.js`（mock_prod_server 前提・playwright）で:
- equity（例 7203.T）詳細を開く → `#relative-position-card` 可視・`.relpos-row` 複数・`data-term` の ? 注入・免責文言存在・`pageerror` 0。
- ETF（例 1321.T）詳細 → `#relative-position-card` が `display:none`。
- 禁止語彙（買い/売り/推奨/上がる/下がる）が card テキストに0件。

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/task7-relpos-verify.js`
Expected: 全アサート PASS・pageerror0。

- [ ] **Step 5: Commit**

```bash
git add detail.js scratchpad/task7-relpos-verify.js
git commit -m "feat(relpos): renderRelativePosition wired (ETF-safe, termHelp, disclaimer)"
```

---

## Task 8: ② 比較テーブル — モーダルのタブ + コンテナ + スタイル

**Files:**
- Modify: `index.html`（`#compare-modal` にタブ + `#compare-table-container`）
- Modify: `detail.css`（タブ・テーブル）

**Interfaces:**
- Produces: DOM `#compare-tab-chart`/`#compare-tab-table` ボタン + `#compare-chart-container`（既存）/`#compare-table-container`（新・初期 `display:none`）。CSS `.cmp-tab*`, `.cmp-table*`。

- [ ] **Step 1: Add tab bar + table container**

`index.html` の `#compare-modal` 内、`.compare-period-bar` の直後・`#compare-chart-container` の直前あたりに:
```html
<div class="cmp-tabs">
  <button class="cmp-tab active" id="compare-tab-chart" onclick="setCompareTab('chart')">📈 リターン比較</button>
  <button class="cmp-tab" id="compare-tab-table" onclick="setCompareTab('table')">▤ 指標比較</button>
</div>
```
`#compare-chart-container` の直後に:
```html
<div id="compare-table-container" style="display:none"></div>
```

- [ ] **Step 2: Styles**

`detail.css`:
```css
.cmp-tabs { display: flex; gap: 8px; margin: 6px 0 8px; }
.cmp-tab { font: 12px var(--ix-mono, monospace); color: #9fb9cc; background: transparent; border: 1px solid rgba(98,240,255,.25);
  border-radius: 3px; padding: 5px 12px; cursor: pointer; }
.cmp-tab.active { color: var(--c-cyan, #62f0ff); border-color: var(--c-cyan, #62f0ff); box-shadow: 0 0 8px rgba(98,240,255,.3); }
.cmp-table { width: 100%; border-collapse: collapse; font: 12px var(--ix-mono, monospace); }
.cmp-table th, .cmp-table td { padding: 6px 8px; text-align: right; border-bottom: 1px solid rgba(98,240,255,.12); white-space: nowrap; }
.cmp-table th:first-child, .cmp-table td:first-child { text-align: left; }
.cmp-table thead th { color: var(--c-cyan, #62f0ff); font-weight: 600; }
.cmp-table td.na { color: #7d93a5; }
.cmp-table-wrap { overflow-x: auto; }
/* 免責の共通スタイル（相対カード/比較テーブル/ランキングで共用・.sig-disclaimer と同等） */
.panel-disclaimer { margin-top: 8px; font-size: 10px; color: var(--ix-text-dim, #9fb0d0); line-height: 1.5; }
```

- [ ] **Step 3: Smoke**

mock server で比較モーダルを開き、2タブとテーブルコンテナ（空・display:none）が DOM 存在。切替 JS は Task 9。

- [ ] **Step 4: Commit**

```bash
git add index.html detail.css
git commit -m "feat(compare-table): modal tab bar + #compare-table-container + styles"
```

---

## Task 9: ② 比較テーブル — 描画 + タブ切替 + 配線（detail.js）

**Files:**
- Modify: `detail.js`（`renderCompareTable` + `setCompareTab` + 再描画点 + 公開）
- Test: Playwright

**Interfaces:**
- Consumes: `CrossSection.compareMetricsRows`, `compareSet`（IIFE-private）, `window.esc`, `injectTermHelp`, `STOCK_DATA`, `DetailRules.ANALYSIS_DISCLAIMER`.
- Produces: `renderCompareTable(compareSet)`, `setCompareTab(which)`（detail.js window 公開）。

- [ ] **Step 1: Implement**

`detail.js`:
```js
// term は INDICATOR_GLOSSARY のキー（小文字ハイフン短コード）に一致させる（?ツールチップが引けるように）
var COMPARE_COLS = [
  { key: "per", label: "PER", term: "per" }, { key: "pbr", label: "PBR", term: "pbr" },
  { key: "roe", label: "ROE", term: "roe" }, { key: "netMargin", label: "純利益率", term: "net-margin" },
  { key: "opMargin", label: "営業利益率", term: "op-margin" }, { key: "equityRatio", label: "自己資本比率", term: "equity-ratio" },
  { key: "currentRatio", label: "流動比率", term: "current-ratio" }, { key: "marketCap", label: "時価総額", term: "market-cap" },
];
function renderCompareTable(setLike) {
  var host = document.getElementById("compare-table-container");
  if (!host) return;
  var CS = (typeof CrossSection !== "undefined") ? CrossSection : window.CrossSection;
  var disc = (typeof DetailRules !== "undefined") && DetailRules.ANALYSIS_DISCLAIMER;
  var tickers = setLike ? Array.from(setLike) : [];
  if (!CS || !tickers.length || !STOCK_DATA) { host.innerHTML = ""; return; }
  var rows = CS.compareMetricsRows(tickers, STOCK_DATA);
  var head = '<th>銘柄</th>' + COMPARE_COLS.map(function (c) {
    return '<th data-term="' + esc(c.term) + '">' + esc(c.label) + '</th>'; }).join("");
  var body = rows.map(function (r) {
    var tds = '<td>' + esc(r.name) + (r.isEtf ? ' <span class="cmp-etf">ETF</span>' : '') + '</td>';
    tds += COMPARE_COLS.map(function (c) {
      var cell = r.cells[c.key];
      return '<td class="' + (cell.missing ? 'na' : '') + '">' + esc(cell.format) +
        (c.key === "marketCap" && !cell.missing ? ' <span class="cmp-cur">' + esc(r.currency === "USD" ? "$" : "¥") + '</span>' : '') + '</td>';
    }).join("");
    return '<tr>' + tds + '</tr>';
  }).join("");
  host.innerHTML = '<div class="cmp-table-wrap"><table class="cmp-table"><thead><tr>' + head +
    '</tr></thead><tbody>' + body + '</tbody></table></div>' +
    '<div class="cmp-note">※ 時価総額は通貨単位が異なり市場をまたぐ比較はできません。</div>' +
    (disc ? '<div class="panel-disclaimer">' + esc(disc) + '</div>' : '');
  if (typeof injectTermHelp === "function") injectTermHelp(host);
}
function setCompareTab(which) {
  var chart = document.getElementById("compare-chart-container");
  var table = document.getElementById("compare-table-container");
  var legend = document.getElementById("compare-legend");
  var bChart = document.getElementById("compare-tab-chart"), bTable = document.getElementById("compare-tab-table");
  var isTable = which === "table";
  if (chart) chart.style.display = isTable ? "none" : "";
  if (legend) legend.style.display = isTable ? "none" : "";
  if (table) { table.style.display = isTable ? "" : "none"; if (isTable) renderCompareTable(compareSet); }
  if (bChart) bChart.classList.toggle("active", !isTable);
  if (bTable) bTable.classList.toggle("active", isTable);
}
```
CSS 追記（`.cmp-etf`/`.cmp-cur`/`.cmp-note` 軽微・detail.css）:
```css
.cmp-etf { color: #ffca3a; font-size: 10px; } .cmp-cur { color: #9fb9cc; } .cmp-note { font: 11px var(--ix-mono,monospace); color: #9fb9cc; margin: 6px 0; }
```

- [ ] **Step 2: Wire re-render + default tab reset**

`openCompareModal` の末尾で `setCompareTab("chart")`（開くたびチャート既定）を呼ぶ。`addToCompare`/`removeFromCompare` の末尾で「テーブルが表示中なら `renderCompareTable(compareSet)`」を呼ぶ（`document.getElementById("compare-table-container").style.display !== "none"` 判定）。

- [ ] **Step 3: Expose**

`detail.js` window ブロックに `window.renderCompareTable = renderCompareTable; window.setCompareTab = setCompareTab;` を追加。

- [ ] **Step 4: Playwright verify**

`scratchpad/task9-comparetable-verify.js`：詳細→比較モーダル開く→「指標比較」タブ→テーブル可視・ヘッダ8列・行数=compareSet・ETF追加で N/A セル・? 注入・pageerror0・タブ往復で二重描画なし。

- [ ] **Step 5: Commit**

```bash
git add detail.js detail.css scratchpad/task9-comparetable-verify.js
git commit -m "feat(compare-table): renderCompareTable + tab switch wired (netMargin first, ETF N/A)"
```

---

## Task 10: ③ ランキングビュー — ルート + markup + 入口

**Files:**
- Modify: `index.html`（VIEW_IDS + `#ranking-view` + `navigateToRanking` + 入口ボタン + Object.assign）

**Interfaces:**
- Produces: view `#ranking-view`、`navigateToRanking()`（window 公開）、`showView("ranking")` 経路。

- [ ] **Step 1: Register view + markup**

`index.html` の `VIEW_IDS` に `ranking: "ranking-view"` 追加。他 view-section の兄弟として:
```html
<div id="ranking-view" class="view-section">
  <div class="ranking-head">
    <button class="rk-back" onclick="navigateToPortal()">← 一覧へ</button>
    <h2 class="ranking-title" data-term="同市場比較">相対ランキング</h2>
    <div class="rk-controls">
      <span class="rk-market"><button class="rk-mkt active" id="rk-mkt-JP" onclick="setRankMarket('JP')">日本株</button>
      <button class="rk-mkt" id="rk-mkt-US" onclick="setRankMarket('US')">米国株</button></span>
      <select id="rk-metric" onchange="renderRanking()"></select>
    </div>
  </div>
  <div class="ranking-body">
    <div id="rk-scatter-wrap"><canvas id="rk-scatter"></canvas></div>
    <div id="rk-sector-strip"></div>
    <div id="rk-table"></div>
  </div>
  <div class="panel-disclaimer" id="rk-disclaimer"></div>
</div>
```

- [ ] **Step 2: navigateToRanking + expose**

inline に追加:
```js
function navigateToRanking() { showView("ranking"); if (typeof renderRanking === "function") renderRanking(); }
```
`Object.assign(window, { … })` に `navigateToRanking, setRankMarket, renderRanking` を追加（`setRankMarket`/`renderRanking` は Task 11/12 で定義。定義前に公開名だけ足しておくと参照時 undefined になるため、**Task 11 完了時にまとめて追加**でもよい。ここでは `navigateToRanking` のみ追加し、残り2つは Task 11 で追加）。

- [ ] **Step 3: Entry button**

ポータルの `#screening-toggle` 付近に:
```html
<button id="ranking-entry" onclick="navigateToRanking()">▤ ランキング</button>
```

- [ ] **Step 4: Smoke**

mock server で ▤ランキング クリック→ `#ranking-view` が active（他 view 非表示）・戻るで portal。空でも pageerror0。

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(ranking): register #ranking-view + navigateToRanking + entry button"
```

---

## Task 11: ③ ランキング表 + 市場/指標UI

**Files:**
- Modify: `index.html`（inline: `setRankMarket` / `renderRanking` の表部分 / metric select 初期化 / 公開追加）
- Modify: `detail.css`（ranking スタイル）

**Interfaces:**
- Consumes: `CrossSection.buildUniverse/rankByMetric`, `STOCK_DATA`, `getSectorColor`, `navigateToDetail`.
- Produces: `setRankMarket(m)`, `renderRanking()`（表・帯は Task 12 で追加）。

- [ ] **Step 1: Implement state + select init + table render**

inline:
```js
var rankMarket = "JP", rankMetric = "per";
function _initRankMetricSelect() {
  var sel = document.getElementById("rk-metric");
  if (!sel || sel.options.length) return;
  (window.CrossSection.METRIC_REGISTRY).forEach(function (m) {
    var o = document.createElement("option"); o.value = m.key; o.textContent = m.label; sel.appendChild(o);
  });
  sel.value = rankMetric;
}
function setRankMarket(m) {
  rankMarket = m;
  document.getElementById("rk-mkt-JP").classList.toggle("active", m === "JP");
  document.getElementById("rk-mkt-US").classList.toggle("active", m === "US");
  renderRanking();
}
function renderRanking() {
  var CS = window.CrossSection; if (!CS || !STOCK_DATA) return;
  _initRankMetricSelect();
  rankMetric = document.getElementById("rk-metric").value || rankMetric;
  var u = CS.buildUniverse(STOCK_DATA);
  var rows = CS.rankByMetric(u, rankMarket, rankMetric);
  var host = document.getElementById("rk-table");
  host.innerHTML = '<table class="rk-tbl"><thead><tr><th>#</th><th>銘柄</th><th>業種</th><th>値</th><th>順位(%)</th></tr></thead><tbody>' +
    rows.map(function (r) {
      var col = (typeof getSectorColor === "function") ? getSectorColor(r.industry) : "#62f0ff";
      return '<tr onclick="navigateToDetail(\'' + esc(r.ticker) + '\')">' +
        '<td>' + r.rank + '</td>' +
        '<td><span class="rk-dot" style="background:' + esc(col) + '"></span>' + esc(r.name) + '</td>' +
        '<td class="rk-sec">' + esc(r.industry) + '</td>' +
        '<td class="rk-val">' + esc(r.format) + '</td>' +
        '<td>' + Math.round(r.percentile) + '</td></tr>';
    }).join("") + '</tbody></table>';
  var disc = (window.DetailRules && DetailRules.ANALYSIS_DISCLAIMER) || "";
  document.getElementById("rk-disclaimer").textContent = disc;
  renderRankScatterAndStrip(u); // Task 12
}
```
（`renderRankScatterAndStrip` は Task 12 で定義。Task 11 時点では空関数 `function renderRankScatterAndStrip(){}` を先に置く＝表単独で動く。）

- [ ] **Step 2: Styles**（detail.css）

```css
#ranking-view .ranking-head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin-bottom: 12px; }
.rk-controls { display: flex; gap: 10px; align-items: center; margin-left: auto; }
.rk-mkt, .rk-back, #ranking-entry { font: 12px var(--ix-mono,monospace); color: #9fb9cc; background: transparent;
  border: 1px solid rgba(98,240,255,.25); border-radius: 3px; padding: 5px 12px; cursor: pointer; }
.rk-mkt.active { color: var(--c-cyan,#62f0ff); border-color: var(--c-cyan,#62f0ff); box-shadow: 0 0 8px rgba(98,240,255,.3); }
#rk-metric { font: 12px var(--ix-mono,monospace); color: #cfe8ff; background: #0a1420; border: 1px solid rgba(98,240,255,.3); border-radius: 3px; padding: 4px 8px; }
.rk-tbl { width: 100%; border-collapse: collapse; font: 12px var(--ix-mono,monospace); }
.rk-tbl th, .rk-tbl td { padding: 6px 8px; border-bottom: 1px solid rgba(98,240,255,.10); text-align: right; }
.rk-tbl th:nth-child(2), .rk-tbl td:nth-child(2), .rk-tbl th:nth-child(3), .rk-tbl td:nth-child(3) { text-align: left; }
.rk-tbl tbody tr { cursor: pointer; } .rk-tbl tbody tr:hover { background: rgba(98,240,255,.06); }
.rk-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 6px; }
.rk-sec { color: #9fb9cc; } .rk-val { color: #fff; }
```

- [ ] **Step 3: Expose**

`Object.assign(window, { … })` に `setRankMarket, renderRanking` を追加。

- [ ] **Step 4: Playwright verify**

`scratchpad/task11-ranking-verify.js`：▤ランキング→表描画（行数>0・JP既定）→市場US切替で行変化→指標切替（例 roe）で並び変化→行クリックで詳細遷移→pageerror0・禁止語彙0。

- [ ] **Step 5: Commit**

```bash
git add index.html detail.css scratchpad/task11-ranking-verify.js
git commit -m "feat(ranking): market/metric controls + ranking table (sector color, drill to detail)"
```

---

## Task 12: ③ 散布図（Chart.js・0x0罠）+ データ駆動セクター帯

**Files:**
- Modify: `index.html`（inline: `renderRankScatterAndStrip` 実装で空関数置換）
- Modify: `detail.css`（scatter/strip）

**Interfaces:**
- Consumes: `CrossSection.scatterPoints/sectorMedians`, `Chart`（版固定済）, `getSectorColor`.
- Produces: `renderRankScatterAndStrip(universe)`。

- [ ] **Step 1: Implement（破棄先行 + 0x0罠回避）**

空関数を置換:
```js
var _rkScatter = null;
function renderRankScatterAndStrip(u) {
  var CS = window.CrossSection;
  // --- セクター帯（データ駆動・N>=3、残りその他） ---
  var sm = CS.sectorMedians(u, rankMarket, rankMetric, { minN: 3 });
  var m = CS.METRIC_BY_KEY[rankMetric];
  var strip = document.getElementById("rk-sector-strip");
  strip.innerHTML = '<div class="rk-strip-title">セクター中央値（' + esc(m.label) + '・N≥3）</div>' +
    '<div class="rk-strip">' + sm.map(function (s) {
      var col = (s.sector === "その他") ? "#7d93a5" : ((typeof getSectorColor === "function") ? getSectorColor(s.sector) : "#62f0ff");
      var fmt = (m.unit === "%") ? (s.median.toFixed(1) + "%") : (m.unit === "倍" ? s.median.toFixed(1) + "倍" : Math.round(s.median));
      return '<div class="rk-cell"><span class="rk-dot" style="background:' + esc(col) + '"></span>' +
        '<span class="rk-cell-sec">' + esc(s.sector) + '</span><span class="rk-cell-n">n' + s.n + '</span>' +
        '<span class="rk-cell-med">' + esc(fmt) + '</span></div>';
    }).join("") + '</div>';
  // --- 散布図（x=PER, y=ROE 既定・両軸欠測除外・中央値クロスヘア） ---
  var xKey = "per", yKey = "roe";
  var sp = CS.scatterPoints(u, rankMarket, xKey, yKey);
  var canvas = document.getElementById("rk-scatter");
  if (!canvas || typeof Chart === "undefined") return;
  if (_rkScatter) { _rkScatter.destroy(); _rkScatter = null; }   // 破棄先行（再入の二重生成防止）
  // 0x0罠回避：view が active になってから rAF で生成
  requestAnimationFrame(function () {
    if (!canvas.clientWidth) return; // 非表示なら生成しない（0x0固定回避）
    var ctx = canvas.getContext("2d");
    _rkScatter = new Chart(ctx, {
      type: "scatter",
      data: { datasets: [{
        label: sp.xLabel + " × " + sp.yLabel,
        data: sp.points.map(function (p) { return { x: p.x, y: p.y, _t: p.ticker, _n: p.name }; }),
        pointBackgroundColor: sp.points.map(function (p) { return (typeof getSectorColor === "function") ? getSectorColor(p.industry) : "#62f0ff"; }),
        pointRadius: 5, pointHoverRadius: 7,
      }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { x: { title: { display: true, text: sp.xLabel }, ticks: { color: "#9fb9cc" }, grid: { color: "rgba(98,240,255,.08)" } },
                  y: { title: { display: true, text: sp.yLabel }, ticks: { color: "#9fb9cc" }, grid: { color: "rgba(98,240,255,.08)" } } },
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: function (c) { var d = c.raw; return d._n + "  " + sp.xLabel + ":" + d.x + " / " + sp.yLabel + ":" + d.y; } } } },
      },
    });
  });
}
```

- [ ] **Step 2: Styles**（detail.css）

```css
#rk-scatter-wrap { position: relative; height: 340px; margin-bottom: 14px; }
.rk-strip-title { font: 600 12px var(--ix-mono,monospace); color: var(--c-cyan,#62f0ff); margin: 8px 0 6px; }
.rk-strip { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
.rk-cell { display: flex; align-items: center; gap: 6px; font: 11px var(--ix-mono,monospace); color: #cfe8ff;
  border: 1px solid rgba(98,240,255,.18); border-radius: 3px; padding: 4px 8px; }
.rk-cell-sec { color: #cfe8ff; } .rk-cell-n { color: #7d93a5; } .rk-cell-med { color: #fff; }
```

- [ ] **Step 3: 0x0罠 note**

散布図は `#ranking-view` を active 化した後（`navigateToRanking`→`renderRanking`→`renderRankScatterAndStrip`）に描く。`requestAnimationFrame`＋`clientWidth` ガードで寸法0生成を回避。市場/指標切替のたび `destroy()` 先行で再生成。

- [ ] **Step 4: Playwright verify**

`scratchpad/task12-scatter-verify.js`：ランキング表示→ canvas 実サイズ>0・Chart インスタンス生成・セクター帯セル存在（「その他」含む）→市場/指標切替で再描画（例外なし・二重生成なし）→pageerror0。

- [ ] **Step 5: Commit**

```bash
git add index.html detail.css scratchpad/task12-scatter-verify.js
git commit -m "feat(ranking): value×quality scatter (Chart.js, 0x0-safe) + data-driven sector strip"
```

---

## Task 13: 統合検証・ハードニング

**Files:**
- Test/verify のみ（コード修正は検証で出た確定分だけ）

- [ ] **Step 1: 単体・全緑**

Run: `node --test tests/`（cross-section-rules / detail-rules / finance-rules / money-rules 全 PASS）。

- [ ] **Step 2: スナップショット再突合（ranking 追加を反映）**

`scratchpad/f2-snapshot.js` の対象に `#ranking-view` 経路を追加（portal/detail/money + ranking の DOM/canvas/公開typeof/pageerror）。baseline 再取得 → 変更後 capture → `compare` で `✅ MATCH`（新規カード/ビューは意図した差分としてハーネス側 baseline を更新）。
Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/f2-snapshot.js capture` → 変更適用済のため diff は新 UI のみ。公開面（`Object.assign` + detail.js window）に `navigateToRanking/setRankMarket/renderRanking/renderRelativePosition/renderCompareTable/setCompareTab` が bare typeof で存在。

- [ ] **Step 3: 統合スモーク（3面同時）**

`scratchpad/task13-bundleB-smoke.js`：1セッションで ①詳細の相対カード（equity可視/ETF非表示）②比較モーダルのタブ→テーブル ③ランキング（表/散布図/帯・市場/指標切替）を通し、`pageerror` 0・禁止語彙（買い/売り/推奨/上がる/下がる/割安なので）0・免責が3面に存在。

- [ ] **Step 4: 敵対検証ワークフロー（各機能 refute）**

ultracode workflow で3面を並列に敵対検証（4観点×refute）：
- **規制安全語彙**：descriptor/DOM に売買/予測語が混入しないか（閉集合逸脱）。
- **モジュール境界**：cross-section-rules が money-rules/advice を import していないか・facts に流出しないか・逆依存(detail-rules→cross-section)がないか。
- **null/小N正当性**：per/pbr/marketCap の0欠測・ETF除外・minN「その他」集約・空市場。
- **0x0罠/lifecycle**：散布図の破棄先行・clientWidth ガード・再入二重生成。
confirmed のみ反映（HIGH/MED 0 を目標・出たら該当タスクに戻って修正→再検証）。

- [ ] **Step 5: 最終コミット**

```bash
git add scratchpad/f2-snapshot.js scratchpad/task13-bundleB-smoke.js
git commit -m "test(bundleB): integration smoke + snapshot rebaseline (relpos/compare-table/ranking)"
```

---

## Self-Review 結果（plan著者チェック）

- **Spec coverage**：①相対カード=Task6-7／②比較テーブル=Task8-9／③ランキング&散布図&セクター帯=Task10-12／共有コア=Task1-4／配線・グロッサリ=Task5／教育フレーム(免責・?・中立語)=各描画Task+Task5／検証=Task13。spec §2-9 を網羅。
- **Placeholder scan**：純関数は完全コード。DOM は実 markup/描画コードを記載。Task10 で `renderRanking` を「空関数先置き→Task12で実装」と明示（前方参照の穴を回避）。Task11 は表単独で動く（scatter は空関数）。
- **Type consistency**：`buildUniverse`→`{market:{_members,[key]:[]}}` を peerStats/rankByMetric/scatterPoints/sectorMedians が一貫消費。`relativePosition` の group/metric 形状を renderRelativePosition が一致参照。`compareMetricsRows` の cells 形状を renderCompareTable が一致参照。公開名（navigateToRanking/setRankMarket/renderRanking/renderRelativePosition/renderCompareTable/setCompareTab）は定義Taskと公開Taskで一致。

## 実装ガードレール（既存規律）
- 新カード/ビューは**固定id静的コンテナ**（insert しない冪等）。detail を触ったら分離規律（純計算=cross-section-rules/描画=detail.js|inline）。
- **currentTicker/currentView は生束縛**（window 値コピー禁止）。
- 実装は **worktree 分離**（`EnterWorktree` name=bundleB-relative-view）＝共有ファイル(index.html/detail.js/detail.css)大改修ゆえ他 session と直列化。統合は `ExitWorktree`→main merge→本人サニティ→push→本番curl。
- **本番反映は push≠反映**：`vercel inspect --logs | grep Commit` + 本番 curl で実コミット確認。
