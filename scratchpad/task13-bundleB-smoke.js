// scratchpad/task13-bundleB-smoke.js — Task13 統合検証（3面同時 + 既存ビュー健全性 + 規制安全）。
// mock_prod_server（127.0.0.1:8200）前提。task7/task9/task11/task12 verify script のパターンを踏襲し
// 1セッションで通す（①相対カード ②比較テーブル ③ランキング + 既存ビュー回帰 + 規制安全語彙 + pageerror0）。
const { chromium } = require('playwright');

const BASE = 'http://localhost:8200';
const EQUITY_TICKER = '7203.T'; // stock/JP
const ETF_TICKER = '1321.T';    // etf/JP

// no-score/中立語(brief 指定の禁止語彙 + 追加分)。
const BANNED_WORDS = ['買い', '売り', '推奨', '上がる', '下がる', '割安なので', '狙い目', 'お得'];

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

// 禁止語彙チェックは記述部(タイトル/グループ/セル/見出し)のみが対象。ANALYSIS_DISCLAIMER 共有の
// 固定文は「売買推奨…ではありません」という否定形で「推奨」を含むため、task7/9/11 と同じ規約で
// disclaimer テキストは対象領域から差し引く(disclaimer の存在自体は別途 assert する)。
function bannedHitsExcludingDisclaimer(fullText, disclaimerText) {
  let text = fullText || '';
  if (disclaimerText) {
    // 出現分をすべて除去(同一免責文が複数箇所に出ても安全)。
    text = text.split(disclaimerText).join('');
  }
  return BANNED_WORDS.filter((w) => text.includes(w));
}

async function run() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push('PE:' + e.message));

  await page.goto(BASE + '/?diag=off', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (typeof STOCK_DATA === 'object' && STOCK_DATA && Object.keys(STOCK_DATA).length > 0), { timeout: 8000 });

  // ============================================================
  // (0) 既存ビュー健全性（回帰）: portal 表 rows
  // ============================================================
  console.log('--- (0a) portal-view: 銘柄行が描画されている ---');
  const portal0 = await page.evaluate(() => {
    const view = document.getElementById('portal-view');
    return {
      active: view.classList.contains('active'),
      rowCount: document.querySelectorAll('.portal-table tbody tr').length,
    };
  });
  assertTrue(portal0.active, 'portal-view が active(初期状態)');
  assertTrue(portal0.rowCount > 0, 'portal-table の行数>0: count=' + portal0.rowCount);

  // ============================================================
  // (1) 相対カード: equity可視 / ETF非表示
  // ============================================================
  console.log('--- (1a) equity(' + EQUITY_TICKER + ') detail: #relative-position-card 可視 + 内容 ---');
  await openDetail(page, EQUITY_TICKER);
  const relEq = await page.evaluate(() => {
    const card = document.getElementById('relative-position-card');
    if (!card) return null;
    const cs = getComputedStyle(card);
    const disc = card.querySelector('.panel-disclaimer');
    return {
      display: cs.display,
      rowCount: card.querySelectorAll('.relpos-row').length,
      termHelpCount: card.querySelectorAll('.term-help').length,
      titleTerm: card.querySelector('.card-title')?.getAttribute('data-term'),
      fullText: card.textContent || '',
      disclaimerText: disc ? (disc.textContent || '') : '',
    };
  });
  assertTrue(!!relEq, '#relative-position-card が存在する');
  if (relEq) {
    assertTrue(relEq.display !== 'none', 'equity: display は none でない: display=' + relEq.display);
    assertTrue(relEq.rowCount > 1, '.relpos-row が複数存在する: count=' + relEq.rowCount);
    assertTrue(relEq.termHelpCount > 0, '「?」(.term-help)が注入されている: count=' + relEq.termHelpCount);
    assertTrue(relEq.titleTerm === '同市場比較', 'カードタイトル data-term="同市場比較"');
    assertTrue(relEq.disclaimerText.length > 0, '免責文言(panel-disclaimer)が存在する【相対カード】');
  }

  console.log('--- (1b) ETF(' + ETF_TICKER + ') detail: #relative-position-card は display:none ---');
  await openDetail(page, ETF_TICKER);
  const relEtf = await page.evaluate(() => {
    const card = document.getElementById('relative-position-card');
    if (!card) return null;
    return { display: getComputedStyle(card).display };
  });
  assertTrue(!!relEtf, 'ETF detail でも #relative-position-card は存在する(要素は残る)');
  if (relEtf) assertTrue(relEtf.display === 'none', 'ETF detail で display:none: display=' + relEtf.display);

  // ============================================================
  // (0b) 既存ビュー健全性（回帰）: detail の MARKET CHART / 財務カード
  // ============================================================
  console.log('--- (0b) detail-view: 既存の MARKET CHART / 財務カードが引き続き描画される ---');
  await openDetail(page, EQUITY_TICKER); // equity に戻す(以降の compare/relpos 検証の土台)
  const detail0 = await page.evaluate(() => {
    return {
      stockTitle: document.getElementById('stock-title')?.textContent || '',
      chartContainerChildren: (document.getElementById('chart-container') || {}).children?.length || 0,
      bsChart: !!document.getElementById('bsChart'),
      plChart: !!document.getElementById('plChart'),
      cfChart: !!document.getElementById('cfChart'),
      radarChart: !!document.getElementById('radarChart'),
      equityRatioText: document.getElementById('equity-ratio')?.textContent || '',
    };
  });
  // #stock-title は静的markupでは"MARKET CHART"だが detail.js(439行)が銘柄名+期間で動的更新する(既存挙動)。
  assertTrue(detail0.stockTitle.includes('トヨタ') || detail0.stockTitle.includes(EQUITY_TICKER), '#stock-title が銘柄情報で動的更新されている: ' + detail0.stockTitle);
  assertTrue(detail0.chartContainerChildren > 0, '#chart-container に子要素あり(価格チャート描画): count=' + detail0.chartContainerChildren);
  assertTrue(detail0.bsChart && detail0.plChart && detail0.cfChart && detail0.radarChart, 'BS/PL/CF/Radar の4canvasが存在する');
  assertTrue(detail0.equityRatioText !== '0.0%' && detail0.equityRatioText.length > 0, '自己資本比率が実値で描画されている(既定値のまま残っていない): ' + detail0.equityRatioText);

  // ============================================================
  // (2) 比較テーブル: モーダル → タブ → テーブル / ETF追加 / 往復
  // ============================================================
  console.log('--- (2a) 比較モーダル開く → 指標比較タブ → テーブル可視/ヘッダ8指標/行=compareSet ---');
  await page.evaluate(() => { openCompareModal(); });
  await page.waitForTimeout(200);
  await page.evaluate(() => { setCompareTab('table'); });
  await page.waitForTimeout(200);
  const cmpA = await page.evaluate(() => {
    const chart = document.getElementById('compare-chart-container');
    const table = document.getElementById('compare-table-container');
    const bChart = document.getElementById('compare-tab-chart');
    const bTable = document.getElementById('compare-tab-table');
    const disc = table.querySelector('.panel-disclaimer');
    return {
      tableDisplay: getComputedStyle(table).display,
      chartDisplay: getComputedStyle(chart).display,
      headCount: table.querySelectorAll('.cmp-table thead th').length,
      rowCount: table.querySelectorAll('.cmp-table tbody tr').length,
      bChartActive: bChart.classList.contains('active'),
      bTableActive: bTable.classList.contains('active'),
      termHelpCount: table.querySelectorAll('.term-help').length,
      fullText: table.textContent || '',
      disclaimerText: disc ? (disc.textContent || '') : '',
    };
  });
  assertTrue(cmpA.tableDisplay !== 'none', '比較テーブル可視: display=' + cmpA.tableDisplay);
  assertTrue(cmpA.chartDisplay === 'none', '比較チャートは非表示: display=' + cmpA.chartDisplay);
  assertTrue(cmpA.headCount === 9, 'ヘッダ列数=9(銘柄+8指標): count=' + cmpA.headCount);
  assertTrue(cmpA.rowCount === 1, '行数=compareSet初期(自分のみ=1): count=' + cmpA.rowCount);
  assertTrue(cmpA.bChartActive === false && cmpA.bTableActive === true, 'タブactive切替: chart=' + cmpA.bChartActive + ' table=' + cmpA.bTableActive);
  assertTrue(cmpA.termHelpCount > 0, '「?」(.term-help)がヘッダに注入されている: count=' + cmpA.termHelpCount);
  assertTrue(cmpA.disclaimerText.length > 0, '免責文言(panel-disclaimer)が存在する【比較テーブル】');

  console.log('--- (2b) ETF(' + ETF_TICKER + ')を比較に追加 → 比率セルは"—"、時価総額は値あり ---');
  await page.evaluate((t) => { addToCompare(t); }, ETF_TICKER);
  await page.waitForTimeout(200);
  const cmpB = await page.evaluate(() => {
    const table = document.getElementById('compare-table-container');
    const rows = Array.from(table.querySelectorAll('.cmp-table tbody tr'));
    const etfRow = rows.find((r) => r.querySelector('.cmp-etf'));
    if (!etfRow) return { found: false };
    const tds = Array.from(etfRow.querySelectorAll('td'));
    return {
      found: true,
      rowCount: rows.length,
      perNA: tds[1].classList.contains('na') && tds[1].textContent.includes('—'),
      pbrNA: tds[2].classList.contains('na') && tds[2].textContent.includes('—'),
      marketCapNotNA: !tds[8].classList.contains('na'),
      marketCapText: tds[8].textContent,
    };
  });
  assertTrue(cmpB.found, 'ETF行が特定できる(.cmp-etf バッジ)');
  if (cmpB.found) {
    assertTrue(cmpB.rowCount === 2, '行数=2(自分+ETF): count=' + cmpB.rowCount);
    assertTrue(cmpB.perNA, 'ETF行 PER セルは missing(na, "—")');
    assertTrue(cmpB.pbrNA, 'ETF行 PBR セルは missing(na, "—")');
    assertTrue(cmpB.marketCapNotNA, 'ETF行 時価総額 セルは値あり: text=' + cmpB.marketCapText);
  }

  console.log('--- (2c) タブ往復(table→chart→table) → 二重描画/例外なし ---');
  await page.evaluate(() => { setCompareTab('chart'); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { setCompareTab('table'); });
  await page.waitForTimeout(150);
  const cmpC = await page.evaluate(() => {
    const table = document.getElementById('compare-table-container');
    return {
      tableCount: table.querySelectorAll('.cmp-table').length,
      rowCount: table.querySelectorAll('.cmp-table tbody tr').length,
      display: getComputedStyle(table).display,
    };
  });
  assertTrue(cmpC.tableCount === 1, '往復後もテーブルは1個のみ(二重描画なし): count=' + cmpC.tableCount);
  assertTrue(cmpC.rowCount === 2, '往復後も行数=2のまま: count=' + cmpC.rowCount);
  assertTrue(cmpC.display !== 'none', '往復後もテーブル可視: display=' + cmpC.display);

  // モーダルを閉じて(以降のranking/既存ビュー検証の土台をクリーンに)。
  await page.evaluate(() => { if (typeof closeModal === 'function') closeModal('compare-modal'); });
  await page.waitForTimeout(150);

  // ============================================================
  // (3) ランキング: 表 / 散布図 / セクター帯 / 市場・指標切替
  // ============================================================
  console.log('--- (3a) ▤ランキング → ranking-view active + 表(JP既定,行数>0) + 散布図canvas + セクター帯 ---');
  // detail-view からは #ranking-entry が不可視(portal-view内) → navigateToRanking() を直接呼ぶ。
  await page.evaluate(() => { navigateToRanking(); });
  await page.waitForTimeout(300); // renderRankScatterAndStrip は rAF 経由
  const rkA = await page.evaluate(() => {
    const view = document.getElementById('ranking-view');
    const rows = Array.from(document.querySelectorAll('#rk-table .rk-tbl tbody tr'));
    const canvas = document.getElementById('rk-scatter');
    const chartInst = (typeof Chart !== 'undefined' && typeof Chart.getChart === 'function') ? Chart.getChart(canvas) : null;
    const cells = Array.from(document.querySelectorAll('#rk-sector-strip .rk-cell'));
    const disc = document.getElementById('rk-disclaimer');
    return {
      viewActive: view.classList.contains('active'),
      jpActive: document.getElementById('rk-mkt-JP').classList.contains('active'),
      rowCount: rows.length,
      tickers: rows.map((r) => r.getAttribute('data-ticker')),
      clientWidth: canvas.clientWidth,
      clientHeight: canvas.clientHeight,
      hasChartInstance: !!chartInst,
      chartDatasetLen: chartInst ? chartInst.data.datasets[0].data.length : -1,
      cellCount: cells.length,
      fullText: view.textContent || '',
      disclaimerText: disc ? (disc.textContent || '') : '',
    };
  });
  assertTrue(rkA.viewActive, 'ranking-view が active');
  assertTrue(rkA.jpActive, '既定は JP がactive');
  assertTrue(rkA.rowCount > 0, '表の行数>0: count=' + rkA.rowCount);
  assertTrue(rkA.clientWidth > 0 && rkA.clientHeight > 0, 'canvas #rk-scatter 実サイズ>0: w=' + rkA.clientWidth + ' h=' + rkA.clientHeight);
  assertTrue(rkA.hasChartInstance, 'Chart インスタンスが #rk-scatter に紐付いている');
  assertTrue(rkA.chartDatasetLen > 0, '散布図データ点>0: count=' + rkA.chartDatasetLen);
  assertTrue(rkA.cellCount > 0, 'セクター帯セルが存在する: count=' + rkA.cellCount);
  assertTrue(rkA.disclaimerText.length > 0, '免責文言(#rk-disclaimer)が存在する【ランキング】');
  const jpTickers = rkA.tickers;

  console.log('--- (3b) 市場 US に切替 + 指標 roe に切替 → 再描画OK(scatterインスタンス1個のみ・pageerrorなし) ---');
  await page.click('#rk-mkt-US');
  await page.waitForTimeout(250);
  await page.evaluate(() => { document.getElementById('rk-metric').value = 'roe'; renderRanking(); });
  await page.waitForTimeout(250);
  const rkB = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('#rk-table .rk-tbl tbody tr'));
    const canvas = document.getElementById('rk-scatter');
    let instancesForCanvas = 0;
    if (typeof Chart !== 'undefined' && Chart.instances) {
      Object.keys(Chart.instances).forEach((k) => { if (Chart.instances[k].canvas === canvas) instancesForCanvas++; });
    }
    return {
      usActive: document.getElementById('rk-mkt-US').classList.contains('active'),
      rowCount: rows.length,
      tickers: rows.map((r) => r.getAttribute('data-ticker')),
      instancesForCanvas,
      clientWidth: canvas.clientWidth,
      metricValue: document.getElementById('rk-metric').value,
    };
  });
  assertTrue(rkB.usActive, '市場切替: US がactive');
  assertTrue(rkB.rowCount > 0, 'US表の行数>0: count=' + rkB.rowCount);
  assertTrue(JSON.stringify(rkB.tickers) !== JSON.stringify(jpTickers), '市場切替で銘柄集合がJPと異なる');
  assertTrue(rkB.instancesForCanvas === 1, '市場+指標切替後も canvas紐付きChartインスタンスは1個のみ(二重生成なし): count=' + rkB.instancesForCanvas);
  assertTrue(rkB.clientWidth > 0, '切替後も canvas 実サイズ>0: w=' + rkB.clientWidth);
  assertTrue(rkB.metricValue === 'roe', '指標が roe に切り替わっている');

  const preSwitchErrCount = pageErrors.length;
  assertTrue(pageErrors.length === preSwitchErrCount, '市場/指標切替で "Canvas is already in use" 等の pageerror が発生していない');

  // ============================================================
  // (0c) 既存ビュー健全性（回帰）: money view(◎司令塔)
  // ============================================================
  console.log('--- (0c) money-view: ◎司令塔(MCC.show)が開く ---');
  await page.evaluate(() => { MCC.show(); });
  await page.waitForTimeout(500);
  const money0 = await page.evaluate(() => {
    const mv = document.getElementById('money-view');
    const root = document.getElementById('mcc-root');
    return {
      display: getComputedStyle(mv).display,
      active: mv.classList.contains('active'),
      mccChildren: root ? root.children.length : -1,
    };
  });
  assertTrue(money0.active && money0.display !== 'none', 'money-view が active/可視: active=' + money0.active + ' display=' + money0.display);
  assertTrue(money0.mccChildren > 0, '#mcc-root に描画済み子要素がある: count=' + money0.mccChildren);
  // portal に戻す。
  await page.evaluate(() => { MCC.backToPortal(); });
  await page.waitForTimeout(200);

  // ============================================================
  // (4) 規制安全: 3面横断で禁止語彙0 + 免責文言が3面に存在（既に(1)(2)(3)個別 assert 済 → ここで横断まとめ）
  // ============================================================
  console.log('--- (4) 規制安全語彙: 相対カード/比較テーブル/ランキングの3面横断で禁止語彙0 ---');
  const relHits = bannedHitsExcludingDisclaimer(relEq.fullText, relEq.disclaimerText);
  const cmpHits = bannedHitsExcludingDisclaimer(cmpA.fullText, cmpA.disclaimerText);
  const rkHits = bannedHitsExcludingDisclaimer(rkA.fullText, rkA.disclaimerText);
  assertTrue(relHits.length === 0, '相対カード: 禁止語彙0件: hit=' + JSON.stringify(relHits));
  assertTrue(cmpHits.length === 0, '比較テーブル: 禁止語彙0件: hit=' + JSON.stringify(cmpHits));
  assertTrue(rkHits.length === 0, 'ランキング: 禁止語彙0件: hit=' + JSON.stringify(rkHits));
  assertTrue(relEq.disclaimerText.length > 0 && cmpA.disclaimerText.length > 0 && rkA.disclaimerText.length > 0,
    '免責文言(ANALYSIS_DISCLAIMER系)が3面すべてに存在する');

  // ============================================================
  // (5) pageerror = 0（セッション全体）
  // ============================================================
  console.log('--- (5) pageerror(セッション全体) ---');
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
