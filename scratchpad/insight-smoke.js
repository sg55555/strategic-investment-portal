// AI読み解き（束D層2）統合スモーク（Task 11）。
// 使い方: MOCK_ADVICE_MODE=personal .venv/bin/python scratchpad/mock_prod_server.py & \
//         NODE_PATH=/home/shugo/node_modules node scratchpad/insight-smoke.js ; kill %1
//
// personal: カード表示→ボタン出現→click→カード描画（headline 検証）
// production: カード非表示・ボタン非表示（click 分岐に入らない＝痕跡ゼロ）
//
// 注意: 本アプリの F3 中央ルーターは deep-link 不採用（stale な #detail/#money で開かれたら
//  window.onload が hash を除去し portal で起動する設計・意図的）。よって直接
//  goto("...#detail/7203.T") では detail-view に到達できない（getStock 未実行＝財務未ハイドレート）。
//  既存 scratchpad/detail-snapshot.js と同じ手順で: portal を読み込み→STOCK_DATA 充足を待ち→
//  page.evaluate(() => navigateToDetail(ticker)) で遷移する。
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://127.0.0.1:8200/", { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
    { timeout: 8000 }
  );
  await page.evaluate(() => { if (typeof navigateToDetail === "function") navigateToDetail("7203.T"); });
  await page.waitForTimeout(800);

  // ai-insight-btn は .ai-insight-card 内の静的 markup（常に DOM 上に存在・自身に display:none は
  //  無い）。「非表示」の実体はカード側 display:none のカスケードなので、単純な DOM 存在（$）でなく
  //  isVisible（祖先の display も含めた実可視性）で判定する＝production で「btn: false」が実態と一致する。
  const cardVisible = await page.isVisible("#ai-insight-card");
  const btnVisible = await page.isVisible("#ai-insight-btn");
  console.log("card visible:", cardVisible, "btn:", btnVisible);

  if (cardVisible && btnVisible) {
    const btn = await page.$("#ai-insight-btn");
    await btn.click();
    await page.waitForTimeout(500);
    const headline = await page.textContent(".ai-ins-headline").catch(() => null);
    console.log("headline:", headline);
    if (!headline) throw new Error("insight card did not render after click");
  }

  console.log("pageerrors:", errors.length);
  if (errors.length) throw new Error("pageerror: " + errors[0]);

  await browser.close();
  console.log("SMOKE OK");
})();
