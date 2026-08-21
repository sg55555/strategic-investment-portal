// 修正③ 受入: 単位バッジ3枚・BS単位層不変(D10)・ヘッダ単位削除・冪等（spec §7）
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  const open = async (t) => { await page.evaluate((tk) => navigateToDetail(tk), t); await page.waitForTimeout(800); };
  const badge = (id) => page.evaluate((i) => document.getElementById(i)?.textContent || null, id);

  await open("7203.T");
  for (const id of ["bs-title-unit-badge", "pl-title-unit-badge", "cf-title-unit-badge"]) {
    check(`${id} が存在し「単位:」表示`, /単位:/.test(await badge(id)));
  }
  // 自己整合: バッジ = unitLabel(pickUnit(各チャート母集合))
  const consistent = await page.evaluate(() => {
    const fin = Object.entries(STOCK_DATA["7203.T"].financials_trend)
      .filter(([, f]) => FinanceRules.hasFinSubstance(f))
      .sort(([a], [b]) => b - a)[0][1];
    const cur = STOCK_DATA["7203.T"].currency;
    const dna = fin.net_assets < 0 ? 0 : fin.net_assets;
    const bsMax = Math.max(FinanceRules.totalAssets(fin),
      FinanceRules.n(fin.current_liabilities) + FinanceRules.n(fin.non_current_liabilities) + dna);
    return document.getElementById("bs-title-unit-badge").textContent === "単位: " + FinanceRules.unitLabel(FinanceRules.pickUnit(bsMax, cur));
  });
  check("BSバッジ＝両スタック和max由来（自己整合）", consistent);
  // D10 回帰: 7741.T（総資産1.23兆・最大セグメント<1兆）は兆円のまま
  await open("7741.T");
  check("7741.T BS=兆円（5値maxなら億円に降格＝D10回帰検知）", /兆円/.test(await badge("bs-title-unit-badge")));
  // USD 億層
  await open("BRK-B");
  const brkPl = await badge("pl-title-unit-badge");
  check("BRK-B: 十億ドル表記が消滅", !/十億/.test(brkPl));
  // ヘッダ「単位:」削除
  const header = await page.evaluate(() => document.getElementById("active-company-header").textContent);
  check("ヘッダから「単位:」削除", !/単位:/.test(header));
  // 冪等（年切替2回でバッジ重複なし）
  await open("7203.T");
  await page.evaluate(() => { [...document.querySelectorAll(".time-btn")][0].click(); });
  await page.waitForTimeout(500);
  const badgeCount = await page.evaluate(() => document.querySelectorAll("#bs-title .chart-unit-badge").length);
  check("バッジ冪等（1個のみ）", badgeCount === 1);
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
