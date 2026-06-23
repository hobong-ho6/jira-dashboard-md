# 13 — Operating Loop (실행 루프 · 로컬 서버)

목적: 전체를 어떻게 돌리는지. 사용자는 Claude Code에게 짧은 명령을 내리고, Claude Code가 MCP·파일을 다룬다.

## mailbox 서버 (`server/serve.py`) 사양
- 표준 라이브러리만(외부 의존 없음), 한 파일. 포트 기본 `5173`(설정 가능).
- 제공:
  - `GET /` 및 정적: `web/` 파일 서빙.
  - `GET /api/snapshot` → `data/snapshot.json` 내용(없으면 빈 스냅샷).
  - `POST /api/commands` → body(JSON 한 건)에 서버가 `id`(없으면 생성)·`ts`·`status:"pending"` 보정 후 `data/commands.jsonl`에 append. 201 반환.
  - `GET /api/commands?status=pending` → pending 목록(Claude Code 드레인용).
  - `POST /api/commands/ack` → `{ids:[...], status:"done|failed|blocked", note?}` 받아 해당 줄을 표시/`.processed/`로 이동.
- **절대 Jira를 호출하지 않는다. 비밀 저장 안 함. CORS는 localhost 한정.**
- 동시성: 파일 append/rename은 락 또는 원자적 rename으로 안전하게.

## 사용자 명령 ↔ Claude Code 동작
| 사용자가 말함 | Claude Code |
|---|---|
| "초기 세팅" | `config.json` 확인/생성(`04`), `web/`·`server/` 산출물 생성, README 안내 |
| **"이 쿼리로 시작/조회: \<JQL\>"** | **시작점.** `config.json.jql`에 저장 → `04` sync 실행 → `snapshot.json` 생성 |
| (대시보드 JQL 입력창 제출) | 큐에 `{"action":"sync","jql":...}` 적재 → "큐 처리" 시 위와 동일 흐름 |
| "서버 켜" / serve | `python3 server/serve.py` 1회 기동, URL 안내(`http://localhost:5173`) |
| "동기화" / sync | 현재 `config.json.jql`로 `04` 절차 실행 |
| "큐 처리" / process | `11` 절차로 `commands.jsonl` 드레인(`sync` 명령 포함) → MCP 실행 → ack → 영향 이슈 증분 재동기화 |
| "전체 새로고침" | 현재 쿼리로 sync 전체 재실행 |
| "대시보드 고쳐: …" | 해당 모듈(`05`~`12`) 규칙 내에서 수정 |

## 권장 운영 사이클
```
1) serve (1회)                       # 서버 상시
2) 사용자가 필터링 쿼리(JQL) 입력      # 출발점: 채팅으로 Claude Code에 직접, 또는 대시보드 JQL바 → sync 명령
3) sync (그 쿼리로)                   # snapshot 생성/갱신
4) 사용자가 대시보드에서 보고/조작 → 액션이 큐에 쌓임
5) process                           # 변경 반영 + 증분 재동기화
6) (반복) 쿼리 변경 시 2)부터, 그 외 4)~5) 반복
```
- "click-and-forget"을 원하면: Claude Code가 짧은 watch 루프(예: `commands.jsonl` mtime 변할 때까지 `sleep` 후 1회 process)를 돌릴 수 있다. 단 무한 tight loop 금지 — 적절한 sleep과 종료 조건을 둔다.
  - 읽기 전용 액션(load_comments/load_transitions/sync/reorder_groups)이 큐에 쌓였는지는 `python3 tools/process_queue.py`로 검사한다(있으면 exit 0 + `PENDING_READONLY=N` 출력, 없으면 exit 1). 이 스크립트는 **신호만 알려줄 뿐 Jira를 호출하지 않는다.** 실제 드레인은 Claude Code가 `process`로 수행한다.
  - 브라우저는 읽기 전용 액션도 다른 액션과 똑같이 큐에 적재만 한다(서버는 Jira를 호출하지 않음 — `01` 신뢰 경계). 과거의 서버 측 자동 처리(`/api/auto-process`·신호파일·워처)는 루프를 닫지 못해 제거됐다.

## 트러블슈팅 (TROUBLESHOOTING로도 분리 가능)
- 브라우저가 snapshot 못 읽음 → 서버 기동/포트/경로 확인(`file://` 직접 열기 금지).
- 상태 변경 실패 → 해당 워크플로우에 그 전이가 없음. `jira_get_transitions` 결과를 사용자에게 보여줌.
- duedate 형식 오류 → `YYYY-MM-DD` 확인.
- 권한/read-only → MCP가 read-only면 mutation 불가, 사용자에게 안내.
- 네트워크 도메인 차단(컨테이너) → 조직 관리자에게 허용 도메인 추가 요청.

## Definition of Done
- 서버 1회 기동으로 대시보드가 뜨고 snapshot/commands가 오간다.
- sync→조작→process 사이클이 끊김 없이 동작.
- 각 사용자 명령이 위 표대로 정확히 매핑되어 실행된다.
