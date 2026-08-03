#!/usr/bin/env bash
# handoff-start.sh — SessionStart 훅
# HANDOFF.md 내용을 세션 시작 컨텍스트로 주입한다.
set -euo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_FILE="$PROJECT_DIR/HANDOFF.md"

# 헤드리스 갱신 세션(종료 훅이 띄운 claude -p)에서는 아무것도 하지 않음
if [ "${CLAUDE_HANDOFF_UPDATING:-0}" = "1" ]; then
  exit 0
fi

# HANDOFF.md가 없으면 조용히 통과
if [ ! -f "$HANDOFF_FILE" ]; then
  exit 0
fi

# JSON 출력: additionalContext로 파일 내용 + 브리핑 지시 주입
python3 - "$HANDOFF_FILE" <<'PYEOF'
import json, sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    content = f.read()

context = (
    "다음은 이 프로젝트의 세션 핸드오프 문서(HANDOFF.md) 전문이다.\n"
    "'현재 상태'와 '다음 할 일'을 파악하고, 첫 응답에서 사용자에게 "
    "한 줄로 브리핑한 뒤 작업을 시작하라.\n"
    "브리핑 형식 예: \"지난 세션: X 완료. 오늘 예정: Y. 시작할까요?\"\n\n"
    "---- HANDOFF.md ----\n" + content
)

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "SessionStart",
        "additionalContext": context,
    }
}, ensure_ascii=False))
PYEOF
