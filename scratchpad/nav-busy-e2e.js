// scratchpad/nav-busy-e2e.js — Task T3「詳細遷移のローディングフィードバック＋小物2件」E2Eスモーク。
//
// 使い方（この1行で1コマンド。HTTP サーバはこのスクリプトが自前で起動/停止する）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/nav-busy-e2e.js
//
// 何を確かめるか（plan Task T3 Step2 の5点）:
//   1. クリック直後（await getStock 待機中）に body.nav-busy とクリック行 .row-busy が付く
//   2. 表示完了で両方消える
//   3. busy中に別行を実クリックしても no-op（2件目の ohlcv/financials 取得が発生しない・遷移先が変わらない）
//   4. 出来高readoutが toLocaleString 形式（3桁カンマ区切り）になっている
//   5. .mcc-anchor-main が money.css から消滅している（静的ファイル grep 0件）
//
// mock_prod_server.py（scratchpad/mock_prod_server.py）を自前起動（PLAN2_PORT=8233）。
// /api/market/ohlcv だけ Playwright route で 1200ms 遅延させ、await getStock 待機中の状態を安定して観測する。
const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }

const ROOT = path.resolve(__dirname, "..");
const PORT = 8233;
const BASE = "http://127.0.0.1:" + PORT;
const OHLCV_DELAY_MS = 1200;

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
  // ---- ⑤ .mcc-anchor-main が money.css から消滅（静的ファイル grep・ブラウザ不要）----
  const moneyCss = fs.readFileSync(path.join(ROOT, "money.css"), "utf8");
  const anchorMainHits = (moneyCss.match(/mcc-anchor-main/g) || []).length;
  assert("5_mcc_anchor_main_removed_from_css", anchorMainHits === 0, anchorMainHits);

  const server = spawn("python3", [path.join(ROOT, "scratchpad", "mock_prod_server.py")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, { PLAN2_PORT: String(PORT) }),
    stdio: "ignore",
  });
  const pageErrors = [];
  try {
    await waitForServer(BASE + "/", 10000);

    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.on("pageerror", (err) => pageErrors.push(String(err && err.stack || err)));

    // /api/market/ohlcv だけ 1200ms 遅延（financials は素通し＝await getStock の待機幅を安定させる）。
    let ohlcvReqCount = 0;
    let finReqCount = 0;
    page.on("request", (req) => {
      const u = req.url();
      if (u.includes("/api/market/ohlcv")) ohlcvReqCount++;
      if (u.includes("/api/market/financials")) finReqCount++;
    });
    await page.route("**/api/market/ohlcv*", async (route) => {
      await new Promise((r) => setTimeout(r, OHLCV_DELAY_MS));
      await route.continue();
    });

    await page.goto(BASE + "/?diag=off", { waitUntil: "networkidle" });
    await page.waitForFunction(() => (
      typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0
    ), undefined, { timeout: 8000 });
    await page.waitForFunction(() => {
      const t = document.querySelectorAll("#portal-container tbody");
      return t.length > 0 && t[0].querySelectorAll("tr").length >= 2;
    }, undefined, { timeout: 15000 });

    const rowInfo = await page.evaluate(() => {
      const firstTbody = document.querySelectorAll("#portal-container tbody")[0];
      const rows = firstTbody.querySelectorAll("tr");
      return {
        tickerA: rows[0].querySelector(".ticker-code").textContent,
        tickerB: rows[1].querySelector(".ticker-code").textContent,
      };
    });

    // ---- ①行A実クリック → await getStock 待機中に body.nav-busy / 行A.row-busy が付く ----
    await page.click("#portal-container tbody:first-of-type tr:nth-child(1)");
    await page.waitForTimeout(150); // OHLCV_DELAY_MS(1200) 未満＝待機中の断面
    const midFlight = await page.evaluate(() => {
      const firstTbody = document.querySelectorAll("#portal-container tbody")[0];
      const rows = firstTbody.querySelectorAll("tr");
      return {
        bodyNavBusy: document.body.classList.contains("nav-busy"),
        bodyCursor: getComputedStyle(document.body).cursor,
        rowARowBusy: rows[0].classList.contains("row-busy"),
        rowBRowBusy: rows[1].classList.contains("row-busy"),
        detailActive: document.getElementById("detail-view").classList.contains("active"),
      };
    });
    assert("1_body_nav_busy_during_fetch", midFlight.bodyNavBusy === true, midFlight);
    assert("1_body_cursor_progress_during_fetch", midFlight.bodyCursor === "progress", midFlight.bodyCursor);
    assert("1_clicked_row_row_busy_during_fetch", midFlight.rowARowBusy === true, midFlight);
    assert("1_detail_not_yet_shown_during_fetch", midFlight.detailActive === false, midFlight);

    // ---- ③busy中に行B(別ticker)を実クリック→ no-op（fetch起きない・row-busyも付かない）----
    const finReqBeforeSecondClick = finReqCount;
    const ohlcvReqBeforeSecondClick = ohlcvReqCount;
    await page.click("#portal-container tbody:first-of-type tr:nth-child(2)");
    await page.waitForTimeout(150);
    const afterSecondClick = await page.evaluate(() => {
      const firstTbody = document.querySelectorAll("#portal-container tbody")[0];
      const rows = firstTbody.querySelectorAll("tr");
      return {
        rowARowBusy: rows[0].classList.contains("row-busy"),
        rowBRowBusy: rows[1].classList.contains("row-busy"),
        bodyNavBusy: document.body.classList.contains("nav-busy"),
      };
    });
    assert("3_second_click_no_new_ohlcv_request", ohlcvReqCount === ohlcvReqBeforeSecondClick, { before: ohlcvReqBeforeSecondClick, after: ohlcvReqCount });
    assert("3_second_click_no_new_financials_request", finReqCount === finReqBeforeSecondClick, { before: finReqBeforeSecondClick, after: finReqCount });
    assert("3_second_click_row_not_marked_busy", afterSecondClick.rowBRowBusy === false, afterSecondClick);
    assert("3_first_row_still_busy_unaffected", afterSecondClick.rowARowBusy === true, afterSecondClick);
    assert("3_body_still_busy_unaffected", afterSecondClick.bodyNavBusy === true, afterSecondClick);

    // ---- ②表示完了で nav-busy/row-busy が消える。遷移先は行A(tickerA)のまま(行Bへ切り替わっていない) ----
    await page.waitForFunction(() => {
      const v = document.getElementById("detail-view");
      return !!v && v.classList.contains("active");
    }, undefined, { timeout: 10000 });
    await page.waitForTimeout(300); // showView 直後の同期後片付け(finally)を確実に跨ぐ
    const afterShown = await page.evaluate(() => {
      const firstTbody = document.querySelectorAll("#portal-container tbody")[0];
      const rows = firstTbody.querySelectorAll("tr");
      return {
        bodyNavBusy: document.body.classList.contains("nav-busy"),
        rowARowBusy: rows[0].classList.contains("row-busy"),
        rowBRowBusy: rows[1].classList.contains("row-busy"),
        titleText: (document.querySelector(".company-title-main") || {}).textContent || "",
      };
    });
    assert("2_body_nav_busy_cleared_after_shown", afterShown.bodyNavBusy === false, afterShown);
    assert("2_row_busy_cleared_after_shown", afterShown.rowARowBusy === false, afterShown);
    assert("2_row_b_never_became_busy", afterShown.rowBRowBusy === false, afterShown);
    assert("3_navigated_to_row_a_not_row_b", afterShown.titleText.includes(rowInfo.tickerA) && !afterShown.titleText.includes(rowInfo.tickerB), { titleText: afterShown.titleText, rowInfo });

    // ---- ④出来高readoutが toLocaleString 形式（3桁カンマ区切り）----
    await page.waitForTimeout(1200); // updateFinancialViews の setTimeout(150ms) + チャート/シグナルダイジェスト描画
    const volumeReadout = await page.evaluate(() => {
      // sig-label は末尾に用語ヘルプ「?」(.term-help) を子要素で含むため data-term="volume" で照合する
      // （textContent 完全一致だと「出来高?」になり不一致になる）。
      const label = document.querySelector('#signal-digest-card .sig-label[data-term="volume"]');
      const row = label ? label.closest(".sig-row") : null;
      const ro = row ? row.querySelector(".sig-readout") : null;
      return ro ? ro.textContent.trim() : null;
    });
    assert("4_volume_readout_present", typeof volumeReadout === "string" && volumeReadout.length > 0, volumeReadout);
    assert("4_volume_readout_has_thousand_commas", /^出来高 \d{1,3}(,\d{3})+$/.test(volumeReadout || ""), volumeReadout);

    // ---- pageerror 0件 ----
    await page.waitForTimeout(200);
    assert("6_no_page_errors", pageErrors.length === 0, pageErrors);

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
