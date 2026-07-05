const { chromium } = require("playwright");
const { spawn } = require("child_process");
const { FIXTURE } = require("./bundleC-fixture.js");
const WT = "/home/shugo/apps/investment-portal/.claude/worktrees/bundleC-discipline-tools";
const PORT = 8971;
(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: WT, stdio: "ignore" });
  await new Promise(r => setTimeout(r, 900));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.route("**/api/market/list", route => route.fulfill({ contentType: "application/json", body: JSON.stringify(FIXTURE) }));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".portal-table tbody tr", { timeout: 8000 });
  // 既定フィルタは "stock_only"（ETF除外）。ETF行を見るため「すべて」に切替。
  await page.click("#quick-filter-all");
  await page.waitForTimeout(200);
  const hasScreener = await page.evaluate(() => typeof window.ScreenerRules === "object");
  // ETF row (日経225) 営業利益率/ROE cells should be "--", not "0.0%"
  const etfCells = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    const etf = rows.find(r => r.textContent.includes("日経225"));
    if (!etf) return null;
    const tds = [...etf.querySelectorAll("td")];
    return { op: tds[8]?.textContent.trim(), roe: tds[9]?.textContent.trim() };
  });
  // 正常株 (トヨタ) ROE should contain a % number
  const toyotaRoe = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    const t = rows.find(r => r.textContent.includes("トヨタ"));
    return t ? [...t.querySelectorAll("td")][9]?.textContent.trim() : null;
  });
  await browser.close(); server.kill();
  const ok = hasScreener && etfCells && etfCells.op.includes("--") && etfCells.roe.includes("--") && /%/.test(toyotaRoe || "") && errors.length === 0;
  console.log(JSON.stringify({ hasScreener, etfCells, toyotaRoe, errors, PASS: ok }, null, 2));
  process.exit(ok ? 0 : 1);
})();
