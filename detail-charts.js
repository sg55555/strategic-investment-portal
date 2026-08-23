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
        zigzagSegments = DR.zigzagSegments,
        calcKeltner = DR.calcKeltner, calcVWAP = DR.calcVWAP, calcOBV = DR.calcOBV;

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
  let trRangeBands = [];
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
      // BS 低棒吹き出しのリード線（spec §8.3）。chart.$bsLeaders 設定時のみ動作（neonGlow と同じ gate 方式）。
      //  ⚠ $datalabels/$layout._box._rect は datalabels 非公開内部 API＝SRI pin v2.2.0 固定の間のみ安定。
      //   プラグイン更新時は本プラグインの動作再確認必須（壊れても gate no-op でリード線が無言で消えるだけ）。
      const bsLeaderPlugin = { id: "bsLeader", afterDatasetsDraw(chart) {
        const specs = chart.$bsLeaders; if (!specs) return;
        const c = chart.ctx; c.save();
        specs.forEach(({ di, bi }) => {
          const el = chart.getDatasetMeta(di).data[bi]; if (!el) return;
          const lab = (el.$datalabels || [])[0]; if (!lab || !lab.$layout || !lab.$layout._visible) return;
          const r = lab.$layout._box._rect;                 // 絶対座標 frame
          const p = el.getProps(["x", "y", "base"]);        // live 値（final=true 不可＝アニメ中ラベルは live el 追従）
          const segY = (p.y + p.base) / 2;
          const fromX = r.x + r.w / 2 < p.x ? r.x + r.w : r.x;   // チップのセグメント側縁
          c.strokeStyle = "rgba(0,229,255,0.55)"; c.lineWidth = 1;
          c.beginPath(); c.moveTo(fromX, r.y + r.h / 2); c.lineTo(p.x, segY); c.stroke();
        });
        c.restore();
      } };
      Chart.register(bsLeaderPlugin);
      // spec §11.1 (P6/D22): 債務超過（net_assets<0）の注記チップ。chart.$bsNote 設定時のみ動作（gate 方式は
      //  neonGlow/bsLeader と同型の3例目）。**datalabels 内部 API に非依存**＝プラグイン更新でリード線が
      //  死んでも注記は生存する（bsLeader 相乗りを採らない理由）。描画矩形は chart.$bsNoteRect へ書き戻し、
      //  受入（scratchpad/bs-callout-verify.js の X() 交差判定）が数値で検収できるようにする。
      const bsNotePlugin = { id: "bsNote", afterDatasetsDraw(chart) {
        chart.$bsNoteRect = null;                                  // 非該当/前回残りを毎フレーム明示クリア
        const note = chart.$bsNote; if (!note || !note.text) return;
        const el = chart.getDatasetMeta(0).data[1]; if (!el) return;  // 調達源泉列の中心x（value=0 でも x は有効）
        const c = chart.ctx, ca = chart.chartArea;
        c.save();
        c.font = "bold 12px " + (Chart.defaults.font.family || "sans-serif");   // テーマA 12px 床
        const tw = c.measureText(note.text).width, padX = 10, padY = 5, h = 12 + padY * 2;
        const cx = Math.max(tw / 2 + padX + 4, Math.min(el.x, chart.width - tw / 2 - padX - 4));   // 端クランプ
        const x = cx - tw / 2 - padX, y = ca.top - h - 16;          // top:65 帯内・低棒チップ上端越え(~12px)と非干渉
        c.fillStyle = "#0a0f17"; c.strokeStyle = "#ff5c7a"; c.lineWidth = 1.5;
        c.beginPath(); c.roundRect(x, y, tw + padX * 2, h, 6); c.fill(); c.stroke();
        c.fillStyle = "#ff8fa5"; c.textAlign = "left"; c.textBaseline = "middle";
        c.fillText(note.text, x + padX, y + h / 2);
        c.restore();
        chart.$bsNoteRect = { x: x, y: y, w: tw + padX * 2, h: h };
      } };
      Chart.register(bsNotePlugin);
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
          const series = compareChart.addLineSeries({ color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
          series.setData(data);
          // F-2: 右軸バッジ8連を止めた代わりに legend で期間リターン%を読む（value=normalizeForCompare が
          //  算出済みの期間リターン%＝追加のデータ取得ゼロ・基準は index.html:1490 の注記どおり期間開始日）。
          const last = data[data.length - 1].value;
          const pct = (last >= 0 ? "+" : "") + last.toFixed(1) + "%";
          legendEl.innerHTML += `<div class="compare-legend-item"><div class="compare-legend-dot" style="background:${color}"></div><span>${esc(STOCK_DATA[ticker]?.company_name || ticker)}</span><span class="compare-legend-val" style="color:${color}">${pct}</span></div>`;
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
        // D13/D26: 描画集合＝全クラスタの top-3/側 ∪ digest 引用（srNearest の up/dn）。
        //  「digest の数値には必ず対応する線がある」を保証する（実測 平均 +0.89 本/最大 +2 本）。
        //  ラベル（軸バッジ＝pane title と運命共同）の選抜は rules 層の純関数 srLabelPlan が単一源
        //  ＝実装・node テスト・verify が同一実装を参照する（選抜ロジックの重複実装によるドリフト根絶）。
        const close = prices[prices.length - 1].close;
        const all = detectSR(prices, Infinity);
        const resistance = all.resistance.slice(0, 3);
        const support = all.support.slice(0, 3);
        const plan = DetailRules.srLabelPlan(resistance, support, close);
        const near = DetailRules.srNearest(all, close);
        resistance.forEach(({ price, count }, i) => {
          srLines.push(candleSeries.createPriceLine({
            price, color: "rgba(255,102,153,0.85)", lineWidth: 1,
            lineStyle: 2, axisLabelVisible: plan.resistance[i], title: `R×${count}`,
          }));
        });
        support.forEach(({ price, count }, i) => {
          srLines.push(candleSeries.createPriceLine({
            price, color: "rgba(52,245,207,0.85)", lineWidth: 1,
            lineStyle: 2, axisLabelVisible: plan.support[i], title: `S×${count}`,
          }));
        });
        // 和集合の追加分（digest が引用する最寄り up/dn が top-3 に無い場合のみ）。ラベルは常に非表示。
        const drawn = new Set(resistance.concat(support).map((x) => x.price));
        [[near.up, "rgba(255,102,153,0.85)", "R"], [near.dn, "rgba(52,245,207,0.85)", "S"]].forEach(([lv, color, tag]) => {
          if (!lv || drawn.has(lv.price)) return;
          drawn.add(lv.price);
          srLines.push(candleSeries.createPriceLine({
            price: lv.price, color, lineWidth: 1,
            lineStyle: 2, axisLabelVisible: false, title: `${tag}×${lv.count}`,
          }));
        });
      }
      function toggleSR() {
        srState = !srState;
        document.getElementById("ind-btn-sr").classList.toggle("active", srState);
        const data = STOCK_DATA[currentTicker];
        if (data) applySRLines(currentDisplayPrices || data.prices);
      }
      // ── サブパネル 汎用レジストリ（RSI/MACD=既存ロジック・色を move-not-rewrite／ADX/ATR=
      //    scratchpad/subpanel-mock/mock-engine.js buildSubpanel の該当分岐を移植）────────────
      const subBaseOpts = {
        layout: { background: { type: "solid", color: "#05080f" }, textColor: "#a8bcc6" },
        grid: { vertLines: { color: "rgba(0,229,255,0.06)" }, horzLines: { color: "rgba(0,229,255,0.06)" } },
        rightPriceScale: { borderColor: "#2a3a44", scaleMargins: { top: 0.16, bottom: 0.16 }, minimumWidth: 72 },
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
        series.createPriceLine({ price: 70, color: "rgba(255,102,153,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "70" });
        series.createPriceLine({ price: 50, color: "rgba(148,163,184,0.2)", lineWidth: 1, lineStyle: 3, axisLabelVisible: false });
        series.createPriceLine({ price: 30, color: "rgba(52,245,207,0.5)",  lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "30" });
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
        hist.createPriceLine({ price: 0, color: "rgba(148,163,184,0.2)", lineWidth: 1, lineStyle: 0, axisLabelVisible: false });
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
        adxLine.createPriceLine({ price: 25, color: "rgba(255,216,77,0.5)", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "25" });
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
          medLine = series.createPriceLine({ price: +med.toFixed(2), color: "rgba(168,188,198,0.4)", lineWidth: 1, lineStyle: 3, axisLabelVisible: false, title: "中央 " + med.toFixed(1) + "%" });
          const badge = chart.__host?.closest(".acc-item")?.querySelector(".acc-metric");
          if (badge) badge.textContent = "中央 " + med.toFixed(1) + "%";   // textContent＝esc 不要
        };
      }
      // OBV（累計出来高線・自動スケール／buildRSI 雛形。0基準の破線を1本＝符号の目安）
      function buildOBV(chart) {
        const series = chart.addLineSeries({
          color: "#5cf0ff", lineWidth: 1.8,
          priceLineVisible: false, lastValueVisible: true, crosshairMarkerVisible: true,
          priceFormat: { type: "volume" },   // C2: 生値2桁小数(-58416942.00・軸幅92px)→ ±58.4M 形式（メイン出来高 :631 と同型）
        });
        series.createPriceLine({ price: 0, color: "rgba(148,163,184,0.25)", lineWidth: 1, lineStyle: 3, axisLabelVisible: false });
        chart.__setData = (display, all) => {
          if (!display?.length || !calcOBV) return;
          const startTime = display[0].time, endTime = display[display.length - 1].time;
          const calcBase = (all?.length > 50) ? all : display;   // 全履歴で累積し窓に filter
          const inRange = (d) => d.time >= startTime && d.time <= endTime;
          const win = calcOBV(calcBase).filter(inRange);
          // 表示窓の先頭を 0 に再アンカー（OBV 絶対値は任意＝窓内の純増減を見る。0基準の破線が意味を持つ）。
          const anchor = win.length ? win[0].value : 0;
          series.setData(win.map((o) => ({ time: o.time, value: o.value - anchor })));
        };
      }
      const SUBPANEL_REGISTRY = {
        rsi:  { height: 100, build: buildRSI },
        macd: { height: 104, build: buildMACD },   // C4: 110 は時間軸込みの設計値 → base=104 に正規化（detail.js SUBPANEL_META と鏡像・両方必須）
        adx:  { height: 132, build: buildADX },
        atr:  { height: 104, build: buildATR },
        obv:  { height: 104, build: buildOBV },
      };
      const _subMounted = {};   // key -> { chart, host, height, axisOn }
      const _subOrder = [];     // mount順
      const _mountGen = {};     // key -> rAF create ループの世代（expand→即collapse→再expand の二重 createChart 防止）
      let _subSyncBound = false;

      // 0x0罠回避: hostEl が可視(clientWidth>0)になるまで rAF で待ってから createChart（冪等）。
      //  世代トークン: pending な create ループは unmount / 後続 mount で失効する（旧ループの復活による
      //  二重 createChart＝chart リークを防ぐ。現物に再入ガードが無かった潜在バグの同梱修正）。
      function mountSubpanel(key, hostEl, opts) {
        opts = opts || {};
        if (_subMounted[key]) { resizeSubpanels(); return; }
        const def = SUBPANEL_REGISTRY[key];
        if (!def || !hostEl) return;
        const height = opts.height || def.height;
        const gen = _mountGen[key] = (_mountGen[key] || 0) + 1;
        let tries = 0;
        const create = () => {
          if (gen !== _mountGen[key] || _subMounted[key]) return;   // 世代失効／別ループが作成済み
          if (!hostEl.clientWidth) { if (tries++ < 30) requestAnimationFrame(create); return; }
          const chart = LightweightCharts.createChart(hostEl, {
            ...subBaseOpts, timeScale: { borderColor: "#2a3a44", visible: false }, height,   // C4: 生成時は常に軸OFF
          });
          chart.__host = hostEl;   // IIFE 私有 chart から見出し DOM へ到達する唯一の経路（C1 代替表示／C4 の DOM 順判定）
          def.build(chart);
          _subMounted[key] = { chart, host: hostEl, height, axisOn: false };
          if (_subOrder.indexOf(key) === -1) _subOrder.push(key);
          _updateSubTimeAxes();       // C4: 登録直後（DOM 順が確定した地点）で最下段へ軸を付け替える
          ensureSubSync();
          if (currentDisplayPrices) chart.__setData(currentDisplayPrices, currentAllPrices);
          const range = priceChart && priceChart.timeScale().getVisibleLogicalRange();
          if (range) chart.timeScale().setVisibleLogicalRange(range);
        };
        requestAnimationFrame(create);
      }
      function unmountSubpanel(key) {
        _mountGen[key] = (_mountGen[key] || 0) + 1;   // pending な create ループを失効（collapse 直後の再 expand 対策）
        const m = _subMounted[key];
        if (!m) return;
        try { m.chart.remove(); } catch (e) {}
        const badge = m.host?.closest(".acc-item")?.querySelector(".acc-metric");
        if (badge) badge.textContent = "";
        delete _subMounted[key];
        const i = _subOrder.indexOf(key);
        if (i !== -1) _subOrder.splice(i, 1);
        _updateSubTimeAxes();         // C4: 残ったパネルの最下段へ軸を移す
      }
      // C4: 時間軸は「DOM 上いちばん下のサブパネル」だけに出す（mount/unmount 後に必ず呼ぶ・冪等）。
      //  DOM 順で判定する理由（D19）: _subOrder は mount 順で、畳む→開くで並びが崩れ最下段判定に使えない。
      //  高さ補償: 軸 ON のパネルは host/chart とも base+TIME_AXIS_H にする（chart.resize だけだと canvas が
      //  host を TIME_AXIS_H 分はみ出す＝detail.js:331 が base 固定・.subpanel-host に高さ規定が無いため）。
      //  既知トレードオフ: 軸の付け替えでアコーディオン全体の高さが ±TIME_AXIS_H 動く（レイアウトシフト）。
      //  許容不可なら「補償なし案(a)」＝h を m.height 固定にし host.style.height を触らない（最下段ペインが
      //  TIME_AXIS_H 分縮む）へ 1 行差で退避できる。
      const TIME_AXIS_H = 28;
      function _updateSubTimeAxes() {
        const keys = Object.keys(_subMounted).filter((k) => _subMounted[k]);
        if (!keys.length) return;
        keys.sort((a, b) => (_subMounted[a].host.compareDocumentPosition(_subMounted[b].host)
          & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
        const bottom = keys[keys.length - 1];
        for (const k of keys) {
          const m = _subMounted[k], on = (k === bottom);
          if (m.axisOn === on) continue;                 // 冪等ガード
          m.axisOn = on;
          m.chart.applyOptions({ timeScale: { visible: on } });
          const h = m.height + (on ? TIME_AXIS_H : 0);
          m.host.style.height = h + "px";
          if (m.host.clientWidth > 0) m.chart.resize(m.host.clientWidth, h);
        }
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
          if (m && m.host.clientWidth > 0) {
            const h = m.height + (m.axisOn ? TIME_AXIS_H : 0);
            m.host.style.height = h + "px";
            m.chart.resize(m.host.clientWidth, h);
          }
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
        trSeries.forEach(s => { try { priceChart.removeSeries(s); } catch(e) {} });
        trSeries = [];
        trRangeBands = [];
        if (!trState || !displayPrices?.length || displayPrices.length < 10) return;

        const dev = autoZigZagDeviation(displayPrices);
        const pivots = calcZigZag(displayPrices, dev);
        if (pivots.length < 2) return;
        const segs = zigzagSegments(displayPrices, pivots);

        for (const seg of segs) {
          if (seg.type === "trend") {
            // ZigZag 逆規約（up=緑 teal/down=赤 pink・意味不変）。始点→終点の線形補間（既存挙動を保存）。
            const color = seg.change > 0 ? "rgba(52,245,207,0.9)" : "rgba(255,102,153,0.9)";
            const s = priceChart.addLineSeries({ color, lineWidth: 2, lineStyle: 0, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
            const segLen = seg.endIdx - seg.startIdx;
            const data = [];
            for (let j = seg.startIdx; j <= seg.endIdx; j++) {
              const t = (j - seg.startIdx) / segLen;
              const v = seg.startVal + (seg.endVal - seg.startVal) * t;
              data.push({ time: displayPrices[j].time, value: parseFloat(v.toFixed(2)) });
            }
            s.setData(data);
            trSeries.push(s);
          } else {
            // レンジ帯：支持・抵抗を帯の全区間に amber 破線1本ずつ（複数ピボットを束ねた1帯）。
            [seg.resistance, seg.support].forEach((val) => {
              const s = priceChart.addLineSeries({ color: "rgba(255,216,77,0.85)", lineWidth: 1.5, lineStyle: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
              const data = [];
              for (let j = seg.startIdx; j <= seg.endIdx; j++) data.push({ time: displayPrices[j].time, value: parseFloat(val.toFixed(2)) });
              s.setData(data);
              trSeries.push(s);
            });
            trRangeBands.push({ startTime: displayPrices[seg.startIdx].time, endTime: displayPrices[seg.endIdx].time, support: seg.support, resistance: seg.resistance });
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
        applySRLines(displayPrices);   // spec §6.1: S/R は表示窓基準（MA/BB/KC の base は不可侵）

        // ── T/Rトレンドライン ──
        currentDisplayPrices = displayPrices;
        drawTRLines(displayPrices);

        // ── サブパネル（mount 済み全 key・表示範囲に揃える） ──
        refreshSubpanels(displayPrices, allPrices);

        // ── 表示窓の視域確定（#9・D20）: 全系列 setData 完了後に一度だけ。少数バーは中央寄せパディングで
        //  ローソク幅を maxBarSpacing にクランプする（LWC v4.2.3 に maxBarSpacing オプションは無い）。
        //  ts.width()=price 軸を除いたペイン幅。0（非表示）は skip＝0x0罠と同じガード思想。
        const ts = priceChart.timeScale();
        const w = ts.width() || (document.getElementById("chart-container")?.clientWidth || 0);
        const r = DetailRules.fitLogicalRange(displayPrices.length, w);
        if (r) r.fit ? ts.fitContent() : ts.setVisibleLogicalRange({ from: r.from, to: r.to });
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
      // レンジ帯の淡いグロー（案B・面でなく光）。trState=off / trRangeBands 空なら描かない。
      //  candle glow と同機構＝draw 時に trRangeBands を読む（drawTRLines の series 変更で pane 再描画される）。
      function makeRangeBandPrimitive() {
        const renderer = {
          draw(target) {
            target.useMediaCoordinateSpace((scope) => {
              if (!trState || !trRangeBands.length || !priceChart || !candleSeries) return;
              const ctx = scope.context;
              const ts = priceChart.timeScale();
              for (const b of trRangeBands) {
                const x1 = ts.timeToCoordinate(b.startTime), x2 = ts.timeToCoordinate(b.endTime);
                const yR = candleSeries.priceToCoordinate(b.resistance), yS = candleSeries.priceToCoordinate(b.support);
                if (x1 == null || x2 == null || yR == null || yS == null) continue;
                const g = ctx.createLinearGradient(0, yR, 0, yS);
                g.addColorStop(0, "rgba(255,216,77,0.16)");
                g.addColorStop(0.5, "rgba(255,216,77,0.05)");
                g.addColorStop(1, "rgba(255,216,77,0.16)");
                ctx.fillStyle = g;
                ctx.fillRect(x1, yR, x2 - x1, yS - yR);
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
          timeScale: { borderColor: "#2a3a44", lockVisibleTimeRangeOnResize: true },
          rightPriceScale: { borderColor: "#2a3a44", minimumWidth: 72 },
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
        candleSeries.attachPrimitive(makeRangeBandPrimitive());

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
      // カードタイトル右端の単位バッジ（チャート別単位・冪等・spec §7.2）。injectTermHelp の data-term
      //  span と共存するため既存 child の後ろへ append し、2回目以降は textContent 差替のみ。
      function setUnitBadge(titleId, unit) {
        const title = document.getElementById(titleId);
        if (!title) return;
        const badgeId = titleId + "-unit-badge";
        let badge = document.getElementById(badgeId);
        if (!badge) {
          badge = document.createElement("span");
          badge.id = badgeId;
          badge.className = "chart-unit-badge";
          title.appendChild(badge);
        }
        badge.textContent = "単位: " + FinanceRules.unitLabel(unit);
      }

      // 📊 1. BS (極太2.5倍 & 吹き出しエスケープ)
      // spec §7.1 D10: BS はチャート別単位＝両スタック和の max で選層（ページ統一単位の引数受け渡しは廃止）。
      function renderBSChart(fin) {
        const isMobile = window.innerWidth < 768;
        const totalAssets = FinanceRules.totalAssets(fin);   // F1: 純関数へ集約（欠損は0扱い）
        const hasNegativeEquity = fin.net_assets < 0;
        // 負の純資産の場合はチャート用に0を使用（自社株買い等による）
        const displayNetAssets = hasNegativeEquity ? 0 : fin.net_assets;
        // spec §7.1 D10: BS は stacked＝軸上限はスタック和。両スタック和の max で選層（JPY 単位層変化ゼロ）
        const currency = STOCK_DATA[currentTicker]?.currency;
        const bsAxisMax = Math.max(
          totalAssets,
          FinanceRules.n(fin.current_liabilities) + FinanceRules.n(fin.non_current_liabilities) + displayNetAssets
        );
        const unit = FinanceRules.pickUnit(bsAxisMax, currency);
        setUnitBadge("bs-title", unit);
        // spec §8.1: 低棒判定と side-aware パディング（totalAssets>0 ガード＝P1 全ゼロ年の NaN 防御の二重化）
        const LOW = 0.12;
        const lowLeft  = totalAssets > 0 && [fin.current_assets, fin.non_current_assets].some(v => v > 0 && v / totalAssets < LOW);
        const lowRight = totalAssets > 0 && [fin.current_liabilities, fin.non_current_liabilities, displayNetAssets].some(v => v > 0 && v / totalAssets < LOW);
        const hostW = document.getElementById("bsChart").parentElement.clientWidth || 880;
        const CALLOUT_PAD = Math.min(140, Math.max(126, Math.round(hostW * 0.16)));   // frame実測max112.6+gap12+余裕
        // spec §8.3: リード線対象（低棒のみ）。bi は datasets data 配列の実バー位置＝
        //  負債/純資産系 data=[0,v]→bi=1・資産系 data=[v,0]→bi=0（取り違えると value=0 バーを引き
        //  formatter null→_visible=false で gate が黙って skip＝リード線が無言で欠ける）。
        // spec §11.2 (P8): ラベル付き生タプル → filter の2段化（機能等価・lowIndices の LOW=0.12 判定は不変）。
        //  ⚠ desktop 吹き出し=LOW(0.12) と モバイルサマリ=MOBILE_NOTE_LOW(0.15) の**非対称は意図的**（D21）＝
        //   「モバイル情報全損」の定義が datalabels 表示ゲート（:881-884 の 0.15）側だから。揃えると 12-15% 帯が
        //   「デスクトップ吹き出しもモバイルサマリも無い」取りこぼしになる。
        const BS_LABELS = ["純資産", "固定負債", "流動負債", "固定資産", "流動資産"];
        const lowTuples = [
          [0, displayNetAssets, 1],            // 純資産→調達源泉列
          [1, fin.non_current_liabilities, 1], // 固定負債→調達源泉列
          [2, fin.current_liabilities, 1],     // 流動負債→調達源泉列
          [3, fin.non_current_assets, 0],      // 固定資産→運用形態列
          [4, fin.current_assets, 0],          // 流動資産→運用形態列
        ];
        const lowIndices = lowTuples
          .filter(([, v]) => totalAssets > 0 && v > 0 && v / totalAssets < LOW)
          .map(([di, , bi]) => ({ di, bi }));
        // spec §8.4: 同側低棒2つ以上は2本目以降を角度 align で分離（θ<45°・offset は /cosθ 補正で
        //  「バー端+12px」の水平クリアランスを保存）。※縦距離<50px 条件は render 前に画素距離が
        //  取れないため「同側2本目以降は常に stagger」の保守的上位集合で運用（受入は rect 交差 0 で判定）。
        const STAGGER_DEG = 18;
        const staggerByKey = {};   // "di:bi" -> { deg, factor }
        [0, 1].forEach((bi) => {
          lowIndices.filter((s) => s.bi === bi).forEach((s, k) => {
            if (k === 0) return;
            const dev = STAGGER_DEG * k;                       // 水平からの偏角（<45°）
            const deg = bi === 0 ? 180 - dev : dev;            // 左列=180°基準/右列=0°基準から下向き成分
            staggerByKey[s.di + ":" + s.bi] = { deg: deg, factor: 1 / Math.cos(dev * Math.PI / 180) };
          });
        });
        const equityRatio = FinanceRules.equityRatio(fin);   // F1: 純関数へ集約
        // spec §7.4 D17: 銀行/保険/証券は流動/固定区分がなく分母0＝ratio の 0 返しが「0.0%」偽値になる。
        //  本体（finance-rules.js:36-39/:19-22）は既存挙動固定のまま、消費者側で ratioOrNull を選ぶ既存パターン
        //  （ポータル index.html:1980・cross-section-rules.js:90-91）に揃える＝3例目・同引数。
        const currentRatio = FinanceRules.ratioOrNull(fin, FinanceRules.currentRatio, ["current_assets", "current_liabilities"], ["current_liabilities"]);

        // fix round2 Finding I-2: animateNumber は900ms間 rAF で innerText を書き続けキャンセル機構がない。
        //  銘柄/年切替で旧ループが完走前に次の描画が始まると、下の静的書込み（マイナス／N/A）を旧ループの
        //  最終フレームが後から上書きしてしまう（前銘柄の値が残像として固定される）。bumpAnimSeq(el) で
        //  世代を進めてから書くことで、同一 el への in-flight animateNumber ループを自己停止させる。
        if (hasNegativeEquity) {
          const eqEl = document.getElementById("equity-ratio");
          bumpAnimSeq(eqEl);
          eqEl.innerText = "マイナス";
          eqEl.style.color = "#ff5c7a";
          document.getElementById("desc-equity-ratio").innerText = "▶ 純資産マイナス（積極的な自社株買い等による）";
        } else {
          document.getElementById("equity-ratio").style.color = "#ffd60a";
          animateNumber(document.getElementById("equity-ratio"), equityRatio, "%", 1, 900);
        }
        // ⚠ animateNumber(null) は (null*eased).toFixed(1) = "0.0%" を**無言表示**する（detail.js:189-199）＝分岐必須。
        const crEl = document.getElementById("current-ratio");
        if (currentRatio === null) {
          bumpAnimSeq(crEl);
          crEl.innerText = "N/A";
          // detail.js:753（currentRatioDesc）が毎 render 先に書く→ここが後勝ち。非 null 年/銘柄では上書きしないため
          //  基準文言への復帰は detail.js 側の毎回書込で自動成立（追加の戻し処理は不要）。
          const crDescEl = document.getElementById("desc-current-ratio");
          if (crDescEl) crDescEl.innerText = "▶ 銀行・金融は流動/固定区分がなく適用外";
        } else {
          animateNumber(crEl, currentRatio, "%", 1, 900);
        }

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
            // spec §8.1: 低棒が出る側だけ CALLOUT_PAD を動的付与（side-aware・モバイル arm は不変）。
            layout: { padding: isMobile ? { left: 4, right: 4, top: 10, bottom: 4 } : { left: lowLeft ? CALLOUT_PAD : 8, right: lowRight ? CALLOUT_PAD : 16, top: 65, bottom: 20 } },
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
                // spec §8.2: 旧 :849 'end'/:850 'start'/:851 不正値('left'/'right'→center fallback) を全廃。
                //  :849/:850 の center 化は横逃がし(align/offset)とセットの意図変更＝anchor 単独の先行コミット不可。
                anchor: "center",
                align: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (val === 0) return "center";
                  if (totalAssets > 0 && val / totalAssets < LOW) {
                    const st = staggerByKey[context.datasetIndex + ":" + context.dataIndex];
                    if (st) return st.deg;                     // 角度 align（datalabels は数値=時計回り度を受ける）
                    return context.dataIndex === 0 ? "left" : "right";
                  }
                  return "center";
                },
                offset: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (totalAssets > 0 && val > 0 && val / totalAssets < LOW) {
                    const ca = context.chart.chartArea;
                    let horiz = (ca ? ca.width / 4 : 132) + 12;
                    if (context.dataIndex === 0) horiz += (context.chart.scales.y?.width || 72);
                    const st = staggerByKey[context.datasetIndex + ":" + context.dataIndex];
                    return st ? horiz * st.factor : horiz;     // 角度時は /cosθ 補正（spec §8.4・食い込み防止）
                  }
                  return 0;
                },
                formatter: function (value, context) {
                  if (value === 0) return null;
                  return (
                    context.dataset.label +
                    "\n" +
                    FinanceRules.fmtUnitValue(value, unit)
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
                  callback: (v, i, ticks) => FinanceRules.fmtTickValue(v, unit, ticks),
                },
              },
            },
          },
        });
        bsChartInstance.$neonSpecs = [FIN_COLORS.bs.eq, FIN_COLORS.bs.ncl, FIN_COLORS.bs.cl, FIN_COLORS.bs.nca, FIN_COLORS.bs.ca].map((s) => [s, s]);
        bsChartInstance.$bsLeaders = lowIndices;
        // spec §11.1 (P6): 債務超過はチャート上で無痕跡（displayNetAssets=0＋formatter null）だったため上部に明示注記。
        //  unit はチャート別単位（:756）＝バッジ/軸/ラベルと自動整合。モバイルは top 帯 10px で置き場がないため
        //  非表示にし、Task 13 の #bs-mobile-note が債務超過行を兼務する。
        bsChartInstance.$bsNote = (!isMobile && hasNegativeEquity)
          ? { text: "純資産 ▲" + FinanceRules.fmtUnitValue(Math.abs(fin.net_assets), unit) + "（債務超過）" }
          : null;
        // spec §11.2 (P8): モバイルの <15% セグメントは datalabels が出ない（:881-884）＝金額/構成比を DOM で補完。
        //  債務超過は displayNetAssets=0（v>0 ガードで除外）ゆえタプルに乗らないため unshift で先頭に置く。
        const MOBILE_NOTE_LOW = 0.15;
        const noteEl = document.getElementById("bs-mobile-note");
        if (noteEl) {
          const items = totalAssets > 0 ? lowTuples
            .filter(([, v]) => v > 0 && v / totalAssets < MOBILE_NOTE_LOW)
            .map(([di, v]) => BS_LABELS[di] + " " + FinanceRules.fmtUnitValue(v, unit) + " (" + (v / totalAssets * 100).toFixed(1) + "%)") : [];
          if (hasNegativeEquity) items.unshift("純資産 ▲" + FinanceRules.fmtUnitValue(Math.abs(fin.net_assets), unit) + "（債務超過）");
          noteEl.textContent = items.join("・");
          noteEl.hidden = !(isMobile && items.length > 0);
        }
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
            // fix round1 Finding1: 満点(score=100)軸は r scale の外周＝chartArea 境界ちょうどに点が来るため、
            //  datalabels offset(16) 分の描画領域が無いと canvas 外へ 6.6px クリップする（4519.T 全軸100・9984.T ROE=100 で実機再現）。
            //  offset の値そのものを削ると低スコア側（#6 本題＝団子化）の分離が再び不足するため、offset は変えず
            //  r scale 側にラベル分の余白を chart layout で明示的に確保する（レビュー提案どおり）。
            layout: { padding: 20 },
            animation: { duration: 1500, easing: "easeOutQuart" },
            plugins: {
              legend: { display: false },
              datalabels: {
                color: "#cfe0f5",
                textShadowBlur: 6,
                textShadowColor: "rgba(120,210,255,0.55)",
                font: { weight: "bold", size: 11 },
                // spec §7.3 (#6): 低スコアだと点が中心付近に集まりラベルが団子になる＝各軸の外向きへ放射退避。
                //  頂点0=真上(-90°)・時計回り 360/軸数 刻み。数値 align は BS stagger（:920-921）で本番実績のある機構。
                align: (ctx) => ctx.dataIndex * (360 / ctx.chart.data.labels.length) - 90,
                offset: 16,
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
      // spec §7.1: PL はチャート別単位＝plSteps の絶対値 max で選層（ページ統一単位の引数受け渡しは廃止）。
      function renderPLChart(fin) {
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
        const currency = STOCK_DATA[currentTicker]?.currency;
        const plMax = Math.max(0, ...plSteps.map((s) => Math.abs(FinanceRules.n(s.val))));
        const unit = FinanceRules.pickUnit(plMax, currency);
        setUnitBadge("pl-title", unit);

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
                  // spec §7.2 (#5): val=0 は一律 top 退避（HOLDING の center=基線上＝X軸ラベル衝突を廃止）。
                  //  銀行 N/A（#4）も 0 値ゆえ同経路に乗る。
                  if (val === 0) return "top";
                  const max = Math.max(...context.dataset.data.map(Math.abs));
                  return Math.abs(val) / max < 0.15 ? "top" : "bottom";
                },
                offset: function (context) {
                  const val = context.dataset.data[context.dataIndex];
                  if (val === 0) return 12;   // spec §7.2: 現行6→12 で軸帯から確実に離す
                  const max = Math.max(...context.dataset.data.map(Math.abs));
                  return Math.abs(val) / max < 0.15 ? 6 : 0;
                },
                formatter: function (value, context) {
                  let label = context.chart.data.labels[context.dataIndex];
                  if (value === 0 && label === "営業利益" && HOLDING_COMPANIES.has(currentTicker)) {
                    return `N/A\n(持株会社仕様)`;
                  }
                  // spec §7.1 D16: 銀行/保険/証券は営業利益の概念がなく経常利益で開示＝棒なしの黄「0」ラベルを N/A 化。
                  //  判定は値ベース純関数（DetailRules.isFinancialPL・実DBで金融12銘柄36行と外延一致）。
                  //  9984.T は経常=0 で自動排除＝上の HOLDING 分岐と非衝突（順序も HOLDING 優先で保険）。
                  if (value === 0 && label === "営業利益" && DetailRules.isFinancialPL(fin)) {
                    return `N/A\n(銀行・金融)`;
                  }
                  let baseStr = FinanceRules.fmtUnitValue(value, unit);
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
                  callback: (v, i, ticks) => FinanceRules.fmtTickValue(v, unit, ticks),
                },
              },
            },
          },
        });
        plChartInstance.$neonSpecs = [plColors];
      }
      // 💸 4. CF
      function renderCFChart(fin) {
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
        const { waterfallData, cfLabels, cfSpecs, cfDiffs, cfLastIdx, maxCfScale } = DetailRules.cfWaterfall(fin);
        const currency = STOCK_DATA[currentTicker]?.currency;
        const unit = FinanceRules.pickUnit(maxCfScale, currency);   // 累積水準込み＝軸レンジと同義（spec §7.1）
        setUnitBadge("cf-title", unit);

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
                    FinanceRules.fmtUnitValue(diff, unit)
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
                  callback: (v, i, ticks) => FinanceRules.fmtTickValue(v, unit, ticks),
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
  // #9 受入用の薄いデバッグゲッター（resizePrice と同型）。window 直下には公開しない（spec §14 の IIFE 規律・
  //  detail-snapshot の WINDOW_API 17 名は window 直下のみ検査＝windowApi 15/17 は不変）。
  function getPriceVisibleRange() {
    return priceChart ? priceChart.timeScale().getVisibleLogicalRange() : null;
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
    repaint, onWindowResize, renderCompareChart, resizePrice, getPriceVisibleRange,
    mountSubpanel, unmountSubpanel, isSubpanelMounted, activeSubpanels, refreshSubpanels, resizeSubpanels,
  };
})();
