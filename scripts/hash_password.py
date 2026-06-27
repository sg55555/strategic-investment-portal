"""司令室ログイン用の bcrypt パスワードハッシュをローカル生成する。

生パスワードは表示も保存もしない（getpass で隠し入力 → ハッシュのみ標準出力）。
使い方:
    python scripts/hash_password.py
出力された `AUTH_PASSWORD_HASH=...` を
  - ローカル: investment-portal/.env
  - 本番:     Vercel プロジェクトの環境変数
の両方に設定する。生パスワードはどこにも保存しないこと。
"""
import getpass
import sys

import bcrypt


def main() -> int:
    p1 = getpass.getpass("新しいパスワード: ")
    p2 = getpass.getpass("確認のためもう一度: ")
    if p1 != p2:
        print("一致しません。中止しました。", file=sys.stderr)
        return 1
    if len(p1) < 8:
        print("8 文字以上にしてください。中止しました。", file=sys.stderr)
        return 1
    h = bcrypt.hashpw(p1.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    print("\nAUTH_PASSWORD_HASH=" + h)
    print("\n↑ を .env と Vercel 環境変数の両方に設定してください（生パスワードは保存しない）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
