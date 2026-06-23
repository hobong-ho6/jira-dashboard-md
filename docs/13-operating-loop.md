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
  - `GET /api/ui-state` → `data/ui-state.json`(로컬 보기 설정: `groupOrder` 등). 없으면 `{}`.
  - `POST /api/ui-state` → JSON 본문을 `data/ui-state.json`에 원자적으로 덮어쓰기. **로컬 파일 I/O만, Jira 호출 없음**(`12` 그룹 순서 조정용).
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
### 큐 자동 처리 (watch 루프, "click-and-forget")
- 코멘트/전이 조회는 물론 상태·마감일 변경 등 **모든 처리는 MCP가 필요**하므로 서버가 못 한다(서버는 Jira 호출 금지 — `01` 신뢰 경계). 따라서 자동화하려면 **Claude Code 세션이 큐를 감시**해야 하며, 세션(+워처)이 떠 있는 동안만 동작한다.
- 구현(`tools/`):
  - `watch_queue.py [poll]` — **pending 명령이 생길 때까지 블로킹 대기**하다가, 발견 즉시 `{"pending":[{id,action,issueKey,to,duedate,jql}]}` 한 줄을 출력하고 **종료**한다. Claude Code가 백그라운드로 실행하면, 종료 시 세션이 재호출되어 처리 루프가 돈다. 읽기 전용(load_comments/load_transitions/sync)과 **변경(transition/set_duedate/add_comment/set_labels/create_link) 모두** 감지한다(변경은 사용자의 명시적 버튼 클릭 = 의도, `11`). 일감 없으면 조용히 대기(재호출 없음).
  - 재호출된 Claude Code는 `11` 매핑대로 MCP 호출(조회 또는 변경 2단계 전이 등)한 뒤 `apply_queue.py <payload.json> [port]`로 `snapshot.json`에 병합하고 서버 `ack`로 큐를 비운다. payload는 `comments`/`transitions`(드롭다운)/`issuePatch`(변경 후 status·duedate·labels; duedate 변경 시 bucket 재계산)를 담는다. 그리고 watcher를 다시 띄운다.
  - `process_queue.py` — pending 읽기전용 유무만 1회 검사(블로킹 없는 빠른 상태 확인용, exit 0/1).
  - 위 스크립트들은 **Jira를 호출하지 않는다**(큐 파일 읽기 + 로컬 snapshot 쓰기 + localhost ack 만). MCP 호출은 항상 Claude Code가 한다.
- 과거의 서버 측 자동 처리(`/api/auto-process`·신호파일)는 루프를 닫지 못해 제거됐다. `watch_queue.py`는 종료→세션 재호출로 **실제로 루프를 닫는다**는 점이 다르다.
- 무한 tight loop 금지: `watch_queue.py`는 `poll`초(기본 1.5s) 간격으로 잔다. 세션을 닫으면 워처도 멈추므로, 다시 자동화하려면 워처를 재기동한다.

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
