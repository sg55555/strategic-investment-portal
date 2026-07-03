// tests/detail-termhelp.test.js — detail.js の termHelp(term) 純文字列ビルダーの錠（レビュー指摘の追加テスト）。
// detail.js は index.html inline global(document/currentTicker/STOCK_DATA 等)へ依存する IIFE のため
// require() できない（detail-rules.js の UMD と異なる）。termHelp/_indGlo は DOM 非依存・window.esc と
// window.DetailRules.INDICATOR_GLOSSARY のみを読むので、vm.createContext で最小 window stub を与えて
// ロードし、文字列出力だけを検証する（injectTermHelp の DOM 副作用は対象外＝Playwright 側に委譲）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const DETAIL_JS_SRC = fs.readFileSync(path.join(__dirname, "..", "detail.js"), "utf8");

// index.html の esc() と同型（money.js/detail.js が期待する window.esc の契約を再現）。
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// 各テストごとに独立した vm context で detail.js をロードする（テスト間 / detail-rules.test.js との
// グローバル汚染を避けるため runInContext + 都度 createContext・実 Node global には一切触れない）。
function loadDetail(glossary) {
  const windowStub = {
    esc,
    DetailRules: { INDICATOR_GLOSSARY: glossary },
  };
  const context = { window: windowStub };
  vm.createContext(context);
  vm.runInContext(DETAIL_JS_SRC, context, { filename: "detail.js" });
  return context.window.Detail;
}

const XSS_TERM = {
  term: "rsi",
  read: "RSI（相対力指数）",
  def: 'これは "危険" な水準 & <script>alert(1)</script> 域に注意',
};

test("termHelp: 既知termは term-help span を返す（構造・属性）", () => {
  const Detail = loadDetail([XSS_TERM]);
  const html = Detail.termHelp("rsi");
  assert.equal(typeof html, "string");
  assert.ok(html.includes('class="term-help"'), html);
  assert.ok(html.includes('tabindex="0"'), html);
  assert.ok(html.includes('role="note"'), html);
  assert.ok(html.includes("data-def="), html);
  assert.ok(html.includes("aria-label="), html);
  assert.ok(html.includes(">?</span>"), html);
});

test("termHelp: onclick を一切含まない（inline handler 不使用＝CSPフレンドリーの規制/安全ガード）", () => {
  const Detail = loadDetail([XSS_TERM]);
  const html = Detail.termHelp("rsi");
  assert.ok(!/onclick/i.test(html), `unexpected onclick in: ${html}`);
});

test("termHelp: read/def中の <, >, \", & は data-def/aria-label 内でエスケープされる（生では出ない）", () => {
  const Detail = loadDetail([XSS_TERM]);
  const html = Detail.termHelp("rsi");

  // エスケープ後の期待断片（window.esc 適用済み）
  assert.ok(html.includes("&quot;危険&quot;"), html);           // " → &quot;
  assert.ok(html.includes("&amp;"), html);                        // & → &amp;
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), html); // < > → &lt; &gt;

  // 生のタグ/引用符が漏れていないこと（XSS/属性崩壊防止の直接証拠）
  assert.ok(!html.includes("<script>"), html);
  assert.ok(!html.includes("</script>"), html);

  // data-def / aria-label のどちらの属性値にもエスケープ済みテキストが載っていること
  const defMatch = html.match(/data-def="([^"]*)"/);
  const ariaMatch = html.match(/aria-label="([^"]*)"/);
  assert.ok(defMatch, html);
  assert.ok(ariaMatch, html);
  assert.ok(defMatch[1].includes("&lt;script&gt;"), defMatch[1]);
  assert.ok(ariaMatch[1].includes("&lt;script&gt;"), ariaMatch[1]);
});

test("termHelp: 未知termは空文字列を返す（no-op・安全側フォールバック）", () => {
  const Detail = loadDetail([XSS_TERM]);
  assert.equal(Detail.termHelp("no-such-term"), "");
});

test("termHelp: グロッサリが空/未定義でも安全に空文字列を返す", () => {
  const Detail = loadDetail([]);
  assert.equal(Detail.termHelp("rsi"), "");
});
