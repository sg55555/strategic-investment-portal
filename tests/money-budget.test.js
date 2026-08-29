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
    // 40字境界: 40字目が畳み済み空白（元41字）だと slice だけでは末尾に空白が残り、
    // 2周目の trim で長さが 40→39 に変わって冪等性が破れる（レビュー所見の実測ケース）
    { total: 1, items: [{ name: "a".repeat(39) + " " + "b", amount: 100 }] },
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
    // Ruling A4（spec §10.1 が正）: budgets 以外の migrate 出力が fixture 71 ケース全件で不変であることの機械証明
    // （既存 fixture の state に budgets を足しても、migrate が返す他フィールドは 1 バイトも変わらない）
    const migWithB = R.migrate(withB), migBase = R.migrate(c.state);
    assert.deepEqual(
      Object.assign({}, migWithB, { budgets: undefined }),
      Object.assign({}, migBase, { budgets: undefined }),
      c.name
    );
  });
  assert.ok(CASES.length >= 71, "fixture ケース数 " + CASES.length);
});

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

module.exports = { mkRow, mkState };
