const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../finance-rules.js");

// 実データ近似（トヨタ 2025 / 百万円）。inline 複製していた式の単一源を固定する。
const TOYOTA = {
  current_assets: 30000000, non_current_assets: 60000000,
  current_liabilities: 25000000, non_current_liabilities: 20000000,
  net_assets: 45000000, net_sales: 48036704, gross_profit: 10568074,
  operating_income: 4795586, ordinary_income: 6000000,
  income_before_taxes: 6965000, net_income: 4765000,
  operating_cf: 4000000, investing_cf: -3000000, financing_cf: -1000000,
  cf_cash_start: 6524000, cf_cash_end: 6524000,
};

test("ratio は分母>0 のとき numer/denom*100、分母<=0 は 0", () => {
  assert.equal(F.ratio(50, 200), 25);
  assert.equal(F.ratio(50, 0), 0);
  assert.equal(F.ratio(50, -10), 0);
  assert.equal(F.ratio(-10, 100), -10); // 赤字（負の numer）は通す
});

test("totalAssets = 流動資産 + 固定資産（欠損は 0 扱い）", () => {
  assert.equal(F.totalAssets(TOYOTA), 90000000);
  assert.equal(F.totalAssets({ current_assets: 5 }), 5);
  assert.equal(F.totalAssets({}), 0);
  assert.equal(F.totalAssets(null), 0);
});

test("equityRatio = 純資産 / 総資産 * 100", () => {
  assert.equal(F.equityRatio(TOYOTA), 50); // 45,000,000 / 90,000,000
  assert.equal(F.equityRatio({ net_assets: 100 }), 0); // 総資産0 → 0
});

test("currentRatio = 流動資産 / 流動負債 * 100", () => {
  assert.equal(F.currentRatio(TOYOTA), 120); // 30,000,000 / 25,000,000
  assert.equal(F.currentRatio({ current_assets: 100, current_liabilities: 0 }), 0);
});

test("opMargin / netMargin / roe / roa は既存 inline と同値", () => {
  assert.equal(F.opMargin({ operating_income: 200, net_sales: 1000 }), 20);
  assert.equal(F.netMargin({ net_income: 100, net_sales: 1000 }), 10);
  assert.equal(F.roe({ net_income: 100, net_assets: 500 }), 20);
  assert.equal(F.roa({ net_income: 100, current_assets: 400, non_current_assets: 600 }), 10);
  // 分母 0 / 欠損 → 0（"--" 表示は呼び出し側の hasFinData が司る）
  assert.equal(F.roe({ net_income: 100, net_assets: 0 }), 0);
  assert.equal(F.opMargin({}), 0);
});

test("clampScore は 0..100 にクランプ", () => {
  assert.equal(F.clampScore(15, -5, 15), 100);
  assert.equal(F.clampScore(-5, -5, 15), 0);
  assert.equal(F.clampScore(5, -5, 15), 50);
  assert.equal(F.clampScore(999, 0, 50), 100);
  assert.equal(F.clampScore(5, 10, 10), 0); // 同値域はゼロ除算回避
});

test("hasValue: null/undefined は欠損(false)・0 は有効値(true)（捏造防止ゲート）", () => {
  assert.equal(F.hasValue({ gross_profit: 0 }, "gross_profit"), true);
  assert.equal(F.hasValue({ gross_profit: 123 }, "gross_profit"), true);
  assert.equal(F.hasValue({ gross_profit: null }, "gross_profit"), false);
  assert.equal(F.hasValue({}, "gross_profit"), false);
  assert.equal(F.hasValue(null, "gross_profit"), false);
});

test("fmtMagnitude: 百万単位→兆/十億/百万＋通貨（旧 fmtBillion 相当）", () => {
  assert.equal(F.fmtMagnitude(48036704, "JPY"), "48.04 兆円");
  assert.equal(F.fmtMagnitude(416161, "USD"), "416.2 十億ドル"); // $416B
  assert.equal(F.fmtMagnitude(500, "JPY"), "500 百万円");
  assert.equal(F.fmtMagnitude(0, "JPY"), "--");
  assert.equal(F.fmtMagnitude(null, "USD"), "--");
});

test("fmtAxis: 通貨・桁に応じ単位切替（C4: 旧『兆円』固定の誤単位是正）", () => {
  assert.equal(F.fmtAxis(48000000, "JPY"), "48.0兆円");
  assert.equal(F.fmtAxis(416161, "USD"), "416十億ドル"); // 兆ドルでなく十億ドル
  assert.equal(F.fmtAxis(300, "JPY"), "300百万円");
  assert.equal(F.fmtAxis(0, "JPY"), "0");   // 0点は単位なしで揃える
});

test("unitWord: USD→ドル / それ以外→円", () => {
  assert.equal(F.unitWord("USD"), "ドル");
  assert.equal(F.unitWord("JPY"), "円");
  assert.equal(F.unitWord(undefined), "円");
});

test("fmtUnit: 百万＋通貨語（6箇所の重複を集約・undefined は百万円）", () => {
  assert.equal(F.fmtUnit("USD"), "百万ドル");
  assert.equal(F.fmtUnit("JPY"), "百万円");
  assert.equal(F.fmtUnit(undefined), "百万円");
});

test("pickUnit: 会社規模で1単位を選定（JPY 兆/億/百万・USD 兆/十億/百万）", () => {
  // JPY: 1兆(=1e6百万)以上で兆円（小数1桁）
  assert.deepEqual(F.pickUnit(48036704, "JPY"), { div: 1000000, suffix: "兆円", dec: 1 });
  assert.deepEqual(F.pickUnit(1000000, "JPY"), { div: 1000000, suffix: "兆円", dec: 1 });
  // JPY: 100億(=1e4百万)以上の億は整数
  assert.deepEqual(F.pickUnit(520000, "JPY"), { div: 100, suffix: "億円", dec: 0 });
  // JPY: 1〜100億は小数1桁（0.数兆の見づらさ回避）
  assert.deepEqual(F.pickUnit(5000, "JPY"), { div: 100, suffix: "億円", dec: 1 });
  // JPY: 1億未満は百万円
  assert.deepEqual(F.pickUnit(50, "JPY"), { div: 1, suffix: "百万円", dec: 0 });
  // USD: 兆ドル / 十億ドル / 百万ドル（億は使わない）
  assert.deepEqual(F.pickUnit(416161, "USD"), { div: 1000, suffix: "十億ドル", dec: 1 });
  assert.deepEqual(F.pickUnit(1500000, "USD"), { div: 1000000, suffix: "兆ドル", dec: 1 });
  assert.deepEqual(F.pickUnit(500, "USD"), { div: 1, suffix: "百万ドル", dec: 0 });
});

test("fmtUnitValue: pickUnit の単位でページ統一整形（千区切り／0点は単位なし）", () => {
  var jpyT = F.pickUnit(48036704, "JPY");      // 兆円
  assert.equal(F.fmtUnitValue(48036704, jpyT), "48.0兆円");
  assert.equal(F.fmtUnitValue(6524000, jpyT), "6.5兆円");  // 同ページの小さめ値も同単位
  assert.equal(F.fmtUnitValue(0, jpyT), "0");
  var jpyOku = F.pickUnit(520000, "JPY");        // 億円(整数)
  assert.equal(F.fmtUnitValue(520000, jpyOku), "5,200億円");
  var jpyOku1 = F.pickUnit(5000, "JPY");         // 億円(小数1桁)
  assert.equal(F.fmtUnitValue(5000, jpyOku1), "50.0億円");
  var usdB = F.pickUnit(416161, "USD");          // 十億ドル
  assert.equal(F.fmtUnitValue(416161, usdB), "416.2十億ドル");
});

test("fmtUnitValue: 小さな値の適応精度（兆円ページでCFを0.0に潰さない・符号付き0回避）", () => {
  var jpyT = F.pickUnit(48036704, "JPY");  // 兆円(dec1)
  assert.equal(F.fmtUnitValue(15000, jpyT), "0.01兆円");   // 150億 → 桁を増やし有効数字（0.015→toFixed(2)）
  assert.equal(F.fmtUnitValue(-15000, jpyT), "-0.01兆円"); // 符号付き0でなく実値
  assert.equal(F.fmtUnitValue(300000, jpyT), "0.3兆円");   // 3000億 → そのまま
  assert.equal(F.fmtUnitValue(1, jpyT), "0");              // 100万 ≒ 実質0（兆円スケール）
  var jpyOku = F.pickUnit(520000, "JPY");  // 億円(dec0)
  assert.equal(F.fmtUnitValue(-40, jpyOku), "-0.4億円");   // 40百万 → 符号付き0でなく小数で
  assert.equal(F.fmtUnitValue(300, jpyOku), "3億円");
});

test("unitLabel: ヘッダ用の単位文字列", () => {
  assert.equal(F.unitLabel(F.pickUnit(48036704, "JPY")), "兆円");
  assert.equal(F.unitLabel(F.pickUnit(520000, "JPY")), "億円");
  assert.equal(F.unitLabel(null), "");
});
