// scratchpad/task11-fcf-verify.js — Task11 FCF&収益の質コンボカード Playwright 検証。
// 1) 7203.T(equity): #fcf-trend-card 可視 / canvas 描画(Chart.js instance) / 注記に「概算FCF」/ 免責 / pageerror0
// 2) ETF: 本タスク時点では未配線(Task12でfinCards登録)＝可視でも可・display 状態のみ記録
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8200";

// Task11 時点では updateFinancialViews に未配線（Task12で配線）。
// renderFCFTrend(data, isUS) 自体の正しさを検証するため、navigate 後に直接呼び出す。
async function gotoDetail(page, ticker) {
  await page.evaluate((t) => { navigateToDetail(t); }, ticker);
  await page.waitForTimeout(600);
  await page.evaluate((t) => {
    const data = STOCK_DATA[t];
    const isUS = data && data.country === "US";
    DetailCharts.renderFCFTrend(data, isUS);
  }, ticker);
  await page.waitForTimeout(200);
}

function inspect() {
  const card = document.getElementById("fcf-trend-card");
  const cv = document.getElementById("fcfTrend");
  const cs = card ? getComputedStyle(card) : null;
  const note = document.getElementById("fcf-trend-note");
  const disc = document.getElementById("fcf-trend-disclaimer");
  return {
    present: !!card,
    display: cs ? cs.display : null,
    visible: cs ? cs.display !== "none" : false,
    cardCount: document.querySelectorAll("#fcf-trend-card").length,
    canvasPresent: !!cv,
    canvasWidth: cv ? cv.clientWidth : 0,
    canvasHeight: cv ? cv.clientHeight : 0,
    chartAttached: !!(cv && cv.getContext && cv.getContext("2d")),
    noteText: note ? note.textContent : null,
    noteHasFcfDef: note ? note.textContent.includes("概算FCF") : false,
    discText: disc ? disc.textContent.trim() : null,
    discLen: disc ? disc.textContent.trim().length : 0,
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

  await gotoDetail(page, "7203.T");
  results.stock = await page.evaluate(inspect);

  // 冪等再確認（別銘柄→7203.T 再navigateでカード増殖・Chart.jsインスタンス衝突なきこと）
  const other = await page.evaluate(() => Object.keys(STOCK_DATA).find((k) => k !== "7203.T" && STOCK_DATA[k].type !== "etf") || null);
  if (other) await gotoDetail(page, other);
  await gotoDetail(page, "7203.T");
  results.stockReentry = await page.evaluate(inspect);

  const etf = await page.evaluate(() => Object.keys(STOCK_DATA).find((k) => STOCK_DATA[k].type === "etf") || null);
  results.etfTicker = etf;
  if (etf) { await gotoDetail(page, etf); results.etf = await page.evaluate(inspect); }

  results.pageErrorCount = pageErrors.length;
  results.pageErrors = pageErrors.slice(0, 5);

  // ── アサーション ──
  const fails = [];
  const s = results.stock;
  if (!s.present) fails.push("fcf-trend-card 不在");
  if (!s.visible) fails.push("fcf-trend-card 非表示(display=" + s.display + ")");
  if (s.cardCount !== 1) fails.push("fcf-trend-card 重複: " + s.cardCount);
  if (!s.canvasPresent) fails.push("canvas#fcfTrend 不在");
  if (!s.canvasWidth || s.canvasWidth <= 0) fails.push("canvas 0幅(0x0罠): width=" + s.canvasWidth);
  if (!s.canvasHeight || s.canvasHeight <= 0) fails.push("canvas 0高さ(0x0罠): height=" + s.canvasHeight);
  if (!s.noteHasFcfDef) fails.push("注記に「概算FCF」なし: " + s.noteText);
  if (!s.discLen) fails.push("免責文が空");
  if (results.pageErrorCount !== 0) fails.push("pageerror " + results.pageErrorCount + "件: " + JSON.stringify(results.pageErrors));

  const r2 = results.stockReentry;
  if (r2.cardCount !== 1) fails.push("再navigate後カード重複: " + r2.cardCount);
  if (!r2.canvasWidth || r2.canvasWidth <= 0) fails.push("再navigate後 canvas 0幅(destroy/再生成の不整合): " + r2.canvasWidth);

  console.log(JSON.stringify(results, null, 2));
  if (fails.length) {
    console.error("FAIL:\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("PASS: all assertions green");
  }
  await browser.close();
})().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(1); });
