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
  function _finRatio(fin, fn, needKeys, denomKeys) {
    if (!fin || !FR) return null;
    for (var i = 0; i < needKeys.length; i++) { if (!FR.hasValue(fin, needKeys[i])) return null; }
    if (denomKeys) {
      var denom = 0;
      for (var j = 0; j < denomKeys.length; j++) denom += FR.n(fin[denomKeys[j]]);
      if (!(denom > 0)) return null; // 非正の分母＝算出不能→欠測(false 0 を分布に入れない)
    }
    var v = fn(fin);
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }
  function _latestFin(raw) {
    var t = raw && raw.financials_trend;
    if (!t || typeof t !== "object") return null;
    var years = Object.keys(t).map(Number).filter(isFinite).sort(function (a, b) { return b - a; });
    for (var i = 0; i < years.length; i++) {   // spec §5.4-4: 実質値のある最大年（全ゼロFY行スキップ）
      var fin = t[String(years[i])];
      if (FR && FR.hasFinSubstance(fin, raw.currency)) return fin;   // 通貨も渡す（単位不整合の行を母集合から外す）
    }
    return null;
  }

  // ---- 指標レジストリ ----
  var METRIC_REGISTRY = [
    { key: "per", label: "PER", read: "ピーイーアール", unit: "倍", currencyNeutral: true, higherIsBetter: false, termKey: "per",
      getter: function (fin, raw) { return _rawPositive(raw, "per"); } },
    { key: "pbr", label: "PBR", read: "ピービーアール", unit: "倍", currencyNeutral: true, higherIsBetter: false, termKey: "pbr",
      getter: function (fin, raw) { return _rawPositive(raw, "pbr"); } },
    { key: "roe", label: "ROE", read: "アールオーイー", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "roe",
      getter: function (fin) { return _finRatio(fin, FR.roe, ["net_income", "net_assets"], ["net_assets"]); } },
    { key: "roa", label: "ROA", read: "アールオーエー", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "roa",
      getter: function (fin) { return _finRatio(fin, FR.roa, ["net_income", "current_assets", "non_current_assets"], ["current_assets", "non_current_assets"]); } },
    { key: "netMargin", label: "純利益率", read: "じゅんりえきりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "net-margin",
      getter: function (fin) { return _finRatio(fin, FR.netMargin, ["net_income", "net_sales"], ["net_sales"]); } },
    { key: "opMargin", label: "営業利益率", read: "えいぎょうりえきりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "op-margin",
      getter: function (fin) { return _finRatio(fin, FR.opMargin, ["operating_income", "net_sales"], ["net_sales"]); } },
    { key: "equityRatio", label: "自己資本比率", read: "じこしほんひりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "equity-ratio",
      getter: function (fin) { return _finRatio(fin, FR.equityRatio, ["net_assets", "current_assets", "non_current_assets"], ["current_assets", "non_current_assets"]); } },
    { key: "currentRatio", label: "流動比率", read: "りゅうどうひりつ", unit: "%", currencyNeutral: true, higherIsBetter: true, termKey: "current-ratio",
      getter: function (fin) { return _finRatio(fin, FR.currentRatio, ["current_assets", "current_liabilities"], ["current_liabilities"]); } },
    { key: "marketCap", label: "時価総額", read: "じかそうがく", unit: "", currencyNeutral: false, higherIsBetter: null, termKey: "market-cap",
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

  var MARKET_LABEL = { JP: "日本株", US: "米国株" };

  // 中立バンド語(位置のみ・売買/予測語なし)。higherIsBetter は band には使わない(純粋に位置)。
  function _band(pctile) {
    if (pctile == null) return { label: "データなし", tone: "muted" };
    if (pctile >= 80) return { label: "上位", tone: "high" };
    if (pctile >= 60) return { label: "やや上位", tone: "midhigh" };
    if (pctile >= 40) return { label: "中央値付近", tone: "mid" };
    if (pctile >= 20) return { label: "やや下位", tone: "midlow" };
    return { label: "下位", tone: "low" };
  }
  // T1: 指標ごとの単位前提。marketCap の raw は「生の円/ドル」（_rawPositive(raw,"marketCap")
  //  = yfinance info.marketCap 準拠・index.html fmtMarketCap の val/1e12 前提と同じ）。
  //  一方 FR.fmtMagnitude は「百万単位」入力前提（finance-rules.js:80、financials_trend 由来の
  //  他指標はDB準拠で元々百万単位＝そのまま渡してよい）。marketCap だけは /1e6 して百万単位に
  //  揃えてから渡す（監査実測バグ: 生円を直渡しし100万倍の桁で誤表示=「482046.71兆円」）。
  function _fmtMetric(m, value, currency) {
    if (value == null) return "—";
    if (m.key === "marketCap") return FR && FR.fmtMagnitude ? FR.fmtMagnitude(value / 1e6, currency) : String(value);
    if (m.unit === "%") return value.toFixed(1) + "%";
    if (m.unit === "倍") return value.toFixed(1) + "倍";
    return String(value);
  }
  function peerStats(universe, market, metricKey) {
    var g = universe && universe[market];
    var vals = (g && g[metricKey]) || [];
    return {
      n: vals.length, median: median(vals), q1: quantile(vals, 0.25), q3: quantile(vals, 0.75),
      min: vals.length ? Math.min.apply(null, vals) : null,
      max: vals.length ? Math.max.apply(null, vals) : null,
    };
  }
  function relativePosition(ticker, stockData) {
    var raw = stockData && stockData[ticker];
    if (!raw) return null;
    if ((raw.type || "stock") === "etf") return { etf: true };
    var universe = buildUniverse(stockData);
    var market = _market(ticker, raw);
    var g = universe[market];
    if (!g) return null;
    var self = null;
    for (var i = 0; i < g._members.length; i++) { if (g._members[i].ticker === ticker) { self = g._members[i]; break; } }
    var selfVals = self ? self.values : {};
    function entry(m) {
      var value = selfVals[m.key];
      value = (value == null) ? null : value;
      var stats = peerStats(universe, market, m.key);
      var pctile = (value == null) ? null : percentileRank(g[m.key], value);
      var band = _band(pctile);
      return {
        key: m.key, label: m.label, termKey: m.termKey, unit: m.unit,
        value: value, format: _fmtMetric(m, value, raw.currency),
        percentile: pctile, n: stats.n, median: stats.median, min: stats.min, max: stats.max,
        band: band.label, tone: band.tone,
        caption: (value == null) ? "データなし"
          : (MARKET_LABEL[market] || market) + stats.n + "銘柄中 " + band.label + "（" + Math.round(pctile) + "パーセンタイル）",
      };
    }
    function grp(title, keys) { return { title: title, metrics: keys.map(function (k) { return entry(METRIC_BY_KEY[k]); }) }; }
    return {
      market: market, marketLabel: MARKET_LABEL[market] || market, marketN: g._members.length,
      groups: [
        grp("割安度", ["per", "pbr"]),
        grp("収益性", ["roe", "roa", "netMargin", "opMargin"]),
        grp("安全性", ["equityRatio", "currentRatio"]),
        grp("規模", ["marketCap"]),
      ],
    };
  }

  var COMPARE_METRICS = ["per", "pbr", "roe", "netMargin", "opMargin", "equityRatio", "currentRatio", "marketCap"];
  function compareMetricsRows(tickers, stockData) {
    return (tickers || []).map(function (ticker) {
      var raw = stockData && stockData[ticker];
      if (!raw) return null;
      var isEtf = (raw.type || "stock") === "etf";
      var fin = _latestFin(raw);
      var cells = {};
      COMPARE_METRICS.forEach(function (k) {
        var m = METRIC_BY_KEY[k];
        var v = (isEtf && k !== "marketCap") ? null : m.getter(fin, raw);
        var missing = !(typeof v === "number" && isFinite(v));
        cells[k] = { value: missing ? null : v, format: missing ? "—" : _fmtMetric(m, v, raw.currency), missing: missing };
      });
      return { ticker: ticker, name: raw.company_name || ticker, market: raw.country || "", currency: raw.currency || "", isEtf: isEtf, cells: cells };
    }).filter(Boolean);
  }
  function rankByMetric(universe, market, metricKey, opts) {
    var g = universe && universe[market];
    if (!g) return [];
    var m = METRIC_BY_KEY[metricKey];
    var dir = (opts && opts.dir) || (m && m.higherIsBetter === false ? "asc" : "desc");
    var vals = g[metricKey];
    var rows = g._members.filter(function (mem) { return mem.values[metricKey] != null; })
      .map(function (mem) { return { ticker: mem.ticker, name: mem.name, industry: mem.industry, value: mem.values[metricKey], currency: mem.currency }; });
    rows.sort(function (a, b) { return dir === "asc" ? a.value - b.value : b.value - a.value; });
    return rows.map(function (r, i) {
      var p = percentileRank(vals, r.value);
      return { rank: i + 1, ticker: r.ticker, name: r.name, industry: r.industry, value: r.value,
        format: _fmtMetric(m, r.value, r.currency), percentile: p, decile: Math.min(10, Math.floor(p / 10) + 1) };
    });
  }
  function scatterPoints(universe, market, xKey, yKey) {
    var g = universe && universe[market];
    if (!g) return { points: [], xMedian: null, yMedian: null, xLabel: "", yLabel: "" };
    var points = g._members.filter(function (mem) { return mem.values[xKey] != null && mem.values[yKey] != null; })
      .map(function (mem) { return { ticker: mem.ticker, name: mem.name, industry: mem.industry, x: mem.values[xKey], y: mem.values[yKey] }; });
    return { points: points, xMedian: median(points.map(function (p) { return p.x; })), yMedian: median(points.map(function (p) { return p.y; })),
      xLabel: (METRIC_BY_KEY[xKey] || {}).label || xKey, yLabel: (METRIC_BY_KEY[yKey] || {}).label || yKey };
  }
  function sectorMedians(universe, market, metricKey, opts) {
    var g = universe && universe[market];
    if (!g) return [];
    var minN = (opts && opts.minN) || 3, bySector = {};
    g._members.forEach(function (mem) {
      var v = mem.values[metricKey];
      if (v == null) return;
      (bySector[mem.industry] = bySector[mem.industry] || []).push(v);
    });
    var named = [], other = [];
    Object.keys(bySector).forEach(function (sec) {
      var vals = bySector[sec];
      if (vals.length >= minN) named.push({ sector: sec, n: vals.length, median: median(vals) });
      else other = other.concat(vals);
    });
    named.sort(function (a, b) { return (b.median || 0) - (a.median || 0); });
    if (other.length) named.push({ sector: "その他", n: other.length, median: median(other) });
    return named;
  }

  return { median: median, mean: mean, percentileRank: percentileRank, quantile: quantile,
    METRIC_REGISTRY: METRIC_REGISTRY, METRIC_BY_KEY: METRIC_BY_KEY,
    buildUniverse: buildUniverse, _latestFin: _latestFin,
    peerStats: peerStats, relativePosition: relativePosition,
    compareMetricsRows: compareMetricsRows, rankByMetric: rankByMetric, scatterPoints: scatterPoints, sectorMedians: sectorMedians,
  };
});
