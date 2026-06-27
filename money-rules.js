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
  var FACTS_SCHEMA_VERSION = 1; // modeAFacts スキーマ版（版ずれ監査）
  // 免責（node↔browser 単一源・全描画経路で決定論と不可分に常時表示）。
  var DISCLAIMER = "本コーチが示す決定論ルールおよび AI の補足はいずれも、資産規律の維持・教育・判断支援を目的とした一般的な情報提供であり、特定の金融商品の売買や投資配分・タイミングを推奨する投資助言ではありません。当ツールは金融商品取引業者・投資助言代理業者として登録された者による助言ではなく、特定の金融商品の勧誘を目的としたものでもありません。将来の利益や成果を保証するものではありません（過去の実績は将来を示しません）。最終的な投資判断はご自身の責任で行ってください。";
  var DISCLAIMER_VERSION = "disc-v1";

  function num(v) { var n = Number(v); return isFinite(n) && n >= 0 ? n : 0; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function r(x) { return Math.floor(num(x) + 0.5); } // half-up（全値非負前提・Python 還元器とパリティ）
  function yen(n) { return "¥" + Math.round(num(n)).toLocaleString("ja-JP"); }

  var _DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  // goal の安全な正規化（migrate と新規追加の両方で使う・純粋）。
  function normalizeGoal(g, i) {
    return {
      id: (g && typeof g.id === "string" && /^[A-Za-z0-9_-]+$/.test(g.id)) ? g.id : "goal-" + i,
      label: (g && typeof g.label === "string") ? g.label : "",
      targetAmount: num(g && g.targetAmount),
      deadline: (g && typeof g.deadline === "string" && _DATE_RE.test(g.deadline)) ? g.deadline : "",
    };
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
      updatedAt: 0, // last-write-wins 用の epoch ms（刻むのは money.js・ここは受け渡しのみ）
      history: [],
    };
  }

  function migrate(raw) {
    var d = defaultState();
    if (!raw || typeof raw !== "object") return d;
    var b = raw.buckets || {};
    return {
      version: CURRENT_VERSION,
      currency: typeof raw.currency === "string" ? raw.currency : d.currency,
      monthlyExpense: num(raw.monthlyExpense),
      bufferMonths: Number(raw.bufferMonths) > 0 ? num(raw.bufferMonths) : d.bufferMonths,
      buckets: {
        buffer: { amount: num(b.buffer && b.buffer.amount) },
        core: { amount: num(b.core && b.core.amount) },
        satellite: { amount: num(b.satellite && b.satellite.amount) },
      },
      satelliteCapPct: Number(raw.satelliteCapPct) >= 0 ? num(raw.satelliteCapPct) : d.satelliteCapPct,
      goals: Array.isArray(raw.goals)
        ? raw.goals.filter(function (g) { return g && typeof g === "object" && !Array.isArray(g); }).map(normalizeGoal)
        : [],
      updatedAt: num(raw.updatedAt),
      history: Array.isArray(raw.history)
        ? raw.history.filter(function (h) { return h && typeof h.date === "string"; })
            .map(function (h) { return { date: h.date, buffer: num(h.buffer), core: num(h.core), satellite: num(h.satellite) }; })
        : [],
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
    var t = Date.parse(deadline + "T00:00:00Z");
    if (!isFinite(t)) return null;
    var months = (t - num(nowMs)) / (30.44 * 86400000);
    if (months < 0) return "overdue";
    if (months < 3) return "under_3m";
    if (months < 12) return "3_12m";
    if (months < 36) return "1_3y";
    return "over_3y";
  }

  // Slice3: 生 state → Mode A 集約ファクト（純粋）。AI規律コーチへ渡す唯一の境界。
  // 必ず migrate() で全フィールドを coerce（文字列/NaN/巨大配列/不正日付を強制正規化）してから、
  // allowlist キーのみで新規 dict を構築する（viewModel をスプレッドしない・history を走査しない）。
  // opts.includeRawAmounts=true（個人モード・本人合意）でのみ生額・目標ラベルを raw に同梱する。
  // production（既定）の戻り値には生額・ラベル・生日付が一切含まれない＝Mode A の構造保証。
  function modeAFacts(rawState, opts) {
    opts = opts || {};
    var includeRaw = !!opts.includeRawAmounts;
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
    }
    return facts;
  }

  return {
    STORAGE_KEY: STORAGE_KEY, CURRENT_VERSION: CURRENT_VERSION,
    NEXT_TARGETS: NEXT_TARGETS, FACTS_SCHEMA_VERSION: FACTS_SCHEMA_VERSION,
    DISCLAIMER: DISCLAIMER, DISCLAIMER_VERSION: DISCLAIMER_VERSION,
    defaultState: defaultState, migrate: migrate, normalizeGoal: normalizeGoal,
    bufferTarget: bufferTarget, bufferProgress: bufferProgress, bufferRemaining: bufferRemaining,
    investable: investable, satelliteCap: satelliteCap, satelliteOver: satelliteOver,
    totalAssets: totalAssets, goalProgress: goalProgress,
    nextAllocation: nextAllocation, viewModel: viewModel, yen: yen,
    deadlineBucket: deadlineBucket, modeAFacts: modeAFacts,
  };
});
