/* W1「ポータル一目パック」配置3案の実物比較モック（scratchpad/w1-mock-server.py が注入）。
 *
 *   現行 : 何も足さない（比較の基準）
 *   案①  : 発掘ストリップ（表の上に4タブの横並びカード列・表は無変更）
 *   案②  : 表のモード切替（[財務]/[値動き]・値動き時は業種セクションを畳んで1枚表・列ヘッダで並べ替え）
 *   案③  : ヒートマップ先頭（industry×前日比のタイル・クリックでその業種に絞り込み）
 *
 * データは STOCK_DATA[ticker].px（Neon 実データ dump）。本実装では list.py が同じ形を返す想定。
 *   px = { last, date, c1, c5, vr, dh, hi52, lo52, pos52, spark[30] }
 * このファイルはモック専用＝本番コードには入れない（決まった案だけを spec/plan 経由で実装する）。
 */
(function () {
  "use strict";

  var LS_VARIANT = "w1_variant", LS_TAB = "w1_tab", LS_ETF = "w1_etf", LS_TMODE = "w1_tmode";
  var variant = localStorage.getItem(LS_VARIANT) || "strip";   // off | strip | table | heat
  var tab = localStorage.getItem(LS_TAB) || "gain";            // gain | lose | vol | high
  var tableMode = localStorage.getItem(LS_TMODE) || "px";      // fin | px（案②のトグル）
  var includeEtf = localStorage.getItem(LS_ETF) === "1";

  var UP = "#00e676", DOWN = "#ff5c7a", MUTED = "#7f95a3";
  var esc = window.esc || function (s) { return String(s == null ? "" : s); };

  /* ───────── helpers ───────── */
  function pxOf(t) { var d = (typeof STOCK_DATA !== "undefined") && STOCK_DATA[t]; return d && d.px; }
  function toneOf(v) { return v == null ? MUTED : (v > 0 ? UP : (v < 0 ? DOWN : MUTED)); }
  function signed(v, digits, unit) {
    if (v == null || !isFinite(v)) return "--";
    var s = (v > 0 ? "+" : "") + v.toFixed(digits == null ? 2 : digits);
    return s + (unit || "");
  }
  function money(v, currency) {
    if (v == null) return "--";
    var s = v >= 1000 ? Math.round(v).toLocaleString() : v.toFixed(2);
    return currency === "USD" ? "$" + s : "¥" + s;
  }
  function universe() {
    var out = [];
    if (typeof STOCK_DATA === "undefined") return out;
    for (var t in STOCK_DATA) {
      var d = STOCK_DATA[t];
      if (!d || !d.px) continue;
      if (!includeEtf && (d.type || "stock") === "etf") continue;
      out.push({ ticker: t, name: d.company_name || t, industry: d.industry || "—",
                 currency: d.currency, country: d.country, type: d.type || "stock", px: d.px });
    }
    return out;
  }
  function sparkSVG(spark, color, w, h) {
    if (!spark || spark.length < 2) return "";
    w = w || 88; h = h || 26;
    var pad = 2, n = spark.length, dx = (w - pad * 2) / (n - 1), pts = [];
    for (var i = 0; i < n; i++) {
      var y = pad + (100 - spark[i]) / 100 * (h - pad * 2);
      pts.push((pad + i * dx).toFixed(1) + "," + y.toFixed(1));
    }
    var area = "M" + pts[0] + " L" + pts.join(" L") + " L" + (w - pad).toFixed(1) + "," + (h - pad) + " L" + pad + "," + (h - pad) + " Z";
    var uid = "w1g" + Math.abs(spark[0] * 31 + spark[n - 1] * 7 + n);
    return '<svg class="w1-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">' +
      '<defs><linearGradient id="' + uid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.28"/>' +
      '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + uid + ')"/>' +
      '<polyline points="' + pts.join(" ") + '" fill="none" stroke="' + color + '" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }
  function go(t) { if (typeof window.navigateToDetail === "function") window.navigateToDetail(t); }
  function asOf() {
    var u = universe()[0];
    return (u && u.px && u.px.date) || "";
  }

  /* ───────── style ───────── */
  var CSS = `
  #w1-host { margin: 0 0 18px; }
  .w1-cap { font-size: 12px; color: var(--ix-text-dim); margin: 0 0 8px; letter-spacing: .02em; }
  .w1-cap b { color: var(--ix-text); font-weight: 600; }
  .w1-panel { background: var(--ix-surface-panel); border: 1px solid var(--ix-border); border-radius: 12px; padding: 12px 12px 14px; }
  .w1-tabs { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
  .w1-tab { font-size: 12px; padding: 7px 12px; min-height: 32px; border-radius: 999px; cursor: pointer;
            background: transparent; color: var(--ix-text-dim); border: 1px solid var(--ix-border-mid); font-family: inherit; }
  .w1-tab.on { color: var(--ix-text-hi); border-color: rgba(0,229,255,.45); background: rgba(0,229,255,.08); }
  .w1-cards { display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x proximity; }
  .w1-card { flex: 0 0 158px; scroll-snap-align: start; background: var(--ix-surface-chart); border: 1px solid var(--ix-border);
             border-radius: 10px; padding: 9px 10px; cursor: pointer; transition: border-color .15s, transform .15s; }
  .w1-card:hover { border-color: rgba(0,229,255,.4); transform: translateY(-2px); }
  .w1-card .t { font-family: var(--ix-mono); font-size: 12px; color: var(--ix-cyan); letter-spacing: .04em; }
  .w1-card .n { font-size: 12px; color: var(--ix-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin: 2px 0 4px; }
  .w1-card .big { font-size: 17px; font-weight: 700; font-family: var(--ix-mono); line-height: 1.1; }
  .w1-card .sub { font-size: 12px; color: var(--ix-text-dim); font-family: var(--ix-mono); }
  .w1-card .row { display: flex; align-items: flex-end; justify-content: space-between; gap: 6px; }
  .w1-disc { font-size: 12px; color: var(--ix-slate); margin-top: 9px; line-height: 1.5; }

  /* 案② 値動きテーブル */
  .w1-modebar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .w1-seg { display: inline-flex; border: 1px solid var(--ix-border-mid); border-radius: 999px; overflow: hidden; }
  .w1-seg button { font-size: 12px; padding: 7px 14px; min-height: 32px; background: transparent; color: var(--ix-text-dim);
                   border: 0; cursor: pointer; font-family: inherit; }
  .w1-seg button.on { background: rgba(0,229,255,.12); color: var(--ix-text-hi); }
  table.w1-px { width: 100%; border-collapse: collapse; background: var(--ix-surface-panel);
                border: 1px solid var(--ix-border-strong); border-radius: 2px; overflow: hidden; }
  table.w1-px tbody tr:nth-child(even) { background: rgba(255,255,255,.012); }
  table.w1-px th { position: sticky; top: 0; z-index: 2; background: #0a0f17; font-size: 12px; color: var(--ix-text-dim);
                   text-align: left; padding: 9px 8px; border-bottom: 1px solid var(--ix-border-strong); cursor: pointer; white-space: nowrap; }
  table.w1-px th.on { color: var(--ix-cyan); }
  table.w1-px td { padding: 8px; border-bottom: 1px solid rgba(20,32,43,.7); font-size: 13px; white-space: nowrap; }
  table.w1-px tr:hover td { background: rgba(0,229,255,.04); cursor: pointer; }
  .w1-num { font-family: var(--ix-mono); font-weight: 600; }
  .w1-rangebar { position: relative; width: 84px; height: 6px; border-radius: 3px; background: #16222c; }
  .w1-rangebar i { position: absolute; top: -3px; width: 2px; height: 12px; background: var(--ix-cyan); border-radius: 1px; }
  .w1-52 { font-size: 12px; color: var(--ix-text-dim); font-family: var(--ix-mono); }

  /* 案③ ヒートマップ */
  .w1-heat-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .w1-heat-col > h4 { font-size: 12px; color: var(--ix-text-dim); margin: 0 0 8px; letter-spacing: .08em; }
  .w1-grp { margin-bottom: 10px; }
  .w1-grp-h { display: flex; align-items: baseline; gap: 6px; font-size: 12px; color: var(--ix-text); cursor: pointer; margin-bottom: 4px; }
  .w1-grp-h .c { color: var(--ix-slate); }
  .w1-grp-h:hover { color: var(--ix-cyan); }
  .w1-tiles { display: grid; grid-template-columns: repeat(auto-fill, minmax(58px, 1fr)); gap: 3px; }
  .w1-tile { border-radius: 4px; padding: 5px 3px; text-align: center; cursor: pointer; border: 1px solid rgba(255,255,255,.05); }
  .w1-tile:hover { outline: 1px solid var(--ix-cyan); }
  .w1-tile .tt { font-family: var(--ix-mono); font-size: 12px; color: #eaf6fb; line-height: 1.15; }
  .w1-tile .tv { font-family: var(--ix-mono); font-size: 12px; color: rgba(255,255,255,.82); }
  .w1-legend { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ix-text-dim); margin-top: 8px; }
  .w1-legend span.sw { width: 22px; height: 10px; border-radius: 2px; display: inline-block; }

  /* 切替バー */
  #w1-switch { position: fixed; right: 14px; bottom: 14px; z-index: 9999; display: flex; gap: 6px; align-items: center;
               background: rgba(4,7,12,.94); border: 1px solid var(--ix-border-mid); border-radius: 999px; padding: 7px 10px;
               box-shadow: 0 10px 30px rgba(0,0,0,.6); backdrop-filter: blur(6px); }
  #w1-switch b { font-size: 12px; color: var(--ix-slate); letter-spacing: .06em; margin-right: 2px; }
  #w1-switch button { font-size: 12px; min-height: 32px; padding: 6px 11px; border-radius: 999px; cursor: pointer;
                      background: transparent; border: 1px solid var(--ix-border-mid); color: var(--ix-text-dim); font-family: inherit; }
  #w1-switch button.on { background: rgba(0,229,255,.14); border-color: rgba(0,229,255,.5); color: var(--ix-text-hi); }
  #w1-switch label { font-size: 12px; color: var(--ix-text-dim); display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  @media (max-width: 760px) {
    table.w1-px th, table.w1-px td { padding: 8px 5px; }
    table.w1-px td .company-clickable { display: block; max-width: 150px; overflow: hidden; text-overflow: ellipsis; }
    .w1-heat-cols { grid-template-columns: 1fr; }
    #w1-switch { right: 8px; left: 8px; bottom: 8px; justify-content: center; flex-wrap: wrap; }
    .w1-card { flex-basis: 142px; }
  }`;

  function injectCSS() {
    var s = document.createElement("style");
    s.id = "w1-style";
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  /* ───────── 案①：発掘ストリップ ───────── */
  var TABS = [
    { key: "gain", label: "値上がり",     sort: function (a, b) { return b.px.c1 - a.px.c1; },
      main: function (p) { return { text: signed(p.c1, 2, "%"), tone: toneOf(p.c1) }; },
      sub: function (p) { return "5日 " + signed(p.c5, 1, "%"); } },
    { key: "lose", label: "値下がり",     sort: function (a, b) { return a.px.c1 - b.px.c1; },
      main: function (p) { return { text: signed(p.c1, 2, "%"), tone: toneOf(p.c1) }; },
      sub: function (p) { return "5日 " + signed(p.c5, 1, "%"); } },
    { key: "vol",  label: "出来高急増",   sort: function (a, b) { return b.px.vr - a.px.vr; },
      main: function (p) { return { text: (p.vr == null ? "--" : p.vr.toFixed(2) + "倍"), tone: p.vr >= 1.5 ? "#ffca3a" : MUTED }; },
      sub: function (p) { return "前日比 " + signed(p.c1, 2, "%"); } },
    { key: "high", label: "52週高値に接近", sort: function (a, b) { return b.px.dh - a.px.dh; },
      main: function (p) { return { text: (p.dh == null ? "--" : (p.dh >= -0.001 ? "高値更新" : "高値まで " + Math.abs(p.dh).toFixed(1) + "%")),
                                    tone: p.dh >= -1 ? UP : "#ffca3a" }; },
      sub: function (p) { return "前日比 " + signed(p.c1, 2, "%"); } },
  ];

  function renderStrip(host) {
    var t = TABS.filter(function (x) { return x.key === tab; })[0] || TABS[0];
    var rows = universe().filter(function (e) { return e.px && e.px.c1 != null; }).sort(t.sort).slice(0, 12);
    var html = '<div class="w1-cap">今日の動き　<b>' + esc(asOf()) + ' 終値</b>　/　' + universe().length + '銘柄' +
      (includeEtf ? "（ETF含む）" : "（株式のみ）") + '</div><div class="w1-panel"><div class="w1-tabs">';
    TABS.forEach(function (x) {
      html += '<button class="w1-tab' + (x.key === tab ? " on" : "") + '" data-tab="' + x.key + '">' + x.label + "</button>";
    });
    html += '</div><div class="w1-cards">';
    rows.forEach(function (e) {
      var p = e.px, m = t.main(p), tone = toneOf(p.c1);
      html += '<div class="w1-card" data-t="' + esc(e.ticker) + '">' +
        '<div class="t">' + esc(e.ticker) + "</div>" +
        '<div class="n" title="' + esc(e.name) + '">' + esc(e.name) + "</div>" +
        sparkSVG(p.spark, tone, 136, 30) +
        '<div class="row"><div class="big" style="color:' + m.tone + '">' + m.text + "</div>" +
        '<div class="sub">' + money(p.last, e.currency) + "</div></div>" +
        '<div class="sub">' + t.sub(p) + "</div></div>";
    });
    html += "</div><div class=\"w1-disc\">終値ベースの事実の並べ替えです（推奨・売買判断ではありません）。出来高倍率＝当日出来高 ÷ 直近20営業日平均。</div></div>";
    host.innerHTML = html;
    host.querySelectorAll(".w1-tab").forEach(function (b) {
      b.onclick = function () { tab = b.dataset.tab; localStorage.setItem(LS_TAB, tab); renderStrip(host); };
    });
    host.querySelectorAll(".w1-card").forEach(function (c) {
      c.onclick = function () { go(c.dataset.t); };
    });
  }

  /* ───────── 案②：表のモード切替 ───────── */
  var PX_COLS_WIDE = [
    { key: "ticker", label: "コード", w: "8%" },
    { key: "name", label: "企業名", w: "26%" },
    { key: "last", label: "終値", w: "11%" },
    { key: "c1", label: "前日比", w: "11%" },
    { key: "c5", label: "5日", w: "10%" },
    { key: "vr", label: "出来高倍率", w: "11%" },
    { key: "pos52", label: "52週レンジ", w: "13%" },
    { key: "spark", label: "30日", w: "10%", nosort: true },
  ];
  // 390px では8列は成立しない（横スクロールで前日比が画面外へ出る）＝4列に落とす。
  var PX_COLS_NARROW = [
    { key: "name", label: "銘柄", w: "44%" },
    { key: "last", label: "終値", w: "20%" },
    { key: "c1", label: "前日比", w: "20%" },
    { key: "spark", label: "30日", w: "16%", nosort: true },
  ];
  var NARROW_MAX = 760;
  function isNarrow() { return window.innerWidth <= NARROW_MAX; }
  function pxCols() { return isNarrow() ? PX_COLS_NARROW : PX_COLS_WIDE; }
  var PRICE_KEYS = { last: 1, c1: 1, c5: 1, vr: 1, pos52: 1 };
  var flat = null;   // { el, tbody }

  function buildFlatSection() {
    var st = window.__w1host.sortState();
    var wrap = document.createElement("div");
    wrap.className = "sector-section";
    var scroll = document.createElement("div");
    scroll.style.cssText = "overflow-x:auto;-webkit-overflow-scrolling:touch;width:100%;background:#0a0f17;border-radius:10px;";
    var table = document.createElement("table");
    table.className = "w1-px";   // ⚠ portal-table を付けない：既存の nth-child 列非表示が別の列を消すため
    var th = pxCols().map(function (c) {
      var on = st.key === c.key;
      var icon = c.nosort ? "" : '<span class="sort-icon">' + (on ? (st.asc ? "▲" : "▼") : "↕") + "</span>";
      return '<th style="width:' + c.w + '" class="' + (on ? "on" : "") + '" data-k="' + (c.nosort ? "" : c.key) + '">' + c.label + icon + "</th>";
    }).join("");
    table.innerHTML = "<thead><tr>" + th + "</tr></thead><tbody></tbody>";
    table.querySelectorAll("th[data-k]").forEach(function (h) {
      if (!h.dataset.k) return;
      h.onclick = function () { window.__w1host.setSort(h.dataset.k); };
    });
    scroll.appendChild(table);
    wrap.appendChild(scroll);
    return { el: wrap, tbody: table.querySelector("tbody") };
  }

  function pxSection(ind, count, orig) {
    if (variant !== "table" || tableMode !== "px") return orig(ind, count);
    if (!flat || !document.contains(flat.el)) flat = buildFlatSection();     // 新しい描画サイクル
    else return { sectionEl: document.createDocumentFragment(), tbody: flat.tbody };
    return { sectionEl: flat.el, tbody: flat.tbody };
  }

  function pxRow(item, orig) {
    if (variant !== "table" || tableMode !== "px") return orig(item);
    var p = pxOf(item.ticker);
    var tr = document.createElement("tr");
    tr.onclick = function (ev) { go(item.ticker, ev); };
    if (!p) { tr.innerHTML = '<td colspan="' + pxCols().length + '" style="color:var(--ix-slate)">' + esc(item.ticker) + "（価格データなし）</td>"; return tr; }
    var pos = Math.max(0, Math.min(100, p.pos52));
    if (isNarrow()) {
      tr.innerHTML =
        '<td><div class="company-clickable" style="font-size:13px">' + esc(item.name) + "</div>" +
          '<span class="ticker-code" style="font-size:12px">' + esc(item.ticker) + "</span></td>" +
        '<td class="w1-num" style="color:var(--ix-text)">' + money(p.last, item.currency) + "</td>" +
        '<td class="w1-num" style="color:' + toneOf(p.c1) + '">' + signed(p.c1, 2, "%") + "</td>" +
        "<td>" + sparkSVG(p.spark, toneOf(p.c1), 52, 22) + "</td>";
      return tr;
    }
    tr.innerHTML =
      '<td><span class="ticker-code">' + esc(item.ticker) + "</span></td>" +
      '<td><span class="company-clickable" title="' + esc(item.name) + '">' + esc(item.name) + "</span>" +
        (window.currencyBadge ? window.currencyBadge(item.currency) : "") + "</td>" +
      '<td class="w1-num" style="color:var(--ix-text)">' + money(p.last, item.currency) + "</td>" +
      '<td class="w1-num" style="color:' + toneOf(p.c1) + '">' + signed(p.c1, 2, "%") + "</td>" +
      '<td class="w1-num" style="color:' + toneOf(p.c5) + '">' + signed(p.c5, 1, "%") + "</td>" +
      '<td class="w1-num" style="color:' + (p.vr >= 1.5 ? "#ffca3a" : "var(--ix-text-dim)") + '">' + (p.vr == null ? "--" : p.vr.toFixed(2) + "倍") + "</td>" +
      "<td><div class=\"w1-rangebar\"><i style=\"left:" + pos + "%\"></i></div>" +
        '<div class="w1-52">高値まで ' + (p.dh == null ? "--" : Math.abs(p.dh).toFixed(1) + "%") + "</div></td>" +
      "<td>" + sparkSVG(p.spark, toneOf(p.c1), 84, 24) + "</td>";
    return tr;
  }

  function renderTableChrome(host) {
    host.innerHTML =
      '<div class="w1-cap">一覧の見せ方を切り替える　<b>' + esc(asOf()) + ' 終値</b></div>' +
      '<div class="w1-modebar"><div class="w1-seg">' +
      '<button data-m="fin" class="' + (tableMode === "fin" ? "on" : "") + '">財務</button>' +
      '<button data-m="px" class="' + (tableMode === "px" ? "on" : "") + '">値動き</button></div>' +
      '<span class="w1-cap" style="margin:0">' +
      (tableMode === "px"
        ? "値動きモード：業種セクションを畳んで1枚表にし、列ヘッダで全銘柄を横断して並べ替えます。"
        : "財務モード：現行のまま（業種セクション＋財務10列）。") +
      "</span></div>";
    host.querySelectorAll(".w1-seg button").forEach(function (b) {
      b.onclick = function () {
        tableMode = b.dataset.m; localStorage.setItem(LS_TMODE, tableMode);
        flat = null;
        var k = window.__w1host.sortState().key;
        // 値動きモードは「前日比の降順」で開く（発掘の既定）。財務へ戻す時は財務側の既定(コード順)へ。
        if (tableMode === "px" && !PRICE_KEYS[k]) return window.__w1host.setSort("c1");
        if (tableMode === "fin" && PRICE_KEYS[k]) return window.__w1host.setSort("ticker");
        window.__w1host.rerender();
      };
    });
  }

  /* ───────── 案③：ヒートマップ ───────── */
  // 日本株はティッカーが数字で識別できない → 社名を短縮して出す（米国株はティッカーが通り名）。
  function tileLabel(e) {
    if (e.ticker.indexOf(".T") === -1) return e.ticker;
    var n = String(e.name || "").replace(/(ホールディングス|グループ本社|グループ|株式会社|・|　| )/g, "");
    return n.slice(0, 4) || e.ticker.replace(".T", "");
  }
  function heatColor(c1) {
    if (c1 == null) return "rgba(120,140,150,.18)";
    var a = 0.12 + Math.min(1, Math.abs(c1) / 3) * 0.62;
    return c1 >= 0 ? "rgba(0,214,110," + a.toFixed(2) + ")" : "rgba(255,80,110," + a.toFixed(2) + ")";
  }
  function renderHeat(host) {
    var groups = {};
    universe().forEach(function (e) { (groups[e.industry] = groups[e.industry] || []).push(e); });
    var keys = Object.keys(groups).sort(function (a, b) { return groups[b].length - groups[a].length; });
    var cols = { jp: [], us: [] };
    keys.forEach(function (k) { (k.indexOf("US - ") === 0 ? cols.us : cols.jp).push(k); });

    function block(k) {
      var g = groups[k].slice().sort(function (a, b) { return b.px.c1 - a.px.c1; });
      var avg = g.reduce(function (s, e) { return s + (e.px.c1 || 0); }, 0) / g.length;
      var tiles = g.map(function (e) {
        return '<div class="w1-tile" data-t="' + esc(e.ticker) + '" title="' + esc(e.name) + " " + esc(e.ticker) + " " + signed(e.px.c1, 2, "%") + '" ' +
          'style="background:' + heatColor(e.px.c1) + '">' +
          '<div class="tt">' + esc(tileLabel(e)) + "</div>" +
          '<div class="tv">' + signed(e.px.c1, 1, "") + "</div></div>";
      }).join("");
      return '<div class="w1-grp"><div class="w1-grp-h" data-sec="' + esc(k) + '">' +
        esc(k.replace("US - ", "")) + ' <span class="c">' + g.length + "社 / 平均 " +
        '<span style="color:' + toneOf(avg) + '">' + signed(avg, 2, "%") + "</span></span></div>" +
        '<div class="w1-tiles">' + tiles + "</div></div>";
    }

    host.innerHTML =
      '<div class="w1-cap">市場の温度感　<b>' + esc(asOf()) + " 終値の前日比</b>　/　業種名をクリックでその業種に絞り込み</div>" +
      '<div class="w1-panel"><div class="w1-heat-cols">' +
      '<div class="w1-heat-col"><h4>日本株</h4>' + cols.jp.map(block).join("") + "</div>" +
      '<div class="w1-heat-col"><h4>米国株</h4>' + cols.us.map(block).join("") + "</div></div>" +
      '<div class="w1-legend"><span>下落</span>' +
      '<span class="sw" style="background:' + heatColor(-3) + '"></span>' +
      '<span class="sw" style="background:' + heatColor(-1) + '"></span>' +
      '<span class="sw" style="background:' + heatColor(0) + '"></span>' +
      '<span class="sw" style="background:' + heatColor(1) + '"></span>' +
      '<span class="sw" style="background:' + heatColor(3) + '"></span><span>上昇（±3%で振り切り）</span></div>' +
      '<div class="w1-disc">終値ベースの事実の可視化です（推奨・売買判断ではありません）。</div></div>';

    host.querySelectorAll(".w1-tile").forEach(function (el) { el.onclick = function () { go(el.dataset.t); }; });
    host.querySelectorAll(".w1-grp-h").forEach(function (el) {
      el.onclick = function () { window.__w1host.setSector(el.dataset.sec); };
    });
  }

  /* ───────── 切替バー & 配線 ───────── */
  var VARIANTS = [
    { key: "off", label: "現行" }, { key: "strip", label: "案① ストリップ" },
    { key: "table", label: "案② 表モード" }, { key: "heat", label: "案③ ヒートマップ" },
  ];
  function renderSwitch() {
    var bar = document.getElementById("w1-switch");
    if (!bar) { bar = document.createElement("div"); bar.id = "w1-switch"; document.body.appendChild(bar); }
    bar.innerHTML = "<b>W1</b>" + VARIANTS.map(function (v) {
      return '<button data-v="' + v.key + '" class="' + (v.key === variant ? "on" : "") + '">' + v.label + "</button>";
    }).join("") + '<label><input type="checkbox" id="w1-etf"' + (includeEtf ? " checked" : "") + "> ETFも含む</label>";
    bar.querySelectorAll("button").forEach(function (b) {
      b.onclick = function () {
        variant = b.dataset.v; localStorage.setItem(LS_VARIANT, variant);
        flat = null; renderSwitch(); window.__w1host.rerender();
      };
    });
    bar.querySelector("#w1-etf").onchange = function (e) {
      includeEtf = e.target.checked; localStorage.setItem(LS_ETF, includeEtf ? "1" : "0");
      window.__w1host.rerender();
    };
  }

  function host() {
    var h = document.getElementById("w1-host");
    if (!h) {
      var c = document.getElementById("portal-container");
      if (!c) return null;
      h = document.createElement("div");
      h.id = "w1-host";
      c.parentNode.insertBefore(h, c);
    }
    return h;
  }

  window.__W1 = {
    decorate: function (item, company) {
      var p = company && company.px;
      if (!p) return;
      item.px = p; item.last = p.last; item.c1 = p.c1; item.c5 = p.c5;
      item.vr = p.vr; item.dh = p.dh; item.pos52 = p.pos52;
    },
    row: pxRow,
    section: pxSection,
    afterRender: function () {
      var h = host();
      if (!h) return;
      if (variant === "off") { h.innerHTML = ""; return; }
      if (variant === "strip") return renderStrip(h);
      if (variant === "table") {
        renderTableChrome(h);
        // 値動きモードは前日比の降順で開く（初回描画時に1度だけ整える）
        var st = window.__w1host.sortState();
        if (tableMode === "px" && !PRICE_KEYS[st.key] && !window.__w1sorted) {
          window.__w1sorted = 1; window.__w1host.setSort("c1");
        }
        return;
      }
      if (variant === "heat") return renderHeat(h);
    },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  function boot() {
    injectCSS(); renderSwitch();
    var wasNarrow = isNarrow(), t = null;
    window.addEventListener("resize", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (isNarrow() === wasNarrow) return;
        wasNarrow = isNarrow(); flat = null; window.__w1host.rerender();
      }, 200);
    });
  }
})();
