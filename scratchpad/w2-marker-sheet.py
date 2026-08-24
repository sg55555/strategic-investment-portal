"""52週マーカー比較の一覧シートを1枚に合成する（本人が見比べるための素材）。

    python3 scratchpad/w2-marker-sheet.py

w2-marker-shots.js が撮った 案×位置 の切り出しを、位置ごとに縦に並べてラベルを添える。
拡大して貼るのは、実寸だとマーカーが数ピクセルしかなく差が判別できないため。
"""
import os

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "w2-shots", "marker")
OUT = os.path.join(HERE, "w2-shots", "marker-sheet.png")

NAMES = {
    "0": "案0 現状（トラック=灰→シアン／マーカー=明シアン）",
    "1": "案1 白コア＋暗縁",
    "2": "案2 トラック中立化",
    "3": "案3 暗い溝＋発光",
    "4": "案4 アンバー",
    "5": "案5 白コア＋トラック中立",
}
POSITIONS = ["36", "92", "100"]
POS_NOTE = {"36": "36%（レンジ中央より下・現状でも見える）",
            "92": "92%（SPY の実値・ここで沈む）",
            "100": "100%（高値更新・最悪ケース）"}

SCALE = 2          # 実寸だと数pxで差が読めないので拡大する
PAD = 14
LABEL_W = 330
BG = (8, 12, 18)
FG = (200, 216, 226)
HEAD = (98, 240, 255)
# PIL の既定フォントは日本語グリフを持たず全部豆腐になる。IPAゴシック（Debian の標準和文）を使う。
FONT_PATH = "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf"


def _font(size: int):
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except OSError:
        return ImageFont.load_default()


def main() -> int:
    rows = []
    for pos in POSITIONS:
        for key in sorted(NAMES):
            p = os.path.join(SRC, f"pos{pos}-v{key}.png")
            if os.path.exists(p):
                rows.append((pos, key, Image.open(p)))
    if not rows:
        print("素材がありません。先に w2-marker-shots.js を実行してください。")
        return 1

    img_w = max(im.width for _, _, im in rows) * SCALE
    img_h = max(im.height for _, _, im in rows) * SCALE
    row_h = img_h + PAD
    head_h = 30
    total_h = PAD + (head_h + row_h * len(NAMES) + PAD) * len(POSITIONS)
    total_w = PAD + LABEL_W + img_w + PAD

    sheet = Image.new("RGB", (total_w, total_h), BG)
    d = ImageDraw.Draw(sheet)
    f_head, f_label = _font(16), _font(14)

    y = PAD
    for pos in POSITIONS:
        d.text((PAD, y + 6), f"レンジ内位置 {POS_NOTE[pos]}", fill=HEAD, font=f_head)
        y += head_h
        for key in sorted(NAMES):
            match = [im for p, k, im in rows if p == pos and k == key]
            if not match:
                continue
            src = match[0]
            im = src.resize((src.width * SCALE, src.height * SCALE), Image.NEAREST)
            d.text((PAD + 10, y + img_h // 2 - 8), NAMES[key], fill=FG, font=f_label)
            sheet.paste(im, (PAD + LABEL_W, y))
            y += row_h
        y += PAD

    sheet.save(OUT)
    print(f"合成完了 → {OUT}  ({total_w}x{total_h})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
