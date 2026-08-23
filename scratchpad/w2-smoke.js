/* W2「詳細の時間軸パック」受入。
 *
 *   1) W2_INJECT=0 python3 scratchpad/w2-mock-server.py     # :8220（比較ハーネスを注入しない）
 *   2) NODE_PATH=/home/shugo/node_modules node scratchpad/w2-smoke.js
 *
 * ⚠ 合成データのモック鯖（mock_prod_server.py・600本）ではなく **本番 API のプロキシ**を使う。
 *   合成 600 本では 5Y と MAX が同じ窓になり「切り替わっていないのに緑」になるため。
 */
const { chromium } = require("playwright");

const BASE = process.env.W2_BASE || "http://127.0.0.1:8220";
const fail = [];
function check(cond, label) {
  console.log((cond ? "  ✅ " : "  ❌ ") + label);
  if (!cond) fail.push(label);
}

async function open(page, ticker, width = 1440) {
  await page.setViewportSize({ width, height: 900 });
  await page.waitForFunction(() => typeof STOCK_DATA !== "undefined" && Object.keys(STOCK_DATA).length > 0, { timeout: 30000 });
  await page.evaluate((t) => window.navigateToDetail(t), ticker);
  await page.waitForSelector("#chart-container canvas", { timeout: 30000 });
  await page.waitForTimeout(1200);
}
const clickPeriod = (page, k) =>
  page.evaluate((x) => document.querySelector(`#w2-period-box .w2-p[data-p="${x}"]`).click(), k);
const range = (page) =>
  page.evaluate(() => { const r = window.DetailCharts.getPriceVisibleRange(); return r ? Math.round(r.to - r.from) : null; });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (/_vercel\/insights|Failed to load resource/.test(m.text())) return;   // モック鯖は Analytics を配信しない
    errors.push("console: " + m.text());
  });

  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // ブリーフ原文はここで即 reload していたが、直前の goto が投げた window.onload の
  // bootData() fetch がまだ in-flight のまま reload すると中断され、旧ドキュメントの
  // console.error("bootData failed", TypeError: Failed to fetch) がこの page に残る。
  // 実装のバグではなく本スクリプトの競合（毎回同じ箇所で決定的に再現・診断で特定済み）。
  // open() と同じ待ち方（STOCK_DATA 充足待ち）を先に挟んで fetch を完了させてから reload する。
  await page.waitForFunction(() => typeof STOCK_DATA !== "undefined" && Object.keys(STOCK_DATA).length > 0, { timeout: 30000 });
  await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T");

  console.log("=== 期間バー ===");
  const keys = await page.evaluate(() => [...document.querySelectorAll("#w2-period-box .w2-p")].map((b) => b.dataset.p));
  check(keys.join(",") === "FY,1M,3M,6M,YTD,1Y,5Y,MAX", `8個がこの順で並ぶ (${keys.join("/")})`);
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="FY"]').classList.contains("active")),
    "既定は FY（初回・LS 空）");
  // 比較ハーネス（w2-variants.js）が入っていないこと。入っていると期間バーが二重に mount され、
  //  実装ではなくモックを検査してしまう。ハーネスは window.__W2 を必ず生やすのでそれで判定する。
  check(await page.evaluate(() => typeof window.__W2 === "undefined"), "比較ハーネスが注入されていない（W2_INJECT=0）");

  const bars = {};
  for (const k of ["1M", "1Y", "5Y", "MAX"]) { await clickPeriod(page, k); await page.waitForTimeout(800); bars[k] = await range(page); }
  console.log("   可視バー数:", JSON.stringify(bars));
  check(bars["1M"] < bars["1Y"] && bars["1Y"] < bars["5Y"] && bars["5Y"] < bars["MAX"], "1M < 1Y < 5Y < MAX");

  console.log("=== FY 復帰（last-click-wins）===");
  await clickPeriod(page, "1Y"); await page.waitForTimeout(500);
  await page.evaluate(() => document.querySelectorAll("#year-controller-box .time-btn")[0].click());
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="FY"]').classList.contains("active")),
    "FY ボタンを押すと期間バーが FY に戻る");

  console.log("=== 永続 ===");
  await clickPeriod(page, "6M"); await page.waitForTimeout(600);
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "6758.T");
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="6M"]').classList.contains("active")),
    "リロード＋別銘柄でも 6M が復元される");
  await page.evaluate(() => { try { localStorage.setItem("sip_detail_period", "9Z"); } catch (e) {} });
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "6758.T");
  check(await page.evaluate(() => document.querySelector('#w2-period-box .w2-p[data-p="FY"]').classList.contains("active")),
    "未知値を書き込んでも FY へ正規化される");

  console.log("=== 52週レンジ ===");
  await open(page, "7203.T");
  const w52 = await page.evaluate(() => ({
    lo: document.querySelector('[data-w2="lo"]').textContent,
    hi: document.querySelector('[data-w2="hi"]').textContent,
    pos: document.querySelector('[data-w2="pos"]').textContent,
    dist: document.querySelector('[data-w2="dist"]').textContent,
  }));
  check(/^¥[\d,]+$/.test(w52.lo) && /^¥[\d,]+$/.test(w52.hi), `実データで埋まる (${w52.lo} 〜 ${w52.hi} ${w52.pos} ${w52.dist})`);
  const before = JSON.stringify(w52);
  await clickPeriod(page, "1M"); await page.waitForTimeout(700);
  const after = await page.evaluate(() => JSON.stringify({
    lo: document.querySelector('[data-w2="lo"]').textContent, hi: document.querySelector('[data-w2="hi"]').textContent,
    pos: document.querySelector('[data-w2="pos"]').textContent, dist: document.querySelector('[data-w2="dist"]').textContent,
  }));
  check(before === after, "期間を変えても 52週レンジは変わらない（独立）");
  await page.evaluate(() => { STOCK_DATA["7203.T"].px = { last: 1, date: "2026-08-20" }; });
  await open(page, "7203.T");
  check(await page.evaluate(() => getComputedStyle(document.getElementById("w2-52w")).display) === "none",
    "pos52 欠損ならバーごと非表示");

  console.log("=== ベンチマーク ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T");
  await clickPeriod(page, "1Y"); await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());
  await page.waitForTimeout(3000);
  check(await page.evaluate(() => document.getElementById("w2-bench-btn").classList.contains("active")), "ベンチ ON");
  const axis = await page.evaluate(() => {
    const w = DetailRules.rollingWindow(STOCK_DATA[currentTicker].prices, "1Y").displayPrices;
    return { lo: Math.min(...w.map((p) => p.low)) };
  });
  console.log(`   窓内最安値 ${axis.lo}（軸がこの 0.5 倍を下回らないこと）`);
  await page.evaluate(() => { document.getElementById("w2-bench-btn").click(); document.getElementById("w2-bench-btn").click(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());
  await page.waitForTimeout(3000);
  check(!(await page.evaluate(() => document.getElementById("w2-bench-btn").classList.contains("active"))),
    "ON→即OFF を繰り返しても最後の OFF が残る（線が復活しない）");
  await page.evaluate(() => document.getElementById("w2-bench-btn").click());
  await page.waitForTimeout(2500);
  await clickPeriod(page, "MAX"); await page.waitForTimeout(3000);
  check(/（\d{4}年〜）/.test(await page.evaluate(() => document.querySelector('[data-w2="benchLabel"]').textContent)),
    "MAX ではベンチ履歴の開始年がラベルに出る");
  await open(page, "1306.T");
  check(await page.evaluate(() => getComputedStyle(document.getElementById("w2-bench-btn")).display) === "none",
    "ベンチ自身を開くとチップごと非表示");

  console.log("=== 劣化経路 ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T");
  const titleBefore = await page.evaluate(() => document.getElementById("stock-title").textContent);
  await page.evaluate(() => { STOCK_DATA["6758.T"].prices = []; });
  await open(page, "6758.T");
  const titleAfter = await page.evaluate(() => document.getElementById("stock-title").textContent);
  check(titleAfter !== titleBefore && titleAfter.includes("6758.T"),
    `価格ゼロの銘柄でも前銘柄の残像を残さない (${titleAfter.slice(0, 40)})`);

  console.log("=== レスポンシブ ===");
  await page.reload({ waitUntil: "domcontentloaded" });
  await open(page, "7203.T", 390);
  const resp = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    minFont: Math.min(...[...document.querySelectorAll(".w2-rail *")].map((e) => parseFloat(getComputedStyle(e).fontSize)).filter(Boolean)),
  }));
  check(resp.overflow <= 1, `390px で横はみ出しなし (${resp.overflow}px)`);
  check(resp.minFont >= 12, `390px でも文字床 12px を守る (${resp.minFont}px)`);

  check(errors.length === 0, `pageerror ゼロ (${errors.length})`);
  if (errors.length) console.log("   " + errors.slice(0, 5).join("\n   "));

  await browser.close();
  console.log(fail.length ? `\n❌ FAIL ${fail.length}件\n - ` + fail.join("\n - ") : "\n✅ ALL PASS");
  process.exit(fail.length ? 1 : 0);
})();
