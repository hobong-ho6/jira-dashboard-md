#!/usr/bin/env bash
# apply_and_rewatch.sh — 큐 처리(apply_queue.py) + 워쳐 재기동(watch_queue.py)을
# 한 번의 명령으로 묶는다.
#
# 배경: docs/13 워치 루프는 "MCP 처리 → apply_queue.py → watch_queue.py 재기동"
# 3단계인데, 마지막 재기동을 Claude Code가 깜빡하면 워쳐가 죽은 채로 남아
# 큐가 안 처리되는 문제가 반복됐다(2026-07-28). apply_queue.py 실행 뒤 같은
# 프로세스 체인에서 곧바로 watch_queue.py를 이어 실행해, 재기동을 별도로
# "기억해야 하는 단계"가 아니라 이 스크립트 호출 자체에 포함시킨다.
#
# 사용법: tools/apply_and_rewatch.sh <payload.json> [port] [poll_seconds]
#   run_in_background:true 로 호출할 것 — watch_queue.py 가 다음 pending 을
#   찾을 때까지 블로킹하므로, 그때 harness 가 세션을 다시 알려준다(기존과 동일).
set -euo pipefail
cd "$(dirname "$0")/.."

PAYLOAD="${1:?usage: apply_and_rewatch.sh <payload.json> [port] [poll_seconds]}"
PORT="${2:-5173}"
POLL="${3:-1.5}"

python3 tools/apply_queue.py "$PAYLOAD" "$PORT"
exec python3 tools/watch_queue.py "$POLL"
