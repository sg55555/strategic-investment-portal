// money-rules.js — お金の司令塔(MCC) 純関数ロジック。
// ブラウザ(window.MCCRules) と Node(require) の両対応(UMD-lite)。副作用なし。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MCCRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STORAGE_KEY = "mcc_state";
  var CURRENT_VERSION = 2; // v2: goals（資産目標）＋クラウド同期

  // Slice3: AI規律コーチ。正準 next ターゲット（Python テンプレ map と test 網羅の単一源）。
  var NEXT_TARGETS = ["setup", "buffer", "rebalance", "core"];
  var FACTS_SCHEMA_VERSION = 5; // v5: NISA枠（backlog B #3）nisa 集約を facts に追加
  // B#3 NISA枠（非課税枠）法定枠定数（2024新NISA・facts非出力＝公開既知値。年度改定時はここを更新）。
  var NISA_ANNUAL_TSUMITATE = 1200000;   // つみたて投資枠 年間上限
  var NISA_ANNUAL_GROWTH = 2400000;      // 成長投資枠 年間上限
  var NISA_ANNUAL_TOTAL = 3600000;       // 年間合計上限（= つみたて+成長）
  var NISA_LIFETIME = 18000000;          // 生涯非課税保有限度額（簿価）
  var NISA_GROWTH_LIFETIME_CAP = 12000000; // うち成長投資枠の生涯内数上限
  var NISA_SOURCES = ["manual", "history", "ledger"]; // 二軸source（Stage1=manual・Stage2/3で拡張）
  var NISA_MIN_YEAR = 2024;      // Stage2: 新NISA開始年＝履歴年の下限（facts非出力・年度改定時はここ）
  var NISA_HISTORY_MAX = 50;     // Stage2: 履歴件数上限（reserves 流儀・Python 側と同値必須）
  // 免責（node↔browser 単一源・全描画経路で決定論と不可分に常時表示）。
  var DISCLAIMER = "本コーチが示す決定論ルールおよび AI の補足はいずれも、資産規律の維持・教育・判断支援を目的とした一般的な情報提供であり、特定の金融商品の売買や投資配分・タイミングを推奨する投資助言ではありません。当ツールは金融商品取引業者・投資助言代理業者として登録された者による助言ではなく、特定の金融商品の勧誘を目的としたものでもありません。将来の利益や成果を保証するものではありません（過去の実績は将来を示しません）。最終的な投資判断はご自身の責任で行ってください。";
  var DISCLAIMER_VERSION = "disc-v1";

  // 用語集（node↔browser 単一源・DISCLAIMER 同型）。? ツールチップ／各セクション一行説明／用語集ブロックが参照。
  var GLOSSARY = [
    { term: "バッファ", read: "生活防衛資金（現金）", def: "急な出費や収入減に備える、すぐ使える現金。生活費の数ヶ月分を確保します。" },
    { term: "コア", read: "長期の積立投資", def: "資産の中心。インデックス投資などで長期にコツコツ積み立てる「守り」のお金です。" },
    { term: "サテライト", read: "個別株など攻めの投資", def: "値動きの大きい「攻め」の投資。投資元本に対する割合に上限を設け、入れすぎを防ぎます。" },
    { term: "確保枠", read: "目的別の取り置き", def: "新居・登記費用など、使う予定が決まったお金を投資より先に取り置く目的別の貯金です。" },
    { term: "投資余力", read: "毎月投資に回せる額", def: "毎月の収支から無理なく投資に回せる額。数ヶ月の平均でならした値です。" },
    { term: "経常余剰", read: "毎月コンスタントに残るお金", def: "賞与などの臨時収入を除いた、毎月安定して残るお金です。" },
    { term: "規律配分", read: "ルール順の自動振り分け", def: "バッファ→確保枠→コアの順に、決めたルールどおり自動で振り分けます。" },
    { term: "基準（アンカー）", read: "貯蓄額の起点", def: "ある月のはじめの貯蓄額。これに以降の収支を足して、今の貯蓄額を自動計算します。" },
    { term: "資産クラス", read: "お金の種類分け", def: "投資を現金・国内株・先進国株・新興国株・債券・REIT・金などの種類で分けたもの。年齢に応じた配分の「設計図」に使います。" },
    { term: "NISA枠", read: "非課税で投資できる枠", def: "NISA口座で買うと運用益が非課税になる投資の上限枠。当年枠(つみたて120万/成長240万)と生涯枠(1800万・簿価)があります。" },
    { term: "つみたて投資枠", read: "年120万の積立枠", def: "新NISAの積立専用枠。年間120万円まで、金融庁指定の投信を積み立てられます。" },
    { term: "成長投資枠", read: "年240万の成長枠", def: "新NISAの成長枠。年間240万円まで、上場株やETF・投信を購入できます(生涯内数1200万まで)。" },
    { term: "生涯投資枠", read: "生涯1800万の非課税枠", def: "NISAで非課税に保有できる生涯上限(簿価1800万円)。売却すると翌年に枠が復活します。" },
  ];

  // 共有 strict-decimal 文法（scalar-coerce パリティ堅牢化 2026-07-15）。ASCII クラス限定＝\d/\s 不使用
  // （Python Unicode-aware \d/\s は全角/アラビア数字・Unicode 空白を通し発散復活）。LENIENT 前後 ASCII 空白許容。
  var _DECIMAL_RE = /^[ \t\n\r\f\x0b]*[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?[ \t\n\r\f\x0b]*$/;
  function parseNum(v) {                            // → Number（NaN/±Infinity を返し得る・呼び元が gate）
    if (typeof v === "number") return v;            // -0, ±Infinity, NaN はそのまま通す
    if (typeof v === "string") return _DECIMAL_RE.test(v) ? Number(v) : NaN;
    return NaN;                                     // boolean, null, undefined, array, object → NaN
  }
  function num(v) { var n = parseNum(v); return (isFinite(n) && n >= 0) ? n + 0 : 0; } // 非負・n+0 で -0 正規化
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function r(x) { return Math.floor(num(x) + 0.5); } // half-up（全値非負前提・Python 還元器とパリティ）

  // B#2 資産クラス比率：7クラスallowlist（不変・タイブレーク基準）。単一定数を全Taskで参照。
  var ASSET_CLASSES = ["cash", "jpEq", "devEq", "emEq", "bond", "reit", "gold"];
  var ASSET_BUCKETS = ["buffer", "core", "satellite"];
  // （旧 numScalar は num へ集約＝num 自体が scalar-safe になり配列/オブジェクト/bool→0・非decimal 文字列→0・2026-07-15 パリティ堅牢化）
  // 3バケツ(buffer/core/satellite)×7クラスの完全骨格を常に返す（未知キー破棄・非オブジェクト入力→全0骨格）。
  function normalizeAssetHoldings(raw) {
    var src = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
    var out = {};
    for (var b = 0; b < ASSET_BUCKETS.length; b++) {
      var bk = ASSET_BUCKETS[b], inner = (src[bk] && typeof src[bk] === "object" && !Array.isArray(src[bk])) ? src[bk] : {};
      out[bk] = {};
      for (var c = 0; c < ASSET_CLASSES.length; c++) out[bk][ASSET_CLASSES[c]] = num(inner[ASSET_CLASSES[c]]);
    }
    return out;
  }
  // B#3 Stage2: 履歴1行の固定形状（年は normalizeBirthYear 型の範囲gate・金額は共有 num()・未知キー破棄）。
  function normalizeNisaYear(e) {
    var s = (e && typeof e === "object" && !Array.isArray(e)) ? e : {};
    var y = Math.floor(num(s.year));
    return {
      year: (y >= NISA_MIN_YEAR && y <= 9999) ? y : 0,
      tsumitate: num(s.tsumitate),
      growth: num(s.growth),
      soldTsumitate: num(s.soldTsumitate),
      soldGrowth: num(s.soldGrowth),
    };
  }
  // B#3 Stage2: 年別履歴の正規化。reserves 流儀（filter→slice→map）＋無効年除去→年で後勝ち畳み→年昇順。
  // 順序は Python _normalize_nisa_history と厳密一致させること（畳む前にソートすると後勝ちの意味が変わる）。
  function normalizeNisaHistory(raw) {
    var arr = Array.isArray(raw) ? raw : [];
    var rows = [], i;
    var kept = arr.filter(function (e) { return e && typeof e === "object" && !Array.isArray(e); })
      .slice(0, NISA_HISTORY_MAX);
    for (i = 0; i < kept.length; i++) {
      var row = normalizeNisaYear(kept[i]);
      if (row.year > 0) rows.push(row);
    }
    var byYear = {};
    for (i = 0; i < rows.length; i++) byYear[rows[i].year] = rows[i];   // 後勝ち（合算しない）
    var years = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
    return years.map(function (y) { return byYear[y]; });
  }
  // B#3: NISA使用状況の固定形状を常に返す（非オブジェクト入力→全0骨格・allowlist キーのみ・scalar-only coerce・未知キー破棄）。
  function normalizeNisa(raw) {
    var s = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
    return {
      source: NISA_SOURCES.indexOf(s.source) >= 0 ? s.source : "manual",
      anchorYear: num(s.anchorYear),
      tsumitateThisYear: num(s.tsumitateThisYear),
      growthThisYear: num(s.growthThisYear),
      tsumitateLifetime: num(s.tsumitateLifetime),
      growthLifetime: num(s.growthLifetime),
      soldThisYearAtCost: num(s.soldThisYearAtCost),
      history: normalizeNisaHistory(s.history),
    };
  }
  // migrate 専用 birthYear coerce（有限・整数・1900<=n<=9999 以外は 0＝spec §2.2）。
  // spec の "1900..currentYear" のうち currentYear は migrate 時に nowMs 無しで得られないため、
  // 未来年/2桁typo 等の意味的妥当性は Task2 glidePath の age gate（age<0||age>120）が担う。
  // 基底 coerce は num()（scalar-safe＝配列/オブジェクト/bool→0・非decimal 文字列→0＝"0x7CE" 等も拒否）。
  // Python _num() と byte 一致（Number([1990])===1990 の unbox も +v 由来の hex 差も排除・2026-07-15 パリティ堅牢化）。
  function normalizeBirthYear(v) {
    var n = num(v);
    n = Math.floor(n);
    return (n >= 1900 && n <= 9999) ? n : 0;
  }

  // Task2: 年齢グライドパス（currentYear は UTC 導出・degrade 対称）。
  // 不正/巨大 nowMs（例 1e300）は !isFinite(nd.getTime())（Invalid Date）が先に捕捉し configured:false へ。
  // cy の妥当年ガードは Py datetime 有効域（1..9999）に合わせ、JS Date が扱える年10000+（例 nowMs 253402300800000）での
  // JS(configured:true) vs Py(9999で例外→configured:false) 発散を潰す。
  // nowMs の基底 coerce は num()（scalar-safe＝配列/オブジェクト/bool→0）＝Python _num() と byte 一致
  // （2026-07-15 パリティ堅牢化で numScalar を num へ集約）。
  function glidePath(birthYear, nowMs) {
    var nd = new Date(num(nowMs));
    if (!isFinite(nd.getTime())) return { configured: false };
    var cy = nd.getUTCFullYear();
    if (cy < 1 || cy > 9999) return { configured: false }; // Py datetime 有効域に対称化
    var by = num(birthYear);
    var age = cy - by;
    // age は上流 num() サニタイズ＋有界 cy ゆえ常に有限（!isFinite 節は spec 準拠で残す実質 dead branch）。
    if (by <= 0 || !isFinite(age) || age < 0 || age > 120) return { configured: false };
    var Rr = clamp(110 - age, 30, 90);
    return { configured: true, age: age, R: Rr, D: 100 - Rr };
  }
  // Task3: 成長クラス（cash除く6クラスのうち devEq/jpEq/emEq/reit/gold）。GROWTH_CLASSES と合わせ growDef が参照。
  var GROWTH_CLASSES = ["devEq", "jpEq", "emEq", "reit", "gold"];
  // Task2: R（リスク資産%）を地域内訳（cash除く6クラス）へ写像・端数吸収でΣ=100。
  function regionBreakdown(Rr) {
    var D = 100 - Rr, eq = Rr * 0.85, alt = Rr * 0.15;
    var raw = { cash: 0, jpEq: eq * 0.20, devEq: eq * 0.60, emEq: eq * 0.20, bond: D, reit: alt * 0.60, gold: alt * 0.40 };
    return _absorbTo100(raw); // Task共通ヘルパ（下記・Task4の総資産集約でも使用）
  }
  // 端数吸収ヘルパ（regionBreakdown・総資産集約で共用）：r()整数化→残余を argmax(cash除く)へ・タイは ASSET_CLASSES 順。
  function _absorbTo100(rawMap) {
    var out = {}, sum = 0;
    for (var i = 0; i < ASSET_CLASSES.length; i++) { var k = ASSET_CLASSES[i]; out[k] = r(rawMap[k] || 0); sum += out[k]; }
    var rem = 100 - sum;
    if (rem !== 0) {
      var best = null;
      for (var j = 0; j < ASSET_CLASSES.length; j++) {
        var k2 = ASSET_CLASSES[j]; if (k2 === "cash") continue;
        if (best === null || out[k2] > out[best]) best = k2; // > ゆえ同値は先勝ち＝allowlist順
      }
      out[best] += rem;
    }
    return out;
  }

  // Task3: バケツ（buffer/core/satellite）ごとの目標配分（7クラス整数%）。
  // buffer=現金100%固定／satellite=株集中（devEq60/jpEq20/emEq20）固定／core=年齢glidepath（regionBreakdown）。
  function bucketTargets(bucketKey, Rr) {
    var z = { cash: 0, jpEq: 0, devEq: 0, emEq: 0, bond: 0, reit: 0, gold: 0 };
    if (bucketKey === "buffer") { z.cash = 100; return z; }
    if (bucketKey === "satellite") { z.devEq = 60; z.jpEq = 20; z.emEq = 20; return z; }
    return regionBreakdown(Rr); // core
  }
  // Task3: クラスマップ → 成長(g)/守り(d)。g = devEq+jpEq+emEq+reit+gold の和、d = 100-g。
  function growDef(m) {
    var g = 0;
    for (var i = 0; i < GROWTH_CLASSES.length; i++) g += (m[GROWTH_CLASSES[i]] || 0);
    return { g: g, d: 100 - g };
  }

  // Task4: 符号付き half-up（cfNum は符号付き coerce のみで丸めない・rSigned が丸める）。
  // 「-r(-x)」は |x| が0へ丸まる時 -0 を生む（IEEE754の符号付きゼロ）ため `|| 0` で +0 へ正規化（assert/strict の Object.is 差異対策）。
  function rSigned(x) { x = cfNum(x); return (x < 0 ? -r(-x) : r(x)) || 0; }
  // Task4: UI用（facts非対象）＝1バケツ内の分類済み実額比率。合計0は全0＋unclassifiedPct=0。
  function bucketCurrentPct(holdings, bucketKey) {
    var inner = (holdings && holdings[bucketKey]) || {}, sum = 0, i, k;
    for (i = 0; i < ASSET_CLASSES.length; i++) sum += (inner[ASSET_CLASSES[i]] || 0);
    var pct = { cash: 0, jpEq: 0, devEq: 0, emEq: 0, bond: 0, reit: 0, gold: 0 };
    if (sum <= 0) return { classPct: pct, unclassifiedPct: 0 };
    var rawMap = {}; for (i = 0; i < ASSET_CLASSES.length; i++) { k = ASSET_CLASSES[i]; rawMap[k] = (inner[k] || 0) / sum * 100; }
    return { classPct: _absorbTo100(rawMap), unclassifiedPct: 0 };
  }
  // Task4: 総資産の目標側集約＝バケツ目標額ウェイト（buffer/core/satellite）で加重平均。Σweight=0はcore分布へfallback。
  function totalTargetPct(Rr, weights) {
    var w = weights || {}, wb = num(w.buffer), wc = num(w.core), ws = num(w.satellite), tot = wb + wc + ws;
    if (tot <= 0) return regionBreakdown(Rr); // zero-weight fallback = core分布
    var bt = bucketTargets("buffer", Rr), ct = bucketTargets("core", Rr), st = bucketTargets("satellite", Rr);
    var rawMap = {};
    for (var i = 0; i < ASSET_CLASSES.length; i++) { var k = ASSET_CLASSES[i]; rawMap[k] = (bt[k] * wb + ct[k] * wc + st[k] * ws) / tot; }
    return _absorbTo100(rawMap);
  }
  // Task4: 総資産の現状側集約＝各バケツの assetHoldings 実額ウェイト（目標側と非対称・spec §3.3）。全0は null。
  function totalCurrentPct(holdings) {
    var totals = {}, grand = 0, b, i, k;
    for (i = 0; i < ASSET_CLASSES.length; i++) totals[ASSET_CLASSES[i]] = 0;
    for (b = 0; b < ASSET_BUCKETS.length; b++) {
      var inner = (holdings && holdings[ASSET_BUCKETS[b]]) || {};
      for (i = 0; i < ASSET_CLASSES.length; i++) { k = ASSET_CLASSES[i]; var v = inner[k] || 0; totals[k] += v; grand += v; }
    }
    if (grand <= 0) return null;
    var rawMap = {}; for (i = 0; i < ASSET_CLASSES.length; i++) { k = ASSET_CLASSES[i]; rawMap[k] = totals[k] / grand * 100; }
    return _absorbTo100(rawMap);
  }
  // Task4: 符号付きdrift＝現状%−目標% を rSigned で整数化。current=null は各クラス drift=-target。|drift|降順。
  function assetClassDrift(t, c) {
    var rows = [];
    for (var i = 0; i < ASSET_CLASSES.length; i++) {
      var k = ASSET_CLASSES[i]; var tp = t[k] || 0; var cp = c ? (c[k] || 0) : 0;
      rows.push({ key: k, targetPct: tp, currentPct: cp, driftPct: rSigned(cp - tp) });
    }
    rows.sort(function (a, b) { return Math.abs(b.driftPct) - Math.abs(a.driftPct); });
    return rows;
  }

  // 投資枠配分ロードマップ（backlog B #1）定数。state に持たず導出＝migrate/クラウド同期に触れない。
  var CORE_FALLBACK_MONTHS = 24;      // goals未宣言時のコア目標＝月支出×24（2年分）
  var SATELLITE_UNLOCK_CORE_PCT = 50; // サテライト解放＝コア目標の50%

  function yen(n) { return "¥" + Math.round(num(n)).toLocaleString("ja-JP"); }
  function yenSigned(n) { var x = Math.round(Number(n) || 0); return (x < 0 ? "-¥" : "¥") + Math.abs(x).toLocaleString("ja-JP"); } // 収支(負あり)表示用（cf-balance-zero）

  var _DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var _MONTH_RE = /^\d{4}-\d{2}$/;
  // goal の安全な正規化（migrate と新規追加の両方で使う・純粋）。
  function normalizeGoal(g, i) {
    return {
      id: (g && typeof g.id === "string" && /^[A-Za-z0-9_-]+$/.test(g.id)) ? g.id : "goal-" + i,
      label: (g && typeof g.label === "string") ? g.label : "",
      targetAmount: num(g && g.targetAmount),
      deadline: (g && typeof g.deadline === "string" && _DATE_RE.test(g.deadline)) ? g.deadline : "",
    };
  }

  // Slice4.5: 確保枠（sinking fund）の安全正規化（純粋）。配列順＝優先順位。
  // monthlyOverride>0 なら逆算を上書き（固定月額）。deadline で期日逆算・無ければ手動まとめ入れ専用。
  function normalizeReserve(rv, i) {
    return {
      id: (rv && typeof rv.id === "string" && /^[A-Za-z0-9_-]+$/.test(rv.id)) ? rv.id : "reserve-" + i,
      label: (rv && typeof rv.label === "string") ? rv.label : "",
      target: num(rv && rv.target),
      saved: num(rv && rv.saved),
      deadline: (rv && typeof rv.deadline === "string" && _DATE_RE.test(rv.deadline)) ? rv.deadline : "",
      monthlyOverride: num(rv && rv.monthlyOverride),
    };
  }

  // Slice4.5: 確保枠の月次積立提案額（純粋）。完了/残0は0。monthlyOverride>0 なら固定（残額でcap）。
  // else 期日逆算 ceil(残額/残カレンダー月)。残月は (deadline月 − now月) で算出し min 1（期日切迫/超過は満額を今月）。
  // 期日も override も無ければ0（手動まとめ入れ専用）。残カレンダー月＝直感的（「30万を5ヶ月で→月6万」）。
  function reserveMonthly(rv, nowMs) {
    var remaining = Math.max(0, num(rv.target) - num(rv.saved));
    if (remaining === 0) return 0;
    if (num(rv.monthlyOverride) > 0) return Math.min(num(rv.monthlyOverride), remaining);
    if (!rv.deadline || !_DATE_RE.test(rv.deadline) || !(num(nowMs) > 0)) return 0;
    var nd = new Date(num(nowMs));
    if (!isFinite(nd.getTime())) return 0; // 巨大/不正 nowMs は Python(fromtimestamp 例外)と揃え 0 へ degrade
    var cy = nd.getUTCFullYear();
    if (cy < 1 || cy > 9999) return 0; // #3 year>9999 は Py datetime 有効域外で例外→0・glidePath と同じ cy ガードで対称化
    var nowYM = cy * 12 + nd.getUTCMonth(); // 月は0始まり
    var dlYM = parseInt(rv.deadline.slice(0, 4), 10) * 12 + (parseInt(rv.deadline.slice(5, 7), 10) - 1);
    var monthsLeft = dlYM - nowYM;
    if (monthsLeft < 1) monthsLeft = 1; // 期日切迫/超過 → 満額を今月
    return Math.ceil(remaining / monthsLeft); // float64（follow-up D: Py _reserve_monthly は float(math.ceil) で任意精度 int を回避しこの float64 と対称）
  }

  function defaultState() {
    return {
      version: CURRENT_VERSION,
      currency: "JPY",
      monthlyExpense: 0,
      bufferMonths: 6,
      buckets: { buffer: { amount: 0 }, core: { amount: 0 }, satellite: { amount: 0 } },
      satelliteCapPct: 10,
      goals: [],
      lastAppliedCashflowPeriod: "", // Slice4: 直近で applySurplus 済みの確定 period（多重計上ガード・クラウド同期）
      anchor: { date: "", amount: 0 }, // データ基盤Phase1: 定点アンカー（基準月初の現金）。現在現金を kakeibo balance 累積で導出
      reserves: [], // Slice4.5: 目的別確保枠（sinking fund・新居/登記等）。独立プール・ファンド別saved・自動分配なし。投資余力から差引
      cashSource: "manual",       // データ基盤Phase2 二軸: "anchor"=導出cash / "manual"=buckets.buffer 直入力（既定=後方互換）
      investmentSource: "manual", // 二軸: "ledger"=投資台帳ETL派生の元本 / "manual"=buckets.core+satellite 直入力（既定=後方互換）
      updatedAt: 0, // last-write-wins 用の epoch ms（刻むのは money.js・ここは受け渡しのみ）
      history: [],
      birthYear: 0, // B#2 資産クラス比率：年齢glidePath用（0=未設定）
      assetHoldings: normalizeAssetHoldings(null), // B#2: 3バケツ×7クラス完全骨格（全0）
      assetSource: "manual", // B#2 二軸: "ledger"=投資台帳ETL派生 / "manual"=直入力（既定=後方互換）
      nisa: normalizeNisa(null), // B#3 NISA枠：非課税枠トラッキング（Stage1手入力・全0骨格）
    };
  }

  // アンカー（基準月の月初現金）の安全正規化（純粋）。日付は月単位＝常に月初(YYYY-MM-01)へスナップ。
  // 「その月のはじめの貯蓄額」に一意化し、月中の日を入れた時の二重計上の曖昧さを構造的に消す。
  // 後方互換: 既存の YYYY-MM-DD は月初へ丸める（cashDerived は元々月比較なので導出額は不変）。YYYY-MM も受理。
  function normalizeAnchor(a) {
    var raw = (a && typeof a.date === "string") ? a.date : "";
    var date = _DATE_RE.test(raw) ? raw.slice(0, 7) + "-01"
             : _MONTH_RE.test(raw) ? raw + "-01"
             : "";
    return { date: date, amount: num(a && a.amount) };
  }

  function migrate(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== "object") return d;
    var b = raw.buckets || {};
    // migrate gate は parseNum sentinel（num は常に≥0 で satelliteCapPct の >=0 gate が恒真化＝不可）＝
    // 「absent/invalid→default」と「present 0→0」を区別しつつ、配列/hex 文字列も両言語対称に default へ落とす。
    var _bm = parseNum(raw.bufferMonths), _scp = parseNum(raw.satelliteCapPct);
    return {
      version: CURRENT_VERSION,
      currency: typeof raw.currency === "string" ? raw.currency : d.currency,
      monthlyExpense: num(raw.monthlyExpense),
      bufferMonths: _bm > 0 ? num(raw.bufferMonths) : d.bufferMonths,
      buckets: {
        buffer: { amount: num(b.buffer && b.buffer.amount) },
        core: { amount: num(b.core && b.core.amount) },
        satellite: { amount: num(b.satellite && b.satellite.amount) },
      },
      satelliteCapPct: _scp >= 0 ? num(raw.satelliteCapPct) : d.satelliteCapPct,
      lastAppliedCashflowPeriod: (typeof raw.lastAppliedCashflowPeriod === "string" && _DATE_RE.test(raw.lastAppliedCashflowPeriod)) ? raw.lastAppliedCashflowPeriod : "",
      cashSource: raw.cashSource === "anchor" ? "anchor" : "manual",          // 二軸（既定 manual＝後方互換）
      investmentSource: raw.investmentSource === "ledger" ? "ledger" : "manual",
      anchor: normalizeAnchor(raw.anchor),
      reserves: Array.isArray(raw.reserves)
        ? raw.reserves.filter(function (rv) { return rv && typeof rv === "object" && !Array.isArray(rv); }).slice(0, 50).map(normalizeReserve)
        : [],
      goals: Array.isArray(raw.goals)
        ? raw.goals.filter(function (g) { return g && typeof g === "object" && !Array.isArray(g); }).map(normalizeGoal)
        : [],
      updatedAt: num(raw.updatedAt),
      history: Array.isArray(raw.history)
        ? raw.history.filter(function (h) { return h && typeof h.date === "string"; })
            .map(function (h) { return { date: h.date, buffer: num(h.buffer), core: num(h.core), satellite: num(h.satellite) }; })
        : [],
      birthYear: normalizeBirthYear(raw.birthYear),
      assetHoldings: normalizeAssetHoldings(raw.assetHoldings),
      assetSource: raw.assetSource === "ledger" ? "ledger" : "manual",
      nisa: normalizeNisa(raw.nisa), // B#3 NISA枠（前方互換・normalizeで固定形状）
    };
  }

  function bufferTarget(s) { return num(s.monthlyExpense) * num(s.bufferMonths); }
  function bufferProgress(s) { var t = bufferTarget(s); return t > 0 ? clamp(num(s.buckets.buffer.amount) / t, 0, 1) : 0; }
  function bufferRemaining(s) { return Math.max(0, bufferTarget(s) - num(s.buckets.buffer.amount)); }
  function investable(s) { return num(s.buckets.core.amount) + num(s.buckets.satellite.amount); }
  function satelliteCap(s) { return investable(s) * num(s.satelliteCapPct) / 100; }
  function satelliteOver(s) { return Math.max(0, num(s.buckets.satellite.amount) - satelliteCap(s)); }

  // 総資産（バッファ＋投資可能枠）。goals の進捗基準。
  function totalAssets(s) { return num(s.buckets.buffer.amount) + investable(s); }
  // 1 goal を total に対する進捗へ写す（純粋・ゼロ除算なし。日数計算は表示層で実日付を使う）。
  function goalProgress(goal, total) {
    var target = num(goal && goal.targetAmount);
    var t = num(total);
    var prog = target > 0 ? clamp(t / target, 0, 1) : 0;
    return {
      id: goal && goal.id, label: (goal && goal.label) || "",
      targetAmount: target, deadline: (goal && goal.deadline) || "",
      progress: prog, progressPct: Math.round(prog * 100),
      remaining: Math.max(0, target - t),
      achieved: target > 0 && t >= target,
    };
  }

  // 宣言済み goals[] の最大 targetAmount（＝到達点/north star）。無ければ0。
  function northStarTarget(s) {
    var goals = Array.isArray(s.goals) ? s.goals : [];
    var max = 0;
    for (var i = 0; i < goals.length; i++) {
      var t = num(goals[i] && goals[i].targetAmount);
      if (t > max) max = t;
    }
    return max;
  }

  // コアバケツの目標額。goal逆算（安全網を超える成長資本をコアが担う）＋定数フォールバック。
  function coreTarget(s) {
    var bt = bufferTarget(s);
    if (bt <= 0) return 0;                       // setup 未完（月支出未設定）
    var ns = northStarTarget(s);
    if (ns > bt) return ns - bt;                 // 目標逆算
    return num(s.monthlyExpense) * CORE_FALLBACK_MONTHS; // フォールバック
  }

  function coreTargetSource(s) {
    if (bufferTarget(s) <= 0) return "setup";
    return northStarTarget(s) > bufferTarget(s) ? "goal" : "fallback";
  }

  function coreProgress(s) {
    var ct = coreTarget(s);
    var core = num(s.buckets.core.amount);
    var progress = ct > 0 ? clamp(core / ct, 0, 1) : 0;
    return {
      progress: progress,
      pct: Math.round(progress * 100),
      remaining: ct > 0 ? Math.max(0, ct - core) : 0,
      established: ct > 0 && core >= ct,
    };
  }

  // Task2: サテライト解放条件（バッファ達成 AND コア50%以上）
  function satelliteUnlocked(s) {
    return bufferProgress(s) >= 1 && coreProgress(s).progress >= SATELLITE_UNLOCK_CORE_PCT / 100;
  }

  // Task2: ロードマップのフェーズ（6状態）。判定順が意味を持つ。
  function roadmapPhase(s) {
    if (bufferTarget(s) <= 0) return "setup";
    if (bufferProgress(s) < 1) return "buffer";
    if (satelliteOver(s) > 0) return "rebalance";
    var cp = coreProgress(s).progress;
    if (cp >= 1) return "independence";
    if (satelliteUnlocked(s)) return "satellite";
    return "core";
  }

  // Task2: 積立のみ・0%前提の到達月数。rate<=0 は前進不能=null。
  function projectMonths(gapYen, rateYen) {
    if (rateYen <= 0 || !isFinite(gapYen)) return null; // #2 ∞/NaN gap は degrade（Py int(ceil(inf)) OverflowError と対称化）
    var q = Math.max(0, gapYen) / rateYen;
    return isFinite(q) ? Math.ceil(q) : null; // 有限 gap でも rate 極小で比率が溢れる場合を捕捉（float64・follow-up D: Py _project_months は float(math.ceil) で対称）
  }

  // Task2: facts 用に生月数を粗化（ログ指紋の解像度低下）。
  function etaBucket(months) {
    if (months === null || months === undefined) return "none";
    if (months < 6) return "lt6";
    if (months < 12) return "6_12";
    if (months < 36) return "1_3y";
    if (months < 120) return "3_10y";
    return "over_10y";
  }

  // B#3: nowMs から UTC 年/月(0基)を導出（glidePath と同一の [1,9999] ガードで Py datetime と対称化）。
  function nisaNow(nowMs) {
    var d = new Date(num(nowMs));
    var y = d.getUTCFullYear();
    if (!isFinite(y) || y < 1 || y > 9999) return { year: 0, monthIndex: 0, valid: false };
    return { year: y, monthIndex: d.getUTCMonth(), valid: true };
  }

  // B#3: NISA使用状況の全導出（単一計算源＝nisaFacts/nisaRaw/nisaViewModel が参照）。
  function nisaDerive(state, nowMs) {
    var n = normalizeNisa(state && state.nisa);
    var configured = n.anchorYear > 0 || n.tsumitateThisYear > 0 || n.growthThisYear > 0 ||
      n.tsumitateLifetime > 0 || n.growthLifetime > 0 || n.soldThisYearAtCost > 0;
    var now = nisaNow(nowMs);
    var atUsed = n.tsumitateThisYear, agUsed = n.growthThisYear, atTotal = atUsed + agUsed;
    var lifeUsed = n.tsumitateLifetime + n.growthLifetime;
    var annualTsumitateRemaining = Math.max(0, NISA_ANNUAL_TSUMITATE - atUsed);
    var annualGrowthRemaining = Math.max(0, NISA_ANNUAL_GROWTH - agUsed);
    var annualTotalRemaining = Math.max(0, NISA_ANNUAL_TOTAL - atTotal);
    var lifetimeRemaining = Math.max(0, NISA_LIFETIME - lifeUsed);
    var growthCapRemaining = Math.max(0, NISA_GROWTH_LIFETIME_CAP - n.growthLifetime);
    var monthsLeft = now.valid ? (12 - now.monthIndex) : 0;
    return {
      configured: configured, n: n, year: now.year, monthIndex: now.monthIndex, valid: now.valid,
      atUsed: atUsed, agUsed: agUsed, atTotal: atTotal,
      annualTsumitateRemaining: annualTsumitateRemaining, annualGrowthRemaining: annualGrowthRemaining,
      annualTotalRemaining: annualTotalRemaining, lifeUsed: lifeUsed,
      lifetimeRemaining: lifetimeRemaining, growthCapRemaining: growthCapRemaining,
      annualTsumitateUsedPct: clamp(r(atUsed / NISA_ANNUAL_TSUMITATE * 100), 0, 100),
      annualGrowthUsedPct: clamp(r(agUsed / NISA_ANNUAL_GROWTH * 100), 0, 100),
      annualTotalUsedPct: clamp(r(atTotal / NISA_ANNUAL_TOTAL * 100), 0, 100),
      lifetimeUsedPct: clamp(r(lifeUsed / NISA_LIFETIME * 100), 0, 100),
      growthCapUsedPct: clamp(r(n.growthLifetime / NISA_GROWTH_LIFETIME_CAP * 100), 0, 100),
      overContribution: atUsed > NISA_ANNUAL_TSUMITATE || agUsed > NISA_ANNUAL_GROWTH ||
        atTotal > NISA_ANNUAL_TOTAL || lifeUsed > NISA_LIFETIME || n.growthLifetime > NISA_GROWTH_LIFETIME_CAP,
      hasRestorationPending: n.soldThisYearAtCost > 0,
      staleAnchorYear: now.valid && n.anchorYear > 0 && n.anchorYear < now.year,
      monthsLeft: monthsLeft,
      monthlyToFillTsumitate: monthsLeft > 0 ? Math.ceil(annualTsumitateRemaining / monthsLeft) : 0,
      monthlyToFillGrowth: monthsLeft > 0 ? Math.ceil(annualGrowthRemaining / monthsLeft) : 0,
      restoresYear: now.valid ? now.year + 1 : 0,
    };
  }

  // B#3: production 集約facts（両モード同値・生¥ゼロ・全数値leaf整数[-100,150]）。未設定は undefined＝キー省略。
  // lifetimeFillEtaBucket は cashflow ペース由来ゆえ既定'none'＝modeAFacts の cashflow ブロックが上書き（roadmap.etaToCoreBucket と同型）。
  function nisaFacts(state, nowMs) {
    var d = nisaDerive(state, nowMs);
    if (!d.configured) return undefined;
    return {
      source: d.n.source,
      annualTsumitateUsedPct: d.annualTsumitateUsedPct,
      annualGrowthUsedPct: d.annualGrowthUsedPct,
      annualTotalUsedPct: d.annualTotalUsedPct,
      lifetimeUsedPct: d.lifetimeUsedPct,
      growthCapUsedPct: d.growthCapUsedPct,
      annualRoomRemaining: d.annualTotalRemaining > 0,
      lifetimeRoomRemaining: d.lifetimeRemaining > 0,
      growthCapRoomRemaining: d.growthCapRemaining > 0,
      overContribution: d.overContribution,
      hasRestorationPending: d.hasRestorationPending,
      staleAnchorYear: d.staleAnchorYear,
      lifetimeFillEtaBucket: "none",
    };
  }

  // B#3: personal のみの生¥ブロック（facts.raw.nisa）。未設定は undefined＝キー省略。
  function nisaRaw(state, nowMs) {
    var d = nisaDerive(state, nowMs);
    if (!d.configured) return undefined;
    return {
      tsumitateThisYear: d.atUsed, growthThisYear: d.agUsed,
      tsumitateLifetime: d.n.tsumitateLifetime, growthLifetime: d.n.growthLifetime,
      soldThisYearAtCost: d.n.soldThisYearAtCost,
      annualTsumitateRemaining: d.annualTsumitateRemaining,
      annualGrowthRemaining: d.annualGrowthRemaining,
      lifetimeRemaining: d.lifetimeRemaining,
      growthCapRemaining: d.growthCapRemaining,
      monthlyToFillTsumitate: d.monthlyToFillTsumitate,
      restoresYear: d.restoresYear,
    };
  }

  // B#3: UI描画専用VM（¥+%・パリティ不要＝money.js が描く。業務mathはここに集約）。
  function nisaViewModel(state, cd, nowMs) {
    var d = nisaDerive(state, nowMs);
    var pace = (cd && cd.investableSurplus > 0) ? cd.investableSurplus : 0;
    var fillEta = etaBucket(projectMonths(d.lifetimeRemaining, pace));
    return {
      configured: d.configured,
      annual: {
        tsumitate: { cap: NISA_ANNUAL_TSUMITATE, used: d.atUsed, remaining: d.annualTsumitateRemaining, usedPct: d.annualTsumitateUsedPct, remainingPct: clamp(r(d.annualTsumitateRemaining / NISA_ANNUAL_TSUMITATE * 100), 0, 100), over: d.atUsed > NISA_ANNUAL_TSUMITATE },
        growth: { cap: NISA_ANNUAL_GROWTH, used: d.agUsed, remaining: d.annualGrowthRemaining, usedPct: d.annualGrowthUsedPct, remainingPct: clamp(r(d.annualGrowthRemaining / NISA_ANNUAL_GROWTH * 100), 0, 100), over: d.agUsed > NISA_ANNUAL_GROWTH },
        total: { cap: NISA_ANNUAL_TOTAL, used: d.atTotal, remaining: d.annualTotalRemaining, usedPct: d.annualTotalUsedPct, remainingPct: clamp(r(d.annualTotalRemaining / NISA_ANNUAL_TOTAL * 100), 0, 100), over: d.atTotal > NISA_ANNUAL_TOTAL },
      },
      lifetime: { cap: NISA_LIFETIME, used: d.lifeUsed, remaining: d.lifetimeRemaining, usedPct: d.lifetimeUsedPct, remainingPct: clamp(r(d.lifetimeRemaining / NISA_LIFETIME * 100), 0, 100), over: d.lifeUsed > NISA_LIFETIME, tsumitatePortion: d.n.tsumitateLifetime, growthPortion: d.n.growthLifetime,
        tsumitatePortionPct: clamp(r(d.n.tsumitateLifetime / NISA_LIFETIME * 100), 0, 100), growthPortionPct: clamp(r(d.n.growthLifetime / NISA_LIFETIME * 100), 0, 100) },
      growthCap: { cap: NISA_GROWTH_LIFETIME_CAP, used: d.n.growthLifetime, remaining: d.growthCapRemaining, usedPct: d.growthCapUsedPct, remainingPct: clamp(r(d.growthCapRemaining / NISA_GROWTH_LIFETIME_CAP * 100), 0, 100), over: d.n.growthLifetime > NISA_GROWTH_LIFETIME_CAP },
      restoration: { sold: d.n.soldThisYearAtCost, restoresYear: d.restoresYear, hasPending: d.hasRestorationPending },
      staleYear: d.staleAnchorYear, monthlyPace: pace, fillEta: fillEta,
      monthlyToFillTsumitate: d.monthlyToFillTsumitate, monthlyToFillGrowth: d.monthlyToFillGrowth,
      monthsLeft: d.monthsLeft, year: d.year,
    };
  }

  // Task3: 確保枠の月次コミット合計（定常寄与＝投影のコアドラッグ）。cd.reserveAlloc(配列)や cd.toReserves(今月実配分・phase依存)は投影に使わない。
  function reserveMonthlyTotal(s, nowMs) {
    var reserves = Array.isArray(s.reserves) ? s.reserves : [];
    var sum = 0;
    for (var i = 0; i < reserves.length; i++) sum += r(reserveMonthly(reserves[i], nowMs));
    return sum;
  }

  // Task3: 今月の配分プラン（cashflowDerived は不変・サテライト分割はここだけ）。
  function allocationPlan(s, cd) {
    cd = cd || {};
    var surplus = num(cd.investableSurplus);
    var unlocked = satelliteUnlocked(s);
    var toSat = 0, toCore = surplus;
    if (unlocked) {
      var room = Math.max(0, satelliteCap(s) - num(s.buckets.satellite.amount));
      toSat = Math.min(room, r(surplus * num(s.satelliteCapPct) / 100));
      toCore = surplus - toSat;
    }
    return {
      phase: roadmapPhase(s), satelliteUnlocked: unlocked,
      toBuffer: num(cd.toBuffer), toReserves: num(cd.toReserves),
      reserveAlloc: Array.isArray(cd.reserveAlloc) ? cd.reserveAlloc : [],
      toCore: toCore, toSatellite: toSat, monthlySurplus: num(cd.monthlySurplus),
    };
  }

  // Task3: north star（最大目標）のラベル。
  function _northStarLabel(s) {
    var goals = Array.isArray(s.goals) ? s.goals : [];
    var maxT = 0, label = "";
    for (var i = 0; i < goals.length; i++) {
      var t = num(goals[i] && goals[i].targetAmount);
      if (t > maxT) { maxT = t; label = String((goals[i] && goals[i].label) || ""); }
    }
    return label;
  }

  // Task3: ロードマップ UI VM（UI専用・パリティ不要＝cashflowViewModel と同格）。cd=cashflowDerived の戻り。
  function roadmap(s, cd, nowMs) {
    cd = cd || {};
    var available = !!cd.available;
    var monthlySurplus = num(cd.monthlySurplus);
    var reserveMo = reserveMonthlyTotal(s, nowMs);
    var coreContribution = Math.max(0, monthlySurplus - reserveMo);
    var cp = coreProgress(s);
    var ct = coreTarget(s);
    var bt = bufferTarget(s);
    var monthsToBuffer = (available && typeof cd.monthsToBufferComplete === "number")
      ? cd.monthsToBufferComplete
      : (available ? projectMonths(bufferRemaining(s), monthlySurplus) : null);
    var monthsToCore = available ? projectMonths(cp.remaining, coreContribution) : null;
    var cumulativeToCore = (monthsToBuffer !== null && monthsToCore !== null) ? monthsToBuffer + monthsToCore : null;
    var total = totalAssets(s);
    var goals = (Array.isArray(s.goals) ? s.goals : []).slice(0, 20);
    var ns = northStarTarget(s);
    var milestones = [];
    for (var i = 0; i < goals.length; i++) {
      var t = num(goals[i] && goals[i].targetAmount);
      if (t <= 0) continue;
      var gp = goalProgress(goals[i], total);
      milestones.push({
        index: i, label: String((goals[i] && goals[i].label) || ""), targetAmount: t,
        progressPct: gp.progressPct, reached: gp.achieved,
        projectedMonths: available ? projectMonths(Math.max(0, t - total), monthlySurplus) : null,
      });
    }
    return {
      phase: roadmapPhase(s),
      phases: [
        { key: "buffer", label: "守る（生活防衛）", target: bt, saved: num(s.buckets.buffer.amount),
          remaining: bufferRemaining(s), progress: bufferProgress(s), progressPct: Math.round(bufferProgress(s) * 100),
          monthlyContribution: monthlySurplus, monthsToComplete: monthsToBuffer, cumulativeMonths: monthsToBuffer },
        { key: "core", label: "育てる（長期投資）", target: ct, saved: num(s.buckets.core.amount),
          remaining: cp.remaining, progress: cp.progress, progressPct: cp.pct,
          monthlyContribution: coreContribution, monthsToComplete: monthsToCore, cumulativeMonths: cumulativeToCore },
        { key: "satellite", label: "攻める（サテライト）", target: satelliteCap(s), saved: num(s.buckets.satellite.amount),
          progress: 0, progressPct: 0, locked: !satelliteUnlocked(s), unlockCorePct: SATELLITE_UNLOCK_CORE_PCT },
      ],
      northStar: { target: ns, source: coreTargetSource(s), label: _northStarLabel(s) },
      coreTarget: ct, coreProgress: cp,
      satelliteUnlocked: satelliteUnlocked(s), satelliteUnlockCorePct: SATELLITE_UNLOCK_CORE_PCT,
      thisMonth: allocationPlan(s, cd),
      projection: {
        available: available, monthlySurplus: monthlySurplus, reserveMonthlyTotal: reserveMo,
        coreMonthlyContribution: coreContribution, monthsToBuffer: monthsToBuffer,
        monthsToCore: monthsToCore, cumulativeToCore: cumulativeToCore, etaToCoreBucket: etaBucket(cumulativeToCore),
      },
      milestones: milestones,
      timelineAvailable: available && monthlySurplus > 0,
    };
  }

  function nextAllocation(s) {
    if (bufferTarget(s) === 0) {
      return { target: "setup", message: "まず「設定」で月の生活費を入力してください（バッファ目標を設定）" };
    }
    if (bufferProgress(s) < 1) {
      return { target: "buffer", remaining: bufferRemaining(s),
        message: "次の余剰はバッファへ。目標まであと " + yen(bufferRemaining(s)) + "（" + num(s.bufferMonths) + "ヶ月分）" };
    }
    if (satelliteOver(s) > 0) {
      return { target: "rebalance", over: satelliteOver(s),
        message: "サテライトが上限超過（" + yen(satelliteOver(s)) + "）。コアへ寄せるか現金化を検討" };
    }
    return { target: "core", cap: satelliteCap(s),
      message: "バッファ達成。次の余剰はコア（長期）へ。サテライトは上限 " + yen(satelliteCap(s)) + " の余剰内のみ" };
  }

  // 初回オンボーディングのステッパー（純粋・表示専用）。setup 完了度を4段で返し「今ここ」＝最初の未完了。
  // loggedIn/hasCashflow は sync（副作用源）由来のため money.js から渡す。業務 math でなく状態判定。
  function onboardingSteps(s, loggedIn, hasCashflow) {
    var b = (s && s.buckets) || {};
    var bucketsTouched = (num(b.buffer && b.buffer.amount) + num(b.core && b.core.amount) + num(b.satellite && b.satellite.amount)) > 0;
    // target=ジャンプ先セクションの論理キー / linkLabel=action 内でリンク化する語（DOM層が解釈・純データ）。
    var steps = [
      { key: "expense", target: "settings", linkLabel: "「設定」", label: "月の生活費", optional: false, done: num(s && s.monthlyExpense) > 0,
        action: "「設定」を開いて月の生活費を入力（バッファ目標が決まります）" },
      { key: "buckets", target: "buckets", linkLabel: "バッファ・コア・サテライト", label: "今ある金額", optional: false, done: bucketsTouched,
        action: "バッファ・コア・サテライトに、今ある金額を入力" },
      { key: "login", target: "sync", linkLabel: "ログイン", label: "ログイン", optional: true, done: !!loggedIn,
        action: "ログインするとクラウド同期＝複数端末で共有できます（任意）" },
      { key: "cashflow", target: "cashflow", linkLabel: "家計（kakeibo）を連携", label: "収支連携", optional: true, done: !!hasCashflow,
        action: "家計（kakeibo）を連携すると毎月の投資余力が表示されます（任意）" },
    ];
    var current = -1, doneCount = 0;
    for (var i = 0; i < steps.length; i++) { if (!steps[i].done && current === -1) current = i; if (steps[i].done) doneCount++; }
    return { steps: steps, currentIndex: current, allDone: current === -1,
      nextAction: current === -1 ? "" : steps[current].action, doneCount: doneCount, total: steps.length };
  }

  function viewModel(s) {
    var cap = satelliteCap(s);
    var sat = num(s.buckets.satellite.amount);
    var total = totalAssets(s);
    return {
      currency: s.currency,
      totalAssets: total,
      goals: (Array.isArray(s.goals) ? s.goals : []).map(function (g) { return goalProgress(g, total); }),
      monthlyExpense: num(s.monthlyExpense),
      bufferMonths: num(s.bufferMonths),
      satelliteCapPct: num(s.satelliteCapPct),
      bufferAmount: num(s.buckets.buffer.amount),
      coreAmount: num(s.buckets.core.amount),
      satelliteAmount: sat,
      bufferConfigured: bufferTarget(s) > 0,
      bufferTarget: bufferTarget(s),
      bufferProgress: bufferProgress(s),
      bufferProgressPct: Math.round(bufferProgress(s) * 100),
      bufferRemaining: bufferRemaining(s),
      investable: investable(s),
      satelliteCap: cap,
      satelliteOver: satelliteOver(s),
      satelliteIsOver: satelliteOver(s) > 0,
      satelliteFillPct: cap > 0 ? clamp(sat / cap, 0, 1.5) * 100 : (sat > 0 ? 100 : 0),
      next: nextAllocation(s),
      fmt: yen,
    };
  }

  // deadline(YYYY-MM-DD) を now(epoch ms)基準の粗バケツへ写す（純粋・生日付は出さない）。
  function deadlineBucket(deadline, nowMs) {
    if (!deadline || !_DATE_RE.test(deadline) || !(num(nowMs) > 0)) return null;
    if (parseInt(deadline.slice(0, 4), 10) < 1) return null; // wf-E: 西暦0 は Py strptime 有効域外（year>=1）・glidePath/reserveMonthly の cy ガードと一貫
    var t = Date.parse(deadline + "T00:00:00Z");
    if (!isFinite(t)) return null;
    // カレンダー妥当性: Date.parse のロールオーバー(2026-02-30→3-02 等)を弾き Python strptime(拒否)と一致させる。
    var dchk = new Date(t);
    if (dchk.getUTCFullYear() !== parseInt(deadline.slice(0, 4), 10) ||
        dchk.getUTCMonth() + 1 !== parseInt(deadline.slice(5, 7), 10) ||
        dchk.getUTCDate() !== parseInt(deadline.slice(8, 10), 10)) return null;
    var months = (t - num(nowMs)) / (30.44 * 86400000);
    if (months < 0) return "overdue";
    if (months < 3) return "under_3m";
    if (months < 12) return "3_12m";
    if (months < 36) return "1_3y";
    return "over_3y";
  }

  // ── Slice4: 収支連携 → 投資余力（純関数・advice.py mode_a_facts と鏡像／fixture でパリティ固定）──
  function cfNum(v) { var n = parseNum(v); return isFinite(n) ? n + 0 : 0; } // 符号付き（balance は負あり）・parseNum で scalar-safe・n+0 で -0 正規化

  // #1 共有 strict ISO パーサ（api/me/advice.py _parse_iso_ms の鏡像）。
  // Date.parse は lenient で tz 無しを LOCAL 化・スラッシュ/月名を受理・2/30 を 3/2 へロールオーバーし Python
  // fromisoformat と発散するため使わない。明示 ISO サブセット（T か半角空白区切り・tz 無しは UTC）のみを
  // regex 抽出＋カレンダー検証し Date.UTC で決定論計算。非 ISO/範囲外は null。ASCII クラス限定（[0-9]・\d/\s 不使用）。
  var _ISO_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})(?:[T ]([0-9]{2}):([0-9]{2}):([0-9]{2})(\.[0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2})?)?$/;
  function _daysInMonth(y, mo) {
    var leap = (y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0));
    return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  }
  function parseIsoMs(v) {
    if (typeof v !== "string") return null;
    var m = _ISO_RE.exec(v);
    if (!m) return null;
    var Y = +m[1], Mo = +m[2], D = +m[3];
    if (Y < 1 || Mo < 1 || Mo > 12 || D < 1 || D > _daysInMonth(Y, Mo)) return null; // 西暦0＋カレンダー妥当性（Py datetime 有効域 1..9999・fromisoformat 拒否と一致）
    var hh = 0, mi = 0, ss = 0, ms = 0, offMin = 0;
    if (m[4] != null) {                                          // 時刻部あり
      hh = +m[4]; mi = +m[5]; ss = +m[6];
      if (hh > 23 || mi > 59 || ss > 59) return null;            // hour24/25:00/…:60 等は無効（Py も明示 reject し対称）
      if (m[7]) ms = Math.floor(parseFloat("0" + m[7]) * 1000);  // 小数秒→ms へ floor（µs は捨て Py も floor で一致）
      if (m[8] && m[8] !== "Z") {                                // 明示オフセット ±HH:MM
        offMin = (+m[8].slice(1, 3)) * 60 + (+m[8].slice(4, 6));
        if (m[8].charAt(0) === "-") offMin = -offMin;
      }
    }
    var d = new Date(0);
    d.setUTCFullYear(Y, Mo - 1, D);                              // Date.UTC の2桁年(Y<100→1900+Y)レガシー写像を回避し字面年で計算
    d.setUTCHours(hh, mi, ss, ms);
    return d.getTime() - offMin * 60000;                        // tz 無し→UTC・オフセットは UTC へ換算
  }
  function median(arr) {
    if (!arr.length) return 0;
    var a = arr.slice().sort(function (x, y) { return x - y; });
    var n = a.length, m = Math.floor(n / 2);
    return n % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mean(arr) { if (!arr.length) return 0; var s = 0; for (var i = 0; i < arr.length; i++) s += arr[i]; return s / arr.length; }

  // 生 snapshot 行 → 正規化（period 昇順・不正行は捨てる）。
  function cashflowRows(rows) {
    if (!Array.isArray(rows)) return [];
    var out = rows.filter(function (r) {
      return r && typeof r === "object" && typeof r.period === "string" && _DATE_RE.test(r.period);
    }).map(function (r) {
      return {
        period: r.period,
        totalIncome: cfNum(r.total_income),
        salaryIncome: cfNum(r.salary_income),
        miscIncome: cfNum(r.misc_income),
        fixedExpense: cfNum(r.fixed_expense),
        variableExpense: cfNum(r.variable_expense),
        totalExpense: cfNum(r.total_expense),
        balance: cfNum(r.balance),
        isComplete: r.is_complete !== false,
        breakdown: (r.breakdown && typeof r.breakdown === "object") ? r.breakdown : null,
        pulledAt: typeof r.pulled_at === "string" ? r.pulled_at : "",
      };
    });
    out.sort(function (a, b) { return a.period < b.period ? -1 : (a.period > b.period ? 1 : 0); });
    return out;
  }

  function fixedBurdenBucket(pct) {
    if (pct < 30) return "low";
    if (pct < 50) return "mid";
    if (pct < 70) return "high";
    return "very_high";
  }
  function monthsToBufferBucket(m) {
    if (m === null) return "never";   // 余剰0＝前進不能
    if (m === 0) return "achieved";
    if (m <= 6) return "lt6";
    if (m <= 12) return "6_12";
    if (m <= 36) return "1_3y";
    return "over_3y";
  }

  // 投資余力ロジックの単一源。cashflowViewModel（UI）と modeAFacts（LLM）が共に呼ぶ。
  // 余剰 = balance（収入−支出合計。固定費二重控除を避ける）→ 経常余剰=balance−雑収入 → median(3) → ウォーターフォール。
  function cashflowDerived(rows, s, nowMs) {
    var parsed = cashflowRows(rows);
    var currencyMismatch = (s.currency === "USD"); // kakeibo は JPY 前提
    var complete = parsed.filter(function (r) { return r.isComplete; });
    var hasData = parsed.length > 0;

    var recurring = complete.map(function (r) { return r.balance - r.miscIncome; }); // 臨時収入を経常から除外
    var win = recurring.slice(-3);
    var monthsCovered = complete.length;
    var insufficientData = monthsCovered < 3;
    var base = win.length ? median(win) : 0;
    var monthlySurplus = r(Math.max(0, base)); // 赤字clamp＋half-up（負は num() で0）

    var winComplete = complete.slice(-3);
    var winIncome = 0, winExpense = 0, winBalance = 0, winFixed = 0;
    winComplete.forEach(function (rr) { winIncome += rr.totalIncome; winExpense += rr.totalExpense; winBalance += rr.balance; winFixed += rr.fixedExpense; });
    var savingsRatePctRaw = winIncome > 0 ? (winBalance / winIncome) * 100 : 0; // 負あり（UIは生値）
    var fixedBurdenRaw = winIncome > 0 ? (winFixed / winIncome) * 100 : 0;

    // ウォーターフォール（収支→バッファ残→コア）。規律芯=バッファ→コア。サテライトへは自動配分しない
    // （リスク資産へ寄せない＝cf-1）。丸めは toBuffer に集約し investableSurplus を導出（par-2 二重丸め回避）。
    var requiredBuffer = bufferTarget(s);
    var bufferAmount = num(s.buckets.buffer.amount);
    var bufferRem = Math.max(0, requiredBuffer - bufferAmount);
    var bufferConfigured = requiredBuffer > 0;
    var bufferAchieved = bufferConfigured && bufferRem === 0;
    var toBuffer = r(Math.min(monthlySurplus, bufferRem));
    // Slice4.5: バッファ控除後の余剰を確保枠へ優先順位順（配列順）に充当→残りがコア。確保枠が空なら
    // toReserves=0 で旧挙動（investableSurplus=afterBuffer）と完全一致＝既存パリティ不変。全値整数で par-2 二重丸めなし。
    var afterBuffer = Math.max(0, monthlySurplus - toBuffer);
    var reservesArr = Array.isArray(s.reserves) ? s.reserves : [];
    var remainForReserves = afterBuffer, toReserves = 0;
    var reserveAlloc = reservesArr.map(function (rv) {
      var want = r(reserveMonthly(rv, nowMs)); // 整数化（override の float を排し toReserves/investableSurplus を整数に保つ＝par-2）
      var give = Math.max(0, Math.min(want, remainForReserves));
      remainForReserves -= give; toReserves += give;
      var tgt = num(rv.target), sv = num(rv.saved);
      return {
        id: rv.id, label: rv.label, target: tgt, saved: sv, deadline: rv.deadline,
        suggestedMonthly: want, allocated: give,
        progress: tgt > 0 ? clamp(sv / tgt, 0, 1) : (sv > 0 ? 1 : 0),
        complete: tgt > 0 && sv >= tgt,
        shortfall: give < want, // 今月の提案を余剰で満たせない
      };
    });
    var investableSurplus = remainForReserves; // バッファ→確保枠→残り＝コア
    var toCore = investableSurplus;   // 既定は全額コア（サテライトは上限内リバランス操作限定）
    var toSatellite = 0;
    var reservesTotalSaved = 0, reservesTotalTarget = 0, reservesFundedSaved = 0, reservesActive = 0, reservesShortfall = false;
    reserveAlloc.forEach(function (ra) {
      reservesTotalSaved += ra.saved; reservesTotalTarget += ra.target;
      // fundedPct 用は per-reserve で target に cap（超過貯蓄/target=0 saved が他枠の不足を相殺して 100% に見える誤りを排除）。
      if (ra.target > 0) reservesFundedSaved += Math.min(ra.saved, ra.target);
      if (ra.target > 0 && !ra.complete) reservesActive++;
      if (ra.shortfall) reservesShortfall = true;
    });
    var monthsToBufferComplete = bufferAchieved ? 0
      : (monthlySurplus > 0 && bufferRem > 0 && isFinite(bufferRem / monthlySurplus) ? Math.ceil(bufferRem / monthlySurplus) : null); // #2 比率非有限(bufferTarget overflow)は null（Py int(ceil(inf)) と対称）／float64: follow-up D で Py も float(math.ceil) 化し対称
    var destination = nextAllocation(s).target;  // nextTarget と単一源で一致（同画面の自己矛盾を排除）

    // トレンド（直近3 median vs 前3 median・要 prev3 が3ヶ月）。
    // rb<=0（経常赤字の中央値）は相対バンドが符号反転するため絶対比較に切替（cf-2）。
    var recent3 = recurring.slice(-3), prev3 = recurring.slice(-6, -3), trend = null;
    if (recent3.length >= 1 && prev3.length >= 3) {
      var ra = median(recent3), rb = median(prev3);
      if (rb > 0) {
        trend = ra > rb * 1.05 ? "improving" : (ra < rb * 0.95 ? "declining" : "flat");
      } else {
        var eps = Math.max(1000, num(s.monthlyExpense) * 0.02);
        trend = ra > rb + eps ? "improving" : (ra < rb - eps ? "declining" : "flat");
      }
    }

    var last6 = complete.slice(-6);
    var deficitMonths = last6.filter(function (rr) { return rr.balance < 0; }).length;
    var last12 = complete.slice(-12);
    var windfallTtm = r(last12.reduce(function (acc, rr) { return acc + Math.max(0, rr.miscIncome); }, 0));
    var avgIncome = r(mean(winComplete.map(function (rr) { return rr.totalIncome; })));
    var avgExpense = r(mean(winComplete.map(function (rr) { return rr.totalExpense; })));

    var latest = parsed.length ? parsed[parsed.length - 1] : null;
    var staleDays = null;
    if (latest && latest.pulledAt && num(nowMs) > 0) {
      var pt = parseIsoMs(latest.pulledAt); // #1 strict 共有 ISO パーサ（Date.parse の LOCAL 化/lenient を排し _parse_iso_ms と一致）
      if (pt !== null) staleDays = Math.max(0, Math.floor((num(nowMs) - pt) / 86400000));
    }
    var dataFresh = staleDays === null ? null : (staleDays < 35);

    return {
      hasData: hasData, currencyMismatch: currencyMismatch, available: hasData && !currencyMismatch,
      monthsCovered: monthsCovered, insufficientData: insufficientData,
      base: base, monthlySurplus: monthlySurplus, surplusPositive: base > 0,
      requiredBuffer: requiredBuffer, bufferRemaining: bufferRem,
      bufferConfigured: bufferConfigured, bufferAchieved: bufferAchieved,
      toBuffer: toBuffer, investableSurplus: investableSurplus, toSatellite: toSatellite, toCore: toCore,
      toReserves: toReserves, reserveAlloc: reserveAlloc, reservesTotalSaved: reservesTotalSaved,
      reservesTotalTarget: reservesTotalTarget, reservesFundedSaved: reservesFundedSaved,
      reservesActive: reservesActive, reservesShortfall: reservesShortfall,
      monthsToBufferComplete: monthsToBufferComplete, destination: destination,
      savingsRatePctRaw: savingsRatePctRaw, fixedBurdenRaw: fixedBurdenRaw, trend: trend,
      deficitMonths: deficitMonths, windfallTtm: windfallTtm, windfallPresent: windfallTtm > 0,
      avgIncome: avgIncome, avgExpense: avgExpense, staleDays: staleDays, dataFresh: dataFresh,
      latest: latest, rows: parsed,
    };
  }

  // データ基盤Phase1: 定点アンカー＋確定月の(kakeibo balance + 投資現金フロー)累積で現在現金を導出（純粋）。
  // 手入力 buffer のドリフト（次回開くと現実が乖離）を機械的に消す。investmentRows は Phase2 で投資台帳由来
  // ({period, invest_cash_flow})・Phase1 は [] で投資フロー0。当月は is_complete=false で除外し権威は確定値。
  function cashDerived(rows_in, investmentRows, anchor, nowMs) {
    var a = normalizeAnchor(anchor);
    if (!a.date) {
      return { anchorConfigured: false, anchorDate: "", anchorAmount: 0, derivedCash: 0, derivedCashLive: 0, monthsCovered: 0 };
    }
    var anchorYM = a.date.slice(0, 7);
    var rows = cashflowRows(rows_in);
    var icf = {};
    if (Array.isArray(investmentRows)) {
      investmentRows.forEach(function (r) {
        if (r && typeof r.period === "string") icf[r.period] = cfNum(r.invest_cash_flow);
      });
    }
    var sumComplete = 0, sumLive = 0, monthsCovered = 0;
    rows.forEach(function (r) {
      if (r.period.slice(0, 7) < anchorYM) return; // アンカー月より前は対象外
      var flow = r.balance + (icf[r.period] || 0);
      sumLive += flow;
      if (r.isComplete) { sumComplete += flow; monthsCovered++; }
    });
    return {
      anchorConfigured: true, anchorDate: a.date, anchorAmount: a.amount,
      derivedCash: a.amount + sumComplete,   // 権威（確定月のみ）
      derivedCashLive: a.amount + sumLive,    // 参考（当月部分含む）
      monthsCovered: monthsCovered,
    };
  }

  // データ基盤Phase2: 生 投資snapshot 行 → 正規化（period 昇順・不正行は捨てる・cashflowRows と同流儀）。
  function investmentRows(rows) {
    if (!Array.isArray(rows)) return [];
    var out = rows.filter(function (r) {
      return r && typeof r === "object" && typeof r.period === "string" && _DATE_RE.test(r.period);
    }).map(function (r) {
      return {
        period: r.period,
        investCashFlow: cfNum(r.invest_cash_flow),       // 現金影響（符号付き）
        principalCoreDelta: cfNum(r.principal_core_delta),
        principalSatDelta: cfNum(r.principal_sat_delta),
        realizedGain: cfNum(r.realized_gain),            // 実現益（負=損失あり）
        isComplete: r.is_complete !== false,
        pulledAt: typeof r.pulled_at === "string" ? r.pulled_at : "",
      };
    });
    out.sort(function (a, b) { return a.period < b.period ? -1 : (a.period > b.period ? 1 : 0); });
    return out;
  }

  // データ基盤Phase2: 投資台帳の per-period delta を累積し principal/investable/実現益(TTM)を導出（純粋）。
  // 二目的会計（plan §2）: 元本(取得原価)は全期間累積（期初保有=基準日前取得を含む・現金には載らない）／
  //   実現益は直近12確定月のTTM（windfall・経常medianから別建て・売却月にスパイクさせない）。
  // 現金導出は cashDerived が invest_cash_flow を別途畳み込む（ここは元本/実現益の単一責務＝二重計上しない）。
  // 元本は通常非負だが記帳誤りで負化し得る → 表示は max(0,..)、生値(*Raw)も返してドリフト点検に供する。
  function investmentDerived(rows_in, nowMs) {
    var rows = investmentRows(rows_in);
    var principalCore = 0, principalSat = 0;
    rows.forEach(function (rr) { principalCore += rr.principalCoreDelta; principalSat += rr.principalSatDelta; });
    var complete = rows.filter(function (rr) { return rr.isComplete; });
    var last12 = complete.slice(-12);
    var realizedGainTtm = last12.reduce(function (acc, rr) { return acc + rr.realizedGain; }, 0);
    var coreSafe = Math.max(0, principalCore), satSafe = Math.max(0, principalSat);
    var investable = coreSafe + satSafe;
    return {
      investmentConfigured: rows.length > 0,
      principalCore: coreSafe, principalSat: satSafe, investable: investable,
      principalCoreRaw: principalCore, principalSatRaw: principalSat, investableRaw: principalCore + principalSat,
      coreSharePct: investable > 0 ? (coreSafe / investable) * 100 : 0,
      satelliteSharePct: investable > 0 ? (satSafe / investable) * 100 : 0,
      realizedGainTtm: realizedGainTtm,                 // 符号付き（損失は負）
      realizedGainPresent: realizedGainTtm !== 0,
      rows: rows,
    };
  }

  // Task5: 資産クラス比率（backlog B #2）の総資産集約facts。state は migrate() 済みを想定（modeAFacts 内 s を渡す）。
  // birthYear 未設定/域外（glidePath 非configured）は undefined を返す＝facts.assetClasses キー自体を省く（spec §7）。
  function assetClassesFacts(state, nowMs) {
    var gp = glidePath(state.birthYear, nowMs);
    if (!gp.configured) return undefined;
    var weights = { buffer: bufferTarget(state), core: coreTarget(state), satellite: satelliteCap(state) };
    var target = totalTargetPct(gp.R, weights);
    var current = totalCurrentPct(normalizeAssetHoldings(state.assetHoldings));
    var classes = assetClassDrift(target, current);
    return { riskAssetPct: gp.R, classes: classes };
  }

  // Slice3: 生 state → Mode A 集約ファクト（純粋）。AI規律コーチへ渡す唯一の境界。
  // 必ず migrate() で全フィールドを coerce（文字列/NaN/巨大配列/不正日付を強制正規化）してから、
  // allowlist キーのみで新規 dict を構築する（viewModel をスプレッドしない・history を走査しない）。
  // opts.includeRawAmounts=true（個人モード・本人合意）でのみ生額・目標ラベルを raw に同梱する。
  // production（既定）の戻り値には生額・ラベル・生日付が一切含まれない＝Mode A の構造保証。
  function modeAFacts(rawState, opts) {
    opts = opts || {};
    var includeRaw = !!opts.includeRawAmounts;
    // opts.nowMs の基底 coerce は num()（scalar-safe＝配列/オブジェクト/bool→0・非decimal 文字列→0）。
    // JS はここで nowMs を事前 coerce して下流（glidePath/deadlineBucket/cashflowDerived）へ渡し、Python は raw のまま各ヘルパへ
    // 渡して内部で _num() する。num/_num は冪等かつ同一 contract ゆえ両経路とも同値（bool nowMs も両側 0・hex/underscore 文字列も両側 0）。
    // （2026-07-15 パリティ堅牢化で numScalar を num へ集約＝旧「generic num/_num の bool/hex 潜在発散点」を根絶）。
    var nowMs = num(opts.nowMs);
    var s = migrate(rawState);
    var cur = s.currency === "USD" ? "USD" : "JPY"; // 自由文字列 currency を閉集合へ
    var total = totalAssets(s);
    var inv = investable(s);
    var cap = satelliteCap(s);
    var sat = num(s.buckets.satellite.amount);
    var over = satelliteOver(s);
    var core = num(s.buckets.core.amount);
    var goalsArr = (Array.isArray(s.goals) ? s.goals : []).slice(0, 20); // 巨大配列注入を抑止

    var facts = {
      mode: includeRaw ? "personal" : "production",
      currency: cur,
      bufferConfigured: bufferTarget(s) > 0,
      bufferMonths: clamp(r(s.bufferMonths), 0, 120),
      bufferProgressPct: clamp(r(bufferProgress(s) * 100), 0, 100),
      bufferAchieved: bufferProgress(s) >= 1,
      satelliteCapPct: clamp(r(s.satelliteCapPct), 0, 100),
      satelliteFillPct: clamp(r(cap > 0 ? clamp(sat / cap, 0, 1.5) * 100 : (sat > 0 ? 100 : 0)), 0, 150),
      satelliteIsOver: over > 0,
      satelliteOverByPct: clamp(r(cap > 0 ? (over / cap) * 100 : (over > 0 ? 100 : 0)), 0, 100),
      coreSharePct: clamp(r(inv > 0 ? (core / inv) * 100 : 0), 0, 100),
      investableConfigured: inv > 0,
      nextTarget: nextAllocation(s).target,
      goalsCount: goalsArr.length,
      goals: goalsArr.map(function (g, i) {
        var gp = goalProgress(g, total);
        return {
          index: i,
          progressPct: clamp(r(gp.progress * 100), 0, 100),
          achieved: !!gp.achieved,
          hasDeadline: !!g.deadline,
          monthsToDeadlineBucket: deadlineBucket(g.deadline, nowMs),
        };
      }),
      rulesVersion: CURRENT_VERSION,
      schemaVersion: FACTS_SCHEMA_VERSION,
    };

    // 投資枠配分ロードマップ（backlog B #1）。state由来の集約は常時・生¥なし。
    var _cp = coreProgress(s);
    facts.roadmap = {
      phase: roadmapPhase(s),
      coreProgressPct: clamp(_cp.pct, 0, 100),
      coreEstablished: _cp.established,
      satelliteUnlocked: satelliteUnlocked(s),
      coreTargetSource: coreTargetSource(s),
    };

    // Task5: 資産クラス比率（backlog B #2）。未設定（birthYear未設定/域外nowMs）は assetClasses キー自体を省く。
    // age は公開教育値ゆえ raw 隔離不要＝両モードトップレベル同値（spec §3.5/§7 A案）。
    var acFacts = assetClassesFacts(s, nowMs);
    if (acFacts) facts.assetClasses = acFacts;

    // B#3: NISA枠（backlog B #3）。未設定は nisa キー自体を省く（assetClasses と同型・両モード同値）。
    var niFacts = nisaFacts(s, nowMs);
    if (niFacts) facts.nisa = niFacts;

    if (includeRaw) {
      facts.raw = {
        monthlyExpense: num(s.monthlyExpense),
        bufferAmount: num(s.buckets.buffer.amount),
        bufferTarget: bufferTarget(s),
        bufferRemaining: bufferRemaining(s),
        coreAmount: core,
        satelliteAmount: sat,
        investable: inv,
        satelliteCap: cap,
        satelliteOver: over,
        totalAssets: total,
        goals: goalsArr.map(function (g, i) {
          return {
            index: i,
            label: String(g.label || ""),
            targetAmount: num(g.targetAmount),
            remaining: Math.max(0, num(g.targetAmount) - total),
            deadline: String(g.deadline || ""),
          };
        }),
      };
      var niRaw = nisaRaw(s, nowMs);
      if (niRaw) facts.raw.nisa = niRaw;
    }

    // Slice4: cashflow（収支連携）。opts.cashflow が渡された時のみ facts.cashflow を付与。
    // production は集約のみ／personal（includeRaw）は facts.raw.cashflow に生額も同梱。
    if (opts.cashflow !== undefined && opts.cashflow !== null) {
      var cd = cashflowDerived(opts.cashflow, s, nowMs);
      facts.cashflow = {
        available: cd.available,
        monthsCovered: clamp(cd.monthsCovered, 0, 999),
        insufficientData: cd.insufficientData,
        savingsRatePct: clamp(r(cd.savingsRatePctRaw), 0, 100),
        surplusPositive: cd.surplusPositive,
        surplusToExpensePct: clamp(r(num(s.monthlyExpense) > 0 ? cd.monthlySurplus / num(s.monthlyExpense) * 100 : 0), 0, 300),
        investableSurplusPositive: cd.investableSurplus > 0,
        nextDestination: cd.destination,
        monthsToBufferBucket: monthsToBufferBucket(cd.monthsToBufferComplete),
        surplusTrend: cd.trend,
        deficitMonthsInLast6: clamp(cd.deficitMonths, 0, 6),
        fixedBurdenBucket: cd.monthsCovered > 0 ? fixedBurdenBucket(cd.fixedBurdenRaw) : null,
        windfallPresent: cd.windfallPresent,
        dataFresh: cd.dataFresh,
        currencyMismatch: cd.currencyMismatch,
      };
      // ロードマップ ETA（積立のみ・0%・確保枠ドラッグ）。集約バケツのみ＝生月数は出さない。
      var _reserveMo = reserveMonthlyTotal(s, nowMs);
      var _coreContribution = Math.max(0, cd.monthlySurplus - _reserveMo);
      var _mToBuffer = typeof cd.monthsToBufferComplete === "number" ? cd.monthsToBufferComplete : projectMonths(bufferRemaining(s), cd.monthlySurplus);
      var _mToCore = projectMonths(coreProgress(s).remaining, _coreContribution);
      var _cumToCore = (_mToBuffer !== null && _mToCore !== null) ? _mToBuffer + _mToCore : null;
      facts.roadmap.etaToCoreBucket = cd.available ? etaBucket(_cumToCore) : "none";
      // B#3: 生涯枠充填 ETA も cashflow ペースで上書き（roadmap.etaToCoreBucket と同型・既定'none'を実バケツへ）。
      if (facts.nisa) facts.nisa.lifetimeFillEtaBucket = cd.available ? etaBucket(projectMonths(nisaDerive(s, nowMs).lifetimeRemaining, cd.investableSurplus)) : "none";
      // Slice4.5: 確保枠の補足advisory（NEXT_TARGETS は4据え置き＝新カテゴリにしない）。
      // reserves 設定時のみ付与（未設定 state は既存 facts.cashflow をバイト不変に保つ＝既存パリティ維持）。
      // 集約のみ（active=件数/fundedPct=比率/shortfall=bool）＝production でも生 yen を出さない。
      if (cd.reservesTotalTarget > 0) {
        facts.cashflow.reserves = {
          active: clamp(cd.reservesActive, 0, 50),
          fundedPct: clamp(r(cd.reservesFundedSaved / cd.reservesTotalTarget * 100), 0, 100),
          shortfall: cd.reservesShortfall,
        };
      }
      if (includeRaw) {
        facts.raw = facts.raw || {};
        facts.raw.cashflow = {
          monthlySurplus: cd.monthlySurplus,
          investableSurplus: cd.investableSurplus,
          toBuffer: cd.toBuffer,
          toCore: cd.toCore,
          toSatellite: cd.toSatellite,
          avgIncome: cd.avgIncome,
          avgExpense: cd.avgExpense,
          bufferRemaining: r(cd.bufferRemaining),
          monthsToBufferComplete: cd.monthsToBufferComplete,
          windfallTtm: cd.windfallTtm,
        };
        if (cd.reservesTotalTarget > 0) {  // personal のみ：確保枠の生額（本人合意）
          facts.raw.cashflow.toReserves = cd.toReserves;
          facts.raw.cashflow.reservesTotalSaved = cd.reservesTotalSaved;
          facts.raw.cashflow.reservesTotalTarget = cd.reservesTotalTarget;
        }
        var _plan = allocationPlan(s, cd);
        facts.raw.roadmap = {
          coreTarget: coreTarget(s),
          coreRemaining: coreProgress(s).remaining,
          northStarTarget: northStarTarget(s),
          thisMonthToCore: _plan.toCore,
          thisMonthToSatellite: _plan.toSatellite,
        };
      }
    }
    return facts;
  }

  // Slice4: 司令室UI 用 view model（UI専用・パリティ不要）。rows は /api/me/cashflow の生行。
  function cashflowViewModel(rows, rawState, nowMs) {
    var s = migrate(rawState);
    var cd = cashflowDerived(rows, s, nowMs);
    var latestComplete = null;
    for (var i = cd.rows.length - 1; i >= 0; i--) { if (cd.rows[i].isComplete) { latestComplete = cd.rows[i]; break; } }
    // 表示行＝確定月優先。確定月が無ければ当月(進行中)を出す。表示行とバッジを必ず整合させる（cf-partial-mismatch）。
    var disp = latestComplete || cd.latest || {};
    var bal = cfNum(disp.balance), inc = num(disp.totalIncome);
    var monthSavings = inc > 0 ? Math.round(bal / inc * 100) : 0; // 表示行の単月貯蓄率（収入/支出/収支と整合・cf-5）
    var applyPeriod = latestComplete ? latestComplete.period : "";
    var expenseDivergence = (cd.monthsCovered > 0 && num(s.monthlyExpense) > 0 &&
      Math.abs(cd.avgExpense - num(s.monthlyExpense)) / num(s.monthlyExpense) > 0.25); // 手動 monthlyExpense と実支出の乖離(cf-6)
    return {
      available: cd.available, hasData: cd.hasData, currencyMismatch: cd.currencyMismatch,
      insufficientData: cd.insufficientData, monthsCovered: cd.monthsCovered,
      latestPeriod: disp.period || "",
      latestIsPartial: disp.isComplete === false,
      income: inc, expense: num(disp.totalExpense),
      fixedExpense: num(disp.fixedExpense), variableExpense: num(disp.variableExpense),
      balance: bal, balanceFmt: yenSigned(bal), savingsRatePct: monthSavings,
      categories: (disp.breakdown && Array.isArray(disp.breakdown.categories)) ? disp.breakdown.categories.slice(0, 8) : [],
      monthlySurplus: cd.monthlySurplus, investableSurplus: cd.investableSurplus,
      toBuffer: cd.toBuffer, toCore: cd.toCore, toSatellite: cd.toSatellite,
      toReserves: cd.toReserves, reserves: cd.reserveAlloc, reservesShortfall: cd.reservesShortfall,
      reservesTotalSaved: cd.reservesTotalSaved, reservesTotalTarget: cd.reservesTotalTarget, reservesActive: cd.reservesActive,
      surplusPositive: cd.surplusPositive, bufferAchieved: cd.bufferAchieved,
      bufferRemaining: r(cd.bufferRemaining), monthsToBufferComplete: cd.monthsToBufferComplete,
      destination: cd.destination, windfallTtm: cd.windfallTtm, windfallPresent: cd.windfallPresent,
      trend: cd.trend, deficitMonths: cd.deficitMonths,
      avgExpense: cd.avgExpense, expenseDivergence: expenseDivergence,
      applyPeriod: applyPeriod,
      alreadyApplied: !!(s.lastAppliedCashflowPeriod && s.lastAppliedCashflowPeriod === applyPeriod),
      history: cd.rows.slice(-12).map(function (rr) { return { period: rr.period, balance: rr.balance, isComplete: rr.isComplete }; }),
      staleDays: cd.staleDays, dataFresh: cd.dataFresh, fmt: yen, fmtSigned: yenSigned,
    };
  }

  return {
    STORAGE_KEY: STORAGE_KEY, CURRENT_VERSION: CURRENT_VERSION,
    NEXT_TARGETS: NEXT_TARGETS, FACTS_SCHEMA_VERSION: FACTS_SCHEMA_VERSION,
    DISCLAIMER: DISCLAIMER, DISCLAIMER_VERSION: DISCLAIMER_VERSION,
    GLOSSARY: GLOSSARY, onboardingSteps: onboardingSteps,
    defaultState: defaultState, migrate: migrate, normalizeGoal: normalizeGoal,
    normalizeReserve: normalizeReserve, reserveMonthly: reserveMonthly,
    bufferTarget: bufferTarget, bufferProgress: bufferProgress, bufferRemaining: bufferRemaining,
    investable: investable, satelliteCap: satelliteCap, satelliteOver: satelliteOver,
    totalAssets: totalAssets, goalProgress: goalProgress,
    CORE_FALLBACK_MONTHS: CORE_FALLBACK_MONTHS, SATELLITE_UNLOCK_CORE_PCT: SATELLITE_UNLOCK_CORE_PCT,
    northStarTarget: northStarTarget, coreTarget: coreTarget,
    coreTargetSource: coreTargetSource, coreProgress: coreProgress,
    satelliteUnlocked: satelliteUnlocked, roadmapPhase: roadmapPhase,
    projectMonths: projectMonths, etaBucket: etaBucket,
    reserveMonthlyTotal: reserveMonthlyTotal, allocationPlan: allocationPlan, roadmap: roadmap,
    nextAllocation: nextAllocation, viewModel: viewModel, yen: yen, yenSigned: yenSigned,
    deadlineBucket: deadlineBucket, modeAFacts: modeAFacts,
    cashflowDerived: cashflowDerived, cashflowViewModel: cashflowViewModel,
    normalizeAnchor: normalizeAnchor, cashDerived: cashDerived,
    investmentDerived: investmentDerived,
    parseNum: parseNum, num: num, cfNum: cfNum, parseIsoMs: parseIsoMs, normalizeAssetHoldings: normalizeAssetHoldings, ASSET_CLASSES: ASSET_CLASSES,
    glidePath: glidePath, regionBreakdown: regionBreakdown,
    GROWTH_CLASSES: GROWTH_CLASSES, bucketTargets: bucketTargets, growDef: growDef,
    rSigned: rSigned, bucketCurrentPct: bucketCurrentPct,
    totalTargetPct: totalTargetPct, totalCurrentPct: totalCurrentPct, assetClassDrift: assetClassDrift,
    assetClassesFacts: assetClassesFacts,
    normalizeNisa: normalizeNisa,
    NISA_ANNUAL_TSUMITATE: NISA_ANNUAL_TSUMITATE, NISA_ANNUAL_GROWTH: NISA_ANNUAL_GROWTH,
    NISA_ANNUAL_TOTAL: NISA_ANNUAL_TOTAL, NISA_LIFETIME: NISA_LIFETIME,
    NISA_GROWTH_LIFETIME_CAP: NISA_GROWTH_LIFETIME_CAP,
    nisaNow: nisaNow, nisaDerive: nisaDerive,
    nisaFacts: nisaFacts, nisaRaw: nisaRaw,
    nisaViewModel: nisaViewModel,
  };
});
