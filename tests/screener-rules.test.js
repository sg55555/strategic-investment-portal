const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../screener-rules.js");

const STOCK = { per: 12, pbr: 1.2, opMargin: 8, roe: 10, netMargin: 5, eqRatio: 45, curRatio: 150, salesCagr: 7, country: "JP", isEtf: false };
const ETF   = { per: 0, pbr: 0, opMargin: null, roe: null, netMargin: null, eqRatio: null, curRatio: null, salesCagr: null, country: "JP", isEtf: true };

test("positive(PER): min は 0以下/未満を除外、max-only は 0以下を保持（既存挙動）", () => {
  assert.equal(S.passesScreening(STOCK, { per: { min: 10, max: null } }), true);
  assert.equal(S.passesScreening({ ...STOCK, per: 0 }, { per: { min: 10, max: null } }), false);
  assert.equal(S.passesScreening({ ...STOCK, per: 0 }, { per: { min: null, max: 15 } }), true); // max-only は per<=0 を保持
});
test("nullable(ROE): 制約時 null は除外（max-only/負min でも）", () => {
  assert.equal(S.passesScreening(STOCK, { roe: { min: 8, max: null } }), true);
  assert.equal(S.passesScreening(ETF, { roe: { min: 8, max: null } }), false);
  assert.equal(S.passesScreening(ETF, { roe: { min: null, max: 3 } }), false); // 欠測 null は max-only でも除外（D1）
  assert.equal(S.passesScreening(ETF, { opMargin: { min: -50, max: null } }), false); // 負min でも欠測除外
});
test("制約なし軸は無視", () => {
  assert.equal(S.passesScreening(ETF, {}), true);
});
