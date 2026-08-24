"""ヒートマップのバー改善案を1枚のシートに縦積みする（本人が見比べる素材）。

    python3 scratchpad/w15-bar-sheet.py

濃い緑（ヘルスケア/一般消費財/公益/不動産）と濃い赤（US 公益）が同じ画面に写るので、
案ごとに全体を1枚ずつ並べれば、緑側・赤側の潰れ方を同時に比べられる。
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "w2-shots", "heatbar")
OUT = os.path.join(HERE, "w2-shots", "heatbar-sheet.png")

LABELS = [
    ("0", "案0 現状", "台=赤系／伸び=緑（固定）。濃い緑・濃い赤で潰れる"),
    ("A", "案A 文字色に追従", "台=文字色22%／伸び=文字色。下地に対して必ず読める"),
    ("B", "案B 暗い台＋明るい伸び", "下地の色に関係なく同じ見え方（無彩色）"),
    ("C", "案C 色は残し暗い縁で分離", "赤/緑の意味を保ち、暗い縁で下地から切り離す"),
]

PAD = 16
HEAD_H = 46
BG = (8, 12, 18)
FG = (200, 216, 226)
HEAD = (98, 240, 255)
SUB = (139, 162, 175)
FONT_PATH = "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"


def _font(size: int):
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except OSError:
        return ImageFont.load_default()


def main() -> int:
    items = []
    for key, title, note in LABELS:
        p = os.path.join(SRC, f"v{key}.png")
        if os.path.exists(p):
            items.append((title, note, Image.open(p)))
    if not items:
        print("素材がありません。先に w15-bar-shots.js を実行してください。")
        return 1

    w = max(im.width for _, _, im in items)
    total_h = PAD + sum(HEAD_H + im.height + PAD for _, _, im in items)
    sheet = Image.new("RGB", (w + PAD * 2, total_h), BG)
    d = ImageDraw.Draw(sheet)
    f_head, f_sub = _font(17), _font(13)

    y = PAD
    for title, note, im in items:
        d.text((PAD, y), title, fill=HEAD, font=f_head)
        d.text((PAD, y + 22), note, fill=SUB, font=f_sub)
        y += HEAD_H
        sheet.paste(im, (PAD, y))
        y += im.height + PAD

    sheet.save(OUT)
    print(f"合成完了 → {OUT}  ({sheet.width}x{sheet.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
