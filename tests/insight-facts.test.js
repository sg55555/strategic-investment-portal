const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const FR = require("../finance-rules.js");
const CASES = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "insight_facts_cases.json"), "utf8"));

function approx(a, b) {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-9;
}
test("finance-rules.js reproduces fixture expectations (JS authority)", () => {
  for (const c of CASES.finCases) {
    const f = c.fin, e = c.expect, d = FR.dupont(f);
    assert.ok(approx(d.netMargin, e.net_margin), c.name + " net_margin");
    assert.ok(approx(d.assetTurnover, e.asset_turnover), c.name + " asset_turnover");
    assert.ok(approx(d.equityMultiplier, e.equity_multiplier), c.name + " equity_multiplier");
    assert.ok(approx(d.roe, e.roe), c.name + " roe");
    assert.ok(approx(FR.fcf(f), e.fcf), c.name + " fcf");
    assert.ok(approx(FR.fcfMargin(f), e.fcf_margin), c.name + " fcf_margin");
    assert.ok(approx(FR.cashConversion(f), e.cash_conversion), c.name + " cash_conversion");
  }
});
