# W1.5 セクターヒートマップ（市場の温度感） Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ポータル一覧の上に「市場の温度感」パネルを追加する。日本株／米国株の2カラムで13大分類のタイルを並べ、クリックでその大分類の銘柄タイルを展開する。

**Architecture:** 完全にフロント完結。`api/market/list` が既に返している `industry` / `marketCap` / `currency` / `px` だけを使い、54業種→13大分類の写像と集計を `portal-price-rules.js`（UMD・DOM 非依存の純関数）に置き、描画は `index.html` の inline スクリプトが持つ。母集合は W1 の発掘ストリップと同じ `lastPortalList`（表と同じフィルタ後）。

**Tech Stack:** Vanilla JS（UMD 純関数レイヤ ＋ index.html inline）／CSS Grid ／node:test ／playwright（構造スモーク）

**Spec:** `docs/superpowers/specs/2026-08-23-w15-sector-heatmap-design.md`

## Global Constraints

- **API / DB / ETL を一切変更しない**。`api/`・`scripts/`・`db/` に触れない。新 Vercel 関数ゼロ（現在 11/12）。
- **payload を増やさない**。使ってよいのは list が既に返す `industry` / `marketCap` / `currency` / `country` / `type` / `px` のみ。
- 数値計算は `portal-price-rules.js` の純関数に集約する。`index.html` 側は整形と描画だけ。**JS↔Py 鏡像パリティは新設しない**（サーバ側に同じ計算を置かないため）。
- **`.portal-table` の nth-child 依存に触らない**（W1 で踏んだ地雷）。ヒートマップは独立クラス `w15-*` で完結させる。
- **`position:sticky` の th を持つ表に `overflow:hidden` を付けない**（W1 で踏んだ地雷）。
- **指示的文言（買い/売り/推奨/狙い目）を使わない**。ヒートマップパネルには免責文を置かない（直下のストリップ末尾の免責1つが両パネルをカバーする＝spec §9）。
- 大分類の並びは `SECTOR_ORDER` 固定。社数順にしない。
- テストコマンドは `node --test tests/*.test.js`（現在 370 pass）。`pytest` は不変（236 pass）。

---

### Task 1: 54業種→13大分類の写像（`sectorOf`）

**Files:**
- Modify: `portal-price-rules.js`（`return {…}` の直前に追加・export に追記）
- Test: `tests/portal-price-rules.test.js`（末尾に追記）

**Interfaces:**
- Consumes: なし（このタスクが最初）
- Produces: `PortalPriceRules.SECTOR_MAP`（object）/ `PortalPriceRules.SECTOR_ORDER`（string[]）/ `PortalPriceRules.sectorOf(industry: string, isEtf: boolean) -> string`

- [ ] **Step 1: Write the failing test**

`tests/portal-price-rules.test.js` の末尾に追記：

```js
const fs = require("node:fs");
const path = require("node:path");

test("sectorOf: 代表的な業種が大分類へ落ちる", () => {
  assert.equal(R.sectorOf("US - 半導体・AI", false), "テクノロジー");
  assert.equal(R.sectorOf("電機・インフラIT", false), "テクノロジー");
  assert.equal(R.sectorOf("情報通信・巨大投資", false), "テクノロジー");   // dump 側にだけある業種
  assert.equal(R.sectorOf("証券・金融サービス", false), "金融");
  assert.equal(R.sectorOf("US - REIT・不動産", false), "不動産");
  assert.equal(R.sectorOf("総合商社", false), "素材");
});

test("sectorOf: ETF 判定が最優先・未知業種は その他", () => {
  assert.equal(R.sectorOf("US - テクノロジー", true), "ETF");   // isEtf が industry に勝つ
  assert.equal(R.sectorOf("国内ETF - TOPIX", false), "ETF");    // industry に ETF を含む
  assert.equal(R.sectorOf("宇宙開発", false), "その他");
  assert.equal(R.sectorOf(null, false), "その他");
  assert.equal(R.sectorOf(undefined, false), "その他");
});

test("SECTOR_ORDER: 全ての写像先を含み、重複が無い", () => {
  const targets = new Set(Object.values(R.SECTOR_MAP));
  targets.add("ETF"); targets.add("その他");
  for (const t of targets) assert.ok(R.SECTOR_ORDER.includes(t), `${t} が SECTOR_ORDER に無い`);
  assert.equal(new Set(R.SECTOR_ORDER).size, R.SECTOR_ORDER.length);
});

test("SECTOR_MAP: 現ユニバースの全業種が写像に載っている（マップ漏れ検知）", () => {
  // ⚠ universe.csv は CRLF。split("\n") だと最終列に \r が残り type 判定が全行 false になる。
  const lines = fs.readFileSync(path.join(__dirname, "..", "data", "universe.csv"), "utf8").trim().split(/\r?\n/);
  const unmapped = new Set();
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const industry = cols.slice(-4)[0];              // 末尾から: industry,currency,country,type
    const isEtf = cols[cols.length - 1] === "etf";   // 社名にカンマが入っても壊れない読み方
    if (R.sectorOf(industry, isEtf) === "その他") unmapped.add(industry);
  }
  assert.deepEqual([...unmapped], [], "写像に無い業種がある＝SECTOR_MAP に追記が必要");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/portal-price-rules.test.js`
Expected: FAIL（`R.sectorOf is not a function` / `Object.values(undefined)`）

- [ ] **Step 3: Write minimal implementation**

`portal-price-rules.js` の `function clampPos(...)` の直後、`return {` の直前に追加：

```js
  // ── W1.5 セクターヒートマップ：54業種 → 13大分類の写像（spec §3）──
  // ⚠ 手作りの表。ユニバース拡張で未知業種が来ても "その他" に落ちて壊れない。
  //    現ユニバースに "その他" 落ちが無いことは tests/portal-price-rules.test.js が検知する。
  var SECTOR_MAP = {
    "US - テクノロジー": "テクノロジー", "US - クラウド・SaaS": "テクノロジー", "US - 半導体・AI": "テクノロジー",
    "US - SNS・AI": "テクノロジー", "US - EC・クラウド": "テクノロジー", "US - 広告・クラウド": "テクノロジー",
    "US - 決済・フィンテック": "テクノロジー",
    "電気機器・半導体": "テクノロジー", "精密機器・半導体": "テクノロジー", "電機・ITサービス": "テクノロジー",
    "電機・インフラIT": "テクノロジー", "テクノロジー・家電": "テクノロジー", "情報通信": "テクノロジー",
    "情報通信・巨大投資": "テクノロジー",
    "US - 銀行・金融": "金融", "US - 保険": "金融", "US - 証券・資産運用": "金融",
    "銀行・金融": "金融", "保険": "金融", "証券・金融サービス": "金融",
    "US - 医薬品・バイオ": "ヘルスケア", "医薬品・バイオ": "ヘルスケア",
    "US - 資本財・防衛": "資本財", "重工・防衛": "資本財", "産業用ロボット": "資本財", "空調・産業機器": "資本財",
    "US - 小売・流通": "一般消費財", "US - 飲食・外食": "一般消費財", "US - 自動車": "一般消費財",
    "US - 電気自動車・エネルギー": "一般消費財", "US - エンターテインメント": "一般消費財",
    "小売業": "一般消費財", "自動車・輸送機器": "一般消費財", "自動車部品・電装": "一般消費財",
    "エンターテインメント": "一般消費財",
    "US - 生活必需品": "生活必需品", "食品・飲料": "生活必需品",
    "US - 素材・化学": "素材", "化学・素材": "素材", "総合商社": "素材",
    "US - エネルギー": "エネルギー",
    "US - 公益事業": "公益", "電力・ガス": "公益",
    "US - 通信": "通信",
    "US - REIT・不動産": "不動産", "不動産": "不動産",
    "US - 運輸・物流": "運輸", "運輸・インフラ": "運輸",
  };

  // 面の並び順は意味で固定する（社数順にすると検索/フィルタのたびに並びが踊る）。
  var SECTOR_ORDER = ["テクノロジー", "金融", "ヘルスケア", "一般消費財", "生活必需品", "資本財",
    "素材", "エネルギー", "公益", "通信", "不動産", "運輸", "ETF", "その他"];

  function sectorOf(industry, isEtf) {
    if (isEtf === true) return "ETF";
    var ind = String(industry == null ? "" : industry);
    if (ind.indexOf("ETF") !== -1) return "ETF";
    return SECTOR_MAP[ind] || "その他";
  }
```

同ファイル末尾の `return {` に追記：

```js
    SECTOR_MAP: SECTOR_MAP, SECTOR_ORDER: SECTOR_ORDER, sectorOf: sectorOf,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/portal-price-rules.test.js`
Expected: PASS（新規4件を含め全件緑）

- [ ] **Step 5: Commit**

```bash
git add portal-price-rules.js tests/portal-price-rules.test.js
git commit -m "feat(w15): 54業種→13大分類の写像 sectorOf を rules 層に追加"
```

---

### Task 2: 指標定義と色段（`HEAT_METRICS` / `heatValue` / `heatStep`）

**Files:**
- Modify: `portal-price-rules.js`
- Test: `tests/portal-price-rules.test.js`

**Interfaces:**
- Consumes: Task 1 の `_fin`（既存の内部ヘルパ）
- Produces:
  - `PortalPriceRules.HEAT_METRICS: Array<{key,label,field,center,span,digits,unit,signed,note}>`
  - `PortalPriceRules.heatMetric(key: string) -> metric`（未知キーは先頭 `c1` へフォールバック）
  - `PortalPriceRules.heatValue(px: object|null, metricKey: string) -> number|null`
  - `PortalPriceRules.heatStep(v: number|null, metricKey: string) -> {i: number, up: boolean}|null`（`i === -1` が中立、`i` は 0..4）

- [ ] **Step 1: Write the failing test**

```js
test("HEAT_METRICS: 3指標・キーとフォールバック", () => {
  assert.deepEqual(R.HEAT_METRICS.map((m) => m.key), ["c1", "c5", "pos52"]);
  assert.equal(R.heatMetric("pos52").center, 50);
  assert.equal(R.heatMetric("c5").span, 6);
  assert.equal(R.heatMetric("知らないキー").key, "c1");   // 未知キーは既定へ
});

test("heatValue: 指標の取り出し・欠損は null", () => {
  assert.equal(R.heatValue(px({ c1: 1.5 }), "c1"), 1.5);
  assert.equal(R.heatValue(px({ pos52: 62 }), "pos52"), 62);
  assert.equal(R.heatValue(px({ c5: null }), "c5"), null);
  assert.equal(R.heatValue(null, "c1"), null);
  assert.equal(R.heatValue(px({ c1: NaN }), "c1"), null);
});

test("heatStep: 中立帯・段・振り切り・null", () => {
  assert.equal(R.heatStep(null, "c1"), null);
  assert.deepEqual(R.heatStep(0, "c1"), { i: -1, up: true });        // 中立（|d| < 0.06）
  assert.deepEqual(R.heatStep(0.15, "c1"), { i: -1, up: true });     // 0.15/3 = 0.05 → 中立
  assert.deepEqual(R.heatStep(0.5, "c1"), { i: 0, up: true });       // 0.167 → 第1段
  assert.deepEqual(R.heatStep(-3, "c1"), { i: 4, up: false });       // 振り切り（下）
  assert.deepEqual(R.heatStep(99, "c1"), { i: 4, up: true });        // 範囲外でも最上段に丸める
  assert.deepEqual(R.heatStep(50, "pos52"), { i: -1, up: true });    // pos52 は 50 が中立
  assert.deepEqual(R.heatStep(100, "pos52"), { i: 4, up: true });
  assert.deepEqual(R.heatStep(0, "pos52"), { i: 4, up: false });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/portal-price-rules.test.js`
Expected: FAIL（`R.HEAT_METRICS is undefined`）

- [ ] **Step 3: Write minimal implementation**

`sectorOf` の直後に追加：

```js
  // ── W1.5 指標と色段（spec §4）──
  // dh（52週高値からの距離）は片側にしか振れないので発散スケールに載せない＝pos52 を採る。
  var HEAT_METRICS = [
    { key: "c1", label: "1日", field: "c1", center: 0, span: 3, digits: 2, unit: "%", signed: true,
      note: "前日比（±3%で振り切り）" },
    { key: "c5", label: "5日", field: "c5", center: 0, span: 6, digits: 2, unit: "%", signed: true,
      note: "5営業日騰落（±6%で振り切り）" },
    { key: "pos52", label: "52週位置", field: "pos52", center: 50, span: 50, digits: 0, unit: "", signed: false,
      note: "52週レンジ内の位置（0=安値 / 100=高値）" },
  ];
  var HEAT_METRIC_BY_KEY = {};
  HEAT_METRICS.forEach(function (m) { HEAT_METRIC_BY_KEY[m.key] = m; });
  function heatMetric(key) { return HEAT_METRIC_BY_KEY[key] || HEAT_METRICS[0]; }

  function heatValue(px, metricKey) {
    if (!px) return null;
    var v = px[heatMetric(metricKey).field];
    return _fin(v) ? v : null;
  }

  // 塗りと文字色の唯一の根拠。i=-1 が中立、0..4 が段（外側ほど濃い）。
  var HEAT_STEPS = [0.20, 0.42, 0.62, 0.82, 1.0];
  var HEAT_NEUTRAL_BAND = 0.06;
  function heatStep(v, metricKey) {
    if (!_fin(v)) return null;
    var m = heatMetric(metricKey);
    var d = (v - m.center) / m.span;
    var t = Math.min(1, Math.abs(d));
    if (t < HEAT_NEUTRAL_BAND) return { i: -1, up: d >= 0 };
    for (var i = 0; i < HEAT_STEPS.length; i++) {
      if (t <= HEAT_STEPS[i]) return { i: i, up: d >= 0 };
    }
    return { i: HEAT_STEPS.length - 1, up: d >= 0 };
  }
```

export に追記：

```js
    HEAT_METRICS: HEAT_METRICS, heatMetric: heatMetric, heatValue: heatValue,
    HEAT_STEPS: HEAT_STEPS, heatStep: heatStep,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/portal-price-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add portal-price-rules.js tests/portal-price-rules.test.js
git commit -m "feat(w15): ヒートマップの指標定義と発散スケールの色段を追加"
```

---

### Task 3: 集計（`heatAggregate` / `groupBySector`）

**Files:**
- Modify: `portal-price-rules.js`
- Test: `tests/portal-price-rules.test.js`

**Interfaces:**
- Consumes: Task 1 `sectorOf` / `SECTOR_ORDER`、Task 2 `heatValue` / `heatMetric`
- Produces:
  - `PortalPriceRules.heatAggregate(items, metricKey, weighted) -> {v, n, withPx, up, down, cap}`
    - `items` の各要素は `{px, marketCap, industry, isEtf}` を持つ（`filterAndRenderPortal` の item そのまま）
    - `v` は平均値（対象ゼロなら `null`）、`n` は件数、`withPx` は指標値を持つ件数
  - `PortalPriceRules.groupBySector(items, metricKey, weighted) -> Array<agg & {key: string, items: Array}>`
    - `SECTOR_ORDER` 順、要素ゼロの大分類は落とす

- [ ] **Step 1: Write the failing test**

```js
function hit(industry, v, cap, extra) {
  return Object.assign({ industry: industry, isEtf: false, marketCap: cap,
    px: px({ c1: v, pos52: v }) }, extra || {});
}

test("heatAggregate: 単純平均・加重平均・cap=0 のフォールバック", () => {
  const items = [hit("銀行・金融", 1, 100), hit("保険", 3, 300)];
  assert.equal(R.heatAggregate(items, "c1", false).v, 2);              // (1+3)/2
  assert.equal(R.heatAggregate(items, "c1", true).v, 2.5);             // (1*100+3*300)/400
  const noCap = [hit("銀行・金融", 1, 0), hit("保険", 3, 0)];
  assert.equal(R.heatAggregate(noCap, "c1", true).v, 2);               // Σcap=0 → 単純平均へ
});

test("heatAggregate: px 欠損の除外・up/down・同値はどちらにも数えない", () => {
  const items = [hit("保険", 2, 10), hit("保険", -2, 10),
    Object.assign(hit("保険", 0, 10), { px: null }), hit("保険", 0, 10)];
  const a = R.heatAggregate(items, "c1", false);
  assert.equal(a.n, 4);            // 件数は px 無しも含む
  assert.equal(a.withPx, 3);       // 平均の母数は 3
  assert.equal(a.up, 1);
  assert.equal(a.down, 1);         // 0 は中央値と同値＝どちらにも数えない
  assert.equal(a.v, 0);            // (2 + -2 + 0)/3
});

test("heatAggregate: 対象ゼロなら v=null", () => {
  const a = R.heatAggregate([Object.assign(hit("保険", 0, 10), { px: null })], "c1", false);
  assert.equal(a.v, null);
  assert.equal(a.withPx, 0);
});

test("groupBySector: SECTOR_ORDER 順・空の大分類は落とす・ETF は別枠", () => {
  const items = [hit("US - 銀行・金融", 1, 10), hit("US - 半導体・AI", 2, 10),
    Object.assign(hit("国内ETF - TOPIX", 3, 0), { isEtf: true })];
  const g = R.groupBySector(items, "c1", false);
  assert.deepEqual(g.map((x) => x.key), ["テクノロジー", "金融", "ETF"]);   // 定義順であって社数順でない
  assert.equal(g[0].items.length, 1);
  assert.equal(g[1].v, 1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/portal-price-rules.test.js`
Expected: FAIL（`R.heatAggregate is not a function`）

- [ ] **Step 3: Write minimal implementation**

`heatStep` の直後に追加：

```js
  // items = filterAndRenderPortal の item（{px, marketCap, industry, isEtf, …}）。
  // ⚠ weighted は「同一通貨の集合」に対してのみ呼ぶこと。呼び出し側が市場カラム単位で
  //    groupBySector を呼ぶ設計なので、JP=円 / US=ドルの混在は構造的に起きない（spec §5）。
  function heatAggregate(items, metricKey, weighted) {
    var list = items || [], m = heatMetric(metricKey);
    var vals = [], caps = [], up = 0, down = 0, capSum = 0;
    list.forEach(function (it) {
      var v = heatValue(it && it.px, metricKey);
      if (v === null) return;
      var cap = (it && _fin(it.marketCap) && it.marketCap > 0) ? it.marketCap : 0;
      vals.push(v); caps.push(cap); capSum += cap;
      if (v > m.center) up++; else if (v < m.center) down++;
    });
    if (!vals.length) return { v: null, n: list.length, withPx: 0, up: 0, down: 0, cap: 0 };
    var v = 0;
    if (weighted && capSum > 0) {
      for (var i = 0; i < vals.length; i++) v += vals[i] * caps[i];
      v = v / capSum;
    } else {
      for (var j = 0; j < vals.length; j++) v += vals[j];
      v = v / vals.length;
    }
    return { v: v, n: list.length, withPx: vals.length, up: up, down: down, cap: capSum };
  }

  function groupBySector(items, metricKey, weighted) {
    var buckets = {};
    (items || []).forEach(function (it) {
      var key = sectorOf(it && it.industry, !!(it && it.isEtf));
      (buckets[key] = buckets[key] || []).push(it);
    });
    return SECTOR_ORDER.filter(function (k) { return buckets[k] && buckets[k].length; })
      .map(function (k) {
        var a = heatAggregate(buckets[k], metricKey, weighted);
        a.key = k; a.items = buckets[k];
        return a;
      });
  }
```

export に追記：

```js
    heatAggregate: heatAggregate, groupBySector: groupBySector,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/*.test.js`
Expected: PASS（既存 370 ＋ 新規分がすべて緑）

- [ ] **Step 5: Commit**

```bash
git add portal-price-rules.js tests/portal-price-rules.test.js
git commit -m "feat(w15): 大分類ごとの集計 heatAggregate/groupBySector を追加"
```

---

### Task 4: パネルの器（CSS ＋ DOM ＋ 第1層の2カラム描画）

**Files:**
- Modify: `index.html`
  - CSS: `#portal-strip { … }` のブロック（1020 行付近）の直前に `w15-*` を追加
  - markup: `<div id="portal-strip"></div>`（1248 行）の**直前**に `<div id="portal-heat"></div>`
  - script: `renderPortalStrip` の定義（2444 行付近）の**直前**に描画関数群
  - script: `renderPortalStrip(list)` の2つの呼び出し（2167 / 2175 行）の直前に `renderPortalHeatmap(list)`
- Test: 手動確認（描画は Task 7 の構造スモークでまとめて検証）

**Interfaces:**
- Consumes: Task 1-3 の `PortalPriceRules.{groupBySector, heatMetric, heatStep, HEAT_METRICS}`、既存の `esc` / `dataLoadState` / `DATA_PX_ERROR` / `DATA_MARKET_ASOF` / `lastPortalList`
- Produces: `renderPortalHeatmap(list)`（グローバル関数・IIFE 内）、状態変数 `heatMetricKey` / `heatWeighted` / `heatOpenSector`

- [ ] **Step 1: CSS を追加**

`index.html` の `#portal-strip { margin: 0 0 18px; }` の直前に挿入：

```css
      /* ── W1.5 セクターヒートマップ（市場の温度感）── */
      #portal-heat { margin: 0 0 18px; }
      #portal-heat:empty { display: none; }
      .w15-head { font-size: 12px; color: var(--ix-text-dim); margin: 0 0 8px; }
      .w15-head b { color: var(--ix-text); font-weight: 600; }
      .w15-panel { background: var(--ix-surface-panel); border: 1px solid var(--ix-border);
                   border-radius: 4px; padding: 14px 16px 12px; }
      .w15-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
      .w15-col > h4 { font-size: 12px; color: var(--ix-text-dim); margin: 0 0 8px;
                      letter-spacing: 0.08em; font-weight: 600; }
      .w15-col > h4 span { color: var(--ix-slate); font-weight: 400; letter-spacing: 0; }
      .w15-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(124px, 1fr)); gap: 6px; }
      .w15-tile { display: flex; flex-direction: column; gap: 2px; align-items: flex-start;
                  justify-content: center; min-height: 74px; padding: 9px 10px; border-radius: 4px;
                  cursor: pointer; border: 1px solid rgba(255, 255, 255, 0.06); font-family: inherit;
                  text-align: left; overflow: hidden; }
      .w15-tile:hover { outline: 1px solid var(--ix-cyan); outline-offset: -1px; }
      .w15-tile.open { outline: 2px solid var(--ix-cyan); outline-offset: -2px; }
      .w15-t-name { font-size: 12px; opacity: 0.92; white-space: nowrap; overflow: hidden;
                    text-overflow: ellipsis; max-width: 100%; }
      .w15-t-val { font-family: var(--ix-mono); font-size: 19px; font-weight: 700; line-height: 1.05; }
      .w15-t-sub { font-size: 11px; opacity: 0.78; display: flex; align-items: center; gap: 6px; }
      .w15-bar { display: inline-block; width: 42px; height: 4px; border-radius: 2px;
                 background: rgba(255, 80, 110, 0.55); overflow: hidden; }
      .w15-bar > i { display: block; height: 100%; background: rgba(0, 214, 110, 0.95); }
      .w15-empty { font-size: 12px; color: var(--ix-slate); padding: 8px 0; }
      .w15-legend { display: flex; align-items: center; gap: 3px; font-size: 11px;
                    color: var(--ix-text-dim); margin-top: 10px; flex-wrap: wrap; }
      .w15-legend i { width: 17px; height: 9px; border-radius: 1px; display: inline-block; }
      .w15-legend span { margin: 0 5px; }
      .w15-legend .w15-note { color: var(--ix-slate); }
      @media (max-width: 760px) {
        .w15-panel { padding: 12px 11px 10px; }
        .w15-cols { grid-template-columns: 1fr; }
        .w15-grid { grid-template-columns: repeat(auto-fill, minmax(104px, 1fr)); gap: 5px; }
        .w15-tile { min-height: 66px; padding: 8px; }
        .w15-t-val { font-size: 16px; }
      }
```

- [ ] **Step 2: markup を追加**

`<div id="portal-strip"></div>` の直前に1行足す（上から「温度感 → 今日の動き → 表」の順）：

```html
        <div id="portal-heat"></div>
        <div id="portal-strip"></div>
```

- [ ] **Step 3: 描画関数を追加**

`function renderPortalStrip(list) {` の直前に挿入：

```js
      // ── W1.5 セクターヒートマップ（市場の温度感・spec §6）──
      const HEAT_NEUTRAL_RGB = [35, 46, 56];    // パネルの地色に寄せた中立＝「動いていない業種は色がつかない」
      const HEAT_UP_RGB = [0, 200, 110];
      const HEAT_DOWN_RGB = [255, 70, 105];
      let heatMetricKey = localStorage.getItem("sip_heat_metric") || "c1";
      let heatWeighted = localStorage.getItem("sip_heat_weight") === "cap";
      let heatOpenSector = null;                // 展開中の大分類（保存しない＝毎回閉じた状態で始まる）

      function _heatMix(a, b, t) {
        return "rgb(" + Math.round(a[0] + (b[0] - a[0]) * t) + "," +
          Math.round(a[1] + (b[1] - a[1]) * t) + "," + Math.round(a[2] + (b[2] - a[2]) * t) + ")";
      }
      function _heatFill(v) {
        const s = PortalPriceRules.heatStep(v, heatMetricKey);
        if (!s) return "rgba(120,140,150,.10)";                       // 指標値なし
        if (s.i < 0) return _heatMix(HEAT_NEUTRAL_RGB, HEAT_NEUTRAL_RGB, 0);
        return _heatMix(HEAT_NEUTRAL_RGB, s.up ? HEAT_UP_RGB : HEAT_DOWN_RGB, PortalPriceRules.HEAT_STEPS[s.i]);
      }
      function _heatInk(v) {
        const s = PortalPriceRules.heatStep(v, heatMetricKey);
        return (s && s.i >= 3) ? "#06121a" : "#eaf6fb";               // 濃い上位2段は黒文字（可読性）
      }
      function _heatFmt(v) {
        const m = PortalPriceRules.heatMetric(heatMetricKey);
        if (v === null || v === undefined || !isFinite(v)) return "--";
        return m.signed ? PortalPriceRules.fmtSigned(v, m.digits, m.unit) : v.toFixed(m.digits);
      }
      function _heatTile(a) {
        const pct = (a.up + a.down) ? Math.round((a.up / (a.up + a.down)) * 100) : 0;
        return `<button type="button" class="w15-tile${heatOpenSector === a.key ? " open" : ""}"
            data-sec="${esc(a.key)}" style="background:${_heatFill(a.v)};color:${_heatInk(a.v)}"
            title="${esc(a.key)} ${a.n}社 ${_heatFmt(a.v)}">
            <span class="w15-t-name">${esc(a.key)}</span>
            <span class="w15-t-val">${_heatFmt(a.v)}</span>
            <span class="w15-t-sub">${a.n}社　<i class="w15-bar"><i style="width:${pct}%"></i></i></span>
          </button>`;
      }
      function _heatColumn(title, asofDate, items) {
        const aggs = PortalPriceRules.groupBySector(items, heatMetricKey, heatWeighted);
        const asof = asofDate ? `<span>${esc(asofDate.slice(5).replace("-", "/"))} 終値</span>` : "";
        const body = aggs.length
          ? `<div class="w15-grid">${aggs.map(_heatTile).join("")}</div>`
          : `<div class="w15-empty">該当する銘柄がありません</div>`;
        return `<div class="w15-col"><h4>${esc(title)}　${asof}</h4>${body}</div>`;
      }
      function _heatLegend() {
        const m = PortalPriceRules.heatMetric(heatMetricKey);
        const sw = [];
        for (let i = PortalPriceRules.HEAT_STEPS.length - 1; i >= 0; i--) {
          sw.push(`<i style="background:${_heatMix(HEAT_NEUTRAL_RGB, HEAT_DOWN_RGB, PortalPriceRules.HEAT_STEPS[i])}"></i>`);
        }
        sw.push(`<i style="background:${_heatMix(HEAT_NEUTRAL_RGB, HEAT_NEUTRAL_RGB, 0)}"></i>`);
        for (let j = 0; j < PortalPriceRules.HEAT_STEPS.length; j++) {
          sw.push(`<i style="background:${_heatMix(HEAT_NEUTRAL_RGB, HEAT_UP_RGB, PortalPriceRules.HEAT_STEPS[j])}"></i>`);
        }
        return `<div class="w15-legend"><span>${m.signed ? "下落" : "安値圏"}</span>${sw.join("")}
          <span>${m.signed ? "上昇" : "高値圏"}</span>
          <span class="w15-note">${esc(m.note)}　/　タイル下の細いバーは「その大分類のうち上昇した銘柄の割合」</span></div>`;
      }

      // list = 表と同じ母集合（filterAndRenderPortal が作った item 配列）。
      function renderPortalHeatmap(list) {
        const host = document.getElementById("portal-heat");
        if (!host) return;
        // 劣化（spec §7）: データ未取得・価格集計の失敗・0件ではパネルごと出さない。
        // ⚠ 免責文はこのパネルに置かない。直下のストリップ末尾の免責1つが両パネルをカバーする。
        if (dataLoadState !== "ready" || !(list || []).length) { host.innerHTML = ""; return; }
        if (typeof DATA_PX_ERROR !== "undefined" && DATA_PX_ERROR) { host.innerHTML = ""; return; }
        const items = (list || []).filter((it) => it.px);
        if (!items.length) { host.innerHTML = ""; return; }
        const asof = (typeof DATA_MARKET_ASOF !== "undefined" && DATA_MARKET_ASOF) || {};
        const m = PortalPriceRules.heatMetric(heatMetricKey);
        host.innerHTML = `
          <div class="w15-head">市場の温度感　<b>${esc(m.label)}</b>　/　${items.length}銘柄を13の大分類で（クリックで中の銘柄を展開）</div>
          <div class="w15-panel">
            <div class="w15-cols">
              ${_heatColumn("日本株", asof.JP, items.filter((it) => PortalPriceRules.marketOf(it.ticker, it) === "JP"))}
              ${_heatColumn("米国株", asof.US, items.filter((it) => PortalPriceRules.marketOf(it.ticker, it) === "US"))}
            </div>
            ${_heatLegend()}
          </div>`;
      }
```

- [ ] **Step 4: 呼び出しを結線**

`filterAndRenderPortal` 内の2箇所（0件パスと通常パス）で `renderPortalStrip(list)` の直前に足す：

```js
          renderPortalHeatmap(list);          // 0件では自分で消える
          renderPortalStrip(list);            // 0件でも見出し＋「該当なし」を出す
```

```js
        renderPortalHeatmap(list);
        renderPortalStrip(list);
```

- [ ] **Step 5: 実ブラウザで確認**

```bash
.venv/bin/python scratchpad/w15-mock-server.py
```

別ターミナルで `http://127.0.0.1:8215/` を開き、**日本株/米国株の2カラムにタイルが出ること**・各カラム見出しに終値日が出ること・凡例が出ること・**免責文が画面に1つだけ**であることを目視。

⚠ モック鯖はこの時点では `w15-variants.js` も注入する。**本実装の確認では切替バーの「案＝現行」を選ぶ**（モックのパネルと本実装のパネルが二重に出るため）。

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(w15): 市場の温度感パネル（2カラム・大分類タイル・凡例）を追加"
```

---

### Task 5: 第2層（展開）と委譲リスナー

**Files:**
- Modify: `index.html`（`renderPortalHeatmap` の直後に展開描画・`_initPortalStripDelegation` の直後に `_initPortalHeatDelegation`・2006 行付近の初期化に呼び出し追加）

**Interfaces:**
- Consumes: Task 4 の `renderPortalHeatmap` / `heatOpenSector`、既存の `navigateToDetail(ticker, el)` / `setSectorFilter(sector)` / `lastPortalList`
- Produces: `_heatExpansion(aggs)`（HTML 文字列）、`_initPortalHeatDelegation()`

- [ ] **Step 1: 展開の描画を追加**

`_heatLegend` の直後に挿入：

```js
      // 日本株はティッカーが数字で識別できないので社名を短縮（米国株はティッカーが通り名）。
      function _heatStockLabel(it) {
        if (String(it.ticker).indexOf(".T") === -1) return it.ticker;
        const n = String(it.name || "").replace(/(ホールディングス|グループ本社|グループ|株式会社|・|　| )/g, "");
        return n.slice(0, 4) || String(it.ticker).replace(".T", "");
      }
      function _heatExpansion(items) {
        if (!heatOpenSector) return "";
        const mine = items.filter((it) => PortalPriceRules.sectorOf(it.industry, !!it.isEtf) === heatOpenSector);
        if (!mine.length) return "";
        const byInd = {};
        mine.forEach((it) => { (byInd[it.industry] = byInd[it.industry] || []).push(it); });
        const blocks = Object.keys(byInd)
          .sort((a, b) => byInd[b].length - byInd[a].length)
          .map((ind) => {
            const g = byInd[ind].slice().sort((a, b) => {
              const x = PortalPriceRules.heatValue(a.px, heatMetricKey);
              const y = PortalPriceRules.heatValue(b.px, heatMetricKey);
              return (y === null ? -Infinity : y) - (x === null ? -Infinity : x);
            });
            const tiles = g.map((it) => {
              const v = PortalPriceRules.heatValue(it.px, heatMetricKey);
              return `<button type="button" class="w15-stock" data-ticker="${esc(it.ticker)}"
                  style="background:${_heatFill(v)};color:${_heatInk(v)}"
                  title="${esc(it.name)} ${esc(it.ticker)} ${_heatFmt(v)}">
                  <span class="w15-s-name">${esc(_heatStockLabel(it))}</span>
                  <span class="w15-s-val">${_heatFmt(v)}</span></button>`;
            }).join("");
            return `<div class="w15-ind">
                <div class="w15-ind-h" data-ind="${esc(ind)}">${esc(String(ind).replace("US - ", ""))}
                  <span>${g.length}社 ・ 表をこの業種に絞る</span></div>
                <div class="w15-stocks">${tiles}</div></div>`;
          }).join("");
        const a = PortalPriceRules.heatAggregate(mine, heatMetricKey, heatWeighted);
        return `<div class="w15-exp">
            <div class="w15-exp-h">${esc(heatOpenSector)}　<b>${_heatFmt(a.v)}</b>　${mine.length}社
              <button type="button" class="w15-close">閉じる ✕</button></div>
            ${blocks}</div>`;
      }
```

- [ ] **Step 2: `renderPortalHeatmap` に展開を差し込む**

`${_heatLegend()}` の直後に `${_heatExpansion(items)}` を足す：

```js
            ${_heatLegend()}
            ${_heatExpansion(items)}
          </div>`;
```

- [ ] **Step 3: 展開ぶんの CSS を追加**

Task 4 で足した CSS の `.w15-legend .w15-note { … }` の直後に挿入：

```css
      .w15-exp { margin-top: 12px; border-top: 1px solid var(--ix-border); padding-top: 11px; }
      .w15-exp-h { font-size: 13px; color: var(--ix-text); margin-bottom: 9px;
                   display: flex; align-items: center; }
      .w15-exp-h b { font-family: var(--ix-mono); margin: 0 4px; }
      .w15-close { margin-left: auto; font-size: 11px; padding: 5px 10px; min-height: 30px;
                   border-radius: 999px; background: transparent; border: 1px solid var(--ix-border-mid);
                   color: var(--ix-text-dim); cursor: pointer; font-family: inherit; }
      .w15-ind { margin-bottom: 10px; }
      .w15-ind-h { font-size: 12px; color: var(--ix-text-dim); margin-bottom: 4px; cursor: pointer; }
      .w15-ind-h:hover { color: var(--ix-cyan); }
      .w15-ind-h span { color: var(--ix-slate); font-size: 11px; }
      .w15-stocks { display: grid; grid-template-columns: repeat(auto-fill, minmax(66px, 1fr)); gap: 3px; }
      .w15-stock { border-radius: 3px; padding: 6px 3px; text-align: center; cursor: pointer;
                   border: 1px solid rgba(255, 255, 255, 0.05); font-family: inherit; display: block; }
      .w15-stock:hover { outline: 1px solid var(--ix-cyan); outline-offset: -1px; }
      .w15-s-name { display: block; font-family: var(--ix-mono); font-size: 12px; line-height: 1.15; }
      .w15-s-val { display: block; font-family: var(--ix-mono); font-size: 11px; opacity: 0.85; }
```

- [ ] **Step 4: 委譲リスナーを追加**

`_initPortalStripDelegation` 関数の直後に挿入（**inline onclick を作らない**＝W1 と同じ規約）：

```js
      // 委譲リスナー（1回だけ）。タイル→展開 / 銘柄→詳細 / 小分類見出し→表の絞り込み。
      function _initPortalHeatDelegation() {
        const host = document.getElementById("portal-heat");
        if (!host || host.dataset.wired === "1") return;
        host.dataset.wired = "1";
        host.addEventListener("click", (e) => {
          const close = e.target.closest(".w15-close");
          if (close) { heatOpenSector = null; renderPortalHeatmap(lastPortalList); return; }
          const stock = e.target.closest(".w15-stock");
          if (stock && stock.dataset.ticker) { navigateToDetail(stock.dataset.ticker, stock); return; }
          const ind = e.target.closest(".w15-ind-h");
          if (ind && ind.dataset.ind) { setSectorFilter(ind.dataset.ind); return; }
          const tile = e.target.closest(".w15-tile");
          if (tile && tile.dataset.sec) {
            heatOpenSector = (heatOpenSector === tile.dataset.sec) ? null : tile.dataset.sec;
            renderPortalHeatmap(lastPortalList);   // 母集合は変わらない＝表（窓化・スクロール位置）は触らない
          }
        });
      }
```

- [ ] **Step 5: 初期化で呼ぶ**

`_initPortalStripDelegation();` の行の直後に足す：

```js
        _initPortalStripDelegation();                                     // W1: 発掘ストリップの委譲リスナー（1回だけ）
        _initPortalHeatDelegation();                                      // W1.5: ヒートマップの委譲リスナー（1回だけ）
```

- [ ] **Step 6: 実ブラウザで確認**

`http://127.0.0.1:8215/`（切替バーは「現行」）でタイルをクリック → 小分類ごとに銘柄タイルが出る／再クリックと「閉じる ✕」で閉じる／銘柄タイルで詳細へ飛ぶ／小分類見出しで表が絞り込まれることを確認。

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(w15): 大分類の展開（小分類束ね＋銘柄タイル）と委譲リスナーを追加"
```

---

### Task 6: 指標・平均の切替バーと永続化

**Files:**
- Modify: `index.html`（`_heatLegend` の直後に `_heatControls`・`renderPortalHeatmap` の head 行に差し込み・委譲リスナーに分岐追加・CSS 追加）

**Interfaces:**
- Consumes: Task 4 の `heatMetricKey` / `heatWeighted`、Task 5 の `_initPortalHeatDelegation`
- Produces: `_heatControls()`（HTML 文字列）

- [ ] **Step 1: コントロールの描画を追加**

`_heatLegend` の直後に挿入：

```js
      function _heatControls() {
        const metrics = PortalPriceRules.HEAT_METRICS.map((m) =>
          `<button type="button" class="w15-ctl${m.key === heatMetricKey ? " on" : ""}"
             data-metric="${esc(m.key)}">${esc(m.label)}</button>`).join("");
        const weights = [{ k: "eq", label: "単純", on: !heatWeighted }, { k: "cap", label: "時価総額", on: heatWeighted }]
          .map((w) => `<button type="button" class="w15-ctl${w.on ? " on" : ""}" data-weight="${w.k}">${esc(w.label)}</button>`).join("");
        return `<div class="w15-ctls"><span>指標</span>${metrics}<span>平均</span>${weights}</div>`;
      }
```

- [ ] **Step 2: head 行に差し込む**

`renderPortalHeatmap` の `<div class="w15-head">…</div>` の直後（`<div class="w15-panel">` の内側先頭）に足す：

```js
          <div class="w15-panel">
            ${_heatControls()}
            <div class="w15-cols">
```

- [ ] **Step 3: CSS を追加**

Task 5 で足した CSS の直後に挿入：

```css
      .w15-ctls { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-bottom: 11px; }
      .w15-ctls > span { font-size: 11px; color: var(--ix-slate); letter-spacing: 0.06em; margin-right: 2px; }
      .w15-ctls > span + span { margin-left: 8px; }
      .w15-ctl { font-size: 12px; min-height: 32px; padding: 5px 11px; border-radius: 999px; cursor: pointer;
                 background: transparent; border: 1px solid var(--ix-border-mid);
                 color: var(--ix-text-dim); font-family: inherit; }
      .w15-ctl.on { background: rgba(0, 229, 255, 0.14); border-color: rgba(0, 229, 255, 0.5);
                    color: var(--ix-text-hi); }
```

- [ ] **Step 4: 委譲リスナーに分岐を追加**

`_initPortalHeatDelegation` の `const close = …` の**直前**に挿入（コントロールが最優先）：

```js
          const ctl = e.target.closest(".w15-ctl");
          if (ctl) {
            if (ctl.dataset.metric) {
              heatMetricKey = ctl.dataset.metric;
              localStorage.setItem("sip_heat_metric", heatMetricKey);
            } else if (ctl.dataset.weight) {
              heatWeighted = ctl.dataset.weight === "cap";
              localStorage.setItem("sip_heat_weight", ctl.dataset.weight);
            }
            renderPortalHeatmap(lastPortalList);
            return;
          }
```

- [ ] **Step 5: 実ブラウザで確認**

指標3つ・平均2つを切り替え、**リロード後も選択が残る**こと（localStorage）、切替で表がスクロールしない（母集合を触らない）ことを確認。

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(w15): 指標3種と平均2種の切替バー＋localStorage 永続化"
```

---

### Task 7: 構造スモークと受入（劣化・鮮度・免責）

**Files:**
- Create: `scratchpad/w15-smoke.js`
- Modify: なし（不具合が出たら `index.html` / `portal-price-rules.js` を直す）

**Interfaces:**
- Consumes: Task 4-6 の DOM（`#portal-heat` / `.w15-tile` / `.w15-stock` / `.w15-ctl`）
- Produces: 受入スクリプト（以後の wave もこれを回す）

- [ ] **Step 1: スモークを書く**

`scratchpad/w15-smoke.js` を作成：

```js
// scratchpad/w15-smoke.js — W1.5 本実装の構造スモーク（PC 1440 / 390px × 指標3種 × 開閉）。
// 使い方:
//   .venv/bin/python scratchpad/w15-mock-server.py &
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w15-smoke.js ; kill %1
// GPU の見え方は対象外（実機の仕事）。DOM・例外・件数・縦寸法だけ見る。
const { chromium } = require("playwright");

const PORT = process.env.W15_PORT || "8215";
const BASE = `http://127.0.0.1:${PORT}/`;
const VIEWS = [{ name: "pc", width: 1440, height: 1000 }, { name: "mb", width: 390, height: 844 }];
const METRICS = ["c1", "c5", "pos52"];
const IGNORE = [/\/sw\.js/, /\/api\/me/];   // モック環境固有の 404/502（本実装と無関係）

let failed = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
  if (!cond) failed++;
}

(async () => {
  const html = await fetch(BASE).then((r) => r.text()).catch(() => "");
  if (!/id="portal-heat"/.test(html)) {
    console.log(`❌ ${BASE} は W1.5 適用済みのツリーを配信していません`);
    process.exit(2);
  }
  const browser = await chromium.launch();
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error" && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });

    for (const metric of METRICS) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate((k) => localStorage.setItem("sip_heat_metric", k), metric);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.querySelectorAll("#portal-heat .w15-tile").length > 0, { timeout: 25000 });

      const m = await page.evaluate(() => ({
        tiles: document.querySelectorAll("#portal-heat .w15-tile").length,
        cols: document.querySelectorAll("#portal-heat .w15-col").length,
        legend: document.querySelectorAll("#portal-heat .w15-legend").length,
        // ⚠ 免責文は既存で最大2本ある（ストリップ末尾＝常時／モードバー＝値動きモード時のみ・文言は別）。
        //    守る要件は「ヒートマップが免責文を増やさない」こと＝パネル内0件・画面全体は既存のまま。
        heatDisc: (document.getElementById("portal-heat").innerText || "").split("推奨・売買判断ではありません").length - 1,
        bodyDisc: document.body.innerText.split("推奨・売買判断ではありません").length - 1,
        docH: document.documentElement.scrollHeight,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      check(`[${v.name}/${metric}] タイルが出る`, m.tiles > 0, `${m.tiles}枚`);
      check(`[${v.name}/${metric}] 2カラム`, m.cols === 2);
      check(`[${v.name}/${metric}] 凡例1つ`, m.legend === 1);
      check(`[${v.name}/${metric}] ヒートマップは免責文を持たない`, m.heatDisc === 0, `${m.heatDisc}個`);
      check(`[${v.name}/${metric}] 画面の免責文は既存のまま（1〜2本）`, m.bodyDisc >= 1 && m.bodyDisc <= 2, `${m.bodyDisc}個`);
      check(`[${v.name}/${metric}] 横スクロールなし`, !m.overflowX);

      // 展開（⚠ page.click() は要素を画面内へスクロールするので evaluate 経由で押す）
      await page.evaluate(() => document.querySelector("#portal-heat .w15-tile").click());
      await page.waitForTimeout(300);
      const open = await page.evaluate(() => ({
        stocks: document.querySelectorAll("#portal-heat .w15-stock").length,
        docH: document.documentElement.scrollHeight,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      check(`[${v.name}/${metric}] 展開で銘柄タイルが出る`, open.stocks > 0, `${open.stocks}枚`);
      check(`[${v.name}/${metric}] 展開後も横スクロールなし`, !open.overflowX);
      check(`[${v.name}/${metric}] 展開でページが伸びる`, open.docH > m.docH, `${m.docH}→${open.docH}px`);

      // 再クリックで閉じる
      await page.evaluate(() => document.querySelector("#portal-heat .w15-tile").click());
      await page.waitForTimeout(300);
      const closed = await page.evaluate(() => document.querySelectorAll("#portal-heat .w15-stock").length);
      check(`[${v.name}/${metric}] 再クリックで閉じる`, closed === 0);
    }

    // 0件フィルタ → パネルが消える（表側が「見つかりません」を出す）
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelectorAll("#portal-heat .w15-tile").length > 0, { timeout: 25000 });
    await page.fill("#portal-search", "該当しない検索語zzz");
    await page.waitForTimeout(600);
    const empty = await page.evaluate(() => document.getElementById("portal-heat").innerHTML.trim().length);
    check(`[${v.name}] 0件でパネルが消える`, empty === 0);

    check(`[${v.name}] pageerror / console.error なし`, errors.length === 0, errors.join(" | "));
    await ctx.close();
  }
  await browser.close();
  console.log(failed ? `\n❌ ${failed}件 FAIL` : "\n✅ ALL PASS");
  process.exit(failed ? 1 : 0);
})();
```

- [ ] **Step 2: スモークを実行**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/w15-smoke.js
```

Expected: ALL PASS（FAIL があれば `index.html` を直してから再実行）

- [ ] **Step 3: `px_error` 劣化を確認**

モックデータを一時的に加工して `px_error` 経路を通す（**元データは書き換えない**）：

```bash
python3 -c "
import json
d = json.load(open('scratchpad/w1-mock-data.json', encoding='utf-8'))
d['px_meta'] = d.get('px_meta', {}); d['px_error'] = True
for v in d['stocks'].values(): v.pop('px', None)
json.dump(d, open('scratchpad/w15-pxerror.json', 'w', encoding='utf-8'), ensure_ascii=False)
print('wrote scratchpad/w15-pxerror.json')
"
```

先に `scratchpad/w15-mock-server.py` の `DATA` 行を env で差し替えられるようにする（1行修正）：

```python
DATA = os.path.abspath(os.path.join(ROOT, os.environ.get("W15_DATA", "scratchpad/w1-mock-data.json")))
```

```bash
W15_DATA=scratchpad/w15-pxerror.json .venv/bin/python scratchpad/w15-mock-server.py
```

ブラウザで**ヒートマップが消え、一覧表が残る**ことを確認（W1 の劣化要件と同じ）。確認後は `scratchpad/w15-pxerror.json` を削除する（再生成できる一時ファイル）。

- [ ] **Step 4: 全テストを回す**

```bash
node --test tests/*.test.js
```

Expected: 全緑（既存 370 ＋ 新規）

```bash
.venv/bin/python -m pytest tests/ -q
```

Expected: 236 passed（API 非接触＝不変）

- [ ] **Step 5: W1 の受入スクリプトが引き続き通ることを確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/w1-smoke.js
```

Expected: ALL PASS（ヒートマップ追加でストリップ/値動きモードが壊れていないこと）

- [ ] **Step 6: Commit**

```bash
git add scratchpad/w15-smoke.js scratchpad/w15-mock-server.py
git commit -m "test(w15): 構造スモーク（3指標×PC/390px×開閉・0件・劣化）を追加"
```

---

## 完了条件

- `node --test tests/*.test.js` 全緑 / `pytest` 236 passed（不変）
- `scratchpad/w15-smoke.js` ALL PASS
- `scratchpad/w1-smoke.js` ALL PASS（W1 の回帰なし）
- 実ブラウザ（PC / 390px）で本人サニティ：温度感パネル → 展開 → 詳細遷移 → 表の絞り込みの一連が動く
- `git diff --stat` に `api/` `scripts/` `db/` `money*` が**含まれていない**こと（Global Constraints の機械確認）
