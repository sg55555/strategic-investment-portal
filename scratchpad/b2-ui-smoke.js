// scratchpad/b2-ui-smoke.js — Task6 UI assetClassSection(money.js) 機能スモーク。
// 使い方:
//   .venv/bin/python scratchpad/mock_prod_server.py &
//   NODE_PATH=/home/shugo/node_modules node scratchpad/b2-ui-smoke.js ; kill %1
//
// mock_prod_server.py (127.0.0.1:8200) 前提（本番 index.html + money.js/money-rules.js/money.css をモック配信）。
// /api/auth/session 等は本スクリプトが page.route() で差し替える（roadmap-ui-smoke.js と同型）。
//
// 検証観点（DOM/挙動のみ・GPUのグロー/ガラス等の見た目は対象外＝実機の仕事）:
//   1) #mcc-sec-assets が存在する
//   2) 生年未入力: 読み出し非表示（「生年を入力」促し）・ドーナツ/バー/レール非描画
//   3) 生年入力(setField birthYear)→ドーナツ中心の成長/守り%・読み出し・legend 7件が更新される
//   4) 目標バー(.mcc-ac-stack 1本目)のセグメント数が7以下（未分類なし＝目標ドーナツ/バーは7クラスのみ）
//   5) ドリフトレール(.mcc-ac-driftrow)が7行
//   6) 未ログインで手入力欄(.mcc-ac-input 内の moneyInput)が消えない・¥readout(.mcc-ac-yen)は出ない
//   7) 手入力(setField assetHoldings.core.jpEq)→現状バー/ドリフトが更新される（localStorage 保存）
//   8) ログイン時のみ ¥readout(.mcc-ac-yen) が出る
//   9) スコープトグル(acSetScope)でバー/legend が変わる
//   10) 「現状は現金のみ」クイックフィル→assetHoldings.buffer.cash が総額になる
//   11) pageerror 0
const { chromium } = require("playwright");

const BASE = "http://127.0.0.1:8200";

async function routeSessionLoggedOut(page) {
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) }));
}

async function routeSessionLoggedIn(page) {
  await page.unroute("**/api/auth/session").catch(() => {});
  await page.route("**/api/auth/session", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, insightEnabled: false }) }));
  await page.route("**/api/me/cashflow", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cashflow: [] }) }));
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

async function acSnapshot(page) {
  return page.evaluate(() => {
    const el = document.getElementById("mcc-sec-assets");
    if (!el) return null;
    const target = document.querySelectorAll(".mcc-ac-stack")[0];
    const current = document.querySelectorAll(".mcc-ac-stack")[1];
    return {
      exists: true,
      html: el.innerHTML,
      text: el.textContent,
      readoutText: (el.querySelector(".mcc-ac-readout") || {}).textContent || null,
      readoutMuted: !!el.querySelector(".mcc-ac-readout-muted"),
      centerText: (el.querySelector(".mcc-ac-center") || {}).textContent || null,
      legendCount: el.querySelectorAll(".mcc-ac-leg").length,
      targetSegCount: target ? target.querySelectorAll(".mcc-ac-seg").length : 0,
      driftRowCount: el.querySelectorAll(".mcc-ac-driftrow").length,
      donutExists: !!el.querySelector(".mcc-ac-donutwrap"),
      inputFieldCount: el.querySelectorAll(".mcc-ac-input input[type=number]").length,
      yenReadoutExists: !!el.querySelector(".mcc-ac-yen"),
      yenReadoutText: (el.querySelector(".mcc-ac-yen") || {}).textContent || null,
    };
  });
}

async function getState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("mcc_state") || "null"));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 2400 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  const results = {};

  try {
    // ============ フェーズA: 未ログイン・生年未設定 ============
    await routeSessionLoggedOut(page);
    await page.goto(BASE + "/?diag=off", { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
      { timeout: 8000 }
    ).catch(() => {});

    await page.evaluate(() => { localStorage.removeItem("mcc_state"); });
    await page.click(".mcc-nav-btn"); // → showView("money") → MCC.show() → checkSession()(401)
    await page.waitForTimeout(400);

    let snap = await acSnapshot(page);
    results.sec1_sectionExists = !!snap && snap.exists;
    results.sec2_readoutMutedWhenUnconfigured = !!snap && snap.readoutMuted;
    results.sec2_noRailWhenUnconfigured = !!snap && snap.driftRowCount === 0;
    results.sec2_noDonutBarsWhenUnconfigured = !!snap && snap.targetSegCount === 0;
    // 手入力欄・トグル・クイックフィルは生年未設定でも常時表示（§3.4/§5-7）
    results.sec6_inputFieldsPresentUnconfigured = !!snap && snap.inputFieldCount === 15; // buffer(1)+core(7)+satellite(7)
    results.sec1_snapshotBefore = snap;

    // ============ フェーズB: 生年を入力（configured化）============
    await page.evaluate(() => { MCC.setField("birthYear", 1986); });
    await page.waitForTimeout(150);
    snap = await acSnapshot(page);
    results.sec3_readoutShowsAge = !!snap && /あなた\(40歳\)/.test(snap.readoutText || "");
    results.sec3_centerShowsGrowDef = !!snap && /成長 70%/.test(snap.centerText || "") && /守り 30%/.test(snap.centerText || "");
    results.sec3_legendHas7 = !!snap && snap.legendCount === 7;
    results.sec4_targetSegAtMost7 = !!snap && snap.targetSegCount <= 7 && snap.targetSegCount > 0;
    results.sec5_driftRows7 = !!snap && snap.driftRowCount === 7;
    results.sec6_noYenReadoutLoggedOut = !!snap && !snap.yenReadoutExists;
    results.sec6_inputFieldsPresentConfigured = !!snap && snap.inputFieldCount === 15;
    results.sec3_snapshotAfterBirthYear = snap;

    // ============ フェーズC: 未ログインで手入力（localStorage保存・ドリフト更新）============
    const stateBeforeInput = await getState(page);
    await page.evaluate(() => { MCC.setField("assetHoldings.core.jpEq", 500000); });
    await page.waitForTimeout(150);
    const stateAfterInput = await getState(page);
    results.sec7_holdingsSavedLocally =
      !!stateAfterInput && !!stateAfterInput.assetHoldings &&
      stateAfterInput.assetHoldings.core.jpEq === 500000 &&
      (!stateBeforeInput || !stateBeforeInput.assetHoldings || stateBeforeInput.assetHoldings.core.jpEq !== 500000);
    snap = await acSnapshot(page);
    // 現状バー(.mcc-ac-stack 2本目)にセグメントが出る（分類済みholdingsが入った＝currentが空でなくなった）
    const currentSegCount = await page.evaluate(() => {
      const stacks = document.querySelectorAll("#mcc-sec-assets .mcc-ac-stack");
      return stacks[1] ? stacks[1].querySelectorAll(".mcc-ac-seg").length : 0;
    });
    results.sec7_currentBarHasSegAfterInput = currentSegCount > 0;
    // ドリフトレールに jpEq の "→ 現状 100%" が現れる（core scope・単一クラスのみ入力なのでabsorbTo100で100%）
    results.sec7_driftReflectsInput = /国内株[\s\S]*?目標[\s\S]*?→ 現状 100%/.test(snap.text || "");
    results.sec7_snapshotAfterHoldingsInput = snap;

    // ============ フェーズD: スコープトグル（コア→総資産）============
    const legendBefore = snap.html;
    await page.evaluate(() => { MCC.acSetScope("total"); });
    await page.waitForTimeout(150);
    snap = await acSnapshot(page);
    results.sec9_scopeToggleChangesHtml = snap.html !== legendBefore;
    results.sec9_totalBtnActive = await page.evaluate(() => {
      const btns = document.querySelectorAll("#mcc-sec-assets .mcc-ac-tbtn");
      return Array.from(btns).some((b) => /総資産で俯瞰/.test(b.textContent) && b.className.indexOf("on") >= 0);
    });
    await page.evaluate(() => { MCC.acSetScope("core"); }); // 以降のテストのためcoreへ戻す
    await page.waitForTimeout(150);

    // ============ フェーズE: 「現状は現金のみ」クイックフィル ============
    // まず総資産(buckets.amount)を用意してから実行（0だとfill先も0で判別しにくいため）。
    await page.evaluate(() => {
      MCC.setField("buckets.buffer.amount", 200000);
      MCC.setField("buckets.core.amount", 300000);
      MCC.setField("buckets.satellite.amount", 0);
    });
    await page.waitForTimeout(150);
    const totalBefore = await page.evaluate(() => MCCRules.totalAssets(JSON.parse(localStorage.getItem("mcc_state"))));
    await page.evaluate(() => { MCC.acFillCashOnly(); });
    await page.waitForTimeout(150);
    const stateAfterFill = await getState(page);
    results.sec10_quickFillSetsCashToTotal =
      !!stateAfterFill && stateAfterFill.assetHoldings.buffer.cash === totalBefore && totalBefore > 0;

    // ============ フェーズF: ログイン → ¥readout が出る ============
    await routeSessionLoggedIn(page);
    await page.reload({ waitUntil: "networkidle" }); // _sessionChecked をリセットして再チェックさせる
    await page.waitForFunction(
      () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
      { timeout: 8000 }
    ).catch(() => {});
    await page.click(".mcc-nav-btn");
    await page.waitForTimeout(600); // checkSession→reconcile/loadCashflow/loadInvestment の完了待ち

    snap = await acSnapshot(page);
    results.sec8_yenReadoutAppearsLoggedIn = !!snap && snap.yenReadoutExists;
    results.sec8_snapshotLoggedIn = snap;

    results.pageerrors = errors;

    const pass =
      results.sec1_sectionExists &&
      results.sec2_readoutMutedWhenUnconfigured && results.sec2_noRailWhenUnconfigured && results.sec2_noDonutBarsWhenUnconfigured &&
      results.sec6_inputFieldsPresentUnconfigured &&
      results.sec3_readoutShowsAge && results.sec3_centerShowsGrowDef && results.sec3_legendHas7 &&
      results.sec4_targetSegAtMost7 && results.sec5_driftRows7 &&
      results.sec6_noYenReadoutLoggedOut && results.sec6_inputFieldsPresentConfigured &&
      results.sec7_holdingsSavedLocally && results.sec7_currentBarHasSegAfterInput && results.sec7_driftReflectsInput &&
      results.sec9_scopeToggleChangesHtml && results.sec9_totalBtnActive &&
      results.sec10_quickFillSetsCashToTotal &&
      results.sec8_yenReadoutAppearsLoggedIn &&
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
