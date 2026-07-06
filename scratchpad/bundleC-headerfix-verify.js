// 束C 最終レビュー LOW修正検証：売上3期(salesCagr)見出しの用語ヘルプ「?」クリックが
// setSort('salesCagr') を誤発火してソートしてしまう衝突の解消を確認する。
// 1) grid renderers 経由で injectTermHelp が th に .term-help を注入していること
// 2) .term-help（?）をクリックしても行順序が変化しない（ソート未発火）・pageerror無し
// 3) 見出しラベル側（.sort-icon）をクリックすると行順序が変化する（ソートは正常動作）
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const { FIXTURE } = require("./bundleC-fixture.js");
const WT = "/home/shugo/apps/investment-portal/.claude/worktrees/bundleC-discipline-tools";
const PORT = 8981;

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: WT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 900));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.route("**/api/market/list", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(FIXTURE) })
  );
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".portal-table tbody tr", { timeout: 8000 });

  const salesCagrThSelector = "th[onclick*=\"salesCagr\"]";

  // ---- 1) injectTermHelp が th に .term-help を注入していること ----
  const termHelpPresent = await page.$eval(salesCagrThSelector, (th) => !!th.querySelector(":scope > .term-help"));

  const getRowOrder = () =>
    page.$$eval(".portal-table tbody tr .company-clickable", (els) => els.map((el) => el.textContent.trim()));

  const orderBefore = await getRowOrder();

  // ---- 2) .term-help（?）をクリック → ソート未発火（行順序不変）----
  await page.click(`${salesCagrThSelector} .term-help`);
  await page.waitForTimeout(150);
  const orderAfterHelpClick = await getRowOrder();
  const helpClickNoSort = JSON.stringify(orderBefore) === JSON.stringify(orderAfterHelpClick);

  // ---- 3) 見出しラベル側（.sort-icon）をクリック → ソート発火（行順序が変化）----
  // 1回目のクリックで salesCagr 降順になるが、本フィクスチャは偶然 ticker 昇順と同順（Sony>Toyota>Apple）
  // になり得るため、同じ .sort-icon を再クリックして昇順へトグルし、確実に順序が変わることを見る。
  await page.click(`${salesCagrThSelector} .sort-icon`);
  await page.waitForTimeout(150);
  await page.click(`${salesCagrThSelector} .sort-icon`);
  await page.waitForTimeout(150);
  const orderAfterLabelClick = await getRowOrder();
  const labelClickSorts = JSON.stringify(orderAfterHelpClick) !== JSON.stringify(orderAfterLabelClick);

  await browser.close();
  server.kill();

  const result = {
    termHelpPresent,
    orderBefore,
    orderAfterHelpClick,
    orderAfterLabelClick,
    helpClickNoSort,
    labelClickSorts,
    errors,
  };
  const ok = termHelpPresent && helpClickNoSort && labelClickSorts && errors.length === 0;

  console.log(JSON.stringify({ ...result, PASS: ok }, null, 2));
  process.exit(ok ? 0 : 1);
})();
