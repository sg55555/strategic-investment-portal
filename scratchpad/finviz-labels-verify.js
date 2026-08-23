// spec §7.5 受入: 財務ラベル4件（#4 銀行N/A・#5 val=0 退避・#6 レーダー放射・#7 流動比率 N/A）＋NEW 健全性トレンド。
// 実行: PLAN2_PORT=8200 で mock 鯖起動後、NODE_PATH=/home/shugo/node_modules node scratchpad/finviz-labels-verify.js
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
const X = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  const open = async (t) => { await page.evaluate((tk) => navigateToDetail(tk), t); await page.waitForTimeout(2000); };
  // datalabels の描画テキスト/矩形を読む（_model.lines が取れない場合は formatter を直接評価してフォールバック）
  const read = (canvasId) => page.evaluate((id) => {
    const chart = Chart.getChart(document.getElementById(id));
    if (!chart) return null;
    const ds = chart.data.datasets[0];
    // chart.options.plugins.datalabels は Chart.js の解決済み options Proxy＝関数値プロパティに
    //  typeof/read するだけで内部リゾルバが「.dataset を持たないダミー ctx」で即時 invoke し例外化する
    //  （実測: chart.options 経由は align/offset/formatter すべて即クラッシュ）。chart.config.options
    //  （非プロキシの生 config）を読めば関数そのものが取れ、本テストの手組み ctx で安全に呼べる。
    const opts = chart.config.options.plugins.datalabels;
    const items = chart.getDatasetMeta(0).data.map((el, i) => {
      const lab = (el.$datalabels || [])[0];
      let text = null;
      if (lab && lab._model && Array.isArray(lab._model.lines)) text = lab._model.lines.join("\n");
      if (text === null && typeof opts.formatter === "function") {
        text = opts.formatter(ds.data[i], { chart: chart, dataIndex: i, datasetIndex: 0, dataset: ds });
      }
      const rect = (lab && lab.$layout && lab.$layout._visible && lab.$layout._box) ? lab.$layout._box._rect : null;
      const ctx = { chart: chart, dataIndex: i, datasetIndex: 0, dataset: ds };
      return {
        i: i, label: String(chart.data.labels[i]), value: ds.data[i], text: text,
        rect: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null,
        align: typeof opts.align === "function" ? opts.align(ctx) : opts.align,
        offset: typeof opts.offset === "function" ? opts.offset(ctx) : opts.offset,
      };
    });
    return { items: items, labelCount: chart.data.labels.length };
  }, canvasId);
  const sidePanel = () => page.evaluate(() => ({
    cur: (document.getElementById("current-ratio") || {}).innerText || null,
    desc: (document.getElementById("desc-current-ratio") || {}).innerText || null,
  }));
  const healthCur = () => page.evaluate(() => {
    const chart = Chart.getChart(document.getElementById("healthTrend"));
    if (!chart) return null;
    const d = chart.data.datasets.find((s) => /流動比率/.test(s.label));
    return d ? d.data.slice() : null;
  });
  // fix round1 Finding1: レーダーラベルの canvas 外クリップ検出（満点=100 で外周に達する軸が、
  //  放射 offset 分だけ canvas 境界の外にはみ出していないか）。$layout._box._rect は chart.width/height と
  //  同じ座標系（px, 左上原点）＝矩形の全4辺が [0,width]×[0,height] に収まっているかで判定。
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

  // ── 8306.T（銀行）: #4 表示・#7 側パネル・NEW 健全性トレンド・#6 レーダー ──
  await open("8306.T");
  const pl8306 = await read("plChart");
  const op8306 = pl8306.items.find((s) => s.label === "営業利益");
  check("8306.T: PL 営業利益が N/A (銀行・金融)", !!op8306 && op8306.text === "N/A\n(銀行・金融)");
  check("8306.T: 営業利益(val=0) は top 退避・offset 12", !!op8306 && op8306.align === "top" && op8306.offset === 12);
  const sp8306 = await sidePanel();
  check("8306.T: #current-ratio = N/A（0.0% 偽値の解消）", sp8306.cur === "N/A");
  check("8306.T: #desc-current-ratio が適用外文言", /銀行・金融は流動\/固定区分がなく適用外/.test(sp8306.desc || ""));
  const hc8306 = await healthCur();
  check("8306.T: 健全性トレンドの流動比率が全 null（偽0%実線なし）", Array.isArray(hc8306) && hc8306.every((v) => v === null));
  const rd8306 = await read("radarChart");
  const rects8306 = rd8306.items.map((s) => s.rect).filter(Boolean);
  let ov8306 = false;
  for (let i = 0; i < rects8306.length; i++) for (let j = i + 1; j < rects8306.length; j++) if (X(rects8306[i], rects8306[j])) ov8306 = true;
  check(`8306.T: レーダーラベル相互交差 0（${rects8306.length}枚）`, rects8306.length >= 5 && !ov8306);

  // ── 9984.T（持株会社）: IFRS 経常段省略＋val=0 退避 ──
  await open("9984.T");
  const pl9984 = await read("plChart");
  check("9984.T: 経常利益段なし（IFRS 段省略）", !pl9984.items.some((s) => s.label === "経常利益"));
  const zero9984 = pl9984.items.filter((s) => s.value === 0);
  check("9984.T: val=0 段は top 退避・offset 12（center 分岐の廃止）", zero9984.length > 0 && zero9984.every((s) => s.align === "top" && s.offset === 12));
  const op9984 = pl9984.items.find((s) => s.label === "営業利益");
  check("9984.T: 営業利益は持株会社 N/A のまま（銀行分岐に誤爆しない）", !!op9984 && op9984.text === "N/A\n(持株会社仕様)");
  // fix round1 Finding1: 9984.T は ROE=100（満点＝上端軸）を含む＝レビュー指摘の見落とし穴（この銘柄は
  //  従来 PL しか読んでいなかった）。レーダーのクリップ0・交差0 を追加でここに配線する。
  const rl9984 = await readRadarLayout();
  check(`9984.T: レーダーラベル canvas 外クリップ 0（ROE=100 含む・${rl9984 ? rl9984.items.length : 0}枚）`, radarClipCount(rl9984) === 0);
  check(`9984.T: レーダーラベル相互交差 0（${rl9984 ? rl9984.items.length : 0}枚）`, radarOverlapCount(rl9984) === 0 && rl9984 && rl9984.items.length >= 5);

  // ── 4519.T（全軸満点）: レーダー クリップ0（fix round1 Finding1 の再現銘柄） ──
  await open("4519.T");
  const rl4519 = await readRadarLayout();
  check(`4519.T: レーダーラベル canvas 外クリップ 0（全軸100・${rl4519 ? rl4519.items.length : 0}枚）`, radarClipCount(rl4519) === 0);
  check(`4519.T: レーダーラベル相互交差 0（${rl4519 ? rl4519.items.length : 0}枚）`, radarOverlapCount(rl4519) === 0 && rl4519 && rl4519.items.length >= 5);

  // ── 7201.T（低スコア）: レーダー放射分離 ──
  await open("7201.T");
  const rd7201 = await read("radarChart");
  const rects7201 = rd7201.items.map((s) => s.rect).filter(Boolean);
  let ov7201 = false;
  for (let i = 0; i < rects7201.length; i++) for (let j = i + 1; j < rects7201.length; j++) if (X(rects7201[i], rects7201[j])) ov7201 = true;
  check(`7201.T: レーダーラベル相互交差 0（${rects7201.length}枚）`, rects7201.length >= 5 && !ov7201);

  // ── 7203.T（非金融）: 非退行 ──
  await open("7203.T");
  const pl7203 = await read("plChart");
  check("7203.T: PL に N/A ラベルなし（誤爆なし）", !pl7203.items.some((s) => /N\/A/.test(String(s.text || ""))));
  const sp7203 = await sidePanel();
  check("7203.T: #current-ratio が % 表示（N/A でない）", /%$/.test(sp7203.cur || "") && sp7203.cur !== "N/A");
  check("7203.T: #desc-current-ratio が基準文言に復帰", /短期支払能力基準/.test(sp7203.desc || ""));
  const hc7203 = await healthCur();
  check("7203.T: 健全性トレンドの流動比率に実点あり", Array.isArray(hc7203) && hc7203.some((v) => v !== null));

  check("pageerror 0", errors.length === 0);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
