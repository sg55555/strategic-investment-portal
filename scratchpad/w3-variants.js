/* scratchpad/w3-variants.js — W3「司令室PFMパック」モック3案（A/B/C）の実物比較用オーバーレイ。
 *
 * 位置づけ: **捨てコードのプロトタイプ**。本実装では業務 math を money-rules.js（＋Python 鏡像）へ、
 *           描画を money.js へ書く。ここでは money.js が描いた DOM に **追加だけ** して見た目を試す。
 *
 * 読み込まれ方: scratchpad/w3-mock-server.py が index.html の </body> 直前に <script> を注入する
 *              （index.html / money.js / money-rules.js / money.css は 1バイトも変更しない）。
 *
 * URL パラメータ:
 *   ?w3variant=A|B|C   推移カードの置き場所（既定 A）＝設計 D8 の候補3案
 *   &w3now=YYYY-MM-DD  「今日」を差し替える（既定＝実際の今日）。リマインドの月判定・残月計算に使う。
 *
 * 文言・しきい値・既定期間(1Y)は docs/superpowers/specs/2026-08-27-w3-cockpit-pfm-design.md（§3.3/§4/§7）に合わせている。
 *
 * 不変条件:
 *   - 例外を外に投げない（すべて try/catch＋console.error）。money.js の描画を壊さない。
 *   - 既存ノードを innerHTML で置換しない・onclick を消さない（append / insertBefore のみ）。
 *   - render() のたびに注入し直す（マーカー .w3m の有無で二重注入を防ぐ）。
 */
(function () {
  "use strict";

  var LOG = "[w3m]";
  var MARK = "w3m";
  var VARIANTS = { A: "A", B: "B", C: "C" };

  // ---------------------------------------------------------------- params
  var Q = null;
  try { Q = new URLSearchParams(location.search); } catch (e) { Q = null; }
  function param(k) { try { return Q ? (Q.get(k) || "") : ""; } catch (e) { return ""; } }

  var VARIANT = String(param("w3variant") || "A").toUpperCase();
  if (!VARIANTS[VARIANT]) VARIANT = "A";

  var NOW_RAW = param("w3now");
  var NOW = (function () {
    if (/^\d{4}-\d{2}-\d{2}$/.test(NOW_RAW)) {
      var y = +NOW_RAW.slice(0, 4), m = +NOW_RAW.slice(5, 7), d = +NOW_RAW.slice(8, 10);
      var dt = new Date(y, m - 1, d, 12, 0, 0);
      if (isFinite(dt.getTime())) return dt;
    }
    return new Date();
  })();
  var NOW_Y = NOW.getFullYear();
  var NOW_M0 = NOW.getMonth();            // 0 始まり
  var NOW_YMI = NOW_Y * 12 + NOW_M0;

  var PERIOD_KEY = "mcc_series_period";
  var PERIODS = [
    { k: "6M", label: "6M", n: 6 },
    { k: "1Y", label: "1Y", n: 12 },
    { k: "2Y", label: "2Y", n: 24 },
    { k: "ALL", label: "ALL", n: 0 },
  ];
  function getPeriod() {
    try {
      var v = localStorage.getItem(PERIOD_KEY);
      for (var i = 0; i < PERIODS.length; i++) if (PERIODS[i].k === v) return v;
    } catch (e) { /* private browsing */ }
    return "1Y";   // 設計 D5: 既定 1Y
  }
  function setPeriod(k) { try { localStorage.setItem(PERIOD_KEY, k); } catch (e) { /* noop */ } }

  // ---------------------------------------------------------------- utils
  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function yen(n) { return "¥" + Math.round(Number(n) || 0).toLocaleString("ja-JP"); }
  function yenSigned(n) {
    var x = Math.round(Number(n) || 0);
    if (x === 0) return "±¥0";
    return (x < 0 ? "−¥" : "+¥") + Math.abs(x).toLocaleString("ja-JP");   // − は U+2212（§7）
  }
  // §7: 前月比 +¥123,456（+5.2%）／−¥45,000（−1.8%）／±¥0
  function momText(mom) {
    if (!mom) return "";
    var body = yenSigned(mom.delta);
    if (mom.pct === null) return "前月比 " + body;
    var p = mom.pct;
    var sp = p > 0 ? "+" : (p < 0 ? "−" : "±");
    return "前月比 " + body + "（" + sp + Math.abs(p).toFixed(1) + "%）";
  }
  function man(v) {
    var x = Math.round(Number(v) || 0);
    if (Math.abs(x) >= 100000000) return (x / 100000000).toFixed(1).replace(/\.0$/, "") + "億";
    return Math.round(x / 10000).toLocaleString("ja-JP") + "万";
  }
  function ymi(period) { return (+period.slice(0, 4)) * 12 + (+period.slice(5, 7) - 1); }
  function ymLabel(i) { return Math.floor(i / 12) + "年" + (i % 12 + 1) + "月"; }
  function ymOfDate(d) { return d ? (Number(d.slice(0, 4)) + "年" + Number(d.slice(5, 7)) + "月") : ""; }
  function ymSlash(i) {
    var m = i % 12 + 1;
    return Math.floor(i / 12) + "/" + (m < 10 ? "0" + m : m);
  }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function median(a) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var n = s.length, h = Math.floor(n / 2);
    return n % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
  }
  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function jump(key) { try { if (window.MCC && window.MCC.jumpTo) window.MCC.jumpTo(key); } catch (e) { console.error(LOG, e); } }

  // ---------------------------------------------------------------- style
  var CSS = [
    /* --- 共通トーン: money.css のトークンに寄せる（theme D「ネオン・ターミナル」の上に乗る） --- */
    /* 金額ノードは触らず（中身は金額のみ）、兄弟バッジを同じ行の右に置くための追加規則 */
    '.mcc-hero-amount{display:inline-block;vertical-align:baseline;}',
    '.w3m-mom{display:inline-block;margin-left:12px;padding:2px 9px;border-radius:4px;font-size:0.80rem;',
    '  font-weight:700;letter-spacing:0.5px;vertical-align:0.55em;white-space:nowrap;',
    '  border:1px solid rgba(0,230,118,0.42);color:var(--c-emerald-bright);background:rgba(0,230,118,0.08);}',
    '.w3m-mom.neg{border-color:rgba(255,92,138,0.45);color:var(--c-danger-soft);background:rgba(255,23,68,0.08);}',
    '.w3m-mom.flat{border-color:rgba(129,140,248,0.35);color:var(--c-text-dim);background:rgba(129,140,248,0.06);}',

    '.w3m-runway{flex:none;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:0.5px;',
    '  white-space:nowrap;border:1px solid rgba(0,229,255,0.4);color:var(--c-cyan-pale);background:rgba(0,229,255,0.07);}',
    '.w3m-runway.low{border-color:rgba(255,179,0,0.5);color:var(--c-amber-pale);background:rgba(255,179,0,0.08);}',

    /* --- リマインド帯 --- */
    '.w3m-rail{display:flex;flex-direction:column;gap:6px;margin:0 0 12px;}',
    '.w3m-rail-item{display:flex;align-items:flex-start;gap:9px;padding:9px 12px;border-radius:6px;',
    '  font-size:12px;line-height:1.6;background:rgba(15,20,34,0.55);border:1px solid rgba(129,140,248,0.22);',
    '  border-left-width:3px;color:var(--c-text-bright);}',
    '.w3m-rail-item.warn{border-left-color:var(--c-amber);border-color:rgba(255,179,0,0.28);}',
    '.w3m-rail-item.urgent{border-left-color:var(--c-danger);border-color:rgba(255,23,68,0.3);}',
    '.w3m-rail-dot{font-size:10px;margin-right:7px;}',
    '.w3m-rail-item.warn .w3m-rail-dot{color:var(--c-amber-bright);}',
    '.w3m-rail-item.urgent .w3m-rail-dot{color:var(--c-danger-soft);}',
    '.w3m-rail-txt{flex:1 1 auto;min-width:0;}',
    '.w3m-rail-txt b{color:var(--c-text-bright);font-weight:700;}',
    '.w3m-rail-link{flex:none;background:none;border:1px solid rgba(0,229,255,0.35);color:var(--c-cyan-pale);',
    '  border-radius:4px;padding:2px 8px;font:inherit;font-size:11px;cursor:pointer;white-space:nowrap;}',
    '.w3m-rail-link:hover{background:rgba(0,229,255,0.1);}',

    /* --- fold 内の追記行 --- */
    '.w3m-note{font-size:11.5px;line-height:1.65;color:var(--c-text-faint);margin-top:4px;}',
    '.w3m-note b{color:var(--c-text-bright);font-weight:700;}',
    '.w3m-note.warn{color:var(--c-amber-pale);}',
    '.w3m-note.warn b{color:var(--c-amber-bright);}',
    '.w3m-nisanote{margin:0 0 12px;padding:9px 12px;border-radius:6px;font-size:12px;line-height:1.65;',
    '  background:rgba(0,229,255,0.05);border:1px solid rgba(0,229,255,0.24);color:var(--c-text-bright);}',
    '.w3m-nisanote b{color:var(--c-cyan-bright);font-weight:700;}',
    '.w3m-nisanote.warn{background:rgba(255,179,0,0.06);border-color:rgba(255,179,0,0.34);}',
    '.w3m-nisanote.warn b{color:var(--c-amber-bright);}',
    '.w3m-nisanote.urgent{background:rgba(255,23,68,0.07);border-color:rgba(255,23,68,0.34);}',
    '.w3m-nisanote.urgent b{color:var(--c-danger-soft);}',

    /* --- 推移カード --- */
    '.mcc-fold-w3{border-color:rgba(0,229,255,0.3)!important;}',
    '.mcc-fold-w3>summary .mcc-fold-nm{color:var(--c-cyan-bright);}',
    '.w3m-series{min-width:0;}',
    '.w3m-series.compact{margin-top:14px;padding-top:12px;border-top:1px dashed rgba(129,140,248,0.25);}',
    '.w3m-cblock{margin:0 0 16px;padding-bottom:14px;border-bottom:1px dashed rgba(129,140,248,0.22);}',
    /* runway チップを足したぶんゲージ行が詰まるので折り返しを許す（モック限定の追加規則） */
    '.mcc-hero-gauge-row{flex-wrap:wrap;}',
    '.w3m-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:8px;}',
    '.w3m-bar-lb{font-size:11px;letter-spacing:1px;color:var(--c-text-dim);margin-right:2px;}',
    '.w3m-pbtn{background:rgba(0,0,0,0.35);border:1px solid rgba(129,140,248,0.28);color:var(--c-text-dim);',
    '  border-radius:4px;padding:3px 10px;font:inherit;font-size:11px;font-weight:700;letter-spacing:1px;cursor:pointer;}',
    '.w3m-pbtn:hover{border-color:rgba(0,229,255,0.4);color:var(--c-cyan-pale);}',
    '.w3m-pbtn.on{border-color:rgba(0,229,255,0.6);color:var(--c-cyan-bright);background:rgba(0,229,255,0.1);}',
    '.w3m-series.compact .w3m-pbtn{padding:1px 7px;font-size:10px;}',
    '.w3m-svgwrap{width:100%;overflow:hidden;}',
    '.w3m-svgwrap svg{display:block;width:100%;height:auto;touch-action:pan-y;}',
    '.w3m-grid{stroke:rgba(255,255,255,0.10);stroke-width:1;}',
    '.w3m-axtx{fill:var(--c-text-mute);font-size:10px;}',
    '.w3m-anchorln{stroke:var(--c-cyan);stroke-width:1;stroke-dasharray:3 3;opacity:0.55;}',
    '.w3m-anchortx{fill:var(--c-cyan-pale);font-size:10px;letter-spacing:1px;}',
    '.w3m-areacash{fill:var(--c-cyan);fill-opacity:0.22;}',
    '.w3m-areainv{fill:var(--c-indigo-bright);fill-opacity:0.25;}',
    '.w3m-linecash{fill:none;stroke:var(--c-cyan);stroke-width:1.5;}',
    '.w3m-linetot{fill:none;stroke:var(--c-indigo-bright);stroke-width:1;opacity:0.8;}',
    '.w3m-dot{fill:var(--c-indigo-bright);}',
    '.w3m-dot.prov{fill:none;stroke:var(--c-indigo-bright);stroke-width:1.4;}',
    '.w3m-ind{stroke:var(--c-cyan-bright);stroke-width:1;opacity:0.5;}',
    '.w3m-hit{fill:transparent;cursor:crosshair;}',
    '.w3m-cap{margin-top:6px;font-size:11.5px;line-height:1.6;color:var(--c-text-bright);min-height:1.6em;}',
    '.w3m-cap b{color:var(--c-cyan-bright);font-weight:700;}',
    '.w3m-cap i{font-style:normal;color:var(--c-text-faint);}',
    '.w3m-foot{margin-top:5px;font-size:11px;line-height:1.55;color:var(--c-text-mute);}',
    '.w3m-legend{display:flex;flex-wrap:wrap;gap:12px;margin-top:4px;font-size:11px;color:var(--c-text-dim);}',
    '.w3m-legend i{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px;}',
    '.w3m-legend i.cash{background:var(--c-cyan);opacity:0.55;}',
    '.w3m-legend i.inv{background:var(--c-indigo-bright);opacity:0.6;}',

    /* --- 切替パネル（モック専用・本実装には出さない） --- */
    '.w3m-panel{position:fixed;right:12px;bottom:12px;z-index:99999;background:rgba(4,7,12,0.93);',
    '  border:1px solid rgba(0,229,255,0.35);border-radius:6px;padding:8px 10px;font-size:11px;line-height:1.5;',
    '  color:#d4e2ea;font-family:ui-monospace,Menlo,Consolas,monospace;box-shadow:0 6px 22px rgba(0,0,0,0.55);',
    '  max-width:210px;}',
    '.w3m-panel-h{font-weight:700;letter-spacing:1px;color:#62f0ff;margin-bottom:5px;}',
    '.w3m-panel-r{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin-top:3px;}',
    '.w3m-panel-r>span{color:#7f95a3;width:34px;flex:none;}',
    '.w3m-panel a{color:#d4e2ea;text-decoration:none;border:1px solid rgba(129,140,248,0.3);border-radius:3px;',
    '  padding:1px 6px;cursor:pointer;}',
    '.w3m-panel a.on{border-color:rgba(0,229,255,0.7);color:#62f0ff;background:rgba(0,229,255,0.12);}',
    '.w3m-panel b{color:#39ff8b;font-weight:700;}',

    /* --- 390px --- */
    '@media (max-width:560px){',
    '  .w3m-mom{margin-left:0;display:block;width:-moz-fit-content;width:fit-content;margin-top:6px;vertical-align:baseline;}',
    '  .w3m-rail-item{flex-wrap:wrap;}',
    '  .w3m-rail-txt{flex:1 1 100%;}',
    '  .w3m-rail-link{margin-left:17px;}',
    '  .w3m-panel{max-width:140px;font-size:10px;padding:6px 7px;right:6px;bottom:6px;}',
    '  .w3m-panel-r>span{width:26px;}',
    '}',
  ].join("\n");

  function injectStyle() {
    try {
      if (document.getElementById("w3m-style")) return;
      var s = document.createElement("style");
      s.id = "w3m-style";
      s.textContent = CSS;
      (document.head || document.documentElement).appendChild(s);
    } catch (e) { console.error(LOG, "style", e); }
  }

  // ================================================================ model
  // 捨てコードのプロトタイプ計算（本実装は money-rules.js に純関数として書く）。
  var MODEL = null;

  function normRows(raw) {
    if (!Array.isArray(raw)) return [];
    var out = raw.filter(function (r) {
      return r && typeof r === "object" && typeof r.period === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.period);
    }).map(function (r) {
      return {
        period: r.period,
        ymi: ymi(r.period),
        balance: Number(r.balance) || 0,
        miscIncome: Number(r.misc_income) || 0,
        totalIncome: Number(r.total_income) || 0,
        isComplete: r.is_complete !== false,
      };
    });
    out.sort(function (a, b) { return a.ymi - b.ymi; });
    return out;
  }

  function buildModel(state, rawRows) {
    var s = state || {};
    var rows = normRows(rawRows);
    var buckets = s.buckets || {};
    var core = Number((buckets.core || {}).amount) || 0;
    var sat = Number((buckets.satellite || {}).amount) || 0;
    var invest = core + sat;
    var anchor = s.anchor || {};
    var anchorDate = typeof anchor.date === "string" ? anchor.date : "";
    var anchorAmount = Number(anchor.amount) || 0;
    var monthlyExpense = Number(s.monthlyExpense) || 0;
    var bufferMonths = Number(s.bufferMonths) || 0;

    // 連続月だけを使う（末尾から遡って途切れたら止める）。
    var run = [];
    for (var i = rows.length - 1; i >= 0; i--) {
      if (!run.length) { run.unshift(rows[i]); continue; }
      if (rows[i].ymi === run[0].ymi - 1) run.unshift(rows[i]); else break;
    }

    var pts = [];
    var anchorYmi = anchorDate ? ymi(anchorDate) : (run.length ? run[0].ymi : 0);
    if (run.length && anchorDate) {
      // 前方累積: cash(m) = anchor + Σ_{k=anchor..m} flow(k)     （点＝その月の月末残高）
      // 後方逆算: cash(anchor-1) = anchor,  cash(m) = anchor − Σ_{k=m+1..anchor-1} flow(k)
      var byYmi = {};
      run.forEach(function (r) { byYmi[r.ymi] = r; });
      var acc = anchorAmount, k;
      var fwd = {};
      for (k = anchorYmi; k <= run[run.length - 1].ymi; k++) {
        if (!byYmi[k]) break;
        acc += byYmi[k].balance;   // invest_cash_flow は 0（投資台帳は空）
        fwd[k] = acc;
      }
      var back = {};
      var bacc = anchorAmount;
      for (k = anchorYmi - 1; k >= run[0].ymi; k--) {
        back[k] = bacc;                          // cash(anchor-1) = anchor
        if (!byYmi[k]) break;
        bacc -= byYmi[k].balance;                // 1つ前の月末＝この月の flow を差し引く
      }
      run.forEach(function (r) {
        var cash = (r.ymi >= anchorYmi) ? fwd[r.ymi] : back[r.ymi];
        if (cash === undefined) return;
        pts.push({
          ymi: r.ymi, period: r.period, cash: cash, invest: invest,
          total: cash + invest, isComplete: r.isComplete, balance: r.balance,
        });
      });
    }

    var complete = pts.filter(function (p) { return p.isComplete; });
    var last = complete.length ? complete[complete.length - 1] : null;
    var prev = complete.length > 1 ? complete[complete.length - 2] : null;

    // 前月比（直近2確定月の総資産）
    var mom = null;
    if (last && prev) {
      var d = last.total - prev.total;
      mom = { delta: d, pct: prev.total ? (d / prev.total * 100) : null };  // prev.total===0 → % は出さない
    }

    // runway（直近確定月の現金 ÷ 月の生活費）
    var runway = (last && monthlyExpense > 0) ? (last.cash / monthlyExpense) : null;

    // 月あたりの余力（直近3確定月の経常余剰の中央値・負は 0）
    var recent = complete.slice(-3).map(function (p) {
      var row = run.filter(function (r) { return r.ymi === p.ymi; })[0];
      return p.balance - (row ? row.miscIncome : 0);
    });
    var monthlySurplus = Math.max(0, Math.round(median(recent)));

    var totalAssets = last ? last.total : invest;
    var bufferTarget = monthlyExpense * bufferMonths;
    var bufferGap = Math.max(0, bufferTarget - (last ? last.cash : 0));

    // ---- 目標 ----
    var goals = (Array.isArray(s.goals) ? s.goals : []).map(function (g) {
      var target = Number(g.targetAmount) || 0;
      var remaining = Math.max(0, target - totalAssets);
      var eta = (remaining > 0 && monthlySurplus > 0) ? Math.ceil(remaining / monthlySurplus) : null;
      var dl = (typeof g.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(g.deadline)) ? g.deadline : "";
      var monthsLeft = dl ? (ymi(dl) - NOW_YMI) : null;          // 負＝期限超過
      var required = dl ? Math.ceil(remaining / Math.max(1, monthsLeft)) : null;
      var status = remaining === 0 ? "achieved"
        : (dl && monthsLeft < 0) ? "overdue"
          : dl ? ((monthlySurplus > 0 && required <= monthlySurplus) ? "onTrack" : "behind")
            : (monthlySurplus > 0 ? "noDeadline" : "noPace");
      return {
        label: g.label || "", target: target, remaining: remaining, status: status,
        etaMonths: eta, etaYmi: eta === null ? null : NOW_YMI + eta,
        deadline: dl, monthsLeft: monthsLeft, requiredMonthly: required,
      };
    });

    // ---- 確保枠 ----
    // 「monthlySurplus からバッファ残を引いた後に、配列順で充当」（プロトタイプの単純ルール）
    var pool = Math.max(0, monthlySurplus - bufferGap);
    var hasSurplusCtx = monthlySurplus > 0;   // 本実装は cv.available && cv.surplusPositive
    var reserves = (Array.isArray(s.reserves) ? s.reserves : []).map(function (rv) {
      var target = Number(rv.target) || 0, saved = Number(rv.saved) || 0;
      var remaining = Math.max(0, target - saved);
      var complete_ = remaining === 0 && target > 0;
      var dl = (typeof rv.deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rv.deadline)) ? rv.deadline : "";
      var monthsLeft = dl ? (ymi(dl) - NOW_YMI) : null;          // 負＝期日超過
      var override = Number(rv.monthlyOverride) || 0;
      var monthly = complete_ ? 0
        : override > 0 ? Math.min(override, remaining)
          : dl ? Math.ceil(remaining / Math.max(1, monthsLeft)) : 0;
      var allocated = 0;
      if (!complete_ && monthly > 0) { allocated = Math.min(monthly, pool); pool -= allocated; }
      var projectedShortfall = 0, status;
      if (!hasSurplusCtx) status = "unknown";
      else if (complete_) status = "complete";
      else if (!dl) status = "noDeadline";
      else if (monthsLeft < 0) { status = "overdue"; projectedShortfall = remaining; }
      else {
        projectedShortfall = Math.max(0, target - (saved + allocated * Math.max(1, monthsLeft)));
        status = projectedShortfall > 0 ? "short" : "onTrack";
      }
      return {
        label: rv.label || "", target: target, saved: saved, remaining: remaining,
        complete: complete_, deadline: dl, monthsLeft: monthsLeft, status: status,
        monthly: monthly, allocated: allocated, projectedShortfall: projectedShortfall,
      };
    });

    // ---- NISA ----
    var n = (s.nisa && typeof s.nisa === "object") ? s.nisa : {};
    var atUsed = Number(n.tsumitateThisYear) || 0;
    var agUsed = Number(n.growthThisYear) || 0;
    var CAP_T = 1200000, CAP_G = 2400000, CAP_TOT = 3600000;
    var tsumRemain = Math.max(0, CAP_T - atUsed);
    var totRemain = Math.max(0, CAP_TOT - (atUsed + agUsed));
    var nisaMonthsLeft = 12 - NOW_M0;           // money-rules.js の monthsLeft と同式
    var configured = (atUsed + agUsed + (Number(n.tsumitateLifetime) || 0) + (Number(n.growthLifetime) || 0)) > 0;
    var nisa = {
      year: NOW_Y,
      configured: configured,
      remainingTsumitate: tsumRemain,
      remainingGrowth: Math.max(0, CAP_G - agUsed),
      remainingTotal: totRemain,
      monthsLeft: nisaMonthsLeft,
      monthlyToFillTotal: nisaMonthsLeft > 0 ? Math.ceil(totRemain / nisaMonthsLeft) : 0,
      monthlyToFillTsumitate: nisaMonthsLeft > 0 ? Math.ceil(tsumRemain / nisaMonthsLeft) : 0,
      // 設計 §3.3: 0基 monthIndex で 0-8=1〜9月 info / 9-10=10〜11月 warn / 11=12月 urgent
      level: (!configured || totRemain <= 0) ? "none"
        : (NOW_M0 <= 8 ? "info" : (NOW_M0 <= 10 ? "warn" : "urgent")),
    };

    // ---- リマインド帯（warn / urgent のみ） ----
    // 設計 §7 の逐語文言（urgent → warn 順・同レベルは入力順）
    var rail = [];
    if (nisa.level === "urgent") {
      rail.push({
        level: "urgent", jump: "nisa", link: "→ NISA",
        html: "今年の NISA 非課税枠 <b>" + esc(yen(nisa.remainingTotal)) +
          "</b> が未使用です（今月が最後・翌年に繰り越せません）。",
      });
    }
    reserves.forEach(function (rv) {
      if (rv.status !== "overdue") return;
      rail.push({
        level: "urgent", jump: "reserves", link: "→ 確保枠",
        html: "「" + esc(rv.label) + "」は期日（" + esc(ymOfDate(rv.deadline)) + "）を過ぎていますが <b>" +
          esc(yen(rv.projectedShortfall)) + "</b> 未達です。",
      });
    });
    if (nisa.level === "warn") {
      rail.push({
        level: "warn", jump: "nisa", link: "→ NISA",
        html: "今年の NISA 非課税枠が <b>" + esc(yen(nisa.remainingTotal)) + "</b> 残っています（月 <b>" +
          esc(yen(nisa.monthlyToFillTotal)) + "</b> で年内満額・残 " + nisa.monthsLeft +
          "ヶ月）。年内に使わなかった枠は翌年に繰り越せません。",
      });
    }
    reserves.forEach(function (rv) {
      if (rv.status !== "short") return;
      rail.push({
        level: "warn", jump: "reserves", link: "→ 確保枠",
        html: "「" + esc(rv.label) + "」は期日（" + esc(ymOfDate(rv.deadline)) + "）までに <b>" +
          esc(yen(rv.projectedShortfall)) + "</b> 不足の見込みです（今のペース 月 " +
          esc(yen(rv.allocated)) + "）。",
      });
    });

    return {
      pts: pts, complete: complete, last: last, prev: prev, invest: invest,
      anchorDate: anchorDate, anchorYmi: anchorDate ? ymi(anchorDate) : null, anchorAmount: anchorAmount,
      mom: mom, runway: runway, bufferMonths: bufferMonths, monthlyExpense: monthlyExpense,
      monthlySurplus: monthlySurplus, totalAssets: totalAssets,
      goals: goals, reserves: reserves, nisa: nisa, rail: rail,
    };
  }

  // ================================================================ svg
  function niceMax3(m) {
    var target = Math.max(1, m * 1.06);
    var e = Math.pow(10, Math.floor(Math.log10(target / 3)));
    var cands = [1, 1.1, 1.2, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < cands.length; i++) {
      var s = cands[i] * e;
      if (s * 3 >= target) return { step: s, max: s * 3 };
    }
    return { step: 10 * e, max: 30 * e };
  }

  function slicePts(pts) {
    var p = getPeriod(), def = PERIODS[2];
    for (var i = 0; i < PERIODS.length; i++) if (PERIODS[i].k === p) def = PERIODS[i];
    if (!def.n || pts.length <= def.n) return pts.slice();
    return pts.slice(pts.length - def.n);
  }

  // viewBox は画面幅で切り替える（幅 100% でスケールするため、狭い画面で 640 幅のままだと
  // 目盛りラベルが 6px 相当まで縮んで読めなくなる）。
  function svgDims(compact) {
    var narrow = (window.innerWidth || 1024) < 620;
    return {
      W: narrow ? 360 : 640,
      H: compact ? (narrow ? 132 : 120) : (narrow ? 190 : 220),
      padL: narrow ? 38 : (compact ? 40 : 48),
    };
  }

  function buildSvg(pts, compact) {
    var dim = svgDims(compact);
    var W = dim.W, H = dim.H;
    var padL = dim.padL, padR = 10, padT = compact ? 8 : 14, padB = compact ? 16 : 24;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var n = pts.length;
    if (!n) return { html: '<div class="w3m-cap">表示できる月がありません</div>', geo: null };

    var maxTotal = 0;
    pts.forEach(function (p) { if (p.total > maxTotal) maxTotal = p.total; });
    var nm = niceMax3(maxTotal);
    var vmax = nm.max;
    var base = padT + plotH;
    function X(i) { return n === 1 ? padL + plotW / 2 : padL + i * plotW / (n - 1); }
    function Y(v) { return padT + plotH * (1 - clamp(v / vmax, 0, 1)); }

    var s = [];
    s.push('<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="資産の推移">');

    // Y グリッド + ラベル
    for (var t = 1; t <= 3; t++) {
      var v = nm.step * t, y = Y(v);
      s.push('<line class="w3m-grid" x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '"/>');
      s.push('<text class="w3m-axtx" x="' + (padL - 6) + '" y="' + (y + 3.5).toFixed(1) + '" text-anchor="end">' + esc(man(v)) + '</text>');
    }
    s.push('<line class="w3m-grid" x1="' + padL + '" y1="' + base + '" x2="' + (W - padR) + '" y2="' + base + '"/>');

    // 積み上げエリア（現金 → 投資）
    var cashPath = "M" + X(0).toFixed(1) + "," + base;
    var cashLine = "";
    var i;
    for (i = 0; i < n; i++) {
      cashPath += " L" + X(i).toFixed(1) + "," + Y(pts[i].cash).toFixed(1);
      cashLine += (i ? " L" : "M") + X(i).toFixed(1) + "," + Y(pts[i].cash).toFixed(1);
    }
    cashPath += " L" + X(n - 1).toFixed(1) + "," + base + " Z";

    var invPath = "";
    for (i = 0; i < n; i++) invPath += (i ? " L" : "M") + X(i).toFixed(1) + "," + Y(pts[i].cash).toFixed(1);
    for (i = n - 1; i >= 0; i--) invPath += " L" + X(i).toFixed(1) + "," + Y(pts[i].total).toFixed(1);
    invPath += " Z";

    var totLine = "";
    for (i = 0; i < n; i++) totLine += (i ? " L" : "M") + X(i).toFixed(1) + "," + Y(pts[i].total).toFixed(1);

    s.push('<path class="w3m-areacash" d="' + cashPath + '"/>');
    s.push('<path class="w3m-areainv" d="' + invPath + '"/>');
    s.push('<path class="w3m-linecash" d="' + cashLine + '"/>');
    s.push('<path class="w3m-linetot" d="' + totLine + '"/>');

    // 基準（アンカー）の縦点線
    var aIdx = -1;
    for (i = 0; i < n; i++) if (MODEL && pts[i].ymi === MODEL.anchorYmi) aIdx = i;
    if (aIdx >= 0) {
      var ax = X(aIdx);
      s.push('<line class="w3m-anchorln" x1="' + ax.toFixed(1) + '" y1="' + padT + '" x2="' + ax.toFixed(1) + '" y2="' + base + '"/>');
      if (!compact) {
        var anchor = ax > W - 70 ? 'text-anchor="end" x="' + (ax - 4).toFixed(1) + '"' : 'x="' + (ax + 4).toFixed(1) + '"';
        s.push('<text class="w3m-anchortx" ' + anchor + ' y="' + (padT + 9) + '">基準</text>');
      }
    }

    // 点（確定＝塗り丸／当月暫定＝中抜き）
    for (i = 0; i < n; i++) {
      s.push('<circle class="w3m-dot' + (pts[i].isComplete ? "" : " prov") + '" cx="' + X(i).toFixed(1) +
        '" cy="' + Y(pts[i].total).toFixed(1) + '" r="2.5"/>');
    }

    // X ラベル（4点）
    if (!compact || n > 1) {
      var count = compact ? 3 : 4;
      for (var k = 0; k < count; k++) {
        var idx = Math.round(k * (n - 1) / (count - 1));
        var tx = X(idx), ta = k === 0 ? "start" : (k === count - 1 ? "end" : "middle");
        s.push('<text class="w3m-axtx" x="' + tx.toFixed(1) + '" y="' + (H - 4) + '" text-anchor="' + ta + '">' +
          esc(ymSlash(pts[idx].ymi)) + '</text>');
      }
    }

    // hover インジケータ + ヒット領域
    s.push('<line class="w3m-ind" x1="0" y1="' + padT + '" x2="0" y2="' + base + '" style="display:none"/>');
    s.push('<rect class="w3m-hit" x="' + padL + '" y="' + padT + '" width="' + plotW + '" height="' + plotH + '"/>');
    s.push("</svg>");

    return { html: s.join(""), geo: { W: W, padL: padL, plotW: plotW, n: n, X: X, Y: Y, padT: padT, base: base } };
  }

  function captionFor(p) {
    if (!p) return "";
    return "<b>" + esc(ymLabel(p.ymi)) + "</b>：総資産 <b>" + esc(yen(p.total)) + "</b>" +
      "<i>（現金 " + esc(yen(p.cash)) + "・投資 " + esc(yen(p.invest)) + "）" +
      (p.isComplete ? "" : "（当月・暫定）") + "</i>";
  }

  // 推移カードの中身（期間バー＋SVG＋キャプション＋注記）を container に描く。
  function renderSeries(container, compact) {
    try {
      container.innerHTML = "";
      var pts = slicePts(MODEL.pts);

      var bar = el("div", "w3m-bar");
      bar.appendChild(el("span", "w3m-bar-lb", "期間"));
      PERIODS.forEach(function (p) {
        var b = el("button", "w3m-pbtn" + (getPeriod() === p.k ? " on" : ""), esc(p.label));
        b.type = "button";
        b.addEventListener("click", function (ev) {
          ev.preventDefault(); ev.stopPropagation();
          setPeriod(p.k);
          renderSeries(container, compact);
        });
        bar.appendChild(b);
      });
      container.appendChild(bar);

      var wrap = el("div", "w3m-svgwrap");
      var built = buildSvg(pts, compact);
      wrap.innerHTML = built.html;
      container.appendChild(wrap);

      var cap = el("div", "w3m-cap", captionFor(pts.length ? pts[pts.length - 1] : null));
      container.appendChild(cap);

      if (!compact) {
        var lg = el("div", "w3m-legend",
          '<span><i class="cash"></i>現金</span><span><i class="inv"></i>投資（元本）</span>' +
          '<span>○＝当月（暫定）</span>');
        container.appendChild(lg);
      }

      // 逆算の注記は「表示中の窓に基準より前の点が実際にある」ときだけ出す（6M 窓では無意味な注記になる）
      var hasBack = MODEL.anchorYmi !== null && pts.length && pts[0].ymi < MODEL.anchorYmi;
      var anchorTxt = hasBack ? "・基準（" + ymLabel(MODEL.anchorYmi) + "）より前は収支から逆算" : "";
      container.appendChild(el("div", "w3m-foot",
        compact
          ? esc("投資分は現在値で固定" + anchorTxt)
          : esc("投資分（コア＋サテライト）は現在値で固定・時価ではありません" + anchorTxt)));

      // hover / tap
      var svg = wrap.querySelector("svg");
      var geo = built.geo;
      if (svg && geo && pts.length) {
        var ind = svg.querySelector(".w3m-ind");
        var pick = function (clientX) {
          var r = svg.getBoundingClientRect();
          if (!r.width) return;
          var vx = (clientX - r.left) / r.width * geo.W;
          var t = geo.n === 1 ? 0 : (vx - geo.padL) / geo.plotW * (geo.n - 1);
          var i = clamp(Math.round(t), 0, geo.n - 1);
          cap.innerHTML = captionFor(pts[i]);
          if (ind) {
            var x = geo.X(i).toFixed(1);
            ind.setAttribute("x1", x); ind.setAttribute("x2", x);
            ind.style.display = "";
          }
        };
        svg.addEventListener("mousemove", function (e) { pick(e.clientX); });
        svg.addEventListener("mouseleave", function () {
          cap.innerHTML = captionFor(pts[pts.length - 1]);
          if (ind) ind.style.display = "none";
        });
        svg.addEventListener("touchstart", function (e) {
          if (e.touches && e.touches[0]) pick(e.touches[0].clientX);
        }, { passive: true });
        svg.addEventListener("touchmove", function (e) {
          if (e.touches && e.touches[0]) pick(e.touches[0].clientX);
        }, { passive: true });
      }
    } catch (e) { console.error(LOG, "renderSeries", e); }
  }

  // ================================================================ inject
  function makeRail() {
    if (!MODEL.rail.length) return null;
    var rail = el("div", "w3m-rail " + MARK);
    MODEL.rail.forEach(function (it) {
      var row = el("div", "w3m-rail-item " + it.level);
      // ● は本文と同じインライン流に置く（flex の別アイテムにすると狭幅で1文字だけ改行される）。
      row.appendChild(el("span", "w3m-rail-txt", '<span class="w3m-rail-dot">●</span>' + it.html));
      var b = el("button", "w3m-rail-link", esc(it.link));
      b.type = "button";
      b.addEventListener("click", function () { jump(it.jump); });
      row.appendChild(b);
      rail.appendChild(row);
    });
    return rail;
  }

  function makeSeriesCard() {
    // 案 A: 独立 fold ／ 案 B: ヒーロー内コンパクト ／ 案 C: 収支 fold の先頭
    if (VARIANT === "A") {
      var det = document.createElement("details");
      det.className = "mcc-fold mcc-fold-w3 " + MARK;
      det.id = "mcc-sec-series";
      det.open = true;
      var momTxt = MODEL.mom ? ("前月比 <b class=\"" + (MODEL.mom.delta >= 0 ? "pos" : "neg") + "\">" +
        esc(yenSigned(MODEL.mom.delta)) + "</b>") : "前月比 —";   // §7 と同じ符号記法
      var yr = yearDelta();
      det.innerHTML =
        '<summary><span class="mcc-fold-mk"></span><span class="mcc-fold-nm">資産の推移</span>' +
        '<span class="mcc-fold-dg">' + momTxt + "・直近12ヶ月 " +
        (yr === null ? "—" : '<b class="' + (yr >= 0 ? "pos" : "neg") + '">' + esc(yenSigned(yr)) + "</b>") +
        "</span></summary>" +
        '<div class="mcc-fold-body"><div class="w3m-series"></div></div>';
      renderSeries(det.querySelector(".w3m-series"), false);
      return det;
    }
    if (VARIANT === "B") {
      var box = el("div", "w3m-series compact " + MARK);
      renderSeries(box, true);
      return box;
    }
    // C: 収支 fold の本文先頭に「資産の推移」ブロック（見出し＋本体）
    var block = el("div", "w3m-cblock " + MARK);
    block.appendChild(el("div", "mcc-section-title", "資産の推移"));
    var body = el("div", "w3m-series");
    block.appendChild(body);
    renderSeries(body, false);
    return block;
  }

  function yearDelta() {
    var c = MODEL.complete;
    if (c.length < 2) return null;
    var last = c[c.length - 1];
    var target = last.ymi - 12;
    var base = null;
    for (var i = 0; i < c.length; i++) if (c[i].ymi <= target) base = c[i];
    if (!base) base = c[0];
    return last.total - base.total;
  }

  function insertAfter(node, ref) {
    if (!ref || !ref.parentNode) return false;
    if (ref.nextSibling) ref.parentNode.insertBefore(node, ref.nextSibling);
    else ref.parentNode.appendChild(node);
    return true;
  }

  function injectHero(root) {
    var hero = root.querySelector(".mcc-hero");
    if (!hero) return;

    // (a-1) 前月比バッジ（金額の右）
    var amount = hero.querySelector(".mcc-hero-amount");
    if (amount && MODEL.mom) {
      var cls = MODEL.mom.delta > 0 ? "pos" : (MODEL.mom.delta < 0 ? "neg" : "flat");
      // 兄弟として置く（.mcc-hero-amount の中身は金額のみのまま＝既存 E2E の金額アサートを壊さない）。
      // 同じ行の右に見せるのは CSS 側（.mcc-hero-amount を inline-block 化）で行う。
      insertAfter(el("span", "w3m-mom " + cls + " " + MARK, esc(momText(MODEL.mom))), amount);
    }

    // (a-2) runway チップ（ゲージ行の末尾）
    var grow = hero.querySelector(".mcc-hero-gauge-row");
    if (grow && MODEL.runway !== null) {
      var low = MODEL.runway < MODEL.bufferMonths;
      var chip = el("span", "w3m-runway " + (low ? "low" : "ok") + " " + MARK,
        esc("生活費 " + MODEL.runway.toFixed(1) + "ヶ月分"));
      chip.title = "目標 " + MODEL.bufferMonths + "ヶ月分";
      grow.appendChild(chip);
    }
    return hero;
  }

  function injectFoldRows(root) {
    // 目標（§7: onTrack / behind / noDeadline / noPace / overdue。achieved は既存の「達成 ✓」バッジに委ねる）
    var pace = esc(yen(MODEL.monthlySurplus));
    var goalEls = root.querySelectorAll("#mcc-tab-dash .mcc-goal");
    for (var i = 0; i < goalEls.length; i++) {
      var g = MODEL.goals[i];
      var stat = goalEls[i].querySelector(".mcc-goal-stat");
      if (!g || !stat || g.status === "achieved") continue;
      var eta = g.etaYmi === null ? "" : esc(ymLabel(g.etaYmi));
      var txt, warn = false;
      if (g.status === "overdue") {
        txt = "期限（" + esc(ymOfDate(g.deadline)) + "）を過ぎています・あと <b>" + esc(yen(g.remaining)) + "</b>";
        warn = true;
      } else if (g.status === "noPace") {
        txt = "現ペースでは見込みが立ちません（余剰が 0 の月が続いています）";
        warn = true;
      } else if (g.status === "noDeadline") {
        txt = "達成見込み <b>" + eta + "ごろ</b>（現ペース 月 " + pace + "）";
      } else if (g.status === "onTrack") {
        txt = "達成見込み <b>" + eta + "ごろ</b>（現ペース 月 " + pace + "）・期限に間に合う見込み（必要 月 " +
          esc(yen(g.requiredMonthly)) + "）";
      } else {   // behind
        txt = "達成見込み <b>" + (eta || "—") + "ごろ</b>（現ペース 月 " + pace + "）・期限（" +
          esc(ymOfDate(g.deadline)) + "）に間に合わせるには <b>月 " + esc(yen(g.requiredMonthly)) + "</b>";
        warn = true;
      }
      insertAfter(el("div", "w3m-note " + (warn ? "warn " : "") + MARK, txt), stat);
    }

    // 確保枠（§4.5: unknown / noDeadline / complete は行を出さない）
    var rsvEls = root.querySelectorAll("#mcc-tab-dash .mcc-rsv");
    for (var j = 0; j < rsvEls.length; j++) {
      var rv = MODEL.reserves[j];
      var sub = rsvEls[j].querySelector(".mcc-rsv-sub");
      if (!rv || !sub) continue;
      if (rv.status === "unknown" || rv.status === "noDeadline" || rv.status === "complete") continue;
      var t2, w2 = false;
      if (rv.status === "overdue") {
        t2 = "期日（" + esc(ymOfDate(rv.deadline)) + "）を過ぎています・あと <b>" + esc(yen(rv.projectedShortfall)) + "</b>";
        w2 = true;
      } else if (rv.status === "short") {
        t2 = "期日までに <b>" + esc(yen(rv.projectedShortfall)) + "</b> 不足の見込み（今のペース 月 " +
          esc(yen(rv.allocated)) + "）";
        w2 = true;
      } else {
        t2 = "期日までに確保できる見込み";
      }
      insertAfter(el("div", "w3m-note " + (w2 ? "warn " : "") + MARK, t2), sub);
    }

    // NISA（§7 逐語・level!=="none" のとき本文先頭へ／digest にも「残枠 ¥X」を追記）
    var nz = MODEL.nisa;
    if (nz.level !== "none") {
      var nisaBody = root.querySelector("#mcc-sec-nisa .mcc-fold-body .mcc-nisa");
      if (nisaBody) {
        var box = el("div", "w3m-nisanote " + (nz.level === "info" ? "" : nz.level + " ") + MARK,
          "今年の非課税枠は翌年に繰り越せません。残り <b>" + esc(yen(nz.remainingTotal)) +
          "</b>（つみたて " + esc(yen(nz.remainingTsumitate)) + "・成長 " + esc(yen(nz.remainingGrowth)) +
          "）・月 <b>" + esc(yen(nz.monthlyToFillTotal)) + "</b> で年内満額（残 " + nz.monthsLeft + "ヶ月）");
        nisaBody.insertBefore(box, nisaBody.firstChild);
      }
      var dg = root.querySelector("#mcc-sec-nisa > summary .mcc-fold-dg");
      if (dg) dg.appendChild(el("span", MARK, "・残枠 <b>" + esc(yen(nz.remainingTotal)) + "</b>"));
    }
  }

  function injectSeries(root, hero) {
    if (VARIANT === "B") {
      var main = hero && hero.querySelector(".mcc-hero-main");
      if (main) main.appendChild(makeSeriesCard());
      return;
    }
    if (VARIANT === "C") {
      var fold = root.querySelector("#mcc-sec-cashflow");
      if (!fold) return;
      if (fold.tagName === "DETAILS" && !fold.open) fold.open = true;
      var body = fold.querySelector(".mcc-fold-body");
      if (body) body.insertBefore(makeSeriesCard(), body.firstChild);
      return;
    }
    // A: ヒーロー（＋リマインド帯）の直下に独立 fold
    var afterNode = root.querySelector(".w3m-rail") || hero;
    if (afterNode) insertAfter(makeSeriesCard(), afterNode);
  }

  var _injectCount = 0;
  var _openedOnce = false;
  function tryInject() {
    try {
      if (!MODEL) return;
      var root = document.getElementById("mcc-root");
      if (!root) return;
      var hero = root.querySelector(".mcc-hero");
      if (!hero) return;                       // まだ司令室が描かれていない
      if (root.querySelector("." + MARK)) return; // 注入済み

      // モック限定: 注入先の折りたたみ（NISA・確保枠/資産目標）を初回だけ開く。既定は閉じているため、
      // 開かないと「fold 内の追記行」がスクショにも初見の画面にも出ない＝比較にならない。
      if (!_openedOnce) {
        _openedOnce = true;
        ["mcc-sec-nisa", "mcc-sec-reserves-goals"].forEach(function (id) {
          var d = document.getElementById(id);
          if (d && d.tagName === "DETAILS") d.open = true;
        });
      }

      injectHero(root);
      var rail = makeRail();
      if (rail) insertAfter(rail, hero);
      injectSeries(root, hero);
      injectFoldRows(root);
      // 注入済みマーカー（案や描画状況によっては他の注入物が0個になり得るため必ず1個は置く）。
      var m = el("span", MARK + " w3m-marker");
      m.style.display = "none";
      root.appendChild(m);
      _injectCount++;
      reportConsistency();
    } catch (e) { console.error(LOG, "tryInject", e); }
  }

  // 画面幅が変わったら viewBox を選び直す（狭幅で目盛りが潰れないように）。
  var _rsTimer = null;
  function onResizeSeries() {
    if (_rsTimer) clearTimeout(_rsTimer);
    _rsTimer = setTimeout(function () {
      try {
        var list = document.querySelectorAll("#mcc-root .w3m-series");
        for (var i = 0; i < list.length; i++) {
          renderSeries(list[i], /\bcompact\b/.test(list[i].className));
        }
      } catch (e) { console.error(LOG, "onResizeSeries", e); }
    }, 180);
  }

  function reportConsistency() {
    try {
      var amountEl = document.querySelector("#mcc-root .mcc-hero-amount");
      var heroTxt = amountEl ? amountEl.textContent.replace(/前月比[\s\S]*$/, "").trim() : "";
      var heroNum = Number(heroTxt.replace(/[^\d-]/g, ""));
      var lastCash = MODEL.last ? MODEL.last.cash : null;
      var ok = lastCash !== null && heroNum === Math.round(lastCash);
      console.log(LOG, "variant=" + VARIANT, "now=" + NOW.toISOString().slice(0, 10),
        "hero=" + heroTxt, "seriesLastConfirmedCash=" + (lastCash === null ? "-" : yen(lastCash)),
        "MATCH=" + ok);
      window.__W3M__ = {
        variant: VARIANT, now: NOW.toISOString().slice(0, 10),
        heroAmount: heroNum, seriesLastCash: lastCash, match: ok,
        points: MODEL.pts.length, rail: MODEL.rail.length,
        monthlySurplus: MODEL.monthlySurplus,
        mom: MODEL.mom, runway: MODEL.runway,
      };
    } catch (e) { console.error(LOG, "reportConsistency", e); }
  }

  // ================================================================ panel
  function buildPanel() {
    try {
      if (document.querySelector(".w3m-panel")) return;
      var p = el("div", "w3m-panel");
      var nowParam = NOW_RAW && /^\d{4}-\d{2}-\d{2}$/.test(NOW_RAW) ? NOW_RAW : "";
      function href(v, nowv) {
        var q = "?w3variant=" + v + (nowv ? "&w3now=" + nowv : "");
        return location.pathname + q;
      }
      var rows = [];
      rows.push('<div class="w3m-panel-h">W3 モック / 案 ' + esc(VARIANT) + "</div>");
      var a = ["A", "B", "C"].map(function (v) {
        return '<a href="' + esc(href(v, nowParam)) + '"' + (v === VARIANT ? ' class="on"' : "") + ">" + v + "</a>";
      }).join("");
      rows.push('<div class="w3m-panel-r"><span>案</span>' + a + "</div>");
      var dates = [["今日", ""], ["11/15", "2026-11-15"], ["12/15", "2026-12-15"]];
      var d = dates.map(function (x) {
        var on = (x[1] === nowParam);
        return '<a href="' + esc(href(VARIANT, x[1])) + '"' + (on ? ' class="on"' : "") + ">" + esc(x[0]) + "</a>";
      }).join("");
      rows.push('<div class="w3m-panel-r"><span>日付</span>' + d + "</div>");
      rows.push('<div class="w3m-panel-r"><span>幅</span><b id="w3m-vw">-</b></div>');
      p.innerHTML = rows.join("");
      document.body.appendChild(p);
      var vw = document.getElementById("w3m-vw");
      var upd = function () { if (vw) vw.textContent = window.innerWidth + "px"; };
      upd();
      window.addEventListener("resize", function () { upd(); onResizeSeries(); });
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

    var onReady = function () {
      buildPanel();
      openCockpit();
      loadModel();
    };
    if (document.readyState === "complete") setTimeout(onReady, 0);
    else window.addEventListener("load", onReady);
  } catch (e) { console.error(LOG, "boot", e); }
})();
