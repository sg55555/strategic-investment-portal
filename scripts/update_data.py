#!/usr/bin/env python3
"""
Strategic Investment Portal - 自動更新スクリプト

使い方:
  python update_data.py           # 株価・市場指標のみ更新（日次）
  python update_data.py --full    # 財務3表データも更新（年次）

推奨 cron 設定（月〜金の朝7:00 JST）:
  0 7 * * 1-5 ~/apps/investment-portal/.venv/bin/python ~/apps/investment-portal/scripts/update_data.py >> ~/apps/investment-portal/logs/update_log.txt 2>&1
"""

import sys
import subprocess
import time
from pathlib import Path
from datetime import datetime

SCRIPT_DIR  = Path(__file__).parent          # scripts/
APP_DIR     = SCRIPT_DIR.parent              # investment-portal/
VENV_PYTHON = APP_DIR / ".venv" / "bin" / "python"
LOG_FILE    = APP_DIR / "logs" / "update_log.txt"

def log(msg: str):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

def run(script: str) -> bool:
    """スクリプトを実行してエラーを返す"""
    result = subprocess.run(
        [str(VENV_PYTHON), str(SCRIPT_DIR / script)],
        capture_output=True, text=True, cwd=str(SCRIPT_DIR)
    )
    for line in result.stdout.strip().splitlines():
        print("  |", line)
    if result.returncode != 0:
        log(f"  ❌ エラー: {result.stderr.strip()[:200]}")
        return False
    return True

def main():
    full_update = "--full" in sys.argv

    log("=" * 60)
    log(f"🚀 自動更新 {'[FULL: 財務+市場]' if full_update else '[DAILY: 市場データ]'}")
    log("=" * 60)

    if full_update:
        log("📊 Step 1/2: 財務3表データを取得・DB格納...")
        t0 = time.time()
        ok = run("auto_terminal_filter.py")
        elapsed = time.time() - t0
        if ok:
            log(f"  ✅ 財務データ更新完了 ({elapsed:.1f}秒)")
        else:
            log("  ⚠️  財務データで一部エラー。続行します。")
        step_label = "Step 2/2"
    else:
        step_label = "Step 1/1"

    log(f"📈 {step_label}: 株価・市場指標を取得してdata.jsを再生成...")
    t0 = time.time()
    ok = run("get_stock_multi.py")
    elapsed = time.time() - t0
    if ok:
        data_js_size = (APP_DIR / "data.js").stat().st_size / 1024
        log(f"  ✅ data.js 更新完了 ({elapsed:.1f}秒 / {data_js_size:.0f} KB)")
    else:
        log("  ❌ data.js 更新に失敗しました")
        sys.exit(1)

    log("🏁 全処理完了")
    log("=" * 60)

if __name__ == "__main__":
    main()
