# 07 — Linked Issues (요구 A3)

목적: 이슈 간 연결관계를 보여준다. 데이터는 sync 때 `issuelinks`에서 이미 가져온다(추가 호출 없음).

## 정규화 (sync에서)
각 `fields.issuelinks[]` 항목 → `links[]`:
- `type` = `type.name` (예: "Blocks")
- `outwardIssue`가 있으면 `direction="outward"`, `relation=type.outward`, 상대 = `outwardIssue`
- `inwardIssue`가 있으면 `direction="inward"`, `relation=type.inward`, 상대 = `inwardIssue`
- `key/summary/status` = 상대 이슈의 `key`, `fields.summary`, `fields.status.name`
- **Hierarchy 링크 → parent 해석**: `parent` 필드가 없는 이슈에 `Hierarchy link (WBSGantt)` 링크가 `direction="inward"`("is contained in")로 있으면 그 상대를 `parent`로 채운다 — Sub-task를 MCP로 못 만들 때의 폴백 표현(`11`)이 대시보드에서 ↳ 상위로 보이게 하기 위함.
- **Epic Link → parent 해석**: 네이티브 `parent`도 위 Hierarchy 링크도 없으면 `config.epicLinkField` 커스텀필드 값(`epicLink`)을 마지막 폴백으로 `parent`에 채운다(summary는 `null`). Epic 자체는 `set_epic`(`11`)으로 상세에서 편집 가능하며, `epicLink`는 이 폴백 여부와 무관하게 항상 별도로 snapshot에 보존된다(`03`).

## UI 표현 (3가지, 단계적)
1. **카드 내 관계 칩** (필수): 카드/상세에 `relation 상대KEY` 칩. 클릭 → 해당 이슈 카드로 스크롤·하이라이트(스냅샷에 있으면). 스냅샷에 없는 이슈면 `jiraBaseUrl/browse/KEY`를 새 탭으로.
2. **상세 패널 관계 목록** (필수): 방향·관계문구별로 그룹핑(blocks / is blocked by / relates to ...).
3. **의존성 미니 그래프** (선택, 권장): 현재 필터된 이슈 집합으로 방향 그래프(SVG). 노드=이슈, 엣지=링크. 블로킹 체인을 시각화.

## 간트 의존성과의 관계
- 간트 화살표(`06`)는 `links` 중 `config.ganttDependencyLinkTypes`(기본 `Finish-to-Start link (WBSGantt)`·`Blocks`·`Relates`)만 사용. `Relates`는 대칭이라 회색 점선 화살표로 구분해 그린다(`06`).
- 그래프 미니뷰는 전체 링크 타입을 색으로 구분(Blocks=빨강 실선, WBSGantt FS=파랑, Relates=회색 점선 등).

## 사이클·고아 처리
- 사이클이 있어도 렌더가 멈추지 않게(방문 표시). 위상정렬은 best-effort, 실패 시 입력 순서.
- 상대 이슈가 현재 스냅샷 밖이면 칩에 "(외부)" 표시 + 외부 링크로만 연결.

## 연결 생성(쓰기) — 구현됨
- 상세 패널 "연결 추가": 방향 드롭다운(`snapshot.config.linkTypes` 재료, 타입별 outward/inward 문구를 자연문 옵션으로 제공; 대칭 타입인 Relates는 1개로 dedupe) + 상대 티켓 키 입력 + 미리보기 문장.
- 방향 매핑(중요): Jira 링크 레코드 `{inwardIssue: A, outwardIssue: B}`의 의미는 **"A {outward문구} B"** 다(예: A blocks B, A contains B — 2026-07-15 실측 검증: A의 GET에는 상대 B가 `outwardIssue`로 나타나 outward 문구가 붙는다). 따라서 옵션이 **outward**(예: "blocks")면 "현재티켓 blocks 대상" → `inward_issue=현재`, `outward_issue=대상`. **inward**(예: "is blocked by")면 반대. → `create_link` 명령 `{inward, type, outward}`(이슈 키)로 큐잉(`03`/`11`) → `jira_create_issue_link(inward, link_type=type, outward)`. ⚠️ 2026-07-15 이전 큐로 만든 방향성 링크는 반대로 걸렸을 수 있다(MCP에 링크 삭제 도구가 없어 잘못 건 링크는 Jira UI에서 수동 삭제).
- 키 형식 검증(`^[A-Z][A-Z0-9]+-\d+$`)·자기연결 금지는 프런트에서 막는다.
- `link_type`은 추측하지 않고 `jira_get_link_types` 실측값(`config.linkTypes`)에서 고른다(`02`).

## Definition of Done
- 모든 이슈의 연결관계가 카드/상세에 방향·관계문구와 함께 보인다.
- 관계 칩 클릭이 내부 이동 또는 외부 링크로 정확히 동작한다.
- 스냅샷 밖 이슈가 안전하게 처리된다(외부 표시).
