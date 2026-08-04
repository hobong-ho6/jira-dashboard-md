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
- **상시 데몬으로 띄운다.** 서버는 순수 파일 I/O라 세션과 무관하게 살 수 있다 → `nohup python3 server/serve.py >data/serve.log 2>&1 &` (또는 `tools/ensure_services.sh`)로 분리 기동해 **세션 정리에도 생존**시킨다. `tools/ensure_services.sh`는 멱등(이미 떠 있으면 그대로 둠).

## 사용자 명령 ↔ Claude Code 동작
| 사용자가 말함 | Claude Code |
|---|---|
| "초기 세팅" | `config.json` 확인/생성(`04`), `web/`·`server/` 산출물 생성, README 안내 |
| **"이 쿼리로 시작/조회: \<JQL\>"** | **시작점.** `config.json.jql`에 저장 → `04` sync 실행 → `snapshot.json` 생성 |
| (대시보드 JQL 입력창 제출) | 큐에 `{"action":"sync","jql":...}` 적재 → "큐 처리" 시 위와 동일 흐름 |
| "서버 켜" / serve | 서버 데몬 보장(`tools/ensure_services.sh`) **+ `tools/watch_queue.py` 워쳐 `run_in_background` 기동(항상 함께)**, URL 안내(`http://localhost:5173`) |
| "워쳐 실행" / watch | 워쳐 기동. 서버가 꺼져 있으면 **서버도 함께 켠다**(아래 규칙) |
| "동기화" / sync | 현재 `config.json.jql`로 `04` 절차 실행 |
| "큐 처리" / process | `11` 절차로 `commands.jsonl` 드레인(`sync` 명령 포함) → MCP 실행 → ack → 영향 이슈 증분 재동기화 |
| "전체 새로고침" | 현재 쿼리로 sync 전체 재실행 |
| "대시보드 고쳐: …" | 해당 모듈(`05`~`12`) 규칙 내에서 수정 |

> **규칙: 서버와 워쳐는 항상 함께 기동한다.** (2026-06-30 사용자 durable 지시) 워처만으로는 대시보드가 큐에 명령을 넣을 수 없고 `apply_queue.py`의 ack가 localhost:5173으로 가야 해서 동작하지 않는다. "서버 켜"/"워쳐 실행" 중 무엇을 받든 **둘 다** 떠 있게 만든다(이미 떠 있으면 그대로 둠). 한쪽을 끄라는 명시 지시가 없으면 둘을 분리해 띄우지 않는다.

## 프로세스 수명 — 서버 데몬 · 워쳐 세션 묶임 (세션 정리 생존)
(2026-06-30 사용자 durable 지시) 세션 정리/teardown 때 harness 관리 백그라운드 작업은 종료된다. 대응:
- **서버 = 상시 데몬.** `nohup`(또는 `tools/ensure_services.sh`)으로 분리 기동해 세션과 무관하게 생존. 대시보드 보기는 세션이 죽어도 계속 뜬다.
- **워쳐(대기) = 메인 세션 소유, 처리(MCP) = `queue-worker` 서브 에이전트.** 워쳐는 *큐 발견 → 프로세스 종료 → harness가 세션 재호출 → 처리 → 재감시* 로 루프를 닫는다. 재호출을 받을 **살아있는 세션**이 필요하므로 메인 세션이 `run_in_background`로 띄운다. `nohup` 분리 기동은 처리 주체(MCP=Claude)가 없어 공회전하므로 금지. 따라서 자동 처리는 **세션이 살아있는 동안만** 동작한다.
  - **⚠️ 워쳐를 서브 에이전트에 맡기지 않는다(2026-07-30 실측 실패).** `watch_queue.py`는 큐가 생길 때까지 **무한 블로킹**하는데 Bash 포그라운드 상한은 10분이다. 서브 에이전트에 감시를 맡기면 타임아웃마다 재실행해야 하고, 실제로 워커가 이를 "폴링 낭비"로 판단해 `run_in_background`로 띄운 뒤 종료했다 → 백그라운드 완료 알림은 **이미 종료된 자신**에게 가므로 루프가 끊기고 고아 워쳐만 남았다(큐는 ack되지 않아 유실은 없지만 무기한 미처리). 무한 대기를 받아줄 수 있는 주체는 메인 세션뿐이다.
  - **역할 분리 이유.** 비용이 드는 쪽은 대기가 아니라 처리다 — 대기는 블록된 프로세스라 토큰 0, 반면 Jira MCP 응답 JSON과 도구 스키마는 배치당 수천 토큰씩 메인 컨텍스트에 쌓였다. 그래서 **대기만 메인, MCP 처리는 서브 에이전트**로 나눈다(2026-07-30 사용자 확정).
  - **⚠️ 위임 프롬프트에 재기동을 절대 넣지 않는다(2026-08-04 실측 실패).** `queue-worker`의 시스템 지침(`.claude/agents/queue-worker.md`)이 이미 "`apply_and_rewatch.sh`/`watch_queue.py` 실행 금지"를 명시하는데도, 메인 세션이 위임 프롬프트에 "처리 후 `apply_and_rewatch.sh`를 실행하라"는 지시를 직접 적어 넣어 이를 덮어썼다. 그 결과 워커가 `apply_and_rewatch.sh`(내부적으로 `exec watch_queue.py`)를 실행 → 워쳐가 **워커 프로세스 소속**으로 재기동됨 → 워커가 최종 응답 후 종료되자 다음 pending을 알려줄 살아있는 세션이 없어 워쳐가 고아로 멈추고, 그 사이 대시보드 명령이 감지되지 않고 쌓였다. **위임 프롬프트를 작성하는 메인 세션 스스로가 이 경계를 지켜야 한다** — 워커의 시스템 지침이 있어도 델리게이션 프롬프트가 반대로 지시하면 워커는 그것을 따른다. 위임 프롬프트에는 "payload JSON을 쓰고 멈춰라, 재기동은 메인이 한다"만 넣고, `apply_and_rewatch.sh`/`apply_queue.py`/`watch_queue.py` 실행을 요청하는 문구를 어떤 형태로도 포함하지 않는다.
- **한 배치 처리 흐름.** ① 메인 세션이 워쳐 알림으로 `{"pending":[...]}`를 받는다 → ② 아래 **위임 판단**에 따라 직접 처리하거나 `Agent(queue-worker)`에 그 JSON을 넘긴다 → ③ (위임 시) 워커가 MCP 실행 후 `data/.payload_worker_<큐id>.json`을 쓰고 **경로와 요약만 반환**(재기동은 절대 워커에게 시키지 않는다 — 위 경고 참고) → ④ **메인이** `bash tools/apply_and_rewatch.sh <경로>`를 `run_in_background`로 실행(apply+ack+재감시가 한 체인 = 재기동 누락 방지) → ①로. ④는 직접 처리했을 때도, 위임했을 때도 항상 메인 세션의 몫이다.

### 위임 판단 — 무거운 배치만 워커에게 (2026-07-30 실측 후 사용자 확정)
**항상 위임하지 않는다.** 서브 에이전트는 배치마다 고정비(`docs/11` 재독 + MCP 스키마 재로드 + 지침 파싱)로 **~40~50k 토큰**을 낸다. 실측: 마감일 1건 제거에 51,483 토큰·25초(메인 직접이면 한계비용 2~4k·5초). 이 프로젝트의 배치는 평균 **1.6개 명령**(2026-07-30 세션 13배치 기준)이라 대개 고정비가 실작업을 압도한다. 반면 무거운 배치는 응답 원문이 메인 컨텍스트를 크게 오염시켜 위임이 이긴다.

| 배치 성격 | 처리 주체 | 이유 |
|---|---|---|
| `load_comments`·`load_transitions` (읽기 전용) | **메인 직접** | 응답이 작고 이미 컨텍스트에 있는 지식으로 처리 → 한계비용 ≈ 0 |
| 단순 `transition`·`set_duedate`·`set_labels`·`set_description` **1~2건** | **메인 직접** | 같음. 고정비 40k를 낼 이유가 없다 |
| `slackUrl` 붙은 `add_comment`·`create_issue` | **워커 위임** | 스레드 전문 + 사용자 프로필을 끌어와 요약 → 메인 오염 최대 |
| `create_issue` + `subtasks` | **워커 위임** | 다단계(생성→필드→전이→링크)×N, 응답 거대 |
| `sync` 전체 재조회 | **워커 위임** | `fields="*all"` 수십 건 |
| 명령 **3건 이상** 배치 | **워커 위임** | 고정비를 실작업량이 상회 |
| 메인이 개발·개선 작업 중 | **워커 위임** | 토큰이 아니라 **흐름 끊김**이 비용(사용자가 지적한 원래 문제) |

판단이 애매하면 **직접 처리**가 기본값이다. 위임은 신뢰성 비용도 있다 — 워커가 역할을 오해할 여지가 있고, 실제로 첫 시도에서 58,990 토큰·10분을 쓰고 성과 없이 고아 워쳐만 남긴 사고가 있었다.
- **SessionStart 훅 자동복구.** `.claude/settings.local.json`의 `SessionStart` 훅이 매 세션 시작/재개 때 `tools/ensure_services.sh`를 돌려 (a) 서버 데몬을 보장하고 (b) 워쳐 상태를 stdout으로 보고한다. 워쳐가 `DOWN`이면 보고에 `ACTION:` 줄이 떠서 Claude가 `python3 tools/watch_queue.py`를 `run_in_background`로 (재)기동한다. → 사용자는 수동 재기동 없이 세션 재개만으로 서버·워쳐가 자동 복구된다.
  - 훅 설정은 `.claude/settings.local.json`에 있고 이 파일은 **gitignore(토큰 포함 가능 정책, docs/02)** 라 커밋되지 않는다. 새 클론에서 자동복구를 쓰려면 같은 `SessionStart` 훅을 로컬에 추가해야 한다(스크립트 `tools/ensure_services.sh`는 커밋됨). 훅 미설정 시에는 "서버 켜"/"워쳐 실행"으로 수동 기동.

### 정기 전체 재조회 (`hourly-resync` 스킬 + `/loop`)
- 증분 sync(mutation 후 영향 이슈만 재조회)와 별개로, **전체 재조회**를 주기적으로 돌리고 싶을 때는 `.claude/skills/hourly-resync/SKILL.md` 절차(전체 sync + 서버·워쳐 헬스체크)를 따른다.
- 자동 반복은 `/loop 1h`로 이 스킬을 예약한다: `Skill(loop, "1h hourly-resync 스킬(.claude/skills/hourly-resync/SKILL.md) 절차대로 전체 재조회 + 서버/워쳐 헬스체크 수행")`.
- **실행은 서브 에이전트로 위임한다(2026-07-30 사용자 지시).** `/loop` 웨이크업을 받은 메인 세션은 스킬 절차를 직접 수행하지 않고, `Agent`(general-purpose, `run_in_background`)에 SKILL.md 절차를 넘긴다 — 개선 작업 중인 메인 컨텍스트를 재조회 데이터로 오염시키지 않기 위함. 단, 워쳐 재기동만은 예외로 메인 세션 몫이다(queue-worker 기동은 Agent 도구가 필요해 서브 에이전트가 할 수 없음): 재조회 에이전트는 워쳐 DOWN이면 보고만 하고, 메인 세션이 queue-worker를 재기동한다.
- **워쳐와 동일한 제약**: `/loop`는 `ScheduleWakeup`으로 **이 세션을 다시 깨우는 방식**이라, 세션이 완전히 끊기면 예약도 함께 끊긴다. 세션 재개 후 다시 자동으로 이어지지 않으므로, 필요하면 사용자가 `/loop 1h`를 재요청해야 한다(SessionStart 훅은 서버·워쳐만 자동복구하고 `/loop` 예약까지는 복구하지 않는다).
- **⚠️ 별도 scheduled-task와 절차 불일치 사고(2026-08-04).** `/loop 1h` 예약과는 별개로, 사용자가 플랫폼의 진짜 cron 기반 scheduled-task(`~/.claude/scheduled-tasks/jira-dashboard/SKILL.md`, 평일 매시 실행)를 걸어 둔 경우가 있다. 이 파일은 처음엔 "서버·워쳐 체크 + 재기동 + JQL 재조회"까지만 담은 **훨씬 짧고 독립적인 정의**였고, 위 `hourly-resync` 스킬의 "pending 발견 시 드레인" 단계를 전혀 참조하지 않았다. 그 결과 매시간: 재기동된 워쳐가 쌓인 큐를 즉시 재발견 → 즉시 재종료 → scheduled-task 세션은 "재기동했다"까지만 하고 그대로 종료 → 큐는 그대로 몇 시간씩 쌓이는 일이 반복됐다(사용자가 "1시간마다 스킬도 도는데 왜 워쳐가 꺼져 있냐"고 지적해 발견). **수정**: scheduled-task의 prompt를 `hourly-resync` 절차(전체 재조회 + 헬스체크 + **워쳐 재기동 직후 pending 발견 시 위임 판단대로 드레인, 재기동은 항상 이 세션이 직접**)를 그대로 따르도록 갱신했다. `mcp__scheduled-tasks__update_scheduled_task`로 수정 가능(파일을 직접 고쳐도 되지만 도구를 쓰는 편이 안전). **잔존 한계**: scheduled-task로 열린 세션도 결국 자기 절차를 마치면 종료되는 짧은 세션이라, 그 세션이 재기동한 워쳐도 세션 종료와 함께 죽을 수 있다(대화형 세션처럼 사용자가 계속 붙어 있지 않는 한). 이번 수정은 "매시간 쌓인 큐를 확실히 비운다"는 보장이지 "워쳐가 시간 사이사이 항상 떠 있다"는 보장은 아니다 — 후자를 완전히 없애려면 `docs/15`의 헤드리스 워커(PAT 기반, 라이브 세션 불필요)가 필요하나 그건 실험적·계약 미확정 상태다.

## 권장 운영 사이클
```
1) serve + watcher (1회, 항상 함께)   # 서버 상시 + 큐 자동 감시
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
  - 재호출된 Claude Code는 위 **위임 판단**대로 직접 처리하거나 `queue-worker`에 넘긴다. 어느 쪽이든 `11` 매핑대로 MCP 호출(조회 또는 변경 2단계 전이 등) 후 payload를 파일로 쓰고, 메인이 `apply_and_rewatch.sh <payload.json>`으로 `snapshot.json` 병합·서버 `ack`·워쳐 재기동을 한 번에 실행한다. payload는 `comments`/`transitions`(드롭다운)/`issuePatch`(변경 후 status·duedate·labels; duedate 변경 시 bucket 재계산)를 담는다.
  - **⚠️ 재기동 누락 방지(2026-07-28).** "apply_queue.py 실행" → "watcher 재기동"이 별개의 두 단계라, Claude Code가 처리 후 재기동을 깜빡해 워쳐가 죽은 채로 남는 사고가 반복됐다. 이를 막기 위해 `tools/apply_and_rewatch.sh <payload.json> [port] [poll_seconds]`를 만들어 두 단계를 한 프로세스 체인으로 묶었다(`apply_queue.py` 실행 후 `exec`로 `watch_queue.py`를 이어 실행). **처리 후에는 `apply_queue.py`를 단독으로 부르지 말고, 항상 이 스크립트를 `run_in_background:true`로 호출한다.** 이러면 "재기동"이 기억해야 할 별도 단계가 아니라 호출 자체에 포함된다.
  - `process_queue.py` — pending 읽기전용 유무만 1회 검사(블로킹 없는 빠른 상태 확인용, exit 0/1).
  - 위 스크립트들은 **Jira를 호출하지 않는다**(큐 파일 읽기 + 로컬 snapshot 쓰기 + localhost ack 만). MCP 호출은 항상 Claude Code가 한다.
- 과거의 서버 측 자동 처리(`/api/auto-process`·신호파일)는 루프를 닫지 못해 제거됐다. `watch_queue.py`는 종료→세션 재호출로 **실제로 루프를 닫는다**는 점이 다르다.
- 무한 tight loop 금지: `watch_queue.py`는 `poll`초(기본 1.5s) 간격으로 잔다. 세션을 닫으면 워처도 멈추므로, 다시 자동화하려면 워처를 재기동한다.

## 트러블슈팅 (TROUBLESHOOTING로도 분리 가능)
- 브라우저가 snapshot 못 읽음 → 서버 기동/포트/경로 확인(`file://` 직접 열기 금지).
- **정적 파일만 500 `{"error":"read failed"}`** (API `/api/snapshot`은 200인데 `GET /`·`/js/*.js`가 500) → 서버 데몬이 **샌드박스 실행 컨텍스트**에서 떠 `web/` 읽기가 막힌 상태. `data/`만 허용돼 API만 동작. 해결: 데몬을 죽이고(`pgrep -f serve.py` → kill) **샌드박스 없이** 재기동한다(Claude Code Bash 도구면 `dangerouslyDisableSandbox=true`). `SessionStart` 훅의 `tools/ensure_services.sh`는 사용자 셸(비샌드박스)에서 돌아 이 문제가 없다 — 증상은 Claude가 Bash 도구로 직접 `nohup` 기동할 때 발생.
- 상태 변경 실패 → 해당 워크플로우에 그 전이가 없음. `jira_get_transitions` 결과를 사용자에게 보여줌.
- duedate 형식 오류 → `YYYY-MM-DD` 확인.
- 권한/read-only → MCP가 read-only면 mutation 불가, 사용자에게 안내.
- **Jira 인증 실패(401/403 · "client not configured" · 토큰 없음)** → 사용자에게 Jira 토큰을 **1회 요청**하고, **저장소 밖**(MCP 서버 env / gitignore된 `.env`·`data/secrets.json`)에만 보관해 MCP를 재인증한다. 토큰을 `config.json`·snapshot·commands·로그·커밋에 **남기지 않는다**. 평문으로 받은 토큰은 노출로 간주해 재발급 권고(`02` 인증).
- 네트워크 도메인 차단(컨테이너) → 조직 관리자에게 허용 도메인 추가 요청.

## Definition of Done
- 서버 1회 기동으로 대시보드가 뜨고 snapshot/commands가 오간다.
- sync→조작→process 사이클이 끊김 없이 동작.
- 각 사용자 명령이 위 표대로 정확히 매핑되어 실행된다.
