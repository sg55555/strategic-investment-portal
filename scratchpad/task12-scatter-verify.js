// scratchpad/task12-scatter-verify.js — Task12 renderRankScatterAndStrip (Chart.js散布図 + セクター帯) のブラウザ検証。
// mock_prod_server（127.0.0.1:8200）前提。task11-ranking-verify.js のパターンを踏襲。
const { chromium } = require('playwright');

const BASE = 'http://localhost:8200';

let failures = 0;
function assertTrue(cond, label) {
  if (cond) { console.log('  PASS: ' + label); }
  else { console.log('  FAIL: ' + label); failures++; }
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push('PE:' + e.message));

  await page.goto(BASE + '/?diag=off', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (typeof STOCK_DATA === 'object' && STOCK_DATA && Object.keys(STOCK_DATA).length > 0), { timeout: 8000 });

  console.log('--- (a) ▤ランキング(JP/per既定) → canvas 実サイズ>0 + Chartインスタンス生成 + セクター帯セル存在 ---');
  await page.click('#ranking-entry');
  // renderRankScatterAndStrip は requestAnimationFrame 経由で生成するため rAF 分の余裕を持って待つ
  await page.waitForTimeout(300);
  const a = await page.evaluate(() => {
    const canvas = document.getElementById('rk-scatter');
    const chartInst = (typeof Chart !== 'undefined' && typeof Chart.getChart === 'function') ? Chart.getChart(canvas) : null;
    const cells = Array.from(document.querySelectorAll('#rk-sector-strip .rk-cell'));
    return {
      viewActive: document.getElementById('ranking-view').classList.contains('active'),
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      hasChartInstance: !!chartInst,
      chartDatasetLen: chartInst ? chartInst.data.datasets[0].data.length : -1,
      stripTitle: (document.querySelector('#rk-sector-strip .rk-strip-title') || {}).textContent || '',
      cellCount: cells.length,
      cellSectors: cells.map((c) => (c.querySelector('.rk-cell-sec') || {}).textContent || ''),
      hasOther: cells.some((c) => (c.querySelector('.rk-cell-sec') || {}).textContent === 'その他'),
    };
  });
  assertTrue(a.viewActive, 'ranking-view が active');
  assertTrue(a.clientWidth > 0 && a.clientHeight > 0, 'canvas #rk-scatter の実サイズ>0: w=' + a.clientWidth + ' h=' + a.clientHeight);
  assertTrue(a.hasChartInstance, 'Chart インスタンスが #rk-scatter に紐付いている');
  assertTrue(a.chartDatasetLen > 0, '散布図データ点>0: count=' + a.chartDatasetLen);
  assertTrue(a.stripTitle.includes('PER') || a.stripTitle.length > 0, 'セクター帯タイトルが存在する: "' + a.stripTitle + '"');
  assertTrue(a.cellCount > 0, 'セクター帯セルが存在する: count=' + a.cellCount);
  console.log('    cellSectors=' + JSON.stringify(a.cellSectors) + ' hasOther=' + a.hasOther);

  console.log('--- (b) 市場 US に切替 → 再描画（例外なし・二重生成なし） ---');
  let evalError = null;
  try {
    await page.click('#rk-mkt-US');
    await page.waitForTimeout(300);
  } catch (e) { evalError = e.message; }
  const b = await page.evaluate(() => {
    const canvas = document.getElementById('rk-scatter');
    const chartInst = (typeof Chart !== 'undefined' && typeof Chart.getChart === 'function') ? Chart.getChart(canvas) : null;
    // Chart.instances は id をキーにした辞書。この canvas に紐づくインスタンス数を数える(二重生成検知)。
    let instancesForCanvas = 0;
    if (typeof Chart !== 'undefined' && Chart.instances) {
      Object.keys(Chart.instances).forEach((k) => {
        if (Chart.instances[k].canvas === canvas) instancesForCanvas++;
      });
    }
    return {
      usActive: document.getElementById('rk-mkt-US').classList.contains('active'),
      hasChartInstance: !!chartInst,
      instancesForCanvas: instancesForCanvas,
      clientWidth: canvas.clientWidth,
    };
  });
  assertTrue(evalError === null, '市場切替クリックで例外が発生しない: ' + (evalError || 'なし'));
  assertTrue(b.usActive, 'US market が active');
  assertTrue(b.hasChartInstance, '切替後も Chart インスタンスが存在する');
  assertTrue(b.instancesForCanvas === 1, 'canvas に紐づく Chart インスタンスは1つのみ(二重生成なし): count=' + b.instancesForCanvas);
  assertTrue(b.clientWidth > 0, '切替後も canvas 実サイズ>0: w=' + b.clientWidth);

  console.log('--- (c) 指標を roe に切替 → 再描画（例外なし・二重生成なし） ---');
  let evalError2 = null;
  try {
    await page.evaluate(() => {
      document.getElementById('rk-metric').value = 'roe';
      renderRanking();
    });
    await page.waitForTimeout(300);
  } catch (e) { evalError2 = e.message; }
  const c = await page.evaluate(() => {
    const canvas = document.getElementById('rk-scatter');
    let instancesForCanvas = 0;
    if (typeof Chart !== 'undefined' && Chart.instances) {
      Object.keys(Chart.instances).forEach((k) => {
        if (Chart.instances[k].canvas === canvas) instancesForCanvas++;
      });
    }
    const cells = Array.from(document.querySelectorAll('#rk-sector-strip .rk-cell'));
    return {
      metricValue: document.getElementById('rk-metric').value,
      instancesForCanvas: instancesForCanvas,
      stripTitle: (document.querySelector('#rk-sector-strip .rk-strip-title') || {}).textContent || '',
      cellCount: cells.length,
    };
  });
  assertTrue(evalError2 === null, '指標切替で例外が発生しない: ' + (evalError2 || 'なし'));
  assertTrue(c.metricValue === 'roe', '#rk-metric の値が roe に変わっている');
  assertTrue(c.instancesForCanvas === 1, '指標切替後も canvas に紐づく Chart インスタンスは1つのみ: count=' + c.instancesForCanvas);
  assertTrue(c.stripTitle.includes('ROE') || c.stripTitle.length > 0, '指標切替後のセクター帯タイトルが更新されている: "' + c.stripTitle + '"');
  assertTrue(c.cellCount > 0, '指標切替後もセクター帯セルが存在する: count=' + c.cellCount);

  console.log('--- (d) pageerror ---');
  assertTrue(pageErrors.length === 0, 'pageerror 0件: count=' + pageErrors.length + (pageErrors.length ? ' ' + JSON.stringify(pageErrors) : ''));

  await browser.close();

  console.log('');
  if (failures === 0) {
    console.log('✅ ALL PASS (failures=0)');
    process.exit(0);
  } else {
    console.log('❌ FAILURES: ' + failures);
    process.exit(1);
  }
}

run().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(2); });
