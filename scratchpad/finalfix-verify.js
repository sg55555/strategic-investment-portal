// scratchpad/finalfix-verify.js — 束B 最終レビュー修正の的を絞った検証（mock_prod_server :8200 前提）。
// FIX1(相対カード: 単一中立色マーカー / パーセンタイル追従・中央値50%),
// FIX6(散布図 datalabels 無効), FIX7(セクター帯 時価総額の桁整形), FIX8(比較表 時価総額 二重通貨なし)。
const { chromium } = require('playwright');
const BASE = 'http://localhost:8200';
const EQUITY = '7203.T';

let failures = 0;
function ok(cond, label) { console.log((cond ? '  PASS: ' : '  FAIL: ') + label); if (!cond) failures++; }

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push('PE:' + e.message));
  await page.goto(BASE + '/?diag=off', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (typeof STOCK_DATA === 'object' && STOCK_DATA && Object.keys(STOCK_DATA).length > 0), { timeout: 8000 });

  // ── FIX1: 相対カード ──────────────────────────────────────
  console.log('--- FIX1: 相対ポジションカード（単一中立色 / パーセンタイル追従 / 中央値50%） ---');
  await page.evaluate((t) => navigateToDetail(t), EQUITY);
  await page.waitForTimeout(1200);
  const rp = await page.evaluate(() => {
    const card = document.getElementById('relative-position-card');
    const markers = Array.from(card.querySelectorAll('.relpos-marker'));
    const medians = Array.from(card.querySelectorAll('.relpos-median'));
    // 各マーカーの class 一覧（tone-* が無いこと）と、色（getComputedStyle background-color）
    const markerClasses = markers.map((m) => m.className);
    const markerColors = Array.from(new Set(markers.map((m) => getComputedStyle(m).backgroundColor)));
    const medianLefts = Array.from(new Set(medians.map((m) => m.style.left)));
    // 各行: マーカー left(%) と caption のパーセンタイル値を突き合わせる
    const rows = Array.from(card.querySelectorAll('.relpos-row')).map((row) => {
      const mk = row.querySelector('.relpos-marker');
      const cap = row.querySelector('.relpos-cap');
      const left = mk ? parseFloat(mk.style.left) : null;
      let capP = null;
      if (cap) { const mt = (cap.textContent || '').match(/(\d+)\s*パーセンタイル/); if (mt) capP = parseInt(mt[1], 10); }
      return { left, capP };
    }).filter((r) => r.left != null && r.capP != null);
    return { markerCount: markers.length, markerClasses, markerColors, medianLefts, rows };
  });
  ok(rp.markerCount > 1, 'マーカーが複数存在: count=' + rp.markerCount);
  ok(rp.markerClasses.every((c) => c.trim() === 'relpos-marker'), 'FIX4: 全マーカー class が "relpos-marker" のみ（tone-high/tone-low なし）: ' + JSON.stringify(rp.markerClasses.slice(0, 3)));
  ok(rp.markerColors.length === 1, 'FIX4: マーカー色は単一の中立色（色バリエーション=1）: colors=' + JSON.stringify(rp.markerColors));
  ok(rp.medianLefts.length === 1 && rp.medianLefts[0] === '50%', 'FIX3: 中央値ティックは常に left:50%: ' + JSON.stringify(rp.medianLefts));
  const maxDelta = rp.rows.reduce((mx, r) => Math.max(mx, Math.abs(r.left - r.capP)), 0);
  ok(rp.rows.length > 0 && maxDelta < 1.5, 'FIX3: マーカー left(%) がキャプションのパーセンタイルに追従（max|Δ|<1.5）: rows=' + rp.rows.length + ' maxΔ=' + maxDelta.toFixed(2));

  // ── FIX8: 比較表 時価総額 二重通貨なし ──────────────────────
  console.log('--- FIX8: 比較テーブル 時価総額セルに末尾 ¥/$ が無い ---');
  await page.evaluate(() => { openCompareModal(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { setCompareTab('table'); });
  await page.waitForTimeout(200);
  const cmp = await page.evaluate(() => {
    const table = document.getElementById('compare-table-container');
    const rows = Array.from(table.querySelectorAll('.cmp-table tbody tr'));
    const tds = Array.from(rows[0].querySelectorAll('td'));
    const mcText = (tds[8].textContent || '').trim();
    return { mcText, hasCurSpan: !!tds[8].querySelector('.cmp-cur') };
  });
  ok(!/[¥$]\s*$/.test(cmp.mcText), 'FIX8: 時価総額セル末尾が ¥/$ で終わらない: text="' + cmp.mcText + '"');
  ok(!cmp.hasCurSpan, 'FIX8: 時価総額セルに .cmp-cur span を追記していない');
  ok(/兆|十億|百万|億|円|ドル/.test(cmp.mcText), 'FIX8: 時価総額セルは桁+通貨の単位を含む（fmtMagnitude 由来）: text="' + cmp.mcText + '"');
  await page.evaluate(() => { if (typeof closeModal === 'function') closeModal('compare-modal'); });
  await page.waitForTimeout(120);

  // ── FIX6/FIX7: ランキング（指標=時価総額）散布図 datalabels無効 / セクター帯 桁整形 ──
  console.log('--- FIX6/FIX7: ランキング（指標=marketCap）散布図 datalabels無効 / セクター帯 桁整形 ---');
  await page.evaluate(() => { navigateToRanking(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.getElementById('rk-metric').value = 'marketCap'; renderRanking(); });
  await page.waitForTimeout(400);
  const rk = await page.evaluate(() => {
    const canvas = document.getElementById('rk-scatter');
    const inst = (typeof Chart !== 'undefined' && Chart.getChart) ? Chart.getChart(canvas) : null;
    const dl = inst && inst.options && inst.options.plugins ? inst.options.plugins.datalabels : undefined;
    const cells = Array.from(document.querySelectorAll('#rk-sector-strip .rk-cell'));
    const medTexts = cells.map((c) => (c.querySelector('.rk-cell-med')?.textContent || '').trim());
    // 生の10桁以上整数（単位なし）が無いこと
    const bareBigInt = medTexts.filter((t) => /^\d{10,}$/.test(t));
    const withUnit = medTexts.filter((t) => /兆|十億|百万|億|円|ドル/.test(t));
    return { hasInst: !!inst, dlDisplay: dl ? dl.display : undefined, medSample: medTexts.slice(0, 4), bareBigInt, withUnitCount: withUnit.length, cellCount: cells.length };
  });
  ok(rk.hasInst, 'FIX6: 散布図 Chart インスタンスが存在');
  ok(rk.dlDisplay === false, 'FIX6: scatter options.plugins.datalabels.display === false: got=' + JSON.stringify(rk.dlDisplay));
  ok(rk.bareBigInt.length === 0, 'FIX7: セクター帯に生の10桁以上整数が無い: bad=' + JSON.stringify(rk.bareBigInt));
  ok(rk.cellCount > 0 && rk.withUnitCount === rk.cellCount, 'FIX7: 全セクター帯セルが桁+通貨単位を含む（' + rk.withUnitCount + '/' + rk.cellCount + '）: sample=' + JSON.stringify(rk.medSample));

  console.log('--- pageerror ---');
  ok(pageErrors.length === 0, 'pageerror 0件: count=' + pageErrors.length + (pageErrors.length ? ' ' + JSON.stringify(pageErrors) : ''));

  await browser.close();
  console.log('');
  if (failures === 0) { console.log('✅ FINALFIX ALL PASS'); process.exit(0); }
  else { console.log('❌ FINALFIX FAILURES: ' + failures); process.exit(1); }
}
run().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
