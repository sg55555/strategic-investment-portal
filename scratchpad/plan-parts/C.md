## Part C: Task 12-16（B2 描画層・後半＋B3 CSS/DOM）

### Task 12: P6 債務超過注記 `bsNotePlugin`（spec §11.1・D22）

**Files:**
- Modify: `detail-charts.js:147`（`Chart.register(bsLeaderPlugin);` の直後に `bsNotePlugin` 定義＋登録＝約24行）
- Modify: `detail-charts.js:966-967`（`$neonSpecs`/`$bsLeaders` 書込の直後に `$bsNote` 書込＝3行）
- Modify: `scratchpad/bs-callout-verify.js:21`（銘柄セットに SBUX 追加）・`:30`（`axisBandWide` 追加）・`:42`（evaluate 戻り値に noteRect/noteText 追加）・`:55` の直後（注記アサート群）

**Interfaces:**
- Consumes: renderBSChart closure の `unit`（detail-charts.js:756＝チャート別単位）・`hasNegativeEquity`（:747）・`isMobile`（:745）・`fin.net_assets`／`FinanceRules.fmtUnitValue(val, unit)`（finance-rules.js:129・既存）
- Produces: `chart.$bsNote = { text } | null`（gate。neonGlow/bsLeader と同型の3例目）・`chart.$bsNoteRect = {x,y,w,h} | null`（受入用の書き戻し）。**`window` 直下への新規公開なし**（spec §14 IIFE 規律）。**datalabels 内部 API（`$datalabels`/`$layout._box._rect`）に一切依存しない**＝プラグイン更新でリード線が死んでも注記は生存（D22 の採用理由）。

- [ ] **Step 1: 受入アサートを先に書く（実装前＝現状で FAIL することを確認するため）**

`scratchpad/bs-callout-verify.js:21` の銘柄ループに SBUX を追加（8銘柄目・非低棒側の債務超過対照）:

```js
    for (const t of ["6758.T", "8306.T", "7203.T", "4755.T", "NVDA", "BRK-B", "MCD", "SBUX"]) {
```

`:30` の `axisBand` 定義の直後に、注記専用の拡張帯を追加（**既存 `axisBand` は不変**＝現行 green のチップ系アサートを壊さないため。spec §11.3 の「判定域を `y: ca.top-8` へ広げる」は注記側だけに適用する）:

```js
        const axisBand = { x: ca.left - chart.scales.y.width, y: ca.top, w: chart.scales.y.width, h: ca.bottom - ca.top };
        // spec §11.3: 注記チップは chartArea の上（top:65 帯）に出るため、y軸 tick ラベルの上半分との近接を
        //  検出できるよう注記専用に 8px 上へ広げた帯を使う（チップ系の既存アサートは axisBand のまま）。
        const axisBandWide = { x: axisBand.x, y: ca.top - 8, w: axisBand.w, h: (ca.bottom - ca.top) + 8 };
```

`:42` の return を書換:

```js
        return { cw, ch, axisBand, axisBandWide, chips, bars, leaders: (chart.$bsLeaders || []).length,
                 noteRect: chart.$bsNoteRect || null, noteText: (chart.$bsNote || {}).text || null };
```

`:55`（`チップ×バー矩形の交差 0` の check）の直後に追加:

```js
      // spec §11.3: P6 債務超過注記（実DB該当は MCD/SBUX の FY2023-2025 のみ・全 USD 億ドル層）
      const NEG = ["MCD", "SBUX"];
      if (NEG.includes(t)) {
        check(`${t}@${width}: 注記 $bsNoteRect 非null`, !!r.noteRect);
        if (r.noteRect) {
          const nr = r.noteRect;
          check(`${t}@${width}: 注記のcanvas外クリップ 0`, nr.x >= 0 && nr.y >= 0 && nr.x + nr.w <= r.cw && nr.y + nr.h <= r.ch);
          check(`${t}@${width}: 注記×低棒チップ 交差0`, r.chips.every((c) => !X(nr, c)));
          check(`${t}@${width}: 注記×バー矩形 交差0`, r.bars.every((b) => !X(nr, b)));
          check(`${t}@${width}: 注記×y軸帯(拡張) 交差0`, !X(nr, r.axisBandWide));
        }
        check(`${t}@${width}: 注記文言が単位整合（億ドル層）`, /^純資産 ▲\d+(\.\d+)?億ドル（債務超過）$/.test(r.noteText || ""));
      } else {
        check(`${t}@${width}: 非債務超過は注記なし（$bsNoteRect null）`, r.noteRect === null);
      }
```

- [ ] **Step 2: 現状で FAIL を確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js
```
Expected: **FAILED**（MCD/SBUX の `注記 $bsNoteRect 非null` と `注記文言が単位整合` が ❌・非該当6銘柄の null アサートは `undefined || null` で ✅ になる）。SBUX の既存チップ系アサートが緑であることも同時に確認（新銘柄の追加自体が回帰を出していない証明）。

- [ ] **Step 3: `bsNotePlugin` を実装**（detail-charts.js:147 `Chart.register(bsLeaderPlugin);` の直後に挿入）

```js
      // spec §11.1 (P6/D22): 債務超過（net_assets<0）の注記チップ。chart.$bsNote 設定時のみ動作（gate 方式は
      //  neonGlow/bsLeader と同型の3例目）。**datalabels 内部 API に非依存**＝プラグイン更新でリード線が
      //  死んでも注記は生存する（bsLeader 相乗りを採らない理由）。描画矩形は chart.$bsNoteRect へ書き戻し、
      //  受入（scratchpad/bs-callout-verify.js の X() 交差判定）が数値で検収できるようにする。
      const bsNotePlugin = { id: "bsNote", afterDatasetsDraw(chart) {
        chart.$bsNoteRect = null;                                  // 非該当/前回残りを毎フレーム明示クリア
        const note = chart.$bsNote; if (!note || !note.text) return;
        const el = chart.getDatasetMeta(0).data[1]; if (!el) return;  // 調達源泉列の中心x（value=0 でも x は有効）
        const c = chart.ctx, ca = chart.chartArea;
        c.save();
        c.font = "bold 12px " + (Chart.defaults.font.family || "sans-serif");   // テーマA 12px 床
        const tw = c.measureText(note.text).width, padX = 10, padY = 5, h = 12 + padY * 2;
        const cx = Math.max(tw / 2 + padX + 4, Math.min(el.x, chart.width - tw / 2 - padX - 4));   // 端クランプ
        const x = cx - tw / 2 - padX, y = ca.top - h - 16;          // top:65 帯内・低棒チップ上端越え(~12px)と非干渉
        c.fillStyle = "#0a0f17"; c.strokeStyle = "#ff5c7a"; c.lineWidth = 1.5;
        c.beginPath(); c.roundRect(x, y, tw + padX * 2, h, 6); c.fill(); c.stroke();
        c.fillStyle = "#ff8fa5"; c.textAlign = "left"; c.textBaseline = "middle";
        c.fillText(note.text, x + padX, y + h / 2);
        c.restore();
        chart.$bsNoteRect = { x: x, y: y, w: tw + padX * 2, h: h };
      } };
      Chart.register(bsNotePlugin);
```

- [ ] **Step 4: renderBSChart 側の書込**（detail-charts.js:967 `bsChartInstance.$bsLeaders = lowIndices;` の直後に追加）

```js
        // spec §11.1 (P6): 債務超過はチャート上で無痕跡（displayNetAssets=0＋formatter null）だったため上部に明示注記。
        //  unit はチャート別単位（:756）＝バッジ/軸/ラベルと自動整合。モバイルは top 帯 10px で置き場がないため
        //  非表示にし、Task 13 の #bs-mobile-note が債務超過行を兼務する。
        bsChartInstance.$bsNote = (!isMobile && hasNegativeEquity)
          ? { text: "純資産 ▲" + FinanceRules.fmtUnitValue(Math.abs(fin.net_assets), unit) + "（債務超過）" }
          : null;
```

- [ ] **Step 5: 受入を実行し、`roundRect` が実描画されることを機械確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js
```
Expected: **ALL PASS**（MCD/SBUX の `$bsNoteRect` 非 null＋交差0×3＋文言 regex・非該当6銘柄 null）。

**フォールバック（`roundRect` は本コードベース初出＝grep 0件・Chrome 99+/Safari 16+）**: Step 5 が `TypeError: c.roundRect is not a function` 系の pageerror や `$bsNoteRect` 非 null 不成立で落ちたら、Step 3 の `c.beginPath(); c.roundRect(...); c.fill(); c.stroke();` の1行を手書き path（+6行）へ置換して再実行する:

```js
        const rw = tw + padX * 2, rr = 6;
        c.beginPath();
        c.moveTo(x + rr, y); c.lineTo(x + rw - rr, y); c.quadraticCurveTo(x + rw, y, x + rw, y + rr);
        c.lineTo(x + rw, y + h - rr); c.quadraticCurveTo(x + rw, y + h, x + rw - rr, y + h);
        c.lineTo(x + rr, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rr);
        c.lineTo(x, y + rr); c.quadraticCurveTo(x, y, x + rr, y);
        c.closePath(); c.fill(); c.stroke();
```

- [ ] **Step 6: 2層ゲート＋回帰束**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/unit-badge-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: unit-badge-verify ALL PASS。detail-snapshot は層1（**windowApi 15/17・canvasCount・pageErrors 0**）が無条件 MATCH。層2（computedStyles/domHash/chartContainerDims）は本タスクでは DOM/CSS 無改修＝**diff なしが期待値**（diff が出たら意図外＝先に原因を追う）。

- [ ] **Step 7: コミット**

```bash
git add detail-charts.js scratchpad/bs-callout-verify.js
git commit -m "feat(bs): 債務超過注記 bsNotePlugin（datalabels 非依存の別gate・\$bsNoteRect 書き戻しで受入機械化）" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**受入（このタスクの完了条件）**
1. `NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js` → **ALL PASS**（1440/1024 で MCD/SBUX の `$bsNoteRect` 非 null・canvas 外クリップ0・チップ/バー/拡張軸帯との交差0・`/^純資産 ▲\d+(\.\d+)?億ドル（債務超過）$/`・非該当6銘柄で `$bsNoteRect === null`・既存「padding arm 不変（left=4）」維持）
2. `detail-snapshot.js compare` の層1（windowApi 15/17・canvasCount・pageErrors 0）が MATCH
3. `unit-badge-verify.js` ALL PASS

---

### Task 13: P8 モバイル低棒サマリ `#bs-mobile-note`（spec §11.2・D21）

**Files:**
- Modify: `index.html:1262`（`chart-main-area` 閉じ `</div>` の直後・`side-panel`（:1263）の前に1行）
- Modify: `detail-charts.js:767-774`（lowIndices 構築を lowTuples→filter の2段化）・`:967` 付近（`$bsNote` 書込の直後にサマリ書込＝約12行）
- Modify: `detail.css`（末尾・`.chart-unit-badge` の後に `.bs-mobile-note` 1ルール）
- Modify: `scratchpad/bs-callout-verify.js:64-73`（モバイル 375 ブロックにサマリのアサート追加）

**Interfaces:**
- Consumes: renderBSChart closure の `totalAssets`（:746）・`displayNetAssets`（:749）・`hasNegativeEquity`（:747）・`unit`（:756）・`isMobile`（:745）・`LOW`（:759）
- Produces: `#bs-mobile-note`（DOM・`.bs-mobile-note`・既定 `hidden`）。**lowIndices の 0.12 判定は不変**（機能等価な2段化のみ）。**サマリの閾値は 0.15**＝モバイル datalabels 表示ゲート（:881-884）と同値。

- [ ] **Step 1: 受入アサートを先に書く**（`scratchpad/bs-callout-verify.js` のモバイル 375 ブロック＝現 :64-73 を書換）

```js
  // モバイル: 低棒ラベル自体が非表示＝新分岐不到達（padding モバイル arm 不変）
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  const mobRead = async (t) => {
    await page.evaluate((tk) => navigateToDetail(tk), t);
    await page.waitForTimeout(2000);
    return page.evaluate(() => {
      const el = document.getElementById("bs-mobile-note");
      const chart = Chart.getChart(document.getElementById("bsChart"));
      return {
        exists: !!el,
        hidden: el ? el.hidden : null,
        text: el ? el.textContent : null,
        padLeft: chart ? chart.options.layout.padding.left : null,
        noteRect: chart ? (chart.$bsNoteRect || null) : null,
      };
    });
  };
  const m6758 = await mobRead("6758.T");
  check("モバイル: padding arm 不変（left=4）", m6758.padLeft === 4);
  check("モバイル: #bs-mobile-note が存在", m6758.exists === true);
  // spec §11.2: 8306.T は純資産 5.3%（<15%）＝モバイルで datalabels が出ない唯一情報を DOM で補完
  const m8306 = await mobRead("8306.T");
  check("モバイル 8306.T: サマリ表示", m8306.hidden === false);
  check("モバイル 8306.T: 文言（純資産 21.7兆円 (5.3%)）", /純資産 21\.7兆円 \(5\.3%\)/.test(m8306.text || ""));
  // MCD: 債務超過行が先頭・canvas 注記はモバイル非発火
  const mMcd = await mobRead("MCD");
  check("モバイル MCD: サマリに債務超過行", /^純資産 ▲\d+(\.\d+)?億ドル（債務超過）/.test(mMcd.text || ""));
  check("モバイル MCD: canvas 注記は非発火（$bsNoteRect null）", mMcd.noteRect === null);
  // 7203.T: 最小セグメント 29.2%＝全て >=15% ゆえサマリ不要
  const m7203 = await mobRead("7203.T");
  check("モバイル 7203.T: サマリ hidden（全セグメント>=15%）", m7203.hidden === true);
  await browser.close();
```

- [ ] **Step 2: 現状で FAIL を確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js
```
Expected: **FAILED**（`#bs-mobile-note が存在` 以下のモバイル新規5件が ❌。desktop ブロック＝Task 12 分は ALL PASS のまま）。

- [ ] **Step 3: DOM を1行追加**（`index.html:1262` の `</div>`＝chart-main-area 閉じの直後・`<div class="side-panel">`（:1263）の前）

```html
              </div>
              <!-- spec §11.2 (P8): モバイルで <15% セグメントの datalabels が出ない情報全損を DOM で補完 -->
              <div id="bs-mobile-note" class="bs-mobile-note" hidden></div>
              <div class="side-panel">
```

（`<1024px` は `.grid-layout` 縦積み＝チャート直下・側パネルの上に出る。ETF/`!fin` は BS カードごと非表示＝detail.js:759-763＝stale 経路なし。）

- [ ] **Step 4: lowIndices 構築を2段化**（detail-charts.js:767-774 を書換。**:764-766 の既存コメントブロックは残す**）

```js
        // spec §11.2 (P8): ラベル付き生タプル → filter の2段化（機能等価・lowIndices の LOW=0.12 判定は不変）。
        //  ⚠ desktop 吹き出し=LOW(0.12) と モバイルサマリ=MOBILE_NOTE_LOW(0.15) の**非対称は意図的**（D21）＝
        //   「モバイル情報全損」の定義が datalabels 表示ゲート（:881-884 の 0.15）側だから。揃えると 12-15% 帯が
        //   「デスクトップ吹き出しもモバイルサマリも無い」取りこぼしになる。
        const BS_LABELS = ["純資産", "固定負債", "流動負債", "固定資産", "流動資産"];
        const lowTuples = [
          [0, displayNetAssets, 1],            // 純資産→調達源泉列
          [1, fin.non_current_liabilities, 1], // 固定負債→調達源泉列
          [2, fin.current_liabilities, 1],     // 流動負債→調達源泉列
          [3, fin.non_current_assets, 0],      // 固定資産→運用形態列
          [4, fin.current_assets, 0],          // 流動資産→運用形態列
        ];
        const lowIndices = lowTuples
          .filter(([, v]) => totalAssets > 0 && v > 0 && v / totalAssets < LOW)
          .map(([di, , bi]) => ({ di, bi }));
```

- [ ] **Step 5: サマリ書込**（detail-charts.js・Task 12 で追加した `bsChartInstance.$bsNote = ...` の直後＝renderBSChart 末尾）

```js
        // spec §11.2 (P8): モバイルの <15% セグメントは datalabels が出ない（:881-884）＝金額/構成比を DOM で補完。
        //  債務超過は displayNetAssets=0（v>0 ガードで除外）ゆえタプルに乗らないため unshift で先頭に置く。
        const MOBILE_NOTE_LOW = 0.15;
        const noteEl = document.getElementById("bs-mobile-note");
        if (noteEl) {
          const items = totalAssets > 0 ? lowTuples
            .filter(([, v]) => v > 0 && v / totalAssets < MOBILE_NOTE_LOW)
            .map(([di, v]) => BS_LABELS[di] + " " + FinanceRules.fmtUnitValue(v, unit) + " (" + (v / totalAssets * 100).toFixed(1) + "%)") : [];
          if (hasNegativeEquity) items.unshift("純資産 ▲" + FinanceRules.fmtUnitValue(Math.abs(fin.net_assets), unit) + "（債務超過）");
          noteEl.textContent = items.join("・");
          noteEl.hidden = !(isMobile && items.length > 0);
        }
```

- [ ] **Step 6: CSS を1ルール追加**（`detail.css` 末尾・`.chart-unit-badge`（現 :1035）の直後。**money.css 非接触＝cockpit-e2e 昇格を回避**）

```css

      /* spec §11.2 (P8): BS モバイル低棒サマリ（.sig-disclaimer/.fin-pending-note と同規約・12px床） */
      .bs-mobile-note { font-size: 12px; color: var(--ix-text-dim); line-height: 1.5; margin: 6px 2px 0; }
```

- [ ] **Step 7: 受入＋2層ゲート＋回帰束**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: bs-callout-verify **ALL PASS**・theme-floor-check ALL PASS（`checked=` の数がタスク前より**減っていない**ことを目視確認＝セレクタ漏れ検出）・portal-money-smoke **8/8**。detail-snapshot は層1 MATCH・層2 は `domHash`（index.html 1行追加）の意図 diff のみ→ jq で検分後:

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture   # 再 baseline 昇格
```

- [ ] **Step 8: コミット**

```bash
git add index.html detail-charts.js detail.css scratchpad/bs-callout-verify.js
git commit -m "feat(bs): モバイル低棒サマリ #bs-mobile-note（閾値0.15=表示ゲート同値・lowTuples 2段化は機能等価）" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**受入（このタスクの完了条件）**
1. `bs-callout-verify.js` **ALL PASS**（8306.T＝`hidden===false` かつ `/純資産 21\.7兆円 \(5\.3%\)/`／MCD＝先頭が債務超過行かつ `$bsNoteRect === null`／7203.T＝`hidden===true`／6758.T の padding `left===4` 維持／desktop の Task 12 分も維持）
2. `theme-floor-check.js` ALL PASS＋`checked=` 非減少
3. `portal-money-smoke.js` **8/8**
4. `detail-snapshot.js compare` 層1 MATCH・層2 は domHash のみ意図 diff→再 baseline 済

---

### Task 14: 財務ラベル描画側（#4/#5/#6/#7＋NEW の charts 側）（spec §7.1-§7.4・D16/D17）

**Files:**
- Modify: `detail-charts.js:789`（currentRatio を ratioOrNull へ呼び替え）・`:799`（null 分岐＋desc 上書き）・`:1025-1031`（radar datalabels に放射 align/offset）・`:1112-1119`（PL align）・`:1120-1124`（PL offset）・`:1125-1143`（PL formatter に銀行 N/A 分岐）
- Create: `scratchpad/finviz-labels-verify.js`（Playwright 受入・前 wave verify の型を踏襲）

**Interfaces:**
- Consumes（**再実装禁止・Part A の Task 2 が実装済み**）: `DetailRules.isFinancialPL(fin) -> boolean`
- Consumes（**新設禁止・finance-rules.js:174 に既存**）: `FinanceRules.ratioOrNull(fin, fn, needKeys, denomKeys)`
- Consumes（Part A の Task 3/NEW が実装済み・本タスクは観測のみ）: `DetailRules.plSteps` の IFRS 経常段省略・`DetailRules.healthTrendSeries` の curOk 分母条件
- Produces: 描画側の表示のみ（新規 export/window 公開なし）。**`FinanceRules.currentRatio` 本体（finance-rules.js:36-39）と `ratio` の 0 返し（:19-22）は変えない**（tests/finance-rules.test.js:37 の既存挙動固定を維持＝D17）。

- [ ] **Step 1: 受入スクリプトを先に作成**（`scratchpad/finviz-labels-verify.js`）

```js
// spec §7.5 受入: 財務ラベル4件（#4 銀行N/A・#5 val=0 退避・#6 レーダー放射・#7 流動比率 N/A）＋NEW 健全性トレンド。
// 実行: PLAN2_PORT=8200 で mock 鯖起動後、NODE_PATH=/home/shugo/node_modules node scratchpad/finviz-labels-verify.js
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
const X = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  const open = async (t) => { await page.evaluate((tk) => navigateToDetail(tk), t); await page.waitForTimeout(2000); };
  // datalabels の描画テキスト/矩形を読む（_model.lines が取れない場合は formatter を直接評価してフォールバック）
  const read = (canvasId) => page.evaluate((id) => {
    const chart = Chart.getChart(document.getElementById(id));
    if (!chart) return null;
    const ds = chart.data.datasets[0];
    const opts = chart.options.plugins.datalabels;
    const items = chart.getDatasetMeta(0).data.map((el, i) => {
      const lab = (el.$datalabels || [])[0];
      let text = null;
      if (lab && lab._model && Array.isArray(lab._model.lines)) text = lab._model.lines.join("\n");
      if (text === null && typeof opts.formatter === "function") {
        text = opts.formatter(ds.data[i], { chart: chart, dataIndex: i, datasetIndex: 0, dataset: ds });
      }
      const rect = (lab && lab.$layout && lab.$layout._visible && lab.$layout._box) ? lab.$layout._box._rect : null;
      const ctx = { chart: chart, dataIndex: i, datasetIndex: 0, dataset: ds };
      return {
        i: i, label: String(chart.data.labels[i]), value: ds.data[i], text: text,
        rect: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null,
        align: typeof opts.align === "function" ? opts.align(ctx) : opts.align,
        offset: typeof opts.offset === "function" ? opts.offset(ctx) : opts.offset,
      };
    });
    return { items: items, labelCount: chart.data.labels.length };
  }, canvasId);
  const sidePanel = () => page.evaluate(() => ({
    cur: (document.getElementById("current-ratio") || {}).innerText || null,
    desc: (document.getElementById("desc-current-ratio") || {}).innerText || null,
  }));
  const healthCur = () => page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById("healthTrend"));
    if (!chart) return null;
    const d = chart.data.datasets.find((s) => /流動比率/.test(s.label));
    return d ? d.data.slice() : null;
  });

  // ── 8306.T（銀行）: #4 表示・#7 側パネル・NEW 健全性トレンド・#6 レーダー ──
  await open("8306.T");
  const pl8306 = await read("plChart");
  const op8306 = pl8306.items.find((s) => s.label === "営業利益");
  check("8306.T: PL 営業利益が N/A (銀行・金融)", !!op8306 && op8306.text === "N/A\n(銀行・金融)");
  check("8306.T: 営業利益(val=0) は top 退避・offset 12", !!op8306 && op8306.align === "top" && op8306.offset === 12);
  const sp8306 = await sidePanel();
  check("8306.T: #current-ratio = N/A（0.0% 偽値の解消）", sp8306.cur === "N/A");
  check("8306.T: #desc-current-ratio が適用外文言", /銀行・金融は流動\/固定区分がなく適用外/.test(sp8306.desc || ""));
  const hc8306 = await healthCur();
  check("8306.T: 健全性トレンドの流動比率が全 null（偽0%実線なし）", Array.isArray(hc8306) && hc8306.every((v) => v === null));
  const rd8306 = await read("radarChart");
  const rects8306 = rd8306.items.map((s) => s.rect).filter(Boolean);
  let ov8306 = false;
  for (let i = 0; i < rects8306.length; i++) for (let j = i + 1; j < rects8306.length; j++) if (X(rects8306[i], rects8306[j])) ov8306 = true;
  check(`8306.T: レーダーラベル相互交差 0（${rects8306.length}枚）`, rects8306.length >= 5 && !ov8306);

  // ── 9984.T（持株会社）: IFRS 経常段省略＋val=0 退避 ──
  await open("9984.T");
  const pl9984 = await read("plChart");
  check("9984.T: 経常利益段なし（IFRS 段省略）", !pl9984.items.some((s) => s.label === "経常利益"));
  const zero9984 = pl9984.items.filter((s) => s.value === 0);
  check("9984.T: val=0 段は top 退避・offset 12（center 分岐の廃止）", zero9984.length > 0 && zero9984.every((s) => s.align === "top" && s.offset === 12));
  const op9984 = pl9984.items.find((s) => s.label === "営業利益");
  check("9984.T: 営業利益は持株会社 N/A のまま（銀行分岐に誤爆しない）", !!op9984 && op9984.text === "N/A\n(持株会社仕様)");

  // ── 7201.T（低スコア）: レーダー放射分離 ──
  await open("7201.T");
  const rd7201 = await read("radarChart");
  const rects7201 = rd7201.items.map((s) => s.rect).filter(Boolean);
  let ov7201 = false;
  for (let i = 0; i < rects7201.length; i++) for (let j = i + 1; j < rects7201.length; j++) if (X(rects7201[i], rects7201[j])) ov7201 = true;
  check(`7201.T: レーダーラベル相互交差 0（${rects7201.length}枚）`, rects7201.length >= 5 && !ov7201);

  // ── 7203.T（非金融）: 非退行 ──
  await open("7203.T");
  const pl7203 = await read("plChart");
  check("7203.T: PL に N/A ラベルなし（誤爆なし）", !pl7203.items.some((s) => /N\/A/.test(String(s.text || ""))));
  const sp7203 = await sidePanel();
  check("7203.T: #current-ratio が % 表示（N/A でない）", /%$/.test(sp7203.cur || "") && sp7203.cur !== "N/A");
  check("7203.T: #desc-current-ratio が基準文言に復帰", /短期支払能力基準/.test(sp7203.desc || ""));
  const hc7203 = await healthCur();
  check("7203.T: 健全性トレンドの流動比率に実点あり", Array.isArray(hc7203) && hc7203.some((v) => v !== null));

  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: 現状で FAIL を確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/finviz-labels-verify.js
```
Expected: **FAILED**（8306.T の N/A・退避・N/A 側パネル・適用外文言／9984.T の val=0 退避 offset＝現行は align="center"/offset=6 ／レーダー交差）。※`8306.T: 健全性トレンド全 null` と `9984.T: 経常利益段なし` は **Part A の Task 3/NEW 完了後なら既に ✅**（本タスクの実装対象外・観測のみ）。**Part A の Task 2（isFinancialPL）が未完なら本タスクは着手不可**＝先に Part A を完了させる。

- [ ] **Step 3: #7 流動比率を ratioOrNull へ呼び替え**（detail-charts.js:789 を書換）

```js
        // spec §7.4 D17: 銀行/保険/証券は流動/固定区分がなく分母0＝ratio の 0 返しが「0.0%」偽値になる。
        //  本体（finance-rules.js:36-39/:19-22）は既存挙動固定のまま、消費者側で ratioOrNull を選ぶ既存パターン
        //  （ポータル index.html:1980・cross-section-rules.js:90-91）に揃える＝3例目・同引数。
        const currentRatio = FinanceRules.ratioOrNull(fin, FinanceRules.currentRatio, ["current_assets", "current_liabilities"], ["current_liabilities"]);
```

- [ ] **Step 4: #7 の null 分岐（DOM 書込）**（detail-charts.js:799 を書換）

```js
        // ⚠ animateNumber(null) は (null*eased).toFixed(1) = "0.0%" を**無言表示**する（detail.js:189-199）＝分岐必須。
        const crEl = document.getElementById("current-ratio");
        if (currentRatio === null) {
          crEl.innerText = "N/A";
          // detail.js:753（currentRatioDesc）が毎 render 先に書く→ここが後勝ち。非 null 年/銘柄では上書きしないため
          //  基準文言への復帰は detail.js 側の毎回書込で自動成立（追加の戻し処理は不要）。
          const crDescEl = document.getElementById("desc-current-ratio");
          if (crDescEl) crDescEl.innerText = "▶ 銀行・金融は流動/固定区分がなく適用外";
        } else {
          animateNumber(crEl, currentRatio, "%", 1, 900);
        }
```

- [ ] **Step 5: #5 PL の val=0 統一退避**（detail-charts.js:1112-1124 の align/offset を書換。**HOLDING center 分岐（:1115-1116）と未使用になる `label` 定数を削除**）

```js
                align: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  // spec §7.2 (#5): val=0 は一律 top 退避（HOLDING の center=基線上＝X軸ラベル衝突を廃止）。
                  //  銀行 N/A（#4）も 0 値ゆえ同経路に乗る。
                  if (val === 0) return "top";
                  const max = Math.max(...context.dataset.data.map(Math.abs));
                  return Math.abs(val) / max < 0.15 ? "top" : "bottom";
                },
                offset: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (val === 0) return 12;   // spec §7.2: 現行6→12 で軸帯から確実に離す
                  const max = Math.max(...context.dataset.data.map(Math.abs));
                  return Math.abs(val) / max < 0.15 ? 6 : 0;
                },
```

- [ ] **Step 6: #4 PL formatter の銀行 N/A 分岐**（detail-charts.js:1127-1129 の HOLDING 分岐の直後に追加）

```js
                  if (value === 0 && label === "営業利益" && HOLDING_COMPANIES.has(currentTicker)) {
                    return `N/A\n(持株会社仕様)`;
                  }
                  // spec §7.1 D16: 銀行/保険/証券は営業利益の概念がなく経常利益で開示＝棒なしの黄「0」ラベルを N/A 化。
                  //  判定は値ベース純関数（DetailRules.isFinancialPL・実DBで金融12銘柄36行と外延一致）。
                  //  9984.T は経常=0 で自動排除＝上の HOLDING 分岐と非衝突（順序も HOLDING 優先で保険）。
                  if (value === 0 && label === "営業利益" && DetailRules.isFinancialPL(fin)) {
                    return `N/A\n(銀行・金融)`;
                  }
```

- [ ] **Step 7: #6 レーダーラベルの放射退避**（detail-charts.js:1025-1031 の datalabels に2行追加）

```js
              datalabels: {
                color: "#cfe0f5",
                textShadowBlur: 6,
                textShadowColor: "rgba(120,210,255,0.55)",
                font: { weight: "bold", size: 11 },
                // spec §7.3 (#6): 低スコアだと点が中心付近に集まりラベルが団子になる＝各軸の外向きへ放射退避。
                //  頂点0=真上(-90°)・時計回り 360/軸数 刻み。数値 align は BS stagger（:920-921）で本番実績のある機構。
                align: (ctx) => ctx.dataIndex * (360 / ctx.chart.data.labels.length) - 90,
                offset: 8,
                formatter: (v) => Math.round(v) + "点",
              },
```

- [ ] **Step 8: 受入＋2層ゲート＋回帰束**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/finviz-labels-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/unit-badge-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-verify.js
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
PYTHONPATH=$PWD /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: 4本の verify **ALL PASS**・node **334＋Part A 新規分が全 pass**（`ℹ tests` の実行数で判定・`grep -c "test("` で数えない）・pytest **228 不変**。detail-snapshot は層1 MATCH・層2 は `chartContainerDims` 不変／`domHash` 不変（DOM 無改修）・`computedStyles` 不変が期待値。もし `#current-ratio` のテキストが computedStyles/domHash に載って diff が出た場合のみ検分→ `capture` で再 baseline。

- [ ] **Step 9: コミット**

```bash
git add detail-charts.js scratchpad/finviz-labels-verify.js
git commit -m "fix(labels): 銀行営業利益 N/A・val=0 統一退避・レーダー放射退避・流動比率 ratioOrNull 呼替（描画側）" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**受入（このタスクの完了条件）**
1. `finviz-labels-verify.js` **ALL PASS**（8306.T＝PL `"N/A\n(銀行・金融)"`・`#current-ratio === "N/A"`・desc 適用外文言・健全性トレンド流動比率全 null・レーダー rect 相互交差0／9984.T＝経常段なし・val=0 が align `"top"`/offset `12`・持株会社 N/A 維持／7201.T＝レーダー交差0／7203.T＝N/A ラベルなし・`%` 表示・基準文言復帰・流動比率実点あり／pageerror 0）
2. `bs-callout-verify.js`／`unit-badge-verify.js`／`zerofy-verify.js` ALL PASS
3. node テスト全 pass（334＋Part A 新規）・pytest 228 不変
4. `detail-snapshot.js compare` 層1（windowApi 15/17・canvasCount・pageErrors 0）MATCH

---

### Task 15: タイトル配線＋G3 副題行 CSS（#3 の detail.js/CSS 側）（spec §6.1/§6.3・D14/D27）

**Files:**
- Modify: `detail.js:665`（ヘッダの ticker span 条件出力）・`:675-677`（periodLabelParts 消費＋第6引数＋innerHTML 化）
- Modify: `detail.css`（末尾・`.bs-mobile-note` の直後に `.stock-title-sub`）
- Create: `scratchpad/titles-verify.js`（Playwright 受入。node 側の純関数テストは **Part A の Task 5/6 が担当**）

**Interfaces:**
- Consumes（**再実装禁止・Part A の Task 5 が実装済み**）: `DetailRules.periodLabelParts(companyName, ticker, year, isUS, hasFiltered, isEtf) -> { main, period }`（`period` は `[...]` 注記全体・無い場合は空文字）
- Consumes: `esc`（detail.js 内既存・`window.esc` と同一）
- Produces: `#stock-title` の innerHTML 2要素構造（本文＋`.stock-title-sub`）。**`selected-year-display` の ETF「----」化は不採用**（本人確定）。

- [ ] **Step 1: 受入スクリプトを先に作成**（`scratchpad/titles-verify.js`）

```js
// spec §6.4 受入: G1 二重ティッカー解消・G2 ETF 文言・G3 副題行分離（描画側）。
// 実行: PLAN2_PORT=8200 で mock 鯖起動後、NODE_PATH=/home/shugo/node_modules node scratchpad/titles-verify.js
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  const open = async (t) => { await page.evaluate((tk) => navigateToDetail(tk), t); await page.waitForTimeout(900); };
  const title = () => page.evaluate(() => {
    const el = document.getElementById("stock-title");
    const sub = el ? el.querySelector(".stock-title-sub") : null;
    const head = document.querySelector("#active-company-header .company-title-main");
    return {
      text: el ? el.textContent : null,
      subText: sub ? sub.textContent : null,
      subDisplay: sub ? getComputedStyle(sub).display : null,
      headText: head ? head.textContent : null,
    };
  });

  // ── SPY（社名が既に "(SPY)" を含む ETF）──
  await open("SPY");
  const spy = await title();
  check("SPY: #stock-title に (SPY) (SPY) を含まない", !/\(SPY\)\s*\(SPY\)/.test(spy.text || ""));
  check("SPY: ヘッダ社名にも (SPY) (SPY) を含まない", !/\(SPY\)\s*\(SPY\)/.test(spy.headText || ""));
  check("SPY: ETF タイトルに『経営期間トレンド』を含まない", !/経営期間トレンド/.test(spy.text || ""));

  // ── 7203.T（株式・非退行）──
  await open("7203.T");
  const t7203 = await title();
  check("7203.T: 副題 span が存在", !!t7203.subText);
  check("7203.T: 副題が [..] 注記（経営期間トレンド）", /^\[.*経営期間トレンド\]$/.test((t7203.subText || "").trim()));
  check("7203.T: 副題が block（wide でも2行化＝D27）", t7203.subDisplay === "block");
  check("7203.T: 社名が本文側に残る", /トヨタ|TOYOTA|\(7203\.T\)/.test(t7203.text || ""));

  // ── 480px（narrow）──
  await page.setViewportSize({ width: 480, height: 900 });
  await open("7203.T");
  const narrow = await title();
  check("480px: .stock-title-sub が block", narrow.subDisplay === "block");
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: 現状で FAIL を確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/titles-verify.js
```
Expected: **FAILED**（SPY の二重ティッカー2件・`.stock-title-sub` 不在で副題系4件が ❌）。**Part A の Task 5（periodLabelParts）が未完なら本タスクは着手不可**。

- [ ] **Step 3: ヘッダの ticker span を条件出力**（detail.js:665 を書換）

```js
      <span class="company-title-main">${esc(data.company_name)}${data.company_name.includes(`(${currentTicker})`) ? "" : ` <span style="color:#475569;font-size:12px;">(${currentTicker})</span>`}</span>
```

（spec §6.1 D14: 社名が既に `(ticker)` を含む場合のみ付加省略＝実DB該当は SPY のみ。QQQ/GOOGL の括弧連鎖は表示側で触らない＝データ側レーン。）

- [ ] **Step 4: タイトルを periodLabelParts＋innerHTML 化**（detail.js:676-677 を書換）

```js
    // spec §6.3 G3: 期間注記を副題行へ分離（parts 消費）。第6引数 isEtf は `data.type === "etf"` を式直書き
    //  （isEtf 定数は :757 で後方定義＝ここでは未宣言）。
    // ⚠ innerText→innerHTML 化で自動エスケープを失うため esc() 必須（company_name は DB 由来）。
    const titleParts = DetailRules.periodLabelParts(
      data.company_name, currentTicker, selectedYear, isUS, filteredPrices.length > 0, data.type === "etf");
    document.getElementById("stock-title").innerHTML =
      `${esc(titleParts.main)}${titleParts.period ? `<span class="stock-title-sub">${esc(titleParts.period)}</span>` : ""}`;
```

- [ ] **Step 5: `.stock-title-sub` を detail.css 末尾に追加**（Task 13 で追加した `.bs-mobile-note` の直後）

```css

      /* spec §6.3 G3/D27: タイトルの期間注記を副題行へ分離（wide でも block＝narrow 個別 media 分岐は不要）。
         色は 12px 本文として AA 寄りの --ix-text-dim（--ix-border-mid は背景比 ≈1.6:1 で本文には不足）。 */
      .stock-title-sub {
        display: block;
        font-size: 12px;
        color: var(--ix-text-dim);
        letter-spacing: 1px;
        margin-top: 2px;
        text-transform: none;
      }
```

- [ ] **Step 6: 受入＋2層ゲート＋回帰束**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/titles-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js 375
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: titles-verify **ALL PASS**・zerofy-verify（SPY 遷移を含む）ALL PASS・smoke-zigzag-range pageerror 0・theme-floor-check ALL PASS（`checked=` 非減少）・node は **Part A の periodLabel 期待値書換込みで全 pass**。detail-snapshot は層1 MATCH・層2 は `domHash`（#stock-title の子要素追加）と `computedStyles` の意図 diff → jq 検分後:

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
```

- [ ] **Step 7: コミット**

```bash
git add detail.js detail.css scratchpad/titles-verify.js
git commit -m "feat(titles): SPY型の二重ティッカー解消＋期間注記の副題行分離（periodLabelParts 消費・esc 必須の innerHTML 化）" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**受入（このタスクの完了条件）**
1. `titles-verify.js` **ALL PASS**（SPY＝`#stock-title`／ヘッダとも `(SPY) (SPY)` を含まない・「経営期間トレンド」を含まない／7203.T＝`.stock-title-sub` が存在し `[...経営期間トレンド]`・computed display `block`／480px でも `block`／pageerror 0）
2. node テスト全 pass（Part A の periodLabel 期待値書換を含む）
3. `zerofy-verify.js`・`smoke-zigzag-range.js`・`theme-floor-check.js`（1440/375）ALL PASS
4. `detail-snapshot.js compare` 層1 MATCH・層2 は domHash/computedStyles のみ意図 diff→再 baseline 済

---

### Task 16: トグルバー D1＋説明二重 D2（spec §5・B3）

**Files:**
- Modify: `index.html:1222`（`.ma-label` に `data-term="ma"`）・`:1225`（空 span 削除）・`:1231`（KC を `.ctrl-pair` 化）・`:1236-1238`（S/R線・T/R線・VWAP を `.ctrl-pair` 化）
- Modify: `detail.css:499` の直後（`.ctrl-pair` 2ルール）・`:628` の直後（`.acc-item.expanded .acc-desc` 1行）
- Create: `scratchpad/toolbar-terms-verify.js`（Playwright 受入）

**Interfaces:**
- Consumes: `injectTermHelp`（detail.js:224-233）の `beforeend` 注入＋冪等ガード `:scope > .term-help`＝**JS 無改修**でラッパ末尾（＝ボタン直後）に「?」が入る
- Produces: `.ctrl-pair`（ボタン固有概念4件＝keltner/sr/zigzag/vwap のラッパ）・展開時の `.acc-desc` 非表示
- **競合回避（Part B の Task 7 と同一ファイル）**: Part B は同じ `detail.css` に `.acc-metric`（ATR 中央値バッジ）を追加し `detail.js` の addSubpanelItem（acc-head innerHTML＝:359-365）も編集する。**本タスクの D2 は CSS 1行の追加のみに留め、acc-head の innerHTML には一切触れない**。
- **不採用（明記）**: ボタン内包（`<button>` 内に `tabindex=0` span）＝nested interactive で「?」クリックが toggle を誘発し focus が破綻するため。

- [ ] **Step 1: 受入スクリプトを先に作成**（`scratchpad/toolbar-terms-verify.js`）

```js
// spec §5.3 受入: D1 空 span 全廃＋ctrl-pair 密着 / D2 展開時のヘッダ desc 非表示。
//  ⚠ `:empty` 判定は不採用（injectTermHelp 注入後は修正前でも常に0件＝識別力なし）。
// 実行: PLAN2_PORT=8200 で mock 鯖起動後、NODE_PATH=/home/shugo/node_modules node scratchpad/toolbar-terms-verify.js
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(1200);

  // ① data-term を持つグループラベルはすべて自前テキストを持つ（空 span 全廃の検収）
  const labels = await page.evaluate(() => [...document.querySelectorAll(".ma-control-bar .ma-label[data-term]")]
    .map((el) => [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim()));
  check(`① .ma-label[data-term] が2件以上（${labels.length}件）`, labels.length >= 2);
  check("① .ma-label[data-term] は全てテキスト非空", labels.length > 0 && labels.every((t) => t.length > 0));

  // ② ボタン固有概念は ctrl-pair でボタン直後に「?」が入る（4件）
  const pairs = await page.evaluate(() => [...document.querySelectorAll(".ctrl-pair > .term-help")]
    .map((h) => ({
      prevTag: h.previousElementSibling ? h.previousElementSibling.tagName : null,
      term: h.parentElement.dataset.term,
      sameRow: Math.abs(h.getBoundingClientRect().top - h.previousElementSibling.getBoundingClientRect().top) < 12,
    })));
  check(`② .ctrl-pair > .term-help が4件（${pairs.length}件）`, pairs.length === 4);
  check("② 各 ? の previousElementSibling が button", pairs.length === 4 && pairs.every((p) => p.prevTag === "BUTTON"));
  check("② term は keltner/sr/zigzag/vwap", JSON.stringify(pairs.map((p) => p.term).sort()) === JSON.stringify(["keltner", "sr", "vwap", "zigzag"]));

  // ②' 480px の flex-wrap でもボタンと ? が同一行（迷子の最悪ケース根絶）
  await page.setViewportSize({ width: 480, height: 900 });
  await page.waitForTimeout(400);
  const narrowPairs = await page.evaluate(() => [...document.querySelectorAll(".ctrl-pair > .term-help")]
    .map((h) => Math.abs(h.getBoundingClientRect().top - h.previousElementSibling.getBoundingClientRect().top) < 12));
  check("②' 480px でもボタンと ? が同一行", narrowPairs.length === 4 && narrowPairs.every(Boolean));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForTimeout(400);

  // ③ 展開時にヘッダ desc が消え、折り畳みで復帰
  const acc = await page.evaluate(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const item = document.querySelector(".acc-item");
    if (!item) return null;
    const desc = item.querySelector(".acc-desc");
    const head = item.querySelector(".acc-head");
    if (!item.classList.contains("expanded")) { head.click(); await wait(500); }
    const expanded = getComputedStyle(desc).display;
    head.click(); await wait(500);
    const collapsed = getComputedStyle(desc).display;
    head.click(); await wait(500);   // 元の展開状態へ戻す（後続ゲートへの副作用を残さない）
    return { expanded, collapsed };
  });
  check("③ 展開時 .acc-desc の display=none", !!acc && acc.expanded === "none");
  check("③ 折り畳みで .acc-desc が復帰", !!acc && acc.collapsed !== "none");
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: 現状で FAIL を確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/toolbar-terms-verify.js
```
Expected: **FAILED**（① 空 span（ma/keltner/sr/zigzag/vwap）が `.ma-label[data-term]` に混じりテキスト空／② `.ctrl-pair` 0件／③ 展開時も `.acc-desc` が表示）。

- [ ] **Step 3: index.html のトグルバーを書換**（:1222／:1225／:1231／:1236-1238）

`:1222`（グループラベルに概念を内包＝:1229 の「エンベロープ」bb と同形）:

```html
                <span class="ma-label" data-term="ma">移動平均</span>
```

`:1225`（末尾の空 span を削除）:

```html
                <button class="ma-btn" id="ma-btn-75" onclick="toggleMA(75)">MA 75</button>
```

`:1231`（KC はグループ概念でなくボタン固有＝`.ctrl-pair` でラップ・空 span 削除）:

```html
                <span class="ctrl-pair" data-term="keltner"><button class="ma-btn" id="ind-btn-keltner" onclick="toggleKeltner()">KC 20</button></span>
```

`:1236-1238`（S/R線・T/R線・VWAP も同形。空 span はすべて削除）:

```html
                <span class="ctrl-pair" data-term="sr"><button class="ma-btn" id="ind-btn-sr" onclick="toggleSR()">S/R線</button></span>
                <span class="ctrl-pair" data-term="zigzag"><button class="ma-btn" id="ind-btn-tr" onclick="toggleTR()">T/R線</button></span>
                <span class="ctrl-pair" data-term="vwap"><button class="ma-btn" id="ind-btn-vwap" onclick="toggleVWAP()">VWAP</button></span>
```

（`#ind-btn-*` は id 参照のみで toggle/active 付与が動く＝JS 無改修。`--th-shift` クランプ（index.html:2608-2633）は `getBoundingClientRect` の位置計測ベース＝DOM 移設に追従。）

- [ ] **Step 4: detail.css に `.ctrl-pair` を追加**（`.ma-label` ブロック＝現 :492-499 の直後）

```css
      /* spec §5.1 D1: ボタン固有概念の「?」をボタンへ密着させる改行不可ラッパ。
         480px の .ma-control-bar flex-wrap（:454）でボタンと ? の間で改行するのを根絶する。 */
      .ctrl-pair { display: inline-flex; align-items: center; }
      .ctrl-pair > .term-help { margin-left: 3px; }   /* .ctrl-group の gap:5px より密着 */
```

- [ ] **Step 5: detail.css に D2 の1行を追加**（`.acc-desc` 定義＝現 :621-628 の直後・**acc-head の innerHTML には触れない**）

```css
      /* spec §5.2 D2: 展開時はヘッダ desc を隠す（body の .acc-full-desc と同文二重の解消・.expanded は detail.js:326/:338） */
      .acc-item.expanded .acc-desc { display: none; }
```

- [ ] **Step 6: 受入＋2層ゲート＋回帰束**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/toolbar-terms-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js 375
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: toolbar-terms-verify **ALL PASS**・portal-money-smoke **8/8**・theme-floor-check ALL PASS（**`checked=` の数がタスク前より減っていないことを目視確認**＝`.ma-label`/`.term-help` の DOM 移設でセレクタが静かに未マウント扱いへ落ちていないことの検収）・smoke-zigzag-range pageerror 0・tests/detail-termhelp.test.js を含む node 全 pass（termHelp 文字列のみ検証＝非破壊）。detail-snapshot は層1 MATCH・層2 は `domHash`（トグルバー markup）＋`computedStyles`（`.ctrl-pair`）の意図 diff → jq 検分後:

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
```

- [ ] **Step 7: スクリーンショット（本人実機サニティ項目10 の準備）**

```bash
NODE_PATH=/home/shugo/node_modules node -e "
const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();
for(const w of [1280,480]){const p=await b.newPage({viewport:{width:w,height:900}});
await p.goto('http://127.0.0.1:8200',{waitUntil:'networkidle'});
await p.evaluate(()=>navigateToDetail('7203.T'));await p.waitForTimeout(1200);
await p.locator('.ma-control-bar').screenshot({path:'scratchpad/shot-toolbar-'+w+'.png'});await p.close();}
await b.close();})();"
```
（`scratchpad/shot-toolbar-1280.png` / `-480.png` を生成。**コミットしない**＝本人検分用。）

- [ ] **Step 8: コミット**

```bash
git add index.html detail.css scratchpad/toolbar-terms-verify.js
git commit -m "fix(toolbar): 迷子「?」の空span全廃＋ctrl-pair 密着（D1）／アコーディオン展開時のヘッダ説明二重を解消（D2）" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

**受入（このタスクの完了条件）**
1. `toolbar-terms-verify.js` **ALL PASS**（①`.ma-control-bar .ma-label[data-term]` が全てテキスト非空・2件以上／②`.ctrl-pair > .term-help` が4件で各 `previousElementSibling` が `BUTTON`・term が keltner/sr/vwap/zigzag・1280/480 とも同一行／③展開時 `.acc-desc` の computed display=`none`・折り畳みで復帰／pageerror 0）
2. `portal-money-smoke.js` **8/8**
3. `theme-floor-check.js`（1440/375）ALL PASS かつ `checked=` 非減少
4. node テスト全 pass（`tests/detail-termhelp.test.js` 非破壊）
5. `detail-snapshot.js compare` 層1 MATCH・層2 は domHash/computedStyles のみ意図 diff→再 baseline 済
