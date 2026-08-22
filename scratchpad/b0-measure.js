// scratchpad/b0-measure.js — B0 実測（spec §12.0）:
//  ① TIME_AXIS_H＝LWC v4.2.3 が生成する time-axis 行の DOM 高（Part B Task 8＝C4 が使う定数）
//  ② 時間軸 ON/OFF 前後の canvasCount 不変性（spec §12.1 層1ゲートの例外要否の判定）
//  ③ 付随実測: 各サブパネルの右 price-axis セル幅（D24 minimumWidth の妥当性材料）
// read-only（コード変更なし）・mock 鯖 8200 前提。DOM 構造は host > div.tv-lightweight-charts > table、
// table.rows[0]=ペイン行（cells: 左軸/ペイン/右軸）・rows[1]=時間軸行（visible:false なら高さ0）。
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://localhost:8200/?diag=off", { waitUntil: "networkidle" });
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(2500);

  const count = () => page.evaluate(() => document.querySelectorAll("#detail-view canvas").length);
  // SOFT_CAP=2 のため chip 追加だけでは畳んだまま＝「すべて開く」を続けて押す必要がある。
  const addAndExpand = async (key) => {
    await page.evaluate((k) => {
      const chip = document.getElementById("sp-chip-" + k);
      if (chip) chip.click();
      const links = document.getElementById("subpanel-links");
      const openAll = links && links.querySelectorAll("a")[0];
      if (openAll) openAll.click();
    }, key);
    await page.waitForTimeout(1200);
  };

  const c0 = await count();          // 既定 adx+atr（どちらも timeAxis:false）
  await addAndExpand("rsi");
  const c1 = await count();          // +RSI（timeAxis:false）
  await addAndExpand("macd");
  const c2 = await count();          // +MACD（現 HEAD で唯一 timeAxis:true）
  await addAndExpand("obv");
  const c3 = await count();

  const rows = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll("#subpanel-accordion .acc-item").forEach((it) => {
      const host = it.querySelector(".subpanel-host");
      const tbl = host && host.querySelector("table");
      out.push({
        key: it.dataset.key,
        hostH: host ? host.clientHeight : null,
        rowHeights: tbl ? [...tbl.rows].map((tr) => Math.round(tr.getBoundingClientRect().height)) : null,
        priceAxisW: (tbl && tbl.rows[0]) ? Math.round(tbl.rows[0].cells[2].getBoundingClientRect().width) : null,
        canvases: host ? host.querySelectorAll("canvas").length : 0,
      });
    });
    return out;
  });

  const macd = rows.find((r) => r.key === "macd") || {};
  console.log(JSON.stringify({
    TIME_AXIS_H: macd.rowHeights ? macd.rowHeights[1] : null,
    canvasCount: {
      adx_atr: c0, plus_rsi_axisOFF: c1, plus_macd_axisON: c2, plus_obv: c3,
      deltaAxisOFF: c1 - c0, deltaAxisON: c2 - c1,
      invariant: (c1 - c0) === (c2 - c1),
    },
    rows,
    pageErrors: errors,
  }, null, 1));
  await browser.close();
})();
