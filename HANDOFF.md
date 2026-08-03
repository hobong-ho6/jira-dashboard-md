# HANDOFF

<!--
════════════════════════════════════════════════════════════
이 파일은 세션 간 핸드오프 문서입니다. (사람 + Claude 공용)

■ Claude 사용 규칙
1. [세션 시작] 이 파일을 가장 먼저 읽고, "현재 상태"와
   "다음 할 일"을 확인한 뒤 작업을 시작한다.
   시작 시 사용자에게 한 줄로 브리핑한다.
   예) "지난 세션: X 완료. 오늘 예정: Y. 시작할까요?"
2. [세션 종료] 사용자가 "핸드오프 갱신" / "세션 정리" /
   "handoff"라고 하면 이 파일을 아래 규칙으로 갱신한다.
   - "현재 상태" 블록을 새로 작성 (덮어쓰기)
   - "다음 할 일"에서 완료 항목은 [x] 처리 후
     "최근 세션 기록"의 완료 목록으로 이동
   - 새로 발견된 할 일을 "다음 할 일"에 우선순위와 함께 추가
   - "최근 세션 기록" 맨 위에 오늘 세션 엔트리 추가
   - "최근 세션 기록"은 최대 5개 유지. 넘치면 가장 오래된
     엔트리를 "아카이브 요약"에 1~2줄로 압축해 병합
3. [작성 원칙]
   - 다음 세션의 Claude가 이 파일만 읽고 즉시 작업을
     이어갈 수 있을 만큼 구체적으로 쓴다.
     (파일 경로, 커밋 해시, 이슈 번호, 명령어 포함)
   - "왜 그렇게 결정했는지"를 결과보다 우선해서 남긴다.
   - 추측과 사실을 구분한다. 미확인 사항은 (미확인) 표기.
   - 전체 파일이 300줄을 넘지 않게 유지한다.
════════════════════════════════════════════════════════════
-->

## 프로젝트 정보

- **프로젝트명**: jira-dashboard-md (Jira MCP Dashboard)
- **한 줄 설명**: Jira MCP로 이슈를 읽어와 로컬 웹 대시보드로 시각화하고, 대시보드 변경 의도를 다시 Jira MCP로 반영하는 도구
- **주요 경로/저장소**: `/Users/ad03230205/Documents/jira-dashboard-md` (로컬 서버 `http://localhost:5173`)
- **관련 링크**: Jira `https://jira.workers-hub.com` (REST v2, Server/DC) · 세부 규칙은 `CLAUDE.md` + `docs/00`~`docs/15`

---

## 현재 상태

> 마지막 갱신: 2026-07-30 (세션 #2)

지난 세션(#1, 07-21) 이후 여러 세션에 걸쳐 큰 구조 변경이 있었고, **이번 세션에서 그 변경들을 확인·정리**했다(직접 구현한 건 아니고 git 커밋 확인 위주).

- **서버·워쳐**: 이번 세션 시작 시 서버가 3일 가까이 멈춰 있던 좀비 프로세스(포트 5173 점유, 응답 없음)에 막혀 있었음 → kill 후 `dangerouslyDisableSandbox=true`로 재기동, `curl /api/snapshot` 200 확인. 워쳐(`tools/watch_queue.py`)도 재기동, 큐는 현재 0건(비어 있음).
- **큐 처리 구조가 바뀜(07-30, 커밋 `eee4851`·`a89f9bd`·`2ab25fe`)**: `queue-worker` 서브 에이전트(`.claude/agents/queue-worker.md`)가 새로 생겼다. **대기(watch)는 항상 메인 세션**(무한 블로킹을 서브 에이전트에 맡기면 10분 상한에 걸려 루프가 끊김 — 실측 실패 기록됨), **MCP 처리만 조건부로 위임**: slackUrl 요약·`create_issue`+`subtasks`·`sync` 전체 재조회·3건 이상 배치·메인이 개발 중일 때 위임, 애매하면 메인이 직접 처리가 기본(워커 기동 고정비 ~40~50k 토큰이라 가벼운 배치 위임은 손해 — 실측: 마감일 1건에 51,483 토큰). 자세한 표는 `docs/13-operating-loop.md` "위임 판단" 절.
- **`tools/apply_and_rewatch.sh` 추가(07-28, 커밋 `cca9fd0`)**: `apply_queue.py` 실행 후 곧바로 `watch_queue.py`를 이어 실행해, "처리 후 워쳐 재기동을 깜빡하는" 사고를 구조적으로 막음. **큐 처리 후에는 이 스크립트를 `run_in_background:true`로 호출하는 것이 표준 절차** — `apply_queue.py` 단독 호출 금지(`docs/11`, `docs/13`에 명시).
- **UI 변경**: 라벨 그룹 카드에 "연결된 티켓 클러스터"(같은 그룹 내 연결된 티켓을 색 점선 박스로 묶음, 클러스터 여러 개면 색 구분) 추가, 마감일 제거 버튼, OG/파비콘 + 다크/라이트 테마 토글.
- **매뉴얼**: `manual/dropweb/jira-dashboard-manual-v1.zip` — 위 UI 변경분과 하위 작업 생성, In Progress 자동 시작 등을 반영해 v1로 갱신·전달함(이번 세션 이전 별도 작업).
- **HANDOFF.md 자체가 방치되어 있었음**: 지난 세션(#1)이 07-21에 작성한 뒤 이후 세션들이 docs/13·CLAUDE.md는 갱신했지만 이 파일은 손대지 않아 실제 상태와 크게 어긋나 있었다 — 이번 세션에서 git log 기준으로 따라잡아 갱신함(아래 "최근 세션 기록" 참고).
- **커밋되지 않은 변경 있음**: `data/snapshot.json`, `manual/index.html`, `manual/service-spec.md`가 unstaged 상태. 또 `data/.payload_*.json` 임시 파일 28개가 정리 안 된 채 남아 있음(큐 처리 중 생성된 것들 — `.gitignore`에 없어 `git status`에 계속 잡힘, 정리 필요할 수 있음).

---

## 다음 할 일

<!-- 우선순위순. P1=지금 바로, P2=이번 주, P3=여유 있을 때
     각 항목은 "다음 Claude가 바로 착수 가능한" 수준으로 구체적으로 -->

- [ ] **P2**: `data/.payload_*.json` 임시 파일 정리 — 큐 처리(`apply_and_rewatch.sh`) 중 생성된 payload 파일들이 `data/` 아래 28개 남아 `git status`를 어지럽힌다. `.gitignore`에 `data/.payload_*.json` 패턴을 추가하거나, 처리 완료 후 자동 삭제하도록 스크립트를 손보는 것을 검토(사용자 확인 필요 — 삭제 전에 무엇이 남아있는지 먼저 물어볼 것).
- [ ] **P2**: `data/snapshot.json` / `manual/index.html` / `manual/service-spec.md` unstaged 변경 — 다음 세션에서 커밋할지 확인.
- [x] 권한(permissions) 설정 옵션1 관련 — 이후 세션에서 실제로 Jira 쓰기 도구들(`jira_add_comment` 등)이 프롬프트 없이 동작하고 있는 것으로 보아(이번 세션 대화 로그 기준) 해결된 것으로 추정됨. **(미확인)** — 직접 `.claude/settings.local.json`을 열어 확인한 것은 아님.
- [ ] **P3**: `docs/15-headless-worker.md`(PAT 기반 헤드리스 워커)는 여전히 "보류" 상태(2026-06-26 결정). 30일 관찰 기간이 지났으면(관찰 시작일 미확인) 재검토 시점인지 사용자에게 확인.

### 차단 요소 / 대기 중

- 없음(현재 큐 0건, 서버·워쳐 정상).

---

## 주요 결정 사항

<!-- 되돌리기 어렵거나 이후 작업의 전제가 되는 결정만.
     형식: 날짜 | 결정 | 이유 -->

| 날짜 | 결정 | 이유 |
|------|------|------|
| 2026-07-21 | `defaultMode: bypassPermissions` 전체 무프롬프트 전환 요청을 Claude가 직접 적용하지 않기로 함 | Jira 상태 전이·코멘트, git push 등 비가역적 동작까지 전부 무프롬프트로 열리게 되어 "시스템/보안 설정 변경" 금지 원칙에 해당 |
| 2026-07-21 | 사용자 요청으로 이후 응답은 항상 한글로 고정 | 사용자 명시적 요청 |
| 2026-07-30 | 큐 워쳐(대기)는 서브 에이전트에 맡기지 않고 항상 메인 세션이 담당, MCP 처리만 조건부로 `queue-worker`에 위임 | 워쳐를 서브 에이전트에 맡겼다가 10분 Bash 상한 + 백그라운드 완료 알림이 이미 종료된 자신에게 가는 문제로 루프가 끊기는 실패를 실측함(고아 워쳐, 큐 미처리) |
| 2026-07-30 | 큐 배치 위임 기준: slackUrl 요약·subtasks·sync 전체 재조회·3건 이상·개발 중이면 위임, 그 외(애매하면 포함)는 메인 직접 처리 | 워커 기동 고정비 ~40~50k 토큰 실측 — 이 프로젝트 평균 배치가 1.6개 명령이라 가벼운 배치는 위임하면 고정비가 실작업을 압도 |
| 2026-07-30(추정) | `apply_queue.py` 단독 호출 금지, 항상 `tools/apply_and_rewatch.sh`로 apply+ack+워쳐 재기동을 한 체인으로 실행 | 처리 후 워쳐 재기동을 깜빡해 워쳐가 죽은 채 남는 사고가 반복됨 — 재기동을 "기억해야 할 단계"에서 "호출 자체에 포함"으로 구조 변경 |

---

## 최근 세션 기록

<!-- 최신이 맨 위. 최대 5개 유지 -->

### 2026-07-30 — 세션 #2: 서버 복구 + git/문서 재확인 + HANDOFF 갱신 (본 세션)

- **완료**:
  - 좀비 서버 프로세스(3일 미응답, 포트 5173 점유) kill 후 `dangerouslyDisableSandbox=true`로 재기동 → `/api/snapshot` 200 확인
  - 큐 워쳐(`tools/watch_queue.py`) 재기동 확인, 큐 0건
  - 사용자 요청으로 "에이전트 업무 분배" 관련 내용을 git log + `docs/13`/`CLAUDE.md`/`.claude/agents/queue-worker.md`에서 확인·요약해 브리핑 (07-30 세션들에서 이미 구현·커밋된 `queue-worker` 위임 체계)
  - HANDOFF.md를 2026-07-21(세션 #1) 상태에서 현재(2026-07-30)까지의 git 커밋 이력 기준으로 갱신(본 갱신)
- **진행 중 / 중단 지점**: 없음(이번 세션은 확인·정리 위주, 큐 처리 요청은 없었음)
- **발견 / 배운 것**:
  - HANDOFF.md가 세션 #1 이후 한 번도 갱신되지 않아 실제 프로젝트 상태(큰 아키텍처 변경 3건 이상)와 크게 어긋나 있었음 — 문서를 고칠 때 HANDOFF.md도 같이 갱신하는 습관이 세션마다 지켜지지 않고 있다. 다음 세션들은 "핸드오프 갱신" 명시 요청이 없어도, 큰 구조 변경 커밋 직후 간단히 현재 상태를 갱신해두는 게 나을 수 있음(사용자에게 제안할 만한 개선점).
  - `data/.payload_*.json` 임시 파일이 `.gitignore`에 없어 처리할 때마다 `git status`에 계속 쌓임 — 아직 정리 안 됨(위 "다음 할 일" 참고).
  - 서버가 좀비 프로세스로 멈추는 패턴이 이번이 두 번째(이전에도 3일 이상 미응답 프로세스가 포트를 점유한 채 방치된 적 있음, `docs/13` 트러블슈팅에 이미 기록됨) — 재발 방지책(예: 헬스체크에서 응답 지연도 감지)은 아직 없음.
- **다음 세션 첫 작업**: 위 "다음 할 일" P2 두 건(payload 임시파일 정리 여부, unstaged 변경 커밋 여부) 사용자에게 확인.

### 2026-07-21 — 세션 #1: hourly-resync 스케줄 실행 + 권한 설정 논의 + HANDOFF 최초 작성

- **완료**:
  - 예약 작업(hourly-resync 흐름): 서버·워쳐 상태 확인 — 둘 다 정상, 재기동 불필요
  - 저장된 JQL로 전체 재조회(17건) → `data/snapshot.json` 갱신
  - 사용자 요청으로 응답 언어를 한글로 고정
  - CLAUDE.md의 "세션 핸드오프" 규칙 확인, `HANDOFF.md` 최초 작성
- **발견 / 배운 것**: `.claude/settings.local.json`은 gitignore되어 개인 로컬 설정. 큐 드레인에 필요한 일부 Jira 쓰기 도구가 당시 allow 목록에 없었음(현재는 해결된 것으로 보임 — 위 "다음 할 일" 참고).

---

## 아카이브 요약

<!-- 오래된 세션들의 압축 요약. 세션당 1~2줄.
     예) 세션 #1~3 (7/1~7/8): 프로젝트 초기 세팅, DB 스키마 확정(PostgreSQL), CI 구축 완료 -->

(없음)

---

## 컨텍스트 노트

<!-- 세션과 무관하게 항상 유효한 배경지식.
     예) 환경 변수 위치, 테스트 실행 명령, 배포 절차, 주의사항,
     외부 담당자, 자주 쓰는 명령어 -->

- 저장된 JQL(`data/config.json.jql`): `project in (W3P, UNIFY) AND status in (Open, "In Progress", Reopened) AND resolution = Unresolved AND (assignee in (currentUser()) OR reporter in (currentUser())) ORDER BY priority DESC, updated DESC`
- 헬스체크: `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/api/snapshot` (200 기대), `pgrep -fl tools/watch_queue.py`
- 서버 재기동(다운 시): `nohup python3 server/serve.py >data/serve.log 2>&1 &` — 반드시 `dangerouslyDisableSandbox=true`로. **좀비 프로세스 주의**: `curl`이 무응답(000)인데 `lsof -i :5173`에 프로세스가 보이면, 그 프로세스가 며칠째 멈춰 있는 것일 수 있다 — `ps -p <pid> -o etime`으로 경과시간 확인 후 kill.
- 워쳐 재기동(다운 시): `python3 tools/watch_queue.py`를 `run_in_background`로. **큐 처리 후에는 이것만 단독으로 부르지 말고, `bash tools/apply_and_rewatch.sh <payload.json>`을 `run_in_background`로 호출**(apply+ack+재기동 한 체인, `docs/13`).
- 큐 배치 처리 시 위임 판단: slackUrl 요약·subtasks·sync 전체·3건 이상·개발 중 = `Agent(queue-worker)`에 pending JSON 전달, 그 외(애매하면 이쪽 기본)는 메인이 직접 MCP 호출. 상세: `docs/13-operating-loop.md` "위임 판단" 절.
- 전체 재동기화 절차: `jira_search(jql=<config.jql>, fields="*all", limit=50, start_at=0)` → 페이지네이션 → `data/raw_issues.json` 저장(Read로 직접 읽지 말고 python3/jq로 파싱) → `python3 tools/normalize.py` → `data/snapshot.json` 원자적 재생성
- 사용자 응답 언어: 항상 한글
