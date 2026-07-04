// scratchpad/task11-ranking-verify.js — Task11 renderRanking + setRankMarket のブラウザ検証。
// mock_prod_server（127.0.0.1:8200）前提。task7/task9 の navigateToDetail 呼出パターンを踏襲。
const { chromium } = require('playwright');

const BASE = 'http://localhost:8200';

// no-score/中立語(brief 指定の禁止語彙)。
const BANNED_WORDS = ['買い', '売り', '推奨', '上がる', '下がる'];

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

  console.log('--- (a) ▤ランキング → ranking-view active + 表描画（JP既定, 行数>0） ---');
  await page.click('#ranking-entry');
  await page.waitForTimeout(200);
  const a = await page.evaluate(() => {
    const view = document.getElementById('ranking-view');
    const rows = Array.from(document.querySelectorAll('#rk-table .rk-tbl tbody tr'));
    return {
      viewActive: view.classList.contains('active'),
      jpActive: document.getElementById('rk-mkt-JP').classList.contains('active'),
      usActive: document.getElementById('rk-mkt-US').classList.contains('active'),
      rowCount: rows.length,
      tickers: rows.map((r) => r.getAttribute('data-ticker')),
      metricOptions: document.getElementById('rk-metric').options.length,
      metricValue: document.getElementById('rk-metric').value,
      disclaimerLen: (document.getElementById('rk-disclaimer').textContent || '').length,
    };
  });
  assertTrue(a.viewActive, 'ranking-view が active');
  assertTrue(a.jpActive === true && a.usActive === false, '既定は JP がactive、US は非active');
  assertTrue(a.rowCount > 0, '表の行数>0: count=' + a.rowCount);
  assertTrue(a.metricOptions > 1, '#rk-metric に複数optionが登録されている: count=' + a.metricOptions);
  assertTrue(a.metricValue === 'per', '#rk-metric 既定値は per: value=' + a.metricValue);
  assertTrue(a.disclaimerLen > 0, '免責文言(#rk-disclaimer)が存在する');
  const jpTickersPer = a.tickers;

  console.log('--- (b) 市場 US に切替 → active切替 + 行(銘柄集合)が変化 ---');
  await page.click('#rk-mkt-US');
  await page.waitForTimeout(200);
  const b = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#rk-table .rk-tbl tbody tr'));
    return {
      jpActive: document.getElementById('rk-mkt-JP').classList.contains('active'),
      usActive: document.getElementById('rk-mkt-US').classList.contains('active'),
      rowCount: rows.length,
      tickers: rows.map((r) => r.getAttribute('data-ticker')),
    };
  });
  assertTrue(b.jpActive === false && b.usActive === true, 'US切替後: JP非active/US active');
  assertTrue(b.rowCount > 0, 'US表の行数>0: count=' + b.rowCount);
  assertTrue(JSON.stringify(b.tickers) !== JSON.stringify(jpTickersPer), 'US切替で銘柄集合がJPと異なる');
  assertTrue(b.tickers.every((t) => !/\.T$/.test(t)), 'US表の銘柄は.T(日本株)を含まない');

  console.log('--- (c) 指標を roe に切替(同一市場=US内) → 並び順(先頭ticker)が変化 ---');
  const usTopPer = b.tickers[0];
  await page.evaluate(() => {
    document.getElementById('rk-metric').value = 'roe';
    renderRanking();
  });
  await page.waitForTimeout(200);
  const c = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#rk-table .rk-tbl tbody tr'));
    return { metricValue: document.getElementById('rk-metric').value, tickers: rows.map((r) => r.getAttribute('data-ticker')), rowCount: rows.length };
  });
  assertTrue(c.metricValue === 'roe', '#rk-metric の値が roe に変わっている');
  assertTrue(c.rowCount > 0, 'roe切替後も行数>0: count=' + c.rowCount);
  assertTrue(c.tickers[0] !== usTopPer, '指標切替で並び順(先頭ticker)が変化: per先頭=' + usTopPer + ' roe先頭=' + c.tickers[0]);

  console.log('--- (d) 行クリック → 詳細ページへ遷移(currentTicker設定 / detail-view active) ---');
  // security fix: 行は data-ticker 属性(HTML-escaped)を持つのみ・ナビゲーションは
  // #rk-table への委譲リスナー(host.onclick)経由。inline onclick は行に存在しない。
  const expectedTicker = c.tickers[0];
  const noInlineOnclick = await page.evaluate(() => {
    const html = document.getElementById('rk-table').innerHTML;
    return !/onclick\s*=/.test(html);
  });
  assertTrue(noInlineOnclick, '#rk-table 内に inline onclick 属性が存在しない(委譲リスナーのみ)');
  await page.click('#rk-table .rk-tbl tbody tr:first-child');
  await page.waitForTimeout(1200); // navigateToDetail は setTimeout(150ms)経由 + チャート描画
  const d = await page.evaluate(() => ({
    currentTicker: (typeof currentTicker !== 'undefined') ? currentTicker : null,
    detailActive: document.getElementById('detail-view').classList.contains('active'),
    rankingActive: document.getElementById('ranking-view').classList.contains('active'),
  }));
  assertTrue(d.currentTicker === expectedTicker, 'currentTicker が行の銘柄に一致: expected=' + expectedTicker + ' actual=' + d.currentTicker);
  assertTrue(d.detailActive === true, 'detail-view が active');
  assertTrue(d.rankingActive === false, 'ranking-view は非active(遷移後)');

  console.log('--- (e) 禁止語彙(no-score/中立語)チェック: ranking-view 内(表+見出し)テキスト ---');
  // #ranking-entry は portal-view 内にあり detail-view からは不可視 → navigateToRanking() を直接呼ぶ。
  await page.evaluate(() => { navigateToRanking(); });
  await page.waitForTimeout(200);
  const rankingText = await page.evaluate(() => {
    const view = document.getElementById('ranking-view');
    const disc = document.getElementById('rk-disclaimer');
    // 免責文言(panel-disclaimer)は ANALYSIS_DISCLAIMER 共有の固定文で「推奨」を否定形で含むため
    // task7/task9 と同様に禁止語チェックのスコープから除外(descriptor/表本体のみ対象)。
    let text = view.textContent || '';
    if (disc) text = text.replace(disc.textContent || '', '');
    return text;
  });
  const bannedHit = BANNED_WORDS.filter((w) => rankingText.includes(w));
  assertTrue(bannedHit.length === 0, '禁止語彙が0件: hit=' + JSON.stringify(bannedHit));

  console.log('--- (f) pageerror ---');
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
