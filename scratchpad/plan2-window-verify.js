// Plan 2 一覧窓表示の検証（Playwright・headless）。
//  mock_prod_server.py を PLAN2_INFLATE=300 で子プロセス起動 → 窓化の各不変条件を検証。
//  実行: NODE_PATH=/home/shugo/node_modules node scratchpad/plan2-window-verify.js
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8231;                         // 既定 8200 と衝突しない専用ポート
const BASE = `http://127.0.0.1:${PORT}`;
const INFLATE = 300;
const CHUNK = 60;

let failures = 0;
function check(name, cond, extra) {
  const ok = !!cond;
  if (!ok) failures++;
  console.log(`${ok ? "✅" : "❌"} ${name}${extra ? "  " + extra : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function trCount(page) {
  return page.$$eval(".portal-table tbody tr", (els) => els.length);
}
async function sentinelCount(page) {
  return page.$$eval(".portal-sentinel", (els) => els.length);
}

async function main() {
  // --- mock server を子プロセスで起動（PLAN2_PORT で専用ポート・PLAN2_INFLATE で銘柄増幅） ---
  const srv = spawn("python3", [path.join(ROOT, "scratchpad", "mock_prod_server.py")],
    { env: { ...process.env, PLAN2_INFLATE: String(INFLATE), PLAN2_PORT: String(PORT) }, stdio: "inherit" });

  const waitReady = async (b) => {
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(b + "/api/market/list"); if (r.ok) return true; } catch (_) {}
      await sleep(100);
    }
    return false;
  };

  const base = BASE;
  const ready = await waitReady(BASE);
  check("mock server ready", ready, base);
  if (!ready) { srv.kill("SIGKILL"); process.exit(1); }

  // ヒット件数（inflate 後）を API から取得
  const listJson = await (await fetch(base + "/api/market/list")).json();
  const TOTAL_ALL = Object.keys(listJson.stocks).length;
  console.log(`   list stocks (inflated): ${TOTAL_ALL}`);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const pageErrors = [];       // 真の JS 例外（gate 対象）
  const resource404 = [];      // リソースロード失敗（情報・私の JS 変更と独立）
  const consoleErrs = [];      // その他 console.error
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("requestfailed", (r) => resource404.push(r.url() + " (" + (r.failure() && r.failure().errorText) + ")"));
  page.on("response", (r) => { if (r.status() === 404) resource404.push("404 " + r.url()); });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource/i.test(t)) return;   // リソース404は resource404 で別集計
    consoleErrs.push(t);
  });

  await page.goto(base + "/", { waitUntil: "load" });
  // 既定フィルタ = stock_only。グリッド描画待ち。
  await page.waitForSelector(".portal-table tbody tr", { timeout: 10000 });
  await sleep(400);

  // 既定 stock_only の全ヒット数（窓化されていなければ全部、窓化されていれば ~CHUNK）
  // screening-count は非表示（フィルタ無し）なので、全量は「全部スクロール後の tr 数」で確定する。
  const initial = await trCount(page);
  const sentinels0 = await sentinelCount(page);
  check("初期描画 = 窓化（tr < 全ヒット, 概ね CHUNK 近傍）", initial <= CHUNK + 12 && initial >= 1,
        `initial=${initial}`);
  check("sentinel が1個存在（全ヒット > CHUNK 前提）", sentinels0 === 1, `sentinels=${sentinels0}`);

  // --- スクロールで増分 → 全量到達で sentinel 消滅 ---
  let last = initial;
  let grew = false;
  let finalCount = initial;
  for (let s = 0; s < 30; s++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(180);
    const c = await trCount(page);
    if (c > last) grew = true;
    last = c;
    finalCount = c;
    if ((await sentinelCount(page)) === 0) break;
  }
  check("スクロールで増分描画される", grew, `final=${finalCount}`);
  const stockOnlyTotal = finalCount;
  check("全量到達で sentinel 消滅", (await sentinelCount(page)) === 0);
  check("全量描画 tr 数 = 初期より大（窓化が効いていた証拠）", stockOnlyTotal > initial,
        `initial=${initial} full=${stockOnlyTotal}`);

  // --- ソート変更で window リセット（先頭チャンクへ戻る） ---
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.portal-table th[onclick="setSort(\'marketCap\')"]');
  await sleep(300);
  const afterSort = await trCount(page);
  check("ソート変更で window リセット（tr が先頭チャンクへ縮小）", afterSort <= CHUNK + 12 && afterSort < stockOnlyTotal,
        `afterSort=${afterSort}`);
  check("ソート後も sentinel 復活（未完了）", (await sentinelCount(page)) === 1);

  // ソート降順の正当性（marketCap desc: 先頭行の marketCap >= 後続の一部）※順序は各セクター内なので緩く確認
  // 省略可：ここでは reset の件数のみを gate にする。

  // --- 検索で 0件 → empty-state、実クエリで reset ---
  await page.fill("#portal-search", "___no_such_company_xyz___");
  await sleep(400);   // debounce 180ms + 余裕
  const emptyText = await page.$eval("#portal-container", (el) => el.textContent || "");
  check("検索0件で empty-state メッセージ", emptyText.includes("該当する企業が見つかりません"),
        JSON.stringify(emptyText.slice(0, 40)));
  check("empty-state 時は tr 0 / sentinel 0", (await trCount(page)) === 0 && (await sentinelCount(page)) === 0);

  await page.fill("#portal-search", "");
  await sleep(400);
  const afterClear = await trCount(page);
  check("検索クリアで再描画＝先頭チャンク（reset）", afterClear <= CHUNK + 12 && afterClear >= 1, `afterClear=${afterClear}`);

  // --- term-help: 各描画済みセクション見出しに .term-help がちょうど1個ずつ（二重注入なし） ---
  const termStats = await page.evaluate(() => {
    const sections = Array.from(document.querySelectorAll("#portal-container .sector-section"));
    let bad = 0, total = 0;
    sections.forEach((sec) => {
      const th = sec.querySelector('th[data-term="growth-rate"]');
      if (!th) { bad++; return; }
      const n = th.querySelectorAll(".term-help").length;
      total++;
      if (n !== 1) bad++;
    });
    return { sections: sections.length, bad, total };
  });
  check("各セクション見出しに term-help がちょうど1個（冪等・二重なし）", termStats.bad === 0,
        JSON.stringify(termStats));

  // スクロールで増えたセクションにも term-help があるか（全量展開後）
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.click('.portal-table th[onclick="setSort(\'ticker\')"]');
  await sleep(250);
  for (let s = 0; s < 30; s++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(150);
    if ((await sentinelCount(page)) === 0) break;
  }
  const termStats2 = await page.evaluate(() => {
    const ths = Array.from(document.querySelectorAll('#portal-container th[data-term="growth-rate"]'));
    let bad = 0;
    ths.forEach((th) => { if (th.querySelectorAll(".term-help").length !== 1) bad++; });
    return { headers: ths.length, bad };
  });
  check("全量展開後も全セクション見出しに term-help 1個ずつ", termStats2.bad === 0, JSON.stringify(termStats2));

  // --- 行クリック → 詳細ビュー（スクロールで後から出た行でも動く） ---
  await page.evaluate(() => window.scrollTo(0, 0));
  const firstTicker = await page.$eval(".portal-table tbody tr .ticker-code", (el) => el.textContent.trim());
  await page.click(".portal-table tbody tr");
  await sleep(500);
  const detailActive = await page.$eval("#detail-view", (el) => el.classList.contains("active"));
  check("行クリックで詳細ビューへ遷移", detailActive, `firstTicker=${firstTicker}`);

  // 一覧へ戻り、スクロールで後から出た行のクリックも検証
  await page.evaluate(() => { if (window.navigateToPortal) window.navigateToPortal(); else window.showView && window.showView("portal"); });
  await sleep(300);
  await page.waitForSelector(".portal-table tbody tr", { timeout: 5000 });
  for (let s = 0; s < 20; s++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await sleep(150);
    if ((await sentinelCount(page)) === 0) break;
  }
  const rows = await page.$$(".portal-table tbody tr");
  if (rows.length > CHUNK) {
    await rows[rows.length - 1].click();   // 後から窓に入った行
    await sleep(400);
    const detailActive2 = await page.$eval("#detail-view", (el) => el.classList.contains("active"));
    check("スクロールで後から出た行のクリックも詳細へ", detailActive2);
    await page.evaluate(() => { if (window.navigateToPortal) window.navigateToPortal(); else window.showView && window.showView("portal"); });
    await sleep(200);
  } else {
    check("スクロールで後から出た行のクリックも詳細へ（rows<=CHUNKでskip）", true, "skipped");
  }

  // --- JS 例外 0（gate）／リソース404 は情報（私の JS 変更と独立・要 baseline 突合） ---
  check("JS pageerror 0", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  check("非リソース console.error 0", consoleErrs.length === 0, consoleErrs.slice(0, 3).join(" | "));
  if (resource404.length) {
    const uniq = [...new Set(resource404)];
    console.log("ℹ️ リソース404（情報・baseline 突合対象）: " + uniq.slice(0, 6).join(" | "));
  }

  await browser.close();
  srv.kill("SIGKILL");

  console.log(`\n${failures === 0 ? "🎉 ALL PASS" : "💥 " + failures + " FAILURE(S)"}  (inflated total=${TOTAL_ALL})`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
