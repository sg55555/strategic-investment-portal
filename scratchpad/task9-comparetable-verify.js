// scratchpad/task9-comparetable-verify.js — Task9 renderCompareTable + setCompareTab のブラウザ検証。
// mock_prod_server（127.0.0.1:8200）前提。task7-relpos-verify.js のロード待ち/navigateToDetail 呼出パターンを踏襲。
const { chromium } = require('playwright');

const BASE = 'http://localhost:8200';
const EQUITY_TICKER = '7203.T'; // stock/JP
const ETF_TICKER = '1321.T';    // etf/JP

let failures = 0;
function assertTrue(cond, label) {
  if (cond) { console.log('  PASS: ' + label); }
  else { console.log('  FAIL: ' + label); failures++; }
}

async function openDetail(page, ticker) {
  await page.waitForFunction(() => (typeof STOCK_DATA === 'object' && STOCK_DATA && Object.keys(STOCK_DATA).length > 0), { timeout: 8000 });
  await page.evaluate((t) => { navigateToDetail(t); }, ticker);
  await page.waitForTimeout(1200); // updateFinancialViews は setTimeout(150ms) 経由 + チャート描画
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push('PE:' + e.message));

  await page.goto(BASE + '/?diag=off', { waitUntil: 'networkidle' });

  console.log('--- (a) equity(' + EQUITY_TICKER + '): 比較モーダル開く → 指標比較タブ → テーブル可視/ヘッダ8列/行数=compareSet ---');
  await openDetail(page, EQUITY_TICKER);
  await page.evaluate(() => { openCompareModal(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { setCompareTab('table'); });
  await page.waitForTimeout(200);
  const a = await page.evaluate(() => {
    const chart = document.getElementById('compare-chart-container');
    const table = document.getElementById('compare-table-container');
    const bChart = document.getElementById('compare-tab-chart');
    const bTable = document.getElementById('compare-tab-table');
    return {
      tableDisplay: getComputedStyle(table).display,
      chartDisplay: getComputedStyle(chart).display,
      headCount: table.querySelectorAll('.cmp-table thead th').length,
      rowCount: table.querySelectorAll('.cmp-table tbody tr').length,
      bChartActive: bChart.classList.contains('active'),
      bTableActive: bTable.classList.contains('active'),
      termHelpCount: table.querySelectorAll('.term-help').length,
      disclaimerLen: (table.querySelector('.panel-disclaimer')?.textContent || '').length,
    };
  });
  assertTrue(a.tableDisplay !== 'none', 'テーブル可視: display=' + a.tableDisplay);
  assertTrue(a.chartDisplay === 'none', 'チャートは非表示: display=' + a.chartDisplay);
  // ヘッダは「銘柄」+8指標列 = 9。指標列数として8を検証。
  assertTrue(a.headCount === 9, 'ヘッダ列数=9（銘柄+8指標）: count=' + a.headCount);
  assertTrue(a.rowCount === 1, '行数=compareSetサイズ(初期=自分自身のみ=1): count=' + a.rowCount);
  assertTrue(a.bChartActive === false && a.bTableActive === true, 'タブactive切替: chart=' + a.bChartActive + ' table=' + a.bTableActive);
  assertTrue(a.termHelpCount > 0, '「?」(.term-help)がヘッダ列に注入されている: count=' + a.termHelpCount);
  assertTrue(a.disclaimerLen > 0, '免責文言(panel-disclaimer)が存在する');

  console.log('--- (b) ETF(' + ETF_TICKER + ')を比較に追加 → 比率セルはN/A、時価総額は値あり ---');
  await page.evaluate((t) => { addToCompare(t); }, ETF_TICKER);
  await page.waitForTimeout(200);
  const b = await page.evaluate((etfTicker) => {
    const table = document.getElementById('compare-table-container');
    const rows = Array.from(table.querySelectorAll('.cmp-table tbody tr'));
    // ETF行を name に "ETF" バッジが付いている行として特定
    const etfRow = rows.find((r) => r.querySelector('.cmp-etf'));
    if (!etfRow) return { found: false };
    const tds = Array.from(etfRow.querySelectorAll('td'));
    // tds[0]=銘柄名, [1]=PER,[2]=PBR,[3]=ROE,[4]=純利益率,[5]=営業利益率,[6]=自己資本比率,[7]=流動比率,[8]=時価総額
    return {
      found: true,
      rowCount: rows.length,
      perNA: tds[1].classList.contains('na') && tds[1].textContent.includes('—'),
      pbrNA: tds[2].classList.contains('na') && tds[2].textContent.includes('—'),
      marketCapNotNA: !tds[8].classList.contains('na'),
      marketCapText: tds[8].textContent,
    };
  }, ETF_TICKER);
  assertTrue(b.found, 'ETF行が特定できる(.cmp-etf バッジ)');
  if (b.found) {
    assertTrue(b.rowCount === 2, '行数=2(自分+ETF): count=' + b.rowCount);
    assertTrue(b.perNA, 'ETF行の PER セルは missing(na, —)');
    assertTrue(b.pbrNA, 'ETF行の PBR セルは missing(na, —)');
    assertTrue(b.marketCapNotNA, 'ETF行の 時価総額 セルは missing でない(値あり): text=' + b.marketCapText);
  }

  console.log('--- (d) タブ往復（table→chart→table）で二重描画/例外なし ---');
  await page.evaluate(() => { setCompareTab('chart'); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { setCompareTab('table'); });
  await page.waitForTimeout(150);
  const d = await page.evaluate(() => {
    const table = document.getElementById('compare-table-container');
    return {
      tableCount: table.querySelectorAll('.cmp-table').length,
      rowCount: table.querySelectorAll('.cmp-table tbody tr').length,
      display: getComputedStyle(table).display,
    };
  });
  assertTrue(d.tableCount === 1, '往復後もテーブルは1個のみ(二重描画なし): count=' + d.tableCount);
  assertTrue(d.rowCount === 2, '往復後も行数=2のまま: count=' + d.rowCount);
  assertTrue(d.display !== 'none', '往復後もテーブル可視: display=' + d.display);

  console.log('--- (e) pageerror ---');
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
