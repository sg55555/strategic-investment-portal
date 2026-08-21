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
  // ⑥グロー廃止: theme-a L49-81 の text-shadow:none 対象を実 DOM で確認
  const glowSels = [...css.matchAll(/^([^\/@{}]+?)\{\s*text-shadow:\s*none;/gm)]
    .flatMap((g) => g[1].split(",").map((s) => s.trim())).filter(Boolean)
    .filter((s) => !/\.mcc-hero-power small/.test(s));   // 遮断ルールは別検証
  for (const sel of glowSels) {
    const ts = await page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).textShadow : null; }, sel).catch(() => null);
    if (ts !== null && ts !== "none") fails.push(`${sel}: text-shadow=${ts}`);
  }
  // 維持組の過剰廃止検出（.mcc-hero-power は shadow を保持していること）
  const heroTs = await page.evaluate(() => { const el = document.querySelector(".mcc-hero-power"); return el ? getComputedStyle(el).textShadow : null; });
  if (heroTs === "none") fails.push(".mcc-hero-power: 維持すべき shadow が消えている（過剰廃止）");
  // ⑦sans 化: theme-a L85-106 のセレクタ群が system-ui を含むこと
  // 注: 「⑦ 日本語長文」は冒頭サマリ(L12)/トークン注記(L20)にも出現し曖昧なため、
  // セクション見出し本体に一意な「日本語長文:」（コロン付き, L83）へ絞って誤爆(fold-nm等の巻き込み)を回避。
  const sansM = css.match(/日本語長文:[\s\S]*?\*\/([\s\S]*?)\{\s*font-family:\s*var\(--ix-sans\)/);
  const sansSels = sansM[1].split(",").map((s) => s.replace(/\/\*[\s\S]*?\*\//g, "").trim()).filter(Boolean);
  for (const sel of sansSels) {
    // ::after 等の疑似要素は querySelector に渡すと例外→無言スキップになるため、
    // base部分をquerySelectorし getComputedStyle(el, "::after") で判定する。
    const isAfter = /::after$/.test(sel);
    const baseSel = isAfter ? sel.replace(/::after$/, "") : sel;
    const ff = await page.evaluate((args) => {
      const el = document.querySelector(args.baseSel);
      if (!el) return null;
      return getComputedStyle(el, args.isAfter ? "::after" : null).fontFamily;
    }, { baseSel, isAfter }).catch(() => null);
    if (ff !== null && !/system-ui/.test(ff)) fails.push(`${sel}: fontFamily=${ff.slice(0, 40)}`);
  }
  await browser.close();
  console.log(fails.length === 0 ? "ALL PASS" : `${fails.length} FAILED`);
  process.exit(fails.length === 0 ? 0 : 1);
})();
