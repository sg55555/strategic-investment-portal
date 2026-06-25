// money.js — お金の司令塔(MCC) ブラウザ層。window.MCCRules(純関数)をDOMへ適用する薄い層。
window.MCC = (function () {
  "use strict";
  var R = window.MCCRules;
  var state = null;
  var lastSaveOk = true;

  function load() {
    try {
      var raw = localStorage.getItem(R.STORAGE_KEY);
      state = R.migrate(raw ? JSON.parse(raw) : null);
    } catch (e) { state = R.defaultState(); }
    return state;
  }

  function save() {
    var ok;
    try { localStorage.setItem(R.STORAGE_KEY, JSON.stringify(state)); ok = true; }
    catch (e) { ok = false; }
    lastSaveOk = ok;
    return ok;
  }

  // path 例: "monthlyExpense" / "bufferMonths" / "satelliteCapPct" / "buckets.buffer.amount"
  function setField(path, value) {
    if (!state) load();
    var parts = path.split(".");
    var obj = state;
    for (var i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = Number(value) >= 0 ? Number(value) : 0;
    save();
    render();
  }

  function show() {
    var views = document.querySelectorAll(".view-section");
    for (var i = 0; i < views.length; i++) views[i].classList.remove("active");
    document.getElementById("money-view").classList.add("active");
    window.scrollTo(0, 0);
  }

  function backToPortal() {
    document.getElementById("money-view").classList.remove("active");
    document.getElementById("portal-view").classList.add("active");
    window.scrollTo(0, 0);
  }

  function moneyInput(label, path, value) {
    return '<label class="mcc-field"><span>' + label + '</span>' +
      '<input type="number" min="0" step="1000" value="' + value + '" ' +
      'onchange="MCC.setField(\'' + path + '\', this.value)"></label>';
  }

  function render() {
    var root = document.getElementById("mcc-root");
    if (!root) return;
    var vm = R.viewModel(state);

    var gaugeStat = vm.bufferConfigured
      ? ('<strong>' + vm.bufferProgressPct + '%</strong> ' +
          '（' + vm.fmt(vm.bufferAmount) + ' / ' + vm.fmt(vm.bufferTarget) + '）' +
          (vm.bufferRemaining > 0 ? ' ・あと ' + vm.fmt(vm.bufferRemaining) : ' ・達成'))
      : '未設定 — 「設定」で月の生活費を入力するとバッファ目標が決まります';
    var gauge =
      '<div class="mcc-gauge-card">' +
        '<div class="mcc-gauge-label">バッファ目標（生活防衛資金）</div>' +
        '<div class="mcc-gauge-bar"><div class="mcc-gauge-fill" style="width:' + (vm.bufferConfigured ? vm.bufferProgressPct : 0) + '%"></div></div>' +
        '<div class="mcc-gauge-stat">' + gaugeStat + '</div>' +
      '</div>';

    var banner =
      '<div class="mcc-banner mcc-banner-' + vm.next.target + '">' +
        '<span class="mcc-banner-icon">▶</span><span>' + vm.next.message + '</span>' +
      '</div>';

    var satWarn = vm.satelliteIsOver
      ? '<div class="mcc-sat-warn">⚠ 上限超過 ' + vm.fmt(vm.satelliteOver) + '</div>' : '';
    var buckets =
      '<div class="mcc-buckets">' +
        '<div class="mcc-bucket"><div class="mcc-bucket-name">バッファ（現金）</div>' +
          moneyInput("金額", "buckets.buffer.amount", vm.bufferAmount) + '</div>' +
        '<div class="mcc-bucket"><div class="mcc-bucket-name">コア（長期）</div>' +
          moneyInput("金額", "buckets.core.amount", vm.coreAmount) + '</div>' +
        '<div class="mcc-bucket' + (vm.satelliteIsOver ? ' mcc-bucket-over' : '') + '">' +
          '<div class="mcc-bucket-name">サテライト（個別株/短期）</div>' +
          moneyInput("金額", "buckets.satellite.amount", vm.satelliteAmount) +
          '<div class="mcc-sat-bar"><div class="mcc-sat-fill' + (vm.satelliteIsOver ? " over" : "") +
            '" style="width:' + Math.min(100, vm.satelliteFillPct) + '%"></div></div>' +
          '<div class="mcc-sat-cap">上限 ' + vm.fmt(vm.satelliteCap) + '（investable比 ' + vm.satelliteCapPct + '%）</div>' +
          satWarn +
        '</div>' +
      '</div>';

    var settings =
      '<details class="mcc-settings"><summary>設定</summary>' +
        moneyInput("月の生活費", "monthlyExpense", vm.monthlyExpense) +
        moneyInput("バッファ目標（ヶ月）", "bufferMonths", vm.bufferMonths) +
        moneyInput("サテライト上限（%）", "satelliteCapPct", vm.satelliteCapPct) +
      '</details>';

    var isEmpty = vm.monthlyExpense === 0 && vm.bufferAmount === 0 && vm.coreAmount === 0 && vm.satelliteAmount === 0;
    var onboarding = isEmpty
      ? '<div class="mcc-onboard">まず「設定」で月の生活費を、各バケツに現在の金額を入力してください。実データはこの端末（localStorage）にのみ保存され、外部送信されません。</div>'
      : '';
    var tools =
      '<div class="mcc-tools">' +
        '<button class="mcc-tool-btn" onclick="MCC.exportJSON()">↓ エクスポート(JSON)</button>' +
        '<label class="mcc-tool-btn">↑ インポート<input type="file" accept="application/json" style="display:none" ' +
          'onchange="if(this.files[0])MCC.importJSON(this.files[0])"></label>' +
      '</div>';

    var saveWarn = lastSaveOk ? '' : '<div class="mcc-save-warn">⚠ 保存できませんでした（プライベートブラウズ等）。この端末に値が保存されない可能性があります。</div>';
    root.innerHTML = saveWarn + onboarding + gauge + banner + buckets + settings + tools;
  }

  function exportJSON() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mcc_state.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try { state = R.migrate(JSON.parse(reader.result)); save(); render(); }
      catch (e) { alert("読み込みに失敗しました（JSONが不正です）"); }
    };
    reader.onerror = function () { alert("ファイルの読み込みに失敗しました"); };
    reader.readAsText(file);
  }

  function init() {
    if (!R) return;
    load();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { init: init, show: show, backToPortal: backToPortal, setField: setField, load: load, save: save, render: render, exportJSON: exportJSON, importJSON: importJSON };
})();
