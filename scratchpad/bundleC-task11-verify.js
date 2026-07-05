// Task11: プリセット CRUD（clear-first・esc・confirm）検証。
// python3 http.server + route-mock FIXTURE + pageerror listener + dialog queue（prompt/confirm/alert を順番に処理）。
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const { FIXTURE } = require("./bundleC-fixture.js");
const WT = "/home/shugo/apps/investment-portal/.claude/worktrees/bundleC-discipline-tools";
const PORT = 8975;

(async () => {
  const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: WT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 900));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));

  // ダイアログ（prompt/confirm/alert）を順番に処理するキュー。予期しないダイアログ（XSS実行等）は dismiss してカウント。
  const dialogQueue = [];
  let unexpectedDialogs = 0;
  page.on("dialog", async (dialog) => {
    const next = dialogQueue.shift();
    if (!next) { unexpectedDialogs++; await dialog.dismiss(); return; }
    if (next.action === "accept") await dialog.accept(next.value);
    else await dialog.dismiss();
  });

  await page.route("**/api/market/list", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(FIXTURE) })
  );
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForSelector(".portal-table tbody tr", { timeout: 8000 });

  await page.click("#screening-toggle");
  await page.waitForTimeout(200);

  const getOptions = async () => page.$$eval("#scr-preset-select option", (opts) => opts.map((o) => o.textContent));
  const getLS = async () => page.evaluate(() => JSON.parse(localStorage.getItem("sip_screener_presets") || "[]"));
  const clickSave = () => page.click(".screening-preset-btn:not(.del)");
  const clickDelete = () => page.click(".screening-preset-btn.del");

  // ---- 0) 初期状態：0件 placeholder ----
  const opts0 = await getOptions();
  const initPlaceholderTest = opts0.length === 1 && opts0[0].includes("保存済みなし");

  // ---- 1) Save：ROE min=8 を保存 ----
  await page.fill("#scr-roe-min", "8");
  await page.dispatchEvent("#scr-roe-min", "input");
  await page.waitForTimeout(100);
  dialogQueue.push({ action: "accept", value: "テスト" });
  await clickSave();
  await page.waitForTimeout(200);
  const opts1 = await getOptions();
  const ls1 = await getLS();
  const saveTest =
    opts1.some((t) => t === "テスト") &&
    ls1.length === 1 &&
    ls1[0].name === "テスト" &&
    ls1[0].criteria.roe && ls1[0].criteria.roe.min === 8;

  // ---- 2) Clear-first load：別軸(pbr-max=2)を入力後プリセット選択 → 旧値が残らず復元のみ反映 ----
  await page.fill("#scr-pbr-max", "2");
  await page.dispatchEvent("#scr-pbr-max", "input");
  await page.waitForTimeout(100);
  // 既に "テスト" が選択済み(save直後のrefreshPresetSelect)の可能性があるため、一度placeholderへ戻してchangeを確実発火
  await page.selectOption("#scr-preset-select", "");
  await page.waitForTimeout(50);
  await page.selectOption("#scr-preset-select", { label: "テスト" });
  await page.waitForTimeout(200);
  const pbrMaxAfter = await page.inputValue("#scr-pbr-max");
  const roeMinAfter = await page.inputValue("#scr-roe-min");
  const clearFirstTest = pbrMaxAfter === "" && roeMinAfter === "8";

  // ---- 3) Delete（confirm）----
  dialogQueue.push({ action: "accept" }); // confirm
  await clickDelete();
  await page.waitForTimeout(200);
  const opts3 = await getOptions();
  const ls3 = await getLS();
  const deleteTest = !opts3.some((t) => t === "テスト") && ls3.length === 0;

  // ---- 4) キャンセル（no-op）----
  dialogQueue.push({ action: "dismiss" });
  await clickSave();
  await page.waitForTimeout(150);
  const lsCancel = await getLS();
  const cancelTest = lsCancel.length === 0;

  // ---- 5) 空白のみの名前（trim後0字 → alert経路・保存されない）----
  dialogQueue.push({ action: "accept", value: "   " }); // prompt
  dialogQueue.push({ action: "accept" });                // alert
  await clickSave();
  await page.waitForTimeout(150);
  const lsWhitespace = await getLS();
  const whitespaceTest = lsWhitespace.length === 0;

  // ---- 6) XSS-safe name：textContent のみ・onerror 発火なし ----
  const xssName = "<img src=x onerror=alert(1)>";
  dialogQueue.push({ action: "accept", value: xssName });
  await clickSave();
  await page.waitForTimeout(200);
  const opts6 = await getOptions();
  const xssTest = opts6.includes(xssName) && unexpectedDialogs === 0;

  // ---- 7) 全削除 → 0件 placeholder ----
  dialogQueue.push({ action: "accept" }); // confirm（refreshPresetSelect(xssName)で既に選択済み）
  await clickDelete();
  await page.waitForTimeout(200);
  const opts7 = await getOptions();
  const ls7 = await getLS();
  const emptyPlaceholderTest = opts7.length === 1 && opts7[0].includes("保存済みなし") && ls7.length === 0;

  await browser.close();
  server.kill();

  const result = {
    initPlaceholderTest, saveTest, clearFirstTest, deleteTest,
    cancelTest, whitespaceTest, xssTest, emptyPlaceholderTest,
    unexpectedDialogs, errors,
  };
  const ok =
    initPlaceholderTest && saveTest && clearFirstTest && deleteTest &&
    cancelTest && whitespaceTest && xssTest && emptyPlaceholderTest &&
    unexpectedDialogs === 0 && errors.length === 0;

  console.log(JSON.stringify({ ...result, PASS: ok }, null, 2));
  process.exit(ok ? 0 : 1);
})();
