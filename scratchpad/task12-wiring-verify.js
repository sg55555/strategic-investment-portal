// scratchpad/task12-wiring-verify.js — Task12 配線検証（updateFinancialViews → renderDuPont/renderFCFTrend
// + injectTermHelp + finCards + entrance nth-child(9)(10)）。
//
// 1) 7203.T(JP equity): #dupont-card / #fcf-trend-card 可視・DuPont=3因数+ROE恒等式・FCF canvas 描画・
//    両カードに ? term-help バッジ注入・pageerror0。
// 2) 米国銘柄(AAPL・mock DB に実在確認済=financials_trend 2023-2025/currency USD)：同上＋FCFチャートの
//    金額軸(amt scale)ラベルが USD 整形（「ドル」を含む）であること。
// 3) 1321.T(ETF): 両カード display:none（finCards 登録済）。
// 4) 冪等性: 年切替(switchYearボタンクリック)・別銘柄→再navigate のいずれでもカード非増殖・?バッジ非増殖。
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8200";

async function gotoDetail(page, ticker) {
  await page.evaluate((t) => { navigateToDetail(t); }, ticker);
  await page.waitForTimeout(1100);
}

function inspect() {
  const dp = document.getElementById("dupont-card");
  const fc = document.getElementById("fcf-trend-card");
  const dpCs = dp ? getComputedStyle(dp) : null;
  const fcCs = fc ? getComputedStyle(fc) : null;
  const body = document.getElementById("dupont-body");
  const factors = body ? body.querySelectorAll(".dp-factor").length : 0;
  const hasRoeCell = body ? !!body.querySelector(".dp-roe") : false;
  const ops = body ? body.querySelectorAll(".dp-op").length : 0;
  const dpDisc = body ? body.querySelector(".panel-disclaimer") : null;
  const cv = document.getElementById("fcfTrend");
  const fcDisc = document.getElementById("fcf-trend-disclaimer");
  const chartInst = (typeof Chart !== "undefined" && typeof Chart.getChart === "function") ? Chart.getChart("fcfTrend") : null;
  const amtTitle = chartInst ? chartInst.options.scales.amt.title.text : null;
  return {
    dpPresent: !!dp,
    dpDisplay: dpCs ? dpCs.display : null,
    dpVisible: dpCs ? dpCs.display !== "none" : false,
    dpCardCount: document.querySelectorAll("#dupont-card").length,
    dpFactorCount: factors,
    dpHasRoeCell: hasRoeCell,
    dpOpCount: ops,
    dpTermHelps: dp ? dp.querySelectorAll(".card-title .term-help").length : 0,
    dpDiscLen: dpDisc ? dpDisc.textContent.trim().length : 0,
    fcPresent: !!fc,
    fcDisplay: fcCs ? fcCs.display : null,
    fcVisible: fcCs ? fcCs.display !== "none" : false,
    fcCardCount: document.querySelectorAll("#fcf-trend-card").length,
    fcCanvasW: cv ? cv.clientWidth : 0,
    fcCanvasH: cv ? cv.clientHeight : 0,
    fcChartAttached: !!chartInst,
    fcAmtTitle: amtTitle,
    fcTermHelps: fc ? fc.querySelectorAll(".card-title .term-help").length : 0,
    fcDiscLen: fcDisc ? fcDisc.textContent.trim().length : 0,
    stackCards: document.querySelectorAll(".dashboard-stack > .card").length,
  };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(
    () => (typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0),
    { timeout: 10000 }
  );

  const results = {};

  // ── 1) 7203.T(JP equity) ──
  await gotoDetail(page, "7203.T");
  results.jp = await page.evaluate(inspect);

  // ── 4a) 年切替の冪等性（別年ボタンをクリック→再度 inspect）──
  const yearBtnCount = await page.evaluate(() => document.querySelectorAll(".time-btn").length);
  if (yearBtnCount > 1) {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll(".time-btn"));
      const other = btns.find((b) => !b.classList.contains("active")) || btns[0];
      other.click();
    });
    await page.waitForTimeout(400);
  }
  results.jpAfterYearSwitch = await page.evaluate(inspect);

  // ── 2) 米国銘柄（AAPL・mock DB に実在確認済）──
  results.usTicker = await page.evaluate(() =>
    (STOCK_DATA["AAPL"] && STOCK_DATA["AAPL"].type !== "etf") ? "AAPL" :
    Object.keys(STOCK_DATA).find((k) => STOCK_DATA[k].country === "US" && STOCK_DATA[k].type !== "etf" &&
      Object.keys(STOCK_DATA[k].financials_trend || {}).length > 0) || null
  );
  if (results.usTicker) {
    await gotoDetail(page, results.usTicker);
    results.us = await page.evaluate(inspect);
  }

  // ── 4b) 冪等性: 別銘柄(US)→7203.T 再navigate ──
  await gotoDetail(page, "7203.T");
  results.jpReentry = await page.evaluate(inspect);

  // ── 3) ETF(1321.T) ──
  results.etfTicker = await page.evaluate(() => Object.keys(STOCK_DATA).find((k) => STOCK_DATA[k].type === "etf") || null);
  const etfTicker = (results.etfTicker === "1321.T") ? "1321.T" : results.etfTicker;
  if (etfTicker) {
    await gotoDetail(page, etfTicker);
    results.etf = await page.evaluate(inspect);
  }

  results.pageErrorCount = pageErrors.length;
  results.pageErrors = pageErrors.slice(0, 5);

  // ── アサーション ──
  const fails = [];

  function assertStock(r, label) {
    if (!r.dpPresent) fails.push(label + ": dupont-card 不在");
    if (!r.dpVisible) fails.push(label + ": dupont-card 非表示(display=" + r.dpDisplay + ")");
    if (r.dpCardCount !== 1) fails.push(label + ": dupont-card 重複 " + r.dpCardCount);
    if (r.dpFactorCount !== 4) fails.push(label + ": dp-factor 数不一致(期待4=3因数+ROE) " + r.dpFactorCount);
    if (!r.dpHasRoeCell) fails.push(label + ": dp-roe セル不在");
    if (r.dpOpCount !== 3) fails.push(label + ": dp-op(×××=) 数不一致 " + r.dpOpCount);
    if (r.dpTermHelps < 1) fails.push(label + ": dupont-card に ? term-help 未注入 " + r.dpTermHelps);
    if (!r.dpDiscLen) fails.push(label + ": dupont-card 免責文が空");

    if (!r.fcPresent) fails.push(label + ": fcf-trend-card 不在");
    if (!r.fcVisible) fails.push(label + ": fcf-trend-card 非表示(display=" + r.fcDisplay + ")");
    if (r.fcCardCount !== 1) fails.push(label + ": fcf-trend-card 重複 " + r.fcCardCount);
    if (!r.fcCanvasW || r.fcCanvasW <= 0) fails.push(label + ": fcfTrend canvas 0幅(0x0罠) " + r.fcCanvasW);
    if (!r.fcCanvasH || r.fcCanvasH <= 0) fails.push(label + ": fcfTrend canvas 0高さ(0x0罠) " + r.fcCanvasH);
    if (!r.fcChartAttached) fails.push(label + ": Chart.getChart('fcfTrend') 未取得");
    if (r.fcTermHelps < 1) fails.push(label + ": fcf-trend-card に ? term-help 未注入 " + r.fcTermHelps);
    if (!r.fcDiscLen) fails.push(label + ": fcf-trend-card 免責文が空");
  }

  assertStock(results.jp, "JP(7203.T)");
  if (results.jp.stackCards !== 10) fails.push("JP: dashboard-stack カード数が想定外(期待10) " + results.jp.stackCards);

  // 年切替後の冪等性（重複していないこと＝カード数/バッジ数が変化しない）
  assertStock(results.jpAfterYearSwitch, "JP(年切替後)");
  if (results.jpAfterYearSwitch.dpTermHelps !== results.jp.dpTermHelps)
    fails.push("年切替後 dupont ? バッジ数が変化(増殖疑い): " + results.jp.dpTermHelps + " -> " + results.jpAfterYearSwitch.dpTermHelps);
  if (results.jpAfterYearSwitch.fcTermHelps !== results.jp.fcTermHelps)
    fails.push("年切替後 fcf ? バッジ数が変化(増殖疑い): " + results.jp.fcTermHelps + " -> " + results.jpAfterYearSwitch.fcTermHelps);

  if (!results.usTicker) {
    fails.push("mock DB に財務データを持つ米国株が見つからない");
  } else {
    assertStock(results.us, "US(" + results.usTicker + ")");
    if (!results.us.fcAmtTitle || !results.us.fcAmtTitle.includes("ドル"))
      fails.push("US: FCFチャート amt軸ラベルに「ドル」を含まない: " + results.us.fcAmtTitle);
  }

  // 別銘柄(US)経由での再navigate後も非増殖
  assertStock(results.jpReentry, "JP(再navigate後)");
  if (results.jpReentry.dpCardCount !== 1 || results.jpReentry.fcCardCount !== 1)
    fails.push("再navigate後カード重複: dp=" + results.jpReentry.dpCardCount + " fc=" + results.jpReentry.fcCardCount);
  if (results.jpReentry.dpTermHelps !== results.jp.dpTermHelps)
    fails.push("再navigate後 dupont ? バッジ数変化(増殖疑い): " + results.jp.dpTermHelps + " -> " + results.jpReentry.dpTermHelps);
  if (results.jpReentry.fcTermHelps !== results.jp.fcTermHelps)
    fails.push("再navigate後 fcf ? バッジ数変化(増殖疑い): " + results.jp.fcTermHelps + " -> " + results.jpReentry.fcTermHelps);

  if (!results.etfTicker) {
    fails.push("mock DB に ETF が見つからない");
  } else {
    if (results.etf.dpDisplay !== "none") fails.push("ETF(" + etfTicker + "): dupont-card が display:none でない (" + results.etf.dpDisplay + ")");
    if (results.etf.fcDisplay !== "none") fails.push("ETF(" + etfTicker + "): fcf-trend-card が display:none でない (" + results.etf.fcDisplay + ")");
  }

  if (results.pageErrorCount !== 0) fails.push("pageerror " + results.pageErrorCount + "件: " + JSON.stringify(results.pageErrors));

  console.log(JSON.stringify(results, null, 2));
  if (fails.length) {
    console.error("FAIL:\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("PASS: all assertions green");
  }
  await browser.close();
})().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(1); });
