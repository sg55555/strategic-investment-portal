/* 52週レンジバーの「現在地マーカー」配色の実物比較ハーネス。
 *
 *   W2_INJECT_FILE=w2-marker-variants.js W2_INJECT=1 python3 scratchpad/w2-mock-server.py
 *   → http://127.0.0.1:8220/  で銘柄を開き、右下のバーで案とレンジ内位置を切り替える
 *
 * 何を比べるか: トラックは左（くすんだ灰）→右（シアン）のグラデーションで、マーカーも
 * 明るいシアン。**レンジ上部（SPY の 92% など）でマーカーが下地に溶けて見えなくなる**
 * という実機指摘への対応案を、同じ画面上で見比べる。
 *
 * ⚠ これは throwaway の比較ハーネス。採用した案だけを detail.css へ移植する。
 */
(function () {
  "use strict";

  // 各案は「トラック側の CSS」と「マーカー側の CSS」の組。現状(0)を必ず含めて差を見る。
  var VARIANTS = [
    {
      key: "0", name: "現状", note: "トラック=灰→シアン／マーカー=明シアン",
      css: "",
    },
    {
      key: "1", name: "白コア＋暗縁", note: "下地の色に関係なく必ず読める（最も堅い）",
      css: [
        "body[data-mk='1'] .w2-52w-marker{",
        "  background:var(--ix-text-max);",
        "  box-shadow:0 0 0 1px var(--ix-bg-void), 0 0 6px color-mix(in srgb, var(--ix-cyan) 45%, transparent);",
        "}",
      ].join("\n"),
    },
    {
      key: "2", name: "トラック中立化", note: "下地からシアンを抜き、マーカーだけが色を持つ",
      css: [
        "body[data-mk='2'] .w2-52w-track{",
        "  background:linear-gradient(90deg,",
        "    color-mix(in srgb, var(--ix-slate-line) 18%, transparent),",
        "    color-mix(in srgb, var(--ix-slate-line) 40%, transparent));",
        "}",
      ].join("\n"),
    },
    {
      key: "3", name: "暗い溝＋発光", note: "マーカーの左右に地色の溝を作って必ず分離する",
      css: [
        "body[data-mk='3'] .w2-52w-marker{",
        "  width:3px;",
        "  background:var(--ix-cyan-light);",
        "  box-shadow:0 0 0 2px var(--ix-bg-void), 0 0 8px color-mix(in srgb, var(--ix-cyan) 70%, transparent);",
        "}",
      ].join("\n"),
    },
    {
      key: "4", name: "アンバー", note: "下地のシアンと補色関係＝位置に関係なく分離する",
      css: [
        "body[data-mk='4'] .w2-52w-marker{",
        "  background:var(--ix-amber);",
        "  box-shadow:0 0 0 1px var(--ix-bg-void), 0 0 7px color-mix(in srgb, var(--ix-amber) 55%, transparent);",
        "}",
      ].join("\n"),
    },
    {
      key: "5", name: "白コア＋トラック中立", note: "案1と案2の合わせ（最も無彩色寄り）",
      css: [
        "body[data-mk='5'] .w2-52w-track{",
        "  background:linear-gradient(90deg,",
        "    color-mix(in srgb, var(--ix-slate-line) 18%, transparent),",
        "    color-mix(in srgb, var(--ix-slate-line) 40%, transparent));",
        "}",
        "body[data-mk='5'] .w2-52w-marker{",
        "  background:var(--ix-text-max);",
        "  box-shadow:0 0 0 1px var(--ix-bg-void), 0 0 6px color-mix(in srgb, var(--ix-white) 35%, transparent);",
        "}",
      ].join("\n"),
    },
  ];

  // 実機で問題が出るのは上端側。両端と中央を含めて確認できるようにする。
  var POSITIONS = [8, 36, 50, 78, 92, 100];

  var mk = "0", pos = null;   // pos=null は実データのまま

  function injectCss() {
    var st = document.createElement("style");
    st.id = "mk-style";
    st.textContent = VARIANTS.map(function (v) { return v.css; }).join("\n") + "\n" + BAR_CSS;
    document.head.appendChild(st);
    document.body.setAttribute("data-mk", mk);
  }

  /* pos52 を差し替えて再描画する（paint52wBar は px をそのまま読むので、px を書けば反映される）。 */
  function applyPos() {
    if (pos === null) return;
    var d = STOCK_DATA[currentTicker];
    if (!d || !d.px) return;
    d.px.pos52 = pos;
    // dh（高値までの距離）も辻褄を合わせておく（表示文言が pos と矛盾すると比較の邪魔になる）
    d.px.dh = pos >= 100 ? 0 : -(100 - pos) / 2;
    window.Detail.updateFinancialViews();
  }

  var BAR_CSS = [
    "#mk-bar{position:fixed;right:12px;bottom:12px;z-index:99999;display:flex;flex-direction:column;gap:6px;",
    "background:rgba(4,8,13,0.94);border:1px solid #2a3a44;border-radius:6px;padding:10px;",
    "font:12px ui-monospace,Menlo,Consolas,monospace;color:#a8bcc6;box-shadow:0 8px 30px rgba(0,0,0,0.6);max-width:360px}",
    "#mk-bar .row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
    "#mk-bar button{background:transparent;border:1px solid #2a3a44;color:#7f95a3;border-radius:3px;",
    "padding:4px 8px;cursor:pointer;font:inherit;font-weight:bold}",
    "#mk-bar button.on{border-color:#00e5ff;color:#00e5ff;background:rgba(0,229,255,0.12)}",
    "#mk-bar .note{color:#8ba2af;line-height:1.5}",
  ].join("");

  function buildBar() {
    var bar = document.createElement("div");
    bar.id = "mk-bar";

    var r1 = document.createElement("div");
    r1.className = "row";
    r1.appendChild(label("案"));
    VARIANTS.forEach(function (v) {
      var b = document.createElement("button");
      b.textContent = v.key + " " + v.name;
      b.className = v.key === mk ? "on" : "";
      b.onclick = function () {
        mk = v.key;
        document.body.setAttribute("data-mk", mk);
        [].forEach.call(r1.querySelectorAll("button"), function (x) { x.className = ""; });
        b.className = "on";
        note.textContent = v.note;
      };
      r1.appendChild(b);
    });

    var r2 = document.createElement("div");
    r2.className = "row";
    r2.appendChild(label("位置"));
    var mkBtn = function (text, val) {
      var b = document.createElement("button");
      b.textContent = text;
      b.className = val === pos ? "on" : "";
      b.onclick = function () {
        pos = val;
        [].forEach.call(r2.querySelectorAll("button"), function (x) { x.className = ""; });
        b.className = "on";
        if (val === null) location.reload();   // 実データへ戻すのは再読込が確実
        else applyPos();
      };
      return b;
    };
    r2.appendChild(mkBtn("実データ", null));
    POSITIONS.forEach(function (p) { r2.appendChild(mkBtn(p + "%", p)); });

    var note = document.createElement("div");
    note.className = "note";
    note.textContent = VARIANTS[0].note;

    bar.appendChild(r1);
    bar.appendChild(r2);
    bar.appendChild(note);
    document.body.appendChild(bar);
  }

  function label(t) {
    var s = document.createElement("span");
    s.textContent = t;
    return s;
  }

  function boot() {
    injectCss();
    buildBar();
    console.log("[mk] 52週マーカー比較ハーネス ready（案0=現状）");
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.__MK = {
    set variant(v) { mk = v; document.body.setAttribute("data-mk", v); },
    set pos(p) { pos = p; applyPos(); },
  };
})();
