---
name: hourly-resync
description: 저장된 JQL로 전체 티켓을 다시 조회해 snapshot을 갱신하고, mailbox 서버·큐 워쳐 상태를 점검해 꺼져 있으면 재기동한다.
---

# hourly-resync — 전체 재동기화 + 서비스 헬스체크

목적: **증분이 아니라 전체 재조회**로 `data/snapshot.json`을 최신화하고, 서버·워쳐가 죽어 있으면 되살린다.
`/loop 1h`로 이 스킬을 매시간 자동 실행하도록 예약해 둔다(`docs/13` "정기 전체 재조회").

## 절차

1. **JQL 확보.** `data/config.json`의 `jql`을 읽는다. 없으면 진행하지 않고 사용자에게 묻는다.
2. **전체 재조회** (`docs/04` sync 절차와 동일, 증분 아님):
   - `jira_search(jql=config.jql, fields="*all", limit=50, start_at=0)`부터 시작해 응답의 `total`만큼 페이지네이션(50 초과 시 `start_at`을 늘려 반복).
   - ⚠️ `fields`를 좁히면 `issuetype`이 누락되는 MCP 함정이 있다(`docs/02`) — 반드시 `*all`로 받는다.
   - 큰 응답은 `Read`로 직접 읽지 말고, 파일로 받아 `python3 -c "..."` 또는 jq로 파싱해 `data/raw_issues.json`에 가공 없이 저장한다(토큰 절약).
   - `python3 tools/normalize.py` 실행 → `data/snapshot.json`을 원자적으로 재생성.
3. **서비스 헬스체크** (`docs/13` "프로세스 수명"):
   - `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/api/snapshot` 로 서버 확인.
     200이 아니면 `nohup python3 server/serve.py >data/serve.log 2>&1 &`를 **`dangerouslyDisableSandbox=true`**로 재기동(샌드박스에서 띄우면 `web/` 정적 파일이 500 read failed — `docs/13` 트러블슈팅).
   - `pgrep -f tools/watch_queue.py`로 워쳐 확인. 없으면 `python3 tools/watch_queue.py`를 `run_in_background`로 재기동.
   - 워쳐가 즉시 종료되며 pending 큐를 반환하면 `docs/11` 절차로 드레인한 뒤 다시 워쳐를 띄운다(무한 방치 금지).
4. 결과를 한 줄로 보고: 조회 건수, snapshot 갱신 여부, 서버/워쳐 상태.

## 주의
- 이 스킬은 **읽기(sync) + 프로세스 관리**만 한다. sync 중 발견된 변경 큐(전이·마감일·코멘트 등)는 `docs/11` 절차로 함께 처리해도 되지만, 이 스킬 자체가 Jira를 **변경**하지는 않는다.
- `/loop`로 예약된 주기 실행은 **이 세션이 살아있는 동안만** 유지된다(워쳐와 동일한 제약, `docs/13`). 세션이 완전히 끊기면 사용자가 다시 `/loop 1h`로 재예약해야 한다.
- 중복 sync 방지: 직전 실행이 실패/중단됐다면 원인을 보고하고, 무조건 재시도 루프에 빠지지 않는다.
