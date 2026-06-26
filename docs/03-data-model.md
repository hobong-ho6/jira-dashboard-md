# 03 — Data Model (파일 계약)

세 파일이 전체 시스템의 유일한 인터페이스다. **스키마를 바꾸면 이 파일을 먼저 고치고** sync(`04`)·frontend(`12`)·mutations(`11`)를 함께 갱신한다.

---

## `data/config.json` (사람이 손으로도 편집 가능)
```json
{
  "jiraBaseUrl": "https://jira.workers-hub.com",
  "projects": ["PROJ"],
  "jql": "project = PROJ AND statusCategory != Done ORDER BY duedate ASC",
  "fetchLimit": 50,
  "labelOrder": ["urgent", "frontend", "backend"],
  "weekStart": "monday",
  "startDateField": null,
  "epicLinkField": null,
  "ganttDependencyLinkTypes": ["Finish-to-Start link (WBSGantt)", "Blocks"],
  "descriptionLinkRules": [
    { "match": ["figma.com"],                 "category": "design", "label": "Design" },
    { "match": ["github.com", "gitlab"],       "category": "code",   "label": "Code" },
    { "match": ["confluence", "/wiki/"],       "category": "docs",   "label": "Docs" },
    { "match": ["docs.google", "sheets.google","drive.google"], "category": "docs", "label": "Drive" },
    { "match": ["slack.com"],                  "category": "chat",   "label": "Slack" },
    { "match": ["jira.workers-hub.com/browse"],"category": "jira",   "label": "Jira" },
    { "match": ["*"],                          "category": "link",   "label": "Link" }
  ]
}
```
- `jql`: **대시보드의 시작점.** 비워두고(`""`) 사용자가 입력한 필터링 쿼리로 채운다. 사용자가 Claude Code에 직접 주거나 대시보드 JQL 입력창(→ `sync` 명령)으로 전달한다. sync는 이 값으로 `jira_search`를 돈다.
- `startDateField`/`epicLinkField`: `jira_search_fields`로 발견한 `customfield_xxxxx`를 넣는다. 없으면 `null` 유지.
- `descriptionLinkRules`: 위에서부터 첫 매칭 적용. `"*"`는 폴백. (`08`)
- `ganttDependencyLinkTypes`: 간트 화살표로 그릴 링크 타입(`06`,`07`).

## `data/snapshot.json` (Claude Code 작성, 브라우저 읽기 전용 소스)
```json
{
  "generatedAt": "2026-06-23T09:00:00+09:00",
  "jiraBaseUrl": "https://jira.workers-hub.com",
  "query": "project = UNIFI AND statusCategory != Done ORDER BY duedate ASC",
  "config": { "...": "config.json 사본(브라우저가 단일 파일만 읽어도 되게, jql 포함)" },
  "issues": [
    {
      "key": "PROJ-123",
      "url": "https://jira.workers-hub.com/browse/PROJ-123",
      "summary": "결제 모듈 i18n QA",
      "issuetype": "Task",
      "status": { "name": "In Progress", "category": "indeterminate" },
      "priority": "High",
      "assignee": { "name": "hogeun", "displayName": "Hogeun", "avatar": "https://..." },
      "labels": ["frontend", "i18n"],
      "duedate": "2026-06-25",
      "startDate": "2026-06-20",
      "created": "2026-06-18T10:00:00+09:00",
      "updated": "2026-06-22T18:00:00+09:00",
      "parent": "PROJ-100",
      "bucket": "thisWeek",
      "descriptionText": "표시용 정리 텍스트(선택)",
      "descriptionLinks": [
        { "url": "https://figma.com/file/xxx", "text": "디자인 스펙", "category": "design", "label": "Design" }
      ],
      "commentLinks": [
        { "url": "https://slack.com/archives/xxx", "text": "...", "category": "chat", "label": "Slack" }
      ],
      "links": [
        { "type": "Blocks", "direction": "outward", "relation": "blocks",
          "key": "PROJ-200", "summary": "API 배포", "status": "To Do" }
      ],
      "comments": [],
      "commentsLoaded": false
    }
  ],
  "labelGroups": [
    { "name": "frontend", "count": 5, "issueKeys": ["PROJ-123", "PROJ-130"] },
    { "name": "(no label)", "count": 2, "issueKeys": ["PROJ-140", "PROJ-141"] }
  ],
  "transitions": {
    "PROJ-123": [ { "id": "21", "name": "Done", "to": "Done" } ]
  }
}
```
규칙
- `query`: 이 스냅샷을 만든 JQL(=`config.jql`). 대시보드 JQL 입력창은 이 값으로 채워진다.
- `bucket` ∈ `overdue|today|thisWeek|later|none` — sync가 `generatedAt`과 `weekStart` 기준으로 계산(`06`).
- `startDate`: `config.startDateField` 값 → 없으면 `created`의 날짜 → 그래도 없으면 `duedate`와 동일(0일 막대). (`06`)
- `links[].direction` ∈ `inward|outward`, `relation`은 표시 문구(`type.inward`/`outward`).
- `descriptionLinks`: description 원문에서 추출(sync, `08`). `commentLinks`: 코멘트 본문에서 **같은 규칙**으로 추출하되 코멘트 로드 시에만 채워짐(지연, description url과 중복 제거). UI는 둘을 함께 표시(`08`).
- `comments`/`commentsLoaded`: 상세 진입 시 지연 로드로 채움(`10`).
- `transitions`: 비워둬도 됨. 상태 드롭다운을 미리 채우려면 sync 때 일부만, 혹은 상세 진입 시 큐로 요청(`11`).
- 라벨이 없는 이슈는 `labelGroups`의 `"(no label)"`에 모은다.
- `config.projects`: `config.json`의 `projects` 사본. 대시보드 "새 티켓" 폼의 프로젝트 선택지로 쓰인다(`12`). 없으면 프런트가 이슈 키 접두사에서 폴백 추출.
- `config.currentUser`: `config.json`의 `currentUser`(이 Jira 인스턴스의 username, 예: `hogeun.kim`). "새 티켓" 폼의 담당자 기본값으로 쓰인다(`12`). 이메일/표시명이 아니라 **username/key**여야 조회·배정이 된다.

## `data/commands.jsonl` (브라우저 append, Claude Code 드레인)
한 줄당 JSON 하나. 모든 명령은 `id`, `ts`, `status` 보유.
```json
{"id":"c_1719_q001","ts":"2026-06-23T09:05:00+09:00","status":"pending","action":"sync","jql":"project = UNIFI AND statusCategory != Done ORDER BY duedate ASC"}
{"id":"c_1719_ab12","ts":"2026-06-23T09:10:00+09:00","status":"pending","action":"transition","issueKey":"PROJ-123","to":"Done","comment":null}
{"id":"c_1719_cd34","ts":"...","status":"pending","action":"set_duedate","issueKey":"PROJ-123","duedate":"2026-06-30"}
{"id":"c_1719_ef56","ts":"...","status":"pending","action":"add_comment","issueKey":"PROJ-123","body":"QA 완료"}
{"id":"c_1719_gh78","ts":"...","status":"pending","action":"load_comments","issueKey":"PROJ-123"}
{"id":"c_1719_ij90","ts":"...","status":"pending","action":"set_labels","issueKey":"PROJ-123","labels":["frontend","i18n","done-check"]}
{"id":"c_1719_kl12","ts":"...","status":"pending","action":"create_link","inward":"PROJ-1","type":"Blocks","outward":"PROJ-2"}
{"id":"c_1719_mn34","ts":"...","status":"pending","action":"create_issue","project":"UNIFY","issueType":"Task","summary":"새 작업","assignee":"hogeun.kim","description":null,"priority":"High","duedate":"2026-07-01","labels":["frontend"],"parent":null}
```
- `create_issue`: 필수 `project`·`issueType`·`summary`. 선택 `assignee`(기본값=`config.currentUser`, 비우면 프로젝트 기본값)·`description`·`priority`·`duedate`·`labels[]`·`parent`(Sub-task 등). 브라우저는 빈 선택 필드를 생략한다. 생성된 새 이슈는 처리 후 snapshot `issues[]`에 추가된다(`11`).

`action` 종류와 처리 매핑은 `11-mutations.md`가 권위.
`status`: 브라우저는 항상 `pending`으로 만든다. Claude Code가 `done`/`failed`/`blocked`로 바꿔 `data/.processed/`에 옮기거나 `ack` API로 표시.
`id` 규칙: `c_` + epoch초 + `_` + 4자 난수. **중복 id 금지, 재실행 금지.**

## `data/ui-state.json` (브라우저 읽기/쓰기, 보조 파일 — gitignore)
순수 **로컬 보기 설정**. Jira와 무관하며 큐를 거치지 않는다. 브라우저가 `GET/POST /api/ui-state`로 직접 읽고 쓴다(`12`,`13`). 커밋하지 않는다(`.gitignore`).
```json
{
  "groupOrder": ["GuideKim", "Mission&Reward", "UnifiMobile"]
}
```
- `groupOrder`: 라벨 그룹 표시 순서(사용자가 "그룹 순서 조정"에서 드래그한 결과). `"(no label)"`은 제외(항상 맨 끝). 렌더 시 `snapshot.labelGroups`(시드: `config.labelOrder`) 위에 적용된다. 없으면 시드 순서 그대로.
- 스키마는 자유 확장 가능(향후 다른 보기 설정 추가 시 키만 늘린다). 서버는 객체면 그대로 저장한다.
