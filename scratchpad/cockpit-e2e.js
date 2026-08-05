// scratchpad/cockpit-e2e.js — Task A5（実効値方式の render 配線）E2E スモーク。
//
// 使い方（この1行で1コマンド。HTTP サーバはこのスクリプトが自前で起動/停止する）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/cockpit-e2e.js
//
// 何を確かめるか（brief Step3 の5点）:
//   1. バッファ達成率ゲージの表示値が「実効値」由来（保存 state の 111 でなく導出現金 ¥1,070,000／100%）
//   2. バケツのバッファ欄が read-only 表示（input 無し）＋「自動連動中」バッジ＋「基準を変更」導線
//   3. 余剰反映ボタンが無く autonote が出る（＋ applySurplus() を直接叩いても保存 state が動かない＝防衛ゲート）
//   4. anchor 無し state では従来 UI（input・反映ボタン）＝manual 無回帰（実際に反映が効くところまで）
//   5. pageerror 0
//
// 方針: 実 index.html ＋ 実 money.js / money-rules.js / money.css を **無改造で** 配信し、
//       差し替えるのは fetch/route レベル（/api/auth/session・/api/me/state・/api/me/cashflow・
//       /api/me/investment・/api/market/list）だけ＝本番と同じコードパスを通す。
//       シナリオ間の localStorage 汚染を避けるため、シナリオごとに新しい BrowserContext を作る。
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }

const ROOT = path.resolve(__dirname, "..");
const PORT = 8231;
const BASE = "http://127.0.0.1:" + PORT;

// ---- フィクスチャ（決定論・すべて整数＝丸め境界に依存しない）----
// 基準 2026-07-01 に ¥1,000,000、確定月 2026-07 の収支 +¥70,000 → 導出現金 ¥1,070,000。
// バッファ目標 = 月の生活費 150,000 × 6ヶ月 = ¥900,000 → 達成率は clamp されて 100%。
// 保存 state の buckets.buffer.amount=111 は「実効値に上書きされて表示されないこと」の証拠用ダミー。
const ANCHOR_AMOUNT = 1000000;
const ROW_BALANCE = 70000;
const DERIVED_CASH = ANCHOR_AMOUNT + ROW_BALANCE; // 1,070,000
const STALE_BUFFER = 111;

function baseState(extra) {
  const s = {
    version: 3,
    currency: "JPY",
    monthlyExpense: 150000,
    bufferMonths: 6,
    buckets: { buffer: { amount: STALE_BUFFER }, core: { amount: 0 }, satellite: { amount: 0 } },
    satelliteCapPct: 10,
    goals: [],
    reserves: [],
    lastAppliedCashflowPeriod: "",
    updatedAt: 2000000000000, // 2033年＝ローカル(既定 updatedAt:0)より必ず新しい→reconcile で cloud 採用
  };
  return Object.assign(s, extra || {});
}

const STATE_ANCHOR = baseState({ anchor: { date: "2026-07-01", amount: ANCHOR_AMOUNT } });
const STATE_MANUAL = baseState({}); // anchor 無し＝manual モード（従来どおりの UI/挙動）

const CASHFLOW_ROWS = [{
  period: "2026-07-01",
  total_income: 500000,
  salary_income: 500000,
  misc_income: 0,
  fixed_expense: 200000,
  variable_expense: 230000,
  total_expense: 430000,
  balance: ROW_BALANCE,
  is_complete: true,
  pulled_at: new Date().toISOString(),
}];

// ---- 静的配信（python3 -m http.server・リポ直下をそのまま）----
function startServer() {
  const proc = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1", "--directory", ROOT],
    { stdio: ["ignore", "ignore", "ignore"] });
  return proc;
}

function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(BASE + "/index.html", (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else retry();
      });
      req.on("error", retry);
    };
    const retry = () => {
      if (Date.now() > deadline) reject(new Error("http.server did not become ready"));
      else setTimeout(tick, 120);
    };
    tick();
  });
}

// ---- ルート差し替え（fetch/route レベル・実ファイルは無改造）----
async function mockApi(context, stateFixture) {
  const json = (route, body, status) => route.fulfill({
    status: status || 200, contentType: "application/json", body: JSON.stringify(body),
  });
  await context.route("**/api/auth/session", (route) =>
    json(route, { ok: true, insightEnabled: false, nisaAdviceEnabled: false }));
  await context.route("**/api/me/state", (route) =>
    route.request().method() === "PUT" ? json(route, { ok: true }) : json(route, { state: stateFixture }));
  await context.route("**/api/me/cashflow", (route) => json(route, { cashflow: CASHFLOW_ROWS }));
  await context.route("**/api/me/investment", (route) => json(route, { investment: [] }));
  // 市場データは本タスクの対象外。空で返すと index.html が dataLoadState="error" で早期 return し、
  // ポータル grid を描かない＝司令室の検証にノイズ（無関係な例外）を持ち込まない。
  await context.route("**/api/market/**", (route) => json(route, { stocks: {}, updated_at: "" }));
}

// 司令室を開き、セッション確認→reconcile→収支/投資ロード→再描画までを待つ。
async function openCockpit(page) {
  await page.goto(BASE + "/?diag=off", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => { try { localStorage.removeItem("mcc_state"); } catch (e) {} });
  await page.evaluate(() => MCC.show());
  // cashflowSection は loggedIn かつ rows 到着後にしか出ない＝両方の完了シグナルになる。
  await page.waitForSelector("#mcc-sec-cashflow", { timeout: 8000 });
  await page.waitForTimeout(250); // probeNisaCap 由来の追随 render を吸収
}

async function snapshot(page) {
  return page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const txt = (sel) => { const e = q(sel); return e ? e.textContent.trim() : null; };
    const bucketsEl = q("#mcc-sec-buckets");
    const bufferBucket = bucketsEl ? bucketsEl.querySelector(".mcc-bucket") : null;
    const bufferInput = q('#mcc-sec-buckets input[data-mcc-focus="buckets.buffer.amount"]');
    const cfEl = q("#mcc-sec-cashflow");
    return {
      gaugeText: txt(".mcc-gauge-card"),
      gaugeFillWidth: (q(".mcc-gauge-fill") || {}).style ? q(".mcc-gauge-fill").style.width : null,
      bufferInputExists: !!bufferInput,
      bufferInputValue: bufferInput ? bufferInput.value : null,
      autoBadgeText: txt(".mcc-auto-badge"),
      autoValText: txt(".mcc-bucket-auto-val"),
      autoJumpText: bufferBucket ? ((bufferBucket.querySelector(".mcc-jump") || {}).textContent || null) : null,
      bufferNoteText: txt(".mcc-bucket-note"),
      // コア/サテライトの入力欄は連動中も従来どおり（連動対象は buffer だけ）
      otherBucketInputs: bucketsEl
        ? bucketsEl.querySelectorAll('input[data-mcc-focus="buckets.core.amount"], input[data-mcc-focus="buckets.satellite.amount"]').length
        : 0,
      applyBtnExists: !!(cfEl && cfEl.querySelector(".mcc-cf-apply")),
      applyBtnText: cfEl && cfEl.querySelector(".mcc-cf-apply") ? cfEl.querySelector(".mcc-cf-apply").textContent.trim() : null,
      autoNoteText: cfEl && cfEl.querySelector(".mcc-cf-autonote") ? cfEl.querySelector(".mcc-cf-autonote").textContent.trim() : null,
      anchorMainText: txt(".mcc-anchor-main"),
      storedBuffer: (() => {
        try { return JSON.parse(localStorage.getItem("mcc_state") || "null").buckets.buffer.amount; }
        catch (e) { return null; }
      })(),
      storedApplied: (() => {
        try { return JSON.parse(localStorage.getItem("mcc_state") || "null").lastAppliedCashflowPeriod; }
        catch (e) { return null; }
      })(),
    };
  });
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail === undefined ? "" : String(detail) });
}

(async () => {
  const server = startServer();
  let browser = null;
  const pageErrors = [];
  try {
    await waitForServer(15000);
    browser = await chromium.launch();

    // ============ シナリオA: 基準（アンカー）連動中 ============
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    await mockApi(ctxA, STATE_ANCHOR);
    const pageA = await ctxA.newPage();
    pageA.on("pageerror", (e) => pageErrors.push("A:" + String((e && e.message) || e)));
    await openCockpit(pageA);
    const a = await snapshot(pageA);

    // --- アサート1: ゲージが実効値由来 ---
    check("A1_gauge_shows_derived_amount", /¥1,070,000/.test(a.gaugeText || ""), a.gaugeText);
    check("A1_gauge_pct_100", /100%/.test(a.gaugeText || ""), a.gaugeText);
    check("A1_gauge_not_stale_manual_value", !/¥111\b/.test(a.gaugeText || ""), a.gaugeText);
    check("A1_gauge_fill_100pct", a.gaugeFillWidth === "100%", a.gaugeFillWidth);
    check("A1_anchor_block_agrees", /¥1,070,000/.test(a.anchorMainText || ""), a.anchorMainText);

    // --- アサート2: バケツのバッファ欄が read-only 表示＋バッジ ---
    check("A2_buffer_input_absent", a.bufferInputExists === false, a.bufferInputValue);
    check("A2_auto_badge", a.autoBadgeText === "自動連動中", a.autoBadgeText);
    check("A2_auto_value_is_effective", a.autoValText === "¥1,070,000", a.autoValText);
    check("A2_jump_to_anchor_present", a.autoJumpText === "基準を変更", a.autoJumpText);
    check("A2_other_bucket_inputs_intact", a.otherBucketInputs === 2, a.otherBucketInputs);
    check("A2_no_fallback_note_when_linked", a.bufferNoteText === null, a.bufferNoteText);
    // inline onclick は公開APIの export 漏れがあっても「押しても無反応」で無音故障する＝実際に押して確かめる
    // （jumpTo は対象要素に .mcc-jump-flash を付ける＝ハンドラ到達の観測点）。
    await pageA.click("#mcc-sec-buckets .mcc-bucket .mcc-jump");
    await pageA.waitForTimeout(150);
    const jumped = await pageA.evaluate(() => {
      const el = document.getElementById("mcc-sec-cashflow");
      return !!el && el.classList.contains("mcc-jump-flash");
    });
    check("A2_jump_handler_reaches_cashflow", jumped === true, jumped);

    // --- アサート3: 反映ボタン無し＋autonote／applySurplus 防衛ゲート ---
    check("A3_apply_button_absent", a.applyBtnExists === false, a.applyBtnText);
    check("A3_autonote_shown", a.autoNoteText === "基準連動中は貯蓄額が自動追従するため反映操作は不要です", a.autoNoteText);
    check("A3_saved_state_untouched_by_render", a.storedBuffer === STALE_BUFFER, a.storedBuffer);
    // UI を迂回して直接呼んでも二重計上しない（関数側ゲート）
    await pageA.evaluate(() => MCC.applySurplus());
    await pageA.waitForTimeout(200);
    const aAfter = await snapshot(pageA);
    check("A3_applySurplus_gated_buffer", aAfter.storedBuffer === STALE_BUFFER, aAfter.storedBuffer);
    check("A3_applySurplus_gated_period", aAfter.storedApplied === "", aAfter.storedApplied);
    check("A3_display_still_derived", aAfter.autoValText === "¥1,070,000", aAfter.autoValText);
    await ctxA.close();

    // ============ シナリオB: anchor 無し＝manual 無回帰 ============
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    await mockApi(ctxB, STATE_MANUAL);
    const pageB = await ctxB.newPage();
    pageB.on("pageerror", (e) => pageErrors.push("B:" + String((e && e.message) || e)));
    await openCockpit(pageB);
    const b = await snapshot(pageB);

    // --- アサート4: 従来 UI（input・反映ボタン）＝manual 無回帰 ---
    check("B4_buffer_input_present", b.bufferInputExists === true, b.bufferInputValue);
    check("B4_buffer_input_value_is_saved", Number(b.bufferInputValue) === STALE_BUFFER, b.bufferInputValue);
    check("B4_no_auto_badge", b.autoBadgeText === null, b.autoBadgeText);
    check("B4_no_autonote", b.autoNoteText === null, b.autoNoteText);
    check("B4_apply_button_present", b.applyBtnExists === true, b.applyBtnText);
    check("B4_apply_button_enabled_label", /規律配分/.test(b.applyBtnText || ""), b.applyBtnText);
    check("B4_no_fallback_note_when_logged_in_with_rows", b.bufferNoteText === null, b.bufferNoteText);
    check("B4_gauge_uses_saved_value", /¥111/.test(b.gaugeText || ""), b.gaugeText);
    // 反映が実際に効く（従来どおり buffer に toBuffer=70,000 が積まれる）
    await pageB.click("#mcc-sec-cashflow .mcc-cf-apply");
    await pageB.waitForTimeout(250);
    const bAfter = await snapshot(pageB);
    check("B4_applySurplus_works", bAfter.storedBuffer === STALE_BUFFER + ROW_BALANCE, bAfter.storedBuffer);
    check("B4_applied_period_recorded", bAfter.storedApplied === "2026-07-01", bAfter.storedApplied);
    check("B4_apply_button_becomes_disabled", /反映済み/.test(bAfter.applyBtnText || ""), bAfter.applyBtnText);
    await ctxB.close();

    // --- アサート5: pageerror 0 ---
    check("C5_no_page_errors", pageErrors.length === 0, JSON.stringify(pageErrors));
  } catch (e) {
    check("HARNESS_COMPLETED", false, (e && e.stack) || e);
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.kill("SIGTERM");
  }

  const failed = results.filter((r) => !r.pass);
  results.forEach((r) => console.log((r.pass ? "PASS " : "FAIL ") + r.name + (r.detail ? "  [" + r.detail + "]" : "")));
  console.log("----");
  console.log(results.length - failed.length + "/" + results.length + " asserts passed, pageerrors=" + pageErrors.length);
  console.log(failed.length ? "FAIL" : "ALL PASS");
  process.exit(failed.length ? 1 : 0);
})();
