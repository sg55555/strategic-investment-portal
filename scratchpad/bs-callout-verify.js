// 修正④⑤ 受入: 代表銘柄×幅で吹き出し矩形を実測（監査 2026-08-09 と同手法・spec §9.2）
// Task 14: BS 吹き出しの数値アサート受入（監査再現）
//
// 銘柄補正（Task 12-13 の実DB検証で判明。task-14-brief.md のコメントより本コメントが正）:
//   - 6758.T は lowRight を exercise する（固定負債 9.53% が LOW=0.12 未満）。
//     brief 内コメント「低棒左列」表記は誤りだった（lowLeft ではなく lowRight）。
//   - MCD を追加。lowLeft の実 exerciser（流動負債{di:2,bi:1}＋流動資産{di:4,bi:0}）かつ
//     displayNetAssets=0（v>0 ガードで除外される負の純資産）を持つ。USD 銘柄。
//   - 4755.T は同側ペア {di:0,bi:1}+{di:2,bi:1} → stagger（角度 align）ケース。
const { chromium } = require("playwright");
let failed = 0;
function check(name, ok) { console.log((ok ? "  ✅ " : "  ❌ ") + name); if (!ok) failed++; }
const X = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
(async () => {
  const browser = await chromium.launch();
  for (const width of [1440, 1024]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
    for (const t of ["6758.T", "8306.T", "7203.T", "4755.T", "NVDA", "BRK-B", "MCD", "SBUX"]) {
      await page.evaluate((tk) => navigateToDetail(tk), t);
      await page.waitForTimeout(2000);   // アニメ1500ms 完了後に実測
      const r = await page.evaluate(() => {
        const chart = Chart.getChart(document.getElementById("bsChart"));
        if (!chart) return null;
        const ca = chart.chartArea;
        const cw = chart.canvas.width / (window.devicePixelRatio || 1);
        const ch = chart.canvas.height / (window.devicePixelRatio || 1);
        const axisBand = { x: ca.left - chart.scales.y.width, y: ca.top, w: chart.scales.y.width, h: ca.bottom - ca.top };
        // spec §11.3: 注記チップは chartArea の上（top:65 帯）に出るため、y軸 tick ラベルの上半分との近接を
        //  検出できるよう注記専用に 8px 上へ広げた帯を使う（チップ系の既存アサートは axisBand のまま）。
        const axisBandWide = { x: axisBand.x, y: ca.top - 8, w: axisBand.w, h: (ca.bottom - ca.top) + 8 };
        const chips = [], bars = [];
        (chart.$bsLeaders || []).forEach(({ di, bi }) => {
          const el = chart.getDatasetMeta(di).data[bi];
          const lab = el && (el.$datalabels || [])[0];
          if (!lab || !lab.$layout || !lab.$layout._visible) return;
          const rc = lab.$layout._box._rect;
          chips.push({ x: rc.x, y: rc.y, w: rc.w, h: rc.h });
          const half = ca.width / 4;
          const p = el.getProps(["x", "y", "base"]);
          bars.push({ x: p.x - half, y: Math.min(p.y, p.base), w: half * 2, h: Math.abs(p.base - p.y) });
        });
        return { cw, ch, axisBand, axisBandWide, chips, bars, leaders: (chart.$bsLeaders || []).length,
                 noteRect: chart.$bsNoteRect || null, noteText: (chart.$bsNote || {}).text || null };
      });
      if (!r) { check(`${t}@${width}: chart 取得`, false); continue; }
      const clip = r.chips.every((c) => c.x >= 0 && c.y >= 0 && c.x + c.w <= r.cw && c.y + c.h <= r.ch);
      check(`${t}@${width}: チップのcanvas外クリップ 0（${r.chips.length}枚）`, clip);
      let overlap = false, axisHit = false, barHit = false;
      for (let i = 0; i < r.chips.length; i++) {
        if (X(r.chips[i], r.axisBand)) axisHit = true;
        for (let j = i + 1; j < r.chips.length; j++) if (X(r.chips[i], r.chips[j])) overlap = true;
        for (const b of r.bars) if (X(r.chips[i], b)) barHit = true;
      }
      check(`${t}@${width}: チップ相互重なり 0`, !overlap);
      check(`${t}@${width}: チップ×y軸目盛帯の重なり 0`, !axisHit);
      check(`${t}@${width}: チップ×バー矩形の交差 0`, !barHit);
      // spec §11.3: P6 債務超過注記（実DB該当は MCD/SBUX の FY2023-2025 のみ・全 USD 億ドル層）
      const NEG = ["MCD", "SBUX"];
      if (NEG.includes(t)) {
        check(`${t}@${width}: 注記 $bsNoteRect 非null`, !!r.noteRect);
        if (r.noteRect) {
          const nr = r.noteRect;
          check(`${t}@${width}: 注記のcanvas外クリップ 0`, nr.x >= 0 && nr.y >= 0 && nr.x + nr.w <= r.cw && nr.y + nr.h <= r.ch);
          check(`${t}@${width}: 注記×低棒チップ 交差0`, r.chips.every((c) => !X(nr, c)));
          check(`${t}@${width}: 注記×バー矩形 交差0`, r.bars.every((b) => !X(nr, b)));
          check(`${t}@${width}: 注記×y軸帯(拡張) 交差0`, !X(nr, r.axisBandWide));
        }
        check(`${t}@${width}: 注記文言が単位整合（億ドル層）`, /^純資産 ▲\d+(\.\d+)?億ドル（債務超過）$/.test(r.noteText || ""));
      } else {
        check(`${t}@${width}: 非債務超過は注記なし（$bsNoteRect null）`, r.noteRect === null);
      }
    }
    // ETF: bsChart 不描画
    await page.evaluate(() => navigateToDetail("SPY"));
    await page.waitForTimeout(800);
    check(`SPY@${width}: BSカード非表示（ETF非影響）`, await page.evaluate(() => getComputedStyle(document.getElementById("bs-title").closest(".card")).display === "none"));
    check(`pageerror 0 @${width}`, errors.length === 0);
    await page.close();
  }
  // モバイル: 低棒ラベル自体が非表示＝新分岐不到達（padding モバイル arm 不変）
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } });
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  const mobRead = async (t) => {
    await page.evaluate((tk) => navigateToDetail(tk), t);
    await page.waitForTimeout(2000);
    return page.evaluate(() => {
      const el = document.getElementById("bs-mobile-note");
      const chart = Chart.getChart(document.getElementById("bsChart"));
      return {
        exists: !!el,
        hidden: el ? el.hidden : null,
        text: el ? el.textContent : null,
        padLeft: chart ? chart.options.layout.padding.left : null,
        noteRect: chart ? (chart.$bsNoteRect || null) : null,
      };
    });
  };
  const m6758 = await mobRead("6758.T");
  check("モバイル: padding arm 不変（left=4）", m6758.padLeft === 4);
  check("モバイル: #bs-mobile-note が存在", m6758.exists === true);
  // spec §11.2: 8306.T は純資産 5.3%（<15%）＝モバイルで datalabels が出ない唯一情報を DOM で補完
  const m8306 = await mobRead("8306.T");
  check("モバイル 8306.T: サマリ表示", m8306.hidden === false);
  check("モバイル 8306.T: 文言（純資産 21.7兆円 (5.3%)）", /純資産 21\.7兆円 \(5\.3%\)/.test(m8306.text || ""));
  // MCD: 債務超過行が先頭・canvas 注記はモバイル非発火
  const mMcd = await mobRead("MCD");
  check("モバイル MCD: サマリに債務超過行", /^純資産 ▲\d+(\.\d+)?億ドル（債務超過）/.test(mMcd.text || ""));
  check("モバイル MCD: canvas 注記は非発火（$bsNoteRect null）", mMcd.noteRect === null);
  // 7203.T: 最小セグメント 29.2%＝全て >=15% ゆえサマリ不要
  const m7203 = await mobRead("7203.T");
  check("モバイル 7203.T: サマリ hidden（全セグメント>=15%）", m7203.hidden === true);
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
