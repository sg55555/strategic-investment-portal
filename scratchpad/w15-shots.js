// scratchpad/w15-shots.js — W1.5 ヒートマップ3案の実物スクショ＋縦寸法の実測。
// 使い方:
//   .venv/bin/python scratchpad/w15-mock-server.py &
//   NODE_PATH=/home/shugo/node_modules node scratchpad/w15-shots.js ; kill %1
// 見るもの: 各案の PC/390px の見た目・document 縦px（旧モック案③は 390px で 4758px だった）・
//           展開（大分類クリック）後の縦px・pageerror の有無。
const { chromium } = require("playwright");
const fs = require("fs");

const PORT = process.env.W15_PORT || "8215";
const BASE = `http://127.0.0.1:${PORT}/`;
const OUT = "scratchpad/w15-shots";
const VIEWS = [{ name: "pc", width: 1440, height: 1000 }, { name: "mb", width: 390, height: 844 }];
const VARIANTS = ["off", "uni", "tree", "dual"];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const html = await fetch(BASE).then((r) => r.text()).catch(() => "");
  if (!/w15-variants\.js/.test(html) || !/__w15host/.test(html)) {
    console.log(`❌ ${BASE} が W1.5 フック注入済みの index を配信していません`);
    process.exit(2);
  }
  const browser = await chromium.launch();
  const errors = [];
  const rows = [];

  for (const v of VIEWS) {
    const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`[${v.name}] ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`[${v.name}][console] ${m.text()}`); });

    for (const variant of VARIANTS) {
      await page.goto(BASE, { waitUntil: "domcontentloaded" });
      await page.evaluate((k) => {
        localStorage.setItem("w15_variant", k);
        localStorage.setItem("w15_metric", "c1");
        localStorage.setItem("w15_weight", "eq");
      }, variant);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => {
        const c = document.getElementById("portal-container");
        return c && c.querySelectorAll("tbody tr").length > 0;
      }, { timeout: 25000 });
      await page.waitForTimeout(500);

      const m = await page.evaluate(() => ({
        docH: document.documentElement.scrollHeight,
        tiles: document.querySelectorAll("#w15-host .w15-tile").length,
        stocks: document.querySelectorAll("#w15-host .w15-stock").length,
        hostH: (document.getElementById("w15-host") || {}).offsetHeight || 0,
        overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      }));
      await page.screenshot({ path: `${OUT}/${variant}-${v.name}.png`, fullPage: false });
      rows.push({ view: v.name, variant, state: "closed", ...m });

      if (variant !== "off") {
        // 展開（先頭の大分類タイル）。mistakes: page.click() は要素を画面内へスクロールするので evaluate 経由で押す。
        const clicked = await page.evaluate(() => {
          const el = document.querySelector("#w15-host .w15-tile");
          if (!el) return false;
          el.click();
          return true;
        });
        if (clicked) {
          await page.waitForTimeout(400);
          const m2 = await page.evaluate(() => ({
            docH: document.documentElement.scrollHeight,
            tiles: document.querySelectorAll("#w15-host .w15-tile").length,
            stocks: document.querySelectorAll("#w15-host .w15-stock").length,
            hostH: (document.getElementById("w15-host") || {}).offsetHeight || 0,
            overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          }));
          await page.screenshot({ path: `${OUT}/${variant}-${v.name}-open.png`, fullPage: false });
          rows.push({ view: v.name, variant, state: "open", ...m2 });
        }
      }
    }
    await ctx.close();
  }
  await browser.close();

  console.log("view variant  state   docH   hostH  tiles stocks  overflowX");
  for (const r of rows) {
    console.log(
      `${r.view.padEnd(4)} ${r.variant.padEnd(8)} ${r.state.padEnd(6)} ${String(r.docH).padStart(6)} ` +
      `${String(r.hostH).padStart(6)} ${String(r.tiles).padStart(5)} ${String(r.stocks).padStart(6)}  ${r.overflowX ? "❌ある" : "なし"}`);
  }
  console.log(errors.length ? `\n❌ エラー ${errors.length}件:\n` + errors.join("\n") : "\n✅ pageerror / console.error なし");
  process.exit(errors.length ? 1 : 0);
})();
