// detail-charts.js — 詳細ビュー(#detail-view)のチャート lifecycle（生成/描画/toggle/リサイズ/再描画）。
// detail-view 分離リファクタ Task2: index.html にインライン混在していた
//   ①価格チャート(LightweightCharts: ローソク/出来高/MA/BB/S-R/T-R/RSI/MACD サブチャート)
//   ②財務チャート(Chart.js: BS/PL/CF/Radar)＋ネオン発光ヘルパ/プラグイン
//   ③比較チャート＋ウィンドウリサイズ追従＋FHD 初回黒面の強制再描画
// を move-not-rewrite で IIFE クロージャへ隔離し、bare-global だったチャート
// instance/series/state を private 化する（描画/計算ロジックは本体無改変で relocate）。
// 純計算/色定数は detail-rules.js(DetailRules)へ委譲（単一ソース）。inline onclick 用に
// window.toggle* を、詳細ビュー制御用に window.DetailCharts を露出する。
// ⚠️読込順: この <script> は index.html のインライン <script>（Chart.register(ChartDataLabels)を実行）
//   の後に置く。Chart.js プラグインの afterDatasetsDraw 発火順＝登録順のため、neonGlowPlugin を
//   ChartDataLabels の後に登録して現行の描画レイヤ順（Radar のラベル発光等）を不変に保つ。
(function () {
  "use strict";

  // DetailRules（detail-rules.js・classic script global）: 純計算/色定数の単一ソース。
  const DR = (typeof DetailRules !== "undefined") ? DetailRules
    : (typeof window !== "undefined" ? window.DetailRules : null);
  // 色/特例定数は DetailRules を単一ソースとして参照（index.html 側の重複定義は撤去済）。
  const FIN_COLORS = DR.FIN_COLORS;
  const CF_BADGE_PAIR = DR.CF_BADGE_PAIR;
  const COMPARE_COLORS = DR.COMPARE_COLORS;
  const HOLDING_COMPANIES = DR.HOLDING_COMPANIES;
  // テクニカル純関数も DetailRules を単一ソースとして参照（index.html 側の重複定義は撤去済）。
  const calcMA = DR.calcMA, calcBB = DR.calcBB, detectSR = DR.detectSR,
        calcRSI = DR.calcRSI, calcMACD = DR.calcMACD, calcADX = DR.calcADX, calcATR = DR.calcATR,
        calcZigZag = DR.calcZigZag, autoZigZagDeviation = DR.autoZigZagDeviation,
        calcKeltner = DR.calcKeltner, calcVWAP = DR.calcVWAP;

  // ── チャート instance / series / state（index.html から private 化・bare-global 解消の中核）──
  let priceChart = null;
  let candleSeries = null;
  let bsChartInstance = null;
  let radarChartInstance = null;
  let plChartInstance = null;
  let cfChartInstance = null;
  let ma5Series = null, ma25Series = null, ma75Series = null;
  let volumeSeries = null;
  let maState = { 5: false, 25: false, 75: false };
  let bbUpperSeries = null, bbMidSeries = null, bbLowerSeries = null;
  let bbState = false;
      let kcUpperSeries = null, kcMidSeries = null, kcLowerSeries = null;
      let kcState = false;
      let vwapSeries = null;
      let vwapState = false;
  let srLines = [];
  let srState = false;
  let trState = false;
  let trSeries = [];
  let currentDisplayPrices = null;
  let currentAllPrices = null;
  let compareChart = null;

  // ── ネオン発光ヘルパ / Chart.js プラグイン（index.html から verbatim relocate）──
      // ── ネオン発光バー（漆黒に発光する世界観・べた塗り回避） ──
      function _hexRgba(hex, a) {
        const h = hex.replace("#", "");
        const f = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
        const n = parseInt(f, 16);
        return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
      }
      function applyCfTypeBadge(el, type) {
        const pair = CF_BADGE_PAIR[type] || CF_BADGE_PAIR.pivot;
        const t = pair[0], d = pair[1];
        el.style.background = `linear-gradient(160deg, ${_hexRgba(t, 0.72)} 0%, ${_hexRgba(t, 0.52)} 55%, ${_hexRgba(d, 0.42)} 100%)`;
        el.style.borderColor = _hexRgba(t, 0.95);
        el.style.boxShadow = [
          `0 0 22px ${_hexRgba(t, 0.55)}`, `0 0 48px ${_hexRgba(t, 0.24)}`,
          "0 13px 30px rgba(0,0,0,0.55)", "0 3px 7px rgba(0,0,0,0.42)",
          `inset 0 1px 0 ${_hexRgba("#ffffff", 0.38)}`, `inset 0 -10px 22px ${_hexRgba(d, 0.30)}`,
        ].join(",");
        el.style.color = "#fbfdff";
        el.style.textShadow = `0 0 10px ${_hexRgba(t, 0.7)}`;
      }
      function _specTop(s) { return Array.isArray(s) ? s[0] : s; }
      function _specBot(s) { return Array.isArray(s) ? s[1] : s; }
      // 半透明グラスのグラデ（背景＝チャートのグリッドが透ける）。bar 自身の y 範囲で 上=明 → 下=深。
      //  context.element があれば bar 自身の y 範囲で、無ければ chartArea で代替。chartArea 未確定時は base 色。
      function neonBarBg(spec) {
        return function (context) {
          const chart = context.chart, ca = chart.chartArea, el = context.element;
          let y0, y1;
          if (el && typeof el.y === "number" && typeof el.base === "number") { y0 = Math.min(el.y, el.base); y1 = Math.max(el.y, el.base); }
          else if (ca) { y0 = ca.top; y1 = ca.bottom; }
          else return _hexRgba(_specTop(spec), 0.7);
          if (y1 - y0 < 1) y1 = y0 + 1;
          const g = chart.ctx.createLinearGradient(0, y0, 0, y1);
          g.addColorStop(0, _hexRgba(_specTop(spec), 0.90));
          g.addColorStop(0.55, _hexRgba(_specTop(spec), 0.70));
          g.addColorStop(1, _hexRgba(_specBot(spec), 0.46));
          return g;
        };
      }
      // 配列色（CF/PL のように bar ごとに色が違う）用: dataIndex で spec を引いてグラデ化。
      function neonBarBgByIndex(specs) {
        return function (context) { return neonBarBg(specs[context.dataIndex])(context); };
      }
      // バーごとの固有色ネオン縁
      function neonEdge(spec) { return _hexRgba(_specTop(spec), 0.9); }
      function neonEdgeByIndex(specs) { return function (context) { return _hexRgba(_specTop(specs[context.dataIndex]), 0.9); }; }
      // 各バー外周に固有色の発光ブルーム（縁くっきり＝ストローク多層）。chart.$neonSpecs=[dataset毎の[bar毎spec]] を設定したチャートのみ。
      const neonGlowPlugin = {
        id: "neonGlow",
        beforeDatasetsDraw(chart) {
          if (chart.$lineGlow) { const c = chart.ctx; c.save(); c.shadowBlur = 14; c.shadowColor = "rgba(92,240,255,0.5)"; return; }
          const specs = chart.$neonSpecs; if (!specs) return;
          const ctx = chart.ctx; ctx.save();
          chart.data.datasets.forEach((ds, di) => {
            const meta = chart.getDatasetMeta(di); if (meta.hidden) return;
            meta.data.forEach((bar, bi) => {
              const sp = (specs[di] && specs[di][bi]) || specs[di] || null; if (!sp) return;
              const col = _specTop(sp);
              const p = bar.getProps(["x", "y", "base", "width"], true);
              const w = p.width, x = p.x - w / 2, yTop = Math.min(p.y, p.base), h = Math.abs(p.base - p.y);
              if (h < 0.5) return;
              ctx.lineWidth = 2.5; ctx.strokeStyle = _hexRgba(col, 0.95);
              ctx.shadowColor = _hexRgba(col, 0.85); ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
              ctx.shadowBlur = 30; ctx.strokeRect(x + 1.4, yTop + 1.4, Math.max(w - 2.8, 1), Math.max(h - 2.8, 1));
              ctx.shadowBlur = 14; ctx.strokeRect(x + 1.4, yTop + 1.4, Math.max(w - 2.8, 1), Math.max(h - 2.8, 1));
            });
          });
          ctx.restore();
        },
        afterDatasetsDraw(chart) { if (chart.$lineGlow) chart.ctx.restore(); },
      };
      Chart.register(neonGlowPlugin);
      // 数値ラベルのネオン・テキストグロー（各 datalabels に展開）
      const NEON_TEXT_GLOW = { textShadowBlur: 6, textShadowColor: "rgba(120,210,255,0.6)" };

  // ── 比較チャート（index.html から verbatim relocate）──
      function normalizeForCompare(ticker, months) {
        const prices = STOCK_DATA[ticker]?.prices || [];
        const cutDate = new Date();
        cutDate.setMonth(cutDate.getMonth() - months);
        const startStr = cutDate.toISOString().slice(0, 10);
        const filtered = prices.filter(p => p.time >= startStr);
        if (filtered.length < 2) return [];
        const base = filtered[0].close;
        return filtered.map(p => ({ time: p.time, value: parseFloat((((p.close - base) / base) * 100).toFixed(2)) }));
      }

      // cross-module state seam: compareSet/comparePeriodMonths は detail.js の closure 私有につき
      //  detail.js から引数で受ける（旧 index.html global の free-var 参照を置換・描画本体は不変）。
      function renderCompareChart(compareSet, comparePeriodMonths) {
        const container = document.getElementById("compare-chart-container");
        if (compareChart) { compareChart.remove(); compareChart = null; }
        if (compareSet.size === 0) return;

        compareChart = LightweightCharts.createChart(container, {
          layout: { background: { type: "solid", color: "#05080f" }, textColor: "#a8bcc6" },
          grid: { vertLines: { color: "rgba(0,229,255,0.06)" }, horzLines: { color: "rgba(0,229,255,0.06)" } },
          crosshair: { vertLine: { color: "rgba(92,240,255,0.45)", labelBackgroundColor: "#0a3a4a" }, horzLine: { color: "rgba(92,240,255,0.45)", labelBackgroundColor: "#0a3a4a" } },
          timeScale: { borderColor: "#2a3a44" },
          rightPriceScale: { borderColor: "#2a3a44" },
        });

        const legendEl = document.getElementById("compare-legend");
        legendEl.innerHTML = "";

        [...compareSet].forEach((ticker, i) => {
          const color = COMPARE_COLORS[i % COMPARE_COLORS.length];
          const data = normalizeForCompare(ticker, comparePeriodMonths);
          if (data.length === 0) return;
          const series = compareChart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
          series.setData(data);
          legendEl.innerHTML += `<div class="compare-legend-item"><div class="compare-legend-dot" style="background:${color}"></div><span>${esc(STOCK_DATA[ticker]?.company_name || ticker)}</span></div>`;
        });

        compareChart.timeScale().fitContent();
      }

  // ── ウィンドウリサイズ追従（index.html から verbatim relocate）──
      // P4: ウィンドウリサイズ追従。lightweight-charts は生成時のみ寸法確定で resize 非追従だった。
      //  ⚠️0x0罠回避: 詳細ビュー表示中(currentView==='detail')かつコンテナ clientWidth>0 の時のみ resize。
      //  非表示時(clientWidth=0)に resize すると 0x0 に陥るため必ずガード。各サブチャートは可視状態も確認。
      let _chartResizeTimer = null;
      function onWindowResize() {
        if (_chartResizeTimer) clearTimeout(_chartResizeTimer);
        _chartResizeTimer = setTimeout(() => {
          _chartResizeTimer = null;
          // 比較モーダルは詳細ビュー以外でも開きうるので独立に処理
          if (compareChart) {
            const cm = document.getElementById("compare-modal");
            const ccc = document.getElementById("compare-chart-container");
            if (cm && cm.classList.contains("active") && ccc && ccc.clientWidth > 0) {
              compareChart.resize(ccc.clientWidth, ccc.clientHeight);
            }
          }
          if (currentView !== "detail") return;
          const cc = document.getElementById("chart-container");
          if (priceChart && cc && cc.clientWidth > 0) priceChart.resize(cc.clientWidth, cc.clientHeight);
          resizeSubpanels();
        }, 150);
      }

  // ── 価格チャート: MA/BB/S-R/T-R/RSI/MACD toggle・サブチャート・描画（verbatim relocate）──
      function toggleMA(period) {
        maState[period] = !maState[period];
        const btn = document.getElementById("ma-btn-" + period);
        const series = { 5: ma5Series, 25: ma25Series, 75: ma75Series }[period];
        if (!series) return;
        btn.classList.toggle("active", maState[period]);
        series.applyOptions({ visible: maState[period] });
      }
      function toggleBB() {
        bbState = !bbState;
        document.getElementById("ind-btn-bb").classList.toggle("active", bbState);
        [bbUpperSeries, bbMidSeries, bbLowerSeries].forEach(s => s?.applyOptions({ visible: bbState }));
      }
      function toggleKeltner() {
        kcState = !kcState;
        document.getElementById("ind-btn-keltner").classList.toggle("active", kcState);
        [kcUpperSeries, kcMidSeries, kcLowerSeries].forEach(s => s?.applyOptions({ visible: kcState }));
      }
      function toggleVWAP() {
        vwapState = !vwapState;
        document.getElementById("ind-btn-vwap").classList.toggle("active", vwapState);
        vwapSeries?.applyOptions({ visible: vwapState });
      }
      function applySRLines(prices) {
        srLines.forEach(l => { try { candleSeries.removePriceLine(l); } catch(e) {} });
        srLines = [];
        if (!srState || !prices?.length) return;
        const { resistance, support } = detectSR(prices);
        resistance.forEach(({ price, count }) => {
          srLines.push(candleSeries.createPriceLine({
            price, color: "rgba(255,102,153,0.85)", lineWidth: 1,
            lineStyle: 2, axisLabelVisible: true, title: `R×${count}`,
          }));
        });
        support.forEach(({ price, count }) => {
          srLines.push(candleSeries.createPriceLine({
            price, color: "rgba(52,245,207,0.85)", lineWidth: 1,
            lineStyle: 2, axisLabelVisible: true, title: `S×${count}`,
          }));
        });
      }
      function toggleSR() {
        srState = !srState;
        document.getElementById("ind-btn-sr").classList.toggle("active", srState);
        const data = STOCK_DATA[currentTicker];
        if (data) applySRLines(data.prices);
      }
      // ── サブパネル 汎用レジストリ（RSI/MACD=既存ロジック・色を move-not-rewrite／ADX/ATR=
      //    scratchpad/subpanel-mock/mock-engine.js buildSubpanel の該当分岐を移植）────────────
      const subBaseOpts = {
        layout: { background: { type: "solid", color: "#05080f" }, textColor: "#a8bcc6" },
        grid: { vertLines: { color: "rgba(0,229,255,0.06)" }, horzLines: { color: "rgba(0,229,255,0.06)" } },
        rightPriceScale: { borderColor: "#2a3a44", scaleMargins: { top: 0.1, bottom: 0.1 } },
        crosshair: { mode: 1, vertLine: { color: "rgba(92,240,255,0.45)", labelBackgroundColor: "#0a3a4a" }, horzLine: { color: "rgba(92,240,255,0.45)", labelBackgroundColor: "#0a3a4a" } },
        handleScale: false,
        handleScroll: false,
      };
      function _subMedian(arr) {
        if (!arr || !arr.length) return 0;
        const s = arr.slice().sort((a, b) => a - b);
        const m = Math.floor(s.length / 2);
        return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
      }
      // RSI（既存ロジック・色 #ffd84d＋70/50/30 priceLine を verbatim 移植）
      function buildRSI(chart) {
        const series = chart.addLineSeries({
          color: "#ffd84d", lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
        });
        series.createPriceLine({ price: 70, color: "rgba(255,102,153,0.5)", lineWidth: 1, lineStyle: 2, title: "70" });
        series.createPriceLine({ price: 50, color: "rgba(148,163,184,0.2)", lineWidth: 1, lineStyle: 3 });
        series.createPriceLine({ price: 30, color: "rgba(52,245,207,0.5)",  lineWidth: 1, lineStyle: 2, title: "30" });
        chart.__setData = (display, all) => {
          if (!display?.length) return;
          const startTime = display[0].time, endTime = display[display.length - 1].time;
          const calcBase = (all?.length > 50) ? all : display;
          const inRange = (d) => d.time >= startTime && d.time <= endTime;
          series.setData(calcRSI(calcBase).filter(inRange));
        };
      }
      // MACD（既存ロジック・hist＋MACD線 #ff5ca8＋シグナル #3aa6ff＋0線 を verbatim 移植）
      function buildMACD(chart) {
        const hist = chart.addHistogramSeries({ priceLineVisible: false, lastValueVisible: false });
        const line = chart.addLineSeries({
          color: "#ff5ca8", lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        const signal = chart.addLineSeries({
          color: "#3aa6ff", lineWidth: 1.5,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        hist.createPriceLine({ price: 0, color: "rgba(148,163,184,0.2)", lineWidth: 1, lineStyle: 0 });
        chart.__setData = (display, all) => {
          if (!display?.length) return;
          const startTime = display[0].time, endTime = display[display.length - 1].time;
          const calcBase = (all?.length > 50) ? all : display;
          const inRange = (d) => d.time >= startTime && d.time <= endTime;
          const { macdLine, signalLine, histogram } = calcMACD(calcBase);
          hist.setData(histogram.filter(inRange));
          line.setData(macdLine.filter(inRange));
          signal.setData(signalLine.filter(inRange));
        };
      }
      // ADX/DMI（mock-engine.js buildSubpanel の adx 分岐を移植：ADX線 #5cf0ff＋+DI/−DI＋25 priceLine）
      function buildADX(chart) {
        const adxLine = chart.addLineSeries({
          color: "#5cf0ff", lineWidth: 2.4,
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
        });
        const pdi = chart.addLineSeries({
          color: "rgba(52,245,207,0.85)", lineWidth: 1.4,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        const mdi = chart.addLineSeries({
          color: "rgba(255,102,153,0.85)", lineWidth: 1.4,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        adxLine.createPriceLine({ price: 25, color: "rgba(255,216,77,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "25" });
        chart.__setData = (display, all) => {
          if (!display?.length || !calcADX) return;
          const startTime = display[0].time, endTime = display[display.length - 1].time;
          const calcBase = (all?.length > 50) ? all : display;
          const inRange = (d) => d.time >= startTime && d.time <= endTime;
          const a = calcADX(calcBase, 14).filter(inRange);
          adxLine.setData(a.map((o) => ({ time: o.time, value: o.adx })));
          pdi.setData(a.map((o) => ({ time: o.time, value: o.plusDI })));
          mdi.setData(a.map((o) => ({ time: o.time, value: o.minusDI })));
        };
      }
      // ATR%（mock-engine.js buildSubpanel の atr 分岐を移植：ATR%線 #ffb03a[RSIの#ffd84dと非衝突]＋表示窓中央値の破線）
      function buildATR(chart) {
        const series = chart.addLineSeries({
          color: "#ffb03a", lineWidth: 2,
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
        });
        let medLine = null;
        chart.__setData = (display, all) => {
          if (!display?.length || !calcATR) return;
          const startTime = display[0].time, endTime = display[display.length - 1].time;
          const calcBase = (all?.length > 50) ? all : display;
          const inRange = (d) => d.time >= startTime && d.time <= endTime;
          const at = calcATR(calcBase, 14).filter(inRange);
          series.setData(at.map((o) => ({ time: o.time, value: o.pct })));
          const med = _subMedian(at.map((o) => o.pct));
          if (medLine) { try { series.removePriceLine(medLine); } catch (e) {} medLine = null; }
          medLine = series.createPriceLine({ price: +med.toFixed(2), color: "rgba(168,188,198,0.4)", lineWidth: 1, lineStyle: 3, axisLabelVisible: true, title: "中央 " + med.toFixed(1) + "%" });
        };
      }
      const SUBPANEL_REGISTRY = {
        rsi:  { height: 100, timeAxis: false, build: buildRSI },
        macd: { height: 110, timeAxis: true,  build: buildMACD },
        adx:  { height: 132, timeAxis: false, build: buildADX },
        atr:  { height: 104, timeAxis: false, build: buildATR },
      };
      const _subMounted = {};   // key -> { chart, host, height }
      const _subOrder = [];     // mount順
      let _subSyncBound = false;

      // 0x0罠回避: hostEl が可視(clientWidth>0)になるまで rAF で待ってから createChart（冪等）。
      function mountSubpanel(key, hostEl, opts) {
        opts = opts || {};
        if (_subMounted[key]) { resizeSubpanels(); return; }
        const def = SUBPANEL_REGISTRY[key];
        if (!def || !hostEl) return;
        const height = opts.height || def.height;
        let tries = 0;
        const create = () => {
          if (!hostEl.clientWidth) { if (tries++ < 30) requestAnimationFrame(create); return; }
          const chart = LightweightCharts.createChart(hostEl, {
            ...subBaseOpts, timeScale: { borderColor: "#2a3a44", visible: def.timeAxis }, height,
          });
          def.build(chart);
          _subMounted[key] = { chart, host: hostEl, height };
          if (_subOrder.indexOf(key) === -1) _subOrder.push(key);
          ensureSubSync();
          if (currentDisplayPrices) chart.__setData(currentDisplayPrices, currentAllPrices);
          const range = priceChart && priceChart.timeScale().getVisibleLogicalRange();
          if (range) chart.timeScale().setVisibleLogicalRange(range);
        };
        requestAnimationFrame(create);
      }
      function unmountSubpanel(key) {
        const m = _subMounted[key];
        if (!m) return;
        try { m.chart.remove(); } catch (e) {}
        delete _subMounted[key];
        const i = _subOrder.indexOf(key);
        if (i !== -1) _subOrder.splice(i, 1);
      }
      function isSubpanelMounted(key) { return !!_subMounted[key]; }
      function activeSubpanels() { return _subOrder.filter((k) => _subMounted[k]); }
      function refreshSubpanels(displayPrices, allPrices) {
        currentDisplayPrices = displayPrices;
        currentAllPrices = allPrices;
        for (const k in _subMounted) if (_subMounted[k]) _subMounted[k].chart.__setData(displayPrices, allPrices);
      }
      function resizeSubpanels() {
        for (const k in _subMounted) {
          const m = _subMounted[k];
          if (m && m.host.clientWidth > 0) m.chart.resize(m.host.clientWidth, m.height);
        }
      }
      function ensureSubSync() {
        if (_subSyncBound || !priceChart) return;
        priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
          if (range == null) return;
          for (const k in _subMounted) if (_subMounted[k]) _subMounted[k].chart.timeScale().setVisibleLogicalRange(range);
        });
        _subSyncBound = true;
      }
      function drawTRLines(displayPrices) {
        // 既存ラインをクリーンアップ
        trSeries.forEach(s => { try { priceChart.removeSeries(s); } catch(e) {} });
        trSeries = [];
        if (!trState || !displayPrices?.length || displayPrices.length < 10) return;

        const dev = autoZigZagDeviation(displayPrices);
        const pivots = calcZigZag(displayPrices, dev);
        if (pivots.length < 2) return;

        // 各セグメント (連続ピボット間) を個別に分析・描画
        for (let i = 1; i < pivots.length; i++) {
          const p1 = pivots[i - 1], p2 = pivots[i];
          const segLen = p2.idx - p1.idx;
          if (segLen < 3) continue;  // 短すぎるセグメントはスキップ

          const change    = (p2.value - p1.value) / p1.value;
          const absChange = Math.abs(change);

          if (absChange >= 0.03) {
            // ── トレンドセグメント: 始点ピボット → 終点ピボット の斜めライン ──
            const isUp  = change > 0;
            // ZigZag 逆規約（up=緑/down=赤＝トレーダーが手で引くトレンド可視化）の意味は維持し、色のみネオン化。
            const color = isUp ? "rgba(52,245,207,0.9)" : "rgba(255,102,153,0.9)";
            const s = priceChart.addLineSeries({
              color, lineWidth: 2, lineStyle: 0,
              priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
            });
            const data = [];
            for (let j = p1.idx; j <= p2.idx; j++) {
              const t = (j - p1.idx) / segLen;
              const v = p1.value + (p2.value - p1.value) * t;
              data.push({ time: displayPrices[j].time, value: parseFloat(v.toFixed(2)) });
            }
            s.setData(data);
            trSeries.push(s);
          } else {
            // ── レンジセグメント: 区間内の高値・安値を水平ラインで（区間限定）──
            let hi = -Infinity, lo = Infinity;
            for (let j = p1.idx; j <= p2.idx; j++) {
              if (displayPrices[j].high > hi) hi = displayPrices[j].high;
              if (displayPrices[j].low  < lo) lo = displayPrices[j].low;
            }
            [hi, lo].forEach(val => {
              const s = priceChart.addLineSeries({
                color: "rgba(255,216,77,0.85)", lineWidth: 1.5, lineStyle: 2,
                priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
              });
              const data = [];
              for (let j = p1.idx; j <= p2.idx; j++) {
                data.push({ time: displayPrices[j].time, value: val });
              }
              s.setData(data);
              trSeries.push(s);
            });
          }
        }
      }
      function toggleTR() {
        trState = !trState;
        document.getElementById("ind-btn-tr").classList.toggle("active", trState);
        drawTRLines(currentDisplayPrices);
      }
      function updateMaAndVolume(displayPrices, allPrices) {
        if (!displayPrices || displayPrices.length === 0) return;
        const startTime = displayPrices[0].time;
        const endTime = displayPrices[displayPrices.length - 1].time;

        const volData = displayPrices.map((p) => ({
          time: p.time,
          value: p.volume || 0,
          color: p.close >= p.open ? "rgba(218,10,55,0.32)" : "rgba(20,80,215,0.32)",
        }));
        volumeSeries.setData(volData);

        const base = allPrices && allPrices.length >= 75 ? allPrices : displayPrices;
        [[5, ma5Series], [25, ma25Series], [75, ma75Series]].forEach(([period, series]) => {
          const maAll = calcMA(base, period);
          series.setData(maAll.filter((d) => d.time >= startTime && d.time <= endTime));
        });

        // ── ボリンジャーバンド ──
        const bbBase = base.length >= 20 ? base : displayPrices;
        const bb = calcBB(bbBase);
        const f = (d) => d.time >= startTime && d.time <= endTime;
        bbUpperSeries?.setData(bb.upper.filter(f));
        bbMidSeries?.setData(bb.mid.filter(f));
        bbLowerSeries?.setData(bb.lower.filter(f));

        // ── ケルトナーチャネル（BB と同じ全履歴算出→window filter） ──
        const kcBase = base.length >= 20 ? base : displayPrices;
        const kc = calcKeltner(kcBase);
        kcUpperSeries?.setData(kc.upper.filter(f));
        kcMidSeries?.setData(kc.mid.filter(f));
        kcLowerSeries?.setData(kc.lower.filter(f));

        // ── VWAP（期間アンカー＝表示ウィンドウ先頭起点。全履歴算出→filter ではなく displayPrices 直接） ──
        vwapSeries?.setData(calcVWAP(displayPrices));

        // ── 支持線・抵抗線 ──
        applySRLines(base);

        // ── T/Rトレンドライン ──
        currentDisplayPrices = displayPrices;
        drawTRLines(displayPrices);

        // ── サブパネル（mount 済み全 key・表示範囲に揃える） ──
        refreshSubpanels(displayPrices, allPrices);
      }
      // ローソク足のネオン発光（各足をその色で発光・本体と同フレーム描画＝ズーム/パン時もズレない）。
      //  lightweight-charts の Series Primitive を candleSeries に attach し、currentDisplayPrices を読む。
      function makeCandleGlowPrimitive() {
        const renderer = {
          draw(target) {
            target.useMediaCoordinateSpace((scope) => {
              const data = currentDisplayPrices;
              if (!data || !data.length || !priceChart || !candleSeries) return;
              const ctx = scope.context;
              const ts = priceChart.timeScale();
              const bw = Math.max((ts.options().barSpacing || 6) * 0.72, 1.2);
              for (const c of data) {
                const x = ts.timeToCoordinate(c.time); if (x == null) continue;
                if (x < -bw || x > scope.mediaSize.width + bw) continue;  // 視野外のローソクはスキップ（カリング）
                const yO = candleSeries.priceToCoordinate(c.open), yC = candleSeries.priceToCoordinate(c.close);
                const yH = candleSeries.priceToCoordinate(c.high), yL = candleSeries.priceToCoordinate(c.low);
                if (yO == null || yC == null) continue;
                const up = c.close >= c.open;
                const col = up ? "#ff2d55" : "#2a66ff";   // 発光ハロー: up=赤(≒#DA0133明) / down=ロイヤルブルー(≒#0033AD明)
                const top = Math.min(yO, yC), h = Math.max(Math.abs(yC - yO), 1.2);
                ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 9;
                if (yH != null && yL != null) { ctx.strokeStyle = _hexRgba(col, 0.6); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, Math.min(yH, yL)); ctx.lineTo(x, Math.max(yH, yL)); ctx.stroke(); }
                ctx.strokeStyle = _hexRgba(col, 0.85); ctx.lineWidth = 1.4; ctx.strokeRect(x - bw / 2, top, bw, h);
                ctx.restore();
              }
            });
          },
        };
        const paneView = { renderer() { return renderer; }, zOrder() { return "bottom"; } };
        return { paneViews() { return [paneView]; } };
      }
      function initPriceChart() {
        const container = document.getElementById("chart-container");
        priceChart = LightweightCharts.createChart(container, {
          layout: {
            background: { type: "solid", color: "#05080f" },
            textColor: "#a8bcc6",
          },
          grid: {
            vertLines: { color: "rgba(0,229,255,0.06)" },
            horzLines: { color: "rgba(0,229,255,0.06)" },
          },
          crosshair: {
            vertLine: { color: "rgba(92,240,255,0.5)", labelBackgroundColor: "#0a3a4a" },
            horzLine: { color: "rgba(92,240,255,0.5)", labelBackgroundColor: "#0a3a4a" },
          },
          timeScale: { borderColor: "#2a3a44" },
          rightPriceScale: { borderColor: "#2a3a44" },
        });

        priceChart.priceScale("right").applyOptions({
          scaleMargins: { top: 0.05, bottom: 0.25 },
        });

        // ローソク足の色（ネオン・ガラス＝半透明ボディで背景が透ける＋明るいネオン縁／up=赤・down=青）。
        //  本体ボディは半透明、縁/ヒゲは明色。各足の発光は makeCandleGlowPrimitive が同フレーム描画。
        //  canvas色は CSS の --ix-* 自動トークン化(F5)の対象外＝ここで直接管理（値で更新）。
        candleSeries = priceChart.addCandlestickSeries({
          upColor:        "rgba(218,10,55,0.56)",    // up=赤（≒#DA0133 クリムゾン・半透明グラス）
          downColor:      "rgba(12,62,195,0.56)",    // down=青（≒#0033AD ロイヤルブルー・半透明グラス）
          borderUpColor:  "#ff5c7a",   // 明るいレッドのネオン縁
          borderDownColor:"#4d80ff",   // 明るいロイヤルブルーのネオン縁
          wickUpColor:    "#ff5c7a",
          wickDownColor:  "#4d80ff",
        });
        candleSeries.attachPrimitive(makeCandleGlowPrimitive());

        volumeSeries = priceChart.addHistogramSeries({
          priceFormat: { type: "volume" },
          priceScaleId: "vol",
          lastValueVisible: false,
          priceLineVisible: false,
        });
        priceChart.priceScale("vol").applyOptions({
          scaleMargins: { top: 0.82, bottom: 0 },
          visible: false,
        });

        ma5Series = priceChart.addLineSeries({
          color: "#ff5ca8", lineWidth: 1, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        ma25Series = priceChart.addLineSeries({
          color: "#3aa6ff", lineWidth: 1, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        ma75Series = priceChart.addLineSeries({
          color: "#a35cff", lineWidth: 1, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });

        // ── ボリンジャーバンド シリーズ (初期は非表示) ──
        bbUpperSeries = priceChart.addLineSeries({
          color: "rgba(92,240,255,0.5)", lineWidth: 1, lineStyle: 2, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        bbMidSeries = priceChart.addLineSeries({
          color: "rgba(92,240,255,0.78)", lineWidth: 1, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        bbLowerSeries = priceChart.addLineSeries({
          color: "rgba(92,240,255,0.5)", lineWidth: 1, lineStyle: 2, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        // ── ケルトナーチャネル シリーズ（amber/orange・初期非表示。BB=cyan / ma75=purple と非衝突） ──
        kcUpperSeries = priceChart.addLineSeries({
          color: "rgba(255,163,64,0.5)", lineWidth: 1, lineStyle: 2, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        kcMidSeries = priceChart.addLineSeries({
          color: "rgba(255,163,64,0.85)", lineWidth: 1, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        kcLowerSeries = priceChart.addLineSeries({
          color: "rgba(255,163,64,0.5)", lineWidth: 1, lineStyle: 2, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        // ── VWAP シリーズ（gold・単線太め・初期非表示） ──
        vwapSeries = priceChart.addLineSeries({
          color: "#ffd84d", lineWidth: 2, visible: false,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
      }

  // ── FHD 初回黒面の強制再描画（forceChartRepaint→repaint に改称・本体 verbatim）──
      // ★FHD 初回ペイント黒面バグの正式修正で使うヘルパ（診断 diag=redraw で全カード黒→正常を実証）。
      //  真因: FHD(DPR=1)実GPUで detail を開くと、entrance アニメ cardFadeInUp（遅延最大0.57s＋
      //   0.45s≒1.02s）の間に各カードが opacity/transform で合成レイヤへ昇格し、その時点の「黒面
      //   canvas テクスチャ」がレイヤにキャッシュされる。アニメ中に canvas を再描画してもレイヤの
      //   黒キャッシュは差し替わらず、アニメ完了後まで再描画を続けて初めて黒が消える。
      //   4K(DPR>=1.5)/headless では非発生だが呼んでも無害。
      //  実測(probe-fcr): 再描画 183/350ms のみ=黒のまま / 〜1205ms まで継続=黒→正常。→完了後まで延長。
      //  ※ カード層の再ラスタ(box-shadow/border/translateZ)では効かず canvas 自体の再描画のみ有効。
      //  ⚠️0x0罠回避: 各コンテナ clientWidth>0 を確認（非表示時 resize は 0x0 に陥る）。
      function repaint() {
        const run = () => {
          const cc = document.getElementById("chart-container");
          if (priceChart && cc && cc.clientWidth > 0) priceChart.resize(cc.clientWidth, cc.clientHeight);
          resizeSubpanels();
          [bsChartInstance, plChartInstance, cfChartInstance, radarChartInstance].forEach((ch) => {
            if (ch) { try { ch.resize(); ch.update("none"); } catch (e) {} }
          });
          // Feature#3: 健全性トレンドは clientWidth>0(可視)ガード付き＝ETF非表示時に 0x0 空チャート化するのを防ぐ。
          const htc = document.getElementById("healthTrend");
          if (healthTrendInstance && htc && htc.clientWidth > 0) {
            try { healthTrendInstance.resize(); healthTrendInstance.update("none"); } catch (e) {}
          }
          // 束D: FCF&収益の質コンボカード。ETF/非表示時は 0x0 のため clientWidth>0 ガード。
          const fcc = document.getElementById("fcfTrend");
          if (fcfTrendInstance && fcc && fcc.clientWidth > 0) {
            try { fcfTrendInstance.resize(); fcfTrendInstance.update("none"); } catch (e) {}
          }
        };
        // 次フレーム＋entrance アニメ完了後まで複数時刻で再描画。update('none')は冪等で無害。
        //  カード7枚化(Feature#3で health 追加)で末尾カード(CF)の entrance 完了は ≒1.28s(nth-child(7)
        //  遅延0.83s＋アニメ0.45s)。1500ms を足し、この呼出(≒T0+150ms)起点でも完了後に確実に再描画する
        //  (FHD DPR=1 で黒 canvas テクスチャがキャッシュされる黒面バグの予防・headless非再現ゆえ余裕を持たせる)。
        //  束D で末尾カード増(DuPont/FCF)＝entrance完了がさらに伸びるため 1900ms を追加。
        requestAnimationFrame(() => requestAnimationFrame(run));
        [300, 700, 1100, 1500, 1900].forEach((ms) => setTimeout(run, ms));
      }

  // ── 財務チャート（BS/PL/CF/Radar・index.html から verbatim relocate）──
      // 📊 1. BS (極太2.5倍 & 吹き出しエスケープ)
      // cross-module state seam: pageUnit は detail.js の closure 私有につき引数で受ける（本体不変）。
      function renderBSChart(fin, pageUnit) {
        const unitStr = FinanceRules.fmtUnit(STOCK_DATA[currentTicker]?.currency);
        const isMobile = window.innerWidth < 768;
        const totalAssets = FinanceRules.totalAssets(fin);   // F1: 純関数へ集約（欠損は0扱い）
        const hasNegativeEquity = fin.net_assets < 0;
        // 負の純資産の場合はチャート用に0を使用（自社株買い等による）
        const displayNetAssets = hasNegativeEquity ? 0 : fin.net_assets;
        const equityRatio = FinanceRules.equityRatio(fin);   // F1: 純関数へ集約
        const currentRatio = FinanceRules.currentRatio(fin);

        if (hasNegativeEquity) {
          document.getElementById("equity-ratio").innerText = "マイナス";
          document.getElementById("equity-ratio").style.color = "#ff5c7a";
          document.getElementById("desc-equity-ratio").innerText = "▶ 純資産マイナス（積極的な自社株買い等による）";
        } else {
          document.getElementById("equity-ratio").style.color = "#ffd60a";
          animateNumber(document.getElementById("equity-ratio"), equityRatio, "%", 1, 900);
        }
        animateNumber(document.getElementById("current-ratio"), currentRatio, "%", 1, 900);

        const ctx = document.getElementById("bsChart").getContext("2d");
        if (bsChartInstance) {
          bsChartInstance.destroy();
        }

        bsChartInstance = new Chart(ctx, {
          type: "bar",
          data: {
            labels: ["運用形態", "調達源泉"],
            // 【完璧なマッシブ化】スタックを「Stack0」に統一することでChart.jsの2分割バグを封殺し、画面いっぱいの超極太柱を強制発動！
            datasets: [
              {
                label: "純資産",
                data: [0, displayNetAssets],
                backgroundColor: neonBarBg(FIN_COLORS.bs.eq),
                borderColor: neonEdge(FIN_COLORS.bs.eq),
                borderWidth: 1.4,
                borderRadius: 2,
                stack: "Stack0",
                categoryPercentage: 1.0,
                barPercentage: 1.0,
              },
              {
                label: "固定負債",
                data: [0, fin.non_current_liabilities],
                backgroundColor: neonBarBg(FIN_COLORS.bs.ncl),
                borderColor: neonEdge(FIN_COLORS.bs.ncl),
                borderWidth: 1.4,
                borderRadius: 2,
                stack: "Stack0",
                categoryPercentage: 1.0,
                barPercentage: 1.0,
              },
              {
                label: "流動負債",
                data: [0, fin.current_liabilities],
                backgroundColor: neonBarBg(FIN_COLORS.bs.cl),
                borderColor: neonEdge(FIN_COLORS.bs.cl),
                borderWidth: 1.4,
                borderRadius: 2,
                stack: "Stack0",
                categoryPercentage: 1.0,
                barPercentage: 1.0,
              },
              {
                label: "固定資産",
                data: [fin.non_current_assets, 0],
                backgroundColor: neonBarBg(FIN_COLORS.bs.nca),
                borderColor: neonEdge(FIN_COLORS.bs.nca),
                borderWidth: 1.4,
                borderRadius: 2,
                stack: "Stack0",
                categoryPercentage: 1.0,
                barPercentage: 1.0,
              },
              {
                label: "流動資産",
                data: [fin.current_assets, 0],
                backgroundColor: neonBarBg(FIN_COLORS.bs.ca),
                borderColor: neonEdge(FIN_COLORS.bs.ca),
                borderWidth: 1.4,
                borderRadius: 2,
                stack: "Stack0",
                categoryPercentage: 1.0,
                barPercentage: 1.0,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            // 吹き出しが右の宇宙へ飛んでいくため、右側のパディングのみを「180px」へ大拡張し、見切れを完全ブロック！
            layout: { padding: isMobile ? { left: 4, right: 4, top: 10, bottom: 4 } : { left: 100, right: 180, top: 65, bottom: 20 } },
            animation: {
              duration: 1500,
              easing: "easeOutQuart",
            },
            plugins: {
              legend: { display: false },
              datalabels: {
                display: isMobile ? function(ctx) {
                  const val = ctx.dataset.data[ctx.dataIndex];
                  return val > 0 && val / totalAssets >= 0.15;
                } : true,
                clamp: true,  // ラベルがチャートエリア外に出ないよう制限
                color: "#eaf4ff",
                textShadowBlur: 6,
                textShadowColor: "rgba(120,210,255,0.6)",
                font: { weight: "bold", size: isMobile ? 10 : 14 },
                backgroundColor: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (val === 0) return null;
                  return val / totalAssets < 0.12 ? "#0a0f17" : null;
                },
                borderColor: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (val === 0) return null;
                  return val / totalAssets < 0.12 ? "#00e5ff" : null;
                },
                borderWidth: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (val === 0) return 0;
                  return val / totalAssets < 0.12 ? 1.5 : 0;
                },
                borderRadius: 6,
                padding: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (val === 0) return 0;
                  return val / totalAssets < 0.12
                    ? { top: 6, bottom: 6, left: 10, right: 10 }
                    : 0;
                },
                anchor: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  const label = context.dataset.label;
                  if (val === 0) return "center";

                  // 【真・衝突回避：十字セパレートシステム】
                  if (val / totalAssets < 0.12) {
                    if (label === "流動資産" || label === "流動負債")
                      return "end"; // てっぺんの科目は「上」をアンカーに
                    if (label === "純資産") return "start"; // 一番下は「下」をアンカーに
                    return context.dataIndex === 0 ? "left" : "right"; // 挟まれた固定科目は「横」をアンカーに
                  }
                  return "center";
                },
                align: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  const label = context.dataset.label;
                  if (val === 0) return "center";

                  // 流動負債は「上空」へ、固定負債は「右の宇宙」へと、役割ごとに完全に異なる方向へ吹き出しを逃がす！
                  if (val / totalAssets < 0.12) {
                    if (label === "流動資産" || label === "流動負債")
                      return "top";
                    if (label === "純資産") return "bottom";
                    if (label === "固定負債") return "right";
                    if (label === "固定資産") return "left";
                  }
                  return "center";
                },
                offset: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  const label = context.dataset.label;
                  if (val / totalAssets < 0.12) {
                    // バーが極太になったため、右の宇宙へ逃げる固定負債は「75px」の超強力推力で完全に外側へ飛ばす！
                    if (label === "固定資産" || label === "固定負債") return 75;
                    return 15; // 上下へ逃げる科目は15pxでスマートに浮かす
                  }
                  return 0;
                },
                formatter: function (value, context) {
                  if (value === 0) return null;
                  return (
                    context.dataset.label +
                    "\n" +
                    FinanceRules.fmtUnitValue(value, pageUnit)
                  );
                },
                textAlign: "center",
              },
            },
            scales: {
              x: {
                stacked: true,
                grid: { display: false },
                ticks: { color: "#a8bcc6", font: { size: 15, weight: "bold" } },
              },
              y: {
                stacked: true,
                grid: { color: "rgba(0,229,255,0.07)" },
                ticks: {
                  color: "#8ba2af",
                  font: { size: 13 },
                  callback: (v) => FinanceRules.fmtUnitValue(v, pageUnit),
                },
              },
            },
          },
        });
        bsChartInstance.$neonSpecs = [FIN_COLORS.bs.eq, FIN_COLORS.bs.ncl, FIN_COLORS.bs.cl, FIN_COLORS.bs.nca, FIN_COLORS.bs.ca].map((s) => [s, s]);
      }
      // 🕸️ 2. レーダー
      function renderRadarChart(fin) {
        // スコア/roe/roa の計算は detail-rules.js（radarScores・持株会社の税引前利益特例を含む）へ集約。
        //  DOM 書込（数値カウントアップ/色）とチャート描画はここに残す（挙動不変）。
        const rs = DetailRules.radarScores(fin, currentTicker);
        const roe = rs.roe, roa = rs.roa;
        const [score_roe, score_roa, score_margin, score_equity, score_current] = rs.scores;

        animateNumber(document.getElementById("txt-roe-val"), roe, "%", 1, 900);
        animateNumber(document.getElementById("txt-roa-val"), roa, "%", 1, 900);

        document.getElementById("txt-roe-val").style.color =
          roe >= 0 ? "#f570ff" : "#ff1744";
        document.getElementById("txt-roa-val").style.color =
          roa >= 0 ? "#62f0ff" : "#ff1744";

        const ctx = document.getElementById("radarChart").getContext("2d");
        if (radarChartInstance) {
          radarChartInstance.destroy();
        }

        radarChartInstance = new Chart(ctx, {
          type: "radar",
          data: {
            labels: [
              "資本効率 (ROE)",
              "資産効率 (ROA)",
              "収益性 (利益率)",
              "中長期安全 (自己資本)",
              "短期支払 (流動比率)",
            ],
            datasets: [
              {
                data: [
                  score_roe,
                  score_roa,
                  score_margin,
                  score_equity,
                  score_current,
                ],
                backgroundColor: "rgba(92,240,255,0.13)",
                borderColor: "#5cf0ff",
                borderWidth: 2,
                pointBackgroundColor: "#5cf0ff",
                pointBorderColor: "#05080f",
                pointHoverBackgroundColor: "#ff5ca8",
                pointHoverBorderColor: "#5cf0ff",
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1500, easing: "easeOutQuart" },
            plugins: {
              legend: { display: false },
              datalabels: {
                color: "#cfe0f5",
                textShadowBlur: 6,
                textShadowColor: "rgba(120,210,255,0.55)",
                font: { weight: "bold", size: 11 },
                formatter: (v) => Math.round(v) + "点",
              },
            },
            scales: {
              r: {
                angleLines: { color: "rgba(0,229,255,0.07)" },
                grid: { color: "rgba(0,229,255,0.07)" },
                pointLabels: {
                  color: "#a8bcc6",
                  font: { size: 13, weight: "bold" },
                },
                ticks: { display: false },
                suggestedMin: 0,
                suggestedMax: 100,
              },
            },
          },
        });
        radarChartInstance.$lineGlow = true;
      }
      // 📈 3. PL
      // cross-module state seam: pageUnit を detail.js から引数で受ける（本体不変）。
      function renderPLChart(fin, pageUnit) {
        const unitStr = FinanceRules.fmtUnit(STOCK_DATA[currentTicker]?.currency);
        const isMobile = window.innerWidth < 768;
        const ctx = document.getElementById("plChart").getContext("2d");
        if (plChartInstance) {
          plChartInstance.destroy();
        }

        const opMargin = FinanceRules.opMargin(fin);   // F1（datalabels の営業利益率表示で使用）
        const netMargin = FinanceRules.netMargin(fin); //     （datalabels の当期純利益率表示で使用）

        // C4: 欠損項目は捏造せず実データがある時だけ段を出す（hasValue ゲート）。
        //  段の構築（色/hasValue フィルタ）は detail-rules.js（plSteps）へ集約。描画はここに残す（挙動不変）。
        const plSteps = DetailRules.plSteps(fin);
        const plLabels = plSteps.map((s) => s.label);
        const plData = plSteps.map((s) => s.val);
        const plColors = plSteps.map((s) => s.color);

        plChartInstance = new Chart(ctx, {
          type: "bar",
          data: {
            labels: isMobile ? plLabels.map(l => l.slice(0, 4)) : plLabels,
            datasets: [
              {
                data: plData,
                backgroundColor: neonBarBgByIndex(plColors),
                borderColor: neonEdgeByIndex(plColors),
                borderWidth: 1.4,
                borderRadius: 2,
                categoryPercentage: 0.99,
                barPercentage: 0.92,
              },
            ],
          },
          options: {
            layout: { padding: isMobile ? { top: 20, bottom: 8 } : { top: 60, bottom: 40 } },
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1500, easing: "easeOutQuart" },
            plugins: {
              legend: { display: false },
              datalabels: {
                backgroundColor: null,
                color: function (context) {
                  let label = context.chart.data.labels[context.dataIndex];
                  if (label === "営業利益") return "#fde047";
                  if (label === "当期純利益") return "#67e8f9";
                  return "#eaf4ff";
                },
                textShadowBlur: 6,
                textShadowColor: "rgba(120,210,255,0.6)",
                display: isMobile ? function(ctx) {
                  // モバイルでは当期純利益（先頭）と売上高（末尾）のみ表示（段の省略に追従）
                  return ctx.dataIndex === 0 || ctx.dataIndex === ctx.chart.data.labels.length - 1;
                } : true,
                font: { weight: "bold", size: isMobile ? 9 : 14 },
                anchor: "end",
                align: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  const label = context.chart.data.labels[context.dataIndex];
                  if (val === 0 && label === "営業利益" && HOLDING_COMPANIES.has(currentTicker))
                    return "center";
                  const max = Math.max(...context.dataset.data.map(Math.abs));
                  return Math.abs(val) / max < 0.15 ? "top" : "bottom";
                },
                offset: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  const max = Math.max(...context.dataset.data.map(Math.abs));
                  return Math.abs(val) / max < 0.15 ? 6 : 0;
                },
                formatter: function (value, context) {
                  let label = context.chart.data.labels[context.dataIndex];
                  if (value === 0 && label === "営業利益" && HOLDING_COMPANIES.has(currentTicker)) {
                    return `N/A\n(持株会社仕様)`;
                  }
                  let baseStr = FinanceRules.fmtUnitValue(value, pageUnit);
                  if (label === "営業利益") {
                    return (
                      baseStr +
                      `\n営業利益率: ${opMargin.toFixed(1)}%\n(基準値4-5%前後)`
                    );
                  } else if (label === "当期純利益") {
                    return (
                      baseStr +
                      `\n当期純利益率: ${netMargin.toFixed(1)}%\n(基準値3-4%前後)`
                    );
                  }
                  return baseStr;
                },
                textAlign: "center",
              },
            },
            scales: {
              x: {
                grid: { display: false },
                ticks: { color: "#a8bcc6", font: { weight: "bold", size: isMobile ? 9 : 15 } },
              },
              y: {
                grace: "35%",
                grid: { color: "rgba(0,229,255,0.07)" },
                ticks: {
                  color: "#8ba2af",
                  font: { size: 13 },
                  callback: (v) => FinanceRules.fmtUnitValue(v, pageUnit),
                },
              },
            },
          },
        });
        plChartInstance.$neonSpecs = [plColors];
      }
      // 💸 4. CF
      // cross-module state seam: pageUnit を detail.js から引数で受ける（本体不変）。
      function renderCFChart(fin, pageUnit) {
        const unitStr = FinanceRules.fmtUnit(STOCK_DATA[currentTicker]?.currency);
        const isMobile = window.innerWidth < 768;
        const ctx = document.getElementById("cfChart").getContext("2d");
        if (cfChartInstance) {
          cfChartInstance.destroy();
        }

        const opCf = FinanceRules.n(fin.operating_cf);
        const invCf = FinanceRules.n(fin.investing_cf);
        const finCf = FinanceRules.n(fin.financing_cf);

        // CF カード状態（符号→クラス/文言/色）は detail-rules.js（cfFlowStatus）へ集約。DOM 書込はここで適用。
        const oCard = document.getElementById("card-ope");
        const oSign = document.getElementById("txt-ope-sign");
        const oDesc = document.getElementById("txt-ope-desc");
        const oStatus = DetailRules.cfFlowStatus(opCf, "operating");
        oCard.className = "status-card " + oStatus.cardClass;
        oSign.innerText = oStatus.signText;
        oSign.style.color = oStatus.signColor;
        oDesc.innerText = oStatus.descText;

        const iCard = document.getElementById("card-inv");
        const iSign = document.getElementById("txt-inv-sign");
        const iDesc = document.getElementById("txt-inv-desc");
        const iStatus = DetailRules.cfFlowStatus(invCf, "investing");   // 投資は緑赤の意味が反転
        iCard.className = "status-card " + iStatus.cardClass;
        iSign.innerText = iStatus.signText;
        iSign.style.color = iStatus.signColor;
        iDesc.innerText = iStatus.descText;

        const fCard = document.getElementById("card-fin");
        const fSign = document.getElementById("txt-fin-sign");
        const fDesc = document.getElementById("txt-fin-desc");
        const fStatus = DetailRules.cfFlowStatus(finCf, "financing");
        fCard.className = "status-card " + fStatus.cardClass;
        fSign.innerText = fStatus.signText;
        fSign.style.color = fStatus.signColor;
        fDesc.innerText = fStatus.descText;

        // 3CF 符号の組合せ→企業タイプ（type/icon/label）は detail-rules.js（cfCompanyType）へ集約。
        const badge = document.getElementById("cf-type-badge");
        const cfType = DetailRules.cfCompanyType(opCf, invCf, finCf);
        badge.innerHTML = ICO[cfType.icon] + " " + cfType.label;
        applyCfTypeBadge(badge, cfType.cfType);   // 塗り由来ガラス（発光＋シャドウ＋フロート）を type 別に適用

        // C4: 期首現金が無い銘柄に特定企業のマジック定数(6524000)を流用していたのを廃止（0基準で実フロー表示）。
        //  ウォーターフォールの段構築（期首→営業→投資→財務→(その他調整)→期末/純増減）は
        //  detail-rules.js（cfWaterfall）へ集約。描画はここに残す（挙動不変）。
        const { waterfallData, cfLabels, cfSpecs, cfDiffs, cfLastIdx } = DetailRules.cfWaterfall(fin);

        cfChartInstance = new Chart(ctx, {
          type: "bar",
          data: {
            labels: cfLabels,
            datasets: [
              {
                data: waterfallData,
                backgroundColor: neonBarBgByIndex(cfSpecs),
                borderColor: neonEdgeByIndex(cfSpecs),
                borderWidth: 1.4,
                borderRadius: 2,
                categoryPercentage: 0.99,
                barPercentage: 0.9,
              },
            ],
          },
          options: {
            layout: { padding: isMobile ? { top: 36, bottom: 8 } : { top: 60, bottom: 40 } },
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 1500, easing: "easeOutQuart" },
            plugins: {
              legend: { display: false },
              datalabels: {
                display: isMobile ? false : true,  /* モバイルは数値省略（サイドパネルで確認可） */
                color: "#eaf4ff",
                textShadowBlur: 6,
                textShadowColor: "rgba(120,210,255,0.6)",
                font: { weight: "bold", size: 14 },
                position: "center",
                anchor: function (context) {
                  const idx = context.dataIndex;
                  const diff = cfDiffs[idx];
                  return idx === 0 || idx === cfLastIdx
                    ? "end"
                    : diff >= 0
                      ? "end"
                      : "start";
                },
                align: function (context) {
                  const idx = context.dataIndex;
                  const diff = cfDiffs[idx];
                  return diff >= 0 ? "top" : "bottom";
                },
                offset: 15,
                formatter: function (value, context) {
                  const idx = context.dataIndex;
                  const diff = cfDiffs[idx];
                  const sign = diff > 0 && idx !== 0 && idx !== cfLastIdx ? "+" : "";
                  return (
                    cfLabels[idx] +
                    "\n" +
                    sign +
                    FinanceRules.fmtUnitValue(diff, pageUnit)
                  );
                },
                textAlign: "center",
              },
            },
            scales: {
              x: {
                grid: { color: "rgba(0,229,255,0.07)" },
                ticks: { color: "#a8bcc6", font: { weight: "bold", size: isMobile ? 9 : 14 } },
              },
              y: {
                grace: "40%",
                grid: { color: "rgba(0,229,255,0.07)" },
                ticks: {
                  color: "#8ba2af",
                  font: { size: 12 },
                  callback: (v) => FinanceRules.fmtUnitValue(v, pageUnit),
                },
              },
            },
          },
        });
        cfChartInstance.$neonSpecs = [cfSpecs];
      }

  // ── 薄いラッパ（index.html 残置コードが private 化した instance を触れるように）──
  function setCandleData(displayPrices) {
    if (candleSeries) candleSeries.setData(displayPrices);
  }
  function resizePrice(w, h) {
    if (priceChart) priceChart.resize(w, h);
  }

  // ── 財務健全性の推移（Feature#3・二軸 line）──────────────────────────
  //  純計算は DetailRules.healthTrendSeries(欠測 null)。Chart.js line・**destroy 先行**・
  //  **responsive:true(onWindowResize 非登録＝bs/pl/cf/radar と同思想)**・display:none で生成しない。
  //  ⚠️ neonGlowPlugin は $lineGlow/$neonSpecs 未設定で no-op(安全・save/restore 不均衡なし)。
  //  datalabels は display:false。基準線は定数 dataset(chartjs-plugin-annotation 未導入=新CDN依存を足さない)。
  var healthTrendInstance = null;
  var fcfTrendInstance = null;
  function renderHealthTrend(data, isUS) {
    const canvas = document.getElementById("healthTrend");
    if (!canvas) return;
    if (healthTrendInstance) { healthTrendInstance.destroy(); healthTrendInstance = null; }
    const s = DR.healthTrendSeries(data, isUS);
    if (!s.years.length) return;
    const cur = (data && data.currency) || "JPY";
    let maxAbs = 0;
    s.cash.concat(s.totalLiab).forEach((v) => { if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v)); });
    const unit = FinanceRules.pickUnit(maxAbs, cur);
    // ⚠️ chart data は数値(v/unit.div)を渡す。fmtUnitValue の整形済み文字列("6.5兆円"等)を渡すと
    //  Chart.js が +raw で NaN 化し金額線(現金/総負債)が silent に消える。単位表示は軸タイトル/ラベル(unitStr)で行う。
    const toU = (v) => (v == null ? null : v / unit.div);
    const unitStr = FinanceRules.unitLabel(unit);
    // 系列色は BS チャートの意味色を流用(自己資本=金/流動=cyan/総負債=pink)＋現金=green。
    const cEquity = FIN_COLORS.bs.eq[0], cCurrent = FIN_COLORS.bs.ca[0], cCash = "#00e676", cLiab = FIN_COLORS.bs.cl[0];
    const refEquity = s.years.map(() => s.basis.equityMin);
    const refCurLow = s.years.map(() => s.basis.currentLow);
    // 並び順が重要: 基準線(pct)を先に置き、currentHigh 帯を currentLow 線の直後に push して
    //  fill:"-1"(直前=currentLow・同じ pct 軸)で 2 線間を塗る。金額系列(amt)は最後に追加する。
    //  ⚠️ currentHigh を配列末尾(amt の後)に置くと fill:"-1" が総負債(右軸)を指し、軸跨ぎの誤帯になる。
    const datasets = [
      { label: "自己資本比率(%)", yAxisID: "pct", data: s.equityRatio, spanGaps: false, borderColor: cEquity, tension: 0.2, pointRadius: 2 },
      { label: "流動比率(%)", yAxisID: "pct", data: s.currentRatio, spanGaps: false, borderColor: cCurrent, tension: 0.2, pointRadius: 2 },
      { label: "目安:自己資本" + s.basis.equityMin + "%", yAxisID: "pct", data: refEquity, borderColor: "rgba(255,214,10,.35)", borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
      { label: "目安:流動" + s.basis.currentLow + "%", yAxisID: "pct", data: refCurLow, borderColor: "rgba(56,189,248,.35)", borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
    ];
    // JP は流動比率 currentLow-currentHigh 帯（US は currentHigh=null で単線・帯なし）。
    if (s.basis.currentHigh != null) {
      datasets.push({ label: "目安:流動" + s.basis.currentHigh + "%", yAxisID: "pct",
        data: s.years.map(() => s.basis.currentHigh),
        borderColor: "rgba(56,189,248,.35)", borderDash: [4, 4], pointRadius: 0, borderWidth: 1,
        fill: "-1", backgroundColor: "rgba(56,189,248,.06)" }); // fill:"-1" = 直前の currentLow 線(pct)
    }
    // 金額系列(右軸 amt)は基準線群の後に追加（data は v/unit.div の数値・上記 toU 参照）。
    datasets.push(
      { label: "現金(" + unitStr + ")", yAxisID: "amt", data: s.cash.map(toU), spanGaps: false, borderColor: cCash, tension: 0.2, pointRadius: 2 },
      { label: "総負債(" + unitStr + ")", yAxisID: "amt", data: s.totalLiab.map(toU), spanGaps: false, borderColor: cLiab, tension: 0.2, pointRadius: 2 }
    );
    healthTrendInstance = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: { labels: s.years, datasets: datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { labels: { color: "#9fb0d0", boxWidth: 10 } }, datalabels: { display: false } },
        scales: {
          pct: { position: "left", title: { display: true, text: "％", color: "#9fb0d0" }, ticks: { color: "#9fb0d0" }, grid: { color: "rgba(120,140,180,.12)" } },
          amt: { position: "right", title: { display: true, text: unitStr, color: "#9fb0d0" }, ticks: { color: "#9fb0d0" }, grid: { display: false } },
          x: { ticks: { color: "#9fb0d0" }, grid: { display: false } },
        },
      },
    });
  }

  // ── 純資産ROE分解 DuPontカード（束D 層1）────────────────────────────
  //  純計算は DetailRules.dupontDescriptor/dupontFactorSeries（no-score 中立driver句）。
  //  canvas 無し＝innerHTML 全置換のみ（signalDigest 型・0x0罠と無縁・repaint 対象外）。
  //  免責が取得できなければフェイルセーフ非描画（fail-closed）。
  function renderDuPont(fin, data) {
    var host = document.getElementById("dupont-body");
    var card = document.getElementById("dupont-card");
    if (!host || !card) return;
    var disc = DetailRules.ANALYSIS_DISCLAIMER;
    if (!disc) { card.style.display = "none"; return; }        // 免責fail-closed
    card.style.display = "";
    var d = DetailRules.dupontDescriptor(fin);
    var ser = DetailRules.dupontFactorSeries(data);
    var esc = window.esc;
    function cell(label, termKey, val, unit, series) {
      var vtxt = (val == null) ? "--" : (unit === "%" ? val.toFixed(1) + "%" : val.toFixed(2) + unit);
      return '<div class="dp-factor"><div class="dp-flabel" data-term="' + esc(termKey) + '">' + esc(label) + '</div>' +
        '<div class="dp-fval">' + esc(vtxt) + '</div>' +
        '<div class="dp-fspark">' + DetailRules.sparklineSVG(series, { w: 68, h: 18, color: "#5cf0ff" }) + '</div></div>';
    }
    var roeTxt = (d.roe.value == null) ? "--" : d.roe.value.toFixed(1) + "%";
    var html =
      '<div class="dp-identity">' +
        cell("純利益率", "net-margin", d.factors[0].value, "%", ser.netMargin) +
        '<div class="dp-op">×</div>' +
        cell("総資産回転率", "asset-turnover", d.factors[1].value, "倍", ser.assetTurnover) +
        '<div class="dp-op">×</div>' +
        cell("財務レバレッジ", "financial-leverage", d.factors[2].value, "倍", ser.equityMultiplier) +
        '<div class="dp-op">=</div>' +
        '<div class="dp-factor dp-roe"><div class="dp-flabel" data-term="roe">純資産ROE</div>' +
          '<div class="dp-fval">' + esc(roeTxt) + '</div>' +
          '<div class="dp-fspark">' + DetailRules.sparklineSVG(ser.roe, { w: 68, h: 18, color: "#ffd84d" }) + '</div></div>' +
      '</div>' +
      '<div class="dp-driver">' + esc(d.driver.text) + '</div>' +
      '<div class="panel-disclaimer">' + esc(disc) + '</div>';
    host.innerHTML = html;
  }

  // ── FCF & 収益の質 コンボカード（束D 層1）─────────────────────────────
  //  純計算は DetailRules.fcfTrendSeries/fcfQualityDescriptor。renderHealthTrend 型の
  //  二軸 canvas(bar+line mixed)。destroy 先行・responsive:true・免責fail-closed自己完結
  //  （disc 未取得ならカード非表示・DuPont と同型）。repaint() 対象＝clientWidth>0 ガード。
  //  ⚠️ FIN_COLORS.cf は {start,pos,neg,fx,end}（ope/inv というキーは存在しない）。
  //  ⚠️ chart data は数値(v/unit.div)を渡す。fmtUnitValue の整形済み文字列を渡すと NaN 化する
  //  （renderHealthTrend の教訓と同じ）。
  function renderFCFTrend(data, isUS) {
    var card = document.getElementById("fcf-trend-card");
    var cv = document.getElementById("fcfTrend");
    if (!card || !cv) return;
    var disc = DetailRules.ANALYSIS_DISCLAIMER;
    if (!disc) { card.style.display = "none"; return; }        // 免責fail-closed
    card.style.display = "";
    if (fcfTrendInstance) { fcfTrendInstance.destroy(); fcfTrendInstance = null; }
    var s = DetailRules.fcfTrendSeries(data);
    // 注記・免責・quality句（免責/注記は自己完結でここに注入）
    var q = DetailRules.fcfQualityDescriptor(data);
    var noteEl = document.getElementById("fcf-trend-note");
    if (noteEl) noteEl.textContent = q.text;
    var discEl = document.getElementById("fcf-trend-disclaimer");
    if (discEl) discEl.textContent = disc;
    if (!s.years.length) return;                                // ETF/空
    var cur = (data && data.currency) || "JPY";
    var maxAbs = 0;
    s.fcf.forEach(function (v) { if (v != null) maxAbs = Math.max(maxAbs, Math.abs(v)); });
    var unit = FinanceRules.pickUnit(maxAbs, cur);
    var unitStr = FinanceRules.unitLabel(unit);
    var fcfU = s.fcf.map(function (v) { return v == null ? null : v / unit.div; });   // ← 数値を渡す（fmtUnitValue文字列は不可）
    // バー色は正負で FIN_COLORS.cf.pos/neg（cfWaterfall と同じ意味色＝プラス=cyan/マイナス=pink）。
    var barSpecs = s.fcf.map(function (v) { return (v != null && v < 0) ? FIN_COLORS.cf.neg : FIN_COLORS.cf.pos; });
    var ds = [
      { type: "bar", label: "概算FCF(" + unitStr + ")", data: fcfU, yAxisID: "amt", order: 3,
        backgroundColor: neonBarBgByIndex(barSpecs), borderColor: neonEdgeByIndex(barSpecs), borderWidth: 1,
        datalabels: { display: false } },
      { type: "line", label: "現金変換率(%)", data: s.cashConversion, yAxisID: "pct", order: 1,
        borderColor: "#5cf0ff", backgroundColor: "transparent", tension: 0.25, spanGaps: true,
        pointRadius: 3, datalabels: { display: false } },
      { type: "line", label: "FCFマージン(%)", data: s.fcfMargin, yAxisID: "pct", order: 2,
        borderColor: "#ffd84d", backgroundColor: "transparent", tension: 0.25, spanGaps: true,
        borderDash: [4, 3], pointRadius: 2, datalabels: { display: false } },
    ];
    fcfTrendInstance = new Chart(cv.getContext("2d"), {
      data: { labels: s.years, datasets: ds },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: true, labels: { color: "#9fb0d0", boxWidth: 10, font: { size: 10 } } }, datalabels: { display: false } },
        scales: {
          amt: { position: "left", title: { display: true, text: unitStr, color: "#9fb0d0" }, ticks: { color: "#9fb0d0" }, grid: { color: "rgba(120,140,180,.12)" }, grace: "20%" },
          pct: { position: "right", title: { display: true, text: "％", color: "#9fb0d0" }, ticks: { color: "#9fb0d0" }, grid: { drawOnChartArea: false } },
          x: { ticks: { color: "#9fb0d0" }, grid: { display: false } },
        },
      },
    });
    fcfTrendInstance.$neonSpecs = [barSpecs];   // neonGlowPlugin バー発光（$lineGlow は未設定＝bar bloom を活かす。両方設定すると
                                                 // neonGlowPlugin.beforeDatasetsDraw が $lineGlow を先にチェックし bar bloom 分岐が無効化されるため）
  }

  // ── window 露出 ──
  // inline onclick（markup 無改変）が呼ぶ bare 名。公開漏れ=無言故障。
  window.toggleMA = toggleMA;
  window.toggleBB = toggleBB;
  window.toggleSR = toggleSR;
  window.toggleTR = toggleTR;
  window.toggleKeltner = toggleKeltner;
  window.toggleVWAP = toggleVWAP;
  // 詳細ビュー制御 API（index.html 残置コード/onload/updateFinancialViews/detail.js が呼ぶ）。
  window.DetailCharts = {
    initPriceChart, updateMaAndVolume, setCandleData,
    renderBSChart, renderRadarChart, renderPLChart, renderCFChart, renderHealthTrend,
    renderDuPont, renderFCFTrend,
    repaint, onWindowResize, renderCompareChart, resizePrice,
    mountSubpanel, unmountSubpanel, isSubpanelMounted, activeSubpanels, refreshSubpanels, resizeSubpanels,
  };
})();
