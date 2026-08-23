// portal-price-rules.js — ポータルの価格表示レイヤの純関数（DOM非依存・副作用なし）。
// 数値の算出はサーバ(api/market/list.py)側だけで行い、ここは「並べ替え・鮮度判定・列定義・
// 幾何・整形」だけを持つ＝JS↔Py の鏡像パリティ義務を作らない（意図的な設計・spec D9）。
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PortalPriceRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 値動きモードのソートキー集合。モード切替のキー整合と NULL_LAST_KEYS 拡張に使う。
  var PRICE_KEYS = { last: 1, c1: 1, c5: 1, vr: 1, pos52: 1 };

  // 発掘タブ。dir=desc は降順。high は dh(=52週高値からの距離・0以下)の降順＝0に近い順。
  var TABS = [
    { key: "gain", label: "値上がり", metric: "c1", dir: "desc" },
    { key: "lose", label: "値下がり", metric: "c1", dir: "asc" },
    { key: "vol", label: "出来高急増", metric: "vr", dir: "desc" },
    { key: "high", label: "52週高値に接近", metric: "dh", dir: "desc" },
  ];
  var TAB_BY_KEY = {};
  TABS.forEach(function (t) { TAB_BY_KEY[t.key] = t; });

  function _fin(v) { return typeof v === "number" && isFinite(v); }

  function marketOf(ticker, raw) {
    var country = (raw || {}).country;
    if (country) return country;
    return String(ticker).slice(-2) === ".T" ? "JP" : "US";
  }

  // px.date が自市場の最新終値日より前なら stale。px 無し・asof 不明のときは判定しない(false)。
  function isStale(px, marketAsof, market) {
    if (!px || !px.date) return false;
    var asof = (marketAsof || {})[market];
    return !!asof && px.date < asof;
  }

  // items = [{ticker, market, px, ...}]。tabKey のタブ定義で並べ替え、上位 n 件を返す。
  // 除外: px 無し / 指標が非有限 / stale。同値は ticker 昇順で安定化（再描画で順序が揺れない）。
  // 鮮度除外の安全弁：候補の半分より多くが stale なら「除外」をやめて全件を出す。
  // 理由＝ETL が未来日付の行を1本でも混入させると market_asof（市場ごとの MAX）が先へ飛び、
  //       その市場が丸ごと stale 扱いになってストリップが空になる。「何も出ない」は原因が
  //       UI から見えない最悪の壊れ方なので、出したうえで stale を明示する側に倒す。
  var STALE_FILTER_MAX_RATIO = 0.5;

  function rankTop(items, tabKey, n, marketAsof) {
    var tab = TAB_BY_KEY[tabKey] || TABS[0];
    var candidates = (items || []).filter(function (it) {
      var px = it && it.px;
      return !!px && _fin(px[tab.metric]);
    });
    var staleFlags = candidates.map(function (it) {
      return isStale(it.px, marketAsof, it.market || marketOf(it.ticker, it));
    });
    var staleCount = staleFlags.filter(Boolean).length;
    var staleFilterDisabled = candidates.length > 0 && staleCount > candidates.length * STALE_FILTER_MAX_RATIO;
    var rows = candidates.filter(function (_it, i) { return staleFilterDisabled || !staleFlags[i]; });
    rows.sort(function (a, b) {
      var va = a.px[tab.metric], vb = b.px[tab.metric];
      if (va !== vb) return tab.dir === "asc" ? va - vb : vb - va;
      return String(a.ticker) < String(b.ticker) ? -1 : (String(a.ticker) > String(b.ticker) ? 1 : 0);
    });
    return {
      rows: rows.slice(0, n),
      excludedStale: staleFilterDisabled ? 0 : staleCount,
      staleFilterDisabled: staleFilterDisabled,
    };
  }

  // 値動き表の列定義（描画・テスト・受入の単一源）。
  // ⚠ .portal-table の nth-child 列非表示には依存しない＝列セットごと差し替える方式。
  var COLS_WIDE = [
    { key: "ticker", label: "コード", width: "8%", sortable: true },
    { key: "name", label: "企業名", width: "26%", sortable: true },
    { key: "last", label: "終値", width: "11%", sortable: true },
    { key: "c1", label: "前日比", width: "11%", sortable: true },
    { key: "c5", label: "5日", width: "10%", sortable: true },
    { key: "vr", label: "出来高倍率", width: "11%", sortable: true },
    { key: "pos52", label: "52週レンジ", width: "13%", sortable: true },
    { key: "spark", label: "30日", width: "10%", sortable: false },
  ];
  var COLS_NARROW = [
    { key: "name", label: "銘柄", width: "44%", sortable: true },
    { key: "last", label: "終値", width: "20%", sortable: true },
    { key: "c1", label: "前日比", width: "20%", sortable: true },
    { key: "spark", label: "30日", width: "16%", sortable: false },
  ];
  function priceColumns(isNarrow) { return isNarrow ? COLS_NARROW : COLS_WIDE; }

  // 0-100 の正規化 spark → SVG の polyline points と塗り path。幾何の正規化のみ（業務math非該当）。
  function sparkGeometry(spark, w, h) {
    if (!spark || spark.length < 2) return null;
    var pad = 2, n = spark.length, dx = (w - pad * 2) / (n - 1), pts = [];
    for (var i = 0; i < n; i++) {
      var y = pad + (100 - spark[i]) / 100 * (h - pad * 2);
      pts.push((pad + i * dx).toFixed(1) + "," + y.toFixed(1));
    }
    var points = pts.join(" ");
    var area = "M" + pts[0] + " L" + points.split(" ").join(" L") +
      " L" + (w - pad).toFixed(1) + "," + (h - pad) + " L" + pad + "," + (h - pad) + " Z";
    return { points: points, area: area };
  }

  function fmtSigned(v, digits, unit) {
    if (!_fin(v)) return "--";
    return (v > 0 ? "+" : "") + v.toFixed(digits == null ? 2 : digits) + (unit || "");
  }
  function fmtVolRatio(vr) { return _fin(vr) ? vr.toFixed(2) + "倍" : "--"; }
  function fmtDistHigh(dh) {
    if (!_fin(dh)) return "--";
    return dh >= 0 ? "高値更新" : "高値まで " + Math.abs(dh).toFixed(1) + "%";
  }
  function clampPos(pos) { return _fin(pos) ? Math.max(0, Math.min(100, pos)) : null; }

  return {
    PRICE_KEYS: PRICE_KEYS, TABS: TABS, marketOf: marketOf, isStale: isStale,
    rankTop: rankTop, priceColumns: priceColumns, sparkGeometry: sparkGeometry,
    fmtSigned: fmtSigned, fmtVolRatio: fmtVolRatio, fmtDistHigh: fmtDistHigh, clampPos: clampPos,
  };
});
