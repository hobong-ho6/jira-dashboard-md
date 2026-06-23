#!/usr/bin/env python3
"""
watch_queue.py — pending 명령이 큐에 나타날 때까지 블로킹 대기하다가,
발견 즉시 그 목록을 JSON 한 줄로 출력하고 종료한다.

용도(docs/13 watch 루프): Claude Code 가 이 스크립트를 백그라운드로 띄워 두면,
사용자가 대시보드에서 액션(코멘트 로드 / 상태 변경 / 마감일 변경 / 코멘트 추가 등)을
눌러 큐에 pending 이 생기는 순간 스크립트가 종료되고 → Claude Code 세션이 재호출되어
→ docs/11 절차로 처리(MCP 호출 + snapshot 반영 + ack)한 뒤 watcher 를 다시 띄운다.

읽기 전용(load_comments/load_transitions/sync)과 변경(transition/set_duedate/add_comment/
set_labels/create_link) **모두** 감지한다. 변경은 사용자의 명시적 버튼 클릭 = 의도(docs/11)다.
이 스크립트는 Jira/MCP 를 호출하지 않는다. 큐 파일만 읽는다. 일감이 없으면 조용히 대기.

사용법:
  python3 tools/watch_queue.py [poll_seconds]
출력(일감 발견 시, 1줄):
  {"pending": [{"id","action","issueKey","to","duedate","jql"}, ...]}
"""
import json
import sys
import time
from pathlib import Path

BASE = Path(__file__).parent.parent
COMMANDS = BASE / "data" / "commands.jsonl"


def pending():
    if not COMMANDS.exists():
        return []
    out = []
    for line in COMMANDS.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            c = json.loads(line)
        except json.JSONDecodeError:
            continue
        if c.get("status") == "pending":
            out.append({
                "id": c.get("id"), "action": c.get("action"), "issueKey": c.get("issueKey"),
                "to": c.get("to"), "duedate": c.get("duedate"), "jql": c.get("jql"),
            })
    return out


def main():
    poll = float(sys.argv[1]) if len(sys.argv) > 1 else 1.5
    while True:
        p = pending()
        if p:
            print(json.dumps({"pending": p}, ensure_ascii=False), flush=True)
            return
        time.sleep(poll)


if __name__ == "__main__":
    main()
