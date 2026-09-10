// scratchpad/chart-audit.js — 詳細ビューの Chart.js グラフを横断で実測する。
//
//  目的（2026-09-10・小工数 #11/#14）: 「棒が見えない」「ラベルが重なる／はみ出す」を
//  推測でなく数字で押さえる。CF だけでなく BS/PL/レーダー/推移も同じ物差しで測り、
//  修正の前後を同じスクリプトで比較する。
//
//  ラベル矩形は **chartjs-plugin-datalabels 自身が持つ _rects（frame）と _model.origin** から取る。
//  私の再実装ではなくプラグインの計算結果なので、描画とズレない。
//
//  使い方（それぞれ 1 行で 1 コマンド）:
//    PLAN2_PORT=8231 python3 scratchpad/mock_prod_server.py &
//    NODE_PATH=/home/shugo/node_modules node scratchpad/chart-audit.js
//  環境変数: CF_PORT / AUDIT_TICKERS（既定=代表8銘柄・"ALL"で全銘柄）/ AUDIT_TAG（出力名）
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PORT = process.env.CF_PORT || 8231;
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = process.env.AUDIT_TAG || "before";
const OUT = path.join(__dirname, "chart-audit-out");

// 代表パターン: 製造業 / 銀行3行 / 債務超過(米) / 米大型 / 持株会社
const DEFAULT_TICKERS = ["7203.T", "8306.T", "8411.T", "8316.T", "MCD", "SBUX", "AAPL", "9984.T"];
//  AUDIT_WIDTHS="850,875,890" で任意の幅に差し替え可（本人指摘の 851〜900px 帯など、境界の間を測るとき）
const VIEWPORTS = process.env.AUDIT_WIDTHS
  ? process.env.AUDIT_WIDTHS.split(",").map((w) => ({ name: String(+w), width: +w, height: 900 }))
  : [
  { name: "1440", width: 1440, height: 900 },
  { name: "1100", width: 1100, height: 900 },
  { name: "900", width: 900, height: 900 },
  { name: "768", width: 768, height: 900 },
];
const CHARTS = ["bsChart", "plChart", "cfChart", "radarChart", "healthTrend", "fcfTrend"];
const TINY_PX = 3;     // これ未満は「見えない」とみなす

function auditPage(arg) {
  const chartIds = arg.chartIds, tinyPx = arg.tinyPx;
  const out = {};
  for (const id of chartIds) {
    const canvas = document.getElementById(id);
    if (!canvas || !canvas.clientWidth) { out[id] = { missing: true }; continue; }
    const ch = window.Chart && window.Chart.getChart ? window.Chart.getChart(canvas) : null;
    if (!ch) { out[id] = { noInstance: true }; continue; }

    // ── 要素の実ピクセル（棒は高さ・点は半径・扇は外径）
    const tiny = [];
    const elems = [];
    ch.data.datasets.forEach((ds, di) => {
      const meta = ch.getDatasetMeta(di);
      if (meta.hidden) return;
      (meta.data || []).forEach((el, i) => {
        const t = el.constructor && el.constructor.id;
        let px = null, kind = t;
        if (t === "bar") {
          const p = el.getProps(["y", "base", "width", "height"], true);
          px = Math.round(Math.abs(p.base - p.y) * 10) / 10;
          kind = "bar";
        } else if (t === "point") {
          px = Math.round((el.options && el.options.radius) * 10) / 10;
        } else if (t === "arc") {
          const p = el.getProps(["outerRadius", "innerRadius"], true);
          px = Math.round((p.outerRadius - p.innerRadius) * 10) / 10;
        }
        if (px === null) return;
        const label = (ch.data.labels && ch.data.labels[i]) || `#${i}`;
        const value = Array.isArray(ds.data[i]) ? ds.data[i] : ds.data[i];
        elems.push({ ds: di, i, kind, label: String(label), px, value });
        if (kind === "bar" && px < tinyPx && !(value === 0 || value === null ||
            (Array.isArray(value) && value[0] === value[1]))) {
          tiny.push({ ds: di, i, label: String(label), px, value });
        }
      });
    });

    // ── ラベル矩形
    //  プラグインは最終描画位置を静的には持たない（_model.origin は x=null の
    //  データセット原点で、align/offset 適用前）。そこで **箱の寸法はプラグインの
    //  _rects.frame を、置き場所は _model の anchor/align/offset を**使って復元する。
    //  検算＝7203.T@1100 で「その他・調整↔期末現金残高」が重なり、@1440 では重ならない
    //  （実スクショと一致することを 2026-09-10 に確認済み）。
    const rects = [];
    const dl = ch.$datalabels;
    if (dl && dl._labels) {
      dl._labels.forEach((l) => {
        const m = l._model;
        if (!m || m.display === false || !l._rects || !l._rects.frame) return;
        const el = l._el;
        if (!el) return;
        const f = l._rects.frame;
        const t = el.constructor && el.constructor.id;
        let ax, ay;
        if (t === "bar") {
          const p = el.getProps(["x", "y", "base"], true);
          ax = p.x;
          ay = m.anchor === "start" ? p.base : m.anchor === "center" ? (p.y + p.base) / 2 : p.y;
        } else {
          const p = el.getProps(["x", "y"], true);
          ax = p.x; ay = p.y;
        }
        const off = typeof m.offset === "number" ? m.offset : 0;
        let cx = ax, cy = ay;
        const a = m.align;
        if (a === "top") cy = ay - off - f.h / 2;
        else if (a === "bottom") cy = ay + off + f.h / 2;
        else if (a === "left" || a === "start") cx = ax - off - f.w / 2;
        else if (a === "right" || a === "end") cx = ax + off + f.w / 2;
        rects.push({
          i: l._index,
          label: String((ch.data.labels && ch.data.labels[l._index]) || `#${l._index}`),
          x1: Math.round(cx - f.w / 2), y1: Math.round(cy - f.h / 2),
          x2: Math.round(cx + f.w / 2), y2: Math.round(cy + f.h / 2),
          lines: (m.lines || []).length,
          text: (m.lines || []).join(" / "),
        });
      });
    }
    const overlaps = [];
    for (let a = 0; a < rects.length; a++) {
      for (let b = a + 1; b < rects.length; b++) {
        const ox = Math.min(rects[a].x2, rects[b].x2) - Math.max(rects[a].x1, rects[b].x1);
        const oy = Math.min(rects[a].y2, rects[b].y2) - Math.max(rects[a].y1, rects[b].y1);
        if (ox > 0 && oy > 0) overlaps.push({ pair: `${rects[a].label}↔${rects[b].label}`, xPx: Math.round(ox), yPx: Math.round(oy) });
      }
    }
    const W = canvas.clientWidth, H = canvas.clientHeight;
    const clipped = rects.filter((r) => r.x1 < 0 || r.y1 < 0 || r.x2 > W || r.y2 > H)
      .map((r) => ({ label: r.label, x1: r.x1, x2: r.x2, y1: r.y1, y2: r.y2 }));

    out[id] = {
      canvas: { w: W, h: H },
      elemCount: elems.length,
      tiny,
      labelCount: rects.length,
      overlaps,
      clipped,
      rects,
    };
  }
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = { tag: TAG, at: new Date().toISOString(), pages: {} };
  const summary = [];
  const page0 = await browser.newPage();
  await page0.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page0.waitForFunction(() => typeof STOCK_DATA === "object" && Object.keys(STOCK_DATA || {}).length, { timeout: 20000 });
  const all = await page0.evaluate(() => Object.keys(STOCK_DATA));
  await page0.close();
  const wanted = process.env.AUDIT_TICKERS === "ALL" ? all
    : (process.env.AUDIT_TICKERS ? process.env.AUDIT_TICKERS.split(",") : DEFAULT_TICKERS);
  const tickers = wanted.filter((t) => all.includes(t));
  console.log(`銘柄 ${tickers.length} / 画面幅 ${VIEWPORTS.length} / グラフ ${CHARTS.length}`);

  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => typeof STOCK_DATA === "object" && Object.keys(STOCK_DATA || {}).length, { timeout: 20000 });
    for (const t of tickers) {
      await page.evaluate((tk) => navigateToDetail(tk), t);
      await page.waitForTimeout(2400);
      const r = await page.evaluate(auditPage, { chartIds: CHARTS, tinyPx: TINY_PX });
      report.pages[`${t}@${vp.name}`] = r;
      for (const id of CHARTS) {
        const c = r[id];
        if (!c || c.missing || c.noInstance) continue;
        if (c.tiny.length || c.overlaps.length || c.clipped.length) {
          summary.push({ key: `${t}@${vp.name}`, chart: id,
            tiny: c.tiny.map((x) => `${x.label}=${x.px}px`),
            overlaps: c.overlaps.map((x) => `${x.pair}(${x.xPx}x${x.yPx})`),
            clipped: c.clipped.map((x) => x.label) });
        }
      }
    }
    report[`_pageerrors@${vp.name}`] = errs;
    await ctx.close();
    console.log(`  ${vp.name}px 完了`);
  }
  await browser.close();
  report.summary = summary;
  fs.writeFileSync(path.join(OUT, `report-${TAG}.json`), JSON.stringify(report, null, 1));

  // 集計（グラフ別に件数）
  const byChart = {};
  for (const s of summary) {
    const b = (byChart[s.chart] = byChart[s.chart] || { tiny: 0, overlaps: 0, clipped: 0, keys: new Set() });
    b.tiny += s.tiny.length; b.overlaps += s.overlaps.length; b.clipped += s.clipped.length; b.keys.add(s.key);
  }
  console.log(`\n=== ${TAG} 集計（グラフ別）===`);
  for (const [id, b] of Object.entries(byChart)) {
    console.log(`${id.padEnd(12)} 見えない棒 ${String(b.tiny).padStart(3)} / ラベル重なり ${String(b.overlaps).padStart(3)} / はみ出し ${String(b.clipped).padStart(3)}  (${b.keys.size} ケース)`);
  }
  console.log("出力:", path.join(OUT, `report-${TAG}.json`));
})();
