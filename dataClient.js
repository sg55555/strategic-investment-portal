/* お金の司令室 v2 / Slice 1 — data shim（STOCK_DATA を所有する供給層）
 *
 * 旧 data.js（21MB の `const STOCK_DATA`）をこのファイルで置換する。
 *  - REMOTE_ENABLED=false: data-bundle.js（旧データ一括）を読み、従来どおり同期全量で動く＝本番無改造の安全弁。
 *  - REMOTE_ENABLED=true : /api/market/list で軽量サマリだけ取得（初回 21MB→数十KB）。
 *                          銘柄を開く/比較に載せる時に prices・全財務(+AIコメント)を getStock でその場ハイドレート。
 *
 * 既存の同期消費コード（STOCK_DATA[ticker]… / Object.keys(STOCK_DATA) / for..in）は無改造のまま動く。
 * index.html 側の改修は onload・navigateToDetail・addToCompare の3点に await を挿すだけ。
 *
 * 束縛の注意: `let STOCK_DATA` はトップレベル字句束縛で、bare 名 STOCK_DATA として全 classic script から解決される
 *           （旧 const と同じ可視性）。data-bundle.js は `const` を外した代入文なのでこの束縛を上書きする。
 */
let STOCK_DATA = {};
let DATA_UPDATED_AT = "";
const REMOTE_ENABLED = false;

const _MKT_API = "/api/market";
const _mktHydrated = new Set();

async function _mktJSON(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(url + " → HTTP " + r.status);
  return r.json();
}

function _mktLoadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("script load failed: " + src));
    document.head.appendChild(s);
  });
}

/* boot 時に1回。grid 描画に必要なデータを用意する（remote=軽量list / fallback=旧データ一括）。 */
async function bootData() {
  if (REMOTE_ENABLED) {
    STOCK_DATA = await _mktJSON(_MKT_API + "/list");
  } else {
    await _mktLoadScript("data-bundle.js"); // DATA_UPDATED_AT / STOCK_DATA を一括代入
  }
  return STOCK_DATA;
}

/* 銘柄詳細/比較を開く直前に呼ぶ。prices と全財務(+AIコメント)を STOCK_DATA[ticker] にその場マージする。
 * fallback(REMOTE=false) は既に全量入りなので即 return（＝従来動作と完全一致）。 */
async function getStock(ticker) {
  const cur = STOCK_DATA[ticker];
  if (!REMOTE_ENABLED) return cur;
  if (!cur || _mktHydrated.has(ticker)) return cur;
  const [oh, fin] = await Promise.all([
    _mktJSON(_MKT_API + "/ohlcv?ticker=" + encodeURIComponent(ticker)),
    _mktJSON(_MKT_API + "/financials?ticker=" + encodeURIComponent(ticker)),
  ]);
  cur.prices = (oh && oh.prices) || [];
  if (fin && fin.financials_trend) cur.financials_trend = fin.financials_trend;
  _mktHydrated.add(ticker);
  return cur;
}
