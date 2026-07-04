const { test } = require("node:test");
const assert = require("node:assert");
const CS = require("../cross-section-rules.js");

test("median: odd/even/empty/single", () => {
  assert.strictEqual(CS.median([3, 1, 2]), 2);
  assert.strictEqual(CS.median([1, 2, 3, 4]), 2.5);
  assert.strictEqual(CS.median([]), null);
  assert.strictEqual(CS.median([7]), 7);
});
test("mean: basic/empty", () => {
  assert.strictEqual(CS.mean([2, 4]), 3);
  assert.strictEqual(CS.mean([]), null);
});
test("percentileRank: midrank / single=50 / ties / empty", () => {
  assert.strictEqual(CS.percentileRank([10, 20, 30, 40], 30), 62.5); // (2 + 0.5)/4*100
  assert.strictEqual(CS.percentileRank([5], 5), 50);
  assert.strictEqual(CS.percentileRank([10, 10, 10], 10), 50);       // all-ties → 50
  assert.strictEqual(CS.percentileRank([], 5), null);
  assert.strictEqual(CS.percentileRank([1, 2, 3], NaN), null);
});
test("quantile: Q1/Q3 linear interp / single / empty", () => {
  assert.strictEqual(CS.quantile([1, 2, 3, 4, 5], 0.25), 2);
  assert.strictEqual(CS.quantile([1, 2, 3, 4, 5], 0.75), 4);
  assert.strictEqual(CS.quantile([9], 0.5), 9);
  assert.strictEqual(CS.quantile([], 0.5), null);
});
