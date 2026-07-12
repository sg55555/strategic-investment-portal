// scratchpad/roadmap-ui-smoke.js — Task6 UI roadmapSection(money.js) 機能スモーク。
// 使い方: .venv/bin/python scratchpad/mock_prod_server.py & \
//         NODE_PATH=/home/shugo/node_modules node scratchpad/roadmap-ui-smoke.js ; kill %1
//
// mock_prod_server.py (127.0.0.1:8200) 前提（本番 index.html + /api/market/* モック配信）。
// /api/auth/session と /api/me/{cashflow,investment,state} は本スクリプトが page.route() で
// 差し替える（ログイン/未ログイン・収支データ有無を決定論的に切替えるため。mock_prod_server 自体は
// /api/auth/session を常に ok:true で返す実装のため、未ログイン状態を作るにはルート差し替えが必要）。
//
// 検証観点（DOM/挙動のみ・GPUのグロー等の見た目は対象外＝実機の仕事）:
//   1) #mcc-sec-roadmap のフェーズレール（.mcc-rm-phase 3枚）が描画される
//   2) 未ログイン（/api/auth/session→401 差し替え）: roadmap セクション内に ¥ 数字が出ない
//   3) ログイン（/api/auth/session→ok:true・/api/me/cashflow にモック収支データ）:
//      今月配分カード(#mcc-rm-thismonth) に ¥ が出る
//   4) サテライトのロック⇄解放が state（コア進捗）に追従する（同一ロード内で core.amount を動かして確認）
//   5) applySurplus クリックで core.amount のみ増加・satellite は不変（localStorage の mcc_state で確認）
//   6) pageerror 0
//   7) Finding1回帰: ログイン＋連携済み＋赤字/均衡月（monthlySurplus<=0・available=true）→
//      今月配分/タイムラインに「余力がありません」の赤字メッセージが出て、「家計（kakeibo）を連携」の
//      ジャンプリンクは出ない（連携済みユーザーへの誤ったリンクCTAを防ぐ）
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8200";

function yenDigitPresent(text) {
  return /¥[\d,]/.test(text || "");
}

// 収支スナップショット3ヶ月分（決定論・balance一定=150,000円/月）→ monthlySurplus=150,000 を作る。
const CASHFLOW_ROWS = ["2026-04-01", "2026-05-01", "2026-06-01"].map((period) => ({
  period, total_income: 400000, salary_income: 400000, misc_income: 0,
  fixed_expense: 150000, variable_expense: 100000, total_expense: 250000,
  balance: 150000, savings_rate: 37.5, is_complete: true, breakdown: null,
  pulled_at: "2026-07-01T00:00:00Z",
}));

// Finding1回帰: 連携済み（=rows あり・available=true）だが赤字月（expense>=income・balance<0）
// → monthlySurplus は money-rules.js cashflowDerived() の r(Math.max(0, median(...))) により 0 に clamp される
// （赤字/均衡は同じ枝）。available=true・monthlySurplus<=0 の組み合わせを決定論的に作る。
const CASHFLOW_ROWS_DEFICIT = ["2026-04-01", "2026-05-01", "2026-06-01"].map((period) => ({
  period, total_income: 350000, salary_income: 350000, misc_income: 0,
  fixed_expense: 200000, variable_expense: 160000, total_expense: 360000,
  balance: -10000, savings_rate: -2.9, is_complete: true, breakdown: null,
  pulled_at: "2026-07-01T00:00:00Z",
}));

async function routeSessionLoggedOut(page) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) }));
}

async function routeSessionLoggedIn(page) {
  await page.unroute("**/api/auth/session").catch(() => {});
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, insightEnabled: false }) }));
  await page.route("**/api/me/cashflow", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cashflow: CASHFLOW_ROWS }) }));
  await page.route("**/api/me/investment", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ investment: [] }) }));
  await page.route("**/api/me/state", (route) => {
    if (route.request().method() === "PUT") {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    } else {
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: null }) });
    }
  });
}

async function roadmapSnapshot(page) {
  return page.evaluate(() => {
    const el = document.getElementById("mcc-sec-roadmap");
    if (!el) return null;
    const phases = [...el.querySelectorAll(".mcc-rm-phase")].map((p) => ({
      key: p.dataset.key,
      cls: p.className,
      text: p.textContent,
    }));
    const thisMonth = document.getElementById("mcc-rm-thismonth");
    const timeline = el.querySelector(".mcc-rm-timeline");
    return {
      exists: true,
      html: el.innerHTML,
      text: el.textContent,
      phases,
      thisMonthText: thisMonth ? thisMonth.textContent : null,
      timelineText: timeline ? timeline.textContent : null,
    };
  });
}

async function getState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("mcc_state") || "null"));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  const results = {};

  try {
    // ============ フェーズA: 未ログイン ============
    await routeSessionLoggedOut(page);
    await page.goto(BASE + "/?diag=off", { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
      { timeout: 8000 }
    ).catch(() => {});

    await page.evaluate(() => { localStorage.removeItem("mcc_state"); });
    await page.click(".mcc-nav-btn"); // → showView("money") → MCC.show() → checkSession()(401)
    await page.waitForTimeout(400);

    let snap = await roadmapSnapshot(page);
    results.sec1_sectionExists = !!snap && snap.exists;
    results.sec1_railHas3Phases = !!snap && snap.phases.length === 3;
    results.sec1_railKeysOk = !!snap && JSON.stringify(snap.phases.map((p) => p.key)) === JSON.stringify(["buffer", "core", "satellite"]);
    results.sec1_noYenLoggedOut = !!snap && !yenDigitPresent(snap.text);
    results.sec1_snapshot = snap;

    // まだ月支出が未設定＝setup 段。ここで生活費/バッファ/コアを設定して "core" フェーズ・サテライト施錠へ進める。
    await page.evaluate(() => {
      MCC.setField("monthlyExpense", 300000);
      MCC.setField("bufferMonths", 6);
      MCC.setField("buckets.buffer.amount", 1800000); // バッファ100%達成
      MCC.setField("buckets.core.amount", 900000);    // フォールバック目標7,200,000の12.5%＝サテライト施錠のまま
    });
    await page.waitForTimeout(150);
    snap = await roadmapSnapshot(page);
    const bufferPhase = snap.phases.find((p) => p.key === "buffer");
    const corePhase = snap.phases.find((p) => p.key === "core");
    const satPhase = snap.phases.find((p) => p.key === "satellite");
    results.sec2_bufferDone = !!bufferPhase && /mcc-rm-phase-done/.test(bufferPhase.cls);
    results.sec2_coreCurrent = !!corePhase && /mcc-rm-phase-current/.test(corePhase.cls);
    results.sec2_satelliteLocked = !!satPhase && /mcc-rm-phase-locked/.test(satPhase.cls) && /🔒/.test(satPhase.text);
    results.sec2_noYenStillLoggedOut = !yenDigitPresent(snap.text);
    results.sec2_snapshot = snap;

    // コアを50%まで積み増す → サテライト解放（🔒解除・satelliteフェーズがcurrentへ）
    await page.evaluate(() => { MCC.setField("buckets.core.amount", 3600000); });
    await page.waitForTimeout(150);
    snap = await roadmapSnapshot(page);
    const satPhase2 = snap.phases.find((p) => p.key === "satellite");
    results.sec3_satelliteUnlockedNow = !!satPhase2 && !/mcc-rm-phase-locked/.test(satPhase2.cls) && /mcc-rm-phase-current/.test(satPhase2.cls);
    results.sec3_satChipUnlocked = /mcc-rm-satchip-unlocked/.test(snap.html) && /解放中/.test(snap.text);
    results.sec3_noYenStillLoggedOut = !yenDigitPresent(snap.text);
    results.sec3_snapshot = snap;

    const stateBeforeLogin = await getState(page);
    results.stateAfterPhaseA = stateBeforeLogin;

    // ============ フェーズB: ログイン（モックセッション + 収支データ）============
    await routeSessionLoggedIn(page);
    await page.reload({ waitUntil: "networkidle" }); // _sessionChecked をリセットして再チェックさせる
    await page.waitForFunction(
      () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
      { timeout: 8000 }
    ).catch(() => {});
    await page.click(".mcc-nav-btn");
    await page.waitForTimeout(600); // checkSession→reconcile/loadCashflow/loadInvestment の完了待ち

    snap = await roadmapSnapshot(page);
    results.sec4_thisMonthHasYen = !!snap && !!snap.thisMonthText && yenDigitPresent(snap.thisMonthText);
    results.sec4_railStillRenders = !!snap && snap.phases.length === 3;
    results.sec4_snapshot = snap;

    // applySurplus: 既存ボタン（cashflowSection内）をクリック → core のみ増加・satellite不変
    const stateBeforeApply = await getState(page);
    const applyBtn = await page.$(".mcc-cf-apply:not([disabled])");
    results.applyBtnFound = !!applyBtn;
    if (applyBtn) {
      await applyBtn.click();
      await page.waitForTimeout(300);
      const stateAfterApply = await getState(page);
      const coreBefore = stateBeforeApply.buckets.core.amount;
      const coreAfter = stateAfterApply.buckets.core.amount;
      const satBefore = stateBeforeApply.buckets.satellite.amount;
      const satAfter = stateAfterApply.buckets.satellite.amount;
      results.sec5_coreIncreased = coreAfter > coreBefore;
      results.sec5_satelliteUnchanged = satAfter === satBefore;
      results.sec5_deltas = { coreBefore, coreAfter, satBefore, satAfter };
    } else {
      results.sec5_coreIncreased = false;
      results.sec5_satelliteUnchanged = false;
    }

    // ============ フェーズC: ログイン＋連携済み＋赤字/均衡月（Finding1回帰）============
    // /api/me/cashflow だけを赤字データに差し替えて再読込。session/investment/state ルートはフェーズBのまま。
    await page.unroute("**/api/me/cashflow").catch(() => {});
    await page.route("**/api/me/cashflow", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cashflow: CASHFLOW_ROWS_DEFICIT }) }));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
      { timeout: 8000 }
    ).catch(() => {});
    await page.click(".mcc-nav-btn");
    await page.waitForTimeout(600);

    snap = await roadmapSnapshot(page);
    const deficitMsgRe = /余力がありません/;
    const jumpLinkRe = /家計（kakeibo）を連携/;
    results.sec6_thisMonthShowsDeficitMsg = !!snap && !!snap.thisMonthText && deficitMsgRe.test(snap.thisMonthText);
    results.sec6_thisMonthNoJumpLink = !!snap && !!snap.thisMonthText && !jumpLinkRe.test(snap.thisMonthText);
    results.sec6_timelineShowsDeficitMsg = !!snap && !!snap.timelineText && deficitMsgRe.test(snap.timelineText);
    results.sec6_timelineNoJumpLink = !!snap && !!snap.timelineText && !jumpLinkRe.test(snap.timelineText);
    results.sec6_noJumpLinkAnywhereInRoadmap = !!snap && !jumpLinkRe.test(snap.text);
    results.sec6_snapshot = snap;

    results.pageerrors = errors;

    const pass =
      results.sec1_sectionExists && results.sec1_railHas3Phases && results.sec1_railKeysOk && results.sec1_noYenLoggedOut &&
      results.sec2_bufferDone && results.sec2_coreCurrent && results.sec2_satelliteLocked && results.sec2_noYenStillLoggedOut &&
      results.sec3_satelliteUnlockedNow && results.sec3_satChipUnlocked && results.sec3_noYenStillLoggedOut &&
      results.sec4_thisMonthHasYen && results.sec4_railStillRenders &&
      results.applyBtnFound && results.sec5_coreIncreased && results.sec5_satelliteUnchanged &&
      results.sec6_thisMonthShowsDeficitMsg && results.sec6_thisMonthNoJumpLink &&
      results.sec6_timelineShowsDeficitMsg && results.sec6_timelineNoJumpLink && results.sec6_noJumpLinkAnywhereInRoadmap &&
      errors.length === 0;

    console.log(JSON.stringify(results, null, 2));
    console.log(pass ? "PASS" : "FAIL");
    process.exit(pass ? 0 : 1);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error("SMOKE FAILED:", e && e.stack || e);
  process.exit(1);
});
