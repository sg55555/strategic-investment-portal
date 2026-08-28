/* scratchpad/w35-variants.js — W3.5「月次パック」モック3案（A/B/C）の実物比較用オーバーレイ。
 *
 * 位置づけ: **捨てコードのプロトタイプ**。本実装では業務 math を money-rules.js（＋Python 鏡像）へ、
 *           描画を money.js へ書く。ここでは money.js が描いた DOM に **追加だけ** して見た目を試す。
 *
 * 読み込まれ方: scratchpad/w35-mock-server.py が index.html の </body> 直前に <script> を注入する
 *              （index.html / money.js / money-rules.js / money.css は 1バイトも変更しない）。
 *
 * URL パラメータ:
 *   ?w35variant=A|B|C   月次レポートの置き場（既定 A）
 *                         A = タブバー3本目「03 月次レポート」＋専用ペイン
 *                         B = ダッシュボードの fold「月次レポート」（既定 closed）
 *                         C = 収支 fold の本文末尾に直付け（新 fold/タブなし）
 *   &w35now=YYYY-MM-DD  「今日」を差し替える（既定＝実際の今日）。月の経過%・進行中月の判定に使う。
 *
 * 共通で足すもの（案に依らない）:
 *   ① 設定・ガイドタブのカード「月の予算」（#mcc-sec-budget-card）＝合計予算＋費目別予算の入力
 *   ② ダッシュボードの fold「今月の予算」（#mcc-sec-budget-live）＝進行中月の消化バー
 *   ③ 月次レポート本体（月ナビ＋KPI＋資産＋予算 vs 実績＋費目＋現在地）
 *
 * 不変条件:
 *   - 例外を外に投げない（すべて try/catch＋console.error）。money.js の描画を壊さない。
 *   - money.js が描いた既存ノードを innerHTML で置換しない（append / insertBefore のみ）。
 *     innerHTML を使うのは **このオーバーレイが自分で作ったコンテナの中身だけ**。
 *   - render() のたびに注入し直す（マーカー .w35m の有無で二重注入を防ぐ）。
 *   - 予算の入力は画面内の再計算だけ（保存 API は叩かない）。
 */
(function () {
  "use strict";

  var LOG = "[w35m]";
  var MARK = "w35m";
  var VARIANTS = { A: 1, B: 1, C: 1 };

  // ---------------------------------------------------------------- params
  var Q = null;
  try { Q = new URLSearchParams(location.search); } catch (e) { Q = null; }
  function param(k) { try { return Q ? (Q.get(k) || "") : ""; } catch (e) { return ""; } }

  var VARIANT = String(param("w35variant") || "A").toUpperCase();
  if (!VARIANTS[VARIANT]) VARIANT = "A";

  var NOW_RAW = param("w35now");
  var NOW_Y, NOW_M1, NOW_D;
  (function () {
    if (/^\d{4}-\d{2}-\d{2}$/.test(NOW_RAW)) {
      NOW_Y = +NOW_RAW.slice(0, 4); NOW_M1 = +NOW_RAW.slice(5, 7); NOW_D = +NOW_RAW.slice(8, 10);
      if (NOW_M1 >= 1 && NOW_M1 <= 12 && NOW_D >= 1 && NOW_D <= 31) return;
    }
    var d = new Date();
    NOW_Y = d.getFullYear(); NOW_M1 = d.getMonth() + 1; NOW_D = d.getDate();
  })();
  var NOW_PERIOD = NOW_Y + "-" + (NOW_M1 < 10 ? "0" + NOW_M1 : NOW_M1) + "-01";
  var NOW_ISO = NOW_PERIOD.slice(0, 8) + (NOW_D < 10 ? "0" + NOW_D : NOW_D);

  // 月の経過%（UTC 暦・日/その月の日数）。進行中月のバーの目盛線と watch 判定に使う。
  function daysInMonth(y, m1) { return new Date(Date.UTC(y, m1, 0)).getUTCDate(); }
  var ELAPSED_PCT = Math.min(100, NOW_D / daysInMonth(NOW_Y, NOW_M1) * 100);

  // ---------------------------------------------------------------- utils
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function yen(n) { return "¥" + Math.round(num(n)).toLocaleString("ja-JP"); }
  function yenSigned(n) {
    var x = Math.round(num(n));
    if (x === 0) return "±¥0";
    return (x < 0 ? "−¥" : "+¥") + Math.abs(x).toLocaleString("ja-JP");   // − は U+2212
  }
  function pctSigned(p) {
    if (p === null || p === undefined || !isFinite(p)) return "";
    var s = p > 0 ? "+" : (p < 0 ? "−" : "±");
    return s + Math.abs(p).toFixed(1) + "%";
  }
  function ptSigned(p) {
    var s = p > 0 ? "+" : (p < 0 ? "−" : "±");
    return s + Math.abs(p).toFixed(1) + "pt";
  }
  function rp(p) { return Math.round(num(p)); }                 // 表示用の丸め%
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function ymi(period) { return (+period.slice(0, 4)) * 12 + (+period.slice(5, 7) - 1); }
  function periodOf(i) { var y = Math.floor(i / 12), m = i % 12 + 1; return y + "-" + (m < 10 ? "0" + m : m) + "-01"; }
  function ymLabel(period) { return (+period.slice(0, 4)) + "年" + (+period.slice(5, 7)) + "月"; }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function insertAfter(node, ref) {
    if (!ref || !ref.parentNode) return false;
    if (ref.nextSibling) ref.parentNode.insertBefore(node, ref.nextSibling);
    else ref.parentNode.appendChild(node);
    return true;
  }
  // 前月比/前年同月比の1行（値が無ければ「—」）。kind: yen|pt
  function cmpLine(label, cur, prev, kind) {
    if (prev === null || prev === undefined) return esc(label) + " —";
    if (kind === "pt") return esc(label) + " " + esc(ptSigned(cur - prev));
    var d = cur - prev;
    var pc = prev !== 0 ? (d / Math.abs(prev)) * 100 : null;
    return esc(label) + " " + esc(yenSigned(d)) + (pc === null ? "" : "（" + esc(pctSigned(pc)) + "）");
  }

  // ---------------------------------------------------------------- style
  var CSS = [
    /* --- 共通（色は money.css の --c-* トークンのみ。矩形＋細縁＝theme D と揃える） --- */
    '.w35m-sec{margin-top:16px;padding-top:14px;border-top:1px dashed rgba(129,140,248,0.22);}',
    '.w35m-sec:first-child{margin-top:0;padding-top:0;border-top:none;}',
    '.w35m-note{font-size:11.5px;line-height:1.65;color:var(--c-text-faint);margin:4px 0 8px;}',
    '.w35m-note b{color:var(--c-text-bright);font-weight:700;}',
    '.w35m-empty{font-size:12px;line-height:1.6;color:var(--c-text-dim);}',

    /* --- バー（高さは .mcc-goal-bar と同じ 10px） --- */
    '.w35m-bar{position:relative;flex:1 1 auto;min-width:0;height:10px;border-radius:6px;',
    '  background:rgba(255,255,255,0.06);overflow:hidden;}',
    '.w35m-bar.tick{overflow:visible;}',
    '.w35m-fill{display:block;height:100%;border-radius:6px;',
    '  background:linear-gradient(90deg,var(--c-indigo),var(--c-indigo-bright));}',
    '.w35m-fill.watch{background:linear-gradient(90deg,var(--c-amber-deep),var(--c-amber-bright));}',
    '.w35m-fill.over{background:linear-gradient(90deg,var(--c-danger),var(--c-danger-soft));}',
    '.w35m-fill.share{background:linear-gradient(90deg,var(--c-cyan),var(--c-cyan-bright));}',
    '.w35m-tick{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--c-text-dim);opacity:0.85;}',
    '.w35m-barrow{display:flex;align-items:center;gap:8px;}',
    '.w35m-overlab{flex:none;font-size:11px;font-weight:700;color:var(--c-danger-soft);white-space:nowrap;}',

    /* --- 予算バーの行 --- */
    '.w35m-bhead{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;margin-bottom:10px;}',
    '.w35m-bhead-t{color:var(--c-text-bright);font-size:0.94rem;font-weight:700;}',
    '.w35m-bhead-s{color:var(--c-amber);font-size:12px;}',
    '.w35m-btot{margin-bottom:12px;padding:10px 12px;border-radius:8px;',
    '  background:rgba(56,189,248,0.06);border-left:3px solid var(--c-cyan);}',
    '.w35m-btot.over{background:rgba(255,0,61,0.07);border-left-color:var(--c-danger-soft);}',
    '.w35m-btot-l{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px;',
    '  color:var(--c-text-bright);font-size:12px;margin-bottom:7px;}',
    '.w35m-btot-l strong{color:var(--c-cyan-bright);font-size:0.98rem;font-weight:700;}',
    '.w35m-btot.over .w35m-btot-l strong{color:var(--c-danger-soft);}',
    '.w35m-brow{margin-bottom:9px;}',
    '.w35m-brow-l{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:4px;}',
    '.w35m-bnm{color:var(--c-text-bright);font-size:12px;font-weight:700;}',
    '.w35m-bvl{color:var(--c-text-dim);font-size:11.5px;}',
    '.w35m-brow.over .w35m-bnm{color:var(--c-danger-soft);}',
    '.w35m-brow.watch .w35m-bnm{color:var(--c-amber-bright);}',
    '.w35m-chips{display:flex;flex-wrap:wrap;align-items:center;gap:5px;margin-top:10px;}',
    '.w35m-chips-lb{color:var(--c-text-faint);font-size:11.5px;margin-right:2px;}',
    '.w35m-chip{color:var(--c-text-dim);font-size:12px;padding:2px 7px;border-radius:5px;',
    '  background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);}',
    '.w35m-link{background:none;border:1px solid rgba(0,229,255,0.35);color:var(--c-cyan-pale);',
    '  border-radius:4px;padding:2px 8px;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;}',
    '.w35m-link:hover{background:rgba(0,229,255,0.1);}',

    /* --- 設定タブ「月の予算」カード --- */
    '.w35m-cfg-tot{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px;margin-bottom:6px;}',
    '.w35m-cfg-tot .mcc-field{flex:0 0 190px;margin-top:0;}',
    '.w35m-cfg-side{flex:1 1 200px;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:8px;',
    '  padding-bottom:7px;}',
    '.w35m-cfg-avg{color:var(--c-text-dim);font-size:12px;}',
    '.w35m-cfg-avg b{color:var(--c-text-bright);font-weight:700;}',
    '.w35m-adopt{background:rgba(56,189,248,0.14);border:1px solid rgba(56,189,248,0.38);color:var(--c-cyan-pale);',
    '  padding:4px 10px;border-radius:6px;cursor:pointer;font:inherit;font-size:11px;font-weight:700;}',
    '.w35m-adopt:hover{background:rgba(56,189,248,0.24);}',
    '.w35m-adopt.mini{padding:2px 7px;font-size:11px;}',
    '.w35m-btab{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px;}',
    '.w35m-btab th,.w35m-btab td{padding:4px 6px;text-align:right;}',
    '.w35m-btab thead th{color:var(--c-text-dim);font-weight:normal;font-size:12px;}',
    '.w35m-btab tbody th{text-align:left;color:var(--c-text-bright);font-weight:700;white-space:nowrap;}',
    '.w35m-btab tbody tr{border-top:1px solid rgba(255,255,255,0.06);}',
    '.w35m-btab input{width:100%;min-width:72px;background:rgba(0,0,0,0.3);border:1px solid rgba(129,140,248,0.3);',
    '  color:#fff;border-radius:6px;padding:5px 7px;font-size:0.8rem;text-align:right;}',
    '.w35m-btab .w35m-miss{color:var(--c-text-faint);font-size:11px;text-align:left;}',

    /* --- 月次レポート --- */
    '.w35m-report{min-width:0;}',
    '.w35m-rnav{display:flex;align-items:center;gap:10px;margin-bottom:12px;}',
    '.w35m-navbtn{flex:none;background:rgba(0,0,0,0.35);border:1px solid rgba(129,140,248,0.28);',
    '  color:var(--c-text-dim);border-radius:4px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer;}',
    '.w35m-navbtn:hover:not([disabled]){border-color:rgba(0,229,255,0.4);color:var(--c-cyan-pale);}',
    '.w35m-navbtn[disabled]{opacity:0.35;cursor:default;}',
    '.w35m-rtitle{flex:1 1 auto;min-width:0;display:flex;flex-wrap:wrap;align-items:baseline;gap:8px;',
    '  color:var(--c-text-bright);font-size:0.96rem;font-weight:700;}',
    '.w35m-badge{flex:none;font-size:11px;font-weight:700;letter-spacing:0.5px;padding:1px 7px;border-radius:4px;',
    '  border:1px solid rgba(129,140,248,0.35);color:var(--c-text-dim);}',
    '.w35m-badge.conf{border-color:rgba(0,230,118,0.4);color:var(--c-emerald-soft);}',
    '.w35m-badge.prov{border-color:rgba(255,179,0,0.45);color:var(--c-amber-pale);}',
    '.w35m-badge.latest{border-color:rgba(0,229,255,0.45);color:var(--c-cyan-pale);}',
    '.w35m-kpi .mcc-cf-stat em{font-style:normal;color:var(--c-text-faint);font-size:11px;line-height:1.5;}',
    '.w35m-asset{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:10px;',
    '  padding:10px 12px;border-radius:8px;background:rgba(129,140,248,0.07);',
    '  border-left:3px solid var(--c-indigo-bright);margin-bottom:4px;}',
    '.w35m-asset-l{display:flex;flex-direction:column;gap:3px;}',
    '.w35m-asset-l span{color:var(--c-text-dim);font-size:12px;}',
    '.w35m-asset-l strong{color:var(--c-indigo-pale);font-size:1.05rem;font-weight:700;}',
    '.w35m-asset-r{display:flex;flex-direction:column;gap:3px;text-align:right;}',
    '.w35m-sub{color:var(--c-text-faint);font-size:11.5px;line-height:1.5;}',
    '.w35m-sub b{color:var(--c-text-bright);font-weight:700;}',
    '.w35m-crow{margin-bottom:8px;}',
    '.w35m-crow-l{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:6px;margin-bottom:4px;}',
    '.w35m-cnm{color:var(--c-text-bright);font-size:12px;font-weight:700;}',
    '.w35m-cvl{color:var(--c-text-dim);font-size:11.5px;}',
    '.w35m-crest{color:var(--c-text-faint);font-size:11.5px;margin-top:6px;}',
    '.w35m-nrow{color:var(--c-text-bright);font-size:12px;line-height:1.75;}',
    '.w35m-nrow b{color:var(--c-cyan-bright);font-weight:700;}',

    /* --- fold のアクセント（案 B の「月次レポート」／共通の「今月の予算」） --- */
    '.mcc-fold-budget{border-color:rgba(255,179,0,0.28)!important;}',
    '.mcc-fold-budget>summary .mcc-fold-nm{color:var(--c-amber-bright);}',
    '.mcc-fold-w35r{border-color:rgba(129,140,248,0.35)!important;}',
    '.mcc-fold-w35r>summary .mcc-fold-nm{color:var(--c-indigo-soft);}',
    /* 案 C: 収支 fold 末尾に足す月次レポートのブロック */
    '.w35m-cblock{margin-top:16px;padding-top:14px;border-top:1px dashed rgba(129,140,248,0.22);}',

    /* --- 切替パネル（モック専用・本実装には出さない） --- */
    '.w35m-panel{position:fixed;right:12px;bottom:12px;z-index:99999;background:rgba(4,7,12,0.93);',
    '  border:1px solid rgba(0,229,255,0.35);border-radius:6px;padding:8px 10px;font-size:11px;line-height:1.5;',
    '  color:#d4e2ea;font-family:ui-monospace,Menlo,Consolas,monospace;box-shadow:0 6px 22px rgba(0,0,0,0.55);',
    '  max-width:210px;}',
    '.w35m-panel-h{font-weight:700;letter-spacing:1px;color:#62f0ff;margin-bottom:5px;}',
    '.w35m-panel-r{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:3px;}',
    '.w35m-panel-r>span{color:#7f95a3;width:34px;flex:none;}',
    '.w35m-panel a{color:#d4e2ea;text-decoration:none;border:1px solid rgba(129,140,248,0.3);border-radius:3px;',
    '  padding:1px 6px;cursor:pointer;}',
    '.w35m-panel a.on{border-color:rgba(0,229,255,0.7);color:#62f0ff;background:rgba(0,229,255,0.12);}',
    '.w35m-panel b{color:#39ff8b;font-weight:700;}',

    /* --- 狭幅 --- */
    '@media (max-width:600px){',
    /* 3本目のタブを足すと 390px では1行に収まらない → 折返しを許す（本実装では要検討＝報告参照） */
    '  .mcc-tabbar{flex-wrap:wrap;}',
    '  .w35m-btab,.w35m-btab tbody,.w35m-btab tr,.w35m-btab td,.w35m-btab th{display:block;}',
    '  .w35m-btab thead{display:none;}',
    '  .w35m-btab tbody tr{border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:8px;margin-bottom:8px;}',
    '  .w35m-btab td::before{content:attr(data-label);float:left;color:var(--c-text-dim);font-size:12px;}',
    '  .w35m-btab td{text-align:right;padding:3px 0;}',
    '  .w35m-btab tbody th{padding:0 0 4px;}',
    '  .w35m-btab input{width:auto;max-width:56%;}',
    '  .w35m-cfg-tot .mcc-field{flex:1 1 100%;}',
    '  .w35m-asset-r{text-align:left;}',
    '  .w35m-panel{max-width:140px;font-size:10px;padding:6px 7px;right:6px;bottom:6px;}',
    '  .w35m-panel-r>span{width:26px;}',
    '}',
  ].join("\n");

  function injectStyle() {
    try {
      if (document.getElementById("w35m-style")) return;
      var s = document.createElement("style");
      s.id = "w35m-style";
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { console.error(LOG, "style", e); }
  }

  // ================================================================ model
  var MODEL = null;
  var _budgetTotal = 0;        // 画面内で編集される合計予算（保存はしない）
  var _budgetItems = [];       // 画面内で編集される費目予算 [{name, amount}]
  var _reportPeriod = "";      // レポートが表示中の月
  var _reportTabOn = false;    // 案 A: 3本目タブが選択中か（money.js の再描画を跨いで保持）
  var _openBudget = true;      // 「今月の予算」fold の開閉（再描画を跨いで保持）
  var _openReport = false;     // 案 B「月次レポート」fold の開閉（既定 closed）

  function normRows(raw) {
    if (!Array.isArray(raw)) return [];
    return raw.filter(function (r) {
      return r && typeof r === "object" && typeof r.period === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.period);
    }).map(function (r) {
      var cats = [], map = {};
      var bd = r.breakdown && r.breakdown.categories;
      if (Array.isArray(bd)) {
        bd.forEach(function (c) {
          if (!c || typeof c.name !== "string") return;
          var a = num(c.amount);
          map[c.name] = (map[c.name] || 0) + a;
        });
        Object.keys(map).forEach(function (n) { cats.push({ name: n, amount: map[n] }); });
        cats.sort(function (a, b) { return b.amount - a.amount; });
      }
      return {
        period: r.period, ymi: ymi(r.period),
        income: num(r.total_income), salary: num(r.salary_income), misc: num(r.misc_income),
        fixed: num(r.fixed_expense), variable: num(r.variable_expense), expense: num(r.total_expense),
        balance: num(r.balance), savingsRate: num(r.savings_rate),
        isComplete: r.is_complete !== false,
        cats: cats, catMap: map,
      };
    }).sort(function (a, b) { return a.ymi - b.ymi; });
  }

  // アンカー月初の現金を固定点に、確定収支を前後へ累積（money-rules.js assetSeries と同じ式）。
  // R（window.MCCRules）が使えるときはそちらを正とし、これは degrade 用のフォールバック。
  function fallbackSeries(state, rows) {
    var out = { available: false, byPeriod: {}, points: [], totalAssets: 0 };
    try {
      var a = state && state.anchor;
      if (!a || !/^\d{4}-\d{2}/.test(String(a.date || ""))) return out;
      var inv = num(state.buckets && state.buckets.core && state.buckets.core.amount) +
                num(state.buckets && state.buckets.satellite && state.buckets.satellite.amount);
      var by = {}; rows.forEach(function (r) { by[r.period] = r; });
      var anchorP = String(a.date).slice(0, 8) + "01";
      var ai = ymi(anchorP), cash = num(a.amount), pts = [];
      // 後方（アンカー月の前月＝アンカー額そのもの）
      pts.push({ period: periodOf(ai - 1), cash: cash, invest: inv, total: cash + inv, isComplete: true });
      var c = cash, i = ai - 1;
      while (true) {
        var br = by[periodOf(i)];
        if (!br || !br.isComplete) break;
        c = c - br.balance; i = i - 1;
        pts.unshift({ period: periodOf(i), cash: c, invest: inv, total: c + inv, isComplete: true });
      }
      // 前方
      c = cash; i = ai;
      while (true) {
        var fr = by[periodOf(i)];
        if (!fr) break;
        c = c + fr.balance;
        pts.push({ period: periodOf(i), cash: c, invest: inv, total: c + inv, isComplete: fr.isComplete });
        if (!fr.isComplete) break;
        i = i + 1;
      }
      pts.forEach(function (p) { out.byPeriod[p.period] = p; });
      out.points = pts;
      out.available = pts.length > 0;
      for (var k = pts.length - 1; k >= 0; k--) { if (pts[k].isComplete) { out.totalAssets = pts[k].total; break; } }
    } catch (e) { console.error(LOG, "fallbackSeries", e); }
    return out;
  }

  function buildSeries(state, raw, rows) {
    try {
      var R = window.MCCRules;
      if (R && R.effectiveState && R.assetSeries) {
        var eff = R.effectiveState(state, raw, [], Date.now());
        var s = R.assetSeries(eff, raw, []);
        if (s && s.available && s.points && s.points.length) {
          var out = { available: true, byPeriod: {}, points: s.points, source: "MCCRules",
                      totalAssets: R.totalAssets ? R.totalAssets(eff) : 0 };
          s.points.forEach(function (p) { out.byPeriod[p.period] = p; });
          if (!out.totalAssets && s.latestCompleteIndex >= 0) out.totalAssets = s.points[s.latestCompleteIndex].total;
          return out;
        }
      }
    } catch (e) { console.error(LOG, "assetSeries", e); }
    var fb = fallbackSeries(state, rows);
    fb.source = "fallback";
    return fb;
  }

  function buildModel(state, raw) {
    var s = state && typeof state === "object" ? state : {};
    var rows = normRows(raw);
    var byPeriod = {}; rows.forEach(function (r) { byPeriod[r.period] = r; });
    var complete = rows.filter(function (r) { return r.isComplete; });
    var latest = complete.length ? complete[complete.length - 1] : null;
    var live = byPeriod[NOW_PERIOD] && !byPeriod[NOW_PERIOD].isComplete ? byPeriod[NOW_PERIOD] : null;
    if (!live) {
      for (var i = rows.length - 1; i >= 0; i--) { if (!rows[i].isComplete) { live = rows[i]; break; } }
    }
    var b = s.budgets && typeof s.budgets === "object" ? s.budgets : {};
    _budgetTotal = num(b.total);
    _budgetItems = (Array.isArray(b.items) ? b.items : []).filter(function (x) {
      return x && typeof x.name === "string" && x.name;
    }).map(function (x) { return { name: x.name, amount: num(x.amount) }; });

    return {
      state: s, raw: raw, rows: rows, byPeriod: byPeriod, complete: complete,
      latest: latest, live: live,
      series: buildSeries(s, raw, rows),
      goals: Array.isArray(s.goals) ? s.goals : [],
      nisa: s.nisa && typeof s.nisa === "object" ? s.nisa : null,
    };
  }

  // ---------------------------------------------------------------- budget math
  function budgetOf(name) {
    for (var i = 0; i < _budgetItems.length; i++) if (_budgetItems[i].name === name) return _budgetItems[i];
    return null;
  }
  function setBudget(name, amount) {
    var it = budgetOf(name);
    if (it) { it.amount = Math.max(0, num(amount)); return; }
    _budgetItems.push({ name: name, amount: Math.max(0, num(amount)) });
  }
  function itemsSum() {
    var t = 0; _budgetItems.forEach(function (x) { t += Math.max(0, num(x.amount)); }); return t;
  }
  // 直近 n ヶ月（確定月のみ）の平均。cat=null なら支出合計の平均。
  function avgOf(cat, n) {
    if (!MODEL) return 0;
    var c = MODEL.complete.slice(-n);
    if (!c.length) return 0;
    var t = 0;
    c.forEach(function (r) { t += (cat === null ? r.expense : (r.catMap[cat] || 0)); });
    return t / c.length;
  }
  // 直近12ヶ月（進行中月も含む）に実績が出た費目
  function observedCats(n) {
    if (!MODEL) return [];
    var win = MODEL.rows.slice(-n), seen = {}, out = [];
    win.forEach(function (r) { r.cats.forEach(function (c) { if (c.amount > 0) seen[c.name] = 1; }); });
    Object.keys(seen).forEach(function (k) { out.push(k); });
    return out;
  }

  // 予算 vs 実績の1ビュー。live=true なら進行中月（経過%の目盛線・watch 判定つき）。
  function budgetView(row, live) {
    var elapsed = live ? ELAPSED_PCT : 100;
    var items = [], used = {}, overCount = 0;
    _budgetItems.forEach(function (b) {
      var budget = Math.max(0, num(b.amount));
      if (!(budget > 0)) return;
      used[b.name] = 1;
      var actual = row ? num(row.catMap[b.name]) : 0;
      var pct = actual / budget * 100;
      var status = "ok";
      if (actual > budget) { status = "over"; overCount++; }
      else if (live && actual < budget && (pct > elapsed + 10 || pct >= 90)) status = "watch";
      items.push({ name: b.name, budget: budget, actual: actual, pct: pct, status: status,
                   over: Math.max(0, actual - budget), remain: Math.max(0, budget - actual) });
    });
    items.sort(function (x, y) { return y.pct - x.pct; });
    var un = [];
    (row ? row.cats : []).forEach(function (c) {
      if (used[c.name] || !(c.amount > 0)) return;
      un.push({ name: c.name, amount: c.amount });
    });
    un.sort(function (x, y) { return y.amount - x.amount; });
    var actualTotal = row ? row.expense : 0;
    return {
      elapsed: elapsed, live: !!live, items: items, unbudgeted: un, overCount: overCount,
      total: _budgetTotal, actual: actualTotal,
      pct: _budgetTotal > 0 ? actualTotal / _budgetTotal * 100 : 0,
      remain: _budgetTotal - actualTotal,
    };
  }

  function budgetBarsHtml(bv, opts) {
    opts = opts || {};
    var h = "";
    // 合計バー
    var tOver = bv.actual > bv.total && bv.total > 0;
    h += '<div class="w35m-btot' + (tOver ? " over" : "") + '">' +
      '<div class="w35m-btot-l"><span>支出 合計 <strong>' + esc(yen(bv.actual)) + '</strong> / ' +
        esc(yen(bv.total)) + '（' + rp(bv.pct) + '%）</span>' +
      '<span>' + (bv.remain >= 0 ? "残り " + esc(yen(bv.remain)) : "超過 " + esc(yen(-bv.remain))) + '</span></div>' +
      '<div class="w35m-barrow"><span class="w35m-bar' + (bv.live ? " tick" : "") + '">' +
        '<span class="w35m-fill' + (tOver ? " over" : "") + '" style="width:' + clamp(bv.pct, 0, 100).toFixed(1) + '%"></span>' +
        (bv.live ? '<span class="w35m-tick" style="left:' + clamp(bv.elapsed, 0, 100).toFixed(1) + '%" title="月の経過 ' + rp(bv.elapsed) + '%"></span>' : "") +
      '</span></div></div>';
    // 費目バー
    if (!bv.items.length) {
      h += '<div class="w35m-empty">費目の予算が未設定です。</div>';
    } else {
      bv.items.forEach(function (it) {
        var vl = esc(yen(it.actual)) + " / " + esc(yen(it.budget)) + "（" + rp(it.pct) + "%）" +
          (it.status === "over" ? "" : "・残り " + esc(yen(it.remain)));
        h += '<div class="w35m-brow ' + it.status + '">' +
          '<div class="w35m-brow-l"><span class="w35m-bnm">' + esc(it.name) + '</span>' +
            '<span class="w35m-bvl">' + vl + '</span></div>' +
          '<div class="w35m-barrow"><span class="w35m-bar">' +
            '<span class="w35m-fill ' + it.status + '" style="width:' + clamp(it.pct, 0, 100).toFixed(1) + '%"></span></span>' +
            (it.status === "over" ? '<span class="w35m-overlab">超過 ' + esc(yen(it.over)) + '</span>' : "") +
          '</div></div>';
      });
    }
    // 予算なしの費目
    if (bv.unbudgeted.length) {
      var top = bv.unbudgeted.slice(0, 5);
      h += '<div class="w35m-chips"><span class="w35m-chips-lb">予算なしの費目：</span>' +
        top.map(function (c) { return '<span class="w35m-chip">' + esc(c.name) + " " + esc(yen(c.amount)) + "</span>"; }).join("") +
        (bv.unbudgeted.length > top.length ? '<span class="w35m-chip">ほか ' + (bv.unbudgeted.length - top.length) + "費目</span>" : "") +
        (opts.link === false ? "" : '<button type="button" class="w35m-link" data-w35="tobudget">「月の予算」で設定</button>') +
        "</div>";
    }
    return h;
  }

  // ================================================================ 設定タブ「月の予算」カード
  function cfgCardHtml() {
    var avgTotal = avgOf(null, 3);
    var obs = observedCats(12);
    var rows = obs.map(function (n) { return { name: n, avg: avgOf(n, 3), budget: budgetOf(n) }; });
    rows.sort(function (a, b) { return b.avg - a.avg; });
    var missing = _budgetItems.filter(function (b) { return obs.indexOf(b.name) < 0; })
      .map(function (b) { return { name: b.name, avg: null, budget: b }; });
    var all = rows.concat(missing);

    var body = '<div class="w35m-cfg-tot">' +
      '<label class="mcc-field"><span>月の支出予算（合計）</span>' +
        '<input type="number" min="0" step="1000" id="w35m-bt-total" value="' + Math.round(_budgetTotal) + '"></label>' +
      '<div class="w35m-cfg-side">' +
        '<span class="w35m-cfg-avg">実支出の平均 <b>' + esc(yen(avgTotal)) + '</b>/月（直近3ヶ月・確定月のみ）</span>' +
        '<button type="button" class="w35m-adopt" data-w35="adopt-total">平均を採用</button>' +
      '</div></div>';

    body += '<table class="w35m-btab"><thead><tr>' +
      '<th style="text-align:left">費目</th><th>直近3ヶ月平均</th><th>予算</th><th></th>' +
      '</tr></thead><tbody>' +
      all.map(function (r) {
        var val = r.budget && r.budget.amount > 0 ? Math.round(r.budget.amount) : "";
        return "<tr>" +
          '<th scope="row">' + esc(r.name) + "</th>" +
          '<td data-label="直近3ヶ月平均">' + (r.avg === null
            ? '<span class="w35m-miss">直近12ヶ月に実績なし</span>' : esc(yen(r.avg))) + "</td>" +
          '<td data-label="予算"><input type="number" min="0" step="1000" value="' + val +
            '" data-w35cat="' + esc(r.name) + '" placeholder="未設定"></td>' +
          '<td data-label="">' + (r.avg === null ? "" :
            '<button type="button" class="w35m-adopt mini" data-w35avg="' + esc(r.name) + '">平均を採用</button>') + "</td>" +
        "</tr>";
      }).join("") +
      "</tbody></table>";

    body += '<div class="w35m-note" id="w35m-bt-note">' + cfgNoteHtml() + "</div>";
    return body;
  }
  function cfgNoteHtml() {
    var sum = itemsSum();
    var pc = _budgetTotal > 0 ? sum / _budgetTotal * 100 : 0;
    return "費目の合計 <b>" + esc(yen(sum)) + "</b>（合計予算の <b>" + rp(pc) + "%</b>）";
  }

  function makeCfgCard() {
    var card = el("div", "mcc-cfg-card " + MARK);
    card.id = "mcc-sec-budget-card";
    card.innerHTML =
      '<div class="mcc-section-title">月の予算</div>' +
      '<div class="mcc-section-desc">月の支出予算（合計）と費目ごとの予算を決めます。ダッシュボードの「今月の予算」と月次レポートの「予算 vs 実績」がこの値を使います。</div>' +
      cfgCardHtml();
    wireCfgCard(card);
    return card;
  }

  function wireCfgCard(card) {
    try {
      var note = card.querySelector("#w35m-bt-note");
      var total = card.querySelector("#w35m-bt-total");
      function refresh() {
        if (note) note.innerHTML = cfgNoteHtml();
        repaintLive();
        repaintReport();
      }
      if (total) {
        total.addEventListener("change", function () {
          _budgetTotal = Math.max(0, num(total.value));
          refresh();
        });
      }
      var cats = card.querySelectorAll("input[data-w35cat]");
      for (var i = 0; i < cats.length; i++) {
        (function (inp) {
          inp.addEventListener("change", function () {
            setBudget(inp.getAttribute("data-w35cat"), inp.value === "" ? 0 : num(inp.value));
            refresh();
          });
        })(cats[i]);
      }
      card.addEventListener("click", function (ev) {
        try {
          var t = ev.target;
          if (!t || !t.getAttribute) return;
          if (t.getAttribute("data-w35") === "adopt-total") {
            var a = Math.round(avgOf(null, 3));
            _budgetTotal = a;
            if (total) total.value = a;
            refresh();
            return;
          }
          var cn = t.getAttribute("data-w35avg");
          if (cn) {
            var v = Math.round(avgOf(cn, 3));
            setBudget(cn, v);
            var box = card.querySelector('input[data-w35cat="' + cn.replace(/"/g, '\\"') + '"]');
            if (box) box.value = v;
            refresh();
          }
        } catch (e) { console.error(LOG, "cfg click", e); }
      });
    } catch (e) { console.error(LOG, "wireCfgCard", e); }
  }

  // ================================================================ 「今月の予算」fold
  function liveDigestHtml() {
    if (!MODEL || !MODEL.live) return "進行中の月はありません";
    var bv = budgetView(MODEL.live, true);
    return "消化 <b>" + rp(bv.pct) + "%</b>・月 " + rp(bv.elapsed) + "% 経過" +
      (bv.overCount ? "・超過 <b>" + bv.overCount + "費目</b>" : "");
  }
  function liveBodyHtml() {
    if (!MODEL || !MODEL.live) return '<div class="w35m-empty">進行中の月の収支データがありません。</div>';
    var row = MODEL.live;
    var bv = budgetView(row, true);
    return '<div class="w35m-bhead"><span class="w35m-bhead-t">' + esc(ymLabel(row.period)) + "</span>" +
      '<span class="w35m-bhead-s">（進行中・月の ' + rp(bv.elapsed) + "% 経過）</span></div>" +
      budgetBarsHtml(bv, {});
  }
  function makeLiveFold() {
    var det = document.createElement("details");
    det.className = "mcc-fold mcc-fold-budget " + MARK;
    det.id = "mcc-sec-budget-live";
    if (_openBudget) det.open = true;
    det.innerHTML =
      '<summary><span class="mcc-fold-mk"></span><span class="mcc-fold-nm">今月の予算</span>' +
      '<span class="mcc-fold-dg">' + liveDigestHtml() + "</span></summary>" +
      '<div class="mcc-fold-body"><div class="w35m-livebody"></div></div>';
    var body = det.querySelector(".w35m-livebody");
    body.innerHTML = liveBodyHtml();
    det.addEventListener("toggle", function () { _openBudget = !!det.open; });
    wireDelegates(body);
    return det;
  }
  function repaintLive() {
    try {
      var det = document.getElementById("mcc-sec-budget-live");
      if (!det) return;
      var body = det.querySelector(".w35m-livebody");
      if (body) { body.innerHTML = liveBodyHtml(); wireDelegates(body); }
      var dg = det.querySelector("summary .mcc-fold-dg");
      if (dg) dg.innerHTML = liveDigestHtml();
    } catch (e) { console.error(LOG, "repaintLive", e); }
  }

  // ================================================================ 月次レポート本体
  function seriesPoint(period) {
    var s = MODEL && MODEL.series;
    return s && s.byPeriod ? (s.byPeriod[period] || null) : null;
  }
  function kpiTile(label, valueHtml, subs) {
    return '<div class="mcc-cf-stat"><span>' + esc(label) + "</span>" + valueHtml +
      subs.map(function (x) { return '<em>' + x + "</em>"; }).join("") + "</div>";
  }
  function reportHtml(period) {
    if (!MODEL) return '<div class="w35m-empty">読み込み中です。</div>';
    var row = MODEL.byPeriod[period];
    if (!row) return '<div class="w35m-empty">この月の収支データがありません。</div>';
    var i = MODEL.rows.indexOf(row);
    var prev = MODEL.byPeriod[periodOf(row.ymi - 1)] || null;
    var yoy = MODEL.byPeriod[periodOf(row.ymi - 12)] || null;
    var isLatest = !!(MODEL.latest && MODEL.latest.period === period);

    // --- 月ナビ ---
    var h = '<div class="w35m-rnav">' +
      '<button type="button" class="w35m-navbtn" data-w35nav="-1" aria-label="前の月"' +
        (i <= 0 ? " disabled" : "") + ">◀</button>" +
      '<span class="w35m-rtitle">' + esc(ymLabel(period)) +
        '<span class="w35m-badge ' + (row.isComplete ? "conf" : "prov") + '">' +
          (row.isComplete ? "確定" : "暫定（進行中）") + "</span>" +
        (isLatest ? '<span class="w35m-badge latest">最新</span>' : "") +
      "</span>" +
      '<button type="button" class="w35m-navbtn" data-w35nav="1" aria-label="次の月"' +
        (i >= MODEL.rows.length - 1 ? " disabled" : "") + ">▶</button>" +
      "</div>";

    // --- KPI 4タイル ---
    h += '<div class="mcc-cf-stats w35m-kpi">' +
      kpiTile("収入", "<strong>" + esc(yen(row.income)) + "</strong>", [
        cmpLine("前月比", row.income, prev ? prev.income : null, "yen"),
        cmpLine("前年同月比", row.income, yoy ? yoy.income : null, "yen")]) +
      kpiTile("支出", "<strong>" + esc(yen(row.expense)) + "</strong>", [
        cmpLine("前月比", row.expense, prev ? prev.expense : null, "yen"),
        cmpLine("前年同月比", row.expense, yoy ? yoy.expense : null, "yen")]) +
      kpiTile("収支", '<strong class="' + (row.balance < 0 ? "neg" : "pos") + '">' +
        esc(yenSigned(row.balance)) + "</strong>", [
        cmpLine("前月比", row.balance, prev ? prev.balance : null, "yen"),
        cmpLine("前年同月比", row.balance, yoy ? yoy.balance : null, "yen")]) +
      kpiTile("貯蓄率", "<strong>" + row.savingsRate.toFixed(1) + "%</strong>", [
        cmpLine("前月比", row.savingsRate, prev ? prev.savingsRate : null, "pt"),
        cmpLine("前年同月比", row.savingsRate, yoy ? yoy.savingsRate : null, "pt")]) +
      "</div>";

    // --- 資産増減 ---
    var pt = seriesPoint(period), ppt = prev ? seriesPoint(prev.period) : null;
    if (pt) {
      var d = ppt ? pt.total - ppt.total : null;
      var dp = (ppt && ppt.total !== 0) ? (pt.total - ppt.total) / Math.abs(ppt.total) * 100 : null;
      h += '<div class="w35m-asset">' +
        '<span class="w35m-asset-l"><span>総資産（' + esc(ymLabel(period)) + ' 末）</span>' +
          "<strong>" + esc(yen(pt.total)) + "</strong></span>" +
        '<span class="w35m-asset-r">' +
          '<span class="w35m-sub">前月比 ' + (d === null ? "—" : "<b>" + esc(yenSigned(d)) + "</b>" +
            (dp === null ? "" : "（" + esc(pctSigned(dp)) + "）")) + "</span>" +
          '<span class="w35m-sub">現金 ' + esc(yen(pt.cash)) + "／投資 " + esc(yen(pt.invest)) + "</span>" +
        "</span></div>";
    } else {
      h += '<div class="w35m-note">この月の総資産は算出できません（基準〈アンカー〉より前、または月が連続していません）。</div>';
    }

    // --- 予算 vs 実績 ---
    h += '<div class="w35m-sec"><div class="mcc-section-title">予算 vs 実績</div>' +
      '<div class="w35m-note">現在の予算で比較しています' + (row.isComplete ? "" : "（この月は進行中です）") + "。</div>" +
      budgetBarsHtml(budgetView(row, !row.isComplete), {}) + "</div>";

    // --- 費目 ---
    h += '<div class="w35m-sec"><div class="mcc-section-title">費目</div>';
    if (!row.cats.length) {
      h += '<div class="w35m-empty">この月は費目の内訳がありません。</div>';
    } else {
      var top = row.cats.slice(0, 8), rest = row.cats.slice(8);
      h += top.map(function (c) {
        var share = row.expense > 0 ? c.amount / row.expense * 100 : 0;
        var pv = prev ? num(prev.catMap[c.name]) : null;
        var mom = (prev && (prev.catMap[c.name] !== undefined || c.amount)) ? "・前月比 " + esc(yenSigned(c.amount - pv)) : "";
        return '<div class="w35m-crow"><div class="w35m-crow-l">' +
          '<span class="w35m-cnm">' + esc(c.name) + "</span>" +
          '<span class="w35m-cvl">' + esc(yen(c.amount)) + "・" + share.toFixed(1) + "%" + mom + "</span></div>" +
          '<div class="w35m-barrow"><span class="w35m-bar">' +
            '<span class="w35m-fill share" style="width:' + clamp(share, 0, 100).toFixed(1) + '%"></span></span></div></div>';
      }).join("");
      if (rest.length) {
        var rt = 0; rest.forEach(function (c) { rt += c.amount; });
        h += '<div class="w35m-crest">その他 ' + esc(yen(rt)) + "（" + rest.length + "費目）</div>";
      }
    }
    h += "</div>";

    // --- 現在地（最新の確定月を表示中のみ） ---
    if (isLatest) {
      h += '<div class="w35m-sec"><div class="mcc-section-title">現在地</div>' + nowHtml() + "</div>";
    }

    // --- 注記 ---
    var notes = [];
    if (!row.isComplete) notes.push("この月は進行中です（表示は暫定値）。");
    if (!prev) notes.push("前月の収支がないため前月比は「—」です。");
    if (!yoy) notes.push("前年同月の収支がないため前年同月比は「—」です。");
    if (!row.cats.length) notes.push("この月は費目の内訳がありません。");
    if (notes.length) h += '<div class="w35m-note">' + notes.map(esc).join("<br>") + "</div>";
    return h;
  }

  function nowHtml() {
    var out = [];
    try {
      var R = window.MCCRules;
      var nz = MODEL.nisa;
      if (nz) {
        var annual = (R && R.NISA_ANNUAL_TOTAL) ? R.NISA_ANNUAL_TOTAL : 3600000;
        var used = Math.max(0, num(nz.tsumitateThisYear) + num(nz.growthThisYear) - num(nz.soldThisYearAtCost));
        out.push('<div class="w35m-nrow">NISA 年内 使用 <b>' + esc(yen(used)) + "</b> / " + esc(yen(annual)) +
          "（残 <b>" + esc(yen(Math.max(0, annual - used))) + "</b>）</div>");
      }
      var ta = MODEL.series && MODEL.series.totalAssets ? MODEL.series.totalAssets : 0;
      if (MODEL.goals.length && ta > 0) {
        var g = MODEL.goals.map(function (x) {
          var t = num(x.targetAmount);
          var p = t > 0 ? clamp(ta / t * 100, 0, 100) : 0;
          return esc(String(x.label || "目標")) + " <b>" + rp(p) + "%</b>";
        }).join("・");
        out.push('<div class="w35m-nrow">目標：' + g + "（総資産 " + esc(yen(ta)) + " 基準）</div>");
      }
    } catch (e) { console.error(LOG, "nowHtml", e); }
    return out.length ? out.join("") : '<div class="w35m-empty">表示できる現在地がありません。</div>';
  }

  function makeReportHost() {
    var host = el("div", "w35m-report " + MARK);
    host.innerHTML = reportHtml(_reportPeriod);
    wireDelegates(host);
    return host;
  }
  function repaintReport() {
    try {
      var hosts = document.querySelectorAll("#mcc-root .w35m-report");
      for (var i = 0; i < hosts.length; i++) {
        hosts[i].innerHTML = reportHtml(_reportPeriod);
        wireDelegates(hosts[i]);
      }
      var dg = document.querySelector("#mcc-sec-report > summary .mcc-fold-dg");
      if (dg) dg.innerHTML = reportDigestHtml();
    } catch (e) { console.error(LOG, "repaintReport", e); }
  }
  function reportDigestHtml() {
    var r = MODEL && MODEL.latest;
    if (!r) return "—";
    return esc(ymLabel(r.period)) + ' <b class="' + (r.balance < 0 ? "neg" : "pos") + '">' +
      esc(yenSigned(r.balance)) + "</b>・貯蓄率 <b>" + r.savingsRate.toFixed(1) + "%</b>";
  }

  // 月ナビ／「月の予算」へのリンクは innerHTML 差し替えのたびに張り直す（1コンテナ1リスナ）。
  function wireDelegates(container) {
    try {
      if (!container || container.__w35wired) return;
      container.__w35wired = true;
      container.addEventListener("click", function (ev) {
        try {
          var t = ev.target;
          if (!t || !t.getAttribute) return;
          var nav = t.getAttribute("data-w35nav");
          if (nav) { stepReport(+nav); return; }
          if (t.getAttribute("data-w35") === "tobudget") { gotoBudgetCard(); }
        } catch (e) { console.error(LOG, "delegate", e); }
      });
    } catch (e) { console.error(LOG, "wireDelegates", e); }
  }

  function stepReport(dir) {
    if (!MODEL) return;
    var i = -1;
    for (var k = 0; k < MODEL.rows.length; k++) if (MODEL.rows[k].period === _reportPeriod) { i = k; break; }
    var j = clamp(i + dir, 0, MODEL.rows.length - 1);
    if (j === i) return;
    _reportPeriod = MODEL.rows[j].period;
    repaintReport();
  }

  function gotoBudgetCard() {
    try {
      hideReportTab();
      if (window.MCC && window.MCC.switchTab) window.MCC.switchTab("config");
      var card = document.getElementById("mcc-sec-budget-card");
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { console.error(LOG, "gotoBudgetCard", e); }
  }

  // ================================================================ 案 A: 3本目タブ
  function showReportTab() {
    try {
      _reportTabOn = true;
      ["dash", "config"].forEach(function (k) {
        var p = document.getElementById("mcc-tab-" + k); if (p) p.hidden = true;
        var b = document.getElementById("mcc-tab-btn-" + k); if (b) b.setAttribute("aria-selected", "false");
      });
      var rp2 = document.getElementById("mcc-tab-report"); if (rp2) rp2.hidden = false;
      var rb = document.getElementById("mcc-tab-btn-report"); if (rb) rb.setAttribute("aria-selected", "true");
    } catch (e) { console.error(LOG, "showReportTab", e); }
  }
  function hideReportTab() {
    try {
      _reportTabOn = false;
      var p = document.getElementById("mcc-tab-report"); if (p) p.hidden = true;
      var b = document.getElementById("mcc-tab-btn-report"); if (b) b.setAttribute("aria-selected", "false");
    } catch (e) { console.error(LOG, "hideReportTab", e); }
  }
  function onOtherTab(ev) {
    try {
      var t = ev.target;
      while (t && t !== ev.currentTarget && !(t.className && String(t.className).indexOf("mcc-tab") >= 0)) t = t.parentNode;
      if (!t || t === ev.currentTarget) return;
      if (t.id === "mcc-tab-btn-report") return;
      hideReportTab();
    } catch (e) { console.error(LOG, "onOtherTab", e); }
  }

  function injectTabA(root) {
    var nav = root.querySelector(".mcc-tabbar");
    if (!nav) return;
    var btn = el("button", "mcc-tab " + MARK,
      '<span class="mcc-tab-num">03</span>月次レポート');
    btn.type = "button";
    btn.id = "mcc-tab-btn-report";
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-controls", "mcc-tab-report");
    btn.setAttribute("aria-selected", _reportTabOn ? "true" : "false");
    // money.js のタブと同じく mousedown も張る（入力確定直後の1回目が無反応になるのを防ぐ）。
    btn.addEventListener("mousedown", showReportTab);
    btn.addEventListener("click", showReportTab);
    nav.appendChild(btn);
    // 既存2タブは MCC.switchTab が report を知らない → capture で先に report を隠す。
    nav.addEventListener("mousedown", onOtherTab, true);
    nav.addEventListener("click", onOtherTab, true);

    var pane = el("div", "mcc-pane " + MARK);
    pane.id = "mcc-tab-report";
    pane.setAttribute("role", "tabpanel");
    pane.setAttribute("aria-labelledby", "mcc-tab-btn-report");
    pane.hidden = !_reportTabOn;
    pane.appendChild(el("div", "mcc-section-desc",
      "月ごとの収入・支出・収支・貯蓄率と、予算に対する実績をまとめた面です。月は ◀ ▶ で移動します。"));
    pane.appendChild(makeReportHost());
    root.appendChild(pane);
  }

  // ================================================================ 注入
  function injectCommon(root) {
    // ① 設定タブ「月の予算」カード＝「設定」（月の生活費）カードの直後
    var settings = root.querySelector("#mcc-sec-settings");
    if (settings) insertAfter(makeCfgCard(), settings);

    // ② ダッシュボード「今月の予算」fold＝収支 fold の直後
    var cf = root.querySelector("#mcc-sec-cashflow");
    var live = makeLiveFold();
    if (cf) insertAfter(live, cf);
    return live;
  }

  function injectReport(root, afterNode) {
    if (VARIANT === "A") { injectTabA(root); return; }
    if (VARIANT === "B") {
      var det = document.createElement("details");
      det.className = "mcc-fold mcc-fold-w35r " + MARK;
      det.id = "mcc-sec-report";
      if (_openReport) det.open = true;
      det.innerHTML =
        '<summary><span class="mcc-fold-mk"></span><span class="mcc-fold-nm">月次レポート</span>' +
        '<span class="mcc-fold-dg">' + reportDigestHtml() + "</span></summary>" +
        '<div class="mcc-fold-body"></div>';
      det.querySelector(".mcc-fold-body").appendChild(makeReportHost());
      det.addEventListener("toggle", function () { _openReport = !!det.open; });
      if (afterNode) insertAfter(det, afterNode);
      return;
    }
    // C: 収支 fold の本文末尾
    var fold = root.querySelector("#mcc-sec-cashflow");
    if (!fold) return;
    if (fold.tagName === "DETAILS" && !fold.open) fold.open = true;
    var body = fold.querySelector(".mcc-fold-body");
    if (!body) return;
    var block = el("div", "w35m-cblock " + MARK);
    block.appendChild(el("div", "mcc-section-title", "月次レポート"));
    block.appendChild(makeReportHost());
    body.appendChild(block);
  }

  var _injectCount = 0;
  var _openedOnce = false;
  function tryInject() {
    try {
      if (!MODEL) return;
      var root = document.getElementById("mcc-root");
      if (!root) return;
      if (!root.querySelector(".mcc-hero")) return;    // まだ司令室が描かれていない
      if (root.querySelector("." + MARK)) return;      // 注入済み

      // モック限定: 収支 fold は既定 open だが、閉じられていると案 C が見えない＝初回だけ開く。
      if (!_openedOnce) {
        _openedOnce = true;
        var d = document.getElementById("mcc-sec-cashflow");
        if (d && d.tagName === "DETAILS") d.open = true;
      }

      var live = injectCommon(root);
      injectReport(root, live);
      if (VARIANT === "A" && _reportTabOn) showReportTab();

      var m = el("span", MARK + " w35m-marker");
      m.style.display = "none";
      root.appendChild(m);
      _injectCount++;
      report();
    } catch (e) { console.error(LOG, "tryInject", e); }
  }

  function report() {
    try {
      var bv = MODEL && MODEL.live ? budgetView(MODEL.live, true) : null;
      var r = MODEL && MODEL.latest;
      console.log(LOG, "variant=" + VARIANT, "now=" + NOW_ISO,
        "live=" + (MODEL && MODEL.live ? MODEL.live.period : "-"),
        "report=" + _reportPeriod, "series=" + (MODEL ? MODEL.series.source : "-"));
      window.__W35M__ = {
        variant: VARIANT, now: NOW_ISO, injects: _injectCount,
        reportPeriod: _reportPeriod,
        livePeriod: MODEL && MODEL.live ? MODEL.live.period : "",
        elapsedPct: Math.round(ELAPSED_PCT * 10) / 10,
        budgetTotal: _budgetTotal, budgetItems: _budgetItems.length,
        liveExpense: bv ? bv.actual : null, livePct: bv ? Math.round(bv.pct) : null,
        overCount: bv ? bv.overCount : null,
        unbudgeted: bv ? bv.unbudgeted.length : null,
        latestPeriod: r ? r.period : "",
        latestIncome: r ? r.income : null, latestExpense: r ? r.expense : null,
        latestBalance: r ? r.balance : null, latestSavingsRate: r ? r.savingsRate : null,
        totalAssets: MODEL ? Math.round(MODEL.series.totalAssets) : null,
        seriesSource: MODEL ? MODEL.series.source : "",
        rows: MODEL ? MODEL.rows.length : 0,
      };
    } catch (e) { console.error(LOG, "report", e); }
  }

  // ================================================================ panel
  function buildPanel() {
    try {
      if (document.querySelector(".w35m-panel")) return;
      var p = el("div", "w35m-panel");
      var nowParam = /^\d{4}-\d{2}-\d{2}$/.test(NOW_RAW) ? NOW_RAW : "";
      function href(v, nowv) { return location.pathname + "?w35variant=" + v + (nowv ? "&w35now=" + nowv : ""); }
      var rows = ['<div class="w35m-panel-h">W3.5 モック / 案 ' + esc(VARIANT) + "</div>"];
      rows.push('<div class="w35m-panel-r"><span>案</span>' + ["A", "B", "C"].map(function (v) {
        return '<a href="' + esc(href(v, nowParam)) + '"' + (v === VARIANT ? ' class="on"' : "") + ">" + v + "</a>";
      }).join("") + "</div>");
      rows.push('<div class="w35m-panel-r"><span>日付</span>' + [["今日", ""], ["8/29", "2026-08-29"], ["8/10", "2026-08-10"]].map(function (x) {
        return '<a href="' + esc(href(VARIANT, x[1])) + '"' + (x[1] === nowParam ? ' class="on"' : "") + ">" + esc(x[0]) + "</a>";
      }).join("") + "</div>");
      rows.push('<div class="w35m-panel-r"><span>幅</span><b id="w35m-vw">-</b></div>');
      p.innerHTML = rows.join("");
      document.body.appendChild(p);
      var vw = document.getElementById("w35m-vw");
      var upd = function () { if (vw) vw.textContent = window.innerWidth + "px"; };
      upd();
      window.addEventListener("resize", upd);
    } catch (e) { console.error(LOG, "panel", e); }
  }

  // ================================================================ boot
  function fetchJSON(url) {
    return fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then(function (r) { return r.json(); });
  }

  function loadModel() {
    return Promise.all([fetchJSON("/api/me/state"), fetchJSON("/api/me/cashflow")])
      .then(function (res) {
        MODEL = buildModel(res[0] && res[0].state, res[1] && res[1].cashflow);
        _reportPeriod = MODEL.latest ? MODEL.latest.period
          : (MODEL.rows.length ? MODEL.rows[MODEL.rows.length - 1].period : "");
        tryInject();
      })
      .catch(function (e) { console.error(LOG, "loadModel", e); });
  }

  function openCockpit() {
    try {
      if (!location.hash) location.hash = "#money";
      setTimeout(function () {
        var v = document.getElementById("money-view");
        if (v && !/\bactive\b/.test(v.className) && window.MCC && window.MCC.show) window.MCC.show();
      }, 60);
    } catch (e) { console.error(LOG, "openCockpit", e); }
  }

  try {
    injectStyle();

    var mo = new MutationObserver(function () { tryInject(); });
    var startObs = function () {
      var root = document.getElementById("mcc-root");
      if (root) { mo.observe(root, { childList: true }); return true; }
      return false;
    };
    if (!startObs()) document.addEventListener("DOMContentLoaded", startObs);

    // 初回 render を取りこぼさないための保険（20秒だけポーリング）。
    var poll = setInterval(tryInject, 300);
    setTimeout(function () { clearInterval(poll); }, 20000);

    var onReady = function () { buildPanel(); openCockpit(); loadModel(); };
    if (document.readyState === "complete") setTimeout(onReady, 0);
    else window.addEventListener("load", onReady);
  } catch (e) { console.error(LOG, "boot", e); }
})();
