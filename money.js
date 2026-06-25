// money.js — お金の司令塔(MCC) ブラウザ層。window.MCCRules(純関数)をDOMへ適用する薄い層。
window.MCC = (function () {
  "use strict";
  var R = window.MCCRules;
  var state = null;

  function load() {
    try {
      var raw = localStorage.getItem(R.STORAGE_KEY);
      state = R.migrate(raw ? JSON.parse(raw) : null);
    } catch (e) { state = R.defaultState(); }
    return state;
  }

  function save() {
    try { localStorage.setItem(R.STORAGE_KEY, JSON.stringify(state)); return true; }
    catch (e) { return false; }
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

  function moneyInput(label, path, value, vm) {
    return '<label class="mcc-field"><span>' + label + '</span>' +
      '<input type="number" min="0" step="1000" value="' + value + '" ' +
      'onchange="MCC.setField(\'' + path + '\', this.value)"></label>';
  }

  function render() {
    var root = document.getElementById("mcc-root");
    if (!root) return;
    var vm = R.viewModel(state);

    var gauge =
      '<div class="mcc-gauge-card">' +
        '<div class="mcc-gauge-label">バッファ目標（生活防衛資金）</div>' +
        '<div class="mcc-gauge-bar"><div class="mcc-gauge-fill" style="width:' + vm.bufferProgressPct + '%"></div></div>' +
        '<div class="mcc-gauge-stat"><strong>' + vm.bufferProgressPct + '%</strong> ' +
          '（' + vm.fmt(vm.bufferAmount) + ' / ' + vm.fmt(vm.bufferTarget) + '）' +
          (vm.bufferRemaining > 0 ? ' ・あと ' + vm.fmt(vm.bufferRemaining) : ' ・達成') +
        '</div>' +
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
          moneyInput("金額", "buckets.buffer.amount", vm.bufferAmount, vm) + '</div>' +
        '<div class="mcc-bucket"><div class="mcc-bucket-name">コア（長期）</div>' +
          moneyInput("金額", "buckets.core.amount", vm.coreAmount, vm) + '</div>' +
        '<div class="mcc-bucket' + (vm.satelliteIsOver ? ' mcc-bucket-over' : '') + '">' +
          '<div class="mcc-bucket-name">サテライト（個別株/短期）</div>' +
          moneyInput("金額", "buckets.satellite.amount", vm.satelliteAmount, vm) +
          '<div class="mcc-sat-bar"><div class="mcc-sat-fill' + (vm.satelliteIsOver ? " over" : "") +
            '" style="width:' + Math.min(100, vm.satelliteFillPct) + '%"></div></div>' +
          '<div class="mcc-sat-cap">上限 ' + vm.fmt(vm.satelliteCap) + '（investable比 ' + vm.satelliteCapPct + '%）</div>' +
          satWarn +
        '</div>' +
      '</div>';

    var settings =
      '<details class="mcc-settings"><summary>設定</summary>' +
        moneyInput("月の生活費", "monthlyExpense", vm.monthlyExpense, vm) +
        moneyInput("バッファ目標（ヶ月）", "bufferMonths", vm.bufferMonths, vm) +
        moneyInput("サテライト上限（%）", "satelliteCapPct", vm.satelliteCapPct, vm) +
      '</details>';

    root.innerHTML = gauge + banner + buckets + settings;
  }

  function init() {
    if (!R) return;
    load();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { init: init, show: show, backToPortal: backToPortal, setField: setField, load: load, save: save, render: render };
})();
