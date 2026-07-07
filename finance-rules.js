// finance-rules.js — ポータル財務指標の純関数ロジック。
// ブラウザ(window.FinanceRules) と Node(require) の両対応(UMD-lite)。副作用なし。
// 監査 F1: ROE/自己資本比率/流動比率/営業利益率 等が index.html 内に 3〜4 回 inline 複製
// されていたのを単一源へ集約し node --test で固定する。値の単位は DB 準拠（百万円/百万ドル）。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FinanceRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // 財務値は負（赤字・CF流出）も正当な値。NaN/非数のみ 0 に丸める（非負強制はしない）。
  function n(v) {
    var x = Number(v);
    return isFinite(x) ? x : 0;
  }

  // 比率(%)の共通土台。分母 0 以下は「算出不能」として 0 を返す（既存 inline と同挙動）。
  function ratio(numer, denom) {
    var d = n(denom);
    return d > 0 ? (n(numer) / d) * 100 : 0;
  }

  function totalAssets(fin) {
    fin = fin || {};
    return n(fin.current_assets) + n(fin.non_current_assets);
  }
  function totalLiabilities(fin) {   // 総負債 = 流動負債 + 固定負債（欠損→0）
    fin = fin || {};
    return n(fin.current_liabilities) + n(fin.non_current_liabilities);
  }
  function equityRatio(fin) {        // 自己資本比率 = 純資産 / 総資産
    fin = fin || {};
    return ratio(fin.net_assets, totalAssets(fin));
  }
  function currentRatio(fin) {       // 流動比率 = 流動資産 / 流動負債
    fin = fin || {};
    return ratio(fin.current_assets, fin.current_liabilities);
  }
  function opMargin(fin) {           // 営業利益率 = 営業利益 / 売上高
    fin = fin || {};
    return ratio(fin.operating_income, fin.net_sales);
  }
  function netMargin(fin) {          // 当期純利益率 = 純利益 / 売上高
    fin = fin || {};
    return ratio(fin.net_income, fin.net_sales);
  }
  function roe(fin) {                // ROE = 純利益 / 純資産
    fin = fin || {};
    return ratio(fin.net_income, fin.net_assets);
  }
  function roa(fin) {                // ROA = 純利益 / 総資産
    fin = fin || {};
    return ratio(fin.net_income, totalAssets(fin));
  }

  // レーダー等のスコア化（0-100 にクランプ）。
  function clampScore(val, min, max) {
    if (max === min) return 0;
    return Math.min(100, Math.max(0, ((n(val) - min) / (max - min)) * 100));
  }

  // 「実データとして存在するか」の判定（捏造防止の単一ゲート）。
  //  null/undefined は欠損 → false。0 は有効値 → true。
  function hasValue(fin, key) {
    return fin != null && fin[key] != null;
  }

  function unitWord(currency) {
    return currency === "USD" ? "ドル" : "円";
  }

  // 「百万ドル / 百万円」の表示単位。DB値は百万単位なので接頭辞は常に「百万」。
  // index.html 内で 6 箇所に三項演算子で重複していたのを単一源へ集約（監査 F1 完全性）。
  function fmtUnit(currency) {
    return "百万" + unitWord(currency);
  }

  // 値（百万単位）→ 兆/十億/百万 ＋ 通貨。詳細表示・吹き出し用（旧 fmtBillion 相当）。
  function fmtMagnitude(val, currency) {
    var cur = unitWord(currency);
    if (val === 0 || val == null) return "--";
    var a = Math.abs(n(val));
    if (a >= 1000000) return (val / 1000000).toFixed(2) + " 兆" + cur;
    if (a >= 1000) return (val / 1000).toFixed(1) + " 十億" + cur;
    return Number(val).toLocaleString() + " 百万" + cur;
  }

  // 軸ラベル用（簡潔版）。通貨・桁に応じて単位を切替（C4: 旧「兆円」固定の誤単位を是正）。
  function fmtAxis(val, currency) {
    var cur = unitWord(currency);
    var v = n(val);
    if (v === 0) return "0";   // 軸の0点は単位を付けず揃える（兆円/十億ドル混在の見栄え対策）
    var a = Math.abs(v);
    if (a >= 1000000) return (v / 1000000).toFixed(1) + "兆" + cur;
    if (a >= 1000) return Math.round(v / 1000) + "十億" + cur;
    return Math.round(v) + "百万" + cur;
  }

  // ── 会社規模で「1単位」を選定し、詳細ページ内（全チャート/ラベル）で統一表示する。
  //  軸ラベルの 兆/十億 混在と「単位: 百万円」表記の不整合（投資判断時の読みづらさ）を解消。
  //  値は百万単位。maxAbs = そのページの最大絶対値（百万単位）。JPY=兆円/億円/百万円、USD=兆ドル/十億ドル/百万ドル。
  //  しきい値: 1兆(=1e6百万)以上で兆。JPYは100億(=1e4百万)以上の億は整数、1〜100億は小数1桁にし「0.数兆」の見づらさを回避。
  function pickUnit(maxAbs, currency) {
    var a = Math.abs(n(maxAbs));
    var usd = currency === "USD";
    var cur = unitWord(currency);
    if (a >= 1000000) return { div: 1000000, suffix: "兆" + cur, dec: 1 };
    if (usd) {
      if (a >= 1000) return { div: 1000, suffix: "十億" + cur, dec: 1 };
      return { div: 1, suffix: "百万" + cur, dec: 0 };
    }
    if (a >= 100) return { div: 100, suffix: "億" + cur, dec: a >= 10000 ? 0 : 1 }; // 1億=100百万
    return { div: 1, suffix: "百万" + cur, dec: 0 };
  }

  // pickUnit で得た unit で値を整形。0点は単位なしで揃える。
  //  非0が指定桁で 0 に丸まる小さな値は、有効数字が出るまで小数桁を増やす（売上高基準の兆円ページで
  //  小さな CF を「0.0兆円」に潰さない＝ページ単位統一を保ちつつ精度退行と符号付き0を回避）。
  function fmtUnitValue(val, unit) {
    var v = n(val);
    if (!unit) return String(v);
    if (v === 0) return "0";
    var x = v / unit.div;
    var dec = unit.dec;
    while (parseFloat(x.toFixed(dec)) === 0 && dec < 4) dec++;
    if (parseFloat(x.toFixed(dec)) === 0) return "0";   // 4桁でも0 ≒ 実質0（符号付き0も回避）
    var s = dec === 0 ? Math.round(x).toLocaleString() : x.toFixed(dec); // 整数桁は千区切り
    return s + unit.suffix;
  }

  // 単位ラベル（ヘッダ「単位: 兆円」等）。
  function unitLabel(unit) { return unit ? unit.suffix : ""; }

  // 前年比 %。基準0/欠測は null。負基準は abs 分母（DetailRules.yoyBadge と数値一致＝単一源方針）。
  function yoy(prev, curr) {
    var p = n(prev), c = n(curr);
    if (p === 0) return null;
    return ((c - p) / Math.abs(p)) * 100;
  }
  // 年平均成長率 %。両端が正・periods>=1 のときのみ（符号反転/0基準/負ratio の非実数化を根絶）。
  function cagr(begin, end, periods) {
    var b = n(begin), e = n(end);
    if (!(b > 0) || !(e > 0) || !(periods >= 1)) return null;
    return (Math.pow(e / b, 1 / periods) - 1) * 100;
  }

  // 欠測ゲート：needKeys 全て hasValue かつ denomKeys 合計>0 の時のみ fn(fin)、そうでなければ null（CrossSection._finRatio 同型）。
  function ratioOrNull(fin, fn, needKeys, denomKeys) {
    if (!fin) return null;
    for (var i = 0; i < needKeys.length; i++) { if (!hasValue(fin, needKeys[i])) return null; }
    if (denomKeys) {
      var denom = 0;
      for (var j = 0; j < denomKeys.length; j++) denom += n(fin[denomKeys[j]]);
      if (!(denom > 0)) return null;
    }
    var v = fn(fin);
    return (typeof v === "number" && isFinite(v)) ? v : null;
  }
  // 単社の財務時系列（list の financials_trend）から field ごとの {yoy, cagr, beginYear, endYear}。
  function growthRates(trend, fields) {
    fields = fields || ["net_sales", "net_income"];
    trend = trend || {};
    var out = {};
    fields.forEach(function (field) {
      var pairs = Object.keys(trend)
        .map(function (y) { return { year: Number(y), obj: trend[y] }; })
        .filter(function (p) { return isFinite(p.year) && p.obj && p.obj[field] != null && isFinite(Number(p.obj[field])); })
        .map(function (p) { return { year: p.year, value: Number(p.obj[field]) }; })
        .sort(function (a, b) { return a.year - b.year; });
      var res = { yoy: null, cagr: null, beginYear: null, endYear: null };
      if (pairs.length >= 1) {
        var begin = pairs[0], end = pairs[pairs.length - 1];
        res.beginYear = begin.year; res.endYear = end.year;
        var prior = null;
        for (var i = 0; i < pairs.length; i++) { if (pairs[i].year === end.year - 1) prior = pairs[i]; }
        if (prior) res.yoy = yoy(prior.value, end.value);
        var periods = end.year - begin.year;
        if (periods >= 1) res.cagr = cagr(begin.value, end.value, periods);
      }
      out[field] = res;
    });
    return out;
  }

  // ×1（倍率）の共通ゲート。分母>0 かつ両者有限のときのみ numer/denom、他は null。
  // 既存 ratio/ratioOrNull は ×100 を焼込むため、回転率/レバレッジ/現金変換の「倍」には使えない。
  function divOrNull(numer, denom) {
    return (isFinite(numer) && isFinite(denom) && denom > 0) ? (numer / denom) : null;
  }
  // 総資産回転率（倍）= 売上高 / 総資産。入力欠測/分母≤0 は null。
  function assetTurnover(fin) {
    if (!fin) return null;
    if (!hasValue(fin, "net_sales") || !hasValue(fin, "current_assets") || !hasValue(fin, "non_current_assets")) return null;
    return divOrNull(n(fin.net_sales), totalAssets(fin));
  }
  // 財務レバレッジ（倍）= 総資産 / 純資産。入力欠測/分母≤0 は null。
  function equityMultiplier(fin) {
    if (!fin) return null;
    if (!hasValue(fin, "current_assets") || !hasValue(fin, "non_current_assets") || !hasValue(fin, "net_assets")) return null;
    return divOrNull(totalAssets(fin), n(fin.net_assets));
  }
  // DuPont 分解。純利益率(%)×総資産回転率(倍)×財務レバレッジ(倍) ≈ ROE(%)。各因数 null 可。
  // equity は net_assets（純資産・少数株主持分含む）＝厳密な自己資本ではない（呼出側で「純資産ベース」明示）。
  function dupont(fin) {
    fin = fin || {};
    var nm = (hasValue(fin, "net_income") && hasValue(fin, "net_sales") && n(fin.net_sales) > 0) ? netMargin(fin) : null;
    var at = assetTurnover(fin);
    var em = equityMultiplier(fin);
    var re = (hasValue(fin, "net_income") && hasValue(fin, "net_assets") && n(fin.net_assets) > 0) ? roe(fin) : null;
    return { netMargin: nm, assetTurnover: at, equityMultiplier: em, roe: re };
  }
  // 概算フリーCF = 営業CF + 投資CF（投資CFは通常負）。負値は正当（設備投資先行）。
  // 営業CF/投資CF のどちらか欠測なら null（n() の0化に頼らず hasValue でゲート）。
  function fcf(fin) {
    if (!fin) return null;
    if (!hasValue(fin, "operating_cf") || !hasValue(fin, "investing_cf")) return null;
    return n(fin.operating_cf) + n(fin.investing_cf);
  }
  // FCFマージン(%) = FCF / 売上高。売上≤0 or 入力欠測は null。
  function fcfMargin(fin) {
    return ratioOrNull(fin, function (f) { return ratio(fcf(f), f.net_sales); },
      ["operating_cf", "investing_cf", "net_sales"], ["net_sales"]);
  }
  // 現金変換率(%) = 営業CF / 純利益。利益の現金化＝収益の質。純利益≤0(赤字年)/欠測は null。
  //  ⚠ null*100=0 の落とし穴を回避（divOrNull が null を返したら null のまま返す）。
  function cashConversion(fin) {
    if (!fin || !hasValue(fin, "operating_cf")) return null;
    var c = divOrNull(n(fin.operating_cf), n(fin.net_income));
    return c === null ? null : c * 100;
  }

  return {
    n: n,
    pickUnit: pickUnit,
    fmtUnitValue: fmtUnitValue,
    unitLabel: unitLabel,
    ratio: ratio,
    totalAssets: totalAssets,
    totalLiabilities: totalLiabilities,
    equityRatio: equityRatio,
    currentRatio: currentRatio,
    opMargin: opMargin,
    netMargin: netMargin,
    roe: roe,
    roa: roa,
    clampScore: clampScore,
    hasValue: hasValue,
    unitWord: unitWord,
    fmtUnit: fmtUnit,
    fmtMagnitude: fmtMagnitude,
    fmtAxis: fmtAxis,
    yoy: yoy,
    cagr: cagr,
    growthRates: growthRates,
    ratioOrNull: ratioOrNull,
    divOrNull: divOrNull,
    assetTurnover: assetTurnover,
    equityMultiplier: equityMultiplier,
    dupont: dupont,
    fcf: fcf,
    fcfMargin: fcfMargin,
    cashConversion: cashConversion,
  };
});
