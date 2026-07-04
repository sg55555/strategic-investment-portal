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
        calcRSI = DR.calcRSI, calcMACD = DR.calcMACD,
        calcZigZag = DR.calcZigZag, autoZigZagDeviation = DR.autoZigZagDeviation;

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
  let srLines = [];
  let srState = false;
  let rsiChart = null, rsiSeries = null;
  let rsiState = false;
  let macdChart = null, macdLineSeries = null, macdSignalSeries = null, macdHistSeries = null;
  let macdState = false;
  let trState = false;
  let trSeries = [];
  let currentDisplayPrices = null;
  let subChartsTimeSyncBound = false;
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
          const rc = document.getElementById("rsi-container");
          if (rsiChart && rsiState && rc && rc.clientWidth > 0) rsiChart.resize(rc.clientWidth, rc.clientHeight);
          const mc = document.getElementById("macd-container");
          if (macdChart && macdState && mc && mc.clientWidth > 0) macdChart.resize(mc.clientWidth, mc.clientHeight);
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
      function toggleRSI() {
        rsiState = !rsiState;
        document.getElementById("ind-btn-rsi").classList.toggle("active", rsiState);
        const wrap = document.getElementById("rsi-container");
        wrap.classList.toggle("visible", rsiState);
        if (rsiState) {
          // display:none → block への切替後、レイアウト確定を待ってからチャート生成
          requestAnimationFrame(() => {
            if (!rsiChart) initSubCharts();
            const container = document.getElementById("rsi-container");
            rsiChart?.resize(container.clientWidth, container.clientHeight);
            const data = STOCK_DATA[currentTicker];
            if (data) {
              const display = currentDisplayPrices || data.prices.slice(-250);
              updateSubCharts(display, data.prices);
            }
            rsiChart?.timeScale().fitContent();
          });
        }
      }
      function toggleMACD() {
        macdState = !macdState;
        document.getElementById("ind-btn-macd").classList.toggle("active", macdState);
        const wrap = document.getElementById("macd-container");
        wrap.classList.toggle("visible", macdState);
        if (macdState) {
          // display:none → block への切替後、レイアウト確定を待ってからチャート生成
          requestAnimationFrame(() => {
            if (!macdChart) initSubCharts();
            const container = document.getElementById("macd-container");
            macdChart?.resize(container.clientWidth, container.clientHeight);
            const data = STOCK_DATA[currentTicker];
            if (data) {
              const display = currentDisplayPrices || data.prices.slice(-250);
              updateSubCharts(display, data.prices);
            }
            macdChart?.timeScale().fitContent();
          });
        }
      }
      // ── サブチャート 初期化 ────────────────────────────────────────
      function initSubCharts() {
        const baseOpts = {
          layout: { background: { type: "solid", color: "#05080f" }, textColor: "#a8bcc6" },
          grid: { vertLines: { color: "rgba(0,229,255,0.06)" }, horzLines: { color: "rgba(0,229,255,0.06)" } },
          rightPriceScale: { borderColor: "#2a3a44", scaleMargins: { top: 0.1, bottom: 0.1 } },
          crosshair: { mode: 1, vertLine: { color: "rgba(92,240,255,0.45)", labelBackgroundColor: "#0a3a4a" }, horzLine: { color: "rgba(92,240,255,0.45)", labelBackgroundColor: "#0a3a4a" } },
          handleScale: false,
          handleScroll: false,
        };

        if (!rsiChart) {
          rsiChart = LightweightCharts.createChart(
            document.getElementById("rsi-container"),
            { ...baseOpts, timeScale: { borderColor: "#2a3a44", visible: false } }
          );
          rsiSeries = rsiChart.addLineSeries({
            color: "#ffd84d", lineWidth: 1.5,
            priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
          });
          rsiSeries.createPriceLine({ price: 70, color: "rgba(255,102,153,0.5)", lineWidth: 1, lineStyle: 2, title: "70" });
          rsiSeries.createPriceLine({ price: 50, color: "rgba(148,163,184,0.2)", lineWidth: 1, lineStyle: 3 });
          rsiSeries.createPriceLine({ price: 30, color: "rgba(52,245,207,0.5)",  lineWidth: 1, lineStyle: 2, title: "30" });
        }

        if (!macdChart) {
          macdChart = LightweightCharts.createChart(
            document.getElementById("macd-container"),
            { ...baseOpts, timeScale: { borderColor: "#2a3a44", visible: true } }
          );
          macdHistSeries = macdChart.addHistogramSeries({
            priceLineVisible: false, lastValueVisible: false,
          });
          macdLineSeries = macdChart.addLineSeries({
            color: "#ff5ca8", lineWidth: 1.5,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          });
          macdSignalSeries = macdChart.addLineSeries({
            color: "#3aa6ff", lineWidth: 1.5,
            priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
          });
          macdHistSeries.createPriceLine({ price: 0, color: "rgba(148,163,184,0.2)", lineWidth: 1, lineStyle: 0 });
        }

        // 時間軸を主チャートに連動させる（一度だけバインド）
        if (!subChartsTimeSyncBound) {
          priceChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            if (range == null) return;
            if (rsiState && rsiChart)  rsiChart.timeScale().setVisibleLogicalRange(range);
            if (macdState && macdChart) macdChart.timeScale().setVisibleLogicalRange(range);
          });
          subChartsTimeSyncBound = true;
        }
      }
      function updateSubCharts(displayPrices, allPrices) {
        if (!displayPrices?.length) return;
        const startTime = displayPrices[0].time;
        const endTime   = displayPrices[displayPrices.length - 1].time;
        // 計算はフル履歴で行い、表示はメインチャートの時間範囲に揃える
        const calcBase = (allPrices?.length > 50) ? allPrices : displayPrices;
        const inRange = d => d.time >= startTime && d.time <= endTime;

        if (rsiState && rsiChart && rsiSeries) {
          rsiSeries.setData(calcRSI(calcBase).filter(inRange));
        }
        if (macdState && macdChart) {
          const { macdLine, signalLine, histogram } = calcMACD(calcBase);
          macdHistSeries?.setData(histogram.filter(inRange));
          macdLineSeries?.setData(macdLine.filter(inRange));
          macdSignalSeries?.setData(signalLine.filter(inRange));
        }
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

        // ── 支持線・抵抗線 ──
        applySRLines(base);

        // ── T/Rトレンドライン ──
        currentDisplayPrices = displayPrices;
        drawTRLines(displayPrices);

        // ── RSI / MACD サブチャート（表示範囲に揃える） ──
        updateSubCharts(displayPrices, base);
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
          const rc = document.getElementById("rsi-container");
          if (rsiChart && rsiState && rc && rc.clientWidth > 0) rsiChart.resize(rc.clientWidth, rc.clientHeight);
          const mc = document.getElementById("macd-container");
          if (macdChart && macdState && mc && mc.clientWidth > 0) macdChart.resize(mc.clientWidth, mc.clientHeight);
          [bsChartInstance, plChartInstance, cfChartInstance, radarChartInstance].forEach((ch) => {
            if (ch) { try { ch.resize(); ch.update("none"); } catch (e) {} }
          });
          // Feature#3: 健全性トレンドは clientWidth>0(可視)ガード付き＝ETF非表示時に 0x0 空チャート化するのを防ぐ。
          const htc = document.getElementById("healthTrend");
          if (healthTrendInstance && htc && htc.clientWidth > 0) {
            try { healthTrendInstance.resize(); healthTrendInstance.update("none"); } catch (e) {}
          }
        };
        // 次フレーム＋entrance アニメ完了後まで複数時刻で再描画。update('none')は冪等で無害。
        //  カード7枚化(Feature#3で health 追加)で末尾カード(CF)の entrance 完了は ≒1.28s(nth-child(7)
        //  遅延0.83s＋アニメ0.45s)。1500ms を足し、この呼出(≒T0+150ms)起点でも完了後に確実に再描画する
        //  (FHD DPR=1 で黒 canvas テクスチャがキャッシュされる黒面バグの予防・headless非再現ゆえ余裕を持たせる)。
        requestAnimationFrame(() => requestAnimationFrame(run));
        [300, 700, 1100, 1500].forEach((ms) => setTimeout(run, ms));
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

  // ── window 露出 ──
  // inline onclick（markup 無改変）が呼ぶ bare 名。公開漏れ=無言故障。
  window.toggleMA = toggleMA;
  window.toggleBB = toggleBB;
  window.toggleSR = toggleSR;
  window.toggleTR = toggleTR;
  window.toggleRSI = toggleRSI;
  window.toggleMACD = toggleMACD;
  // 詳細ビュー制御 API（index.html 残置コード/onload/updateFinancialViews が呼ぶ）。
  window.DetailCharts = {
    initPriceChart, updateMaAndVolume, setCandleData,
    renderBSChart, renderRadarChart, renderPLChart, renderCFChart, renderHealthTrend,
    repaint, onWindowResize, renderCompareChart, resizePrice,
  };
})();
