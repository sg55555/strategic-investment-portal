// detail-rules.js — 詳細ビュー(#detail-view)の純計算ロジック（DOM 非依存・副作用なし）。
// ブラウザ(window.DetailRules) と Node(require) の両対応(UMD-lite・finance-rules.js と同形)。
// detail-view 分離リファクタ Task1: index.html にインライン混在していた
//   ①テクニカル純関数(calcMA 等・本体は verbatim relocate)
//   ②財務ディスクリプタ計算(値/クラス/色/文言 を descriptor で返す・DOM 書込は呼び出し側に残す)
//   ③色/特例定数(FIN_COLORS/CF_BADGE_PAIR/COMPARE_COLORS/HOLDING_COMPANIES)
// を単一源へ集約し node --test で「抽出で値が変わっていない」ことを固定する。
// 財務指標(ROE/比率/単位整形 等)は finance-rules.js(FinanceRules)へ委譲し、ここでは再宣言しない。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.DetailRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // FinanceRules: classic-script では global(window.FinanceRules)、Node ではテストが global へ注入。
  const FR = (typeof FinanceRules !== "undefined") ? FinanceRules
    : (typeof global !== "undefined" ? global.FinanceRules : null);

  // ── 色/特例定数（index.html から verbatim・段ビルダー/チャートが参照）──────────────
  // CF 企業タイプ バッジのネオン・ガラス処方 [top明, bottom深] ペア（index.html 2200-）。
  const CF_BADGE_PAIR = {
    excellent: ["#ffd84d", "#c87600"], aggressive: ["#3aa6ff", "#1f4fd0"], venture: ["#a35cff", "#6414d8"],
    warn: ["#ff4d6d", "#cc0038"], pivot: ["#5a8fb0", "#2a3a44"],
  };
  // 財務チャート用ネオン・ガラス パレット [top明, bottom深]（index.html 2218-）。
  const FIN_COLORS = {
    bs: { ca: ["#5cf0ff", "#048ab0"], nca: ["#34f5cf", "#048070"], cl: ["#ff6699", "#cc0038"], ncl: ["#a35cff", "#4a0fb0"], eq: ["#ffd84d", "#c87600"] },
    cf: { start: ["#5a9bff", "#16379e"], pos: ["#5cf0ff", "#048ab0"], neg: ["#ff6699", "#cc0038"], fx: ["#8f86e0", "#352a7a"], end: ["#ffd84d", "#c87600"] },
    pl: [["#ff5ca8", "#cc0050"], ["#a35cff", "#4a0fb0"], ["#6f7bff", "#1f28c8"], ["#3aa6ff", "#0a52b8"], ["#34f5cf", "#048070"], ["#22ccf0", "#066a92"]],
  };
  // 持株会社（営業利益が事業実態を表さないため税引前利益で収益性を評価する銘柄・index.html 2301）。
  const HOLDING_COMPANIES = new Set(["9984.T"]);
  // 市場別バリュエーション基準（PER/PBR の割安・割高ライン・index.html 2303-）。
  const MARKET_BASIS = {
    US: { perLow: 20.0, perHigh: 40.0, pbrLow: 2.0, pbrHigh: 15.0, label: "米国市場基準" },
    JP: { perLow: 15.0, perHigh: 28.0, pbrLow: 1.0, pbrHigh: 3.0, label: "プロ基準" },
  };
  // 比較チャートの系列色（index.html 2453）。
  const COMPARE_COLORS = ["#5cf0ff", "#ff5ca8", "#ffd84d", "#a35cff", "#34f5cf", "#ff8a2a", "#3aa6ff", "#ff4d6d"];

  // ── テクニカル純関数（index.html 3029-3351 から本体を1文字も変えず verbatim relocate）──

  function calcMA(prices, period) {
    const result = [];
    for (let i = period - 1; i < prices.length; i++) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += prices[j].close;
      result.push({ time: prices[i].time, value: parseFloat((sum / period).toFixed(2)) });
    }
    return result;
  }

  // ── ボリンジャーバンド ──────────────────────────────────────────
  function calcBB(prices, period = 20, mult = 2) {
    const upper = [], mid = [], lower = [];
    for (let i = period - 1; i < prices.length; i++) {
      const slice = prices.slice(i - period + 1, i + 1).map(p => p.close);
      const ma = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + (b - ma) ** 2, 0) / period;
      const std = Math.sqrt(variance);
      upper.push({ time: prices[i].time, value: parseFloat((ma + mult * std).toFixed(2)) });
      mid.push(  { time: prices[i].time, value: parseFloat(ma.toFixed(2)) });
      lower.push({ time: prices[i].time, value: parseFloat((ma - mult * std).toFixed(2)) });
    }
    return { upper, mid, lower };
  }

  // ── 支持線・抵抗線 自動識別 ────────────────────────────────────
  function detectSR(prices) {
    const recent = prices.slice(-Math.min(252, prices.length));
    const pivotHighs = [], pivotLows = [];
    const n = 3;
    for (let i = n; i < recent.length - n; i++) {
      let isHigh = true, isLow = true;
      for (let j = i - n; j <= i + n; j++) {
        if (j === i) continue;
        if (recent[j].high >= recent[i].high) isHigh = false;
        if (recent[j].low  <= recent[i].low)  isLow  = false;
      }
      if (isHigh) pivotHighs.push(recent[i].high);
      if (isLow)  pivotLows.push(recent[i].low);
    }
    function cluster(levels) {
      if (!levels.length) return [];
      const sorted = [...levels].sort((a, b) => a - b);
      const groups = [];
      let i = 0;
      while (i < sorted.length) {
        const base = sorted[i];
        const group = [base];
        let j = i + 1;
        while (j < sorted.length && (sorted[j] - base) / base < 0.015) {
          group.push(sorted[j++]);
        }
        groups.push({ price: group.reduce((a, b) => a + b, 0) / group.length, count: group.length });
        i = j;
      }
      return groups.sort((a, b) => b.count - a.count).slice(0, 3);
    }
    return { resistance: cluster(pivotHighs), support: cluster(pivotLows) };
  }

  // ── RSI ────────────────────────────────────────────────────────
  function calcRSI(prices, period = 14) {
    if (prices.length < period + 1) return [];
    const closes = prices.map(p => p.close);
    let avgGain = 0, avgLoss = 0;
    for (let i = 1; i <= period; i++) {
      const d = closes[i] - closes[i - 1];
      if (d > 0) avgGain += d; else avgLoss += -d;
    }
    avgGain /= period; avgLoss /= period;
    const result = [];
    for (let i = period; i < prices.length; i++) {
      if (i > period) {
        const d = closes[i] - closes[i - 1];
        avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
        avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
      }
      const rs  = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push({ time: prices[i].time, value: parseFloat((100 - 100 / (1 + rs)).toFixed(2)) });
    }
    return result;
  }

  // ── MACD ───────────────────────────────────────────────────────
  function calcEMA(closes, period) {
    const k = 2 / (period + 1);
    const result = new Array(closes.length).fill(null);
    let sum = 0;
    for (let i = 0; i < period; i++) sum += closes[i];
    result[period - 1] = sum / period;
    for (let i = period; i < closes.length; i++) {
      result[i] = closes[i] * k + result[i - 1] * (1 - k);
    }
    return result;
  }

  function calcMACD(prices, fast = 12, slow = 26, sig = 9) {
    const closes = prices.map(p => p.close);
    const fastEMA = calcEMA(closes, fast);
    const slowEMA = calcEMA(closes, slow);
    const macdVals = [], macdTimes = [];
    for (let i = slow - 1; i < closes.length; i++) {
      if (fastEMA[i] != null && slowEMA[i] != null) {
        macdVals.push(fastEMA[i] - slowEMA[i]);
        macdTimes.push(prices[i].time);
      }
    }
    const sigEMAArr = calcEMA(macdVals, sig);
    const macdLine = [], signalLine = [], histogram = [];
    for (let i = sig - 1; i < macdVals.length; i++) {
      if (sigEMAArr[i] == null) continue;
      const t = macdTimes[i];
      const mv = parseFloat(macdVals[i].toFixed(4));
      const sv = parseFloat(sigEMAArr[i].toFixed(4));
      macdLine.push({ time: t, value: mv });
      signalLine.push({ time: t, value: sv });
      histogram.push({ time: t, value: parseFloat((mv - sv).toFixed(4)),
        color: (mv - sv) >= 0 ? "rgba(255,23,68,0.7)" : "rgba(10,142,255,0.7)" });
    }
    return { macdLine, signalLine, histogram };
  }

  // ── T/R線: ZigZag セグメント分析 ───────────
  // ZigZag: 主要転換点を抽出。deviation 以上の値動きで転換確定
  function calcZigZag(prices, deviation) {
    if (prices.length < 2) return [];
    const pivots = [];
    let trend = null;       // 'up' | 'down'
    let extIdx = 0, extVal = prices[0].close, extType = null;

    for (let i = 1; i < prices.length; i++) {
      const hi = prices[i].high, lo = prices[i].low;
      if (trend === "up") {
        if (hi > extVal) { extVal = hi; extIdx = i; extType = "high"; }
        else if (lo < extVal * (1 - deviation)) {
          pivots.push({ idx: extIdx, value: extVal, type: "high" });
          trend = "down"; extVal = lo; extIdx = i; extType = "low";
        }
      } else if (trend === "down") {
        if (lo < extVal) { extVal = lo; extIdx = i; extType = "low"; }
        else if (hi > extVal * (1 + deviation)) {
          pivots.push({ idx: extIdx, value: extVal, type: "low" });
          trend = "up"; extVal = hi; extIdx = i; extType = "high";
        }
      } else {
        if (hi > prices[0].close * (1 + deviation)) {
          pivots.push({ idx: 0, value: prices[0].low, type: "low" });
          trend = "up"; extVal = hi; extIdx = i; extType = "high";
        } else if (lo < prices[0].close * (1 - deviation)) {
          pivots.push({ idx: 0, value: prices[0].high, type: "high" });
          trend = "down"; extVal = lo; extIdx = i; extType = "low";
        }
      }
    }
    if (extType !== null) pivots.push({ idx: extIdx, value: extVal, type: extType });
    return pivots;
  }

  // 表示期間の値動き幅に応じて閾値を自動調整 (2.5% 〜 8%)
  function autoZigZagDeviation(prices) {
    if (prices.length < 10) return 0.03;
    const closes = prices.map(p => p.close);
    const minP = Math.min(...closes), maxP = Math.max(...closes);
    const totalRange = (maxP - minP) / Math.max(minP, 1);
    return Math.max(0.025, Math.min(0.08, totalRange * 0.15));
  }

  // ── 出来高バーの色（陽線=赤系 / 陰線=青系）。index.html 3555-3559 のインライン map を純関数化。
  function volumeColorData(displayPrices) {
    return displayPrices.map((p) => ({
      time: p.time,
      value: p.volume || 0,
      color: p.close >= p.open ? "rgba(218,10,55,0.32)" : "rgba(20,80,215,0.32)",
    }));
  }

  // ── 財務ディスクリプタ純関数（descriptor を返す・DOM 書込は呼び出し側）───────────────

  // 表示期間の絞り込み（US=暦年 / JP=前年4月〜当年3月・0件は末尾200件）。index.html 3804-3812。
  function priceWindow(prices, selectedYear, isUS) {
    const startDate = isUS ? `${selectedYear}-01-01` : `${selectedYear - 1}-04-01`;
    const endDate   = isUS ? `${selectedYear}-12-31` : `${selectedYear}-03-31`;
    const filteredPrices = prices.filter((p) => p.time >= startDate && p.time <= endDate);
    const displayPrices = filteredPrices.length > 0 ? filteredPrices : prices.slice(-200);
    return { startDate, endDate, filteredPrices, displayPrices };
  }

  // stock-title 文言（絞り込みの有無で分岐）。index.html 3814-3822。
  function periodLabel(companyName, ticker, year, isUS, hasFiltered) {
    if (hasFiltered) {
      const pl = isUS
        ? `${year}年1月 〜 ${year}年12月 経営期間トレンド`
        : `${year - 1}年4月 〜 ${year}年3月 経営期間トレンド`;
      return `${companyName} (${ticker}) - 歴史的ローソク足時系列 [${pl}]`;
    }
    return `${companyName} (${ticker}) - 直近市場ローソク足時系列`;
  }

  // ページ統一単位選定用の最大絶対値（15項目）。index.html 3780-3788。FinanceRules.n/totalAssets 委譲。
  function financialMaxAbs(fin) {
    let maxAbs = 0;
    [FR.totalAssets(fin), fin.net_sales, fin.gross_profit, fin.operating_income,
     fin.ordinary_income, fin.income_before_taxes, fin.net_income, fin.net_assets,
     fin.current_liabilities, fin.non_current_liabilities, fin.cf_cash_start, fin.cf_cash_end,
     fin.operating_cf, fin.investing_cf, fin.financing_cf].forEach((v) => {
      const a = Math.abs(FR.n(v)); if (a > maxAbs) maxAbs = a;
    });
    return maxAbs;
  }

  // 市場別バリュエーション基準の selector。index.html 3839。
  function marketBasisFor(isUS) { return MARKET_BASIS[isUS ? "US" : "JP"]; }

  // PER 評価カード（しきい値・色・文言を verbatim）。index.html 3858-3874。
  function perStatus(rawPer, basis) {
    if (rawPer === 0) return { cardClass: "", valColor: "#cfe0f5", statusText: "▶ 収益評価: データなし" };
    if (rawPer <= basis.perLow) return { cardClass: "green", valColor: "#00e676", statusText: `▶ 収益評価: 割安圏 (${basis.label}: ${basis.perLow}倍以下)` };
    if (rawPer >= basis.perHigh) return { cardClass: "red", valColor: "#ff5c7a", statusText: `▶ 収益評価: 割高・過熱圏 (${basis.label}: ${basis.perHigh}倍以上)` };
    return { cardClass: "", valColor: "#cfe0f5", statusText: "▶ 収益評価: 適正水準 (標準レンジ内)" };
  }

  // PBR 評価カード（gold/red/blue・中間 blue は US/JP で文言分岐）。index.html 3876-3897。
  function pbrStatus(rawPbr, basis, isUS) {
    if (rawPbr === 0) return { cardClass: "", valColor: "#cfe0f5", statusText: "▶ 資産評価: データなし" };
    if (rawPbr <= basis.pbrLow) return { cardClass: "gold", valColor: "#ffd84d", statusText: `▶ 資産評価: 解散価値以下 (${basis.label}: ${basis.pbrLow}倍以下)` };
    if (rawPbr >= basis.pbrHigh) return { cardClass: "red", valColor: "#ff5c7a", statusText: `▶ 資産評価: 高プレミアム評価 (${basis.label}: ${basis.pbrHigh}倍以上)` };
    return {
      cardClass: "blue", valColor: "#38bdf8",
      statusText: isUS ? "▶ 資産評価: 米国成長株水準 (標準レンジ内)" : "▶ 資産評価: 適正な資産評価水準",
    };
  }

  // 自己資本比率・流動比率の基準テキスト（市場別）。index.html 3902-3907。
  function equityRatioDesc(isUS) {
    return isUS
      ? "▶ 米国基準: 30.0% 以上 (自社株買い等で低下しやすい)"
      : "▶ 中長期安全性基準: 40.0% 以上で健全企業水準";
  }
  function currentRatioDesc(isUS) {
    return isUS
      ? "▶ 短期支払能力基準: 150.0% 以上で安全圏 (米国基準)"
      : "▶ 短期支払能力基準: 100.0% 〜 150.0% 以上で安全圏";
  }

  // KPI 前年比バッジ HTML（欠損は空）。index.html 3499-3505。
  function yoyBadge(curr, prev) {
    if (!prev || prev === 0) return "";
    const pct = ((curr - prev) / Math.abs(prev)) * 100;
    const cls = pct > 0.5 ? "up" : pct < -0.5 ? "down" : "flat";
    const sign = pct > 0 ? "▲" : pct < 0 ? "▼" : "─";
    return `<span class="kpi-yoy ${cls}">${sign}${Math.abs(pct).toFixed(1)}%</span>`;
  }

  // PL の段（core は常出・その他は hasValue ゲート）。index.html 4299-4306。
  function plSteps(fin) {
    const sales = fin.net_sales || 0;
    const opIncome = fin.operating_income || 0;
    const netIncome = fin.net_income || 0;
    return [
      { label: "当期純利益", val: netIncome, color: FIN_COLORS.pl[0], core: true },
      { label: "税金等調整前当期純利益", key: "income_before_taxes", val: fin.income_before_taxes, color: FIN_COLORS.pl[1] },
      { label: "経常利益", key: "ordinary_income", val: fin.ordinary_income, color: FIN_COLORS.pl[2] },
      { label: "営業利益", val: opIncome, color: FIN_COLORS.pl[3], core: true },
      { label: "売上総利益", key: "gross_profit", val: fin.gross_profit, color: FIN_COLORS.pl[4] },
      { label: "売上高", val: sales, color: FIN_COLORS.pl[5], core: true },
    ].filter((s) => s.core || FR.hasValue(fin, s.key));
  }

  // CF カード状態（符号→クラス/文言/色）。index.html 4418-4461。
  //  kind: 'operating' | 'investing' | 'financing'（投資は緑赤の意味が反転）。
  function cfFlowStatus(value, kind) {
    if (kind === "operating") {
      return value >= 0
        ? { cardClass: "green", signText: "プラス", signColor: "#00e676", descText: "【本業が順調】" }
        : { cardClass: "red", signText: "マイナス", signColor: "#ff1744", descText: "【本業が苦戦】" };
    }
    if (kind === "investing") {
      return value < 0
        ? { cardClass: "red", signText: "マイナス", signColor: "#ff1744", descText: "【攻めの経営】" }
        : { cardClass: "green", signText: "プラス", signColor: "#00e676", descText: "【守りの経営】" };
    }
    return value >= 0
      ? { cardClass: "green", signText: "プラス", signColor: "#00e676", descText: "【導入・成長期】" }
      : { cardClass: "red", signText: "マイナス", signColor: "#ff1744", descText: "【成熟・衰退期】" };
  }

  // 3CF 符号の組合せ→企業タイプ（icon は ICO のキー名・label は文言）。index.html 4463-4475。
  function cfCompanyType(op, inv, fin) {
    if (op >= 0 && inv < 0 && fin < 0) return { cfType: "excellent", icon: "crown", label: "優良企業タイプ" };
    if (op >= 0 && inv < 0 && fin >= 0) return { cfType: "aggressive", icon: "rocket", label: "積極投資タイプ" };
    if (op < 0 && inv < 0 && fin >= 0) return { cfType: "venture", icon: "flask", label: "ベンチャータイプ" };
    if (op < 0 && inv >= 0 && fin >= 0) return { cfType: "warn", icon: "warn", label: "ジリ脚タイプ" };
    return { cfType: "pivot", icon: "bars", label: "転換期・変革タイプ" };
  }

  // CF ウォーターフォールの段（期首→営業→投資→財務→(その他調整)→期末/純増減）。index.html 4478-4510。
  function cfWaterfall(fin) {
    const opCf = FR.n(fin.operating_cf);
    const invCf = FR.n(fin.investing_cf);
    const finCf = FR.n(fin.financing_cf);
    const hasStartCash = FR.hasValue(fin, "cf_cash_start");
    const startCash = hasStartCash ? fin.cf_cash_start : 0;
    const step1 = startCash + opCf;       // 営業後
    const step2 = step1 + invCf;          // 投資後
    const step3 = step2 + finCf;          // 財務後（純フロー）
    const hasEndCash = FR.hasValue(fin, "cf_cash_end");
    const endCash = (hasStartCash && hasEndCash) ? fin.cf_cash_end : step3;
    const fxOther = endCash - step3;      // その他・調整（為替換算差額／データ差異等）

    const cfSegs = [
      { label: hasStartCash ? "期首現金残高" : "期首（0基準）", data: [0, startCash], diff: startCash, spec: FIN_COLORS.cf.start },
      { label: "営業活動CF", data: [startCash, step1], diff: opCf, spec: opCf >= 0 ? FIN_COLORS.cf.pos : FIN_COLORS.cf.neg },
      { label: "投資活動CF", data: [step1, step2], diff: invCf, spec: invCf >= 0 ? FIN_COLORS.cf.pos : FIN_COLORS.cf.neg },
      { label: "財務活動CF", data: [step2, step3], diff: finCf, spec: finCf >= 0 ? FIN_COLORS.cf.pos : FIN_COLORS.cf.neg },
    ];
    const cfScale = Math.max(Math.abs(startCash), Math.abs(step1), Math.abs(step2), Math.abs(step3), Math.abs(endCash), 1);
    if (hasStartCash && hasEndCash && Math.abs(fxOther) > cfScale * 0.005) {
      cfSegs.push({ label: "その他・調整", data: [step3, endCash], diff: fxOther, spec: FIN_COLORS.cf.fx });
    }
    cfSegs.push({ label: hasStartCash ? "期末現金残高" : "純増減", data: [0, endCash], diff: endCash, spec: FIN_COLORS.cf.end });

    return {
      waterfallData: cfSegs.map((s) => s.data),
      cfLabels: cfSegs.map((s) => s.label),
      cfSpecs: cfSegs.map((s) => s.spec),
      cfDiffs: cfSegs.map((s) => s.diff),
      cfLastIdx: cfSegs.length - 1,
      maxCfScale: cfScale,
    };
  }

  // レーダー5指標スコア（0..100 clamp）＋ roe/roa 実値（持株会社は税引前利益で収益性評価）。index.html 4186-4211。
  function radarScores(fin, ticker) {
    const roe = FR.roe(fin);
    const roa = FR.roa(fin);
    const equityRatio = FR.equityRatio(fin);
    const currentRatio = FR.currentRatio(fin);
    const targetOp = HOLDING_COMPANIES.has(ticker) ? fin.income_before_taxes : fin.operating_income;
    const opMargin = FR.ratio(targetOp, fin.net_sales);
    const score = (val, min, max) => FR.clampScore(val, min, max);
    return {
      roe, roa,
      scores: [
        score(roe, -5, 15),
        score(roa, -2, 8),
        score(opMargin, 0, 12),
        score(equityRatio, 0, 50),
        score(currentRatio, 50, 160),
      ],
    };
  }

  return {
    // テクニカル純関数
    calcMA, calcBB, detectSR, calcRSI, calcEMA, calcMACD, calcZigZag, autoZigZagDeviation, volumeColorData,
    // 財務ディスクリプタ純関数
    priceWindow, periodLabel, financialMaxAbs, marketBasisFor, perStatus, pbrStatus,
    equityRatioDesc, currentRatioDesc, yoyBadge, plSteps, cfFlowStatus, cfCompanyType, cfWaterfall, radarScores,
    // 色/特例定数
    FIN_COLORS, CF_BADGE_PAIR, COMPARE_COLORS, HOLDING_COMPANIES,
  };
});
