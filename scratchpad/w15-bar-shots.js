/* ヒートマップのバー改善案を、実データのタイル上で撮り比べる。
 *
 *   W2_INJECT=0 python3 scratchpad/w2-mock-server.py        # :8220（本番APIプロキシ）
 *   NODE_PATH=/home/shugo/node_modules node scratchpad/w15-bar-shots.js
 *
 * 濃い緑（ヘルスケア/一般消費財/公益/不動産）と濃い赤（US 公益）が同じ画面に出るので、
 * ヒートマップ全体を1枚ずつ撮れば緑・赤の両方の潰れ方を同時に比較できる。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const VARIANTS = require("./w15-bar-variants.js");

const BASE = process.env.W2_BASE || "http://127.0.0.1:8220";
const OUT = path.join(__dirname, "w2-shots", "heatbar");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await page.goto(`${BASE}/?w2mock=off`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof STOCK_DATA !== "undefined" && Object.keys(STOCK_DATA).length > 0, { timeout: 30000 });
  await page.waitForSelector(".w15-tile", { timeout: 30000 });
  await page.waitForTimeout(1500);

  // 差し替え用の style を1枚だけ置き、案ごとに中身を入れ替える（DOM は毎回同じものを撮る）
  await page.addStyleTag({ content: "", id: "w15-bar-variant" }).catch(() => {});
  for (const key of Object.keys(VARIANTS)) {
    await page.evaluate((css) => {
      let st = document.getElementById("w15-bar-variant-style");
      if (!st) {
        st = document.createElement("style");
        st.id = "w15-bar-variant-style";
        document.head.appendChild(st);
      }
      st.textContent = css;
    }, VARIANTS[key].css);
    await page.waitForTimeout(300);
    const panel = await page.$(".w15-panel");
    if (!panel) throw new Error(".w15-panel が見つからない（ヒートマップ未描画）");
    await panel.screenshot({ path: path.join(OUT, `v${key}.png`) });
    console.log(`案${key} ${VARIANTS[key].name} → v${key}.png`);
  }

  await browser.close();
  console.log(`\n撮影完了 → ${OUT}`);
})();
