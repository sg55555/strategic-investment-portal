const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../portal-price-rules.js");

const ASOF = { JP: "2026-08-20", US: "2026-08-21" };
function item(ticker, px, market) {
  return { ticker: ticker, name: ticker, market: market || (ticker.endsWith(".T") ? "JP" : "US"), px: px };
}
function px(o) {
  return Object.assign({ last: 100, date: "2026-08-21", c1: 1, c5: 1, vr: 1, dh: -5, hi52: 120, lo52: 80, pos52: 50, spark: [0, 50, 100] }, o);
}

test("isStale: 同日は false・自市場より古い日は true・px 無しは false", () => {
  assert.equal(R.isStale(px({ date: "2026-08-21" }), ASOF, "US"), false);
  assert.equal(R.isStale(px({ date: "2026-08-10" }), ASOF, "US"), true);
  assert.equal(R.isStale(px({ date: "2026-08-20" }), ASOF, "JP"), false);  // JP の最新は 8/20
  assert.equal(R.isStale(px({ date: "2026-08-20" }), ASOF, "US"), true);   // US では古い
  assert.equal(R.isStale(null, ASOF, "US"), false);                        // データ無しは stale ではない
  assert.equal(R.isStale(px({}), {}, "US"), false);                        // asof 不明なら判定しない
});

test("marketOf: country 優先・欠落時は末尾 .T で JP", () => {
  assert.equal(R.marketOf("7203.T", { country: "JP" }), "JP");
  assert.equal(R.marketOf("AAPL", {}), "US");
  assert.equal(R.marketOf("7203.T", {}), "JP");
});

test("rankTop(gain): c1 降順・上位N・stale 除外を件数で返す", () => {
  const items = [
    item("A", px({ c1: 5 })), item("B", px({ c1: 9 })),
    item("EA", px({ c1: 99, date: "2026-08-10" })),   // stale
    item("C", px({ c1: 7 })),
  ];
  const r = R.rankTop(items, "gain", 2, ASOF);
  assert.deepEqual(r.rows.map((x) => x.ticker), ["B", "C"]);
  assert.equal(r.excludedStale, 1);
});

test("rankTop(lose): c1 昇順", () => {
  const items = [item("A", px({ c1: -1 })), item("B", px({ c1: -8 })), item("C", px({ c1: 3 }))];
  assert.deepEqual(R.rankTop(items, "lose", 3, ASOF).rows.map((x) => x.ticker), ["B", "A", "C"]);
});

test("rankTop(high): dh は 0 に近い順（高値更新=0 が先頭）", () => {
  const items = [item("A", px({ dh: -12 })), item("B", px({ dh: 0 })), item("C", px({ dh: -3 }))];
  assert.deepEqual(R.rankTop(items, "high", 3, ASOF).rows.map((x) => x.ticker), ["B", "C", "A"]);
});

test("rankTop: 指標が null / px 無しの銘柄は落とす", () => {
  const items = [item("A", px({ vr: null })), item("B", null), item("C", px({ vr: 3 }))];
  const r = R.rankTop(items, "vol", 5, ASOF);
  assert.deepEqual(r.rows.map((x) => x.ticker), ["C"]);
  assert.equal(r.excludedStale, 0);
});

test("rankTop: 同値は ticker 昇順で安定（描画のたびに順序が変わらない）", () => {
  const items = [item("ZZZ", px({ c1: 4 })), item("AAA", px({ c1: 4 })), item("MMM", px({ c1: 4 }))];
  assert.deepEqual(R.rankTop(items, "gain", 3, ASOF).rows.map((x) => x.ticker), ["AAA", "MMM", "ZZZ"]);
});

test("priceColumns: wide は8列・narrow は4列・spark はソート不可", () => {
  const wide = R.priceColumns(false), narrow = R.priceColumns(true);
  assert.deepEqual(wide.map((c) => c.key), ["ticker", "name", "last", "c1", "c5", "vr", "pos52", "spark"]);
  assert.deepEqual(narrow.map((c) => c.key), ["name", "last", "c1", "spark"]);
  assert.equal(wide[wide.length - 1].sortable, false);
  assert.equal(narrow[0].sortable, true);
});

test("sparkGeometry: 点数分の座標を返す・平坦データは水平線・2点未満は null", () => {
  const g = R.sparkGeometry([0, 100], 100, 20);
  assert.equal(g.points.split(" ").length, 2);
  assert.match(g.area, /^M/);
  const flat = R.sparkGeometry([50, 50, 50], 100, 20);
  const ys = flat.points.split(" ").map((p) => Number(p.split(",")[1]));
  assert.equal(new Set(ys).size, 1);            // 全部同じ y = 水平
  assert.equal(R.sparkGeometry([1], 100, 20), null);
  assert.equal(R.sparkGeometry(null, 100, 20), null);
});

test("fmt*: null は -- ・正の値に + が付く・単位が付く", () => {
  assert.equal(R.fmtSigned(1.234, 2, "%"), "+1.23%");
  assert.equal(R.fmtSigned(-1.2, 1, "%"), "-1.2%");
  assert.equal(R.fmtSigned(null, 2, "%"), "--");
  assert.equal(R.fmtVolRatio(2.415), "2.42倍");
  assert.equal(R.fmtVolRatio(null), "--");
  assert.equal(R.fmtDistHigh(0), "高値更新");
  assert.equal(R.fmtDistHigh(-3.14), "高値まで 3.1%");
  assert.equal(R.fmtDistHigh(null), "--");
});

test("clampPos: 0-100 に収める・null は null", () => {
  assert.equal(R.clampPos(-5), 0);
  assert.equal(R.clampPos(140), 100);
  assert.equal(R.clampPos(42), 42);
  assert.equal(R.clampPos(null), null);
});

test("rankTop: 候補の半分超が stale なら鮮度除外を止めて全件出す（安全弁）", () => {
  // ETL が未来日付を1本混入 → market_asof が先へ飛び、その市場が丸ごと stale になる状況。
  // 「何も出ない」は原因が UI から見えない最悪の壊れ方なので、出す側へ倒す。
  const asof = { US: "2026-08-25" };
  const items = [
    item("A", px({ c1: 5, date: "2026-08-21" })),
    item("B", px({ c1: 9, date: "2026-08-21" })),
    item("C", px({ c1: 7, date: "2026-08-25" })),
  ];
  const r = R.rankTop(items, "gain", 5, asof);
  assert.equal(r.staleFilterDisabled, true);
  assert.deepEqual(r.rows.map((x) => x.ticker), ["B", "C", "A"]);
  assert.equal(r.excludedStale, 0);
});

test("rankTop: stale が半分以下なら従来どおり除外する（安全弁は働かない）", () => {
  const items = [
    item("A", px({ c1: 5 })), item("B", px({ c1: 9 })),
    item("EA", px({ c1: 99, date: "2026-08-10" })),
  ];
  const r = R.rankTop(items, "gain", 5, ASOF);
  assert.equal(r.staleFilterDisabled, false);
  assert.equal(r.excludedStale, 1);
  assert.deepEqual(r.rows.map((x) => x.ticker), ["B", "A"]);
});

const fs = require("node:fs");
const path = require("node:path");

test("sectorOf: 代表的な業種が大分類へ落ちる", () => {
  assert.equal(R.sectorOf("US - 半導体・AI", false), "テクノロジー");
  assert.equal(R.sectorOf("電機・インフラIT", false), "テクノロジー");
  assert.equal(R.sectorOf("情報通信・巨大投資", false), "テクノロジー");   // dump 側にだけある業種
  assert.equal(R.sectorOf("証券・金融サービス", false), "金融");
  assert.equal(R.sectorOf("US - REIT・不動産", false), "不動産");
  assert.equal(R.sectorOf("総合商社", false), "素材");
});

test("sectorOf: ETF 判定が最優先・未知業種は その他", () => {
  assert.equal(R.sectorOf("US - テクノロジー", true), "ETF");   // isEtf が industry に勝つ
  assert.equal(R.sectorOf("国内ETF - TOPIX", false), "ETF");    // industry に ETF を含む
  assert.equal(R.sectorOf("宇宙開発", false), "その他");
  assert.equal(R.sectorOf(null, false), "その他");
  assert.equal(R.sectorOf(undefined, false), "その他");
});

test("SECTOR_ORDER: 全ての写像先を含み、重複が無い", () => {
  const targets = new Set(Object.values(R.SECTOR_MAP));
  targets.add("ETF"); targets.add("その他");
  for (const t of targets) assert.ok(R.SECTOR_ORDER.includes(t), `${t} が SECTOR_ORDER に無い`);
  assert.equal(new Set(R.SECTOR_ORDER).size, R.SECTOR_ORDER.length);
});

test("SECTOR_MAP: 現ユニバースの全業種が写像に載っている（マップ漏れ検知）", () => {
  const lines = fs.readFileSync(path.join(__dirname, "..", "data", "universe.csv"), "utf8").trim().split(/\r?\n/);
  const unmapped = new Set();
  for (const line of lines.slice(1)) {
    const cols = line.split(",");
    const industry = cols.slice(-4)[0];              // 末尾から: industry,currency,country,type
    const isEtf = cols[cols.length - 1] === "etf";   // 社名にカンマが入っても壊れない読み方
    if (R.sectorOf(industry, isEtf) === "その他") unmapped.add(industry);
  }
  assert.deepEqual([...unmapped], [], "写像に無い業種がある＝SECTOR_MAP に追記が必要");
});

test("HEAT_METRICS: 3指標・キーとフォールバック", () => {
  assert.deepEqual(R.HEAT_METRICS.map((m) => m.key), ["c1", "c5", "pos52"]);
  assert.equal(R.heatMetric("pos52").center, 50);
  assert.equal(R.heatMetric("c5").span, 6);
  assert.equal(R.heatMetric("知らないキー").key, "c1");   // 未知キーは既定へ
});

test("heatValue: 指標の取り出し・欠損は null", () => {
  assert.equal(R.heatValue(px({ c1: 1.5 }), "c1"), 1.5);
  assert.equal(R.heatValue(px({ pos52: 62 }), "pos52"), 62);
  assert.equal(R.heatValue(px({ c5: null }), "c5"), null);
  assert.equal(R.heatValue(null, "c1"), null);
  assert.equal(R.heatValue(px({ c1: NaN }), "c1"), null);
});

test("heatStep: 中立帯・段・振り切り・null", () => {
  assert.equal(R.heatStep(null, "c1"), null);
  assert.deepEqual(R.heatStep(0, "c1"), { i: -1, up: true });        // 中立（|d| < 0.06）
  assert.deepEqual(R.heatStep(0.15, "c1"), { i: -1, up: true });     // 0.15/3 = 0.05 → 中立
  assert.deepEqual(R.heatStep(0.5, "c1"), { i: 0, up: true });       // 0.167 → 第1段
  assert.deepEqual(R.heatStep(-3, "c1"), { i: 4, up: false });       // 振り切り（下）
  assert.deepEqual(R.heatStep(99, "c1"), { i: 4, up: true });        // 範囲外でも最上段に丸める
  assert.deepEqual(R.heatStep(50, "pos52"), { i: -1, up: true });    // pos52 は 50 が中立
  assert.deepEqual(R.heatStep(100, "pos52"), { i: 4, up: true });
  assert.deepEqual(R.heatStep(0, "pos52"), { i: 4, up: false });
});
