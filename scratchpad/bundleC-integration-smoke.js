// Task12: 束C 統合スモーク（① 成長 + ② スクリーナー を同一セッションで通し検証 + 既存ビュー回帰）。
// python3 http.server + route-mock FIXTURE + pageerror listener + dialog queue（Task7-11 の実証済パターンを結合）。
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const { FIXTURE } = require("./bundleC-fixture.js");
const WT = "/home/shugo/apps/investment-portal/.claude/worktrees/bundleC-discipline-tools";
const PORT = 8980;

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: WT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 900));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  const dialogQueue = [];
  let unexpectedDialogs = 0;
  page.on("dialog", async (dialog) => {
    const next = dialogQueue.shift();
    if (!next) { unexpectedDialogs++; await dialog.dismiss(); return; }
    if (next.action === "accept") await dialog.accept(next.value);
    else await dialog.dismiss();
  });

  await page.route("**/api/market/list", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(FIXTURE) })
  );
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".portal-table tbody tr", { timeout: 8000 });

  const result = {};

  const getTickers = async () =>
    page.evaluate(() => [...document.querySelectorAll(".portal-table tbody tr .ticker-code")].map((el) => el.textContent.trim()));
  const getLS = async () => page.evaluate(() => JSON.parse(localStorage.getItem("sip_screener_presets") || "[]"));
  const resetPanel = async () => { await page.click(".screening-reset-btn"); await page.waitForTimeout(150); };
  const setInput = async (sel, val) => { await page.fill(sel, String(val)); await page.dispatchEvent(sel, "input"); await page.waitForTimeout(150); };

  // ETF行を含める（既定は stock_only）。以降のグリッド系検証は全て「すべて」フィルタ下で行う。
  await page.click("#quick-filter-all");
  await page.waitForTimeout(200);

  // ============================================================
  // ① 成長: バッジ表示・色・ソート null-last
  // ============================================================
  const toyotaBadge = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    const t = rows.find((r) => r.textContent.includes("トヨタ"));
    if (!t) return null;
    const badge = t.querySelectorAll("td")[3]?.querySelector(".growth-badge");
    if (!badge) return null;
    return { text: badge.textContent.trim(), outerHTML: badge.outerHTML, style: badge.getAttribute("style") || "" };
  });
  result.growthBadgeTest =
    !!toyotaBadge &&
    toyotaBadge.text.includes("CAGR") &&
    /%/.test(toyotaBadge.text) &&
    !/#00e676|#ff5c7a|#ff1744|#ffd60a|#ffd84d/i.test(toyotaBadge.outerHTML) &&
    /opacity/.test(toyotaBadge.style);

  const headerExists = await page.evaluate(() => !!document.querySelector('th[onclick*="salesCagr"]'));
  await page.click('th[onclick*="salesCagr"]');
  await page.waitForTimeout(200);
  const lastRow1 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    return rows.length ? rows[rows.length - 1].textContent : null;
  });
  await page.click('th[onclick*="salesCagr"]');
  await page.waitForTimeout(200);
  const lastRow2 = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    return rows.length ? rows[rows.length - 1].textContent : null;
  });
  result.nullLastSortTest = headerExists && (lastRow1 || "").includes("日経225") && (lastRow2 || "").includes("日経225");

  // ============================================================
  // ① ETF ratio "--"（0.0% ではない）
  // ============================================================
  const etfCells = await page.evaluate(() => {
    const rows = [...document.querySelectorAll(".portal-table tbody tr")];
    const etf = rows.find((r) => r.textContent.includes("日経225"));
    if (!etf) return null;
    const tds = [...etf.querySelectorAll("td")];
    return { op: tds[8]?.textContent.trim(), roe: tds[9]?.textContent.trim() };
  });
  result.etfRatioDashTest = !!etfCells && etfCells.op.includes("--") && etfCells.roe.includes("--");

  // ============================================================
  // ② スクリーナーパネルを開く
  // ============================================================
  await page.click("#screening-toggle");
  await page.waitForTimeout(200);

  // ---- 8軸 D1: max-only で null 除外（op-max=12） ----
  await setInput("#scr-op-max", 12);
  let tickers = await getTickers();
  result.axisMaxOnlyNullTest = !tickers.includes("1321.T");
  await resetPanel();

  // ---- 8軸: roe-min=8 → ETF(null) 除外・トヨタ 残存 ----
  await setInput("#scr-roe-min", 8);
  tickers = await getTickers();
  result.axisMinTest = !tickers.includes("1321.T") && tickers.includes("7203.T");
  await resetPanel();

  // ============================================================
  // ② 市場 AND
  // ============================================================
  await page.uncheck("#scr-mkt-us");
  await page.waitForTimeout(150);
  tickers = await getTickers();
  result.marketAndTest = !tickers.includes("AAPL") && tickers.includes("7203.T") && tickers.includes("6758.T");
  await page.check("#scr-mkt-us");
  await page.waitForTimeout(150);

  // ============================================================
  // ② バッジ（軸あり/市場のみ/両方無し）
  // ============================================================
  await setInput("#scr-roe-min", 8);
  const badgeWithAxis = await page.textContent("#screening-count");
  result.badgeAxisTest = badgeWithAxis.includes("銘柄");
  await resetPanel();

  const badgeReset = await page.textContent("#screening-count");
  result.badgeResetTest = badgeReset.trim() === "";

  await page.uncheck("#scr-mkt-us");
  await page.waitForTimeout(150);
  const badgeMarketOnly = await page.textContent("#screening-count");
  result.badgeMarketOnlyTest = badgeMarketOnly.includes("銘柄");
  await page.check("#scr-mkt-us");
  await page.waitForTimeout(150);
  await resetPanel();

  // ============================================================
  // ② プリセット CRUD（clear-first・confirm）
  // ============================================================
  await setInput("#scr-roe-min", 8);
  dialogQueue.push({ action: "accept", value: "統合" });
  await page.click(".screening-preset-btn:not(.del)");
  await page.waitForTimeout(200);
  const optsAfterSave = await page.$$eval("#scr-preset-select option", (o) => o.map((x) => x.textContent));
  const lsAfterSave = await getLS();
  const presetSaveTest =
    optsAfterSave.includes("統合") && lsAfterSave.length === 1 &&
    lsAfterSave[0].name === "統合" && lsAfterSave[0].criteria.roe && lsAfterSave[0].criteria.roe.min === 8;

  await setInput("#scr-pbr-max", 2);
  await page.selectOption("#scr-preset-select", "");
  await page.waitForTimeout(50);
  await page.selectOption("#scr-preset-select", { label: "統合" });
  await page.waitForTimeout(200);
  const pbrMaxAfter = await page.inputValue("#scr-pbr-max");
  const roeMinAfter = await page.inputValue("#scr-roe-min");
  const presetClearFirstTest = pbrMaxAfter === "" && roeMinAfter === "8";

  dialogQueue.push({ action: "accept" }); // confirm 削除
  await page.click(".screening-preset-btn.del");
  await page.waitForTimeout(200);
  const optsAfterDelete = await page.$$eval("#scr-preset-select option", (o) => o.map((x) => x.textContent));
  const lsAfterDelete = await getLS();
  const presetDeleteTest = !optsAfterDelete.includes("統合") && lsAfterDelete.length === 0;

  result.presetSaveTest = presetSaveTest;
  result.presetClearFirstTest = presetClearFirstTest;
  result.presetDeleteTest = presetDeleteTest;
  result.presetLocalStorageEmptyTest = lsAfterDelete.length === 0;

  await resetPanel();

  // ============================================================
  // 回帰: 既存4軸（PER max）
  // ============================================================
  await setInput("#scr-per-max", 15);
  tickers = await getTickers();
  result.regressionPerFilterTest = !tickers.includes("AAPL") && tickers.includes("7203.T");
  await resetPanel();
  await page.check("#scr-mkt-us"); // 保険（resetScreening が既に両方チェックに戻すが明示）
  await page.waitForTimeout(100);

  // ============================================================
  // 回帰: money view / detail view 遷移
  // ============================================================
  await page.evaluate(() => { window.MCC.show(); });
  await page.waitForTimeout(400);
  const moneyState = await page.evaluate(() => {
    const mv = document.getElementById("money-view");
    return { active: mv.classList.contains("active"), display: getComputedStyle(mv).display };
  });
  result.regressionMoneyViewTest = moneyState.active && moneyState.display !== "none";
  await page.evaluate(() => { window.MCC.backToPortal(); });
  await page.waitForTimeout(200);

  await page.evaluate((t) => { navigateToDetail(t); }, "7203.T");
  await page.waitForTimeout(500);
  const detailState = await page.evaluate(() => {
    const dv = document.getElementById("detail-view");
    return { active: dv.classList.contains("active"), display: getComputedStyle(dv).display };
  });
  result.regressionDetailViewTest = detailState.active && detailState.display !== "none";
  await page.evaluate(() => { window.navigateToPortal(); });
  await page.waitForTimeout(300);
  const portalState = await page.evaluate(() => document.getElementById("portal-view").classList.contains("active"));
  result.regressionBackToPortalTest = portalState;

  await browser.close();
  server.kill();

  result.unexpectedDialogs = unexpectedDialogs;
  result.errors = errors;
  result.pageerrorZeroTest = errors.length === 0;

  const ok = Object.keys(result).every((k) => {
    if (k === "errors" || k === "unexpectedDialogs") return true;
    return result[k] === true;
  }) && unexpectedDialogs === 0;

  console.log(JSON.stringify({ ...result, PASS: ok }, null, 2));
  process.exit(ok ? 0 : 1);
})();
