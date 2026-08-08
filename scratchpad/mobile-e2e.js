// scratchpad/mobile-e2e.js — Task T2「モバイル動線の復旧」E2Eスモーク（390x844固定）。
//
// 使い方（この1行で1コマンド。HTTP サーバはこのスクリプトが自前で起動/停止する）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/mobile-e2e.js
//
// 何を確かめるか（plan Task T2 Step3 の4点。修正前は全滅していたことを t2-repro 系の手動検証で確認済み）:
//   1. 詳細ページの「比較/ウォッチ」入口ボタンが可視（w>0・高さ≒44pxのタップ目標）
//   2. 「⊕比較」実クリック→比較モーダルが visible かつ右端(モーダル箱・✕ボタンとも)が390px以内
//   3. ✕実クリックでモーダルが閉じる
//   4. ウォッチ(☆)実クリックでトグル（watched クラスが切り替わる）
//   5. portal/detail/money の3ビューとも document.documentElement.scrollWidth ≤ 390（横スクロール無し）
//   6. pageerror 0件
//
// mock_prod_server.py（scratchpad/mock_prod_server.py）を自前起動（PLAN2_PORT=8232）。
// index.html/detail.css/detail.js/money.css 等は毎リクエストでディスクから配信されるため無改造。
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }

const ROOT = path.resolve(__dirname, "..");
const PORT = 8232;
const BASE = "http://127.0.0.1:" + PORT;
const VIEWPORT = { width: 390, height: 844 };

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    (function tick() {
      http.get(url, (res) => { res.resume(); resolve(); })
        .on("error", () => {
          if (Date.now() > deadline) reject(new Error("server did not start: " + url));
          else setTimeout(tick, 100);
        });
    })();
  });
}

let asserts = [];
function assert(name, cond, detail) {
  asserts.push({ name, pass: !!cond, detail });
  console.log((cond ? "PASS" : "FAIL") + " " + name + "  [" + JSON.stringify(detail) + "]");
}

async function main() {
  const server = spawn("python3", [path.join(ROOT, "scratchpad", "mock_prod_server.py")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PLAN2_PORT: String(PORT) }),
    stdio: "ignore",
  });
  const pageErrors = [];
  try {
    await waitForServer(BASE + "/", 10000);

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: VIEWPORT });
    const page = await context.newPage();
    page.on("pageerror", (err) => pageErrors.push(String(err && err.stack || err)));

    await page.goto(BASE + "/?diag=off", { waitUntil: "networkidle" });
    await page.waitForFunction(() => (
      typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0
    ), undefined, { timeout: 8000 });

    // ---- ①portal: 横はみ出し無し ----
    const portalScroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert("1_portal_no_horizontal_overflow", portalScroll.scrollWidth <= portalScroll.clientWidth, portalScroll);

    // ---- 詳細ページへ実クリックで遷移（先頭行）----
    await page.waitForFunction(() => document.querySelectorAll("#portal-container tbody tr").length > 0,
      undefined, { timeout: 15000 });
    await page.click("#portal-container tbody tr:first-child");
    await page.waitForFunction(() => {
      const v = document.getElementById("detail-view");
      return !!v && v.classList.contains("active");
    }, undefined, { timeout: 10000 });
    await page.waitForTimeout(1200); // updateFinancialViews の setTimeout(150ms) + チャート描画

    // ---- ②比較/ウォッチ入口ボタンが可視（w>0・タップ目標44px）----
    const btnInfo = await page.evaluate(() => {
      const star = document.getElementById("detail-star-btn");
      const cmp = document.querySelector(".open-compare-btn");
      const r = (el) => el ? el.getBoundingClientRect() : null;
      return { star: r(star), cmp: r(cmp) };
    });
    assert("2_star_btn_visible", !!btnInfo.star && btnInfo.star.width > 0 && btnInfo.star.height > 0, btnInfo.star);
    assert("2_cmp_btn_visible", !!btnInfo.cmp && btnInfo.cmp.width > 0 && btnInfo.cmp.height > 0, btnInfo.cmp);
    assert("2_star_btn_tap_target_44", btnInfo.star && btnInfo.star.height >= 44, btnInfo.star && btnInfo.star.height);
    assert("2_cmp_btn_tap_target_44", btnInfo.cmp && btnInfo.cmp.height >= 44, btnInfo.cmp && btnInfo.cmp.height);

    // ---- ③detail: 横はみ出し無し ----
    const detailScroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert("3_detail_no_horizontal_overflow", detailScroll.scrollWidth <= detailScroll.clientWidth, detailScroll);

    // ---- ④「⊕比較」実クリック→モーダルvisible・右端が390px以内（✕到達可能）----
    await page.click(".open-compare-btn");
    await page.waitForTimeout(300);
    const modalOpen = await page.evaluate(() => {
      const overlay = document.getElementById("compare-modal");
      const box = document.querySelector(".compare-modal-box");
      const closeBtn = document.querySelector("#compare-modal .modal-close");
      return {
        active: overlay.classList.contains("active"),
        boxRight: box.getBoundingClientRect().right,
        closeRight: closeBtn.getBoundingClientRect().right,
        vw: document.documentElement.clientWidth,
      };
    });
    assert("4_compare_modal_opened_by_real_click", modalOpen.active === true, modalOpen);
    assert("4_compare_modal_box_within_viewport", modalOpen.boxRight <= modalOpen.vw, modalOpen);
    assert("4_compare_modal_close_btn_reachable", modalOpen.closeRight <= modalOpen.vw, modalOpen);

    // ---- ⑤✕実クリックで閉じる ----
    await page.click("#compare-modal .modal-close");
    await page.waitForTimeout(200);
    const modalClosed = await page.evaluate(() =>
      !document.getElementById("compare-modal").classList.contains("active"));
    assert("5_compare_modal_closed_by_real_click_on_x", modalClosed === true, modalClosed);

    // ---- ⑥ウォッチ(☆)実クリックでトグル ----
    const watchedBefore = await page.evaluate(() =>
      document.getElementById("detail-star-btn").classList.contains("watched"));
    await page.click("#detail-star-btn");
    await page.waitForTimeout(150);
    const watchedAfter = await page.evaluate(() =>
      document.getElementById("detail-star-btn").classList.contains("watched"));
    assert("6_watch_toggled_by_real_click", watchedBefore !== watchedAfter, { watchedBefore, watchedAfter });

    // ---- ⑦money: 横はみ出し無し ----
    await page.evaluate(() => { window.location.hash = "#money"; });
    await page.waitForFunction(() => {
      const v = document.getElementById("money-view");
      return !!v && v.classList.contains("active");
    }, undefined, { timeout: 10000 });
    await page.waitForTimeout(800);
    const moneyScroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert("7_money_no_horizontal_overflow", moneyScroll.scrollWidth <= moneyScroll.clientWidth, moneyScroll);

    // ---- pageerror 0件 ----
    await page.waitForTimeout(300);
    assert("8_no_page_errors", pageErrors.length === 0, pageErrors);

    await browser.close();
  } finally {
    server.kill();
  }

  const fails = asserts.filter((a) => !a.pass);
  console.log("----");
  console.log(asserts.length + "/" + asserts.length + " asserts run, " + fails.length + " failed, pageerrors=" + pageErrors.length);
  if (fails.length || pageErrors.length) {
    console.log("FAIL");
    process.exit(1);
  }
  console.log("ALL PASS");
}

main().catch((e) => { console.error(e); process.exit(1); });
