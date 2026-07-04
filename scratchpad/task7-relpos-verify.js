// scratchpad/task7-relpos-verify.js — Task7 renderRelativePosition のブラウザ検証。
// mock_prod_server（127.0.0.1:8200）前提。detail-snapshot.js のロード待ち/navigateToDetail 呼出パターンを踏襲。
const { chromium } = require('playwright');

const BASE = 'http://localhost:8200';
const EQUITY_TICKER = '7203.T'; // stock/JP
const ETF_TICKER = '1321.T';    // etf/JP

// no-score/中立語(brief 指定の禁止語彙)。
const BANNED_WORDS = ['買い', '売り', '推奨', '上がる', '下がる', '割安なので'];

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

  console.log('--- (a) equity(' + EQUITY_TICKER + '): #relative-position-card 可視 + 内容 ---');
  await openDetail(page, EQUITY_TICKER);
  const eq = await page.evaluate(() => {
    const card = document.getElementById('relative-position-card');
    if (!card) return null;
    const cs = getComputedStyle(card);
    return {
      display: cs.display,
      rowCount: card.querySelectorAll('.relpos-row').length,
      termHelpCount: card.querySelectorAll('.term-help').length,
      titleHasTerm: card.querySelector('.card-title')?.getAttribute('data-term'),
      // 禁止語彙チェックは記述部(タイトル+グループ)のみが対象。免責文言(panel-disclaimer)は
      // ANALYSIS_DISCLAIMER 共有の固定文で「売買推奨…ではありません」という否定形で「推奨」を含む
      // (renderSignalDigest 等も同一文言を共有・cross-section-rules.test.js の禁止語チェックも
      //  descriptor 出力のみが対象で disclaimer は対象外＝同じスコープに揃える)。
      descriptorText: (card.querySelector('.card-title')?.textContent || '') +
        Array.from(card.querySelectorAll('.relpos-group')).map((g) => g.textContent).join(''),
      disclaimerHtml: card.querySelector('.panel-disclaimer')?.textContent || '',
    };
  });
  assertTrue(!!eq, '#relative-position-card が存在する');
  if (eq) {
    assertTrue(eq.display !== 'none', 'display は none でない（可視）: display=' + eq.display);
    assertTrue(eq.rowCount > 1, '.relpos-row が複数存在する: count=' + eq.rowCount);
    assertTrue(eq.termHelpCount > 0, '「?」(.term-help) が1個以上注入されている: count=' + eq.termHelpCount);
    assertTrue(eq.titleHasTerm === '同市場比較', 'カードタイトルの data-term="同市場比較"');
    assertTrue(eq.disclaimerHtml.length > 0, '免責文言(panel-disclaimer)が存在する');
    const bannedHit = BANNED_WORDS.filter((w) => eq.descriptorText.includes(w));
    assertTrue(bannedHit.length === 0, '禁止語彙(記述部)が0件: hit=' + JSON.stringify(bannedHit));
  }

  console.log('--- (b) ETF(' + ETF_TICKER + '): #relative-position-card は display:none ---');
  await openDetail(page, ETF_TICKER);
  const etf = await page.evaluate(() => {
    const card = document.getElementById('relative-position-card');
    if (!card) return null;
    return { display: getComputedStyle(card).display };
  });
  assertTrue(!!etf, 'ETF詳細でも #relative-position-card は存在する（要素自体は残る）');
  if (etf) assertTrue(etf.display === 'none', 'ETF詳細で display:none: display=' + etf.display);

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
