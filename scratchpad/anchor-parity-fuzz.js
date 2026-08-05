// scratchpad/anchor-parity-fuzz.js — Task A4 JS↔Py modeAFacts/mode_a_facts パリティ fuzz（anchor モード特化）。
//
// scratchpad/b2-parity-fuzz.js（Task7/Task10 の型・手本）をベースに、state.anchor（アンカー）を adversarial
// 込みでランダム生成し、cashflow rows / investment rows（invest_cash_flow 折り込み・NISA台帳フィールド）と
// 組み合わせて JS money-rules.js modeAFacts と Python advice.mode_a_facts のトップレベル出力
// （production/personal 両モード）が JSON 正規化後に一致することを検証する。0 mismatch が完了条件。
//
// b2-parity-fuzz.js との違い（Task A4 の焦点）:
//   1. genAnchor(): 有効な月初アンカー（境界日付含む）・.5 半端額（r() half-up 境界）・
//      calendar非妥当だが正規表現は通る月（"2026-13"/"2026-00"）・スラッシュ/非文字列/配列等の drop 系・
//      巨大/負/NaN 額 を混在生成。state.anchor に 70% の確率で乗せる（残り30%は無し=manual 経路も維持）。
//   2. genInvestmentRows(): 既存 genLedgerRows の NISA台帳フィールドに加え、invest_cash_flow/
//      principal_core_delta/principal_sat_delta/realized_gain/is_complete も adversarial 込みで生成
//      （cashDerived の icf 折り込み＝anchor 実効値への現金フロー合算を直接突く）。
//   3. cashflow rows の period を anchor 月の前後（before/at/after）にまたがせるための期間バリエーションを拡張。
//
// 実装コード（money-rules.js/advice.py）は変更しない＝検証専用ハーネス。mismatch を見つけたらここでは修正せず
// scratchpad/anchor-parity-fuzz-mismatches.json に詳細を書き出す。
//
// 使い方: node scratchpad/anchor-parity-fuzz.js [N] [seed]
//   N    : ケース数（既定600・production/personal 両モードで検証＝総比較件数は2N）
//   seed : PRNG シード（既定4242・再現性のため固定）
//
// 前提: .venv/bin/python に依存（Python 側 advice.mode_a_facts 呼び出し・PYTHONPATH=api/me を自動設定）。
// このリポは投資ポートフォリオ本体の worktree（.venv 無し）ゆえ /home/shugo/apps/investment-portal/.venv を使う。

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MAIN_REPO_ROOT = "/home/shugo/apps/investment-portal"; // .venv はメインリポ側（worktree に無い場合のフォールバック）
const R = require(path.join(ROOT, "money-rules.js"));

const N = parseInt(process.argv[2] || "600", 10);
const SEED = parseInt(process.argv[3] || "4242", 10);

// mulberry32 — 決定論的 PRNG（固定シード既定＝再現性）。
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
function randInt(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function maybe(p) { return rng() < p; }

// ---- birthYear 生成（b2-parity-fuzz.js と同型）----
function genBirthYear() {
  const cat = pick([
    "unset", "validRange", "outOfRange", "negative", "huge", "float",
    "stringNumeric", "stringNonNumeric", "stringNaN",
    "singleArrayValid", "singleArrayInvalid", "singleArrayHuge",
    "multiArray", "emptyArray", "null", "bool", "object",
  ]);
  switch (cat) {
    case "unset": return 0;
    case "validRange": return randInt(1900, 2026);
    case "outOfRange": return pick([randInt(1, 1899), randInt(10000, 99999)]);
    case "negative": return -randInt(1, 5000);
    case "huge": return pick([1e15, 9999999999, 1e300, 253402300800000]);
    case "float": return randInt(1900, 2026) + rng();
    case "stringNumeric": return String(randInt(1900, 2026));
    case "stringNonNumeric": return pick(["abc", "twenty", "", "1990abc"]);
    case "stringNaN": return "NaN";
    case "singleArrayValid": return [randInt(1900, 2026)];
    case "singleArrayInvalid": return [randInt(1, 50)];
    case "singleArrayHuge": return [1e15];
    case "multiArray": return [randInt(1900, 2026), randInt(1900, 2026)];
    case "emptyArray": return [];
    case "null": return null;
    case "bool": return pick([true, false]);
    case "object": return { a: 1 };
    default: return 0;
  }
}

// ---- nowMs 生成（b2-parity-fuzz.js と同型）----
const NOW = 1784073600000; // 2026-07-15 UTC 固定基準（再現性）
function genNowMs() {
  const cat = pick([
    "normal", "yearBoundaryUTC", "zero", "negative", "huge", "fractional",
    "stringNumeric", "stringNonNumeric",
    "singleArray", "singleArrayZero", "multiArray", "emptyArray",
    "null", "bool", "object",
  ]);
  switch (cat) {
    case "normal": return NOW + randInt(-3650, 3650) * 86400000;
    case "yearBoundaryUTC": {
      const y = randInt(1950, 2100);
      return pick([Date.UTC(y, 11, 31, 23, 59, 59, 999), Date.UTC(y, 0, 1, 0, 0, 0, 0)]);
    }
    case "zero": return 0;
    case "negative": return -randInt(1, 5000) * 86400000;
    case "huge": return pick([Date.UTC(2100, 0, 1), Date.UTC(2099, 11, 31), NOW + 3650 * 86400000, 253402300800000, 300000000000000]);
    case "fractional": return NOW + rng() * 1000;
    case "stringNumeric": return String(NOW - randInt(0, 1000) * 86400000);
    case "stringNonNumeric": return pick(["not-a-date", "", "abc"]);
    case "singleArray": return [NOW - randInt(0, 18250) * 86400000];
    case "singleArrayZero": return [0];
    case "multiArray": return [NOW, NOW + 1];
    case "emptyArray": return [];
    case "null": return null;
    case "bool": return pick([true, false]);
    case "object": return {};
    default: return NOW;
  }
}

// ---- assetHoldings スカラー値の adversarial 生成（b2-parity-fuzz.js と同型）----
function genScalarAdversarial() {
  const cat = pick([
    "posNum", "negNum", "hugeNum", "floatNum", "stringNumeric", "stringNonNumeric",
    "singleArray", "multiArray", "emptyArray", "nestedObject", "null", "bool",
    "stringHex", "stringOctBin", "stringUnderscore", "stringUnicodeDigit", "stringPadded", "stringSpecial", "nestedArray",
  ]);
  switch (cat) {
    case "posNum": return randInt(0, 5000000);
    case "negNum": return -randInt(1, 5000000);
    case "hugeNum": return pick([1000000, 50000000, 1000000000, 1e300, 1e308]);
    case "floatNum": return rng() * 1000000;
    case "stringNumeric": return String(randInt(0, 1000000));
    case "stringNonNumeric": return pick(["abc", "", "12abc", "  ", "1.2.3"]);
    case "singleArray": return [randInt(0, 100000)];
    case "multiArray": return [1, 2, 3];
    case "emptyArray": return [];
    case "nestedObject": return { nested: true };
    case "null": return null;
    case "bool": return pick([true, false]);
    case "stringHex": return pick(["0x10", "0X1F", "0xFF"]);
    case "stringOctBin": return pick(["0o17", "0b101"]);
    case "stringUnderscore": return pick(["1_000", "1_0", "1_000.5"]);
    case "stringUnicodeDigit": return pick(["１２３", "٥", "５００"]);
    case "stringPadded": return pick([" 5 ", " 100", "42 "]);
    case "stringSpecial": return pick(["Infinity", "inf", "1e999", "-0", "+5", "007", ".5", "5.", "1e3", "-5"]);
    case "nestedArray": return pick([[[5]], [["5"]], [[[42]]]]);
    default: return 0;
  }
}

// ---- Task A4: アンカー生成（正常/半端額/calendar非妥当だが format 妥当/drop 系を混在）----
// r()half-up境界(.5)・calendar非妥当month(13/00・regexは通る)・非string date(drop)・巨大/負/NaN amount を含む。
function genAnchorDate() {
  const cat = pick([
    "validMonthStart", "validMonthMid", "validMonthOnly", "yearBoundary",
    "invalidCalendarMonth", "invalidCalendarMonth00", "invalidDay30on29",
    "slashFormat", "singleDigitNoLeadingZero", "empty", "nonDateString",
    "nonString", "arrayWrap", "objectWrap",
  ]);
  const y = randInt(2023, 2029);
  const mo = String(randInt(1, 12)).padStart(2, "0");
  switch (cat) {
    case "validMonthStart": return `${y}-${mo}-01`;
    case "validMonthMid": return `${y}-${mo}-${String(randInt(2, 28)).padStart(2, "0")}`; // 月中日→月初へ丸めの経路
    case "validMonthOnly": return `${y}-${mo}`; // YYYY-MM も受理
    case "yearBoundary": return pick([`${y}-12-31`, `${y}-01-01`]);
    case "invalidCalendarMonth": return `${y}-13`;   // regex は \d{2} のみ検証＝calendar非妥当でも通る
    case "invalidCalendarMonth00": return `${y}-00-01`;
    case "invalidDay30on29": return `${y}-02-30`;    // 日は無視されるため実質 no-op（"-01" に丸め）
    case "slashFormat": return `${y}/${mo}/01`;      // drop（正規表現不一致）
    case "singleDigitNoLeadingZero": return `${y}-${randInt(1, 9)}-1`; // drop
    case "empty": return "";
    case "nonDateString": return pick(["abc", "not-a-date", "2026-02-30T00:00:00Z"]);
    case "nonString": return pick([20260701, true, false, null, undefined]);
    case "arrayWrap": return [`${y}-${mo}-01`];      // drop（typeof!=="string"）
    case "objectWrap": return { y };                 // drop
    default: return "";
  }
}
function genAnchorAmount() {
  const cat = pick([
    "roundYen", "halfUpBoundary", "halfUpBoundaryNeg999", "zero", "negative",
    "huge", "stringNumeric", "stringNaN", "stringHex", "arrayWrap", "boolWrap", "nullWrap",
  ]);
  switch (cat) {
    case "roundYen": return randInt(0, 5000000);
    case "halfUpBoundary": return randInt(0, 999) * 1000 + 0.5;      // X.5 円境界（r() half-up を直撃）
    case "halfUpBoundaryNeg999": return 599999.5;                     // brief 既定の境界値も混在
    case "zero": return 0;
    case "negative": return -randInt(1, 3000000);                     // num() gate で0へ
    case "huge": return pick([1e15, 1e300, 9999999999]);
    case "stringNumeric": return String(randInt(0, 2000000));
    case "stringNaN": return "NaN";
    case "stringHex": return pick(["0x10", "0xFF"]);
    case "arrayWrap": return [randInt(0, 100000)];
    case "boolWrap": return pick([true, false]);
    case "nullWrap": return null;
    default: return 0;
  }
}
function genAnchor() {
  return { date: genAnchorDate(), amount: genAnchorAmount() };
}

// ---- assetHoldings 全体構造の生成（b2-parity-fuzz.js と同型）----
const ASSET_CLASSES = R.ASSET_CLASSES;
const BUCKETS = ["buffer", "core", "satellite"];
function genAssetHoldings() {
  const shapeCat = pick(["normal", "normal", "normal", "null", "array", "string", "number", "missingBucket"]);
  if (shapeCat === "null") return null;
  if (shapeCat === "array") return [1, 2, 3];
  if (shapeCat === "string") return "not-an-object";
  if (shapeCat === "number") return 12345;
  const out = {};
  for (const bk of BUCKETS) {
    if (shapeCat === "missingBucket" && rng() < 0.3) continue;
    const inner = {};
    for (const c of ASSET_CLASSES) {
      if (rng() < 0.75) inner[c] = genScalarAdversarial();
    }
    if (rng() < 0.3) inner["XXX_unknown"] = genScalarAdversarial();
    out[bk] = inner;
  }
  if (rng() < 0.15) out["ZZZ_unknown_bucket"] = { cash: 999 };
  return out;
}

// ---- Task A4: state 生成（b2-parity-fuzz.js の genState + anchor 追加）----
const VALID_DEADLINES = ["2030-01-01", "2028-06-15", "2035-12-31"];
function genState() {
  const s = { birthYear: genBirthYear(), assetHoldings: genAssetHoldings() };
  if (maybe(0.85)) s.monthlyExpense = genScalarAdversarial();
  if (maybe(0.85)) s.bufferMonths = genScalarAdversarial();
  if (maybe(0.85)) s.satelliteCapPct = genScalarAdversarial();
  if (maybe(0.7)) s.updatedAt = genScalarAdversarial();
  if (maybe(0.85)) {
    s.buckets = {};
    for (const bk of BUCKETS) if (maybe(0.85)) s.buckets[bk] = { amount: genScalarAdversarial() };
  }
  if (maybe(0.55)) {
    const g = { targetAmount: genScalarAdversarial() };
    if (maybe(0.6)) g.label = "goal-" + randInt(0, 9);
    if (maybe(0.6)) g.deadline = pick(VALID_DEADLINES);
    s.goals = [g];
  }
  if (maybe(0.55)) {
    const rv = { target: genScalarAdversarial(), saved: genScalarAdversarial(), monthlyOverride: genScalarAdversarial() };
    if (maybe(0.6)) rv.deadline = pick(VALID_DEADLINES);
    s.reserves = [rv];
  }
  if (maybe(0.3)) s.currency = pick(["JPY", "USD", 123, "EUR"]);
  if (maybe(0.7)) {
    const ni = {};
    if (maybe(0.8)) ni.anchorYear = genScalarAdversarial();
    if (maybe(0.85)) ni.tsumitateThisYear = genScalarAdversarial();
    if (maybe(0.85)) ni.growthThisYear = genScalarAdversarial();
    if (maybe(0.8)) ni.tsumitateLifetime = genScalarAdversarial();
    if (maybe(0.8)) ni.growthLifetime = genScalarAdversarial();
    if (maybe(0.6)) ni.soldThisYearAtCost = genScalarAdversarial();
    if (maybe(0.4)) ni.source = pick(["manual", "history", "ledger", "bogus", 123]);
    if (maybe(0.6)) {
      if (maybe(0.15)) {
        ni.history = pick(["nope", 123, null, {}]);
      } else {
        const rows = [];
        const nRows = Math.floor(rng() * 55);
        for (let k = 0; k < nRows; k++) {
          const row = {};
          if (maybe(0.9)) row.year = pick([2024, 2025, 2026, 2027, 2023, 0, 10000, "2024", "２０２４", [2024]]);
          if (maybe(0.9)) row.tsumitate = genScalarAdversarial();
          if (maybe(0.9)) row.growth = genScalarAdversarial();
          if (maybe(0.7)) row.soldTsumitate = genScalarAdversarial();
          if (maybe(0.7)) row.soldGrowth = genScalarAdversarial();
          if (maybe(0.1)) row.bogus = "x";
          rows.push(maybe(0.08) ? pick([null, [1], 5, "x"]) : row);
        }
        ni.history = rows;
      }
    }
    s.nisa = ni;
  }
  // Task A4: 70% でアンカーを乗せる（残り30%は無し=manual経路も維持・cashSource両分岐をカバー）。
  if (maybe(0.7)) s.anchor = genAnchor();
  return s;
}

// ---- cashflow 行生成（b2-parity-fuzz.js の genCashflowRows を拡張: period レンジをアンカー年またぎに）----
const CF_MONTHS = [
  "2029-12-01", "2028-06-01", "2027-01-01",
  "2026-06-01", "2026-05-01", "2026-04-01", "2026-03-01", "2026-02-01", "2026-01-01",
  "2024-11-01", "2023-07-01",
];
function genPulledAt() {
  return pick([
    "", "2026-06-20T00:00:00Z", "2026-06-20T12:34:56", "2026-06-20 12:34:56",
    "2026-06-20T12:00:00+09:00", "2026-06-20", "2026-06-20T12:00:00.500Z",
    "2026/06/20", "Jan 1 2026", "2026-13-01", "2026-02-30", "2026-06-20T25:00:00Z",
    "not-a-date", 12345, null,
    "2026-06-20T24:00:00", "2026-06-20T24:00:00Z",
    "0050-06-15", "0000-01-01", "0001-12-31",
    "2026-06-20T12:34:56.999999", "2026-06-20T12:34:56.123456",
    "2026-06-20T12:00:00+0900",
  ]);
}
function genCashflowRows() {
  if (maybe(0.3)) return undefined; // 未連携（Slice3 経路＝cashflow なし・A4: anchor no-rows degrade もこの分岐で自然にカバー）
  if (maybe(0.15)) return [];       // 空配列（anchor-no-rows-degrade と同型の明示 no-op 経路）
  const n = randInt(1, 5);
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      period: pick(CF_MONTHS),
      total_income: genScalarAdversarial(),
      salary_income: genScalarAdversarial(),
      misc_income: genScalarAdversarial(),
      fixed_expense: genScalarAdversarial(),
      variable_expense: genScalarAdversarial(),
      total_expense: genScalarAdversarial(),
      balance: genScalarAdversarial(),
      is_complete: pick([true, false]),
      pulled_at: genPulledAt(),
    });
  }
  return rows;
}

// ---- Task A4: 投資台帳行の生成（B#3 nisa_* フィールド + invest_cash_flow 系フィールドを同居させる）----
// cashDerived の icf 折り込み（anchor 実効値への現金フロー合算）と nisaLedgerFold の両方を同一行群で突く。
function genInvestmentRows() {
  const n = Math.floor(rng() * 6); // 0〜5行（0行＝configured:false 経路も踏む）
  const rows = [];
  for (let i = 0; i < n; i++) {
    const bad = rng() < 0.25;
    const row = { period: bad && rng() < 0.5 ? "xxxx-01-01" : pick(CF_MONTHS) };
    // B#3 NISA台帳フィールド（既存 b2-parity-fuzz.js genLedgerRows と同型）
    row.nisa_tsumitate_delta = bad ? [5] : Math.floor(rng() * 1500000);
    row.nisa_growth_delta = bad ? NaN : Math.floor(rng() * 2500000);
    row.nisa_tsumitate_sold_at_cost = bad ? "abc" : Math.floor(rng() * 400000);
    row.nisa_growth_sold_at_cost = bad ? -100 : Math.floor(rng() * 400000);
    // Task A4: cashDerived icf 折り込み対象フィールド（負値を高頻度に混ぜ investCashFlow の減算経路を突く）。
    if (maybe(0.85)) row.invest_cash_flow = pick([genScalarAdversarial(), -randInt(0, 2000000), randInt(0, 2000000)]);
    if (maybe(0.6)) row.principal_core_delta = genScalarAdversarial();
    if (maybe(0.6)) row.principal_sat_delta = genScalarAdversarial();
    if (maybe(0.5)) row.realized_gain = genScalarAdversarial();
    if (maybe(0.8)) row.is_complete = pick([true, false]);
    if (maybe(0.3)) row.pulled_at = genPulledAt();
    rows.push(row);
  }
  return rows;
}

// ---- ケース生成 ----
const cases = [];
for (let i = 0; i < N; i++) {
  cases.push({
    name: "anchor-fuzz-" + i,
    state: genState(),
    nowMs: genNowMs(),
    cashflow: genCashflowRows(),
    investment: genInvestmentRows(),
  });
}

// ---- JSON 正規化（キー順ソート・-0→0・非有限 sentinel 化）----
function canon(o) {
  if (o === null || typeof o !== "object") {
    if (typeof o === "number") {
      if (Object.is(o, -0)) return 0;
      if (!isFinite(o)) return "__nonfinite__:" + (Number.isNaN(o) ? "NaN" : (o > 0 ? "Infinity" : "-Infinity"));
    }
    return o;
  }
  if (Array.isArray(o)) return o.map(canon);
  const keys = Object.keys(o).sort();
  const out = {};
  for (const k of keys) out[k] = canon(o[k]);
  return out;
}

// ---- JS 側出力（production + personal 両モード）----
const jsResults = cases.map((c) => {
  const prod = R.modeAFacts(c.state, { includeRawAmounts: false, nowMs: c.nowMs, cashflow: c.cashflow, investmentRows: c.investment });
  const pers = R.modeAFacts(c.state, { includeRawAmounts: true, nowMs: c.nowMs, cashflow: c.cashflow, investmentRows: c.investment });
  return { name: c.name, state: c.state, nowMs: c.nowMs, cashflow: c.cashflow, investment: c.investment, prod: canon(prod), pers: canon(pers) };
});

const ioPath = path.join(__dirname, "anchor-parity-fuzz-io.json");
fs.writeFileSync(ioPath, JSON.stringify({ cases: jsResults.map((r) => ({ name: r.name, state: r.state, nowMs: r.nowMs, cashflow: r.cashflow, investment: r.investment })) }), "utf8");

// ---- Python 側実行（PYTHONPATH=api/me で advice.mode_a_facts を呼ぶ）。既存 b2-parity-fuzz-run.py を再利用。----
const pyScript = path.join(ROOT, "scratchpad", "b2-parity-fuzz-run.py");
const outPath = path.join(__dirname, "anchor-parity-fuzz-py-out.json");
const venvCandidates = [path.join(ROOT, ".venv", "bin", "python"), path.join(MAIN_REPO_ROOT, ".venv", "bin", "python")];
const venvPy = venvCandidates.find((p) => fs.existsSync(p));
if (!venvPy) throw new Error("venv python not found: " + venvCandidates.join(", "));
execFileSync(venvPy, [pyScript, ioPath, outPath], {
  cwd: ROOT,
  env: Object.assign({}, process.env, { PYTHONPATH: path.join(ROOT, "api", "me") }),
  stdio: "inherit",
});

const pyResults = JSON.parse(fs.readFileSync(outPath, "utf8")).cases;
const pyByName = {};
for (const r of pyResults) pyByName[r.name] = r;

// ---- 比較（Python 側は JSON.parse を経由済＝int/float 表記差は自然に吸収される）----
const mismatches = [];
let compared = 0;
for (const jr of jsResults) {
  const pr = pyByName[jr.name];
  compared += 2;
  const prodStr = JSON.stringify(jr.prod);
  const pyProdStr = JSON.stringify(canon(pr ? pr.prod : undefined));
  if (prodStr !== pyProdStr) {
    mismatches.push({ name: jr.name, mode: "production", state: jr.state, nowMs: jr.nowMs, cashflow: jr.cashflow, investment: jr.investment, js: jr.prod, py: pr ? pr.prod : null });
  }
  const persStr = JSON.stringify(jr.pers);
  const pyPersStr = JSON.stringify(canon(pr ? pr.pers : undefined));
  if (persStr !== pyPersStr) {
    mismatches.push({ name: jr.name, mode: "personal", state: jr.state, nowMs: jr.nowMs, cashflow: jr.cashflow, investment: jr.investment, js: jr.pers, py: pr ? pr.pers : null });
  }
}

const anchoredCount = cases.filter((c) => c.state.anchor).length;
console.log("cases:", N, "seed:", SEED, "withAnchor:", anchoredCount, "compared:", compared, "mismatches:", mismatches.length);
if (mismatches.length) {
  fs.writeFileSync(path.join(__dirname, "anchor-parity-fuzz-mismatches.json"), JSON.stringify(mismatches, null, 2), "utf8");
  console.log("mismatch samples written to scratchpad/anchor-parity-fuzz-mismatches.json (showing up to 3):");
  console.log(JSON.stringify(mismatches.slice(0, 3), null, 2));
}
process.exit(mismatches.length === 0 ? 0 : 1);
