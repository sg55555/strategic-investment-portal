// 修正② 受入: S/R 窓統一（レベルが表示窓レンジ内・digest と同一入力）＋ A-mini source assert
const { chromium } = require("playwright");
const fs = require("fs");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
(async () => {
  // ① コード同一性: 呼出口2つが displayPrices 系・axisLabelVisible が index ゲート
  const src = fs.readFileSync("detail-charts.js", "utf8");
  check("chart 側呼出が displayPrices", /applySRLines\(displayPrices\)/.test(src));
  check("toggleSR が currentDisplayPrices フォールバック", /applySRLines\(currentDisplayPrices \|\| data\.prices\)/.test(src));
  check("A-mini: axisLabelVisible: i < 2", (src.match(/axisLabelVisible: i < 2/g) || []).length === 2);
  check("MA/BB/KC base 不可侵", /const base = allPrices && allPrices\.length >= 75 \? allPrices : displayPrices;/.test(src));
  // ② 機能: 過年度 FY 窓で S/R が窓レンジ内（監査B の逆転・レンジ外れの解消定義）
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  for (const [t, yr, isUS] of [["7203.T", 2024, false], ["8306.T", 2024, false], ["NVDA", 2024, true]]) {
    const r = await page.evaluate(async ([tk, y, us]) => {
      // STOCK_DATA[tk].prices は list API では未ハイドレート（[]）。getStock で ohlcv をその場マージしてから読む
      // （navigateToDetail 相当のハイドレーション・DOM 描画は不要なので getStock 単体で足りる）。
      await getStock(tk);
      const prices = STOCK_DATA[tk].prices;
      const { displayPrices } = DetailRules.priceWindow(prices, y, us);
      const sr = DetailRules.detectSR(displayPrices);          // 修正後のチャート入力と同一
      const srFull = DetailRules.detectSR(displayPrices, Infinity); // digest 入力
      const lows = displayPrices.map((p) => p.low), highs = displayPrices.map((p) => p.high);
      const lo = Math.min(...lows), hi = Math.max(...highs);
      const levels = sr.resistance.concat(sr.support).map((x) => x.price);
      const inRange = levels.every((p) => p >= lo * 0.985 && p <= hi * 1.015); // クラスタ平均±1.5%帯ぶんの許容
      const subset = sr.resistance.every((c) => srFull.resistance.some((f) => f.price === c.price))
        && sr.support.every((c) => srFull.support.some((f) => f.price === c.price));
      return { n: levels.length, dpLen: displayPrices.length, inRange, subset };
    }, [t, yr, isUS]);
    check(`${t} FY${yr}: displayPrices 非空（dp=${r.dpLen}）`, r.dpLen > 0);
    check(`${t} FY${yr}: S/R ${r.n}本すべて窓レンジ内`, r.n > 0 && r.inRange);
    check(`${t} FY${yr}: chart top-3 ⊆ digest 全クラスタ（同一入力の決定論）`, r.subset);
  }
  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
