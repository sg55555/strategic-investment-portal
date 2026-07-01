# detail-view 分離リファクタ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `#detail-view` のロジック/描画/スタイルを `index.html` の inline から4モジュール（`detail-rules.js`／`detail-charts.js`／`detail.js`／`detail.css`）へ、視覚・挙動を完全保存したまま段階抽出する。

**Architecture:** money-view と同型の分離アーキ（純関数＝rules / IIFE＝view / css）。detail は「rules（純計算）＋charts（LWC/Chart.js lifecycle・move-not-rewrite）＋detail.js（DOM/オーケストレーション/イベント・IIFE・curated window API）」の3層＋detail.css。各 Step は「移行前後で算出スタイル/DOM/挙動が完全一致」を headless snapshot と純関数 unit test で検証し、独立コミット・回帰即 revert。

**Tech Stack:** Vanilla JS（classic scripts・非module・全globalはwindowプロパティ）、Lightweight Charts v4.2.3、Chart.js 4.5.1、node --test（純関数）、Playwright（before-after snapshot）、診断モックサーバ（`scratchpad/mock_prod_server.py`）。

## Global Constraints

- **唯一の技術制約＝`display:none → createChart` の 0x0罠**：チャート容器（`#chart-container`/`#rsi-container`/`#macd-container`/`#compare-chart-container`）の寸法・初期化順序を不変に保つ。関係箇所＝`initPriceChart`（onload 2687 で hidden 生成）／`navigateToDetail` の `priceChart.resize(clientWidth,450)`（3727）＋`setTimeout(updateFinancialViews,150)`（3731）／`toggleRSI`/`toggleMACD` の rAF→lazy `initSubCharts`→resize（3160/3220）／`forceChartRepaint`（3753・rAF×2＋[300,700,1100]ms・`clientWidth>0` guard）／`onWindowResize`（2655・`currentView==='detail'`＋`clientWidth>0` guard）。
- **チャートは move-not-rewrite**：描画ロジック（`initPriceChart`/`makeCandleGlowPrimitive`/`updateMaAndVolume`/`initSubCharts`/`updateSubCharts`/`drawTRLines`/`render{BS,Radar,PL,CF,Compare}Chart`/`calc*`/`toggle*`）は1文字も変えず relocate。色・形状の**意味付け不変**（ローソク up=赤/down=青、ZigZag 逆規約 teal/pink）。※チャート改変 freeze は 2026-07-01 全面解除済だが、本リファクタでは視覚改善を混ぜない（before-after 完全一致検証を維持するため）。
- **視覚・挙動は完全不変**（純アーキ・リファクタ）。機能追加・データ層/バックエンド変更なし。
- **外部bare-global を再宣言しない**：`STOCK_DATA`/`getStock`（dataClient.js:14/56）、`FinanceRules`（finance-rules.js）、`Chart`/`LightweightCharts`（CDN）。detail モジュールは参照のみ。
- **中央ルーターは移さない**：`showView`/`_applyView`/`onHashChange`/`navigateToPortal`/`VIEW_IDS`/`currentView`（3947-3972 / 2324-2325）は main に残す（money.js も `window.showView` を使う）。detail は `window.showView('detail')` を呼ぶ。
- **共有シンボルは移さない**：`esc`（2279）/`ICO`（2284）/`currencyBadge`（2377）/`trackEvent`（3419）/`watchlist`（2425）/`isWatched`（2426）/`watchChipLabel`（2428）/`toggleWatchlist`（2431・portal+detail 共有）/`DEFAULT_*`（2297-2299）/`currentTicker`（2308・detail 書込だが portal/watchlist/compare 読取＝共有 let のまま）。
- **classic-script 読込順**：`index.html` は `detail-rules.js`（依存なし）→ `detail-charts.js`（依存: detail-rules/finance-rules/Chart/LWC）→ `detail.js`（依存: detail-charts/detail-rules）の順で `<script src>` 追加。既存 dataClient.js/finance-rules.js より後、money.js 前後は非依存。
- **inline onclick は温存**：`navigateToPortal`/`exportCSV`/`toggleMA`/`toggleBB`/`toggleSR`/`toggleTR`/`toggleRSI`/`toggleMACD`（markup 1821-1877）＋ compare-modal の `addToCompare`/`closeModal`/`compareSearchInput`/`openCompareModal`/`removeFromCompare`/`setComparePeriod` は、移設先モジュールが `window.<name> = <name>` で bare 名を維持（markup は無改変）。`switchYear` は `navigateToDetail` 内の `btn.onclick` closure ゆえ window 露出不要。
- **各 Step 後に検証**：`node --test tests/detail-rules.test.js`（Task1以降）＋ `node scratchpad/detail-snapshot.js`（before-after 突合）。**pageerror0・snapshot 完全一致が gate**。

---

## Task 0: 検証ハーネス + baseline スナップショット

**Files:**
- Create: `scratchpad/detail-snapshot.js`（Playwright before-after 突合ツール・scratchpad は配信外）
- Create: `scratchpad/detail-baseline.json`（現行 index.html の baseline・生成物）
- Use: `scratchpad/mock_prod_server.py`（既存・127.0.0.1:8200 で本番 index.html＋/api/market/* モック配信・`?diag=off` で「詳細を開く」ボタン注入。停止中なら `python scratchpad/mock_prod_server.py &` で起動）

**Interfaces:**
- Produces: `captureDetailSnapshot(page)` が返す JSON（各 Step の gate 比較キー）＝`{ domHash, computedStyles:{selector:{prop:value}}, canvasCount, chartContainerDims:{id:{w,h}}, windowApi:{name:bool}, pageErrors:[] }`。以降の全 Task がこの snapshot 一致を検証に使う。

- [ ] **Step 1: snapshot ツールを書く**

```js
// scratchpad/detail-snapshot.js — 現行 index.html の detail-view を開き、before-after 比較キーを収集/突合する。
// 視覚バグは headless では出ないが、DOM構造・算出スタイル・canvas数・chart寸法・window API・pageerror は確定できる。
const { chromium } = require('playwright');
const fs = require('fs');

// inline onclick が依存する window 名（Global Constraints の一覧）。抽出後も存在必須。
const WINDOW_API = ['navigateToPortal','exportCSV','toggleMA','toggleBB','toggleSR','toggleTR',
  'toggleRSI','toggleMACD','addToCompare','closeModal','compareSearchInput','openCompareModal',
  'removeFromCompare','setComparePeriod','toggleWatchlist','navigateToDetail','showView'];
// 算出スタイルを見張る detail 内セレクタ（代表・各カード/パネル/コントロール）。
const STYLE_SELECTORS = ['#detail-view','.back-bar','.dashboard-stack','#chart-container',
  '.card','.card-title','.grid-layout','.side-panel','.status-card','.panel-sign-value-large',
  '.ma-control-bar','.sub-chart-wrap','.kpi-compare-card','.type-badge','.detail-star-btn',
  '.active-company-title','.time-control-bar','.ai-analysis-card'];
const STYLE_PROPS = ['display','position','background','background-color','color','border','border-radius',
  'box-shadow','font-family','width','height','padding','margin','grid-template-columns','backdrop-filter'];

async function captureDetailSnapshot(page) {
  await page.waitForFunction(() => (typeof STOCK_DATA==='object' && STOCK_DATA && Object.keys(STOCK_DATA).length>0), { timeout: 8000 }).catch(()=>{});
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push('PE:'+e.message));
  // 詳細を開く（7203.T＝モック済 equity）。ETF/財務欠損は Task ごとに別途 open で追加検証。
  await page.evaluate(() => { if (typeof navigateToDetail==='function') navigateToDetail('7203.T'); });
  await page.waitForTimeout(1500);
  return await page.evaluate((cfg) => {
    const dv = document.getElementById('detail-view');
    const norm = (html) => html.replace(/\s+/g,' ').replace(/> </g,'><').trim();
    const domHash = norm(dv ? dv.innerHTML : '').length + ':' + norm(dv ? dv.outerHTML : '').slice(0,200);
    const computedStyles = {};
    cfg.STYLE_SELECTORS.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) { computedStyles[sel] = null; return; }
      const cs = getComputedStyle(el); const o = {};
      cfg.STYLE_PROPS.forEach(p => o[p] = cs.getPropertyValue(p));
      computedStyles[sel] = o;
    });
    const dims = {};
    ['chart-container','rsi-container','macd-container'].forEach(id => {
      const el = document.getElementById(id);
      dims[id] = el ? { w: el.clientWidth, h: el.clientHeight } : null;
    });
    const windowApi = {}; cfg.WINDOW_API.forEach(n => windowApi[n] = typeof window[n] === 'function');
    return {
      domHash,
      computedStyles,
      canvasCount: document.querySelectorAll('#detail-view canvas').length,
      chartContainerDims: dims,
      windowApi,
    };
  }, { STYLE_SELECTORS, STYLE_PROPS, WINDOW_API }).then(r => ({ ...r, pageErrors }));
}

async function run() {
  const mode = process.argv[2] || 'capture'; // capture | compare
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto('http://localhost:8200/?diag=off', { waitUntil: 'networkidle' });
  const snap = await captureDetailSnapshot(page);
  await browser.close();
  const path = __dirname + '/detail-baseline.json';
  if (mode === 'capture') {
    fs.writeFileSync(path, JSON.stringify(snap, null, 2));
    console.log('baseline saved. canvases=' + snap.canvasCount + ' pageErrors=' + snap.pageErrors.length +
      ' windowApi=' + Object.values(snap.windowApi).filter(Boolean).length + '/' + Object.keys(snap.windowApi).length);
  } else {
    const base = JSON.parse(fs.readFileSync(path, 'utf8'));
    const diffs = [];
    if (JSON.stringify(base.computedStyles) !== JSON.stringify(snap.computedStyles)) diffs.push('computedStyles');
    if (base.domHash !== snap.domHash) diffs.push('domHash: '+base.domHash+' -> '+snap.domHash);
    if (base.canvasCount !== snap.canvasCount) diffs.push('canvasCount '+base.canvasCount+' -> '+snap.canvasCount);
    if (JSON.stringify(base.chartContainerDims) !== JSON.stringify(snap.chartContainerDims)) diffs.push('chartContainerDims');
    if (JSON.stringify(base.windowApi) !== JSON.stringify(snap.windowApi)) diffs.push('windowApi: '+JSON.stringify(snap.windowApi));
    if (snap.pageErrors.length) diffs.push('pageErrors: '+JSON.stringify(snap.pageErrors));
    console.log(diffs.length ? ('❌ DIFFS:\n  '+diffs.join('\n  ')) : '✅ MATCH (snapshot identical, pageerror0)');
    process.exit(diffs.length ? 1 : 0);
  }
}
run();
```

- [ ] **Step 2: モックサーバ稼働を確認し baseline を取得**

Run:
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8200/?diag=off  # 200 でなければ python scratchpad/mock_prod_server.py & で起動
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
```
Expected: `baseline saved. canvases=11 pageErrors=0 windowApi=17/17`（canvas数は現行実測に合わせる。windowApi は全て true）。

- [ ] **Step 3: baseline を確認（この時点で compare は MATCH のはず）**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare`
Expected: `✅ MATCH (snapshot identical, pageerror0)`（baseline 自身との比較＝一致）。

- [ ] **Step 4: コミット（ハーネスのみ・本番コード無改変）**

```bash
cd /home/shugo/apps/investment-portal
git add scratchpad/detail-snapshot.js
git commit -m "test(portal): detail-view before-after snapshot harness (Task0)"
```
（`scratchpad/detail-baseline.json` は生成物ゆえ commit 不要。`.gitignore` 済みでなければ add しない。）

---

## Task 1: detail-rules.js（純関数抽出・TDD）

**Files:**
- Create: `detail-rules.js`（UMD-lite・`window.DetailRules` ＋ `module.exports`。finance-rules.js のヘッダ形式に厳密に合わせる）
- Create: `tests/detail-rules.test.js`（node --test・`tests/finance-rules.test.js` と同型）
- Modify: `index.html`（純計算箇所を `DetailRules.*` 呼び出しに差し替え＋`<script src="detail-rules.js">` 追加）

**Interfaces:**
- Produces（detail-charts.js/detail.js が消費する純関数・DOM非依存）:
  - `DetailRules.priceWindow(prices, selectedYear, isUS)` → `{ startDate, endDate, filteredPrices, displayPrices }`（現 3804-3812。US=暦年 / JP=前年4月〜当年3月 filter、0件は `prices.slice(-200)`）
  - `DetailRules.periodLabel(companyName, ticker, year, isUS, hasFiltered)` → `string`（現 3814-3821）
  - `DetailRules.financialMaxAbs(fin)` → `number`（現 3780-3789 の15項目 max|abs|。FinanceRules.n/totalAssets を使用）
  - `DetailRules.marketBasisFor(isUS)` → `{perLow,perHigh,pbrLow,pbrHigh,label}`（現 MARKET_BASIS 2303-2306＋selector 3839）
  - `DetailRules.perStatus(rawPer, basis)` → `{cardClass,valColor,statusText}`（現 3858-3874）
  - `DetailRules.pbrStatus(rawPbr, basis, isUS)` → `{cardClass,valColor,statusText}`（現 3876-3897）
  - `DetailRules.equityRatioDesc(isUS)` / `DetailRules.currentRatioDesc(isUS)` → `string`（現 3902-3907）
  - `DetailRules.yoyBadge(curr, prev)` → `string`（HTML・現 3499-3505）
  - テクニカル純関数（配列→配列・現 3029-3351）: `calcMA`/`calcBB`/`detectSR`/`calcRSI`/`calcEMA`/`calcMACD`/`calcZigZag`/`autoZigZagDeviation`/`volumeColorData`（3555-3559）
  - 財務段ビルダー（純・現 4299-4510）: `plSteps(fin)`/`cfWaterfall(fin)`/`cfCompanyType(op,inv,fin)`/`cfFlowStatus(value,kind)`/`radarScores(fin,ticker)`
  - 色/特例定数: `DetailRules.FIN_COLORS`/`CF_BADGE_PAIR`/`COMPARE_COLORS`/`HOLDING_COMPANIES`（現 2218/2200/2453/2301。段ビルダー・チャートが参照）
- Consumes: `FinanceRules`（既存・重複禁止＝`n`/`totalAssets`/`equityRatio`/`currentRatio`/`opMargin`/`netMargin`/`roe`/`roa`/`ratio`/`clampScore`/`hasValue`/`pickUnit`/`unitLabel`/`fmtUnit`/`fmtUnitValue`/`fmtMagnitude` を委譲）

**注記:** 純関数は「値/クラス/色/文言の descriptor オブジェクトを返す」形にし、DOM 書込は呼び出し側（Task3 の detail.js）に残す。これで現在 `updateFinancialViews`/`render*Chart` 内で「計算と DOM 変更が密結合」している箇所を、descriptor 返し＋呼び出し側適用に割り、算出結果を不変に保つ。テクニカル/段ビルダーは現在も純粋ゆえ verbatim relocate。

- [ ] **Step 1: finance-rules.js のヘッダ形式を確認（模倣元）**

Run: `sed -n '1,20p;/module.exports/,+5p' finance-rules.js`（UMD-lite の開始/終了パターンを確認し detail-rules.js に合わせる）
Expected: `(function(root,factory){...})(...)` 形式で `root.FinanceRules = ...` と `module.exports` の両対応。

- [ ] **Step 2: 失敗するテストを書く（純関数の代表挙動を固定）**

`tests/detail-rules.test.js`（抜粋・実装前は import で落ちる）:
```js
const test = require('node:test');
const assert = require('node:assert');
const FinanceRules = require('../finance-rules.js');   // detail-rules が委譲する既存純関数
global.FinanceRules = FinanceRules;                    // classic-script 参照を node で満たす
const DetailRules = require('../detail-rules.js');

test('priceWindow: US は暦年で絞る', () => {
  const prices = [{time:'2022-12-31',close:1},{time:'2023-06-01',close:2},{time:'2023-12-31',close:3},{time:'2024-01-02',close:4}];
  const r = DetailRules.priceWindow(prices, 2023, true);
  assert.deepStrictEqual(r.displayPrices.map(p=>p.time), ['2023-06-01','2023-12-31']);
});
test('priceWindow: JP は前年4月〜当年3月', () => {
  const prices = [{time:'2022-03-31',close:1},{time:'2022-04-01',close:2},{time:'2023-03-31',close:3},{time:'2023-04-01',close:4}];
  const r = DetailRules.priceWindow(prices, 2023, false);
  assert.deepStrictEqual(r.displayPrices.map(p=>p.time), ['2022-04-01','2023-03-31']);
});
test('priceWindow: 0件は末尾200件フォールバック', () => {
  const prices = Array.from({length:250},(_,i)=>({time:'1999-01-01',close:i}));
  const r = DetailRules.priceWindow(prices, 2050, true);
  assert.strictEqual(r.displayPrices.length, 200);
});
test('perStatus: 割安は green', () => {
  const b = DetailRules.marketBasisFor(false);
  const s = DetailRules.perStatus(b.perLow, b);
  assert.strictEqual(s.cardClass, 'green');
});
test('perStatus: 0 はデータなし中立', () => {
  const b = DetailRules.marketBasisFor(false);
  assert.strictEqual(DetailRules.perStatus(0, b).cardClass, '');
});
test('cfCompanyType: 営業+/投資-/財務- は excellent', () => {
  assert.strictEqual(DetailRules.cfCompanyType(100,-50,-30).cfType, 'excellent');
});
test('calcMA: 期間平均', () => {
  const out = DetailRules.calcMA([{time:'a',close:2},{time:'b',close:4},{time:'c',close:6}], 2);
  assert.strictEqual(out[out.length-1].value, 5);
});
```
（実装後に現行値と付き合わせて `perStatus`/`pbrStatus`/`cfFlowStatus` の分類しきい値・色・文言を **現 index.html の値そのまま** で固定する。テストは「抽出で値が変わっていない」ことの錠。）

- [ ] **Step 3: テストが落ちることを確認**

Run: `node --test tests/detail-rules.test.js`
Expected: FAIL（`Cannot find module '../detail-rules.js'`）。

- [ ] **Step 4: detail-rules.js を実装（現行ロジックを純関数として移植）**

- ヘッダは finance-rules.js と同形の UMD-lite。`FinanceRules` は classic では global、node では `global.FinanceRules`（テストで注入済）を参照。
- テクニカル純関数（`calcMA`/`calcBB`/`detectSR`/`calcRSI`/`calcEMA`/`calcMACD`/`calcZigZag`/`autoZigZagDeviation`）は index.html 3029-3351 から **本体を1文字も変えず** 移植（histogram/volume の色文字列も現状のまま）。
- `priceWindow`/`periodLabel`/`financialMaxAbs`/`marketBasisFor`/`perStatus`/`pbrStatus`/`equityRatioDesc`/`currentRatioDesc`/`yoyBadge`/`plSteps`/`cfWaterfall`/`cfCompanyType`/`cfFlowStatus`/`radarScores`/`volumeColorData` は、現 index.html の該当行（Interfaces に明記）から「計算部のみ」を抜き、**同じ入力→同じ descriptor** を返す純関数化。しきい値/色/文言は現物を verbatim コピー。
- 定数 `FIN_COLORS`/`CF_BADGE_PAIR`/`COMPARE_COLORS`/`HOLDING_COMPANIES` を index.html から移し、`DetailRules` に同梱 export（Task2 の detail-charts がこれを参照）。

Skeleton:
```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.DetailRules = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const FR = (typeof FinanceRules !== 'undefined') ? FinanceRules
    : (typeof global !== 'undefined' ? global.FinanceRules : null);
  const FIN_COLORS = { /* index.html 2218- から verbatim */ };
  const CF_BADGE_PAIR = { /* 2200- */ };
  const COMPARE_COLORS = [ /* 2453 */ ];
  const HOLDING_COMPANIES = new Set([ /* 2301 */ ]);
  function priceWindow(prices, selectedYear, isUS) { /* 3804-3812 の計算部 */ }
  function perStatus(rawPer, basis) { /* 3858-3874 → {cardClass,valColor,statusText} */ }
  // ... 他 Interfaces の全純関数 ...
  return { priceWindow, periodLabel, financialMaxAbs, marketBasisFor, perStatus, pbrStatus,
    equityRatioDesc, currentRatioDesc, yoyBadge, plSteps, cfWaterfall, cfCompanyType, cfFlowStatus,
    radarScores, volumeColorData, calcMA, calcBB, detectSR, calcRSI, calcEMA, calcMACD, calcZigZag,
    autoZigZagDeviation, FIN_COLORS, CF_BADGE_PAIR, COMPARE_COLORS, HOLDING_COMPANIES };
});
```

- [ ] **Step 5: テストが通ることを確認**

Run: `node --test tests/detail-rules.test.js`
Expected: PASS（全ケース緑）。しきい値/色/文言は現物コピーなので値一致。

- [ ] **Step 6: index.html を DetailRules 呼び出しへ差し替え＋script追加**

- `<head>` の finance-rules.js `<script>` 直後に `<script src="detail-rules.js"></script>` を追加（依存: finance-rules → detail-rules）。
- `updateFinancialViews`（3770-3944）内の該当計算を `DetailRules.priceWindow(...)` / `DetailRules.financialMaxAbs(fin)` / `DetailRules.marketBasisFor(isUS)` / `DetailRules.perStatus/pbrStatus/equityRatioDesc/currentRatioDesc` へ置換し、**DOM 書込（card.className/style.color/innerText 等）は descriptor を適用する形で残す**（挙動不変）。
- `renderKpiCompare`（3484-3548）の YoY を `DetailRules.yoyBadge`、`render{BS,Radar,PL,CF}Chart` の段/スコア/分類計算を `DetailRules.plSteps/cfWaterfall/cfCompanyType/cfFlowStatus/radarScores/volumeColorData` へ置換（描画呼び出し自体は Task2 で移すのでここでは計算のみ委譲）。
- index.html 側の重複定義（移した純関数・定数）を削除（`calc*`/`FIN_COLORS` 等は Task2 の relocate と重複しないよう、この Task では detail-rules に集約したものを index から消す。ただし `toggle*`/`render*`/`draw*` 等の**描画関数はまだ index に残す**＝Task2 で移す）。

- [ ] **Step 7: snapshot 一致を検証（挙動不変の gate）**

Run:
```bash
node --test tests/detail-rules.test.js
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: unit test PASS ＋ `✅ MATCH (snapshot identical, pageerror0)`。差分が出たら DetailRules の descriptor 適用漏れ＝該当箇所を戻して再突合。

- [ ] **Step 8: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js index.html
git commit -m "refactor(portal): detail純計算を detail-rules.js へ抽出+unit test (Task1・挙動不変)"
```

---

## Task 2: detail-charts.js（チャート lifecycle を move-not-rewrite で隔離）

**Files:**
- Create: `detail-charts.js`（IIFE・`window.DetailCharts` ＋ inline onclick 用に `window.toggle*` bare 名を維持）
- Modify: `index.html`（チャート関数/インスタンス/状態を除去し `<script src="detail-charts.js">` 追加＋onload/onWindowResize の呼び出しを DetailCharts 経由へ）

**Interfaces:**
- Produces（detail.js が消費）:
  - `DetailCharts.initPriceChart()`（現 3619-3692・onload から呼ぶ・hidden 生成）
  - `DetailCharts.updateMaAndVolume(displayPrices, allPrices)`（現 3550-3585）
  - `DetailCharts.renderBSChart(fin)/renderRadarChart(fin)/renderPLChart(fin)/renderCFChart(fin)`（現 3981-4589）
  - `DetailCharts.setCandleData(displayPrices)`（`candleSeries.setData` の薄いラッパ・現 3823 相当）
  - `DetailCharts.repaint()`（現 forceChartRepaint 3753-3768 を移設・`clientWidth>0` guard 保持）
  - `DetailCharts.onWindowResize()`（現 2655-2675 を移設・`currentView==='detail'`＋`clientWidth>0` guard 保持）
  - `DetailCharts.renderCompareChart()`（現 2523-2549）
  - window 露出（inline onclick 温存）: `toggleMA`/`toggleBB`/`toggleSR`/`toggleTR`/`toggleRSI`/`toggleMACD`
- Consumes: `DetailRules`（`calc*`/`FIN_COLORS`/`CF_BADGE_PAIR`/`COMPARE_COLORS`/`HOLDING_COMPANIES`/段ビルダー）、`FinanceRules`（単位/比率）、`Chart`/`LightweightCharts`（CDN）、`STOCK_DATA`/`currentTicker`/`selectedYear`/`pageUnit`（Task3 が所有・当面は共有 let 参照）、`neonGlowPlugin`（Chart.js 登録が必要）

**跨ぎ結合の扱い（Global Constraints 準拠）:**
- チャートインスタンス/系列/状態（2311-2346・priceChart/candleSeries/volumeSeries/ma*Series/bb*Series/srLines/trSeries/rsiChart/macdChart/*Series/currentDisplayPrices/subChartsTimeSyncBound、maState/bbState/srState/rsiState/macdState/trState）は **detail-charts.js のクロージャへ移動**（bare-global 解消の中核）。
- `makeCandleGlowPrimitive`（3589-3617）と `currentDisplayPrices` は同一モジュール内に置く（per-frame 隠れ結合）。
- `neonGlowPlugin`/`NEON_TEXT_GLOW`/`neonBarBg*`/`neonEdge*`/`_hexRgba`/`_specTop`/`_specBot`/`applyCfTypeBadge`（2192-2273）も detail-charts へ移す（`Chart.register(neonGlowPlugin)` は module 内で実行）。
- `priceChart`/`rsiChart`/`macdChart`/`compareChart` は `onWindowResize` も触るため、`onWindowResize` を detail-charts に移し、index.html の `window.addEventListener('resize', ...)`（2685）は `DetailCharts.onWindowResize` を呼ぶよう差し替え（`currentView` は共有参照で読む）。
- `initPriceChart` の onload 呼び出し（2687）は `DetailCharts.initPriceChart()` へ差し替え（**hidden 生成→初回 resize の順序を不変に**）。

- [ ] **Step 1: detail-charts.js の枠を作り、チャート関数/状態を verbatim relocate**

- IIFE 枠（money.js 同型）を作り、2192-2273（neon helpers/plugin）＋2311-2346・2450-2453（instance/state/const）＋3029-3417（calc*/toggle*/apply*/init*/update*/draw*）＋3550-3585（updateMaAndVolume）＋3589-3692（glow/initPriceChart）＋2512-2549（normalizeForCompare/renderCompareChart）＋3753-3768（forceChartRepaint→`repaint`）＋2655-2675（onWindowResize）＋3981-4589（render{BS,Radar,PL,CF}Chart）を **本体無改変** で移す。
- `calc*` 等が Task1 で detail-rules へ移った純関数は、detail-charts から `DetailRules.calcMA(...)` 参照へ置換（重複を残さない）。※Task1 で detail-rules に入れた `calc*` は index からは Task1 Step6 で消していないので、この Task で「detail-charts は DetailRules を参照／index の calc* 定義は削除」を同時に行う。
- `Chart.register(neonGlowPlugin)` を module 内で1回。
- `window.toggleMA=toggleMA` 等、inline onclick が呼ぶ6関数を bare 名で露出。`window.DetailCharts = { initPriceChart, updateMaAndVolume, setCandleData, renderBSChart, renderRadarChart, renderPLChart, renderCFChart, repaint, onWindowResize, renderCompareChart }`。

- [ ] **Step 2: index.html から移設分を除去し、呼び出しを DetailCharts 経由へ**

- `<head>` に `<script src="detail-charts.js"></script>` を detail-rules.js の後に追加。
- index.html inline から移した関数/インスタンス/状態/定数の定義を削除。
- onload（2687）: `initPriceChart()` → `DetailCharts.initPriceChart()`。
- resize バインド（2685）: `onWindowResize` → `DetailCharts.onWindowResize`。
- `updateFinancialViews` 内の `candleSeries.setData`→`DetailCharts.setCandleData`、`updateMaAndVolume(...)`→`DetailCharts.updateMaAndVolume(...)`、`forceChartRepaint()`→`DetailCharts.repaint()`、`renderBSChart/...`→`DetailCharts.renderBSChart/...`（この Task では updateFinancialViews はまだ index に残す＝呼び先だけ差し替え）。
- `navigateToDetail` 内の `priceChart.resize(container.clientWidth,450)`（3727）は priceChart がクロージャに入るため `DetailCharts` に薄い `resizePrice(w,h)` を足して差し替え（0x0 の初回 resize 順序を保持）。

- [ ] **Step 3: snapshot 一致を検証（canvas数/chart寸法/pageerror が要）**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare`
Expected: `✅ MATCH`（特に `canvasCount`＝11・`chartContainerDims` 不変・pageerror0）。加えて **RSI/MACD/BB/SR/TR/compare の toggle を手動確認**（0x0罠の実挙動は snapshot 外なので、モックを実ブラウザで開き各 toggle が描画されるか目視、または snapshot に toggle 後の canvas 数チェックを追加）。

- [ ] **Step 4: 0x0罠の実挙動を追加検証（toggle 後の再描画）**

`scratchpad/detail-snapshot.js` に一時的な toggle シーケンス（`toggleRSI();toggleMACD();toggleTR()` 後の canvas 数・pageerror）を足して実行、または実ブラウザ（モック）で目視。
Expected: RSI/MACD サブパネルが表示（0x0 でない）・pageerror0。

- [ ] **Step 5: コミット**

```bash
git add detail-charts.js index.html
git commit -m "refactor(portal): チャートlifecycleを detail-charts.js へ move-not-rewrite隔離 (Task2・挙動不変)"
```

---

## Task 3: detail.js（DOM/オーケストレーション/イベント・IIFE）

**Files:**
- Create: `detail.js`（IIFE・`window.Detail` ＋ inline onclick/cross-module 用 bare 名を維持）
- Modify: `index.html`（detail オーケストレーション/DOM/compare ハンドラを除去し `<script src="detail.js">` 追加）

**Interfaces:**
- Produces（inline onclick・portal からの呼び出し・cross-module 用に bare 名維持）:
  - `navigateToDetail(ticker)`（3694-3734・portal 行 `tr.onclick` 2846 が呼ぶ）
  - `exportCSV()`（3425-3428）
  - compare-modal: `openCompareModal()`（2455）/`compareSearchInput()`（2464）/`addToCompare(t)`（2477）/`removeFromCompare(t)`（2488）/`setComparePeriod(m)`（2505・`event` 依存を引数 or `window.event` 明示で保持）/`closeModal(id,event)`（2594・共有ゆえ main 残置でも可＝現状維持を優先）
  - `window.Detail = { navigateToDetail, updateFinancialViews, switchYear }`（内部用）
- Consumes: `DetailRules`（純計算）、`DetailCharts`（描画）、`FinanceRules`、`window.showView`（ルーター）、`STOCK_DATA`/`getStock`、共有 `esc`/`ICO`/`currencyBadge`/`trackEvent`/`isWatched`/`watchChipLabel`/`toggleWatchlist`/`currentTicker`/`watchlist`
- 内部状態をクロージャ化: `selectedYear`/`pageUnit`/`compareSet`/`comparePeriodMonths`（`currentTicker` は共有 let のまま＝portal/watchlist 読取のため）

- [ ] **Step 1: detail.js の枠を作り、オーケストレーション/DOM/compare を relocate**

- IIFE 枠（money.js 同型）。`navigateToDetail`/`switchYear`/`updateFinancialViews`/`renderKpiCompare`/`exportCSV`/`_doExportCSV`/`animateNumber`/`fmtBillion`＋compare ハンドラ（`openCompareModal`/`compareSearchInput`/`addToCompare`/`removeFromCompare`/`renderCompareChips`/`setComparePeriod`）を移す。
- `updateFinancialViews` は Task1/2 で計算→DetailRules・描画→DetailCharts に委譲済の形で移す（本体はその委譲版）。**forceChartRepaint 呼び出し位置（ETF/!fin early-return より前）を厳守**。
- `selectedYear`/`pageUnit`/`compareSet`/`comparePeriodMonths` をクロージャ内 let に。`pageUnit` は DetailCharts も読むため、`DetailCharts` に `setPageUnit(u)` を足すか、`updateFinancialViews` が render 呼び出し時に unit を引数で渡す形へ（挙動不変の範囲で最小結線）。
- window 露出: inline onclick が呼ぶ bare 名（`navigateToDetail`/`exportCSV`/`openCompareModal`/`compareSearchInput`/`addToCompare`/`removeFromCompare`/`setComparePeriod`）＋`window.Detail`。`switchYear` は navigateToDetail 内 closure ゆえ露出不要。

- [ ] **Step 2: index.html から detail オーケストレーションを除去し script 追加**

- `<head>` に `<script src="detail.js"></script>` を detail-charts.js の後に追加。
- 移した関数群を index.html inline から削除。onload の `initPriceChart` 呼び出し（Task2 で DetailCharts 化済）等、残る main 側（router/onload/portal/onWindowResize バインド）は保持。
- `setComparePeriod` の暗黙 `event` 依存は、markup が `onclick="setComparePeriod(3)"` 形なら関数内で `window.event` を明示参照 or 引数化して挙動保持（現状踏襲を優先し `window.event` 明示が最小変更）。

- [ ] **Step 3: snapshot 一致＋主要導線の実挙動を検証**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare`
Expected: `✅ MATCH`。加えてモック実ブラウザで **株式（7203.T）/ETF（合成 or SPY モック）/財務欠損年** を開き、ヘッダ/KPI/AI コメント/年ボタン切替（switchYear）/compare モーダル/CSV/ウォッチ星が現行同等に動作・pageerror0 を目視（headless snapshot＋手動の二段）。

- [ ] **Step 4: detail 由来 bare-global の解消を確認**

Run: `grep -nE '^\s+(let|const|function) ' index.html | grep -Ei 'priceChart|candleSeries|selectedYear|pageUnit|compareSet|rsiState|macdState|renderBSChart|updateFinancialViews|navigateToDetail'`（inline に残っていないこと＝空を期待。`currentTicker` 等の意図的共有は除く）
Expected: detail 専用シンボルが inline から消えている（空 or 共有のみ）。

- [ ] **Step 5: コミット**

```bash
git add detail.js index.html
git commit -m "refactor(portal): detailオーケストレーション/DOM/compareを detail.js(IIFE)へ抽出 (Task3・挙動不変)"
```

---

## Task 4: detail.css（detail 専用スタイル抽出）

**Files:**
- Create: `detail.css`
- Modify: `index.html`（`<style>` から detail 専用ルールを移し `<link rel="stylesheet" href="detail.css">` 追加）

**Interfaces:**
- Produces: `detail.css`（detail 専用セレクタ＋その @media 上書き）。**セレクタ・値・トークン参照（`var(--ix-*)`）は不変**。

**移動する（detail-only・css インベントリ準拠）:** `.back-bar`(507)/`.time-btn-group`/`.time-btn`(539)/`.dashboard-stack`(569)/`#chart-container`(610)/`.grid-layout`(614)/`.chart-main-area`(628)/`.side-panel`(635)/`.status-card`＋色変種(648)/`.panel-*`(723/745)/`.type-badge`(778)/`.full-width-area`(799)/`.detail-star-btn`(817)/`.compare-*`＋`#compare-chart-container`(922-1064)/`.open-compare-btn`(1051)/`.ma-control-bar`一式(1344)/`.sub-chart-wrap`＋`#rsi/#macd-container`(1405)/`.sector-badge`(1428)/`.active-company-title`系(1442)/`.time-control-bar`系(1466)/`.ai-analysis-*`(1510)/`.kpi-*`＋`@keyframes kpiReveal`(1551/1673)/`@keyframes cardFadeInUp`＋`.dashboard-stack.animate-cards .card`(1695)＋これらの **@media 上書き（1236-1240/1253-1273/1283-1289/1300-1311/1257/1287/1311 等）**。

**移動しない（shared-base・誤移動注意）:** `:root` トークン(53)/`body`/`.container`(117)/`.view-section`(252)/`.back-btn`(518・detail+money 共有)/`.star-btn`(805・portal)/`screening-*`(832)/`.contact-*`(1067)/`.site-footer`(1102)/`.modal-overlay`/`.modal-box`/`.modal-close`/`.modal-title`等(1126-1216・全モーダル共有)/`.grid-bg`(1648)/`.hud-ico`/`.val-badge`/`.safety-*`/`.sparkline-*`等(420・portal)。

**⚠️判断保留の2件（この Task で決める）:**
- `.card`/`.card-title`(577/598)＝現状 detail のみ使用だが generic 名。**保守的に index.html 基底へ残す**（spec の「共有基底は残す」に従い、将来 portal 流用時の破壊回避）。＝detail.css へは移さない。
- `.compare-*` は #detail-view 外（#compare-modal 2066）だが機能 detail。detail.css へ移すが、セレクタが `#detail-view` 配下前提でないことを保つ（現状もグローバルセレクタ）。

- [ ] **Step 1: detail.css を作り detail-only ルールを verbatim 移動**

上記「移動する」セレクタ＋その @media 上書きを、`<style>`(48-1708) から **値・順序・トークン参照を一切変えず** `detail.css` へ移す。0x0罠対象の容器（`#chart-container`/`#rsi-container`/`#macd-container`/`#compare-chart-container`）は寸法値不変。

- [ ] **Step 2: index.html に link 追加＋移動分を style から削除**

- `<head>` の既存 `<link>`（money.css 等）付近に `<link rel="stylesheet" href="detail.css">` を追加（**基底トークン `:root` は index.html 側に残るので detail.css は後読みで問題なし**＝カスケード順は同等になるよう既存 money.css と同じ位置に置く）。
- 移した detail-only ルールを `<style>` から削除。`.card`/`.card-title`/shared-base は残す。

- [ ] **Step 3: 算出スタイル完全一致を検証（最重要 gate）**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare`
Expected: `✅ MATCH`（`computedStyles` の全セレクタ×全プロパティが baseline と一致・domHash 不変・pageerror0）。1つでも差分＝カスケード順/セレクタ/値のズレ＝該当を戻して再突合。narrow 幅の @media 上書き漏れは snapshot の viewport を変えて追加確認（`page.setViewportSize` で 1024/768/480 を回す拡張を一時追加）。

- [ ] **Step 4: コミット**

```bash
git add detail.css index.html
git commit -m "refactor(portal): detail専用CSSを detail.css へ抽出 (Task4・算出スタイル不変)"
```

---

## Task 5: 最終検証・統合スモーク

- [ ] **Step 1: 全 gate を通し確認**

Run:
```bash
node --test tests/detail-rules.test.js
node --test tests/finance-rules.test.js   # 既存回帰(83緑)
node --test tests/money-rules.test.js      # 既存回帰(72緑)
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: 全 unit test 緑 ＋ snapshot `✅ MATCH`。

- [ ] **Step 2: 複数銘柄・複数幅の実挙動スモーク（headless）**

モック実ブラウザ（1920/1024/768）で 株式/ETF/財務欠損年 を開き、全カード描画・全 toggle・compare・switchYear・CSV・ウォッチ・pageerror0 を確認（0x0罠の実挙動は snapshot 外＝ここで担保）。

- [ ] **Step 3: index.html 縮小の確認（DoD）**

Run: `wc -l index.html detail-rules.js detail-charts.js detail.js detail.css`
Expected: index.html が有意に縮小（detail ロジック/描画/スタイルが4モジュールへ移動）・detail 由来 bare-global 解消。

- [ ] **Step 4: 本番デプロイは別途**（本人承認＋`git push`＋Vercel curl＋実機サニティ）。この plan の範囲は挙動不変の抽出まで。デプロイ前に各 Step の snapshot 一致を敵対検証 workflow で再確認する（広さ停止で決定済の方式）。

---

## Self-Review（この plan の点検）

- **Spec coverage:** spec §4 の4モジュール＝Task1-4 に対応。§6 Step0-4＝Task0-4。§7 検証＝Task0 ハーネス＋各 Task の compare gate＋Task1 unit test。§8 DoD＝Task3 Step4（bare-global 解消）＋Task5 Step3（縮小）。§9 リスク（Step2 チャート）＝Task2 の move-not-rewrite＋0x0 追加検証（Task2 Step4）。§10 広さ＝Task5 Step4 に敵対検証 workflow を明記。
- **Placeholder scan:** 「TBD/後で」等なし。move は「該当行から verbatim relocate」＋新規 glue（module skeleton/test/harness）は完全コード。moved 本体を再掲しないのは意図（verbatim relocate ＝行番号明示）で、writing-plans の「complete code」は新規コードに適用。
- **Type consistency:** `captureDetailSnapshot`（Task0 産・全 Task 消費）／`DetailRules.*`（Task1 産・Task2/3 消費）／`DetailCharts.*`（Task2 産・Task3 消費）／`window.Detail`（Task3）で命名一貫。inline onclick 用 bare 名（`toggle*`＝Task2、`navigateToDetail`/`exportCSV`/compare 系＝Task3）を Global Constraints と各 Interfaces で一致。
- **既知の補正（インベントリ発）:** `.card`/`.card-title` は detail のみ使用だが generic 名ゆえ基底残置（Task4 判断保留で明示）。`compareChart`/compare-modal は #detail-view 外だが機能 detail（Task2/4 で扱い明記）。`onWindowResize`/`initPriceChart` の跨ぎ（Task2 で DetailCharts 化＋呼び出し差し替え）。`currentTicker` は共有 let 維持（privatize しない）。
