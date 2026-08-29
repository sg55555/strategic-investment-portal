# W3.5「月次パック」設計 — 予算 vs 実績（今月の消化）／マンスリーレポート

- 日付: 2026-08-29
- ブランチ: `worktree-w35-monthly-pack`（worktree `.claude/worktrees/w35-monthly-pack`・base `39e51f5`＝W3 本番LIVE）
- 前提スレッド: UIUX刷新（W1 → W1.5 → W2 → W3 に続く W3.5。2026-08-09 に本人が選定した「機能第1弾」の司令室PFM束のうち、W3 D2 で送った残り2点）
- 所有ノート: Obsidian `Projects/investment-portal.md`「🎨 UIUX刷新スレッド」／司令室の権威ノート `Projects/wealth-cockpit-v2.md`
- 前 wave の spec: `docs/superpowers/specs/2026-08-27-w3-cockpit-pfm-design.md`（§3.2 `assetSeries`・§6 置き場のモック比較・§11 申し送り）

---

## §1 目的とスコープ

お金の司令室（`#money-view`・`money.js` が `#mcc-root` に描画）に「**今月いくら使ってよくて、いま何%使ったか**」と
「**先月はどうだったか**」を入れる。W3 で時間軸（推移・前月比・見通し・期限）は入ったが、**支出の意図（予算）**と
**月ごとの振り返り（レポート）**が無い。kakeibo は日々のフローの記録、司令室は意図した配分の管理（低頻度・熟慮）という
既存の役割分担（`Projects/wealth-cockpit-v2.md` Slice4.5）に沿い、予算＝「意図」を司令室に置き、実績＝kakeibo 由来の
`cashflow_snapshots` から毎回導出する。

入れるもの（2点・W3 D2 の送り分）:

1. **予算 vs 実績** — kakeibo の費目そのままの月額予算（＋合計）を state に持ち、進行中の月の消化率を
   ダッシュボードの fold「今月の予算」に出す。バーには「今日の位置」（月の経過率）の目盛線を重ねる。
2. **マンスリーレポート** — 月を選んで（既定＝最新の確定月）その月の収入/支出/収支/貯蓄率・前月比/前年同月比・
   費目・予算 vs 実績・資産増減（W3 `assetSeries` の同月点）を1画面で読む。置き場は §6（モック実物比較で決定）。

### 非目標（YAGNI）

- **予算のバケツ化**（費目をまとめる対応表）→ 本人裁定で不採用（2026-08-29・費目そのまま＝D1）。必要になったら後付け。
- **予算の月別履歴**（「7月の予算」「8月の予算」を別に持つ）→ 不採用（D3）。予算は現在値1本。
- **AI コーチ facts の拡張**。`modeAFacts`／`advice.py`／`tests/fixtures/advice_facts_cases.json`／`FACTS_SCHEMA_VERSION`（=6）は
  **非接触**（D2）。予算を AI に渡すのは将来 wave（その時に鏡像化・coarsen 設計・SCHEMA_VERSION 7）。
- **ETL／DB／新 Vercel 関数**（**11/12 を維持**）。kakeibo への書き戻し・通知・PDF 出力。
- **レポートの「投資余力」再計算**（過去月時点の平滑値は持たない＝現在の `monthlySurplus` は収支 fold の領分）。
- 既存 `assetSeries`／`cashDerived`／`cashflowDerived`／`effectiveState`／`nisaViewModel`／`goalProgress` の**改変**
  （すべて読むだけ）。

## §2 決定（本人承認済み・2026-08-29）

- **D1 予算＝kakeibo 費目そのまま＋合計**（案A・本人選択）。`budgets = { total, items:[{name, amount}] }`。対応表なし。
  代替案 B（予算バケツ＋対応表）は schema・UI・未割当費目の扱いが増える、C（固定/変動/総支出の3本）は「どの費目で使い
  すぎたか」が見えないため不採用。
- **D2 facts 非出力・鏡像なし**。`budgets` は UI 専用。**機械確認**＝`budgets` 入り state と無しの state で `modeAFacts` の
  出力が deepEqual（§10.1）。`advice.py _migrate` は `raw.get` 方式で未知キーを無視するため無改変。
- **D3 予算は現在値 1 本**。過去月のレポートは「現在の予算で比較しています」と明記。
- **D4 実績の源＝ETL 見出し列（`total_expense`/`fixed_expense`/`variable_expense`）＋ `breakdown.categories`**。
  進行中行（`is_complete=false`・ETL 日次 `0 21 * * *`）も使う＝「今月の消化」は毎朝更新される。
- **D5 月次レポートは月を選べる**（◀ ▶・既定＝最新の確定月・進行中月は「暫定（進行中）」）。選択月は `money.js` の
  モジュール変数 `_reportPeriod`（localStorage にも cloud state にも入れない・リロードで最新へ戻る）。
- **D6 レポートは「その月の事実」のみ**。NISA・目標は月に紐づかない「現在地」なので**最新の確定月を表示中のみ**、
  既存 VM（`nisaViewModel`／`viewModel().goals`）をそのまま読む「現在地」ブロックを出す（新規 math なし）。
- **D7 文言は事実＋数値のみ**（W3 D9 と同じ）。「超過 ¥X」「残り ¥X」「月の 94% 経過・消化 93%」は出す。
  「節約しましょう」「使いすぎ」「見直しましょう」等の指示・評価語は**新設部分に一切入れない**（§7・受入で機械確認）。
- **D8 暦は既存どおり UTC**（`nisaNow`／`monthsBetweenYM` と同じ）。経過率の分母は既存 `_daysInMonth`。
  月末深夜（JST 0〜9時）は月がずれ得る＝既存と同じ既知事項。
- **D9 レポートの置き場＝案A「3 タブ目」**（モック実物比較・本人選定 2026-08-29・§6）。タブ順は 01 ダッシュボード／02 月次レポート／
  03 設定・ガイド。≤600px は番号を消し短いラベル（ダッシュボード／レポート／設定）で 1 行に収める（wrap も横スクロールもしない）。
- **D10 合計予算は別フィールド `budgets.total`**（本人選択）。既存「月の生活費」（`monthlyExpense`＝バッファ目標の基準＝
  守るべき必要生活費）は流用しない（臨時込みの実支出が常に超過して見え、バーが恒常的に赤になる）。

## §3 データモデル

### 3.1 state（`money-rules.js defaultState`／`migrate`）

```js
budgets: {
  total: 0,        // 月の支出予算（合計）。0＝未設定＝合計バー非表示
  items: []        // [{ name: "食費", amount: 45000 }, …] 費目名→月額
}
```

`normalizeBudgets(raw)`（純関数・冪等・`migrate` と `money.js` の書込経路の両方で使う）:

```
total = num(raw && raw.total)                                   // 非有限/負/文字列ゴミ → 0（num の既存規約）
items = Array.isArray(raw.items) ? raw.items : []
  .filter(it => it && typeof it === "object" && !Array.isArray(it))
  .map(it => ({ name: normName(it.name), amount: num(it.amount) }))
  .filter(it => it.name.length > 0 && it.amount > 0)            // amount 0 ＝「予算なし」＝要素ごと消す
  dedupe by name（先勝ち）→ slice(0, 40)
normName(v) = typeof v === "string" ? v.replace(/["'\\\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, 40) : ""
```
- `"`／`'`／`\`／制御文字（U+0000〜001F）を落とすのは `data-mcc-focus="budgets.item:<name>"` の属性セレクタ復元（§4.6）と inline handler
  `MCC.setBudgetItem('<name>', …)` を壊さないため（出力時はさらに `esc()` を通す）。kakeibo の費目名（`系統`）は日本語・「・」・英数のみ＝実データでは何も落ちない。
- `migrate(raw)` に `budgets: normalizeBudgets(raw.budgets)` を追加（`reserves`/`goals` と同型）。`defaultState()` に
  `budgets: normalizeBudgets(null)`。**既存 fixture（`advice_facts_cases.json` 71 ケース）の state は `budgets` を持たない
  → 既定 `{total:0, items:[]}` に落ちるだけ**で他フィールドは 1 バイトも変わらない（§10.1 で deepEqual）。
- `api/me/state.py` は JSONB 素通し（サイズ上限なし・増分は数百バイト）。LWW 同期に乗る＝予算は全端末で共有される
  （`mcc_tab`／`mcc_series_period` と違い「家計の意図」なので端末ローカルにしない）。

### 3.2 純関数（すべて `money-rules.js`・`money.js` は表示のみ）

| 関数 | 入力 → 出力 | 定義 |
|---|---|---|
| `normalizeBudgets(raw)` | any → `{total, items}` | §3.1 |
| `elapsedFraction(period, nowMs)` | `YYYY-MM-01`, epoch → 0..1 \| null | `period` の月と `nowMs`（UTC）の月を比較。過去月→1／未来月→0／同月→`clamp(day / _daysInMonth(y,m), 0, 1)`。`period` 不正・`nowMs` 非有限 → null |
| `latestRow(rows_in)` | API 生 rows → `cashflowRows()` の末尾行 \| null | fold「今月の予算」の対象行（末尾が `isComplete=false` なら進行中、確定なら「進行中の月はまだありません」） |
| `budgetProgress(budgets, row, nowMs)` | 正規化前後どちらの budgets でも可, `cashflowRows()` の 1 行 \| null, epoch → 下記 | その行に対する消化 |
| `budgetTotals(budgets)` | budgets → `{total, sumItems, count, itemsPct \| null, overTotal}` | 設定カードの注記「費目の合計 ¥X（合計予算の Y%）」の源（rows 非依存＝未ログインでも出せる・`itemsPct = total>0 ? round(sumItems/total*100) : null`・`overTotal = max(0, sumItems−total)`） |
| `budgetCategoryStats(rows_in, months)` | rows, 窓（既定 12）→ `{window, stats:[…]}` | 設定カードの費目一覧の源 |
| `reportNav(rows_in, period)` | rows, 選択月 → `{available, period, prev, next, latestComplete, isLatestComplete, isPartial}` | 選択月の正規化と前後移動 |
| `monthlyReport(eff, rows_in, investmentRows_in, period, nowMs)` | → 下記 | レポート本体の VM |

**`budgetProgress(budgets, row, nowMs)`**
```
b = normalizeBudgets(budgets)
configured = b.total > 0 || b.items.length > 0
if (!row) → { available:false, reason:"noRow", configured }
elapsed    = row.isComplete ? 1 : (elapsedFraction(row.period, nowMs) ?? 1)     // 進行中でも period 不正なら満月扱い
elapsedPct = Math.round(elapsed * 100)
cats       = row.breakdown && Array.isArray(row.breakdown.categories)
             ? categories.filter(c => c && typeof c.name==="string" && normName(c.name)).map(c => ({name: normName(c.name), amount: num(c.amount)}))
             : []
actualByName = 同名は合算（amount は num()＝負値/非有限/文字列ゴミは 0）
statusOf(actual, budget) = budget<=0 ? "none"
                         : actual > budget ? "over"
                         : (!row.isComplete && actual < budget && (pct > elapsedPct + 10 || pct >= 90)) ? "watch"
                         : "ok"
  ただし pct = Math.round(actual / budget * 100)
  // watch は「ペース超過（消化% > 経過%+10pt）」と「上限に接近（消化% ≥ 90）」の OR。ペースだけだと月末近く
  // （経過 94%）では 104% 超＝すでに over で発火し得ない（モックで判明）。actual === budget（家賃など固定費が
  // 予算ちょうど）は ok＝毎月アンバーになる騒音を避ける。確定月は over/ok のみ。
total = b.total > 0
  ? { budget:b.total, actual:row.totalExpense, pct, remaining:max(0,budget−actual), over:max(0,actual−budget), status }
  : { budget:0, actual:row.totalExpense, pct:null, remaining:null, over:0, status:"none" }
items = b.items.map(it => { name, budget:it.amount, actual:actualByName[name]||0, pct, remaining, over, status, hasData:(name in actualByName) })
        .sort((a,b) => b.pct−a.pct || b.budget−a.budget || a.name.localeCompare(b.name))     // 決定論
unbudgeted = cats で items に無い費目（amount>0）を amount 降順→name で並べ slice(0,5)
unbudgetedTotal = 上記の全件合計（上位5だけでない）
sumBudgeted = Σ items.budget／sumActualBudgeted = Σ items.actual
overCount = items.filter(status==="over").length／watchCount 同様
hasBreakdown = cats.length > 0
breakdownMismatch = hasBreakdown && |Σcats.amount − row.totalExpense| > max(1000, row.totalExpense*0.01)
                  // ETL は見出し（月別集計DB）と内訳（生取引）を別 DB から取る＝ずれ得る。エラーにせず注記フラグ
return { available:true, configured, period:row.period, isComplete:row.isComplete, elapsed, elapsedPct, total, items,
         unbudgeted, unbudgetedTotal, sumBudgeted, sumActualBudgeted, overCount, watchCount, hasBreakdown, breakdownMismatch,
         catsTotal }                                    // catsTotal = Σcats.amount（不一致注記の「内訳の合計（¥X）」用）
```

**`budgetCategoryStats(rows_in, months=12)`**
```
rows = cashflowRows(rows_in); complete = rows.filter(isComplete); win = complete.slice(-months)
acc[name] = { sum12, sum3 (末尾3行分), present (出現月数), last (win 末尾行の額・無ければ 0) }
stats = Object.keys(acc).map(name => ({ name, avg12: r(sum12 / win.length), avg3: r(sum3 / min(3, win.length)), months:present, last }))
        .sort((a,b) => b.avg12−a.avg12 || a.name.localeCompare(b.name))
return { window: win.length, stats }          // win.length===0 → { window:0, stats:[] }
```
- 平均の分母は**窓の月数**（出現しない月＝0）。年1回の費目（税金等）が「月あたり」に均される＝予算の目安として正しい。

**`reportNav(rows_in, period)`**
```
rows = cashflowRows(rows_in)
if (!rows.length) → { available:false, period:"", prev:null, next:null, latestComplete:"", isLatestComplete:false, isPartial:false }   // 固定形状
latestComplete = 末尾から最初の isComplete 行の period（無ければ ""）
sel = (period が YYYY-MM-01 で rows に実在) ? period : (latestComplete || rows[rows.length−1].period)
idx = rows.findIndex(period===sel); prev = rows[idx−1]?.period ?? null; next = rows[idx+1]?.period ?? null
return { available:true, period:sel, prev, next, latestComplete, isLatestComplete: sel===latestComplete, isPartial: !rows[idx].isComplete }
```
- 前後移動は**行の並び**（欠月は飛ばす）。前月比/前年同月比は**暦**（`_shiftYM`）で引く＝欠月なら `available:false`。

**`monthlyReport(eff, rows_in, investmentRows_in, period, nowMs)`**
```
nav = reportNav(rows_in, period); if (!nav.available) → { available:false, reason:"noRows" }
rows = cashflowRows(rows_in); byPeriod; row = byPeriod[nav.period]
prevRow = byPeriod[_shiftYM(nav.period, −1)] || null;  yoyRow = byPeriod[_shiftYM(nav.period, −12)] || null
income = row.totalIncome, salary = row.salaryIncome, misc = row.miscIncome, expense = row.totalExpense,
fixed = row.fixedExpense, variable = row.variableExpense, balance = row.balance,
savingsRatePct = income > 0 ? Math.round(balance / income * 100) : 0        // cashflowViewModel の monthSavings と同式（不変条件①）
delta(cur, prev) = { delta: cur−prev, pct: prev !== 0 ? round1((cur−prev) / |prev| * 100) : null }
mom = prevRow ? { available:true, period:prevRow.period, income:delta(..), expense:delta(..), balance:delta(..),
                  savingsRatePct: { delta: savingsRatePct − savingsRatePct(prevRow), pct:null } }        // 貯蓄率は pt（§6 注意5）
              : { available:false, period:"", income:null, expense:null, balance:null, savingsRatePct:null }   // 固定形状
yoy = yoyRow  ? 同上 : 同上（available:false の固定形状）
cats = budgetProgress と同じ正規化・同名合算 → amount 降順→name
categories = { hasBreakdown, count: cats.length,
               top: cats.slice(0,8).map(c => ({ name, amount, sharePct: expense>0 ? Math.round(amount/expense*100) : 0,
                                                 delta: prevRow?.breakdown ? amount − prevAmount(name) : null })),
               othersAmount: Σ cats.slice(8).amount }
budget = budgetProgress(eff.budgets, row, nowMs)
series = assetSeries(eff, rows_in, investmentRows_in)
point = series.points.find(p => p.period === nav.period); prevPoint = find(_shiftYM(nav.period, −1))
assets = !series.available ? { available:false, reason:series.reason }
       : !point            ? { available:false, reason:"noPoint" }        // 打切の外・アンカー前の逆算不能月
       : { available:true, total:point.total, cash:point.cash, invest:point.invest, isComplete:point.isComplete,
           beforeAnchor:point.beforeAnchor, delta: prevPoint ? point.total − prevPoint.total : null,
           pct: prevPoint && prevPoint.total !== 0 ? round1((point.total − prevPoint.total) / |prevPoint.total| * 100) : null }
return { available:true, period:nav.period, isComplete:row.isComplete, nav, income, salary, misc, expense, fixed, variable,
         balance, savingsRatePct, mom, yoy, categories, budget, assets }
```
- `round1` = 小数1桁（W3 `momDelta` の pct と同じ丸め）。

### 3.3 不変条件（`tests/money-budget.test.js` で機械証明）

1. 最新の確定月の `monthlyReport().balance` と `savingsRatePct` は `cashflowViewModel()` の `balance`／`savingsRatePct` と一致
   （収支 fold と同じ数字）。
2. `monthlyReport().assets.total` は `assetSeries(eff, rows, inv).points` の同 period 点の `total` と一致（推移カードと同じ数字）。
3. `budgetProgress().items[].actual` の和 ≦ Σ `breakdown.categories.amount`（内訳の外から金額を作らない）。
4. `normalizeBudgets(normalizeBudgets(x))` deepEqual `normalizeBudgets(x)`（冪等）。
5. `modeAFacts(migrate(s_with_budgets), opts)` deepEqual `modeAFacts(migrate(s_without), opts)`（production／personal 両モード・D2）。

### 3.4 変更しないもの（機械確認する）

- `assetSeries`／`cashDerived`／`cashflowDerived`／`cashflowViewModel`／`effectiveState`／`modeAFacts`／`nisaFacts`／`nisaViewModel`／
  `goalProgress`／`normalize*`（`normalizeBudgets` 以外）: **無改変**（`git diff` で関数本体に差分が無いこと）。
- `api/` 配下: **無接触**（`git diff --stat -- api/` が空）。`tests/fixtures/*`: 無接触。

## §4 描画（`money.js`）

### 4.1 render() の配線（追加分）

```
var liveRow = R.latestRow(_cashflowRows);
var bp      = R.budgetProgress(eff.budgets, liveRow, now);                       // fold「今月の予算」
var rep     = R.monthlyReport(eff, _cashflowRows, _investmentRows, _reportPeriod, now);   // レポート（D9 の置き場へ）
```
- `now` は既存の `render()` 内 1 回の `Date.now()` を共有。各セクションへは**引数で渡す**（module 変数を増やさない・
  `_reportPeriod` だけは選択状態として持つ）。
- `eff.budgets`（`effectiveState` は buckets しか差し替えないので `eff.budgets === state.budgets`）。

### 4.2 設定・ガイドタブ「月の予算」カード（`budgetCard(stats, cv)`）

- `cfgCard("mcc-sec-budget-card", "月の予算", "kakeibo の費目ごとの月額と合計。ダッシュボードの「今月の予算」と月次レポートの予算 vs 実績に使います。", body)`
  を **「設定」カード（`mcc-sec-settings` を含む `settings`）の直後**に置く（`configHtml` の連結順を変えるだけ）。
- body:
  1. 合計行 `.mcc-bud-total`: `moneyInput("月の支出予算（合計）", "budgets.total", state.budgets.total)`（既存 `setField` で足りる・
     `data-mcc-focus="budgets.total"`）＋ 読み出し `実支出の平均は ¥X/月（直近3ヶ月・確定月のみ）`（`cv.avgExpense`・`cv.available` のときだけ）＋
     ボタン「平均を採用」（`MCC.adoptBudgetTotalAvg()`・既存 `adoptAvgExpense` と同型）。一致時は「✓ 設定と一致」。
  2. 費目テーブル `.mcc-bud-table`（`stats = R.budgetCategoryStats(_cashflowRows, 12)`）: 行＝`stats.stats`（平均額順）∪
     `state.budgets.items` にあって stats に無い費目（末尾・`.mcc-bud-nodata`「直近12ヶ月に実績なし」）。
     列＝費目名／直近3ヶ月平均（`avg3`・`cv.available` のときだけ ¥）／予算 `<input type="number" min="0" step="1000"
     data-mcc-focus="budgets.item:<name>" onchange="MCC.setBudgetItem('<name>', this.value)">`／「平均を採用」
     （`MCC.adoptBudgetItemAvg('<name>')`・`avg3>0` のときだけ）。**0 を入れると予算を消す**（注記に明記）。
     ≤600px は NISA 年別表と同じ `data-label` 方式で 1 行 1 カード化。
  3. 注記 `.mcc-bud-note`（`R.budgetTotals(state.budgets)` 由来）: `費目の合計 ¥X（合計予算の Y%）`（`total>0` のとき。X>total なら「（合計予算を ¥Z 上回っています）」を
     事実として付ける）。`stats.window===0`（未ログイン/未連携）は「収支を連携すると、直近12ヶ月に使った費目が自動で並びます」。
- ゲート: 入力欄は readout gate ではない＝未ログインでも編集可（NISA 入力と同じ規律・state はローカル）。¥の読み出し
  （平均・実績）は `cv.available` のときだけ。

### 4.3 ダッシュボード fold「今月の予算」（`budgetLiveSection(bp, cv)`）

- 描画ゲート: `sync.loggedIn && cv.available` 以外は `""`（未連携 CTA は収支 fold に一本化・二重に出さない）。
- `foldSection("mcc-sec-budget-live", "mcc-fold-budget", "今月の予算", digest, body)`。**収支 fold の直後**（`dashHtml` の連結順）。
  `_FOLD_DEFAULT_OPEN["mcc-sec-budget-live"] = true`。
- `!bp.configured`: digest `未設定`／body＝1行「費目ごとの月額を設定すると、今月の消化がここに出ます。」＋ `jumpLink("budget", "「月の予算」")`
  ＋ 今月の費目上位5チップ（`bp.unbudgeted`・設定前でも「今月ここまで何に使ったか」が見える）。
- 見出し行 `.mcc-bud-head`: `fmtAnchorMonth(bp.period)`＋（`bp.isComplete` ? `（確定）` : `（進行中・月の ${elapsedPct}% 経過）`）。
  末尾行が確定月のときは注記「進行中の月のデータはまだありません（最新の確定月を表示）」。
- `budgetBars(bp, { tick: !bp.isComplete })`（§4.5）→ 予算なし費目 `.mcc-bud-unbud`: `予算なしの費目 ¥${unbudgetedTotal}：` ＋
  チップ（上位5・`名前 ¥額`）＋ `jumpLink("budget", "「月の予算」で設定")`。`unbudgeted` が空なら行ごと出さない。
- `bp.breakdownMismatch`: 注記「内訳の合計（¥X）と支出合計が一致していません」。
- digest（`configured` のとき）: `total.budget>0` → `消化 ${total.pct}%・月 ${elapsedPct}% 経過`／`total.budget===0` →
  `費目 ${items.length}件・月 ${elapsedPct}% 経過`。`overCount>0` なら `・超過 ${overCount}費目` を付ける。確定月表示中は
  `月 … 経過` の代わりに `（確定）`。

### 4.4 月次レポート（`reportSection(rep, vm, nvm, loggedIn)`・3 タブ目 `mcc-tab-report`＝D9）

- pane の先頭に `.mcc-section-desc`「月ごとの収入・支出・収支・貯蓄率と、予算に対する実績をまとめた面です。月は ◀ ▶ で移動します。」
  （§7）。本体は `<div id="mcc-tab-report-body">`（`_JUMP_TARGETS.report` の着地点）。
- `!sync.loggedIn` → 本文「ログインすると月次レポートが表示されます。」（¥ゼロ）。
- `!rep.available`（収支未連携）→ 「収支データが未連携です。」1行（`jumpLink("cashflow", …)` は既存の fallback に乗る）。
- 月ナビ `.mcc-rep-nav`: `<button aria-label="前の月" onclick="MCC.setReportPeriod('<prev>')" [disabled]>◀</button>`
  `<span class="mcc-rep-month">${fmtAnchorMonth(period)}</span> <button aria-label="次の月">▶</button>`＋チップ `最新`
  （`nav.isLatestComplete`）＋バッジ `確定`／`暫定（進行中）`（`.mcc-hero-chip-live/-prov` と同じ見た目）。
  `nav.prev/next` が null のボタンは `disabled`。
- KPI 4 タイル `.mcc-cf-stats` 流用（収入／支出／収支／貯蓄率）。各タイル下に `.mcc-rep-delta`:
  `前月比 ${yenSigned(delta)}（${pct}%）`／`前年同月比 …`（`available:false` → `前月比 —`）。収支は `.pos/.neg`。
- 資産増減タイル `.mcc-rep-assets`: `総資産 ${yen(total)}`＋`前月比 ${yenSigned(delta)}（${pct}%）`＋`現金 ${yen(cash)}・投資 ${yen(invest)}`。
  `assets.available===false` → 理由別 1 行（§7）。`beforeAnchor` なら W3 と同じ「基準より前は収支から逆算」注記。
- 予算 vs 実績: `budgetBars(rep.budget, { tick: !rep.isComplete, compareNote: rep.isComplete })`。`!configured` → 1 行
  「予算は未設定です。」＋ `jumpLink("budget", …)`。
- 費目 `.mcc-rep-cats`: 上位 8 行＝`名前 ¥額（構成比%）` ＋ 構成比バー（`.mcc-bud-bar` 流用・幅=sharePct）＋ `前月比 ±¥`
  （`delta===null` → 省略）。残りは `その他 ¥X`。`!hasBreakdown` → 「この月は内訳がありません。」
- 現在地 `.mcc-rep-now`（`nav.isLatestComplete && loggedIn` のときだけ）: `NISA 年内 使用 ${yen(nvm.annual.total.used)} / ${yen(cap)}（残 ${yen(remaining)}）`
  （`nvm.configured` のとき）＋ 目標 `${label} ${progressPct}%`（`vm.goals` 先頭 3 件・無ければ行ごと省略）。
- 注記 `.mcc-rep-notes`: 暫定／内訳と合計の不一致／欠月 の該当時のみ。

### 4.5 共通部品 `budgetBars(bp, opts)`

- 合計バー（`bp.total.budget>0`）: `.mcc-bud-row.mcc-bud-row-total`＝ラベル `支出 合計`／値 `${yen(actual)} / ${yen(budget)}（${pct}%）`／
  右端 `残り ${yen(remaining)}` または `超過 ${yen(over)}`／バー `.mcc-bud-bar > .mcc-bud-fill.${status}`（幅 `min(100,pct)%`）
  ＋ `opts.tick` なら `.mcc-bud-tick`（`left: ${elapsedPct}%`）。
- 費目バー（`bp.items`・pct 降順）: 同型。`hasData:false` → 値欄 `実績なし`・バー幅 0。
- `opts.compareNote` → 末尾に「現在の予算で比較しています」。
- 数値・並び・状態はすべて `bp` 由来（money.js で再計算しない＝業務 math 禁）。

### 4.6 公開面・状態・永続化

- `window.MCC` に追加: `setBudgetItem(name, value)`／`adoptBudgetItemAvg(name)`／`adoptBudgetTotalAvg()`／`setReportPeriod(period)`。
- `setBudgetItem(name, value)`: `n = normName(name)`（rules の `normalizeBudgets` に通す＝money.js に正規化を書かない）。
  `amount = Number(value)>=0 ? Number(value) : 0`。`items` を「同名があれば置換／無ければ末尾に追加／amount 0 なら除去」して
  `state.budgets = R.normalizeBudgets({ total: state.budgets.total, items })` → `save()` → `_renderAfterEdit()`（`setField` と同じ
  再描画経路＝`_pendingFocusKey` によるフォーカス復元は `data-mcc-focus="budgets.item:<name>"` で既存機構に乗る）。
- `adoptBudgetItemAvg(name)`: `stats` の `avg3` を `setBudgetItem(name, avg3)`。`adoptBudgetTotalAvg()`: `setField("budgets.total", cv.avgExpense)`。
- `setReportPeriod(period)`: `_reportPeriod = period; render();`（W3 `setSeriesPeriod` と同じ全再描画。`reportNav` が不正値を最新へ戻す）。
- `_JUMP_TARGETS` 追加: `budget: { id:"mcc-sec-budget-card", tab:"config" }`／`budgetLive: { id:"mcc-sec-budget-live", tab:"dash" }`／
  `report: { id:"mcc-tab-report-body", tab:"report" }`。`_TABS`／`_TAB_LABELS`／`tabBar`／`render()` の pane 連結に `report` を追加
  （§6 注意 1）。`switchTab` は未知値を `dash` へ倒す既存挙動のまま（`"report"` を受理するだけ）。
- 永続化: `budgets` はクラウド state（LWW）。`_reportPeriod` は永続化しない（D5）。fold 開閉は既存 `mcc_details` に自動で乗る。

## §5 スタイル（`money.css`・theme D・既存トークンのみ）

- fold アクセント `.mcc-fold-budget > summary .mcc-fold-mk { color: var(--c-amber-bright) }`（収支＝cf／推移＝cyan と区別）。
- バー: `.mcc-bud-row { display:grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 10px; align-items:center; margin: 8px 0 }`
  `.mcc-bud-bar { position:relative; height:10px; background:rgba(255,255,255,0.06); border-radius:6px; overflow:hidden; grid-column:1 / -1 }`
  `.mcc-bud-fill { height:100%; background: var(--c-cyan) }`／`.mcc-bud-fill.watch { background: var(--c-amber) }`／
  `.mcc-bud-fill.over { background: var(--c-danger) }`／`.mcc-bud-tick { position:absolute; top:0; bottom:0; width:2px; background: var(--c-text-dim); opacity:.85 }`
  `.mcc-bud-val { color: var(--c-text-dim); font-size:12px; white-space:nowrap }`／`.mcc-bud-over { color: var(--c-danger-soft) }`／
  `.mcc-bud-rem { color: var(--c-slate) }`。
- チップ `.mcc-bud-chip`＝`.mcc-cf-cat` と同型。注記 `.mcc-bud-note`＝`.mcc-cf-note` と同型。
- 設定カード表 `.mcc-bud-table`（`.mcc-nisa-table` の grid/ `data-label` 規約を流用）。
- レポート: `.mcc-rep-nav { display:flex; align-items:center; gap:8px; flex-wrap:wrap }`／`.mcc-rep-delta { font-size:12px; color: var(--c-text-dim) }`／
  `.mcc-rep-assets`・`.mcc-rep-cats`・`.mcc-rep-now`・`.mcc-rep-notes` は既存 `.mcc-cf-*` の余白・色階調に揃える。
  390px: KPI は既存 `.mcc-cf-stats` の 2 列化に乗る・費目行は 2 行折返し・ナビは 1 行に収める（`flex-wrap`）。
- タブ 3 本（D9）: `.mcc-tab` は既存のまま。`.mcc-tab-lbl-s { display:none }`／`@media (max-width:600px) { .mcc-tab-num, .mcc-tab-lbl { display:none }
  .mcc-tab-lbl-s { display:inline } .mcc-tab { padding: 12px 8px; letter-spacing: 0.5px } }`＝390px で「ダッシュボード／レポート／設定」が
  1 行（実測で `.mcc-tabbar` が wrap しない・高さ 43px 不変を受入 S9 で確認）。

## §6 レポートの置き場（D9・モック実物比較で確定）

| 案 | 置き場 | 長所 | 短所 |
|---|---|---|---|
| A | 3 タブ目（`_TABS = ["dash","report","config"]`・「01 ダッシュボード／02 月次レポート／03 設定・ガイド」・pane `mcc-tab-report`） | 全幅で読める・ダッシュボードの縦が増えない・「月次の儀式」として独立 | タブを切り替えないと見えない・タブ 3 本 |
| B | ダッシュボードの fold「月次レポート」（`mcc-sec-report`・「今月の予算」の直後・既定 closed・digest＝最新確定月の収支/貯蓄率） | 1 画面完結 | 縦がさらに伸びる（fold 9 本） |
| C | 収支 fold `#mcc-sec-cashflow` を拡張（月ナビ＋レポート本体を「収支の詳細」に統合・新 fold/タブなし） | 追加面ゼロ | fold の主題が二重化（W3 で案 C を不採用にした理由と同型） |

- モック: `scratchpad/w35-mock-server.py`（合成 fixture＝12 費目の内訳・`budgets` 入り state・進行中月 2026-08・本人データ非使用）＋
  `scratchpad/w35-variants.js`（`?w35variant=A|B|C`・`?w35now=YYYY-MM-DD`）＋ `scratchpad/w35-mock-shots.js`（A/B/C × 1440/390 ×
  dash/report/config の 18 枚・pageerror 0）。本人は `python3 scratchpad/w35-mock-server.py` → `http://127.0.0.1:8250/?w35variant=A&w35now=2026-08-29`
  を実ブラウザで比較。
- **選定結果＝A（本人・2026-08-29）**。3 タブ目 `report`（pane `id="mcc-tab-report"`・ボタン `id="mcc-tab-btn-report"`）。
  B は縦の増加（fold 9 本）、C は fold の主題の二重化で不採用（モック実物で確認）。
- モックで判明した実装上の注意（本実装で必ず反映）:
  1. **タブ機構**: `_TABS = ["dash", "report", "config"]`／`_TAB_LABELS` に `report: { num:"02", label:"月次レポート", short:"レポート" }`
     を足し、`config` は `num:"03"` に繰り下げ。`switchTab`／`tabBar` は `_TABS` を回す汎用ループのまま（モックのように capture listener で
     割り込まない）。`tabBar` は `.mcc-tab-lbl`（full）と `.mcc-tab-lbl-s`（short）の 2 span を出し、CSS が幅で出し分ける（§5）。
  2. **390px でタブ 3 本は 1 行に入らない**（実測 2 行）。sticky バーが 43→87px になる wrap は不採用＝短いラベルで 1 行（§5）。
  3. **fold の既定開閉は `_FOLD_DEFAULT_OPEN` に明示登録**（`"mcc-sec-budget-live": true`）。`_restoreDetails()` は id を持つ全 details を
     localStorage `mcc_details` から復元する＝登録が無いと初回 closed になる。
  4. **watch のしきい値**（§3.2 の OR 規則・actual === budget は ok）。
  5. **貯蓄率の前月比/前年同月比は pt**（`前月比 −35.0pt`）。金額は ¥＋%。
  6. **直近 3 ヶ月平均は確定月のみ**（進行中月を混ぜると過小）。設定カードの読み出しに「（直近3ヶ月・確定月のみ）」と明記。
  7. `window.MCCRules`（`money.js` の `R`）で `effectiveState → assetSeries → totalAssets` がそのまま使える（新規の math なし）。
  8. 既存 CSS との干渉なし（`.mcc-cf-stats` の 640px 2 列化・`.mcc-goal-bar` の 10px をそのまま流用）。
  9. 既存の設定タブに **390px 横溢れ（`.mcc-field` 幅 209px・fullPage 幅 471px）** がある。`overflow-x: clip` で見えないが W3.5 と無関係＝
     §11 の別レーン申し送り。

## §7 文言（決定論・事実＋数値のみ・D7）

| 場所 | 文言 |
|---|---|
| fold 名 | `今月の予算` |
| fold digest | `消化 93%・月 94% 経過`／`消化 93%・月 94% 経過・超過 1費目`／`費目 8件・月 94% 経過`／`未設定`／確定月表示中 `消化 102%（確定）` |
| 見出し | `2026年8月（進行中・月の 94% 経過）`／`2026年7月（確定）`／注記 `進行中の月のデータはまだありません（最新の確定月を表示）` |
| 合計バー | `支出 合計` `¥241,300 / ¥260,000（93%）` `残り ¥18,700`／`超過 ¥6,000` |
| 費目バー | `食費` `¥41,500 / ¥45,000（92%）` `残り ¥3,500`／`超過 ¥4,500`／`実績なし` |
| 予算なし | `予算なしの費目 ¥31,400：車・ガソリン ¥12,000・衣服 ¥8,900 …`＋`「月の予算」で設定` |
| 未設定 | `費目ごとの月額を設定すると、今月の消化がここに出ます。`＋`「月の予算」`（jump） |
| 不一致 | `内訳の合計（¥241,300）と支出合計（¥246,000）が一致していません` |
| 過去月 | `現在の予算で比較しています` |
| pane 説明 | `月ごとの収入・支出・収支・貯蓄率と、予算に対する実績をまとめた面です。月は ◀ ▶ で移動します。`／未ログイン `ログインすると月次レポートが表示されます。`／未連携 `収支データが未連携です。` |
| タブ | `01 ダッシュボード`／`02 月次レポート`／`03 設定・ガイド`・≤600px は `ダッシュボード`／`レポート`／`設定` |
| ナビ | `◀`（aria-label `前の月`）`2026年7月` `▶`（`次の月`）チップ `最新` バッジ `確定`／`暫定（進行中）` |
| 前月比 | `前月比 +¥12,000（+3.4%）`／`前年同月比 −¥5,000（−1.2%）`／`前月比 —`（− は U+2212・W3 §7 と同じ）。貯蓄率は `前月比 −35.0pt`（小数 1 桁・pt） |
| 資産 | `総資産 ¥3,120,000` `前月比 +¥52,000（+1.7%）` `現金 ¥1,920,000・投資 ¥1,200,000`／`noAnchor`→`資産の推移は基準（アンカー）設定後に表示されます`／`currency`→`JPY 以外の通貨には対応していません`（既存 seriesSection と同文）／`noPoint`・その他→`この月は資産の系列に含まれません（収支データの欠けた月があります）` |
| 注記 | 暫定＝既存文言 `今月の収支は月末締め後（翌月初の自動更新）に反映されます。` を流用／欠月 `前月のデータがありません`・`前年同月のデータがありません`（禁則語なし） |
| 費目 | `食費 ¥45,000（18%）` `前月比 +¥2,000`／`その他 ¥23,000`／`この月は内訳がありません。` |
| 現在地 | `NISA 年内 使用 ¥300,000 / ¥3,600,000（残 ¥3,300,000）`／`住宅の頭金 24%` |
| 設定カード | `月の支出予算（合計）`／`実支出の平均は ¥X/月（直近3ヶ月・確定月のみ）`／`平均を採用`／`✓ 設定と一致`／`0 を入れると予算を消します`／`直近12ヶ月に実績なし`／`費目の合計 ¥X（合計予算の Y%）`／`収支を連携すると、直近12ヶ月に使った費目が自動で並びます` |

- **禁則**（新設部分・受入で機械確認）: `節約`／`使いすぎ`／`見直し`／`おすすめ`／`しましょう`／`べき` を含まない。
  （既存 `cashflowSection` の「支出の見直しを優先しましょう」は既存文言＝本 wave の対象外・無改変）

## §8 劣化と例外

| 状況 | 挙動 |
|---|---|
| 未ログイン | fold「今月の予算」非描画。レポート pane はログイン案内 1 行（¥ゼロ）。設定カードは `items` の編集可・¥読み出しなし（送信ゼロ維持） |
| 収支未連携（rows 0） | fold 非描画（収支 fold の未連携 CTA に一本化）。レポート＝「収支データが未連携です。」。設定カード＝費目一覧は空＋案内文 |
| USD（`cv.currencyMismatch`） | 収支 fold と同じく非表示＋既存注記（予算 fold・レポートは `cv.available` false で非描画） |
| 進行中行なし（月初・ETL 未取込） | fold は最新確定月を `（確定）` で描き注記を出す。digest は `消化 …%（確定）` |
| `breakdown` が null の行 | 費目バーは全て `実績なし`・合計バーは見出し列で成立・レポート費目は「内訳がありません」 |
| 内訳と見出しの不一致 | `breakdownMismatch` 注記（エラーにしない） |
| 欠月 | 前月比/前年同月比の該当だけ `—`。資産増減は `noPoint`（打切の外）で理由 1 行。W3 の `truncated*` 注記は無改変 |
| 費目の改名/消滅 | `hasData:false`＝設定カード末尾「直近12ヶ月に実績なし」・fold では `実績なし`。予算は消さない（本人が 0 で消す） |
| 上限 | items 40 件・費目名 40 字（`normalizeBudgets` が黙って切る＝`reserves` 50 件と同型）。表示は `stats` 全件（実データは 15〜25 程度） |
| `_reportPeriod` が rows に無い | `reportNav` が最新の確定月へ正規化（ボタン連打・データ更新後も壊れない） |

## §9 既存受入への影響

- `scratchpad/cockpit-e2e.js`（241 → 更新後 252）: `FOLD_IDS`（全スナップショットで「必ず存在」を要求）には `mcc-sec-budget-live` を**足さない**（予算 fold は
  未ログイン/未連携で非描画＝足すと既存アサートが壊れる）。代わりに専用スナップショットキー `budgetLive`＋新規アサート（ログイン時あり・未ログイン時なし・digest 逐語）で検証／
  設定タブの input 数が増える（`configHoldingInputs`・`configNisaInputs` は接頭辞一致で不変・`dashInputCount` は 0 のまま）／
  タブ 3 本（`#mcc-tab-report` の hidden 切替・`aria-selected`）。**期待値を意図的に更新し新基準値（件数）を spec §11 と CLAUDE.md 追記に記録**。
- `scratchpad/w3-smoke.js`（128）: 推移 fold は無改変・DOM 順（hero → rail → series → cashflow → **budget-live** → …）は series より後ろに
  挿入するだけ＝不変。
- `scratchpad/portal-money-smoke.js`: 司令室の表示遷移のみ＝不変を実行で確認。
- `tests/money-rules.test.js` `migrate(null) deepEqual defaultState`: 両方に `budgets` が入るので不変。`advice_facts_cases` の JS 側 71 ケース: 不変。
- `pytest tests/test_advice_facts.py`（106）: `api/` 非接触＝不変。`scratchpad/anchor-parity-fuzz.js`: 不変（budgets を生成に加えても
  facts は不変＝§3.3 ⑤の fuzz 版を任意で追加）。

## §10 テスト計画

### 10.1 node ユニット（新規 `tests/money-budget.test.js`・`node --test tests/*.test.js`）

- `normalizeBudgets`: null/配列/ゴミ → 既定／`"` と制御文字の除去／空白正規化／40 字切り／amount 0 除去／重複先勝ち／40 件切り／冪等（③④）。
- `migrate`: `budgets` 無し raw → 既定／既存 fixture 71 ケースの state で `migrate` 出力の `budgets` 以外が W3 時点と deepEqual／
  **⑤ `modeAFacts` deepEqual（production/personal）**。
- `elapsedFraction`: 過去月 1／未来月 0／同月の 1 日・15 日・末日（28/29/30/31 日の月）／不正 period → null／`nowMs` 非有限 → null。
- `budgetProgress`: row null／未設定（configured false）／合計のみ／費目のみ／over・watch・ok の境界（進行中: `pct === elapsedPct+10` かつ
  `pct < 90` は ok・`+11` は watch・`pct === 90` は watch・`actual === budget` は ok・`actual > budget` は over／確定月: watch にならない）／同名合算／負の amount は 0／`hasData:false`／unbudgeted の上位 5 と全件合計／並びの決定論／
  `breakdownMismatch` の閾値（`max(1000, 1%)`）／③。
- `budgetCategoryStats`: 窓 12 の分母＝窓の月数／avg3／出現月数／末尾値／未確定行の除外／rows 0 → `{window:0, stats:[]}`／並び。
- `reportNav`: 不正 period → 最新確定月／確定月ゼロ → 末尾行／prev/next の端／`isPartial`。
- `monthlyReport`: ①／②／mom・yoy の欠月 `available:false`／`pct` null（prev 0）／categories top 8＋others／delta null（前月内訳なし）／
  assets `noAnchor`・`noPoint`・`beforeAnchor`／`savingsRatePct` の式一致。

### 10.2 ブラウザ受入（新規 `scratchpad/w35-smoke.js`・Playwright・`NODE_PATH=/home/shugo/node_modules node scratchpad/w35-smoke.js`）

- 配信＝`W35_VARIANTS=0 python3 scratchpad/w35-mock-server.py`（w35-smoke が自前起動・オーバーレイ非注入＝本実装の money.js だけを検証）。
  `context.addInitScript` で `Date.now`／`new Date()` を 2026-08-29 に固定（W3 §6 注意 4 と同じ）。PC 1440 / 390px。
- ケース（**期待値は literal 固定**＝rules と DOM が同じ `money-rules.js` を読む死角を避ける・W3 §11）:
  S1 未設定（fixture の `budgets` を空にした鯖モード `W35_BUDGETS=0`）→ digest `未設定`・CTA・費目上位チップ／
  S2 設定済 → 合計バー `¥241,300 / ¥260,000（93%）`・目盛線 `left:94%`・over 1 件（外食費 赤）・watch 1 件（食費 アンバー）・
  unbudgeted 5 件・digest 逐語／S3 設定カード：input に 0 → 行が消える・`平均を採用` → 値が avg3 になる・フォーカス復元／
  S4 レポート：既定 2026年7月＋`最新`＋`確定`・◀ で 2026年6月（`最新` 消える・前月比/前年同月比の逐語）・▶▶ で 2026年8月
  `暫定（進行中）`・端で disabled／S5 資産増減が推移カードの同月点と一致（DOM 同士の突合）／S6 未ログイン（鯖 `W35_AUTH=0`）→
  fold なし・¥ゼロ（本文に `¥` が出ない）／S7 禁則語（§7）が新設セクションに 0 件／S8 fold 開閉が再描画後も保持／
  S9 タブ 3 本＝切替が非再描画（`#mcc-root` の子ノード参照が同一・fold の開閉が残る）・390px で `.mcc-tabbar` が wrap しない（バー高＝
  ボタン高を主アサート・px の実測値は緑になってから記録）・短いラベルの逐語／S10 pageerror・console.error 0（KNOWN_NOISE 除く）。
- 同額タイの並び（fixture の 保険／車・ガソリン 各 ¥12,000）は `localeCompare`＝ICU 依存なので、チップ類は**集合と合計**で assert し順序に依存させない。

### 10.3 既存スイート

- `node --test tests/*.test.js`（418 → 440）／`pytest tests/`（106 不変）／`cockpit-e2e.js`（241 → 252）／
  `w3-smoke.js` 128／`portal-money-smoke.js`／`git diff --stat -- api/ tests/fixtures/ index.html`＝空。

## §11 リスクと申し送り

- **内訳と見出しの二重源**: ETL は見出しを月別集計 DB、内訳を生取引 DB から取る（`etl_cashflow.py` ハイブリッド粒度）。
  ずれは `breakdownMismatch` で見せるだけ（直すのは kakeibo 側）。
- **進行中月の鮮度**: ETL は毎朝 6:50 JST＝「今日の消化」は前日までの取引。見出し行に既存 `fetchNoteHtml` の鮮度表示が
  あるのでここでは重ねない。
- **経過率の暦**: UTC（D8）。JST 0〜9 時は日付が 1 日戻る＝経過率が最大 3pt 低く出る（既知・W3 と同じ扱い）。
- **render() 全再描画**: 月ナビ・予算入力も render() 経由＝フォーカス復元は既存機構（`_pendingFocusKey`）に乗る。
  ナビボタン押下後のフォーカスは失われる（W3 期間ボタンと同じ deferred minor）。
- **facts へ出す将来**: `budgets` を AI に渡す時は `advice.py _migrate`／`_normalize_budgets` 鏡像＋coarsen（費目名は production で
  出さない）＋SCHEMA_VERSION 7＋fixture 追加が必要。本 wave は入口を作らない。
- **既存の 390px 横溢れ（別レーン）**: 設定タブの `.mcc-field`（幅 209px・3 件）が fullPage 幅 471px を作っている。`html/body { overflow-x: clip }`
  で画面には出ないが、W3.5 の追加分は溢れゼロ（モック実測 dash 453→452px／config 471→471px）。直すなら別 wave。
- **`.claude/CLAUDE.md`（統合時に main 直下で追記）**: git 管理外＝worktree からは編集不能（W3 §11 と同じ）。統合セッションが
  「お金の司令塔／司令室」節の `🆕 W3` bullet の直後へ次を追記すること（cockpit-e2e の新基準値は実装後に確定して差し替える）。

  ```markdown
    - **🆕 W3.5 月次パック（spec `docs/superpowers/specs/2026-08-29-w35-monthly-pack-design.md`）**：予算 vs 実績（`state.budgets={total,items[{name,amount}]}`＝kakeibo 費目そのまま・`normalizeBudgets`／`budgetProgress`／`budgetCategoryStats`）＋月次レポート（`reportNav`／`monthlyReport`・選択月は `_reportPeriod`＝非永続）。**`budgets` は UI 専用＝facts 非出力・advice.py 鏡像なし（`modeAFacts` 出力は budgets の有無で deepEqual＝`tests/money-budget.test.js`）**。⚠`normalizeBudgets` は amount 0 を「削除」と解釈する（0 を保存しない）。⚠経過率は UTC・進行中行（`is_complete=false`）を対象＝末尾行が確定なら「進行中の月はまだありません」注記を消さない。⚠内訳（生取引）と見出し（月別集計）は別源＝`breakdownMismatch` を注記で見せる（直さない）。受入＝`NODE_PATH=/home/shugo/node_modules node scratchpad/w35-smoke.js`（`W35_VARIANTS=0` のモック鯖を自前起動）＋ cockpit-e2e（新基準値 252）。
  ```

## §12 変更するファイル

- `money-rules.js`: §3 の純関数を追加（既存関数は無改変）＋`defaultState`/`migrate` に `budgets`＋UMD return に追記。
- `money.js`: §4（`budgetCard`／`budgetLiveSection`／`budgetBars`／`reportSection`／`setBudgetItem`／`adoptBudgetItemAvg`／`adoptBudgetTotalAvg`／
  `setReportPeriod`／`_reportPeriod`／`_JUMP_TARGETS`／`_FOLD_DEFAULT_OPEN`／タブ 3 本（`_TABS`/`_TAB_LABELS`/`tabBar`/pane）／`window.MCC` 追記）。
- `money.css`: §5。
- `tests/money-budget.test.js`: 新規（§10.1）。
- `scratchpad/w35-mock-server.py`／`w35-variants.js`／`w35-mock-shots.js`: モック比較資産（リポに残す・`.vercelignore` の scratchpad 除外で
  本番に出ない）。`w35-mock-server.py` は §10.2 の受入でも配信役を兼ねる（`W35_VARIANTS=0`・`W35_BUDGETS=0`・`W35_AUTH=0`）。
- `scratchpad/w35-smoke.js`: 受入（§10.2）。
- `docs/superpowers/specs/2026-08-29-w35-monthly-pack-design.md`（本書）／`docs/superpowers/plans/2026-08-29-w35-monthly-pack.md`（次工程）。
- 非接触: `index.html`／`api/**`／`db/**`／`scripts/**`／`tests/fixtures/*`／`vercel.json`。
