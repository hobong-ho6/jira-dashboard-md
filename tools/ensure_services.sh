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

# 헬스체크에 상한을 둔다. 좀비(포트는 잡고 응답만 없음)를 만나면 타임아웃 없는
# curl 이 그대로 매달려 SessionStart 훅 전체가 멈출 수 있다.
health() {
  curl -s -o /dev/null --max-time 5 "http://localhost:$PORT/api/snapshot" 2>/dev/null
}

start_server() {
  nohup python3 server/serve.py >data/serve.log 2>&1 &
  sleep 1
  if health; then SERVER="started(daemon)"; else SERVER="FAILED(see data/serve.log)"; fi
}

if health; then
  SERVER="up"
else
  ZPID=$(lsof -ti "tcp:$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
  if [ -z "$ZPID" ]; then
    start_server
  elif ps -p "$ZPID" -o command= 2>/dev/null | grep -q "server/serve.py"; then
    # 좀비 서버: 포트는 LISTEN 인데 응답이 없다(3회 재발 — 2026-07-30·08-06 등).
    # 그냥 재기동하면 Address already in use 로 죽고 FAILED 만 남아 사람이 kill 해야 했다.
    # 원인 가설(2026-08-06, 사용자 제기): 장시간 자리 비움 → macOS sleep/standby 반복 중
    # 프로세스는 살아남지만(STAT=S) 리스닝 소켓이 응답 불능이 된다. 확정 전이라
    # kill 직전에 소켓·스택·직전 sleep/wake 이력을 남겨 다음 재발 때 대조한다.
    DUMP="data/zombie_$(date +%Y%m%d_%H%M%S).txt"
    {
      echo "# 좀비 서버 진단 (PID $ZPID, 감지 $(date '+%Y-%m-%d %H:%M:%S'))"
      echo "## 프로세스 (STAT=T 면 정지, S 면 살아있는데 소켓만 죽은 것)"
      ps -p "$ZPID" -o pid,stat,etime,lstart,command 2>/dev/null
      echo "## 열린 소켓"
      lsof -p "$ZPID" -a -i 2>/dev/null
      echo "## 최근 sleep/wake — 마지막 Wake 직후 멈췄는지 대조"
      pmset -g log 2>/dev/null | grep -E "Entering Sleep|Wake from|DarkWake" | tail -20
      echo "## 스택 (어디서 막혔는지)"
      sample "$ZPID" 2 2>/dev/null
    } >"$DUMP" 2>&1
    echo "[ensure_services] 좀비 서버 감지(PID $ZPID, $(ps -p "$ZPID" -o etime= 2>/dev/null | tr -d ' ') 경과) — 진단 $DUMP 저장 후 정리·재기동"
    kill "$ZPID" 2>/dev/null
    sleep 2
    if kill -0 "$ZPID" 2>/dev/null; then kill -9 "$ZPID" 2>/dev/null; sleep 1; fi
    start_server
  else
    # 우리 serve.py 가 아닌 프로세스는 절대 죽이지 않는다(포트 충돌은 사용자 판단).
    SERVER="PORT_CONFLICT(PID $ZPID — 우리 서버 아님, 자동 정리 안 함)"
  fi
fi

if pgrep -f "tools/watch_queue.py" >/dev/null 2>&1; then
  WATCHER="running"
else
  WATCHER="DOWN"
fi

echo "[ensure_services] server=$SERVER (:$PORT), watcher=$WATCHER"
if [ "$WATCHER" = "DOWN" ]; then
  echo "[ensure_services] ACTION: 큐 워쳐가 꺼져 있습니다 — 'python3 tools/watch_queue.py' 를 run_in_background 로 (재)기동해 큐 자동 처리를 재개하세요. 큐가 잡히면 MCP 처리는 queue-worker 서브 에이전트에 넘깁니다(docs/13)."
fi
