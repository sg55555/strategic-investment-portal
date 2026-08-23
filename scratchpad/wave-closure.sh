#!/usr/bin/env bash
# wave クロージャ C-2/C-3/C-4: 受入スクリプト全数＋snapshot を一度の mock 鯖起動で通す
set -u
# ⚠ `git rev-parse --show-toplevel` は使わない。main チェックアウトから叩くと W2 を含まないツリーを
#   検査して ALL GREEN を返してしまう（stale 参照を git 依存に置き換えると同種の罠が再発する）。
#   このスクリプト自身の位置（scratchpad/の親）から worktree ルートを解決する＝常にこの worktree を見る。
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NODE_PATH=/home/shugo/node_modules

if ss -tlnp 2>/dev/null | grep -q ":8200"; then
  echo "ABORT: port 8200 is occupied by another session"
  exit 1
fi

# ⚠ この worktree には gitignore された data/investment.db が無い（symlink 未設置だと鯖は起動できても
#   全 API が 500 を返し、受入15本が「鯖は上がっているのに中身が空」で全滅する）。
#   4階層上を指す symlink を張る（3階層だと dangling になる＝この worktree で実際に踏んだ罠）。
[ -e data/investment.db ] || ln -sfn ../../../../data/investment.db data/investment.db
stat -L data/investment.db > /dev/null 2>&1 || { echo "ABORT: data/investment.db の symlink が壊れている（dangling）。4階層上を指しているか確認"; exit 1; }

PLAN2_PORT=8200 python3 scratchpad/mock_prod_server.py > /tmp/wave-closure-srv.log 2>&1 &
SRV_PID=$!
sleep 2
# ⚠ 「200 が返る」だけの判定は不十分（DB が空でも静的ファイルの / 自体は 200 を返すため検知できない）。
#   実データの中身（"stocks" キー）で判定する。
if ! curl -sf "http://127.0.0.1:8200/api/market/list" | grep -q '"stocks"'; then
  echo "ABORT: mock 鯖が実データを返していない（data/investment.db を確認）"
  kill $SRV_PID 2>/dev/null
  exit 1
fi
echo "mock server up (pid=$SRV_PID)"

FAILED=""

# C-2: 前 wave 受入6本
echo "===== C-2: 前 wave 受入6本 ====="
for f in bs-callout-verify sr-window-verify unit-badge-verify zerofy-verify zerofy-portal-verify theme-floor-check; do
  if node scratchpad/$f.js > /tmp/wc-$f.log 2>&1; then
    echo "  PASS  $f"
  else
    echo "  FAIL  $f"
    FAILED="$FAILED $f"
  fi
done

# C-3: 本 wave 新規 verify
echo "===== C-3: 本 wave 新規 verify ====="
for f in subpanel-verify fit-range-verify compare-verify finviz-labels-verify titles-verify toolbar-terms-verify radar-clip-375-verify; do
  if BEFORE_BOX_H=816 node scratchpad/$f.js > /tmp/wc-$f.log 2>&1; then
    echo "  PASS  $f"
  else
    echo "  FAIL  $f"
    FAILED="$FAILED $f"
  fi
done

echo "===== C-3b: 横断スモーク ====="
for f in portal-money-smoke smoke-zigzag-range; do
  if node scratchpad/$f.js > /tmp/wc-$f.log 2>&1; then
    echo "  PASS  $f"
  else
    echo "  FAIL  $f"
    FAILED="$FAILED $f"
  fi
done

# C-4: detail-snapshot
echo "===== C-4: detail-snapshot compare ====="
if node scratchpad/detail-snapshot.js compare > /tmp/wc-snapshot.log 2>&1; then
  echo "  MATCH"
else
  echo "  DIFF (see /tmp/wc-snapshot.log)"
  FAILED="$FAILED detail-snapshot"
fi
tail -3 /tmp/wc-snapshot.log

kill $SRV_PID 2>/dev/null
wait $SRV_PID 2>/dev/null
echo "mock server stopped (pid=$SRV_PID)"

if [ -n "$FAILED" ]; then
  echo "RESULT: FAILED ->$FAILED"
  exit 1
fi
echo "RESULT: ALL GREEN (C-2/C-3/C-4)"
