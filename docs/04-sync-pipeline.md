# 04 — Sync Pipeline (읽기 경로: Jira → snapshot)

목적: **사용자가 입력한 필터링 쿼리(JQL)** 로 이슈를 읽어 `data/snapshot.json`을 만든다. 호출을 최소화한다. 이 쿼리가 대시보드의 시작점이다.

## Claude Code 절차
1. **필터링 쿼리 확보(시작점).** 다음 중 하나로 JQL을 얻는다:
   - 사용자가 Claude Code에 직접 준 JQL, 또는
   - 대시보드 JQL 입력창에서 들어온 `sync` 명령의 `jql`(`docs/11`).
   둘 다 없고 `config.json.jql`도 비어 있으면 사용자에게 한 번 묻는다(예시 JQL 제시). 받은 값을 `config.json.jql`에 저장한다. **쿼리 없이는 이 절차를 진행하지 않는다.**
2. (최초 1회 또는 필요 시) 커스텀 필드 발견:
   - `jira_search_fields(keyword="start")`, `("기간")`, `("epic")` 등으로 시작일/에픽 링크 후보 id 확인 → `config.json`의 `startDateField`/`epicLinkField`에 기록.
3. 페이지네이션 루프:
   ```
   start_at = 0
   fields = "summary,status,issuetype,assignee,priority,labels,duedate,created,updated,description,issuelinks,parent"
   (+ config.startDateField 있으면 콤마로 추가)
   repeat:
     res = jira_search(jql=config.jql, fields=fields, limit=config.fetchLimit, start_at=start_at)
     수집 res.issues
     if start_at + len(res.issues) >= res.total: break
     start_at += config.fetchLimit
   ```
   수집한 응답(`{...,"issues":[...]}` 또는 issues 배열)을 **가공 없이 그대로** `data/raw_issues.json`에 저장한다.
   - MCP는 평면(flattened) 형식을 돌려주지만, `tools/normalize.py`의 `to_v2()`가 자동으로 표준 v2로 변환한다(`02` §MCP 응답 형식). **수동 변환 스크립트는 불필요**하다.
   - **이슈 유형(issuetype) 보강:** 이 MCP의 `jira_search`는 `issuetype`을 누락한다(`02`). 카드/상세에 유형(Epic/Task 등)을 표시하려면 각 이슈에 `jira_get_issue(issue_key, fields="issuetype")`로 `issue_type`을 받아 raw 이슈에 주입한다(이슈당 1콜). `to_v2()`가 `issue_type`→`issuetype`으로 매핑한다. 유형은 거의 안 바뀌므로 1회성 보강 성격.
4. `python3 tools/normalize.py` 실행 → `config.json`을 읽어 `data/snapshot.json`을 원자적으로 생성. 각 이슈 정규화(`03` 스키마):
   - 상태/우선순위/담당자/라벨/타입/부모를 02 §응답경로대로 추출.
   - `startDate` = `startDateField` 값 → 없으면 `created`의 날짜(YYYY-MM-DD) → 없으면 `duedate`.
   - `descriptionLinks` = description 원문을 `08` 규칙으로 파싱.
   - `links` = `issuelinks[]`를 `03`의 `{type,direction,relation,key,summary,status}`로 변환.
   - `bucket` = `06`의 분류 함수로 계산(기준일 = `generatedAt` 로컬 날짜).
   - `comments=[]`, `commentsLoaded=false`.
5. `labelGroups` 생성: 라벨→이슈키 역인덱스. 라벨 없는 이슈는 `"(no label)"`. 정렬은 `config.labelOrder` 우선, 나머지는 count 내림차순.
6. `config` 사본을 snapshot에 포함(브라우저가 snapshot 한 파일만 읽어도 되도록). snapshot 최상위에 `query`(=사용한 JQL)도 기록한다.
7. `data/snapshot.json`을 **원자적 쓰기**(임시파일 → rename)로 저장. 부분 기록 금지.

## 증분 재동기화 (mutation 후)
- `process`(`11`) 직후엔 전체 sync 대신 영향받은 issueKey만 `jira_get_issue`로 다시 읽어 snapshot의 해당 항목만 교체하고 `generatedAt` 갱신. 큰 보드에서 비용 절감.

## 성능·한도
- `limit ≤ 50`. 큰 결과는 반드시 페이지네이션.
- 한 번의 `jira_search`로 끝나도록 `fields`를 충분히 지정해 이슈별 추가 호출을 피한다.
- 코멘트·전이는 여기서 가져오지 않는다(지연 로드: `10`, `11`).

## Definition of Done
- 사용자가 입력한 JQL이 `config.json.jql`과 snapshot 최상위 `query`에 기록된다.
- `snapshot.json`이 스키마(`03`)를 100% 만족하고 원자적으로 저장된다.
- 라벨 없는 이슈가 `"(no label)"`에 모인다.
- `bucket`이 모든 이슈에 채워진다.
- 동일 JQL 재실행 시 결과가 안정적이다(정렬·그룹 순서 결정적).
