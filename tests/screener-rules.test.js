const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../screener-rules.js");

const STOCK = { per: 12, pbr: 1.2, opMargin: 8, roe: 10, netMargin: 5, eqRatio: 45, curRatio: 150, salesCagr: 7, country: "JP", isEtf: false };
const ETF   = { per: 0, pbr: 0, opMargin: null, roe: null, netMargin: null, eqRatio: null, curRatio: null, salesCagr: null, country: "JP", isEtf: true };

test("positive(PER): min は 0以下/未満を除外、max-only は 0以下を保持（既存挙動）", () => {
  assert.equal(S.passesScreening(STOCK, { per: { min: 10, max: null } }), true);
  assert.equal(S.passesScreening({ ...STOCK, per: 0 }, { per: { min: 10, max: null } }), false);
  assert.equal(S.passesScreening({ ...STOCK, per: 0 }, { per: { min: null, max: 15 } }), true); // max-only は per<=0 を保持
});
test("nullable(ROE): 制約時 null は除外（max-only/負min でも）", () => {
  assert.equal(S.passesScreening(STOCK, { roe: { min: 8, max: null } }), true);
  assert.equal(S.passesScreening(ETF, { roe: { min: 8, max: null } }), false);
  assert.equal(S.passesScreening(ETF, { roe: { min: null, max: 3 } }), false); // 欠測 null は max-only でも除外（D1）
  assert.equal(S.passesScreening(ETF, { opMargin: { min: -50, max: null } }), false); // 負min でも欠測除外
});
test("制約なし軸は無視", () => {
  assert.equal(S.passesScreening(ETF, {}), true);
});

test("passesScreening: min/max とも非有限の軸は no-op（除外しない）", () => {
  assert.equal(S.passesScreening(STOCK, { per: { min: null, max: null } }), true);
  assert.equal(S.passesScreening(ETF, { roe: { min: null, max: null } }), true);
});

test("normalizeMarkets: [] と [JP,US] は無制約([])", () => {
  assert.deepEqual(S.normalizeMarkets([]), []);
  assert.deepEqual(S.normalizeMarkets(["JP", "US"]), []);
  assert.deepEqual(S.normalizeMarkets(["JP"]), ["JP"]);
});
test("passesMarket: 無制約=全通過 / 市場指定時 ETF は false / 国一致", () => {
  assert.equal(S.passesMarket({ country: "US", isEtf: false }, []), true);
  assert.equal(S.passesMarket({ country: "JP", isEtf: true }, ["JP"]), false); // 市場指定＝株式のみ
  assert.equal(S.passesMarket({ country: "JP", isEtf: false }, ["JP"]), true);
  assert.equal(S.passesMarket({ country: "US", isEtf: false }, ["JP"]), false);
});
test("normalizeMarkets/passesMarket: 重複トークン折込・full-set×ETF は通過", () => {
  assert.deepEqual(S.normalizeMarkets(["JP", "JP"]), ["JP"]);
  assert.deepEqual(S.normalizeMarkets(["US", "JP"]), []);
  assert.equal(S.passesMarket({ country: "JP", isEtf: true }, ["JP", "US"]), true); // full-set=無制約→ETFも通過
});
test("hasAnyConstraint: 市場のみ絞込→true / 両チェック([])→軸無ければ false", () => {
  assert.equal(S.hasAnyConstraint({}, ["JP"]), true);
  assert.equal(S.hasAnyConstraint({}, ["JP", "US"]), false);
  assert.equal(S.hasAnyConstraint({ per: { min: 10, max: null } }, []), true);
});
test("normalizeCriteria: 有限数のみ・空軸は落とす", () => {
  const c = S.normalizeCriteria({ per: { min: "10", max: "" }, roe: { min: "", max: "" } });
  assert.deepEqual(c, { per: { min: 10, max: null } });
});

test("validatePreset: 空白のみ名/40字超/不正軸/不正市場は false", () => {
  assert.equal(S.validatePreset({ name: "   ", criteria: {}, markets: [] }), false);
  assert.equal(S.validatePreset({ name: "a".repeat(41), criteria: {}, markets: [] }), false);
  assert.equal(S.validatePreset({ name: "x", criteria: { bogus: { min: 1, max: null } }, markets: [] }), false);
  assert.equal(S.validatePreset({ name: "x", criteria: {}, markets: ["XX"] }), false);
  assert.equal(S.validatePreset({ name: "割安JP", criteria: { per: { min: 10, max: null } }, markets: ["JP"] }), true);
});
test("migratePreset: 旧形/未知キーを寄せる・不正は null", () => {
  const mp = S.migratePreset({ name: "v0", criteria: { per: { min: 10 }, bogus: { min: 1 } }, markets: ["JP", "US"] });
  assert.equal(mp.v, 1);
  assert.deepEqual(mp.markets, []);          // 両市場→正規化[]
  assert.ok(mp.criteria.per && !mp.criteria.bogus);
  assert.equal(S.migratePreset(null), null);
});
test("loadPresets/savePresets: round-trip・破損→[]", () => {
  const mem = {}; global.localStorage = { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
  assert.equal(S.savePresets([{ name: "x", criteria: { roe: { min: 8, max: null } }, markets: [], v: 1 }]), true);
  assert.equal(S.loadPresets().length, 1);
  mem["sip_screener_presets"] = "{bad json";
  assert.deepEqual(S.loadPresets(), []);
  delete global.localStorage;
});

test("回帰(Fix1): migratePreset は非配列 markets(文字列 'JP') でも例外を投げず markets:[] に正規化する", () => {
  let mp;
  assert.doesNotThrow(() => { mp = S.migratePreset({ name: "x", criteria: {}, markets: "JP" }); });
  assert.ok(mp);
  assert.deepEqual(mp.markets, []);
  assert.equal(S.validatePreset(mp), true);
});
test("回帰(Fix1): loadPresets は1件が非配列markets(破損)でも例外で全滅([])せず、正常プリセットを保持する", () => {
  try {
    const mem = {};
    global.localStorage = { getItem: (k) => mem[k] || null, setItem: (k, v) => { mem[k] = v; } };
    mem["sip_screener_presets"] = JSON.stringify([
      { name: "broken", criteria: {}, markets: "JP", v: 1 },
      { name: "ok", criteria: { roe: { min: 8, max: null } }, markets: [], v: 1 },
    ]);
    const loaded = S.loadPresets();
    // 修正前は migratePreset 内の forEach が非配列 markets で TypeError→catch→[] だった（ok も含め全滅）。
    // 修正後は非配列 markets が [](無制約) に正規化され例外を投げないため、両方とも有効なプリセットとして残る。
    assert.notDeepEqual(loaded, []);
    assert.ok(loaded.some((p) => p.name === "ok"));
  } finally {
    delete global.localStorage;
  }
});
test("回帰(Fix2): validatePreset は Object.prototype 由来キー(constructor)を軸として受理しない", () => {
  assert.equal(S.validatePreset({ name: "x", criteria: { constructor: { min: 1, max: 2 } }, markets: [] }), false);
});
test("回帰(Fix2): migratePreset は Object.prototype 由来キー(constructor)を軸として引き継がない", () => {
  const mp = S.migratePreset({ name: "x", criteria: { constructor: { min: 1, max: 2 } }, markets: [] });
  assert.ok(mp);
  assert.ok(!Object.prototype.hasOwnProperty.call(mp.criteria, "constructor"));
});
test("回帰(Fix3): validatePreset は min/max が数値以外(boolean/array/string)なら false", () => {
  assert.equal(S.validatePreset({ name: "x", criteria: { per: { min: true, max: null } }, markets: [] }), false);
  assert.equal(S.validatePreset({ name: "x", criteria: { per: { min: [5], max: null } }, markets: [] }), false);
  assert.equal(S.validatePreset({ name: "x", criteria: { per: { min: "5", max: null } }, markets: [] }), false);
});
