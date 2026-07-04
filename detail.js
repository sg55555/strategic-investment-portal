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
  }

  function removeFromCompare(ticker) {
    compareSet.delete(ticker);
    renderCompareChips();
    DetailCharts.renderCompareChart(compareSet, comparePeriodMonths);
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
      var lo = m.min, hi = m.max, span = (hi - lo) || 1;
      var pos = Math.max(0, Math.min(100, ((m.value - lo) / span) * 100));
      var medPos = (m.median == null) ? 50 : Math.max(0, Math.min(100, ((m.median - lo) / span) * 100));
      return '<div class="relpos-row">' +
        '<div class="relpos-label" data-term="' + window.esc(m.termKey) + '">' + window.esc(m.label) + '</div>' +
        '<div class="relpos-bar"><div class="relpos-median" style="left:' + medPos.toFixed(1) + '%"></div>' +
        '<div class="relpos-marker tone-' + window.esc(m.tone) + '" style="left:' + pos.toFixed(1) + '%"></div></div>' +
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
    const finCards = ["kpi-compare-card", "bs-title", "radar-title", "pl-title", "cf-title", "health-trend-card", "relative-position-card"];
    finCards.forEach(id => {
      const card = document.getElementById(id)?.closest(".card");
      if (card) card.style.display = isEtf ? "none" : "";
    });
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
    // Feature: 相対で見る目 束B ①相対ポジションカード。ETF/財務欠損は上の early-return でここに到達しない
    //  （relative-position-card は finCards に登録済＝ETF時 display:none）。関数内で fail-safe 非描画も持つ。
    renderRelativePosition(currentTicker);
    // forceChartRepaint() は価格チャート描画直後（early-return より前）へ移設済（上記参照）。
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
  // cross-module seam(共有ヘルパ): animateNumber は detail-charts.js の renderBSChart/renderRadarChart が
  //  free-var 参照する（Task2 で global 前提のまま relocate 済）。detail.js へ移した本体を window に露出し
  //  detail-charts.js 側の bare 参照を解決させる（純ヘルパゆえ状態 seam と異なり引数化でなく shared global）。
  window.animateNumber = animateNumber;
  window.renderRelativePosition = renderRelativePosition; // 相対ポジションカード（テスト/将来の手動再描画用）
  // 内部/将来用（switchYear は navigateToDetail 内 closure ゆえ bare 露出不要）。
  window.Detail = { navigateToDetail, updateFinancialViews, switchYear, termHelp, injectTermHelp, renderSignalDigest, renderRelativePosition };
})();
