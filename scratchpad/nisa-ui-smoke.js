// scratchpad/nisa-ui-smoke.js — Task9 UI nisaSection(money.js) 機能スモーク。
// 使い方:
//   .venv/bin/python scratchpad/mock_prod_server.py &
//   NODE_PATH=/home/shugo/node_modules node scratchpad/nisa-ui-smoke.js ; kill %1
//
// mock_prod_server.py (127.0.0.1:8200) 前提（本番 index.html + money.js/money-rules.js/money.css をモック配信）。
// /api/auth/session 等は本スクリプトが page.route() で差し替える（b2-ui-smoke.js と同型）。
//
// 検証観点（DOM/挙動のみ・GPUのグロー/ガラス等の見た目は対象外＝実機の仕事）:
//   1) #mcc-sec-nisa が存在する（未設定でも常時レンダリング＝入力欄を出す）
//   2) 未設定: 手入力欄は常時表示・¥readoutは出ない
//   3) 使用状況を入力(setField nisa.*)→configured化→HUD/ドーナツ/バー/ゲージ/チップが描画される
//   4) 未ログイン: %/バー/構造は描画されるが ¥ は一切出ない（readout gate）
//   5) ログイン: ¥ が出る（HUD・stat・legend系）
//   6) 入力欄(nisa.*)から setField→state.nisa に反映・再描画される
//   7) jumpTo('nisa') が #mcc-sec-nisa へスクロール（要素解決）できる
//   8) pageerror 0
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

async function nisaSnapshot(page) {
  return page.evaluate(() => {
    const el = document.getElementById("mcc-sec-nisa");
    if (!el) return null;
    // hasYen は「データ readout」面(HUD/hero/grid2/chips/readout)のみを対象にする。
    // .mcc-nisa-gate の固定注記文言「¥はログイン時のみ表示（未ログインは%のみ）。」は
    // ルール自体の説明テキスト（mock 直系のコピー）であり、readout gate の対象外＝
    // 未ログインでも常時表示される仕様（personal/cap の¥値そのものではない）。
    const dataEls = [
      el.querySelector(".mcc-nisa-hud"),
      el.querySelector(".mcc-nisa-hero"),
      el.querySelector(".mcc-nisa-grid2"),
      el.querySelector(".mcc-nisa-chips"),
      el.querySelector(".mcc-nisa-readout"),
    ].filter(Boolean);
    const dataText = dataEls.map((e) => e.textContent).join(" ");
    return {
      exists: true,
      html: el.innerHTML,
      text: el.textContent,
      hasYen: /¥/.test(dataText),
      readoutMuted: !!el.querySelector(".mcc-nisa-readout-muted"),
      hudCount: el.querySelectorAll(".mcc-nisa-hud .h").length,
      donutExists: !!el.querySelector(".mcc-nisa-donutwrap"),
      gaugeCount: el.querySelectorAll(".mcc-nisa-grid2 .mcc-nisa-card").length,
      chipCount: el.querySelectorAll(".mcc-nisa-chip").length,
      inputFieldCount: el.querySelectorAll(".mcc-nisa-input input[type=number]").length,
      segCount: el.querySelectorAll(".mcc-nisa-seg").length,
      legendText: (el.querySelector(".mcc-nisa-legend") || {}).textContent || "",
    };
  });
}

async function getState(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("mcc_state") || "null"));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 2600 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String((e && e.message) || e)));
  const results = {};

  try {
    // ============ フェーズA: 未ログイン・NISA未設定 ============
    await routeSessionLoggedOut(page);
    await page.goto(BASE + "/?diag=off", { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
      { timeout: 8000 }
    ).catch(() => {});

    await page.evaluate(() => { localStorage.removeItem("mcc_state"); });
    await page.click(".mcc-nav-btn"); // → showView("money") → MCC.show() → checkSession()(401)
    await page.waitForTimeout(400);

    let snap = await nisaSnapshot(page);
    results.sec1_sectionExists = !!snap && snap.exists;
    results.sec2_readoutMutedWhenUnconfigured = !!snap && snap.readoutMuted;
    results.sec2_noHudWhenUnconfigured = !!snap && snap.hudCount === 0;
    // 手入力欄は未設定でも常時表示（6フィールド）
    results.sec2_inputFieldsPresentUnconfigured = !!snap && snap.inputFieldCount === 6;
    results.sec2_noYenUnconfigured = !!snap && !snap.hasYen;
    results.sec1_snapshotBefore = snap;

    // ============ フェーズB: 使用状況を入力（configured化）============
    await page.evaluate(() => {
      MCC.setField("nisa.anchorYear", 2026);
      MCC.setField("nisa.tsumitateThisYear", 600000);
      MCC.setField("nisa.growthThisYear", 1000000);
      MCC.setField("nisa.tsumitateLifetime", 2200000);
      MCC.setField("nisa.growthLifetime", 3000000);
      MCC.setField("nisa.soldThisYearAtCost", 800000);
    });
    await page.waitForTimeout(150);
    snap = await nisaSnapshot(page);
    results.sec3_hudRenders = !!snap && snap.hudCount === 5;
    results.sec3_donutRenders = !!snap && snap.donutExists;
    results.sec3_gaugesRender = !!snap && snap.gaugeCount >= 2; // hero + 2 mini（neonb cardは全て.mcc-nisa-card）
    results.sec3_segsRender = !!snap && snap.segCount >= 2; // 生涯総枠2段+当年2ゲージ分
    results.sec3_chipsRender = !!snap && snap.chipCount >= 2; // 満額まで + 復活予定（+staleYear警告=2026年なら年一致でstaleではない想定）
    results.sec3_snapshotConfigured = snap;

    // ============ フェーズC: 未ログインで ¥ は一切出ない（%/バー/構造は出る）============
    results.sec4_noYenLoggedOut = !!snap && !snap.hasYen;
    results.sec4_hasPercentSign = !!snap && /%/.test(snap.text || "");

    // 未ログインでの手入力保存確認（localStorage）
    const stateAfterInput = await getState(page);
    results.sec6_inputsSavedLocally =
      !!stateAfterInput && !!stateAfterInput.nisa &&
      stateAfterInput.nisa.tsumitateThisYear === 600000 &&
      stateAfterInput.nisa.growthThisYear === 1000000 &&
      stateAfterInput.nisa.soldThisYearAtCost === 800000;

    // ============ フェーズD: jumpTo('nisa') が要素解決できる ============
    const scrolledOk = await page.evaluate(() => {
      const el = document.getElementById("mcc-sec-nisa");
      if (!el) return false;
      let called = false;
      const orig = el.scrollIntoView;
      el.scrollIntoView = function () { called = true; };
      MCC.jumpTo("nisa");
      el.scrollIntoView = orig;
      return called;
    });
    results.sec7_jumpToResolves = scrolledOk;

    // ============ フェーズE: ログイン → ¥ が出る ============
    await routeSessionLoggedIn(page);
    await page.reload({ waitUntil: "networkidle" }); // _sessionChecked をリセットして再チェックさせる
    await page.waitForFunction(
      () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
      { timeout: 8000 }
    ).catch(() => {});
    await page.click(".mcc-nav-btn");
    await page.waitForTimeout(600); // checkSession→reconcile 完了待ち

    snap = await nisaSnapshot(page);
    results.sec5_yenAppearsLoggedIn = !!snap && snap.hasYen;
    results.sec5_snapshotLoggedIn = snap;
    // review Critical対応の確認: ログイン時、セグメント凡例(つみたて分/成長分)は¥金額で出て
    // 独自計算の"%"テキストは出ない(¥はvm.lifetime.tsumitatePortion/growthPortion由来・money.js非計算)。
    results.sec5_legendShowsYenNotPercent =
      !!snap && /¥/.test(snap.legendText || "") && !/つみたて分\s*\d+%|成長分\s*\d+%/.test(snap.legendText || "");

    // ============ フェーズF: setField による再描画反映（ログイン中）============
    await page.evaluate(() => { MCC.setField("nisa.tsumitateThisYear", 900000); });
    await page.waitForTimeout(150);
    const stateAfterRelogin = await getState(page);
    results.sec6_setFieldUpdatesStateLoggedIn =
      !!stateAfterRelogin && stateAfterRelogin.nisa.tsumitateThisYear === 900000;
    snap = await nisaSnapshot(page);
    // review Minor: 旧アサーションは `|| snap.hasYen` が既にログイン中で恒真（tautology）だった。
    // 新値(¥900,000)が実際に再描画テキストに反映されているかを厳格に(AND)検証する。
    results.sec6_rerenderReflectsNewValue = !!snap && /90万|900,000/.test(snap.text || "") && snap.hasYen;

    // ============ フェーズG: 統合チェック（既存セクションと共存）============
    const integ = await page.evaluate(() => {
      function nonEmpty(id) {
        const el = document.getElementById(id);
        return !!el && el.textContent.trim().length > 20;
      }
      return {
        roadmapPresent: nonEmpty("mcc-sec-roadmap"),
        assetsPresent: nonEmpty("mcc-sec-assets"),
        nisaPresent: nonEmpty("mcc-sec-nisa"),
        cashflowPresent: nonEmpty("mcc-sec-cashflow"),
        bucketsPresent: nonEmpty("mcc-sec-buckets"),
      };
    });
    results.sec8_allSectionsCoexist =
      integ.roadmapPresent && integ.assetsPresent && integ.nisaPresent &&
      integ.cashflowPresent && integ.bucketsPresent;
    results.integrationSnapshot = integ;

    results.pageerrors = errors;

    const pass =
      results.sec1_sectionExists &&
      results.sec2_readoutMutedWhenUnconfigured && results.sec2_noHudWhenUnconfigured &&
      results.sec2_inputFieldsPresentUnconfigured && results.sec2_noYenUnconfigured &&
      results.sec3_hudRenders && results.sec3_donutRenders && results.sec3_gaugesRender &&
      results.sec3_segsRender && results.sec3_chipsRender &&
      results.sec4_noYenLoggedOut && results.sec4_hasPercentSign &&
      results.sec6_inputsSavedLocally &&
      results.sec7_jumpToResolves &&
      results.sec5_yenAppearsLoggedIn && results.sec5_legendShowsYenNotPercent &&
      results.sec6_setFieldUpdatesStateLoggedIn && results.sec6_rerenderReflectsNewValue &&
      results.sec8_allSectionsCoexist &&
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
