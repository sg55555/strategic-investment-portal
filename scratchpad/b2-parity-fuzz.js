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
    case "negative": return -randInt(1, 1e15);
    case "huge": return pick([1e300, 253402300800000, 9999999999999999, -1e300]);
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
  ]);
  switch (cat) {
    case "posNum": return randInt(0, 5000000);
    case "negNum": return -randInt(1, 5000000);
    case "hugeNum": return pick([1e15, 1e300]);
    case "floatNum": return rng() * 1000000;
    case "stringNumeric": return String(randInt(0, 1000000));
    case "stringNonNumeric": return pick(["abc", "", "12abc"]);
    case "singleArray": return [randInt(0, 100000)]; // brief: [5] 等の単一要素配列 coercion
    case "multiArray": return [1, 2, 3];
    case "emptyArray": return [];
    case "nestedObject": return { nested: true };
    case "null": return null;
    case "bool": return pick([true, false]);
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

// ---- ケース生成 ----
const cases = [];
for (let i = 0; i < N; i++) {
  cases.push({
    name: "fuzz-" + i,
    state: { birthYear: genBirthYear(), assetHoldings: genAssetHoldings() },
    nowMs: genNowMs(),
  });
}

// ---- JSON 正規化（キー順ソート・-0→0）----
function canon(o) {
  if (o === null || typeof o !== "object") {
    if (typeof o === "number" && Object.is(o, -0)) return 0;
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
  const prod = R.modeAFacts(c.state, { includeRawAmounts: false, nowMs: c.nowMs });
  const pers = R.modeAFacts(c.state, { includeRawAmounts: true, nowMs: c.nowMs });
  return { name: c.name, state: c.state, nowMs: c.nowMs, prod: canon(prod), pers: canon(pers) };
});

const ioPath = path.join(__dirname, "b2-parity-fuzz-io.json");
fs.writeFileSync(ioPath, JSON.stringify({ cases: jsResults.map((r) => ({ name: r.name, state: r.state, nowMs: r.nowMs })) }), "utf8");

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
    mismatches.push({ name: jr.name, mode: "production", state: jr.state, nowMs: jr.nowMs, js: jr.prod, py: pr ? pr.prod : null });
  }
  const persStr = JSON.stringify(jr.pers);
  const pyPersStr = JSON.stringify(canon(pr ? pr.pers : undefined));
  if (persStr !== pyPersStr) {
    mismatches.push({ name: jr.name, mode: "personal", state: jr.state, nowMs: jr.nowMs, js: jr.pers, py: pr ? pr.pers : null });
  }
}

console.log("cases:", N, "seed:", SEED, "compared:", compared, "mismatches:", mismatches.length);
if (mismatches.length) {
  fs.writeFileSync(path.join(__dirname, "b2-parity-fuzz-mismatches.json"), JSON.stringify(mismatches, null, 2), "utf8");
  console.log("mismatch samples written to scratchpad/b2-parity-fuzz-mismatches.json (showing up to 3):");
  console.log(JSON.stringify(mismatches.slice(0, 3), null, 2));
}
process.exit(mismatches.length === 0 ? 0 : 1);
