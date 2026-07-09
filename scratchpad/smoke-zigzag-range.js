// 統合スモーク（headless）: 詳細ビュー実描画で ZigZag レンジ帯を検証。
// GPU グロー（案B primitive の光彩）は headless では非authoritative（本人が実機で最終確認）なので、
// ここでの合否は (必須) pageerror0・詳細ビューで canvases>0・T/R トグルが例外なく動く、の3点。
// レンジチップ（disc-chip「レンジ」）はデータ依存で出ないこともある＝出た場合のみ中立語をアサートし、
// 出ないこと自体は失敗にしない（brief §Ambiguity resolution）。
//
// 合否ゲートは pageerror のみ（既存 scratchpad/detail-snapshot.js・f2-snapshot.js の規約に合わせる）。
// console 'error' は Chromium がネットワーク404も"console error"として流すため参考ログに留める
// （実測: index.html の /_vercel/insights/script.js 404＝mock server が Vercel Analytics 未実装ゆえの
//  既知の無害ノイズ・ZigZag改修と無関係・pageerror にはならない）。
const { chromium } = require("playwright");

(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 1200 } });
  const errs = []; // pageerror のみ = 合否ゲート
  const consoleErrs = []; // console error = 参考ログのみ（非ゲート）
  p.on("pageerror", (e) => errs.push("PAGEERROR: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") consoleErrs.push("CONSOLE: " + m.text()); });

  await p.goto("http://127.0.0.1:8200/", { waitUntil: "networkidle" });

  // 銘柄詳細へ（実 DOM 確認済＝ポータル行に .stock-row/data-ticker は無く、
  // <tr onclick="navigateToDetail(ticker)"> のみ。行は非同期フェッチ後に描画されるため待つ）。
  await p.waitForSelector(".portal-table tbody tr", { timeout: 15000 });
  await p.click(".portal-table tbody tr");

  // チャート実描画（lightweight-charts の canvas 生成）を待つ。
  await p.waitForSelector("#chart-container canvas", { timeout: 15000 });
  await p.waitForTimeout(1200);

  // T/R トグル ON（新 drawTRLines + 案B グロー帯 primitive が例外なく動くか）。
  const tr = await p.$("#ind-btn-tr");
  if (tr) {
    await tr.click();
    await p.waitForTimeout(600);
  }

  // ON 状態でスクショ（帯の一本化を目視確認するため・旧ギザギザ非再発）。
  await p.screenshot({ path: "scratchpad/zigzag-range-smoke.png", fullPage: true });
  const chartBox = await p.$("#chart-container");
  if (chartBox) await chartBox.screenshot({ path: "scratchpad/zigzag-range-smoke-chart.png" });

  // OFF に戻す（両方向で例外が出ないことも確認）。
  if (tr) {
    await tr.click();
    await p.waitForTimeout(600);
  }

  const res = await p.evaluate(() => {
    const chip = Array.from(document.querySelectorAll(".disc-chip .k")).find((e) => e.textContent.includes("レンジ"));
    const chipText = chip ? (chip.parentElement.querySelector(".v") || {}).textContent || "" : "";
    return {
      discipline: !!document.querySelector("#discipline-card"),
      rangeChip: !!chip,
      rangeChipText: chipText, // 例「横ばい帯の中（帯幅…%・…点接触）」＝中立語のみを目視/アサート
      canvases: document.querySelectorAll("#chart-container canvas").length,
      trBtnFound: !!document.getElementById("ind-btn-tr"),
    };
  });

  // レンジチップが出た場合のみ中立語アサート（売買シグナル語や煽り語を含まないこと）。
  let neutralCheck = "(N/A: chip absent)";
  if (res.rangeChip) {
    const forbidden = ["買い", "売り", "急騰", "急落", "チャンス", "危険", "推奨"];
    const hit = forbidden.find((w) => res.rangeChipText.includes(w));
    neutralCheck = hit ? `NG: forbidden word "${hit}" in chip text` : "OK: neutral";
  }

  console.log("result:", JSON.stringify(res));
  console.log("neutralCheck:", neutralCheck);
  console.log("pageerrors:", errs.length ? errs.join("\n") : "(none)");
  console.log("console-errors(non-gating, informational):", consoleErrs.length ? consoleErrs.join("\n") : "(none)");

  await b.close();

  if (errs.length) process.exit(1);
  if (res.canvases === 0) { console.log("FAIL: canvases===0"); process.exit(1); }
  if (!res.trBtnFound) { console.log("FAIL: #ind-btn-tr not found"); process.exit(1); }
  if (res.rangeChip && neutralCheck.indexOf("NG") === 0) { console.log("FAIL:", neutralCheck); process.exit(1); }
})();
