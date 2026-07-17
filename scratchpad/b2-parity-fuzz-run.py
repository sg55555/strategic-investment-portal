#!/usr/bin/env python3
"""scratchpad/b2-parity-fuzz-run.py — Task7/Task10 パリティ fuzz: Python 側 mode_a_facts 実行ヘルパー。

scratchpad/b2-parity-fuzz.js から起動される（PYTHONPATH=api/me 前提で `import advice` が解決する）。
Node が書いた入力 JSON（cases: [{name, state, nowMs, cashflow, investment}]）を読み、
production/personal 両モードの advice.mode_a_facts 出力を書き出す。検証専用・advice.py は無改変。
Task10: investment（台帳行）も cashflow の隣で受け、mode_a_facts の第5引数として渡す。
"""
import json
import math
import sys

import advice


def _sanitize(o):
    """JS↔Py 比較用: JSON 非対応の非有限 float を JS canon と同一 sentinel へ（両側同値の Infinity は一致・真の発散は依然検出）。"""
    if isinstance(o, float):
        if math.isnan(o):
            return "__nonfinite__:NaN"
        if math.isinf(o):
            return "__nonfinite__:Infinity" if o > 0 else "__nonfinite__:-Infinity"
        return o
    if isinstance(o, dict):
        return {k: _sanitize(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_sanitize(x) for x in o]
    return o


def main():
    in_path, out_path = sys.argv[1], sys.argv[2]
    with open(in_path, encoding="utf-8") as f:
        data = json.load(f)
    out = []
    for c in data["cases"]:
        state = c["state"]
        now_ms = c["nowMs"]
        cashflow = c.get("cashflow")  # scalar-coerce パリティ堅牢化: cfNum 経路も検証（None=Slice3 経路）
        investment = c.get("investment")  # Task10: 台帳行（0行含む・None は生じない=JS 側は常に配列を渡す）
        try:
            prod = advice.mode_a_facts(state, False, now_ms, cashflow, investment)
        except Exception as e:  # noqa: BLE001 — fuzz は例外自体も mismatch として可視化する
            prod = {"__error__": repr(e)}
        try:
            pers = advice.mode_a_facts(state, True, now_ms, cashflow, investment)
        except Exception as e:  # noqa: BLE001
            pers = {"__error__": repr(e)}
        out.append({"name": c["name"], "prod": prod, "pers": pers})
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"cases": _sanitize(out)}, f)


if __name__ == "__main__":
    main()
