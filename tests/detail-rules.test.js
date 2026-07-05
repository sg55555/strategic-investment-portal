// tests/detail-rules.test.js — detail-view 分離リファクタ Task1 の純関数錠。
// finance-rules.test.js と同型（node --test）。detail-rules.js は FinanceRules に委譲するため
// node では global へ注入してから require する（classic-script の global 参照を満たす）。
const test = require("node:test");
const assert = require("node:assert/strict");
const FinanceRules = require("../finance-rules.js");
global.FinanceRules = FinanceRules;
const D = require("../detail-rules.js");
const FORBIDDEN = require("./fixtures/forbidden_terms.js");

// ── priceWindow: 表示期間の絞り込み（US=暦年 / JP=前年4月〜当年3月 / 0件は末尾200件）──
test("priceWindow: US は暦年で絞る", () => {
  const prices = [
    { time: "2022-12-31", close: 1 }, { time: "2023-06-01", close: 2 },
    { time: "2023-12-31", close: 3 }, { time: "2024-01-02", close: 4 },
  ];
  const r = D.priceWindow(prices, 2023, true);
  assert.deepEqual(r.displayPrices.map((p) => p.time), ["2023-06-01", "2023-12-31"]);
  assert.deepEqual(r.filteredPrices.map((p) => p.time), ["2023-06-01", "2023-12-31"]);
  assert.equal(r.startDate, "2023-01-01");
  assert.equal(r.endDate, "2023-12-31");
});
test("priceWindow: JP は前年4月〜当年3月", () => {
  const prices = [
    { time: "2022-03-31", close: 1 }, { time: "2022-04-01", close: 2 },
    { time: "2023-03-31", close: 3 }, { time: "2023-04-01", close: 4 },
  ];
  const r = D.priceWindow(prices, 2023, false);
  assert.deepEqual(r.displayPrices.map((p) => p.time), ["2022-04-01", "2023-03-31"]);
  assert.equal(r.startDate, "2022-04-01");
  assert.equal(r.endDate, "2023-03-31");
});
test("priceWindow: 0件は末尾200件フォールバック（filteredPrices は空のまま）", () => {
  const prices = Array.from({ length: 250 }, (_, i) => ({ time: "1999-01-01", close: i }));
  const r = D.priceWindow(prices, 2050, true);
  assert.equal(r.displayPrices.length, 200);
  assert.equal(r.filteredPrices.length, 0);
  assert.equal(r.displayPrices[0].close, 50); // slice(-200) = index 50..249
});

// ── periodLabel: stock-title 文言（絞り込みの有無で分岐）──
test("periodLabel: US 絞り込みあり", () => {
  assert.equal(
    D.periodLabel("Apple", "AAPL", 2023, true, true),
    "Apple (AAPL) - 歴史的ローソク足時系列 [2023年1月 〜 2023年12月 経営期間トレンド]",
  );
});
test("periodLabel: JP 絞り込みあり", () => {
  assert.equal(
    D.periodLabel("トヨタ", "7203.T", 2023, false, true),
    "トヨタ (7203.T) - 歴史的ローソク足時系列 [2022年4月 〜 2023年3月 経営期間トレンド]",
  );
});
test("periodLabel: 絞り込みなしは直近市場ラベル", () => {
  assert.equal(
    D.periodLabel("トヨタ", "7203.T", 2023, false, false),
    "トヨタ (7203.T) - 直近市場ローソク足時系列",
  );
});

// ── financialMaxAbs: 15項目の最大絶対値（FinanceRules.n / totalAssets 委譲）──
test("financialMaxAbs: 15項目の max|abs|（totalAssets=流動+固定, 負も絶対値）", () => {
  const fin = {
    current_assets: 30000000, non_current_assets: 60000000, // totalAssets=90,000,000 が最大
    net_sales: 48036704, net_income: 4765000, net_assets: 45000000,
    current_liabilities: 25000000, non_current_liabilities: 20000000,
    operating_cf: 4000000, investing_cf: -3000000, financing_cf: -1000000,
  };
  assert.equal(D.financialMaxAbs(fin), 90000000);
  assert.equal(D.financialMaxAbs({ financing_cf: -12345 }), 12345); // 負の絶対値
  assert.equal(D.financialMaxAbs({}), 0);
});

// ── marketBasisFor: 市場別バリュエーション基準（MARKET_BASIS 単一ソース）──
test("marketBasisFor: US / JP の基準値", () => {
  assert.deepEqual(D.marketBasisFor(true),
    { perLow: 20.0, perHigh: 40.0, pbrLow: 2.0, pbrHigh: 15.0, label: "米国市場基準", equityMin: 30, currentLow: 150, currentHigh: null });
  assert.deepEqual(D.marketBasisFor(false),
    { perLow: 15.0, perHigh: 28.0, pbrLow: 1.0, pbrHigh: 3.0, label: "プロ基準", equityMin: 40, currentLow: 100, currentHigh: 150 });
});

test("marketBasisFor: 財務健全性の数値閾値を露出 (equityMin/currentLow/currentHigh)", () => {
  const jp = D.marketBasisFor(false), us = D.marketBasisFor(true);
  assert.equal(jp.equityMin, 40);
  assert.equal(jp.currentLow, 100);
  assert.equal(jp.currentHigh, 150); // JP: 100-150 帯
  assert.equal(us.equityMin, 30);
  assert.equal(us.currentLow, 150);
  assert.equal(us.currentHigh, null); // US: 単線
  // desc 文言は同一源(marketBasisFor)から生成され従来と一致（回帰固定）
  assert.equal(D.equityRatioDesc(false), "▶ 中長期安全性基準: 40.0% 以上で健全企業水準");
  assert.equal(D.currentRatioDesc(false), "▶ 短期支払能力基準: 100.0% 〜 150.0% 以上で安全圏");
  assert.equal(D.equityRatioDesc(true), "▶ 米国基準: 30.0% 以上 (自社株買い等で低下しやすい)");
  assert.equal(D.currentRatioDesc(true), "▶ 短期支払能力基準: 150.0% 以上で安全圏 (米国基準)");
});

// ── perStatus: PER 評価カード（しきい値・色・文言を verbatim 固定）──
test("perStatus: 0 はデータなし中立", () => {
  const b = D.marketBasisFor(false);
  assert.deepEqual(D.perStatus(0, b),
    { cardClass: "", valColor: "#cfe0f5", statusText: "▶ 収益評価: データなし" });
});
test("perStatus: 割安は green", () => {
  const b = D.marketBasisFor(false);
  assert.deepEqual(D.perStatus(b.perLow, b),
    { cardClass: "green", valColor: "#00e676", statusText: `▶ 収益評価: 割安圏 (${b.label}: ${b.perLow}倍以下)` });
});
test("perStatus: 割高は red", () => {
  const b = D.marketBasisFor(false);
  assert.deepEqual(D.perStatus(b.perHigh, b),
    { cardClass: "red", valColor: "#ff5c7a", statusText: `▶ 収益評価: 割高・過熱圏 (${b.label}: ${b.perHigh}倍以上)` });
});
test("perStatus: 中間は適正中立", () => {
  const b = D.marketBasisFor(false);
  assert.deepEqual(D.perStatus(20, b),
    { cardClass: "", valColor: "#cfe0f5", statusText: "▶ 収益評価: 適正水準 (標準レンジ内)" });
});

// ── pbrStatus: PBR 評価カード（gold/red/blue・US/JP 分岐）──
test("pbrStatus: 0 はデータなし中立", () => {
  const b = D.marketBasisFor(false);
  assert.deepEqual(D.pbrStatus(0, b, false),
    { cardClass: "", valColor: "#cfe0f5", statusText: "▶ 資産評価: データなし" });
});
test("pbrStatus: 解散価値以下は gold", () => {
  const b = D.marketBasisFor(false);
  assert.deepEqual(D.pbrStatus(b.pbrLow, b, false),
    { cardClass: "gold", valColor: "#ffd84d", statusText: `▶ 資産評価: 解散価値以下 (${b.label}: ${b.pbrLow}倍以下)` });
});
test("pbrStatus: 高プレミアムは red", () => {
  const b = D.marketBasisFor(false);
  assert.deepEqual(D.pbrStatus(b.pbrHigh, b, false),
    { cardClass: "red", valColor: "#ff5c7a", statusText: `▶ 資産評価: 高プレミアム評価 (${b.label}: ${b.pbrHigh}倍以上)` });
});
test("pbrStatus: 中間 blue は US/JP で文言分岐", () => {
  const jp = D.marketBasisFor(false), us = D.marketBasisFor(true);
  assert.deepEqual(D.pbrStatus(2, jp, false),
    { cardClass: "blue", valColor: "#38bdf8", statusText: "▶ 資産評価: 適正な資産評価水準" });
  assert.deepEqual(D.pbrStatus(5, us, true),
    { cardClass: "blue", valColor: "#38bdf8", statusText: "▶ 資産評価: 米国成長株水準 (標準レンジ内)" });
});

// ── equityRatioDesc / currentRatioDesc: 市場別の基準テキスト ──
test("equityRatioDesc / currentRatioDesc は US/JP で文言分岐", () => {
  assert.equal(D.equityRatioDesc(true), "▶ 米国基準: 30.0% 以上 (自社株買い等で低下しやすい)");
  assert.equal(D.equityRatioDesc(false), "▶ 中長期安全性基準: 40.0% 以上で健全企業水準");
  assert.equal(D.currentRatioDesc(true), "▶ 短期支払能力基準: 150.0% 以上で安全圏 (米国基準)");
  assert.equal(D.currentRatioDesc(false), "▶ 短期支払能力基準: 100.0% 〜 150.0% 以上で安全圏");
});

// ── yoyBadge: 前年比バッジ HTML（up/down/flat・欠損は空）──
test("yoyBadge: 増減・横ばい・欠損", () => {
  assert.equal(D.yoyBadge(110, 100), '<span class="kpi-yoy up">▲10.0%</span>');
  assert.equal(D.yoyBadge(90, 100), '<span class="kpi-yoy down">▼10.0%</span>');
  assert.equal(D.yoyBadge(100.2, 100), '<span class="kpi-yoy flat">▲0.2%</span>'); // |pct|<=0.5 は flat だが sign は正
  assert.equal(D.yoyBadge(100, 0), "");
  assert.equal(D.yoyBadge(100, null), "");
});

// ── cfFlowStatus: 営業/投資/財務CF のカード状態（符号→文言/色/クラス）──
test("cfFlowStatus: operating の +/-", () => {
  assert.deepEqual(D.cfFlowStatus(100, "operating"),
    { cardClass: "green", signText: "プラス", signColor: "#00e676", descText: "【本業が順調】" });
  assert.deepEqual(D.cfFlowStatus(-1, "operating"),
    { cardClass: "red", signText: "マイナス", signColor: "#ff1744", descText: "【本業が苦戦】" });
});
test("cfFlowStatus: investing は負が「攻めの経営」（緑赤が反転）", () => {
  assert.deepEqual(D.cfFlowStatus(-50, "investing"),
    { cardClass: "red", signText: "マイナス", signColor: "#ff1744", descText: "【攻めの経営】" });
  assert.deepEqual(D.cfFlowStatus(0, "investing"),
    { cardClass: "green", signText: "プラス", signColor: "#00e676", descText: "【守りの経営】" });
});
test("cfFlowStatus: financing の +/-", () => {
  assert.deepEqual(D.cfFlowStatus(0, "financing"),
    { cardClass: "green", signText: "プラス", signColor: "#00e676", descText: "【導入・成長期】" });
  assert.deepEqual(D.cfFlowStatus(-30, "financing"),
    { cardClass: "red", signText: "マイナス", signColor: "#ff1744", descText: "【成熟・衰退期】" });
});

// ── cfCompanyType: 3CF 符号の組合せ→企業タイプ（5分類）──
test("cfCompanyType: 5分類（type/icon/label）", () => {
  assert.deepEqual(D.cfCompanyType(100, -50, -30), { cfType: "excellent", icon: "crown", label: "優良企業タイプ" });
  assert.deepEqual(D.cfCompanyType(100, -50, 30), { cfType: "aggressive", icon: "rocket", label: "積極投資タイプ" });
  assert.deepEqual(D.cfCompanyType(-100, -50, 30), { cfType: "venture", icon: "flask", label: "ベンチャータイプ" });
  assert.deepEqual(D.cfCompanyType(-100, 50, 30), { cfType: "warn", icon: "warn", label: "ジリ脚タイプ" });
  assert.deepEqual(D.cfCompanyType(100, 50, -30), { cfType: "pivot", icon: "bars", label: "転換期・変革タイプ" });
});

// ── plSteps: 損益の段（core は常出・その他は hasValue ゲート）──
test("plSteps: 欠損項目(gross_profit)は段を出さない", () => {
  const fin = {
    net_sales: 1000, operating_income: 200, net_income: 100,
    income_before_taxes: 150, ordinary_income: 180, gross_profit: null,
  };
  const steps = D.plSteps(fin);
  assert.deepEqual(steps.map((s) => s.label),
    ["当期純利益", "税金等調整前当期純利益", "経常利益", "営業利益", "売上高"]);
  assert.deepEqual(steps.map((s) => s.val), [100, 150, 180, 200, 1000]);
  // gross_profit=0（実在値）は段を出す（hasValue は 0 を有効値扱い）
  assert.ok(D.plSteps({ ...fin, gross_profit: 0 }).some((s) => s.label === "売上総利益"));
});

// ── radarScores: 5指標スコア（0..100 clamp）＋ roe/roa 実値 ──
test("radarScores: スコア配列と roe/roa（持株会社は税引前利益で収益性評価）", () => {
  const fin = {
    net_income: 100, net_assets: 500, current_assets: 400, non_current_assets: 600,
    operating_income: 120, income_before_taxes: 240, net_sales: 1000,
    current_liabilities: 200,
  };
  const r = D.radarScores(fin, "7203.T"); // 通常銘柄=営業利益
  assert.equal(r.roe, 20);   // 100/500*100
  assert.equal(r.roa, 10);   // 100/1000*100
  assert.equal(r.scores.length, 5);
  // 収益性は opMargin=12% → clampScore(12,0,12)=100
  assert.equal(r.scores[2], 100);
  const h = D.radarScores(fin, "9984.T"); // 持株会社=税引前利益 24% → clamp(24,0,12)=100 も同様に100
  assert.equal(h.scores[2], 100);
});

// ── volumeColorData: 出来高バーの色（陽線/陰線）──
test("volumeColorData: close>=open は赤系 / < は青系", () => {
  const out = D.volumeColorData([
    { time: "a", volume: 10, close: 5, open: 4 },
    { time: "b", volume: 20, close: 3, open: 4 },
    { time: "c", close: 5, open: 5 },
  ]);
  assert.deepEqual(out, [
    { time: "a", value: 10, color: "rgba(218,10,55,0.32)" },
    { time: "b", value: 20, color: "rgba(20,80,215,0.32)" },
    { time: "c", value: 0, color: "rgba(218,10,55,0.32)" }, // 同値=赤系, volume 欠損=0
  ]);
});

// ── テクニカル純関数: verbatim relocate の同値確認（代表挙動）──
test("calcMA: 期間平均", () => {
  const out = D.calcMA([{ time: "a", close: 2 }, { time: "b", close: 4 }, { time: "c", close: 6 }], 2);
  assert.equal(out.length, 2);
  assert.equal(out[out.length - 1].value, 5);
  assert.deepEqual(out[0], { time: "b", value: 3 });
});
test("calcBB: upper/mid/lower（mid=移動平均）", () => {
  const prices = Array.from({ length: 5 }, (_, i) => ({ time: String(i), close: i + 1 }));
  const r = D.calcBB(prices, 3, 2);
  assert.equal(r.mid[0].value, 2);   // (1+2+3)/3
  assert.ok(r.upper[0].value > r.mid[0].value && r.lower[0].value < r.mid[0].value);
});
test("calcRSI: 一貫上昇は 100 近傍 / 短すぎは空", () => {
  assert.deepEqual(D.calcRSI([{ time: "a", close: 1 }], 14), []);
  const up = Array.from({ length: 20 }, (_, i) => ({ time: String(i), close: i + 1 }));
  const r = D.calcRSI(up, 14);
  assert.equal(r[r.length - 1].value, 99.01); // avgLoss=0 → rs=100 → 100-100/101=99.01
});
test("calcEMA: 先頭 period-1 は null, period-1 は単純平均", () => {
  const out = D.calcEMA([1, 2, 3, 4], 2);
  assert.equal(out[0], null);
  assert.equal(out[1], 1.5); // (1+2)/2
});
test("calcMACD: line/signal/histogram を返す（histogram に色）", () => {
  const prices = Array.from({ length: 60 }, (_, i) => ({ time: String(i), close: 100 + Math.sin(i) * 5 }));
  const r = D.calcMACD(prices);
  assert.ok(Array.isArray(r.macdLine) && Array.isArray(r.signalLine) && Array.isArray(r.histogram));
  if (r.histogram.length) assert.ok(/^rgba\(/.test(r.histogram[0].color));
});
test("calcZigZag / autoZigZagDeviation: pivots と自動閾値レンジ", () => {
  assert.deepEqual(D.calcZigZag([{ time: "a", close: 1, high: 1, low: 1 }], 0.03), []);
  const dev = D.autoZigZagDeviation(Array.from({ length: 5 }, (_, i) => ({ close: i })));
  assert.equal(dev, 0.03); // length<10 は既定 0.03
  const dev2 = D.autoZigZagDeviation(Array.from({ length: 20 }, (_, i) => ({ close: 100 + i })));
  assert.ok(dev2 >= 0.025 && dev2 <= 0.08);
});
test("detectSR: resistance / support クラスタを返す", () => {
  const prices = Array.from({ length: 40 }, (_, i) => ({ high: 100 + (i % 5), low: 90 - (i % 5) }));
  const r = D.detectSR(prices);
  assert.ok(Array.isArray(r.resistance) && Array.isArray(r.support));
});

// ── 定数 export（Task2 の detail-charts が参照）──
test("定数を verbatim で同梱 export する", () => {
  assert.deepEqual(D.COMPARE_COLORS,
    ["#5cf0ff", "#ff5ca8", "#ffd84d", "#a35cff", "#34f5cf", "#ff8a2a", "#3aa6ff", "#ff4d6d"]);
  assert.ok(D.HOLDING_COMPANIES instanceof Set && D.HOLDING_COMPANIES.has("9984.T"));
  assert.deepEqual(D.FIN_COLORS.bs.eq, ["#ffd84d", "#c87600"]);
  assert.deepEqual(D.CF_BADGE_PAIR.excellent, ["#ffd84d", "#c87600"]);
});

// ── INDICATOR_GLOSSARY / ANALYSIS_DISCLAIMER: 分析グロッサリ・免責データ（規制安全＝中立・売買/予測語なし）──
test("INDICATOR_GLOSSARY: shape and required terms", () => {
  assert.ok(Array.isArray(D.INDICATOR_GLOSSARY));
  const required = ["ma", "bb", "rsi", "macd", "sr", "zigzag", "volume", "percent-b",
    "equity-ratio", "current-ratio", "roe", "roa", "op-margin", "net-margin", "per", "pbr"];
  const terms = new Set(D.INDICATOR_GLOSSARY.map((g) => g.term));
  for (const t of required) assert.ok(terms.has(t), `missing term: ${t}`);
  assert.equal(terms.size, D.INDICATOR_GLOSSARY.length, "duplicate term");
  for (const g of D.INDICATOR_GLOSSARY) {
    assert.equal(typeof g.term, "string");
    assert.ok(g.read && typeof g.read === "string");
    assert.ok(g.def && typeof g.def === "string");
  }
});

test("INDICATOR_GLOSSARY: def/read contain no trade/forecast words", () => {
  for (const g of D.INDICATOR_GLOSSARY) {
    const txt = g.read + "　" + g.def;
    for (const re of FORBIDDEN.ALL) {
      assert.ok(!re.test(txt), `forbidden word in "${g.term}": ${re} :: ${txt}`);
    }
  }
});

test("INDICATOR_GLOSSARY has cross-section terms", () => {
  const terms = D.INDICATOR_GLOSSARY.map(g => g.term);
  ["パーセンタイル", "中央値", "四分位", "同市場比較"].forEach(t => assert.ok(terms.includes(t), t));
});

test("ANALYSIS_DISCLAIMER: nonempty education-frame string", () => {
  assert.equal(typeof D.ANALYSIS_DISCLAIMER, "string");
  assert.ok(D.ANALYSIS_DISCLAIMER.length > 20);
});

// ── signalDigest（テクニカル現在地サマリ・Feature#2）──────────────────
//  規制安全（no-score 構造固定・売買/予測語彙非命中）と time-index 整合・no-data 畳みを錠。
const STATE_ENUM = new Set([
  'MA5>MA25>MA75の並び', 'MA75>MA25>MA5の並び', '並びは混在',
  '買われ過ぎの目安圏(70以上)', '売られ過ぎの目安圏(30以下)', '中立圏',
  'MACD線がシグナル線の上', 'MACD線がシグナル線の下',
  '上限バンドの外側', '下限バンドの外側', 'バンド内側',
  '算出済み', '直近の確定区間はトレンド', '直近の確定区間はレンジ',
  '陽線(終値≥始値)', '陰線', 'データ不足',
]);

function synthPrices(n) {
  const out = []; let p = 100;
  for (let i = 0; i < n; i++) {
    const d = new Date(2020, 0, 1 + i); const t = d.toISOString().slice(0, 10);
    const o = p; p = p * (1 + (Math.sin(i / 7) * 0.01)); const c = p;
    out.push({ time: t, open: o, high: Math.max(o, c) * 1.01, low: Math.min(o, c) * 0.99, close: c, volume: 1000 + i });
  }
  return out;
}

test("signalDigest: 7 descriptors, no numeric score fields, state in closed enum", () => {
  const all = synthPrices(300);
  const disp = all.slice(-120);
  const ds = D.signalDigest(disp, all);
  assert.equal(ds.length, 7);
  for (const d of ds) {
    assert.ok(typeof d.key === "string" && typeof d.label === "string" && typeof d.term === "string");
    assert.ok(STATE_ENUM.has(d.state), `state not in enum: ${d.state}`);
    // no-score 構造固定: numeric スコア用フィールドを持たない
    assert.equal(d.value, undefined);
    assert.equal(d.score, undefined);
    assert.equal(d.weight, undefined);
    assert.equal(typeof d.readout, "string");
  }
});

test("signalDigest: labels/states contain no trade/forecast words", () => {
  const all = synthPrices(300);
  const ds = D.signalDigest(all.slice(-120), all);
  for (const d of ds) {
    const txt = [d.label, d.state, d.readout, d.note || ""].join("　");
    for (const re of FORBIDDEN.ALL) assert.ok(!re.test(txt), `forbidden in ${d.key}: ${re} :: ${txt}`);
  }
});

test("signalDigest: current value indexed to display window end, not allPrices tail (H7)", () => {
  const all = synthPrices(300);
  const disp = all.slice(0, 120); // 過去窓（末尾=all[119]・all 末尾=all[299] とは別日）
  const ds = D.signalDigest(disp, all);
  const rsi = ds.find((d) => d.key === "rsi");

  // フル履歴 RSI 系列から「disp 末尾の日付」の値と「all 末尾（今日）」の値を取り出す。
  const rsiSeries = D.calcRSI(all, 14);
  const dispEndTime = disp[disp.length - 1].time;
  const atDispEnd = rsiSeries.find((r) => r.time === dispEndTime);
  const atToday = rsiSeries[rsiSeries.length - 1];
  assert.ok(atDispEnd, "RSI series should cover disp end date");

  // H7 不変条件: readout は disp 末尾日の RSI 値であり、all 末尾（今日）の値ではない。
  // （恒真アサートでなく実値で照合する＝allPrices-tail indexing への回帰を検出できる）
  assert.equal(rsi.readout, "RSI " + atDispEnd.value);
  assert.notEqual(atDispEnd.value, atToday.value, "test data must make disp-end and today differ");
  assert.notEqual(rsi.readout, "RSI " + atToday.value);
});

test("signalDigest: thin history folds to データ不足, no crash", () => {
  const ds = D.signalDigest(synthPrices(5), synthPrices(5));
  assert.equal(ds.length, 7);
  assert.ok(ds.some((d) => d.state === "データ不足"));
});

// S/R 用の決定論ピーク列: 谷=100。近い抵抗=122(count1)・遠い抵抗=150/160/170(各count3)・末尾close=120。
// これで「count 降順 top-3(150/160/170)」は近い 122 を脱落させる＝M7 の反例になる。
function synthSRSeries() {
  const A = []; let t = 0;
  const bar = (o, h, l, c) => { const d = new Date(2020, 0, 1 + t++); return { time: d.toISOString().slice(0, 10), open: o, high: h, low: l, close: c, volume: 1000 }; };
  const valley = () => A.push(bar(100, 100.8, 99.2, 100));
  const peak = (lvl) => A.push(bar(100, lvl, 99, 100.5));
  const valleys = (n) => { for (let i = 0; i < n; i++) valley(); };
  valleys(4);
  peak(122); valleys(4);
  peak(150); valleys(4); peak(150); valleys(4); peak(150); valleys(4);
  peak(160); valleys(4); peak(160); valleys(4); peak(160); valleys(4);
  peak(170); valleys(4); peak(170); valleys(4); peak(170); valleys(4);
  for (let i = 0; i < 5; i++) A.push(bar(120, 120.5, 119.5, 120)); // 末尾=現在地 close 120（ピボット検出外）
  return A;
}

test("detectSR: maxPerSide caps per side (default 3) and Infinity returns all clusters (M7)", () => {
  const A = synthSRSeries();
  const def = D.detectSR(A);
  const all = D.detectSR(A, Infinity);
  assert.ok(def.resistance.length <= 3, "default caps resistance to top-3");
  assert.ok(all.resistance.length > def.resistance.length, "Infinity returns more clusters");
  assert.ok(!def.resistance.some((r) => r.price === 122), "near 122 dropped by default top-3-by-count");
  assert.ok(all.resistance.some((r) => r.price === 122), "near 122 present with Infinity");
});

test("signalDigest S/R: picks nearest-by-distance level, not top-3-by-count (M7)", () => {
  const A = synthSRSeries();
  const sr = D.signalDigest(A, A).find((d) => d.key === "sr");
  assert.equal(sr.state, "算出済み");
  // close=120 に最も近い抵抗は 122(+1.7%)。top-3(150/160/170)しか見なければ +25.0% になってしまう。
  assert.match(sr.readout, /直近の抵抗まで \+1\.7%/);
  assert.doesNotMatch(sr.readout, /\+25\.0%/);
});

test("signalDigest S/R: computed from display window (dp), independent of allPrices tail (window-aware)", () => {
  const disp = synthSRSeries(); // close ~120・抵抗 122 近傍（2020 の日付）
  // all = disp ＋ はるかに高い直近水準(500)の後続 bar（2022）。S/R が ap を使うなら巨大な%になるはず。
  const tail = [];
  for (let i = 0; i < 300; i++) { const d = new Date(2022, 0, 1 + i); tail.push({ time: d.toISOString().slice(0, 10), open: 500, high: 505, low: 495, close: 500, volume: 1000 }); }
  const all = disp.concat(tail);
  const srDispOnly = D.signalDigest(disp, disp).find((d) => d.key === "sr");
  const srWithHugeAll = D.signalDigest(disp, all).find((d) => d.key === "sr");
  // S/R は dp（第1引数=表示期間）から算出されるので allPrices 末尾(500)に影響されず一致する。
  assert.equal(srWithHugeAll.readout, srDispOnly.readout);
  assert.match(srWithHugeAll.readout, /直近の抵抗まで \+1\.7%/);
});

// ── healthTrendSeries（財務健全性トレンド・Feature#3）──────────────────
test("healthTrendSeries: per-ratio missing gate → null (not 0%)", () => {
  const data = { currency: "JPY", financials_trend: {
    "2021": { net_assets: 500, current_assets: 300, non_current_assets: 700, current_liabilities: 200, non_current_liabilities: 300, cf_cash_end: 120 },
    "2022": { current_assets: 300, non_current_assets: 700 }, // net_assets/負債/現金 欠損
  }};
  const s = D.healthTrendSeries(data, false);
  assert.deepEqual(s.years, ["2021", "2022"]);
  assert.equal(typeof s.equityRatio[0], "number");
  assert.equal(s.equityRatio[1], null);   // net_assets 欠損 → 0% でなく null
  assert.equal(s.currentRatio[1], null);  // current_liabilities 欠損 → null
  assert.equal(s.cash[1], null);          // cf_cash_end 欠損 → null
  assert.equal(s.totalLiab[1], null);     // 負債両方欠損 → null
  assert.equal(s.cash[0], 120);
  assert.equal(s.totalLiab[0], 500);      // 200 + 300
  assert.equal(s.basis.equityMin, 40);
  assert.equal(s.basis.currentHigh, 150);
});

test("healthTrendSeries: ETF (financials_trend={}) → 空系列", () => {
  const s = D.healthTrendSeries({ currency: "JPY", financials_trend: {} }, false);
  assert.deepEqual(s.years, []);
  assert.deepEqual(s.equityRatio, []);
  assert.equal(s.basis.equityMin, 40);
});

test("INDICATOR_GLOSSARY: cagr/growth-rate は read 付きで存在（売買/予測語なし）", () => {
  const g = require("../detail-rules.js").INDICATOR_GLOSSARY;
  const by = {}; g.forEach((e) => (by[e.term] = e));
  assert.ok(by["cagr"] && by["cagr"].read && by["cagr"].def);
  assert.ok(by["growth-rate"] && by["growth-rate"].read && by["growth-rate"].def);
  assert.doesNotMatch(by["cagr"].def + by["growth-rate"].def, /買い|売り|推奨|割安|割高/);
});
