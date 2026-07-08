// detail.js — 詳細ビュー(#detail-view)のDOM/オーケストレーション/イベント（IIFE隔離）。
// detail-view 分離リファクタ Task3: index.html にインライン混在していた
//   ①詳細オーケストレーション(navigateToDetail/switchYear/updateFinancialViews/renderKpiCompare)
//   ②比較モーダル(openCompareModal/compareSearchInput/addToCompare/removeFromCompare/renderCompareChips/setComparePeriod)
//   ③CSVエクスポート(exportCSV/_doExportCSV)＋数値アニメ/整形ヘルパ(animateNumber/fmtBillion)
// を move-not-rewrite で IIFE クロージャへ隔離し、bare-global だった詳細状態
//   (selectedYear/pageUnit/compareSet/comparePeriodMonths)を private 化する（挙動不変）。
// 純計算=DetailRules・描画=DetailCharts・単位=FinanceRules・ルーター=showView へ委譲（参照のみ・再宣言しない）。
// ⚠️cross-module state seam: pageUnit/compareSet/comparePeriodMonths は detail-charts.js が読むため
//   render*Chart / renderCompareChart へ引数で流し込む（index.html global 削除後の ReferenceError 回避）。
//   描画ロジック本体は detail-charts.js 側で不変・signature と参照解決のみ。
// inline onclick / portal / cross-module 用に bare 名(navigateToDetail/exportCSV/compare群)＋window.Detail を露出。
// ⚠️読込順: この <script> は detail-charts.js / detail-rules.js の後（依存が下）・money-rules.js の前。
//   currentTicker/watchlist/STOCK_DATA/getStock/esc/ICO/currencyBadge/trackEvent/isWatched/watchChipLabel/
//   toggleWatchlist/showView/DEFAULT_CURRENCY 等は index.html インライン(classic script global)を free-var 参照。
(function () {
  "use strict";

  // ── 詳細ビューの内部状態（index.html から private 化・bare-global 解消）──
  //  currentTicker は portal/watchlist が読むため index.html global 維持（双方 free-var 参照）。
  let selectedYear = 2025;
  let pageUnit = null;   // Batch C: 会社規模で選定した「ページ統一単位」（pickUnit の結果）。

  // 比較チャート（index.html から verbatim relocate）
  let compareSet = new Set();
  let comparePeriodMonths = 12;

  function openCompareModal() {
    compareSet = new Set([currentTicker]);
    document.getElementById("compare-modal").classList.add("active");
    document.getElementById("compare-search-input").value = "";
    document.getElementById("compare-search-list").style.display = "none";
    renderCompareChips();
    DetailCharts.renderCompareChart(compareSet, comparePeriodMonths);
    setCompareTab("chart");  // Task9: モーダルを開くたびチャート既定へリセット
  }

  function compareSearchInput() {
    const q = document.getElementById("compare-search-input").value.toLowerCase().trim();
    const list = document.getElementById("compare-search-list");
    if (!q) { list.style.display = "none"; return; }
    const results = Object.keys(STOCK_DATA).filter(t => {
      const d = STOCK_DATA[t];
      return (t.toLowerCase().includes(q) || d.company_name.toLowerCase().includes(q)) && !compareSet.has(t);
    }).slice(0, 10);
    if (results.length === 0) { list.style.display = "none"; return; }
    list.innerHTML = results.map(t => `<div class="compare-search-item" onclick="addToCompare('${t}')">${t} — ${esc(STOCK_DATA[t].company_name)}</div>`).join("");
    list.style.display = "block";
  }

  async function addToCompare(ticker) {
    if (compareSet.size >= 8) { alert("比較は最大8銘柄です"); return; }
    // v2 Slice1: 比較に載せる前に prices をその場ハイドレート
    if (typeof getStock === "function") { try { await getStock(ticker); } catch (e) { console.error("getStock failed", e); } }
    compareSet.add(ticker);
    document.getElementById("compare-search-input").value = "";
    document.getElementById("compare-search-list").style.display = "none";
    renderCompareChips();
    DetailCharts.renderCompareChart(compareSet, comparePeriodMonths);
    _rerenderCompareTableIfVisible();
  }

  function removeFromCompare(ticker) {
    compareSet.delete(ticker);
    renderCompareChips();
    DetailCharts.renderCompareChart(compareSet, comparePeriodMonths);
    _rerenderCompareTableIfVisible();
  }
  // Task9: テーブルタブ表示中のみ再描画（チャートタブ中は無駄な再描画をしない）
  function _rerenderCompareTableIfVisible() {
    var table = document.getElementById("compare-table-container");
    if (table && table.style.display !== "none") renderCompareTable(compareSet);
  }

  function renderCompareChips() {
    const chipsEl = document.getElementById("compare-chips");
    chipsEl.innerHTML = [...compareSet].map((t, i) => {
      const color = DetailRules.COMPARE_COLORS[i % DetailRules.COMPARE_COLORS.length];
      return `<div class="compare-chip" style="border-color:${color};color:${color};background:${color}22;">
        ${esc(STOCK_DATA[t]?.company_name || t)}
        <span class="compare-chip-remove" onclick="removeFromCompare('${t}')">✕</span>
      </div>`;
    }).join("");
  }

  function setComparePeriod(months) {
    comparePeriodMonths = months;
    document.querySelectorAll(".compare-period-btn").forEach(b => b.classList.remove("active"));
    window.event.target.classList.add("active");   // Task3: 暗黙 global event を window.event に明示化（markup 無改変・挙動不変）
    DetailCharts.renderCompareChart(compareSet, comparePeriodMonths);
  }

  // ── ②比較テーブル（Feature: 相対で見る目 束B・指標比較タブ）───────────────────
  //  純計算は CrossSection.compareMetricsRows（期間非依存の指標のみ・ETF は比率 N/A・時価総額のみ表示）。
  //  term は INDICATOR_GLOSSARY のキー（小文字ハイフン短コード）に一致させる（?ツールチップが引けるように）。
  var COMPARE_COLS = [
    { key: "per", label: "PER", term: "per" }, { key: "pbr", label: "PBR", term: "pbr" },
    { key: "roe", label: "ROE", term: "roe" }, { key: "netMargin", label: "純利益率", term: "net-margin" },
    { key: "opMargin", label: "営業利益率", term: "op-margin" }, { key: "equityRatio", label: "自己資本比率", term: "equity-ratio" },
    { key: "currentRatio", label: "流動比率", term: "current-ratio" }, { key: "marketCap", label: "時価総額", term: "market-cap" },
  ];
  function renderCompareTable(setLike) {
    var host = document.getElementById("compare-table-container");
    if (!host) return;
    var CS = (typeof CrossSection !== "undefined") ? CrossSection : window.CrossSection;
    var disc = (typeof DetailRules !== "undefined") && DetailRules.ANALYSIS_DISCLAIMER;
    var tickers = setLike ? Array.from(setLike) : [];
    // 注意: STOCK_DATA は dataClient.js トップレベル let の生束縛（cross-script bare 読取専用・
    //  window.STOCK_DATA は存在しない＝F2 の罠と同型）。window コピーではなく bare 参照で読む。
    // FIX5: 免責フェイルクローズ。ANALYSIS_DISCLAIMER(disc) が取得不能なら分析本体(表)を描画しない
    //  （renderRelativePosition と同じ規制不変条件＝免責なしで分析を出さない）。
    if (!CS || !disc || !tickers.length || typeof STOCK_DATA === "undefined" || !STOCK_DATA) { host.innerHTML = ""; return; }
    var rows = CS.compareMetricsRows(tickers, STOCK_DATA);
    var head = '<th>銘柄</th>' + COMPARE_COLS.map(function (c) {
      return '<th data-term="' + window.esc(c.term) + '">' + window.esc(c.label) + '</th>'; }).join("");
    var body = rows.map(function (r) {
      var tds = '<td>' + window.esc(r.name) + (r.isEtf ? ' <span class="cmp-etf">ETF</span>' : '') + '</td>';
      tds += COMPARE_COLS.map(function (c) {
        var cell = r.cells[c.key];
        // FIX8: 時価総額セルは cell.format(fmtMagnitude) が既に「兆円/兆ドル」の通貨単位を含むため、
        //  末尾に ¥/$ を追記しない（"1.50 兆円 ¥" の二重通貨を解消）。
        return '<td class="' + (cell.missing ? 'na' : '') + '">' + window.esc(cell.format) + '</td>';
      }).join("");
      return '<tr>' + tds + '</tr>';
    }).join("");
    host.innerHTML = '<div class="cmp-table-wrap"><table class="cmp-table"><thead><tr>' + head +
      '</tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="cmp-note">※ 時価総額は通貨単位が異なり市場をまたぐ比較はできません。</div>' +
      (disc ? '<div class="panel-disclaimer">' + window.esc(disc) + '</div>' : '');
    if (typeof injectTermHelp === "function") injectTermHelp(host);
  }
  function setCompareTab(which) {
    var chart = document.getElementById("compare-chart-container");
    var table = document.getElementById("compare-table-container");
    var legend = document.getElementById("compare-legend");
    var bChart = document.getElementById("compare-tab-chart"), bTable = document.getElementById("compare-tab-table");
    var isTable = which === "table";
    if (chart) chart.style.display = isTable ? "none" : "";
    if (legend) legend.style.display = isTable ? "none" : "";
    if (table) { table.style.display = isTable ? "" : "none"; if (isTable) renderCompareTable(compareSet); }
    if (bChart) bChart.classList.toggle("active", !isTable);
    if (bTable) bTable.classList.toggle("active", isTable);
  }

  function exportCSV() {
    trackEvent("csv_export", { ticker: currentTicker });
    _doExportCSV();
  }
  function _doExportCSV() {
    const data = STOCK_DATA[currentTicker];
    if (!data) return;
    const currency = data.currency || DEFAULT_CURRENCY;
    const unit = FinanceRules.fmtUnit(currency);
    const years = Object.keys(data.financials_trend).sort();
    const rows = [
      ["指標", "単位", ...years],
      ["企業名", "", ...years.map(() => data.company_name)],
      ["ティッカー", "", ...years.map(() => currentTicker)],
      ["", "", ...years.map(() => "")],
      ["売上高", unit, ...years.map(y => data.financials_trend[y]?.net_sales || 0)],
      ["売上総利益", unit, ...years.map(y => data.financials_trend[y]?.gross_profit || 0)],
      ["営業利益", unit, ...years.map(y => data.financials_trend[y]?.operating_income || 0)],
      ["税引前当期利益", unit, ...years.map(y => data.financials_trend[y]?.income_before_taxes || 0)],
      ["当期純利益", unit, ...years.map(y => data.financials_trend[y]?.net_income || 0)],
      ["", "", ...years.map(() => "")],
      ["流動資産", unit, ...years.map(y => data.financials_trend[y]?.current_assets || 0)],
      ["固定資産", unit, ...years.map(y => data.financials_trend[y]?.non_current_assets || 0)],
      ["流動負債", unit, ...years.map(y => data.financials_trend[y]?.current_liabilities || 0)],
      ["固定負債", unit, ...years.map(y => data.financials_trend[y]?.non_current_liabilities || 0)],
      ["純資産", unit, ...years.map(y => data.financials_trend[y]?.net_assets || 0)],
      ["", "", ...years.map(() => "")],
      ["営業CF", unit, ...years.map(y => data.financials_trend[y]?.operating_cf || 0)],
      ["投資CF", unit, ...years.map(y => data.financials_trend[y]?.investing_cf || 0)],
      ["財務CF", unit, ...years.map(y => data.financials_trend[y]?.financing_cf || 0)],
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const bom = "﻿";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentTicker}_financials.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function animateNumber(el, endVal, suffix, decimals, duration) {
    if (!el) return;
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.innerText = (endVal * eased).toFixed(decimals) + suffix;
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function fmtBillion(val, currency) {
    // F1: 単位整形は finance-rules.js に集約（旧 inline と同挙動）。
    return FinanceRules.fmtMagnitude(val, currency);
  }

  // ── 分析グロッサリ用語ヘルプ（Task2: 純CSSポップオーバー・inline onclick 不使用＝CSP フレンドリー）──
  //  データは DetailRules.INDICATOR_GLOSSARY（Task1）。エスケープは window.esc（F2 公開・money.js 私有 esc は跨がない）。
  var _indGloMap = null;
  function _indGlo() {
    if (_indGloMap) return _indGloMap;
    _indGloMap = {};
    var arr = (window.DetailRules && window.DetailRules.INDICATOR_GLOSSARY) || [];
    for (var i = 0; i < arr.length; i++) _indGloMap[arr[i].term] = arr[i];
    return _indGloMap;
  }
  function termHelp(term) {
    var g = _indGlo()[term];
    if (!g) return ""; // 未知 term は no-op（安全側）
    var def = window.esc(g.read + "：" + g.def);
    var aria = window.esc(g.read + "とは：" + g.def);
    return '<span class="term-help" tabindex="0" role="note" data-def="' + def +
           '" aria-label="' + aria + '">?</span>';
  }
  function injectTermHelp(root) {
    if (!root) return;
    var nodes = root.querySelectorAll("[data-term]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.querySelector(":scope > .term-help")) continue; // 重複注入ガード（冪等）
      var html = termHelp(el.dataset.term);
      if (html) el.insertAdjacentHTML("beforeend", html);
    }
  }

  // ── AI読み解き（束D層2）: session probe＋capability キャッシュ ──────────────
  //  /api/auth/session を1度だけ叩き {ok, insightEnabled} をクロージャ内キャッシュ。
  //  production(非personal)デプロイでは insightEnabled=false → 可視ゲートで完全非表示（痕跡ゼロ）。
  //  fetch失敗/非2xx はすべて fail-closed（{ok:false, insightEnabled:false}）で隠す側に倒す。
  var _insightCap = null;   // {ok, insightEnabled}（probe 済みキャッシュ・成功(ok:true)のみ保持）
  function probeInsightCap() {
    // 成功キャッシュのみ短絡。未ログイン/失敗の {ok:false} はキャッシュしない＝money view での
    //  リロードなしログイン後に銘柄詳細へ戻ったら再 probe して mid-session login を拾う。
    if (_insightCap && _insightCap.ok) return Promise.resolve(_insightCap);
    return fetch("/api/auth/session", { credentials: "same-origin" })
      .then(function (r) { return r.ok ? r.json() : { ok: false, insightEnabled: false }; })
      .then(function (j) {
        var cap = { ok: !!j.ok, insightEnabled: !!j.insightEnabled };
        if (cap.ok) _insightCap = cap;   // 成功のみキャッシュ（negative は毎回再 probe）
        return cap;
      })
      .catch(function () { return { ok: false, insightEnabled: false }; });   // 失敗はキャッシュしない
  }

  // ── テクニカル現在地サマリ signalDigest カード（Feature#2）──────────────────
  //  純計算は DetailRules.signalDigest（no-score 中立閉集合）。ここは DOM 書込のみ（window.esc でエスケープ）。
  //  固定 id カードへ innerHTML 置換＝冪等（switchYear/navigate で複数回呼ばれても増殖しない）。
  //  免責が取得できなければフェイルセーフ非描画。価格のみで成立するので ETF でも表示される。
  function renderSignalDigest(displayPrices, allPrices) {
    var card = document.getElementById("signal-digest-card");
    if (!card) return;
    var disc = window.DetailRules && window.DetailRules.ANALYSIS_DISCLAIMER;
    if (!disc) { card.style.display = "none"; return; } // 免責取得不可=フェイルセーフ非描画
    var ds = (window.DetailRules && window.DetailRules.signalDigest(displayPrices, allPrices)) || [];
    if (!ds.length) { card.style.display = "none"; return; }
    var endBar = displayPrices && displayPrices.length ? displayPrices[displayPrices.length - 1] : null;
    var asOf = endBar ? endBar.time : "";
    var rows = ds.map(function (d) {
      var note = d.note ? '<span class="sig-note">' + window.esc(d.note) + "</span>" : "";
      var ro = d.readout ? '<span class="sig-readout">' + window.esc(d.readout) + "</span>" : "";
      return '<div class="sig-row"><span class="sig-label" data-term="' + window.esc(d.term) + '">' +
        window.esc(d.label) + '</span><span class="sig-state">' + window.esc(d.state) + "</span>" +
        ro + note + "</div>";
    }).join("");
    card.innerHTML =
      '<div class="card-title">テクニカル現在地サマリ' +
      (asOf ? ' <span class="sig-asof">（表示期間の最新：' + window.esc(asOf) + " 時点）</span>" : "") + "</div>" +
      '<div class="sig-body">' + rows + "</div>" +
      '<div class="sig-disclaimer">' + window.esc(disc) + "</div>";
    card.style.display = "";
    injectTermHelp(card);
  }

  // ── サブパネル選択UI（アコーディオン・案C・Task8）───────────────────────────
  //  参照移植元: scratchpad/subpanel-mock/live-C.html の addItem/removeItem/expand/collapse/toggle/
  //  buildChips（差分＝MockEngine.mount/unmount → window.DetailCharts.mountSubpanel/unmountSubpanel、
  //  ヘッダの用語?は injectTermHelp/data-term、チップは既存 .ma-btn を再利用）。
  //  0x0罠: host を display:block にしてから mountSubpanel を呼ぶ（DetailCharts 側も rAF で二重待ち）。
  //  height は DetailCharts.SUBPANEL_REGISTRY の既定値と同値（重複だが host の CSS 高さを chart 生成前に
  //  確保するため必須＝ mountSubpanel の opts.height は省略しても同じ値に解決するが、host 側は自前で持つ必要がある）。
  var SUBPANEL_META = [
    { key: "rsi",  label: "RSI",     sub: "(14)",       term: "rsi",  height: 100, desc: "買われすぎ/売られすぎの目安。70超で過熱・30割れで冷え込み。" },
    { key: "macd", label: "MACD",    sub: "(12,26,9)",  term: "macd", height: 110, desc: "短期と長期の移動平均の差。勢いの向きと転換の傾向。" },
    { key: "adx",  label: "ADX/DMI", sub: "(14)",       term: "adx",  height: 132, desc: "トレンドの強さ（向きは示さない）。25超で方向感、20未満はレンジ気味。" },
    { key: "atr",  label: "ATR%",    sub: "(14)",       term: "atr",  height: 104, desc: "1日の値幅の目安（株価に対する%）。値幅そのものは行動を促すものではない。" },
    { key: "obv",  label: "OBV",     sub: "",           term: "obv",  height: 104, desc: "終値方向×出来高の累計線。傾き・価格との食い違いを見る目安。" },
  ];
  var SOFT_CAP = 2;
  var _accItems = {};             // key -> {wrap, host, caret, expanded}
  var _subpanelUIInited = false;  // initSubpanelUI の冪等ガード（navigate/switchYear 複数回呼び対応）

  function _spMeta(key) {
    for (var i = 0; i < SUBPANEL_META.length; i++) if (SUBPANEL_META[i].key === key) return SUBPANEL_META[i];
    return null;
  }
  function _countExpanded() {
    var n = 0;
    for (var k in _accItems) if (_accItems[k] && _accItems[k].expanded) n++;
    return n;
  }
  function _chipOf(key) {
    return document.getElementById("sp-chip-" + key);
  }
  function _setHint(msg) {
    var links = document.getElementById("subpanel-links");
    if (!links) return;
    var hint = links.querySelector(".subpanel-hint");
    if (!msg) { if (hint) hint.remove(); return; }
    if (!hint) { hint = document.createElement("span"); hint.className = "subpanel-hint"; links.appendChild(hint); }
    hint.textContent = msg;
  }

  function expandSubpanel(key) {
    var it = _accItems[key];
    if (!it || it.expanded) return;
    it.expanded = true;
    it.wrap.classList.add("expanded");
    it.caret.textContent = "▾";
    var meta = _spMeta(key);
    var height = meta && meta.height ? meta.height : undefined;
    it.host.style.display = "block";
    if (height) it.host.style.height = height + "px";  // chart 生成前に host のレイアウト高さを確保（0x0罠の親版）
    window.DetailCharts && window.DetailCharts.mountSubpanel(key, it.host, height ? { height: height } : {});
  }
  function collapseSubpanel(key) {
    var it = _accItems[key];
    if (!it || !it.expanded) return;
    it.expanded = false;
    it.wrap.classList.remove("expanded");
    it.caret.textContent = "▸";
    window.DetailCharts && window.DetailCharts.unmountSubpanel(key);
    it.host.style.display = "none";
    it.host.style.height = "0";
  }
  function toggleSubpanel(key) {
    var it = _accItems[key];
    if (!it) return;
    it.expanded ? collapseSubpanel(key) : expandSubpanel(key);
  }

  function addSubpanelItem(key) {
    if (_accItems[key]) return;
    var meta = _spMeta(key);
    if (!meta) return;
    var wrap = document.createElement("div");
    wrap.className = "acc-item";
    wrap.dataset.key = key;
    var head = document.createElement("div");
    head.className = "acc-head";
    head.innerHTML =
      '<span class="acc-caret">▸</span>' +
      '<span class="acc-label" data-term="' + window.esc(meta.term) + '">' + window.esc(meta.label) + '</span>' +
      '<span class="acc-sub">' + window.esc(meta.sub) + '</span>' +
      '<span class="spacer"></span>' +
      '<span class="acc-desc">' + window.esc(meta.desc) + '</span>' +
      '<span class="acc-close" title="外す">✕</span>';
    var body = document.createElement("div");
    body.className = "acc-body";
    var fd = document.createElement("div");
    fd.className = "acc-full-desc";
    fd.textContent = meta.desc;
    var host = document.createElement("div");
    host.className = "subpanel-host";
    host.style.display = "none";
    host.style.height = "0";
    body.appendChild(fd);
    body.appendChild(host);
    wrap.appendChild(head);
    wrap.appendChild(body);
    var list = document.getElementById("subpanel-accordion");
    if (list) list.appendChild(wrap);

    _accItems[key] = { wrap: wrap, host: host, caret: head.querySelector(".acc-caret"), expanded: false };

    // 委譲でなく item 単位のリスナー（要素は addItem 時に1回だけ生成＝重複束縛なし）。
    head.addEventListener("click", function (e) {
      if (e.target.classList.contains("acc-close")) return;
      toggleSubpanel(key);
    });
    head.querySelector(".acc-close").addEventListener("click", function (e) {
      e.stopPropagation();
      removeSubpanelItem(key);
    });

    var chip = _chipOf(key);
    if (chip) chip.classList.add("active");
    injectTermHelp(wrap);

    // ソフト上限: 既に SOFT_CAP 枠展開済なら畳んだまま追加（ヒントで案内・トースト無し）。
    if (_countExpanded() >= SOFT_CAP) {
      _setHint(meta.label + " を畳んで追加（展開は" + SOFT_CAP + "枠まで・ヘッダで開けます）");
    } else {
      expandSubpanel(key);
    }
  }
  function removeSubpanelItem(key) {
    var it = _accItems[key];
    if (!it) return;
    window.DetailCharts && window.DetailCharts.unmountSubpanel(key);
    it.wrap.remove();
    delete _accItems[key];
    var chip = _chipOf(key);
    if (chip) chip.classList.remove("active");
  }

  function initSubpanelUI() {
    if (_subpanelUIInited) return;  // 冪等（navigate/switchYear の複数回呼び出しでも重複構築しない）
    var chipsEl = document.getElementById("subpanel-chips");
    var linksEl = document.getElementById("subpanel-links");
    if (!chipsEl || !linksEl) return;
    chipsEl.innerHTML = "";
    SUBPANEL_META.forEach(function (meta) {
      var b = document.createElement("button");
      b.className = "ma-btn";
      b.id = "sp-chip-" + meta.key;
      b.dataset.key = meta.key;
      b.textContent = meta.label;
      // 委譲不可（チップは固定4個・イベント委譲でなくチップ生成時1回束縛で足りる＝新規 inline onclick は増やさない）。
      b.addEventListener("click", function () {
        _accItems[meta.key] ? removeSubpanelItem(meta.key) : addSubpanelItem(meta.key);
      });
      chipsEl.appendChild(b);
    });
    var expandAll = document.createElement("a");
    expandAll.textContent = "すべて開く";
    expandAll.addEventListener("click", function () { Object.keys(_accItems).forEach(expandSubpanel); _setHint(""); });
    var collapseAll = document.createElement("a");
    collapseAll.textContent = "すべて畳む";
    collapseAll.addEventListener("click", function () { Object.keys(_accItems).forEach(collapseSubpanel); });
    linksEl.innerHTML = "";
    linksEl.appendChild(expandAll);
    linksEl.appendChild(collapseAll);

    // 既定: ADX + ATR を展開（本機能の主役=規律テクニカルを最初に見せる）。
    addSubpanelItem("adx");
    addSubpanelItem("atr");

    _subpanelUIInited = true;
  }

  // ── 規律テクニカル 現在地ミニ解説カード（Task8 Step2）──────────────────────
  //  純計算は DetailRules.disciplineDigest（no-score 中立閉集合）。生数値は丸め表示のみ（"スコア"演出禁止）。
  function renderDisciplineCard(displayPrices, allPrices) {
    var card = document.getElementById("discipline-card");
    if (!card) return;
    var disc = window.DetailRules && window.DetailRules.ANALYSIS_DISCLAIMER;
    if (!disc) { card.style.display = "none"; return; } // 免責取得不可=フェイルセーフ非描画（renderSignalDigest 同型）
    var d = window.DetailRules && window.DetailRules.disciplineDigest(displayPrices, allPrices);
    if (!d || !d.ok) { card.style.display = "none"; return; }
    var trendCls = d.trend === "方向感が強い" ? "warm" : d.trend.indexOf("レンジ") >= 0 ? "calm" : "";
    var volCls = d.vol === "振れ大きめ" ? "hot" : d.vol === "静穏" ? "calm" : "";
    card.style.display = "";
    card.innerHTML =
      '<div class="disc-title">規律テクニカル 現在地</div>' +
      '<div class="disc-chip"><span class="k">トレンド強度</span><span class="v ' + trendCls + '" data-term="adx">' +
        window.esc(d.trend) + '（ADX ' + Math.round(d.adx) + '・' + window.esc(d.dir) + '）</span></div>' +
      '<div class="disc-chip"><span class="k">値幅</span><span class="v ' + volCls + '" data-term="atr">' +
        window.esc(d.vol) + '（ATR% ' + d.atrPct.toFixed(1) + '%）</span></div>' +
      '<div class="disc-note">' + window.esc(d.note) + '</div>' +
      '<div class="panel-disclaimer">' + window.esc(disc) + '</div>';
    injectTermHelp(card);
  }

  // ── ①相対ポジションカード（Feature: 相対で見る目 束B）───────────────────────
  //  純計算は CrossSection.relativePosition（同市場内パーセンタイル・中立バンド語）。ここは DOM 書込のみ。
  //  免責/CrossSection/STOCK_DATA いずれか欠落・ETF・自己データ欠損はフェイルセーフ非描画（renderSignalDigest 同型）。
  function renderRelativePosition(ticker) {
    var card = document.getElementById("relative-position-card");
    if (!card) return;
    var CS = (typeof CrossSection !== "undefined") ? CrossSection : window.CrossSection;
    var disc = (typeof DetailRules !== "undefined") && DetailRules.ANALYSIS_DISCLAIMER;
    // 注意: STOCK_DATA は dataClient.js トップレベル let の生束縛（cross-script bare 読取専用・
    //  window.STOCK_DATA は存在しない＝F2 の罠と同型）。window コピーではなく bare 参照で読む。
    if (!CS || !disc || typeof STOCK_DATA === "undefined" || !STOCK_DATA) { card.style.display = "none"; return; }
    var rp = CS.relativePosition(ticker, STOCK_DATA);
    if (!rp || rp.etf) { card.style.display = "none"; return; }
    function barRow(m) {
      if (m.value == null) {
        return '<div class="relpos-row"><div class="relpos-label" data-term="' + window.esc(m.termKey) + '">' + window.esc(m.label) +
          '</div><div class="relpos-na">データなし</div><div class="relpos-val">—</div></div>';
      }
      // FIX3: バー上の位置はパーセンタイルで表す（キャプション/バンドと同一尺度）。marketCap 等の
      //  歪んだ分布で min-max 線形位置がキャプション（パーセンタイル）と矛盾する旧バグを解消。
      //  中央値ティックは定義上 50 パーセンタイル＝常に 50% に置く。
      var pos = Math.max(0, Math.min(100, (typeof m.percentile === "number" ? m.percentile : 50)));
      // FIX4: マーカー色は単一の中立色（tone クラス廃止）。緑=高/赤=低の方向的良し悪しを色で
      //  含意しないよう、位置は中立バンド語（テキスト）に委ね、色は指標横断で一貫させる。
      return '<div class="relpos-row">' +
        '<div class="relpos-label" data-term="' + window.esc(m.termKey) + '">' + window.esc(m.label) + '</div>' +
        '<div class="relpos-bar"><div class="relpos-median" style="left:50%"></div>' +
        '<div class="relpos-marker" style="left:' + pos.toFixed(1) + '%"></div></div>' +
        '<div class="relpos-val">' + window.esc(m.format) + '</div>' +
        '<div class="relpos-cap">' + window.esc(m.caption) + '</div></div>';
    }
    var html = '<div class="card-title" data-term="同市場比較">相対ポジション <span class="relpos-sub">' +
      window.esc(rp.marketLabel) + window.esc(String(rp.marketN)) + '銘柄との比較</span></div>';
    rp.groups.forEach(function (grp) {
      if (!grp.metrics.length) return;
      html += '<div class="relpos-group"><div class="relpos-group-title">' + window.esc(grp.title) + '</div>' +
        grp.metrics.map(barRow).join("") + '</div>';
    });
    html += '<div class="panel-disclaimer">' + window.esc(disc) + '</div>';
    card.innerHTML = html;
    card.style.display = "";
    if (typeof injectTermHelp === "function") injectTermHelp(card);
  }

  function renderKpiCompare(data) {
    const grid = document.getElementById("kpi-compare-grid");
    if (!grid) return;
    const currency = data.currency || DEFAULT_CURRENCY;
    const years = Object.keys(data.financials_trend).sort((a, b) => Number(a) - Number(b));
    grid.innerHTML = "";

    years.forEach((yr, idx) => {
      const fin = data.financials_trend[yr];
      const prevFin = idx > 0 ? data.financials_trend[years[idx - 1]] : null;
      const isActive = String(yr) === String(selectedYear);

      const opMargin = FinanceRules.opMargin(fin);     // F1: 純関数へ集約
      const roe = FinanceRules.roe(fin);

      const yoyBadge = DetailRules.yoyBadge;   // 前年比バッジ計算は detail-rules.js へ集約（挙動不変）

      const col = document.createElement("div");
      col.className = "kpi-year-col" + (isActive ? " active-year" : "");
      col.innerHTML = `
        <div class="kpi-year-label">
          ${yr} FY${isActive ? '<span class="kpi-active-badge">選択中</span>' : ""}
        </div>
        <div class="kpi-row">
          <span class="kpi-row-label">売上高</span>
          <span class="kpi-row-value reveal">${fmtBillion(fin.net_sales, currency)}${yoyBadge(fin.net_sales, prevFin?.net_sales)}</span>
        </div>
        <div class="kpi-row">
          <span class="kpi-row-label">営業利益率</span>
          <span class="kpi-row-value kpi-pct" data-val="${opMargin.toFixed(3)}" data-suffix="%">0.0%${yoyBadge(opMargin, prevFin ? FinanceRules.opMargin(prevFin) : null)}</span>
        </div>
        <hr class="kpi-divider">
        <div class="kpi-row">
          <span class="kpi-row-label">純利益</span>
          <span class="kpi-row-value reveal">${fmtBillion(fin.net_income, currency)}${yoyBadge(fin.net_income, prevFin?.net_income)}</span>
        </div>
        <div class="kpi-row">
          <span class="kpi-row-label">ROE</span>
          <span class="kpi-row-value kpi-pct" data-val="${roe.toFixed(3)}" data-suffix="%">0.0%${yoyBadge(roe, prevFin ? FinanceRules.roe(prevFin) : null)}</span>
        </div>
      `;
      grid.appendChild(col);
    });

    // KPI % 値のカウントアップアニメーション（YoYバッジは保持しながら数値部分のみ更新）
    grid.querySelectorAll(".kpi-pct").forEach((el, i) => {
      const val = parseFloat(el.dataset.val || "0");
      setTimeout(() => {
        const start = performance.now();
        function tick(now) {
          const t = Math.min((now - start) / 800, 1);
          const eased = 1 - Math.pow(1 - t, 3);
          if (el.childNodes[0]) el.childNodes[0].nodeValue = (val * eased).toFixed(1) + "%";
          if (t < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      }, i * 80);
    });
  }

  async function navigateToDetail(ticker) {
    trackEvent("view_detail", { ticker, company: STOCK_DATA[ticker]?.company_name });
    currentTicker = ticker;
    // v2 Slice1: 詳細を描く前に prices/全財務をその場ハイドレート（remote時のみ実フェッチ）
    if (typeof getStock === "function") { try { await getStock(ticker); } catch (e) { console.error("getStock failed", e); } }
    const data = STOCK_DATA[ticker];
    if (!data) return;

    const availableYears = Object.keys(data.financials_trend).sort(
      (a, b) => b - a,
    );
    selectedYear = availableYears[0] || 2025;

    const ctrlBox = document.getElementById("year-controller-box");
    ctrlBox.innerHTML = "";
    availableYears.reverse().forEach((yr) => {
      const btn = document.createElement("button");
      btn.className = `time-btn ${yr == selectedYear ? "active" : ""}`;
      btn.innerText = yr + " FY";
      btn.onclick = (e) => switchYear(yr, e);
      ctrlBox.appendChild(btn);
    });

    showView("detail");

    // カードフェードインアニメーション起動
    const stack = document.querySelector(".dashboard-stack");
    stack.classList.remove("animate-cards");
    void stack.offsetWidth; // reflow
    stack.classList.add("animate-cards");

    {
      const container = document.getElementById("chart-container");
      DetailCharts.resizePrice(container.clientWidth, 450);
    }

    // 【詳細グラフ・アニメーション完全復活】150ms待機でブラウザのレイアウト計算完了後に着火
    setTimeout(() => {
      updateFinancialViews();
    }, 150);
  }

  function switchYear(year, event) {
    selectedYear = year;
    document.querySelectorAll(".time-btn").forEach((b) => b.classList.remove("active"));
    event.target.classList.add("active");
    document.getElementById("selected-year-display").innerText = year + " FY";
    updateFinancialViews();
  }

  function updateFinancialViews() {
    const data = STOCK_DATA[currentTicker];
    if (!data) return;

    const fin = data.financials_trend[selectedYear];
    // C1: ここで早期 return せず、価格チャート/PER/PBR/ETF 判定まで進める。
    //  ETF(financials_trend={})や財務欠損年でもローソク足は描画する（財務固有の描画のみ後段で fin ガード）。

    // Batch C: 会社規模で1単位を選定し、ヘッダ・全チャート軸・全ラベルで統一表示する。
    //  軸の 兆/十億 混在と「単位: 百万円」表記の不整合（投資判断時の読みづらさ）を構造的に解消。
    const _maxAbs = fin ? DetailRules.financialMaxAbs(fin) : 0;
    pageUnit = FinanceRules.pickUnit(_maxAbs, data.currency);
    const unitLabel = FinanceRules.unitLabel(pageUnit);
    const currBadgeHtml = currencyBadge(data.currency);

    const headerEl = document.getElementById("active-company-header");
    headerEl.innerHTML = `
      <span class="company-title-main">${esc(data.company_name)} <span style="color:#475569;font-size:0.9rem;">(${currentTicker})</span></span>
      <span class="sector-badge">${esc(data.industry)}</span>${currBadgeHtml}
      <span style="font-size:0.7rem;color:#8ba2af;margin-left:4px;">単位: ${unitLabel}</span>
      <button class="detail-star-btn${isWatched(currentTicker) ? " watched" : ""}" id="detail-star-btn"
        onclick="toggleWatchlist('${currentTicker}')">${isWatched(currentTicker) ? ICO.starFill + " ウォッチ中" : ICO.starOutline + " ウォッチ"}</button>
      <button class="open-compare-btn" onclick="openCompareModal()">⊕ 比較チャート</button>
    `;
    document.getElementById("selected-year-display").innerText = selectedYear + " FY";

    // 米国株は暦年、日本株は4月〜翌3月の決算期でフィルタ（priceWindow で単一ソース化）
    const isUS = data.country === "US";
    const { filteredPrices, displayPrices } = DetailRules.priceWindow(data.prices, selectedYear, isUS);
    document.getElementById("stock-title").innerText =
      DetailRules.periodLabel(data.company_name, currentTicker, selectedYear, isUS, filteredPrices.length > 0);
    DetailCharts.setCandleData(displayPrices);
    DetailCharts.updateMaAndVolume(displayPrices, data.prices);

    // ★FHD 初回ペイント黒面バグの正式修正（diag=redraw で全カード黒→正常を実証）：
    //  価格チャート描画直後・かつ ETF/財務欠損の early-return より前で強制再描画をスケジュールする。
    //  ⚠️ここに置く理由: ETF(financials_trend={})や財務欠損年でも MARKET CHART カード(priceChart)は
    //   常に表示され entrance アニメで合成レイヤ黒キャッシュを起こすが、下段(isEtf/!fin)の early-return
    //   で後方の呼び出しに到達しないため（レビューで確定した欠陥）。ここなら全経路で無条件に走る。
    //  実処理は rAF＋[300,700,1100]ms 遅延で走り、後続で同期描画される財務チャート(bs/pl/cf/radar)も
    //  実行時に最新インスタンスを読むため、株式経路の再描画も従来どおり効く（検証済み挙動を保存）。
    DetailCharts.repaint();

    // Task4: 静的指標ラベルへの用語ヘルプ「?」注入。isEtf/!fin の early-return より前に置き、
    //  ETF（financials_trend={}）でも ma-control-bar の「?」が確実に注入されるようにする。
    //  冪等ガード（injectTermHelp 内）があるため switchYear 等での再呼び出しも安全。
    injectTermHelp(document.getElementById("detail-view"));

    // Feature#2: テクニカル現在地サマリ。価格のみで成立するので isEtf/!fin early-return より前で無条件に描画。
    //  カード自身の「?」注入は renderSignalDigest 内の injectTermHelp(card) が行う（冪等）。
    renderSignalDigest(displayPrices, data.prices);

    // 束C③規律テクニカル（ADX/ATR）: サブパネル選択UI（アコーディオン）は初回のみ構築（冪等・chip/accordion
    //  DOM は銘柄をまたいで再利用＝navigate/switchYear のたびに再構築しない）。既定 ADX/ATR 展開は
    //  initSubpanelUI 内で1度だけ行われ、以後の銘柄/年切替はチャート側 refreshSubpanels（updateMaAndVolume
    //  経由・上記で呼び出し済）が mount 済みパネルへ setData するだけで追従する。
    //  ミニ解説カードは renderSignalDigest と同型（価格のみで成立・isEtf/!fin early-return より前で無条件描画・
    //  switchYear 等の再呼び出しでも冪等）で毎回再描画する。
    initSubpanelUI();
    renderDisciplineCard(displayPrices, data.prices);

    // Feature: 相対で見る目 束B ①相対ポジションカード。renderSignalDigest と同型で isEtf/!fin の
    //  early-return より前に無条件で呼び、関数内の fail-safe（!disc/ETF/データ欠損で自己非表示）に
    //  可視制御を一元化する。非ETFで当年財務が欠損でも per/pbr/marketCap は raw 由来で成立し、比率群は
    //  「データなし」で表示（early-return 後に呼んで前銘柄の残像を出す旧バグを解消）。
    renderRelativePosition(currentTicker);

    const rawPer = data.per || 0;
    const rawPbr = data.pbr || 0;

    // 米国株は市場慣行を反映した別基準を適用（marketBasisFor で単一ソース化）
    const basis = DetailRules.marketBasisFor(isUS);

    if (rawPer > 0) {
      animateNumber(document.getElementById("txt-per-val"), rawPer, "倍", 1, 900);
    } else {
      document.getElementById("txt-per-val").innerText = "--";
    }
    if (rawPbr > 0) {
      animateNumber(document.getElementById("txt-pbr-val"), rawPbr, "倍", 1, 900);
    } else {
      document.getElementById("txt-pbr-val").innerText = "--";
    }

    // PER 評価カード: 計算は detail-rules.js（descriptor）、DOM 書込はここで適用（挙動不変）。
    const pCard = document.getElementById("card-per");
    const pStatus = document.getElementById("txt-per-status");
    const pVal = document.getElementById("txt-per-val");
    const perDesc = DetailRules.perStatus(rawPer, basis);
    pCard.className = perDesc.cardClass ? `status-card ${perDesc.cardClass}` : "status-card";
    pVal.style.color = perDesc.valColor;
    pStatus.innerText = perDesc.statusText;

    // PBR 評価カード: 同上（gold/red/blue・中間 blue は US/JP 分岐を descriptor が保持）。
    const bCard = document.getElementById("card-pbr");
    const bStatus = document.getElementById("txt-pbr-status");
    const bVal = document.getElementById("txt-pbr-val");
    const pbrDesc = DetailRules.pbrStatus(rawPbr, basis, isUS);
    bCard.className = pbrDesc.cardClass ? `status-card ${pbrDesc.cardClass}` : "status-card";
    bVal.style.color = pbrDesc.valColor;
    bStatus.innerText = pbrDesc.statusText;

    // 自己資本比率・流動比率の基準テキストを市場に合わせて更新（文言は detail-rules.js へ集約）
    const eqDesc = document.getElementById("desc-equity-ratio");
    const crDesc = document.getElementById("desc-current-ratio");
    if (eqDesc) eqDesc.innerText = DetailRules.equityRatioDesc(isUS);
    if (crDesc) crDesc.innerText = DetailRules.currentRatioDesc(isUS);

    // ETF・財務データなしの場合はチャートカードを非表示
    const isEtf = data.type === "etf";
    const finCards = ["kpi-compare-card", "bs-title", "radar-title", "pl-title", "cf-title", "health-trend-card", "dupont-card", "fcf-trend-card"];
    finCards.forEach(id => {
      const card = document.getElementById(id)?.closest(".card");
      if (card) card.style.display = isEtf ? "none" : "";
    });
    // ai-insight-card は常に既定 none を維持し、wireInsightCard の可視ゲート（login+personal＋層1カード表示）
    //  でのみ表示する。ETF/財務欠損(!fin)の early-return や production デプロイでは一切可視化させない（痕跡ゼロ）。
    var _aiInsightCard = document.getElementById("ai-insight-card");
    if (_aiInsightCard) _aiInsightCard.style.display = "none";
    if (isEtf) {
      document.getElementById("kpi-compare-card").style.display = "none";
      return;
    }

    // C1: 非ETFで当該年度の財務が欠損なら、価格チャートまでは描画済みなので
    //  財務固有の描画(KPI/BS/PL/CF/レーダー)だけをスキップする。
    if (!fin) return;

    // AI財務分析コメントの表示
    const aiCard = document.getElementById("ai-analysis-card");
    const aiText = document.getElementById("ai-analysis-text");
    const aiYearEl = document.getElementById("ai-analysis-year");
    const aiComment = fin?.ai_analysis;
    if (aiCard && aiComment) {
      aiText.innerText = aiComment;
      if (aiYearEl) aiYearEl.innerText = selectedYear + " FY";
      aiCard.style.display = "";
    } else if (aiCard) {
      aiCard.style.display = "none";
    }

    renderKpiCompare(data);
    // cross-module state seam: pageUnit は detail-charts.js が読むため引数で渡す（render*Chart 本体は不変）。
    DetailCharts.renderBSChart(fin, pageUnit);
    DetailCharts.renderRadarChart(fin);
    DetailCharts.renderPLChart(fin, pageUnit);
    DetailCharts.renderCFChart(fin, pageUnit);
    // Feature#3: 財務健全性の推移（二軸 line）。ETF/財務欠損は上の early-return でここに到達しない
    //  （health-trend-card は finCards に登録済＝ETF時 display:none）。免責は空 div へここで注入。
    DetailCharts.renderHealthTrend(data, isUS);
    var htDisc = document.getElementById("health-trend-disclaimer");
    if (htDisc && window.DetailRules) htDisc.textContent = window.DetailRules.ANALYSIS_DISCLAIMER || "";
    injectTermHelp(document.getElementById("health-trend-card"));
    // Task12: 束D層1配線。DuPont恒等式カード / FCF＆収益の質カード（免責は各render自己完結）。
    DetailCharts.renderDuPont(fin, data);
    DetailCharts.renderFCFTrend(data, isUS);
    injectTermHelp(document.getElementById("dupont-card"));
    injectTermHelp(document.getElementById("fcf-trend-card"));
    // Task10: 束D層2 AI読み解きカード配線（session probe→可視ゲート）。層1(DuPont/FCF)描画の直後に置く
    //  （renderDuPont が dupont-card の実 display を確定させた後に layer1Hidden を判定するため）。
    wireInsightCard(data);
    // 相対ポジションカードは renderSignalDigest 直後（early-return より前）へ移設済（上記参照）＝
    //  ETF/財務欠損でも関数内 fail-safe で自己制御する（finCards から除外済）。
    // forceChartRepaint() も価格チャート描画直後（early-return より前）へ移設済（上記参照）。
  }

  // ── AI読み解き（束D層2）: 配線・可視ゲート・オンデマンド取得・degrade・描画 ────────
  //  可視ゲート＝ログイン済 && personal デプロイ && 層1(dupont-card)が表示中 の3条件AND。
  //  production(非personal)/未ログイン/層1非表示 のいずれでも完全非表示（痕跡ゼロ）。
  function wireInsightCard(data) {
    var card = document.getElementById("ai-insight-card");
    if (!card) return;
    var body = document.getElementById("ai-insight-body");
    var btn = document.getElementById("ai-insight-btn");
    if (body) body.innerHTML = "";                       // 銘柄切替でクリア
    // 免責 fail-closed（規制不変条件④）：免責文言を一度だけ確定し、可視ゲートで空判定に使う。
    var discText = (window.DetailRules && window.DetailRules.ANALYSIS_DISCLAIMER) || "";
    var disc = document.getElementById("ai-insight-disclaimer");
    if (disc) disc.textContent = discText;
    injectTermHelp(card);
    var reqTicker = currentTicker;   // レース防止：probe 開始時点の銘柄を捕捉
    probeInsightCap().then(function (cap) {
      // stale probe ガード：probe 中に別銘柄へ遷移済みなら、去った銘柄のカード可視状態に一切触れない。
      if (currentTicker !== reqTicker) return;
      // 可視ゲート：ログイン済 && personal デプロイ && 層1(dupont-card)が表示中（ETF/財務欠損は層1が
      // finCards で display:none 済＝それに連動して insight も隠す）。data 引数は将来拡張用に受けるが判定は
      // 層1 の実 display に委ねる（ETF と非ETF財務欠損の両方を1条件で正しく捕捉）。
      var dpCard = document.getElementById("dupont-card");
      var layer1Hidden = !dpCard || dpCard.style.display === "none";
      // 免責 fail-closed（規制不変条件④）：discText が空（免責なし）なら助言カードを出さない。
      if (!(cap.ok && cap.insightEnabled) || layer1Hidden || !discText) { card.style.display = "none"; return; }
      card.style.display = "";   // finCards が '' 済でも冪等に明示表示
      if (btn) {
        btn.disabled = false;
        btn.textContent = "AIに読み解いてもらう";
        btn.onclick = function () { fetchInsight(currentTicker); };
      }
    });
  }

  function fetchInsight(ticker) {
    var btn = document.getElementById("ai-insight-btn");
    var body = document.getElementById("ai-insight-body");
    if (btn) { btn.disabled = true; btn.textContent = "読み解き中…"; }
    fetch("/api/me/insight", {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker: ticker }),
    }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      // レース防止：遅延レスポンス着信時に別銘柄へ遷移済み(currentTicker!==ticker)なら共有カード
      //  #ai-insight-body へ一切書かない（stale AI 分析が別銘柄の名義/免責下に描かれる誤判断ハザードを封じる）。
      .then(function (res) { if (currentTicker === ticker) renderInsightResult(res.status, res.j); })
      .catch(function () { if (currentTicker === ticker) renderInsightResult(0, null); })
      // ボタン文言リセットも自銘柄のときだけ（stale 応答は現銘柄自身の wiring が所有するボタンに触れない）。
      .then(function () { if (currentTicker === ticker && btn) { btn.disabled = false; btn.textContent = "再読み解き"; } });
  }

  function renderInsightResult(status, j) {
    var body = document.getElementById("ai-insight-body");
    if (!body) return;
    if (status === 200 && j && j.applicable === false) {
      body.innerHTML = '<div class="ai-ins-note">この銘柄は財務3表がないため読み解き対象外です。</div>';
      return;
    }
    var ai = j && j.ai;
    if (!ai) {  // degrade：層1 決定論を案内
      body.innerHTML = '<div class="ai-ins-note">AI読み解きは今は利用できません。上の「純資産ROE分解」「FCF＆収益の質」カードの決定論ファクトをご参照ください。</div>';
      return;
    }
    renderInsightCard(ai);
  }

  function renderInsightCard(ai) {
    var body = document.getElementById("ai-insight-body");
    if (!body) return;
    function sec(label, text) {
      if (!text) return "";
      return '<div><div class="ai-ins-sec-label">' + esc(label) + '</div><div class="ai-ins-sec-body">' + esc(text) + "</div></div>";
    }
    body.innerHTML =
      (ai.headline ? '<div class="ai-ins-headline">' + esc(ai.headline) + "</div>" : "") +
      sec("財務ストーリー", ai.story) +
      sec("判断含意", ai.assessment) +
      sec("留意点", ai.watch);
  }

  // ── window 露出（inline onclick / portal 行 onclick / cross-module 用 bare 名）──
  //  index.html インライン(削除済)の bare 参照を window プロパティ経由で解決させる。
  window.navigateToDetail = navigateToDetail;      // portal 行 tr.onclick が bare 参照
  window.exportCSV = exportCSV;                    // markup onclick="exportCSV()"
  window.openCompareModal = openCompareModal;      // updateFinancialViews 生成 onclick
  window.compareSearchInput = compareSearchInput;  // markup oninput
  window.addToCompare = addToCompare;              // compareSearchInput 生成 onclick
  window.removeFromCompare = removeFromCompare;    // renderCompareChips 生成 onclick
  window.setComparePeriod = setComparePeriod;      // markup onclick
  window.renderCompareTable = renderCompareTable;  // 将来の手動再描画用
  window.setCompareTab = setCompareTab;            // markup onclick="setCompareTab('table')"
  // cross-module seam(共有ヘルパ): animateNumber は detail-charts.js の renderBSChart/renderRadarChart が
  //  free-var 参照する（Task2 で global 前提のまま relocate 済）。detail.js へ移した本体を window に露出し
  //  detail-charts.js 側の bare 参照を解決させる（純ヘルパゆえ状態 seam と異なり引数化でなく shared global）。
  window.animateNumber = animateNumber;
  window.renderRelativePosition = renderRelativePosition; // 相対ポジションカード（テスト/将来の手動再描画用）
  // 内部/将来用（switchYear は navigateToDetail 内 closure ゆえ bare 露出不要）。
  window.Detail = { navigateToDetail, updateFinancialViews, switchYear, termHelp, injectTermHelp, renderSignalDigest, renderRelativePosition, renderInsightCard, fetchInsight, probeInsightCap, initSubpanelUI, renderDisciplineCard };
})();
