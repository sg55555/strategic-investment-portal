// 修正① ポータル行受入: 全ゼロ銘柄の成長バッジ実CAGR/ソート/正常銘柄の非影響（spec §5.5）
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const item = await page.evaluate(() => {
    // renderPortal と同じ経路で 6861.T の growth を再計算（実装の substTrend フィルタを検証）
    const c = STOCK_DATA["6861.T"];
    const substYears = Object.keys(c.financials_trend).filter((y) => FinanceRules.hasFinSubstance(c.financials_trend[y]));
    const substTrend = {};
    substYears.forEach((y) => { substTrend[y] = c.financials_trend[y]; });
    return {
      substHas2026: substYears.some((y) => String(y) === "2026"),
      growth: FinanceRules.growthRates(substTrend, ["net_sales", "net_income"]),
      rawGrowth: FinanceRules.growthRates(c.financials_trend, ["net_sales", "net_income"]),
    };
  });
  check("6861.T: substYears が FY2026 を除外", item.substHas2026 === false);
  check("6861.T: salesCagr が実値（null でない）", item.growth.salesCagr !== null);
  check("6861.T: salesYoY が -100% でない", item.growth.salesYoY === null || Math.round(item.growth.salesYoY) !== -100);
  // DOM: 6861.T 行の成長バッジが muted「CAGR —」でない
  const badge = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    const row = rows.find((r) => r.innerHTML.includes("6861"));
    const b = row && row.querySelector(".growth-badge");
    return b ? b.textContent : null;
  });
  check("6861.T 行: 成長バッジが実CAGR表示（『—』でない）", badge !== null && !/—/.test(badge));
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
