/* W2 実物比較モックの動作スモーク＋スクリーンショット採取。
 *
 *   1) 別ターミナルで  .venv/bin/python scratchpad/w2-mock-server.py
 *   2) NODE_PATH=/home/shugo/node_modules node scratchpad/w2-mock-smoke.js
 *
 * 目的＝本人に見せる前に「3案とも実際に動く」ことを機械で確認する（レイアウトの好みは人が決める）。
 * 見るもの: 部品が刺さったか／期間切替で本当に窓が変わったか（バー数）／52週が実データで埋まったか／
 *           ベンチ ON でエラーが出ないか／pageerror ゼロ。スクショは PC(1440) と 390px。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.W2_BASE || "http://127.0.0.1:8220";
const TICKER = process.env.W2_TICKER || "7203.T";
const OUT = path.join(__dirname, "w2-shots");
const VARIANTS = ["a", "b", "c"];

const fail = [];
function check(cond, label) {
  console.log((cond ? "  ✅ " : "  ❌ ") + label);
  if (!cond) fail.push(label);
}

async function openDetail(page, width) {
  await page.setViewportSize({ width, height: 900 });
  // STOCK_DATA は index.html/dataClient.js の top-level `let`＝window プロパティにならない（bare 参照が正）
  await page.waitForFunction(() => typeof STOCK_DATA !== "undefined" && Object.keys(STOCK_DATA).length > 0, { timeout: 30000 });
  await page.evaluate((t) => window.navigateToDetail(t), TICKER);
  await page.waitForSelector("#chart-container canvas", { timeout: 30000 });
  await page.waitForTimeout(1200);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();

  for (const v of VARIANTS) {
    console.log(`\n=== variant ${v} ===`);
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      // モック鯖は Vercel Analytics を配信しない（本番だけの資産）。この 404 はアプリの故障ではない。
      if (/_vercel\/insights/.test(m.text()) || /Failed to load resource/.test(m.text())) return;
      errors.push("console: " + m.text());
    });

    await page.goto(`${BASE}/?v=${v}`, { waitUntil: "domcontentloaded" });
    await openDetail(page, 1440);

    const mounted = await page.evaluate(() => ({
      periods: [...document.querySelectorAll(".w2-p")].map((b) => b.dataset.p),
      has52: !!document.querySelector(".w2-52w"),
      bench: !!document.querySelector(".w2-bench"),
      lo: (document.querySelector("[data-w2='lo']") || {}).textContent,
      hi: (document.querySelector("[data-w2='hi']") || {}).textContent,
      pos: (document.querySelector("[data-w2='pos']") || {}).textContent,
      dist: (document.querySelector("[data-w2='dist']") || {}).textContent,
      benchLabel: (document.querySelector("[data-w2='benchLabel']") || {}).textContent,
    }));
    check(mounted.periods.join(",") === "FY,1M,3M,6M,YTD,1Y,5Y,MAX", `期間8個そろっている (${mounted.periods.join("/")})`);
    check(mounted.has52 && mounted.bench, "52週バーとベンチチップが刺さっている");
    check(/[0-9]/.test(mounted.lo || "") && /[0-9]/.test(mounted.hi || ""), `52週が実データで埋まる lo=${mounted.lo} hi=${mounted.hi} pos=${mounted.pos} ${mounted.dist}`);
    check((mounted.benchLabel || "").includes("TOPIX"), `JP 銘柄のベンチが TOPIX (${mounted.benchLabel})`);

    // 期間切替＝本当に窓が変わるか（バー数で見る）
    const bars = {};
    for (const p of ["FY", "1M", "1Y", "5Y", "MAX"]) {
      await page.evaluate((k) => window.__W2.setPeriod(k), p);
      await page.waitForTimeout(700);
      bars[p] = await page.evaluate(() => {
        const r = window.DetailCharts.getPriceVisibleRange();
        return { period: window.__W2.period, range: r ? Math.round(r.to - r.from) : null };
      });
    }
    console.log("   窓のバー数(可視レンジ):", JSON.stringify(bars));
    check(bars["1M"].range < bars["1Y"].range, "1M の窓 < 1Y の窓");
    check(bars["1Y"].range < bars["5Y"].range, "1Y の窓 < 5Y の窓");
    check(bars["5Y"].range < bars["MAX"].range, "5Y の窓 < MAX の窓（合成データなら区別できず落ちる）");

    // ベンチ ON
    await page.evaluate(() => window.__W2.setPeriod("1Y"));
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__W2.toggleBench());
    await page.waitForTimeout(3000);
    const bench = await page.evaluate(() => ({ pts: window.__W2.benchPoints, captured: window.__W2.chartCaptured }));
    check(bench.captured, "価格チャート実体を捕獲できている");
    check(bench.pts > 200, `ベンチ線が実データで描かれた (${bench.pts}点／1Y窓)`);
    // スクショは MARKET CHART カードだけを切り出す（ページ全体だと肝心のカードが折り返しの下に隠れる）
    await page.evaluate(() => document.getElementById("chart-container").closest(".card").scrollIntoView({ block: "start" }));
    await page.waitForTimeout(600);
    const cardEl = await page.$("#chart-container");
    const card = await cardEl.evaluateHandle((el) => el.closest(".card"));
    await card.asElement().screenshot({ path: path.join(OUT, `${v}-pc.png`) });

    // 390px
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(900);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(overflow <= 1, `390px で横はみ出しなし (${overflow}px)`);
    await page.evaluate(() => document.getElementById("chart-container").closest(".card").scrollIntoView({ block: "start" }));
    await page.waitForTimeout(600);
    const card390 = await (await page.$("#chart-container")).evaluateHandle((el) => el.closest(".card"));
    await card390.asElement().screenshot({ path: path.join(OUT, `${v}-390.png`) });

    const heights = await page.evaluate(() => {
      const card = document.getElementById("chart-container").closest(".card");
      return { page: document.documentElement.scrollHeight, card: Math.round(card.getBoundingClientRect().height) };
    });
    console.log(`   390px: page=${heights.page}px card=${heights.card}px`);

    check(errors.length === 0, `pageerror ゼロ (${errors.length})`);
    if (errors.length) console.log("   " + errors.slice(0, 5).join("\n   "));
    await ctx.close();
  }

  await browser.close();
  console.log(fail.length ? `\n❌ FAIL ${fail.length}件\n - ` + fail.join("\n - ") : "\n✅ ALL PASS");
  process.exit(fail.length ? 1 : 0);
})();
