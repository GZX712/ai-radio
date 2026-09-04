#!/bin/bash
# localhost.run 隧道自动保活脚本
# - 建立 ssh 反向隧道指向 localhost:8787
# - 每 45s curl 一次自己的公网 URL，制造流量防止 "tunnel inactivity timeout" 被踢
# - ssh 断开/被杀后自动重连，URL 会变（新 URL 打印到 stdout 与日志）
# 用法: bash shots/tunnel-keepalive.sh
# 日志: shots/tunnel-keepalive.log

cd "$(dirname "$0")" || exit 1
LOG="tunnel-keepalive.log"
mkdir -p /tmp/airadio-tunnel

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

log "== tunnel-keepalive 启动 =="

while true; do
  TMPLOG="/tmp/airadio-tunnel/ssh-$$.log"
  ssh -o StrictHostKeyChecking=no \
      -o ServerAliveInterval=30 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -o "RequestTTY=no" \
      -R 80:localhost:8787 nokey@localhost.run >"$TMPLOG" 2>&1 &
  SSHPID=$!
  log "ssh 已启动 pid=$SSHPID，等待分配 URL..."

  URL=""
  for i in $(seq 1 20); do
    if [ -n "$URL" ]; then break; fi
    if ! kill -0 "$SSHPID" 2>/dev/null; then log "ssh 提前退出，准备重连"; break; fi
    # 取第一个 "xxx.lhr.life tunneled" 行里的 https URL
    URL=$(grep -oE 'https://[a-z0-9]+\.lhr\.life' "$TMPLOG" 2>/dev/null | head -1)
    sleep 2
  done

  if [ -z "$URL" ]; then
    log "未拿到 URL，杀 ssh 重试"
    kill "$SSHPID" 2>/dev/null
    sleep 3
    continue
  fi
  log ">>> 当前公网地址: $URL  (ssh pid=$SSHPID)"

  # keepalive 循环：每 45s 自访问一次，防 inactivity timeout
  FAILS=0
  while kill -0 "$SSHPID" 2>/dev/null; do
    CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$URL" 2>/dev/null)
    if [ "$CODE" = "200" ] || [ "$CODE" = "304" ]; then
      FAILS=0
    else
      FAILS=$((FAILS+1))
      log "自访问异常 http=$CODE fails=$FAILS"
    fi
    if [ "$FAILS" -ge 3 ]; then
      log "连续 3 次自访问失败，判定隧道失效，重启"
      break
    fi
    sleep 45
  done
  log "ssh 进程结束，3 秒后自动重连（URL 将更换）"
  kill "$SSHPID" 2>/dev/null
  sleep 3
done
