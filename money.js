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

  function render() {
    var root = document.getElementById("mcc-root");
    if (!root) return;
    root.innerHTML = '<p class="mcc-placeholder">司令塔（描画はTask3で実装）</p>';
  }

  function init() {
    if (!R) return;
    load();
    render();
  }

  document.addEventListener("DOMContentLoaded", init);

  return { init: init, show: show, backToPortal: backToPortal, setField: setField, load: load, save: save, render: render };
})();
