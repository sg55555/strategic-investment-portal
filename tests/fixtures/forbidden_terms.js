// tests/fixtures/forbidden_terms.js — 規制安全の共有辞書（禁止語彙 fixture）。
// api/me/advice.py の _TRADE_RE / _FORECAST_RE を JS 用に逐語転記（Python re と JS RegExp は本パターンの範囲で
// 構文互換のため、文字クラス・非捕捉群・選択をそのまま移植）。
// 出典: api/me/advice.py:98-108（_TRADE_RE は 98-103, _FORECAST_RE は 105-108）。
// advice.py の該当正規表現を改訂したら本ファイルも必ず同期すること（乖離するとテストが規制安全を保証しなくなる）。
"use strict";

// 売買・タイミング（advice.py _TRADE_RE 98-103）。
const TRADE = /買い(?:増し|足し|場|時|付け|まし|ます|なさい|ください)|買う|購入|仕込み?|押し目買い|逆張り|順張り|ドテン|利食い|戻り売り|高値掴み|空売り|ナンピン|売り(?:場|時|まし|ます|なさい|ください)|売る|売却|利確|利益確定|損切り?|今が買い|今が売り|エントリー|手仕舞/;

// 相場予測・保証（advice.py _FORECAST_RE 105-108）。
const FORECAST = /必勝|確実に儲|必ず上が|必ず下が|急騰|暴落|利益を保証|元本保証|値上がり確実|(?:相場|価格|株価|利回り|金利|為替|指数|市場)[^。]{0,12}(?:上がるでしょう|下がるでしょう|上昇する|下落する|急騰|暴落|期待でき)/;

module.exports = { TRADE, FORECAST, ALL: [TRADE, FORECAST] };
