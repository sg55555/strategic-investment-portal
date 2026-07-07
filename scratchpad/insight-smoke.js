// AI読み解き（束D層2）統合スモーク（Task 11）。
// 使い方: MOCK_ADVICE_MODE=personal .venv/bin/python scratchpad/mock_prod_server.py & \
//         NODE_PATH=/home/shugo/node_modules node scratchpad/insight-smoke.js ; kill %1
//
// 実際に組んだアサーション（すべて失敗時 throw・非到達では PASS 扱いにしない）:
//   A. detail view 到達の独立証明: #dupont-card が isVisible===true（insight ゲートと
//      無関係な layer1 カード＝production で ai-insight-card が隠れていても、これが
//      true なら「view は本当にレンダリングされた」と証明できる＝production の
//      「非表示」と「view 未到達」を区別する）。
//   B. モードはサーバの /api/auth/session（session.py の実ゲートと同じ真実源）から判定。
//   C. personal: #ai-insight-card / #ai-insight-btn が isVisible===true（false なら throw）
//      →click→headline が正準文言と完全一致（非空チェックでなく厳密等価）。
//   D. production: #ai-insight-card が isVisible===false（true なら throw＝痕跡ゼロの証明）。
//   E. pageerrors === 0（両モード共通）。
//   F. browser.close() は try/finally で必ず実行（アサート失敗時も chromium を残さない）。
const { chromium } = require("playwright");

const EXPECTED_HEADLINE = "収益の質は堅調";

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("http://127.0.0.1:8200/", { waitUntil: "networkidle" });
    await page.waitForFunction(
      () => typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0,
      { timeout: 8000 }
    );
    // 注意: 本アプリの F3 中央ルーターは deep-link 不採用（stale な #detail/#money で開かれたら
    //  window.onload が hash を除去し portal で起動する設計・意図的）。よって直接
    //  goto("...#detail/7203.T") では detail-view に到達できない（getStock 未実行＝財務未ハイドレート）。
    //  既存 scratchpad/detail-snapshot.js と同じ手順で: portal を読み込み→STOCK_DATA 充足を待ち→
    //  page.evaluate(() => navigateToDetail(ticker)) で遷移する。
    await page.evaluate(() => { if (typeof navigateToDetail === "function") navigateToDetail("7203.T"); });
    await page.waitForTimeout(800);

    // --- A. detail view 到達の独立証明（mode-agnostic） ---
    const dupontVisible = await page.isVisible("#dupont-card");
    console.log("dupont-card visible (detail view loaded):", dupontVisible);
    if (dupontVisible !== true) {
      throw new Error(
        "#dupont-card is not visible — detail view for 7203.T never rendered " +
        "(navigation/financials load broken; independent of insight gate)"
      );
    }

    // --- B. モードはサーバ自身（/api/auth/session）から判定 ---
    const cap = await page.evaluate(() =>
      fetch("/api/auth/session", { credentials: "same-origin" }).then((r) => r.json())
    );
    console.log("session cap:", JSON.stringify(cap));
    if (typeof cap.insightEnabled !== "boolean") {
      throw new Error("cap.insightEnabled missing/not boolean — cannot determine mode: " + JSON.stringify(cap));
    }

    const cardVisible = await page.isVisible("#ai-insight-card");
    console.log("card visible:", cardVisible);

    if (cap.insightEnabled === true) {
      // --- C. personal branch ---
      if (cardVisible !== true) {
        throw new Error("personal mode: #ai-insight-card is not visible (expected true)");
      }
      const btnVisible = await page.isVisible("#ai-insight-btn");
      console.log("btn visible:", btnVisible);
      if (btnVisible !== true) {
        throw new Error("personal mode: #ai-insight-btn is not visible (expected true)");
      }
      const btn = await page.$("#ai-insight-btn");
      await btn.click();
      await page.waitForTimeout(500);
      const headline = await page.textContent(".ai-ins-headline").catch(() => null);
      console.log("headline:", headline);
      if (headline !== EXPECTED_HEADLINE) {
        throw new Error(
          `personal mode: headline mismatch — expected exactly "${EXPECTED_HEADLINE}", got ${JSON.stringify(headline)}`
        );
      }
    } else {
      // --- D. production branch ---
      if (cardVisible !== false) {
        throw new Error("production mode: #ai-insight-card is visible (expected false — zero-trace gate)");
      }
    }

    // --- E. pageerrors === 0 ---
    console.log("pageerrors:", errors.length);
    if (errors.length) throw new Error("pageerror: " + errors[0]);

    console.log("SMOKE OK");
  } finally {
    // --- F. browser.close() は失敗時も必ず実行 ---
    await browser.close();
  }
})().catch((e) => {
  console.error("SMOKE FAILED:", e.message);
  process.exit(1);
});
