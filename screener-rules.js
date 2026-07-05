// screener-rules.js — スクリーナーの純述語＋軸レジストリ＋プリセット schema。DOM非依存・副作用なし。
// item の算出済フィールドのみ読む（FinanceRules 非依存）。no-score・facts非出力。
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScreenerRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var AXIS_REGISTRY = [
    { key: "per", label: "PER", termKey: "per", unit: "倍", field: "per", kind: "positive", group: "割安", dom: { min: "scr-per-min", max: "scr-per-max" } },
    { key: "pbr", label: "PBR", termKey: "pbr", unit: "倍", field: "pbr", kind: "positive", group: "割安", dom: { min: "scr-pbr-min", max: "scr-pbr-max" } },
    { key: "opMargin", label: "営業利益率", termKey: "op-margin", unit: "%", field: "opMargin", kind: "nullable", group: "収益", dom: { min: "scr-op-min", max: "scr-op-max" } },
    { key: "roe", label: "ROE", termKey: "roe", unit: "%", field: "roe", kind: "nullable", group: "収益", dom: { min: "scr-roe-min", max: "scr-roe-max" } },
    { key: "netMargin", label: "純利益率", termKey: "net-margin", unit: "%", field: "netMargin", kind: "nullable", group: "収益", dom: { min: "scr-nm-min", max: "scr-nm-max" } },
    { key: "eqRatio", label: "自己資本比率", termKey: "equity-ratio", unit: "%", field: "eqRatio", kind: "nullable", group: "安全", dom: { min: "scr-eq-min", max: "scr-eq-max" } },
    { key: "curRatio", label: "流動比率", termKey: "current-ratio", unit: "%", field: "curRatio", kind: "nullable", group: "安全", dom: { min: "scr-cur-min", max: "scr-cur-max" } },
    { key: "salesCagr", label: "売上成長率(3期CAGR)", termKey: "cagr", unit: "%", field: "salesCagr", kind: "nullable", group: "成長", dom: { min: "scr-cagr-min", max: "scr-cagr-max" } },
  ];
  var AXIS_BY_KEY = {};
  AXIS_REGISTRY.forEach(function (a) { AXIS_BY_KEY[a.key] = a; });

  function _fin(v) { return typeof v === "number" && isFinite(v); }

  function passesScreening(item, criteria) {
    item = item || {}; criteria = criteria || {};
    for (var i = 0; i < AXIS_REGISTRY.length; i++) {
      var ax = AXIS_REGISTRY[i], c = criteria[ax.key];
      if (!c) continue;
      var hasMin = _fin(c.min), hasMax = _fin(c.max);
      if (!hasMin && !hasMax) continue;
      var v = item[ax.field];
      if (ax.kind === "positive") {
        if (hasMin && (!(v > 0) || v < c.min)) return false;
        if (hasMax && v > 0 && v > c.max) return false;
      } else { // nullable：制約あり＋欠測(null/非有限)は除外
        if (!_fin(v)) return false;
        if (hasMin && v < c.min) return false;
        if (hasMax && v > c.max) return false;
      }
    }
    return true;
  }

  function _num(v) { var x = parseFloat(v); return isFinite(x) ? x : null; }

  function normalizeMarkets(markets) {
    var set = {};
    (markets || []).forEach(function (m) { if (m === "JP" || m === "US") set[m] = true; });
    var keys = Object.keys(set);
    return (keys.length === 0 || keys.length === 2) ? [] : keys;
  }
  function passesMarket(item, markets) {
    var m = normalizeMarkets(markets);
    if (m.length === 0) return true;
    if ((item && item.isEtf)) return false;      // 市場指定＝株式のみ（チップと統一）
    return m.indexOf(item && item.country) !== -1;
  }
  function normalizeCriteria(raw) {
    var out = {};
    AXIS_REGISTRY.forEach(function (ax) {
      var r = (raw && raw[ax.key]) || {};
      var min = _num(r.min), max = _num(r.max);
      if (min !== null || max !== null) out[ax.key] = { min: min, max: max };
    });
    return out;
  }
  function hasAnyConstraint(criteria, markets) {
    var anyAxis = Object.keys(criteria || {}).some(function (k) {
      var c = criteria[k]; return c && (_fin(c.min) || _fin(c.max));
    });
    return anyAxis || normalizeMarkets(markets).length > 0;
  }

  return { AXIS_REGISTRY: AXIS_REGISTRY, AXIS_BY_KEY: AXIS_BY_KEY, passesScreening: passesScreening, normalizeMarkets: normalizeMarkets, passesMarket: passesMarket, normalizeCriteria: normalizeCriteria, hasAnyConstraint: hasAnyConstraint, _num: _num };
});
