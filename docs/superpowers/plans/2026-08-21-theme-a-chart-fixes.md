# テーマA本実装＋チャート修正①〜⑤ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UIUX刷新 wave＝案A可読性チューニングの本体反映＋監査推奨順①〜⑤（全ゼロFY防御/S/R窓統一+A-mini/チャート別単位/BS吹き出し）を、spec `docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md`（敵対検証16件反映済・以下「spec」）どおりに実装する。

**Architecture:** 純関数（finance-rules/detail-rules/cross-section-rules・node --test 直叩き）→描画（detail-charts）→配線（detail.js/index.html）の分離規律を維持。テーマAは「override CSS の移植」でなく発生源修正＋in-place 編集。検証は 2 層ゲート（不変キー無条件 MATCH＋意図 diff 検分→再 baseline 昇格）。

**Tech Stack:** Vanilla JS（UMD/IIFE）・Chart.js 4.5.1＋chartjs-plugin-datalabels 2.2.0（SRI pin）・Lightweight Charts 4.2.3・node --test・pytest・Playwright 1.60.0（NODE_PATH=/home/shugo/node_modules）・scratchpad/mock_prod_server.py（PLAN2_PORT=8200）。

## Global Constraints

- **worktree**: `/home/shugo/apps/investment-portal/.claude/worktrees/uiux-theme-a-charts`（branch `worktree-uiux-theme-a-charts`・base `143df86`）。全コマンドはこの worktree ルートで実行。
- **node テスト起動**: `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`（**ディレクトリ渡し `tests/` は MODULE_NOT_FOUND で不可**）。baseline=331 pass/0 fail。
- **pytest 起動**: `PYTHONPATH=/home/shugo/apps/investment-portal/.claude/worktrees/uiux-theme-a-charts /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q`（venv は **main 側**・PYTHONPATH 必須）。baseline=228 passed。**本 wave で Python は無改変＝228 不変が全タスクのゲート**。
- **Playwright 実行**: `NODE_PATH=/home/shugo/node_modules node <script>`。mock 鯖は `PLAN2_PORT=8200 python3 scratchpad/mock_prod_server.py`（detail-snapshot.js:61 / f2-snapshot.js:121 は URL 8200 ハードコード）。
- **0x0 罠**: display:none コンテナで createChart しない・chart-container の寸法/初期化順序は不変（唯一の恒久技術制約）。
- **MA/BB/KC の base 算出（detail-charts.js:483-502）不可侵**（ウォームアップ切れ退行防止）。S/R だけを displayPrices 化する。
- **window 公開面を増やさない**: detail-snapshot の windowApi 16/16 gate を壊すため、新しい `window.*` API・`Object.assign(window,...)` 追加は禁止。新関数は closure 私有 or `FinanceRules.*`/`DetailRules.*` 名前空間。
- **money.js / money-rules.js / advice.py / api/ は非接触**（money.css のみ変更＝表示層）。money.css を触ったタスクは cockpit-e2e.js 必須。
- **ローソク確定色・ZigZag 逆規約・サブパネル形状は非対象**。テーマA が触るのは文字/チップ/トークン/グローのみ。
- **CSS cascade 罠**: 12px 床は base 宣言と @media 内縮小宣言（spec §4.5 の 9 行）を**同時書換**。D 層 `[data-theme="D"] #money-view` 直指定 font-family の 4 クラス（section-desc/cf-note/nisa-gate/rm-note）は**末尾追記でなく in-place 編集**。
- **datalabels 内部 API**（`$datalabels`/`$layout._box._rect`）は SRI pin v2.2.0 固定の間のみ安定。プラグイン更新時は bsLeader 再確認（spec §8.3）。
- **コミット**: 各タスク末尾で `git add <明示列挙> && git commit`。メッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける。scratchpad/ の検証スクリプトはリポ追跡対象（過去 wave と同様）だが baseline JSON（detail-baseline.json/f2-baseline.json）は**コミットしない**。
- **detail-snapshot 2 層ゲート**（spec §9.1）: 層1=windowApi 16/16・canvasCount・pageErrors 0 は無条件不変。層2=computedStyles/domHash/chartContainerDims は diff キーを jq で検分し「意図した変更のみ」を確認→`capture` で再 baseline 昇格。f2-snapshot も同運用。

---

### Task 0: 検証基盤セットアップ（実DB symlink・before-baseline・ledger）

**Files:**
- Replace: `data/investment.db`（0 バイト空ファイル→main 実DBへの symlink）
- Create: `scratchpad/detail-baseline.json`・`scratchpad/f2-baseline.json`（capture 生成物・**コミットしない**）
- Create: `.superpowers/sdd/progress.md`（SDD ledger・git 非追跡＝コミット不要）

**Interfaces:**
- Produces: 以後の全タスクが依存する検証基盤（実DB・mock 鯖・before-baseline×2・テスト green 確認）

- [ ] **Step 1: 実DB symlink 差替**（worktree の db は 0 バイト空＝mock 鯖の全 API が 500 になり e2e が偽陰性で全滅するため必須）

```bash
rm data/investment.db
ln -s /home/shugo/apps/investment-portal/data/investment.db data/investment.db
ls -la data/investment.db   # -> main 側 86KB への symlink を確認
```

- [ ] **Step 2: テスト green baseline 確認**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js
PYTHONPATH=$PWD /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q
```
Expected: node **331 pass/0 fail**・pytest **228 passed**。

- [ ] **Step 3: mock 鯖起動＋before-baseline を2本 capture**（**いかなるコード変更よりも前に**）

```bash
PLAN2_PORT=8200 python3 scratchpad/mock_prod_server.py &   # 起動しっぱなしで以後のタスクでも使用
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
NODE_PATH=/home/shugo/node_modules node scratchpad/f2-snapshot.js capture
```
Expected: `scratchpad/detail-baseline.json`・`scratchpad/f2-baseline.json` 生成。※main リポ側の古い f2-baseline.json は流用禁止（2026-07-03 期の陳腐化物）。

- [ ] **Step 4: SDD ledger 新規作成**

`.superpowers/sdd/progress.md` を main 側 `.superpowers/sdd/progress.md`（B#2）の形式で作成:

```markdown
# テーマA本実装＋チャート修正①〜⑤ SDD 進捗 ledger

- branch: worktree-uiux-theme-a-charts / base: 143df86（実装開始前 HEAD）
- spec: docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md
- plan: docs/superpowers/plans/2026-08-21-theme-a-chart-fixes.md
- 検証基盤: 実DB symlink 済・before-baseline(detail/f2) capture 済・node 331/pytest 228 green

## タスク状態
- Task 0: complete（セットアップ）

## Minor findings ロールアップ
（レビューで出た Minor をここへ追記）
```

- [ ] **Step 5: コミット**（symlink は gitignore 対象・baseline もコミットしない＝コミット対象が無ければ skip）

```bash
git status --short   # data/ と scratchpad/*.json が untracked/ignored のままであることを確認
```

---

### Task 1: `FinanceRules.hasFinSubstance`（修正①の単一源述語）

**Files:**
- Modify: `finance-rules.js`（:67 hasValue 直後に新関数・:248 exports に追加）
- Test: `tests/finance-rules.test.js`（末尾に追加）

**Interfaces:**
- Produces: `FinanceRules.hasFinSubstance(fin) -> boolean`（fin=財務行オブジェクト or null/undefined。全ゼロ行/null は false）。Task 2/3/4/5 が消費。

- [ ] **Step 1: 失敗するテストを書く**（tests/finance-rules.test.js 末尾に追加）

```js
test("hasFinSubstance: 全ゼロFY行（ETL未確定）を欠測扱いにする単一源述語", () => {
  const allZero = { net_sales: 0, current_assets: 0, non_current_assets: 0, net_assets: 0, net_income: 0, operating_cf: 0 };
  assert.equal(F.hasFinSubstance(allZero), false);       // 全ゼロ行（18列すべて0）
  assert.equal(F.hasFinSubstance(null), false);          // 行なし
  assert.equal(F.hasFinSubstance(undefined), false);
  const bank = { net_sales: 6838439, current_assets: 0, non_current_assets: 413113501, net_assets: 18000000 };
  assert.equal(F.hasFinSubstance(bank), true);           // 銀行: current_assets=0 でも総資産>0（誤除外なし）
  const normal = { net_sales: 48036704, current_assets: 100, non_current_assets: 200, net_assets: 150 };
  assert.equal(F.hasFinSubstance(normal), true);
  const negEquityOnly = { net_sales: 0, current_assets: 0, non_current_assets: 0, net_assets: -500 };
  assert.equal(F.hasFinSubstance(negEquityOnly), true);  // 純資産のみ負値＝実質データあり
});
```

- [ ] **Step 2: 失敗を確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/finance-rules.test.js`
Expected: FAIL（`F.hasFinSubstance is not a function`）

- [ ] **Step 3: 実装**（finance-rules.js の hasValue（:65-67）直後に追加）

```js
  // 「実質値のある財務行か」の判定（全ゼロFY行=ETL未確定行の防御・spec §5 全消費者の単一源）。
  //  主要3軸（売上/総資産/純資産）のいずれかに実質値があれば true。現DBでは
  //  「n(net_sales)===0 && totalAssets===0」の否定と等価（12銘柄FY2026行に過不足なく一致をSELECTで実証済）。
  function hasFinSubstance(fin) {
    if (!fin) return false;
    return n(fin.net_sales) > 0 || totalAssets(fin) > 0 || n(fin.net_assets) !== 0;
  }
```

exports（:248 `hasValue: hasValue,` の直後）に `hasFinSubstance: hasFinSubstance,` を追加。

- [ ] **Step 4: テスト pass 確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`
Expected: **332 pass/0 fail**（331＋新規1）

- [ ] **Step 5: コミット**

```bash
git add finance-rules.js tests/finance-rules.test.js
git commit -m "feat(zerofy): FinanceRules.hasFinSubstance 追加（全ゼロFY行防御の単一源述語）"
```

---

### Task 2: 健全性/FCF トレンド系列の全ゼロ年 null 化

**Files:**
- Modify: `detail-rules.js:875-883`（healthTrendSeries ループ）・`:906-913`（fcfTrendSeries ループ）
- Test: `tests/detail-rules.test.js`（末尾に追加）

**Interfaces:**
- Consumes: `FR.hasFinSubstance(fin)`（Task 1）
- Produces: healthTrendSeries/fcfTrendSeries は全ゼロ年で**全系列 null**（healthTrend は equityRatio/currentRatio/cash/totalLiab の4系列とも）

- [ ] **Step 1: 失敗するテストを書く**（tests/detail-rules.test.js 末尾に追加。既存の require 変数名は同ファイル先頭の慣行＝`DR` に合わせる）

```js
test("healthTrendSeries/fcfTrendSeries: 全ゼロFY行は全系列 null 欠測点（偽0実点を排除）", () => {
  const data = { currency: "JPY", financials_trend: {
    2025: { net_sales: 1000, current_assets: 500, non_current_assets: 500, net_assets: 400,
            current_liabilities: 300, non_current_liabilities: 300, cf_cash_end: 200,
            operating_cf: 100, investing_cf: -50, net_income: 80 },
    2026: { net_sales: 0, current_assets: 0, non_current_assets: 0, net_assets: 0,
            current_liabilities: 0, non_current_liabilities: 0, cf_cash_end: 0,
            operating_cf: 0, investing_cf: 0, net_income: 0 },
  } };
  const h = DR.healthTrendSeries(data, false);
  const zi = h.years.indexOf("2026"), oi = h.years.indexOf("2025");
  assert.equal(h.equityRatio[zi], null);   // 比率2系列: 0%急落を欠測化
  assert.equal(h.currentRatio[zi], null);
  assert.equal(h.cash[zi], null);          // 金額2系列: 現金0/総負債0の偽実点も欠測化
  assert.equal(h.totalLiab[zi], null);
  assert.notEqual(h.equityRatio[oi], null);
  assert.notEqual(h.cash[oi], null);
  const fc = DR.fcfTrendSeries(data);
  const fzi = fc.years.indexOf("2026");
  assert.equal(fc.fcf[fzi], null);         // FCF=0 の偽実点を排除
  assert.equal(fc.operatingCf[fzi], null);
  assert.equal(fc.investingCf[fzi], null);
  assert.notEqual(fc.fcf[fc.years.indexOf("2025")], null);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/detail-rules.test.js`
Expected: FAIL（cash[zi] が 0・fcf[fzi] が 0）

- [ ] **Step 3: 実装**

healthTrendSeries のループ（:875-883）を書換:

```js
    for (var i = 0; i < years.length; i++) {
      var f = tr[years[i]];
      var sub = FR.hasFinSubstance(f);   // 全ゼロFY行（ETL未確定）は4系列とも欠測点（spec §5.4-1）
      var eqOk = sub && FR.hasValue(f, "net_assets") && FR.hasValue(f, "current_assets") && FR.hasValue(f, "non_current_assets");
      var curOk = sub && FR.hasValue(f, "current_assets") && FR.hasValue(f, "current_liabilities");
      eq.push(eqOk ? FR.equityRatio(f) : null);
      cur.push(curOk ? FR.currentRatio(f) : null);
      cash.push(sub && FR.hasValue(f, "cf_cash_end") ? f.cf_cash_end : null);
      tl.push(sub && (FR.hasValue(f, "current_liabilities") || FR.hasValue(f, "non_current_liabilities")) ? FR.totalLiabilities(f) : null);
    }
```

fcfTrendSeries のループ（:906-913）冒頭に early null を追加:

```js
    for (var i = 0; i < years.length; i++) {
      var f = tr[years[i]];
      if (!FR.hasFinSubstance(f)) {   // 全ゼロFY行は全系列 null（FCF=0 の偽実点を排除・spec §5.4-2）
        fcfA.push(null); mg.push(null); cc.push(null); op.push(null); iv.push(null);
        continue;
      }
      fcfA.push(FR.fcf(f));
      mg.push(FR.fcfMargin(f));
      cc.push(FR.cashConversion(f));
      op.push(FR.hasValue(f, "operating_cf") ? f.operating_cf : null);
      iv.push(FR.hasValue(f, "investing_cf") ? f.investing_cf : null);
    }
```

- [ ] **Step 4: 全テスト pass 確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`
Expected: **333 pass/0 fail**

- [ ] **Step 5: コミット**

```bash
git add detail-rules.js tests/detail-rules.test.js
git commit -m "fix(zerofy): 健全性/FCFトレンドの全ゼロFY年を全系列null欠測化（0%急落・偽FCF=0を排除）"
```

---

### Task 3: cross-section `_latestFin` の実質最新年化

**Files:**
- Modify: `cross-section-rules.js:63-69`
- Test: `tests/cross-section-rules.test.js`（末尾に追加）

**Interfaces:**
- Consumes: `FR.hasFinSubstance`（FR 束縛は cross-section-rules.js:6-7 で既存）
- Produces: `_latestFin(raw)` は「hasFinSubstance な最大年」の fin を返す（全ゼロ最新年をスキップ）。`CS._latestFin` は export 済（:255）＝直接テスト可。

- [ ] **Step 1: 失敗するテストを書く**（tests/cross-section-rules.test.js 末尾に追加。先頭の `const CS = require("../cross-section-rules.js")` を利用）

```js
test("_latestFin: 最新年が全ゼロFY行なら実質値のある直近年へフォールバック", () => {
  const raw = { financials_trend: {
    2025: { net_sales: 1000, current_assets: 500, non_current_assets: 500, net_assets: 400 },
    2026: { net_sales: 0, current_assets: 0, non_current_assets: 0, net_assets: 0 },
  } };
  const fin = CS._latestFin(raw);
  assert.equal(fin.net_sales, 1000);            // 2026(全ゼロ)でなく2025を採用
  const allZeroOnly = { financials_trend: {
    2026: { net_sales: 0, current_assets: 0, non_current_assets: 0, net_assets: 0 },
  } };
  assert.equal(CS._latestFin(allZeroOnly), null); // 実質年が無ければ null（分布から除外）
});
```

- [ ] **Step 2: 失敗を確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/cross-section-rules.test.js`
Expected: FAIL（fin.net_sales が 0）

- [ ] **Step 3: 実装**（:63-69 を書換）

```js
  function _latestFin(raw) {
    var t = raw && raw.financials_trend;
    if (!t || typeof t !== "object") return null;
    var years = Object.keys(t).map(Number).filter(isFinite).sort(function (a, b) { return b - a; });
    for (var i = 0; i < years.length; i++) {   // spec §5.4-4: 実質値のある最大年（全ゼロFY行スキップ）
      var fin = t[String(years[i])];
      if (FR && FR.hasFinSubstance(fin)) return fin;
    }
    return null;
  }
```

- [ ] **Step 4: 全テスト pass 確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`
Expected: **334 pass/0 fail**（既存 cross-section テストの回帰なし＝現フィクスチャは実質行のみゆえ不変）

- [ ] **Step 5: コミット**

```bash
git add cross-section-rules.js tests/cross-section-rules.test.js
git commit -m "fix(zerofy): cross-section _latestFin を実質最新年へ（全ゼロFY行で12大型銘柄が分布から脱落する汚染を解消）"
```

---

### Task 4: detail.js 既定年＋合流＋表示/非表示の共通ブロック＋プレースホルダ

**Files:**
- Modify: `detail.js:598-601`（既定年）・`:650`（fin ゲート）・`:754-772`（共通ブロック化）
- Modify: `detail.css` 末尾（`.fin-pending-note` スタイル追加）
- Create: `scratchpad/zerofy-verify.js`（Playwright 受入）

**Interfaces:**
- Consumes: `FinanceRules.hasFinSubstance`
- Produces: `#fin-pending-note`（`#kpi-compare-card` 直前・`.fin-pending-note`）。表示判定の単一源 `finVisible = !isEtf && !!fin`。年ボタン生成（:605）は**無改変**＝FY2026 ボタンは残る。

- [ ] **Step 1: 既定年選択を書換**（:598-601）

```js
	const availableYears = Object.keys(data.financials_trend).sort(
		(a, b) => b - a,
	);
	// spec §5.2: 既定年は「実質値のある最新年」（全ゼロFY行=ETL未確定はスキップ・FY2026ボタン自体は残す）
	selectedYear = availableYears.find((y) => FinanceRules.hasFinSubstance(data.financials_trend[y]))
		|| availableYears[0] || 2025;
```

- [ ] **Step 2: fin ゲートを書換**（:650）

```js
	const rawFin = data.financials_trend[selectedYear];
	// spec §5.3 合流方式: 全ゼロFY行は既存 !fin 経路へ合流（財務描画スキップ＋プレースホルダ）
	const fin = FinanceRules.hasFinSubstance(rawFin) ? rawFin : null;
```

- [ ] **Step 3: 表示/非表示の共通ブロック化**（:754-772 の `// ETF・財務データなしの場合は…` 〜 `if (!fin) return;` を以下に置換。ai-analysis-card の既存トグル（:775-785）は**そのまま残す**＝fin 実在経路の表示を担う）

```js
	// spec §5.3: ETF・財務なし(全ゼロFY含む)の表示/非表示は finVisible を単一判定源に毎回評価する
	//  共通ブロック（isEtf return より前の無条件通過点）。FY2026→実質年復帰・ETF→株式の復帰も担う。
	const isEtf = data.type === "etf";
	const finVisible = !isEtf && !!fin;
	const finCards = ["bs-title", "radar-title", "pl-title", "cf-title", "health-trend-card", "dupont-card", "fcf-trend-card"];
	finCards.forEach(id => {
		const card = document.getElementById(id)?.closest(".card");
		if (card) card.style.display = finVisible ? "" : "none";
	});
	// kpi-compare-card / ai-analysis-card は .card 祖先を持たない（#detail-view 直下）＝直接 display
	const kpiCard = document.getElementById("kpi-compare-card");
	if (kpiCard) kpiCard.style.display = finVisible ? "" : "none";
	const aiCardHide = document.getElementById("ai-analysis-card");
	if (aiCardHide && !finVisible) aiCardHide.style.display = "none";
	// 決算未確定プレースホルダ（株式×非実質年のみ表示・冪等・#kpi-compare-card 直前）
	let pendingNote = document.getElementById("fin-pending-note");
	if (!pendingNote && kpiCard) {
		pendingNote = document.createElement("div");
		pendingNote.id = "fin-pending-note";
		pendingNote.className = "fin-pending-note";
		pendingNote.textContent = "この年度は決算未確定です";
		kpiCard.parentNode.insertBefore(pendingNote, kpiCard);
	}
	if (pendingNote) pendingNote.style.display = (!isEtf && !fin) ? "" : "none";
	// ai-insight-card は常に既定 none を維持（既存挙動保存・wireInsightCard の可視ゲートのみが表示する）
	var _aiInsightCard = document.getElementById("ai-insight-card");
	if (_aiInsightCard) _aiInsightCard.style.display = "none";
	if (isEtf) return;

	// C1: 非ETFで当該年度の財務が欠損（全ゼロFY含む）なら財務固有の描画だけをスキップ
	if (!fin) return;
```

※旧コードとの差分: finCards 配列から `"kpi-compare-card"` を除去（closest(".card") が null＝no-op だったため直接 display へ）。旧 :765-768 の isEtf 分岐（kpi 直接 hide + return）は共通ブロックへ吸収。

- [ ] **Step 4: detail.css 末尾（:1020 の後）にスタイル追加**

```css
      /* 修正① 全ゼロFY: 決算未確定プレースホルダ（spec §5.3） */
      .fin-pending-note { color: var(--ix-text-dim); font-size: 13px; padding: 18px 0 6px; letter-spacing: 1px; }
```

- [ ] **Step 5: Playwright 受入スクリプトを作成**（`scratchpad/zerofy-verify.js`・mock 鯖 8200 前提）

```js
// 修正① 受入: 既定年/プレースホルダ/残像ゼロ/AIカード/復帰/ETF遷移（spec §5.5）
// 実行: PLAN2_PORT=8200 で mock 鯖起動後、NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-verify.js
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8200";
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  const open = async (t) => { await page.evaluate((tk) => navigateToDetail(tk), t); await page.waitForTimeout(700); };
  const q = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).display : null; }, sel);

  await open("6861.T");   // 全ゼロFY2026 銘柄
  const defYear = await page.evaluate(() => document.getElementById("selected-year-display").innerText);
  check("既定年が実質最新年（2026 FY でない）", !/2026/.test(defYear));
  check("既定年でプレースホルダ非表示", ["none", null].includes(await q("#fin-pending-note")));
  // FY2026 ボタンを手動選択
  await page.evaluate(() => { [...document.querySelectorAll(".time-btn")].find((b) => /2026/.test(b.innerText))?.click(); });
  await page.waitForTimeout(700);
  check("FY2026: プレースホルダ表示", (await q("#fin-pending-note")) !== "none");
  check("FY2026: KPI比較カード非表示", (await q("#kpi-compare-card")) === "none");
  check("FY2026: AI分析カード非表示", (await q("#ai-analysis-card")) === "none");
  check("FY2026: BSカード非表示", await page.evaluate(() => getComputedStyle(document.getElementById("bs-title").closest(".card")).display === "none"));
  // 実質年へ復帰
  await page.evaluate(() => { [...document.querySelectorAll(".time-btn")].find((b) => !/2026/.test(b.innerText))?.click(); });
  await page.waitForTimeout(700);
  check("復帰: KPI比較カード再表示", (await q("#kpi-compare-card")) !== "none");
  check("復帰: プレースホルダ非表示", (await q("#fin-pending-note")) === "none");
  // 前年に ai_analysis がある銘柄で FY2026 切替→AI カード非表示（mock は全年 ai_analysis 生成）
  await open("6861.T");
  const aiBefore = await q("#ai-analysis-card");
  await page.evaluate(() => { [...document.querySelectorAll(".time-btn")].find((b) => /2026/.test(b.innerText))?.click(); });
  await page.waitForTimeout(700);
  check("AI: 実質年で表示→FY2026で非表示", aiBefore !== "none" && (await q("#ai-analysis-card")) === "none");
  // ETF 遷移でプレースホルダ残留なし
  await open("SPY");
  check("SPY: プレースホルダ非表示", (await q("#fin-pending-note")) === "none");
  check("SPY: KPI比較カード非表示（ETF既存挙動）", (await q("#kpi-compare-card")) === "none");
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 6: 受入実行＋snapshot 検分**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-verify.js          # -> ALL PASS
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare
```
Expected: zerofy-verify ALL PASS。compare は domHash diff（#fin-pending-note 追加）のみ＝意図 diff を検分後 `capture` で再 baseline。windowApi 16/16・canvasCount・pageErrors 0 不変。

- [ ] **Step 7: コミット**

```bash
git add detail.js detail.css scratchpad/zerofy-verify.js
git commit -m "feat(zerofy): 既定年=実質最新年＋合流方式プレースホルダ＋表示/非表示の共通ブロック化（復帰欠落も解消）"
```

---

### Task 5: index.html ポータル系の全ゼロFY防御（latestFin/sparkline/growthRates）

**Files:**
- Modify: `index.html:1963-1968`・`:1992-1996`・`:2001`
- Create: `scratchpad/zerofy-portal-verify.js`

**Interfaces:**
- Consumes: `FinanceRules.hasFinSubstance`
- Produces: `substYears`（実質年・降順）/`substTrend`（実質年のみの trend オブジェクト）を1回構築し latestFin・trendYears・growthRates の3消費者で共用（spec §5.4-5/6/7）

- [ ] **Step 1: 最新年採用を書換**（:1963-1968）

```js
          // spec §5.4-5: 実質値のある年のみを母集合に（全ゼロFY行=ETL未確定を除外・hasFinSubstance 単一源）
          const substYears = Object.keys(company.financials_trend)
            .filter((y) => FinanceRules.hasFinSubstance(company.financials_trend[y]))
            .sort((a, b) => Number(b) - Number(a));
          const substTrend = {};
          substYears.forEach((y) => { substTrend[y] = company.financials_trend[y]; });
          const latestYear = substYears[0] || null;
          const latestFin = latestYear ? company.financials_trend[latestYear] : null;
          const fin = latestFin || {};
          const hasFinData = latestFin !== null;   // substYears 由来＝常に実質行（旧 net_sales>0||net_assets>0 述語を置換）
```

- [ ] **Step 2: sparkline 母集合を書換**（:1992-1996）

```js
          let trendSales = [];
          // spec §5.4-6: 実質年のみの昇順末尾3年（全ゼロFY の 0 が偽のゼロ急落波形になるのを排除）
          const trendYears = substYears.slice().sort((a, b) => Number(a) - Number(b)).slice(-3);
          trendYears.forEach((yr) => {
            trendSales.push(company.financials_trend[yr].net_sales || 0);
          });
```

- [ ] **Step 3: growthRates を書換**（:2001）

```js
          // spec §5.4-7: end=全ゼロ年だと salesYoY=-100%/CAGR null（バッジ劣化・ソート最下位・スクリーナー脱落）
          const growth = FinanceRules.growthRates(substTrend, ["net_sales", "net_income"]);
```

- [ ] **Step 4: Playwright 受入スクリプト作成**（`scratchpad/zerofy-portal-verify.js`）

```js
// 修正① ポータル行受入: 全ゼロ銘柄の成長バッジ実CAGR/ソート/正常銘柄の非影響（spec §5.5）
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const item = await page.evaluate(() => {
    // renderPortal と同じ経路で 6861.T の growth を再計算（実装の substTrend フィルタを検証）
    const c = STOCK_DATA["6861.T"];
    const substYears = Object.keys(c.financials_trend).filter((y) => FinanceRules.hasFinSubstance(c.financials_trend[y]));
    const substTrend = {};
    substYears.forEach((y) => { substTrend[y] = c.financials_trend[y]; });
    return {
      substHas2026: substYears.some((y) => String(y) === "2026"),
      growth: FinanceRules.growthRates(substTrend, ["net_sales", "net_income"]),
      rawGrowth: FinanceRules.growthRates(c.financials_trend, ["net_sales", "net_income"]),
    };
  });
  check("6861.T: substYears が FY2026 を除外", item.substHas2026 === false);
  check("6861.T: salesCagr が実値（null でない）", item.growth.salesCagr !== null);
  check("6861.T: salesYoY が -100% でない", item.growth.salesYoY === null || Math.round(item.growth.salesYoY) !== -100);
  // DOM: 6861.T 行の成長バッジが muted「CAGR —」でない
  const badge = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    const row = rows.find((r) => r.innerHTML.includes("6861"));
    const b = row && row.querySelector(".growth-badge");
    return b ? b.textContent : null;
  });
  check("6861.T 行: 成長バッジが実CAGR表示（『—』でない）", badge !== null && !/—/.test(badge));
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 5: 受入実行＋f2-snapshot 検分**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-portal-verify.js   # -> ALL PASS
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js     # -> 9 assert PASS
NODE_PATH=/home/shugo/node_modules node scratchpad/f2-snapshot.js compare
```
Expected: f2 compare は portalDomLen 系の意図 diff のみ（全ゼロ12銘柄の sparkline/バッジ変化）→検分後 `capture` で再 baseline。

- [ ] **Step 6: コミット**

```bash
git add index.html scratchpad/zerofy-portal-verify.js
git commit -m "fix(zerofy): ポータルの最新年/sparkline/growthRates を実質年母集合へ（偽ゼロ急落・CAGR—劣化・ソート最下位落ちを解消）"
```

---

### Task 6: テーマA-1 トークン＋!important 発生源修正

**Files:**
- Modify: `index.html`（:70 トークン・:72 直後に --ix-sans・:447・:1206・:2061・:2101-2102・:2144/2153/2170/2178）
- Modify: `money.css`（:12・:774・:775）
- Modify: `detail.js`（:663・:665）

**Interfaces:**
- Produces: トークン `--ix-slate: #7f95a3`・新規 `--ix-sans`（index.html :root＝detail.css/money.css からも参照可）。theme-a の !important 4ルールは**本体に持ち込まない**（発生源を var()/12px 化）。

- [ ] **Step 1: index.html トークン**（:70 書換＋:72 の直後に挿入）

```css
  --ix-slate: #7f95a3;
```
（旧値 `#6b7d8a`。td 以外の使用約9箇所も明るくなるが可読性向上と同方向＝spec §4.1 で許容済）

`--ix-text: #d4e2ea;`（:72）の直後に追加:

```css
  /* テーマA⑦: 日本語長文用サンセリフ（mono/字間はラテン・数値へ分離） */
  --ix-sans: system-ui, -apple-system, "Segoe UI", "Hiragino Sans",
             "Noto Sans JP", "Yu Gothic UI", "Meiryo", sans-serif;
```

- [ ] **Step 2: money.css トークン**（:12 の `--c-text-mute: #5b6478` → `#7b859b`〔非D保険・--c-text-faint は据置〕／:774 の `--c-text-faint: #6e8492` → `#8299a7`・`--c-text-mute: #54636f` → `#7f95a3`／:775 の `--c-slate: #6b7d8a` → `#7f95a3`）

- [ ] **Step 3: !important 発生源4系統を修正**

1. index.html:2101-2102（sector-title テンプレ・**border-color:${sectorColor}33 と :2103 のグラデは残す**）:
```js
            <span style="color:var(--ix-text);">${esc(ind.replace("US - ", "US ").replace("国内ETF", "JP ETF"))}</span>
            <span class="sector-count-badge" style="border-color:${sectorColor}33;color:var(--ix-text-dim);">${count}社</span>
```
2. index.html:2144/2153/2170/2178 の4箇所: `"color: #6b7d8a;"` → `"color: var(--ix-slate);"`
3. index.html:2061（空状態 div）: `color:#6b7d8a` → `color:var(--ix-slate)`
4. index.html:1206（#csv-export-btn inline）: `font-size:0.72rem` → `font-size:12px`
5. detail.js:663（ティッカー・**12px が正＝override の見た目に忠実・本人確定**）: `font-size:0.9rem` → `font-size:12px`
6. detail.js:665（単位注記・Task 10 で span ごと削除されるが順序上ここで床）: `font-size:0.7rem` → `font-size:12px`

- [ ] **Step 4: 「標準」val-badge 減灯**（index.html:447 に `opacity: 0.35;` を追記・非表示化はしない）

```css
      .val-badge.fair  { background: rgba(107,125,138,0.14); color: var(--ix-slate-light); border: 1px solid rgba(107,125,138,0.28); opacity: 0.35; }
```

- [ ] **Step 5: 検証（層1不変＋意図 diff 検分）**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
NODE_PATH=/home/shugo/node_modules node scratchpad/f2-snapshot.js compare      # portal.styles 意図diff→検分→capture
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare  # computedStyles 意図diff→検分→capture
NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js              # money.css トークン変更のため必須
```
Expected: smoke/cockpit 全 PASS。snapshot diff は色トークン由来キーのみ＝jq で確認後 再 baseline。

- [ ] **Step 6: コミット**

```bash
git add index.html money.css detail.js
git commit -m "feat(theme-a): トークン書換(--ix-slate/--ix-sans/--c-*)＋!important 4系統の発生源修正（var()化・12px直書き）"
```

---

### Task 7: テーマA-2 12px床（media同時書換）＋?円17px＋境界線色2クラス

**Files:**
- Modify: `index.html`（inline style 内の床対象＋@media :903/:924/:928）
- Modify: `detail.css`（床対象＋@media :408/:439・:706-708・:254・:935・:941-942/:958）
- Modify: `money.css`（床対象＋1行 media :331/:555/:565/:741・:255/:257/:272）
- Create: `scratchpad/theme-floor-check.js`

**Interfaces:**
- Consumes: 床対象クラスの全量リスト＝`docs/superpowers/specs/assets/theme-a-tuning.css` の **L111-157**（portal 15/detail 29/mcc 97・stale 0 件を機械照合済＝これが正のチェックリスト）
- Produces: 床対象全クラスの computed font-size ≥ 12px（全ビューポート）・`.term-help`/`.mcc-help` 円 17px

- [ ] **Step 1: 機械照合スクリプトを先に作成**（`scratchpad/theme-floor-check.js`・失敗する状態から始める＝TDD）

```js
// テーマA①⑧ 床チェック: theme-a-tuning.css L111-157 のセレクタ全量について computed font-size>=12px を検証。
// 実行: NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js [width]（既定 1440・375 も回す）
const { chromium } = require("playwright");
const fs = require("fs");
const width = Number(process.argv[2] || 1440);
const css = fs.readFileSync("docs/superpowers/specs/assets/theme-a-tuning.css", "utf8");
// ①⑧ブロック（L108-159）のセレクタ列挙を抽出（`{ font-size: 12px; }` の直前までのカンマ区切り）
const m = css.match(/一括で12px化[\s\S]*?\*\/([\s\S]*?)\{\s*font-size:\s*12px;/);
const selectors = m[1].split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim()).filter((s) => s && !s.startsWith("/*"));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(700);
  await page.evaluate(() => showView("money"));
  await page.waitForTimeout(400);
  let fails = [], found = 0;
  for (const sel of selectors) {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      return parseFloat(getComputedStyle(el).fontSize);
    }, sel).catch(() => null);
    if (r === null) continue;             // 未マウントの動的要素はスキップ（ログのみ）
    found++;
    if (r < 12) fails.push(`${sel}: ${r}px`);
  }
  // ?円 17px
  const circle = await page.evaluate(() => {
    const el = document.querySelector(".term-help") || document.querySelector(".mcc-help");
    return el ? getComputedStyle(el).width : null;
  });
  console.log(`width=${width} checked=${found}/${selectors.length} circle=${circle}`);
  fails.forEach((f) => console.log("  ❌ " + f));
  if (circle && parseFloat(circle) < 17) { fails.push("?円<17px"); console.log("  ❌ ?円 " + circle); }
  await browser.close();
  console.log(fails.length === 0 ? "ALL PASS" : `${fails.length} FAILED`);
  process.exit(fails.length === 0 ? 0 : 1);
})();
```

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js`
Expected: **FAILED 多数**（現状 sub-12px が実在するため）

- [ ] **Step 2: base 宣言の in-place 12px 化**

対象＝theme-a-tuning.css **L111-157 の全クラス**の基底宣言（index.html 約16・detail.css 約17＋px系 :899-958・money.css 約61）。各宣言の `font-size: 0.6〜0.74rem` / `10px`/`11px` を `font-size: 12px` へ in-place 書換。特記:
- `detail.css:935 .relpos-cap` は **`font: 11px/1.3 var(--ix-mono...)` の shorthand**＝`font: 12px/1.3 var(--ix-mono, monospace);` へ（プロパティ形が他と異なる）。
- 除外（純装飾グリフ・触らない）: `.c-sep` / `.acc-caret` / `.mcc-rm-phase-dot` / `.mcc-step-dot`。

- [ ] **Step 3: @media 内縮小の同時書換（cascade 罠・9行全部）**

| ファイル:行 | 対象 | 書換 |
|---|---|---|
| index.html:903 | `.sector-btn` 0.72rem @768 | `font-size: 12px` |
| index.html:924 | `.sector-btn` 0.68rem @375 | `font-size: 12px` |
| index.html:928 | `.card-title` 0.72rem @375 | `font-size: 12px` |
| detail.css:408 | `.panel-desc-text-below` 0.72rem @768 | `font-size: 12px` |
| detail.css:439 | `.detail-star-btn`/`.open-compare-btn` 0.68rem @768 | `font-size: 12px` |
| money.css:331 | `.mcc-step-label` 0.62rem @640 | `font-size: 12px` |
| money.css:555 | `.mcc-rm-phase-label` 0.66rem @640 | `font-size: 12px` |
| money.css:565 | `.mcc-rm-seam-chip` 0.58rem @640 | `font-size: 12px` |
| money.css:741 | `.mcc-nisa-table td::before` 0.66rem @600 | `font-size: 12px` |

- [ ] **Step 4: ?円 17px 化＋境界線色2クラス**

- `detail.css:941-942` `.term-help`: `width/height: 14px→17px`・`font-size: 10px→12px`。`:958` `.term-help::after` 本文 `11px→12px`。
- `money.css:255` `.mcc-help` w/h `14px→17px`・`:257` font `0.6rem→12px`・`:272` `::after` 本文 `0.66rem→12px`。
- `detail.css:706-708` `.time-label`: `font-size: 0.74rem→12px`＋color `var(--ix-border-mid)→var(--ix-text-dim)`。
- `detail.css:254` `.detail-star-btn` の color `var(--ix-border-mid)→var(--ix-text-dim)`（:253 は padding・:hover/.watched の amber 据置）。

- [ ] **Step 5: 機械照合＋表ヘッダ確認**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js        # 1440 -> ALL PASS
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js 375    # 375  -> ALL PASS（media 同時書換の証明）
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js 768
```
＋Playwright で index.html:2116 の th 内 `.term-help`（円17px化）が**表ヘッダを折返させない**ことをスクショ確認（`page.screenshot`）。

- [ ] **Step 6: snapshot 検分＋cockpit-e2e**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare   # computedStyles 意図diff→capture
NODE_PATH=/home/shugo/node_modules node scratchpad/f2-snapshot.js compare
NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js               # money.css 変更のため必須
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
```

- [ ] **Step 7: コミット**

```bash
git add index.html detail.css money.css scratchpad/theme-floor-check.js
git commit -m "feat(theme-a): 12px床の全量適用（base＋@media同時書換）＋?円17px＋境界線色2クラス是正"
```

---

### Task 8: テーマA-3 グロー廃止＋日本語長文 sans 化（mono 奪回）

**Files:**
- Modify: `index.html:604`・`:453`／`detail.css:290`・`:589-591`・`:1017`＋末尾／`money.css` グロー各行＋`:1128`・`:1011`・`:1279`・`:1200-1201`・`:866` 直後＋末尾

**Interfaces:**
- Consumes: `--ix-sans`（Task 6）
- Produces: 廃止対象の text-shadow=none・免責/注記の font-family=var(--ix-sans)/letter-spacing:0/line-height:1.65

- [ ] **Step 1: グロー廃止（text-shadow 宣言を in-place 削除・**この列挙行に限定＝一括掃除禁止**）**

- index.html:604（.card-title）・:453（.safety-score-num）
- detail.css:290（.compare-title）・:589-591（.disc-chip .v.hot/.warm/.calm）・:1017（.ai-ins-headline の `text-shadow: 0 0 8px currentColor` のみ削除・color は残す）
- money.css: :822（.mcc-tab[aria-selected=true]）/:1125（.mcc-section-title）/:898-899（.mcc-sync-status 2行）/:952-962（.mcc-fold-*-nm 6種）/:994-995（.mcc-cf-stat strong）/:873,878,883（.mcc-hero-next 系 strong）/:1071（.mcc-sat-warn）/:1236（.mcc-ac-yen）/:1242（.mcc-ac-leg .pc）/:1244（.mcc-ac-center .big）/:1249-1251（.mcc-ac-driftrow .dv）
- **維持組（触らない）**: `.mcc-hero-power`（:864-866）・`.mcc-hero-ref-amount`（:853）
- money.css:866 の直後に継承遮断を追加:

```css
[data-theme="D"] #money-view .mcc-hero-power small { text-shadow: none; }
```

- [ ] **Step 2: mono 奪回4クラス（D層高特異性＝in-place 必須）**

1. money.css:1128 `.mcc-section-desc`: `font-family: var(--mcc-mono); letter-spacing: 0.2px;` → `font-family: var(--ix-sans); letter-spacing: 0; line-height: 1.65;`（color は据置）
2. money.css:1011 `.mcc-cf-note`: `{ font-family: var(--mcc-mono); }` → `{ font-family: var(--ix-sans); letter-spacing: 0; line-height: 1.65; }`
3. money.css:1279 `.mcc-nisa-gate,` の**1行だけを削除**（:1274-1280 の 7 セレクタグループから除去・他6の mono 維持。※recon themeA.md の「5クラス」は誤記＝spec §4.4 が正）
4. money.css:1200-1201 のグループから `.mcc-rm-note,` を除去（`.mcc-rm-timeline` の mono は維持）:

```css
[data-theme="D"] #money-view .mcc-rm-timeline { font-family: var(--mcc-mono); }
```

- [ ] **Step 3: 免責/注記グループの正式ルールを末尾追加**（theme-a:85-98 と同セレクタ集合）

detail.css 末尾（Task 4 で追加した .fin-pending-note の後）:

```css
      /* テーマA⑦: 日本語長文の sans 化（免責・説明文・用語定義） */
      .sig-disclaimer, .panel-disclaimer, .ht-disclaimer,
      .modal-text, .disc-note, .acc-desc, .acc-body .acc-full-desc,
      .sig-note, .ht-note, .subpanel-hint, .panel-desc-text-below,
      .term-help::after {
        font-family: var(--ix-sans);
        letter-spacing: 0;
        line-height: 1.65;
      }
```

money.css 末尾:

```css
/* テーマA⑦: 日本語長文の sans 化（money 系免責・注記・用語定義） */
.mcc-advice-disclaimer, .mcc-ac-disc, .mcc-nisa-gate,
.mcc-expense-note, .mcc-bucket-note, .mcc-hero-ref-note,
.mcc-cf-monthnote, .mcc-nisa-srcnote, .mcc-rm-note,
.mcc-guide-rule, .mcc-guide-privacy,
.mcc-glo-def, .mcc-glo-read, .mcc-help::after {
  font-family: var(--ix-sans);
  letter-spacing: 0;
  line-height: 1.65;
}
```

index.html の inline style 末尾（:1014 付近・detail.css 読込より前でも同特異性・後続ファイルなので問題なし。portal 系のみ）:

```css
      /* テーマA⑦: portal 側の日本語注記 sans 化 */
      .screening-note { font-family: var(--ix-sans); letter-spacing: 0; line-height: 1.65; }
```

- [ ] **Step 4: 検証（グロー0＋sans 化の機械確認を theme-floor-check.js に追加）**

`scratchpad/theme-floor-check.js` の円チェックの後に追加（列挙は theme-a-tuning.css から床リストと同じ方式で抽出）:

```js
  // ⑥グロー廃止: theme-a L49-81 の text-shadow:none 対象を実 DOM で確認
  const glowSels = [...css.matchAll(/^([^\/@{}]+?)\{\s*text-shadow:\s*none;/gm)]
    .flatMap((g) => g[1].split(",").map((s) => s.trim())).filter(Boolean)
    .filter((s) => !/\.mcc-hero-power small/.test(s));   // 遮断ルールは別検証
  for (const sel of glowSels) {
    const ts = await page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).textShadow : null; }, sel).catch(() => null);
    if (ts !== null && ts !== "none") fails.push(`${sel}: text-shadow=${ts}`);
  }
  // 維持組の過剰廃止検出（.mcc-hero-power は shadow を保持していること）
  const heroTs = await page.evaluate(() => { const el = document.querySelector(".mcc-hero-power"); return el ? getComputedStyle(el).textShadow : null; });
  if (heroTs === "none") fails.push(".mcc-hero-power: 維持すべき shadow が消えている（過剰廃止）");
  // ⑦sans 化: theme-a L85-106 のセレクタ群が system-ui を含むこと
  const sansM = css.match(/⑦ 日本語長文[\s\S]*?\*\/([\s\S]*?)\{\s*font-family:\s*var\(--ix-sans\)/);
  const sansSels = sansM[1].split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim()).filter(Boolean);
  for (const sel of sansSels) {
    const ff = await page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).fontFamily : null; }, sel).catch(() => null);
    if (ff !== null && !/system-ui/.test(ff)) fails.push(`${sel}: fontFamily=${ff.slice(0, 40)}`);
  }
```

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js         # ALL PASS（床+グロー+sans）
NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js               # money.css 変更のため必須
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare && NODE_PATH=/home/shugo/node_modules node scratchpad/f2-snapshot.js compare
```
Expected: 全 PASS・snapshot は意図 diff（textShadow/fontFamily）のみ→再 baseline。**維持組 .mcc-hero-power / .mcc-hero-ref-amount の shadow が残っている**ことも確認（過剰廃止の検出）。

- [ ] **Step 5: コミット**

```bash
git add index.html detail.css money.css scratchpad/theme-floor-check.js
git commit -m "feat(theme-a): 14px未満グロー廃止（維持組保存）＋日本語長文sans化（D層mono4クラスはin-place奪回）"
```

---

### Task 9: 単位純関数（pickUnit USD 億層＋fmtTickValue）

**Files:**
- Modify: `finance-rules.js:109-111`（USD 分岐）・fmtUnitValue（:130）直後に fmtTickValue 追加・exports に追加
- Test: `tests/finance-rules.test.js:104/:106/:119` 書換＋新規テスト追加

**Interfaces:**
- Produces: `FinanceRules.pickUnit`（USD: a≥1e6→兆・a≥100→**億**〔dec: a≥10000?0:1〕・else 百万＝JPY 鏡像・**JPY 分岐無改変**）／`FinanceRules.fmtTickValue(val, unit, ticks) -> string`（軸目盛専用・Task 10 が消費）

- [ ] **Step 1: 既存 USD テスト3アサートを書換＋fmtTickValue テストを追加（失敗する状態に）**

:104 → `assert.deepEqual(F.pickUnit(416161, "USD"), { div: 100, suffix: "億ドル", dec: 0 });`
:106 → `assert.deepEqual(F.pickUnit(500, "USD"), { div: 100, suffix: "億ドル", dec: 1 });`
:119 → `assert.equal(F.fmtUnitValue(416161, usdB), "4,162億ドル");`
（:105 兆ドル・JPY 系 :95-102/:111-117/:124-130・unitLabel :134-136 は**無改変＝JPY 不変の証明**）

末尾に追加:

```js
test("fmtTickValue: 軸目盛は目盛間隔から小数桁を動的算出（0.1兆×4連の重複と桁不揃いを同時に防ぐ）", () => {
  var t = { div: 1000000, suffix: "兆ドル", dec: 1 };
  var ticks = [{ value: 0 }, { value: 20000 }, { value: 40000 }];   // step=0.02兆
  assert.equal(F.fmtTickValue(20000, t, ticks), "0.02兆ドル");
  assert.equal(F.fmtTickValue(40000, t, ticks), "0.04兆ドル");
  assert.equal(F.fmtTickValue(0, t, ticks), "0");
  assert.equal(F.fmtTickValue(20000, t, null), "0.02兆ドル");        // ticks 無しは値単体で桁算出
  var oku = { div: 100, suffix: "億円", dec: 0 };
  var ticks2 = [{ value: 0 }, { value: 100000 }];                    // step=1000億
  assert.equal(F.fmtTickValue(100000, oku, ticks2), "1,000億円");    // dec0 保持・千区切り
  assert.equal(F.fmtTickValue(100000, null, ticks2), "100000");      // unit 無しは素通し
});
```

- [ ] **Step 2: 失敗を確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/finance-rules.test.js`
Expected: FAIL（pickUnit USD 旧挙動＋fmtTickValue 未定義）

- [ ] **Step 3: 実装**

pickUnit の USD 分岐（:109-111）を書換:

```js
    if (usd) {
      if (a >= 100) return { div: 100, suffix: "億" + cur, dec: a >= 10000 ? 0 : 1 }; // 1億=100百万（JPY鏡像・十億層廃止=spec §7.3）
      return { div: 1, suffix: "百万" + cur, dec: 0 };
    }
```

fmtUnitValue（:130）の直後に追加:

```js
  // 軸目盛専用の整形（spec §7.4）。datalabel 側は fmtUnitValue を使用＝**両者は必ず同じ向きに変更すること**。
  //  目盛間隔(step)から小数桁を動的算出し「0.1兆ドル×4連」重複と「0.02兆ドル」桁不揃いを同時に防ぐ。
  function fmtTickValue(val, unit, ticks) {
    var v = n(val);
    if (!unit) return String(v);
    if (v === 0) return "0";
    var step = (ticks && ticks.length > 1)
      ? Math.abs(ticks[1].value - ticks[0].value) / unit.div
      : Math.abs(v) / unit.div;
    var dec = step > 0 ? Math.max(unit.dec, Math.min(4, Math.ceil(-Math.log10(step)))) : unit.dec;
    var x = v / unit.div;
    if (parseFloat(x.toFixed(dec)) === 0) return "0";
    var s = dec === 0 ? Math.round(x).toLocaleString() : x.toFixed(dec);
    return s + unit.suffix;
  }
```

exports に `fmtTickValue: fmtTickValue,`（`fmtUnitValue: fmtUnitValue,` の直後）を追加。fmtUnitValue（:118-119 コメント）にも相互参照を1行追記: `//  軸目盛は fmtTickValue（下）＝変更時は両方を同じ向きに保つこと。`

- [ ] **Step 4: 全テスト pass 確認**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`
Expected: **335 pass/0 fail**（334＋新規1・書換3アサートも green）

- [ ] **Step 5: コミット**

```bash
git add finance-rules.js tests/finance-rules.test.js
git commit -m "feat(unit): pickUnit USD億層（JPY鏡像・十億層廃止）＋fmtTickValue（軸目盛の動的小数桁）"
```

---

### Task 10: チャート別単位への配線（pageUnit 全廃・単位バッジ・financialMaxAbs 削除）

**Files:**
- Modify: `detail-charts.js`（renderBSChart/renderPLChart/renderCFChart のシグネチャ・単位算出・formatter/軸 callback・setUnitBadge 新設・dead unitStr 3箇所削除）
- Modify: `detail.js`（:22 pageUnit 削除・:654-658 削除・:665 単位 span 削除・:788-792 呼出変更）
- Modify: `detail-rules.js`（financialMaxAbs :452-462 削除・exports :993 から除去）
- Modify: `detail.css` 末尾（.chart-unit-badge）
- Test: `tests/detail-rules.test.js`（financialMaxAbs テストブロック削除）
- Create: `scratchpad/unit-badge-verify.js`

**Interfaces:**
- Consumes: `FinanceRules.pickUnit`（USD 億層）・`FinanceRules.fmtTickValue`・`FinanceRules.unitLabel`
- Produces: `renderBSChart(fin)` / `renderPLChart(fin)` / `renderCFChart(fin)`（**pageUnit 引数廃止＝detail.js の呼出と同一コミットで変更**。片方だけ変えると fmtUnitValue が !unit で String(v) 素通し＝例外の出ない無言故障）。単位バッジ `#bs-title-unit-badge` / `#pl-title-unit-badge` / `#cf-title-unit-badge`（class `.chart-unit-badge`）。

- [ ] **Step 1: setUnitBadge を detail-charts.js に新設**（財務チャート節の冒頭・:706 付近）

```js
      // カードタイトル右端の単位バッジ（チャート別単位・冪等・spec §7.2）。injectTermHelp の data-term
      //  span と共存するため既存 child の後ろへ append し、2回目以降は textContent 差替のみ。
      function setUnitBadge(titleId, unit) {
        const title = document.getElementById(titleId);
        if (!title) return;
        const badgeId = titleId + "-unit-badge";
        let badge = document.getElementById(badgeId);
        if (!badge) {
          badge = document.createElement("span");
          badge.id = badgeId;
          badge.className = "chart-unit-badge";
          title.appendChild(badge);
        }
        badge.textContent = "単位: " + FinanceRules.unitLabel(unit);
      }
```

- [ ] **Step 2: renderBSChart のチャート内単位化**（:709-710・:715 直後・:885/:903）

```js
      function renderBSChart(fin) {                       // pageUnit 引数廃止
        const isMobile = window.innerWidth < 768;         // 旧:710 の dead unitStr は削除
        const totalAssets = FinanceRules.totalAssets(fin);
        const hasNegativeEquity = fin.net_assets < 0;
        const displayNetAssets = hasNegativeEquity ? 0 : fin.net_assets;
        // spec §7.1 D10: BS は stacked＝軸上限はスタック和。両スタック和の max で選層（JPY 単位層変化ゼロ）
        const currency = STOCK_DATA[currentTicker]?.currency;
        const bsAxisMax = Math.max(
          totalAssets,
          FinanceRules.n(fin.current_liabilities) + FinanceRules.n(fin.non_current_liabilities) + displayNetAssets
        );
        const unit = FinanceRules.pickUnit(bsAxisMax, currency);
        setUnitBadge("bs-title", unit);
```

formatter（:885）: `FinanceRules.fmtUnitValue(value, pageUnit)` → `FinanceRules.fmtUnitValue(value, unit)`
軸 callback（:903）: `callback: (v) => FinanceRules.fmtUnitValue(v, pageUnit)` → `callback: (v, i, ticks) => FinanceRules.fmtTickValue(v, unit, ticks)`

- [ ] **Step 3: renderPLChart 同型**（:994-995・plSteps :1007 の後・:1069/:1097）

```js
      function renderPLChart(fin) {                       // pageUnit 引数廃止・dead unitStr 削除
        const isMobile = window.innerWidth < 768;
        ...
        const plSteps = DetailRules.plSteps(fin);         // :1007 既存
        const currency = STOCK_DATA[currentTicker]?.currency;
        const plMax = Math.max(0, ...plSteps.map((s) => Math.abs(FinanceRules.n(s.val))));
        const unit = FinanceRules.pickUnit(plMax, currency);
        setUnitBadge("pl-title", unit);
```
:1069 `baseStr = FinanceRules.fmtUnitValue(value, unit)`・:1097 軸 → `(v, i, ticks) => FinanceRules.fmtTickValue(v, unit, ticks)`

- [ ] **Step 4: renderCFChart 同型**（:1107-1108・:1156 の destructure に maxCfScale 追加・:1211/:1228）

```js
      function renderCFChart(fin) {                       // pageUnit 引数廃止・dead unitStr 削除
        ...
        const { waterfallData, cfLabels, cfSpecs, cfDiffs, cfLastIdx, maxCfScale } = DetailRules.cfWaterfall(fin);
        const currency = STOCK_DATA[currentTicker]?.currency;
        const unit = FinanceRules.pickUnit(maxCfScale, currency);   // 累積水準込み＝軸レンジと同義（spec §7.1）
        setUnitBadge("cf-title", unit);
```
:1211 `FinanceRules.fmtUnitValue(diff, unit)`・:1228 軸 → `(v, i, ticks) => FinanceRules.fmtTickValue(v, unit, ticks)`

- [ ] **Step 5: detail.js 側の全廃（同一コミット必須）**

- :22 `let pageUnit = null;` 行を削除
- :654-658（`// Batch C:` コメント2行＋`const _maxAbs`＋`pageUnit =`＋`const unitLabel =`）を削除
- :665 の単位 span 行（`<span style="font-size:12px;color:#8ba2af;margin-left:4px;">単位: ${unitLabel}</span>`）をテンプレから削除（ETF の「単位: 百万円」無意味表示も解消・spec §11 D5）
- :788 コメント行（cross-module state seam）を削除し、:789/791/792 を `DetailCharts.renderBSChart(fin);` / `DetailCharts.renderPLChart(fin);` / `DetailCharts.renderCFChart(fin);` へ

- [ ] **Step 6: financialMaxAbs 削除（spec §11 D6）**

- detail-rules.js :452-462（コメント含む）を削除・exports（:993）から `financialMaxAbs, ` を除去
- tests/detail-rules.test.js の financialMaxAbs テストブロック（:74-83・`financialMaxAbs` を含む test() 1個）を削除

- [ ] **Step 7: detail.css 末尾に単位バッジのスタイル**

```css
      /* チャート別単位バッジ（spec §7.2・12px床/テーマA整合） */
      .chart-unit-badge { margin-left: 10px; font-size: 12px; color: var(--ix-text-dim); letter-spacing: 0.5px; text-transform: none; }
```

- [ ] **Step 8: node テスト（削除分の減算確認）**

Run: `NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js`
Expected: **334 pass/0 fail**（335−financialMaxAbs 1）

- [ ] **Step 9: Playwright 受入**（`scratchpad/unit-badge-verify.js`）

```js
// 修正③ 受入: 単位バッジ3枚・BS単位層不変(D10)・ヘッダ単位削除・冪等（spec §7）
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  const open = async (t) => { await page.evaluate((tk) => navigateToDetail(tk), t); await page.waitForTimeout(800); };
  const badge = (id) => page.evaluate((i) => document.getElementById(i)?.textContent || null, id);

  await open("7203.T");
  for (const id of ["bs-title-unit-badge", "pl-title-unit-badge", "cf-title-unit-badge"]) {
    check(`${id} が存在し「単位:」表示`, /単位:/.test(await badge(id)));
  }
  // 自己整合: バッジ = unitLabel(pickUnit(各チャート母集合))
  const consistent = await page.evaluate(() => {
    const fin = Object.entries(STOCK_DATA["7203.T"].financials_trend)
      .filter(([, f]) => FinanceRules.hasFinSubstance(f))
      .sort(([a], [b]) => b - a)[0][1];
    const cur = STOCK_DATA["7203.T"].currency;
    const dna = fin.net_assets < 0 ? 0 : fin.net_assets;
    const bsMax = Math.max(FinanceRules.totalAssets(fin),
      FinanceRules.n(fin.current_liabilities) + FinanceRules.n(fin.non_current_liabilities) + dna);
    return document.getElementById("bs-title-unit-badge").textContent === "単位: " + FinanceRules.unitLabel(FinanceRules.pickUnit(bsMax, cur));
  });
  check("BSバッジ＝両スタック和max由来（自己整合）", consistent);
  // D10 回帰: 7741.T（総資産1.23兆・最大セグメント<1兆）は兆円のまま
  await open("7741.T");
  check("7741.T BS=兆円（5値maxなら億円に降格＝D10回帰検知）", /兆円/.test(await badge("bs-title-unit-badge")));
  // USD 億層
  await open("BRK-B");
  const brkPl = await badge("pl-title-unit-badge");
  check("BRK-B: 十億ドル表記が消滅", !/十億/.test(brkPl));
  // ヘッダ「単位:」削除
  const header = await page.evaluate(() => document.getElementById("active-company-header").textContent);
  check("ヘッダから「単位:」削除", !/単位:/.test(header));
  // 冪等（年切替2回でバッジ重複なし）
  await open("7203.T");
  await page.evaluate(() => { [...document.querySelectorAll(".time-btn")][0].click(); });
  await page.waitForTimeout(500);
  const badgeCount = await page.evaluate(() => document.querySelectorAll("#bs-title .chart-unit-badge").length);
  check("バッジ冪等（1個のみ）", badgeCount === 1);
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/unit-badge-verify.js` → ALL PASS

- [ ] **Step 10: snapshot 検分＋コミット**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare  # domHash 意図diff（ヘッダspan削除+バッジ追加）→capture
git add detail-charts.js detail.js detail-rules.js detail.css tests/detail-rules.test.js scratchpad/unit-badge-verify.js
git commit -m "feat(unit): チャート別単位（pageUnit全廃・BS=両スタック和max・単位バッジ・fmtTickValue軸）＋financialMaxAbs削除"
```

---

### Task 11: S/R 窓統一＋A-mini（軸ラベル上位2本/側）

**Files:**
- Modify: `detail-charts.js:226-238`（A-mini）・`:508`・`:244`
- Modify: `detail-rules.js:706-707`（stale コメント事実化）
- Create: `scratchpad/sr-window-verify.js`

**Interfaces:**
- Consumes: `detectSR`（無改変・決定論）・`currentDisplayPrices`（closure・:511 で更新）
- Produces: チャート S/R＝displayPrices 基準（digest と同一入力＝数値一致）・軸ラベルは各側 index<2 のみ

- [ ] **Step 1: 窓統一（2口同時・片方だけは状態依存不整合を生むため禁止）**

:508 → `applySRLines(displayPrices);   // spec §6.1: S/R は表示窓基準（MA/BB/KC の base は不可侵）`
:244 → `if (data) applySRLines(currentDisplayPrices || data.prices);`（:243 の `const data = STOCK_DATA[currentTicker];` は維持。引数渡し＝:511 の代入順序罠を回避）

- [ ] **Step 2: A-mini**（:227-238 の 2 つの forEach をインデックス付きに）

```js
        resistance.forEach(({ price, count }, i) => {
          srLines.push(candleSeries.createPriceLine({
            price, color: "rgba(255,102,153,0.85)", lineWidth: 1,
            lineStyle: 2, axisLabelVisible: i < 2, title: `R×${count}`,   // A-mini: 軸ラベル上位2本/側（線は全本維持）
          }));
        });
        support.forEach(({ price, count }, i) => {
          srLines.push(candleSeries.createPriceLine({
            price, color: "rgba(52,245,207,0.85)", lineWidth: 1,
            lineStyle: 2, axisLabelVisible: i < 2, title: `S×${count}`,
          }));
        });
```
（detectSR の戻りは count 降順ソート済＝再ソート不要）

- [ ] **Step 3: stale コメント事実化**（detail-rules.js:706-707）

```js
    // 5) S/R 最寄り（表示期間 dp から算出。チャート側 S/R 線も displayPrices 基準＝入力同一で数値整合
    //    〔spec §6.1 窓統一済〕／全クラスタを close で上下分割し価格差最小を選ぶ＝top-3 外も対象[M7]）
```

- [ ] **Step 4: 機械ゲート**（`scratchpad/sr-window-verify.js`。LWC の priceLine は closure 私有で読めず window API 追加は禁止（windowApi 16 gate）のため、①純関数の入力同一性＝過年度 FY 窓で S/R レベルが窓レンジ内に収まること（監査B 症状の解消定義）②コード同一性＝2 呼出口の source assert、で判定）

```js
// 修正② 受入: S/R 窓統一（レベルが表示窓レンジ内・digest と同一入力）＋ A-mini source assert
const { chromium } = require("playwright");
const fs = require("fs");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  // ① コード同一性: 呼出口2つが displayPrices 系・axisLabelVisible が index ゲート
  const src = fs.readFileSync("detail-charts.js", "utf8");
  check("chart 側呼出が displayPrices", /applySRLines\(displayPrices\)/.test(src));
  check("toggleSR が currentDisplayPrices フォールバック", /applySRLines\(currentDisplayPrices \|\| data\.prices\)/.test(src));
  check("A-mini: axisLabelVisible: i < 2", (src.match(/axisLabelVisible: i < 2/g) || []).length === 2);
  check("MA/BB/KC base 不可侵", /const base = allPrices && allPrices\.length >= 75 \? allPrices : displayPrices;/.test(src));
  // ② 機能: 過年度 FY 窓で S/R が窓レンジ内（監査B の逆転・レンジ外れの解消定義）
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  for (const [t, yr, isUS] of [["7203.T", 2024, false], ["8306.T", 2024, false], ["NVDA", 2024, true]]) {
    const r = await page.evaluate(([tk, y, us]) => {
      const prices = STOCK_DATA[tk].prices;
      const { displayPrices } = DetailRules.priceWindow(prices, y, us);
      const sr = DetailRules.detectSR(displayPrices);          // 修正後のチャート入力と同一
      const srFull = DetailRules.detectSR(displayPrices, Infinity); // digest 入力
      const lows = displayPrices.map((p) => p.low), highs = displayPrices.map((p) => p.high);
      const lo = Math.min(...lows), hi = Math.max(...highs);
      const levels = sr.resistance.concat(sr.support).map((x) => x.price);
      const inRange = levels.every((p) => p >= lo * 0.985 && p <= hi * 1.015); // クラスタ平均±1.5%帯ぶんの許容
      const subset = sr.resistance.every((c) => srFull.resistance.some((f) => f.price === c.price))
        && sr.support.every((c) => srFull.support.some((f) => f.price === c.price));
      return { n: levels.length, inRange, subset };
    }, [t, yr, isUS]);
    check(`${t} FY${yr}: S/R ${r.n}本すべて窓レンジ内`, r.inRange);
    check(`${t} FY${yr}: chart top-3 ⊆ digest 全クラスタ（同一入力の決定論）`, r.subset);
  }
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/sr-window-verify.js` → ALL PASS

- [ ] **Step 5: 回帰スイート＋コミット**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js                 # 334（detectSR 無改変）
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js       # pageerror 0
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare  # 層1不変（canvas 内容は非比較）
git add detail-charts.js detail-rules.js scratchpad/sr-window-verify.js
git commit -m "fix(sr): S/R をチャート/digest 共に displayPrices 基準へ窓統一（2口同時）＋A-mini 軸ラベル上位2本/側"
```

---

### Task 12: BS 吹き出しコア（低棒判定・side-aware padding・anchor/align/offset）

**Files:**
- Modify: `detail-charts.js`（:715 直後に低棒判定・:801 padding・:841-854 anchor・:855-868 align・:870-879 offset）

**Interfaces:**
- Consumes: Task 10 の renderBSChart 冒頭（totalAssets/displayNetAssets/unit）
- Produces: `LOW`/`lowLeft`/`lowRight`/`CALLOUT_PAD`（Task 13 の lowIndices/stagger が同判定を消費）。align/offset は Task 13 で stagger 対応の最終形に置換される（本タスクの形は中間形）。

- [ ] **Step 1: 低棒判定と CALLOUT_PAD**（Task 10 で入れた `const unit = ...; setUnitBadge(...)` の直後に追加）

```js
        // spec §8.1: 低棒判定と side-aware パディング（totalAssets>0 ガード＝P1 全ゼロ年の NaN 防御の二重化）
        const LOW = 0.12;
        const lowLeft  = totalAssets > 0 && [fin.current_assets, fin.non_current_assets].some(v => v > 0 && v / totalAssets < LOW);
        const lowRight = totalAssets > 0 && [fin.current_liabilities, fin.non_current_liabilities, displayNetAssets].some(v => v > 0 && v / totalAssets < LOW);
        const hostW = document.getElementById("bsChart").parentElement.clientWidth || 880;
        const CALLOUT_PAD = Math.min(140, Math.max(126, Math.round(hostW * 0.16)));   // frame実測max112.6+gap12+余裕
```

- [ ] **Step 2: layout.padding**（:801。**モバイル arm 不変**・Chart.js の layout.padding はスクリプタブル不可＝render 時に数値化して渡す）

```js
            layout: { padding: isMobile ? { left: 4, right: 4, top: 10, bottom: 4 } : { left: lowLeft ? CALLOUT_PAD : 8, right: lowRight ? CALLOUT_PAD : 16, top: 65, bottom: 20 } },
```

- [ ] **Step 3: anchor を "center" 統一**（:841-854 の関数全体を置換）

```js
                // spec §8.2: 旧 :849 'end'/:850 'start'/:851 不正値('left'/'right'→center fallback) を全廃。
                //  :849/:850 の center 化は横逃がし(align/offset)とセットの意図変更＝anchor 単独の先行コミット不可。
                anchor: "center",
```

- [ ] **Step 4: align 横逃がし**（:855-868 を置換・Task 13 で stagger 対応版に更新される中間形）

```js
                align: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (val === 0) return "center";
                  if (totalAssets > 0 && val / totalAssets < LOW) {
                    // 低棒は全科目 横逃がし（左列=left/右列=right・旧 'top'/'bottom' 廃止＝上空浮遊も解消）
                    return context.dataIndex === 0 ? "left" : "right";
                  }
                  return "center";
                },
```

- [ ] **Step 5: offset**（:870-879 を置換・左列は y 軸幅加算＝spec §11 D12）

```js
                offset: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (totalAssets > 0 && val > 0 && val / totalAssets < LOW) {
                    const ca = context.chart.chartArea;
                    let horiz = (ca ? ca.width / 4 : 132) + 12;   // frame縁=バー端+12px（幾何恒等・spec §8.2）
                    if (context.dataIndex === 0) horiz += (context.chart.scales.y?.width || 72);  // 左列: 軸目盛を覆わない
                    return horiz;
                  }
                  return 0;
                },
```

- [ ] **Step 6: スモーク（詳細受入は Task 14）**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare  # 層1不変・chartContainerDims 意図diff検分
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js       # pageerror 0
```

- [ ] **Step 7: コミット**

```bash
git add detail-charts.js
git commit -m "feat(bs): 低棒side-aware動的パディング＋anchor center統一＋全科目横逃がし＋offset幾何恒等（左列は軸幅加算）"
```

---

### Task 13: bsLeaderPlugin（リード線）＋同側低棒 stagger

**Files:**
- Modify: `detail-charts.js`（:128 直後に bsLeaderPlugin・renderBSChart に lowIndices/staggerByKey・align/offset を最終形へ・:909 直後に $bsLeaders）

**Interfaces:**
- Consumes: Task 12 の LOW/lowLeft/lowRight・datalabels 内部 API `$datalabels[0].$layout._box._rect`（**SRI pin v2.2.0 の間のみ安定・プラグイン更新時は再確認**＝壊れても gate no-op でエラーは出ない）
- Produces: `chart.$bsLeaders = [{di, bi}]`（他チャートは未設定＝no-op・neonGlow と同じ gate 方式）

- [ ] **Step 1: bsLeaderPlugin を登録**（:128 `Chart.register(neonGlowPlugin);` の直後。登録順=ChartDataLabels(index.html:1602)→neonGlow→bsLeader＝afterDatasetsDraw がラベル描画・_box 更新後に走る）

```js
      // BS 低棒吹き出しのリード線（spec §8.3）。chart.$bsLeaders 設定時のみ動作（neonGlow と同じ gate 方式）。
      //  ⚠ $datalabels/$layout._box._rect は datalabels 非公開内部 API＝SRI pin v2.2.0 固定の間のみ安定。
      //   プラグイン更新時は本プラグインの動作再確認必須（壊れても gate no-op でリード線が無言で消えるだけ）。
      const bsLeaderPlugin = { id: "bsLeader", afterDatasetsDraw(chart) {
        const specs = chart.$bsLeaders; if (!specs) return;
        const c = chart.ctx; c.save();
        specs.forEach(({ di, bi }) => {
          const el = chart.getDatasetMeta(di).data[bi]; if (!el) return;
          const lab = (el.$datalabels || [])[0]; if (!lab || !lab.$layout || !lab.$layout._visible) return;
          const r = lab.$layout._box._rect;                 // 絶対座標 frame
          const p = el.getProps(["x", "y", "base"]);        // live 値（final=true 不可＝アニメ中ラベルは live el 追従）
          const segY = (p.y + p.base) / 2;
          const fromX = r.x + r.w / 2 < p.x ? r.x + r.w : r.x;   // チップのセグメント側縁
          c.strokeStyle = "rgba(0,229,255,0.55)"; c.lineWidth = 1;
          c.beginPath(); c.moveTo(fromX, r.y + r.h / 2); c.lineTo(p.x, segY); c.stroke();
        });
        c.restore();
      } };
      Chart.register(bsLeaderPlugin);
```

- [ ] **Step 2: lowIndices と stagger テーブルを renderBSChart に追加**（Task 12 の CALLOUT_PAD の直後）

```js
        // spec §8.3: リード線対象（低棒のみ）。bi は datasets data 配列の実バー位置＝
        //  負債/純資産系 data=[0,v]→bi=1・資産系 data=[v,0]→bi=0（取り違えると value=0 バーを引き
        //  formatter null→_visible=false で gate が黙って skip＝リード線が無言で欠ける）。
        const lowIndices = [
          [0, displayNetAssets, 1],            // 純資産→調達源泉列
          [1, fin.non_current_liabilities, 1], // 固定負債→調達源泉列
          [2, fin.current_liabilities, 1],     // 流動負債→調達源泉列
          [3, fin.non_current_assets, 0],      // 固定資産→運用形態列
          [4, fin.current_assets, 0],          // 流動資産→運用形態列
        ].filter(([, v]) => totalAssets > 0 && v > 0 && v / totalAssets < LOW)
         .map(([di, , bi]) => ({ di, bi }));
        // spec §8.4: 同側低棒2つ以上は2本目以降を角度 align で分離（θ<45°・offset は /cosθ 補正で
        //  「バー端+12px」の水平クリアランスを保存）。※縦距離<50px 条件は render 前に画素距離が
        //  取れないため「同側2本目以降は常に stagger」の保守的上位集合で運用（受入は rect 交差 0 で判定）。
        const STAGGER_DEG = 18;
        const staggerByKey = {};   // "di:bi" -> { deg, factor }
        [0, 1].forEach((bi) => {
          lowIndices.filter((s) => s.bi === bi).forEach((s, k) => {
            if (k === 0) return;
            const dev = STAGGER_DEG * k;                       // 水平からの偏角（<45°）
            const deg = bi === 0 ? 180 - dev : dev;            // 左列=180°基準/右列=0°基準から下向き成分
            staggerByKey[s.di + ":" + s.bi] = { deg: deg, factor: 1 / Math.cos(dev * Math.PI / 180) };
          });
        });
```

- [ ] **Step 3: align/offset を stagger 対応の最終形へ**（Task 12 の中間形を置換）

```js
                align: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (val === 0) return "center";
                  if (totalAssets > 0 && val / totalAssets < LOW) {
                    const st = staggerByKey[context.datasetIndex + ":" + context.dataIndex];
                    if (st) return st.deg;                     // 角度 align（datalabels は数値=時計回り度を受ける）
                    return context.dataIndex === 0 ? "left" : "right";
                  }
                  return "center";
                },
                offset: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (totalAssets > 0 && val > 0 && val / totalAssets < LOW) {
                    const ca = context.chart.chartArea;
                    let horiz = (ca ? ca.width / 4 : 132) + 12;
                    if (context.dataIndex === 0) horiz += (context.chart.scales.y?.width || 72);
                    const st = staggerByKey[context.datasetIndex + ":" + context.dataIndex];
                    return st ? horiz * st.factor : horiz;     // 角度時は /cosθ 補正（spec §8.4・食い込み防止）
                  }
                  return 0;
                },
```

- [ ] **Step 4: $bsLeaders を設定**（:909 `bsChartInstance.$neonSpecs = ...` の直後）

```js
        bsChartInstance.$bsLeaders = lowIndices;
```

- [ ] **Step 5: スモーク＋コミット**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js       # pageerror 0
git add detail-charts.js
git commit -m "feat(bs): bsLeaderPlugin リード線（\$bsLeaders gate）＋同側低棒の角度 stagger（offset /cosθ 補正）"
```

---

### Task 14: BS 吹き出しの数値アサート受入（監査再現）

**Files:**
- Create: `scratchpad/bs-callout-verify.js`

**Interfaces:**
- Consumes: `Chart.getChart(canvas)`（Chart.js v4 静的 API・window 公開面の追加なし）・`$datalabels[0].$layout._box._rect`

- [ ] **Step 1: 受入スクリプト作成**（spec §9.2 の数値アサート＝クリップ0/相互重なり0/y軸帯重なり0/バー交差0）

```js
// 修正④⑤ 受入: 代表銘柄×幅で吹き出し矩形を実測（監査 2026-08-09 と同手法・spec §9.2）
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
const X = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
(async () => {
  const browser = await chromium.launch();
  for (const width of [1440, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
    for (const t of ["6758.T", "8306.T", "7203.T", "4755.T", "NVDA", "BRK-B"]) {
      await page.evaluate((tk) => navigateToDetail(tk), t);
      await page.waitForTimeout(2000);   // アニメ1500ms 完了後に実測
      const r = await page.evaluate(() => {
        const chart = Chart.getChart(document.getElementById("bsChart"));
        if (!chart) return null;
        const ca = chart.chartArea;
        const cw = chart.canvas.width / (window.devicePixelRatio || 1);
        const ch = chart.canvas.height / (window.devicePixelRatio || 1);
        const axisBand = { x: ca.left - chart.scales.y.width, y: ca.top, w: chart.scales.y.width, h: ca.bottom - ca.top };
        const chips = [], bars = [];
        (chart.$bsLeaders || []).forEach(({ di, bi }) => {
          const el = chart.getDatasetMeta(di).data[bi];
          const lab = el && (el.$datalabels || [])[0];
          if (!lab || !lab.$layout || !lab.$layout._visible) return;
          const rc = lab.$layout._box._rect;
          chips.push({ x: rc.x, y: rc.y, w: rc.w, h: rc.h });
          const half = ca.width / 4;
          const p = el.getProps(["x", "y", "base"]);
          bars.push({ x: p.x - half, y: Math.min(p.y, p.base), w: half * 2, h: Math.abs(p.base - p.y) });
        });
        return { cw, ch, axisBand, chips, bars, leaders: (chart.$bsLeaders || []).length };
      });
      if (!r) { check(`${t}@${width}: chart 取得`, false); continue; }
      const clip = r.chips.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= r.cw && c.y + c.h <= r.ch);
      check(`${t}@${width}: チップのcanvas外クリップ 0（${r.chips.length}枚）`, clip);
      let overlap = false, axisHit = false, barHit = false;
      for (let i = 0; i < r.chips.length; i++) {
        if (X(r.chips[i], r.axisBand)) axisHit = true;
        for (let j = i + 1; j < r.chips.length; j++) if (X(r.chips[i], r.chips[j])) overlap = true;
        for (const b of r.bars) if (X(r.chips[i], b)) barHit = true;
      }
      check(`${t}@${width}: チップ相互重なり 0`, !overlap);
      check(`${t}@${width}: チップ×y軸目盛帯の重なり 0`, !axisHit);
      check(`${t}@${width}: チップ×バー矩形の交差 0`, !barHit);
    }
    // ETF: bsChart 不描画
    await page.evaluate(() => navigateToDetail("SPY"));
    await page.waitForTimeout(800);
    check(`SPY@${width}: BSカード非表示（ETF非影響）`, await page.evaluate(() => getComputedStyle(document.getElementById("bs-title").closest(".card")).display === "none"));
    check(`pageerror 0 @${width}`, errors.length === 0);
    await page.close();
  }
  // モバイル: 低棒ラベル自体が非表示＝新分岐不到達（padding モバイル arm 不変）
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await page.evaluate(() => navigateToDetail("6758.T"));
  await page.waitForTimeout(2000);
  const mob = await page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById("bsChart"));
    return chart ? chart.options.layout.padding.left : null;
  });
  check("モバイル: padding arm 不変（left=4）", mob === 4);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
```

- [ ] **Step 2: 実行**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js`
Expected: **ALL PASS**（fail した場合＝stagger 角度 STAGGER_DEG を代表銘柄で実測調整（θ<45° 内）し Task 13 の値を更新→再実行）

- [ ] **Step 3: コミット**

```bash
git add scratchpad/bs-callout-verify.js
git commit -m "test(bs): 吹き出し矩形の数値アサート受入（クリップ/相互/軸帯/バー交差=0・監査再現手法）"
```

---

### Task 15: 統合ハードニング（全スイート・最終 baseline・本番 Neon 確認・記憶整理）

**Files:**
- Modify: `.superpowers/sdd/progress.md`（総括）・spec（実装差分メモ追記）・Obsidian 所有ノート（§12 リスト転記）

- [ ] **Step 1: 全スイート一括**

```bash
NODE_PATH=/home/shugo/node_modules node --test tests/*.test.js                # 334 pass/0 fail
PYTHONPATH=$PWD /home/shugo/apps/investment-portal/.venv/bin/pytest tests/ -q # 228 passed（Python 無改変の証明）
NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js             # money.css 変更のため必須
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js      # 9 assert
NODE_PATH=/home/shugo/node_modules node scratchpad/smoke-zigzag-range.js
NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-portal-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js && NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js 375
NODE_PATH=/home/shugo/node_modules node scratchpad/sr-window-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/unit-badge-verify.js
NODE_PATH=/home/shugo/node_modules node scratchpad/bs-callout-verify.js
```
Expected: 全部 green。

- [ ] **Step 2: 最終 re-baseline→MATCH**

```bash
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js capture
NODE_PATH=/home/shugo/node_modules node scratchpad/detail-snapshot.js compare   # -> ✅ MATCH
NODE_PATH=/home/shugo/node_modules node scratchpad/f2-snapshot.js capture
NODE_PATH=/home/shugo/node_modules node scratchpad/f2-snapshot.js compare       # -> MATCH
```

- [ ] **Step 3: 本番 Neon の全ゼロ行存在確認**（spec §5.5 完了判定・読み取りのみ）

```bash
curl -s "https://strategic-investment-portal.vercel.app/api/market/financials?ticker=6861.T" | python3 -m json.tool | head -40
```
Expected: FY2026 行が値 0 のオブジェクトとして配信されている（ローカル SQLite と同系譜＝フロント防御が本番でも作動する前提の裏取り）。※もし本番に全ゼロ行が無ければ「表示側防御は将来の ETL 再実行への恒久ガード」として ledger に記録し完了扱い。

- [ ] **Step 4: 記憶整理（本人指示・spec §12）**

- spec 末尾に「## 14. 実装差分メモ」節を追記（plan からの逸脱・stagger の「常時 stagger」保守的上位集合・STAGGER_DEG 実測値・その他実装で確定した点）。
- **Obsidian `Projects/investment-portal.md` 🎨UIUX刷新スレッド節へ spec §12 の次 wave リスト本体を転記**（ポインタでなく本体＝worktree 片付け後も辿れるように）。
- `.superpowers/sdd/progress.md` に総括（全 Task 状態・テスト数・受入結果）。

- [ ] **Step 5: コミット（docs のみ）**

```bash
git add docs/superpowers/specs/2026-08-20-theme-a-chart-fixes-design.md
git commit -m "docs(spec): 実装差分メモ追記（テーマA+チャート修正wave 実装完了時点）"
```

- [ ] **Step 6: 完了報告**（merge/push は本人承認後＝別セッションの統合手順。**push しない**。本人実機サニティ項目＝spec §10 の5点を報告に明記）

---

## Self-Review（plan 執筆時に実施済み）

- **Spec coverage**: §4（Task 6/7/8）・§5（Task 1/2/3/4/5）・§6（Task 11）・§7（Task 9/10）・§8（Task 12/13/14）・§9（Task 0＋各タスク検証＋Task 15）・§11 D1-D12（D3/D4=Task 5 のフィルタ&CSV据置・D5/D6=Task 10・D10=Task 10・D11=Task 10・D12=Task 12）・§12（Task 15 転記）。
- **逸脱1件（明示）**: spec §8.4 の「縦距離<50px のペアに stagger」は render 前に画素距離が取れないため「**同側2本目以降は常に stagger**」の保守的上位集合で実装（受入は rect 交差 0 アサートで担保・Task 15 で spec 実装差分メモに記録）。
- **Type consistency**: `hasFinSubstance`（Task 1 定義→2/3/4/5 消費）・`fmtTickValue(val, unit, ticks)`（9→10）・`renderBSChart(fin)`（10 で変更→12/13 は同関数内）・`lowIndices`/`staggerByKey`/`$bsLeaders`（12→13→14）・バッジ id `bs-title-unit-badge` 形式（10→verify）で一貫。
- **テスト数の推移**: 331 → T1: 332 → T2: 333 → T3: 334 → T9: 335 → T10: 334（financialMaxAbs 削除）＝最終 334。
