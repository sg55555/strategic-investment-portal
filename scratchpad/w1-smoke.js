// scratchpad/w1-smoke.js — W1 モック3案の構造スモーク＋スクショ撮り。
// 使い方:
//   .venv/bin/python scratchpad/w1-mock-server.py &
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w1-smoke.js ; kill %1
// GPUのグロー/ガラス等の見た目は対象外（実機の仕事）。ここは DOM/例外/件数だけ見る。
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8210/";
const OUT = "scratchpad/w1-shots";
const VIEWS = [
  { name: "pc", width: 1440, height: 1000 },
  { name: "mb", width: 390, height: 844 },
];
const VARIANTS = ["off", "strip", "table", "heat"];

(async () => {
  const fs = require("fs");
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  let fail = 0;
  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errs.push("console: " + m.text()); });
      page.on("response", (r) => { if (r.status() >= 400) errs.push("HTTP " + r.status() + " " + r.url()); });
    for (const variant of VARIANTS) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate((x) => {
        localStorage.setItem("w1_variant", x);
        localStorage.setItem("w1_tmode", "px");
      }, variant);
      await page.goto(BASE, { waitUntil: "networkidle" });
      await page.waitForSelector("#portal-container table tbody tr", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(700);
      const stat = await page.evaluate(() => ({
        rows: document.querySelectorAll("#portal-container tbody tr").length,
        tables: document.querySelectorAll("#portal-container table").length,
        pxTables: document.querySelectorAll("#portal-container table.w1-px").length,
        cards: document.querySelectorAll("#w1-host .w1-card").length,
        tiles: document.querySelectorAll("#w1-host .w1-tile").length,
        sparks: document.querySelectorAll("#w1-host .w1-spark, #portal-container .w1-spark").length,
        hostH: (document.getElementById("w1-host") || {}).offsetHeight || 0,
        switchOn: !!document.querySelector("#w1-switch button.on"),
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        pxData: (typeof STOCK_DATA !== "undefined") && !!(Object.values(STOCK_DATA)[0] || {}).px,
        noPxCells: document.body.innerText.split("価格データなし").length - 1,
      }));
      const shot = `${OUT}/${variant}-${v.name}.png`;
      await page.screenshot({ path: shot, fullPage: false });
      const bad = [];
      if (!stat.pxData) bad.push("px データ未注入");
      if (variant === "strip" && stat.cards < 10) bad.push("カード数 " + stat.cards);
      if (variant === "heat" && stat.tiles < 100) bad.push("タイル数 " + stat.tiles);
      if (variant === "table" && stat.pxTables !== 1) bad.push("値動き表が " + stat.pxTables + " 枚（1枚のはず）");
      if (variant === "off" && (stat.cards || stat.tiles || stat.pxTables)) bad.push("現行なのに追加UIが出ている");
      if (stat.overflowX) bad.push("横スクロール発生");
      if (stat.noPxCells) bad.push("価格データなし行 " + stat.noPxCells);
      if (bad.length) fail++;
      console.log(`${v.name}/${variant}: rows=${stat.rows} tables=${stat.tables} pxTables=${stat.pxTables} ` +
        `cards=${stat.cards} tiles=${stat.tiles} sparks=${stat.sparks} hostH=${stat.hostH} ` +
        (bad.length ? "❌ " + bad.join(" / ") : "✅"));
    }
    if (errs.length) { console.log(`  [${v.name}] JSエラー ${errs.length}件:`); errs.slice(0, 8).forEach((e) => console.log("   - " + e)); }
    await ctx.close();
  }
  await browser.close();
  console.log(fail ? `\n❌ ${fail} 件の要確認` : "\n✅ 全ケース構造OK");
  process.exit(fail ? 1 : 0);
})();
