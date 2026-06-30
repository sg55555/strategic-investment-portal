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

  return {
    n: n,
    ratio: ratio,
    totalAssets: totalAssets,
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
  };
});
