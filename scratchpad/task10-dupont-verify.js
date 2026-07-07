// scratchpad/task10-dupont-verify.js — Task10 DuPont恒等式カード Playwright 検証。
// 1) 7203.T(equity): #dupont-card 可視 / 3因数+ROE(dp-factor×4) / .dp-spark polyline / driver「純資産ベース」/ 免責 / pageerror0
// 2) ETF: 本タスク時点では未配線(Task12でfinCards登録)＝可視でも可・display 状態のみ記録
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8200";

// Task10 時点では updateFinancialViews に未配線（Task12で配線）。
// renderDuPont(fin, data) 自体の正しさを検証するため、navigate 後に直接呼び出す。
async function gotoDetail(page, ticker) {
  await page.evaluate((t) => { navigateToDetail(t); }, ticker);
  await page.waitForTimeout(600);
  await page.evaluate((t) => {
    const data = STOCK_DATA[t];
    const years = Object.keys(data.financials_trend || {});
    const fin = years.length ? data.financials_trend[years[years.length - 1]] : null;
    DetailCharts.renderDuPont(fin, data);
  }, ticker);
  await page.waitForTimeout(200);
}

function inspect() {
  const card = document.getElementById("dupont-card");
  const body = document.getElementById("dupont-body");
  const cs = card ? getComputedStyle(card) : null;
  const factors = body ? body.querySelectorAll(".dp-factor").length : 0;
  const roeCell = body ? body.querySelector(".dp-roe") : null;
  const sparks = body ? body.querySelectorAll(".dp-spark").length : 0;
  const polylines = body ? body.querySelectorAll(".dp-spark polyline").length : 0;
  const driver = body ? body.querySelector(".dp-driver") : null;
  const disc = body ? body.querySelector(".panel-disclaimer") : null;
  const ops = body ? body.querySelectorAll(".dp-op").length : 0;
  return {
    present: !!card,
    display: cs ? cs.display : null,
    visible: cs ? cs.display !== "none" : false,
    cardCount: document.querySelectorAll("#dupont-card").length,
    factorCount: factors,
    hasRoeCell: !!roeCell,
    opCount: ops,
    sparkCount: sparks,
    polylineCount: polylines,
    driverText: driver ? driver.textContent : null,
    driverHasNetAssetsBase: driver ? driver.textContent.includes("純資産ベース") : false,
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

  // 冪等再確認（別銘柄→7203.T 再navigateでカード増殖しないこと）
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
  if (!s.present) fails.push("dupont-card 不在");
  if (!s.visible) fails.push("dupont-card 非表示(display=" + s.display + ")");
  if (s.cardCount !== 1) fails.push("dupont-card 重複: " + s.cardCount);
  if (s.factorCount !== 4) fails.push("dp-factor 数不一致(期待4=3因数+ROE): " + s.factorCount); // 3因数+ROEセル
  if (!s.hasRoeCell) fails.push("dp-roe セル不在");
  if (s.opCount !== 3) fails.push("dp-op(×××=) 数不一致: " + s.opCount);
  if (s.sparkCount !== 4) fails.push("dp-spark 数不一致(期待4): " + s.sparkCount);
  if (s.polylineCount < 1) fails.push("polyline 描画0（有効点2点以上の系列が皆無）");
  if (!s.driverHasNetAssetsBase) fails.push("driver文言に「純資産ベース」なし: " + s.driverText);
  if (!s.discLen) fails.push("免責文が空");
  if (results.pageErrorCount !== 0) fails.push("pageerror " + results.pageErrorCount + "件: " + JSON.stringify(results.pageErrors));

  const r2 = results.stockReentry;
  if (r2.cardCount !== 1) fails.push("再navigate後カード重複: " + r2.cardCount);

  console.log(JSON.stringify(results, null, 2));
  if (fails.length) {
    console.error("FAIL:\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("PASS: all assertions green");
  }
  await browser.close();
})().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(1); });
