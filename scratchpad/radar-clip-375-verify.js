// fix round2 Finding M-6: finviz-labels-verify.js は 1440px のみで radar のクリップ/交差を検証していた。
//  fix round1 で足した layout:{padding:20}＋offset:16 が、.chart-main-area が ≤480px で 280px固定・375px で
//  さらに 240px 固定（detail.css:459/466）という別幾何のモバイル幅でも有効かは未検証だった＝本スクリプトで確認する。
// 実行: PLAN2_PORT=8200 で mock 鯖起動後、NODE_PATH=/home/shugo/node_modules node scratchpad/radar-clip-375-verify.js
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
const X = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  const open = async (t) => { await page.evaluate((tk) => navigateToDetail(tk), t); await page.waitForTimeout(2000); };
  // finviz-labels-verify.js と同じ読み取りロジック（chart.config.options 経由・生 config で datalabels 関数を安全に呼ぶ）。
  const readRadarLayout = () => page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById("radarChart"));
    if (!chart) return null;
    const ds = chart.data.datasets[0];
    const items = chart.getDatasetMeta(0).data.map((el, i) => {
      const lab = (el.$datalabels || [])[0];
      const rect = (lab && lab.$layout && lab.$layout._visible && lab.$layout._box) ? lab.$layout._box._rect : null;
      return { i: i, label: String(chart.data.labels[i]), value: ds.data[i], rect: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null };
    });
    return { chartW: chart.width, chartH: chart.height, items: items };
  });
  const radarClipCount = (layout) => {
    if (!layout) return Infinity;
    return layout.items.filter((it) => {
      if (!it.rect) return false;
      const r = it.rect;
      return r.x < 0 || r.y < 0 || (r.x + r.w) > layout.chartW || (r.y + r.h) > layout.chartH;
    }).length;
  };
  const radarOverlapCount = (layout) => {
    const rects = (layout ? layout.items : []).map((s) => s.rect).filter(Boolean);
    let n = 0;
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (X(rects[i], rects[j])) n++;
    return n;
  };

  // 4519.T（全軸満点）・9984.T（ROE=100）・7201.T（低スコア＝放射退避が効くか）の3銘柄を 375px で確認。
  for (const [ticker, note] of [["4519.T", "全軸100"], ["9984.T", "ROE=100"], ["7201.T", "低スコア"]]) {
    await open(ticker);
    const layout = await readRadarLayout();
    const n = layout ? layout.items.length : 0;
    const clip = radarClipCount(layout);
    const overlap = radarOverlapCount(layout);
    console.log(`  -- ${ticker}（${note}）: chartW=${layout ? layout.chartW : "?"} chartH=${layout ? layout.chartH : "?"} labels=${n} clip=${clip} overlap=${overlap}`);
    check(`${ticker}: 375px でレーダーラベル canvas 外クリップ 0（${note}）`, clip === 0);
    check(`${ticker}: 375px でレーダーラベル相互交差 0（${note}）`, overlap === 0 && n >= 5);
  }

  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
