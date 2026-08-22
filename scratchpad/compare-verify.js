// #10 受入（spec §10）: 比較チャート F1-F4。compareChart は IIFE 私有＝右軸バッジはソース照合、
//  legend/chips/縦高は DOM 実測。MODE=before で「コード変更前の 480px 総縦高」を採取する
//  （B0 の detail-snapshot は compare モーダル非対象＝後から before は取れない）。
const { chromium } = require("playwright");
const fs = require("fs");
const BEFORE = process.env.MODE === "before";
let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ✅ " : "  ❌ ") + name + (extra === undefined ? "" : `  [${extra}]`));
  if (!ok) failed++;
}
const TICKERS = ["8306.T", "6758.T", "4755.T", "NVDA", "BRK-B", "MCD", "SBUX"];   // + 7203.T = 8銘柄（上限）
async function openCompare(page) {
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(2200);
  await page.evaluate(() => openCompareModal());
  for (const t of TICKERS) await page.evaluate((tk) => addToCompare(tk), t);
  await page.waitForTimeout(1500);
}
const MEASURE = () => {
  const box = document.querySelector(".compare-modal-box");
  const chips = document.getElementById("compare-chips");
  const lg = document.getElementById("compare-legend");
  return {
    boxH: Math.round(box.getBoundingClientRect().height),
    chipsH: Math.round(chips.getBoundingClientRect().height),
    legendH: Math.round(lg.getBoundingClientRect().height),
    chipTexts: [...chips.querySelectorAll(".compare-chip")].map((c) => c.textContent.replace(/[✕\s]/g, "")),
    legendItems: lg.querySelectorAll(".compare-legend-item").length,
    legendVals: [...lg.querySelectorAll(".compare-legend-val")].map((v) => v.textContent.trim()),
  };
};
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  // ── 480px: 縦膨張の before/after
  const narrow = await browser.newPage({ viewport: { width: 480, height: 900 } });
  narrow.on("pageerror", (e) => errors.push(String(e)));
  await narrow.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await openCompare(narrow);
  const m = await narrow.evaluate(MEASURE);
  console.log("  📐 480px:", JSON.stringify(m));
  if (BEFORE) {
    console.log("BEFORE MEASURED（この値を SDD ledger に控えて MODE 無しで再実行する）");
    await browser.close();
    process.exit(0);
  }
  // ── ① ソース照合（F-1）
  const src = fs.readFileSync("detail-charts.js", "utf8");
  check("F-1: compare 系列の lastValueVisible:false",
    /addLineSeries\(\{ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false \}\)/.test(src));
  // ── ② F-2 legend の期間リターン%
  check("F-2: legend 8項目", m.legendItems === 8, String(m.legendItems));
  check("F-2: 全項目に符号付き%", m.legendVals.length === 8 && m.legendVals.every((v) => /^[+-]\d+(\.\d+)?%$/.test(v)),
    m.legendVals.join(" "));
  // ── ③ F-3 chips はティッカーのみ
  check("F-3: chips がティッカー表示", m.chipTexts.length === 8
    && m.chipTexts.every((t) => ["7203.T"].concat(TICKERS).includes(t)), m.chipTexts.join(","));
  const BEFORE_BOX_H = Number(process.env.BEFORE_BOX_H || 0);   // Step 1 で控えた before 値
  check(`F-3: 480px の総縦高が before(${BEFORE_BOX_H}) 以下`, BEFORE_BOX_H > 0 && m.boxH <= BEFORE_BOX_H,
    `after=${m.boxH}`);
  check("F-3: chips 段数が減る（before 122px 相当 → 2段以内 ≈70px 以下）", m.chipsH <= 70, String(m.chipsH));
  // ── ④ F-4 setComparePeriod のプログラム呼出し
  const threw = await narrow.evaluate(() => { try { setComparePeriod(36); return null; } catch (e) { return String(e); } });
  check("F-4: page から setComparePeriod(36) が throw しない", threw === null, String(threw));
  await narrow.waitForTimeout(800);
  const m2 = await narrow.evaluate(MEASURE);
  check("F-4: 期間切替後も legend 8項目が再描画される", m2.legendItems === 8, String(m2.legendItems));
  // クリック経路（btn 引数）で active が1つだけ付く
  const act = await narrow.evaluate(() => {
    [...document.querySelectorAll(".compare-period-btn")][0].click();
    return [...document.querySelectorAll(".compare-period-btn.active")].map((b) => b.textContent.trim());
  });
  check("F-4: クリック経路で active は 1 個（3M）", act.length === 1 && act[0] === "3M", act.join(","));

  // ── ⑤ 1440px でも同様に成立（narrow 専用の退行を避ける）
  const wide = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  wide.on("pageerror", (e) => errors.push(String(e)));
  await wide.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await openCompare(wide);
  const mw = await wide.evaluate(MEASURE);
  check("1440px: legend 8項目＋符号付き%", mw.legendItems === 8 && mw.legendVals.every((v) => /^[+-]\d+(\.\d+)?%$/.test(v)),
    mw.legendVals.join(" "));
  check("pageerror 0", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
