// scratchpad/cf-recon.js — 小工数 #11(CF ラベル衝突) / #14(銀行CF 専用表示) の現状を実測する。
//  推測で作り直さないための recon。棒の実ピクセル高さとラベル矩形を測り、
//  「フロー段が何 px か」「どのラベルが重なるか」を数字で出す＋CF カードのスクショを撮る。
//
//  使い方（この 1 行で 1 コマンド）:
//    PLAN2_PORT=8231 python3 scratchpad/mock_prod_server.py & sleep 2
//    NODE_PATH=/home/shugo/node_modules node scratchpad/cf-recon.js
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PORT = process.env.CF_PORT || 8231;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, "cf-recon-out");
const TICKERS = (process.env.CF_TICKERS || "7203.T,8306.T,8411.T").split(",");
const VIEWPORTS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "1100", width: 1100, height: 900 },
  { name: "900", width: 900, height: 900 },
  { name: "768", width: 768, height: 900 },
  { name: "390", width: 390, height: 844 },
];

// ページ内で走る計測。Chart.getChart で CF チャート実体を取り、棒の実ピクセルと
// datalabels の矩形（プラグイン内部があればそれ、無ければ formatter+measureText で再現）を返す。
function measure() {
  const canvas = document.getElementById("cfChart");
  if (!canvas) return { error: "cfChart canvas が無い" };
  const ch = window.Chart && window.Chart.getChart ? window.Chart.getChart(canvas) : null;
  if (!ch) return { error: "Chart インスタンスが取れない" };

  const meta = ch.getDatasetMeta(0);
  const area = ch.chartArea;
  const dl = ch.options.plugins.datalabels;
  const ctx = canvas.getContext("2d");
  const fontSpec = "bold 14px " + getComputedStyle(canvas).fontFamily;

  const bars = meta.data.map((el, i) => {
    const props = el.getProps(["x", "y", "base", "width"], true);
    const h = Math.abs(props.base - props.y);
    return {
      i,
      label: ch.data.labels[i],
      x: Math.round(props.x),
      top: Math.round(Math.min(props.y, props.base)),
      bottom: Math.round(Math.max(props.y, props.base)),
      barW: Math.round(props.width),
      pxH: Math.round(h * 10) / 10,
    };
  });

  // ラベル文字列は実際の formatter を通す（表示と同じ文字列で幅を測る）。
  // Chart.js が scriptable option を解決済みで formatter を持たない版があるので、
  // その場合は描画側と同じ式（label + 改行 + 符号 + fmtUnitValue(diff, unit)）で再現する。
  const rawData = ch.data.datasets[0].data;
  const last = rawData.length - 1;
  const diffOf = (i) => (Array.isArray(rawData[i]) ? rawData[i][1] - rawData[i][0] : rawData[i]);
  const cfg = (ch.config && ch.config.options && ch.config.options.plugins || {}).datalabels || {};
  const fmt = typeof dl.formatter === "function" ? dl.formatter
    : typeof cfg.formatter === "function" ? cfg.formatter
      : null;
  const scale = Math.max.apply(null, rawData.flat().map(Math.abs).concat([1]));
  const unit = window.FinanceRules
    ? window.FinanceRules.pickUnit(scale, (window.STOCK_DATA || {})[window.currentTicker] &&
        window.STOCK_DATA[window.currentTicker].currency)
    : null;
  ctx.save();
  ctx.font = fontSpec;
  const labels = bars.map((b, i) => {
    const d = diffOf(i);
    const raw = fmt
      ? fmt(rawData[i], { dataIndex: i, chart: ch })
      : ch.data.labels[i] + "\n" + (d > 0 && i !== 0 && i !== last ? "+" : "") +
        (unit ? window.FinanceRules.fmtUnitValue(d, unit) : String(d));
    const lines = String(raw).split("\n");
    const w = Math.max.apply(null, lines.map((s) => ctx.measureText(s).width));
    return { i, text: lines.join(" / "), w: Math.round(w), lines: lines.length };
  });
  ctx.restore();

  // ラベル矩形を描画側と同じ規則で再現する（anchor end/start・align top/bottom・offset 15）。
  //  datalabels の既定 lineHeight=1.2・padding=4。棒の中心 x に置かれる。
  const OFFSET = typeof dl.offset === "number" ? dl.offset : 15;
  const LH = 14 * 1.2, PAD = 4;
  const rects = bars.map((b, i) => {
    const d = diffOf(i);
    const anchorEnd = i === 0 || i === last ? true : d >= 0;
    const anchorY = anchorEnd ? (d >= 0 ? b.top : b.bottom) : (d >= 0 ? b.bottom : b.top);
    const h = labels[i].lines * LH + PAD * 2;
    const w = labels[i].w + PAD * 2;
    const alignTop = d >= 0;
    const y1 = alignTop ? anchorY - OFFSET - h : anchorY + OFFSET;
    return { i, label: b.label, x1: Math.round(b.x - w / 2), x2: Math.round(b.x + w / 2), y1: Math.round(y1), y2: Math.round(y1 + h) };
  });

  // 全ペアの矩形交差（隣接に限らない）＋描画域からのはみ出し
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const ox = Math.min(rects[i].x2, rects[j].x2) - Math.max(rects[i].x1, rects[j].x1);
      const oy = Math.min(rects[i].y2, rects[j].y2) - Math.max(rects[i].y1, rects[j].y1);
      if (ox > 0 && oy > 0) {
        overlaps.push({ pair: `${rects[i].label}↔${rects[j].label}`, xPx: Math.round(ox), yPx: Math.round(oy) });
      }
    }
  }
  const clipped = rects.filter((r) => r.y1 < 0 || r.y2 > canvas.clientHeight || r.x1 < 0 || r.x2 > canvas.clientWidth)
    .map((r) => ({ label: r.label, y1: r.y1, y2: r.y2, x1: r.x1, x2: r.x2 }));

  const slot = bars.length > 1 ? Math.round(bars[1].x - bars[0].x) : null;
  return {
    chartArea: { w: Math.round(area.right - area.left), h: Math.round(area.bottom - area.top) },
    canvasCss: { w: canvas.clientWidth, h: canvas.clientHeight },
    slotPx: slot,
    datalabelsOn: dl.display !== false,
    bars,
    labels,
    rects,
    overlaps,
    clipped,
    yMax: ch.scales.y.max,
    yMin: ch.scales.y.min,
    unitBadge: (document.querySelector("#cf-title .unit-badge") || {}).textContent || null,
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = {};
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
      { timeout: 15000 },
    );
    for (const t of TICKERS) {
      await page.evaluate((tk) => navigateToDetail(tk), t);
      await page.waitForTimeout(2600);   // アニメ 1500ms + 描画余裕
      const m = await page.evaluate(measure);
      report[`${t}@${vp.name}`] = m;
      const card = page.locator("#cfChart").locator("xpath=ancestor::div[contains(@class,'card')][1]");
      const file = path.join(OUT, `cf-${t.replace(".", "_")}-${vp.name}.png`);
      try { await card.screenshot({ path: file }); } catch (e) { report[`${t}@${vp.name}`].shotError = String(e).slice(0, 120); }
      const tiny = (m.bars || []).filter((b) => b.pxH < 3).map((b) => `${b.label}=${b.pxH}px`);
      console.log(`${t}@${vp.name}: 段=${(m.bars || []).length} 重なり=${(m.overlaps || []).length}` +
        ` 3px未満=[${tiny.join(", ")}] slot=${m.slotPx}px`);
    }
    report[`_pageerrors@${vp.name}`] = errs;
    await ctx.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 1));
  console.log("\n出力:", OUT);
})();
