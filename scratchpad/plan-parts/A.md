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
