const { chromium } = require("playwright");
const { spawn } = require("child_process");
const { FIXTURE } = require("./bundleC-fixture.js");
const WT = "/home/shugo/apps/investment-portal/.claude/worktrees/bundleC-discipline-tools";
const PORT = 8972;
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
  // 既定フィルタは "stock_only"（ETF除外）。ETF行(日経225)を見るため「すべて」に切替。
  await page.click("#quick-filter-all");
  await page.waitForTimeout(200);

  // トヨタ行のトレンドセルに成長バッジ (CAGR + %) があるか
  const toyotaBadge = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    const t = rows.find(r => r.textContent.includes("トヨタ"));
    if (!t) return null;
    const badge = t.querySelectorAll("td")[3]?.querySelector(".growth-badge");
    if (!badge) return null;
    return { text: badge.textContent.trim(), outerHTML: badge.outerHTML, style: badge.getAttribute("style") || "" };
  });

  // ヘッダソート: th[onclick*="salesCagr"] をクリック → 1回目/2回目 (asc/desc) 両方で ETF(日経225, salesCagr=null) が最終データ行
  const headerExists = await page.evaluate(() => !!document.querySelector('th[onclick*="salesCagr"]'));
  await page.click('th[onclick*="salesCagr"]');
  await page.waitForTimeout(200);
  const lastRowAfterClick1 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    return rows.length ? rows[rows.length - 1].textContent : null;
  });
  await page.click('th[onclick*="salesCagr"]');
  await page.waitForTimeout(200);
  const lastRowAfterClick2 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    return rows.length ? rows[rows.length - 1].textContent : null;
  });

  await browser.close(); server.kill();

  const badgeOk = !!toyotaBadge
    && toyotaBadge.text.includes("CAGR")
    && /\d+\.\d%/.test(toyotaBadge.text)
    && !/#00e676|#ff5c7a|#ff1744|#ffd60a|#ffd84d/i.test(toyotaBadge.outerHTML)
    && /opacity/.test(toyotaBadge.style);
  const nullLastOk = (lastRowAfterClick1 || "").includes("日経225") && (lastRowAfterClick2 || "").includes("日経225");
  const ok = headerExists && badgeOk && nullLastOk && errors.length === 0;

  console.log(JSON.stringify({
    headerExists, toyotaBadge, lastRowAfterClick1: (lastRowAfterClick1 || "").slice(0, 60),
    lastRowAfterClick2: (lastRowAfterClick2 || "").slice(0, 60), badgeOk, nullLastOk, errors, PASS: ok,
  }, null, 2));
  process.exit(ok ? 0 : 1);
})();
