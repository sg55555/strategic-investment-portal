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

// D2: 当月（進行中）行を足した版。確定値 derivedCash（1,070,000）と参考値 derivedCashLive（1,040,000）が
// **食い違う**状態を作る＝ヒーローの「当月込みの参考値」ブロックが出る条件（同額なら出さない仕様）。
const PARTIAL_BALANCE = -30000;
const DERIVED_CASH_LIVE = DERIVED_CASH + PARTIAL_BALANCE; // 1,040,000
const CASHFLOW_ROWS_PARTIAL = CASHFLOW_ROWS.concat([{
  period: "2026-08-01",
  total_income: 500000,
  salary_income: 500000,
  misc_income: 0,
  fixed_expense: 200000,
  variable_expense: 330000,
  total_expense: 530000,
  balance: PARTIAL_BALANCE,
  is_complete: false,
  pulled_at: new Date().toISOString(),
}]);

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
async function mockApi(context, stateFixture, cashflowRows) {
  const rows = cashflowRows === undefined ? CASHFLOW_ROWS : cashflowRows;
  const json = (route, body, status) => route.fulfill({
    status: status || 200, contentType: "application/json", body: JSON.stringify(body),
  });
  await context.route("**/api/auth/session", (route) =>
    json(route, { ok: true, insightEnabled: false, nisaAdviceEnabled: false }));
  await context.route("**/api/me/state", (route) =>
    route.request().method() === "PUT" ? json(route, { ok: true }) : json(route, { state: stateFixture }));
  await context.route("**/api/me/cashflow", (route) => json(route, { cashflow: rows }));
  await context.route("**/api/me/investment", (route) => json(route, { investment: [] }));
  // 市場データは本タスクの対象外。空で返すと index.html が dataLoadState="error" で早期 return し、
  // ポータル grid を描かない＝司令室の検証にノイズ（無関係な例外）を持ち込まない。
  await context.route("**/api/market/**", (route) => json(route, { stocks: {}, updated_at: "" }));
}

// 司令室を開き、セッション確認→reconcile→収支/投資ロード→再描画までを待つ。
async function openCockpit(page) {
  await page.goto(BASE + "/?diag=off", { waitUntil: "domcontentloaded" });
  // D1: mcc_tab（表示中タブ）も消す。config が残ったコンテキストだと収支セクションが hidden のままで、
  // 下の waitForSelector（既定 state:"visible"）が 8 秒ハングして無関係な失敗になる。
  await page.evaluate(() => { try { localStorage.removeItem("mcc_state"); localStorage.removeItem("mcc_tab"); } catch (e) {} });
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
      bufferNoteHasJump: !!q(".mcc-bucket-note .mcc-jump"),
      // B1: この端末での最終取得（fetchinfo）／取得失敗（fetcherr）の可視化。
      fetchNoteId: !!q("#mcc-cf-fetchnote"),
      fetchInfoText: txt(".mcc-cf-fetchinfo"),
      fetchErrText: txt(".mcc-cf-fetcherr"),
      cfStatsHaveYen: cfEl
        ? Array.from(cfEl.querySelectorAll(".mcc-cf-stat strong")).some((el) => /¥/.test(el.textContent))
        : false,
      // コア/サテライトの入力欄は連動中も従来どおり（連動対象は buffer だけ）
      otherBucketInputs: bucketsEl
        ? bucketsEl.querySelectorAll('input[data-mcc-focus="buckets.core.amount"], input[data-mcc-focus="buckets.satellite.amount"]').length
        : 0,
      applyBtnExists: !!(cfEl && cfEl.querySelector(".mcc-cf-apply")),
      applyBtnText: cfEl && cfEl.querySelector(".mcc-cf-apply") ? cfEl.querySelector(".mcc-cf-apply").textContent.trim() : null,
      autoNoteText: cfEl && cfEl.querySelector(".mcc-cf-autonote") ? cfEl.querySelector(".mcc-cf-autonote").textContent.trim() : null,
      // D2: 導出現金の**金額表示**はヒーローへ一本化＝収支カード側の .mcc-anchor-main は消えている。
      // 「何を基準にしているか」の1行（.mcc-anchor-sub）と「基準を変更」ボタンは入力の文脈として残る。
      anchorMainText: txt(".mcc-anchor-main"),
      anchorSubText: txt(".mcc-anchor-sub"),
      anchorEditExists: !!q(".mcc-anchor-edit"),
      anchorFormExists: !!q(".mcc-anchor-form"),
      // D2: ヒーロー（サマリー）
      heroExists: !!q(".mcc-hero"),
      heroLabelText: txt(".mcc-hero-label"),
      heroAmountText: txt(".mcc-hero-amount"),
      heroBasisText: txt(".mcc-hero-basis"),
      heroBasisJumpText: q(".mcc-hero-basis .mcc-jump") ? q(".mcc-hero-basis .mcc-jump").textContent.trim() : null,
      heroChipLiveText: txt(".mcc-hero-chip-live"),
      heroChipProvText: txt(".mcc-hero-chip-prov"),
      heroRefAmountText: txt(".mcc-hero-ref-amount"),
      heroAutoBadgeText: txt(".mcc-hero-badge-auto"),
      heroGaugePctText: txt(".mcc-hero-gauge-pct"),
      heroGaugeFillWidth: q(".mcc-hero-gauge-fill") ? q(".mcc-hero-gauge-fill").style.width : null,
      heroGaugeNoteText: txt(".mcc-hero-side .mcc-hero-ref-note"),
      heroPowerText: txt(".mcc-hero-power"),
      heroPowerNoneText: txt(".mcc-hero-power-none"),
      heroNextText: txt(".mcc-hero-next"),
      heroNextClass: q(".mcc-hero-next") ? q(".mcc-hero-next").className : null,
      heroDoneBadgeText: txt(".mcc-hero-badge-done"),
      // D2 重複統合の観測点：banner は廃止・鮮度行は文書内に1個だけでヒーロー配下・チップは収支のみ。
      bannerExists: !!q(".mcc-banner"),
      fetchNoteCount: document.querySelectorAll("#mcc-cf-fetchnote").length,
      fetchNoteInHero: !!q(".mcc-hero #mcc-cf-fetchnote"),
      cfWfChips: document.querySelectorAll("#mcc-sec-cashflow .mcc-wf").length,
      rmWfChips: document.querySelectorAll("#mcc-rm-thismonth .mcc-wf").length,
      rmWfText: txt("#mcc-rm-thismonth .mcc-rm-wf-text"),
      freshTxt: txt(".mcc-cf-fresh-txt"),
      storedBuffer: (() => {
        try { return JSON.parse(localStorage.getItem("mcc_state") || "null").buckets.buffer.amount; }
        catch (e) { return null; }
      })(),
      storedApplied: (() => {
        try { return JSON.parse(localStorage.getItem("mcc_state") || "null").lastAppliedCashflowPeriod; }
        catch (e) { return null; }
      })(),
      storedCash: (() => {
        try { return JSON.parse(localStorage.getItem("mcc_state") || "null").assetHoldings.buffer.cash; }
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
    // D2 期待変更: 導出現金の金額表示は収支カード（.mcc-anchor-main）からヒーローへ一本化した。
    // 旧 A1_anchor_block_agrees と同じ意図（ゲージと同じ導出額が本文にも出ている）をヒーローで固定する。
    check("A1_hero_amount_agrees", a.heroAmountText === "¥1,070,000", a.heroAmountText);
    check("A1_anchor_main_removed_from_cashflow", a.anchorMainText === null, a.anchorMainText);

    // --- アサート B1: この端末での最終取得（正常時）---
    check("B1_fetchnote_id_present", a.fetchNoteId === true, a.fetchNoteId);
    check("B1_fetchinfo_shown_just_now", /この端末での最終取得: (たった今|\d+分前)/.test(a.fetchInfoText || ""), a.fetchInfoText);
    check("B1_no_fetcherr_initially", a.fetchErrText === null, a.fetchErrText);
    check("B1_cf_stats_have_yen_before_mock", a.cfStatsHaveYen === true, a.cfStatsHaveYen);
    // D2 期待変更: 鮮度行はヒーロー下端へ移設。id は文書内に1個のまま（repaintStaleNotice の契約）。
    check("B1_fetchnote_moved_into_hero", a.fetchNoteInHero === true, a.fetchNoteInHero);
    check("B1_fetchnote_single_in_document", a.fetchNoteCount === 1, a.fetchNoteCount);

    // --- アサート D2-A: ヒーロー（anchor 連動・当月行なし＝参考値は確定値と同額で非表示）---
    check("A7_hero_present", a.heroExists === true, a.heroExists);
    check("A7_hero_label_is_confirmed_savings", /いまの貯蓄額（確定）/.test(a.heroLabelText || ""), a.heroLabelText);
    check("A7_hero_chip_live", a.heroChipLiveText === "自動算出", a.heroChipLiveText);
    check("A7_hero_basis_shows_anchor", /基準＝2026年7月のはじめ ¥1,000,000/.test(a.heroBasisText || ""), a.heroBasisText);
    check("A7_hero_basis_shows_delta", /確定1ヶ月分 \+¥70,000/.test(a.heroBasisText || ""), a.heroBasisText);
    // 参考値（derivedCashLive）＝確定値と同額のときは出さない（どちらが権威か読めなくなるため）
    check("A7_hero_ref_hidden_when_same", a.heroRefAmountText === null, a.heroRefAmountText);
    check("A7_hero_auto_badge", a.heroAutoBadgeText === "収支連携から自動算出", a.heroAutoBadgeText);
    check("A7_hero_gauge_pct_100", a.heroGaugePctText === "100%", a.heroGaugePctText);
    check("A7_hero_gauge_fill_100", a.heroGaugeFillWidth === "100%", a.heroGaugeFillWidth);
    check("A7_hero_gauge_note_shows_target", /¥1,070,000 \/ ¥900,000/.test(a.heroGaugeNoteText || ""), a.heroGaugeNoteText);
    check("A7_hero_done_badge", a.heroDoneBadgeText === "達成済", a.heroDoneBadgeText);
    check("A7_hero_power_is_investable_surplus", /¥70,000/.test(a.heroPowerText || ""), a.heroPowerText);
    check("A7_hero_next_shown", /次の一手：/.test(a.heroNextText || ""), a.heroNextText);
    check("A7_hero_next_message_is_vm_next", /バッファ達成。次の余剰はコア（長期）へ/.test(a.heroNextText || ""), a.heroNextText);
    check("A7_hero_next_class_by_target", /mcc-hero-next-core/.test(a.heroNextClass || ""), a.heroNextClass);
    // --- 重複統合の3点（① banner 廃止 ② チップは収支のみ ③ anchor 表示はヒーローのみ）---
    check("A8_banner_removed", a.bannerExists === false, a.bannerExists);
    check("A8_wf_chips_only_in_cashflow", a.cfWfChips > 0 && a.rmWfChips === 0,
      JSON.stringify({ cf: a.cfWfChips, rm: a.rmWfChips }));
    check("A8_roadmap_thismonth_is_text_line", /バッファ ¥0 → コア ¥70,000/.test(a.rmWfText || ""), a.rmWfText);
    check("A8_anchor_edit_link_kept_in_cashflow", a.anchorEditExists === true, a.anchorEditExists);
    check("A8_anchor_sub_kept_in_cashflow", /貯蓄額の基準＝2026年7月のはじめ/.test(a.anchorSubText || ""), a.anchorSubText);

    // --- アサート2: バケツのバッファ欄が read-only 表示＋バッジ ---
    check("A2_buffer_input_absent", a.bufferInputExists === false, a.bufferInputValue);
    check("A2_auto_badge", a.autoBadgeText === "自動連動中", a.autoBadgeText);
    check("A2_auto_value_is_effective", a.autoValText === "¥1,070,000", a.autoValText);
    check("A2_jump_to_anchor_present", a.autoJumpText === "基準を変更", a.autoJumpText);
    check("A2_other_bucket_inputs_intact", a.otherBucketInputs === 2, a.otherBucketInputs);
    check("A2_no_fallback_note_when_linked", a.bufferNoteText === null, a.bufferNoteText);
    // inline onclick は公開APIの export 漏れがあっても「押しても無反応」で無音故障する＝実際に押して確かめる
    // （jumpTo は対象要素に .mcc-jump-flash を付ける＝ハンドラ到達の観測点）。
    // D1: バケツは設定・ガイドタブへ移動したので、実クリックの前にそのタブへ切替える（タブバーも実クリック）。
    await pageA.click("#mcc-tab-btn-config");
    await pageA.click("#mcc-sec-buckets .mcc-bucket .mcc-jump");
    await pageA.waitForTimeout(150);
    const jumped = await pageA.evaluate(() => {
      const el = document.getElementById("mcc-sec-cashflow");
      return {
        flashed: !!el && el.classList.contains("mcc-jump-flash"),
        // 収支は dash タブ＝ジャンプで自動的に dash へ戻っている（hidden が外れている）はず
        dashVisible: !document.getElementById("mcc-tab-dash").hidden,
        storedTab: (() => { try { return localStorage.getItem("mcc_tab"); } catch (e) { return null; } })(),
      };
    });
    check("A2_jump_handler_reaches_cashflow", jumped.flashed === true, jumped.flashed);
    check("A2_jump_switches_back_to_dash_tab", jumped.dashVisible === true, JSON.stringify(jumped));

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

    // --- fix1: 「現状は現金のみ」クイックフィルが実効値を書く（画面の合計と一致する）---
    // 旧実装は保存 state（buffer=111）を合計していたため、画面に ¥1,070,000 と出ている状態で
    // 111 を無言で書き込んでいた。実効 state を渡すよう修正した点の実測。
    await pageA.evaluate(() => MCC.acFillCashOnly());
    await pageA.waitForTimeout(200);
    const aFill = await snapshot(pageA);
    check("A6_acFillCashOnly_writes_effective_total", aFill.storedCash === DERIVED_CASH, aFill.storedCash);
    check("A6_acFillCashOnly_not_stale_total", aFill.storedCash !== STALE_BUFFER, aFill.storedCash);

    // --- アサート B1続き: /api/me/cashflow を 500 でモックした再取得後に fetcherr 表示＋rows 温存 ---
    // 500 route に意図的な遅延を入れ、無遅延の /api/me/investment（成功＝_cfFetchErr を ""へ）より必ず後に
    // 解決させる。loadCashflow/loadInvestment は _cfFetchedAt/_cfFetchErr を共有する設計（brief B1 で明示許容）
    // のため、順序を固定しないとどちらが最後に勝つか不定＝flaky になる。
    await ctxA.route("**/api/me/cashflow", (route) =>
      new Promise((resolve) => setTimeout(resolve, 80)).then(() =>
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "boom" }) })
      ));
    await pageA.evaluate(() => MCC.refreshData());
    await pageA.waitForTimeout(500);
    const aErr = await snapshot(pageA);
    check("B1_fetcherr_shown_after_500",
      /更新に失敗しました（HTTP 500）・直前のデータを表示中/.test(aErr.fetchErrText || ""), aErr.fetchErrText);
    check("B1_rows_preserved_yen_still_shown_after_500", aErr.cfStatsHaveYen === true, aErr.cfStatsHaveYen);
    check("B1_gauge_unaffected_by_fetch_error", /¥1,070,000/.test(aErr.gaugeText || ""), aErr.gaugeText);
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
    // fix2: ログイン済み＋rowsあり＋基準未設定＝「あと1手で自動化できる」唯一の層。
    // 誘導注記が出る側の分岐を正のアサートで固定する（旧版はここを「注記なし」で固定していた）。
    check("B4_anchor_setup_note_shown", /基準（アンカー）を設定すると/.test(b.bufferNoteText || ""), b.bufferNoteText);
    check("B4_anchor_setup_note_has_jump", b.bufferNoteHasJump === true, b.bufferNoteHasJump);
    check("B4_gauge_uses_saved_value", /¥111/.test(b.gaugeText || ""), b.gaugeText);
    // --- D2-B: manual モードのヒーロー＝保存値表示＋設定誘導（自動算出の痕跡を出さない）---
    check("B5_hero_present", b.heroExists === true, b.heroExists);
    check("B5_hero_label_is_buffer_cash", /バッファ（現金）/.test(b.heroLabelText || ""), b.heroLabelText);
    check("B5_hero_amount_is_saved_value", b.heroAmountText === "¥111", b.heroAmountText);
    check("B5_hero_no_chip_live", b.heroChipLiveText === null, b.heroChipLiveText);
    check("B5_hero_no_auto_badge", b.heroAutoBadgeText === null, b.heroAutoBadgeText);
    check("B5_hero_no_ref_block", b.heroRefAmountText === null, b.heroRefAmountText);
    check("B5_hero_basis_guides_to_anchor_setup", /基準（アンカー）を設定すると/.test(b.heroBasisText || ""), b.heroBasisText);
    check("B5_hero_basis_has_jump", b.heroBasisJumpText === "「収支と投資余力」", b.heroBasisJumpText);
    check("B5_hero_fresh_row_present_when_logged_in", b.fetchNoteInHero === true, b.fetchNoteInHero);
    check("B5_banner_removed_in_manual_too", b.bannerExists === false, b.bannerExists);
    check("B5_anchor_form_kept_in_cashflow", b.anchorFormExists === true, b.anchorFormExists);
    // 反映が実際に効く（従来どおり buffer に toBuffer=70,000 が積まれる）
    await pageB.click("#mcc-sec-cashflow .mcc-cf-apply");
    await pageB.waitForTimeout(250);
    const bAfter = await snapshot(pageB);
    check("B4_applySurplus_works", bAfter.storedBuffer === STALE_BUFFER + ROW_BALANCE, bAfter.storedBuffer);
    check("B4_applied_period_recorded", bAfter.storedApplied === "2026-07-01", bAfter.storedApplied);
    check("B4_apply_button_becomes_disabled", /反映済み/.test(bAfter.applyBtnText || ""), bAfter.applyBtnText);
    await ctxB.close();

    // ============ シナリオC: 基準あり・収支rows空（未連携）＝degrade 経路 ============
    // effectiveState は「配列だが長さ0」で no-op に倒れる＝anchor 設定済みでも連動しない層。
    // 注記が出る側のもう1分岐（収支未連携）を正のアサートで固定する。
    const ctxC = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    await mockApi(ctxC, STATE_ANCHOR, []); // anchor 設定済み・rows は空配列
    const pageC = await ctxC.newPage();
    pageC.on("pageerror", (e) => pageErrors.push("C:" + String((e && e.message) || e)));
    await openCockpit(pageC);
    const c = await snapshot(pageC);

    check("C6_not_linked_without_rows", c.bufferInputExists === true, c.bufferInputValue);
    check("C6_no_auto_badge_without_rows", c.autoBadgeText === null, c.autoBadgeText);
    check("C6_input_keeps_saved_value", Number(c.bufferInputValue) === STALE_BUFFER, c.bufferInputValue);
    check("C6_rows_missing_note_shown", /収支データが未連携のため自動算出できません/.test(c.bufferNoteText || ""), c.bufferNoteText);
    check("C6_rows_missing_note_states_anchor_is_set", /基準（アンカー）は設定済み/.test(c.bufferNoteText || ""), c.bufferNoteText);
    check("C6_gauge_uses_saved_value_when_degraded", /¥111/.test(c.gaugeText || ""), c.gaugeText);
    // --- D2-C: degrade 経路のヒーロー（基準あり・rows 無し）＝保存値＋「なぜ自動にならないか」を明示 ---
    check("C7_hero_amount_is_saved_value", c.heroAmountText === "¥111", c.heroAmountText);
    check("C7_hero_basis_states_rows_missing", /収支データが未連携のため保存値を表示中/.test(c.heroBasisText || ""), c.heroBasisText);
    check("C7_hero_power_none_note", /収支データが未連携です/.test(c.heroPowerNoneText || ""), c.heroPowerNoneText);
    // B1 レビュー minor: staleDays==null（pulled_at 無し＝rows 空）でもカデンス文言を必ず出す
    check("C7_fresh_cadence_shown_when_staleDays_null", /毎日 朝6時ごろ/.test(c.freshTxt || ""), c.freshTxt);
    await ctxC.close();

    // ============ シナリオD（Task B2 ①）: 背景401（cloudFlush の PUT）→ 鮮度行に警告＋フル再描画無し ============
    // 収支カードが見えている状態（ログイン中）で PUT /api/me/state だけ 401 に切り替え、編集保存を走らせる。
    // repaintStaleNotice()/repaintSyncBar() が「対象要素だけの部分描画」であることを、フォーカス中の入力に
    // 立てた独自マーカー属性（DOM ノードの同一性の証拠）が生き残るかで直接検証する＝ full render なら
    // #mcc-root.innerHTML が丸ごと作り直されノードごと消える＝マーカーもフォーカスも消える。
    const ctxD = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    await mockApi(ctxD, STATE_ANCHOR);
    let putState401 = false;
    await ctxD.route("**/api/me/state", (route) => {
      if (route.request().method() !== "PUT") {
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: STATE_ANCHOR }) });
      }
      return putState401
        ? route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "unauthorized" }) })
        : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
    });
    const pageD = await ctxD.newPage();
    pageD.on("pageerror", (e) => pageErrors.push("D:" + String((e && e.message) || e)));
    await openCockpit(pageD);

    // 1回目の編集：save() 自身が起こす（正常な・想定内の）即時 full render を先に済ませておく
    // （B2 が守るのはこの後に来る「debounce 後の背景 401」の部分描画であって、この直後の描画ではない）。
    // D1: バケツ（＝この検証で使うアクティブ入力）は設定・ガイドタブへ移動したため、先にそのタブへ。
    // switchTab は再描画しない設計なので、この切替自体はマーカー/フォーカスの検証に影響しない。
    await pageD.evaluate(() => MCC.switchTab("config"));
    await pageD.evaluate(() => { MCC.setField("buckets.core.amount", "5000"); });
    await pageD.waitForTimeout(150);
    // 再描画後の（新しい）入力ノードへフォーカス＋独自マーカーを付与＝これが「アクティブ入力」の基準点。
    await pageD.focus('#mcc-sec-buckets input[data-mcc-focus="buckets.core.amount"]');
    await pageD.evaluate(() => { document.activeElement.setAttribute("data-b2-marker", "keepme"); });
    // ここから PUT を 401 に切り替える。1回目の編集で仕込んだ debounce(800ms) タイマーは張られたまま
    // なので、以降に発火する cloudFlush の PUT がそのまま 401 を踏む。
    putState401 = true;
    await pageD.waitForTimeout(900); // debounce(800ms) 経過＋fetch/後続処理の完了待ち
    const dSnap = await pageD.evaluate(() => {
      const el = document.activeElement;
      return {
        activeMarker: el && el.getAttribute ? el.getAttribute("data-b2-marker") : null,
        activeFocusKey: el && el.getAttribute ? el.getAttribute("data-mcc-focus") : null,
        fetchErrText: (() => { const e = document.querySelector(".mcc-cf-fetcherr"); return e ? e.textContent.trim() : null; })(),
        syncStatusText: (() => { const e = document.getElementById("mcc-sync-status"); return e ? e.textContent.trim() : null; })(),
        cfSectionStillPresent: !!document.getElementById("mcc-sec-cashflow"),
      };
    });
    check("D1_fetcherr_shows_session_expired_after_bg_401", /セッションが切れています/.test(dSnap.fetchErrText || ""), dSnap.fetchErrText);
    check("D1_sync_bar_reflects_logged_out", dSnap.syncStatusText === "☁ クラウド同期（複数端末で共有）", dSnap.syncStatusText);
    // フル再描画なし＝独自マーカーが消えずに残っている（＝ノードが作り直されていない）
    check("D1_no_full_rerender_marker_survives", dSnap.activeMarker === "keepme", dSnap.activeMarker);
    // アクティブ入力のフォーカスがそのまま保持されている（body 等へ逃げていない）
    check("D1_focus_preserved_on_same_input", dSnap.activeFocusKey === "buckets.core.amount", dSnap.activeFocusKey);
    check("D1_cashflow_section_not_torn_down_by_partial_repaint", dSnap.cfSectionStillPresent === true, dSnap.cfSectionStillPresent);
    await ctxD.close();

    // ============ シナリオE（Task B2 ②）: sync.loggedIn=false での ↻ 相当（死にボタン解消）============
    // セッションが最初から無い状態（/api/auth/session が ok:false）で MCC.refreshData() を呼ぶ。
    // 旧実装は `if (_refreshing || !sync.loggedIn) return;` の無言 return＝押しても何も起きない死にボタン
    // だった。新実装はログイン欄へ jumpTo（スクロール＋flash）して再ログイン導線を示す。
    // 収支セクション自体が未ログインでは非描画（既存の認証データゲート・本タスクの対象外）なので、
    // このシナリオで観測できる「警告」は鮮度行のテキストではなくログイン欄への誘導（flash）そのもの。
    const ctxE = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    const netCallsE = [];
    await ctxE.route("**/api/auth/session", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: false }) }));
    await ctxE.route("**/api/me/**", (route) => {
      netCallsE.push(route.request().method() + " " + route.request().url());
      route.fulfill({ status: 401, contentType: "application/json", body: "{}" });
    });
    await ctxE.route("**/api/market/**", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ stocks: {}, updated_at: "" }) }));
    // D2: 未ログインのヒーロー（保存値ベース＋ログイン誘導）も同じシナリオで見る。money.js は
    // DOMContentLoaded の init() で1回だけ localStorage を読むため、seed は addInitScript（ページ
    // スクリプトより前に走る）で入れる＝goto 後に setItem しても既に load() 済みで反映されない。
    const LOCAL_STATE_E = {
      version: 3, currency: "JPY", monthlyExpense: 100000, bufferMonths: 3,
      buckets: { buffer: { amount: 250000 }, core: { amount: 0 }, satellite: { amount: 0 } },
      satelliteCapPct: 10, goals: [], reserves: [], lastAppliedCashflowPeriod: "", updatedAt: 1,
    };
    await ctxE.addInitScript((s) => {
      try { localStorage.setItem("mcc_state", s); localStorage.removeItem("mcc_tab"); } catch (e) {}
    }, JSON.stringify(LOCAL_STATE_E));
    const pageE = await ctxE.newPage();
    pageE.on("pageerror", (e) => pageErrors.push("E:" + String((e && e.message) || e)));
    await pageE.goto(BASE + "/?diag=off", { waitUntil: "domcontentloaded" });
    await pageE.evaluate(() => MCC.show());
    await pageE.waitForTimeout(500); // 収支セクションは出現しない（未ログイン）ので固定 wait でセッション確認の完了を待つ
    const eBefore = await pageE.evaluate(() => ({
      cfSection: !!document.getElementById("mcc-sec-cashflow"),
      syncFlashed: (document.getElementById("mcc-sec-sync") || {}).className || "",
    }));
    check("E2_precondition_logged_out_no_cashflow_section", eBefore.cfSection === false, eBefore.cfSection);
    check("E2_precondition_sync_not_yet_flashed", !/mcc-jump-flash/.test(eBefore.syncFlashed), eBefore.syncFlashed);

    // --- D2-E: 未ログインのヒーロー＝ローカル保存値＋ログイン誘導・鮮度行は出さない ---
    const eHero = await pageE.evaluate(() => {
      const q = (sel) => document.querySelector(sel);
      const txt = (sel) => { const e = q(sel); return e ? e.textContent.trim() : null; };
      return {
        exists: !!q(".mcc-hero"),
        label: txt(".mcc-hero-label"),
        amount: txt(".mcc-hero-amount"),
        basis: txt(".mcc-hero-basis"),
        basisJump: txt(".mcc-hero-basis .mcc-jump"),
        gaugePct: txt(".mcc-hero-gauge-pct"),
        powerNone: txt(".mcc-hero-power-none"),
        next: txt(".mcc-hero-next"),
        fetchNoteCount: document.querySelectorAll("#mcc-cf-fetchnote").length,
        banner: !!q(".mcc-banner"),
      };
    });
    check("E3_hero_present_when_logged_out", eHero.exists === true, eHero.exists);
    check("E3_hero_shows_local_saved_value", eHero.amount === "¥250,000", eHero.amount);
    check("E3_hero_label_is_buffer_cash", /バッファ（現金）/.test(eHero.label || ""), eHero.label);
    check("E3_hero_gauge_from_local_state", eHero.gaugePct === "83%", eHero.gaugePct);
    check("E3_hero_login_cta_text", /ログインすると自動算出・収支が反映されます/.test(eHero.basis || ""), eHero.basis);
    check("E3_hero_login_cta_jump", eHero.basisJump === "ログイン", eHero.basisJump);
    check("E3_hero_power_needs_login", /ログインして収支を連携すると表示されます/.test(eHero.powerNone || ""), eHero.powerNone);
    check("E3_hero_next_from_local_state", /次の余剰はバッファへ/.test(eHero.next || ""), eHero.next);
    // 鮮度行は未ログインでは出さない（＝id 不在。repaintStaleNotice は no-op で例外にならない＝下で実測）
    check("E3_no_fetchnote_when_logged_out", eHero.fetchNoteCount === 0, eHero.fetchNoteCount);
    check("E3_banner_removed_when_logged_out", eHero.banner === false, eHero.banner);
    // ヒーローのログイン導線を**実クリック**（inline onclick＝公開 API 到達点）してログイン欄へ飛ぶ
    await pageE.evaluate(() => {
      document.querySelectorAll(".mcc-jump-flash").forEach((n) => n.classList.remove("mcc-jump-flash"));
    });
    await pageE.click(".mcc-hero-basis .mcc-jump");
    await pageE.waitForTimeout(120);
    const eJump = await pageE.evaluate(() => (document.getElementById("mcc-sec-sync") || {}).className || "");
    check("E3_hero_login_cta_reaches_sync", /mcc-jump-flash/.test(eJump), eJump);
    netCallsE.length = 0;
    // 直前の E3 クリックで付いた flash を必ず消してから測る（refreshData の render で作り直されるが、
    // 「前の操作の残り香で通ってしまう」形の弱いアサートにしないため明示的に落とす）。
    await pageE.evaluate(() => {
      document.querySelectorAll(".mcc-jump-flash").forEach((n) => n.classList.remove("mcc-jump-flash"));
    });
    await pageE.evaluate(() => MCC.refreshData());
    await pageE.waitForTimeout(300);
    const eAfter = await pageE.evaluate(() => ({
      syncClass: (document.getElementById("mcc-sec-sync") || {}).className || "",
      loginFormPresent: !!document.getElementById("mcc-pw"),
    }));
    // 死にボタンでなくなった＝呼ぶとログイン欄へ実際にジャンプ（スクロール＋flash）する
    check("E2_deadbutton_now_jumps_to_sync", /mcc-jump-flash/.test(eAfter.syncClass), eAfter.syncClass);
    check("E2_login_form_shown_as_redirect_target", eAfter.loginFormPresent === true, eAfter.loginFormPresent);
    // 無言 return の代わりに導線を出すだけで、未ログインのままデータ取得を試みたりはしない（回帰防止）
    check("E2_no_cashflow_investment_calls_attempted_while_logged_out", netCallsE.length === 0, JSON.stringify(netCallsE));
    await ctxE.close();

    // ============ シナリオF（Task B3）: タブ復帰時の自動再取得（TTL 10分）============
    // _cfFetchedAt は money.js IIFE 内部のモジュール変数で外部から直接書けない（brief 指示どおり
    // テスト専用フックは追加しない）。代わりに context.addInitScript で window.Date を差し替え、
    // 「10分以上古い」を Date.now() の進行そのもので決定論的に作る（sinon 風フェイクタイマーの手法）。
    const ctxF = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    await ctxF.addInitScript(() => {
      var RealDate = Date;
      window.__mockNow = RealDate.now();
      window.__setMockNow = function (ms) { window.__mockNow = ms; };
      window.Date = class extends RealDate {
        constructor(...args) {
          if (args.length === 0) { super(window.__mockNow); }
          else { super(...args); }
        }
        static now() { return window.__mockNow; }
      };
    });
    await mockApi(ctxF, STATE_ANCHOR);
    let cashflowCallsF = 0;
    let sessionCallsF = 0;
    let statePutCallsF = 0;
    let sessionExpiredF = false; // F4 で checkSession を ok:false に切り替える
    await ctxF.route("**/api/me/cashflow", (route) => {
      cashflowCallsF++;
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ cashflow: CASHFLOW_ROWS }) });
    });
    await ctxF.route("**/api/auth/session", (route) => {
      sessionCallsF++;
      route.fulfill({
        status: 200, contentType: "application/json",
        body: JSON.stringify(sessionExpiredF ? { ok: false } : { ok: true, insightEnabled: false, nisaAdviceEnabled: false }),
      });
    });
    await ctxF.route("**/api/me/state", (route) => {
      if (route.request().method() === "PUT") {
        statePutCallsF++;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) });
      }
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ state: STATE_ANCHOR }) });
    });
    const pageF = await ctxF.newPage();
    pageF.on("pageerror", (e) => pageErrors.push("F:" + String((e && e.message) || e)));
    await openCockpit(pageF);
    check("F0_precondition_cashflow_fetched_once", cashflowCallsF === 1, cashflowCallsF);
    // show() は checkSession() と probeNisaCap() の両方が /api/auth/session を叩く（既存仕様・本タスクの対象外）
    // ＝初回で 2 回が正しい前提。以降 F1/F4 の「増分」判定はこの絶対値でなく差分で見る。
    check("F0_precondition_session_checked_twice_by_show", sessionCallsF === 2, sessionCallsF);

    // --- F0続き: hidden 経路は無破壊（cloudFlushBeacon が従来どおり効く・新分岐は return 後で通らない）---
    await pageF.evaluate(() => { MCC.setField("buckets.core.amount", "9999"); }); // _cloudDirty を立てる
    await pageF.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pageF.waitForTimeout(150);
    check("F0_hidden_still_flushes_via_beacon", statePutCallsF >= 1, statePutCallsF);
    check("F0_hidden_does_not_trigger_refetch", cashflowCallsF === 1, cashflowCallsF);

    // --- F1: 10分超過＋money-view active＋ログイン中 → visible 復帰で checkSession→refreshData ---
    await pageF.evaluate(() => { window.__setMockNow(window.__mockNow + 700000); }); // +11分40秒
    const cashflowBeforeF1 = cashflowCallsF, sessionBeforeF1 = sessionCallsF;
    await pageF.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { get: () => "visible", configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pageF.waitForTimeout(400);
    check("F1_cashflow_refetched_on_stale_visible_return", cashflowCallsF > cashflowBeforeF1, cashflowCallsF);
    check("F1_session_rechecked_on_stale_visible_return", sessionCallsF > sessionBeforeF1, sessionCallsF);

    // --- F2: 直後の再ディスパッチ（時刻を進めない）→ 多重発火しない（_cfFetchedAt 更新済み・TTL未超過）---
    const cashflowBeforeF2 = cashflowCallsF;
    await pageF.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await pageF.waitForTimeout(300);
    check("F2_no_duplicate_fetch_within_ttl", cashflowCallsF === cashflowBeforeF2, cashflowCallsF);

    // --- F2b: 再び TTL 超過にした上で visible 連打（同tick内で2回 dispatch）→ refreshData の
    //     _refreshing ガードにより fetch は1回だけ（checkSession 解決の順序に依らず単一化される）。
    await pageF.evaluate(() => { window.__setMockNow(window.__mockNow + 700000); });
    const cashflowBeforeF2b = cashflowCallsF;
    await pageF.evaluate(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await pageF.waitForTimeout(400);
    check("F2b_rapid_double_dispatch_fetches_once", cashflowCallsF === cashflowBeforeF2b + 1, cashflowCallsF);

    // --- F3: portal 表示中（money-view 非 active）は TTL 超過でも発火しない ---
    await pageF.evaluate(() => { MCC.backToPortal(); });
    await pageF.evaluate(() => { window.__setMockNow(window.__mockNow + 700000); });
    const cashflowBeforeF3 = cashflowCallsF;
    await pageF.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await pageF.waitForTimeout(300);
    check("F3_no_fetch_while_portal_active", cashflowCallsF === cashflowBeforeF3, cashflowCallsF);
    await pageF.evaluate(() => { MCC.show(); });
    await pageF.waitForSelector("#mcc-sec-cashflow", { timeout: 8000 });

    // --- F4: セッション切れ（checkSession が ok:false）→ refreshData は呼ばれず render のみ（cashflow 再取得なし）---
    sessionExpiredF = true;
    await pageF.evaluate(() => { window.__setMockNow(window.__mockNow + 700000); });
    const cashflowBeforeF4 = cashflowCallsF;
    await pageF.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await pageF.waitForTimeout(400);
    check("F4_no_cashflow_refetch_when_session_expired", cashflowCallsF === cashflowBeforeF4, cashflowCallsF);
    const fAfterExpire = await pageF.evaluate(() => !!document.getElementById("mcc-sec-cashflow"));
    check("F4_cashflow_section_hidden_after_session_expiry_render", fAfterExpire === false, fAfterExpire);
    await ctxF.close();

    // ============ シナリオG（Task D1）: #mcc-root 内 2タブ骨格（dash / config）============
    // 検証観点: 既定タブ／セクションの振り分け／クリック切替（hidden＋aria＋localStorage）／
    // 非アクティブ面の DOM 温存（details 開閉・未確定入力値）／リロード復元／jumpTo のタブ追随。
    const ctxG = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    await mockApi(ctxG, STATE_ANCHOR);
    const pageG = await ctxG.newPage();
    pageG.on("pageerror", (e) => pageErrors.push("G:" + String((e && e.message) || e)));
    await openCockpit(pageG);

    // offsetParent は hidden（display:none）で null＝属性だけでなく「実際に見えているか」を確認できる。
    const tabState = () => pageG.evaluate(() => ({
      dashHidden: document.getElementById("mcc-tab-dash").hidden,
      configHidden: document.getElementById("mcc-tab-config").hidden,
      dashSelected: document.getElementById("mcc-tab-btn-dash").getAttribute("aria-selected"),
      configSelected: document.getElementById("mcc-tab-btn-config").getAttribute("aria-selected"),
      storedTab: (() => { try { return localStorage.getItem("mcc_tab"); } catch (e) { return null; } })(),
      dashHasSync: !!document.querySelector("#mcc-tab-dash #mcc-sec-sync"),
      dashHasNisa: !!document.querySelector("#mcc-tab-dash #mcc-sec-nisa"),
      dashHasCashflow: !!document.querySelector("#mcc-tab-dash #mcc-sec-cashflow"),
      dashHasAssets: !!document.querySelector("#mcc-tab-dash #mcc-sec-assets"),
      dashHasGoals: !!document.querySelector("#mcc-tab-dash #mcc-sec-goals"),
      configHasGuide: !!document.querySelector("#mcc-tab-config .mcc-guide"),
      configHasBuckets: !!document.querySelector("#mcc-tab-config #mcc-sec-buckets"),
      configHasSettings: !!document.querySelector("#mcc-tab-config #mcc-sec-settings"),
      configHasTools: !!document.querySelector("#mcc-tab-config .mcc-tools"),
      cashflowVisible: !!(document.getElementById("mcc-sec-cashflow") || {}).offsetParent,
      bucketsVisible: !!(document.getElementById("mcc-sec-buckets") || {}).offsetParent,
    }));

    // --- G1: 既定は dash（localStorage 未設定）---
    const g1 = await tabState();
    check("G1_default_tab_is_dash", g1.dashHidden === false && g1.configHidden === true, JSON.stringify(g1));
    check("G1_default_aria_selected", g1.dashSelected === "true" && g1.configSelected === "false", JSON.stringify(g1));
    check("G1_dash_content_visible_config_not", g1.cashflowVisible === true && g1.bucketsVisible === false, JSON.stringify(g1));

    // --- G2: セクションの振り分け（brief の割当どおり）---
    check("G2_dash_holds_sync_nisa_cashflow_assets_goals",
      g1.dashHasSync && g1.dashHasNisa && g1.dashHasCashflow && g1.dashHasAssets && g1.dashHasGoals, JSON.stringify(g1));
    check("G2_config_holds_guide_buckets_settings_tools",
      g1.configHasGuide && g1.configHasBuckets && g1.configHasSettings && g1.configHasTools, JSON.stringify(g1));

    // --- G3: タブバーの実クリックで切替（hidden／aria／localStorage／実描画）---
    await pageG.click("#mcc-tab-btn-config");
    await pageG.waitForTimeout(80);
    const g3 = await tabState();
    check("G3_click_config_swaps_hidden", g3.dashHidden === true && g3.configHidden === false, JSON.stringify(g3));
    check("G3_click_config_swaps_aria", g3.dashSelected === "false" && g3.configSelected === "true", JSON.stringify(g3));
    check("G3_click_config_persists_localstorage", g3.storedTab === "config", g3.storedTab);
    check("G3_click_config_swaps_visibility", g3.bucketsVisible === true && g3.cashflowVisible === false, JSON.stringify(g3));

    // --- G4: 非アクティブ面は DOM から消えない（details 開閉・未確定入力値が切替で失われない）---
    await pageG.evaluate(() => {
      document.getElementById("mcc-sec-settings").open = true;
      document.querySelector('#mcc-sec-buckets input[data-mcc-focus="buckets.core.amount"]').value = "424242"; // change 未発火＝未確定
    });
    await pageG.click("#mcc-tab-btn-dash");
    const g4mid = await pageG.evaluate(() => ({
      bucketsStillInDom: !!document.getElementById("mcc-sec-buckets"),
      bucketsVisible: !!(document.getElementById("mcc-sec-buckets") || {}).offsetParent,
    }));
    await pageG.click("#mcc-tab-btn-config");
    const g4 = await pageG.evaluate(() => ({
      settingsOpen: document.getElementById("mcc-sec-settings").open,
      coreValue: document.querySelector('#mcc-sec-buckets input[data-mcc-focus="buckets.core.amount"]').value,
    }));
    check("G4_inactive_pane_stays_in_dom", g4mid.bucketsStillInDom === true && g4mid.bucketsVisible === false, JSON.stringify(g4mid));
    check("G4_details_open_survives_tab_roundtrip", g4.settingsOpen === true, g4.settingsOpen);
    check("G4_uncommitted_input_survives_tab_roundtrip", g4.coreValue === "424242", g4.coreValue);

    // --- G5: リロード後に localStorage からタブが復元される（config のまま）---
    await pageG.goto(BASE + "/?diag=off", { waitUntil: "domcontentloaded" });
    await pageG.evaluate(() => MCC.show());
    // config タブ復元後は収支セクションが hidden＝visible 待ちにすると固まるので attached で待つ。
    await pageG.waitForSelector("#mcc-sec-cashflow", { state: "attached", timeout: 8000 });
    await pageG.waitForTimeout(250);
    const g5 = await tabState();
    check("G5_tab_restored_after_reload", g5.configHidden === false && g5.dashHidden === true, JSON.stringify(g5));
    check("G5_restored_aria_selected", g5.configSelected === "true" && g5.dashSelected === "false", JSON.stringify(g5));

    // --- G6/G7: jumpTo が属するタブへ自動切替（既存7ターゲット全て）＋details open＋flash ---
    const jumpTargets = [
      ["settings", "mcc-sec-settings", "config"],
      ["buckets", "mcc-sec-buckets", "config"],
      ["sync", "mcc-sec-sync", "dash"],
      ["cashflow", "mcc-sec-cashflow", "dash"],
      ["goals", "mcc-sec-goals", "dash"],
      ["assets", "mcc-sec-assets", "dash"],
      ["nisa", "mcc-sec-nisa", "dash"],
    ];
    for (const [key, id, tab] of jumpTargets) {
      // 直前の状態に依存しないよう、必ず「反対のタブ」から飛ばす（切替が起きたことを毎回観測する）。
      await pageG.evaluate((otherTab) => {
        MCC.switchTab(otherTab);
        document.querySelectorAll(".mcc-jump-flash").forEach((n) => n.classList.remove("mcc-jump-flash"));
      }, tab === "dash" ? "config" : "dash");
      const r = await pageG.evaluate(({ key, id }) => {
        MCC.jumpTo(key);
        const el = document.getElementById(id);
        return {
          flashed: !!el && el.classList.contains("mcc-jump-flash"),
          visible: !!(el && el.offsetParent),
          activeTab: document.getElementById("mcc-tab-config").hidden ? "dash" : "config",
          detailsOpen: el && el.tagName === "DETAILS" ? el.open : null,
        };
      }, { key, id });
      check("G6_jump_" + key + "_switches_to_" + tab + "_tab", r.activeTab === tab, JSON.stringify(r));
      check("G6_jump_" + key + "_flashes_and_visible", r.flashed === true && r.visible === true, JSON.stringify(r));
      if (key === "settings") check("G6_jump_settings_opens_details", r.detailsOpen === true, r.detailsOpen);
    }

    // --- G8: ガイド内リンクを実クリック（inline onclick＝公開API export 漏れの検出点）---
    // ガイドは config タブの折りたたみ内。dash 側へ飛ぶリンクは押した瞬間に自分ごと hidden になるため、
    // 1本ごとに config へ戻して details を開き直す。
    const guideExpect = [
      { idx: 0, id: "mcc-sec-settings", tab: "config" },
      { idx: 1, id: "mcc-sec-buckets", tab: "config" },
      { idx: 2, id: "mcc-sec-sync", tab: "dash" },
      { idx: 3, id: "mcc-sec-cashflow", tab: "dash" },
    ];
    const guideCount = await pageG.evaluate(() => {
      MCC.switchTab("config");
      const g = document.querySelector(".mcc-guide");
      if (g) g.open = true;
      return document.querySelectorAll(".mcc-guide .mcc-guide-steps .mcc-jump").length;
    });
    check("G8_guide_links_count", guideCount === guideExpect.length, guideCount);
    for (const g of guideExpect) {
      await pageG.evaluate(() => {
        MCC.switchTab("config");
        const el = document.querySelector(".mcc-guide"); if (el) el.open = true;
        document.querySelectorAll(".mcc-jump-flash").forEach((n) => n.classList.remove("mcc-jump-flash"));
      });
      await pageG.locator(".mcc-guide .mcc-guide-steps .mcc-jump").nth(g.idx).click();
      await pageG.waitForTimeout(80);
      const gr = await pageG.evaluate((id) => {
        const el = document.getElementById(id);
        return {
          flashed: !!el && el.classList.contains("mcc-jump-flash"),
          visible: !!(el && el.offsetParent),
          activeTab: document.getElementById("mcc-tab-config").hidden ? "dash" : "config",
        };
      }, g.id);
      check("G8_guide_link_" + g.idx + "_reaches_" + g.id, gr.flashed === true && gr.visible === true, JSON.stringify(gr));
      check("G8_guide_link_" + g.idx + "_lands_on_" + g.tab, gr.activeTab === g.tab, JSON.stringify(gr));
    }

    // --- G9（review fix 1）: 入力の確定直後にタブボタンを押しても1回で切替わる ---
    // 実キーボードで打ってからタブボタンを実クリックする＝本番と同じ順序を踏む必要がある。
    // mousedown → (既定動作でフォーカス移動) → 入力の blur → change → setField → render() で
    // #mcc-root.innerHTML が作り直され、押していたボタンが mouseup の前に detach される＝click が
    // 発火しない（onclick だけだと1回目が無反応）。値を直接代入する G3/G4 では change が出ず通らない経路。
    await pageG.evaluate(() => MCC.switchTab("config"));
    const coreSel = '#mcc-sec-buckets input[data-mcc-focus="buckets.core.amount"]';
    await pageG.click(coreSel);
    await pageG.keyboard.press("Control+a");
    await pageG.keyboard.type("777000");   // ここではまだ change 未発火（blur していない）
    await pageG.click("#mcc-tab-btn-dash");  // クリックは1回だけ（2回押せば動く、では回帰検出にならない）
    await pageG.waitForTimeout(300);
    const g9 = await pageG.evaluate(() => ({
      activeTab: document.getElementById("mcc-tab-config").hidden ? "dash" : "config",
      storedCore: (() => {
        try { return JSON.parse(localStorage.getItem("mcc_state") || "null").buckets.core.amount; }
        catch (e) { return null; }
      })(),
    }));
    check("G9_tab_click_after_input_commit_switches_once", g9.activeTab === "dash", JSON.stringify(g9));
    check("G9_input_change_still_committed", g9.storedCore === 777000, JSON.stringify(g9));

    // --- G10（review fix 2）: 保存失敗の警告は両ペインに出る（設定タブで編集中でも見える）---
    // localStorage.setItem を投げるようにして saveLocal() を失敗させる＝lastSaveOk=false の実経路。
    await pageG.evaluate(() => {
      const origSetItem = Storage.prototype.setItem;
      window.__restoreLs = () => { Storage.prototype.setItem = origSetItem; };
      Storage.prototype.setItem = function () { throw new Error("quota exceeded (test)"); };
      MCC.setField("buckets.satellite.amount", "12345");   // save() 失敗 → lastSaveOk=false → 再描画
    });
    await pageG.waitForTimeout(300);
    const g10 = await pageG.evaluate(() => ({
      dashWarn: !!document.querySelector("#mcc-tab-dash .mcc-save-warn"),
      configWarn: !!document.querySelector("#mcc-tab-config .mcc-save-warn"),
      configWarnText: (() => {
        const el = document.querySelector("#mcc-tab-config .mcc-save-warn");
        return el ? el.textContent.trim() : null;
      })(),
    }));
    await pageG.evaluate(() => { if (window.__restoreLs) window.__restoreLs(); });
    check("G10_save_warn_in_both_panes", g10.dashWarn === true && g10.configWarn === true, JSON.stringify(g10));
    check("G10_save_warn_text_in_config", /保存できませんでした/.test(g10.configWarnText || ""), g10.configWarnText);
    await ctxG.close();

    // ============ シナリオH（Task D2）: 当月（進行中）行あり＝ヒーローの「当月込みの参考値」 ============
    // 確定値（derivedCash＝確定月のみ）と参考値（derivedCashLive＝当月部分を含む）が食い違う唯一の条件。
    // シナリオA（当月行なし＝両者同額）の「参考値を出さない」と対になる検証。
    const ctxH = await browser.newContext({ viewport: { width: 1280, height: 2400 } });
    await mockApi(ctxH, STATE_ANCHOR, CASHFLOW_ROWS_PARTIAL);
    const pageH = await ctxH.newPage();
    pageH.on("pageerror", (e) => pageErrors.push("H:" + String((e && e.message) || e)));
    await openCockpit(pageH);
    const h = await snapshot(pageH);

    check("H1_hero_confirmed_amount_excludes_partial_month", h.heroAmountText === "¥1,070,000", h.heroAmountText);
    check("H1_hero_ref_amount_includes_partial_month", h.heroRefAmountText === "¥1,040,000", h.heroRefAmountText);
    check("H1_hero_ref_chip_is_provisional", h.heroChipProvText === "暫定・毎日自動更新", h.heroChipProvText);
    check("H1_hero_basis_delta_is_confirmed_only", /確定1ヶ月分 \+¥70,000/.test(h.heroBasisText || ""), h.heroBasisText);
    check("H1_hero_amount_and_gauge_agree", /¥1,070,000/.test(h.gaugeText || ""), h.gaugeText);
    // 重複統合の再確認（当月行があっても増殖しない）
    check("H2_single_fetchnote_in_hero", h.fetchNoteCount === 1 && h.fetchNoteInHero === true,
      JSON.stringify({ n: h.fetchNoteCount, inHero: h.fetchNoteInHero }));
    check("H2_banner_absent", h.bannerExists === false, h.bannerExists);
    check("H2_wf_chips_only_in_cashflow", h.cfWfChips > 0 && h.rmWfChips === 0,
      JSON.stringify({ cf: h.cfWfChips, rm: h.rmWfChips }));
    check("H2_anchor_amount_not_duplicated_in_cashflow", h.anchorMainText === null, h.anchorMainText);
    // 部分描画（repaintStaleNotice）はヒーローへ移設後も同じ id を掴んで差し替わる（契約維持の直接検証）
    const hRepaint = await pageH.evaluate(() => {
      const before = document.getElementById("mcc-cf-fetchnote");
      before.setAttribute("data-d2-marker", "old");
      MCC.refreshData();   // ログイン中＝再取得 → 完了後に full render ではなく通常 render が走る
      return !!before;
    });
    await pageH.waitForTimeout(400);
    const hAfter = await pageH.evaluate(() => ({
      count: document.querySelectorAll("#mcc-cf-fetchnote").length,
      inHero: !!document.querySelector(".mcc-hero #mcc-cf-fetchnote"),
    }));
    check("H3_refresh_precondition", hRepaint === true, hRepaint);
    check("H3_fetchnote_still_single_and_in_hero_after_refresh",
      hAfter.count === 1 && hAfter.inHero === true, JSON.stringify(hAfter));
    await ctxH.close();

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
