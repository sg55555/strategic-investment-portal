// 修正① 受入: 既定年/プレースホルダ/残像ゼロ/AIカード/復帰/ETF遷移（spec §5.5）
// 実行: PLAN2_PORT=8200 で mock 鯖起動後、NODE_PATH=/home/shugo/node_modules node scratchpad/zerofy-verify.js
const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8200";
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "networkidle" });
  const open = async (t) => { await page.evaluate((tk) => navigateToDetail(tk), t); await page.waitForTimeout(700); };
  const q = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el ? getComputedStyle(el).display : null; }, sel);

  await open("6861.T");   // 全ゼロFY2026 銘柄
  const defYear = await page.evaluate(() => document.getElementById("selected-year-display").innerText);
  check("既定年が実質最新年（2026 FY でない）", !/2026/.test(defYear));
  check("既定年でプレースホルダ非表示", ["none", null].includes(await q("#fin-pending-note")));
  // spec §5.4-3: KPI比較ストリップは全ゼロFY列（2026）を含まない（vacuousでないことも確認）
  const kpiColTexts = await page.evaluate(() => [...document.querySelectorAll("#kpi-compare-grid .kpi-year-col")].map((c) => c.textContent));
  check("KPI比較ストリップに列が1つ以上ある", kpiColTexts.length >= 1);
  check("KPI比較ストリップに2026年列を含まない", !kpiColTexts.some((t) => /2026/.test(t)));
  // FY2026 ボタンを手動選択
  await page.evaluate(() => { [...document.querySelectorAll(".time-btn")].find((b) => /2026/.test(b.innerText))?.click(); });
  await page.waitForTimeout(700);
  check("FY2026: プレースホルダ表示", (await q("#fin-pending-note")) !== "none");
  check("FY2026: KPI比較カード非表示", (await q("#kpi-compare-card")) === "none");
  check("FY2026: AI分析カード非表示", (await q("#ai-analysis-card")) === "none");
  check("FY2026: BSカード非表示", await page.evaluate(() => getComputedStyle(document.getElementById("bs-title").closest(".card")).display === "none"));
  // 実質年へ復帰
  await page.evaluate(() => { [...document.querySelectorAll(".time-btn")].find((b) => !/2026/.test(b.innerText))?.click(); });
  await page.waitForTimeout(700);
  check("復帰: KPI比較カード再表示", (await q("#kpi-compare-card")) !== "none");
  check("復帰: プレースホルダ非表示", (await q("#fin-pending-note")) === "none");
  // 前年に ai_analysis がある銘柄で FY2026 切替→AI カード非表示（mock は全年 ai_analysis 生成）
  await open("6861.T");
  const aiBefore = await q("#ai-analysis-card");
  await page.evaluate(() => { [...document.querySelectorAll(".time-btn")].find((b) => /2026/.test(b.innerText))?.click(); });
  await page.waitForTimeout(700);
  check("AI: 実質年で表示→FY2026で非表示", aiBefore !== "none" && (await q("#ai-analysis-card")) === "none");
  // ETF 遷移でプレースホルダ残留なし
  await open("SPY");
  check("SPY: プレースホルダ非表示", (await q("#fin-pending-note")) === "none");
  check("SPY: KPI比較カード非表示（ETF既存挙動）", (await q("#kpi-compare-card")) === "none");
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
