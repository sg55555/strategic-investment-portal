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
test("relativePosition: 中立語彙のみ・自市場内・欠測データなし・ETF", () => {
  const data = {
    "A.T": jpStock({ per: 10, roe: undefined }),   // roe は財務から算出
    "B.T": jpStock({ per: 30 }),
    "C.T": jpStock({ per: 20, financials_trend: { "2025": { year: 2025, net_sales: 1000, net_assets: 600,
      current_assets: 500, non_current_assets: 500, current_liabilities: 250, operating_income: 120 } } }), // net_income欠落
  };
  const rp = CS.relativePosition("A.T", data);
  assert.strictEqual(rp.market, "JP");
  assert.strictEqual(rp.marketLabel, "日本株");
  const per = rp.groups[0].metrics.find(m => m.key === "per");
  assert.strictEqual(per.value, 10);
  assert.ok(per.caption.includes("日本株") && per.caption.includes("パーセンタイル"));
  // C.T は net_income 欠落 → roe/netMargin は欠測(=universe に入らない)。A.T の roe は算出可。
  const roe = rp.groups[1].metrics.find(m => m.key === "roe");
  assert.ok(roe.value != null);
  // 中立語彙: どの caption/band にも売買/予測語が無い
  const BANNED = ["買い", "売り", "買う", "売る", "推奨", "割安なので", "上がる", "下がる", "狙い目", "お得"];
  const allText = JSON.stringify(rp);
  BANNED.forEach(w => assert.ok(!allText.includes(w), "banned word: " + w));
  assert.deepStrictEqual(CS.relativePosition("ETF.T", { "ETF.T": jpStock({ type: "etf", financials_trend: {} }) }), { etf: true });
  assert.strictEqual(CS.relativePosition("NOPE", data), null);
});
test("compareMetricsRows: ETFはN/A・欠測—・marketCapは通貨付き", () => {
  const data = { "A.T": jpStock(), "ETF.T": jpStock({ type: "etf", financials_trend: {} }) };
  const rows = CS.compareMetricsRows(["A.T", "ETF.T", "NOPE"], data);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].cells.per.missing, false);
  assert.strictEqual(rows[1].isEtf, true);
  assert.strictEqual(rows[1].cells.roe.missing, true);
  assert.strictEqual(rows[1].cells.roe.format, "—");
  assert.strictEqual(rows[1].cells.marketCap.missing, false); // ETFでも時価総額は出す
});
test("rankByMetric: 自市場内・PER昇順(低い順)・decile", () => {
  const data = { "A.T": jpStock({ per: 10 }), "B.T": jpStock({ per: 30 }), "C.T": jpStock({ per: 20 }) };
  const u = CS.buildUniverse(data);
  const r = CS.rankByMetric(u, "JP", "per");
  assert.deepStrictEqual(r.map(x => x.ticker), ["A.T", "C.T", "B.T"]); // higherIsBetter=false → asc
  assert.strictEqual(r[0].rank, 1);
});
test("scatterPoints: 両軸欠測除外 + 中央値", () => {
  const data = { "A.T": jpStock({ per: 10 }), "B.T": jpStock({ per: 20 }) };
  const u = CS.buildUniverse(data);
  const s = CS.scatterPoints(u, "JP", "per", "roe");
  assert.strictEqual(s.points.length, 2);
  assert.strictEqual(s.xMedian, 15);
  assert.ok(s.xLabel === "PER" && s.yLabel === "ROE");
});
test("sectorMedians: N<minNはその他集約", () => {
  const mk = (sec, per) => jpStock({ industry: sec, per });
  const data = { "1.T": mk("金融", 10), "2.T": mk("金融", 12), "3.T": mk("金融", 14),
    "4.T": mk("小売", 20), "5.T": mk("食品", 22) };
  const u = CS.buildUniverse(data);
  const sm = CS.sectorMedians(u, "JP", "per", { minN: 3 });
  const fin = sm.find(x => x.sector === "金融");
  const other = sm.find(x => x.sector === "その他");
  assert.strictEqual(fin.n, 3);
  assert.strictEqual(fin.median, 12);
  assert.strictEqual(other.n, 2); // 小売+食品
});
test("METRIC_REGISTRY termKeys all resolve in INDICATOR_GLOSSARY", () => {
  const DR = require("../detail-rules.js");
  const gloss = new Set(DR.INDICATOR_GLOSSARY.map(g => g.term));
  CS.METRIC_REGISTRY.forEach(m => {
    assert.ok(gloss.has(m.termKey), `termKey "${m.termKey}" (${m.key}) missing from INDICATOR_GLOSSARY`);
  });
});
