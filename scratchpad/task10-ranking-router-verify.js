// Task10: #ranking-view ルーター配線の smoke（renderRanking 本体は Task11/12 未実装＝空でOK）
const { chromium } = require("playwright");

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { console.log(`  PASS: ${label}`); pass++; }
  else { console.log(`  FAIL: ${label}`); fail++; }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  await page.goto("http://127.0.0.1:8200/", { waitUntil: "networkidle" });
  await page.waitForSelector("#ranking-entry", { timeout: 10000 });

  console.log("--- (a) 初期状態: portal が active ---");
  check("portal-view が active", await page.$eval("#portal-view", (el) => el.classList.contains("active")));
  check("ranking-view は非active", !(await page.$eval("#ranking-view", (el) => el.classList.contains("active"))));

  console.log("--- (b) ▤ランキング クリック → ranking-view が active、他は非active ---");
  await page.click("#ranking-entry");
  await page.waitForTimeout(150);
  check("ranking-view が active", await page.$eval("#ranking-view", (el) => el.classList.contains("active")));
  check("portal-view は非active", !(await page.$eval("#portal-view", (el) => el.classList.contains("active"))));
  check("detail-view は非active", !(await page.$eval("#detail-view", (el) => el.classList.contains("active"))));
  check("money-view は非active", !(await page.$eval("#money-view", (el) => el.classList.contains("active"))));
  check("location.hash = #ranking", (await page.evaluate(() => location.hash)) === "#ranking");

  console.log("--- (c) ranking-view 内マークアップ骨格の存在確認 ---");
  check("rk-mkt-JP ボタン(active)が存在", await page.$eval("#rk-mkt-JP", (el) => el.classList.contains("active")));
  check("rk-mkt-US ボタンが存在", (await page.$("#rk-mkt-US")) !== null);
  check("rk-metric select が存在", (await page.$("#rk-metric")) !== null);
  check("rk-scatter canvas が存在", (await page.$("#rk-scatter")) !== null);
  check("rk-sector-strip が存在", (await page.$("#rk-sector-strip")) !== null);
  check("rk-table が存在", (await page.$("#rk-table")) !== null);
  check("rk-disclaimer が存在", (await page.$("#rk-disclaimer")) !== null);

  console.log("--- (d) 戻る(← 一覧へ) → portal に戻る ---");
  await page.click(".rk-back");
  await page.waitForTimeout(150);
  check("portal-view が active", await page.$eval("#portal-view", (el) => el.classList.contains("active")));
  check("ranking-view は非active", !(await page.$eval("#ranking-view", (el) => el.classList.contains("active"))));
  check("location.hash = #portal", (await page.evaluate(() => location.hash)) === "#portal");

  console.log("--- (e) #ranking ハッシュ直遷移（onHashChange経路）---");
  await page.evaluate(() => { location.hash = "#ranking"; });
  await page.waitForTimeout(150);
  check("hash直遷移でranking-viewがactive", await page.$eval("#ranking-view", (el) => el.classList.contains("active")));

  console.log("--- (f) window.navigateToRanking が公開されている ---");
  check("typeof window.navigateToRanking === 'function'", await page.evaluate(() => typeof window.navigateToRanking === "function"));
  check("typeof window.setRankMarket !== 'function' (Task11未実装=想定通り)", await page.evaluate(() => typeof window.setRankMarket !== "function"));
  check("typeof window.renderRanking !== 'function' (Task12未実装=想定通り)", await page.evaluate(() => typeof window.renderRanking !== "function"));

  console.log("--- (g) pageerror ---");
  check("pageerror 0件", pageErrors.length === 0);
  if (pageErrors.length) console.log(pageErrors);

  await browser.close();
  console.log(fail === 0 ? "\n✅ ALL PASS" : `\n❌ FAIL: ${fail} 件`);
  process.exit(fail === 0 ? 0 : 1);
})();
