"""3案の設計（workflow の返り値 JSON）を w2-variants.js の先頭へ貼り付ける生成スクリプト。

    python3 scratchpad/gen-w2-defs.py <workflow-output.json>

案の markup/CSS は 3 エージェントが独立に設計したものをそのまま使う（手で書き換えない）。
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(HERE, "w2-variants.js")


def main() -> int:
    src = sys.argv[1]
    payload = json.load(open(src))
    result = payload.get("result", payload)
    defs = {}
    for x in result["designs"]:
        defs[x["key"]] = {
            "name": x["name"],
            "thesis": x["thesis"],
            "parts": x["parts"],
            "css": x["css"],
            "vertical_cost": x["vertical_cost"],
            "tradeoffs": x["tradeoffs"],
        }
    head = (
        "/* 3案の定義（w2-mock-variants workflow の 3 エージェントが独立に設計した markup/CSS を機械的に貼付）。\n"
        " * この下の IIFE が配線する。案そのものの中身はここ以外で編集しない。 */\n"
        "window.__W2_VARIANT_DEFS__ = "
        + json.dumps(defs, ensure_ascii=False, indent=2)
        + ";\n\n"
    )
    body = open(TARGET).read()
    marker = "__W2_VARIANT_DEFS__ = "
    if marker in body.split("(function ()")[0]:
        print("already prepended; rewriting head")
        body = body.split("(function ()", 1)[1]
        body = "(function ()" + body
    open(TARGET, "w").write(head + body)
    print("ok bytes", len(head + body), "variants:", ",".join(sorted(defs)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
