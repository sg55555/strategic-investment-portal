#!/usr/bin/env bash
# Investment Portal メンテナンススクリプト
# 用途: tmp/ の古い一時ファイル削除 + logs/ のアーカイブ
# 推奨 cron（毎週日曜 2:00）:
#   0 2 * * 0 ~/apps/investment-portal/scripts/maintain.sh >> ~/apps/investment-portal/logs/maintain.log 2>&1

set -euo pipefail

APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMP_DIR="$APP_DIR/tmp"
LOG_DIR="$APP_DIR/logs"
ARCHIVE_DIR="$HOME/old_logs"
TIMESTAMP=$(date +"%Y-%m-%d %H:%M:%S")
YEAR_MONTH=$(date +"%Y-%m")

echo "[$TIMESTAMP] === メンテナンス開始 ==="

# ── tmp/ の古いファイルを削除（7日以上前）──────────────────
echo "[$TIMESTAMP] [tmp] 7日以上前のファイルを削除..."
DELETED=0
if [ -d "$TMP_DIR" ]; then
    while IFS= read -r -d '' f; do
        rm -rf "$f"
        echo "  削除: $f"
        DELETED=$((DELETED + 1))
    done < <(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -mtime +7 -print0)
fi
echo "[$TIMESTAMP] [tmp] ${DELETED}件削除"

# ── logs/ の古いログをアーカイブ（30日以上前）──────────────
echo "[$TIMESTAMP] [logs] 30日以上前のログをアーカイブ..."
ARCHIVE_TARGET="$ARCHIVE_DIR/$YEAR_MONTH"
ARCHIVED=0
if [ -d "$LOG_DIR" ]; then
    while IFS= read -r -d '' f; do
        filename=$(basename "$f")
        mkdir -p "$ARCHIVE_TARGET"
        gzip -c "$f" > "$ARCHIVE_TARGET/${filename}.gz" && rm "$f"
        echo "  アーカイブ: $f → $ARCHIVE_TARGET/${filename}.gz"
        ARCHIVED=$((ARCHIVED + 1))
    done < <(find "$LOG_DIR" -maxdepth 1 -name "*.txt" -mtime +30 -print0)
fi
echo "[$TIMESTAMP] [logs] ${ARCHIVED}件アーカイブ"

echo "[$TIMESTAMP] === メンテナンス完了 ==="
