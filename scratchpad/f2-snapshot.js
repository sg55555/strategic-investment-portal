// scratchpad/f2-snapshot.js — F2(IIFE隔離)の before/after 挙動保存 gate。
// portal/detail/money 3ビュー + 操作フロー + pageerror + 公開面(bare typeof)を突合する。
// 挙動保存の核: (1)pageerror0 (2)DOM/canvas/style不変 (3)公開20名の bare解決が不変
//              (4)currentTicker/currentView の cross-script 生束縛が双方向で機能(ticker切替)。
// 併せて isolation達成(privatズ化サンプルが bare typeof 'undefined' へ反転)を確認(gate外の情報)。
const { chromium } = require('playwright');
const fs = require('fs');

// IIFE後も bare参照が解決し続けねばならない公開20名(function/const/生束縛)。値でなく「解決可能性」を bare typeof で見る。
const EXPOSED = ['esc','ICO','DEFAULT_CURRENCY','currencyBadge','isWatched','trackEvent','showView',
  'toggleScreening','applyScreening','resetScreening','toggleWatchlist','handleContactSubmit',
  'openModal','closeModal','retryLoadData','onPortalSearchInput','setSort','navigateToPortal',
  'currentTicker','currentView'];
// IIFE内へ private化される想定のサンプル(before:定義済 → after:'undefined' に反転すれば隔離成功)。
const PRIVATIZED = ['screening','filterAndRenderPortal','sortKey','loadPortalData','buildSparklineSVG',
  'getSectorColor','watchlist','VIEW_IDS','initSectorFilter','onHashChange'];

const STYLE_SELECTORS = ['#portal-view','.dashboard-stack','#detail-view','#chart-container','.card',
  '.card-title','#money-view','#mcc-root'];
const STYLE_PROPS = ['display','position','background-color','color','border','border-radius',
  'box-shadow','font-family','grid-template-columns','backdrop-filter'];

const norm = (s) => s.replace(/\s+/g, ' ').replace(/> </g, '><').trim();

async function capture(page, pageErrors) {
  await page.waitForFunction(
    () => (typeof STOCK_DATA === 'object' && STOCK_DATA && Object.keys(STOCK_DATA).length > 0),
    { timeout: 10000 }
  ).catch(() => {});
  await page.waitForTimeout(800);

  // ── portal 初期状態 ──
  const portal = await page.evaluate((cfg) => {
    const pv = document.getElementById('portal-view');
    const styles = {};
    cfg.STYLE_SELECTORS.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) { styles[sel] = null; return; }
      const cs = getComputedStyle(el); const o = {};
      cfg.STYLE_PROPS.forEach(p => o[p] = cs.getPropertyValue(p));
      styles[sel] = o;
    });
    return {
      portalDomLen: pv ? pv.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim().length : -1,
      portalCanvas: document.querySelectorAll('#portal-view canvas').length,
      portalSvgSpark: document.querySelectorAll('#portal-view svg.spark, #portal-view .sparkline svg, #portal-view svg').length,
      rowCount: document.querySelectorAll('#portal-view tbody tr, #portal-view .stock-card, #portal-view tr').length,
      styles,
    };
  }, { STYLE_SELECTORS, STYLE_PROPS });

  // ── 公開/private の bare typeof(typeof は未宣言でも throw しない) ──
  const resolve = await page.evaluate((names) => {
    const out = {};
    // 個別 typeof を関数化して未宣言でも安全に。
    names.forEach(n => { out[n] = eval('typeof ' + n); });
    return out;
  }, [...EXPOSED, ...PRIVATIZED]);
  const exposed = {}; EXPOSED.forEach(n => exposed[n] = resolve[n]);
  const privatized = {}; PRIVATIZED.forEach(n => privatized[n] = resolve[n]);

  // ── detail: 7203.T を開く ──
  const secondTicker = await page.evaluate(() => {
    const keys = Object.keys(STOCK_DATA || {});
    return keys.find(k => k !== '7203.T') || null;
  });
  await page.evaluate(() => { if (typeof navigateToDetail === 'function') navigateToDetail('7203.T'); });
  await page.waitForTimeout(1600);
  const detail1 = await page.evaluate(() => {
    const dv = document.getElementById('detail-view');
    const title = (dv?.querySelector('.active-company-title')?.textContent || '').trim();
    const dims = {};
    ['chart-container','rsi-container','macd-container'].forEach(id => {
      const el = document.getElementById(id);
      dims[id] = el ? { w: el.clientWidth, h: el.clientHeight } : null;
    });
    return {
      detailDomLen: dv ? dv.innerHTML.replace(/\s+/g, ' ').replace(/> </g, '><').trim().length : -1,
      detailCanvas: document.querySelectorAll('#detail-view canvas').length,
      title, dims,
    };
  });

  // ── currentTicker 生束縛の双方向: 別ticker へ切替 → title が変わる ──
  let tickerSwitch = { second: secondTicker, switched: null, title2: null };
  if (secondTicker) {
    await page.evaluate((t) => { navigateToDetail(t); }, secondTicker);
    await page.waitForTimeout(1400);
    const title2 = await page.evaluate(() =>
      (document.querySelector('#detail-view .active-company-title')?.textContent || '').trim());
    tickerSwitch = { second: secondTicker, switched: title2 !== detail1.title && title2.length > 0, title2 };
    // 7203.T へ戻す(以降の比較安定化)
    await page.evaluate(() => navigateToDetail('7203.T'));
    await page.waitForTimeout(1200);
  }

  // ── money ビュー ──
  const money = await page.evaluate(() => {
    if (typeof showView === 'function') showView('money');
    const mv = document.getElementById('money-view');
    const root = document.getElementById('mcc-root');
    return {
      moneyDisplay: mv ? getComputedStyle(mv).display : null,
      mccChildren: root ? root.children.length : -1,
    };
  });
  await page.waitForTimeout(400);
  // portal へ戻す
  await page.evaluate(() => { if (typeof navigateToPortal === 'function') navigateToPortal(); });
  await page.waitForTimeout(300);

  return { portal, exposed, privatized, detail1, tickerSwitch, money, pageErrors: [...pageErrors] };
}

async function run() {
  const mode = process.argv[2] || 'capture';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push('PE:' + e.message));
  await page.goto('http://localhost:8200/?diag=off', { waitUntil: 'networkidle' });
  const snap = await capture(page, pageErrors);
  await browser.close();

  const p = __dirname + '/f2-baseline.json';
  if (mode === 'capture') {
    fs.writeFileSync(p, JSON.stringify(snap, null, 2));
    const exN = Object.values(snap.exposed).filter(v => v !== 'undefined').length;
    console.log(`baseline saved. portalCanvas=${snap.portal.portalCanvas} detailCanvas=${snap.detail1.detailCanvas} ` +
      `exposed_resolved=${exN}/${EXPOSED.length} switched=${snap.tickerSwitch.switched} ` +
      `mccChildren=${snap.money.mccChildren} pageErrors=${snap.pageErrors.length}`);
    console.log('exposed:', JSON.stringify(snap.exposed));
    console.log('privatized(before):', JSON.stringify(snap.privatized));
  } else {
    const base = JSON.parse(fs.readFileSync(p, 'utf8'));
    const diffs = [];
    // 挙動保存 gate: portal 構造/style, detail 構造/canvas/dims/title, 公開解決, ticker切替, money, pageerror
    const cmp = (label, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${label}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`); };
    cmp('portal.styles', base.portal.styles, snap.portal.styles);
    cmp('portal.portalCanvas', base.portal.portalCanvas, snap.portal.portalCanvas);
    cmp('portal.rowCount', base.portal.rowCount, snap.portal.rowCount);
    cmp('portal.portalDomLen', base.portal.portalDomLen, snap.portal.portalDomLen);
    cmp('exposed(bare typeof)', base.exposed, snap.exposed);   // 公開20名の解決が不変であること(最重要)
    cmp('detail.detailCanvas', base.detail1.detailCanvas, snap.detail1.detailCanvas);
    cmp('detail.dims', base.detail1.dims, snap.detail1.dims);
    cmp('detail.title', base.detail1.title, snap.detail1.title);
    cmp('detail.detailDomLen', base.detail1.detailDomLen, snap.detail1.detailDomLen);
    cmp('tickerSwitch.switched', base.tickerSwitch.switched, snap.tickerSwitch.switched);
    cmp('money.mccChildren>0', base.money.mccChildren > 0, snap.money.mccChildren > 0);
    if (snap.pageErrors.length) diffs.push('pageErrors: ' + JSON.stringify(snap.pageErrors));
    if (!snap.tickerSwitch.switched) diffs.push('tickerSwitch FAILED: currentTicker 生束縛が機能せず(title不変)');

    // isolation 情報(gate外): private化サンプルが 'undefined' へ反転したか
    const isoFlipped = PRIVATIZED.filter(n => base.privatized[n] !== 'undefined' && snap.privatized[n] === 'undefined');
    const isoLeaked = PRIVATIZED.filter(n => snap.privatized[n] !== 'undefined');
    console.log(`isolation: ${isoFlipped.length}/${PRIVATIZED.length} が bare global から隔離(undefined化)。`);
    if (isoLeaked.length) console.log('  まだ bare 解決するもの(private化漏れ or 意図残置):', JSON.stringify(isoLeaked.map(n => `${n}=${snap.privatized[n]}`)));

    console.log(diffs.length
      ? ('❌ 挙動保存 DIFFS:\n  ' + diffs.join('\n  '))
      : '✅ MATCH (portal/detail/money/公開解決/ticker切替 不変・pageerror0)');
    process.exit(diffs.length ? 1 : 0);
  }
}
run();
