#!/usr/bin/env python3
"""
process_queue.py — 큐에 처리할 읽기 전용 액션이 있는지 검사하는 헬퍼.

이 스크립트는 Jira/MCP를 호출하지 않는다. `data/commands.jsonl`을 읽어
pending 상태의 읽기 전용 액션(load_comments / load_transitions / sync / reorder_groups)이
있으면 개수를 출력하고 exit 0, 없으면 exit 1.

용도: Claude Code가 docs/13의 짧은 "watch 루프"에서 이 결과를 보고
언제 한 번 `process`(docs/11)를 돌릴지 판단한다.
실제 큐 드레인과 MCP 호출은 항상 Claude Code가 수행한다(서버/스크립트가 아님).
"""
import json
from pathlib import Path

BASE = Path(__file__).parent.parent
COMMANDS_FILE = BASE / "data" / "commands.jsonl"

# Jira를 변경하지 않는 읽기 전용 액션 (docs/11)
READ_ONLY_ACTIONS = {"load_comments", "load_transitions", "sync", "reorder_groups"}


def pending_readonly():
    if not COMMANDS_FILE.exists():
        return []
    out = []
    with open(COMMANDS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                cmd = json.loads(line)
            except json.JSONDecodeError:
                continue
            if cmd.get("status") == "pending" and cmd.get("action") in READ_ONLY_ACTIONS:
                out.append(cmd)
    return out


def main():
    pend = pending_readonly()
    if pend:
        print("PENDING_READONLY=%d" % len(pend))
        raise SystemExit(0)
    raise SystemExit(1)


if __name__ == "__main__":
    main()
