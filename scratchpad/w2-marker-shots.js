/* 52週マーカー比較ハーネスの一覧スクショを撮る（本人が見比べる前の素材づくり）。
 *
 *   W2_INJECT_FILE=w2-marker-variants.js python3 scratchpad/w2-mock-server.py   # :8220
 *   NODE_PATH=/home/shugo/node_modules node scratchpad/w2-marker-shots.js
 *
 * 案 × レンジ内位置 の組でレール部分だけを切り出して撮る。実機で問題になったのは
 * 上端側（92%/100%）なので、そこを必ず含める。
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.W2_BASE || "http://127.0.0.1:8220";
const OUT = path.join(__dirname, "w2-shots", "marker");
const VARIANTS = ["0", "1", "2", "3", "4", "5"];
const NAMES = { 0: "現状", 1: "白コア＋暗縁", 2: "トラック中立化", 3: "暗い溝＋発光", 4: "アンバー", 5: "白コア＋中立" };
const POSITIONS = [36, 92, 100];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof STOCK_DATA !== "undefined" && Object.keys(STOCK_DATA).length > 0, { timeout: 30000 });
  await page.evaluate(() => window.navigateToDetail("7203.T"));
  await page.waitForSelector("#chart-container canvas", { timeout: 30000 });
  await page.waitForTimeout(1200);

  for (const pos of POSITIONS) {
    for (const v of VARIANTS) {
      await page.evaluate(([vv, pp]) => { window.__MK.variant = vv; window.__MK.pos = pp; }, [v, pos]);
      await page.waitForTimeout(400);
      const rail = await page.$(".w2-52w");
      await rail.screenshot({ path: path.join(OUT, `pos${pos}-v${v}.png`) });
    }
    console.log(`pos=${pos}% : ${VARIANTS.map((v) => `v${v}=${NAMES[v]}`).join(" / ")}`);
  }

  await browser.close();
  console.log(`\n撮影完了 → ${OUT}`);
})();
