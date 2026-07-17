// scratchpad/b2-parity-fuzz.js — Task7 JS↔Py modeAFacts/mode_a_facts パリティ fuzz。
//
// birthYear/assetHoldings/nowMs をランダム生成（巨大/負 nowMs・単一要素配列 coercion・birthYear 未設定 を含む）し、
// JS money-rules.js modeAFacts と Python advice.mode_a_facts のトップレベル出力（production/personal 両モード）が
// JSON 正規化後に一致することを検証する。0 mismatch が完了条件。
//
// 実装コード（money-rules.js/advice.py）は変更しない＝検証専用ハーネス。mismatch を見つけたらここでは修正せず
// scratchpad/b2-parity-fuzz-mismatches.json に詳細を書き出し、呼び出し側が BLOCKED 判断する。
//
// 使い方: node scratchpad/b2-parity-fuzz.js [N] [seed]
//   N    : ケース数（既定400・production/personal 両モードで検証＝総比較件数は2N）
//   seed : PRNG シード（既定42・再現性のため固定）
//
// 前提: .venv/bin/python に依存（Python 側 advice.mode_a_facts 呼び出し・PYTHONPATH=api/me を自動設定）。

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const R = require(path.join(ROOT, "money-rules.js"));

const N = parseInt(process.argv[2] || "400", 10);
const SEED = parseInt(process.argv[3] || "42", 10);

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

// ---- birthYear 生成（brief: 未設定/巨大/単一要素配列 coercion を含む）----
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

// ---- nowMs 生成（brief: 巨大/負 nowMs・単一要素配列 coercion を含む）----
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
    case "negative": return -randInt(1, 5000) * 86400000; // 1970 直前まで（JS Date/Py datetime 両対応）。極端負値は Date 境界 pre-existing 非対称[別チケット]ゆえ除外
    case "huge": return pick([Date.UTC(2100, 0, 1), Date.UTC(2099, 11, 31), NOW + 3650 * 86400000, 253402300800000, 300000000000000]); // 253402300800000=year10000(>9999) を含む＝Date/datetime 境界 #3 を対称化済（reserveMonthly cy>9999→両側0・glidePath/current_year は既存 guard）
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

// ---- assetHoldings スカラー値の adversarial 生成 ----
function genScalarAdversarial() {
  const cat = pick([
    "posNum", "negNum", "hugeNum", "floatNum", "stringNumeric", "stringNonNumeric",
    "singleArray", "multiArray", "emptyArray", "nestedObject", "null", "bool",
    // ↓ scalar-coerce パリティ堅牢化（2026-07-15）で追加＝JS Number()/+v ↔ Py float() の文法差を突く
    "stringHex", "stringOctBin", "stringUnderscore", "stringUnicodeDigit", "stringPadded", "stringSpecial", "nestedArray",
  ]);
  switch (cat) {
    case "posNum": return randInt(0, 5000000);
    case "negNum": return -randInt(1, 5000000);
    case "hugeNum": return pick([1000000, 50000000, 1000000000, 1e300, 1e308]); // 1e300/1e308＝monthlyExpense×bufferMonths の積 float64 溢れ→Infinity を誘発＝int(math.ceil(inf)) 境界 #2 を対称化済（比率非有限→両側 null・500 回避）
    case "floatNum": return rng() * 1000000;
    case "stringNumeric": return String(randInt(0, 1000000));
    case "stringNonNumeric": return pick(["abc", "", "12abc", "  ", "1.2.3"]);
    case "singleArray": return [randInt(0, 100000)]; // brief: [5] 等の単一要素配列 coercion
    case "multiArray": return [1, 2, 3];
    case "emptyArray": return [];
    case "nestedObject": return { nested: true };
    case "null": return null;
    case "bool": return pick([true, false]);
    case "stringHex": return pick(["0x10", "0X1F", "0xFF"]);              // JS Number 受理・Py float 拒否
    case "stringOctBin": return pick(["0o17", "0b101"]);                 // 同上
    case "stringUnderscore": return pick(["1_000", "1_0", "1_000.5"]);   // Py float 受理・JS Number 拒否（逆方向）
    case "stringUnicodeDigit": return pick(["１２３", "٥", "５００"]);       // 全角/アラビア（Py float 受理・JS 拒否＝\d 不使用の要）
    case "stringPadded": return pick([" 5 ", " 100", "42 "]);            // LENIENT 前後 ASCII 空白
    case "stringSpecial": return pick(["Infinity", "inf", "1e999", "-0", "+5", "007", ".5", "5.", "1e3", "-5"]);
    case "nestedArray": return pick([[[5]], [["5"]], [[[42]]]]);         // 入れ子配列（JS toString unbox・Py TypeError）
    default: return 0;
  }
}

const ASSET_CLASSES = R.ASSET_CLASSES;
const BUCKETS = ["buffer", "core", "satellite"];

// ---- assetHoldings 全体構造の生成（バケツ欠落/未知キー/非オブジェクト全体も含む）----
function genAssetHoldings() {
  const shapeCat = pick(["normal", "normal", "normal", "null", "array", "string", "number", "missingBucket"]);
  if (shapeCat === "null") return null;
  if (shapeCat === "array") return [1, 2, 3];
  if (shapeCat === "string") return "not-an-object";
  if (shapeCat === "number") return 12345;
  const out = {};
  for (const bk of BUCKETS) {
    if (shapeCat === "missingBucket" && rng() < 0.3) continue; // バケツ丸ごと欠落
    const inner = {};
    for (const c of ASSET_CLASSES) {
      if (rng() < 0.75) inner[c] = genScalarAdversarial(); // 一部クラスは未入力のまま(欠落キー)
    }
    if (rng() < 0.3) inner["XXX_unknown"] = genScalarAdversarial(); // 未知キー注入
    out[bk] = inner;
  }
  if (rng() < 0.15) out["ZZZ_unknown_bucket"] = { cash: 999 }; // 未知バケツ注入
  return out;
}

// ---- 全 num フィールドを含む state 生成（scalar-coerce パリティ堅牢化 2026-07-15）----
// birthYear/assetHoldings に加え num()経路の monthlyExpense/bufferMonths/satelliteCapPct/buckets.*.amount/
// updatedAt/goals[].targetAmount/reserves[].{target,saved,monthlyOverride} を adversarial 値で変動させる。
const VALID_DEADLINES = ["2030-01-01", "2028-06-15", "2035-12-31"];
function maybe(p) { return rng() < p; }
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
    if (maybe(0.4)) ni.source = pick(["manual","history","ledger","bogus",123]);
    // Stage2: 年別履歴(非配列/要素異常/重複年/域外年/順序シャッフル/件数境界50を踏む)
    if (maybe(0.6)) {
      if (maybe(0.15)) {
        ni.history = pick(["nope", 123, null, {}]);          // 非配列 → []
      } else {
        const rows = [];
        const nRows = Math.floor(rng() * 55);                 // 0〜54(slice(0,50) 境界を跨ぐ)
        for (let k = 0; k < nRows; k++) {
          const row = {};
          if (maybe(0.9)) row.year = pick([2024, 2025, 2026, 2027, 2023, 0, 10000, "2024", "２０２４", [2024]]);
          if (maybe(0.9)) row.tsumitate = genScalarAdversarial();
          if (maybe(0.9)) row.growth = genScalarAdversarial();
          if (maybe(0.7)) row.soldTsumitate = genScalarAdversarial();
          if (maybe(0.7)) row.soldGrowth = genScalarAdversarial();
          if (maybe(0.1)) row.bogus = "x";                    // 未知キー破棄
          rows.push(maybe(0.08) ? pick([null, [1], 5, "x"]) : row);   // 要素 filter
        }
        ni.history = rows;                                    // 年の重複と順序ずれは pick の性質上まとめて発生
      }
    }
    s.nisa = ni;
  }
  return s;
}

// ---- cashflow 行生成（cfNum 経路＋timestamp parser #1 を通す）----
const CF_MONTHS = ["2026-06-01", "2026-05-01", "2026-04-01", "2026-03-01", "2026-02-01", "2026-01-01"];
// #1 pulled_at battery：strict 共有 ISO パーサ（parseIsoMs↔_parse_iso_ms）が tz無し/半角空白/オフセット/date-only/
// 小数秒 を同一 epoch、スラッシュ/月名/カレンダー無効/非文字列 を両側同一 reject にすることを end-to-end で誘発。
function genPulledAt() {
  return pick([
    "", "2026-06-20T00:00:00Z", "2026-06-20T12:34:56", "2026-06-20 12:34:56",
    "2026-06-20T12:00:00+09:00", "2026-06-20", "2026-06-20T12:00:00.500Z",
    "2026/06/20", "Jan 1 2026", "2026-13-01", "2026-02-30", "2026-06-20T25:00:00Z",
    "not-a-date", 12345, null,
    // wf-A/B/C/F の境界も誘発
    "2026-06-20T24:00:00", "2026-06-20T24:00:00Z",       // A: hour24 → 両側 reject
    "0050-06-15", "0000-01-01", "0001-12-31",            // B: 西暦<100/0 → 字面年/reject
    "2026-06-20T12:34:56.999999", "2026-06-20T12:34:56.123456", // C: µs → ms floor
    "2026-06-20T12:00:00+0900",                          // F: コロン無オフセット → reject
  ]);
}
function genCashflowRows() {
  if (maybe(0.4)) return undefined; // 未連携（Slice3 経路＝cashflow なし）
  const n = randInt(1, 4);
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      period: CF_MONTHS[i % CF_MONTHS.length],
      total_income: genScalarAdversarial(),
      salary_income: genScalarAdversarial(),
      misc_income: genScalarAdversarial(),
      fixed_expense: genScalarAdversarial(),
      variable_expense: genScalarAdversarial(),
      total_expense: genScalarAdversarial(),
      balance: genScalarAdversarial(),
      is_complete: pick([true, false]),
      pulled_at: genPulledAt(), // #1 strict 共有 ISO パーサで両側同一処理（tz無し/空白/スラッシュ/月名/カレンダー無効/非文字列）
    });
  }
  return rows;
}

// ---- ケース生成 ----
const cases = [];
for (let i = 0; i < N; i++) {
  cases.push({
    name: "fuzz-" + i,
    state: genState(),
    nowMs: genNowMs(),
    cashflow: genCashflowRows(),
  });
}

// ---- JSON 正規化（キー順ソート・-0→0）----
function canon(o) {
  if (o === null || typeof o !== "object") {
    if (typeof o === "number") {
      if (Object.is(o, -0)) return 0;
      if (!isFinite(o)) return "__nonfinite__:" + (Number.isNaN(o) ? "NaN" : (o > 0 ? "Infinity" : "-Infinity")); // JSON は Infinity/NaN 非対応＝両側 sentinel 化（真の発散は依然検出）
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
  const prod = R.modeAFacts(c.state, { includeRawAmounts: false, nowMs: c.nowMs, cashflow: c.cashflow });
  const pers = R.modeAFacts(c.state, { includeRawAmounts: true, nowMs: c.nowMs, cashflow: c.cashflow });
  return { name: c.name, state: c.state, nowMs: c.nowMs, cashflow: c.cashflow, prod: canon(prod), pers: canon(pers) };
});

const ioPath = path.join(__dirname, "b2-parity-fuzz-io.json");
fs.writeFileSync(ioPath, JSON.stringify({ cases: jsResults.map((r) => ({ name: r.name, state: r.state, nowMs: r.nowMs, cashflow: r.cashflow })) }), "utf8");

// ---- Python 側実行（PYTHONPATH=api/me で advice.mode_a_facts を呼ぶ）----
const pyScript = path.join(__dirname, "b2-parity-fuzz-run.py");
const outPath = path.join(__dirname, "b2-parity-fuzz-py-out.json");
const venvPy = path.join(ROOT, ".venv", "bin", "python");
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
    mismatches.push({ name: jr.name, mode: "production", state: jr.state, nowMs: jr.nowMs, cashflow: jr.cashflow, js: jr.prod, py: pr ? pr.prod : null });
  }
  const persStr = JSON.stringify(jr.pers);
  const pyPersStr = JSON.stringify(canon(pr ? pr.pers : undefined));
  if (persStr !== pyPersStr) {
    mismatches.push({ name: jr.name, mode: "personal", state: jr.state, nowMs: jr.nowMs, cashflow: jr.cashflow, js: jr.pers, py: pr ? pr.pers : null });
  }
}

console.log("cases:", N, "seed:", SEED, "compared:", compared, "mismatches:", mismatches.length);
if (mismatches.length) {
  fs.writeFileSync(path.join(__dirname, "b2-parity-fuzz-mismatches.json"), JSON.stringify(mismatches, null, 2), "utf8");
  console.log("mismatch samples written to scratchpad/b2-parity-fuzz-mismatches.json (showing up to 3):");
  console.log(JSON.stringify(mismatches.slice(0, 3), null, 2));
}
process.exit(mismatches.length === 0 ? 0 : 1);
