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
  var FACTS_SCHEMA_VERSION = 2; // v2: Slice4 cashflow（収支連携→投資余力）集約を facts に追加
  // 免責（node↔browser 単一源・全描画経路で決定論と不可分に常時表示）。
  var DISCLAIMER = "本コーチが示す決定論ルールおよび AI の補足はいずれも、資産規律の維持・教育・判断支援を目的とした一般的な情報提供であり、特定の金融商品の売買や投資配分・タイミングを推奨する投資助言ではありません。当ツールは金融商品取引業者・投資助言代理業者として登録された者による助言ではなく、特定の金融商品の勧誘を目的としたものでもありません。将来の利益や成果を保証するものではありません（過去の実績は将来を示しません）。最終的な投資判断はご自身の責任で行ってください。";
  var DISCLAIMER_VERSION = "disc-v1";

  function num(v) { var n = Number(v); return isFinite(n) && n >= 0 ? n : 0; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function r(x) { return Math.floor(num(x) + 0.5); } // half-up（全値非負前提・Python 還元器とパリティ）
  function yen(n) { return "¥" + Math.round(num(n)).toLocaleString("ja-JP"); }
  function yenSigned(n) { var x = Math.round(Number(n) || 0); return (x < 0 ? "-¥" : "¥") + Math.abs(x).toLocaleString("ja-JP"); } // 収支(負あり)表示用（cf-balance-zero）

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
      lastAppliedCashflowPeriod: "", // Slice4: 直近で applySurplus 済みの確定 period（多重計上ガード・クラウド同期）
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
      lastAppliedCashflowPeriod: (typeof raw.lastAppliedCashflowPeriod === "string" && _DATE_RE.test(raw.lastAppliedCashflowPeriod)) ? raw.lastAppliedCashflowPeriod : "",
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

  // ── Slice4: 収支連携 → 投資余力（純関数・advice.py mode_a_facts と鏡像／fixture でパリティ固定）──
  function cfNum(v) { var n = Number(v); return isFinite(n) ? n : 0; } // 符号付き（balance は負あり）
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
    var investableSurplus = Math.max(0, monthlySurplus - toBuffer);
    var toCore = investableSurplus;   // 既定は全額コア（サテライトは上限内リバランス操作限定）
    var toSatellite = 0;
    var monthsToBufferComplete = bufferAchieved ? 0
      : (monthlySurplus > 0 && bufferRem > 0 ? Math.ceil(bufferRem / monthlySurplus) : null);
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
      var pt = Date.parse(latest.pulledAt);
      if (isFinite(pt)) staleDays = Math.max(0, Math.floor((num(nowMs) - pt) / 86400000));
    }
    var dataFresh = staleDays === null ? null : (staleDays < 35);

    return {
      hasData: hasData, currencyMismatch: currencyMismatch, available: hasData && !currencyMismatch,
      monthsCovered: monthsCovered, insufficientData: insufficientData,
      base: base, monthlySurplus: monthlySurplus, surplusPositive: base > 0,
      requiredBuffer: requiredBuffer, bufferRemaining: bufferRem,
      bufferConfigured: bufferConfigured, bufferAchieved: bufferAchieved,
      toBuffer: toBuffer, investableSurplus: investableSurplus, toSatellite: toSatellite, toCore: toCore,
      monthsToBufferComplete: monthsToBufferComplete, destination: destination,
      savingsRatePctRaw: savingsRatePctRaw, fixedBurdenRaw: fixedBurdenRaw, trend: trend,
      deficitMonths: deficitMonths, windfallTtm: windfallTtm, windfallPresent: windfallTtm > 0,
      avgIncome: avgIncome, avgExpense: avgExpense, staleDays: staleDays, dataFresh: dataFresh,
      latest: latest, rows: parsed,
    };
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
    defaultState: defaultState, migrate: migrate, normalizeGoal: normalizeGoal,
    bufferTarget: bufferTarget, bufferProgress: bufferProgress, bufferRemaining: bufferRemaining,
    investable: investable, satelliteCap: satelliteCap, satelliteOver: satelliteOver,
    totalAssets: totalAssets, goalProgress: goalProgress,
    nextAllocation: nextAllocation, viewModel: viewModel, yen: yen, yenSigned: yenSigned,
    deadlineBucket: deadlineBucket, modeAFacts: modeAFacts,
    cashflowDerived: cashflowDerived, cashflowViewModel: cashflowViewModel,
  };
});
