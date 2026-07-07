// scratchpad/task13-bundleD-integration.js — Task13 束D層1 最終ハードニング・統合スモーク。
//
// equity（7203.T=JP / AAPL=US）× 幅（1920/1024/768）で:
//   #dupont-card: 3因数(dp-factor×4=3因数+ROE)・dp-op×3・恒等式(生値・詳細は下記メソッド)・
//                 SVGスパークライン・driver「純資産ベース」・免責。
//   #fcf-trend-card: canvas描画(Chart.getChart('fcfTrend'))・注記「概算FCF」・免責。
//   ETF(1321.T): 両カード display:none。
//   規制grep: 両カードの innerHTML に禁止語彙0（tests/fixtures/forbidden_terms.js の FORBIDDEN.ALL＝
//     advice.py _TRADE_RE/_FORECAST_RE の単一源 fixture を再利用。手ロールしない）。
//   pageerror0（全幅・全銘柄）。
//
// 恒等式の検算方法: DOM表示はROUNDED（netMargin/roe=toFixed(1), assetTurnover/equityMultiplier=toFixed(2)）
//   のため、丸め後テキストで検算すると数%ずれ得る（false-fail要因）。よって
//   window.DetailRules.dupontDescriptor(fin) の RAW 返却値（factors[i].value / roe.value）で
//   netMargin×assetTurnover×equityMultiplier ≈ roe を検算（絶対差 < 1e-6・finance-rules.test.js の
//   既存許容と同じ絶対誤差方式＝%スケールの数値同士なので絶対差で十分）。
//   別途、表示テキスト(dp-fval)が RAW 値の丸めと自己整合していることも許容差(1decimal±0.05001 /
//   2decimal±0.00501)で検証する。
const path = require("path");
const { chromium } = require("playwright");
const FORBIDDEN = require(path.join(__dirname, "..", "tests", "fixtures", "forbidden_terms.js"));

const BASE = "http://127.0.0.1:8200";
const WIDTHS = [1920, 1024, 768];
const JP = "7203.T";
const US = "AAPL";
const ETF = "1321.T";

async function gotoDetail(page, ticker) {
  await page.evaluate((t) => { navigateToDetail(t); }, ticker);
  await page.waitForTimeout(1100);
}

// ブラウザ context 内で実行（equity 用）。
function inspectEquity(ticker) {
  const data = STOCK_DATA[ticker];
  const years = Object.keys((data && data.financials_trend) || {}).sort((a, b) => b - a);
  const year = years[0] || null;
  const fin = year ? data.financials_trend[year] : null;
  const d = window.DetailRules.dupontDescriptor(fin);

  const dpCard = document.getElementById("dupont-card");
  const dpBody = document.getElementById("dupont-body");
  const factorEls = dpBody ? Array.from(dpBody.querySelectorAll(".dp-factor")) : [];
  const displayed = {};
  factorEls.forEach((el) => {
    const labelEl = el.querySelector(".dp-flabel");
    const valEl = el.querySelector(".dp-fval");
    const sparkEl = el.querySelector(".dp-fspark svg.dp-spark");
    const term = labelEl ? labelEl.getAttribute("data-term") : ("_unknown_" + factorEls.indexOf(el));
    displayed[term] = {
      text: valEl ? valEl.textContent.trim() : null,
      hasSparkSvg: !!sparkEl,
      sparkHasPolyline: sparkEl ? !!sparkEl.querySelector("polyline") : false,
    };
  });
  const driverEl = dpBody ? dpBody.querySelector(".dp-driver") : null;
  const dpDiscEl = dpBody ? dpBody.querySelector(".panel-disclaimer") : null;

  const fcCard = document.getElementById("fcf-trend-card");
  const cv = document.getElementById("fcfTrend");
  const chartInst = (typeof Chart !== "undefined" && typeof Chart.getChart === "function") ? Chart.getChart("fcfTrend") : null;
  const fcNoteEl = document.getElementById("fcf-trend-note");
  const fcDiscEl = document.getElementById("fcf-trend-disclaimer");

  return {
    ticker, year,
    dpPresent: !!dpCard,
    dpVisible: dpCard ? getComputedStyle(dpCard).display !== "none" : false,
    dpCardCount: document.querySelectorAll("#dupont-card").length,
    dpFactorCount: factorEls.length,
    dpOpCount: dpBody ? dpBody.querySelectorAll(".dp-op").length : 0,
    raw: {
      netMargin: d.factors[0].value, assetTurnover: d.factors[1].value,
      equityMultiplier: d.factors[2].value, roe: d.roe.value,
    },
    displayed,
    driverText: driverEl ? driverEl.textContent : null,
    dpDiscText: dpDiscEl ? dpDiscEl.textContent.trim() : null,
    dpDiscLen: dpDiscEl ? dpDiscEl.textContent.trim().length : 0,
    dpInnerHTML: dpCard ? dpCard.innerHTML : "",

    fcPresent: !!fcCard,
    fcVisible: fcCard ? getComputedStyle(fcCard).display !== "none" : false,
    fcCardCount: document.querySelectorAll("#fcf-trend-card").length,
    fcCanvasW: cv ? cv.clientWidth : 0,
    fcCanvasH: cv ? cv.clientHeight : 0,
    fcChartAttached: !!chartInst,
    fcNoteText: fcNoteEl ? fcNoteEl.textContent : null,
    fcDiscText: fcDiscEl ? fcDiscEl.textContent.trim() : null,
    fcDiscLen: fcDiscEl ? fcDiscEl.textContent.trim().length : 0,
    fcInnerHTML: fcCard ? fcCard.innerHTML : "",
  };
}

function inspectEtf() {
  const dp = document.getElementById("dupont-card");
  const fc = document.getElementById("fcf-trend-card");
  return {
    dpDisplay: dp ? getComputedStyle(dp).display : null,
    fcDisplay: fc ? getComputedStyle(fc).display : null,
  };
}

function parseNum(text) {
  if (text == null) return null;
  if (text.trim() === "--") return null;
  const v = parseFloat(text.replace(/[^0-9.\-]/g, ""));
  return isFinite(v) ? v : null;
}

async function runWidth(browser, width, fails, allResults) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForFunction(
    () => (typeof STOCK_DATA === "object" && STOCK_DATA && Object.keys(STOCK_DATA).length > 0),
    { timeout: 10000 }
  );

  const wr = { width, jp: null, us: null, etf: null, pageErrorCount: 0, pageErrors: [] };

  // ── equities: JP / US ──
  for (const [label, ticker] of [["JP", JP], ["US", US]]) {
    await gotoDetail(page, ticker);
    const r = await page.evaluate(inspectEquity, ticker);
    wr[label.toLowerCase()] = r;
    const tag = `w${width}/${label}(${ticker})`;

    if (!r.dpPresent) fails.push(`${tag}: dupont-card 不在`);
    if (!r.dpVisible) fails.push(`${tag}: dupont-card 非表示`);
    if (r.dpCardCount !== 1) fails.push(`${tag}: dupont-card 重複 ${r.dpCardCount}`);
    if (r.dpFactorCount !== 4) fails.push(`${tag}: dp-factor 数不一致(期待4) ${r.dpFactorCount}`);
    if (r.dpOpCount !== 3) fails.push(`${tag}: dp-op 数不一致(期待3) ${r.dpOpCount}`);
    if (!r.driverText || !r.driverText.includes("純資産ベース")) fails.push(`${tag}: driver に「純資産ベース」なし: ${r.driverText}`);
    if (!r.dpDiscLen) fails.push(`${tag}: dupont-card 免責文が空`);

    // SVGスパークライン: 3因数+ROE いずれも svg.dp-spark を保持し、複数年データ(3年)ゆえ polyline も持つこと。
    const terms = ["net-margin", "asset-turnover", "financial-leverage", "roe"];
    for (const term of terms) {
      const dd = r.displayed[term];
      if (!dd) { fails.push(`${tag}: displayed[${term}] 不在`); continue; }
      if (!dd.hasSparkSvg) fails.push(`${tag}: ${term} に svg.dp-spark 不在`);
      if (!dd.sparkHasPolyline) fails.push(`${tag}: ${term} の sparkline に polyline 不在(欠測扱い?)`);
    }

    // 恒等式（RAW値・絶対差<1e-6）。3年ぶんの入力が揃っている想定(mock DB確認済)だが、
    // 万一 null 混在時はスキップし記録のみ(false-fail回避)。
    const { netMargin, assetTurnover, equityMultiplier, roe } = r.raw;
    if (netMargin != null && assetTurnover != null && equityMultiplier != null && roe != null) {
      const product = netMargin * assetTurnover * equityMultiplier;
      const diff = Math.abs(product - roe);
      if (!(diff < 1e-6)) fails.push(`${tag}: 恒等式不一致 netMargin*at*em=${product} vs roe=${roe} diff=${diff}`);
    } else {
      fails.push(`${tag}: 恒等式検算スキップ(因数null: netMargin=${netMargin} at=${assetTurnover} em=${equityMultiplier} roe=${roe})`);
    }

    // 表示テキストの自己整合(RAW値の丸めと一致)。
    function checkDisplayed(term, rawVal, decimals) {
      const dd = r.displayed[term];
      if (!dd) return;
      const shown = parseNum(dd.text);
      if (rawVal == null) {
        if (shown !== null) fails.push(`${tag}: ${term} raw=null なのに表示値あり(${dd.text})`);
        return;
      }
      if (shown === null) { fails.push(`${tag}: ${term} raw=${rawVal} なのに表示「--」`); return; }
      const tol = decimals === 1 ? 0.05001 : 0.00501;
      const d2 = Math.abs(shown - rawVal);
      if (!(d2 < tol)) fails.push(`${tag}: ${term} 表示値(${shown})がRAW(${rawVal})の丸めと不整合 diff=${d2} tol=${tol}`);
    }
    checkDisplayed("net-margin", netMargin, 1);
    checkDisplayed("asset-turnover", assetTurnover, 2);
    checkDisplayed("financial-leverage", equityMultiplier, 2);
    checkDisplayed("roe", roe, 1);

    // ── #fcf-trend-card ──
    if (!r.fcPresent) fails.push(`${tag}: fcf-trend-card 不在`);
    if (!r.fcVisible) fails.push(`${tag}: fcf-trend-card 非表示`);
    if (r.fcCardCount !== 1) fails.push(`${tag}: fcf-trend-card 重複 ${r.fcCardCount}`);
    if (!r.fcCanvasW || r.fcCanvasW <= 0) fails.push(`${tag}: fcfTrend canvas 0幅(0x0罠) ${r.fcCanvasW}`);
    if (!r.fcCanvasH || r.fcCanvasH <= 0) fails.push(`${tag}: fcfTrend canvas 0高さ(0x0罠) ${r.fcCanvasH}`);
    if (!r.fcChartAttached) fails.push(`${tag}: Chart.getChart('fcfTrend') 未取得`);
    if (!r.fcNoteText || !r.fcNoteText.includes("概算FCF")) fails.push(`${tag}: 注記に「概算FCF」なし: ${r.fcNoteText}`);
    if (!r.fcDiscLen) fails.push(`${tag}: fcf-trend-card 免責文が空`);

    // ── 規制grep（両カード innerHTML）──
    for (const re of FORBIDDEN.ALL) {
      if (re.test(r.dpInnerHTML)) fails.push(`${tag}: dupont-card innerHTML に禁止語彙一致(${re})`);
      if (re.test(r.fcInnerHTML)) fails.push(`${tag}: fcf-trend-card innerHTML に禁止語彙一致(${re})`);
    }
  }

  // ── ETF: 両カード非表示 ──
  await gotoDetail(page, ETF);
  const etfR = await page.evaluate(inspectEtf);
  wr.etf = etfR;
  const etag = `w${width}/ETF(${ETF})`;
  if (etfR.dpDisplay !== "none") fails.push(`${etag}: dupont-card が display:none でない (${etfR.dpDisplay})`);
  if (etfR.fcDisplay !== "none") fails.push(`${etag}: fcf-trend-card が display:none でない (${etfR.fcDisplay})`);

  wr.pageErrorCount = pageErrors.length;
  wr.pageErrors = pageErrors.slice(0, 10);
  if (pageErrors.length) fails.push(`w${width}: pageerror ${pageErrors.length}件: ${JSON.stringify(pageErrors.slice(0, 5))}`);

  allResults.push(wr);
  await page.close();
}

(async () => {
  const browser = await chromium.launch();
  const fails = [];
  const allResults = [];

  for (const width of WIDTHS) {
    await runWidth(browser, width, fails, allResults);
  }

  await browser.close();

  console.log(JSON.stringify(allResults, null, 2));
  if (fails.length) {
    console.error("FAIL:\n- " + fails.join("\n- "));
    process.exitCode = 1;
  } else {
    console.log("PASS: all assertions green (widths=" + WIDTHS.join(",") + ")");
  }
})().catch((e) => { console.error("SCRIPT ERROR:", e); process.exit(1); });
