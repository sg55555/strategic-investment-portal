// scratchpad/discipline-disclaimer-verify.js — Important修正の局所検証。
// renderDisciplineCard に免責 fail-closed ゲート＋免責同梱を追加した後、
// #discipline-card がなお描画され（トレンド強度/ADX/値幅/ATR%/note）、免責文が同梱されるかを確認。
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));

  await page.goto("http://localhost:8200/?diag=off", { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
    { timeout: 8000 }
  ).catch(() => {});

  await page.evaluate(() => { if (typeof navigateToDetail === "function") navigateToDetail("7203.T"); });
  await page.waitForTimeout(1200);

  const st = await page.evaluate(() => {
    const disc = window.DetailRules && window.DetailRules.ANALYSIS_DISCLAIMER;
    const card = document.getElementById("discipline-card");
    const visible = !!card && card.style.display !== "none";
    const text = card ? card.textContent : "";
    const html = card ? card.innerHTML : "";
    return { disc, visible, text, hasPanelDisclaimerEl: !!(card && card.querySelector(".panel-disclaimer")) };
  });

  const results = {
    errors,
    cardVisible: st.visible,
    hasTrendStrength: /トレンド強度/.test(st.text),
    hasAdx: /ADX/.test(st.text),
    hasVolWidth: /値幅/.test(st.text),
    hasAtrPct: /ATR%/.test(st.text),
    hasNote: st.text.length > 0,
    disclaimerTextPresent: !!st.disc && st.text.indexOf(st.disc) !== -1,
    panelDisclaimerElPresent: st.hasPanelDisclaimerEl,
  };

  const pass =
    results.cardVisible && results.hasTrendStrength && results.hasAdx && results.hasVolWidth &&
    results.hasAtrPct && results.disclaimerTextPresent && results.panelDisclaimerElPresent &&
    errors.length === 0;

  console.log(JSON.stringify(results, null, 2));
  console.log(pass ? "PASS" : "FAIL");
  await browser.close();
  process.exit(pass ? 0 : 1);
})();
