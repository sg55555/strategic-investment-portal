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

  return { median: median, mean: mean, percentileRank: percentileRank, quantile: quantile };
});
