#!/usr/bin/env bash
# handoff-end.sh — SessionEnd 훅
# 세션 트랜스크립트를 헤드리스 Claude(claude -p)로 요약시켜
# HANDOFF.md를 갱신한다. 실패해도 세션 종료를 막지 않는다.
set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
HANDOFF_FILE="$PROJECT_DIR/HANDOFF.md"
LOG_FILE="$PROJECT_DIR/.claude/handoff-hook.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE" 2>/dev/null || true; }

# ── 재귀 방지: 종료 훅이 띄운 헤드리스 세션이 끝날 때 또 실행되는 것 차단
if [ "${CLAUDE_HANDOFF_UPDATING:-0}" = "1" ]; then
  exit 0
fi

# ── 전제 조건 확인
if [ ! -f "$HANDOFF_FILE" ]; then
  log "HANDOFF.md 없음 — 건너뜀"
  exit 0
fi
if ! command -v claude >/dev/null 2>&1; then
  log "claude CLI 없음 — 건너뜀"
  exit 0
fi

# ── stdin JSON에서 transcript_path, reason 추출
INPUT_JSON="$(cat)"
TRANSCRIPT_PATH="$(printf '%s' "$INPUT_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("transcript_path",""))' 2>/dev/null || true)"
REASON="$(printf '%s' "$INPUT_JSON" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("reason",""))' 2>/dev/null || true)"

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
  log "트랜스크립트 없음 (reason=$REASON) — 건너뜀"
  exit 0
fi

# ── 트랜스크립트(JSONL)에서 대화 텍스트만 추출 (뒤에서 최대 60,000자)
DIGEST_FILE="$(mktemp)"
python3 - "$TRANSCRIPT_PATH" > "$DIGEST_FILE" <<'PYEOF'
import json, sys

MAX_CHARS = 60000
lines_out = []

with open(sys.argv[1], encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue
        etype = entry.get("type", "")
        if etype not in ("user", "assistant"):
            continue
        msg = entry.get("message", {}) or {}
        role = msg.get("role", etype)
        content = msg.get("content", "")
        parts = []
        if isinstance(content, str):
            parts.append(content)
        elif isinstance(content, list):
            for block in content:
                if not isinstance(block, dict):
                    continue
                bt = block.get("type", "")
                if bt == "text":
                    parts.append(block.get("text", ""))
                elif bt == "tool_use":
                    name = block.get("name", "?")
                    parts.append(f"[도구 호출: {name}]")
                # tool_result는 길이만 차지하므로 생략
        text = "\n".join(p for p in parts if p and p.strip())
        if text.strip():
            lines_out.append(f"### {role}\n{text.strip()}")

digest = "\n\n".join(lines_out)
if len(digest) > MAX_CHARS:
    digest = "(앞부분 생략)\n\n" + digest[-MAX_CHARS:]
print(digest)
PYEOF

DIGEST_SIZE="$(wc -c < "$DIGEST_FILE" | tr -d ' ')"
if [ "$DIGEST_SIZE" -lt 500 ]; then
  log "세션이 너무 짧음(${DIGEST_SIZE}B, reason=$REASON) — 갱신 생략"
  rm -f "$DIGEST_FILE"
  exit 0
fi

# ── 헤드리스 Claude에게 갱신본 생성 요청
#    새 파일 전문을 stdout으로만 출력하게 하고, 쓰기는 이 스크립트가 담당
PROMPT_FILE="$(mktemp)"
{
  echo "너는 세션 핸드오프 문서 관리자다."
  echo "아래에 [현재 HANDOFF.md]와 [이번 세션 트랜스크립트 요약본]이 있다."
  echo "HANDOFF.md 상단 주석에 적힌 갱신 규칙을 그대로 따라"
  echo "갱신된 HANDOFF.md의 '전체 파일 내용'을 출력하라."
  echo ""
  echo "출력 규칙 (반드시 지킬 것):"
  echo "- 마크다운 코드펜스나 설명 문장 없이, 파일 내용 원문만 출력"
  echo "- 상단의 HTML 주석(사용 규칙)은 그대로 보존"
  echo "- '최근 세션 기록' 맨 위에 오늘 세션 엔트리 추가, 최대 5개 유지"
  echo "- 오늘 날짜: $(date '+%Y-%m-%d')"
  echo ""
  echo "==== [현재 HANDOFF.md] ===="
  cat "$HANDOFF_FILE"
  echo ""
  echo "==== [이번 세션 트랜스크립트 요약본] ===="
  cat "$DIGEST_FILE"
} > "$PROMPT_FILE"

NEW_CONTENT="$(CLAUDE_HANDOFF_UPDATING=1 claude -p --model sonnet < "$PROMPT_FILE" 2>>"$LOG_FILE")"
CLAUDE_EXIT=$?
rm -f "$DIGEST_FILE" "$PROMPT_FILE"

# ── 검증 후 백업 + 원자적 교체
if [ $CLAUDE_EXIT -ne 0 ] || [ -z "$NEW_CONTENT" ]; then
  log "claude -p 실패(exit=$CLAUDE_EXIT) — HANDOFF.md 유지"
  exit 0
fi
case "$NEW_CONTENT" in
  "# HANDOFF"*) : ;;  # 정상 시작
  *)
    log "출력 형식 검증 실패(첫 줄 불일치) — HANDOFF.md 유지"
    exit 0
    ;;
esac

cp "$HANDOFF_FILE" "$HANDOFF_FILE.bak" 2>/dev/null || true
TMP_OUT="$(mktemp)"
printf '%s\n' "$NEW_CONTENT" > "$TMP_OUT"
mv "$TMP_OUT" "$HANDOFF_FILE"
log "HANDOFF.md 갱신 완료 (reason=$REASON)"

exit 0
