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
    // equityMin/currentLow/currentHigh = 財務健全性トレンドの基準線数値(単一源・currentHigh=null は単線)。
    US: { perLow: 20.0, perHigh: 40.0, pbrLow: 2.0, pbrHigh: 15.0, label: "米国市場基準", equityMin: 30, currentLow: 150, currentHigh: null },
    JP: { perLow: 15.0, perHigh: 28.0, pbrLow: 1.0, pbrHigh: 3.0, label: "プロ基準", equityMin: 40, currentLow: 100, currentHigh: 150 },
  };
  // 比較チャートの系列色（index.html 2453）。
  const COMPARE_COLORS = ["#5cf0ff", "#ff5ca8", "#ffd84d", "#a35cff", "#34f5cf", "#ff8a2a", "#3aa6ff", "#ff4d6d"];

  // ── 分析グロッサリ・免責データ（純データ・DOM非依存・規制安全＝中立/売買語・予測語を含めない）───
  // 免責文言（教育・学習フレーム）。詳細ビューの用語集/凡例で表示する単一源。
  var ANALYSIS_DISCLAIMER =
    "これらの指標・要約は教育・学習を目的とした事実の表示であり、特定銘柄の売買推奨や将来予測ではありません。投資判断はご自身の責任で行ってください。";

  // 指標グロッサリ（16語）。def は中立・平易・「よくある誤解」を1文含む（売買判断語・予測語を含めない）。
  var INDICATOR_GLOSSARY = [
    { term: "ma", read: "移動平均（MA）", def: "一定期間の終値の平均を線にしたもの。価格の平均的な水準を見る目安で、線の傾きや価格との位置関係を確認する。水準だけで方向は決まらない。" },
    { term: "bb", read: "ボリンジャーバンド（BB）", def: "移動平均を中心に標準偏差の幅で上下のバンドを描いたもの。値動きの幅（ボラティリティ）の目安。バンド外＝すぐ反転、という意味ではない。" },
    { term: "rsi", read: "RSI（相対力指数）", def: "直近の値上がり・値下がりの勢いを0〜100で表す目安。70超は買われ過ぎ、30未満は売られ過ぎの目安であって、水準だけで方向は決まらない。" },
    { term: "macd", read: "MACD", def: "短期と長期の移動平均の差（MACD線）とその平均（シグナル線）の関係を見る。2本の位置関係や交差の有無は事実であり、それ自体が方向を保証しない。" },
    { term: "sr", read: "支持線・抵抗線（S/R）", def: "過去に価格が反発・頭打ちしやすかった水準を自動で抽出したもの。タッチ回数が多いほど意識されやすい目安にすぎない。" },
    { term: "zigzag", read: "ZigZag（トレンド/レンジ）", def: "一定以上動いた転換点だけを結び、区間を「トレンド」か「レンジ（横ばい）」に分けて見る。末尾の点は未確定で後から変わりうる。" },
    { term: "volume", read: "出来高", def: "その日に売買が成立した株数。関心の大きさの目安。多い＝上昇、という意味ではなく、価格の文脈と併せて見る。" },
    { term: "percent-b", read: "%B", def: "ボリンジャーバンドの中で価格が今どの位置にあるかを0〜1で表したもの。1超＝上限の外側、0未満＝下限の外側という位置の事実を示す。" },
    { term: "equity-ratio", read: "自己資本比率", def: "総資産のうち返済不要の自己資本が占める割合。財務の安定度の目安。一般に高いほど安定的とされるが、業種で適正水準は異なる。" },
    { term: "current-ratio", read: "流動比率", def: "1年以内に現金化できる資産が、1年以内に返す負債の何倍あるかの割合。短期の支払い能力の目安。" },
    { term: "roe", read: "ROE（自己資本利益率）", def: "自己資本に対してどれだけ利益を上げたかの割合。資本の使い方の効率の目安。借入を増やしても上がるため、内訳と併せて見る。" },
    { term: "roa", read: "ROA（総資産利益率）", def: "総資産に対してどれだけ利益を上げたかの割合。資産全体の使い方の効率の目安。" },
    { term: "op-margin", read: "営業利益率", def: "売上に対する本業の利益の割合。本業の稼ぐ力の目安。" },
    { term: "net-margin", read: "純利益率", def: "売上に対する最終利益の割合。税金・特別損益まで含めた最終的な手残りの目安。" },
    { term: "per", read: "PER（株価収益率）", def: "株価が1株当たり利益の何倍かを表す。割安・割高の一つの目安で、成長期待や業種で適正水準は変わる。水準だけで判断しない。" },
    { term: "pbr", read: "PBR（株価純資産倍率）", def: "株価が1株当たり純資産の何倍かを表す。資産面から見た割安・割高の一つの目安。" },
    { term: "market-cap", read: "じかそうがく", def: "時価総額。株価×発行済株式数で、企業の市場での規模を表す。規模の大小は割安・割高や優劣を断定するものではない。" },
    { term: "パーセンタイル", read: "ぱーせんたいる", def: "ある値が母集団の中で下から何%の位置かを示す指標。50なら中央、80なら下から80%（=上位20%）。順位を割合で表す。" },
    { term: "中央値", read: "ちゅうおうち", def: "値を小さい順に並べたときの真ん中の値。平均と違い極端な外れ値の影響を受けにくい。" },
    { term: "四分位", read: "しぶんい", def: "分布を4等分する位置。第1四分位(下から25%)・中央値(50%)・第3四分位(75%)。ばらつきの目安。" },
    { term: "同市場比較", read: "どうしじょうひかく", def: "同じ市場(日本株どうし/米国株どうし)の中での相対的な位置。比率は通貨に依存しないため市場内で比較できる。値が高い/低いは良し悪しを断定するものではない。" },
    { term: "cagr", read: "CAGR（年平均成長率）", def: "複数年の増減を1年あたりの平均ペースに均した成長率。" },
    { term: "growth-rate", read: "成長率", def: "売上や利益が前年（または数年平均）に対しどれだけ増減したか。将来の株価を保証するものではない。" },
    { term: "dupont", read: "デュポン分解", def: "ROEを『純利益率×総資産回転率×財務レバレッジ』の3つに分けて、何が効率を支えているかを見る枠組み。ここでは自己資本の代わりに純資産（少数株主持分を含む）を用いた分解。" },
    { term: "asset-turnover", read: "総資産回転率", def: "売上高が総資産の何倍かを表す（倍）。資産をどれだけ効率よく売上に変えているかの目安。業種で適正水準は大きく異なる。" },
    { term: "financial-leverage", read: "財務レバレッジ", def: "総資産が純資産の何倍かを表す（倍）。借入などで資産を膨らませるほど大きくなる。ROEを押し上げる一方で財務リスクも高める。" },
    { term: "fcf", read: "フリーCF（概算）", def: "営業CFと投資CFの合計で、事業から自由に使える現金の概算。設備投資が多い年は一時的にマイナスになりうる。" },
    { term: "fcf-margin", read: "FCFマージン", def: "売上高に対する概算フリーCFの割合。売上のうちどれだけ自由な現金が残るかの目安。" },
    { term: "cash-conversion", read: "現金変換率", def: "純利益に対する営業CFの割合。利益がどれだけ現金として入ってきているかの目安（収益の質）。赤字の年は意味を持たない。" },
    { term: "adx", read: "ADX/DMI（トレンド強度）", def: "ADXはトレンドの強さ（0〜100）を測る目安で、向きは示さない。+DI/−DIは上昇・下降どちらの圧力が優勢かの目安。ADXが低い＝横ばい、高い＝一方向に動きやすい局面の目安であって、強い・弱いはそれ自体が方向を決めるものではない。" },
    { term: "atr", read: "ATR%（値幅の目安）", def: "ATR（平均的な1日の値幅）を株価で割った割合。大きいほど日々の振れが大きい＝荒い相場という目安で、銘柄をまたいで比べられる。値幅の目安であり、それ自体が行動を促すものではない。" },
    { term: "keltner", read: "ケルトナーチャネル", def: "移動平均（EMA）を中心に、値幅（ATR）の一定倍を上下に加えたバンド。価格が上限・下限の外側か内側かは位置の事実であり、外側であること自体が方向を決めるものではない。" },
    { term: "obv", read: "OBV（オンバランスボリューム）", def: "終値が前日より上がった日は出来高を足し、下がった日は引いて積み上げた累計線。傾きや価格との食い違い（ダイバージェンス）を見る目安で、絶対値の大きさ自体には意味がなく、線の向きだけで方向が決まるものではない。" },
    { term: "vwap", read: "VWAP（出来高加重平均）", def: "表示している期間の出来高で重みづけした平均価格。終値がその上か下かは位置の事実であり、水準だけで方向が決まるものではない。" },
  ];

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
  // maxPerSide: 各サイド(抵抗/支持)で返すクラスタ数の上限。既定 3(チャート描画=強い順 top-3)。
  //  signalDigest の「最寄り(価格差最小)」選択は count 降順 top-3 の外の近い水準も対象にするため Infinity を渡す(M7)。
  function detectSR(prices, maxPerSide) {
    const _maxPerSide = (maxPerSide == null) ? 3 : maxPerSide;
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
      return groups.sort((a, b) => b.count - a.count).slice(0, _maxPerSide);
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

  // ── ATR (Wilder・period=14)。value=絶対ATR / pct=ATR%(÷close×100) ──
  function calcATR(prices, period = 14) {
    const out = [];
    if (prices.length < period + 1) return out;
    const tr = [];
    for (let i = 1; i < prices.length; i++) {
      const h = prices[i].high, l = prices[i].low, pc = prices[i - 1].close;
      tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    let atr = 0;
    for (let k = 0; k < period; k++) atr += tr[k];
    atr /= period;
    const push = (pi, a) => {
      const cl = prices[pi].close || 0;
      out.push({ time: prices[pi].time, value: parseFloat(a.toFixed(2)), pct: cl ? parseFloat((a / cl * 100).toFixed(2)) : 0 });
    };
    push(period, atr); // tr index period-1 → price index period
    for (let k = period; k < tr.length; k++) { atr = (atr * (period - 1) + tr[k]) / period; push(k + 1, atr); }
    return out;
  }

  // ── ADX/DMI (Wilder・period=14)。{time, adx, plusDI, minusDI} ──
  function calcADX(prices, period = 14) {
    if (prices.length < 2 * period + 1) return [];
    const tr = [], pdm = [], mdm = [];
    for (let i = 1; i < prices.length; i++) {
      const h = prices[i].high, l = prices[i].low, ph = prices[i - 1].high, pl = prices[i - 1].low, pc = prices[i - 1].close;
      const up = h - ph, dn = pl - l;
      pdm.push(up > dn && up > 0 ? up : 0);
      mdm.push(dn > up && dn > 0 ? dn : 0);
      tr.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    let atr = 0, ap = 0, am = 0;
    for (let k = 0; k < period; k++) { atr += tr[k]; ap += pdm[k]; am += mdm[k]; }
    const dx = [];
    const pushDX = (pi) => {
      const pDI = atr === 0 ? 0 : 100 * ap / atr, mDI = atr === 0 ? 0 : 100 * am / atr;
      const sum = pDI + mDI, d = sum === 0 ? 0 : 100 * Math.abs(pDI - mDI) / sum;
      dx.push({ pi, pDI, mDI, dx: d });
    };
    pushDX(period);
    for (let k = period; k < tr.length; k++) {
      atr = atr - atr / period + tr[k];
      ap = ap - ap / period + pdm[k];
      am = am - am / period + mdm[k];
      pushDX(k + 1);
    }
    if (dx.length < period) return [];
    let adx = 0;
    for (let k = 0; k < period; k++) adx += dx[k].dx;
    adx /= period;
    const res = [];
    const pushRes = (idx, a) => {
      const o = dx[idx];
      res.push({ time: prices[o.pi].time, adx: parseFloat(a.toFixed(2)), plusDI: parseFloat(o.pDI.toFixed(2)), minusDI: parseFloat(o.mDI.toFixed(2)) });
    };
    pushRes(period - 1, adx);
    for (let k = period; k < dx.length; k++) { adx = (adx * (period - 1) + dx[k].dx) / period; pushRes(k, adx); }
    return res;
  }

  // ── ケルトナーチャネル：EMA(emaPeriod) を中心に ± atrMult×ATR(atrPeriod) のバンド ──
  //  mid=EMA(close)（全長 null 埋め）と ATR（index atrPeriod 起点の短い配列）を **time で整列** する。
  function calcKeltner(prices, emaPeriod = 20, atrMult = 2, atrPeriod = 14) {
    const upper = [], mid = [], lower = [];
    if (!prices || prices.length < Math.max(emaPeriod, atrPeriod + 1)) return { upper, mid, lower };
    const closes = prices.map(p => p.close);
    const ema = calcEMA(closes, emaPeriod);            // 全長・period-1 まで null
    const atr = calcATR(prices, atrPeriod);            // [{time,value,pct}]・index atrPeriod 起点
    const atrByTime = new Map(atr.map(o => [o.time, o.value]));
    for (let i = 0; i < prices.length; i++) {
      const t = prices[i].time, m = ema[i], a = atrByTime.get(t);
      if (m == null || a == null) continue;            // EMA・ATR 双方が揃うバーのみ出力
      const band = atrMult * a;
      mid.push({ time: t, value: parseFloat(m.toFixed(2)) });
      upper.push({ time: t, value: parseFloat((m + band).toFixed(2)) });
      lower.push({ time: t, value: parseFloat((m - band).toFixed(2)) });
    }
    return { upper, mid, lower };
  }

  // ── OBV（On-Balance Volume）：終値方向で出来高を加減した累計線。絶対値は任意・傾きを見る ──
  function calcOBV(prices) {
    const out = [];
    if (!prices || prices.length < 2) return out;
    let obv = 0;
    for (let i = 1; i < prices.length; i++) {
      const c = prices[i].close, pc = prices[i - 1].close;
      if (c > pc) obv += (prices[i].volume || 0);
      else if (c < pc) obv -= (prices[i].volume || 0);
      // c === pc: 変化なし
      out.push({ time: prices[i].time, value: obv });
    }
    return out;
  }

  // ── VWAP（期間アンカー）：prices[0] を起点に typical=(H+L+C)/3 の出来高加重平均を累積 ──
  //  日足のためセッション VWAP 不可。呼び出し側は「表示ウィンドウ」を prices として渡す（起点=期間先頭）。
  function calcVWAP(prices) {
    const out = [];
    if (!prices || !prices.length) return out;
    let cumPV = 0, cumV = 0;
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      const tp = (p.high + p.low + p.close) / 3;
      const v = p.volume || 0;
      cumPV += tp * v;
      cumV += v;
      if (cumV > 0) out.push({ time: p.time, value: parseFloat((cumPV / cumV).toFixed(2)) });
    }
    return out;
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

  // 表示期間ボラティリティに応じた帯の近接許容（autoZigZagDeviation と同思想＝スイング幅の半分・[0.02,0.045]）。
  //  下限保証で「切り上がるトレンド」を誤って帯化しないようにする。
  function autoClusterTol(prices) {
    return Math.max(0.02, Math.min(0.045, autoZigZagDeviation(prices) * 0.5));
  }

  // ピボット列を「トレンド区間」と「レンジ帯（複数ピボットを束ねた水平バンド）」のセグメント列へ後処理。
  //  単一源＝drawTRLines / signalDigest / disciplineDigest がこれを消費（判定の二重実装を作らない）。
  function zigzagSegments(prices, pivots, opts) {
    opts = opts || {};
    var trendPct = opts.trendPct != null ? opts.trendPct : 0.03;
    var minTouches = opts.minTouches != null ? opts.minTouches : 2;
    var clusterTol = opts.clusterTol != null ? opts.clusterTol : autoClusterTol(prices);
    var segs = [];
    var n = pivots.length;
    var i = 0;
    while (i < n - 1) {
      var bestK = -1, bestBand = null;
      for (var k = i + (2 * minTouches - 1); k < n; k++) {
        var highs = [], lows = [];
        for (var w = i; w <= k; w++) { (pivots[w].type === "high" ? highs : lows).push(pivots[w].value); }
        if (highs.length < minTouches || lows.length < minTouches) continue;
        var resistance = _mean(highs), support = _mean(lows), mid = (resistance + support) / 2 || 1;
        var highsSpread = (Math.max.apply(null, highs) - Math.min.apply(null, highs)) / mid;
        var lowsSpread = (Math.max.apply(null, lows) - Math.min.apply(null, lows)) / mid;
        if (highsSpread <= clusterTol && lowsSpread <= clusterTol && resistance > support) {
          bestK = k; bestBand = { support: support, resistance: resistance, touchHigh: highs.length, touchLow: lows.length };
        } else break;
      }
      if (bestK >= 0) {
        segs.push({
          type: "range", startIdx: pivots[i].idx, endIdx: pivots[bestK].idx,
          support: bestBand.support, resistance: bestBand.resistance,
          touchHigh: bestBand.touchHigh, touchLow: bestBand.touchLow, pivots: pivots.slice(i, bestK + 1),
        });
        i = bestK;
      } else {
        var p1 = pivots[i], p2 = pivots[i + 1], change = (p2.value - p1.value) / p1.value;
        if (Math.abs(change) >= trendPct && (p2.idx - p1.idx) >= 3) {
          segs.push({ type: "trend", startIdx: p1.idx, endIdx: p2.idx, startVal: p1.value, endVal: p2.value, change: change });
        }
        i = i + 1;
      }
    }
    return segs;
  }

  // ヘルパ: 配列の平均値を求める
  function _mean(a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; }

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
    var b = marketBasisFor(isUS);
    return isUS
      ? "▶ 米国基準: " + b.equityMin + ".0% 以上 (自社株買い等で低下しやすい)"
      : "▶ 中長期安全性基準: " + b.equityMin + ".0% 以上で健全企業水準";
  }
  function currentRatioDesc(isUS) {
    var b = marketBasisFor(isUS);
    return isUS
      ? "▶ 短期支払能力基準: " + b.currentLow + ".0% 以上で安全圏 (米国基準)"
      : "▶ 短期支払能力基準: " + b.currentLow + ".0% 〜 " + b.currentHigh + ".0% 以上で安全圏";
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

  // ── テクニカル現在地サマリ signalDigest（Feature#2）──────────────────
  //  「今どの状態か」を1枚で示す descriptor 配列。numeric スコアフィールド（value/score/weight）を
  //  一切持たず、state は符号スカラに写像不能な中立状態語の閉集合。売買語・予測語を出さない（規制安全）。
  //  ⚠️ 同モジュール radarScores（意図的な 0-100 スコア）とは役割が別。ここは横断合成・結論を出さない。
  //  計算はフル履歴 allPrices、現在地値は displayPrices 末尾 time で各系列を index（今日の値を混入させない）。
  function _atDisplayEnd(series, endTime) {
    if (!series || !series.length || !endTime) return null;
    for (var i = series.length - 1; i >= 0; i--) if (series[i].time === endTime) return series[i];
    return null;
  }
  // ADX/ATR の中立状態語（signalDigest と disciplineDigest の単一源・売買語なし）
  function _adxState(adx) {
    var a = Math.round(adx);
    return a >= 25 ? "方向感が強い" : a >= 20 ? "やや方向感あり" : "弱い・レンジ気味";
  }
  function _atrVolState(pct, med) {
    if (!(med > 0)) return "通常";
    return pct >= med * 1.3 ? "振れ大きめ" : pct <= med * 0.75 ? "静穏" : "通常";
  }
  function _diDir(pDI, mDI) {
    if (pDI == null || mDI == null) return "";
    var diff = Math.abs(pDI - mDI);
    if (diff < 2) return "上下拮抗";
    return pDI > mDI ? "上向き圧力優勢" : "下向き圧力優勢";
  }
  function _median(arr) {
    if (!arr || !arr.length) return 0;
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function signalDigest(displayPrices, allPrices) {
    var out = [];
    var dp = displayPrices || [];
    var ap = (allPrices && allPrices.length) ? allPrices : dp;
    var endBar = dp.length ? dp[dp.length - 1] : null;
    var endTime = endBar ? endBar.time : null;
    var close = endBar ? endBar.close : null;

    // 1) MA 整列
    (function () {
      var m5 = _atDisplayEnd(calcMA(ap, 5), endTime);
      var m25 = _atDisplayEnd(calcMA(ap, 25), endTime);
      var m75 = _atDisplayEnd(calcMA(ap, 75), endTime);
      var state = 'データ不足', readout = '';
      if (m5 && m25 && m75) {
        var a = m5.value, b = m25.value, c = m75.value;
        if (a > b && b > c) state = 'MA5>MA25>MA75の並び';
        else if (c > b && b > a) state = 'MA75>MA25>MA5の並び';
        else state = '並びは混在';
        if (close != null) readout = '終値はMA25の' + (close >= b ? '上' : '下');
      }
      out.push({ key: 'ma', label: '移動平均の並び', term: 'ma', state: state, readout: readout });
    })();

    // 2) RSI ゾーン
    (function () {
      var r = _atDisplayEnd(calcRSI(ap, 14), endTime);
      var state = 'データ不足', readout = '';
      if (r) {
        var v = r.value;
        state = v >= 70 ? '買われ過ぎの目安圏(70以上)' : v <= 30 ? '売られ過ぎの目安圏(30以下)' : '中立圏';
        readout = 'RSI ' + v;
      }
      out.push({ key: 'rsi', label: 'RSI', term: 'rsi', state: state, readout: readout });
    })();

    // 3) MACD 位置・交差（売買語なし＝位置関係と交差有無の純事実）
    (function () {
      var mac = calcMACD(ap, 12, 26, 9);
      var hist = (mac && mac.histogram) || [];
      var state = 'データ不足', note = '';
      var end = _atDisplayEnd(hist, endTime);
      if (end) {
        state = end.value >= 0 ? 'MACD線がシグナル線の上' : 'MACD線がシグナル線の下';
        var idx = hist.indexOf(end);
        if (idx > 0) {
          var prev = hist[idx - 1];
          note = (prev && ((prev.value >= 0) !== (end.value >= 0))) ? '直近でシグナル線と交差あり' : '交差なし';
        }
      }
      out.push({ key: 'macd', label: 'MACD', term: 'macd', state: state, readout: '', note: note });
    })();

    // 4) BB %B
    (function () {
      var bb = calcBB(ap, 20, 2);
      var u = _atDisplayEnd(bb && bb.upper, endTime);
      var l = _atDisplayEnd(bb && bb.lower, endTime);
      var state = 'データ不足', readout = '';
      if (u && l && close != null && (u.value - l.value) !== 0) {
        var pb = (close - l.value) / (u.value - l.value);
        state = pb > 1 ? '上限バンドの外側' : pb < 0 ? '下限バンドの外側' : 'バンド内側';
        readout = '%B ' + pb.toFixed(2);
      }
      out.push({ key: 'percent-b', label: 'ボリンジャー%B', term: 'percent-b', state: state, readout: readout });
    })();

    // 5) S/R 最寄り（表示期間 dp から算出＝チャート描画のS/R線・as-ofキャプションと整合／全クラスタを
    //    close で上下分割し価格差最小を選ぶ＝count 降順 top-3 の外の近い水準も対象[M7]・count は強度表示のみ）
    (function () {
      var sr = detectSR(dp, Infinity) || { resistance: [], support: [] };
      var all = (sr.resistance || []).concat(sr.support || []);
      var up = null, dn = null;
      if (close != null) {
        for (var i = 0; i < all.length; i++) {
          var lv = all[i];
          if (lv.price >= close) { if (!up || (lv.price - close) < (up.price - close)) up = lv; }
          else { if (!dn || (close - lv.price) < (close - dn.price)) dn = lv; }
        }
      }
      var parts = [];
      if (up) parts.push('直近の抵抗まで +' + (((up.price - close) / close) * 100).toFixed(1) + '%（強度' + up.count + '）');
      if (dn) parts.push('直近の支持まで −' + (((close - dn.price) / close) * 100).toFixed(1) + '%（強度' + dn.count + '）');
      out.push({ key: 'sr', label: '支持線・抵抗線', term: 'sr', state: parts.length ? '算出済み' : 'データ不足', readout: parts.join('／') });
    })();

    // 6) ZigZag：zigzagSegments の末尾セグメント（単一源）。state は既存 enum 値を維持し改善は readout へ。
    (function () {
      var segs = zigzagSegments(dp, calcZigZag(dp, autoZigZagDeviation(dp)) || []) || [];
      var state = 'データ不足', readout = '', note = '';
      var last = segs.length ? segs[segs.length - 1] : null;
      if (last) {
        if (last.type === 'range') {
          state = '直近の確定区間はレンジ';
          readout = '帯幅 ' + ((last.resistance - last.support) / last.support * 100).toFixed(1) + '%・' + (last.touchHigh + last.touchLow) + '点接触';
        } else {
          state = '直近の確定区間はトレンド';
          readout = (last.change >= 0 ? '+' : '') + (last.change * 100).toFixed(1) + '%';
        }
        note = '末尾ピボットは未確定';
      }
      out.push({ key: 'zigzag', label: 'ZigZag区間', term: 'zigzag', state: state, readout: readout, note: note });
    })();

    // 7) 出来高（陽/陰のみ）
    (function () {
      var vc = volumeColorData(dp) || [];
      var end = vc.length ? vc[vc.length - 1] : null;
      var state = 'データ不足', readout = '';
      if (end && endBar) {
        state = (endBar.close >= endBar.open) ? '陽線(終値≥始値)' : '陰線';
        readout = '出来高 ' + (end.value || 0);
      }
      out.push({ key: 'volume', label: '出来高', term: 'volume', state: state, readout: readout });
    })();

    // 8) ADX/DMI（トレンド強度・向きは圧力の事実）
    (function () {
      var a = calcADX(ap, 14);
      var end = _atDisplayEnd(a, endTime);
      var state = 'データ不足', readout = '';
      if (end) {
        state = _adxState(end.adx);
        readout = 'ADX ' + Math.round(end.adx) + '（' + _diDir(end.plusDI, end.minusDI) + '）';
      }
      out.push({ key: 'adx', label: 'トレンド強度', term: 'adx', state: state, readout: readout });
    })();

    // 9) ATR%（値幅の目安・中央値比）
    (function () {
      var at = calcATR(ap, 14);
      var end = _atDisplayEnd(at, endTime);
      var win = at.filter(function (o) { return endTime && o.time <= endTime && (!dp.length || o.time >= dp[0].time); });
      var med = _median(win.map(function (o) { return o.pct; }));
      var state = 'データ不足', readout = '';
      if (end) {
        state = _atrVolState(end.pct, med);
        readout = 'ATR% ' + end.pct.toFixed(1) + '%（中央値 ' + (med || 0).toFixed(1) + '%）';
      }
      out.push({ key: 'atr', label: '値幅(ATR%)', term: 'atr', state: state, readout: readout });
    })();

    // 10) ケルトナーチャネル（終値のチャネル内外・純事実）
    (function () {
      var kc = calcKeltner(ap);
      var u = _atDisplayEnd(kc && kc.upper, endTime);
      var m = _atDisplayEnd(kc && kc.mid, endTime);
      var l = _atDisplayEnd(kc && kc.lower, endTime);
      var state = 'データ不足', readout = '';
      if (u && m && l && close != null) {
        state = close > u.value ? '上限チャネルの外側' : close < l.value ? '下限チャネルの外側' : 'チャネル内側';
        readout = '中心線比 ' + (close >= m.value ? '+' : '') + ((close / m.value - 1) * 100).toFixed(1) + '%';
      }
      out.push({ key: 'keltner', label: 'ケルトナー', term: 'keltner', state: state, readout: readout });
    })();

    // 11) VWAP（表示期間の出来高加重平均・終値の上下）
    (function () {
      var vw = calcVWAP(dp);   // 期間アンカー＝表示ウィンドウ dp（signalDigest の他ブロックと異なり ap でなく dp）
      var end = vw.length ? vw[vw.length - 1] : null;
      var state = 'データ不足', readout = '';
      if (end && close != null && end.value > 0) {
        var dev = (close / end.value - 1) * 100;
        state = Math.abs(dev) <= 0.3 ? 'VWAP近辺' : (dev > 0 ? '終値がVWAPの上' : '終値がVWAPの下');
        readout = '乖離 ' + (dev >= 0 ? '+' : '') + dev.toFixed(1) + '%';
      }
      out.push({ key: 'vwap', label: 'VWAP', term: 'vwap', state: state, readout: readout });
    })();

    // 12) OBV（累計出来高線の傾き・純事実。純変化/総出来高で正規化＝絶対値は任意）
    (function () {
      var obv = calcOBV(ap);
      var end = _atDisplayEnd(obv, endTime);
      var state = 'データ不足', readout = '';
      if (end && dp.length >= 21) {
        var back = _atDisplayEnd(obv, dp[dp.length - 21].time);
        if (back) {
          var d = end.value - back.value;
          var gross = 0;
          for (var i = dp.length - 20; i < dp.length; i++) gross += (dp[i].volume || 0);
          var ratio = gross > 0 ? d / gross : 0;
          state = Math.abs(ratio) < 0.2 ? 'ほぼ横ばい' : (ratio > 0 ? '直近20日で上向き' : '直近20日で低下');
          readout = '20日純出来高比 ' + (ratio >= 0 ? '+' : '') + (ratio * 100).toFixed(0) + '%';
        }
      }
      out.push({ key: 'obv', label: 'OBV', term: 'obv', state: state, readout: readout });
    })();

    return out;
  }

  // ── 規律テクニカル現在地（ミニ解説カード用・ADX/ATR フォーカス）──
  function disciplineDigest(displayPrices, allPrices) {
    var dp = displayPrices || [];
    var ap = (allPrices && allPrices.length) ? allPrices : dp;
    var endBar = dp.length ? dp[dp.length - 1] : null;
    var endTime = endBar ? endBar.time : null;
    var a = _atDisplayEnd(calcADX(ap, 14), endTime);
    var atSeries = calcATR(ap, 14);
    var at = _atDisplayEnd(atSeries, endTime);
    if (!a || !at) return { ok: false };
    var win = atSeries.filter(function (o) { return o.time <= endTime && (!dp.length || o.time >= dp[0].time); });
    var med = _median(win.map(function (o) { return o.pct; }));
    return {
      ok: true,
      adx: a.adx, plusDI: a.plusDI, minusDI: a.minusDI,
      atrPct: at.pct, atrMedian: parseFloat((med || 0).toFixed(2)),
      trend: _adxState(a.adx), dir: _diDir(a.plusDI, a.minusDI), vol: _atrVolState(at.pct, med),
      note: "ADXが低い局面は方向感が乏しく（レンジ気味）、ATR%で日々の振れの荒さを見ます。まず全体像（この現在地）→気になる指標を下で開く、の順で読むと迷いにくいです。",
    };
  }

  // ── 財務健全性トレンド系列（Feature#3）──────────────────────────────
  //  全年ループで equityRatio/currentRatio/現金/総負債 を系列化。**比率別の欠測ゲート**＝
  //  各比率の全入力キーが hasValue の年のみ算出し、1つでも欠ければ null(欠測点)。実0% と区別する
  //  (totalAssets は n() で欠損を0補完＝片側欠損年が"部分合計"で誤比率を出すのを防ぐ)。ETF は series ゼロ。
  function healthTrendSeries(data, isUS) {
    var tr = (data && data.financials_trend) || {};
    var years = Object.keys(tr).sort();
    var basis = marketBasisFor(!!isUS);
    var eq = [], cur = [], cash = [], tl = [];
    for (var i = 0; i < years.length; i++) {
      var f = tr[years[i]];
      var eqOk = FR.hasValue(f, "net_assets") && FR.hasValue(f, "current_assets") && FR.hasValue(f, "non_current_assets");
      var curOk = FR.hasValue(f, "current_assets") && FR.hasValue(f, "current_liabilities");
      eq.push(eqOk ? FR.equityRatio(f) : null);
      cur.push(curOk ? FR.currentRatio(f) : null);
      cash.push(FR.hasValue(f, "cf_cash_end") ? f.cf_cash_end : null);
      tl.push((FR.hasValue(f, "current_liabilities") || FR.hasValue(f, "non_current_liabilities")) ? FR.totalLiabilities(f) : null);
    }
    return {
      years: years, equityRatio: eq, currentRatio: cur, cash: cash, totalLiab: tl,
      basis: { equityMin: basis.equityMin, currentLow: basis.currentLow, currentHigh: basis.currentHigh },
    };
  }

  // ── DuPont 因数系列（束D）── 全年ループで dupont 各因数を系列化・欠測 null 点・ETF は空。
  function dupontFactorSeries(data) {
    var tr = (data && data.financials_trend) || {};
    var years = Object.keys(tr).sort();
    var nm = [], at = [], em = [], re = [];
    for (var i = 0; i < years.length; i++) {
      var d = FR.dupont(tr[years[i]]);
      nm.push(d.netMargin); at.push(d.assetTurnover); em.push(d.equityMultiplier); re.push(d.roe);
    }
    return { years: years, netMargin: nm, assetTurnover: at, equityMultiplier: em, roe: re };
  }
  // ── FCF & 収益の質 系列（束D）── 概算FCF/FCFマージン/現金変換率＋内訳CF・欠測 null 点・ETF は空。
  function fcfTrendSeries(data) {
    var tr = (data && data.financials_trend) || {};
    var years = Object.keys(tr).sort();
    var fcfA = [], mg = [], cc = [], op = [], iv = [];
    for (var i = 0; i < years.length; i++) {
      var f = tr[years[i]];
      fcfA.push(FR.fcf(f));
      mg.push(FR.fcfMargin(f));
      cc.push(FR.cashConversion(f));
      op.push(FR.hasValue(f, "operating_cf") ? f.operating_cf : null);
      iv.push(FR.hasValue(f, "investing_cf") ? f.investing_cf : null);
    }
    return { years: years, fcf: fcfA, fcfMargin: mg, cashConversion: cc, operatingCf: op, investingCf: iv };
  }

  // ── 純SVGスパークライン（束D）── null は欠測として除外。有効点<2は空svg。DOM非依存。
  function sparklineSVG(values, opts) {
    opts = opts || {};
    var w = opts.w || 64, h = opts.h || 18, pad = 2;
    var color = opts.color || "currentColor";
    var pts = [];
    for (var i = 0; i < values.length; i++) {
      if (values[i] != null && isFinite(Number(values[i]))) pts.push({ i: i, v: Number(values[i]) });
    }
    var head = '<svg class="dp-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '" aria-hidden="true">';
    if (pts.length < 2) return head + "</svg>";
    var xs = values.length - 1;
    var vs = pts.map(function (p) { return p.v; });
    var min = Math.min.apply(null, vs), max = Math.max.apply(null, vs);
    var span = (max - min) || 1;
    var coord = pts.map(function (p) {
      var x = pad + (p.i / xs) * (w - 2 * pad);
      var y = h - pad - ((p.v - min) / span) * (h - 2 * pad);
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
    return head + '<polyline points="' + coord + '" fill="none" stroke="' + color +
      '" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  // ── DuPont descriptor（束D・層1・公開）── no-score・中立driver句・純資産ベース明示。
  function dupontDescriptor(fin) {
    var d = FR.dupont(fin);
    var factors = [
      { key: "netMargin", label: "純利益率", termKey: "net-margin", value: d.netMargin, unit: "%" },
      { key: "assetTurnover", label: "総資産回転率", termKey: "asset-turnover", value: d.assetTurnover, unit: "倍" },
      { key: "equityMultiplier", label: "財務レバレッジ", termKey: "financial-leverage", value: d.equityMultiplier, unit: "倍" },
    ];
    var text;
    var complete = d.netMargin != null && d.assetTurnover != null && d.equityMultiplier != null && d.roe != null;
    if (complete) {
      // 符号ゲート: レバレッジ(財務レバレッジ)の効果は netMargin の符号で向きが反転する
      // （roe = netMargin×assetTurnover×equityMultiplier より ∂roe/∂equityMultiplier ∝ netMargin）。
      // 黒字（roe>=0）は「押し上げ」で正しいが、赤字（roe<0）だと押し上げは方向が逆＝マイナス幅の拡大が正しい。
      var driverSentence = d.roe < 0
        ? "純利益が赤字の年は、財務レバレッジが高いほどROEのマイナス幅が拡大し財務リスクも高まります（一般的な性質）。"
        : "レバレッジはROEを押し上げますが財務リスクも高めます（一般的な性質）。";
      text = "純資産ROE " + d.roe.toFixed(1) + "% は、純利益率×総資産回転率×財務レバレッジ の積です。" +
        "財務レバレッジ " + d.equityMultiplier.toFixed(2) + "倍 は総資産が純資産の約 " + d.equityMultiplier.toFixed(2) + "倍 であることを表します（純資産ベース＝少数株主持分を含む）。" +
        driverSentence;
    } else {
      text = "一部の因数が欠損のため、分解は参考値です（純資産ベース＝少数株主持分を含む）。";
    }
    return { factors: factors, roe: { value: d.roe, unit: "%" }, driver: { text: text } };
  }

  // ── FCF & 収益の質 descriptor（束D・層1・公開）── 事実記述のみ・中立・no-score。
  function fcfQualityDescriptor(data) {
    var s = fcfTrendSeries(data);
    var base = "概算FCF＝営業CF＋投資CF（投資CFは通常マイナス）。";
    // 最新の有効な現金変換率
    var lastCc = null;
    for (var i = s.cashConversion.length - 1; i >= 0; i--) { if (s.cashConversion[i] != null) { lastCc = s.cashConversion[i]; break; } }
    var hasNegFcf = s.fcf.some(function (v) { return v != null && v < 0; });
    var parts = [base];
    if (lastCc != null) {
      parts.push(lastCc >= 100
        ? "直近では営業CFが純利益を上回り、利益の現金化は概ね良好です（現金変換率 " + Math.round(lastCc) + "%）。"
        : "直近では営業CFが純利益を下回っています（現金変換率 " + Math.round(lastCc) + "%）。赤字年の現金変換率は表示していません。");
    } else {
      parts.push("現金変換率を算出できる年がありません（赤字年やCF欠損の年は非表示）。");
    }
    if (hasNegFcf) parts.push("投資が営業CFを上回った年は概算FCFがマイナスになります（成長投資局面で一般に起こりうる事実です）。");
    return { text: parts.join("") };
  }

  return {
    // テクニカル純関数
    calcMA, calcBB, detectSR, calcRSI, calcEMA, calcMACD, calcZigZag, autoZigZagDeviation, zigzagSegments, autoClusterTol, volumeColorData,
    calcATR, calcADX, calcKeltner, calcOBV, calcVWAP, disciplineDigest,
    signalDigest, healthTrendSeries, dupontFactorSeries, fcfTrendSeries,
    // 財務ディスクリプタ純関数
    priceWindow, periodLabel, financialMaxAbs, marketBasisFor, perStatus, pbrStatus,
    equityRatioDesc, currentRatioDesc, yoyBadge, plSteps, cfFlowStatus, cfCompanyType, cfWaterfall, radarScores,
    sparklineSVG, dupontDescriptor, fcfQualityDescriptor,
    // 色/特例定数
    FIN_COLORS, CF_BADGE_PAIR, COMPARE_COLORS, HOLDING_COMPANIES,
    // 分析グロッサリ・免責データ
    INDICATOR_GLOSSARY, ANALYSIS_DISCLAIMER,
  };
});
