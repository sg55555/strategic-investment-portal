const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../money-rules.js");

test("defaultState は6ヶ月バッファ・10%上限・全バケツ0", () => {
  const s = R.defaultState();
  assert.equal(s.version, R.CURRENT_VERSION);
  assert.equal(s.bufferMonths, 6);
  assert.equal(s.satelliteCapPct, 10);
  assert.equal(s.buckets.buffer.amount, 0);
  assert.equal(s.currency, "JPY");
});

test("bufferTarget = monthlyExpense * bufferMonths", () => {
  const s = R.defaultState(); s.monthlyExpense = 300000;
  assert.equal(R.bufferTarget(s), 1800000);
});

test("bufferProgress は 0..1 にclampしゼロ除算を避ける", () => {
  const s = R.defaultState();
  assert.equal(R.bufferProgress(s), 0); // target 0
  s.monthlyExpense = 100000; // target 600000
  s.buckets.buffer.amount = 300000;
  assert.equal(R.bufferProgress(s), 0.5);
  s.buckets.buffer.amount = 600000;
  assert.equal(R.bufferProgress(s), 1);
  s.buckets.buffer.amount = 9999999;
  assert.equal(R.bufferProgress(s), 1); // clamp上限
});

test("bufferRemaining は残額（達成後は0）", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; // target 600000
  s.buckets.buffer.amount = 250000;
  assert.equal(R.bufferRemaining(s), 350000);
  s.buckets.buffer.amount = 700000;
  assert.equal(R.bufferRemaining(s), 0);
});

test("investable=core+satellite、satelliteCap=investable*pct、over算出", () => {
  const s = R.defaultState();
  s.buckets.core.amount = 900000; s.buckets.satellite.amount = 100000; // investable 1,000,000
  assert.equal(R.investable(s), 1000000);
  assert.equal(R.satelliteCap(s), 100000); // 10%
  assert.equal(R.satelliteOver(s), 0);
  s.buckets.satellite.amount = 150000; // investable 1,050,000 cap 105,000 -> over 45,000
  assert.equal(R.satelliteCap(s), 105000);
  assert.equal(R.satelliteOver(s), 45000);
});

test("investable=0 では cap=0・over=0（ゼロ除算なし）", () => {
  const s = R.defaultState();
  assert.equal(R.satelliteCap(s), 0);
  assert.equal(R.satelliteOver(s), 0);
});

test("nextAllocation: バッファ未達 -> buffer", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; s.buckets.buffer.amount = 0;
  const n = R.nextAllocation(s);
  assert.equal(n.target, "buffer");
  assert.equal(n.remaining, 600000);
  assert.match(n.message, /バッファへ/);
});

test("nextAllocation: バッファ達成・サテライト上限内 -> core", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; s.buckets.buffer.amount = 600000;
  s.buckets.core.amount = 900000; s.buckets.satellite.amount = 100000;
  assert.equal(R.nextAllocation(s).target, "core");
});

test("nextAllocation: バッファ達成・サテライト超過 -> rebalance", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; s.buckets.buffer.amount = 600000;
  s.buckets.core.amount = 100000; s.buckets.satellite.amount = 500000; // investable 600000 cap 60000 over 440000
  assert.equal(R.nextAllocation(s).target, "rebalance");
});

test("migrate はゴミ入力を安全なstateに正規化", () => {
  const m = R.migrate({ monthlyExpense: "abc", bufferMonths: -3, buckets: { satellite: { amount: -5 } }, history: "nope", satelliteCapPct: 25 });
  assert.equal(m.monthlyExpense, 0);
  assert.equal(m.bufferMonths, 6);
  assert.equal(m.buckets.satellite.amount, 0);
  assert.equal(m.satelliteCapPct, 25);
  assert.deepEqual(m.history, []);
  assert.equal(m.version, R.CURRENT_VERSION);
});

test("migrate(null) は defaultState 同等", () => {
  assert.deepEqual(R.migrate(null), R.defaultState());
});

test("viewModel は表示用フィールドを公開", () => {
  const s = R.defaultState(); s.monthlyExpense = 100000; s.buckets.buffer.amount = 300000;
  const vm = R.viewModel(s);
  assert.equal(vm.bufferProgressPct, 50);
  assert.equal(vm.bufferRemaining, 300000);
  assert.equal(typeof vm.next.message, "string");
  assert.equal(vm.fmt(1234), "¥1,234");
});

test("nextAllocation: 未設定(target=0) -> setup", () => {
  const s = R.defaultState(); // monthlyExpense=0 => bufferTarget 0
  assert.equal(R.nextAllocation(s).target, "setup");
});

test("viewModel.bufferConfigured は target>0 で true", () => {
  const s = R.defaultState();
  assert.equal(R.viewModel(s).bufferConfigured, false);
  s.monthlyExpense = 100000;
  assert.equal(R.viewModel(s).bufferConfigured, true);
});
