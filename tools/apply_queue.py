#!/usr/bin/env python3
"""
apply_queue.py — 큐 명령 처리 결과를 snapshot.json 에 병합하고, 서버 ack API 로 처리완료 표시.

Claude Code 가 MCP 로 받은 결과(코멘트/전이/변경 후 필드)를 payload JSON 으로 넘기면:
  1) issues[].comments / commentsLoaded         (load_comments)
  2) transitions[KEY]                            (load_transitions: 드롭다운 옵션)
  3) issues[] 필드 패치 (status/duedate/labels)  (transition/set_duedate/set_labels 등 mutation 후)
     - duedate 가 바뀌면 bucket 을 재계산(normalize 규칙 재사용)
  3b) addIssues: 새 이슈(raw MCP)를 normalize 해 issues 에 추가/교체 (create_issue 후) → labelGroups 재빌드
  4) generatedAt 갱신(브라우저 폴링이 변경 감지)
  5) 서버 POST /api/commands/ack 로 처리분 done 처리
를 한다. 이 스크립트는 Jira/MCP 를 호출하지 않는다(로컬 파일 + localhost ack 만).

사용법:
  python3 tools/apply_queue.py <payload.json> [port]

payload.json:
{
  "comments":    {"W3P-5600": [{"author","created","updated","body"}, ...]},
  "transitions": {"UNIFY-7789": [{"id","name","to"}, ...]},
  "issuePatch":  {"UNIFY-7789": {"status": {"name":"Resolved","category":"done"}}},
  "addIssues":   [ {raw MCP issue}, ... ],
  "ackIds":  ["c_..."],
  "dropIds": ["c_..."]
}
"""
import json
import os
import sys
import datetime as dt
import importlib.util
import urllib.request
from pathlib import Path

BASE = Path(__file__).parent.parent
SNAP = BASE / "data" / "snapshot.json"
CONFIG = BASE / "data" / "config.json"

# normalize.py 의 bucket_of 재사용 (duedate 변경 시 bucket 재계산)
_spec = importlib.util.spec_from_file_location("normalize", str(BASE / "tools" / "normalize.py"))
_nz = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_nz)


def _ack(ids, status, note, port):
    if not ids:
        return 0
    body = json.dumps({"ids": ids, "status": status, "note": note}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:%d/api/commands/ack" % port,
        data=body, headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        json.loads(r.read().decode("utf-8"))
    return len(ids)


def main():
    if len(sys.argv) < 2:
        print("usage: apply_queue.py <payload.json> [port]", file=sys.stderr)
        sys.exit(2)
    port = int(sys.argv[2]) if len(sys.argv) > 2 else 5173
    payload = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))

    snap = json.loads(SNAP.read_text(encoding="utf-8"))
    by_key = {it.get("key"): it for it in snap.get("issues", [])}
    cfg = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    week_start = (snap.get("config", {}) or {}).get("weekStart") or cfg.get("weekStart", "monday")
    today = dt.date.today()

    rules = cfg.get("descriptionLinkRules", [])
    comments = payload.get("comments", {})
    for key, cs in comments.items():
        it = by_key.get(key)
        if it is not None:
            it["comments"] = cs
            it["commentsLoaded"] = True
            # 코멘트 본문의 링크도 같은 규칙으로 분류 (descriptionLinks 와 중복 제거)
            existing = {l.get("url") for l in it.get("descriptionLinks", [])}
            it["commentLinks"] = _nz.comment_links_from(cs, rules, existing)

    transitions = payload.get("transitions", {})
    snap.setdefault("transitions", {})
    for key, ts in transitions.items():
        snap["transitions"][key] = ts

    patch = payload.get("issuePatch", {})
    for key, fields in patch.items():
        it = by_key.get(key)
        if it is None:
            continue
        it.update(fields)
        if "duedate" in fields:  # 마감일 변경 → bucket 재계산
            it["bucket"] = _nz.bucket_of(fields["duedate"], today, week_start)
        if "descriptionText" in fields:  # 설명 변경 → 설명 링크 재파싱
            it["descriptionLinks"] = _nz.parse_description_links(fields["descriptionText"], rules)
        if "labels" in fields:  # 라벨 변경 → labelGroups 재빌드
            snap["labelGroups"] = _nz.build_label_groups(snap.get("issues", []), cfg.get("labelOrder", []))

    add = payload.get("addIssues", [])
    if add:  # create_issue 후: 새 이슈 normalize → 추가/교체 → labelGroups 재빌드
        pos = {it.get("key"): i for i, it in enumerate(snap.get("issues", []))}
        for raw in add:
            norm = _nz.normalize_issue(_nz.to_v2(raw), cfg, today)
            if norm["key"] in pos:
                snap["issues"][pos[norm["key"]]] = norm
            else:
                snap.setdefault("issues", []).append(norm)
                pos[norm["key"]] = len(snap["issues"]) - 1
        snap["labelGroups"] = _nz.build_label_groups(snap.get("issues", []), cfg.get("labelOrder", []))

    snap["generatedAt"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")

    tmp = str(SNAP) + ".tmp"
    Path(tmp).write_text(json.dumps(snap, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, SNAP)

    acked = dropped = 0
    try:
        acked = _ack(payload.get("ackIds", []), "done", "auto-processed", port)
        dropped = _ack(payload.get("dropIds", []), "done", "obsolete/dropped", port)
    except Exception as e:  # noqa: BLE001 — 서버 미연결이어도 snapshot 은 이미 갱신됨
        print("snapshot 갱신 완료, 단 ack 실패(서버 미연결?): %s" % e, file=sys.stderr)
        print("미ack id: %s" % (payload.get("ackIds", []) + payload.get("dropIds", [])), file=sys.stderr)

    print("applied: comments=%d, transitions=%d, issuePatch=%d, ack=%d, drop=%d"
          % (len(comments), len(transitions), len(patch), acked, dropped))


if __name__ == "__main__":
    main()
