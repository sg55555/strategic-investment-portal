# 束D「財務を物語に」層1 Implementation Plan（DuPont恒等式カード＋FCF&収益の質コンボカード）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 詳細ビューに DuPont恒等式カード（ROE=純利益率×総資産回転率×財務レバレッジ）と FCF&収益の質コンボカード（概算FCF＋現金変換率/FCFマージン）を、公開・決定論・教育フレームの層1として追加する。

**Architecture:** 純関数は `finance-rules.js`（÷1プリミティブ `divOrNull` ＋ DuPont/FCF指標）、descriptor/系列/純SVGは `detail-rules.js`、描画は `detail-charts.js`（DuPont=canvas無しinline SVG／FCF=`renderHealthTrend`型二軸canvas）、カードmarkupは `index.html` 固定id静的コンテナ、配線は `detail.js updateFinancialViews`。move-not-rewrite（既存チャート無改変）。

**Tech Stack:** Vanilla JS（UMD-lite純関数）／Lightweight Charts v4.2.3／Chart.js 4.5.1＋datalabels／node --test／mock_prod_server.py＋detail-snapshot.js 検証ハーネス。

## Global Constraints

- **規制安全（層1不変条件）**：no-score（合成スコア/格付けを作らない）／中立語閉集合の句（売買語・予測語ゼロ）／因果は一般論のみ（誤解注記）／免責fail-closed・不可分同梱／facts非出力（`modeAFacts`/`advice.py` 非接触）／「純資産ROE分解」「概算FCF」を画面文言に明示。
- **欠測ゲート**：分母0以下・入力欠測は `null`（欠測点）。`||0` で0%潰し禁止。負のFCFは正当＝保持。DuPont equity は `net_assets`（純資産・少数株主持分含む）＝「自己資本」と呼ばない。
- **0x0罠（唯一の技術制約）**：canvas は明示高さ wrapper、resize は `clientWidth>0` ガード、destroy先行。DuPontはcanvas無し（inline SVG）で構造回避。
- **UMD公開面の足し忘れ＝無言故障**：新純関数は `finance-rules.js` return(:186-210) に、descriptor/純SVGは `detail-rules.js` return(:584-595) に、描画は `detail-charts.js` の `window.DetailCharts` export(:1196-1200) に必ず追加。
- **既存無改変**：money-rules/money.js／既存チャート描画本体／ローソク確定色・canvas意味色に触れない。新CDN依存なし。
- **単位**：全財務値は百万単位。比率は無次元（通貨非依存）。FCF絶対額は `FinanceRules.pickUnit`/`fmtUnitValue` で通貨別整形。
- **検証**：`node --test`（NODE_PATH不要）。DOM系は `NODE_PATH=/home/shugo/node_modules node scratchpad/<verify>.js` ＋ mock server（`scratchpad/mock_prod_server.py` :8200）。
- **spec**：`docs/superpowers/specs/2026-07-07-phase2-bundleD-financial-story-design.md`。

---

### Task 1: `divOrNull` 共通÷1プリミティブ（finance-rules.js）

**Files:**
- Modify: `finance-rules.js`（新関数を `growthRates` の後・`return` の前に追加＋ return オブジェクトに登録）
- Test: `tests/finance-rules.test.js`（末尾に test 追記）

**Interfaces:**
- Produces: `FinanceRules.divOrNull(numer, denom) -> number|null`（`denom>0` かつ両者有限で `numer/denom`、他は `null`。×1倍率用＝既存 `ratio`/`ratioOrNull` は×100を焼込むため倍率に使えない）

- [ ] **Step 1: Write the failing test**

```js
test("divOrNull は分母>0かつ両者有限のとき numer/denom、他は null（×1・負numer可）", () => {
  assert.equal(F.divOrNull(10, 2), 5);
  assert.equal(F.divOrNull(-10, 2), -5);      // 負の numer は通す
  assert.equal(F.divOrNull(10, 0), null);     // 分母0
  assert.equal(F.divOrNull(10, -2), null);    // 分母<0
  assert.equal(F.divOrNull(NaN, 2), null);
  assert.equal(F.divOrNull(10, Infinity), null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/finance-rules.test.js`
Expected: FAIL（`F.divOrNull is not a function`）

- [ ] **Step 3: Write minimal implementation**

`finance-rules.js` の `growthRates` 関数の後、`return {` の直前に追加：

```js
  // ×1（倍率）の共通ゲート。分母>0 かつ両者有限のときのみ numer/denom、他は null。
  // 既存 ratio/ratioOrNull は ×100 を焼込むため、回転率/レバレッジ/現金変換の「倍」には使えない。
  function divOrNull(numer, denom) {
    return (isFinite(numer) && isFinite(denom) && denom > 0) ? (numer / denom) : null;
  }
```

`return {` オブジェクト（:186）に追記：

```js
    divOrNull: divOrNull,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/finance-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add finance-rules.js tests/finance-rules.test.js
git commit -m "feat(bundleD): divOrNull ×1除算プリミティブ（DuPont/FCF倍率の土台）"
```

---

### Task 2: `assetTurnover` / `equityMultiplier`（finance-rules.js）

**Files:**
- Modify: `finance-rules.js`
- Test: `tests/finance-rules.test.js`

**Interfaces:**
- Consumes: `divOrNull`（Task 1）、既存 `totalAssets`/`hasValue`/`n`
- Produces:
  - `FinanceRules.assetTurnover(fin) -> number|null`（倍・売上/総資産・入力欠測/分母≤0→null）
  - `FinanceRules.equityMultiplier(fin) -> number|null`（倍・総資産/純資産・入力欠測/分母≤0→null）

- [ ] **Step 1: Write the failing test**

```js
test("assetTurnover = 売上/総資産（倍）・欠測/分母0は null", () => {
  assert.ok(Math.abs(F.assetTurnover(TOYOTA) - (48036704 / 90000000)) < 1e-9);
  assert.equal(F.assetTurnover({ net_sales: 100, current_assets: 50, non_current_assets: 50 }), 1);
  assert.equal(F.assetTurnover({ net_sales: 100, current_assets: 0, non_current_assets: 0 }), null); // 総資産0
  assert.equal(F.assetTurnover({ current_assets: 50, non_current_assets: 50 }), null); // 売上欠測
  assert.equal(F.assetTurnover(null), null);
});

test("equityMultiplier = 総資産/純資産（倍）・欠測/分母≤0は null", () => {
  assert.equal(F.equityMultiplier(TOYOTA), 2); // 90,000,000 / 45,000,000
  assert.equal(F.equityMultiplier({ current_assets: 50, non_current_assets: 50, net_assets: 0 }), null);
  assert.equal(F.equityMultiplier({ current_assets: 50, non_current_assets: 50 }), null); // 純資産欠測
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/finance-rules.test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`divOrNull` の後に追加：

```js
  // 総資産回転率（倍）= 売上高 / 総資産。入力欠測/分母≤0 は null。
  function assetTurnover(fin) {
    if (!fin) return null;
    if (!hasValue(fin, "net_sales") || !hasValue(fin, "current_assets") || !hasValue(fin, "non_current_assets")) return null;
    return divOrNull(n(fin.net_sales), totalAssets(fin));
  }
  // 財務レバレッジ（倍）= 総資産 / 純資産。入力欠測/分母≤0 は null。
  function equityMultiplier(fin) {
    if (!fin) return null;
    if (!hasValue(fin, "current_assets") || !hasValue(fin, "non_current_assets") || !hasValue(fin, "net_assets")) return null;
    return divOrNull(totalAssets(fin), n(fin.net_assets));
  }
```

return に追記：`assetTurnover: assetTurnover,` `equityMultiplier: equityMultiplier,`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/finance-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add finance-rules.js tests/finance-rules.test.js
git commit -m "feat(bundleD): assetTurnover/equityMultiplier（DuPont 回転率・レバレッジ）"
```

---

### Task 3: `dupont` 合成＋恒等式固定（finance-rules.js）

**Files:**
- Modify: `finance-rules.js`
- Test: `tests/finance-rules.test.js`

**Interfaces:**
- Consumes: `netMargin`/`roe`（既存・%）、`assetTurnover`/`equityMultiplier`（Task 2）、`hasValue`/`n`
- Produces: `FinanceRules.dupont(fin) -> {netMargin:number|null, assetTurnover:number|null, equityMultiplier:number|null, roe:number|null}`。恒等式 `netMargin(%) × assetTurnover × equityMultiplier ≈ roe(%)`

- [ ] **Step 1: Write the failing test**

```js
test("dupont: 恒等式 netMargin%×assetTurnover×equityMultiplier ≈ roe%", () => {
  const d = F.dupont(TOYOTA);
  assert.ok(Math.abs(d.netMargin - F.netMargin(TOYOTA)) < 1e-9);
  assert.ok(Math.abs(d.roe - F.roe(TOYOTA)) < 1e-9);
  assert.equal(d.equityMultiplier, 2);
  // 恒等式（%スケール）が閉じる
  assert.ok(Math.abs(d.netMargin * d.assetTurnover * d.equityMultiplier - d.roe) < 1e-6);
});

test("dupont: 欠測因数は該当のみ null（他は算出）", () => {
  const d = F.dupont({ net_income: 100, net_sales: 1000, current_assets: 400, non_current_assets: 600 }); // net_assets欠測
  assert.equal(d.netMargin, 10);
  assert.ok(Math.abs(d.assetTurnover - 0.1) < 1e-9);
  assert.equal(d.equityMultiplier, null); // 純資産欠測
  assert.equal(d.roe, null);              // 純資産欠測
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/finance-rules.test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```js
  // DuPont 分解。純利益率(%)×総資産回転率(倍)×財務レバレッジ(倍) ≈ ROE(%)。各因数 null 可。
  // equity は net_assets（純資産・少数株主持分含む）＝厳密な自己資本ではない（呼出側で「純資産ベース」明示）。
  function dupont(fin) {
    fin = fin || {};
    var nm = (hasValue(fin, "net_income") && hasValue(fin, "net_sales") && n(fin.net_sales) > 0) ? netMargin(fin) : null;
    var at = assetTurnover(fin);
    var em = equityMultiplier(fin);
    var re = (hasValue(fin, "net_income") && hasValue(fin, "net_assets") && n(fin.net_assets) > 0) ? roe(fin) : null;
    return { netMargin: nm, assetTurnover: at, equityMultiplier: em, roe: re };
  }
```

return に追記：`dupont: dupont,`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/finance-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add finance-rules.js tests/finance-rules.test.js
git commit -m "feat(bundleD): dupont 合成（恒等式一致をテスト固定）"
```

---

### Task 4: `fcf` / `fcfMargin` / `cashConversion`（finance-rules.js）

**Files:**
- Modify: `finance-rules.js`
- Test: `tests/finance-rules.test.js`

**Interfaces:**
- Consumes: `n`/`hasValue`/`ratio`/`ratioOrNull`/`divOrNull`
- Produces:
  - `FinanceRules.fcf(fin) -> number|null`（営業CF+投資CF・負値保持・どちらか欠測→null）
  - `FinanceRules.fcfMargin(fin) -> number|null`（%・FCF/売上・売上≤0/欠測→null）
  - `FinanceRules.cashConversion(fin) -> number|null`（%・営業CF/純利益・純利益≤0/欠測→null）

- [ ] **Step 1: Write the failing test**

```js
test("fcf = 営業CF+投資CF（負値保持・どちらか欠測は null）", () => {
  assert.equal(F.fcf(TOYOTA), 1000000);                          // 4,000,000 + (-3,000,000)
  assert.equal(F.fcf({ operating_cf: 100, investing_cf: -300 }), -200); // 負のFCFは正当
  assert.equal(F.fcf({ operating_cf: 100 }), null);              // 投資CF欠測
  assert.equal(F.fcf(null), null);
});

test("fcfMargin = FCF/売上*100（売上≤0/欠測は null・負可）", () => {
  assert.ok(Math.abs(F.fcfMargin(TOYOTA) - (1000000 / 48036704 * 100)) < 1e-9);
  assert.equal(F.fcfMargin({ operating_cf: 100, investing_cf: -300, net_sales: 0 }), null); // 売上0
  assert.equal(F.fcfMargin({ operating_cf: 100, investing_cf: -300 }), null);               // 売上欠測
});

test("cashConversion = 営業CF/純利益*100（純利益≤0/欠測は null）", () => {
  assert.ok(Math.abs(F.cashConversion(TOYOTA) - (4000000 / 4765000 * 100)) < 1e-9);
  assert.equal(F.cashConversion({ operating_cf: 100, net_income: 0 }), null);   // 純利益0
  assert.equal(F.cashConversion({ operating_cf: 100, net_income: -50 }), null); // 赤字年
  assert.equal(F.cashConversion({ net_income: 100 }), null);                    // 営業CF欠測（n()の0化に頼らない）
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/finance-rules.test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```js
  // 概算フリーCF = 営業CF + 投資CF（投資CFは通常負）。負値は正当（設備投資先行）。
  // 営業CF/投資CF のどちらか欠測なら null（n() の0化に頼らず hasValue でゲート）。
  function fcf(fin) {
    if (!fin) return null;
    if (!hasValue(fin, "operating_cf") || !hasValue(fin, "investing_cf")) return null;
    return n(fin.operating_cf) + n(fin.investing_cf);
  }
  // FCFマージン(%) = FCF / 売上高。売上≤0 or 入力欠測は null。
  function fcfMargin(fin) {
    return ratioOrNull(fin, function (f) { return ratio(fcf(f), f.net_sales); },
      ["operating_cf", "investing_cf", "net_sales"], ["net_sales"]);
  }
  // 現金変換率(%) = 営業CF / 純利益。利益の現金化＝収益の質。純利益≤0(赤字年)/欠測は null。
  //  ⚠ null*100=0 の落とし穴を回避（divOrNull が null を返したら null のまま返す）。
  function cashConversion(fin) {
    if (!fin || !hasValue(fin, "operating_cf")) return null;
    var c = divOrNull(n(fin.operating_cf), n(fin.net_income));
    return c === null ? null : c * 100;
  }
```

return に追記：`fcf: fcf,` `fcfMargin: fcfMargin,` `cashConversion: cashConversion,`

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/finance-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add finance-rules.js tests/finance-rules.test.js
git commit -m "feat(bundleD): fcf/fcfMargin/cashConversion（概算FCF・収益の質・null伝播ガード）"
```

---

### Task 5: `dupontFactorSeries` / `fcfTrendSeries`（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`（`healthTrendSeries` の後・return の前／return の該当グループに追記）
- Test: `tests/detail-rules.test.js`（`global.FinanceRules = require("../finance-rules.js")` 済み前提）

**Interfaces:**
- Consumes: `FR.dupont`/`FR.fcf`/`FR.fcfMargin`/`FR.cashConversion`/`FR.hasValue`
- Produces:
  - `DetailRules.dupontFactorSeries(data) -> {years:[], netMargin:[], assetTurnover:[], equityMultiplier:[], roe:[]}`（全年・欠測null点・ETF空）
  - `DetailRules.fcfTrendSeries(data) -> {years:[], fcf:[], fcfMargin:[], cashConversion:[], operatingCf:[], investingCf:[]}`（同）

- [ ] **Step 1: Write the failing test**

```js
test("dupontFactorSeries: 全年・欠測null点・ETF空", () => {
  const data = { financials_trend: {
    "2023": { net_income: 100, net_sales: 1000, current_assets: 400, non_current_assets: 600, net_assets: 500 },
    "2024": { net_income: 120, net_sales: 1100, current_assets: 400, non_current_assets: 600 }, // net_assets欠測
  }};
  const s = D.dupontFactorSeries(data);
  assert.deepEqual(s.years, ["2023", "2024"]);
  assert.equal(s.equityMultiplier[0], 2);      // 1000/500
  assert.equal(s.equityMultiplier[1], null);   // 欠測
  assert.equal(s.roe[1], null);
  assert.deepEqual(D.dupontFactorSeries({ financials_trend: {} }).years, []); // ETF空
});

test("fcfTrendSeries: fcf/margin/conversion と 内訳CF・欠測null点", () => {
  const data = { financials_trend: {
    "2024": { operating_cf: 4000000, investing_cf: -3000000, net_sales: 48036704, net_income: 4765000 },
    "2025": { net_sales: 50000000 }, // CF欠測
  }};
  const s = D.fcfTrendSeries(data);
  assert.equal(s.fcf[0], 1000000);
  assert.equal(s.fcf[1], null);
  assert.equal(s.cashConversion[1], null);
  assert.equal(s.operatingCf[0], 4000000);
  assert.equal(s.investingCf[1], null);
});
```
（テスト冒頭で `const D = require("../detail-rules.js");` を利用。既存テストの読込規約に合わせる。）

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`healthTrendSeries` の後に追加：

```js
  // ── DuPont 因数系列（束D）── 全年ループで dupont 各因数を系列化・欠測 null 点・ETF は空。
  function dupontFactorSeries(data) {
    var tr = (data && data.financials_trend) || {};
    var years = Object.keys(tr).sort();
    var nm = [], at = [], em = [], re = [];
    for (var i = 0; i < years.length; i++) {
      var d = FR.dupont(tr[years[i]]);
      nm.push(d.netMargin); at.push(d.assetTurnover); em.push(d.equityMultiplier); re.push(d.roe);
    }
    return { years: years, netMargin: nm, assetTurnover: at, equityMultiplier: em, roe: re };
  }
  // ── FCF & 収益の質 系列（束D）── 概算FCF/FCFマージン/現金変換率＋内訳CF・欠測 null 点・ETF は空。
  function fcfTrendSeries(data) {
    var tr = (data && data.financials_trend) || {};
    var years = Object.keys(tr).sort();
    var fcfA = [], mg = [], cc = [], op = [], iv = [];
    for (var i = 0; i < years.length; i++) {
      var f = tr[years[i]];
      fcfA.push(FR.fcf(f));
      mg.push(FR.fcfMargin(f));
      cc.push(FR.cashConversion(f));
      op.push(FR.hasValue(f, "operating_cf") ? f.operating_cf : null);
      iv.push(FR.hasValue(f, "investing_cf") ? f.investing_cf : null);
    }
    return { years: years, fcf: fcfA, fcfMargin: mg, cashConversion: cc, operatingCf: op, investingCf: iv };
  }
```

return の「テクニカル純関数」行（`signalDigest, healthTrendSeries,`）に `dupontFactorSeries, fcfTrendSeries,` を追記。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(bundleD): dupontFactorSeries/fcfTrendSeries（欠測null点・ETF空）"
```

---

### Task 6: `sparklineSVG` 純SVGビルダー（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Produces: `DetailRules.sparklineSVG(values, opts) -> string`（`<svg>…</svg>`・null欠測を除外・有効点<2は空svg・DOM非依存の純文字列）。`opts={w,h,color}`

**理由:** `buildSparklineSVG`(index.html:2135) は F2 IIFE で PRIVATIZED＝window 非到達。detail 側に純関数で新設（node --test 可・0x0罠/FHD黒面と無縁の inline SVG）。

- [ ] **Step 1: Write the failing test**

```js
test("sparklineSVG: 有効点>=2で polyline・null除外・<2は空svg", () => {
  const svg = D.sparklineSVG([1, null, 3, 4], { w: 60, h: 18 });
  assert.match(svg, /<svg/);
  assert.match(svg, /<polyline/);
  // 有効3点（index 0,2,3）が反映される＝points に3座標
  assert.equal((svg.match(/,/g) || []).length, 3); // "x,y" が3組
  const empty = D.sparklineSVG([null, 5], {});
  assert.match(empty, /<svg/);
  assert.doesNotMatch(empty, /<polyline/); // 有効1点→線なし
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```js
  // ── 純SVGスパークライン（束D）── null は欠測として除外。有効点<2は空svg。DOM非依存。
  function sparklineSVG(values, opts) {
    opts = opts || {};
    var w = opts.w || 64, h = opts.h || 18, pad = 2;
    var color = opts.color || "currentColor";
    var pts = [];
    for (var i = 0; i < values.length; i++) {
      if (values[i] != null && isFinite(Number(values[i]))) pts.push({ i: i, v: Number(values[i]) });
    }
    var head = '<svg class="dp-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">';
    if (pts.length < 2) return head + "</svg>";
    var xs = values.length - 1;
    var vs = pts.map(function (p) { return p.v; });
    var min = Math.min.apply(null, vs), max = Math.max.apply(null, vs);
    var span = (max - min) || 1;
    var coord = pts.map(function (p) {
      var x = pad + (p.i / xs) * (w - 2 * pad);
      var y = h - pad - ((p.v - min) / span) * (h - 2 * pad);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    return head + '<polyline points="' + coord + '" fill="none" stroke="' + color +
      '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }
```

return の「財務ディスクリプタ純関数」グループに `sparklineSVG,` を追記。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(bundleD): sparklineSVG 純SVGビルダー（buildSparklineSVGはF2で非到達）"
```

---

### Task 7: `dupontDescriptor` 中立driver句（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Consumes: `FR.dupont`
- Produces: `DetailRules.dupontDescriptor(fin) -> {factors:[{key,label,termKey,value,unit}], roe:{value,unit}, driver:{text}}`。中立driver句・no-score・「純資産ベース（少数株主持分を含む）」明示・売買/予測語ゼロ。

- [ ] **Step 1: Write the failing test**

```js
const FORBIDDEN = ["買い", "売り", "買う", "売る", "購入", "売却", "推奨", "おすすめ", "狙い目", "割安だから", "上がる", "下がる", "上昇する見込み", "見込まれ", "だろう", "利益が出る", "儲か"];

test("dupontDescriptor: 3因数+ROE+中立driver・純資産ベース明示・禁止語彙0", () => {
  const d = D.dupontDescriptor(TOYOTA);
  assert.equal(d.factors.length, 3);
  assert.equal(d.factors[0].termKey, "net-margin");
  assert.equal(d.factors[1].termKey, "asset-turnover");
  assert.equal(d.factors[2].termKey, "financial-leverage");
  assert.ok(Math.abs(d.roe.value - F.roe(TOYOTA)) < 1e-9);
  assert.match(d.driver.text, /純資産ベース/);
  FORBIDDEN.forEach((w) => assert.ok(!d.driver.text.includes(w), "禁止語: " + w));
});

test("dupontDescriptor: 欠測は値null・参考値フォールバック句", () => {
  const d = D.dupontDescriptor({ net_income: 100, net_sales: 1000 }); // 資産系欠測
  assert.equal(d.factors[1].value, null); // 回転率null
  assert.match(d.driver.text, /参考値|欠損/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`sparklineSVG` の後に追加。**driver句は固定中立文の閉集合**（売買/予測語を含めない・ランキングや良否判断をしない）：

```js
  // ── DuPont descriptor（束D・層1・公開）── no-score・中立driver句・純資産ベース明示。
  function dupontDescriptor(fin) {
    var d = FR.dupont(fin);
    var factors = [
      { key: "netMargin", label: "純利益率", termKey: "net-margin", value: d.netMargin, unit: "%" },
      { key: "assetTurnover", label: "総資産回転率", termKey: "asset-turnover", value: d.assetTurnover, unit: "倍" },
      { key: "equityMultiplier", label: "財務レバレッジ", termKey: "financial-leverage", value: d.equityMultiplier, unit: "倍" },
    ];
    var text;
    var complete = d.netMargin != null && d.assetTurnover != null && d.equityMultiplier != null && d.roe != null;
    if (complete) {
      text = "純資産ROE " + d.roe.toFixed(1) + "% は、純利益率×総資産回転率×財務レバレッジ の積です。" +
        "財務レバレッジ " + d.equityMultiplier.toFixed(2) + "倍 は総資産が純資産の約 " + d.equityMultiplier.toFixed(2) + "倍 であることを表します（純資産ベース＝少数株主持分を含む）。" +
        "レバレッジはROEを押し上げますが財務リスクも高めます（一般的な性質）。";
    } else {
      text = "一部の因数が欠損のため、分解は参考値です（純資産ベース＝少数株主持分を含む）。";
    }
    return { factors: factors, roe: { value: d.roe, unit: "%" }, driver: { text: text } };
  }
```

return の「財務ディスクリプタ純関数」グループに `dupontDescriptor,` を追記。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(bundleD): dupontDescriptor（中立driver句・純資産ベース明示・禁止語彙0テスト）"
```

---

### Task 8: `fcfQualityDescriptor` 中立quality句（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Consumes: `DetailRules.fcfTrendSeries`
- Produces: `DetailRules.fcfQualityDescriptor(data) -> {text}`。中立・事実記述・「概算FCF＝営業CF＋投資CF」明示・売買/予測語ゼロ。

- [ ] **Step 1: Write the failing test**

```js
test("fcfQualityDescriptor: 概算FCF定義明示・中立・禁止語彙0", () => {
  const data = { financials_trend: {
    "2023": { operating_cf: 5000, investing_cf: -2000, net_sales: 100000, net_income: 4000 },
    "2024": { operating_cf: 4000, investing_cf: -6000, net_sales: 100000, net_income: 4500 }, // FCF負
  }};
  const q = D.fcfQualityDescriptor(data);
  assert.match(q.text, /概算FCF/);
  FORBIDDEN.forEach((w) => assert.ok(!q.text.includes(w), "禁止語: " + w));
});

test("fcfQualityDescriptor: 全欠測はフォールバック句", () => {
  const q = D.fcfQualityDescriptor({ financials_trend: { "2024": { net_sales: 100 } } });
  assert.match(q.text, /概算FCF/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

**quality句は固定中立文の閉集合**（最新年の現金変換率と、いずれかの年でFCFが負かどうかの事実のみで分岐・良否判断/売買/予測語なし）：

```js
  // ── FCF & 収益の質 descriptor（束D・層1・公開）── 事実記述のみ・中立・no-score。
  function fcfQualityDescriptor(data) {
    var s = fcfTrendSeries(data);
    var base = "概算FCF＝営業CF＋投資CF（投資CFは通常マイナス）。";
    // 最新の有効な現金変換率
    var lastCc = null;
    for (var i = s.cashConversion.length - 1; i >= 0; i--) { if (s.cashConversion[i] != null) { lastCc = s.cashConversion[i]; break; } }
    var hasNegFcf = s.fcf.some(function (v) { return v != null && v < 0; });
    var parts = [base];
    if (lastCc != null) {
      parts.push(lastCc >= 100
        ? "直近では営業CFが純利益を上回り、利益の現金化は概ね良好です（現金変換率 " + Math.round(lastCc) + "%）。"
        : "直近では営業CFが純利益を下回っています（現金変換率 " + Math.round(lastCc) + "%）。赤字年の現金変換率は表示していません。");
    } else {
      parts.push("現金変換率を算出できる年がありません（赤字年やCF欠損の年は非表示）。");
    }
    if (hasNegFcf) parts.push("投資が営業CFを上回った年は概算FCFがマイナスになります（成長投資局面で一般に起こりうる事実です）。");
    return { text: parts.join("") };
  }
```

return の「財務ディスクリプタ純関数」グループに `fcfQualityDescriptor,` を追記。

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(bundleD): fcfQualityDescriptor（概算FCF明示・中立・禁止語彙0テスト）"
```

---

### Task 9: INDICATOR_GLOSSARY 追加語（detail-rules.js）

**Files:**
- Modify: `detail-rules.js`（`INDICATOR_GLOSSARY` 配列に追記）
- Test: `tests/detail-rules.test.js`

**Interfaces:**
- Produces: `INDICATOR_GLOSSARY` に `dupont`/`asset-turnover`/`financial-leverage`/`fcf`/`fcf-margin`/`cash-conversion` の6語（`net-margin`/`roe` は既存）。中立def＋誤解注記1文。

- [ ] **Step 1: Write the failing test**

```js
test("INDICATOR_GLOSSARY に束Dの新語が中立defで存在する", () => {
  const glo = D.INDICATOR_GLOSSARY;
  const keys = glo.map((g) => g.term);
  ["dupont", "asset-turnover", "financial-leverage", "fcf", "fcf-margin", "cash-conversion"].forEach((k) => {
    assert.ok(keys.includes(k), "欠語: " + k);
  });
  glo.forEach((g) => {                                   // 全語 def は非空
    assert.ok(typeof g.def === "string" && g.def.length > 5);
    FORBIDDEN.forEach((w) => assert.ok(!g.def.includes(w), g.term + " に禁止語: " + w));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

`INDICATOR_GLOSSARY` 配列末尾（`growth-rate` の後）に追記：

```js
    { term: "dupont", read: "デュポン分解", def: "ROEを『純利益率×総資産回転率×財務レバレッジ』の3つに分けて、何が効率を支えているかを見る枠組み。ここでは自己資本の代わりに純資産（少数株主持分を含む）を用いた分解。" },
    { term: "asset-turnover", read: "総資産回転率", def: "売上高が総資産の何倍かを表す（倍）。資産をどれだけ効率よく売上に変えているかの目安。業種で適正水準は大きく異なる。" },
    { term: "financial-leverage", read: "財務レバレッジ", def: "総資産が純資産の何倍かを表す（倍）。借入などで資産を膨らませるほど大きくなる。ROEを押し上げる一方で財務リスクも高める。" },
    { term: "fcf", read: "フリーCF（概算）", def: "営業CFと投資CFの合計で、事業から自由に使える現金の概算。設備投資が多い年は一時的にマイナスになりうる。" },
    { term: "fcf-margin", read: "FCFマージン", def: "売上高に対する概算フリーCFの割合。売上のうちどれだけ自由な現金が残るかの目安。" },
    { term: "cash-conversion", read: "現金変換率", def: "純利益に対する営業CFの割合。利益がどれだけ現金として入ってきているかの目安（収益の質）。赤字の年は意味を持たない。" },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(bundleD): グロッサリ6語追加（DuPont/回転率/レバレッジ/FCF/マージン/現金変換率）"
```

---

### Task 10: DuPontカード markup ＋ `renderDuPont`（index.html / detail-charts.js）

**Files:**
- Modify: `index.html`（dashboard-stack 末尾・健全性トレンドカードの後に `#dupont-card` 追加）
- Modify: `detail-charts.js`（`renderDuPont` を IIFE 内に追加＋`window.DetailCharts` export に登録）
- Modify: `detail.css`（`.dp-*` 最小スタイル）
- Verify: `scratchpad/task10-dupont-verify.js`（mock server + headless）

**Interfaces:**
- Consumes: `DetailRules.dupontDescriptor(fin)`、`DetailRules.dupontFactorSeries(data)`、`DetailRules.sparklineSVG(...)`、`DetailRules.ANALYSIS_DISCLAIMER`、`window.esc`
- Produces: `DetailCharts.renderDuPont(fin, data)`（canvas無し＝innerHTML全置換・免責fail-closed自己完結）

**先に読む:** `detail.js renderSignalDigest`(238-260・固定id innerHTML置換＋免責fail-closed の型)。renderDuPont はこの型を踏襲（canvas無しなので repaint 対象外）。

- [ ] **Step 1: index.html にカード markup を追加**

`health-trend-card`（index.html:1254-1259 付近）の閉じ `</div>` の後に：

```html
              <div class="card dp-card" id="dupont-card">
                <div class="card-title"><span data-term="dupont">純資産ROE分解</span></div>
                <div id="dupont-body"></div>
              </div>
```
（本体は renderDuPont が innerHTML で全置換。免責・?は body 内に自己完結で描く。）

- [ ] **Step 2: detail-charts.js に renderDuPont を実装**

IIFE 内（renderHealthTrend の近く）に追加：

```js
  function renderDuPont(fin, data) {
    var host = document.getElementById("dupont-body");
    var card = document.getElementById("dupont-card");
    if (!host || !card) return;
    var disc = DetailRules.ANALYSIS_DISCLAIMER;
    if (!disc) { card.style.display = "none"; return; }        // 免責fail-closed
    card.style.display = "";
    var d = DetailRules.dupontDescriptor(fin);
    var ser = DetailRules.dupontFactorSeries(data);
    var esc = window.esc;
    function cell(label, termKey, val, unit, series) {
      var vtxt = (val == null) ? "--" : (unit === "%" ? val.toFixed(1) + "%" : val.toFixed(2) + unit);
      return '<div class="dp-factor"><div class="dp-flabel" data-term="' + esc(termKey) + '">' + esc(label) + '</div>' +
        '<div class="dp-fval">' + esc(vtxt) + '</div>' +
        '<div class="dp-fspark">' + DetailRules.sparklineSVG(series, { w: 68, h: 18, color: "#5cf0ff" }) + '</div></div>';
    }
    var roeTxt = (d.roe.value == null) ? "--" : d.roe.value.toFixed(1) + "%";
    var html =
      '<div class="dp-identity">' +
        cell("純利益率", "net-margin", d.factors[0].value, "%", ser.netMargin) +
        '<div class="dp-op">×</div>' +
        cell("総資産回転率", "asset-turnover", d.factors[1].value, "倍", ser.assetTurnover) +
        '<div class="dp-op">×</div>' +
        cell("財務レバレッジ", "financial-leverage", d.factors[2].value, "倍", ser.equityMultiplier) +
        '<div class="dp-op">=</div>' +
        '<div class="dp-factor dp-roe"><div class="dp-flabel" data-term="roe">純資産ROE</div>' +
          '<div class="dp-fval">' + esc(roeTxt) + '</div>' +
          '<div class="dp-fspark">' + DetailRules.sparklineSVG(ser.roe, { w: 68, h: 18, color: "#ffd84d" }) + '</div></div>' +
      '</div>' +
      '<div class="dp-driver">' + esc(d.driver.text) + '</div>' +
      '<div class="panel-disclaimer">' + esc(disc) + '</div>';
    host.innerHTML = html;
  }
```

`window.DetailCharts`（:1196-1200）に `renderDuPont: renderDuPont,` を追記。

- [ ] **Step 3: detail.css に最小スタイルを追加**

```css
.dp-identity{display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;margin:6px 0 10px;}
.dp-factor{display:flex;flex-direction:column;gap:2px;min-width:84px;}
.dp-flabel{font-size:11px;color:var(--ix-text-dim,#8aa);}
.dp-fval{font-family:var(--ix-mono,monospace);font-size:18px;color:var(--ix-text,#dff);}
.dp-op{font-size:16px;color:var(--ix-text-dim,#8aa);padding-bottom:20px;}
.dp-roe .dp-fval{color:#ffd84d;}
.dp-driver{font-size:12px;line-height:1.6;color:var(--ix-text-secondary,#bcd);}
```

- [ ] **Step 4: 検証（mock server + headless）**

`scratchpad/task10-dupont-verify.js` を作成し、mock server（`python scratchpad/mock_prod_server.py` :8200）に対し 7203.T（equity）と 1321.T（ETF）を開いて確認：
- 7203.T：`#dupont-card` 可視、恒等式3因数＋ROE表示、`.dp-spark` polyline 4本、driver句に「純資産ベース」、免責文、pageerror0。
- 1321.T（ETF）：`#dupont-card` は Task 12 の finCards 登録で display:none（本タスク時点では未配線＝可視でも可・Task 12 で最終確認）。

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/task10-dupont-verify.js`
Expected: PASS（アサーション緑・pageerror0）

- [ ] **Step 5: Commit**

```bash
git add index.html detail-charts.js detail.css scratchpad/task10-dupont-verify.js
git commit -m "feat(bundleD): DuPont恒等式カード（markup+renderDuPont・SVGスパークライン・免責fail-closed）"
```

---

### Task 11: FCFカード markup ＋ `renderFCFTrend`（index.html / detail-charts.js）

**Files:**
- Modify: `index.html`（`#dupont-card` の後に `#fcf-trend-card`）
- Modify: `detail-charts.js`（`renderFCFTrend` 追加＋instance let＋`repaint()` 対象追加＋timeout配列延長＋export）
- Modify: `detail.css`（`.ht-chart` 再利用のため追加不要／必要なら `#fcf-trend-card .ht-chart`）
- Verify: `scratchpad/task11-fcf-verify.js`

**Interfaces:**
- Consumes: `DetailRules.fcfTrendSeries(data)`、`DetailRules.fcfQualityDescriptor(data)`、`FinanceRules.pickUnit`/`fmtUnitValue`/`unitLabel`、`DetailRules.ANALYSIS_DISCLAIMER`、`FIN_COLORS`、`neonBarBg`/`$neonSpecs`/`$lineGlow`
- Produces: `DetailCharts.renderFCFTrend(data, isUS)`（二軸コンボ・免責fail-closed）

**先に読む:** `detail-charts.js renderHealthTrend`(1133-1185) を熟読（二軸・`toU`＝`v/unit.div` を data に渡す・`fmtUnitValue` 済み文字列を data に渡すと NaN 化する教訓・yAxisID・scales・destroy先行）。`renderFCFTrend` はこの型に **bar+line mixed** を足したもの。

- [ ] **Step 1: index.html にカード markup を追加**

```html
              <div class="card fcf-trend-card" id="fcf-trend-card">
                <div class="card-title"><span data-term="fcf">FCF＆収益の質（概算）</span></div>
                <div class="ht-chart"><canvas id="fcfTrend"></canvas></div>
                <div class="ht-note" id="fcf-trend-note"></div>
                <div class="panel-disclaimer" id="fcf-trend-disclaimer"></div>
              </div>
```

- [ ] **Step 2: detail-charts.js に renderFCFTrend を実装**

instance private let を追加（healthTrendInstance の近く）：`var fcfTrendInstance = null;`

renderHealthTrend を手本に（数値 `v/unit.div` を data へ・単位は軸タイトル）：

```js
  function renderFCFTrend(data, isUS) {
    var card = document.getElementById("fcf-trend-card");
    var cv = document.getElementById("fcfTrend");
    if (!card || !cv) return;
    var disc = DetailRules.ANALYSIS_DISCLAIMER;
    if (!disc) { card.style.display = "none"; return; }        // 免責fail-closed
    card.style.display = "";
    if (fcfTrendInstance) { fcfTrendInstance.destroy(); fcfTrendInstance = null; }
    var s = DetailRules.fcfTrendSeries(data);
    // 注記・免責・quality句
    var q = DetailRules.fcfQualityDescriptor(data);
    var noteEl = document.getElementById("fcf-trend-note");
    if (noteEl) noteEl.textContent = q.text;
    var discEl = document.getElementById("fcf-trend-disclaimer");
    if (discEl) discEl.textContent = disc;
    if (!s.years.length) return;                                // ETF/空
    var cur = data.currency;
    var maxAbs = 0;
    s.fcf.forEach(function (v) { if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v)); });
    var unit = FinanceRules.pickUnit(maxAbs, cur);
    var unitStr = FinanceRules.unitLabel(unit);
    var fcfU = s.fcf.map(function (v) { return v == null ? null : v / unit.div; });   // ← 数値を渡す（fmtUnitValue文字列は不可）
    var barSpecs = s.years.map(function (_, i) { return (s.fcf[i] != null && s.fcf[i] < 0) ? FIN_COLORS.cf.inv : FIN_COLORS.cf.ope; });
    var ds = [
      { type: "bar", label: "概算FCF", data: fcfU, yAxisID: "amt", order: 3,
        backgroundColor: barSpecs.map(function (sp) { return neonBarBg(sp); }),
        borderColor: barSpecs.map(function (sp) { return neonEdge(sp); }), borderWidth: 1,
        datalabels: { display: false } },
      { type: "line", label: "現金変換率(%)", data: s.cashConversion, yAxisID: "pct", order: 1,
        borderColor: "#5cf0ff", backgroundColor: "transparent", tension: 0.25, spanGaps: true,
        pointRadius: 3, datalabels: { display: false } },
      { type: "line", label: "FCFマージン(%)", data: s.fcfMargin, yAxisID: "pct", order: 2,
        borderColor: "#ffd84d", backgroundColor: "transparent", tension: 0.25, spanGaps: true,
        borderDash: [4, 3], pointRadius: 2, datalabels: { display: false } },
    ];
    fcfTrendInstance = new Chart(cv.getContext("2d"), {
      data: { labels: s.years, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: true, labels: { boxWidth: 10, font: { size: 10 } } }, datalabels: { display: false } },
        scales: {
          amt: { position: "left", title: { display: true, text: unitStr }, grace: "20%" },
          pct: { position: "right", title: { display: true, text: "％" }, grid: { drawOnChartArea: false } },
        },
      },
    });
    fcfTrendInstance.$neonSpecs = [barSpecs];   // neonGlowPlugin バー発光
    fcfTrendInstance.$lineGlow = true;
  }
```
（`FIN_COLORS.cf.ope`/`.inv` の実キーは detail-rules.js:27 の `FIN_COLORS` を読んで一致させる。無ければ bs 系の既存ペアを流用。`neonBarBg`/`neonEdge` の実シグネチャは既存呼出箇所で確認。）

`window.DetailCharts` export に `renderFCFTrend: renderFCFTrend,` を追記。

- [ ] **Step 3: repaint() に FCF canvas を追加＋timeout延長**

`repaint()`（detail-charts.js:563-586）の run() 内、healthTrendInstance の resize と同型で追加：

```js
    if (fcfTrendInstance && document.getElementById("fcfTrend") &&
        document.getElementById("fcfTrend").clientWidth > 0) {
      try { fcfTrendInstance.resize(); fcfTrendInstance.update("none"); } catch (e) {}
    }
```

timeout 配列 `[300, 700, 1100, 1500]`（:585）を `[300, 700, 1100, 1500, 1900]` に延長（末尾カード増でentrance完了が伸びるためFHD黒面予防）。

- [ ] **Step 4: 検証（mock server + headless）**

`scratchpad/task11-fcf-verify.js`：7203.T で `#fcf-trend-card` 可視・canvas 描画・注記に「概算FCF」・免責文・pageerror0。1321.T（ETF）は Task 12 で finCards 非表示確認。負FCF銘柄（あれば）で bar が負方向に出ることを目視用にスクショ。

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/task11-fcf-verify.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add index.html detail-charts.js detail.css scratchpad/task11-fcf-verify.js
git commit -m "feat(bundleD): FCF&収益の質コンボカード（二軸bar+line・repaint対象追加・免責fail-closed）"
```

---

### Task 12: 配線（detail.js updateFinancialViews）＋ finCards ＋ entrance nth-child

**Files:**
- Modify: `detail.js`（`updateFinancialViews` の renderHealthTrend 直後に 2描画呼出＋injectTermHelp／`finCards` 配列に2id追加）
- Modify: `detail.css`（`cardFadeInUp` の nth-child を (9)(10) 拡張）
- Verify: `scratchpad/task12-wiring-verify.js`

**Interfaces:**
- Consumes: `DetailCharts.renderDuPont`（Task 10）、`DetailCharts.renderFCFTrend`（Task 11）、`injectTermHelp`
- Produces: 両カードが equity 銘柄で描画・配線され、ETF で非表示になる

- [ ] **Step 1: updateFinancialViews に描画呼出を追加**

`renderHealthTrend`(detail.js:552 付近) の直後、`if(!fin)return`(529) より後（財務カード領域）に：

```js
      DetailCharts.renderDuPont(fin, data);
      DetailCharts.renderFCFTrend(data, isUS);
      injectTermHelp(document.getElementById("dupont-card"));
      injectTermHelp(document.getElementById("fcf-trend-card"));
```
（免責は各 render が自己完結で注入済＝ここでの textContent 注入は不要。）

- [ ] **Step 2: finCards に2枚を追加**

`finCards` 配列（detail.js:517）に `"dupont-card"`, `"fcf-trend-card"` を追加（ETF時 display:none）。

- [ ] **Step 3: entrance nth-child を拡張**

`detail.css` の `.dashboard-stack .card:nth-child(N){animation-delay:...}`（752-772・現在(8)=0.96s）に追加：

```css
.dashboard-stack .card:nth-child(9){animation-delay:1.09s;}
.dashboard-stack .card:nth-child(10){animation-delay:1.22s;}
```

- [ ] **Step 4: 検証（mock server + headless・equity と ETF）**

`scratchpad/task12-wiring-verify.js`：
- 7203.T（JP equity）：#dupont-card / #fcf-trend-card 可視・恒等式値・FCF canvas・?バッジ注入・pageerror0。
- 米国銘柄（例 AAPL）：同上（USD 単位整形）。
- 1321.T（ETF）：両カード display:none（finCards）。
- 年切替（switchYear）でカード重複せず・?増殖せず。

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/task12-wiring-verify.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add detail.js detail.css scratchpad/task12-wiring-verify.js
git commit -m "feat(bundleD): 配線（renderDuPont/renderFCFTrend+injectTermHelp+finCards+entrance nth-child9/10）"
```

---

### Task 13: 統合スモーク＋snapshot突合＋規制grep＋facts非流出（最終ハードニング）

**Files:**
- Create: `scratchpad/task13-bundleD-integration.js`
- Test: `tests/detail-rules.test.js`（既存緑を再確認）／既存 Python advice facts テスト（facts非流出）
- Verify: `scratchpad/detail-snapshot.js compare`

**Interfaces:**
- Consumes: 全 Task 1-12 の成果

- [ ] **Step 1: 全 node --test 緑を確認**

Run: `node --test`
Expected: finance-rules / detail-rules / cross-section / money-rules すべて PASS（新規テスト含む）

- [ ] **Step 2: snapshot 突合（既存カード無変化＋新カード出現）**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture`（新規baseは新カード込み）／既存ビューの DOM/style/canvas/pageerror が新カード以外で不変であることを目視確認。

- [ ] **Step 3: 統合スモーク**

`scratchpad/task13-bundleD-integration.js`：equity（JP/US）×多幅（1920/1024/768）で
- #dupont-card：恒等式3因数＋ROE・`netMargin*at*em ≈ roe`（DOMから数値抽出して検算）・SVGスパークライン・driver「純資産ベース」・免責。
- #fcf-trend-card：canvas・注記「概算FCF」・免責。
- ETF：両カード非表示。
- **規制grep**：両カードの innerHTML に禁止語彙（買い/売り/推奨/割安だから/上がる 等）が0。
- pageerror0。

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/task13-bundleD-integration.js`
Expected: PASS

- [ ] **Step 4: facts非流出（Python）**

既存の advice facts テスト（`tests/test_advice_facts.py` 相当）を実行し、グロッサリ/descriptor 追加が `mode_a_facts` に流出しないことを確認（束Dは detail-rules.js/finance-rules.js のみで advice.py/money-rules.js に非接触＝パリティ不変）。

Run: `python -m pytest tests/test_advice_facts.py -q`（存在するもの）
Expected: PASS（既存緑維持）

- [ ] **Step 5: Commit**

```bash
git add scratchpad/task13-bundleD-integration.js
git commit -m "test(bundleD): 統合スモーク（恒等式検算/ETF非表示/規制grep/facts非流出/pageerror0）"
```

---

## Self-Review（spec 突合）

**1. Spec coverage:**
- §3 divOrNull → Task 1 ✓／§4.1 assetTurnover/equityMultiplier/dupont → Task 2,3 ✓／§5.1 fcf/fcfMargin/cashConversion → Task 4 ✓
- §4.2 dupontFactorSeries/dupontDescriptor → Task 5,7 ✓／§5.2 fcfTrendSeries/fcfQualityDescriptor → Task 5,8 ✓／SVG → Task 6 ✓
- §4.5/§5.5 グロッサリ → Task 9 ✓／§4.3 renderDuPont → Task 10 ✓／§5.3 renderFCFTrend＋repaint → Task 11 ✓
- §6 配線＋finCards / §7 entrance nth-child → Task 12 ✓／§2 免責fail-closed → Task 10,11（各render自己完結）✓
- §8 成功基準/§10 検証（node/snapshot/統合/規制grep/facts） → Task 13 ✓／§9 0x0罠：DuPont=SVG無縁・FCF=.ht-chart明示高さ+repaint ✓

**2. Placeholder scan:** 各 render の `FIN_COLORS.cf.*`/`neonBarBg` 等は「既存を読んで一致させる」明示指示付き（値は既存単一源に従う）＝プレースホルダでなく参照指示。driver/quality句は固定中立文を完全記載。

**3. Type consistency:** `dupont(fin)` の返却キー（netMargin/assetTurnover/equityMultiplier/roe）は Task 3→5→7 で一致。`fcfTrendSeries` のキー（fcf/fcfMargin/cashConversion/operatingCf/investingCf）は Task 5→8→11 で一致。`dupontDescriptor.factors[i].termKey` はグロッサリ term（net-margin/asset-turnover/financial-leverage）と一致（Task 7,9）。`sparklineSVG(values,opts)` シグネチャは Task 6→10 一致。

## Execution Handoff

（skill 手順に従い、実装方式は本文で確認する。）
