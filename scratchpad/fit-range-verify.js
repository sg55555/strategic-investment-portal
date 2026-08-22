// #9 受入（spec §9）: 少数バーの左余白解消＝可視 logical range の数値アサート。
//  priceChart は IIFE 私有のため DetailCharts.getPriceVisibleRange()（DetailCharts 名前空間の薄ラッパ・
//  window 直下公開なし＝spec §14）経由で読む。ペイン幅は LWC が生成する table の1行目・中央セル幅。
const { chromium } = require("playwright");
const fs = require("fs");
let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ✅ " : "  ❌ ") + name + (extra === undefined ? "" : `  [${extra}]`));
  if (!ok) failed++;
}
(async () => {
  // ── ① ソース照合
  const src = fs.readFileSync("detail-charts.js", "utf8");
  check("配線: updateMaAndVolume 末尾で fitLogicalRange 評価",
    /DetailRules\.fitLogicalRange\(displayPrices\.length, w\)/.test(src));
  check("配線: fit / setVisibleLogicalRange の分岐",
    /ts\.fitContent\(\) : ts\.setVisibleLogicalRange\(\{ from: r\.from, to: r\.to \}\)/.test(src));
  check("lockVisibleTimeRangeOnResize: true",
    /timeScale: \{ borderColor: "#2a3a44", lockVisibleTimeRangeOnResize: true \}/.test(src));
  check("ゲッターは DetailCharts 名前空間のみ（window 直下公開なし）",
    /getPriceVisibleRange,/.test(src) && !/window\.getPriceVisibleRange/.test(src));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });

  // ── ② 実データ US 銘柄の 2026 FY（181本＝fit 分岐。修正前は既定 barSpacing 6px で左に約33本ぶんの空白）
  await page.evaluate(() => navigateToDetail("NVDA"));
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("#year-controller-box .time-btn")].find((x) => x.innerText.trim().startsWith("2026"));
    if (b) b.click();
  });
  await page.waitForTimeout(2500);
  const r1 = await page.evaluate(() => {
    const { displayPrices } = DetailRules.priceWindow(STOCK_DATA["NVDA"].prices, 2026, true);
    const r = DetailCharts.getPriceVisibleRange();
    const tbl = document.querySelector("#chart-container table");
    const paneW = tbl ? tbl.rows[0].cells[1].getBoundingClientRect().width : 0;
    return { n: displayPrices.length, from: r ? r.from : null, to: r ? r.to : null, paneW };
  });
  check(`NVDA FY2026: 181本前後（n=${r1.n}）`, r1.n > 150 && r1.n < 220, String(r1.n));
  check(`NVDA FY2026: 左余白なし（from=${r1.from})`, r1.from !== null && r1.from > -2, String(r1.from));
  check(`NVDA FY2026: 右端まで表示（to=${r1.to}）`, r1.to !== null && r1.to >= r1.n - 1, String(r1.to));

  // ── ③ 合成35本（クランプ分岐＝中央寄せパディング）
  //  mock 鯖の build_ohlcv が返す検証専用 ticker。list には載せない（＝ポータル DOM/前 wave 受入6本に非波及）
  //  ので、STOCK_DATA へ stub を注入してから navigateToDetail → getStock が ohlcv/financials を引く。
  await page.evaluate(() => {
    STOCK_DATA["ZZFIT35"] = { company_name: "Fit Clamp Test ETF", industry: "検証用", currency: "USD",
      country: "US", type: "etf", marketCap: 1e11, per: 10, pbr: 1, prices: [], financials_trend: {} };
  });
  await page.evaluate(() => navigateToDetail("ZZFIT35"));
  await page.waitForTimeout(2500);
  const r2 = await page.evaluate(() => {
    const { displayPrices } = DetailRules.priceWindow(STOCK_DATA["ZZFIT35"].prices, 2025, true);
    const r = DetailCharts.getPriceVisibleRange();
    const tbl = document.querySelector("#chart-container table");
    const paneW = tbl ? tbl.rows[0].cells[1].getBoundingClientRect().width : 0;
    return { n: displayPrices.length, from: r ? r.from : null, to: r ? r.to : null, paneW };
  });
  check(`ZZFIT35: 合成35本が届いている（n=${r2.n}）`, r2.n === 35, String(r2.n));
  check("クランプ: 左右にパディング（from<0 かつ to>n-1）", r2.from < 0 && r2.to > r2.n - 1, `${r2.from} / ${r2.to}`);
  check("クランプ: 左右対称（差 <1 logical）",
    Math.abs((-r2.from) - (r2.to - (r2.n - 1))) < 1, `${r2.from} / ${r2.to}`);
  check("クランプ: バー幅 ≈ maxBarSpacing 15px（±2px）",
    Math.abs(r2.paneW / (r2.to - r2.from) - 15) <= 2, String((r2.paneW / (r2.to - r2.from)).toFixed(2)));

  check("pageerror 0", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
