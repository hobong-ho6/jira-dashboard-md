#!/bin/sh
# ensure_services.sh — 서버(상시 데몬)·워쳐(세션 묶임) 기동 보장. (docs/13)
#
# SessionStart 훅에서 호출한다. 세션이 시작/재개될 때마다:
#   1) mailbox 서버가 꺼져 있으면 nohup 데몬으로 띄운다(세션 정리에도 생존).
#   2) 워쳐 상태를 stdout 으로 보고한다 → Claude 가 run_in_background 로 (재)기동.
#
# 왜 서버만 데몬이고 워쳐는 아닌가:
#   서버는 정적 파일 + 큐 파일 I/O 만 한다(Jira 호출 없음, docs/01 신뢰 경계) →
#   세션과 무관하게 데몬으로 상시 생존 가능.
#   워쳐는 큐 발견 시 "프로세스 종료 → harness 가 Claude 세션 재호출 → MCP 처리"
#   로 루프를 닫는다. 재호출을 받을 살아있는 세션이 필요하므로 Claude 가
#   run_in_background 로 띄워야 한다(nohup 분리 시 처리 주체가 없어 공회전).
#   따라서 여기서는 워쳐 상태만 보고하고, 기동은 Claude 에게 맡긴다.
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT" || exit 1
PORT=${1:-5173}

if curl -s -o /dev/null "http://localhost:$PORT/api/snapshot" 2>/dev/null; then
  SERVER="up"
else
  nohup python3 server/serve.py >data/serve.log 2>&1 &
  sleep 1
  if curl -s -o /dev/null "http://localhost:$PORT/api/snapshot" 2>/dev/null; then
    SERVER="started(daemon)"
  else
    SERVER="FAILED(see data/serve.log)"
  fi
fi

if pgrep -f "tools/watch_queue.py" >/dev/null 2>&1; then
  WATCHER="running"
else
  WATCHER="DOWN"
fi

echo "[ensure_services] server=$SERVER (:$PORT), watcher=$WATCHER"
if [ "$WATCHER" = "DOWN" ]; then
  echo "[ensure_services] ACTION: 큐 워쳐가 꺼져 있습니다 — 'python3 tools/watch_queue.py' 를 run_in_background 로 (재)기동해 큐 자동 처리를 재개하세요."
fi
