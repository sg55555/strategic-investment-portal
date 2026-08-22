# UIUX刷新 wave「小工数頻出系一掃」実装 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 前 wave が積み残した「小工数頻出系」の表示不具合 12 項目＋recon 新発見 1 件を一掃し、チャート/ラベル/タイトル/トグルバーの読みにくさと偽値表示を解消する。

**Architecture:** 既存の detail 分離規律（純計算=detail-rules.js/finance-rules.js・描画 lifecycle=detail-charts.js・配線=detail.js）を維持したまま、①判定/選抜/整形ロジックは全て rules 層の純関数として新設し node テストで固定 ②描画層はその純関数を消費するだけ（選抜ロジックの二重実装を作らない）③受入は「rules 層＝node テスト」「描画層＝Playwright の DOM 計測＋ソース照合」の二本立て（lightweight-charts のインスタンスは IIFE 私有で page から観測できないため、canvas 内部状態に依存するアサートは書かない）。

**Tech Stack:** Vanilla JS（IIFE・ES5 互換記法混在）／lightweight-charts v4.2.3（SRI pin・index.html:44）／Chart.js v4.5.1＋chartjs-plugin-datalabels v2.2.0（SRI pin・index.html:46）／node --test（tests/*.test.js）／pytest（scripts 系）／Playwright 1.60.0＋chromium（`NODE_PATH=/home/shugo/node_modules`）／mock_prod_server.py（SQLite 実財務＋決定論合成 OHLCV・127.0.0.1:8200）

**Spec:** `docs/superpowers/specs/2026-08-22-uiux-quickfix-sweep-design.md`（2026-08-22 本人承認・敵対検証5レンズ30件反映済・決定記録 D13〜D27）

**Base:** worktree `/home/shugo/apps/investment-portal/.claude/worktrees/uiux-chart-sweep`・branch `worktree-uiux-chart-sweep`・base main `8e44298`

## Global Constraints

以下は全タスクの要件に暗黙的に含まれる（spec §14 の不可侵制約＋本 wave の確定事項）。

- **0x0 罠**: `display:none` のコンテナで `createChart` しない。chart-container の寸法・初期化順序は不変に保つ（C4 の高さミラー・rAF ガードを含む）。
- **MA/BB/KC の base 算出（全履歴算出→窓 filter のウォームアップ機構）不可侵**。本 wave は applySRLines と fit 配線にのみ触れる。
- **detail 分離規律**: 純計算は必ず detail-rules.js / finance-rules.js へ（displayName / periodLabelParts / isFinancialPL / srNearest / srLabelPlan / fitLogicalRange / detectSR マージ）。描画 lifecycle は detail-charts.js、DOM 配線は detail.js。
- **IIFE 公開面**: `window` 直下への新規公開は禁止。唯一の例外＝`DetailCharts.getPriceVisibleRange()`（#9 受入用デバッグゲッター・resizePrice と同型の薄ラッパ・DetailCharts 名前空間内）。
- **windowApi 15/17 は全タスクで不変**（detail-snapshot の WINDOW_API は window 直下 17 名の存在チェックのみ＝名前空間内の追加は非観測）。「ゲートを変えるため」の window 直公開は規律違反。
- **money.js / money-rules.js / advice.py は非接触**。money.css も非接触（#13 の CSS は detail.css 側）＝cockpit-e2e は必須ゲート外。触った場合のみ cockpit-e2e 212 check 全 PASS へ昇格（CLAUDE.md 条件）。
- **bsLeaderPlugin の datalabels 内部 API（`$datalabels` / `$layout._box._rect`）依存は SRI pin v2.2.0 の間のみ安定**。新設する bsNotePlugin は内部 API 非依存で設計する（D22）。
- **ローソク確定色・ZigZag 逆規約の意味は保持**（本 wave はどちらの算出にも触れない）。
- **finance-rules.js の currentRatio 本体（:36-39）と ratio の 0 返し（:19-22）は変更しない**（tests/finance-rules.test.js:37 の既存挙動固定を維持＝消費者側 ratioOrNull 化で解決する・D17）。
- **テスト実行コマンド**: node は `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`（**ディレクトリ渡し `tests/` は Node v24 で MODULE_NOT_FOUND**）。pytest は `PYTHONPATH=$(pwd) /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q`。ベースライン＝node 334 pass / pytest 228 pass。
- **mock 鯖のポートは 8200 固定**（前 wave 受入6本が全て 8200 ハードコード）。起動前に `lsof -i :8200` で専有チェックし、使用中なら中断する（並行セッションによる偽陰性の防止）。
- **2層ゲート**: 層1（無条件 MATCH）＝windowApi 15/17・canvasCount・pageErrors 0。層2（意図 diff 検分→再 baseline）＝computedStyles / domHash / chartContainerDims。層2 はタスク粒度ごとに検分→capture 昇格を繰り返す。
- **本 wave で確定した採否**（spec の「plan で確定」項目）: ATR 中央値の代替表示＝アコーディオン見出しバッジ（`.acc-metric`）／ETF の `selected-year-display` 「----」化＝不採用／S/R 連鎖マージの span 上限オプション＝非採用／CF diff=0 の浮遊「0」＝現状維持（非スコープ）／C4 の高さ補償＝採用（±28px のレイアウトシフトは実機サニティ項目7で許容確認）／`#desc-current-ratio` の N/A 上書き＝採用／detail.js:682-688 の stale コメント事実化＝採用／`roundRect`＝採用（受入で実描画を機械確認・NG なら手書き path へフォールバック）。
- **SDD ledger**: `.superpowers/sdd/2026-08-22-uiux-quickfix-sweep/progress.md`（per-plan workspace 規約）。

---
## Part A: Task 0-6（B0 前処理＋B1 純関数系）

**Part A が Produce しタスク間契約になる公開面**（Part B/C はこの名前・シグネチャ・戻り値形だけに依存する。全て `detail-rules.js` の exports へ追加＝**window 直下への新規公開は禁止**・spec §14）:

| 関数 | シグネチャ | 戻り値 | 追加タスク |
|---|---|---|---|
| `DetailRules.displayName` | `(companyName, ticker)` | `string` | Task 5 |
| `DetailRules.periodLabelParts` | `(companyName, ticker, year, isUS, hasFiltered, isEtf)` | `{ main: string, period: string }`（period は `[...]` を含む注記全体） | Task 5 |
| `DetailRules.periodLabel` | 同上 | `string`（`parts.period ? main + " " + period : main`） | Task 5（既存を薄いラッパへ書換） |
| `DetailRules.isFinancialPL` | `(fin)` | `boolean` | Task 2 |
| `DetailRules.srNearest` | `(sr, close)` | `{ up: {price,count}|null, dn: {price,count}|null }` | Task 4 |
| `DetailRules.srLabelPlan` | `(resistance, support, close)` | `{ resistance: boolean[], support: boolean[] }`（入力配列と同じ長さ・`axisLabelVisible: plan.resistance[i]` で消費） | Task 4 |
| `DetailRules.fitLogicalRange` | `(barCount, paneWidth, maxBarSpacing = 15)` | `{fit:true}` / `{fit:false, from, to}` / `null` | Task 6 |
| `DetailRules.detectSR` | `(prices, maxPerSide)`（**シグネチャ不変**・内部マージのみ） | 既存どおり `{resistance, support}` | Task 4 |

**Part A のクロージャ**: node `334 → 357 pass / 0 fail`・pytest `228 passed`（Python 無改変）・`git diff --name-only 8e44298` が `detail-rules.js` / `tests/detail-rules.test.js` / `scratchpad/b0-measure.js` / `scratchpad/plan-parts/b0-measured.md` のみ（money 系 3 ファイル非接触＝cockpit-e2e 不要）。

---

### Task 0: B0 前処理（8200 専有確認・before-baseline・ハーネス実測・ベースライン確認）

**Files:**
- Create: `scratchpad/b0-measure.js`（B0 実測スクリプト・read-only・コミットする）
- Create: `scratchpad/plan-parts/b0-measured.md`（実測結果の記録＝Task 8/Part B が参照する典拠・コミットする）
- Create: `scratchpad/detail-baseline.json`（capture 生成物・**コミットしない**）
- Create: `.superpowers/sdd/2026-08-22-uiux-quickfix-sweep/progress.md`（per-plan ledger・git 非追跡）
- **コード・テスト・spec は一切変更しない**（このタスクは計測と記録のみ）

**Interfaces:**
- Produces: ①`TIME_AXIS_H`（Part B Task 8＝C4 が定数として使う実測値）②時間軸 ON/OFF に対する `canvasCount` 不変性の判定（spec §12.1 層1ゲートの例外要否）③before-baseline（全タスクの 2 層ゲートの起点）④サブパネル右軸幅の実測（Part B の D24 `minimumWidth:72` 妥当性の材料）
- Consumes: なし（**このタスクより前にコードを触ると before-baseline が失われる＝前 wave worktree 削除済でリカバリ不可**）

- [ ] **Step 1: 8200 の専有チェック（使用中なら即中断・spec §12.0）**

```bash
lsof -i :8200
```
Expected: **出力なし（exit 1）**。何か LISTEN していたら**この時点で中断**（前 wave 受入6本は全て 8200 ハードコード＝並行セッションが居ると偽陰性になる）。他 worktree のセッションが使っている場合は、その終了を待つ（`ps aux | grep [m]ock_prod_server` で PID と cwd を確認し、**他セッションのプロセスは kill しない**）。

- [ ] **Step 2: mock 鯖 8200 を起動して疎通確認**

```bash
PLAN2_PORT=8200 python3 scratchpad/mock_prod_server.py &
```

```bash
sleep 2; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8200/
```
Expected: `200`。以後のタスクでも起動しっぱなしで使う（DB symlink は設定済＝作業ゼロ・`data/investment.db` は main 実DB 86KB へのリンク）。

- [ ] **Step 3: before-baseline を capture（コードを触る前に必須・1手）**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
```
Expected: `baseline saved. canvases=<N> pageErrors=0 windowApi=15/17`（`scratchpad/detail-baseline.json` 生成。windowApi は 15/17 が正常値＝spec §12.1・「baseline から不変」で運用する）。この JSON は**コミットしない**。

- [ ] **Step 4: B0 実測スクリプトを新規作成**（`scratchpad/b0-measure.js`）

```js
// scratchpad/b0-measure.js — B0 実測（spec §12.0）:
//  ① TIME_AXIS_H＝LWC v4.2.3 が生成する time-axis 行の DOM 高（Part B Task 8＝C4 が使う定数）
//  ② 時間軸 ON/OFF 前後の canvasCount 不変性（spec §12.1 層1ゲートの例外要否の判定）
//  ③ 付随実測: 各サブパネルの右 price-axis セル幅（D24 minimumWidth の妥当性材料）
// read-only（コード変更なし）・mock 鯖 8200 前提。DOM 構造は host > div.tv-lightweight-charts > table、
// table.rows[0]=ペイン行（cells: 左軸/ペイン/右軸）・rows[1]=時間軸行（visible:false なら高さ0）。
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:8200/?diag=off", { waitUntil: "networkidle" });
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(2500);

  const count = () => page.evaluate(() => document.querySelectorAll("#detail-view canvas").length);
  // SOFT_CAP=2 のため chip 追加だけでは畳んだまま＝「すべて開く」を続けて押す必要がある。
  const addAndExpand = async (key) => {
    await page.evaluate((k) => {
      const chip = document.getElementById("sp-chip-" + k);
      if (chip) chip.click();
      const links = document.getElementById("subpanel-links");
      const openAll = links && links.querySelectorAll("a")[0];
      if (openAll) openAll.click();
    }, key);
    await page.waitForTimeout(1200);
  };

  const c0 = await count();          // 既定 adx+atr（どちらも timeAxis:false）
  await addAndExpand("rsi");
  const c1 = await count();          // +RSI（timeAxis:false）
  await addAndExpand("macd");
  const c2 = await count();          // +MACD（現 HEAD で唯一 timeAxis:true）
  await addAndExpand("obv");
  const c3 = await count();

  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("#subpanel-accordion .acc-item").forEach((it) => {
      const host = it.querySelector(".subpanel-host");
      const tbl = host && host.querySelector("table");
      out.push({
        key: it.dataset.key,
        hostH: host ? host.clientHeight : null,
        rowHeights: tbl ? [...tbl.rows].map((tr) => Math.round(tr.getBoundingClientRect().height)) : null,
        priceAxisW: (tbl && tbl.rows[0]) ? Math.round(tbl.rows[0].cells[2].getBoundingClientRect().width) : null,
        canvases: host ? host.querySelectorAll("canvas").length : 0,
      });
    });
    return out;
  });

  const macd = rows.find((r) => r.key === "macd") || {};
  console.log(JSON.stringify({
    TIME_AXIS_H: macd.rowHeights ? macd.rowHeights[1] : null,
    canvasCount: {
      adx_atr: c0, plus_rsi_axisOFF: c1, plus_macd_axisON: c2, plus_obv: c3,
      deltaAxisOFF: c1 - c0, deltaAxisON: c2 - c1,
      invariant: (c1 - c0) === (c2 - c1),
    },
    rows,
    pageErrors: errors,
  }, null, 1));
  await browser.close();
})();
```

- [ ] **Step 5: B0 実測を実行**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/b0-measure.js
```
Expected（plan 執筆時に同型 probe で先行実測済・1920×1080）: `TIME_AXIS_H: 28`（macd の rowHeights=`[82,28]`＝登録高 110 の内訳）・他4枚は rowHeights=`[<全高>,0]`・`canvases` は**軸 ON/OFF によらず全ホスト 7**・`deltaAxisOFF === deltaAxisON === 7` → `invariant: true`・`pageErrors: []`。
- **`invariant: true` なら** spec §12.1 の層1ゲート（canvasCount 無条件不変）に例外を書かずに進む＝Part B Task 8（C4）は canvasCount 不変が必須ゲートのまま。
- **`invariant: false` だったときのみ** spec §12.1 に「C4 タスクの意図 diff」として例外を明記してから Part B へ渡す（低確度・先行実測では非該当）。
- `TIME_AXIS_H` が 28 以外なら**実測値を正とする**（Part B Task 8 の定数はこの値）。

- [ ] **Step 6: 実測結果を記録**（`scratchpad/plan-parts/b0-measured.md` を新規作成＝Part B Task 8 が参照する典拠）

```markdown
# B0 実測（Task 0・HEAD 8e44298・コード変更前）

- 実行: `NODE_PATH=/home/shugo/node_modules node scratchpad/b0-measure.js`（viewport 1920x1080・mock 8200）
- **TIME_AXIS_H = <実測値> px**（LWC v4.2.3 の time-axis 行＝host > .tv-lightweight-charts > table の rows[1] 実高）
  - 根拠: macd host（登録高 110）の rowHeights = [<ペイン高>, <軸高>]／他4枚は軸行 高さ0
- **canvasCount 不変性 = <true|false>**（adx+atr=<c0> → +rsi(軸OFF)=<c1> → +macd(軸ON)=<c2> → +obv=<c3>／
  deltaAxisOFF=<..> deltaAxisON=<..>）＝軸 ON/OFF で canvas 要素数は<変わらない|変わる>
  - <true の場合> spec §12.1 層1ゲート（canvasCount 無条件不変）に例外不要
- 付随: サブパネル右 price-axis セル幅 = adx <..> / atr <..> / rsi <..> / macd <..> / obv <..> px
  - **Part B 申し送り（D24）**: OBV は生値軸のため他より広い＝`priceFormat:{type:"volume"}`（C2）で縮めた後に
    `minimumWidth:72` が効く順序。volume 化前に minimumWidth だけ入れても OBV だけ揃わない。
- pageErrors: <[]>
```

- [ ] **Step 7: ベースライン（テスト・前 wave 受入6本）を確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
```
Expected: **334 pass / 0 fail**（`ℹ tests` の実行値で判定＝`grep -c "test("` で数えない・ディレクトリ渡し `tests/` は MODULE_NOT_FOUND で不可）。

```bash
PYTHONPATH=$(pwd) /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q
```
Expected: **228 passed**（venv は main 側・PYTHONPATH 必須）。

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js
```

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/sr-window-verify.js
```

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/unit-badge-verify.js
```

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-verify.js
```

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-portal-verify.js
```

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js
```
Expected: 6本とも `ALL PASS`（exit 0）。theme-floor-check は `checked=77/145` の checked 数も控える（後続のセレクタリネームで静かに減るのを検出するため）。

- [ ] **Step 8: SDD ledger を新規作成**（`.superpowers/sdd/2026-08-22-uiux-quickfix-sweep/progress.md`・per-plan workspace 規約）

```markdown
# UIUX quickfix sweep SDD 進捗 ledger

- branch: worktree-uiux-chart-sweep / base: 8e44298（実装開始前 HEAD）
- spec: docs/superpowers/specs/2026-08-22-uiux-quickfix-sweep-design.md
- plan: docs/superpowers/plans/2026-08-22-uiux-quickfix-sweep.md
- 検証基盤: before-baseline capture 済・node 334/pytest 228 green・前wave受入6本 ALL PASS
- B0 実測: TIME_AXIS_H=<値> / canvasCount 不変=<true|false>（scratchpad/plan-parts/b0-measured.md）

## タスク状態
- Task 0: complete（B0 前処理）

## Minor findings ロールアップ
（レビューで出た Minor をここへ追記）
```

- [ ] **Step 9: コミット**（baseline JSON と ledger はコミットしない＝`.superpowers/` は git 非追跡・`scratchpad/*.json` は追跡外運用）

```bash
git add scratchpad/b0-measure.js scratchpad/plan-parts/b0-measured.md
git commit -m "chore(sweep): B0 前処理（TIME_AXIS_H/canvasCount 不変性の実測＋before-baseline 起点）"
```

```bash
git status --short
```
Expected: `scratchpad/detail-baseline.json` が untracked のまま残る（コミット対象に入っていないこと）。

**受入（このタスクの完了条件）**
- `lsof -i :8200` が Step 1 時点で無出力（専有確認）／`curl` が 200。
- `scratchpad/detail-baseline.json` が存在し `pageErrors=0`・`windowApi=15/17`。
- `scratchpad/b0-measure.js` の出力に `TIME_AXIS_H` の数値と `canvasCount.invariant` の真偽が入り、`pageErrors: []`。
- `scratchpad/plan-parts/b0-measured.md` に上記2値が転記されている。
- node **334 pass/0 fail**・pytest **228 passed**・前 wave 受入6本すべて `ALL PASS`（exit 0）。
- `git diff --name-only 8e44298` に `detail-rules.js` 等の**実装ファイルが含まれない**（このタスクはコード無改修）。

---

### Task 1: healthTrendSeries の curOk に分母>0 条件（NEW・確定事項3 / spec §7.4）

**Files:**
- Modify: `detail-rules.js:867`（healthTrendSeries の curOk・1行）
- Test: `tests/detail-rules.test.js`（`healthTrendSeries: ETF (financials_trend={}) → 空系列`（現 :469-474）の直後に追加）

**Interfaces:**
- Consumes: `FR.n`（finance-rules.js:13-16・既存）
- Produces: `DetailRules.healthTrendSeries(data, isUS).currentRatio[i]` が **流動負債0 の年で `null`**（`spanGaps:false` により線が消える＝銀行の 0% 偽実線の根絶）。export 面の変更なし＝Part B/C への契約影響なし。

- [ ] **Step 1: 失敗するテストを書く**

```js
test("healthTrendSeries: 流動負債0（銀行型）は流動比率を null 欠測化（0% 偽実線の根絶）", () => {
  const data = { currency: "JPY", financials_trend: {
    "2024": { net_sales: 6838439, current_assets: 0, non_current_assets: 413113501,
              current_liabilities: 0, non_current_liabilities: 390000000,
              net_assets: 18000000, cf_cash_end: 50000000 },
    "2025": { net_sales: 7000000, current_assets: 30000000, non_current_assets: 60000000,
              current_liabilities: 25000000, non_current_liabilities: 20000000,
              net_assets: 45000000, cf_cash_end: 6524000 },
  }};
  const s = D.healthTrendSeries(data, false);
  assert.equal(s.currentRatio[0], null);              // 分母0 → 0.0% でなく欠測点
  assert.equal(typeof s.currentRatio[1], "number");   // 通常年は従来どおり実値（非退行）
  assert.equal(typeof s.equityRatio[0], "number");    // 自己資本比率は銀行でも算出可＝巻き込み禁止
  assert.equal(s.cash[0], 50000000);                  // 現金系列も巻き込まない
});
```

- [ ] **Step 2: 失敗を確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js
```
Expected: **FAIL**。`AssertionError: Expected values to be strictly equal: 0 !== null`（`s.currentRatio[0]` が `FR.currentRatio` の分母0→0 返しでそのまま 0 になる）。

- [ ] **Step 3: 実装**（`detail-rules.js:867` の1行を書換）

```js
      var curOk = sub && FR.hasValue(f, "current_assets") && FR.hasValue(f, "current_liabilities")
        && FR.n(f.current_liabilities) > 0;   // 分母0（銀行・金融は流動区分なし）は 0% 偽実線でなく欠測点（spec §7.4）
```
`FR.currentRatio` 本体（finance-rules.js:36-39）と `ratio` の 0 返し（:19-22）は**変えない**（tests/finance-rules.test.js:37 の既存挙動固定を維持＝D17）。

- [ ] **Step 4: テスト pass 確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
```
Expected: **335 pass / 0 fail**（334＋新規1）。既存 `healthTrendSeries: per-ratio missing gate → null`（現 :451-467）も緑のまま（当該フィクスチャは current_liabilities 欠損＝hasValue で先に落ちる）。

- [ ] **Step 5: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "fix(health): 健全性トレンドの流動比率を分母0で null 欠測化（銀行の0%偽実線を根絶）"
```

**受入（このタスクの完了条件）**
- node **335 pass / 0 fail**・pytest **228 passed** 不変。
- `git diff 8e44298 -- detail-rules.js | grep -c '^+'` の増分が curOk の1論理行に閉じている（他関数へ波及していない）。
- `FinanceRules.currentRatio` / `ratio` の定義が無改変（`git diff 8e44298 -- finance-rules.js` が空）。

---

### Task 2: `isFinancialPL` 新設＋radarScores の targetOp 経常代替（#4 rules 側 / spec §7.1・D16）

**Files:**
- Modify: `detail-rules.js`（plSteps 定義（現 :497-498 のコメント＋`function plSteps`）の直上に新関数・`:581` targetOp・exports `:987`）
- Test: `tests/detail-rules.test.js`（plSteps 節（現 :189-200）と radarScores 節（現 :203-217）の直後に追加）

**Interfaces:**
- Consumes: `FR.n`
- Produces: **`DetailRules.isFinancialPL(fin) -> boolean`**（Part B の PL formatter＝detail-charts.js:1125-1143 が `value===0 && label==="営業利益" && DetailRules.isFinancialPL(fin)` の形で消費）。`radarScores` の戻り値形は不変（scores[2] の算出元だけが変わる＝**意図変更**）。

- [ ] **Step 1: 失敗するテストを書く**（2本）

```js
// ── isFinancialPL: 金融（銀行・保険・証券）の PL 判定（値ベース単独・D16）──
test("isFinancialPL: 営業利益0×経常>0 の金融型だけ true", () => {
  assert.equal(D.isFinancialPL({ operating_income: 0, ordinary_income: 1500000 }), true);   // 8306.T 型（実DB 金融12銘柄36行）
  assert.equal(D.isFinancialPL({ operating_income: 0, ordinary_income: 0, income_before_taxes: 3086701 }), false); // 9984.T 型（経常0で自動排除）
  assert.equal(D.isFinancialPL({ operating_income: 4795586, ordinary_income: 6000000 }), false); // 通常銘柄
  assert.equal(D.isFinancialPL(null), false);
});

test("radarScores: 金融型は収益性を経常利益で代替評価（営業利益0の0点固定を解消）", () => {
  const bank = { net_income: 100, net_assets: 500, current_assets: 0, non_current_assets: 1000,
                 operating_income: 0, ordinary_income: 200, income_before_taxes: 210,
                 net_sales: 1000, current_liabilities: 0 };
  assert.equal(D.radarScores(bank, "8306.T").scores[2], 100);   // 経常率 20% → clampScore(20,0,12)=100（従来は 0 点）
  // 非金融は営業利益のまま（経常で代替していないことの錠: 経常24% でなく 営業6% が使われる）
  const normal = { net_income: 100, net_assets: 500, current_assets: 400, non_current_assets: 600,
                   operating_income: 60, ordinary_income: 240, income_before_taxes: 240,
                   net_sales: 1000, current_liabilities: 200 };
  assert.equal(D.radarScores(normal, "7203.T").scores[2], 50);  // opMargin 6% → clampScore(6,0,12)=50
  // 持株会社は従来どおり税引前利益（HOLDING 特例が先・非衝突）
  const holding = { net_income: 100, net_assets: 500, current_assets: 400, non_current_assets: 600,
                    operating_income: 0, ordinary_income: 0, income_before_taxes: 240,
                    net_sales: 1000, current_liabilities: 200 };
  assert.equal(D.radarScores(holding, "9984.T").scores[2], 100);
});
```

- [ ] **Step 2: 失敗を確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js
```
Expected: **FAIL 2件**。①`TypeError: D.isFinancialPL is not a function` ②`AssertionError: Expected values to be strictly equal: 0 !== 100`（bank の scores[2] が営業利益0のまま 0 点）。

- [ ] **Step 3: 実装（1）isFinancialPL 新設**（`detail-rules.js` の `// PL の段（core は常出・その他は hasValue ゲート）` コメント（現 :497）の**直前**に挿入）

```js
  // 金融（銀行・保険・証券）の PL 構造判定（値ベース単独・D16）。営業利益の科目を持たず経常利益が本業成績。
  //  実DB照会で金融12銘柄36行（銀行5/保険3/証券2/US2）と過不足なく外延一致・非金融の該当0行。
  //  9984.T（経常0×税引前≠0）は ordinary>0 条件で自動排除＝HOLDING_COMPANIES 特例と非衝突。
  function isFinancialPL(fin) {
    if (!fin) return false;
    return FR.n(fin.operating_income) === 0 && FR.n(fin.ordinary_income) > 0;
  }
```

- [ ] **Step 4: 実装（2）radarScores の targetOp**（`detail-rules.js:581` の1行を書換）

```js
    const targetOp = HOLDING_COMPANIES.has(ticker) ? fin.income_before_taxes
      : (isFinancialPL(fin) ? fin.ordinary_income : fin.operating_income);   // 金融は経常で収益性を評価（spec §7.1）
```
score レンジ 0-12（:589）は**据置**（8306.T 2025 経常率 37.3%→100点＝形状が0点→ほぼ100点へ変わるのは退行でなく意図変更・実機サニティ項目1）。

- [ ] **Step 5: 実装（3）export 追加**（`detail-rules.js:987` の `... yoyBadge, plSteps, ...` の行）

```js
    equityRatioDesc, currentRatioDesc, yoyBadge, isFinancialPL, plSteps, cfFlowStatus, cfCompanyType, cfWaterfall, radarScores,
```

- [ ] **Step 6: テスト pass 確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
```
Expected: **337 pass / 0 fail**。既存 `radarScores: スコア配列と roe/roa（持株会社は税引前利益で収益性評価）`（現 :203-217）も緑（当該フィクスチャは operating_income=120≠0＝isFinancialPL false）。

- [ ] **Step 7: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(fin-label): DetailRules.isFinancialPL 追加＋レーダー収益性を金融は経常利益で代替評価"
```

**受入（このタスクの完了条件）**
- node **337 pass / 0 fail**・pytest **228 passed**。
- `node -e 'global.FinanceRules=require("./finance-rules.js");const D=require("./detail-rules.js");console.log(typeof D.isFinancialPL)'` → `function`（export 面の機械確認）。
- `grep -n "window.isFinancialPL\|Object.assign(window" detail-rules.js` が 0 件（window 直公開なし・spec §14）。

---

### Task 3: plSteps の IFRS 経常段省略（#5 rules 側 / spec §7.2 後半）

**Files:**
- Modify: `detail-rules.js:509`（plSteps の filter）
- Test: `tests/detail-rules.test.js`（plSteps 節・`plSteps: 欠損項目(gross_profit)は段を出さない`（現 :189-200）の直後）

**Interfaces:**
- Consumes: `FR.n` / `FR.hasValue`
- Produces: `DetailRules.plSteps(fin)` が **経常0×税引前≠0（IFRS 型）で経常段を返さない**（配列長が1減る）。Part B の PL 描画（detail-charts.js renderPLChart）は plSteps の戻り配列をそのまま使うため追加配線不要。

- [ ] **Step 1: 失敗するテストを書く**

```js
test("plSteps: IFRS 型（経常0×税引前≠0）は経常段を省略する", () => {
  const ifrs = { net_sales: 6000000, operating_income: 0, ordinary_income: 0,
                 income_before_taxes: 3086701, net_income: 2000000, gross_profit: null };  // 9984.T FY2025 型
  assert.deepEqual(D.plSteps(ifrs).map((s) => s.label),
    ["当期純利益", "税金等調整前当期純利益", "営業利益", "売上高"]);
  // 税引前も0（＝実質欠測）なら従来どおり段を出す（省略条件を広げない錠）
  assert.ok(D.plSteps({ ...ifrs, income_before_taxes: 0 }).some((s) => s.label === "経常利益"));
});
```

- [ ] **Step 2: 失敗を確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js
```
Expected: **FAIL**。`AssertionError [ERR_ASSERTION]: Expected values to be deeply strictly equal` — actual に `"経常利益"` が含まれる（`hasValue(fin,"ordinary_income")` は 0 を有効値扱いするため現行は段が出る）。

- [ ] **Step 3: 実装**（`detail-rules.js:509` の filter を書換）

```js
    ].filter((s) => (s.core || FR.hasValue(fin, s.key))
      // IFRS 型（経常概念なし＝経常0×税引前≠0）の経常段は省略（spec §7.2・実DB該当は 9984.T の3行のみ）。
      && !(s.key === "ordinary_income" && FR.n(fin.ordinary_income) === 0 && FR.n(fin.income_before_taxes) !== 0));
```

- [ ] **Step 4: テスト pass 確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
```
Expected: **338 pass / 0 fail**（既存 plSteps テストは ordinary_income=180 で非該当＝緑のまま）。

- [ ] **Step 5: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "fix(pl): IFRS型（経常0×税引前≠0）の経常段を省略（9984.T の浮遊0を構造的に解消）"
```

**受入（このタスクの完了条件）**
- node **338 pass / 0 fail**・pytest **228 passed**。
- `D.plSteps` の戻り配列に `core:true` の3段（当期純利益/営業利益/売上高）が**常に**含まれる（上記テストの deepEqual が兼ねる）。

---

### Task 4: S/R 純関数3点（#8(1a) 二次マージ＋`srNearest`＋`srLabelPlan` / spec §8.1・§8.2・§8.4）

**Files:**
- Modify: `detail-rules.js:131-147`（cluster() 内・`groups` 構築（:143-145）と `sort+slice`（:146）の間に二次マージを挿入）
- Modify: `detail-rules.js:149` の直後（detectSR 定義の直後）に `srNearest` / `srLabelPlan` を新設
- Modify: `detail-rules.js:697-706`（signalDigest の S/R ブロックを `srNearest` 呼び出しへ差し替え＝単一源化）
- Modify: `detail-rules.js:982`（exports のテクニカル行に `srNearest, srLabelPlan` を追加）
- Test: `tests/detail-rules.test.js`（`signalDigest S/R: computed from display window (dp) ...`（現 :437-448）の直後・healthTrendSeries 節（現 :450）の直前に builder ＋9本を追加）

**Interfaces:**
- Consumes: なし（rules 層内で完結）
- Produces:
  - `DetailRules.detectSR(prices, maxPerSide)` — **シグネチャ不変**。内部で近接クラスタを tol=1% でマージ（count 加重平均＋count 合算）。マージは `slice(0,_maxPerSide)` の**前**＝`chart top-3 ⊆ digest 全クラスタ` の prefix 性（sr-window-verify.js:32-33）を維持。
  - **`DetailRules.srNearest(sr, close) -> { up, dn }`**（各 `{price,count}|null`）— Part B の applySRLines が「top-3 ∪ digest 引用レベル」の和集合描画に使う（§8.4）。digest 側も同関数へ差し替え済＝**単一源**。
  - **`DetailRules.srLabelPlan(resistance, support, close) -> { resistance: boolean[], support: boolean[] }`** — Part B が `axisLabelVisible: plan.resistance[i]` / `plan.support[i]` の形で消費（§8.2）。入力配列と同じ長さの boolean 配列（index 2 以降は常に false）。
- **非担当（Part B 申し送り）**: applySRLines の適用・和集合描画・`scratchpad/sr-window-verify.js:11` のソース固定アサート書換（spec §13-2）・INDICATOR_GLOSSARY "sr" への側呼称ねじれ一文追加（§8.4 末尾。**同じ detail-rules.js を触るが §8.4 の描画タスクと同束にする**＝Part A では触らない）。

- [ ] **Step 1: 失敗するテストを書く（1）近接マージ3本**（`tests/detail-rules.test.js` の synthSRSeries 系テスト群の末尾＝現 :448 の直後に追加）

```js
// 近接マージ検証用の決定論 builder（synthSRSeries と同じ谷=100・末尾 close=120・ピーク間は谷4本）。
function srSeriesFromPeaks(peaks) {
  const A = []; let t = 0;
  const bar = (o, h, l, c) => { const d = new Date(2020, 0, 1 + t++); return { time: d.toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: 1000 }; };
  const valley = () => A.push(bar(100, 100.8, 99.2, 100));
  const peak = (lvl) => A.push(bar(100, lvl, 99, 100.5));
  const valleys = (n) => { for (let i = 0; i < n; i++) valley(); };
  valleys(4);
  peaks.forEach((p) => { peak(p); valleys(4); });
  for (let i = 0; i < 5; i++) A.push(bar(120, 120.5, 119.5, 120));
  return A;
}

test("detectSR: 近接クラスタ(<1%)を count 加重平均＋count 合算でマージ", () => {
  // 一次帯1.5% の greedy 分割で {150,151.5,152.1}(avg 151.2・count3) と {152.4}(count1) に割れる。
  // 隣接ギャップ 0.79% < 1% → マージ後 price=(151.2*3+152.4*1)/4=151.5・count=4。
  const A = srSeriesFromPeaks([150, 151.5, 152.1, 152.4]);
  const r = D.detectSR(A, Infinity).resistance;
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0].price - 151.5) < 1e-9);
  assert.equal(r[0].count, 4);
});

test("detectSR: ≥1% 離れたクラスタはマージしない（一次帯の断片是正に閉じる）", () => {
  const A = srSeriesFromPeaks([150, 150, 153.5, 153.5]);   // 隣接 2.33%
  const r = D.detectSR(A, Infinity).resistance;
  assert.deepEqual(r.map((x) => [x.price, x.count]), [[150, 2], [153.5, 2]]);
});

test("signalDigest S/R: マージ後の強度（合算 count）が readout に出る（単一源）", () => {
  const A = srSeriesFromPeaks([150, 151.5, 152.1, 152.4]);
  const sr = D.signalDigest(A, A).find((d) => d.key === "sr");
  assert.match(sr.readout, /直近の抵抗まで \+\d+\.\d%（強度4）/);   // マージ前は 強度3
});
```

- [ ] **Step 2: 失敗を確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js
```
Expected: **FAIL 3件**。①`Expected values to be strictly equal: 2 !== 1`（r.length＝マージされず2クラスタ）②`[[150,2],[153.5,2]]` は**通る**（このテストは実装前でも緑＝非マージ側の錠）③`AssertionError ... /直近の抵抗まで \+\d+\.\d%（強度4）/` に対し actual は `強度3`。

- [ ] **Step 3: 実装（1）cluster() の二次マージ**（`detail-rules.js:146` の `return groups.sort(...)` を以下で置換）

```js
      // 二次マージ（監査A①・spec §8.1）: 一次帯 1.5% の greedy 分割が残す断片を tol=1% で束ねる。
      //  代表値＝count 加重平均（多数 pivot 側へ寄せる）／強度＝count 合算。**slice の前**に置くため
      //  chart top-3 ⊆ digest 全クラスタ の prefix 性（sr-window-verify.js:32-33）と digest 強度の単一源性が保たれる。
      const MERGE_TOL = 0.01;
      const merged = [];
      for (const g of groups) {
        const last = merged[merged.length - 1];
        if (last && (g.price - last.price) / last.price < MERGE_TOL) {
          const c = last.count + g.count;
          last.price = (last.price * last.count + g.price * g.count) / c;
          last.count = c;
        } else merged.push({ price: g.price, count: g.count });
      }
      return merged.sort((a, b) => b.count - a.count).slice(0, _maxPerSide);
```
連鎖マージの span 上限オプション（spec §8.1 の +2 行）は**非採用**（本人確定事項・既定どおり）。

- [ ] **Step 4: 実装（2）srNearest / srLabelPlan を新設**（`detail-rules.js` の detectSR 定義終端（現 :149 の `}`）の直後に挿入）

```js
  // 終値の直上/直下の最寄りレベル選択（digest の :700-705 を関数化＝チャートの和集合描画と共用の単一源・spec §8.4）。
  //  side は「price と close の関係」だけで決まるため R クラスタが下側（＝直近の支持）になり得る（M7 既存仕様）。
  function srNearest(sr, close) {
    const s = sr || {};
    const all = (s.resistance || []).concat(s.support || []);
    let up = null, dn = null;
    if (close != null) {
      for (let i = 0; i < all.length; i++) {
        const lv = all[i];
        if (lv.price >= close) { if (!up || (lv.price - close) < (up.price - close)) up = lv; }
        else { if (!dn || (close - lv.price) < (close - dn.price)) dn = lv; }
      }
    }
    return { up, dn };
  }

  // 軸ラベルを付与するレベルの選抜（spec §8.2・実装＝検証の単一源＝H3）。各側 top-2 を候補とし
  //  count 降順 → 終値に近い順 → R 優先 で走査して (i) 終値±1% は抑制（終値バッジ埋没対策）
  //  (ii) 既採用と <1% は cross-side でも抑制。戻り値は入力配列と同じ長さの boolean 配列。
  function srLabelPlan(resistance, support, close) {
    const R = resistance || [], S = support || [];
    const plan = { resistance: R.map(() => false), support: S.map(() => false) };
    if (!(close > 0)) return plan;
    const cand = [];
    for (let i = 0; i < Math.min(2, R.length); i++) cand.push({ side: "R", idx: i, price: R[i].price, count: R[i].count });
    for (let j = 0; j < Math.min(2, S.length); j++) cand.push({ side: "S", idx: j, price: S[j].price, count: S[j].count });
    cand.sort((a, b) => (b.count - a.count)
      || (Math.abs(a.price - close) - Math.abs(b.price - close))
      || (a.side === b.side ? a.idx - b.idx : (a.side === "R" ? -1 : 1)));
    const taken = [];
    for (const c of cand) {
      if (Math.abs(c.price - close) / close < 0.01) continue;                                   // 終値バッジゾーン
      if (taken.some((p) => Math.abs(p - c.price) / Math.min(p, c.price) < 0.01)) continue;     // 既採用と近接
      taken.push(c.price);
      plan[c.side === "R" ? "resistance" : "support"][c.idx] = true;
    }
    return plan;
  }
```

- [ ] **Step 5: 実装（3）digest を srNearest へ差し替え**（`detail-rules.js:698-706` の `var all = ...` から for ループ終端までを以下2行で置換）

```js
      var nr = srNearest(sr, close);   // 最寄り選択は srNearest に単一源化（チャート側の和集合描画と共用）
      var up = nr.up, dn = nr.dn;
```

- [ ] **Step 6: 実装（4）export 追加**（`detail-rules.js:982` のテクニカル行）

```js
    calcMA, calcBB, detectSR, srNearest, srLabelPlan, calcRSI, calcEMA, calcMACD, calcZigZag, autoZigZagDeviation, zigzagSegments, autoClusterTol, volumeColorData,
```

- [ ] **Step 7: マージ3本の pass 確認＋既存 S/R 錠4本の無改変緑を確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js
```
Expected: 3本 pass。既存 S/R 錠4本（現 :270 detectSR shape・:418-426 maxPerSide/M7・:428-435 digest 最寄り・:437-448 digest 窓基準）は**無改変で全緑**（synthSRSeries のレベル間隔は >1.5%＝マージ非影響。plan 執筆時に同ロジックで先行検証済＝マージ後も `[{150,3},{160,3},{170,3},{122,1}]` で不変）。

- [ ] **Step 8: 失敗するテストを書く（2）srNearest 2本**

```js
test("srNearest: 終値の直上/直下の最寄りレベルを返す（digest と同一源）", () => {
  const A = synthSRSeries();                    // close=120・抵抗 122(×1)/150/160/170・支持 99
  const nr = D.srNearest(D.detectSR(A, Infinity), 120);
  assert.equal(nr.up.price, 122);
  assert.equal(nr.up.count, 1);
  assert.equal(nr.dn.price, 99);
  const sd = D.signalDigest(A, A).find((d) => d.key === "sr");
  assert.match(sd.readout, new RegExp("直近の抵抗まで \\+" + (((nr.up.price - 120) / 120) * 100).toFixed(1) + "%"));
});

test("srNearest: 片側不在は null・側は close との大小だけで決まる（R が下側になり得る）", () => {
  const nr = D.srNearest({ resistance: [{ price: 90, count: 1 }], support: [{ price: 80, count: 2 }] }, 100);
  assert.equal(nr.up, null);
  assert.equal(nr.dn.price, 90);      // R クラスタでも close 未満なら「直近の支持」側（M7 既存仕様＝§8.4 の用語集注記の根拠）
  assert.deepEqual(D.srNearest({ resistance: [], support: [] }, 100), { up: null, dn: null });
  assert.deepEqual(D.srNearest(null, 100), { up: null, dn: null });
});
```

- [ ] **Step 9: 失敗するテストを書く（3）srLabelPlan 4本**

```js
test("srLabelPlan: 終値±1% のレベルはラベルを抑制（終値バッジ埋没の解消）", () => {
  const plan = D.srLabelPlan(
    [{ price: 100.5, count: 9 }, { price: 120, count: 4 }],
    [{ price: 99.6, count: 8 }, { price: 80, count: 3 }],
    100);
  assert.deepEqual(plan.resistance, [false, true]);   // 100.5=+0.5% は抑制
  assert.deepEqual(plan.support, [false, true]);      // 99.6=-0.4% は抑制
});

test("srLabelPlan: 既採用と <1% は cross-side でも抑制（count 降順に採用）", () => {
  const plan = D.srLabelPlan(
    [{ price: 120, count: 5 }, { price: 120.5, count: 4 }],
    [{ price: 119.5, count: 3 }],
    100);
  assert.deepEqual(plan.resistance, [true, false]);   // 120.5 は 120 と 0.42%
  assert.deepEqual(plan.support, [false]);            // 119.5 も 120 と 0.42%（cross-side）
});

test("srLabelPlan: ラベルは各側 top-2 まで（3本目以降は常に false）＋縮退入力", () => {
  const plan = D.srLabelPlan(
    [{ price: 120, count: 5 }, { price: 130, count: 4 }, { price: 140, count: 3 }], [], 100);
  assert.deepEqual(plan.resistance, [true, true, false]);
  assert.deepEqual(plan.support, []);
  assert.deepEqual(D.srLabelPlan([], [], 100), { resistance: [], support: [] });
  assert.deepEqual(D.srLabelPlan([{ price: 120, count: 1 }], [], 0),
    { resistance: [false], support: [] });            // close 不正は全 false（決定論の縮退）
});

test("srLabelPlan: tie-break は count 降順 → 終値に近い順 → R 優先（決定論）", () => {
  const plan = D.srLabelPlan([{ price: 110, count: 3 }], [{ price: 109, count: 3 }], 100);
  assert.deepEqual(plan.support, [true]);       // 同 count なら終値に近い S(109・距離9) が先
  assert.deepEqual(plan.resistance, [false]);   // 110 は 109 と 0.92% → 抑制
  const same = D.srLabelPlan([{ price: 110, count: 3 }], [{ price: 90, count: 3 }], 100);
  assert.deepEqual(same.resistance, [true]);    // 距離同値(10)なら R 優先・互いに ≥1% で共存
  assert.deepEqual(same.support, [true]);
});
```

- [ ] **Step 10: 失敗を確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js
```
Expected: **FAIL 6件**（Step 4 で実装済なら pass。TDD 順を守るなら Step 8/9 のテストを Step 4 の**前**に書き、`TypeError: D.srNearest is not a function` / `D.srLabelPlan is not a function` を確認してから Step 4 を適用する）。

- [ ] **Step 11: 全テスト pass 確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
```
Expected: **347 pass / 0 fail**（338＋9）。

- [ ] **Step 12: 既存 S/R 受入スクリプトの非破壊を確認**（Part A は detail-charts.js を触らないため `sr-window-verify.js:11` のソース固定アサートはまだ有効＝ここで割れたら本物の異常）

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/sr-window-verify.js
```
Expected: `ALL PASS`（マージ後のレベルは一次クラスタ群の加重平均＝窓レンジ内が維持され、subset アサートも slice 前マージゆえ不変）。

- [ ] **Step 13: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(sr): 近接クラスタの二次マージ＋srNearest/srLabelPlan を rules 層へ新設（選抜と最寄り選択の単一源化）"
```

**受入（このタスクの完了条件）**
- node **347 pass / 0 fail**・pytest **228 passed**。
- **既存 S/R 錠4本（tests/detail-rules.test.js:270 / :418-426 / :428-435 / :437-448）が無改変で全緑**（`git diff 8e44298 -- tests/detail-rules.test.js` にこれら4本の変更が現れない）。
- `scratchpad/sr-window-verify.js` が `ALL PASS`（exit 0）。
- `node -e 'global.FinanceRules=require("./finance-rules.js");const D=require("./detail-rules.js");console.log(typeof D.srNearest, typeof D.srLabelPlan)'` → `function function`。
- `grep -c "for (var i = 0; i < all.length; i++)" detail-rules.js` → **0**（digest 側の最寄り選択が srNearest へ一本化された機械確認）。

---

### Task 5: タイトル純関数（#3 G1/G2/G3 の rules 側 / spec §6.1・§6.2・§6.3）

**Files:**
- Modify: `detail-rules.js:441-450`（`periodLabel` の直上に `displayName` / `periodLabelParts` を新設し `periodLabel` を薄いラッパへ書換）
- Modify: `detail-rules.js:986`（exports に `displayName, periodLabelParts` を追加）
- Test: `tests/detail-rules.test.js:54-70`（periodLabel 文字列一致3本のうち**フォールバック1本の期待値を書換**）＋同節直後に新規5本

**Interfaces:**
- Consumes: なし
- Produces:
  - **`DetailRules.displayName(companyName, ticker) -> string`**（Part B の detail.js:665 ヘッダ側は同じ判定を3項演算子で行う＝表示の一貫性の根拠）
  - **`DetailRules.periodLabelParts(...) -> { main, period }`**（Part B が detail.js:676-677 の innerHTML 化で `esc(p.main) + <span class="stock-title-sub">esc(p.period)</span>` として消費）
  - **`DetailRules.periodLabel(...) -> string`**（既存呼出し互換の1行版。`isEtf` は第6引数・undefined→falsy で後方互換）
- **非担当（Part B/C 申し送り）**: detail.js:665 ヘッダの ticker span 省略・:677 の第6引数 `data.type === "etf"` 追加・:676-677 の innerHTML 化（Part B）／`.stock-title-sub` の CSS（Part C・D27 で wide も2行化）。**ETF の `selected-year-display`「----」化は今回不採用**（本人確定）。

- [ ] **Step 1: 失敗するテストを書く（新規5本）**（`periodLabel: 絞り込みなしは直近市場ラベル`（現 :66-71）の直後に追加）

```js
// ── displayName / periodLabelParts（G1/G2/G3・spec §6）──
test("displayName: 社名が既に (ticker) を含む場合は付加しない（SPY 型二重の解消）", () => {
  assert.equal(D.displayName("S&P 500 ETF (SPY)", "SPY"), "S&P 500 ETF (SPY)");
  assert.equal(D.displayName("Apple", "AAPL"), "Apple (AAPL)");
  // QQQ/GOOGL の括弧連鎖（括弧内が ticker でない）は情報として維持＝D14
  assert.equal(D.displayName("Invesco QQQ (NASDAQ 100)", "QQQ"), "Invesco QQQ (NASDAQ 100) (QQQ)");
});

test("periodLabelParts: US/JP は main（社名＋種別）と period（[...] 注記）を分離して返す", () => {
  const us = D.periodLabelParts("Apple", "AAPL", 2023, true, true, false);
  assert.equal(us.main, "Apple (AAPL) - 歴史的ローソク足時系列");
  assert.equal(us.period, "[2023年1月 〜 2023年12月 経営期間トレンド]");
  const jp = D.periodLabelParts("トヨタ", "7203.T", 2023, false, true, false);
  assert.equal(jp.main, "トヨタ (7203.T) - 歴史的ローソク足時系列");
  assert.equal(jp.period, "[2022年4月 〜 2023年3月 経営期間トレンド]");
});

test("periodLabelParts: フォールバック（窓0件）は実窓との不一致を注記で明示する", () => {
  const p = D.periodLabelParts("トヨタ", "7203.T", 2023, false, false, false);
  assert.equal(p.main, "トヨタ (7203.T) - 直近市場ローソク足時系列");
  assert.equal(p.period, "[2023FY の価格データ未収録のため直近200営業日を表示]");
});

test("periodLabelParts: ETF は「年間市場トレンド」・フォールバック注記は FY 表記を避ける", () => {
  const on = D.periodLabelParts("S&P 500 ETF (SPY)", "SPY", 2025, true, true, true);
  assert.equal(on.period, "[2025年1月 〜 2025年12月 年間市場トレンド]");
  assert.doesNotMatch(on.period, /経営期間/);
  const fb = D.periodLabelParts("S&P 500 ETF (SPY)", "SPY", 2025, true, false, true);
  assert.equal(fb.period, "[価格データ未収録のため直近200営業日を表示]");
  assert.doesNotMatch(fb.period, /FY/);
});

test("periodLabel: periodLabelParts の薄いラッパ（SPY 型でティッカーが二重にならない）", () => {
  const p = D.periodLabelParts("Apple", "AAPL", 2023, true, true, false);
  assert.equal(D.periodLabel("Apple", "AAPL", 2023, true, true, false), p.main + " " + p.period);
  assert.equal(
    D.periodLabel("S&P 500 ETF (SPY)", "SPY", 2025, true, true, true),
    "S&P 500 ETF (SPY) - 歴史的ローソク足時系列 [2025年1月 〜 2025年12月 年間市場トレンド]",
  );
});
```

- [ ] **Step 2: 既存 periodLabel テストの期待値を書換**（spec §13-1・**同一コミット必須**）

`tests/detail-rules.test.js:66-71` の1本のみを以下へ書換（US/JP の2本＝:54-65 は**文言不変**＝退行検出の錠としてそのまま残す）:

```js
test("periodLabel: 絞り込みなしは直近市場ラベル＋未収録注記（G2）", () => {
  assert.equal(
    D.periodLabel("トヨタ", "7203.T", 2023, false, false),
    "トヨタ (7203.T) - 直近市場ローソク足時系列 [2023FY の価格データ未収録のため直近200営業日を表示]",
  );
});
```

- [ ] **Step 3: 失敗を確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js
```
Expected: **FAIL 6件**。`TypeError: D.displayName is not a function` / `D.periodLabelParts is not a function`（新規5本）＋書換えた既存1本が `... - 直近市場ローソク足時系列` に注記が無い旨の文字列不一致。

- [ ] **Step 4: 実装**（`detail-rules.js:441-450` の periodLabel 定義とその直上コメントを以下で置換）

```js
  // 社名表示（社名が既に "(ticker)" を含むなら付加を省略＝SPY 型の二重ティッカー防止・spec §6.1/D14）。
  //  QQQ/GOOGL の括弧連鎖（括弧内が ticker でない）は情報として維持し、社名整理はデータ側レーンで扱う。
  function displayName(companyName, ticker) {
    const name = String(companyName == null ? "" : companyName);
    return name.includes(`(${ticker})`) ? name : `${name} (${ticker})`;
  }

  // stock-title 文言を main（社名＋時系列種別）と period（[...] 注記）に分離（spec §6.2/§6.3）。
  //  isEtf: ETF は「経営期間」を使わず「年間市場トレンド」、フォールバック注記も FY 表記を避ける
  //  （ETF は selectedYear=2025 ハードコードのため FY 表記が不自然になる・§16 に恒久対応を残置）。
  function periodLabelParts(companyName, ticker, year, isUS, hasFiltered, isEtf) {
    const name = displayName(companyName, ticker);
    if (hasFiltered) {
      const trend = isEtf ? "年間市場トレンド" : "経営期間トレンド";
      const pl = isUS
        ? `${year}年1月 〜 ${year}年12月 ${trend}`
        : `${year - 1}年4月 〜 ${year}年3月 ${trend}`;
      return { main: `${name} - 歴史的ローソク足時系列`, period: `[${pl}]` };
    }
    return {
      main: `${name} - 直近市場ローソク足時系列`,
      period: isEtf
        ? "[価格データ未収録のため直近200営業日を表示]"
        : `[${year}FY の価格データ未収録のため直近200営業日を表示]`,
    };
  }

  // 1行版（既存呼出し互換の薄いラッパ）。index.html 3814-3822 由来。
  function periodLabel(companyName, ticker, year, isUS, hasFiltered, isEtf) {
    const p = periodLabelParts(companyName, ticker, year, isUS, hasFiltered, isEtf);
    return p.period ? `${p.main} ${p.period}` : p.main;
  }
```

- [ ] **Step 5: export 追加**（`detail-rules.js:986` の財務ディスクリプタ行）

```js
    priceWindow, periodLabel, periodLabelParts, displayName, marketBasisFor, perStatus, pbrStatus,
```

- [ ] **Step 6: 全テスト pass 確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
```
Expected: **352 pass / 0 fail**（347＋5・既存1本は書換で同数）。

- [ ] **Step 7: コミット**（テスト期待値の書換を**同一コミット**に含める＝spec §13-1）

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(title): displayName/periodLabelParts 新設（SPY型二重ティッカー解消・ETF文言・副題行分離の骨格）"
```

**受入（このタスクの完了条件）**
- node **352 pass / 0 fail**・pytest **228 passed**。
- `D.periodLabel("S&P 500 ETF (SPY)","SPY",2025,true,true,true)` の戻り値に `(SPY) (SPY)` が**含まれない**（上記テストが機械判定）。
- 既存 US/JP の periodLabel 文字列一致2本（現 :54-65）が**無改変で緑**（文言退行の錠）。
- `node -e 'global.FinanceRules=require("./finance-rules.js");const D=require("./detail-rules.js");const p=D.periodLabelParts("A","T",2023,true,true,false);console.log(typeof p.main, typeof p.period)'` → `string string`。

---

### Task 6: `fitLogicalRange` 新設（#9 rules 側 / spec §9・D20）

**Files:**
- Modify: `detail-rules.js:439` の直後（`priceWindow` 定義の直後）に新関数
- Modify: `detail-rules.js:986`（exports に `fitLogicalRange` を追加）
- Test: `tests/detail-rules.test.js`（priceWindow 節（現 :45-51）の直後に5本）

**Interfaces:**
- Consumes: なし
- Produces: **`DetailRules.fitLogicalRange(barCount, paneWidth, maxBarSpacing = 15) -> {fit:true} | {fit:false, from, to} | null`**。Part B が updateMaAndVolume 末尾で `ts.width()` を渡して評価し `fitContent()` / `setVisibleLogicalRange({from,to})` を分岐（`null` は skip＝width 0 の 0x0 罠ガードと同じ思想）。
- **非担当（Part B 申し送り）**: detail-charts.js への配線・`lockVisibleTimeRangeOnResize:true`・`getPriceVisibleRange()` デバッグゲッター（DetailCharts 名前空間・window 直公開禁止）・mock_prod_server.py への合成35本 ticker 追加・detail.js:682-688 の stale コメント事実化（採用・Part B）。

- [ ] **Step 1: 失敗するテストを書く（5本）**

```js
// ── fitLogicalRange: 少数バー時の中央寄せパディング（spec §9・LWC v4.2.3 に maxBarSpacing が無いための手実装）──
test("fitLogicalRange: 十分な本数は素の fitContent（境界はちょうど幅一致も fit 側）", () => {
  assert.deepEqual(D.fitLogicalRange(300, 900), { fit: true });
  assert.deepEqual(D.fitLogicalRange(60, 900), { fit: true });   // 60*15 = 900（等号は fit）
});

test("fitLogicalRange: 境界の1本下はパディング分岐へ落ちる", () => {
  const r = D.fitLogicalRange(59, 900);
  assert.equal(r.fit, false);
  assert.equal(r.from, -0.5);      // (900/15 - 59)/2 = 0.5
  assert.equal(r.to, 58.5);        // barCount-1 + pad
});

test("fitLogicalRange: 少数バーは中央寄せ（pad 対称・全バーが必ず可視域に入る）", () => {
  const r = D.fitLogicalRange(35, 900);
  assert.deepEqual(r, { fit: false, from: -12.5, to: 46.5 });
  assert.equal(r.from + r.to, 34);            // 対称性: 中心 = (barCount-1)/2
  assert.ok(r.from <= 0 && r.to >= 34);       // 全バー可視
});

test("fitLogicalRange: maxBarSpacing は第3引数で上書きできる（既定 15）", () => {
  assert.deepEqual(D.fitLogicalRange(35, 900, 30), { fit: true });   // 35*30 = 1050 >= 900
  assert.equal(D.fitLogicalRange(35, 900, 10).from, -27.5);          // (900/10 - 35)/2 = 27.5
});

test("fitLogicalRange: 0本/幅0/無効入力は null（非表示時 skip の根拠）", () => {
  assert.equal(D.fitLogicalRange(0, 900), null);
  assert.equal(D.fitLogicalRange(35, 0), null);
  assert.equal(D.fitLogicalRange(35, -10), null);
  assert.equal(D.fitLogicalRange(null, 900), null);
  assert.equal(D.fitLogicalRange(35, 900, 0), null);
});
```

- [ ] **Step 2: 失敗を確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js
```
Expected: **FAIL 5件**。`TypeError: D.fitLogicalRange is not a function`。

- [ ] **Step 3: 実装**（`detail-rules.js:439`（priceWindow の `}`）の直後に挿入）

```js
  // 表示窓の logical range 決定（spec §9・D20）。LWC v4.2.3 に maxBarSpacing オプションが無いため
  //  「barCount×maxBarSpacing ≥ paneWidth なら素の fitContent／未満なら中央寄せパディング」を手実装する。
  //  無効入力（0本・幅0/負・spacing 0）は null＝呼び出し側は skip（非表示チャートの 0x0 罠ガードと同思想）。
  function fitLogicalRange(barCount, paneWidth, maxBarSpacing = 15) {
    if (!(barCount > 0) || !(paneWidth > 0) || !(maxBarSpacing > 0)) return null;
    if (barCount * maxBarSpacing >= paneWidth) return { fit: true };
    const pad = (paneWidth / maxBarSpacing - barCount) / 2;
    return { fit: false, from: -pad, to: barCount - 1 + pad };
  }
```

- [ ] **Step 4: export 追加**（`detail-rules.js:986` の財務ディスクリプタ行・Task 5 の追加分と同じ行）

```js
    priceWindow, fitLogicalRange, periodLabel, periodLabelParts, displayName, marketBasisFor, perStatus, pbrStatus,
```

- [ ] **Step 5: 全テスト pass 確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
```
Expected: **357 pass / 0 fail**（352＋5）。

```bash
PYTHONPATH=$(pwd) /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q
```
Expected: **228 passed**（Python 無改変）。

- [ ] **Step 6: Part A クロージャの機械確認**（detail-snapshot の 2 層ゲート＝rules 層のみの変更は DOM/style を動かさないはずだが、S/R マージで S/R 線の本数・位置が変わるため `domHash` は動かない一方 `pageErrors`/`canvasCount`/`windowApi` は不変であることを確認する）

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: `✅ MATCH` または diffs が `computedStyles` を含まず `pageErrors` 0 のみ。**`windowApi` / `canvasCount` に diff が出たら層1違反＝原因を潰すまで進めない**（S/R マージは canvas 要素数を変えない＝priceLine は canvas 描画）。diff が出た場合は `jq` で baseline と突合し意図 diff と確認できたときのみ `capture` で再 baseline。

```bash
git diff --name-only 8e44298
```
Expected: `detail-rules.js` / `tests/detail-rules.test.js` / `scratchpad/b0-measure.js` / `scratchpad/plan-parts/b0-measured.md` のみ（**money.js/money-rules.js/money.css を含まない**＝cockpit-e2e 昇格条件に当たらない・spec §12.2）。

- [ ] **Step 7: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "feat(chart): DetailRules.fitLogicalRange 追加（少数バーの中央寄せパディング・v4.2.3 手実装）"
```

**受入（このタスクの完了条件）**
- node **357 pass / 0 fail**・pytest **228 passed**。
- `node -e 'global.FinanceRules=require("./finance-rules.js");const D=require("./detail-rules.js");console.log(JSON.stringify([D.fitLogicalRange(35,900),D.fitLogicalRange(300,900),D.fitLogicalRange(0,900)]))'` → `[{"fit":false,"from":-12.5,"to":46.5},{"fit":true},null]`。
- `scratchpad/detail-snapshot.js compare` で `windowApi` / `canvasCount` / `pageErrors` に diff なし。
- `git diff --name-only 8e44298` が上記4ファイルのみ（Part A の変更面が rules 層とハーネスに閉じている）。
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

---

## wave クロージャ（Task 0-16 完了時・merge 前の最終確認）

すべて機械判定。1つでも落ちたら merge に進まない。

- [ ] **C-1: 全 suite 緑**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
PYTHONPATH=$(pwd) /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q
```

Expected: node `357+ pass / 0 fail`（Part A の追加23本を含む・実数は各タスクの積み上げ）・pytest `228 passed`（Python 無改変）。

- [ ] **C-2: 前 wave 受入6本の回帰（全数 ALL PASS）**

```bash
for f in bs-callout-verify sr-window-verify unit-badge-verify zerofy-verify zerofy-portal-verify theme-floor-check; do
  echo "=== $f ==="; NODE_PATH=/home/shugo/node_modules node scratchpad/$f.js || echo "FAILED: $f";
done
```

Expected: 6本とも ALL PASS（`sr-window-verify` は Task 10 でゲート更新済みの版・`bs-callout-verify` は Task 12/13 で SBUX 追加＋注記アサート拡張済みの版）。

- [ ] **C-3: 本 wave 新規 verify の全数再走**

```bash
for f in subpanel-verify fit-range-verify compare-verify finviz-labels-verify titles-verify toolbar-terms-verify; do
  echo "=== $f ==="; NODE_PATH=/home/shugo/node_modules node scratchpad/$f.js || echo "FAILED: $f";
done
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js
```

Expected: 全て ALL PASS（exit 0）・portal-money-smoke `8/8`・smoke-zigzag-range の pageerror 0。

- [ ] **C-4: detail-snapshot の最終 MATCH**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```

Expected: `✅ MATCH`（各タスクで層2 を検分→再 baseline 済のため最終は差分ゼロ）。**windowApi 15/17・canvasCount・pageErrors 0 の層1 は全期間を通じて無条件不変**。

- [ ] **C-5: money 系の非接触を機械確認（cockpit-e2e 昇格判定・spec §12.2）**

```bash
git diff --name-only 8e44298 | grep -E '^(money\.js|money-rules\.js|money\.css)$' && echo "TOUCHED -> cockpit-e2e 必須" || echo "非接触 -> cockpit-e2e 不要"
```

Expected: `非接触 -> cockpit-e2e 不要`。もし1つでも該当したら `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js` を **212 check 全 PASS** で通してから進む（CLAUDE.md の必須条件）。

- [ ] **C-6: 変更面の棚卸し**

```bash
git diff --stat 8e44298
git log --oneline 8e44298..HEAD
```

Expected: 変更が `detail-rules.js` / `detail-charts.js` / `detail.js` / `detail.css` / `index.html` / `tests/detail-rules.test.js` / `scratchpad/*`（verify・mock 鯖・b0 計測）に収まる。`finance-rules.js` は**無改変**（ratioOrNull は既存＝D17）・`money.*` 3ファイルと `api/` は無改変。

- [ ] **C-7: SDD ledger の最終更新**

`.superpowers/sdd/2026-08-22-uiux-quickfix-sweep/progress.md` に Task 0-16 の complete・各コミット SHA・Minor findings ロールアップ・C-1〜C-6 の実測値を記録。

### この後（plan スコープ外・本人作業）

1. **本人実機サニティ 10 項目**（spec §14）＝mock 鯖 8200 を起動して本人がブラウザで検分。特に **`maxBarSpacing=15` の最終確定（候補 12-18px）**・**C4 の ±28px レイアウトシフトの許容可否**・**D25（基準線 title 消滅）と ATR 中央値バッジの見え方**・**D27（wide でのタイトル2行化）** は plan で決め切れない体感判断。
2. **merge/デプロイ**（前 wave と同手順）＝main へ ff-merge → push → **両デプロイ（通常 URL / persona）の変更資産を md5 突合**（push 成功≠反映）。
3. **横断記憶整理**＝Obsidian `Projects/investment-portal.md` の🎨UIUX刷新スレッド節と MEMORY.md を更新し、spec §16 の次 wave 積み残しリスト本体を転記。
