// #1 サブパネル C1-C4 受入（spec §4.5）: DOM 計測＋ソース照合。
//  LWC の chart/priceLine インスタンスは IIFE 私有で page から到達不能・軸ラベルは canvas 描画で DOM に
//  無いため、①7本の createPriceLine のソース照合 ②LWC が生成する table 構造（行=ペイン/時間軸・
//  最終セル=右軸）の DOM 実測、の2手段で機械判定する（spec §4.5 = 敵対検証 H3 の受入手段置換）。
const { chromium } = require("playwright");
const fs = require("fs");
let failed = 0;
function check(name, ok, extra) {
  console.log((ok ? "  ✅ " : "  ❌ ") + name + (extra === undefined ? "" : `  [${extra}]`));
  if (!ok) failed++;
}
// page.evaluate 用: アコーディオン各項目の LWC DOM 実測（DOM 順で返る）
const SNAP = () => [...document.querySelectorAll("#subpanel-accordion .acc-item")].map((it) => {
  const host = it.querySelector(".subpanel-host");
  const tbl = host.querySelector("table");
  const rows = tbl ? [...tbl.rows] : [];
  const rh = (i) => (rows[i] ? Math.round(rows[i].getBoundingClientRect().height) : -1);
  const lastCell = rows[0] ? rows[0].cells[rows[0].cells.length - 1] : null;
  return {
    key: it.dataset.key,
    mounted: !!tbl,
    axisW: lastCell ? Math.round(lastCell.getBoundingClientRect().width) : -1,
    paneH: rh(0), axisH: rh(1),
    hostH: host.clientHeight,
    charts: host.querySelectorAll(".tv-lightweight-charts").length,
    metric: (it.querySelector(".acc-metric") || {}).textContent || "",
  };
});
(async () => {
  // ── ① ソース照合（C1/C2/C3）
  const src = fs.readFileSync("detail-charts.js", "utf8");
  [
    ["RSI 70", /price: 70,[^\n]*axisLabelVisible: false/],
    ["RSI 50", /price: 50,[^\n]*axisLabelVisible: false/],
    ["RSI 30", /price: 30,[^\n]*axisLabelVisible: false/],
    ["MACD 0線", /hist\.createPriceLine\(\{ price: 0,[^\n]*axisLabelVisible: false/],
    ["ADX 25", /price: 25,[^\n]*axisLabelVisible: false/],
    ["ATR 中央", /medLine = series\.createPriceLine\(\{ price: \+med\.toFixed\(2\),[^\n]*axisLabelVisible: false/],
    ["OBV 0線", /price: 0, color: "rgba\(148,163,184,0\.25\)"[^\n]*axisLabelVisible: false/],
  ].forEach(([n, re]) => check(`C1: ${n} が axisLabelVisible:false`, re.test(src)));
  check("C2: OBV が priceFormat volume", /lineWidth: 1\.8,[\s\S]{0,200}priceFormat: \{ type: "volume" \}/.test(src));
  check("C2/C3: subBaseOpts = scaleMargins 0.16 + minimumWidth 72",
    /rightPriceScale: \{ borderColor: "#2a3a44", scaleMargins: \{ top: 0\.16, bottom: 0\.16 \}, minimumWidth: 72 \}/.test(src));
  check("C2: メイン rightPriceScale minimumWidth 72",
    /rightPriceScale: \{ borderColor: "#2a3a44", minimumWidth: 72 \}/.test(src));

  // ── ② DOM 実測
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:8200", { waitUntil: "networkidle" });
  await page.evaluate(() => navigateToDetail("7203.T"));
  await page.waitForTimeout(2500);
  // 5枚全展開（既定 adx+atr／追加分は SOFT_CAP=2 で畳んだまま追加される→「すべて開く」で開く）
  await page.evaluate(() => ["rsi", "macd", "obv"].forEach((k) => document.getElementById("sp-chip-" + k)?.click()));
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.getElementById("subpanel-links").querySelectorAll("a")[0].click());
  await page.waitForTimeout(1800);

  let s = await page.evaluate(SNAP);
  check("5枚とも mount 済み", s.length === 5 && s.every((x) => x.mounted), s.map((x) => x.key).join(","));
  const ws = s.map((x) => x.axisW);
  check("C2: 右軸幅が全サブパネルで一致", new Set(ws).size === 1, ws.join("/"));
  check("C2: 右軸幅 = minimumWidth 72", ws.every((w) => w === 72), ws.join("/"));
  const atr = s.find((x) => x.key === "atr");
  check("D25 代替: ATR にのみ中央値バッジ",
    /^中央 \d+(\.\d+)?%$/.test(atr.metric) && s.filter((x) => x.key !== "atr").every((x) => x.metric === ""),
    s.map((x) => x.key + ":" + JSON.stringify(x.metric)).join(" "));

  // ATR を畳む→バッジは空へ（stale 値を残さない）→再展開で復帰
  const clickAtrHead = () => [...document.querySelectorAll("#subpanel-accordion .acc-item")]
    .find((it) => it.dataset.key === "atr").querySelector(".acc-head").click();
  await page.evaluate(clickAtrHead);
  await page.waitForTimeout(900);
  s = await page.evaluate(SNAP);
  check("ATR 畳み: バッジが空へ", s.find((x) => x.key === "atr").metric === "");
  await page.evaluate(clickAtrHead);
  await page.waitForTimeout(1500);
  s = await page.evaluate(SNAP);
  check("ATR 再展開: バッジ復帰", /^中央 \d+(\.\d+)?%$/.test(s.find((x) => x.key === "atr").metric));

  // ── ③ C4: 時間軸は DOM 最下段のみ＋高さ補償（TIME_AXIS_H は b0-measured.md の実測値）
  const TIME_AXIS_H = 28;
  const BASE_H = { rsi: 100, macd: 104, adx: 132, atr: 104, obv: 104 };
  const axisKeys = (arr) => arr.filter((x) => x.axisH > 0).map((x) => x.key);
  check("C4: createChart は常に軸 OFF 生成", /timeScale: \{ borderColor: "#2a3a44", visible: false \}/.test(src));
  check("C4: SUBPANEL_REGISTRY の timeAxis フラグ廃止", !/timeAxis/.test(src));
  check("C4: _updateSubTimeAxes = 定義1＋呼出2", (src.match(/_updateSubTimeAxes\(\)/g) || []).length === 3,
    String((src.match(/_updateSubTimeAxes\(\)/g) || []).length));
  const dsrc = fs.readFileSync("detail.js", "utf8");
  check("C4: MACD 高さ 104 の二重定義ミラー",
    /macd: \{ height: 104,/.test(src) && /key: "macd",[^\n]*height: 104,/.test(dsrc));

  s = await page.evaluate(SNAP);
  check("C4: 軸を持つのは1枚だけ", axisKeys(s).length === 1, axisKeys(s).join(","));
  check("C4: 軸は DOM 最下段", axisKeys(s)[0] === s[s.length - 1].key, `${axisKeys(s)[0]} vs ${s[s.length - 1].key}`);
  check("C4: 軸行の高さ = TIME_AXIS_H", s[s.length - 1].axisH === TIME_AXIS_H, String(s[s.length - 1].axisH));
  check("C4: host 高 = ペイン高+軸高（canvas はみ出しゼロ）",
    s.every((x) => x.hostH === x.paneH + Math.max(x.axisH, 0)),
    JSON.stringify(s.map((x) => [x.key, x.hostH, x.paneH, x.axisH])));
  check("C4: 高さ補償 = base(+28 は最下段のみ)",
    s.every((x) => x.hostH === BASE_H[x.key] + (x.axisH > 0 ? TIME_AXIS_H : 0)),
    JSON.stringify(s.map((x) => x.key + ":" + x.hostH)));

  // 最下段を「外す」→ 軸が新しい最下段へ移る
  await page.evaluate(() => {
    const items = [...document.querySelectorAll("#subpanel-accordion .acc-item")];
    items[items.length - 1].querySelector(".acc-close").click();
  });
  await page.waitForTimeout(1200);
  s = await page.evaluate(SNAP);
  check("C4: 最下段除去後も軸は1枚・新最下段",
    axisKeys(s).length === 1 && axisKeys(s)[0] === s[s.length - 1].key, axisKeys(s).join(",") + " / " + s.map((x) => x.key).join(","));
  check("C4: 除去後の高さ補償も整合", s.every((x) => x.hostH === BASE_H[x.key] + (x.axisH > 0 ? TIME_AXIS_H : 0)),
    JSON.stringify(s.map((x) => x.key + ":" + x.hostH)));

  // resizeSubpanels 二重呼び出しで高さが累積しない（冪等）
  await page.evaluate(() => { DetailCharts.resizeSubpanels(); DetailCharts.resizeSubpanels(); });
  await page.waitForTimeout(400);
  const s2 = await page.evaluate(SNAP);
  check("C4: resize 冪等（高さ累積なし）",
    JSON.stringify(s2.map((x) => x.hostH)) === JSON.stringify(s.map((x) => x.hostH)),
    JSON.stringify(s2.map((x) => x.hostH)));

  // rAF 世代ガード: 同一チップの高速 4 連打（add→remove→add→remove→add 相当）でも chart は host あたり1個
  await page.evaluate(() => { const c = document.getElementById("sp-chip-rsi"); c.click(); c.click(); c.click(); c.click(); });
  await page.waitForTimeout(2000);
  const s3 = await page.evaluate(SNAP);
  check("rAF 世代ガード: host あたり chart は 1 個以下", s3.every((x) => x.charts <= 1),
    JSON.stringify(s3.map((x) => x.key + ":" + x.charts)));
  // 注: SOFT_CAP(=2 in detail.js・Task8対象外) により rsi は連打後「DOM末尾だが未マウント」になり得る
  //  （既に3枚(adx/atr/macd)展開中の状態から add→remove を繰り返すと再展開がキャップでブロックされるため）。
  //  未マウントの acc-item は chart を持たず時間軸も持ち得ない＝比較対象は「DOM順で最後にマウント済み」の枠。
  const s3Mounted = s3.filter((x) => x.mounted);
  check("C4: 連打後も軸は最下段(マウント済み)1枚",
    axisKeys(s3).length === 1 && axisKeys(s3)[0] === s3Mounted[s3Mounted.length - 1].key,
    axisKeys(s3).join(",") + " / " + s3.map((x) => x.key + (x.mounted ? "" : "(unmounted)")).join(","));

  check("pageerror 0", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
  process.exit(failed === 0 ? 0 : 1);
})();
