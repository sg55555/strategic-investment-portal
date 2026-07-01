// scratchpad/detail-snapshot.js — 現行 index.html の detail-view を開き、before-after 比較キーを収集/突合する。
// 視覚バグは headless では出ないが、DOM構造・算出スタイル・canvas数・chart寸法・window API・pageerror は確定できる。
const { chromium } = require('playwright');
const fs = require('fs');

// inline onclick が依存する window 名（Global Constraints の一覧）。抽出後も存在必須。
const WINDOW_API = ['navigateToPortal','exportCSV','toggleMA','toggleBB','toggleSR','toggleTR',
  'toggleRSI','toggleMACD','addToCompare','closeModal','compareSearchInput','openCompareModal',
  'removeFromCompare','setComparePeriod','toggleWatchlist','navigateToDetail','showView'];
// 算出スタイルを見張る detail 内セレクタ（代表・各カード/パネル/コントロール）。
const STYLE_SELECTORS = ['#detail-view','.back-bar','.dashboard-stack','#chart-container',
  '.card','.card-title','.grid-layout','.side-panel','.status-card','.panel-sign-value-large',
  '.ma-control-bar','.sub-chart-wrap','.kpi-compare-card','.type-badge','.detail-star-btn',
  '.active-company-title','.time-control-bar','.ai-analysis-card'];
const STYLE_PROPS = ['display','position','background','background-color','color','border','border-radius',
  'box-shadow','font-family','width','height','padding','margin','grid-template-columns','backdrop-filter'];

// controller 指示: 初回ロード時の pageerror も取りこぼさないよう、リスナは run() 内で goto の前に登録し、
// 収集した配列を capture に渡す。ここでは capture 側で受け取る形にする。
async function captureDetailSnapshot(page, pageErrors) {
  await page.waitForFunction(() => (typeof STOCK_DATA==='object' && STOCK_DATA && Object.keys(STOCK_DATA).length>0), { timeout: 8000 }).catch(()=>{});
  // 詳細を開く（7203.T＝モック済 equity）。ETF/財務欠損は Task ごとに別途 open で追加検証。
  await page.evaluate(() => { if (typeof navigateToDetail==='function') navigateToDetail('7203.T'); });
  await page.waitForTimeout(1500);
  const r = await page.evaluate((cfg) => {
    const dv = document.getElementById('detail-view');
    const norm = (html) => html.replace(/\s+/g,' ').replace(/> </g,'><').trim();
    const domHash = norm(dv ? dv.innerHTML : '').length + ':' + norm(dv ? dv.outerHTML : '').slice(0,200);
    const computedStyles = {};
    cfg.STYLE_SELECTORS.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) { computedStyles[sel] = null; return; }
      const cs = getComputedStyle(el); const o = {};
      cfg.STYLE_PROPS.forEach(p => o[p] = cs.getPropertyValue(p));
      computedStyles[sel] = o;
    });
    const dims = {};
    ['chart-container','rsi-container','macd-container'].forEach(id => {
      const el = document.getElementById(id);
      dims[id] = el ? { w: el.clientWidth, h: el.clientHeight } : null;
    });
    const windowApi = {}; cfg.WINDOW_API.forEach(n => windowApi[n] = typeof window[n] === 'function');
    return {
      domHash,
      computedStyles,
      canvasCount: document.querySelectorAll('#detail-view canvas').length,
      chartContainerDims: dims,
      windowApi,
    };
  }, { STYLE_SELECTORS, STYLE_PROPS, WINDOW_API });
  return { ...r, pageErrors };
}

async function run() {
  const mode = process.argv[2] || 'capture'; // capture | compare
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  // 初回ロードの pageerror も拾うため、goto の前にリスナを登録する。
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push('PE:'+e.message));
  await page.goto('http://localhost:8200/?diag=off', { waitUntil: 'networkidle' });
  const snap = await captureDetailSnapshot(page, pageErrors);
  await browser.close();
  const path = __dirname + '/detail-baseline.json';
  if (mode === 'capture') {
    fs.writeFileSync(path, JSON.stringify(snap, null, 2));
    console.log('baseline saved. canvases=' + snap.canvasCount + ' pageErrors=' + snap.pageErrors.length +
      ' windowApi=' + Object.values(snap.windowApi).filter(Boolean).length + '/' + Object.keys(snap.windowApi).length);
  } else {
    const base = JSON.parse(fs.readFileSync(path, 'utf8'));
    const diffs = [];
    if (JSON.stringify(base.computedStyles) !== JSON.stringify(snap.computedStyles)) diffs.push('computedStyles');
    if (base.domHash !== snap.domHash) diffs.push('domHash: '+base.domHash+' -> '+snap.domHash);
    if (base.canvasCount !== snap.canvasCount) diffs.push('canvasCount '+base.canvasCount+' -> '+snap.canvasCount);
    if (JSON.stringify(base.chartContainerDims) !== JSON.stringify(snap.chartContainerDims)) diffs.push('chartContainerDims');
    if (JSON.stringify(base.windowApi) !== JSON.stringify(snap.windowApi)) diffs.push('windowApi: '+JSON.stringify(snap.windowApi));
    if (snap.pageErrors.length) diffs.push('pageErrors: '+JSON.stringify(snap.pageErrors));
    console.log(diffs.length ? ('❌ DIFFS:\n  '+diffs.join('\n  ')) : '✅ MATCH (snapshot identical, pageerror0)');
    process.exit(diffs.length ? 1 : 0);
  }
}
run();
