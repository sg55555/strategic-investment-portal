// テーマA①⑧ 床チェック: theme-a-tuning.css L111-157 のセレクタ全量について computed font-size>=12px を検証。
// 実行: NODE_PATH=/home/shugo/node_modules node scratchpad/theme-floor-check.js [width]（既定 1440・375 も回す）
const { chromium } = require("playwright");
const fs = require("fs");
const width = Number(process.argv[2] || 1440);
const css = fs.readFileSync("docs/superpowers/specs/assets/theme-a-tuning.css", "utf8");
// ①⑧ブロック（L108-159）のセレクタ列挙を抽出（`{ font-size: 12px; }` の直前までのカンマ区切り）
const m = css.match(/一括で12px化[\s\S]*?\*\/([\s\S]*?)\{\s*font-size:\s*12px;/);
const selectors = m[1].split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim()).filter((s) => s && !s.startsWith("/*"));
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(700);
  await page.evaluate(() => showView("money"));
  await page.waitForTimeout(400);
  let fails = [], found = 0;
  for (const sel of selectors) {
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      return parseFloat(getComputedStyle(el).fontSize);
    }, sel).catch(() => null);
    if (r === null) continue;             // 未マウントの動的要素はスキップ（ログのみ）
    found++;
    if (r < 12) fails.push(`${sel}: ${r}px`);
  }
  // ?円 17px
  const circle = await page.evaluate(() => {
    const el = document.querySelector(".term-help") || document.querySelector(".mcc-help");
    return el ? getComputedStyle(el).width : null;
  });
  console.log(`width=${width} checked=${found}/${selectors.length} circle=${circle}`);
  fails.forEach((f) => console.log("  ❌ " + f));
  if (circle && parseFloat(circle) < 17) { fails.push("?円<17px"); console.log("  ❌ ?円 " + circle); }
  await browser.close();
  console.log(fails.length === 0 ? "ALL PASS" : `${fails.length} FAILED`);
  process.exit(fails.length === 0 ? 0 : 1);
})();
