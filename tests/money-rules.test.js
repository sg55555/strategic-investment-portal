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

// --- Slice2: 目標機能（goals）＋クラウド同期 ---

test("defaultState は v2・goals 空配列", () => {
  const s = R.defaultState();
  assert.equal(s.version, 2);
  assert.equal(R.CURRENT_VERSION, 2);
  assert.deepEqual(s.goals, []);
});

test("totalAssets = buffer+core+satellite", () => {
  const s = R.defaultState();
  s.buckets.buffer.amount = 500000; s.buckets.core.amount = 900000; s.buckets.satellite.amount = 100000;
  assert.equal(R.totalAssets(s), 1500000);
});

test("migrate(v1・goals無し) は goals:[] を補う", () => {
  const m = R.migrate({ version: 1, monthlyExpense: 100000 });
  assert.deepEqual(m.goals, []);
  assert.equal(m.version, 2);
});

test("migrate は goals を正規化（不正額→0・不正日付→空・id/label保持）", () => {
  const m = R.migrate({
    goals: [
      { id: "g1", label: "FIRE", targetAmount: 50000000, deadline: "2040-01-01" },
      { id: "g2", label: "車", targetAmount: "abc", deadline: "not-a-date" },
      "garbage",
      { label: 123, targetAmount: -5 },
    ],
  });
  assert.equal(m.goals.length, 3); // "garbage"(非object)は除外
  assert.deepEqual(m.goals[0], { id: "g1", label: "FIRE", targetAmount: 50000000, deadline: "2040-01-01" });
  assert.equal(m.goals[1].targetAmount, 0);
  assert.equal(m.goals[1].deadline, "");
  assert.equal(m.goals[2].label, ""); // 非文字列labelは空
  assert.equal(m.goals[2].targetAmount, 0); // 負は0
  assert.equal(typeof m.goals[2].id, "string"); // id欠落でも文字列を割当
});

test("viewModel.goals は totalAssets基準の進捗を付与", () => {
  const s = R.defaultState();
  s.buckets.buffer.amount = 1000000; s.buckets.core.amount = 1000000; // total 2,000,000
  s.goals = [{ id: "g1", label: "目標", targetAmount: 8000000, deadline: "2030-12-31" }];
  const vm = R.viewModel(s);
  assert.equal(vm.totalAssets, 2000000);
  assert.equal(vm.goals.length, 1);
  assert.equal(vm.goals[0].progress, 0.25);
  assert.equal(vm.goals[0].progressPct, 25);
  assert.equal(vm.goals[0].remaining, 6000000);
  assert.equal(vm.goals[0].achieved, false);
  assert.equal(vm.goals[0].label, "目標");
});

test("goalProgress: targetAmount=0 はゼロ除算せず progress0・remaining0", () => {
  const g = R.goalProgress({ id: "x", label: "未設定", targetAmount: 0, deadline: "" }, 1000000);
  assert.equal(g.progress, 0);
  assert.equal(g.progressPct, 0);
  assert.equal(g.remaining, 0);
  assert.equal(g.achieved, false);
});

test("goalProgress: 達成は progress=1(clamp)・achieved=true・remaining0", () => {
  const g = R.goalProgress({ id: "x", label: "達成", targetAmount: 1000000, deadline: "" }, 1500000);
  assert.equal(g.progress, 1);
  assert.equal(g.progressPct, 100);
  assert.equal(g.remaining, 0);
  assert.equal(g.achieved, true);
});

test("defaultState は updatedAt:0（last-write-wins 用）", () => {
  assert.equal(R.defaultState().updatedAt, 0);
});

test("migrate は updatedAt を数値で通す（不正は0）", () => {
  assert.equal(R.migrate({ updatedAt: 1719500000000 }).updatedAt, 1719500000000);
  assert.equal(R.migrate({ updatedAt: "bad" }).updatedAt, 0);
  assert.equal(R.migrate({}).updatedAt, 0);
});
