## Part B: Task 7-11（B2 描画層・前半）

> **前提（Part A の Task 0-6 完了後に着手）**: rules 層に `DetailRules.srLabelPlan` / `srNearest` / `fitLogicalRange` が実装＋export 済み・B0 前処理（mock 鯖 8200 起動＋`detail-baseline.json` capture＋`scratchpad/plan-parts/b0-measured.md` の実測値）が済んでいること。**Part B は消費側＝選抜/窓ロジックを再実装しない**（spec §14「純計算=rules」規律）。
>
> **本 Part の共通コマンド**
> ```bash
> NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js                  # Part A 完了時点の pass 数・fail 0
> NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare   # 層1 MATCH（windowApi 15/17・canvasCount・pageErrors 0）
> NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js         # 全タスクで安い保険（ALL PASS）
> NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js        # pageerror 0
> ```
> mock 鯖は `PLAN2_PORT=8200 python3 scratchpad/mock_prod_server.py`（起動前に `lsof -i :8200` で他セッション専有を検知したら**即中断**＝spec §12.0）。
>
> **Part C との分界（同一ファイルを触るため厳守）**: Task 7-11 では detail-charts.js の **PL formatter(:1096-1145)・radar(:1025-1031)・renderBSChart(:747-967)・側パネル(:789/:799)** に触れない。

---

### Task 7: サブパネル C1+C2+C3＋ATR 中央値バッジ（spec §4.1/§4.2/§4.3・D18/D24/D25）

**Files:**
- Modify: `detail-charts.js:270`（subBaseOpts＝C3 scaleMargins＋C2 minimumWidth）・`:287-289`（RSI 70/50/30）・`:309`（MACD 0線）・`:335`（ADX 25）・`:361-363`（ATR 中央線＋バッジ書出）・`:368-372`（OBV priceFormat＋0線）・`:405-409`（`chart.__host` 1行）・`:418-425`（unmount でバッジクリア）・`:609`（メイン rightPriceScale minimumWidth）
- Modify: `detail.js:359-365`（addSubpanelItem の `.acc-head` innerHTML に `.acc-metric` を追加）
- Modify: `detail.css:619`直後（`.acc-metric`）
- Create: `scratchpad/subpanel-verify.js`（Task 8 で C4 分を追記して使い回す）

**Interfaces:**
- Consumes: なし（rules 層非依存＝Part A と独立に着手可）
- Produces: `.acc-item > .acc-head > .acc-metric` の DOM 契約（ATR のみ `"中央 x.x%"`・他は空文字）／`chart.__host`（closure 内 mount メタ・**Task 8 の DOM 順判定と同じ host 参照**）

- [ ] **Step 1: 受入スクリプトを先に書く（検証先行＝node テストが無い領域の TDD 代替）**

`scratchpad/subpanel-verify.js` を新規作成:

```js
// #1 サブパネル C1-C4 受入（spec §4.5）: DOM 計測＋ソース照合。
//  LWC の chart/priceLine インスタンスは IIFE 私有で page から到達不能・軸ラベルは canvas 描画で DOM に
//  無いため、①7本の createPriceLine のソース照合 ②LWC が生成する table 構造（行=ペイン/時間軸・
//  最終セル=右軸）の DOM 実測、の2手段で機械判定する（spec §4.5 = 敵対検証 H3 の受入手段置換）。
const { chromium } = require("playwright");
const fs = require("fs");
let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ✅ " : "  ❌ ") + name + (extra === undefined ? "" : `  [${extra}]`));
  if (!ok) failed++;
}
// page.evaluate 用: アコーディオン各項目の LWC DOM 実測（DOM 順で返る）
const SNAP = () => [...document.querySelectorAll("#subpanel-accordion .acc-item")].map((it) => {
  const host = it.querySelector(".subpanel-host");
  const tbl = host.querySelector("table");
  const rows = tbl ? [...tbl.rows] : [];
  const rh = (i) => (rows[i] ? Math.round(rows[i].getBoundingClientRect().height) : -1);
  const lastCell = rows[0] ? rows[0].cells[rows[0].cells.length - 1] : null;
  return {
    key: it.dataset.key,
    mounted: !!tbl,
    axisW: lastCell ? Math.round(lastCell.getBoundingClientRect().width) : -1,
    paneH: rh(0), axisH: rh(1),
    hostH: host.clientHeight,
    charts: host.querySelectorAll(".tv-lightweight-charts").length,
    metric: (it.querySelector(".acc-metric") || {}).textContent || "",
  };
});
(async () => {
  // ── ① ソース照合（C1/C2/C3）
  const src = fs.readFileSync("detail-charts.js", "utf8");
  [
    ["RSI 70", /price: 70,[^\n]*axisLabelVisible: false/],
    ["RSI 50", /price: 50,[^\n]*axisLabelVisible: false/],
    ["RSI 30", /price: 30,[^\n]*axisLabelVisible: false/],
    ["MACD 0線", /hist\.createPriceLine\(\{ price: 0,[^\n]*axisLabelVisible: false/],
    ["ADX 25", /price: 25,[^\n]*axisLabelVisible: false/],
    ["ATR 中央", /medLine = series\.createPriceLine\(\{ price: \+med\.toFixed\(2\),[^\n]*axisLabelVisible: false/],
    ["OBV 0線", /price: 0, color: "rgba\(148,163,184,0\.25\)"[^\n]*axisLabelVisible: false/],
  ].forEach(([n, re]) => check(`C1: ${n} が axisLabelVisible:false`, re.test(src)));
  check("C2: OBV が priceFormat volume", /lineWidth: 1\.8,[\s\S]{0,200}priceFormat: \{ type: "volume" \}/.test(src));
  check("C2/C3: subBaseOpts = scaleMargins 0.16 + minimumWidth 72",
    /rightPriceScale: \{ borderColor: "#2a3a44", scaleMargins: \{ top: 0\.16, bottom: 0\.16 \}, minimumWidth: 72 \}/.test(src));
  check("C2: メイン rightPriceScale minimumWidth 72",
    /rightPriceScale: \{ borderColor: "#2a3a44", minimumWidth: 72 \}/.test(src));

  // ── ② DOM 実測
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(2500);
  // 5枚全展開（既定 adx+atr／追加分は SOFT_CAP=2 で畳んだまま追加される→「すべて開く」で開く）
  await page.evaluate(() => ["rsi", "macd", "obv"].forEach((k) => document.getElementById("sp-chip-" + k)?.click()));
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.getElementById("subpanel-links").querySelectorAll("a")[0].click());
  await page.waitForTimeout(1800);

  let s = await page.evaluate(SNAP);
  check("5枚とも mount 済み", s.length === 5 && s.every((x) => x.mounted), s.map((x) => x.key).join(","));
  const ws = s.map((x) => x.axisW);
  check("C2: 右軸幅が全サブパネルで一致", new Set(ws).size === 1, ws.join("/"));
  check("C2: 右軸幅 = minimumWidth 72", ws.every((w) => w === 72), ws.join("/"));
  const atr = s.find((x) => x.key === "atr");
  check("D25 代替: ATR にのみ中央値バッジ",
    /^中央 \d+(\.\d+)?%$/.test(atr.metric) && s.filter((x) => x.key !== "atr").every((x) => x.metric === ""),
    s.map((x) => x.key + ":" + JSON.stringify(x.metric)).join(" "));

  // ATR を畳む→バッジは空へ（stale 値を残さない）→再展開で復帰
  const clickAtrHead = () => [...document.querySelectorAll("#subpanel-accordion .acc-item")]
    .find((it) => it.dataset.key === "atr").querySelector(".acc-head").click();
  await page.evaluate(clickAtrHead);
  await page.waitForTimeout(900);
  s = await page.evaluate(SNAP);
  check("ATR 畳み: バッジが空へ", s.find((x) => x.key === "atr").metric === "");
  await page.evaluate(clickAtrHead);
  await page.waitForTimeout(1500);
  s = await page.evaluate(SNAP);
  check("ATR 再展開: バッジ復帰", /^中央 \d+(\.\d+)?%$/.test(s.find((x) => x.key === "atr").metric));

  check("pageerror 0", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/subpanel-verify.js`
Expected: **FAIL**（現状＝C1 の 7 本すべて不一致・右軸幅が `52/46/52/58/92` でバラバラ・`.acc-metric` 不在で ATR バッジ空）。この FAIL 出力（特に軸幅の実測列）を SDD ledger に控える。

- [ ] **Step 2: C1＝基準線7本の軸ラベル抑止（detail-charts.js）**

`:287-289`（buildRSI）を置換:

```js
        series.createPriceLine({ price: 70, color: "rgba(255,102,153,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "70" });
        series.createPriceLine({ price: 50, color: "rgba(148,163,184,0.2)", lineWidth: 1, lineStyle: 3, axisLabelVisible: false });
        series.createPriceLine({ price: 30, color: "rgba(52,245,207,0.5)",  lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "30" });
```

`:309`（buildMACD）を置換:

```js
        hist.createPriceLine({ price: 0, color: "rgba(148,163,184,0.2)", lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
```

`:335`（buildADX・明示 true→false）を置換:

```js
        adxLine.createPriceLine({ price: 25, color: "rgba(255,216,77,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "25" });
```

`:363`（buildATR・明示 true→false。**LWC v4.2.3 は axisLabelVisible:false で pane title も描画しない＝D25 で承認済み**。title 文字列は残すが非描画＝代替表示は Step 5 のバッジ）を置換:

```js
          medLine = series.createPriceLine({ price: +med.toFixed(2), color: "rgba(168,188,198,0.4)", lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: "中央 " + med.toFixed(1) + "%" });
```

`:372`（buildOBV 0線）を置換:

```js
        series.createPriceLine({ price: 0, color: "rgba(148,163,184,0.25)", lineWidth: 1, lineStyle: 3, axisLabelVisible: false });
```

- [ ] **Step 3: C2＝OBV 生値軸の volume 化＋軸幅 72 揃え（D24）**

`:368-371`（buildOBV の addLineSeries）を置換:

```js
        const series = chart.addLineSeries({
          color: "#5cf0ff", lineWidth: 1.8,
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
          priceFormat: { type: "volume" },   // C2: 生値2桁小数(-58416942.00・軸幅92px)→ ±58.4M 形式（メイン出来高 :631 と同型）
        });
```

`:609`（initPriceChart のメイン rightPriceScale）を置換＝サブパネルと同値の下限幅（**現状の自然幅は 66px＝72 へ広がりペインが 6px 狭くなる＝層2 の意図 diff**）:

```js
          rightPriceScale: { borderColor: "#2a3a44", minimumWidth: 72 },
```

- [ ] **Step 4: C3＝上下端ティックのクリップ解消（subBaseOpts 1行・C2 の minimumWidth と同居）**

`:270` を置換:

```js
        rightPriceScale: { borderColor: "#2a3a44", scaleMargins: { top: 0.16, bottom: 0.16 }, minimumWidth: 72 },
```

- [ ] **Step 5: ATR 中央値バッジ（D25 の代替表示・DOM 経路 host→.acc-item→.acc-metric）**

(a) `detail.js` addSubpanelItem の `head.innerHTML`（:359-365）に1行追加（`.acc-sub` の後・`.spacer` の前）:

```js
      '<span class="acc-sub">' + window.esc(meta.sub) + '</span>' +
      '<span class="acc-metric"></span>' +   // C1(D25): 軸ラベル/pane title を消した動的値の代替表示（ATR 中央値のみ書込・他は空）
      '<span class="spacer"></span>' +
```

(b) `detail-charts.js` mountSubpanel の createChart 直後（`def.build(chart);` の前）に1行追加:

```js
          chart.__host = hostEl;   // IIFE 私有 chart から見出し DOM へ到達する唯一の経路（C1 代替表示／C4 の DOM 順判定）
```

(c) `detail-charts.js` buildATR の `__setData` 内・medLine 生成の直後に2行追加:

```js
          const badge = chart.__host?.closest(".acc-item")?.querySelector(".acc-metric");
          if (badge) badge.textContent = "中央 " + med.toFixed(1) + "%";   // textContent＝esc 不要
```

(d) `detail-charts.js` unmountSubpanel（`try { m.chart.remove(); } catch (e) {}` の直後）に2行追加＝畳んだときに stale な中央値を残さない:

```js
        const badge = m.host?.closest(".acc-item")?.querySelector(".acc-metric");
        if (badge) badge.textContent = "";
```

(e) `detail.css:619`（`.acc-sub` 定義）の直後に1行追加（`.acc-sub` と同型・12px 床準拠）:

```css
      .acc-metric { font-family: var(--ix-mono); font-size: 12px; color: var(--ix-text-dim); }
```

- [ ] **Step 6: 受入 PASS 確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/subpanel-verify.js
```
Expected: **ALL PASS**（右軸幅が 5枚とも 72・ATR バッジ `中央 x.x%`・pageerror 0）。

- [ ] **Step 7: 回帰束＋層2 検分→再 baseline＋コミット**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js                 # fail 0（本タスクは rules 非接触）
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js        # ALL PASS
NODE_PATH=/home/shugo/node_modules node scratchpad/sr-window-verify.js         # ALL PASS（Task 10 前＝現ゲートのまま通る）
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js       # pageerror 0
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js        # ALL PASS（detail.css 触ったため・checked 数の減少がないこと）
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare  # 層1 MATCH／層2 diff キーを検分
jq '.chartContainerDims' scratchpad/detail-baseline.json                       # メイン軸 66→72 のペイン幅縮小が意図 diff
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture  # 検分 OK なら再 baseline 昇格
git add detail-charts.js detail.js detail.css scratchpad/subpanel-verify.js
git commit -m "fix(subpanel): 基準線7本の軸ラベル抑止＋OBV volume軸/軸幅72揃え＋端マージン0.16＋ATR中央値バッジ（C1-C3・D18/D24/D25）"
```

**受入（このタスクの完了条件・機械判定）**
1. `scratchpad/subpanel-verify.js` が **ALL PASS**（exit 0）＝ C1 ソース照合 7/7・右軸幅 5枚とも 72・ATR バッジ正規表現一致＋他4枚は空・畳み/再展開でバッジが消えて戻る・pageerror 0。
2. `detail-snapshot.js compare` の**層1（windowApi 15/17・canvasCount・pageErrors 0）が MATCH**。層2 diff は「メイン/サブの右軸幅とペイン寸法」のみで、検分後に capture 昇格済み。
3. bs-callout-verify / sr-window-verify / smoke-zigzag-range / theme-floor-check が ALL PASS、node テスト fail 0。
4. C3（上下端ティック非クリップ）の見た目は canvas 描画のため機械判定不可＝**ソース照合（scaleMargins 0.16）＋本人実機サニティ項目7**に委ねる（spec §4.5）。

---

### Task 8: サブパネル C4＝時間軸を常に最下段のみ（spec §4.4・D19）

**Files:**
- Modify: `detail-charts.js:384-390`（SUBPANEL_REGISTRY＝timeAxis 廃止・macd 110→104）・`:391-393`（`_mountGen` 追加）・`:396-417`（mountSubpanel＝rAF 世代ガード＋軸 OFF 生成＋`_updateSubTimeAxes()` 呼出）・`:418-425`（unmountSubpanel＝世代 bump＋`_updateSubTimeAxes()` 呼出）・`:425` 直後（`_updateSubTimeAxes` 新設）・`:433-438`（resizeSubpanels の高さ式）
- Modify: `detail.js:292`（SUBPANEL_META macd height 110→104＝**二重定義ミラー必須**）
- Modify: `scratchpad/subpanel-verify.js`（C4 チェックを追記）

**Interfaces:**
- Consumes: `chart.__host`（Task 7 で設定）・`_subMounted[key].host` の DOM 位置
- Produces: `_updateSubTimeAxes()`（**closure 内私有＝新規 window/DetailCharts 公開なし**）・`_subMounted[key].axisOn`（resizeSubpanels と共有する高さ状態）

- [ ] **Step 1: `TIME_AXIS_H` の確定（B0 実測値の取り込み）**

```bash
grep -n "TIME_AXIS_H\|time-axis\|canvasCount" scratchpad/plan-parts/b0-measured.md
```
`b0-measured.md` の実測値を採用する（**暫定値 28**＝本 plan 執筆時に headless 1440px で実測した MACD の time-axis 行高が 28px・同時に「軸 ON/OFF で host 内 canvas 数は 7 個で不変」も実測済＝spec §12.1 の canvasCount 例外は**不要見込み**）。b0-measured.md が 28 以外を示す場合はコード定数と verify の期待値を**両方**その値へ差し替える。

- [ ] **Step 2: 受入スクリプトに C4 チェックを先に追記（検証先行）**

`scratchpad/subpanel-verify.js` の `check("pageerror 0", ...)` の**直前**に挿入:

```js
  // ── ③ C4: 時間軸は DOM 最下段のみ＋高さ補償（TIME_AXIS_H は b0-measured.md の実測値）
  const TIME_AXIS_H = 28;
  const BASE_H = { rsi: 100, macd: 104, adx: 132, atr: 104, obv: 104 };
  const axisKeys = (arr) => arr.filter((x) => x.axisH > 0).map((x) => x.key);
  check("C4: createChart は常に軸 OFF 生成", /timeScale: \{ borderColor: "#2a3a44", visible: false \}/.test(src));
  check("C4: SUBPANEL_REGISTRY の timeAxis フラグ廃止", !/timeAxis/.test(src));
  check("C4: _updateSubTimeAxes = 定義1＋呼出2", (src.match(/_updateSubTimeAxes\(\)/g) || []).length === 3,
    String((src.match(/_updateSubTimeAxes\(\)/g) || []).length));
  const dsrc = fs.readFileSync("detail.js", "utf8");
  check("C4: MACD 高さ 104 の二重定義ミラー",
    /macd: \{ height: 104,/.test(src) && /key: "macd",[^\n]*height: 104,/.test(dsrc));

  s = await page.evaluate(SNAP);
  check("C4: 軸を持つのは1枚だけ", axisKeys(s).length === 1, axisKeys(s).join(","));
  check("C4: 軸は DOM 最下段", axisKeys(s)[0] === s[s.length - 1].key, `${axisKeys(s)[0]} vs ${s[s.length - 1].key}`);
  check("C4: 軸行の高さ = TIME_AXIS_H", s[s.length - 1].axisH === TIME_AXIS_H, String(s[s.length - 1].axisH));
  check("C4: host 高 = ペイン高+軸高（canvas はみ出しゼロ）",
    s.every((x) => x.hostH === x.paneH + Math.max(x.axisH, 0)),
    JSON.stringify(s.map((x) => [x.key, x.hostH, x.paneH, x.axisH])));
  check("C4: 高さ補償 = base(+28 は最下段のみ)",
    s.every((x) => x.hostH === BASE_H[x.key] + (x.axisH > 0 ? TIME_AXIS_H : 0)),
    JSON.stringify(s.map((x) => x.key + ":" + x.hostH)));

  // 最下段を「外す」→ 軸が新しい最下段へ移る
  await page.evaluate(() => {
    const items = [...document.querySelectorAll("#subpanel-accordion .acc-item")];
    items[items.length - 1].querySelector(".acc-close").click();
  });
  await page.waitForTimeout(1200);
  s = await page.evaluate(SNAP);
  check("C4: 最下段除去後も軸は1枚・新最下段",
    axisKeys(s).length === 1 && axisKeys(s)[0] === s[s.length - 1].key, axisKeys(s).join(",") + " / " + s.map((x) => x.key).join(","));
  check("C4: 除去後の高さ補償も整合", s.every((x) => x.hostH === BASE_H[x.key] + (x.axisH > 0 ? TIME_AXIS_H : 0)),
    JSON.stringify(s.map((x) => x.key + ":" + x.hostH)));

  // resizeSubpanels 二重呼び出しで高さが累積しない（冪等）
  await page.evaluate(() => { DetailCharts.resizeSubpanels(); DetailCharts.resizeSubpanels(); });
  await page.waitForTimeout(400);
  const s2 = await page.evaluate(SNAP);
  check("C4: resize 冪等（高さ累積なし）",
    JSON.stringify(s2.map((x) => x.hostH)) === JSON.stringify(s.map((x) => x.hostH)),
    JSON.stringify(s2.map((x) => x.hostH)));

  // rAF 世代ガード: 同一チップの高速 4 連打（add→remove→add→remove→add 相当）でも chart は host あたり1個
  await page.evaluate(() => { const c = document.getElementById("sp-chip-rsi"); c.click(); c.click(); c.click(); c.click(); });
  await page.waitForTimeout(2000);
  const s3 = await page.evaluate(SNAP);
  check("rAF 世代ガード: host あたり chart は 1 個以下", s3.every((x) => x.charts <= 1),
    JSON.stringify(s3.map((x) => x.key + ":" + x.charts)));
  check("C4: 連打後も軸は最下段1枚", axisKeys(s3).length === 1 && axisKeys(s3)[0] === s3[s3.length - 1].key,
    axisKeys(s3).join(",") + " / " + s3.map((x) => x.key).join(","));
```

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/subpanel-verify.js`
Expected: **FAIL**（現状＝軸は MACD 固定で DOM 中段に出る・`timeAxis` フラグ存在・`_updateSubTimeAxes` 不在・macd host 高 110）。Task 7 分のチェックは PASS のまま。

- [ ] **Step 3: SUBPANEL_REGISTRY から timeAxis 廃止＋MACD 高さ正規化（detail-charts.js:384-390）**

```js
      const SUBPANEL_REGISTRY = {
        rsi:  { height: 100, build: buildRSI },
        macd: { height: 104, build: buildMACD },   // C4: 110 は時間軸込みの設計値 → base=104 に正規化（detail.js SUBPANEL_META と鏡像・両方必須）
        adx:  { height: 132, build: buildADX },
        atr:  { height: 104, build: buildATR },
        obv:  { height: 104, build: buildOBV },
      };
```

`detail.js:292` を鏡像修正（**忘れると host 高 110 と chart 高 104 が食い違う**）:

```js
    { key: "macd", label: "MACD",    sub: "(12,26,9)",  term: "macd", height: 104, desc: "短期と長期の移動平均の差。勢いの向きと転換の傾向。" },
```

- [ ] **Step 4: mountSubpanel＝軸 OFF 生成＋rAF 世代ガード＋呼出（detail-charts.js:391-417）**

`:391-393` の状態宣言に1行追加:

```js
      const _subMounted = {};   // key -> { chart, host, height, axisOn }
      const _subOrder = [];     // mount順
      const _mountGen = {};     // key -> rAF create ループの世代（expand→即collapse→再expand の二重 createChart 防止）
      let _subSyncBound = false;
```

`:396-417` の mountSubpanel を置換:

```js
      // 0x0罠回避: hostEl が可視(clientWidth>0)になるまで rAF で待ってから createChart（冪等）。
      //  世代トークン: pending な create ループは unmount / 後続 mount で失効する（旧ループの復活による
      //  二重 createChart＝chart リークを防ぐ。現物に再入ガードが無かった潜在バグの同梱修正）。
      function mountSubpanel(key, hostEl, opts) {
        opts = opts || {};
        if (_subMounted[key]) { resizeSubpanels(); return; }
        const def = SUBPANEL_REGISTRY[key];
        if (!def || !hostEl) return;
        const height = opts.height || def.height;
        const gen = _mountGen[key] = (_mountGen[key] || 0) + 1;
        let tries = 0;
        const create = () => {
          if (gen !== _mountGen[key] || _subMounted[key]) return;   // 世代失効／別ループが作成済み
          if (!hostEl.clientWidth) { if (tries++ < 30) requestAnimationFrame(create); return; }
          const chart = LightweightCharts.createChart(hostEl, {
            ...subBaseOpts, timeScale: { borderColor: "#2a3a44", visible: false }, height,   // C4: 生成時は常に軸OFF
          });
          chart.__host = hostEl;
          def.build(chart);
          _subMounted[key] = { chart, host: hostEl, height, axisOn: false };
          if (_subOrder.indexOf(key) === -1) _subOrder.push(key);
          _updateSubTimeAxes();       // C4: 登録直後（DOM 順が確定した地点）で最下段へ軸を付け替える
          ensureSubSync();
          if (currentDisplayPrices) chart.__setData(currentDisplayPrices, currentAllPrices);
          const range = priceChart && priceChart.timeScale().getVisibleLogicalRange();
          if (range) chart.timeScale().setVisibleLogicalRange(range);
        };
        requestAnimationFrame(create);
      }
```

- [ ] **Step 5: unmountSubpanel＋`_updateSubTimeAxes` 新設＋resizeSubpanels（detail-charts.js:418-438）**

`:418-425` の unmountSubpanel を置換（**世代 bump は `!m` の早期 return より前**＝pending 中の create を確実に失効させるため）:

```js
      function unmountSubpanel(key) {
        _mountGen[key] = (_mountGen[key] || 0) + 1;   // pending な create ループを失効（collapse 直後の再 expand 対策）
        const m = _subMounted[key];
        if (!m) return;
        try { m.chart.remove(); } catch (e) {}
        const badge = m.host?.closest(".acc-item")?.querySelector(".acc-metric");
        if (badge) badge.textContent = "";
        delete _subMounted[key];
        const i = _subOrder.indexOf(key);
        if (i !== -1) _subOrder.splice(i, 1);
        _updateSubTimeAxes();         // C4: 残ったパネルの最下段へ軸を移す
      }
      // C4: 時間軸は「DOM 上いちばん下のサブパネル」だけに出す（mount/unmount 後に必ず呼ぶ・冪等）。
      //  DOM 順で判定する理由（D19）: _subOrder は mount 順で、畳む→開くで並びが崩れ最下段判定に使えない。
      //  高さ補償: 軸 ON のパネルは host/chart とも base+TIME_AXIS_H にする（chart.resize だけだと canvas が
      //  host を TIME_AXIS_H 分はみ出す＝detail.js:331 が base 固定・.subpanel-host に高さ規定が無いため）。
      //  既知トレードオフ: 軸の付け替えでアコーディオン全体の高さが ±TIME_AXIS_H 動く（レイアウトシフト）。
      //  許容不可なら「補償なし案(a)」＝h を m.height 固定にし host.style.height を触らない（最下段ペインが
      //  TIME_AXIS_H 分縮む）へ 1 行差で退避できる。
      const TIME_AXIS_H = 28;
      function _updateSubTimeAxes() {
        const keys = Object.keys(_subMounted).filter((k) => _subMounted[k]);
        if (!keys.length) return;
        keys.sort((a, b) => (_subMounted[a].host.compareDocumentPosition(_subMounted[b].host)
          & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
        const bottom = keys[keys.length - 1];
        for (const k of keys) {
          const m = _subMounted[k], on = (k === bottom);
          if (m.axisOn === on) continue;                 // 冪等ガード
          m.axisOn = on;
          m.chart.applyOptions({ timeScale: { visible: on } });
          const h = m.height + (on ? TIME_AXIS_H : 0);
          m.host.style.height = h + "px";
          if (m.host.clientWidth > 0) m.chart.resize(m.host.clientWidth, h);
        }
      }
```

`:433-438` の resizeSubpanels を置換（軸分の高さがリサイズで失われるのを防ぐ・host も同式で同期）:

```js
      function resizeSubpanels() {
        for (const k in _subMounted) {
          const m = _subMounted[k];
          if (m && m.host.clientWidth > 0) {
            const h = m.height + (m.axisOn ? TIME_AXIS_H : 0);
            m.host.style.height = h + "px";
            m.chart.resize(m.host.clientWidth, h);
          }
        }
      }
```

- [ ] **Step 6: 受入 PASS 確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/subpanel-verify.js
```
Expected: **ALL PASS**（Task 7 分＋C4 分）。FAIL する場合は `axisH` の実測値を確認し、`TIME_AXIS_H` が b0-measured.md と一致しているかを最初に疑う。

- [ ] **Step 7: 回帰束＋層2 検分→再 baseline＋コミット**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js                 # fail 0（tests/ にサブパネル参照 0 件）
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js        # ALL PASS
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js       # pageerror 0
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare  # 層1 MATCH（canvasCount は B0 実測どおり不変が期待値）
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture  # 層2 検分後に昇格
git add detail-charts.js detail.js scratchpad/subpanel-verify.js
git commit -m "fix(subpanel): 時間軸を常に最下段のみへ（DOM順判定・高さ補償・rAF世代ガード同梱・C4/D19）"
```
**canvasCount が変動した場合のみ**（B0 実測と食い違う場合）: 先に spec §12.1 へ C4 の意図 diff として例外を明記してから昇格する（spec §4.5 の条件）。

**受入（このタスクの完了条件・機械判定）**
1. `scratchpad/subpanel-verify.js` **ALL PASS**（exit 0）＝ソース照合4（軸OFF生成/timeAxis 廃止/`_updateSubTimeAxes` 3出現/macd 104 ミラー）＋DOM 実測（軸 1枚・DOM 最下段・軸行 28px・host 高 = pane+axis・base+28 の高さ補償・最下段除去後の追従・resize 冪等・host あたり chart 1個）。
2. `detail-snapshot.js compare` の層1 MATCH（**canvasCount 不変**＝B0 実測どおり）・pageErrors 0。層2（chartContainerDims/domHash）は検分後に capture 昇格。
3. node テスト fail 0・bs-callout-verify / smoke-zigzag-range ALL PASS。
4. レイアウトシフト（±28px）の許容は**本人実機サニティ項目7**（機械判定の対象外・許容不可なら上記コメントの案(a)へ 1 行差で退避）。

---

### Task 9: fitContent 配線（#9 描画側・spec §9・D20）

**Files:**
- Modify: `detail-charts.js:527-535`（updateMaAndVolume 末尾に fit 評価）・`:608`（timeScale に `lockVisibleTimeRangeOnResize`）・`:1303-1305` 近傍（`getPriceVisibleRange` 新設）・`:1473-1479`（DetailCharts 公開面へ追加）
- Modify: `detail.js:686`（stale コメントの事実化＝コメントのみ）
- Modify: `scratchpad/mock_prod_server.py:52-53/:160-175`（検証専用 ticker `ZZFIT35` の合成35本・**既存銘柄の系列は不変**）
- Create: `scratchpad/fit-range-verify.js`

**Interfaces:**
- Consumes: `DetailRules.fitLogicalRange(barCount, paneWidth, maxBarSpacing = 15) -> {fit:true} | {fit:false, from, to} | null`（Part A Task 6 が実装済み・**再実装しない**）
- Produces: `DetailCharts.getPriceVisibleRange() -> {from:number,to:number}|null`（受入デバッグ用の薄ラッパ・**window 直下公開は禁止**＝spec §14。detail-snapshot の WINDOW_API は window 直下 17 名のみ検査＝**windowApi 15/17 は不変・再 baseline 不要**）

- [ ] **Step 1: 受入スクリプトを先に書く（検証先行）**

`scratchpad/fit-range-verify.js` を新規作成:

```js
// #9 受入（spec §9）: 少数バーの左余白解消＝可視 logical range の数値アサート。
//  priceChart は IIFE 私有のため DetailCharts.getPriceVisibleRange()（DetailCharts 名前空間の薄ラッパ・
//  window 直下公開なし＝spec §14）経由で読む。ペイン幅は LWC が生成する table の1行目・中央セル幅。
const { chromium } = require("playwright");
const fs = require("fs");
let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ✅ " : "  ❌ ") + name + (extra === undefined ? "" : `  [${extra}]`));
  if (!ok) failed++;
}
(async () => {
  // ── ① ソース照合
  const src = fs.readFileSync("detail-charts.js", "utf8");
  check("配線: updateMaAndVolume 末尾で fitLogicalRange 評価",
    /DetailRules\.fitLogicalRange\(displayPrices\.length, w\)/.test(src));
  check("配線: fit / setVisibleLogicalRange の分岐",
    /ts\.fitContent\(\) : ts\.setVisibleLogicalRange\(\{ from: r\.from, to: r\.to \}\)/.test(src));
  check("lockVisibleTimeRangeOnResize: true",
    /timeScale: \{ borderColor: "#2a3a44", lockVisibleTimeRangeOnResize: true \}/.test(src));
  check("ゲッターは DetailCharts 名前空間のみ（window 直下公開なし）",
    /getPriceVisibleRange,/.test(src) && !/window\.getPriceVisibleRange/.test(src));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });

  // ── ② 実データ US 銘柄の 2026 FY（181本＝fit 分岐。修正前は既定 barSpacing 6px で左に約33本ぶんの空白）
  await page.evaluate(() => navigateToDetail("NVDA"));
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("#year-controller-box .time-btn")].find((x) => x.innerText.trim().startsWith("2026"));
    if (b) b.click();
  });
  await page.waitForTimeout(2500);
  const r1 = await page.evaluate(() => {
    const { displayPrices } = DetailRules.priceWindow(STOCK_DATA["NVDA"].prices, 2026, true);
    const r = DetailCharts.getPriceVisibleRange();
    const tbl = document.querySelector("#chart-container table");
    const paneW = tbl ? tbl.rows[0].cells[1].getBoundingClientRect().width : 0;
    return { n: displayPrices.length, from: r ? r.from : null, to: r ? r.to : null, paneW };
  });
  check(`NVDA FY2026: 181本前後（n=${r1.n}）`, r1.n > 150 && r1.n < 220, String(r1.n));
  check(`NVDA FY2026: 左余白なし（from=${r1.from})`, r1.from !== null && r1.from > -2, String(r1.from));
  check(`NVDA FY2026: 右端まで表示（to=${r1.to}）`, r1.to !== null && r1.to >= r1.n - 1, String(r1.to));

  // ── ③ 合成35本（クランプ分岐＝中央寄せパディング）
  //  mock 鯖の build_ohlcv が返す検証専用 ticker。list には載せない（＝ポータル DOM/前 wave 受入6本に非波及）
  //  ので、STOCK_DATA へ stub を注入してから navigateToDetail → getStock が ohlcv/financials を引く。
  await page.evaluate(() => {
    STOCK_DATA["ZZFIT35"] = { company_name: "Fit Clamp Test ETF", industry: "検証用", currency: "USD",
      country: "US", type: "etf", marketCap: 1e11, per: 10, pbr: 1, prices: [], financials_trend: {} };
  });
  await page.evaluate(() => navigateToDetail("ZZFIT35"));
  await page.waitForTimeout(2500);
  const r2 = await page.evaluate(() => {
    const { displayPrices } = DetailRules.priceWindow(STOCK_DATA["ZZFIT35"].prices, 2025, true);
    const r = DetailCharts.getPriceVisibleRange();
    const tbl = document.querySelector("#chart-container table");
    const paneW = tbl ? tbl.rows[0].cells[1].getBoundingClientRect().width : 0;
    return { n: displayPrices.length, from: r ? r.from : null, to: r ? r.to : null, paneW };
  });
  check(`ZZFIT35: 合成35本が届いている（n=${r2.n}）`, r2.n === 35, String(r2.n));
  check("クランプ: 左右にパディング（from<0 かつ to>n-1）", r2.from < 0 && r2.to > r2.n - 1, `${r2.from} / ${r2.to}`);
  check("クランプ: 左右対称（差 <1 logical）",
    Math.abs((-r2.from) - (r2.to - (r2.n - 1))) < 1, `${r2.from} / ${r2.to}`);
  check("クランプ: バー幅 ≈ maxBarSpacing 15px（±2px）",
    Math.abs(r2.paneW / (r2.to - r2.from) - 15) <= 2, String((r2.paneW / (r2.to - r2.from)).toFixed(2)));

  check("pageerror 0", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

（`#chart-container table` の1行目・中央セル＝LWC のペイン領域、最終セル＝右軸。本 plan 執筆時に headless 1440px で実測した構造・NVDA FY2026 は n=181 / コンテナ幅 1350 / ペイン幅 1284。）

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/fit-range-verify.js`
Expected: **FAIL**（`DetailCharts.getPriceVisibleRange is not a function` で page 側 evaluate が throw＝全機能チェックが FAIL）。

- [ ] **Step 2: 受入用の合成35本 ticker を mock 鯖へ追加（既存銘柄の系列は 1 バイトも変えない）**

`scratchpad/mock_prod_server.py:52-53` の直後に追加:

```python
# 受入専用の合成銘柄（#9 少数バークランプ）。ticker_master に無く /api/market/list にも載らない
#  （＝ポータル DOM・前 wave 受入6本へ非波及）。詳細ビューは verify 側が STOCK_DATA へ stub を注入し
#  navigateToDetail → getStock がこの ohlcv/financials を引く。
_SYNTH_OHLCV = {
    "ZZFIT35": {"bars": 35, "end": datetime.date(2025, 12, 31)},
}
```

`_ticker_known`（:160-164）を置換:

```python
def _ticker_known(ticker: str) -> bool:
    if ticker in _SYNTH_OHLCV:          # 受入専用の合成銘柄
        return True
    with _db() as conn:
        return conn.execute(
            "SELECT 1 FROM ticker_master WHERE ticker = ? LIMIT 1", (_base_ticker(ticker),)
        ).fetchone() is not None
```

`build_ohlcv`（:171-174）の本数/終端の決定を置換（**生成式そのものは不変＝既存銘柄は完全に同一バイト**）:

```python
    h = _ticker_hash(ticker)
    base = 1000.0 + (h % 4000)          # 銘柄別ベース価格 1000〜5000
    synth = _SYNTH_OHLCV.get(ticker)
    n = synth["bars"] if synth else _OHLCV_BARS
    end = synth["end"] if synth else _OHLCV_END
    start = end - datetime.timedelta(days=n - 1)
```

確認（mock 鯖を再起動してから）:

```bash
curl -s "http://127.0.0.1:8200/api/market/ohlcv?ticker=ZZFIT35" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['prices']), d['prices'][0]['time'], d['prices'][-1]['time'])"
# -> 35 2025-11-27 2025-12-31
curl -s "http://127.0.0.1:8200/api/market/list" | python3 -c "import json,sys; d=json.load(sys.stdin); print(len(d['stocks']), 'ZZFIT35' in d['stocks'])"
# -> 95 False（list 非搭載＝ポータル非波及）
```

- [ ] **Step 3: デバッグゲッターを新設（DetailCharts 名前空間・+3行）**

`detail-charts.js:1303-1305`（resizePrice）の直後に追加:

```js
  // #9 受入用の薄いデバッグゲッター（resizePrice と同型）。window 直下には公開しない（spec §14 の IIFE 規律・
  //  detail-snapshot の WINDOW_API 17 名は window 直下のみ検査＝windowApi 15/17 は不変）。
  function getPriceVisibleRange() {
    return priceChart ? priceChart.timeScale().getVisibleLogicalRange() : null;
  }
```

`:1477`（DetailCharts 公開面）に追加:

```js
    repaint, onWindowResize, renderCompareChart, resizePrice, getPriceVisibleRange,
```

- [ ] **Step 4: 修正前の実測値を採取（before 記録・FAIL 確認）**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/fit-range-verify.js
```
Expected: **FAIL**（ソース照合3件と機能チェックが FAIL）。出力の `from` 実測値（NVDA FY2026 で概ね **-30〜-36**＝左余白の正体、ZZFIT35 で **-0 前後＝右端寄せのまま**）を SDD ledger に控える＝「症状が実在した」証拠。

- [ ] **Step 5: fit 配線（updateMaAndVolume 末尾・+7行）**

`detail-charts.js:534`（`refreshSubpanels(displayPrices, allPrices);`）の直後・関数終端 `:535` の直前に挿入:

```js

        // ── 表示窓の視域確定（#9・D20）: 全系列 setData 完了後に一度だけ。少数バーは中央寄せパディングで
        //  ローソク幅を maxBarSpacing にクランプする（LWC v4.2.3 に maxBarSpacing オプションは無い）。
        //  ts.width()=price 軸を除いたペイン幅。0（非表示）は skip＝0x0罠と同じガード思想。
        const ts = priceChart.timeScale();
        const w = ts.width() || (document.getElementById("chart-container")?.clientWidth || 0);
        const r = DetailRules.fitLogicalRange(displayPrices.length, w);
        if (r) r.fit ? ts.fitContent() : ts.setVisibleLogicalRange({ from: r.from, to: r.to });
```

- [ ] **Step 6: リサイズで視域を保存（initPriceChart :608・+1語）**

```js
          timeScale: { borderColor: "#2a3a44", lockVisibleTimeRangeOnResize: true },
```

- [ ] **Step 7: 序で＝stale コメントの事実化（detail.js:686・コメントのみ）**

```js
      //  実処理は rAF＋[300,700,1100,1500,1900]ms 遅延で走り、後続で同期描画される財務チャート(bs/pl/cf/radar)も
```

- [ ] **Step 8: 受入 PASS 確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/fit-range-verify.js
```
Expected: **ALL PASS**（NVDA FY2026 の `from` が -0.5 前後・ZZFIT35 が左右対称パディングでバー幅 ≈15px）。

- [ ] **Step 9: 回帰束＋層2 検分→再 baseline＋コミット**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js                 # fail 0（fitLogicalRange の node テストは Part A Task 6）
PYTHONPATH=$PWD /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q  # 228 不変（mock 鯖は tests/ 収集対象外）
NODE_PATH=/home/shugo/node_modules node scratchpad/sr-window-verify.js         # ALL PASS（窓ロジック非改変の証明）
NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-verify.js            # ALL PASS（年選択経路を触るため）
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js        # ALL PASS
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js       # pageerror 0
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare  # 層1 MATCH（**windowApi 15/17 不変**が最重要）
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture  # 層2 検分後に昇格
git add detail-charts.js detail.js scratchpad/mock_prod_server.py scratchpad/fit-range-verify.js
git commit -m "feat(chart): 少数バーの左余白解消＝fitContent/setVisibleLogicalRange 配線＋視域ゲッター（#9・D20）"
```

**受入（このタスクの完了条件・機械判定）**
1. `scratchpad/fit-range-verify.js` **ALL PASS**（exit 0）＝ソース照合4＋NVDA FY2026 の `from > -2 && to >= n-1`＋ZZFIT35 の左右対称パディングとバー幅 ≈15px（±2px）＋pageerror 0。
2. `detail-snapshot.js compare` で **windowApi が 15/17 のまま MATCH**（ゲッターを window 直下へ出していないことの機械証明）・canvasCount・pageErrors 0 も MATCH。
3. `curl /api/market/list` に `ZZFIT35` が**含まれない**（既存受入6本への非波及の機械確認）。
4. node fail 0・pytest 228・sr-window-verify / zerofy-verify / bs-callout-verify / smoke-zigzag-range ALL PASS。
5. `maxBarSpacing=15` の最終確定（12-18px 候補）とリサイズ体感は**本人実機サニティ項目8**。

---

### Task 10: S/R ラベル選抜の適用＋D9 和集合描画（spec §8.2/§8.4/§8.5・D13/D26）

**Files:**
- Modify: `detail-charts.js:241-258`（applySRLines＝srLabelPlan 適用＋和集合描画）
- Modify: `detail-rules.js:50-83`（INDICATOR_GLOSSARY "sr" に側呼称ねじれの一文）
- Modify: `scratchpad/sr-window-verify.js:11`（**ソース固定アサートの書換＝必須。忘れると偽 FAIL**）＋数値アサート追加
- 参照のみ（変更しない）: `detail-rules.js` の `srLabelPlan` / `srNearest` / `detectSR`（Part A Task 4 実装済み）

**Interfaces:**
- Consumes: `DetailRules.srLabelPlan(resistance, support, close) -> { resistance: boolean[], support: boolean[] }`・`DetailRules.srNearest(sr, close) -> { up: {price,count}|null, dn: {price,count}|null }`・`DetailRules.detectSR(prices, maxPerSide)`（シグネチャ不変）
- Produces: チャート S/R＝「top-3/側 ∪ digest 引用（srNearest）」の線集合。ラベルは srLabelPlan の付与集合のみ（追加線は `axisLabelVisible:false` 固定＝title も非描画＝D26）

- [ ] **Step 1: 受入ゲートを先に更新（sr-window-verify.js＝現行ゲートは新実装で必ず割れる）**

`scratchpad/sr-window-verify.js:11` の1行を置換（**ここを直さずに実装すると偽 FAIL する**）:

```js
  check("A-mini 後継: ラベル判定は DetailRules.srLabelPlan（選抜ロジックは rules 層の単一源）",
    /const plan = DetailRules\.srLabelPlan\(/.test(src)
    && (src.match(/axisLabelVisible: plan\.(resistance|support)\[i\]/g) || []).length === 2
    && !/axisLabelVisible: i < 2/.test(src));
  check("D9 和集合: detectSR(prices, Infinity) ＋ srNearest の追加描画",
    /detectSR\(prices, Infinity\)/.test(src) && /DetailRules\.srNearest\(/.test(src));
```

さらに `:32-33` の subset アサート（**不変**）の後ろ、`check("pageerror 0", ...)` の直前に純関数評価を追加（spec §8.5 ②）:

```js
  // ② 純関数評価: 描画集合とラベル付与集合を rules 層の同一実装で再現し数値アサート（LWC priceLine は
  //    IIFE 私有で列挙 API も無く直接観測不能＝spec §8.5 の受入手段）。
  for (const [t, yr, isUS] of [["NVDA", 2025, true], ["7203.T", 2025, false], ["8306.T", 2025, false]]) {
    const r = await page.evaluate(async ([tk, y, us]) => {
      await getStock(tk);
      const { displayPrices } = DetailRules.priceWindow(STOCK_DATA[tk].prices, y, us);
      const close = displayPrices[displayPrices.length - 1].close;
      const all = DetailRules.detectSR(displayPrices, Infinity);
      const top = { resistance: all.resistance.slice(0, 3), support: all.support.slice(0, 3) };
      const near = DetailRules.srNearest(all, close);
      const drawn = new Set(top.resistance.concat(top.support).map((x) => x.price));
      [near.up, near.dn].forEach((x) => { if (x) drawn.add(x.price); });
      const plan = DetailRules.srLabelPlan(top.resistance, top.support, close);
      const labeled = top.resistance.filter((_, i) => plan.resistance[i]).map((x) => x.price)
        .concat(top.support.filter((_, i) => plan.support[i]).map((x) => x.price));
      let minPairGap = Infinity;
      for (let i = 0; i < labeled.length; i++) for (let j = i + 1; j < labeled.length; j++) {
        minPairGap = Math.min(minPairGap, Math.abs(labeled[i] - labeled[j]) / Math.min(labeled[i], labeled[j]));
      }
      const minCloseGap = labeled.length ? Math.min(...labeled.map((p) => Math.abs(p - close) / close)) : Infinity;
      return {
        labelR: plan.resistance.filter(Boolean).length,
        labelS: plan.support.filter(Boolean).length,
        minPairGap, minCloseGap,
        digestDrawn: [near.up, near.dn].every((x) => !x || drawn.has(x.price)),
        drawnN: drawn.size,
      };
    }, [t, yr, isUS]);
    check(`${t}: ラベル ≤2/側（R=${r.labelR} S=${r.labelS}）`, r.labelR <= 2 && r.labelS <= 2);
    check(`${t}: ラベル同士は ≥1% 離れる`, !(r.minPairGap < 0.01), String(r.minPairGap));
    check(`${t}: 終値±1% にラベル無し`, !(r.minCloseGap < 0.01), String(r.minCloseGap));
    check(`${t}: digest 引用値に対応する線が描画集合に存在（D9 和集合・線 ${r.drawnN}本）`, r.digestDrawn);
  }
```

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/sr-window-verify.js`
Expected: **FAIL**（ソース照合＝新式が未実装／`axisLabelVisible: i < 2` が残存・純関数評価は `srLabelPlan` があれば PASS しうるが「描画集合」はソース側が未対応）。

- [ ] **Step 2: applySRLines を srLabelPlan 適用＋和集合描画へ置換（detail-charts.js:241-258）**

```js
      function applySRLines(prices) {
        srLines.forEach(l => { try { candleSeries.removePriceLine(l); } catch(e) {} });
        srLines = [];
        if (!srState || !prices?.length) return;
        // D13/D26: 描画集合＝全クラスタの top-3/側 ∪ digest 引用（srNearest の up/dn）。
        //  「digest の数値には必ず対応する線がある」を保証する（追加は実測 平均 +0.89 本/最大 +2 本）。
        //  ラベル（軸バッジ＝pane title と運命共同）の選抜は rules 層の純関数 srLabelPlan が単一源
        //  ＝実装・node テスト・verify が同一実装を参照する（選抜ロジックの重複実装によるドリフト根絶）。
        const close = prices[prices.length - 1].close;
        const all = detectSR(prices, Infinity);
        const resistance = all.resistance.slice(0, 3);
        const support = all.support.slice(0, 3);
        const plan = DetailRules.srLabelPlan(resistance, support, close);
        const near = DetailRules.srNearest(all, close);
        resistance.forEach(({ price, count }, i) => {
          srLines.push(candleSeries.createPriceLine({
            price, color: "rgba(255,102,153,0.85)", lineWidth: 1,
            lineStyle: 2, axisLabelVisible: plan.resistance[i], title: `R×${count}`,
          }));
        });
        support.forEach(({ price, count }, i) => {
          srLines.push(candleSeries.createPriceLine({
            price, color: "rgba(52,245,207,0.85)", lineWidth: 1,
            lineStyle: 2, axisLabelVisible: plan.support[i], title: `S×${count}`,
          }));
        });
        // 和集合の追加分（digest が引用する最寄り up/dn が top-3 に無い場合のみ）。ラベルは常に非表示。
        const drawn = new Set(resistance.concat(support).map((x) => x.price));
        [[near.up, "rgba(255,102,153,0.85)", "R"], [near.dn, "rgba(52,245,207,0.85)", "S"]].forEach(([lv, color, tag]) => {
          if (!lv || drawn.has(lv.price)) return;
          drawn.add(lv.price);
          srLines.push(candleSeries.createPriceLine({
            price: lv.price, color, lineWidth: 1,
            lineStyle: 2, axisLabelVisible: false, title: `${tag}×${lv.count}`,
          }));
        });
      }
```
※ `detectSR` は detail-charts.js 内で既に参照されている名前（IIFE 冒頭で `DetailRules` から取り込み済み）。`srLabelPlan`/`srNearest` は取り込みが無いため **`DetailRules.` プレフィックス付きで呼ぶ**（既存の `DetailRules.*` 呼出しと同型）。取り込みエイリアスの有無は実装時に `grep -n "detectSR\|const { .* } = DetailRules" detail-charts.js` で現物確認し、あるなら同じ流儀に合わせる。

- [ ] **Step 3: 用語集に側呼称ねじれの一文（detail-rules.js:50-83 の "sr" 項）**

`INDICATOR_GLOSSARY` の `"sr"` の本文末尾に追記（**既存文言は変えず1文追加**）:

```js
      + "／注: 直近の支持・抵抗は終値の上下で機械的に選ぶため、線のラベル（R×n/S×n）と呼称が入れ替わって見えることがあります（過去のタッチ位置で R/S を付けているため）。"
```
（実際の連結形は現物の文字列リテラル形式に合わせる。`grep -n '"sr"' detail-rules.js` で現物を確認してから編集。）

- [ ] **Step 4: 受入 PASS 確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/sr-window-verify.js
```
Expected: **ALL PASS**（ソース照合＋窓レンジ内＋subset＋ラベル ≤2/側・ペア ≥1%・終値±1% 抑制・digest 引用線の存在）。

- [ ] **Step 5: 回帰束＋層2 検分→再 baseline＋コミット**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js                 # fail 0（S/R 錠4本＋Part A の新規テストが緑のまま）
NODE_PATH=/home/shugo/node_modules node scratchpad/fit-range-verify.js         # ALL PASS（#9 非退行）
NODE_PATH=/home/shugo/node_modules node scratchpad/subpanel-verify.js          # ALL PASS（#1 非退行）
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js        # ALL PASS
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js       # pageerror 0
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare  # 層1 MATCH
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture  # 層2 検分後に昇格（S/R 線は canvas＝domHash 非影響の見込み）
git add detail-charts.js detail-rules.js scratchpad/sr-window-verify.js
git commit -m "fix(sr): ラベル選抜を DetailRules.srLabelPlan へ委譲＋digest引用の和集合描画（D13/D26）"
```

**受入（このタスクの完了条件・機械判定）**
1. `scratchpad/sr-window-verify.js` **ALL PASS**（exit 0）。特に ①`axisLabelVisible: i < 2` がソースから**消えている** ②`axisLabelVisible: plan.resistance[i]` / `plan.support[i]` が各1回 ③`detectSR(prices, Infinity)` と `DetailRules.srNearest(` がソースに存在 ④3銘柄で「ラベル ≤2/側・ペア間 ≥1%・終値±1% にラベル無し・digest 引用値に対応する線が描画集合に存在」。
2. `:32-33` の subset アサート（chart top-3 ⊆ digest 全クラスタ）が**無改変で PASS**（マージが slice 前に置かれている前提の錠）。
3. node テスト fail 0（既存 S/R 錠4本は無改変で緑）・detail-snapshot 層1 MATCH・pageErrors 0。
4. top-3 の顔ぶれ変化は「変わって正しい」検分＋**本人実機サニティ項目9**。

---

### Task 11: 比較チャート F1-F4（spec §10・D23）

**Files:**
- Modify: `detail-charts.js:185`（F-1 lastValueVisible）・`:181-188`（F-2 legend に期間リターン%）
- Modify: `detail.js:82`（F-3 chips ティッカー化）・`:88-93`（F-4 引数化）
- Modify: `index.html:1486-1489`（F-4 onclick 4箇所）
- Modify: `detail.css:378-389` 近傍（`.compare-legend-val`）・`@media (max-width:768px)` ブロック（narrow legend 2列）
- Create: `scratchpad/compare-verify.js`

**Interfaces:**
- Consumes: `normalizeForCompare(ticker, months)` の戻り値末尾 `.value`（= 期間リターン%・追加データ取得ゼロ）
- Produces: `setComparePeriod(months, btn)`（**第2引数は任意**＝旧 onclick 形も `window.event` フォールバックで非破壊）・`.compare-legend-val` の DOM 契約

- [ ] **Step 1: 480px の before 実測を先に取る（コード変更前・このタスクの最初のステップ）**

`scratchpad/compare-verify.js` を新規作成（before/after 兼用＝`MODE=before` では寸法を出力するだけで数値ゲートをかけない）:

```js
// #10 受入（spec §10）: 比較チャート F1-F4。compareChart は IIFE 私有＝右軸バッジはソース照合、
//  legend/chips/縦高は DOM 実測。MODE=before で「コード変更前の 480px 総縦高」を採取する
//  （B0 の detail-snapshot は compare モーダル非対象＝後から before は取れない）。
const { chromium } = require("playwright");
const fs = require("fs");
const BEFORE = process.env.MODE === "before";
let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ✅ " : "  ❌ ") + name + (extra === undefined ? "" : `  [${extra}]`));
  if (!ok) failed++;
}
const TICKERS = ["8306.T", "6758.T", "4755.T", "NVDA", "BRK-B", "MCD", "SBUX"];   // + 7203.T = 8銘柄（上限）
async function openCompare(page) {
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(2200);
  await page.evaluate(() => openCompareModal());
  for (const t of TICKERS) await page.evaluate((tk) => addToCompare(tk), t);
  await page.waitForTimeout(1500);
}
const MEASURE = () => {
  const box = document.querySelector(".compare-modal-box");
  const chips = document.getElementById("compare-chips");
  const lg = document.getElementById("compare-legend");
  return {
    boxH: Math.round(box.getBoundingClientRect().height),
    chipsH: Math.round(chips.getBoundingClientRect().height),
    legendH: Math.round(lg.getBoundingClientRect().height),
    chipTexts: [...chips.querySelectorAll(".compare-chip")].map((c) => c.textContent.replace(/[✕\s]/g, "")),
    legendItems: lg.querySelectorAll(".compare-legend-item").length,
    legendVals: [...lg.querySelectorAll(".compare-legend-val")].map((v) => v.textContent.trim()),
  };
};
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // ── 480px: 縦膨張の before/after
  const narrow = await browser.newPage({ viewport: { width: 480, height: 900 } });
  narrow.on("pageerror", (e) => errors.push(String(e)));
  await narrow.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await openCompare(narrow);
  const m = await narrow.evaluate(MEASURE);
  console.log("  📐 480px:", JSON.stringify(m));
  if (BEFORE) {
    console.log("BEFORE MEASURED（この値を SDD ledger に控えて MODE 無しで再実行する）");
    await browser.close();
    process.exit(0);
  }
  // ── ① ソース照合（F-1）
  const src = fs.readFileSync("detail-charts.js", "utf8");
  check("F-1: compare 系列の lastValueVisible:false",
    /addLineSeries\(\{ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false \}\)/.test(src));
  // ── ② F-2 legend の期間リターン%
  check("F-2: legend 8項目", m.legendItems === 8, String(m.legendItems));
  check("F-2: 全項目に符号付き%", m.legendVals.length === 8 && m.legendVals.every((v) => /^[+-]\d+(\.\d+)?%$/.test(v)),
    m.legendVals.join(" "));
  // ── ③ F-3 chips はティッカーのみ
  check("F-3: chips がティッカー表示", m.chipTexts.length === 8
    && m.chipTexts.every((t) => ["7203.T"].concat(TICKERS).includes(t)), m.chipTexts.join(","));
  const BEFORE_BOX_H = Number(process.env.BEFORE_BOX_H || 0);   // Step 1 で控えた before 値
  check(`F-3: 480px の総縦高が before(${BEFORE_BOX_H}) 以下`, BEFORE_BOX_H > 0 && m.boxH <= BEFORE_BOX_H,
    `after=${m.boxH}`);
  check("F-3: chips 段数が減る（before 122px 相当 → 2段以内 ≈70px 以下）", m.chipsH <= 70, String(m.chipsH));
  // ── ④ F-4 setComparePeriod のプログラム呼出し
  const threw = await narrow.evaluate(() => { try { setComparePeriod(36); return null; } catch (e) { return String(e); } });
  check("F-4: page から setComparePeriod(36) が throw しない", threw === null, String(threw));
  await narrow.waitForTimeout(800);
  const m2 = await narrow.evaluate(MEASURE);
  check("F-4: 期間切替後も legend 8項目が再描画される", m2.legendItems === 8, String(m2.legendItems));
  // クリック経路（btn 引数）で active が1つだけ付く
  const act = await narrow.evaluate(() => {
    [...document.querySelectorAll(".compare-period-btn")][0].click();
    return [...document.querySelectorAll(".compare-period-btn.active")].map((b) => b.textContent.trim());
  });
  check("F-4: クリック経路で active は 1 個（3M）", act.length === 1 && act[0] === "3M", act.join(","));

  // ── ⑤ 1440px でも同様に成立（narrow 専用の退行を避ける）
  const wide = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  wide.on("pageerror", (e) => errors.push(String(e)));
  await wide.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await openCompare(wide);
  const mw = await wide.evaluate(MEASURE);
  check("1440px: legend 8項目＋符号付き%", mw.legendItems === 8 && mw.legendVals.every((v) => /^[+-]\d+(\.\d+)?%$/.test(v)),
    mw.legendVals.join(" "));
  check("pageerror 0", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

```bash
MODE=before NODE_PATH=/home/shugo/node_modules node scratchpad/compare-verify.js
```
Expected: `📐 480px: {"boxH":…,"chipsH":…,…}` が出力される（**本 plan 執筆時の参考実測値＝boxH 816 / chipsH 122 / legendH 68 / legendItems 8 / legendVals []**）。この `boxH` を SDD ledger に控え、以後 `BEFORE_BOX_H=<値>` で渡す。

- [ ] **Step 2: 変更前の FAIL 確認**

```bash
BEFORE_BOX_H=816 NODE_PATH=/home/shugo/node_modules node scratchpad/compare-verify.js
```
Expected: **FAIL**（lastValueVisible:false 無し・`.compare-legend-val` 0件・chips が社名・chipsH 122px）。

- [ ] **Step 3: F-1＋F-2（detail-charts.js:181-188）**

`:181-188` の forEach を置換:

```js
        [...compareSet].forEach((ticker, i) => {
          const color = COMPARE_COLORS[i % COMPARE_COLORS.length];
          const data = normalizeForCompare(ticker, comparePeriodMonths);
          if (data.length === 0) return;
          const series = compareChart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
          series.setData(data);
          // F-2: 右軸バッジ8連を止めた代わりに legend で期間リターン%を読む（value=normalizeForCompare が
          //  算出済みの期間リターン%＝追加のデータ取得ゼロ・基準は index.html:1490 の注記どおり期間開始日）。
          const last = data[data.length - 1].value;
          const pct = (last >= 0 ? "+" : "") + last.toFixed(1) + "%";
          legendEl.innerHTML += `<div class="compare-legend-item"><div class="compare-legend-dot" style="background:${color}"></div><span>${esc(STOCK_DATA[ticker]?.company_name || ticker)}</span><span class="compare-legend-val" style="color:${color}">${pct}</span></div>`;
        });
```

- [ ] **Step 4: F-3 chips のティッカー化（detail.js:82）＋narrow CSS**

`detail.js:82` を置換（社名は legend が担う＝同名二重の解消）:

```js
        ${esc(t)}
```

`detail.css` の `.compare-legend-item`（:378-384）の直後に追加:

```css
      .compare-legend-val {
        font-family: var(--ix-mono);
        font-weight: bold;
        margin-left: 2px;
      }
```

`detail.css` の `@media (max-width: 768px)` ブロック内（`.compare-modal-box { ... }` の直後）に追加:

```css
        /* F-3: legend の縦膨張抑制（8行→4行）。chips はティッカー化で約2段に収まる。 */
        .compare-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; }
```

- [ ] **Step 5: F-4 setComparePeriod の引数化（detail.js:88-93＋index.html:1486-1489）**

`detail.js:88-93` を置換:

```js
  function setComparePeriod(months, btn) {
    comparePeriodMonths = months;
    document.querySelectorAll(".compare-period-btn").forEach(b => b.classList.remove("active"));
    // D23: window.event 依存を解消（引数 btn が正・旧 onclick 形と console/テストからの呼出しも壊さない）。
    (btn || (window.event && window.event.target))?.classList.add("active");
    DetailCharts.renderCompareChart(compareSet, comparePeriodMonths);
  }
```

`index.html:1486-1489` を置換:

```html
          <button class="compare-period-btn" onclick="setComparePeriod(3, this)">3M</button>
          <button class="compare-period-btn active" onclick="setComparePeriod(12, this)">1Y</button>
          <button class="compare-period-btn" onclick="setComparePeriod(36, this)">3Y</button>
          <button class="compare-period-btn" onclick="setComparePeriod(60, this)">5Y</button>
```

- [ ] **Step 6: 受入 PASS 確認**

```bash
BEFORE_BOX_H=816 NODE_PATH=/home/shugo/node_modules node scratchpad/compare-verify.js
```
Expected: **ALL PASS**（480px の `boxH` が before 以下・chipsH ≤70・legend 8項目すべて符号付き%・`setComparePeriod(36)` が throw なし・クリック経路の active 1個・pageerror 0）。

- [ ] **Step 7: 回帰束＋層2 検分→再 baseline＋コミット**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js                 # fail 0（tests/ に compare 参照 0 件）
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js       # 8/8（index.html を触ったため）
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js        # ALL PASS（detail.css・checked 数の減少なし）
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js       # pageerror 0
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js        # ALL PASS
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare  # 層1 MATCH（windowApi は存在チェックのみ＝シグネチャ変更 OK）
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture  # index.html 変更＝domHash 意図 diff を検分後に昇格
git add detail-charts.js detail.js detail.css index.html scratchpad/compare-verify.js
git commit -m "fix(compare): 右軸バッジ抑止＋legend期間リターン%＋chipsティッカー化＋setComparePeriod引数化（F1-F4・D23）"
```

**受入（このタスクの完了条件・機械判定）**
1. `scratchpad/compare-verify.js` **ALL PASS**（exit 0・`BEFORE_BOX_H` に Step 1 の実測値を渡した状態）。
2. before/after の 480px 総縦高が ledger に記録され、**after ≤ before**（参考: before boxH 816 / chipsH 122）。
3. `detail-snapshot.js compare` 層1 MATCH（windowApi 15/17・canvasCount・pageErrors 0）／domHash は index.html 変更の意図 diff として検分後に再 baseline。
4. portal-money-smoke 8/8・theme-floor-check ALL PASS・node fail 0。
5. narrow 2列 legend / chips ティッカー化の違和感は**本人実機サニティ項目6**。

---

### Part B クロージャ（Task 7-11 完了時の確認）

- [ ] **全受入スクリプトの通し実行**

```bash
for s in subpanel-verify fit-range-verify sr-window-verify compare-verify bs-callout-verify unit-badge-verify zerofy-verify zerofy-portal-verify theme-floor-check smoke-zigzag-range; do
  echo "== $s"; BEFORE_BOX_H=816 NODE_PATH=/home/shugo/node_modules node scratchpad/$s.js || echo "FAILED: $s";
done
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
PYTHONPATH=$PWD /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q
git diff --name-only 8e44298 | grep -E "money\.(js|css)|money-rules\.js" && echo "⚠️ 司令室3ファイル接触＝cockpit-e2e 212 check へ昇格" || echo "OK: money 系 非接触"
```
Expected: 全 ALL PASS・node fail 0・pytest 228・money 系 非接触。

- [ ] **Part C への申し送り**（同一ファイルを触るため）: Task 7-11 で detail-charts.js の変更帯は **:181-191 / :241-258 / :267-274 / :282-390 / :396-446 / :527-535 / :608-609 / :1303-1310 / :1473-1479**。Part C の担当帯（bsNotePlugin :147 / renderBSChart :747-967 / radar :1025-1031 / PL formatter :1096-1145）とは重ならない。`DetailCharts` 公開面は `getPriceVisibleRange` の1本のみ増える（windowApi は 15/17 のまま）。
