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

module.exports = { mkRow, mkState };
