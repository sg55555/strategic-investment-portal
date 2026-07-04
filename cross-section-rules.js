// cross-section-rules.js — 銘柄横断(クロスセクション)の純関数。分布の中の現在地を返す。
// ブラウザ(window.CrossSection) と Node(require) 両対応(UMD-lite)。副作用なし・DOM非依存。
// finance-rules.js の直後にロード（FinanceRules の単社getterを横断集計の部品として消費）。
// 母集団は市場ベース(country='JP'|'US')。no-score・中立語・facts非出力。
(function (root, factory) {
  const FR = (typeof FinanceRules !== "undefined") ? FinanceRules
    : (typeof require !== "undefined") ? require("./finance-rules.js") : null;
  const api = factory(FR);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CrossSection = api;
})(typeof self !== "undefined" ? self : this, function (FR) {
  "use strict";

  // ---- 統計プリミティブ ----
  function _sorted(vals) {
    return (vals || []).filter(function (v) { return typeof v === "number" && isFinite(v); })
      .sort(function (a, b) { return a - b; });
  }
  function median(vals) {
    var s = _sorted(vals);
    if (s.length === 0) return null;
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mean(vals) {
    var s = _sorted(vals);
    if (s.length === 0) return null;
    return s.reduce(function (a, b) { return a + b; }, 0) / s.length;
  }
  // midrank: (x未満の個数 + 同値の個数/2) / n ×100。単要素=50・全同値=50。
  function percentileRank(vals, x) {
    var s = _sorted(vals);
    if (s.length === 0 || typeof x !== "number" || !isFinite(x)) return null;
    var less = 0, equal = 0;
    for (var i = 0; i < s.length; i++) { if (s[i] < x) less++; else if (s[i] === x) equal++; }
    return ((less + equal / 2) / s.length) * 100;
  }
  function quantile(vals, q) {
    var s = _sorted(vals);
    if (s.length === 0) return null;
    if (s.length === 1) return s[0];
    var pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    if (lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }

  // ---- 欠測ゲート ----
  function _rawPositive(raw, key) {
    var v = Number(raw && raw[key]);
    return (isFinite(v) && v > 0) ? v : null; // 0/欠落/非有限 = 欠測(list.py null→0の罠)
  }
  function _finRatio(fin, fn, needKeys) {
    if (!fin || !FR) return null;
    for (var i = 0; i < needKeys.length; i++) { if (!FR.hasValue(fin, needKeys[i])) return null; }
    var v = fn(fin);
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }
  function _latestFin(raw) {
    var t = raw && raw.financials_trend;
    if (!t || typeof t !== "object") return null;
    var years = Object.keys(t).map(Number).filter(isFinite);
    if (years.length === 0) return null;
    return t[String(Math.max.apply(null, years))] || null;
  }

  // ---- 指標レジストリ ----
  var METRIC_REGISTRY = [
    { key: "per", label: "PER", read: "ピーイーアール", unit: "倍", currencyNeutral: true, higherIsBetter: false, termKey: "PER",
      getter: function (fin, raw) { return _rawPositive(raw, "per"); } },
    { key: "pbr", label: "PBR", read: "ピービーアール", unit: "倍", currencyNeutral: true, higherIsBetter: false, termKey: "PBR",
      getter: function (fin, raw) { return _rawPositive(raw, "pbr"); } },
    { key: "roe", label: "ROE", read: "アールオーイー", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "ROE",
      getter: function (fin) { return _finRatio(fin, FR.roe, ["net_income", "net_assets"]); } },
    { key: "roa", label: "ROA", read: "アールオーエー", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "ROA",
      getter: function (fin) { return _finRatio(fin, FR.roa, ["net_income", "current_assets", "non_current_assets"]); } },
    { key: "netMargin", label: "純利益率", read: "じゅんりえきりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "純利益率",
      getter: function (fin) { return _finRatio(fin, FR.netMargin, ["net_income", "net_sales"]); } },
    { key: "opMargin", label: "営業利益率", read: "えいぎょうりえきりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "営業利益率",
      getter: function (fin) { return _finRatio(fin, FR.opMargin, ["operating_income", "net_sales"]); } },
    { key: "equityRatio", label: "自己資本比率", read: "じこしほんひりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "自己資本比率",
      getter: function (fin) { return _finRatio(fin, FR.equityRatio, ["net_assets", "current_assets", "non_current_assets"]); } },
    { key: "currentRatio", label: "流動比率", read: "りゅうどうひりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "流動比率",
      getter: function (fin) { return _finRatio(fin, FR.currentRatio, ["current_assets", "current_liabilities"]); } },
    { key: "marketCap", label: "時価総額", read: "じかそうがく", unit: "", currencyNeutral: false, higherIsBetter: null, termKey: "時価総額",
      getter: function (fin, raw) { return _rawPositive(raw, "marketCap"); } },
  ];
  var METRIC_BY_KEY = {};
  METRIC_REGISTRY.forEach(function (m) { METRIC_BY_KEY[m.key] = m; });

  function _market(ticker, raw) {
    return raw.country || (String(ticker).slice(-2) === ".T" ? "JP" : "US");
  }
  function buildUniverse(stockData) {
    var universe = {};
    Object.keys(stockData || {}).forEach(function (ticker) {
      var raw = stockData[ticker];
      if (!raw || (raw.type || "stock") === "etf") return;
      var market = _market(ticker, raw);
      if (!universe[market]) {
        universe[market] = { _members: [] };
        METRIC_REGISTRY.forEach(function (m) { universe[market][m.key] = []; });
      }
      var fin = _latestFin(raw);
      var values = {};
      METRIC_REGISTRY.forEach(function (m) {
        var v = m.getter(fin, raw);
        values[m.key] = (typeof v === "number" && isFinite(v)) ? v : null;
        if (values[m.key] !== null) universe[market][m.key].push(values[m.key]);
      });
      universe[market]._members.push({
        ticker: ticker, name: raw.company_name || ticker, industry: raw.industry || "—",
        currency: raw.currency || "", values: values,
      });
    });
    return universe;
  }

  return { median: median, mean: mean, percentileRank: percentileRank, quantile: quantile,
    METRIC_REGISTRY: METRIC_REGISTRY, METRIC_BY_KEY: METRIC_BY_KEY,
    buildUniverse: buildUniverse, _latestFin: _latestFin,
  };
});
