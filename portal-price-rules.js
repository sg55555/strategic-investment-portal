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

  // ── W1.5 セクターヒートマップ：54業種 → 13大分類の写像（spec §3）──
  // ⚠ 手作りの表。ユニバース拡張で未知業種が来ても "その他" に落ちて壊れない。
  //    現ユニバースに "その他" 落ちが無いことは tests/portal-price-rules.test.js が検知する。
  var SECTOR_MAP = {
    "US - テクノロジー": "テクノロジー", "US - クラウド・SaaS": "テクノロジー", "US - 半導体・AI": "テクノロジー",
    "US - SNS・AI": "テクノロジー", "US - EC・クラウド": "テクノロジー", "US - 広告・クラウド": "テクノロジー",
    "US - 決済・フィンテック": "テクノロジー",
    "電気機器・半導体": "テクノロジー", "精密機器・半導体": "テクノロジー", "電機・ITサービス": "テクノロジー",
    "電機・インフラIT": "テクノロジー", "テクノロジー・家電": "テクノロジー", "情報通信": "テクノロジー",
    "情報通信・巨大投資": "テクノロジー",
    "US - 銀行・金融": "金融", "US - 保険": "金融", "US - 証券・資産運用": "金融",
    "銀行・金融": "金融", "保険": "金融", "証券・金融サービス": "金融",
    "US - 医薬品・バイオ": "ヘルスケア", "医薬品・バイオ": "ヘルスケア",
    "US - 資本財・防衛": "資本財", "重工・防衛": "資本財", "産業用ロボット": "資本財", "空調・産業機器": "資本財",
    "US - 小売・流通": "一般消費財", "US - 飲食・外食": "一般消費財", "US - 自動車": "一般消費財",
    "US - 電気自動車・エネルギー": "一般消費財", "US - エンターテインメント": "一般消費財",
    "小売業": "一般消費財", "自動車・輸送機器": "一般消費財", "自動車部品・電装": "一般消費財",
    "エンターテインメント": "一般消費財",
    "US - 生活必需品": "生活必需品", "食品・飲料": "生活必需品",
    "US - 素材・化学": "素材", "化学・素材": "素材", "総合商社": "素材",
    "US - エネルギー": "エネルギー",
    "US - 公益事業": "公益", "電力・ガス": "公益",
    "US - 通信": "通信",
    "US - REIT・不動産": "不動産", "不動産": "不動産",
    "US - 運輸・物流": "運輸", "運輸・インフラ": "運輸",
  };

  // 面の並び順は意味で固定する（社数順にすると検索/フィルタのたびに並びが踊る）。
  var SECTOR_ORDER = ["テクノロジー", "金融", "ヘルスケア", "一般消費財", "生活必需品", "資本財",
    "素材", "エネルギー", "公益", "通信", "不動産", "運輸", "ETF", "その他"];

  function sectorOf(industry, isEtf) {
    if (isEtf === true) return "ETF";
    var ind = String(industry == null ? "" : industry);
    if (ind.indexOf("ETF") !== -1) return "ETF";
    return SECTOR_MAP[ind] || "その他";
  }

  // ── W1.5 指標と色段（spec §4）──
  // dh（52週高値からの距離）は片側にしか振れないので発散スケールに載せない＝pos52 を採る。
  var HEAT_METRICS = [
    { key: "c1", label: "1日", field: "c1", center: 0, span: 3, digits: 2, unit: "%", signed: true,
      note: "前日比（±3%で振り切り）" },
    { key: "c5", label: "5日", field: "c5", center: 0, span: 6, digits: 2, unit: "%", signed: true,
      note: "5営業日騰落（±6%で振り切り）" },
    { key: "pos52", label: "52週位置", field: "pos52", center: 50, span: 50, digits: 0, unit: "", signed: false,
      note: "52週レンジ内の位置（0=安値 / 100=高値）" },
  ];
  var HEAT_METRIC_BY_KEY = {};
  HEAT_METRICS.forEach(function (m) { HEAT_METRIC_BY_KEY[m.key] = m; });
  function heatMetric(key) { return HEAT_METRIC_BY_KEY[key] || HEAT_METRICS[0]; }

  function heatValue(px, metricKey) {
    if (!px) return null;
    var v = px[heatMetric(metricKey).field];
    return _fin(v) ? v : null;
  }

  // 塗りと文字色の唯一の根拠。i=-1 が中立、0..4 が段（外側ほど濃い）。
  var HEAT_STEPS = [0.20, 0.42, 0.62, 0.82, 1.0];
  var HEAT_NEUTRAL_BAND = 0.06;
  function heatStep(v, metricKey) {
    if (!_fin(v)) return null;
    var m = heatMetric(metricKey);
    var d = (v - m.center) / m.span;
    var t = Math.min(1, Math.abs(d));
    if (t < HEAT_NEUTRAL_BAND) return { i: -1, up: d >= 0 };
    for (var i = 0; i < HEAT_STEPS.length; i++) {
      if (t <= HEAT_STEPS[i]) return { i: i, up: d >= 0 };
    }
    return { i: HEAT_STEPS.length - 1, up: d >= 0 };
  }

  return {
    PRICE_KEYS: PRICE_KEYS, TABS: TABS, marketOf: marketOf, isStale: isStale,
    rankTop: rankTop, priceColumns: priceColumns, sparkGeometry: sparkGeometry,
    fmtSigned: fmtSigned, fmtVolRatio: fmtVolRatio, fmtDistHigh: fmtDistHigh, clampPos: clampPos,
    SECTOR_MAP: SECTOR_MAP, SECTOR_ORDER: SECTOR_ORDER, sectorOf: sectorOf,
    HEAT_METRICS: HEAT_METRICS, heatMetric: heatMetric, heatValue: heatValue,
    HEAT_STEPS: HEAT_STEPS, heatStep: heatStep,
  };
});
