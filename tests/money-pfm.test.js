const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../money-rules.js");

// ---- fixture ヘルパ（整数のみ・決定論）----
// startYM="2024-06" から balances.length ヶ月の API 生行を作る。opts.partialLast=true なら末尾行を is_complete:false に。
function mkRows(startYM, balances, opts) {
  opts = opts || {};
  var y = parseInt(startYM.slice(0, 4), 10), m = parseInt(startYM.slice(5, 7), 10) - 1;
  return balances.map(function (bal, i) {
    var mm = m + i, yy = y + Math.floor(mm / 12); mm = ((mm % 12) + 12) % 12;
    var period = yy + "-" + ("0" + (mm + 1)).slice(-2) + "-01";
    return {
      period: period, total_income: 350000, salary_income: 350000, misc_income: 0,
      fixed_expense: 140000, variable_expense: 350000 - 140000 - bal, total_expense: 350000 - bal,
      balance: bal, savings_rate: 0, is_complete: !(opts.partialLast && i === balances.length - 1),
      breakdown: null, pulled_at: "2026-08-27T00:00:00Z",
    };
  });
}
function mkState(extra) {
  return R.migrate(Object.assign({
    version: 2, currency: "JPY", monthlyExpense: 220000, bufferMonths: 6,
    buckets: { buffer: { amount: 0 }, core: { amount: 600000 }, satellite: { amount: 0 } },
    satelliteCapPct: 10, goals: [], reserves: [], updatedAt: 1,
    anchor: { date: "2025-03-01", amount: 1000000 },
  }, extra || {}));
}
// 2024-06 〜 2026-02 の21ヶ月確定＋2026-03 暫定。アンカー 2025-03（index 9）。
const BAL = [50000, 60000, -20000, 70000, 80000, 30000, 40000, 90000, -10000, 60000, 70000, 50000, 80000, 20000, 60000, 90000, 30000, 70000, 40000, 60000, 50000, 15000];
const ROWS = mkRows("2024-06", BAL, { partialLast: true });
const EFF = mkState();

test("assetSeries: 前方累積＝アンカー月から確定行を足す（不変条件: 最後の確定点 cash === derivedCash）", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  assert.equal(s.available, true);
  assert.equal(s.anchorPeriod, "2025-03-01");
  const cd = R.cashDerived(ROWS, [], EFF.anchor);
  const lastComplete = s.points[s.latestCompleteIndex];
  assert.equal(lastComplete.period, "2026-02-01");
  assert.equal(lastComplete.cash, cd.derivedCash);
  assert.equal(s.liveIndex, s.points.length - 1);
  assert.equal(s.points[s.liveIndex].isComplete, false);
  assert.equal(s.points[s.liveIndex].cash, cd.derivedCashLive);
  assert.equal(s.truncatedForward, false);
});

test("assetSeries: アンカー点＝アンカー月初＝前月末 = anchor.amount（isAnchor・beforeAnchor）", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  const a = s.points.find((p) => p.isAnchor);
  assert.equal(a.period, "2025-02-01");
  assert.equal(a.cash, 1000000);
  assert.equal(a.beforeAnchor, true);
  assert.equal(a.isComplete, true);
  // アンカー月（2025-03）の点 = anchor.amount + flow(2025-03)
  const m = s.points.find((p) => p.period === "2025-03-01");
  assert.equal(m.cash, 1000000 + BAL[9]);
});

test("assetSeries: 後方累積＝前月末 = 当月末 − flow(当月)・period 昇順・invest は全点同値", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  const jan = s.points.find((p) => p.period === "2025-01-01");  // = 2025-02 末 − flow(2025-02)
  assert.equal(jan.cash, 1000000 - BAL[8]);
  const first = s.points[0];
  assert.equal(first.period, "2024-05-01");  // 2024-06 の行から逆算した 2024-05 末
  assert.equal(first.cash, 1000000 - BAL.slice(0, 9).reduce((a, b) => a + b, 0));
  for (let i = 1; i < s.points.length; i++) assert.ok(s.points[i - 1].period < s.points[i].period);
  assert.ok(s.points.every((p) => p.invest === 600000 && p.total === p.cash + 600000));
  assert.equal(s.truncatedBackward, false);
});

test("assetSeries: 欠月で打切（前方は truncatedForward・後方は truncatedBackward）", () => {
  const gapF = ROWS.filter((r) => r.period !== "2025-08-01");
  const sf = R.assetSeries(EFF, gapF, []);
  assert.equal(sf.truncatedForward, true);
  assert.equal(sf.points[sf.points.length - 1].period, "2025-07-01");
  const gapB = ROWS.filter((r) => r.period !== "2024-10-01");
  const sb = R.assetSeries(EFF, gapB, []);
  assert.equal(sb.truncatedBackward, true);
  assert.equal(sb.points[0].period, "2024-10-01");  // 2024-11 の行から逆算した 2024-10 末まで
});

test("assetSeries: 途中の暫定行は打切・末尾の暫定行だけ liveIndex", () => {
  const rows = ROWS.map((r) => (r.period === "2025-10-01" ? Object.assign({}, r, { is_complete: false }) : r));
  const s = R.assetSeries(EFF, rows, []);
  assert.equal(s.truncatedForward, true);
  assert.equal(s.liveIndex, -1);
  assert.equal(s.points[s.points.length - 1].period, "2025-09-01");
});

test("assetSeries: invest_cash_flow は cashDerived と同じく flow に合流", () => {
  const inv = [{ period: "2025-06-01", invest_cash_flow: -100000 }];
  const s = R.assetSeries(EFF, ROWS, inv);
  const cd = R.cashDerived(ROWS, inv, EFF.anchor);
  assert.equal(s.points[s.latestCompleteIndex].cash, cd.derivedCash);
  const jun = s.points.find((p) => p.period === "2025-06-01"), may = s.points.find((p) => p.period === "2025-05-01");
  assert.equal(jun.cash - may.cash, BAL[12] - 100000);
});

test("assetSeries: 非 available の reason", () => {
  assert.equal(R.assetSeries(mkState({ anchor: null }), ROWS, []).reason, "noAnchor");
  assert.equal(R.assetSeries(EFF, [], []).reason, "noRows");
  assert.equal(R.assetSeries(EFF, mkRows("2026-03", [1000], { partialLast: true }), []).reason, "noCompleteRows");
  assert.equal(R.assetSeries(mkState({ currency: "USD" }), ROWS, []).reason, "currency");
  assert.deepEqual(R.assetSeries(EFF, [], []).points, []);
});

test("seriesWindow / normalizeSeriesPeriod", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  assert.deepEqual(R.SERIES_PERIODS, ["6M", "1Y", "2Y", "ALL"]);
  assert.equal(R.seriesWindow(s.points, "6M").length, 6);
  assert.equal(R.seriesWindow(s.points, "1Y").length, 12);
  assert.equal(R.seriesWindow(s.points, "2Y").length, s.points.length);  // 23点 < 24 なので ALL と同じ長さになる（下の合成30点配列で24点切出しを別途検証）
  assert.equal(R.seriesWindow(s.points, "ALL").length, s.points.length);
  // 2Y の24点切出し自体を検証（fixture は23点しかなく上のアサーションだけでは ALL と区別できないため、合成30点配列で確認）
  const synth = Array.from({ length: 30 }, (_, i) => ({ period: "synth-" + i }));
  assert.equal(R.seriesWindow(synth, "2Y").length, 24);
  assert.equal(R.seriesWindow(synth, "2Y")[0].period, synth[6].period);
  assert.equal(R.seriesWindow(synth, "2Y")[23].period, synth[29].period);
  assert.equal(R.seriesWindow(s.points, "6M")[5].period, s.points[s.points.length - 1].period);
  assert.equal(R.normalizeSeriesPeriod("bogus"), "1Y");
  assert.equal(R.normalizeSeriesPeriod(null), "1Y");
  assert.equal(R.normalizeSeriesPeriod("ALL"), "ALL");
});

test("momDelta: 直近2確定点の差・暫定点は無視・pct・符号", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  const m = R.momDelta(s.points);
  assert.equal(m.available, true);
  assert.equal(m.curPeriod, "2026-02-01");
  assert.equal(m.prevPeriod, "2026-01-01");
  assert.equal(m.delta, BAL[20]);
  assert.equal(m.sign, 1);
  const prev = s.points.find((p) => p.period === "2026-01-01");
  assert.ok(Math.abs(m.pct - (BAL[20] / prev.total) * 100) < 1e-9);
  assert.equal(R.momDelta([{ period: "2026-01-01", total: 1, isComplete: true }]).available, false);
  assert.equal(R.momDelta([{ period: "2025-12-01", total: 0, isComplete: true }, { period: "2026-01-01", total: 5, isComplete: true }]).pct, null);
  assert.equal(R.momDelta([{ period: "2025-12-01", total: 5, isComplete: true }, { period: "2026-01-01", total: 5, isComplete: true }]).sign, 0);
});

test("spanDelta: 最新確定点と months 個前の点", () => {
  const s = R.assetSeries(EFF, ROWS, []);
  const d = R.spanDelta(s.points, 12);
  assert.equal(d.available, true);
  assert.equal(d.toPeriod, "2026-02-01");
  assert.equal(d.fromPeriod, "2025-02-01");
  assert.equal(d.delta, BAL.slice(9, 21).reduce((a, b) => a + b, 0));
  assert.equal(R.spanDelta(s.points, 100).available, false);
});

const NOW_AUG = Date.UTC(2026, 7, 15);   // 2026-08-15
const NOW_NOV = Date.UTC(2026, 10, 15);  // 2026-11-15
const NOW_DEC = Date.UTC(2026, 11, 15);  // 2026-12-15

test("monthsBetweenYM: 同月0・翌月1・前月−1・年跨ぎ・不正null・reserveMonthly と同じ暦", () => {
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2026-08-31"), 0);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2026-09-01"), 1);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2026-07-31"), -1);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2027-01-15"), 5);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "2026-11"), 3);
  assert.equal(R.monthsBetweenYM(NOW_AUG, ""), null);
  assert.equal(R.monthsBetweenYM(NOW_AUG, "bogus"), null);
  assert.equal(R.monthsBetweenYM(0, "2026-11-30"), null);
  assert.equal(R.monthsBetweenYM(NaN, "2026-11-30"), null);
  // reserveMonthly（無改変）との一致: ceil(残額 / max(1, 月差))
  ["2026-11-30", "2026-08-31", "2027-06-30"].forEach((dl) => {
    const rv = R.normalizeReserve({ target: 300000, saved: 120000, deadline: dl }, 0);
    assert.equal(R.reserveMonthly(rv, NOW_AUG), Math.ceil(180000 / Math.max(1, R.monthsBetweenYM(NOW_AUG, dl))));
  });
});

test("runwayMonths: buffer/monthlyExpense・小数1桁・low の境界・生活費0は非available", () => {
  const s = mkState({ buckets: { buffer: { amount: 946000 }, core: { amount: 0 }, satellite: { amount: 0 } } });
  const rw = R.runwayMonths(s);
  assert.deepEqual(rw, { available: true, months: 4.3, target: 6, low: true });
  const eq = R.runwayMonths(mkState({ buckets: { buffer: { amount: 1320000 }, core: { amount: 0 }, satellite: { amount: 0 } } }));
  assert.equal(eq.months, 6); assert.equal(eq.low, false);
  assert.equal(R.runwayMonths(mkState({ monthlyExpense: 0 })).available, false);
});

test("goalOutlook: 各 status と eta/requiredMonthly", () => {
  const g = (target, deadline) => R.normalizeGoal({ label: "x", targetAmount: target, deadline: deadline || "" }, 0);
  assert.equal(R.goalOutlook(g(1000000, ""), 1000000, 50000, NOW_AUG).status, "achieved");
  assert.equal(R.goalOutlook(g(1000000, "2026-03-31"), 500000, 50000, NOW_AUG).status, "overdue");
  const on = R.goalOutlook(g(1000000, "2027-08-31"), 400000, 50000, NOW_AUG);   // 残600000 / 12ヶ月 = 50000 <= 50000
  assert.equal(on.status, "onTrack"); assert.equal(on.requiredMonthly, 50000); assert.equal(on.monthsLeft, 12);
  assert.equal(on.etaMonths, 12); assert.equal(on.etaPeriod, "2027-08");
  const be = R.goalOutlook(g(1000000, "2027-02-28"), 400000, 50000, NOW_AUG);   // 残600000 / 6 = 100000 > 50000
  assert.equal(be.status, "behind"); assert.equal(be.requiredMonthly, 100000);
  const nd = R.goalOutlook(g(1000000, ""), 400000, 50000, NOW_AUG);
  assert.equal(nd.status, "noDeadline"); assert.equal(nd.requiredMonthly, null); assert.equal(nd.etaPeriod, "2027-08");
  const np = R.goalOutlook(g(1000000, ""), 400000, 0, NOW_AUG);
  assert.equal(np.status, "noPace"); assert.equal(np.etaMonths, null); assert.equal(np.etaPeriod, "");
  // 期限あり・余剰0 → behind（必要月額は出る）
  const bz = R.goalOutlook(g(1000000, "2027-02-28"), 400000, 0, NOW_AUG);
  assert.equal(bz.status, "behind"); assert.equal(bz.requiredMonthly, 100000); assert.equal(bz.etaMonths, null);
  // 年跨ぎの etaPeriod
  assert.equal(R.goalOutlook(g(1000000, ""), 400000, 100000, Date.UTC(2026, 10, 1)).etaPeriod, "2027-05");
});

test("reserveOutlook: unknown/complete/noDeadline/overdue/short/onTrack・monthsLeft=0", () => {
  const ra = (o) => Object.assign({ id: "r", label: "r", target: 300000, saved: 120000, deadline: "2026-11-30", suggestedMonthly: 60000, allocated: 60000, complete: false }, o);
  assert.equal(R.reserveOutlook(ra({}), NOW_AUG, false).status, "unknown");
  assert.equal(R.reserveOutlook(ra({ complete: true, saved: 300000 }), NOW_AUG, true).status, "complete");
  assert.equal(R.reserveOutlook(ra({ deadline: "" }), NOW_AUG, true).status, "noDeadline");
  const od = R.reserveOutlook(ra({ deadline: "2026-06-30" }), NOW_AUG, true);
  assert.equal(od.status, "overdue"); assert.equal(od.projectedShortfall, 180000);
  const sh = R.reserveOutlook(ra({ allocated: 30000 }), NOW_AUG, true);   // 120000 + 30000×3 = 210000 → 不足 90000
  assert.equal(sh.status, "short"); assert.equal(sh.projectedShortfall, 90000); assert.equal(sh.projectedSaved, 210000);
  const ok = R.reserveOutlook(ra({}), NOW_AUG, true);                      // 120000 + 60000×3 = 300000
  assert.equal(ok.status, "onTrack"); assert.equal(ok.projectedShortfall, 0);
  const z = R.reserveOutlook(ra({ deadline: "2026-08-31", allocated: 180000 }), NOW_AUG, true);  // 今月が期日 → max(1,0)=1
  assert.equal(z.monthsLeft, 0); assert.equal(z.status, "onTrack");
});

test("nisaReminder: none / info / warn / urgent の月境界と monthlyToFillTotal", () => {
  const st = mkState({ nisa: { source: "manual", anchorYear: 2026, tsumitateThisYear: 300000, growthThisYear: 0, tsumitateLifetime: 300000, growthLifetime: 0 } });
  const cd = R.cashflowDerived(ROWS, st, NOW_AUG);
  const nvmAt = (now) => R.nisaViewModel(st, cd, now, []);
  assert.equal(R.nisaReminder(nvmAt(NOW_AUG), NOW_AUG).level, "info");
  assert.equal(R.nisaReminder(nvmAt(Date.UTC(2026, 8, 30)), Date.UTC(2026, 8, 30)).level, "info");   // 9月
  assert.equal(R.nisaReminder(nvmAt(Date.UTC(2026, 9, 1)), Date.UTC(2026, 9, 1)).level, "warn");     // 10月
  const nov = R.nisaReminder(nvmAt(NOW_NOV), NOW_NOV);
  assert.equal(nov.level, "warn"); assert.equal(nov.monthsLeft, 2); assert.equal(nov.remainingTotal, 3300000);
  assert.equal(nov.monthlyToFillTotal, 1650000); assert.equal(nov.remainingTsumitate, 900000); assert.equal(nov.remainingGrowth, 2400000);
  assert.equal(R.nisaReminder(nvmAt(NOW_DEC), NOW_DEC).level, "urgent");
  assert.equal(R.nisaReminder(R.nisaViewModel(mkState(), cd, NOW_NOV, []), NOW_NOV).level, "none");   // 未設定
  const full = mkState({ nisa: { source: "manual", anchorYear: 2026, tsumitateThisYear: 1200000, growthThisYear: 2400000, tsumitateLifetime: 3600000, growthLifetime: 2400000 } });
  assert.equal(R.nisaReminder(R.nisaViewModel(full, cd, NOW_NOV, []), NOW_NOV).level, "none");       // 残0
  assert.equal(R.nisaReminder(null, NOW_NOV).level, "none");
});

test("reminders: warn/urgent のみ・urgent→warn 順・同レベルは入力順・目標は含めない", () => {
  const out = R.reminders({
    nisa: { level: "warn", remainingTotal: 1 },
    reserves: [
      { id: "a", label: "A", deadline: "2026-11-30", allocated: 1, outlook: { status: "short", projectedShortfall: 1 } },
      { id: "b", label: "B", deadline: "2026-06-30", allocated: 0, outlook: { status: "overdue", projectedShortfall: 2 } },
      { id: "c", label: "C", deadline: "", allocated: 0, outlook: { status: "onTrack", projectedShortfall: 0 } },
    ],
  });
  assert.deepEqual(out.map((x) => x.key + ":" + (x.id) + ":" + x.level), ["reserve:b:urgent", "nisa:nisa:warn", "reserve:a:warn"]);
  assert.equal(out[0].jump, "reserves"); assert.equal(out[1].jump, "nisa"); assert.equal(out[2].deadline, "2026-11-30");
  assert.deepEqual(R.reminders({ nisa: { level: "info" }, reserves: [] }), []);
  assert.deepEqual(R.reminders(null), []);
});
