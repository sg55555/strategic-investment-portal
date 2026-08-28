# W3.5「月次パック」Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** お金の司令室（`#money-view`）に「予算 vs 実績（今月の消化＝ダッシュボードの fold『今月の予算』）」と「マンスリーレポート（3 タブ目 `mcc-tab-report`）」を、既存 state／API／facts を一切変えずに足す。

**Architecture:** 導出ロジックは全て `money-rules.js` の純関数（UI 専用・`modeAFacts` 非接触＝`advice.py` 鏡像義務なし）。`money.js` は `render()` 冒頭で1回だけ VM を作り、各セクションに**引数で**配って HTML 文字列を組む（既存の全再描画方式・`root.innerHTML` 差替）。予算は `state.budgets`（クラウド LWW 同期）、選択月は非永続のモジュール変数 `_reportPeriod`。検証は node ユニット（純関数）＋ Playwright 受入 `scratchpad/w35-smoke.js`（合成 fixture を返す `scratchpad/w35-mock-server.py` を `W35_VARIANTS=0` で配信）。

**Tech Stack:** Vanilla JS（ES5 風の `var`/`function`・UMD-lite）、CSS（theme D トークン `--c-*`）、node:test、Playwright（`NODE_PATH=/home/shugo/node_modules`）、Python 3 標準ライブラリ（モック鯖）。

**Spec:** `docs/superpowers/specs/2026-08-29-w35-monthly-pack-design.md`

## Global Constraints

- **非目標（spec §1）**: 予算のバケツ化／予算の月別履歴／facts 拡張／ETL・DB・**新 Vercel 関数（11/12 を維持）**／レポートの「投資余力」再計算。入れない。
- **非接触**: `index.html`／`api/**`／`db/**`／`scripts/**`／`tests/fixtures/*`／`vercel.json`。`git diff --stat -- api/ tests/fixtures/ index.html` は常に空。
- **無改変（spec §3.4）**: `assetSeries`／`cashDerived`／`cashflowDerived`／`cashflowViewModel`／`effectiveState`／`modeAFacts`／`nisaFacts`／`nisaViewModel`／`goalProgress`／`normalize*`（`normalizeBudgets` 以外）。**追加のみ**。
- **`FACTS_SCHEMA_VERSION` は 6 のまま**・`budgets` は **facts 非出力**（`advice.py` 鏡像なし＝D2）。機械証明＝`tests/money-budget.test.js` の不変条件⑤。
- **`money.js` に業務 math を書かない**。数値・並び・状態はすべて `money-rules.js` 由来（`money.js` は文字列整形と DOM のみ）。
- **`window.MCC` に新ハンドラを足したら return（`money.js` 末尾）に追記**（忘れると無音故障）。
- **暦は UTC**（`nisaNow`／`monthsBetweenYM` と同じ・D8）。経過率の分母は既存 `_daysInMonth`。
- **文言は spec §7 を逐語**。**禁則語**（`節約`／`使いすぎ`／`見直し`／`おすすめ`／`しましょう`／`べき`）を新設部分に入れない（受入 S7 が機械確認）。マイナスは U+2212「−」。
- **CSS は既存トークン `--c-*` のみ**（生 hex 禁止・rgba の濃淡は既存規則に倣う）。
- **ES5 風で書く**（`var`／`function`／アロー・`const`・テンプレートリテラルを `money-rules.js`／`money.js` で使わない）。テストは既存どおり `const`／アロー可。
- localStorage の新キーは**作らない**（fold 開閉は既存 `mcc_details`・タブは既存 `mcc_tab`。`_reportPeriod` は永続化しない＝D5）。
- テスト実行: `node --test tests/*.test.js`（末尾スラッシュ禁止）／pytest は `/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_advice_facts.py -q`（worktree に .venv は無い）。
- Playwright 系は `NODE_PATH=/home/shugo/node_modules node <script>`。
- コミットは worktree ブランチ `worktree-w35-monthly-pack` に小さく（**push しない**）。

---

## ファイル構成

| ファイル | 役割 | 変更 |
|---|---|---|
| `money-rules.js` | 純関数（予算・レポート）＋`defaultState`/`migrate` の `budgets` | 追加（W3 ブロックの後・`return {` の前）＋UMD return 追記 |
| `tests/money-budget.test.js` | 新純関数のユニット＋不変条件①〜⑤ | 新規 |
| `money.js` | 設定カード／fold「今月の予算」／3 タブ目のレポート／ハンドラ | 追加＋タブ機構と `render()` の配線 |
| `money.css` | `.mcc-bud-*`／`.mcc-rep-*`／タブ短ラベル | 末尾に追加 |
| `scratchpad/w35-mock-server.py` | 受入の配信役（`W35_BUDGETS=0`／`W35_AUTH=0` を追加） | 2箇所変更 |
| `scratchpad/w35-smoke.js` | Playwright 受入（S1〜S10） | 新規 |
| `scratchpad/w35-real-shots.js` | 本実装スクショ | 新規 |
| `scratchpad/cockpit-e2e.js` | 既存 E2E の期待値更新（fold 追加・タブ3本） | 変更 |
| `docs/superpowers/specs/2026-08-29-w35-monthly-pack-design.md` | §9 件数・§11 CLAUDE.md 追記ブロックの実測反映 | 変更 |

---

### Task 1: state（`normalizeBudgets`／`defaultState`／`migrate`）

**Files:**
- Modify: `money-rules.js`（`reminders` 関数の閉じ `}` の直後＝`  return {` の直前に追加／`defaultState`／`migrate`／UMD return）
- Test: `tests/money-budget.test.js`（新規）

**Interfaces:**
- Consumes: 既存 `num`／`r`／`clamp`／`_DATE_RE`／`cashflowRows`／`_daysInMonth`／`_shiftYM`／`assetSeries`（後続 Task）。
- Produces:
  - `R.normName(v) → string`（`"`／`'`／`\`／U+0000-001F 除去・空白畳み・trim・40字）
  - `R.normalizeBudgets(raw) → { total:number, items:[{name,amount}] }`（冪等・amount 0 は除去・重複先勝ち・40件）
  - `R.defaultState().budgets` / `R.migrate(raw).budgets` が上記の固定形状

- [ ] **Step 1: 失敗するテストを書く**

`tests/money-budget.test.js` を新規作成:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../money-rules.js");

// ---- fixture ヘルパ（整数のみ・決定論。money-pfm.test.js の mkRows と同型＋breakdown 対応）----
// cats は [[name, amount], …]。省略時 breakdown:null（内訳なしの行）。
function mkRow(period, o) {
  o = o || {};
  const income = o.income == null ? 350000 : o.income;
  const misc = o.misc || 0;
  const fixed = o.fixed == null ? 140000 : o.fixed;
  const expense = o.expense == null ? 250000 : o.expense;
  return {
    period: period, total_income: income, salary_income: income - misc, misc_income: misc,
    fixed_expense: fixed, variable_expense: expense - fixed, total_expense: expense,
    balance: income - expense, savings_rate: 0, is_complete: !o.partial,
    breakdown: o.cats ? { categories: o.cats.map((c) => ({ name: c[0], amount: c[1] })) } : null,
    pulled_at: "2026-08-29T00:00:00Z",
  };
}
function mkState(extra) {
  return R.migrate(Object.assign({
    version: 2, currency: "JPY", monthlyExpense: 220000, bufferMonths: 6,
    buckets: { buffer: { amount: 0 }, core: { amount: 600000 }, satellite: { amount: 0 } },
    satelliteCapPct: 10, goals: [], reserves: [], updatedAt: 1,
    anchor: { date: "2026-01-01", amount: 1000000 },
  }, extra || {}));
}

test("normalizeBudgets: 非オブジェクト/配列/ゴミは既定 {total:0, items:[]}", () => {
  const empty = { total: 0, items: [] };
  assert.deepEqual(R.normalizeBudgets(null), empty);
  assert.deepEqual(R.normalizeBudgets(undefined), empty);
  assert.deepEqual(R.normalizeBudgets([]), empty);
  assert.deepEqual(R.normalizeBudgets("x"), empty);
  assert.deepEqual(R.normalizeBudgets(42), empty);
  assert.deepEqual(R.normalizeBudgets({ total: "abc", items: "nope" }), empty);
  assert.deepEqual(R.normalizeBudgets({ total: -5, items: [1, "a", null, []] }), empty);
  assert.deepEqual(R.normalizeBudgets({ total: "260000" }), { total: 260000, items: [] });
});

test("normName: 引用符/バックスラッシュ/制御文字の除去・空白畳み・trim・40字", () => {
  assert.equal(R.normName('食"費'), "食費");
  assert.equal(R.normName("食'費"), "食費");
  assert.equal(R.normName("食\\費"), "食費");
  assert.equal(R.normName("食\u0000\u001f費"), "食費");
  assert.equal(R.normName("  食   費  "), "食 費");
  assert.equal(R.normName("あ".repeat(45)), "あ".repeat(40));
  assert.equal(R.normName(123), "");
  assert.equal(R.normName(null), "");
  assert.equal(R.normName("   "), "");
});

test("normalizeBudgets: amount 0/負は要素ごと除去・重複は先勝ち・40件で切る・名前は正規化", () => {
  const b = R.normalizeBudgets({
    total: 260000,
    items: [
      { name: "食費", amount: 45000 },
      { name: "予算なし", amount: 0 },        // 0 ＝「予算なし」＝消す
      { name: "負", amount: -100 },
      { name: '外"食費', amount: 20000 },     // " は落ちる
      { name: "食費", amount: 99999 },        // 重複＝先勝ち
      { name: "", amount: 1000 },             // 名前なし
      { name: "__proto__", amount: 500 },     // プロトタイプ汚染よけ
      { name: "__proto__", amount: 600 },
    ],
  });
  assert.deepEqual(b, { total: 260000, items: [
    { name: "食費", amount: 45000 }, { name: "外食費", amount: 20000 }, { name: "__proto__", amount: 500 },
  ] });
  const many = [];
  for (let i = 0; i < 50; i++) many.push({ name: "c" + i, amount: 1000 + i });
  const cut = R.normalizeBudgets({ total: 0, items: many });
  assert.equal(cut.items.length, 40);
  assert.equal(cut.items[39].name, "c39");
});

test("不変条件④: normalizeBudgets は冪等", () => {
  const raws = [
    null, { total: 260000, items: [{ name: " 食 費 ", amount: "45000" }, { name: "x", amount: 0 }] },
    { total: "abc", items: [{ name: '"a"', amount: 1 }, { name: "a", amount: 2 }] },
  ];
  raws.forEach((raw) => {
    const once = R.normalizeBudgets(raw);
    assert.deepEqual(R.normalizeBudgets(once), once, JSON.stringify(raw));
  });
});

test("defaultState/migrate: budgets は固定形状・migrate(null) は defaultState と deepEqual", () => {
  assert.deepEqual(R.defaultState().budgets, { total: 0, items: [] });
  assert.deepEqual(R.migrate(null), R.defaultState());
  assert.deepEqual(R.migrate({}).budgets, { total: 0, items: [] });
  assert.deepEqual(R.migrate({ budgets: "x" }).budgets, { total: 0, items: [] });
  assert.deepEqual(R.migrate({ budgets: { total: 1000, items: [{ name: "食費", amount: 45000 }] } }).budgets,
    { total: 1000, items: [{ name: "食費", amount: 45000 }] });
  // budgets を足しても他フィールドは1バイトも変わらない
  const base = mkState();
  const withB = R.migrate(Object.assign({}, base, { budgets: { total: 1, items: [{ name: "a", amount: 2 }] } }));
  const stripped = Object.assign({}, withB, { budgets: { total: 0, items: [] } });
  assert.deepEqual(stripped, Object.assign({}, base, { budgets: { total: 0, items: [] } }));
});

// --- 不変条件⑤（D2 facts 非出力）: budgets の有無で modeAFacts は完全一致 ---
const CASES = require("./fixtures/advice_facts_cases.json").cases;
function caseNow(c) { return c.nowMs != null ? c.nowMs : (c.nowIso ? Date.parse(c.nowIso) : 0); }
const SAMPLE_BUDGETS = { total: 260000, items: [{ name: "食費", amount: 45000 }, { name: "外食費", amount: 20000 }] };

test("不変条件⑤: 全 fixture ケースで modeAFacts が budgets の有無に不感（production/personal）", () => {
  CASES.forEach((c) => {
    const opts = { nowMs: caseNow(c), cashflow: c.cashflow, investmentRows: c.investment || [] };
    const withB = Object.assign({}, c.state, { budgets: SAMPLE_BUDGETS });
    assert.deepEqual(R.modeAFacts(R.migrate(withB), opts), R.modeAFacts(R.migrate(c.state), opts), c.name);
    const pers = Object.assign({ includeRawAmounts: true }, opts);
    assert.deepEqual(R.modeAFacts(R.migrate(withB), pers), R.modeAFacts(R.migrate(c.state), pers), c.name);
  });
  assert.ok(CASES.length >= 71, "fixture ケース数 " + CASES.length);
});

module.exports = { mkRow, mkState };
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/money-budget.test.js`
Expected: FAIL（`R.normalizeBudgets is not a function` 等）

- [ ] **Step 3: 実装（`money-rules.js`・`reminders` 関数の閉じ `}` の直後、`  return {` の直前に挿入）**

```js
  // ==== W3.5 月次パック（spec docs/superpowers/specs/2026-08-29-w35-monthly-pack-design.md §3）====
  // すべて UI 専用の純関数（facts 非出力＝advice.py 鏡像なし・D2）。時刻は呼び元（render）が1回取った nowMs を受ける。
  // 関数宣言は巻き上げられるため、defaultState/migrate より後ろに置いても両者から呼べる。

  var BUDGET_ITEMS_MAX = 40;   // reserves 50 件と同型の上限（黙って切る）
  var BUDGET_NAME_MAX = 40;

  // §3.1 費目名の正規化。属性セレクタ（data-mcc-focus="budgets.item:<name>"）と inline handler
  // MCC.setBudgetItem('<name>') を壊す文字（" ' \ 制御文字）を落とす。出力時はさらに esc() を通す。
  function normName(v) {
    if (typeof v !== "string") return "";
    return v.replace(/["'\\\u0000-\u001f]/g, "").replace(/\s+/g, " ").trim().slice(0, BUDGET_NAME_MAX);
  }

  // §3.1 予算の安全正規化（純粋・冪等）。migrate と money.js の書込経路の両方が通る唯一の入口。
  // amount 0 は「予算なし」＝要素ごと除去（＝0 を保存しない）。同名は先勝ち。
  function normalizeBudgets(raw) {
    var src = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
    var list = Array.isArray(src.items) ? src.items : [];
    var seen = {}, out = [];
    for (var i = 0; i < list.length; i++) {
      var it = list[i];
      if (!it || typeof it !== "object" || Array.isArray(it)) continue;
      var name = normName(it.name), amount = num(it.amount);
      if (!name.length || !(amount > 0)) continue;
      var key = "k:" + name;                                   // "__proto__" 等でも安全なキー空間
      if (Object.prototype.hasOwnProperty.call(seen, key)) continue;
      seen[key] = true;
      out.push({ name: name, amount: amount });
      if (out.length >= BUDGET_ITEMS_MAX) break;
    }
    return { total: num(src.total), items: out };
  }
```

`defaultState()`（`nisa: normalizeNisa(null),` の直後）に1行追加:

```js
      budgets: normalizeBudgets(null), // W3.5 月の支出予算（UI 専用・facts 非出力・LWW 同期）
```

`migrate(raw)` の return（`nisa: normalizeNisa(raw.nisa),` の直後）に1行追加:

```js
      budgets: normalizeBudgets(raw.budgets), // W3.5（未知キー同様に既定へ落ちる＝既存 fixture は不変）
```

UMD return（`money-rules.js` 末尾）の `reserveOutlook: reserveOutlook, nisaReminder: nisaReminder, reminders: reminders,` の直後に追記:

```js
    // W3.5 月次パック（UI 専用・facts 非出力）
    normName: normName, normalizeBudgets: normalizeBudgets,
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/money-budget.test.js`
Expected: 6 pass / fail 0

Run: `node --test tests/*.test.js`
Expected: 全 pass・fail 0（既存 418 に新規分だけ増える。`migrate(null) deepEqual defaultState` は両方に `budgets` が入るので不変）

Run: `/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/test_advice_facts.py -q`
Expected: 106 passed（`api/` 非接触の確認）

- [ ] **Step 5: コミット**

```bash
git add money-rules.js tests/money-budget.test.js
git commit -m "feat(w35): state に budgets を追加（normalizeBudgets／defaultState／migrate・facts 非出力の機械証明つき）"
```

---

### Task 2: 予算の純関数（`elapsedFraction`／`latestRow`／`budgetProgress`／`budgetTotals`）

**Files:**
- Modify: `money-rules.js`（Task 1 の `normalizeBudgets` の直後に追加／UMD return に追記）
- Test: `tests/money-budget.test.js`（追記）

**Interfaces:**
- Consumes: `normalizeBudgets`／`normName`／`num`／`clamp`／`_DATE_RE`／`_daysInMonth`／`cashflowRows`。
- Produces:
  - `R.elapsedFraction(period, nowMs) → 0..1 | null`
  - `R.latestRow(rows_in) → cashflowRows() の末尾行 | null`
  - `R.budgetProgress(budgets, row, nowMs) → { available, reason?, configured, period, isComplete, elapsed, elapsedPct, total:{budget,actual,pct,remaining,over,status}, items:[{name,budget,actual,pct,remaining,over,status,hasData}], unbudgeted:[{name,amount}], unbudgetedTotal, sumBudgeted, sumActualBudgeted, overCount, watchCount, hasBreakdown, breakdownMismatch, catsTotal }`
  - `R.budgetTotals(budgets) → { total, sumItems, count, itemsPct|null, overTotal }`（設定カードの注記用＝`money.js` で足し算をしない）
  - 内部ヘルパ `_budgetActualByName(row)`（Task 3 の `monthlyReport` も使う）

- [ ] **Step 1: 失敗するテストを書く（`tests/money-budget.test.js` 末尾の `module.exports` の直前に追記）**

```js
// ---- W3.5 §3.2 予算の純関数 ----
const NOW_AUG29 = Date.UTC(2026, 7, 29);   // 2026-08-29（8月は31日 → 29/31 ≒ 93.5%）
const NOW_APR15 = Date.UTC(2026, 3, 15);   // 2026-04-15（4月は30日 → ちょうど 50%）

test("elapsedFraction: 過去月1／未来月0／同月は day / 日数（UTC・D8）", () => {
  assert.equal(R.elapsedFraction("2026-07-01", NOW_AUG29), 1);
  assert.equal(R.elapsedFraction("2026-09-01", NOW_AUG29), 0);
  assert.ok(Math.abs(R.elapsedFraction("2026-08-01", NOW_AUG29) - 29 / 31) < 1e-12);
  assert.ok(Math.abs(R.elapsedFraction("2026-08-01", Date.UTC(2026, 7, 1)) - 1 / 31) < 1e-12);
  assert.equal(R.elapsedFraction("2026-08-01", Date.UTC(2026, 7, 31)), 1);          // 31日の月の末日
  assert.equal(R.elapsedFraction("2026-04-01", NOW_APR15), 0.5);                     // 30日の月
  assert.equal(R.elapsedFraction("2026-02-01", Date.UTC(2026, 1, 28)), 1);           // 28日の月
  assert.equal(R.elapsedFraction("2024-02-01", Date.UTC(2024, 1, 29)), 1);           // 閏29日
  assert.ok(Math.abs(R.elapsedFraction("2024-02-01", Date.UTC(2024, 1, 15)) - 15 / 29) < 1e-12);
  assert.equal(R.elapsedFraction("bogus", NOW_AUG29), null);
  assert.equal(R.elapsedFraction("2026-08", NOW_AUG29), null);
  assert.equal(R.elapsedFraction(null, NOW_AUG29), null);
  assert.equal(R.elapsedFraction("2026-08-01", 0), null);
  assert.equal(R.elapsedFraction("2026-08-01", NaN), null);
  assert.equal(R.elapsedFraction("2026-08-01", "x"), null);
});

test("latestRow: 正規化後の末尾行・不正行は捨てる・空は null", () => {
  const rows = [mkRow("2026-07-01"), mkRow("2026-06-01"), { period: "bad" }];
  assert.equal(R.latestRow(rows).period, "2026-07-01");
  assert.equal(R.latestRow(rows).isComplete, true);
  assert.equal(R.latestRow([mkRow("2026-08-01", { partial: true })]).isComplete, false);
  assert.equal(R.latestRow([]), null);
  assert.equal(R.latestRow(null), null);
});

const BUD = { total: 260000, items: [{ name: "食費", amount: 45000 }, { name: "外食費", amount: 20000 }] };
const CATS_AUG = [["食費", 41600], ["外食費", 24500], ["車・ガソリン", 12000], ["衣服", 8900], ["保険", 12000], ["書籍・教育", 2600]];
// budgetProgress / monthlyReport が受けるのは cashflowRows() 済みの行＝生 API 行は latestRow で正規化する。
const norm = (raw) => R.latestRow([raw]);
const ROW_AUG = norm(mkRow("2026-08-01", { partial: true, expense: 241300, fixed: 114000, cats: CATS_AUG }));

test("budgetProgress: row null／未設定／合計のみ／費目のみ", () => {
  const none = R.budgetProgress(BUD, null, NOW_AUG29);
  assert.deepEqual(none, { available: false, reason: "noRow", configured: true });
  assert.equal(R.budgetProgress(null, null, NOW_AUG29).configured, false);
  const unset = R.budgetProgress({ total: 0, items: [] }, ROW_AUG, NOW_AUG29);
  assert.equal(unset.available, true);
  assert.equal(unset.configured, false);
  assert.deepEqual(unset.total, { budget: 0, actual: 241300, pct: null, remaining: null, over: 0, status: "none" });
  assert.deepEqual(unset.items, []);
  assert.equal(unset.unbudgeted.length, 5);              // 上位5（全6費目のうち）
  assert.equal(unset.unbudgetedTotal, 101600);           // 全件合計（上位5だけでない）
  const totalOnly = R.budgetProgress({ total: 260000, items: [] }, ROW_AUG, NOW_AUG29);
  assert.equal(totalOnly.total.pct, 93);                 // 241,300 / 260,000
  assert.equal(totalOnly.total.remaining, 18700);
  assert.equal(totalOnly.total.over, 0);
  assert.equal(totalOnly.total.status, "watch");         // 進行中・93% ≥ 90
  const itemsOnly = R.budgetProgress({ total: 0, items: BUD.items }, ROW_AUG, NOW_AUG29);
  assert.equal(itemsOnly.total.status, "none");
  assert.equal(itemsOnly.items.length, 2);
});

test("budgetProgress: 経過率・費目の値と並び・同名合算・負値0・hasData", () => {
  const bp = R.budgetProgress(BUD, ROW_AUG, NOW_AUG29);
  assert.equal(bp.period, "2026-08-01");
  assert.equal(bp.isComplete, false);
  assert.equal(bp.elapsedPct, 94);                       // round(29/31*100)
  assert.equal(bp.total.pct, 93);
  assert.deepEqual(bp.items.map((i) => i.name), ["外食費", "食費"]);   // pct 降順（123 → 92）
  assert.deepEqual(bp.items[0], { name: "外食費", budget: 20000, actual: 24500, pct: 123, remaining: 0, over: 4500, status: "over", hasData: true });
  assert.deepEqual(bp.items[1], { name: "食費", budget: 45000, actual: 41600, pct: 92, remaining: 3400, over: 0, status: "watch", hasData: true });
  assert.equal(bp.overCount, 1);
  assert.equal(bp.watchCount, 1);
  assert.equal(bp.sumBudgeted, 65000);
  assert.equal(bp.sumActualBudgeted, 66100);
  assert.equal(bp.hasBreakdown, true);
  assert.equal(bp.catsTotal, 101600);          // 内訳の総額（予算あり/なしの両方を含む）
  // 同名は合算・負値は 0・名前ゴミは捨てる
  const dup = R.budgetProgress({ total: 0, items: [{ name: "食費", amount: 10000 }] },
    norm(mkRow("2026-08-01", { partial: true, cats: [["食費", 3000], ["食費", 4000], ["食費", -9000], ["", 5000]] })), NOW_AUG29);
  assert.equal(dup.items[0].actual, 7000);
  assert.equal(dup.items[0].hasData, true);
  // 内訳に出ない費目＝実績なし
  const nodata = R.budgetProgress({ total: 0, items: [{ name: "旧・雑貨", amount: 3000 }] }, ROW_AUG, NOW_AUG29);
  assert.deepEqual(nodata.items[0], { name: "旧・雑貨", budget: 3000, actual: 0, pct: 0, remaining: 3000, over: 0, status: "ok", hasData: false });
  // breakdown なしの行＝費目は全て実績なし・合計は見出し列で成立
  const noBd = R.budgetProgress(BUD, norm(mkRow("2026-07-01", { expense: 250000 })), NOW_AUG29);
  assert.equal(noBd.hasBreakdown, false);
  assert.equal(noBd.breakdownMismatch, false);
  assert.equal(noBd.items.every((i) => i.hasData === false), true);
  assert.equal(noBd.total.actual, 250000);
});

test("budgetProgress: status の境界（watch は ペース超過 OR 90% 接近・actual===budget は ok・確定月は watch なし）", () => {
  const row = (cats, partial) => norm(mkRow("2026-04-01", { partial: partial, expense: 200000, cats: cats }));
  const st = (actual, partial) => R.budgetProgress({ total: 0, items: [{ name: "x", amount: 10000 }] },
    row([["x", actual]], partial), NOW_APR15).items[0].status;
  assert.equal(st(6000, true), "ok");        // pct 60 === elapsedPct(50)+10 かつ <90
  assert.equal(st(6100, true), "watch");     // pct 61 > 60
  assert.equal(st(9000, true), "watch");     // pct 90（ペース超過でなくても接近で発火）
  assert.equal(st(5000, true), "ok");        // pct 50 ＝ 経過どおり
  assert.equal(st(8900, true), "watch");     // pct 89（90 未満でもペース超過なら watch）
  assert.equal(st(10000, true), "ok");       // actual === budget（毎月のアンバーを避ける）
  assert.equal(st(10001, true), "over");
  assert.equal(st(9000, false), "ok");       // 確定月は watch にならない
  assert.equal(st(10001, false), "over");
  assert.equal(R.budgetProgress({ total: 0, items: [{ name: "x", amount: 10000 }] }, row([["x", 6100]], true), NOW_APR15).elapsedPct, 50);
  // 進行中でも nowMs が読めなければ満月扱い（elapsed=1）
  const bad = R.budgetProgress({ total: 0, items: [{ name: "x", amount: 10000 }] }, row([["x", 6100]], true), 0);
  assert.equal(bad.elapsed, 1);
  assert.equal(bad.elapsedPct, 100);
});

test("budgetProgress: breakdownMismatch の閾値は max(1000, 1%)", () => {
  const mk = (catSum, expense) => R.budgetProgress(BUD,
    norm(mkRow("2026-07-01", { expense: expense, cats: [["食費", catSum]] })), NOW_AUG29);
  assert.equal(mk(100000, 100000).breakdownMismatch, false);
  assert.equal(mk(99000, 100000).breakdownMismatch, false);   // 差 1000 = max(1000, 1000) → 超えない
  assert.equal(mk(98999, 100000).breakdownMismatch, true);    // 差 1001
  assert.equal(mk(497000, 500000).breakdownMismatch, false);  // 差 3000 < 5000（1%）
  assert.equal(mk(494000, 500000).breakdownMismatch, true);   // 差 6000 > 5000
});

test("不変条件③: items[].actual の和 ≦ Σ breakdown.categories.amount", () => {
  [ROW_AUG, norm(mkRow("2026-07-01", { expense: 250000, cats: [["食費", 50000], ["外食費", 30000]] }))].forEach((row) => {
    const bp = R.budgetProgress(BUD, row, NOW_AUG29);
    assert.ok(bp.sumActualBudgeted <= bp.catsTotal, bp.sumActualBudgeted + " / " + bp.catsTotal);
  });
});

test("budgetTotals: 費目予算の合計・合計予算比・超過（money.js で足し算をしないための単一源）", () => {
  assert.deepEqual(R.budgetTotals(BUD), { total: 260000, sumItems: 65000, count: 2, itemsPct: 25, overTotal: 0 });
  assert.deepEqual(R.budgetTotals({ total: 50000, items: BUD.items }), { total: 50000, sumItems: 65000, count: 2, itemsPct: 130, overTotal: 15000 });
  assert.deepEqual(R.budgetTotals(null), { total: 0, sumItems: 0, count: 0, itemsPct: null, overTotal: 0 });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/money-budget.test.js`
Expected: 新規 8 件が FAIL（`R.elapsedFraction is not a function` 等）。Task 1 の 6 件は緑のまま。

- [ ] **Step 3: 実装（`money-rules.js`・Task 1 の `normalizeBudgets` の直後に追加）**

```js
  // §3.2 月の経過率（0..1）。過去月→1／未来月→0／同月→day / _daysInMonth（UTC・D8）。不正は null。
  function elapsedFraction(period, nowMs) {
    if (typeof period !== "string" || !_DATE_RE.test(period)) return null;
    var ms = num(nowMs);
    if (!(ms > 0)) return null;
    var nd = new Date(ms);
    if (!isFinite(nd.getTime())) return null;
    var cy = nd.getUTCFullYear();
    if (cy < 1 || cy > 9999) return null;
    var nowYM = cy * 12 + nd.getUTCMonth();
    var pYM = parseInt(period.slice(0, 4), 10) * 12 + (parseInt(period.slice(5, 7), 10) - 1);
    if (pYM < nowYM) return 1;
    if (pYM > nowYM) return 0;
    return clamp(nd.getUTCDate() / _daysInMonth(cy, nd.getUTCMonth() + 1), 0, 1);
  }

  // §3.2 fold「今月の予算」の対象行＝正規化後の末尾行（末尾が確定なら「進行中の月はまだありません」）。
  function latestRow(rows_in) {
    var rows = cashflowRows(rows_in);
    return rows.length ? rows[rows.length - 1] : null;
  }

  // 内訳（breakdown.categories）を名前正規化＋同名合算した一覧。負値は num() で 0（内訳の外から金額を作らない）。
  // list は入力順（＝並びは呼び元が決める）・byKey は "k:"+name の索引。
  function _budgetActualByName(row) {
    var cats = (row && row.breakdown && Array.isArray(row.breakdown.categories)) ? row.breakdown.categories : [];
    var list = [], byKey = {};
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i];
      if (!c || typeof c !== "object") continue;
      var name = normName(c.name);
      if (!name.length) continue;
      var amount = num(c.amount);
      var key = "k:" + name;
      if (Object.prototype.hasOwnProperty.call(byKey, key)) { byKey[key].amount += amount; }
      else { byKey[key] = { name: name, amount: amount }; list.push(byKey[key]); }
    }
    return { list: list, byKey: byKey };
  }

  // §3.2 その行に対する予算の消化。budgets は正規化前後どちらでも可。row は cashflowRows() の1行。
  function budgetProgress(budgets, row, nowMs) {
    var b = normalizeBudgets(budgets);
    var configured = b.total > 0 || b.items.length > 0;
    if (!row) return { available: false, reason: "noRow", configured: configured };
    var elapsed = row.isComplete ? 1 : elapsedFraction(row.period, nowMs);
    if (elapsed === null) elapsed = 1;                       // 進行中でも period 不正なら満月扱い
    var elapsedPct = Math.round(elapsed * 100);
    var acc = _budgetActualByName(row);
    var cats = acc.list;
    // watch＝「ペース超過（消化% > 経過%+10pt）」と「上限接近（消化% ≥ 90）」の OR。確定月は over/ok のみ。
    function statusOf(actual, budget) {
      if (!(budget > 0)) return "none";
      if (actual > budget) return "over";
      var pct = Math.round(actual / budget * 100);
      if (!row.isComplete && actual < budget && (pct > elapsedPct + 10 || pct >= 90)) return "watch";
      return "ok";
    }
    var totalActual = num(row.totalExpense);
    var total = b.total > 0
      ? { budget: b.total, actual: totalActual, pct: Math.round(totalActual / b.total * 100),
          remaining: Math.max(0, b.total - totalActual), over: Math.max(0, totalActual - b.total),
          status: statusOf(totalActual, b.total) }
      : { budget: 0, actual: totalActual, pct: null, remaining: null, over: 0, status: "none" };
    var budgetedKeys = {};
    var items = b.items.map(function (it) {
      var key = "k:" + it.name;
      budgetedKeys[key] = true;
      var has = Object.prototype.hasOwnProperty.call(acc.byKey, key);
      var actual = has ? acc.byKey[key].amount : 0;
      return { name: it.name, budget: it.amount, actual: actual,
        pct: Math.round(actual / it.amount * 100),
        remaining: Math.max(0, it.amount - actual), over: Math.max(0, actual - it.amount),
        status: statusOf(actual, it.amount), hasData: has };
    });
    items.sort(function (x, y) { return (y.pct - x.pct) || (y.budget - x.budget) || x.name.localeCompare(y.name); });
    var unbudgetedAll = cats.filter(function (c) {
      return c.amount > 0 && !Object.prototype.hasOwnProperty.call(budgetedKeys, "k:" + c.name);
    }).sort(function (x, y) { return (y.amount - x.amount) || x.name.localeCompare(y.name); });
    var unbudgetedTotal = 0;
    unbudgetedAll.forEach(function (c) { unbudgetedTotal += c.amount; });
    var sumBudgeted = 0, sumActualBudgeted = 0, overCount = 0, watchCount = 0;
    items.forEach(function (it) {
      sumBudgeted += it.budget; sumActualBudgeted += it.actual;
      if (it.status === "over") overCount++;
      else if (it.status === "watch") watchCount++;
    });
    var catsTotal = 0;
    cats.forEach(function (c) { catsTotal += c.amount; });
    var hasBreakdown = cats.length > 0;
    // ETL は見出し（月別集計DB）と内訳（生取引）を別 DB から取る＝ずれ得る。エラーにせず注記フラグ。
    var breakdownMismatch = hasBreakdown && Math.abs(catsTotal - totalActual) > Math.max(1000, totalActual * 0.01);
    return { available: true, reason: "", configured: configured, period: row.period, isComplete: row.isComplete,
      elapsed: elapsed, elapsedPct: elapsedPct, total: total, items: items,
      unbudgeted: unbudgetedAll.slice(0, 5).map(function (c) { return { name: c.name, amount: c.amount }; }),
      unbudgetedTotal: unbudgetedTotal, sumBudgeted: sumBudgeted, sumActualBudgeted: sumActualBudgeted,
      overCount: overCount, watchCount: watchCount, hasBreakdown: hasBreakdown,
      breakdownMismatch: breakdownMismatch, catsTotal: catsTotal };
  }

  // §4.2 設定カードの注記用（rows に依存しない＝未ログイン/未連携でも出せる）。money.js で合算しないための単一源。
  function budgetTotals(budgets) {
    var b = normalizeBudgets(budgets);
    var sumItems = 0;
    b.items.forEach(function (it) { sumItems += it.amount; });
    return { total: b.total, sumItems: sumItems, count: b.items.length,
      itemsPct: b.total > 0 ? Math.round(sumItems / b.total * 100) : null,
      overTotal: b.total > 0 ? Math.max(0, sumItems - b.total) : 0 };
  }
```

UMD return の W3.5 行を差し替え:

```js
    // W3.5 月次パック（UI 専用・facts 非出力）
    normName: normName, normalizeBudgets: normalizeBudgets, budgetTotals: budgetTotals,
    elapsedFraction: elapsedFraction, latestRow: latestRow, budgetProgress: budgetProgress,
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/money-budget.test.js`
Expected: 14 pass / fail 0

Run: `node --test tests/*.test.js`
Expected: 全 pass・fail 0

- [ ] **Step 5: コミット**

```bash
git add money-rules.js tests/money-budget.test.js
git commit -m "feat(w35): 予算の純関数 elapsedFraction/latestRow/budgetProgress/budgetTotals（watch は ペース超過 OR 90% 接近）"
```

---

### Task 3: レポートの純関数（`budgetCategoryStats`／`reportNav`／`monthlyReport`）

**Files:**
- Modify: `money-rules.js`（Task 2 の `budgetTotals` の直後に追加／UMD return に追記）
- Test: `tests/money-budget.test.js`（追記）

**Interfaces:**
- Consumes: `cashflowRows`／`_budgetActualByName`／`budgetProgress`／`assetSeries`／`_shiftYM`／`r`／`num`。
- Produces:
  - `R.budgetCategoryStats(rows_in, months) → { window, stats:[{name, avg12, avg3, months, last}] }`（`months` 省略/0 は 12）
  - `R.reportNav(rows_in, period) → { available, period, prev|null, next|null, latestComplete, isLatestComplete, isPartial }`
  - `R.monthlyReport(eff, rows_in, investmentRows_in, period, nowMs) → { available, reason, period, isComplete, nav, income, salary, misc, expense, fixed, variable, balance, savingsRatePct, mom, yoy, categories:{hasBreakdown,count,top,othersAmount}, budget, assets }`
    - `mom`／`yoy` ＝ `{ available, period, income:{delta,pct|null}, expense:{…}, balance:{…}, savingsRatePct:{delta,pct:null} }`（`available:false` のときは各項 `null`）
    - `assets` ＝ `{ available, reason, total, cash, invest, isComplete, beforeAnchor, delta|null, pct|null }`

- [ ] **Step 1: 失敗するテストを書く（`tests/money-budget.test.js` 末尾の `module.exports` の直前に追記）**

```js
// ---- W3.5 §3.2 レポートの純関数 ----
// 2026-03 〜 2026-08（末尾のみ暫定）。費目は毎月同じ3つ＋7月だけ「旅行」。
function repRows() {
  const cats = (f) => [["食費", 40000 + f], ["外食費", 20000 + f], ["光熱費", 10000 + f]];
  return [
    mkRow("2025-07-01", { income: 350000, expense: 250000, fixed: 140000, cats: cats(0) }),
    mkRow("2026-03-01", { income: 300000, expense: 240000, fixed: 140000, cats: cats(1000) }),
    mkRow("2026-04-01", { income: 300000, expense: 250000, fixed: 140000, cats: cats(2000) }),
    mkRow("2026-05-01", { income: 300000, expense: 260000, fixed: 140000, cats: cats(3000) }),
    mkRow("2026-06-01", { income: 400000, misc: 100000, expense: 270000, fixed: 140000, cats: cats(4000) }),
    mkRow("2026-07-01", { income: 350000, expense: 280000, fixed: 140000, cats: cats(5000).concat([["旅行", 50000]]) }),
    mkRow("2026-08-01", { partial: true, income: 350000, expense: 120000, fixed: 60000, cats: cats(0) }),
  ];
}
const REP_ROWS = repRows();
const REP_EFF = mkState({ anchor: { date: "2026-03-01", amount: 1000000 }, budgets: { total: 260000, items: [{ name: "食費", amount: 45000 }] } });

test("budgetCategoryStats: 窓の月数が分母・avg3・出現月数・末尾値・未確定行は除外", () => {
  const st = R.budgetCategoryStats(REP_ROWS, 12);
  assert.equal(st.window, 6);                                  // 確定 6 行（2026-08 は除外）
  assert.deepEqual(st.stats.map((s) => s.name), ["食費", "外食費", "光熱費", "旅行"]);   // avg12 降順
  const shoku = st.stats[0];
  assert.equal(shoku.months, 6);
  assert.equal(shoku.last, 45000);                             // 窓末尾（2026-07）の額
  assert.equal(shoku.avg12, Math.floor((40000 * 6 + 15000) / 6 + 0.5));
  assert.equal(shoku.avg3, Math.floor((43000 + 44000 + 45000) / 3 + 0.5));
  const ryoko = st.stats[3];
  assert.equal(ryoko.months, 1);                               // 1回だけ出た費目も「月あたり」に均す
  assert.equal(ryoko.avg12, Math.floor(50000 / 6 + 0.5));
  assert.equal(ryoko.avg3, Math.floor(50000 / 3 + 0.5));
  assert.equal(R.budgetCategoryStats(REP_ROWS, 3).window, 3);
  assert.equal(R.budgetCategoryStats(REP_ROWS).window, 6);     // months 省略＝12
  assert.deepEqual(R.budgetCategoryStats([], 12), { window: 0, stats: [] });
  assert.deepEqual(R.budgetCategoryStats([mkRow("2026-08-01", { partial: true })], 12), { window: 0, stats: [] });
});

test("reportNav: 不正 period は最新確定月／確定ゼロは末尾行／prev・next の端／isPartial", () => {
  const n = R.reportNav(REP_ROWS, "");
  assert.equal(n.available, true);
  assert.equal(n.period, "2026-07-01");
  assert.equal(n.latestComplete, "2026-07-01");
  assert.equal(n.isLatestComplete, true);
  assert.equal(n.isPartial, false);
  assert.equal(n.prev, "2026-06-01");
  assert.equal(n.next, "2026-08-01");
  assert.equal(R.reportNav(REP_ROWS, "2099-01-01").period, "2026-07-01");   // rows に無い＝最新確定月へ
  assert.equal(R.reportNav(REP_ROWS, "bogus").period, "2026-07-01");
  const first = R.reportNav(REP_ROWS, "2025-07-01");
  assert.equal(first.prev, null);                                            // 端（行の並びで前後・欠月は飛ばす）
  assert.equal(first.next, "2026-03-01");
  const last = R.reportNav(REP_ROWS, "2026-08-01");
  assert.equal(last.next, null);
  assert.equal(last.isPartial, true);
  assert.equal(last.isLatestComplete, false);
  const onlyPartial = R.reportNav([mkRow("2026-08-01", { partial: true })], "");
  assert.equal(onlyPartial.period, "2026-08-01");
  assert.equal(onlyPartial.latestComplete, "");
  assert.equal(R.reportNav([], "").available, false);
});

test("monthlyReport: 不変条件① 収支 fold と同じ balance / savingsRatePct", () => {
  const rep = R.monthlyReport(REP_EFF, REP_ROWS, [], "", NOW_AUG29);
  const cv = R.cashflowViewModel(REP_ROWS, REP_EFF, NOW_AUG29);
  assert.equal(rep.period, "2026-07-01");
  assert.equal(rep.balance, cv.balance);
  assert.equal(rep.savingsRatePct, cv.savingsRatePct);
  assert.equal(rep.income, 350000);
  assert.equal(rep.expense, 280000);
  assert.equal(rep.fixed, 140000);
  assert.equal(rep.variable, 140000);
  assert.equal(rep.savingsRatePct, Math.round(70000 / 350000 * 100));
});

test("monthlyReport: 不変条件② assets は assetSeries の同月点と一致（推移カードと同じ数字）", () => {
  const rep = R.monthlyReport(REP_EFF, REP_ROWS, [], "", NOW_AUG29);
  const s = R.assetSeries(REP_EFF, REP_ROWS, []);
  const p = s.points.find((q) => q.period === "2026-07-01");
  const prev = s.points.find((q) => q.period === "2026-06-01");
  assert.equal(rep.assets.available, true);
  assert.equal(rep.assets.total, p.total);
  assert.equal(rep.assets.cash, p.cash);
  assert.equal(rep.assets.invest, p.invest);
  assert.equal(rep.assets.delta, p.total - prev.total);
  assert.equal(rep.assets.pct, Math.round((p.total - prev.total) / Math.abs(prev.total) * 1000) / 10);
});

test("monthlyReport: mom / yoy（欠月は available:false・pct null・貯蓄率は pt）", () => {
  const rep = R.monthlyReport(REP_EFF, REP_ROWS, [], "", NOW_AUG29);
  assert.equal(rep.mom.available, true);
  assert.equal(rep.mom.period, "2026-06-01");
  assert.deepEqual(rep.mom.income, { delta: -50000, pct: -12.5 });
  assert.deepEqual(rep.mom.expense, { delta: 10000, pct: 3.7 });
  assert.deepEqual(rep.mom.balance, { delta: -60000, pct: -46.2 });
  assert.deepEqual(rep.mom.savingsRatePct, { delta: 20 - 33, pct: null });   // 20% − 33%
  assert.equal(rep.yoy.available, true);                                      // 12 ヶ月前＝2025-07-01 が実在
  assert.equal(rep.yoy.period, "2025-07-01");
  assert.deepEqual(rep.yoy.expense, { delta: 30000, pct: 12 });
  assert.deepEqual(rep.yoy.income, { delta: 0, pct: 0 });
  const march = R.monthlyReport(REP_EFF, REP_ROWS, [], "2026-03-01", NOW_AUG29);
  assert.equal(march.mom.available, false);                                   // 2026-02 は無い（欠月）
  assert.equal(march.mom.income, null);
  assert.equal(march.yoy.available, false);
  // prev が 0 のとき pct は null
  const zeroRows = [mkRow("2026-06-01", { income: 100000, expense: 100000 }), mkRow("2026-07-01", { income: 100000, expense: 90000 })];
  const z = R.monthlyReport(REP_EFF, zeroRows, [], "2026-07-01", NOW_AUG29);
  assert.equal(z.mom.balance.pct, null);
  assert.equal(z.mom.balance.delta, 10000);
});

test("monthlyReport: categories は上位8＋その他・構成比・前月比（前月内訳なしは null）", () => {
  const rep = R.monthlyReport(REP_EFF, REP_ROWS, [], "2026-07-01", NOW_AUG29);
  assert.equal(rep.categories.hasBreakdown, true);
  assert.equal(rep.categories.count, 4);
  assert.deepEqual(rep.categories.top.map((c) => c.name), ["旅行", "食費", "外食費", "光熱費"]);
  assert.equal(rep.categories.top[1].amount, 45000);
  assert.equal(rep.categories.top[1].sharePct, Math.round(45000 / 280000 * 100));
  assert.equal(rep.categories.top[1].delta, 1000);      // 45,000 − 44,000
  assert.equal(rep.categories.top[0].delta, 50000);     // 前月に無い費目＝0 からの差
  assert.equal(rep.categories.othersAmount, 0);
  // 9費目なら 8 行＋その他
  const many = [];
  for (let i = 0; i < 9; i++) many.push(["c" + i, 10000 - i * 100]);
  const wide = R.monthlyReport(REP_EFF, [mkRow("2026-07-01", { expense: 200000, cats: many })], [], "2026-07-01", NOW_AUG29);
  assert.equal(wide.categories.top.length, 8);
  assert.equal(wide.categories.othersAmount, 9200);
  assert.equal(wide.categories.top[0].delta, null);     // 前月行なし
  // 内訳なしの月
  const bare = R.monthlyReport(REP_EFF, [mkRow("2026-07-01", { expense: 200000 })], [], "2026-07-01", NOW_AUG29);
  assert.equal(bare.categories.hasBreakdown, false);
  assert.deepEqual(bare.categories.top, []);
});

test("monthlyReport: assets の非 available（noAnchor / noPoint / beforeAnchor）と rows 0", () => {
  const noAnchor = R.monthlyReport(mkState({ anchor: null }), REP_ROWS, [], "", NOW_AUG29);
  assert.deepEqual(noAnchor.assets, { available: false, reason: "noAnchor" });
  // アンカーより前の月＝逆算（beforeAnchor）
  const back = R.monthlyReport(REP_EFF, REP_ROWS, [], "2025-07-01", NOW_AUG29);
  assert.equal(back.assets.available, false);          // 欠月で後方打切＝系列に含まれない
  assert.equal(back.assets.reason, "noPoint");
  const near = R.monthlyReport(mkState({ anchor: { date: "2026-06-01", amount: 1000000 } }), REP_ROWS, [], "2026-05-01", NOW_AUG29);
  assert.equal(near.assets.available, true);
  assert.equal(near.assets.beforeAnchor, true);
  const noRows = R.monthlyReport(REP_EFF, [], [], "", NOW_AUG29);
  assert.equal(noRows.available, false);
  assert.equal(noRows.reason, "noRows");
});

test("monthlyReport: budget は budgetProgress と同値（選択月の行に対して）", () => {
  const rep = R.monthlyReport(REP_EFF, REP_ROWS, [], "2026-07-01", NOW_AUG29);
  const direct = R.budgetProgress(REP_EFF.budgets, R.latestRow(REP_ROWS.filter((r) => r.period === "2026-07-01")), NOW_AUG29);
  assert.deepEqual(rep.budget, direct);
  assert.equal(rep.budget.isComplete, true);
});
```

- [ ] **Step 2: 失敗を確認**

Run: `node --test tests/money-budget.test.js`
Expected: 新規 8 件が FAIL（`R.budgetCategoryStats is not a function` 等）。Task 1〜2 の 14 件は緑のまま。

- [ ] **Step 3: 実装（`money-rules.js`・Task 2 の `budgetTotals` の直後に追加）**

```js
  // §3.2 設定カードの費目一覧の源。平均の分母は**窓の月数**（出現しない月＝0）＝年1回の費目も「月あたり」に均す。
  // 確定月のみ（進行中月を混ぜると過小・§6 注意6）。
  function budgetCategoryStats(rows_in, months) {
    var n = num(months) > 0 ? Math.floor(num(months)) : 12;
    var complete = cashflowRows(rows_in).filter(function (rr) { return rr.isComplete; });
    var win = complete.slice(-n);
    if (!win.length) return { window: 0, stats: [] };
    var lastPeriod = win[win.length - 1].period;
    var last3 = {};
    win.slice(-3).forEach(function (rr) { last3["p:" + rr.period] = true; });
    var acc = {}, order = [];
    win.forEach(function (rr) {
      var inLast3 = Object.prototype.hasOwnProperty.call(last3, "p:" + rr.period);
      _budgetActualByName(rr).list.forEach(function (c) {
        var key = "k:" + c.name;
        if (!Object.prototype.hasOwnProperty.call(acc, key)) {
          acc[key] = { name: c.name, sum12: 0, sum3: 0, present: 0, last: 0 };
          order.push(key);
        }
        var a = acc[key];
        a.sum12 += c.amount;
        if (inLast3) a.sum3 += c.amount;
        if (c.amount > 0) a.present += 1;
        if (rr.period === lastPeriod) a.last = c.amount;
      });
    });
    var denom3 = Math.min(3, win.length);
    var stats = order.map(function (key) {
      var a = acc[key];
      return { name: a.name, avg12: r(a.sum12 / win.length), avg3: r(a.sum3 / denom3), months: a.present, last: a.last };
    });
    stats.sort(function (x, y) { return (y.avg12 - x.avg12) || x.name.localeCompare(y.name); });
    return { window: win.length, stats: stats };
  }

  // §3.2 選択月の正規化と前後移動。前後は**行の並び**（欠月は飛ばす）。前月比/前年同月比は暦（_shiftYM）で引く。
  function reportNav(rows_in, period) {
    var rows = cashflowRows(rows_in);
    if (!rows.length) {
      return { available: false, period: "", prev: null, next: null, latestComplete: "", isLatestComplete: false, isPartial: false };
    }
    var latestComplete = "";
    for (var i = rows.length - 1; i >= 0; i--) { if (rows[i].isComplete) { latestComplete = rows[i].period; break; } }
    var idx = -1, j;
    if (typeof period === "string" && _DATE_RE.test(period)) {
      for (j = 0; j < rows.length; j++) { if (rows[j].period === period) { idx = j; break; } }
    }
    if (idx < 0) {
      var sel = latestComplete || rows[rows.length - 1].period;
      for (j = 0; j < rows.length; j++) { if (rows[j].period === sel) { idx = j; break; } }
    }
    return { available: true, period: rows[idx].period,
      prev: idx > 0 ? rows[idx - 1].period : null,
      next: idx < rows.length - 1 ? rows[idx + 1].period : null,
      latestComplete: latestComplete, isLatestComplete: rows[idx].period === latestComplete,
      isPartial: !rows[idx].isComplete };
  }

  function _round1(x) { return Math.round(x * 10) / 10; }
  function _repDelta(cur, prev) {
    var d = cur - prev;
    return { delta: d, pct: prev !== 0 ? _round1(d / Math.abs(prev) * 100) : null };
  }
  // 単月の貯蓄率（cashflowViewModel の monthSavings と同式＝不変条件①）。
  function _repSavingsPct(row) { return row.totalIncome > 0 ? Math.round(row.balance / row.totalIncome * 100) : 0; }

  // §3.2 月次レポート本体の VM。eff は effectiveState 済み（eff.budgets === state.budgets）。
  function monthlyReport(eff, rows_in, investmentRows_in, period, nowMs) {
    var nav = reportNav(rows_in, period);
    if (!nav.available) return { available: false, reason: "noRows", nav: nav };
    var rows = cashflowRows(rows_in), byPeriod = {};
    rows.forEach(function (rr) { byPeriod["p:" + rr.period] = rr; });
    var row = byPeriod["p:" + nav.period];
    var prevP = _shiftYM(nav.period, -1);
    var prevRow = byPeriod["p:" + prevP] || null;
    var yoyRow = byPeriod["p:" + _shiftYM(nav.period, -12)] || null;
    var savingsRatePct = _repSavingsPct(row);
    function cmp(other) {
      if (!other) return { available: false, period: "", income: null, expense: null, balance: null, savingsRatePct: null };
      return { available: true, period: other.period,
        income: _repDelta(row.totalIncome, other.totalIncome),
        expense: _repDelta(row.totalExpense, other.totalExpense),
        balance: _repDelta(row.balance, other.balance),
        savingsRatePct: { delta: savingsRatePct - _repSavingsPct(other), pct: null } };   // 貯蓄率は pt（§6 注意5）
    }
    var acc = _budgetActualByName(row);
    var cats = acc.list.slice().sort(function (x, y) { return (y.amount - x.amount) || x.name.localeCompare(y.name); });
    var prevAcc = prevRow ? _budgetActualByName(prevRow) : null;
    var prevHas = !!(prevAcc && prevAcc.list.length);
    var expense = row.totalExpense;
    var top = cats.slice(0, 8).map(function (c) {
      var pk = "k:" + c.name;
      return { name: c.name, amount: c.amount,
        sharePct: expense > 0 ? Math.round(c.amount / expense * 100) : 0,
        delta: prevHas ? c.amount - (Object.prototype.hasOwnProperty.call(prevAcc.byKey, pk) ? prevAcc.byKey[pk].amount : 0) : null };
    });
    var othersAmount = 0;
    cats.slice(8).forEach(function (c) { othersAmount += c.amount; });
    var series = assetSeries(eff, rows_in, investmentRows_in);
    var point = null, prevPoint = null;
    series.points.forEach(function (p) {
      if (p.period === nav.period) point = p;
      if (p.period === prevP) prevPoint = p;
    });
    var assets;
    if (!series.available) assets = { available: false, reason: series.reason };
    else if (!point) assets = { available: false, reason: "noPoint" };   // 打切の外・アンカー前の逆算不能月
    else assets = { available: true, reason: "", total: point.total, cash: point.cash, invest: point.invest,
      isComplete: point.isComplete, beforeAnchor: point.beforeAnchor,
      delta: prevPoint ? point.total - prevPoint.total : null,
      pct: (prevPoint && prevPoint.total !== 0) ? _round1((point.total - prevPoint.total) / Math.abs(prevPoint.total) * 100) : null };
    return { available: true, reason: "", period: nav.period, isComplete: row.isComplete, nav: nav,
      income: row.totalIncome, salary: row.salaryIncome, misc: row.miscIncome, expense: expense,
      fixed: row.fixedExpense, variable: row.variableExpense, balance: row.balance, savingsRatePct: savingsRatePct,
      mom: cmp(prevRow), yoy: cmp(yoyRow),
      categories: { hasBreakdown: cats.length > 0, count: cats.length, top: top, othersAmount: othersAmount },
      budget: budgetProgress(eff && eff.budgets, row, nowMs), assets: assets };
  }
```

UMD return の W3.5 行を差し替え:

```js
    // W3.5 月次パック（UI 専用・facts 非出力）
    normName: normName, normalizeBudgets: normalizeBudgets, budgetTotals: budgetTotals,
    elapsedFraction: elapsedFraction, latestRow: latestRow, budgetProgress: budgetProgress,
    budgetCategoryStats: budgetCategoryStats, reportNav: reportNav, monthlyReport: monthlyReport,
```

- [ ] **Step 4: テストが通ることを確認**

Run: `node --test tests/money-budget.test.js`
Expected: 22 pass / fail 0

Run: `node --test tests/*.test.js`
Expected: 全 pass・fail 0

Run: `git diff --stat -- api/ tests/fixtures/ index.html`
Expected: 出力なし

- [ ] **Step 5: コミット**

```bash
git add money-rules.js tests/money-budget.test.js
git commit -m "feat(w35): レポートの純関数 budgetCategoryStats/reportNav/monthlyReport（収支 fold・推移カードとの不変条件つき）"
```

---

### Task 4: 設定・ガイドタブ「月の予算」カード

**Files:**
- Modify: `money.js`（`adoptAvgExpense` の直後にハンドラ3本／`cfgCard` の直後に `budgetCard`／`_JUMP_TARGETS`／`render()` の VM と `configHtml`／`window.MCC` return）
- Modify: `money.css`（末尾に `.mcc-bud-table` 系）

**Interfaces:**
- Consumes: `R.normalizeBudgets`／`R.normName`／`R.budgetCategoryStats`／`R.budgetTotals`／`R.yen`／既存 `cfgCard`／`moneyInput`／`setField`／`_renderAfterEdit`／`jumpLink`／`esc`。
- Produces: `MCC.setBudgetItem(name, value)`／`MCC.adoptBudgetItemAvg(name)`／`MCC.adoptBudgetTotalAvg()`、DOM: `#mcc-sec-budget-card`（`.mcc-cfg-card`）＞ `.mcc-bud-total`（`input[data-mcc-focus="budgets.total"]`）／`table.mcc-bud-table`（`input[data-mcc-focus^="budgets.item:"]`・`tr.mcc-bud-nodata`）／`.mcc-bud-note`。`_JUMP_TARGETS.budget`。

- [ ] **Step 1: `money.js` にハンドラを追加（`adoptAvgExpense` 関数の閉じ `}` の直後・`// ---- 描画 ----` コメントの直前）**

```js
  // ==== W3.5 月次パック（spec §4）: 月の予算。数値・並び・状態は全て R.* 由来（money.js に業務 math を書かない）====
  // 費目の予算を設定/更新/削除（0 を入れると削除＝normalizeBudgets の規約）。正規化は rules に一本化する。
  function setBudgetItem(name, value) {
    if (!state) load();
    var b = R.normalizeBudgets(state.budgets);
    var n = R.normName(name);
    if (!n) return;
    var amount = Number(value) >= 0 ? Number(value) : 0;
    var items = [], replaced = false;
    for (var i = 0; i < b.items.length; i++) {
      if (b.items[i].name === n) {
        replaced = true;
        if (amount > 0) items.push({ name: n, amount: amount });   // 0 は積まない＝要素ごと消える
      } else {
        items.push({ name: b.items[i].name, amount: b.items[i].amount });
      }
    }
    if (!replaced && amount > 0) items.push({ name: n, amount: amount });
    state.budgets = R.normalizeBudgets({ total: b.total, items: items });
    save();
    _renderAfterEdit();   // setField と同じ再描画経路（data-mcc-focus="budgets.item:<name>" でフォーカス復元）
  }
  // 費目の予算に「直近3ヶ月平均（確定月のみ）」を採用。平均は R.budgetCategoryStats 由来（ここで平均を作らない）。
  function adoptBudgetItemAvg(name) {
    var n = R.normName(name);
    if (!n) return;
    var stats = R.budgetCategoryStats(_cashflowRows, 12).stats;
    for (var i = 0; i < stats.length; i++) {
      if (stats[i].name === n) { if (stats[i].avg3 > 0) setBudgetItem(n, stats[i].avg3); return; }
    }
  }
  // 合計予算に実支出の平均を採用（adoptAvgExpense と同型・既存 setField で足りる）。
  function adoptBudgetTotalAvg() {
    if (!sync.loggedIn) return;
    var cv = R.cashflowViewModel(_cashflowRows, state, Date.now());
    if (!cv.hasData || !(cv.avgExpense > 0)) return;
    setField("budgets.total", cv.avgExpense);
  }
```

- [ ] **Step 2: `money.js` に `budgetCard` を追加（`cfgCard` 関数の閉じ `}` の直後・`// ---- D1: #mcc-root 内 2タブ` コメントの直前）**

```js
  // §4.2 設定・ガイドタブ「月の予算」カード。stats=R.budgetCategoryStats(_cashflowRows, 12)／cv=R.cashflowViewModel。
  // 入力欄は readout gate ではない＝未ログインでも編集可（NISA 入力と同じ規律）。¥の読み出しは cv.available のときだけ。
  function budgetCard(stats, cv) {
    var b = R.normalizeBudgets(state.budgets);
    var bt = R.budgetTotals(state.budgets);
    var byName = {}, seen = {};
    b.items.forEach(function (it) { byName["k:" + it.name] = it.amount; });

    // ① 合計行
    var totalRead = "";
    if (cv.available && cv.avgExpense > 0) {
      totalRead = '<div class="mcc-bud-readout">実支出の平均は <strong>' + R.yen(cv.avgExpense) + '/月</strong>（直近3ヶ月・確定月のみ）' +
        (bt.total === cv.avgExpense
          ? '<span class="mcc-bud-applied">✓ 設定と一致</span>'
          : '<button type="button" class="mcc-bud-adopt" onclick="MCC.adoptBudgetTotalAvg()">平均を採用</button>') +
        '</div>';
    }
    var totalRow = '<div class="mcc-bud-total">' + moneyInput("月の支出予算（合計）", "budgets.total", bt.total) + totalRead + '</div>';

    // ② 費目テーブル（stats の平均額順 ∪ stats に無い設定済み費目＝末尾）
    var rows = stats.stats.map(function (s) {
      seen["k:" + s.name] = true;
      return { name: s.name, avg3: s.avg3, budget: byName["k:" + s.name] || 0, noData: false };
    });
    b.items.forEach(function (it) {
      if (!Object.prototype.hasOwnProperty.call(seen, "k:" + it.name)) {
        rows.push({ name: it.name, avg3: 0, budget: it.amount, noData: true });
      }
    });
    var trs = rows.map(function (rw) {
      var nm = esc(rw.name);
      return '<tr' + (rw.noData ? ' class="mcc-bud-nodata"' : '') + '>' +
        '<th scope="row">' + nm + (rw.noData ? '<span class="mcc-bud-nodata-tag">直近12ヶ月に実績なし</span>' : '') + '</th>' +
        '<td data-label="直近3ヶ月平均">' + ((cv.available && rw.avg3 > 0) ? R.yen(rw.avg3) : '—') + '</td>' +
        '<td data-label="予算"><input type="number" min="0" step="1000" value="' + rw.budget + '" ' +
          'data-mcc-focus="budgets.item:' + nm + '" onchange="MCC.setBudgetItem(\'' + nm + '\', this.value)"></td>' +
        '<td data-label="平均を採用">' + ((cv.available && rw.avg3 > 0)
          ? '<button type="button" class="mcc-bud-adopt" onclick="MCC.adoptBudgetItemAvg(\'' + nm + '\')">平均を採用</button>'
          : '') + '</td>' +
      '</tr>';
    }).join("");
    var table = rows.length
      ? '<table class="mcc-bud-table"><thead><tr><th>費目</th><th>直近3ヶ月平均</th><th>予算</th><th></th></tr></thead>' +
        '<tbody>' + trs + '</tbody></table>' +
        '<div class="mcc-bud-note">0 を入れると予算を消します</div>'
      : '';

    // ③ 注記
    var notes = "";
    if (stats.window === 0) {
      notes += '<div class="mcc-bud-note">収支を連携すると、直近12ヶ月に使った費目が自動で並びます</div>';
    }
    if (bt.total > 0) {
      notes += '<div class="mcc-bud-note">費目の合計 ' + R.yen(bt.sumItems) + '（合計予算の ' + bt.itemsPct + '%）' +
        (bt.overTotal > 0 ? '（合計予算を ' + R.yen(bt.overTotal) + ' 上回っています）' : '') + '</div>';
    }
    return cfgCard("mcc-sec-budget-card", "月の予算",
      'kakeibo の費目ごとの月額と合計。ダッシュボードの「今月の予算」と月次レポートの予算 vs 実績に使います。',
      totalRow + table + notes);
  }
```

- [ ] **Step 3: `money.js` の配線（3箇所）**

(a) `_JUMP_TARGETS`（`series:` 行の直後）に追加:

```js
    budget:      { id: "mcc-sec-budget-card",    tab: "config" },
```

(b) `render()` の VM 生成部（`var gol = vm.goals.map(...)` の直後）に追加:

```js
    // W3.5: 予算 vs 実績・月次レポートの VM（全て純関数・facts 非出力）。
    var bstats = R.budgetCategoryStats(_cashflowRows, 12);
```

(c) `configHtml`（`render()` 内）を差し替え＝`settings` の直後に `budgetCard(bstats, cv)` を挿入:

```js
    var configHtml = saveWarn + anchorCard(cv, cdMain) + settings + budgetCard(bstats, cv) + buckets +
      assetInputCard() + nisaInputCard(nvm) + reservesGoalsAddCard(vm) + tools + guideSection();
```

(d) 公開面（`money.js` 末尾 `return {`）の `setSeriesPeriod: setSeriesPeriod,` の直後に追加:

```js
    setBudgetItem: setBudgetItem, adoptBudgetItemAvg: adoptBudgetItemAvg, adoptBudgetTotalAvg: adoptBudgetTotalAvg,
```

- [ ] **Step 4: `money.css` 末尾に追加**

```css
/* ==== W3.5 月次パック: 設定タブ「月の予算」カード（spec §5）==== */
.mcc-bud-total { margin-bottom: 12px; }
.mcc-bud-readout { color: var(--c-text-dim); font-size: 12px; margin-top: 6px; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.mcc-bud-readout strong { color: var(--c-text); font-weight: 700; }
.mcc-bud-applied { color: var(--c-emerald-soft); font-size: 12px; font-weight: 700; }
.mcc-bud-adopt {
  background: rgba(56,189,248,0.14); border: 1px solid rgba(56,189,248,0.38); color: var(--c-cyan-pale);
  padding: 3px 9px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 700;
}
.mcc-bud-adopt:hover { background: rgba(56,189,248,0.24); }
.mcc-bud-table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 10px; }
.mcc-bud-table th, .mcc-bud-table td { padding: 4px 6px; text-align: right; }
.mcc-bud-table thead th { color: var(--c-text-dim); font-weight: normal; font-size: 12px; }
.mcc-bud-table tbody th { text-align: left; color: var(--c-text-bright); }
.mcc-bud-table input { width: 100%; min-width: 72px; background: rgba(0,0,0,0.3);
  border: 1px solid rgba(129,140,248,0.3); color: #fff; border-radius: 6px; padding: 5px 7px; font-size: 0.8rem; }
.mcc-bud-nodata-tag { color: var(--c-text-faint); font-size: 12px; margin-left: 6px; font-family: var(--ix-sans); letter-spacing: 0; }
.mcc-bud-note { color: var(--c-text-faint); font-size: 12px; line-height: 1.5; margin-top: 8px; font-family: var(--ix-sans); letter-spacing: 0; }
@media (max-width: 600px) {
  .mcc-bud-table, .mcc-bud-table tbody, .mcc-bud-table tr, .mcc-bud-table td, .mcc-bud-table th { display: block; }
  .mcc-bud-table thead { display: none; }
  .mcc-bud-table tr { border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 8px; margin-bottom: 8px; }
  .mcc-bud-table td::before { content: attr(data-label); float: left; color: var(--c-text-dim); font-size: 12px; }
}
```

- [ ] **Step 5: 構文と既存受入**

Run: `node --check money.js && echo OK`
Expected: OK

Run: `node --test tests/*.test.js`
Expected: 全 pass（rules は不変）

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js`
Expected: `ALL PASS`・`pageerrors=0`（設定タブの input が増えるだけ＝`dashInputCount` は 0 のまま・`configHoldingInputs`／`configNisaInputs` は接頭辞一致で不変。もし赤が出たら Task 7 でなく**ここで**原因を読む）

- [ ] **Step 6: コミット**

```bash
git add money.js money.css
git commit -m "feat(w35): 設定・ガイドタブに「月の予算」カード（合計＋費目テーブル・平均を採用・0 で削除）"
```

---

### Task 5: ダッシュボード fold「今月の予算」

**Files:**
- Modify: `money.js`（`seriesSection` の直後に `budgetBars`／`budgetLiveSection`／`_FOLD_DEFAULT_OPEN`／`_JUMP_TARGETS`／`render()` の VM と `dashHtml`）
- Modify: `money.css`（末尾に `.mcc-bud-row` 系）

**Interfaces:**
- Consumes: `R.latestRow`／`R.budgetProgress`／`R.yen`／既存 `foldSection`／`jumpLink`／`fmtAnchorMonth`／`esc`／`sync.loggedIn`。
- Produces: `budgetBars(bp, opts)`（Task 6 のレポートも使う・`opts = { tick, compareNote }`）、DOM: `details#mcc-sec-budget-live.mcc-fold.mcc-fold-budget` ＞ `.mcc-budget` ＞ `.mcc-bud-head`／`.mcc-bud-row.mcc-bud-row-total|-item` ＞ `.mcc-bud-bar > .mcc-bud-fill.ok|watch|over|none` ＋ `.mcc-bud-tick`／`.mcc-bud-unbud > .mcc-bud-chip`／`.mcc-bud-note`。`_JUMP_TARGETS.budgetLive`。

- [ ] **Step 1: `money.js` に `budgetBars`／`budgetLiveSection` を追加（`seriesSection` 関数の閉じ `}` の直後・`// W3: リマインド帯` コメントの直前）**

```js
  // §4.5 予算バー（合計＋費目）。数値・並び・状態は bp 由来＝ここは幅%と文言だけを組む（業務 math 禁）。
  function budgetBars(bp, opts) {
    opts = opts || {};
    function bar(cls, label, it, tick) {
      var noData = (it.hasData === false);
      var val = noData ? '実績なし'
        : (it.budget > 0 ? R.yen(it.actual) + ' / ' + R.yen(it.budget) + '（' + it.pct + '%）' : R.yen(it.actual));
      var right = (noData || !(it.budget > 0)) ? ''
        : (it.over > 0 ? '<span class="mcc-bud-over">超過 ' + R.yen(it.over) + '</span>'
                       : '<span class="mcc-bud-rem">残り ' + R.yen(it.remaining) + '</span>');
      var w = (noData || !(it.budget > 0)) ? 0 : Math.min(100, it.pct);
      return '<div class="mcc-bud-row ' + cls + '">' +
        '<span class="mcc-bud-lbl">' + esc(label) + '</span>' +
        '<span class="mcc-bud-val">' + val + right + '</span>' +
        '<span class="mcc-bud-bar"><span class="mcc-bud-fill ' + it.status + '" style="width:' + w + '%"></span>' +
          (tick ? '<span class="mcc-bud-tick" style="left:' + bp.elapsedPct + '%"></span>' : '') +
        '</span>' +
      '</div>';
    }
    var tick = !!opts.tick;
    var out = "";
    if (bp.total && bp.total.budget > 0) out += bar("mcc-bud-row-total", "支出 合計", bp.total, tick);
    out += bp.items.map(function (it) { return bar("mcc-bud-row-item", it.name, it, tick); }).join("");
    if (opts.compareNote) out += '<div class="mcc-bud-note">現在の予算で比較しています</div>';
    return out;
  }

  // §4.3 ダッシュボード fold「今月の予算」。描画ゲート＝ログイン済み＋収支あり（未連携 CTA は収支 fold に一本化）。
  function budgetLiveSection(bp, cv) {
    if (!sync.loggedIn || !cv.available || !bp || !bp.available) return "";
    var chips = bp.unbudgeted.map(function (c) {
      return '<span class="mcc-bud-chip">' + esc(c.name) + ' ' + R.yen(c.amount) + '</span>';
    }).join("");
    if (!bp.configured) {
      return foldSection("mcc-sec-budget-live", "mcc-fold-budget", "今月の予算", '<b>未設定</b>',
        '<div class="mcc-budget">' +
          '<div class="mcc-bud-cta">費目ごとの月額を設定すると、今月の消化がここに出ます。' + jumpLink("budget", "「月の予算」") + '</div>' +
          (chips ? '<div class="mcc-bud-unbud">' + chips + '</div>' : '') +
        '</div>');
    }
    var head = '<div class="mcc-bud-head"><span class="mcc-bud-period">' + esc(fmtAnchorMonth(bp.period)) + '</span>' +
      (bp.isComplete ? '<span class="mcc-cf-latest">（確定）</span>'
                     : '<span class="mcc-cf-partial">（進行中・月の ' + bp.elapsedPct + '% 経過）</span>') + '</div>' +
      (bp.isComplete ? '<div class="mcc-bud-note">進行中の月のデータはまだありません（最新の確定月を表示）</div>' : '');
    var unbud = bp.unbudgeted.length
      ? '<div class="mcc-bud-unbud">予算なしの費目 ' + R.yen(bp.unbudgetedTotal) + '：' + chips +
        jumpLink("budget", "「月の予算」で設定") + '</div>'
      : '';
    var mism = bp.breakdownMismatch
      ? '<div class="mcc-bud-note">内訳の合計（' + R.yen(bp.catsTotal) + '）と支出合計（' + R.yen(bp.total.actual) + '）が一致していません</div>'
      : '';
    var digest = (bp.total.budget > 0 ? '消化 <b>' + bp.total.pct + '%</b>' : '費目 <b>' + bp.items.length + '件</b>') +
      (bp.isComplete ? '（確定）' : '・月 ' + bp.elapsedPct + '% 経過') +
      (bp.overCount > 0 ? '・超過 ' + bp.overCount + '費目' : '');
    return foldSection("mcc-sec-budget-live", "mcc-fold-budget", "今月の予算", digest,
      '<div class="mcc-budget">' + head + budgetBars(bp, { tick: !bp.isComplete }) + unbud + mism + '</div>');
  }
```

- [ ] **Step 2: `money.js` の配線（3箇所）**

(a) `_FOLD_DEFAULT_OPEN` を差し替え（`_restoreDetails()` は登録が無いと初回 closed になる＝§6 注意3）:

```js
  var _FOLD_DEFAULT_OPEN = { "mcc-sec-cashflow": true, "mcc-sec-series": true, "mcc-sec-budget-live": true,
    "mcc-sec-settings": true, "mcc-ac-input": true, "mcc-nisa-input": true };
```

(b) `_JUMP_TARGETS` の `budget:` 行の直後に追加:

```js
    budgetLive:  { id: "mcc-sec-budget-live",    tab: "dash" },
```

(c) `render()` の VM 生成部（Task 4 で足した `var bstats = …` の直後）に追加:

```js
    var liveRow = R.latestRow(_cashflowRows);
    var bp = R.budgetProgress(eff.budgets, liveRow, now);
```

(d) `dashHtml` を差し替え（`cashflowSection(cv)` の直後に挿入）:

```js
    var dashHtml = syncBar() + saveWarn + stepperSection(ob) + heroSection(vm, cv, cdMain, mom, rw) +
      reminderRail(rem) + seriesSection(series, mom, span, _seriesPeriod) +
      cashflowSection(cv) + budgetLiveSection(bp, cv) + roadmapSection(rm, sync.loggedIn) + nisaSection(nvm, nrem) +
      assetClassSection(vm) + reservesGoalsSection(vm, cv, cdMain, gol, rol, cd.monthlySurplus) + adviceSection(vm);
```

- [ ] **Step 3: `money.css` 末尾に追加**

```css
/* ==== W3.5: ダッシュボード fold「今月の予算」（spec §5）==== */
.mcc-fold-budget > summary .mcc-fold-mk { color: var(--c-amber-bright); }
.mcc-budget { display: block; }
.mcc-bud-cta { color: var(--c-text-dim); font-size: 0.8rem; line-height: 1.6; padding: 2px 0 6px; font-family: var(--ix-sans); letter-spacing: 0; }
.mcc-bud-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.mcc-bud-period { color: var(--c-text-bright); font-size: 0.94rem; font-weight: 700; }
.mcc-bud-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; align-items: center; margin: 8px 0; }
.mcc-bud-lbl { color: var(--c-text); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mcc-bud-val { color: var(--c-text-dim); font-size: 12px; white-space: nowrap; text-align: right; }
.mcc-bud-over { color: var(--c-danger-soft); margin-left: 8px; }
.mcc-bud-rem { color: var(--c-slate); margin-left: 8px; }
.mcc-bud-bar { position: relative; height: 10px; background: rgba(255,255,255,0.06); border-radius: 6px; overflow: hidden; grid-column: 1 / -1; }
.mcc-bud-fill { display: block; height: 100%; background: var(--c-cyan); }
.mcc-bud-fill.watch { background: var(--c-amber); }
.mcc-bud-fill.over { background: var(--c-danger); }
.mcc-bud-fill.none { background: var(--c-slate); }
.mcc-bud-tick { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--c-text-dim); opacity: 0.85; }
.mcc-bud-row-total .mcc-bud-lbl { color: var(--c-text-bright); font-weight: 700; }
.mcc-bud-unbud { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; margin-top: 10px; color: var(--c-text-dim); font-size: 12px; }
.mcc-bud-chip { color: var(--c-text-dim); font-size: 12px; padding: 2px 7px; border-radius: 5px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); }
```

- [ ] **Step 4: 構文と既存受入**

Run: `node --check money.js && echo OK`
Expected: OK

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js`
Expected: `ALL PASS`（128 asserts・DOM 順は series より後ろに挿入するだけ＝推移カードの検証は不変）

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js`
Expected: `ALL PASS`（fold が1本増えるが `FOLD_IDS` は明示列挙＝この時点では既存アサートに影響しない。期待値の意図的更新は Task 7）

- [ ] **Step 5: コミット**

```bash
git add money.js money.css
git commit -m "feat(w35): ダッシュボード fold「今月の予算」（合計・費目バー＋今日の位置の目盛線・予算なし費目チップ）"
```

---

### Task 6: 3 タブ目「月次レポート」

**Files:**
- Modify: `money.js`（`_TABS`／`_TAB_LABELS`／`_loadTab`／`switchTab`／`tabBar`／`_reportPeriod`／`setReportPeriod`／`reportSection`／`_JUMP_TARGETS`／`render()` の VM と pane 連結／`window.MCC` return）
- Modify: `money.css`（末尾にタブ短ラベルと `.mcc-rep-*`）

**Interfaces:**
- Consumes: `R.monthlyReport`／`R.yen`／`R.yenSigned`／`budgetBars`（Task 5）／`fmtDeltaYen`（W3）／既存 `jumpLink`／`fmtAnchorMonth`／`esc`。
- Produces: `MCC.setReportPeriod(period)`、DOM: `#mcc-tab-report`（pane）＞ `#mcc-tab-report-body` ＞ `.mcc-rep-nav`（`button[aria-label="前の月"|"次の月"]`・`.mcc-rep-month`・`.mcc-rep-chip`・`.mcc-hero-chip-live|-prov`）／`.mcc-cf-stats`（KPI 4）＋`.mcc-rep-delta`／`.mcc-rep-assets`／`.mcc-rep-budget`／`.mcc-rep-cats`／`.mcc-rep-now`／`.mcc-rep-notes`。タブ: `#mcc-tab-btn-report`・`.mcc-tab-lbl`／`.mcc-tab-lbl-s`。`_JUMP_TARGETS.report`。

- [ ] **Step 1: タブ機構を 3 本にする（`money.js`・4箇所）**

(a) `_TABS`／`_TAB_LABELS` を差し替え（`var _TAB_KEY = "mcc_tab";` の直後）:

```js
  var _TABS = ["dash", "report", "config"];
  var _TAB_LABELS = {
    dash: { num: "01", label: "ダッシュボード", short: "ダッシュボード" },
    report: { num: "02", label: "月次レポート", short: "レポート" },
    config: { num: "03", label: "設定・ガイド", short: "設定" },
  };
```

(b) `_loadTab()` を差し替え（未知値は既定 dash＝既存挙動のまま `report` を受理するだけ）:

```js
  function _loadTab() {
    try { var v = localStorage.getItem(_TAB_KEY); return _TABS.indexOf(v) >= 0 ? v : "dash"; }
    catch (e) { return "dash"; }   // プライベートブラウズ等は既定タブ
  }
```

(c) `switchTab(name)` の1行目を差し替え:

```js
    var tab = _TABS.indexOf(name) >= 0 ? name : "dash";   // 不明値は既定（dash）へ倒す
```

(d) `tabBar()` のボタン本文を差し替え（`.mcc-tab-lbl`（full）と `.mcc-tab-lbl-s`（short）の2 span を出し、CSS が幅で出し分ける＝§6 注意1）:

```js
          '<span class="mcc-tab-num">' + _TAB_LABELS[t].num + '</span>' +
          '<span class="mcc-tab-lbl">' + esc(_TAB_LABELS[t].label) + '</span>' +
          '<span class="mcc-tab-lbl-s">' + esc(_TAB_LABELS[t].short) + '</span>' +
```

- [ ] **Step 2: `money.js` に選択月の状態とレポート本体を追加（Task 5 の `budgetLiveSection` の閉じ `}` の直後）**

```js
  // §4.6 レポートの選択月。localStorage にも cloud state にも入れない（D5・リロードで最新の確定月へ戻る）。
  var _reportPeriod = "";
  function setReportPeriod(period) {
    _reportPeriod = (typeof period === "string") ? period : "";
    render();   // W3 setSeriesPeriod と同じ全再描画（reportNav が不正値を最新へ戻す）
  }
  // 符号付き小数1桁（マイナスは U+2212・fmtDeltaYen と同じ規約）。単位は呼び元が付ける（% / pt）。
  function fmtDeltaPct1(n) {
    var v = Math.round((Number(n) || 0) * 10) / 10;
    return (v > 0 ? "+" : (v < 0 ? "−" : "±")) + Math.abs(v).toFixed(1);
  }
  // 前月比/前年同月比の1行。cmp=rep.mom|rep.yoy／key="income"|"expense"|"balance"|"savingsRatePct"。
  // unit="pt" は貯蓄率（%ポイント差・§6 注意5）。欠月は「—」。
  function repDeltaLine(label, cmp, key, unit) {
    if (!cmp || !cmp.available || !cmp[key]) return '<div class="mcc-rep-delta">' + label + ' —</div>';
    var d = cmp[key];
    var txt = (unit === "pt")
      ? fmtDeltaPct1(d.delta) + "pt"
      : fmtDeltaYen(d.delta) + (d.pct === null ? "" : "（" + fmtDeltaPct1(d.pct) + "%）");
    return '<div class="mcc-rep-delta">' + label + ' ' + esc(txt) + '</div>';
  }
  // §4.4 月次レポート（3 タブ目 mcc-tab-report＝D9）。rep=R.monthlyReport／vm=R.viewModel／nvm=R.nisaViewModel。
  function reportSection(rep, vm, nvm, loggedIn) {
    var desc = '<div class="mcc-section-desc">月ごとの収入・支出・収支・貯蓄率と、予算に対する実績をまとめた面です。月は ◀ ▶ で移動します。</div>';
    if (!loggedIn) {
      return desc + '<div id="mcc-tab-report-body"><div class="mcc-rep-empty">ログインすると月次レポートが表示されます。</div></div>';
    }
    if (!rep || !rep.available) {
      return desc + '<div id="mcc-tab-report-body"><div class="mcc-rep-empty">収支データが未連携です。</div></div>';
    }
    var nav = rep.nav;
    var navHtml = '<div class="mcc-rep-nav">' +
      '<button type="button" class="mcc-rep-navbtn" aria-label="前の月"' +
        (nav.prev ? ' onclick="MCC.setReportPeriod(\'' + nav.prev + '\')"' : ' disabled') + '>◀</button>' +
      '<span class="mcc-rep-month">' + esc(fmtAnchorMonth(rep.period)) + '</span>' +
      '<button type="button" class="mcc-rep-navbtn" aria-label="次の月"' +
        (nav.next ? ' onclick="MCC.setReportPeriod(\'' + nav.next + '\')"' : ' disabled') + '>▶</button>' +
      (nav.isLatestComplete ? '<span class="mcc-rep-chip">最新</span>' : '') +
      (rep.isComplete ? '<span class="mcc-hero-chip-live">確定</span>' : '<span class="mcc-hero-chip-prov">暫定（進行中）</span>') +
    '</div>';

    var kpi = '<div class="mcc-cf-stats">' +
      '<div class="mcc-cf-stat"><span>収入</span><strong>' + R.yen(rep.income) + '</strong>' +
        repDeltaLine("前月比", rep.mom, "income") + repDeltaLine("前年同月比", rep.yoy, "income") + '</div>' +
      '<div class="mcc-cf-stat"><span>支出</span><strong>' + R.yen(rep.expense) + '</strong>' +
        repDeltaLine("前月比", rep.mom, "expense") + repDeltaLine("前年同月比", rep.yoy, "expense") + '</div>' +
      '<div class="mcc-cf-stat"><span>収支</span><strong class="' + (rep.balance < 0 ? "neg" : "pos") + '">' + R.yenSigned(rep.balance) + '</strong>' +
        repDeltaLine("前月比", rep.mom, "balance") + repDeltaLine("前年同月比", rep.yoy, "balance") + '</div>' +
      '<div class="mcc-cf-stat"><span>貯蓄率</span><strong>' + rep.savingsRatePct + '%</strong>' +
        repDeltaLine("前月比", rep.mom, "savingsRatePct", "pt") + repDeltaLine("前年同月比", rep.yoy, "savingsRatePct", "pt") + '</div>' +
    '</div>';

    var a = rep.assets, assetsHtml;
    if (a.available) {
      var aDelta = (a.delta === null) ? "—" : fmtDeltaYen(a.delta) + (a.pct === null ? "" : "（" + fmtDeltaPct1(a.pct) + "%）");
      assetsHtml = '<div class="mcc-rep-assets">' +
        '<div class="mcc-rep-assets-main">総資産 <strong>' + R.yen(a.total) + '</strong>' +
          '<span class="mcc-rep-delta">前月比 ' + esc(aDelta) + '</span></div>' +
        '<div class="mcc-rep-assets-sub">現金 ' + R.yen(a.cash) + '・投資 ' + R.yen(a.invest) + '</div>' +
        (a.beforeAnchor ? '<div class="mcc-rep-note">基準（アンカー）より前は収支から逆算</div>' : '') +
      '</div>';
    } else {
      var amsg = (a.reason === "noAnchor") ? '資産の推移は基準（アンカー）設定後に表示されます'
        : (a.reason === "currency") ? 'JPY 以外の通貨には対応していません'
        : 'この月は資産の系列に含まれません（収支データの欠けた月があります）';
      assetsHtml = '<div class="mcc-rep-assets"><div class="mcc-rep-note">' + amsg + '</div></div>';
    }

    var budgetHtml = '<div class="mcc-rep-budget"><div class="mcc-rep-h">予算 vs 実績</div>' +
      (rep.budget.configured
        ? budgetBars(rep.budget, { tick: !rep.isComplete, compareNote: rep.isComplete })
        : '<div class="mcc-bud-cta">予算は未設定です。' + jumpLink("budget", "「月の予算」") + '</div>') +
    '</div>';

    var catsHtml;
    if (rep.categories.hasBreakdown) {
      var lines = rep.categories.top.map(function (c) {
        return '<div class="mcc-rep-cat">' +
          '<span class="mcc-rep-cat-nm">' + esc(c.name) + ' ' + R.yen(c.amount) + '（' + c.sharePct + '%）</span>' +
          (c.delta === null ? '' : '<span class="mcc-rep-cat-d">前月比 ' + esc(fmtDeltaYen(c.delta)) + '</span>') +
          '<span class="mcc-bud-bar"><span class="mcc-bud-fill ok" style="width:' + Math.min(100, c.sharePct) + '%"></span></span>' +
        '</div>';
      }).join("");
      catsHtml = '<div class="mcc-rep-cats"><div class="mcc-rep-h">費目</div>' + lines +
        (rep.categories.othersAmount > 0 ? '<div class="mcc-rep-cat"><span class="mcc-rep-cat-nm">その他 ' + R.yen(rep.categories.othersAmount) + '</span></div>' : '') +
      '</div>';
    } else {
      catsHtml = '<div class="mcc-rep-cats"><div class="mcc-rep-h">費目</div><div class="mcc-rep-note">この月は内訳がありません。</div></div>';
    }

    // D6: NISA・目標は月に紐づかない「現在地」＝最新の確定月を表示中のみ（新規 math なし）。
    var nowHtml = "";
    if (nav.isLatestComplete) {
      var nowRows = "";
      if (nvm && nvm.configured) {
        nowRows += '<div class="mcc-rep-now-row">NISA 年内 使用 ' + R.yen(nvm.annual.total.used) + ' / ' + R.yen(nvm.annual.total.cap) +
          '（残 ' + R.yen(nvm.annual.total.remaining) + '）</div>';
      }
      (vm.goals || []).slice(0, 3).forEach(function (g) {
        nowRows += '<div class="mcc-rep-now-row">' + esc(g.label || "（無題）") + ' ' + g.progressPct + '%</div>';
      });
      if (nowRows) nowHtml = '<div class="mcc-rep-now"><div class="mcc-rep-h">現在地</div>' + nowRows + '</div>';
    }

    var notes = "";
    if (!rep.isComplete) notes += '<div class="mcc-rep-note">今月の収支は月末締め後（翌月初の自動更新）に反映されます。</div>';
    if (rep.budget.available && rep.budget.breakdownMismatch) {
      notes += '<div class="mcc-rep-note">内訳の合計（' + R.yen(rep.budget.catsTotal) + '）と支出合計（' + R.yen(rep.expense) + '）が一致していません</div>';
    }
    if (!rep.mom.available) notes += '<div class="mcc-rep-note">前月のデータがありません</div>';
    if (!rep.yoy.available) notes += '<div class="mcc-rep-note">前年同月のデータがありません</div>';
    var notesHtml = notes ? '<div class="mcc-rep-notes">' + notes + '</div>' : '';

    return desc + '<div id="mcc-tab-report-body">' + navHtml + kpi + assetsHtml + budgetHtml + catsHtml + nowHtml + notesHtml + '</div>';
  }
```

- [ ] **Step 3: `money.js` の配線（3箇所）**

(a) `_JUMP_TARGETS` の `budgetLive:` 行の直後に追加:

```js
    report:      { id: "mcc-tab-report-body",    tab: "report" },
```

(b) `render()` の VM 生成部（Task 5 で足した `var bp = …` の直後）に追加:

```js
    var rep = R.monthlyReport(eff, _cashflowRows, _investmentRows, _reportPeriod, now);
```

(c) `root.innerHTML` の代入を差し替え（dash と config の間に report pane を挿入）:

```js
    root.innerHTML = tabBar() +
      '<div class="mcc-pane" id="mcc-tab-dash" role="tabpanel" aria-labelledby="mcc-tab-btn-dash"' +
        (_activeTab === "dash" ? "" : " hidden") + '>' + dashHtml + '</div>' +
      '<div class="mcc-pane" id="mcc-tab-report" role="tabpanel" aria-labelledby="mcc-tab-btn-report"' +
        (_activeTab === "report" ? "" : " hidden") + '>' + saveWarn + reportSection(rep, vm, nvm, sync.loggedIn) + '</div>' +
      '<div class="mcc-pane" id="mcc-tab-config" role="tabpanel" aria-labelledby="mcc-tab-btn-config"' +
        (_activeTab === "config" ? "" : " hidden") + '>' + configHtml + '</div>';
```

(d) 公開面（`money.js` 末尾 `return {`）の Task 4 で足した行の直後に追加:

```js
    setReportPeriod: setReportPeriod,
```

- [ ] **Step 4: `money.css` 末尾に追加**

```css
/* ==== W3.5: タブ3本の短ラベル（390px で 1 行に収める・§5/§6 注意2）==== */
.mcc-tab-lbl-s { display: none; }
@media (max-width: 600px) {
  .mcc-tab-num, .mcc-tab-lbl { display: none; }
  .mcc-tab-lbl-s { display: inline; }
  .mcc-tab { padding: 12px 8px; letter-spacing: 0.5px; }
}

/* ==== W3.5: 月次レポート（spec §5）==== */
.mcc-rep-empty { color: var(--c-text-dim); font-size: 0.8rem; padding: 6px 0 4px; line-height: 1.6; font-family: var(--ix-sans); letter-spacing: 0; }
.mcc-rep-nav { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0 14px; }
.mcc-rep-navbtn {
  background: rgba(0,0,0,0.3); border: 1px solid rgba(129,140,248,0.3); color: var(--c-text-dim);
  border-radius: 6px; padding: 3px 11px; font-size: 0.9rem; cursor: pointer;
}
.mcc-rep-navbtn:hover { color: var(--c-cyan-pale); }
.mcc-rep-navbtn[disabled] { opacity: 0.45; cursor: not-allowed; }
.mcc-rep-month { color: var(--c-text-bright); font-size: 1.0rem; font-weight: 700; }
.mcc-rep-chip { color: var(--c-cyan-pale); font-size: 12px; font-weight: 700; border: 1px solid rgba(56,189,248,0.45); border-radius: 4px; padding: 1px 7px; }
.mcc-rep-delta { color: var(--c-text-dim); font-size: 12px; margin-top: 2px; }
.mcc-rep-h { color: var(--c-text-dim); font-size: 12px; font-weight: 700; letter-spacing: 1px; margin: 16px 0 6px; }
.mcc-rep-assets { margin-top: 14px; padding: 10px 12px; border-radius: 8px; background: rgba(56,189,248,0.08); border-left: 3px solid var(--c-cyan); }
.mcc-rep-assets-main { color: var(--c-text); font-size: 0.8rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; }
.mcc-rep-assets-main strong { color: var(--c-cyan-pale); font-size: 1.0rem; }
.mcc-rep-assets-sub { color: var(--c-text-dim); font-size: 12px; margin-top: 4px; }
.mcc-rep-cat { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; align-items: center; margin: 8px 0; }
.mcc-rep-cat-nm { color: var(--c-text); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.mcc-rep-cat-d { color: var(--c-text-dim); font-size: 12px; white-space: nowrap; }
.mcc-rep-cat .mcc-bud-bar { grid-column: 1 / -1; }
.mcc-rep-now-row { color: var(--c-text-dim); font-size: 12px; line-height: 1.6; }
.mcc-rep-note, .mcc-rep-notes .mcc-rep-note { color: var(--c-text-faint); font-size: 12px; line-height: 1.5; margin-top: 6px; font-family: var(--ix-sans); letter-spacing: 0; }
```

- [ ] **Step 5: 構文と既存受入**

Run: `node --check money.js && echo OK`
Expected: OK

Run: `node --test tests/*.test.js`
Expected: 全 pass

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js`
Expected: `ALL PASS`

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js`
Expected: `ALL PASS`（既存アサートは dash/config しか見ない＝3 本目の追加では落ちない。落ちたら Task 7 の期待値更新の前に原因を読む）

- [ ] **Step 6: コミット**

```bash
git add money.js money.css
git commit -m "feat(w35): 3 タブ目「月次レポート」（月ナビ・KPI と前月比/前年同月比・資産増減・予算 vs 実績・費目・現在地）"
```

---

### Task 7: 受入（モック鯖の変種・`w35-smoke.js`・スクショ・既存 E2E の期待値更新）

**Files:**
- Modify: `scratchpad/w35-mock-server.py`（`W35_BUDGETS=0`／`W35_AUTH=0`）
- Create: `scratchpad/w35-smoke.js`（S1〜S10）
- Create: `scratchpad/w35-real-shots.js`
- Modify: `scratchpad/cockpit-e2e.js`（fold・タブ3本の期待値を**意図的に更新**）

**Interfaces:**
- 期待値は **literal 固定**（rules と DOM が同じ `money-rules.js` を読む死角を避ける＝W3 §11）。fixture は決定論（LCG seed 20260829・2024-03〜2026-08・アンカー 2025-09 ¥1,450,000・進行中月 2026-08）。

- [ ] **Step 1: モック鯖に受入用の2変種を追加（`scratchpad/w35-mock-server.py`）**

(a) `build_state()` の `return {` の直前に、辞書を組み立てて返す形へ変更（末尾の `}` を `st` に代入し、env で潰す）。具体的には `def build_state():` の本体先頭を `st = {` に、末尾の `}` を `}` のまま残したうえで、`return st` の直前に次を挿入する:

```python
    # 受入 S1（未設定）用: W35_BUDGETS=0 なら予算を空にする（state の他フィールドは触らない）。
    if os.environ.get("W35_BUDGETS", "1") == "0":
        st["budgets"] = {"total": 0, "items": []}
    return st
```
（＝`def build_state():` の `return {` を `st = {` に書き換え、辞書リテラルの閉じ `}` の直後に上記2行＋`return st` を置く）

(b) `class Handler` の `_api` メソッド内、`if path.startswith("/api/market/"):` ブロックの直後に挿入:

```python
        # 受入 S6（未ログイン）用: W35_AUTH=0 ならセッションと /api/me/* を 401 にする。
        if os.environ.get("W35_AUTH", "1") == "0" and (path == "/api/auth/session" or path.startswith("/api/me/")):
            self._drain_body()
            self._json({"error": "unauthorized"}, status=401)
            return True
```

Run: `W35_BUDGETS=0 python3 scratchpad/w35-mock-server.py --port 8251 & sleep 2; curl -s http://127.0.0.1:8251/api/me/state | head -c 200; kill %1`
Expected: `"budgets": {"total": 0, "items": []}` を含む

- [ ] **Step 2: 受入ハーネスを書く（`scratchpad/w35-smoke.js` 新規）**

```js
// scratchpad/w35-smoke.js — W3.5 月次パック 受入（spec §10.2）。
// 使い方（この1行で1コマンド。モック鯖は自前で起動/停止・W35_VARIANTS=0 で本実装だけを検証）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w35-smoke.js
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }

const ROOT = path.resolve(__dirname, "..");
const results = [];
function check(name, cond, detail) { results.push({ name, pass: !!cond, detail }); if (!cond) console.log("  ✗ " + name + (detail ? " — " + detail : "")); }

// fixture 由来の literal（w35-mock-server.py の決定論 fixture。fixture を意図的に変えたときだけ更新する）。
const LIT = {
  augHead: "2026年8月",
  augElapsed: 94,                       // 2026-08-29 → 29/31
  augTotalVal: "¥241,300 / ¥260,000（93%）",
  augTotalRem: "残り ¥18,700",
  augDigest: "消化 93%・月 94% 経過・超過 1費目",
  gaishoku: "¥24,500 / ¥20,000（123%）",
  gaishokuOver: "超過 ¥4,500",
  shokuhi: "¥41,600 / ¥45,000（92%）",
  shokuhiRem: "残り ¥3,400",
  unbudTotal: "¥41,900",
  shokuhiAvg3: "48233",                 // 直近3確定月（2026-05/06/07）の平均＝round((52700+42500+49500)/3)
  julyMonth: "2026年7月",
  julyIncome: "¥335,000", julyExpense: "¥266,000", julyBalance: "¥69,000", julySavings: "21%",
  julyMomIncome: "前月比 −¥200,000（−37.4%）",
  julyMomExpense: "前月比 +¥28,500（+12.0%）",
  julyMomBalance: "前月比 −¥228,500（−76.8%）",
  julyMomSavings: "前月比 −35.0pt",
  julyYoyIncome: "前年同月比 −¥15,000（−4.3%）",
  julyYoyExpense: "前年同月比 +¥18,000（+7.3%）",
  julyYoySavings: "前年同月比 −8.0pt",
  julyAssets: "¥3,174,000", julyAssetsDelta: "前月比 +¥69,000（+2.2%）",
  julyAssetsSub: "現金 ¥2,574,000・投資 ¥600,000",
  juneMonth: "2026年6月",
  juneMomIncome: "前月比 +¥205,000（+62.1%）",
  juneMomExpense: "前月比 −¥30,000（−11.2%）",
  juneMomSavings: "前月比 +37.0pt",
  nisaNow: "NISA 年内 使用 ¥300,000 / ¥3,600,000（残 ¥3,300,000）",
  goalNow: "住宅の頭金 63%",
  tabLabels: ["ダッシュボード", "レポート", "設定"],
  tabbarH: 43,                          // 390px で wrap しない高さ（W3 実測値）
};
const BAN = ["節約", "使いすぎ", "見直し", "おすすめ", "しましょう", "べき"];
const KNOWN_NOISE = [/Failed to load resource/i, /favicon/i, /_vercel\/insights/i, /the server responded with a status of 401/i];
const PC = { width: 1440, height: 900 }, SP = { width: 390, height: 844 };
const NOW = Date.UTC(2026, 7, 29, 3);   // 2026-08-29（JST 昼＝UTC でも 08-29）

function startServer(port, env) {
  return spawn("python3", [path.join(ROOT, "scratchpad", "w35-mock-server.py"), "--port", String(port)],
    { stdio: ["ignore", "ignore", "ignore"], env: Object.assign({}, process.env, { W35_VARIANTS: "0" }, env || {}) });
}
function waitForServer(base, ms) {
  const dl = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => http.get(base + "/api/auth/session", (res) => { res.resume(); resolve(); })
      .on("error", () => (Date.now() > dl ? reject(new Error("server not ready")) : setTimeout(tick, 120)));
    tick();
  });
}
// Date を固定（render() は Date.now() を1回取る＝ここを固定すれば全 VM が同じ月を見る）。
async function fixDate(context, fixedMs) {
  await context.addInitScript((fixed) => {
    const RealDate = Date;
    function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed); }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => fixed; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
  }, fixedMs);
}
async function newPage(browser, base, viewport, loggedIn) {
  const context = await browser.newContext({ viewport });
  await fixDate(context, NOW);
  const page = await context.newPage();
  const errors = [], consoleErrs = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (!KNOWN_NOISE.some((re) => re.test(t))) consoleErrs.push(t);
  });
  await page.goto(base + "/?diag=off", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => MCC.show());
  await page.waitForSelector("#mcc-root .mcc-hero", { timeout: 15000 });
  if (loggedIn) await page.waitForFunction(() => !!document.querySelector("#mcc-sec-cashflow .mcc-cashflow"), null, { timeout: 15000 });
  return { context, page, errors, consoleErrs };
}
const txtOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, " ").trim() : ""; }, sel);

async function main() {
  const PORT = 8252, BASE = "http://127.0.0.1:" + PORT;
  const PORT_NB = 8253, BASE_NB = "http://127.0.0.1:" + PORT_NB;   // W35_BUDGETS=0
  const PORT_NA = 8254, BASE_NA = "http://127.0.0.1:" + PORT_NA;   // W35_AUTH=0
  const servers = [startServer(PORT), startServer(PORT_NB, { W35_BUDGETS: "0" }), startServer(PORT_NA, { W35_AUTH: "0" })];
  let browser;
  try {
    await Promise.all([waitForServer(BASE, 15000), waitForServer(BASE_NB, 15000), waitForServer(BASE_NA, 15000)]);
    browser = await chromium.launch();

    // ---- S1 未設定（W35_BUDGETS=0）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE_NB, PC, true);
      await page.waitForSelector("#mcc-sec-budget-live");
      const s1 = await page.evaluate(() => ({
        digest: document.querySelector("#mcc-sec-budget-live .mcc-fold-dg").textContent.trim(),
        cta: (document.querySelector("#mcc-sec-budget-live .mcc-bud-cta") || {}).textContent || "",
        chips: Array.from(document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-chip")).map((n) => n.textContent.trim()),
        bars: document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-row").length,
      }));
      check("S1 digest 未設定", s1.digest === "未設定", s1.digest);
      check("S1 CTA 逐語", s1.cta.indexOf("費目ごとの月額を設定すると、今月の消化がここに出ます。") >= 0, s1.cta);
      check("S1 CTA に「月の予算」ジャンプ", s1.cta.indexOf("「月の予算」") >= 0, s1.cta);
      check("S1 今月の費目チップ 5件", s1.chips.length === 5, JSON.stringify(s1.chips));
      check("S1 バーは出さない", s1.bars === 0, s1.bars);
      check("S1 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S2 設定済（既定 fixture・2026-08-29）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.waitForSelector("#mcc-sec-budget-live .mcc-bud-row-total");
      const s2 = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-row-item")).map((r) => ({
          name: r.querySelector(".mcc-bud-lbl").textContent.trim(),
          val: r.querySelector(".mcc-bud-val").textContent.replace(/\s+/g, " ").trim(),
          cls: r.querySelector(".mcc-bud-fill").className,
          width: r.querySelector(".mcc-bud-fill").style.width,
        }));
        const total = document.querySelector("#mcc-sec-budget-live .mcc-bud-row-total");
        return {
          open: document.getElementById("mcc-sec-budget-live").open,
          digest: document.querySelector("#mcc-sec-budget-live .mcc-fold-dg").textContent.replace(/\s+/g, " ").trim(),
          head: document.querySelector("#mcc-sec-budget-live .mcc-bud-head").textContent.replace(/\s+/g, " ").trim(),
          totalVal: total.querySelector(".mcc-bud-val").textContent.replace(/\s+/g, " ").trim(),
          tick: total.querySelector(".mcc-bud-tick") ? total.querySelector(".mcc-bud-tick").style.left : "",
          totalWidth: total.querySelector(".mcc-bud-fill").style.width,
          rows: rows,
          unbud: (document.querySelector("#mcc-sec-budget-live .mcc-bud-unbud") || {}).textContent || "",
          chips: Array.from(document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-chip")).map((n) => n.textContent.trim()),
          notes: Array.from(document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-note")).map((n) => n.textContent.trim()).join("|"),
        };
      });
      check("S2 fold は既定 open", s2.open === true);
      check("S2 digest 逐語", s2.digest === LIT.augDigest, s2.digest);
      check("S2 見出し（進行中・経過率）", s2.head.indexOf(LIT.augHead) === 0 && s2.head.indexOf("（進行中・月の " + LIT.augElapsed + "% 経過）") > 0, s2.head);
      check("S2 合計バーの値", s2.totalVal.indexOf(LIT.augTotalVal) === 0, s2.totalVal);
      check("S2 合計バーの残り", s2.totalVal.indexOf(LIT.augTotalRem) > 0, s2.totalVal);
      check("S2 目盛線＝経過率", s2.tick === LIT.augElapsed + "%", s2.tick);
      check("S2 合計バー幅＝消化率", s2.totalWidth === "93%", s2.totalWidth);
      check("S2 費目 9 行・pct 降順の先頭は外食費", s2.rows.length === 9 && s2.rows[0].name === "外食費", JSON.stringify(s2.rows.map((r) => r.name)));
      check("S2 over は 1 件（外食費・赤）", s2.rows.filter((r) => /\bover\b/.test(r.cls)).length === 1 && /\bover\b/.test(s2.rows[0].cls), s2.rows[0].cls);
      check("S2 over の値と超過額", s2.rows[0].val.indexOf(LIT.gaishoku) === 0 && s2.rows[0].val.indexOf(LIT.gaishokuOver) > 0, s2.rows[0].val);
      const watch = s2.rows.filter((r) => /\bwatch\b/.test(r.cls));
      check("S2 watch は 1 件（食費・アンバー）", watch.length === 1 && watch[0].name === "食費", JSON.stringify(watch));
      check("S2 watch の値と残り", watch.length === 1 && watch[0].val.indexOf(LIT.shokuhi) === 0 && watch[0].val.indexOf(LIT.shokuhiRem) > 0, watch.length ? watch[0].val : "");
      const nodata = s2.rows.filter((r) => r.val === "実績なし");
      check("S2 実績なしは 旧・雑貨 1 件・バー幅 0", nodata.length === 1 && nodata[0].name === "旧・雑貨" && nodata[0].width === "0%", JSON.stringify(nodata));
      check("S2 予算なしの費目 合計", s2.unbud.indexOf("予算なしの費目 " + LIT.unbudTotal + "：") >= 0, s2.unbud);
      check("S2 予算なしチップ 5 件", s2.chips.length === 5, JSON.stringify(s2.chips));
      check("S2 チップに 車・ガソリン ¥12,000", s2.chips.indexOf("車・ガソリン ¥12,000") >= 0, JSON.stringify(s2.chips));
      check("S2 内訳と合計は一致（不一致注記なし）", s2.notes.indexOf("一致していません") < 0, s2.notes);
      check("S2 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S3 設定カード（0 で削除・平均を採用・フォーカス復元）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.evaluate(() => MCC.switchTab("config"));
      await page.waitForSelector("#mcc-sec-budget-card .mcc-bud-table");
      const before = await page.evaluate(() => ({
        rows: document.querySelectorAll("#mcc-sec-budget-card .mcc-bud-table tbody tr").length,
        nodata: Array.from(document.querySelectorAll("#mcc-sec-budget-card tr.mcc-bud-nodata th")).map((n) => n.textContent.trim()),
        readout: (document.querySelector("#mcc-sec-budget-card .mcc-bud-readout") || {}).textContent || "",
        note: Array.from(document.querySelectorAll("#mcc-sec-budget-card .mcc-bud-note")).map((n) => n.textContent.trim()).join("|"),
      }));
      check("S3 実績なしの行は「旧・雑貨」＋タグ", before.nodata.length === 1 && before.nodata[0].indexOf("旧・雑貨") === 0 && before.nodata[0].indexOf("直近12ヶ月に実績なし") > 0, JSON.stringify(before.nodata));
      check("S3 合計の読み出し（直近3ヶ月・確定月のみ）", before.readout.indexOf("実支出の平均は ¥257,000/月（直近3ヶ月・確定月のみ）") >= 0, before.readout);
      check("S3 0 で消える注記", before.note.indexOf("0 を入れると予算を消します") >= 0, before.note);
      check("S3 費目の合計注記", before.note.indexOf("費目の合計 ¥207,000（合計予算の 80%）") >= 0, before.note);
      // 旧・雑貨に 0 を入れる → 行ごと消える
      await page.evaluate(() => {
        const inp = document.querySelector('#mcc-sec-budget-card input[data-mcc-focus="budgets.item:旧・雑貨"]');
        inp.value = "0";
        inp.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForFunction(() => !document.querySelector('#mcc-sec-budget-card input[data-mcc-focus="budgets.item:旧・雑貨"]'), null, { timeout: 5000 });
      const after0 = await page.evaluate(() => ({
        rows: document.querySelectorAll("#mcc-sec-budget-card .mcc-bud-table tbody tr").length,
        stored: JSON.parse(localStorage.getItem("mcc_state")).budgets.items.map((i) => i.name),
      }));
      check("S3 0 入力で行が消える", after0.rows === before.rows - 1, before.rows + " → " + after0.rows);
      check("S3 0 入力で state からも消える", after0.stored.indexOf("旧・雑貨") < 0, JSON.stringify(after0.stored));
      // 食費に「平均を採用」→ avg3 が入る＋フォーカス復元（data-mcc-focus）
      await page.evaluate(() => {
        const th = Array.from(document.querySelectorAll("#mcc-sec-budget-card tbody tr")).find((tr) => tr.querySelector("th").textContent.trim() === "食費");
        th.querySelector(".mcc-bud-adopt").click();
      });
      await page.waitForFunction((want) => {
        const i = document.querySelector('#mcc-sec-budget-card input[data-mcc-focus="budgets.item:食費"]');
        return !!i && i.value === want;
      }, LIT.shokuhiAvg3, { timeout: 5000 });
      check("S3 平均を採用で avg3 が入る", true);
      // 入力欄に触ってから Enter 確定＝フォーカスが同じ欄に戻る
      const focused = await page.evaluate(async () => {
        const inp = document.querySelector('#mcc-sec-budget-card input[data-mcc-focus="budgets.item:外食費"]');
        inp.focus();
        inp.value = "21000";
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 60));
        const ae = document.activeElement;
        return ae ? ae.getAttribute("data-mcc-focus") : "";
      });
      check("S3 フォーカス復元（budgets.item:外食費）", focused === "budgets.item:外食費", focused);
      check("S3 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S4 レポート（既定＝最新の確定月・◀ ▶・端で disabled）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.evaluate(() => MCC.switchTab("report"));
      await page.waitForSelector("#mcc-tab-report-body .mcc-rep-nav");
      const snap = () => page.evaluate(() => ({
        month: document.querySelector(".mcc-rep-month").textContent.trim(),
        chip: (document.querySelector(".mcc-rep-chip") || {}).textContent || "",
        badge: (document.querySelector(".mcc-hero-chip-live, .mcc-hero-chip-prov") || {}).textContent || "",
        kpis: Array.from(document.querySelectorAll("#mcc-tab-report-body .mcc-cf-stat")).map((s) => s.textContent.replace(/\s+/g, " ").trim()),
        assets: (document.querySelector(".mcc-rep-assets") || {}).textContent.replace(/\s+/g, " ").trim(),
        now: (document.querySelector(".mcc-rep-now") || {}).textContent || "",
        prevDisabled: document.querySelector('[aria-label="前の月"]').disabled,
        nextDisabled: document.querySelector('[aria-label="次の月"]').disabled,
        cats: Array.from(document.querySelectorAll(".mcc-rep-cat-nm")).map((n) => n.textContent.trim()),
        budgetRows: document.querySelectorAll(".mcc-rep-budget .mcc-bud-row").length,
        compareNote: (document.querySelector(".mcc-rep-budget .mcc-bud-note") || {}).textContent || "",
      }));
      const july = await snap();
      check("S4 既定＝最新の確定月", july.month === LIT.julyMonth, july.month);
      check("S4 最新チップ", july.chip === "最新", july.chip);
      check("S4 確定バッジ", july.badge === "確定", july.badge);
      check("S4 収入タイル逐語", july.kpis[0].indexOf(LIT.julyIncome) >= 0 && july.kpis[0].indexOf(LIT.julyMomIncome) >= 0 && july.kpis[0].indexOf(LIT.julyYoyIncome) >= 0, july.kpis[0]);
      check("S4 支出タイル逐語", july.kpis[1].indexOf(LIT.julyExpense) >= 0 && july.kpis[1].indexOf(LIT.julyMomExpense) >= 0 && july.kpis[1].indexOf(LIT.julyYoyExpense) >= 0, july.kpis[1]);
      check("S4 収支タイル逐語", july.kpis[2].indexOf(LIT.julyBalance) >= 0 && july.kpis[2].indexOf(LIT.julyMomBalance) >= 0, july.kpis[2]);
      check("S4 貯蓄率タイルは pt", july.kpis[3].indexOf(LIT.julySavings) >= 0 && july.kpis[3].indexOf(LIT.julyMomSavings) >= 0 && july.kpis[3].indexOf(LIT.julyYoySavings) >= 0, july.kpis[3]);
      check("S4 資産増減", july.assets.indexOf("総資産 " + LIT.julyAssets) >= 0 && july.assets.indexOf(LIT.julyAssetsDelta) >= 0 && july.assets.indexOf(LIT.julyAssetsSub) >= 0, july.assets);
      check("S4 現在地（最新の確定月のみ）", july.now.indexOf(LIT.nisaNow) >= 0 && july.now.indexOf(LIT.goalNow) >= 0, july.now);
      check("S4 確定月は「現在の予算で比較しています」", july.compareNote.indexOf("現在の予算で比較しています") >= 0, july.compareNote);
      check("S4 費目の先頭＝賃貸費用（構成比つき）", july.cats[0].indexOf("賃貸費用 ¥85,000（32%）") === 0, july.cats[0]);
      // ◀ で前月へ
      await page.click('[aria-label="前の月"]');
      await page.waitForFunction(() => document.querySelector(".mcc-rep-month").textContent.trim() === "2026年6月", null, { timeout: 5000 });
      const june = await snap();
      check("S4 ◀ で 2026年6月", june.month === LIT.juneMonth, june.month);
      check("S4 最新チップは消える", june.chip === "", june.chip);
      check("S4 6月の前月比（収入/支出/貯蓄率）", june.kpis[0].indexOf(LIT.juneMomIncome) >= 0 && june.kpis[1].indexOf(LIT.juneMomExpense) >= 0 && june.kpis[3].indexOf(LIT.juneMomSavings) >= 0, june.kpis.join(" | "));
      check("S4 6月は現在地を出さない", june.now === "", june.now);
      // ▶ ▶ で進行中月へ
      await page.click('[aria-label="次の月"]');
      await page.waitForFunction(() => document.querySelector(".mcc-rep-month").textContent.trim() === "2026年7月", null, { timeout: 5000 });
      await page.click('[aria-label="次の月"]');
      await page.waitForFunction(() => document.querySelector(".mcc-rep-month").textContent.trim() === "2026年8月", null, { timeout: 5000 });
      const aug = await snap();
      check("S4 ▶▶ で 2026年8月・暫定（進行中）", aug.badge === "暫定（進行中）", aug.badge);
      check("S4 端では ▶ が disabled", aug.nextDisabled === true, aug.nextDisabled);
      check("S4 進行中月は比較注記を出さない", aug.compareNote.indexOf("現在の予算で比較しています") < 0, aug.compareNote);
      check("S4 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S5 資産増減が推移カードの同月点と一致（DOM 同士の突合）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      const capText = await page.evaluate(() => {
        const hits = Array.from(document.querySelectorAll("#mcc-sec-series .mcc-series-hit"));
        const h = hits.map((x) => x.getAttribute("data-cap")).find((c) => c && c.indexOf("2026年7月") === 0);
        return h || "";
      });
      await page.evaluate(() => MCC.switchTab("report"));
      await page.waitForSelector(".mcc-rep-assets");
      const rep = await txtOf(page, ".mcc-rep-assets");
      check("S5 推移カードに 2026年7月 の点がある", capText.indexOf("総資産 " + LIT.julyAssets) > 0, capText);
      check("S5 レポートの総資産＝推移カードの同月点", rep.indexOf("総資産 " + LIT.julyAssets) >= 0, rep);
      check("S5 現金/投資も一致", capText.indexOf("現金 ¥2,574,000") > 0 && rep.indexOf("現金 ¥2,574,000") >= 0, capText + " || " + rep);
      check("S5 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S6 未ログイン（W35_AUTH=0）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE_NA, PC, false);
      const s6 = await page.evaluate(() => {
        const rep = document.getElementById("mcc-tab-report");
        const card = document.getElementById("mcc-sec-budget-card");
        return {
          fold: !!document.getElementById("mcc-sec-budget-live"),
          repText: rep ? rep.textContent.replace(/\s+/g, " ").trim() : "",
          cardText: card ? card.textContent.replace(/\s+/g, " ").trim() : "",
          cardInputs: card ? card.querySelectorAll("input").length : 0,
        };
      });
      check("S6 未ログインは fold を描かない", s6.fold === false);
      check("S6 レポートはログイン案内 1 行", s6.repText.indexOf("ログインすると月次レポートが表示されます。") >= 0, s6.repText);
      check("S6 レポートに ¥ が出ない", s6.repText.indexOf("¥") < 0, s6.repText);
      check("S6 設定カードは編集可（入力あり）", s6.cardInputs >= 1, s6.cardInputs);
      check("S6 設定カードに ¥ が出ない", s6.cardText.indexOf("¥") < 0, s6.cardText);
      check("S6 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S7 禁則語（新設セクションに 0 件）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.evaluate(() => MCC.switchTab("report"));
      await page.waitForSelector("#mcc-tab-report-body");
      const texts = await page.evaluate(() => ({
        fold: (document.getElementById("mcc-sec-budget-live") || {}).textContent || "",
        report: (document.getElementById("mcc-tab-report") || {}).textContent || "",
        card: (document.getElementById("mcc-sec-budget-card") || {}).textContent || "",
      }));
      BAN.forEach((w) => {
        check("S7 禁則語「" + w + "」が新設部分に無い",
          texts.fold.indexOf(w) < 0 && texts.report.indexOf(w) < 0 && texts.card.indexOf(w) < 0, w);
      });
      check("S7 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S8 fold の開閉が再描画後も保持 ----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      await page.waitForSelector("#mcc-sec-budget-live");
      await page.evaluate(() => { document.getElementById("mcc-sec-budget-live").open = false; });
      await page.waitForTimeout(80);
      await page.evaluate(() => MCC.render());
      await page.waitForTimeout(80);
      const closed = await page.evaluate(() => document.getElementById("mcc-sec-budget-live").open);
      check("S8 閉じた fold は再描画後も閉じたまま", closed === false, closed);
      await page.evaluate(() => { document.getElementById("mcc-sec-budget-live").open = true; });
      await page.waitForTimeout(80);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.evaluate(() => MCC.show());
      await page.waitForSelector("#mcc-sec-budget-live");
      const reopened = await page.evaluate(() => document.getElementById("mcc-sec-budget-live").open);
      check("S8 開いた fold はリロード後も開く（mcc_details）", reopened === true, reopened);
      check("S8 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }

    // ---- S9 タブ 3 本（非再描画切替・390px で 1 行）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, PC, true);
      const s9a = await page.evaluate(() => {
        window.__cf = document.getElementById("mcc-sec-cashflow");
        window.__cf.open = false;
        return {
          tabs: Array.from(document.querySelectorAll(".mcc-tab")).map((b) => b.id),
          nums: Array.from(document.querySelectorAll(".mcc-tab-num")).map((n) => n.textContent.trim()),
          labels: Array.from(document.querySelectorAll(".mcc-tab-lbl")).map((n) => n.textContent.trim()),
          shorts: Array.from(document.querySelectorAll(".mcc-tab-lbl-s")).map((n) => n.textContent.trim()),
        };
      });
      check("S9 タブ 3 本", JSON.stringify(s9a.tabs) === JSON.stringify(["mcc-tab-btn-dash", "mcc-tab-btn-report", "mcc-tab-btn-config"]), JSON.stringify(s9a.tabs));
      check("S9 番号 01/02/03", JSON.stringify(s9a.nums) === JSON.stringify(["01", "02", "03"]), JSON.stringify(s9a.nums));
      check("S9 ラベル逐語", JSON.stringify(s9a.labels) === JSON.stringify(["ダッシュボード", "月次レポート", "設定・ガイド"]), JSON.stringify(s9a.labels));
      check("S9 短ラベル逐語", JSON.stringify(s9a.shorts) === JSON.stringify(LIT.tabLabels), JSON.stringify(s9a.shorts));
      await page.click("#mcc-tab-btn-report");
      await page.waitForTimeout(80);
      const s9b = await page.evaluate(() => ({
        same: window.__cf === document.getElementById("mcc-sec-cashflow"),
        stillClosed: document.getElementById("mcc-sec-cashflow").open,
        hidden: [document.getElementById("mcc-tab-dash").hidden, document.getElementById("mcc-tab-report").hidden, document.getElementById("mcc-tab-config").hidden],
        aria: Array.from(document.querySelectorAll(".mcc-tab")).map((b) => b.getAttribute("aria-selected")),
        stored: localStorage.getItem("mcc_tab"),
      }));
      check("S9 切替は非再描画（同一ノード参照）", s9b.same === true);
      check("S9 切替で fold の開閉が残る", s9b.stillClosed === false);
      check("S9 hidden はレポートだけ false", JSON.stringify(s9b.hidden) === JSON.stringify([true, false, true]), JSON.stringify(s9b.hidden));
      check("S9 aria-selected", JSON.stringify(s9b.aria) === JSON.stringify(["false", "true", "false"]), JSON.stringify(s9b.aria));
      check("S9 localStorage に report", s9b.stored === "report", s9b.stored);
      await context.close();
      // 390px: wrap しない（タブバー高さ＝タブ1個分）
      const sp = await newPage(browser, BASE, SP, true);
      const s9c = await sp.page.evaluate(() => {
        const bar = document.querySelector(".mcc-tabbar");
        const btn = document.querySelector(".mcc-tab");
        return {
          barH: Math.round(bar.getBoundingClientRect().height),
          btnH: Math.round(btn.getBoundingClientRect().height),
          numShown: getComputedStyle(document.querySelector(".mcc-tab-num")).display,
          lblShown: getComputedStyle(document.querySelector(".mcc-tab-lbl")).display,
          shortShown: getComputedStyle(document.querySelector(".mcc-tab-lbl-s")).display,
          viewW: document.getElementById("money-view").scrollWidth,
        };
      });
      check("S9 390px でタブバーが wrap しない", s9c.barH === s9c.btnH, s9c.barH + " / " + s9c.btnH);
      check("S9 390px のタブバー高さ（W3 実測 43px）", s9c.barH === LIT.tabbarH, s9c.barH);
      check("S9 390px は番号とフルラベルを隠す", s9c.numShown === "none" && s9c.lblShown === "none" && s9c.shortShown !== "none", JSON.stringify(s9c));
      check("S9 390px 横あふれなし", s9c.viewW <= 390, s9c.viewW);
      check("S9 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0 && sp.errors.length === 0 && sp.consoleErrs.length === 0,
        errors.concat(consoleErrs, sp.errors, sp.consoleErrs).join(" / "));
      await sp.context.close();
    }

    // ---- S10 390px のレポート/予算 fold（描画とエラー 0）----
    {
      const { context, page, errors, consoleErrs } = await newPage(browser, BASE, SP, true);
      await page.evaluate(() => MCC.switchTab("report"));
      await page.waitForSelector("#mcc-tab-report-body .mcc-rep-nav");
      const s10 = await page.evaluate(() => ({
        navH: Math.round(document.querySelector(".mcc-rep-nav").getBoundingClientRect().height),
        viewW: document.getElementById("money-view").scrollWidth,
        kpis: document.querySelectorAll("#mcc-tab-report-body .mcc-cf-stat").length,
      }));
      check("S10 390px 横あふれなし", s10.viewW <= 390, s10.viewW);
      check("S10 KPI 4 タイル", s10.kpis === 4, s10.kpis);
      check("S10 月ナビは 1〜2 行に収まる", s10.navH <= 80, s10.navH);
      check("S10 pageerror/console.error 0", errors.length === 0 && consoleErrs.length === 0, errors.concat(consoleErrs).join(" / "));
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    servers.forEach((s) => s.kill());
  }
  const failed = results.filter((r) => !r.pass);
  console.log(results.length - failed.length + "/" + results.length + " asserts passed");
  console.log(failed.length ? "FAIL" : "ALL PASS");
  process.exit(failed.length ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
```

- [ ] **Step 3: 受入を実行して赤を読む**

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w35-smoke.js`
Expected: 最終的に `ALL PASS`。落ちた `✗` 行は **detail に実測値**が出るので、
- **文言・数値の literal ズレ**＝実装を spec §7 に合わせる（LIT を勝手に実測へ書き換えない）。
- ただし `S3 費目の合計注記`（`¥207,000`＝fixture の items 合計）と `S9 390px のタブバー高さ`（43px）は環境差で動き得る値なので、**先に構造の assert（wrap しない／注記が出る）が緑であることを確認**してから、実測値で LIT を更新してよい（更新したらコミットメッセージに実測値を書く）。

- [ ] **Step 4: 本実装スクショ（`scratchpad/w35-real-shots.js` 新規）**

```js
// scratchpad/w35-real-shots.js — W3.5 本実装（モック注入なし）のスクリーンショット。
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w35-real-shots.js [outDir]
// モック鯖を W35_VARIANTS=0 で 8255 に自前起動し、PC 1440 / 390px × dash/report/config を fullPage で撮る。
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");
const fs = require("fs");
let chromium;
try { ({ chromium } = require("playwright")); } catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }
const ROOT = path.resolve(__dirname, "..");
const PORT = 8255, BASE = "http://127.0.0.1:" + PORT;
const OUT = process.argv[2] || path.join(ROOT, "scratchpad", "w35-real-shots");
fs.mkdirSync(OUT, { recursive: true });
const NOW = Date.UTC(2026, 7, 29, 3);

function waitForServer(ms) {
  const dl = Date.now() + ms;
  return new Promise((resolve, reject) => {
    const tick = () => http.get(BASE + "/api/auth/session", (res) => { res.resume(); resolve(); })
      .on("error", () => (Date.now() > dl ? reject(new Error("server not ready")) : setTimeout(tick, 120)));
    tick();
  });
}
async function fixDate(context, fixedMs) {
  await context.addInitScript((fixed) => {
    const RealDate = Date;
    function FakeDate(...a) { return a.length ? new RealDate(...a) : new RealDate(fixed); }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => fixed; FakeDate.UTC = RealDate.UTC; FakeDate.parse = RealDate.parse;
    window.Date = FakeDate;
  }, fixedMs);
}
const VP = [{ key: "1440", w: 1440, h: 900 }, { key: "390", w: 390, h: 844 }];
const TABS = ["dash", "report", "config"];

async function main() {
  const server = spawn("python3", [path.join(ROOT, "scratchpad", "w35-mock-server.py"), "--port", String(PORT)],
    { stdio: ["ignore", "ignore", "ignore"], env: Object.assign({}, process.env, { W35_VARIANTS: "0" }) });
  let browser;
  try {
    await waitForServer(15000);
    browser = await chromium.launch();
    for (const v of VP) {
      const context = await browser.newContext({ viewport: { width: v.w, height: v.h } });
      await fixDate(context, NOW);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(BASE + "/?diag=off", { waitUntil: "domcontentloaded" });
      await page.evaluate(() => window.MCC && window.MCC.show && window.MCC.show());
      await page.waitForSelector("#mcc-root .mcc-hero", { timeout: 15000 });
      await page.waitForFunction(() => !!document.querySelector("#mcc-sec-cashflow .mcc-cashflow"), null, { timeout: 15000 });
      for (const t of TABS) {
        await page.evaluate((tab) => MCC.switchTab(tab), t);
        await page.waitForTimeout(400);
        const file = path.join(OUT, "real-" + v.key + "-" + t + ".png");
        await page.screenshot({ path: file, fullPage: true });
        const info = await page.evaluate(() => ({
          budgetRows: document.querySelectorAll("#mcc-sec-budget-live .mcc-bud-row").length,
          digest: (document.querySelector("#mcc-sec-budget-live .mcc-fold-dg") || {}).textContent || "",
          repMonth: (document.querySelector(".mcc-rep-month") || {}).textContent || "",
          scrollW: document.getElementById("money-view").scrollWidth,
        }));
        console.log(file, JSON.stringify(info), "pageerrors=" + errors.length);
      }
      await context.close();
    }
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
```

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w35-real-shots.js`
Expected: 6 枚出力・全行 `pageerrors=0`・390px の `scrollW` が 390 以下

- [ ] **Step 5: 既存 E2E の期待値を意図的に更新（`scratchpad/cockpit-e2e.js`）**

(a) スナップショット関数（`return {` の `folds: folds,` の直後）に追加:

```js
      // W3.5: 予算 fold（収支データがある文脈でだけ描かれる＝FOLD_IDS には入れない）
      budgetLive: (() => {
        const el = document.getElementById("mcc-sec-budget-live");
        return el ? {
          tag: el.tagName, isFold: /\bmcc-fold\b/.test(el.className), open: !!el.open,
          digest: (() => { const d = el.querySelector(".mcc-fold-dg"); return d ? d.textContent.trim() : null; })(),
          inDash: !!document.querySelector("#mcc-tab-dash #mcc-sec-budget-live"),
          yenInputs: el.querySelectorAll("input").length,
        } : null;
      })(),
      budgetCardInConfig: !!document.querySelector("#mcc-tab-config #mcc-sec-budget-card"),
```

(b) シナリオA の `D3_digest_cashflow` の直後に追加:

```js
    // --- W3.5: 予算 fold と設定カード（新設の期待値）---
    check("W35_budget_fold_present_in_dash",
      !!a.budgetLive && a.budgetLive.tag === "DETAILS" && a.budgetLive.isFold && a.budgetLive.inDash,
      JSON.stringify(a.budgetLive));
    check("W35_budget_fold_default_open", !!a.budgetLive && a.budgetLive.open === true, JSON.stringify(a.budgetLive));
    check("W35_budget_fold_digest_unset", !!a.budgetLive && a.budgetLive.digest === "未設定", a.budgetLive && a.budgetLive.digest);
    check("W35_budget_fold_has_no_input", !!a.budgetLive && a.budgetLive.yenInputs === 0, a.budgetLive && a.budgetLive.yenInputs);
    check("W35_budget_card_in_config", a.budgetCardInConfig === true, a.budgetCardInConfig);
    check("W35_dash_still_has_no_input", a.placement.dashInputCount === 0, a.placement.dashInputCount);
```

(c) `tabState()` の返却オブジェクトに3行追加:

```js
      reportHidden: document.getElementById("mcc-tab-report").hidden,
      reportSelected: document.getElementById("mcc-tab-btn-report").getAttribute("aria-selected"),
      reportHasBody: !!document.querySelector("#mcc-tab-report #mcc-tab-report-body"),
```

(d) `G1_default_tab_is_dash` の直後に追加:

```js
    check("W35_G1_report_pane_hidden_by_default", g1.reportHidden === true && g1.reportSelected === "false", JSON.stringify(g1));
    check("W35_G1_report_body_exists", g1.reportHasBody === true, JSON.stringify(g1));
```

(e) `G3_click_config_swaps_hidden` の直後に追加（レポートタブの実クリック）:

```js
    await pageG.click("#mcc-tab-btn-report");
    await pageG.waitForTimeout(80);
    const g3r = await tabState();
    check("W35_G3_click_report_swaps_hidden",
      g3r.dashHidden === true && g3r.configHidden === true && g3r.reportHidden === false, JSON.stringify(g3r));
    check("W35_G3_click_report_swaps_aria",
      g3r.reportSelected === "true" && g3r.dashSelected === "false" && g3r.configSelected === "false", JSON.stringify(g3r));
    check("W35_G3_report_tab_stored", g3r.storedTab === "report", g3r.storedTab);
    await pageG.click("#mcc-tab-btn-config");   // 後続シナリオのために config へ戻す
    await pageG.waitForTimeout(80);
```

Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js`
Expected: `ALL PASS`・`pageerrors=0`。**最後の行に出る `N/N asserts passed` の N を控える**（新基準値＝Task 8 で spec §11 と CLAUDE.md 追記に書く）。

- [ ] **Step 6: 全スイート（最終）**

```bash
node --test tests/*.test.js
/home/shugo/apps/investment-portal/.venv/bin/python -m pytest tests/ -q
NODE_PATH=/home/shugo/node_modules node scratchpad/w35-smoke.js
NODE_PATH=/home/shugo/node_modules node scratchpad/w3-smoke.js
NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js
NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
git diff --stat -- api/ tests/fixtures/ index.html db/ scripts/ vercel.json
```
Expected: 全緑／pytest 106 passed（`api/` 非接触）／`ALL PASS` ×4（w35-smoke・w3-smoke 128・cockpit-e2e 新基準値・portal-money-smoke）／最後の diff は**出力なし**。

- [ ] **Step 7: 偽陽性の潰し（一時変更・コミットしない）**

1. `money-rules.js` の `budgetProgress` の `if (!row.isComplete && actual < budget && (pct > elapsedPct + 10 || pct >= 90)) return "watch";` から `|| pct >= 90` を消す。
   Run: `node --test tests/money-budget.test.js` → 「status の境界」が FAIL。
   Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w35-smoke.js` → 「S2 watch は 1 件（食費・アンバー）」が ✗。
   `git checkout -- money-rules.js` で戻す。
2. `money.js` の `budgetBars` の `left:' + bp.elapsedPct + '%` を `left:0%` に変える。
   Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/w35-smoke.js` → 「S2 目盛線＝経過率」が ✗。
   `git checkout -- money.js` で戻す。
3. `money.js` の `_FOLD_DEFAULT_OPEN` から `"mcc-sec-budget-live": true` を消す。
   Run: `NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js` → `W35_budget_fold_default_open` が FAIL。
   `git checkout -- money.js` で戻す。

Run: `git status --short` → 出力なし（一時変更が残っていないこと）

- [ ] **Step 8: コミット**

```bash
git add scratchpad/w35-mock-server.py scratchpad/w35-smoke.js scratchpad/w35-real-shots.js scratchpad/cockpit-e2e.js
git commit -m "test(w35): 受入 w35-smoke（S1〜S10・期待値 literal 固定）＋モック鯖の W35_BUDGETS/W35_AUTH＋cockpit-e2e の期待値更新"
```

---

### Task 8: 記録（spec の実測反映・申し送り）

**Files:**
- Modify: `docs/superpowers/specs/2026-08-29-w35-monthly-pack-design.md`（§9 の件数・§11 の CLAUDE.md 追記ブロック）
- Modify: `docs/superpowers/plans/2026-08-29-w35-monthly-pack.md`（本書・末尾の申し送り）
- **`.claude/CLAUDE.md` は worktree に存在しない（git 管理外）＝ここでは触らない**（統合セッションが main 直下で追記する）

- [ ] **Step 1: spec §9 の件数を実測へ更新**

`§9 既存受入への影響` の `scratchpad/cockpit-e2e.js`（241）を Task 7 Step 5 の実測 N へ差し替え、行末に「→ 更新後 N」を書く。同様に `node --test tests/*.test.js`（418 → 新規分だけ増える）を実測（`node --test tests/*.test.js` の合計）へ差し替える。

- [ ] **Step 2: spec §11 の CLAUDE.md 追記ブロックの `（新基準値 N）` を実測へ置換**

`受入＝…＋ cockpit-e2e（新基準値 N）` の `N` を Task 7 Step 5 の実測値にする（例: `（新基準値 253）`）。ブロック全体は統合セッションがそのまま `.claude/CLAUDE.md` へ貼る前提なので、**他の文字は変えない**。

- [ ] **Step 3: 本 plan 末尾の「統合セッションへの申し送り」を実測で埋める**

下の「## 統合セッションへの申し送り」節の `N` / `M` を実測へ置換する。

- [ ] **Step 4: コミット**

```bash
git add docs/superpowers/specs/2026-08-29-w35-monthly-pack-design.md docs/superpowers/plans/2026-08-29-w35-monthly-pack.md
git commit -m "docs(w35): spec §9/§11 の件数を実測へ更新・plan に統合セッションへの申し送りを追記"
```

---

## 完了条件（plan 全体）

- Task 1〜8 のコミットが `worktree-w35-monthly-pack` に積まれ、`git status --short` が空。
- `node --test tests/*.test.js` 全緑（既存 418 ＋ `money-budget` 22）／pytest 106／`w35-smoke.js`・`w3-smoke.js`（128）・`cockpit-e2e.js`（新基準値）・`portal-money-smoke.js` が `ALL PASS`。
- `git diff --stat -- api/ tests/fixtures/ index.html db/ scripts/ vercel.json` が空（Vercel 関数 11/12 を維持）。
- `scratchpad/w35-real-shots/` に 6 枚（1440/390 × dash/report/config）・全て pageerror 0。
- 本人の本番（persona ログイン）実機サニティは merge/push 後（plan の外）。

## 統合セッションへの申し送り

1. **`.claude/CLAUDE.md` への追記は main 直下で行う**（git 管理外＝worktree からは編集不能・W3 §11 と同じ）。追記先＝「お金の司令塔／司令室」節の `🆕 W3` bullet の直後。貼る文面は **spec §11 の追記ブロック（Task 8 で `N` を実測へ置換済み）をそのままコピー**する。
2. **Obsidian への昇格も統合時**（並行セッション記憶2層ルールの層2）。書く先＝`Projects/investment-portal.md`「🎨 UIUX刷新スレッド」に W3.5 の完了と次の起点、`Projects/wealth-cockpit-v2.md` に `state.budgets` の存在と「予算＝意図は司令室／実績は kakeibo 由来」の役割分担、`MEMORY.md` の investment-portal 行に「W3.5 月次パック ✅」。
3. **新基準値**: `cockpit-e2e.js` = N asserts（W3 時点 241）／`node --test tests/*.test.js` = M（W3 時点 418・W3.5 で +22）。次 wave はこの値から動かす。
4. **別レーンの持ち越し（本 wave の対象外）**: 既存の 390px 横溢れ（設定タブの `.mcc-field` 幅 209px が fullPage 幅 471px を作る・`overflow-x: clip` で画面には出ない）＝spec §11。直すなら別 wave。
5. **将来 wave の入口**: `budgets` を AI に渡すときは `advice.py _migrate`／`_normalize_budgets` 鏡像＋coarsen（費目名は production で出さない）＋`FACTS_SCHEMA_VERSION` 7＋fixture 追加が必要。本 wave は入口を作っていない（`tests/money-budget.test.js` の不変条件⑤がそれを機械で守る）。
