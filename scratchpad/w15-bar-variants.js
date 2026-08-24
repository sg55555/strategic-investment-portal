/* セクターヒートマップ「タイル内の細いバー」の可読性・改善案の実物比較。
 *
 *   NODE_PATH=/home/shugo/node_modules node scratchpad/w15-bar-shots.js
 *   （比較シートは scratchpad/w15-bar-sheet.py が合成）
 *
 * 何が問題か（実機指摘）: タイルの背景は中立→緑/赤の5段グラデーション。一方バーは固定色で
 * 台=赤系 rgba(255,80,110,.55) / 伸び=緑 rgba(0,214,110,.95)。**濃い緑のタイルでは緑の上に緑**、
 * 濃い赤のタイルでは赤の上に赤になり、下地とバーが同じ意味の色を二重に使って潰し合う。
 *
 * 変数として持っているのは「バーの色をどう決めるか」だけ。タイルの背景色（＝指標の強さ）と
 * 文字色（_heatInk が上位2段で黒に切り替える）は触らない。
 */
const W15_BAR_VARIANTS = {
  "0": {
    name: "現状",
    note: "台=赤系／伸び=緑（固定）。濃い緑・濃い赤のタイルで潰れる",
    css: "",
  },
  "A": {
    name: "文字色に追従",
    note: "台=文字色22%／伸び=文字色。_heatInk が下地に対して可読な色を選んでいるので必ず読める",
    css: `
      .w15-bar { background: color-mix(in srgb, currentColor 22%, transparent) !important; }
      .w15-bar > i { background: currentColor !important; }
    `,
  },
  "B": {
    name: "暗い台＋明るい伸び",
    note: "台=暗color/伸び=明色で固定。下地の色に関係なく同じ見え方になる",
    css: `
      .w15-bar { background: rgba(6,18,26,.45) !important;
                 box-shadow: inset 0 0 0 1px rgba(6,18,26,.55); }
      .w15-bar > i { background: rgba(236,248,255,.92) !important; }
    `,
  },
  "C": {
    name: "色は残し暗い縁で分離",
    note: "赤/緑の意味を保ったまま、台を暗くし1pxの暗い縁で下地から切り離す",
    css: `
      .w15-bar { background: rgba(6,18,26,.55) !important;
                 box-shadow: inset 0 0 0 1px rgba(6,18,26,.75); }
      .w15-bar > i { background: rgba(0,230,120,1) !important;
                     box-shadow: inset 0 0 0 1px rgba(6,18,26,.35); }
    `,
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = W15_BAR_VARIANTS;
