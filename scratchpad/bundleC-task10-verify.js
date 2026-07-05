const { chromium } = require("playwright");
const { spawn } = require("child_process");
const { FIXTURE } = require("./bundleC-fixture.js");
const WT = "/home/shugo/apps/investment-portal/.claude/worktrees/bundleC-discipline-tools";
const PORT = 8974;
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

  // ETF (1321.T) を含める（既定は stock_only）
  await page.click("#quick-filter-all");
  await page.waitForTimeout(200);

  // スクリーニングパネルを開く
  await page.click("#screening-toggle");
  await page.waitForTimeout(200);

  const getTickers = async () => page.evaluate(() =>
    [...document.querySelectorAll(".portal-table tbody tr .ticker-code")].map(el => el.textContent.trim())
  );

  const resetPanel = async () => {
    await page.click(".screening-reset-btn");
    await page.waitForTimeout(150);
  };

  // ---- 1) 8軸フィルタ：ROE >= 8 → ETF(roe=null) 除外・トヨタ(roe≈10.6) 残存 ----
  await page.fill("#scr-roe-min", "8");
  await page.dispatchEvent("#scr-roe-min", "input");
  await page.waitForTimeout(150);
  let tickers = await getTickers();
  const roeTest = !tickers.includes("1321.T") && tickers.includes("7203.T");

  await resetPanel();

  // ---- 2) nullable max-only: op-max=12 のみ → ETF(opMargin=null) 除外 ----
  await page.fill("#scr-op-max", "12");
  await page.dispatchEvent("#scr-op-max", "input");
  await page.waitForTimeout(150);
  tickers = await getTickers();
  const opMaxTest = !tickers.includes("1321.T");

  await resetPanel();

  // ---- 3) 市場 AND: US を外す → AAPL 除外・JP株は残存 ----
  await page.uncheck("#scr-mkt-us");
  await page.waitForTimeout(150);
  tickers = await getTickers();
  const marketTest = !tickers.includes("AAPL") && tickers.includes("7203.T") && tickers.includes("6758.T");
  await page.check("#scr-mkt-us");
  await page.waitForTimeout(150);

  // ---- 4) バッジ ----
  // 4a: 軸フィルタ有効 → "銘柄" を含む
  await page.fill("#scr-roe-min", "8");
  await page.dispatchEvent("#scr-roe-min", "input");
  await page.waitForTimeout(150);
  const badgeWithAxis = await page.textContent("#screening-count");
  const badgeAxisTest = badgeWithAxis.includes("銘柄");

  await resetPanel();
  // 4b: 両市場チェック・軸なし → 空
  const badgeReset = await page.textContent("#screening-count");
  const badgeResetTest = badgeReset.trim() === "";

  // 4c: US のみ外す（軸なし）→ 市場のみでも制約とみなしバッジ表示
  await page.uncheck("#scr-mkt-us");
  await page.waitForTimeout(150);
  const badgeMarketOnly = await page.textContent("#screening-count");
  const badgeMarketOnlyTest = badgeMarketOnly.includes("銘柄");
  await page.check("#scr-mkt-us");
  await page.waitForTimeout(150);
  await resetPanel();

  // ---- 5) termHelp 注入 ----
  const termResult = await page.evaluate(() => {
    const panelCount = document.querySelectorAll("#screening-panel .term-help").length;
    const growthHeader = document.querySelector('.portal-table thead th[data-term="growth-rate"]');
    const growthHasTerm = growthHeader ? !!growthHeader.querySelector(".term-help") : false;
    return { panelCount, growthHasTerm };
  });
  const termTest = termResult.panelCount >= 1 && termResult.growthHasTerm;

  await browser.close(); server.kill();

  const result = {
    roeTest, opMaxTest, marketTest,
    badgeAxisTest, badgeResetTest, badgeMarketOnlyTest,
    termPanelCount: termResult.panelCount, termGrowthHasTerm: termResult.growthHasTerm, termTest,
    errors,
  };
  const ok = roeTest && opMaxTest && marketTest && badgeAxisTest && badgeResetTest && badgeMarketOnlyTest && termTest && errors.length === 0;

  console.log(JSON.stringify({ ...result, PASS: ok }, null, 2));
  process.exit(ok ? 0 : 1);
})();
