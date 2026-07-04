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

// 最新年 = 2025。7グリッド財務。per/pbr/marketCap は raw 直下。
function jpStock(over) {
  return Object.assign({
    company_name: "テスト", industry: "電気機器", currency: "JPY", country: "JP", type: "stock",
    per: 15, pbr: 1.5, marketCap: 1e12,
    financials_trend: { "2024": { year: 2024, net_sales: 900, net_assets: 500, current_assets: 400,
      non_current_assets: 600, current_liabilities: 200, operating_income: 90, net_income: 60 },
      "2025": { year: 2025, net_sales: 1000, net_assets: 600, current_assets: 500,
        non_current_assets: 500, current_liabilities: 250, operating_income: 120, net_income: 80 } },
  }, over || {});
}
test("buildUniverse: ETF除外・市場分割・0欠測・最新年採用", () => {
  const data = {
    "1.T": jpStock({ per: 10 }),
    "2.T": jpStock({ per: 20, marketCap: 0 }),        // marketCap=0 → 欠測
    "3.T": jpStock({ per: 0 }),                        // per=0 → 欠測
    "ETF.T": jpStock({ type: "etf", financials_trend: {} }),
    "AAA": jpStock({ country: "US", currency: "USD", industry: "US - Tech" }),
  };
  const u = CS.buildUniverse(data);
  assert.deepStrictEqual([...u.JP.per].sort((a, b) => a - b), [10, 20]); // "2.T" は per=20 有効(marketCapのみ欠測). "3.T" per=0は欠測.
  // 注: "2.T" は per=20 有効(marketCapのみ欠測)。per配列 = [10,20]の有効値（"3.T" per=0は欠測）
  assert.ok(u.JP._members.length === 3);   // ETF除外・US別 → JP stock 3件
  assert.ok(u.US._members.length === 1);
  assert.strictEqual(u.JP.marketCap.filter(v => v === 0).length, 0); // 0は入らない
  // ROE(最新2025) = 80/600*100 ≈ 13.33
  const roe = u.JP._members[0].values.roe;
  assert.ok(Math.abs(roe - 13.333) < 0.01);
});
test("_latestFin: max year / empty", () => {
  assert.strictEqual(CS._latestFin(jpStock()).year, 2025);
  assert.strictEqual(CS._latestFin({ financials_trend: {} }), null);
});
