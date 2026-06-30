# 12 — Frontend

목적: `snapshot.json`을 읽어 라벨 그룹·간트·카드·상세를 렌더하고, 액션을 큐로 보낸다.

## 기술 선택
- **바닐라 JS + HTML + CSS 권장**(빌드 도구 없이 `web/`을 서버로 바로 제공). Opus 4.7가 단일 세션에서 안정적으로 다루기 쉽고 의존성 깨질 일이 적다.
- 외부 라이브러리는 최소화. 간트는 직접 SVG/div로 구현(`06`). 차트 라이브러리 도입 시 CDN 1개로 한정하고 오프라인 폴백 고려.
- 파일이 커지면 `app.js`를 `data.js`(로드/폴링), `gantt.js`, `cards.js`, `detail.js`, `actions.js`로 분할(ES module).

## 시작점: JQL 쿼리바 (필수)
- 상단에 JQL 입력창 + "조회 시작" 버튼을 둔다. **이 입력이 대시보드의 출발점이다.**
- 제출(클릭 또는 Enter) → `{"action":"sync","jql":"..."}`를 큐로 전송(`actions.sync`). 토스트로 "Claude Code에서 process로 반영" 안내.
- 입력창은 `snapshot.query`(없으면 `snapshot.config.jql`)로 prefill. 사용자가 편집 중이면 덮어쓰지 않는다.
- 빈 상태(쿼리 미입력/이슈 0): "필터링 쿼리를 입력해 시작하세요" 온보딩 메시지를 본문에 표시.

## 데이터 로드 & 폴링
- 시작 시 `GET /api/snapshot`(서버가 `data/snapshot.json` 제공) 또는 정적 경로 `../data/snapshot.json` fetch.
- `generatedAt`을 기억하고 N초(기본 5~10s)마다 재fetch. 값이 바뀌면 diff 렌더(가능하면 부분 갱신, 어려우면 전체 재렌더 + 스크롤/접힘 상태 보존).
- 윈도우 포커스 복귀 시 즉시 1회 재fetch.

## 상태(클라이언트)
- `state = { snapshot, filters, collapsed:Set<"group:name">, selectedKey, ui:{ groupOrder } }`.
- 선택 `selectedKey`는 메모리 유지. **접힘 상태 `collapsed`는 서버 `ui-state.json`에 영속**(다음 실행 시 복원). 타임라인·카드가 같은 `state.collapsed`(그룹명 기준)를 공유하므로 **한쪽에서 접으면 양쪽이 함께 접힌다.**
- **보기 설정(`ui`)은 서버에 영속**한다: 시작 시 `GET /api/ui-state`로 로드, 변경 시 `POST /api/ui-state`로 저장(`data/ui-state.json`, `13`). 현재 `ui.groupOrder`(그룹 순서)·`ui.collapsed`(접힘 그룹, 키 `group:<name>`)·`ui.sectionOrder`(본문 영역 순서 — `today`/`timeline`/`outOfRange`/`cards`)가 이 경로를 쓴다. 서버 미연결 시 기본값으로 동작하고 저장만 생략된다. 그룹 순서는 렌더 시 `util.applyGroupOrder(groups, ui.groupOrder)`로 적용되어 간트·카드가 동일 순서를 공유한다. 영역 순서는 `sections.js`가 `.content`의 `section[data-section]` 노드를 재배치(패널 헤더의 ▲▼)하고 영속한다.

## 오늘 마감(Today) 강조 섹션
- 본문 첫 영역(`section[data-section="today"]`, `#today`)에 **due date가 오늘인 이슈만** 라벨 그룹으로 보여준다. 강조 스타일(`.panel-today`, today 색).
- `app.js todayGroups()`가 `passesBaseFilters(it) && bucketOf(duedate)==="today"`인 이슈를 `labelGroups` 기준으로 묶고, **기존 `renderCards`를 재사용**해 `#today`에 렌더한다(카드 UI·그룹 접힘 `group:<name>` 공유).
- 상태줄 버킷 필터(`filters.bucket`)와 **무관**(정의상 오늘). 0건이면 "오늘 마감인 티켓이 없습니다" 표시(영역·순서조정 유지).
- 순서 조정·영속은 다른 영역과 동일(`sections.js`가 `section[data-section]`에 ▲▼ 자동 부착, `sectionOrder`에 `today` 포함). 기본 맨 위.

## 설명 이미지 붙여넣기
- 설명(description) `textarea`(`#cf-description`·`#d-desc-body`)에 `paste-image.js`의 `wireImagePaste`를 연결한다. 클립보드 이미지를 붙이면 `POST /api/upload-image`로 업로드 → 본문 커서에 `!파일명!` 삽입 + 업로드 경로를 수집해 `create_issue`/`set_description`의 `attachments[]`로 전송(`03`/`11`). 코멘트는 미지원(첨부 인자 없음).

## 액션 전송
- `POST /api/commands`에 `03` 스키마 JSON. 성공 시 낙관적 UI(예: "대기 중" 배지) 후 폴링으로 확정.
- 서버 없으면 클립보드 폴백(`11`).

## 스타일 토큰 (일관 색)
```
--bg, --surface, --border, --text, --muted
--bucket-overdue:#e5484d  --bucket-today:#f5a623  --bucket-week:#3b82f6  --bucket-later:#8b8f98  --bucket-none:#c9ccd1
--cat-design:#d946ef --cat-code:#22c55e --cat-docs:#3b82f6 --cat-chat:#f59e0b --cat-jira:#0052cc --cat-link:#64748b
status-pill: new=neutral, indeterminate=blue, done=green
라벨 색: 라벨문자열 해시 → 미리 정의된 10색 팔레트(결정적)
```
- 다크/라이트 토글(선택). 대비(AA) 확보.
- 디자인 디테일이 필요하면 `/mnt/skills/public/frontend-design/SKILL.md`를 참고해 토큰·타이포를 잡는다.

## 접근성·견고성
- 키보드: 그룹 토글/카드 포커스 가능. 칩은 button 요소.
- snapshot이 비었거나 로드 실패 시 빈 상태/에러 표시.
- 큰 보드(수백 이슈) 대비: 카드 가상화는 과하면 생략하되, 간트 막대 수가 많으면 그룹 접힘 기본값을 "접힘"으로.

## Definition of Done
- JQL 쿼리바가 시작점으로 동작한다(제출 시 sync 명령 전송, prefill, 빈 상태 온보딩).
- snapshot만으로 전 화면이 렌더되고 폴링으로 갱신된다.
- 접힘/선택/필터 상태가 재렌더에도 보존된다.
- 액션이 큐로 전송되고 결과가 반영된다.
- 색 토큰이 bucket/category/status에 일관 적용된다.
