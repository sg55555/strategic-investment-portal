// money-rules.js — お金の司令塔(MCC) 純関数ロジック。
// ブラウザ(window.MCCRules) と Node(require) の両対応(UMD-lite)。副作用なし。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MCCRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var STORAGE_KEY = "mcc_state";
  var CURRENT_VERSION = 1;

  function num(v) { var n = Number(v); return isFinite(n) && n >= 0 ? n : 0; }
  function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
  function yen(n) { return "¥" + Math.round(num(n)).toLocaleString("ja-JP"); }

  function defaultState() {
    return {
      version: CURRENT_VERSION,
      currency: "JPY",
      monthlyExpense: 0,
      bufferMonths: 6,
      buckets: { buffer: { amount: 0 }, core: { amount: 0 }, satellite: { amount: 0 } },
      satelliteCapPct: 10,
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
    return {
      currency: s.currency,
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

  return {
    STORAGE_KEY: STORAGE_KEY, CURRENT_VERSION: CURRENT_VERSION,
    defaultState: defaultState, migrate: migrate,
    bufferTarget: bufferTarget, bufferProgress: bufferProgress, bufferRemaining: bufferRemaining,
    investable: investable, satelliteCap: satelliteCap, satelliteOver: satelliteOver,
    nextAllocation: nextAllocation, viewModel: viewModel, yen: yen,
  };
});
