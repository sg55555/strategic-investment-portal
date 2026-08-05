// scratchpad/portal-money-smoke.js — Task E1 Step4: ポータル側スモーク（横断動線）。
//
// 使い方（この1行で1コマンド。HTTP サーバはこのスクリプトが自前で起動/停止する）:
//   NODE_PATH=/home/shugo/node_modules node scratchpad/portal-money-smoke.js
//
// 何を確かめるか:
//   #portal 表示 → 銘柄詳細(#detail)遷移 → #money 遷移 → タブ切替(dash⇔config) → ポータルへ戻る、
//   の横断動線で pageerror が 0 であること（司令室改修がポータル/詳細ビューを壊していないことの確認）。
// 実 mock_prod_server.py（scratchpad/mock_prod_server.py）で index.html をバイトそのまま配信し、
// /api/market/* を SQLite 実財務+合成 OHLCV でモックする（改造なし・本番と同じコードパス）。
const { spawn } = require("child_process");
const http = require("http");
const path = require("path");

let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { ({ chromium } = require("/home/shugo/node_modules/playwright")); }

const ROOT = path.resolve(__dirname, "..");
const PORT = 8207;
const BASE = "http://127.0.0.1:" + PORT;

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
  // pageErrors = 未捕捉例外のみ（cockpit-e2e.js の C5_no_page_errors と同じ定義・合否基準）。
  // consoleNoise/httpNoise は参考ログ（4xx含む・失敗判定には使わない＝/_vercel/insights 等ローカル既知404を誤検知しないため）。
  const pageErrors = [];
  const consoleNoise = [];
  const httpNoise = [];
  try {
    await waitForServer(BASE + "/", 10000);

    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (err) => pageErrors.push(String(err && err.stack || err)));
    page.on("console", (msg) => { if (msg.type() === "error") consoleNoise.push(msg.text()); });
    page.on("response", (res) => {
      if (res.status() >= 400) httpNoise.push("http " + res.status() + " " + res.url());
    });

    await page.goto(BASE + "/", { waitUntil: "networkidle" });

    // 1. #portal 表示（既定ビュー）
    const portalActive = await page.evaluate(() => {
      const v = document.getElementById("portal-view");
      return !!v && v.classList.contains("active");
    });
    assert("1_portal_active_by_default", portalActive, portalActive);

    // データロード完了（portal-container に行が描画される）まで待つ
    await page.waitForFunction(() => {
      const c = document.getElementById("portal-container");
      return !!c && c.querySelectorAll("tbody tr").length > 0;
    }, undefined, { timeout: 15000 });

    const rowCount = await page.evaluate(() => document.querySelectorAll("#portal-container tbody tr").length);
    assert("2_portal_rows_rendered", rowCount > 0, rowCount);

    // 2. 銘柄詳細へ遷移（先頭行クリック）
    await page.click("#portal-container tbody tr:first-child");
    await page.waitForFunction(() => {
      const v = document.getElementById("detail-view");
      return !!v && v.classList.contains("active");
    }, undefined, { timeout: 10000 });
    const detailActive = await page.evaluate(() => {
      const v = document.getElementById("detail-view");
      return !!v && v.classList.contains("active");
    });
    const hash1 = await page.evaluate(() => location.hash);
    assert("3_detail_active_after_click", detailActive, { detailActive, hash1 });

    // 3. #money へ遷移
    await page.evaluate(() => { window.location.hash = "#money"; });
    await page.waitForFunction(() => {
      const v = document.getElementById("money-view");
      return !!v && v.classList.contains("active");
    }, undefined, { timeout: 10000 });
    const moneyActive = await page.evaluate(() => {
      const v = document.getElementById("money-view");
      return !!v && v.classList.contains("active");
    });
    assert("4_money_active_after_hash", moneyActive, moneyActive);

    // mcc-root の描画を待つ（tab buttons が生えるまで）
    await page.waitForFunction(() => !!document.getElementById("mcc-tab-btn-dash"), undefined, { timeout: 10000 });

    // 4. タブ切替: dash -> config -> dash
    await page.click("#mcc-tab-btn-config");
    const configSelected = await page.evaluate(() =>
      document.getElementById("mcc-tab-btn-config").getAttribute("aria-selected"));
    assert("5_tab_config_selected", configSelected === "true", configSelected);

    await page.click("#mcc-tab-btn-dash");
    const dashSelected = await page.evaluate(() =>
      document.getElementById("mcc-tab-btn-dash").getAttribute("aria-selected"));
    assert("6_tab_dash_selected", dashSelected === "true", dashSelected);

    // 5. ポータルへ戻る
    await page.evaluate(() => { window.location.hash = "#portal"; });
    await page.waitForFunction(() => {
      const v = document.getElementById("portal-view");
      return !!v && v.classList.contains("active");
    }, undefined, { timeout: 10000 });
    const portalActiveAgain = await page.evaluate(() => {
      const v = document.getElementById("portal-view");
      return !!v && v.classList.contains("active");
    });
    assert("7_portal_active_after_return", portalActiveAgain, portalActiveAgain);

    // pageerror チェック（少し待って非同期エラーも拾う）
    await page.waitForTimeout(300);
    assert("8_no_page_errors", pageErrors.length === 0, pageErrors);
    console.log("(参考・非合否) consoleNoise=" + JSON.stringify(consoleNoise));
    console.log("(参考・非合否) httpNoise=" + JSON.stringify(httpNoise));

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
