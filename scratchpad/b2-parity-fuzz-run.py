#!/usr/bin/env python3
"""scratchpad/b2-parity-fuzz-run.py — Task7 パリティ fuzz: Python 側 mode_a_facts 実行ヘルパー。

scratchpad/b2-parity-fuzz.js から起動される（PYTHONPATH=api/me 前提で `import advice` が解決する）。
Node が書いた入力 JSON（cases: [{name, state, nowMs}]）を読み、
production/personal 両モードの advice.mode_a_facts 出力を書き出す。検証専用・advice.py は無改変。
"""
import json
import sys

import advice


def main():
    in_path, out_path = sys.argv[1], sys.argv[2]
    with open(in_path, encoding="utf-8") as f:
        data = json.load(f)
    out = []
    for c in data["cases"]:
        state = c["state"]
        now_ms = c["nowMs"]
        try:
            prod = advice.mode_a_facts(state, False, now_ms)
        except Exception as e:  # noqa: BLE001 — fuzz は例外自体も mismatch として可視化する
            prod = {"__error__": repr(e)}
        try:
            pers = advice.mode_a_facts(state, True, now_ms)
        except Exception as e:  # noqa: BLE001
            pers = {"__error__": repr(e)}
        out.append({"name": c["name"], "prod": prod, "pers": pers})
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"cases": out}, f)


if __name__ == "__main__":
    main()
