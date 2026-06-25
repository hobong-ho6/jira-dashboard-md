# 02 — Jira MCP Contract (`noahs-mcp-jira`)

> 이 환경의 실제 사실에 기반한다. Jira **Server/DC**, base `https://jira.workers-hub.com`, REST **v2**.
> 도구 시그니처는 세션에서 `tool_search`로 로드한 결과를 항상 우선한다(여기 표기는 작성 시점 기준).

## 인증 / 자격증명 (Jira 토큰)
- Jira 읽기/쓰기는 **MCP(`noahs-mcp-jira`)** 가 자신의 자격증명으로 수행한다. 대시보드 서버·`config.json`·`snapshot`·`commands`는 **토큰을 다루지 않는다**(`01` 신뢰 경계, `13` 서버 규칙).
- **토큰이 없거나 인증 실패(401/403 · "client not configured" · read-only 오류) 시:** Claude Code는 사용자에게 Jira 토큰을 **1회 요청**한다(예: "Jira 토큰을 알려주세요 — MCP 인증에만 쓰고 저장소엔 저장하지 않습니다"). 받은 값은 **저장소 밖**에만 둔다:
  - 권장: MCP 서버 설정의 환경변수(예: `JIRA_PERSONAL_TOKEN`)로 주입 → MCP 재기동.
  - 임시: gitignore된 `.env` 또는 `data/secrets.json`. **`config.json` 등 커밋되는 파일·스냅샷·큐·로그에는 절대 넣지 않는다.**
- 토큰을 채팅·이슈 본문·커밋 등 평문으로 받으면 **노출된 것으로 간주**하고 사용자에게 **폐기·재발급(rotate)** 을 권고한다. 어떤 산출물에도 토큰을 echo/기록하지 않는다.

## 사용하는 도구와 용도
| 도구 | 용도 | 핵심 인자 |
|------|------|-----------|
| `jira_search` | sync 메인 쿼리 | `jql`, `fields`, `limit`(≤50), `start_at` |
| `jira_get_issue` | 상세/코멘트/링크 지연 로드 | `issue_key`, `fields`, `comment_limit`, `expand` |
| `jira_get_transitions` | 상태 변경 1단계 | `issue_key` |
| `jira_transition_issue` | 상태 변경 2단계 | `issue_key`, `transition_id`, (`comment`, `fields`) |
| `jira_update_issue` | Due date·라벨 등 필드 변경 | `issue_key`, `fields`(object) |
| `jira_add_comment` | 코멘트 추가 | `issue_key`, `comment`(markdown) |
| `jira_create_issue_link` | 연결 생성(선택) | `inward_issue_key`, `link_type`, `outward_issue_key` |
| `jira_get_link_types` | 링크 타입 목록 | (없음) |
| `jira_search_fields` | 커스텀 필드 id 발견 | `keyword` |
| `jira_get_agile_boards` / `jira_get_board_issues` / `jira_get_sprint_issues` | 보드·스프린트 범위가 필요할 때 | — |

## sync용 권장 `fields` (N+1 회피)
`jira_search` 한 번으로 카드·간트·라벨·링크에 필요한 거의 모든 것을 가져온다:
```
summary,status,issuetype,assignee,priority,labels,duedate,created,updated,description,issuelinks,parent
```
- `issuelinks` 를 포함하면 연결관계(A3)를 검색 결과에서 바로 얻는다 → 이슈별 추가 호출 불필요.
- **코멘트는 검색 결과에 없다.** 상세 진입 시 `jira_get_issue(issue_key, fields="comment", comment_limit=N)`로 가져온다(`10`). ⚠️ **이 MCP는 `fields`에 `comment`가 없으면 `comment_limit`을 줘도 코멘트를 반환하지 않는다**(기본 `fields`엔 comment 미포함 → 빈 것처럼 보임). 코멘트 0건 이슈는 응답에 `comments` 키 자체가 없으니 `[]`로 취급한다. 또한 `jira_get_issue`의 코멘트는 평면 형식이라 `comments[].author`가 **객체**(`{display_name,...}`)다 — snapshot/`apply_queue`에는 `author`를 **문자열(displayName)** 로 변환해 넣는다(프런트 `detail.js`가 문자열로 렌더).

## 응답에서 읽어야 할 경로 (정규화 기준)
- 상태: `fields.status.name`, 카테고리: `fields.status.statusCategory.key` (`new`/`indeterminate`/`done`)
- Due date: `fields.duedate` (형식 `"YYYY-MM-DD"`, 없으면 `null`)
- 라벨: `fields.labels` (문자열 배열)
- 담당자: `fields.assignee.displayName` / `.name` / `.avatarUrls`
- 우선순위: `fields.priority.name`
- 타입: `fields.issuetype.name`
- 부모/에픽: `fields.parent.key` (또는 에픽 링크 커스텀 필드 — §커스텀 필드 발견)
- 설명: `fields.description` — **Jira wiki markup 원문**(v2). 링크 파싱은 이 원문에서 한다(`08`).
- 링크: `fields.issuelinks[]` — 각 항목은
  - `type.name`(예: "Blocks"), `type.inward`/`type.outward`(관계 문구),
  - `inwardIssue` **또는** `outwardIssue` 중 하나가 존재 → 방향 판별.
    - `outwardIssue` 있으면 "이 이슈 → 상대"(outward, 문구 = `type.outward`)
    - `inwardIssue` 있으면 "상대 → 이 이슈"(inward, 문구 = `type.inward`)
  - 상대 이슈: `(in/out)wardIssue.key`, `.fields.summary`, `.fields.status.name`
- 코멘트: `fields.comment.comments[]` → 각 `author.displayName`, `created`, `updated`, `body`(wiki markup)

## MCP 응답 형식: 평면(flattened) — `normalize.py`가 v2로 변환
> 위 "응답에서 읽어야 할 경로"는 **표준 v2(`fields` 래퍼) 기준**이다. 그러나 이 환경의
> `noahs-mcp-jira.jira_search`는 **평면(flattened) 형식**을 돌려준다. `tools/normalize.py`의
> `to_v2()`가 자동으로 v2로 변환하므로, sync 시 **MCP 응답을 가공 없이 그대로** `data/raw_issues.json`에
> 저장하면 된다(수동 변환 불필요). 두 형식의 실측 차이는 다음과 같다:

| 항목 | MCP 평면 응답 | 표준 v2 (`normalize.py`가 기대) |
|------|---------------|-------------------------------|
| 구조 | 필드가 **최상위**에 평면화 | `issue.fields.*` 래퍼 |
| 상태 | `status = {name, category:"To Do", color}` | `status.statusCategory.key`(`new`/`indeterminate`/`done`) |
| 담당자 | `display_name`, `avatar_url` (**snake_case**) | `displayName`, `avatarUrls["48x48"]` |
| 링크 | `issuelinks[].inward_issue` / `outward_issue` (snake) | `inwardIssue` / `outwardIssue` |
| 커스텀필드 | `customfield_xxx = {"value": X}` (**래핑**) | `customfield_xxx = X` (값 그대로) |
| 부모 | `parent = {key, fields}` (v2와 동일) | `parent.key` |

- `status.category` → `statusCategory.key` 매핑: `"To Do"→new`, `"In Progress"→indeterminate`, `"Done"→done`.
- **커스텀필드 언래핑이 중요**: `{"value": null}`을 그대로 두면 `startDate` 추출이 깨진다(과거 수동 변환의 버그). `to_v2()`는 `{value:X}`→`X`로 풀며, 이미 v2인 입력에도 멱등하게 적용된다.
- 검색 결과는 **`issuetype`을 누락한다**(이 MCP의 한계). 유형이 필요하면 `jira_get_issue(fields="issuetype")`로 받는다(응답 키는 snake_case `issue_type`). sync에서 유형 표시가 필요하면 이슈당 1콜로 보강한다(`04`). 보강 안 하면 타입은 빈 문자열.

## 함정 / 반드시 지킬 것
1. **상태 변경은 2단계.** 상태 *이름*으로 못 바꾼다.
   `jira_get_transitions(issue_key)` → 응답에서 목표 상태 이름과 일치하는 항목의 `id` →
   `jira_transition_issue(issue_key, transition_id)`. 같은 상태로 가는 전이가 없으면 그 워크플로우에선 불가하므로 사용자에게 가능한 전이 목록을 보여준다.
2. **Due date 변경.** `jira_update_issue(issue_key, fields={"duedate":"YYYY-MM-DD"})`. 제거는 `{"duedate": null}`.
3. **wiki markup vs markdown.** v2 본문은 wiki markup. 코멘트는 `jira_add_comment(comment=...)`가 markdown을 받아 변환. 설명을 markdown으로 쓰려면 `jira_update_issue(..., is_description_markdown=True)`.
4. **페이지네이션.** `limit` 최대 50. 결과의 `total`을 보고 `start_at`을 50씩 증가시키며 반복. (`04`)
5. **커스텀 필드는 추측 금지.** "시작일/기간/에픽 링크"가 필요하면 `jira_search_fields(keyword="start")`, `(keyword="gantt")`, `(keyword="기간")`, `(keyword="epic")` 등으로 `id`(예: `customfield_10xxx`)를 **발견**해 `config.json`에 기록한 뒤 사용한다.
6. **프로젝트 키 추측 금지.** `config.json`에 없으면 사용자에게 1회 확인.
7. **읽기 전용 모드 가능성.** mutation 도구가 read-only 오류를 내면 사용자에게 알리고 큐 항목을 `blocked`로 둔다(삭제하지 않음).

## 이 인스턴스의 링크 타입 (실측)
| name | outward(→) | inward(←) | 비고 |
|------|------------|-----------|------|
| Blocks | blocks | is blocked by | 의존성, 간트 화살표 근거 |
| Relates | relates to | relates to | 일반 관계 |
| Duplicate | duplicates | is duplicated by | |
| Cloners | clones | is cloned by | |
| Problem/Incident | causes | is caused by | |
| Defect | has defect | is defect of | |
| Issue split | split to | split from | |
| Finish-to-Start link (WBSGantt) | (선행→후행) | | **간트 의존성 1순위** |
| Finish-to-Finish / Start-to-Start / Start-to-Finish (WBSGantt) | | | 간트 의존성 |
| Hierarchy link (WBSGantt) | contains | is contained in | 계층(부모-자식 대용 가능) |

- 이 인스턴스는 **WBS Gantt-Chart 플러그인**을 쓴다. 간트 의존성 화살표는 우선
  `Finish-to-Start link (WBSGantt)`와 `Blocks`를 사용한다(`06`, `07`에서 가중치 매핑).
- `jira_create_issue_link`의 `link_type`에는 위 `name`을 그대로 넣는다(예: `"Blocks"`).
