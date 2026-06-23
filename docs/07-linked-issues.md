# 07 — Linked Issues (요구 A3)

목적: 이슈 간 연결관계를 보여준다. 데이터는 sync 때 `issuelinks`에서 이미 가져온다(추가 호출 없음).

## 정규화 (sync에서)
각 `fields.issuelinks[]` 항목 → `links[]`:
- `type` = `type.name` (예: "Blocks")
- `outwardIssue`가 있으면 `direction="outward"`, `relation=type.outward`, 상대 = `outwardIssue`
- `inwardIssue`가 있으면 `direction="inward"`, `relation=type.inward`, 상대 = `inwardIssue`
- `key/summary/status` = 상대 이슈의 `key`, `fields.summary`, `fields.status.name`

## UI 표현 (3가지, 단계적)
1. **카드 내 관계 칩** (필수): 카드/상세에 `relation 상대KEY` 칩. 클릭 → 해당 이슈 카드로 스크롤·하이라이트(스냅샷에 있으면). 스냅샷에 없는 이슈면 `jiraBaseUrl/browse/KEY`를 새 탭으로.
2. **상세 패널 관계 목록** (필수): 방향·관계문구별로 그룹핑(blocks / is blocked by / relates to ...).
3. **의존성 미니 그래프** (선택, 권장): 현재 필터된 이슈 집합으로 방향 그래프(SVG). 노드=이슈, 엣지=링크. 블로킹 체인을 시각화.

## 간트 의존성과의 관계
- 간트 화살표(`06`)는 `links` 중 `config.ganttDependencyLinkTypes`만 사용.
- 그래프 미니뷰는 전체 링크 타입을 색으로 구분(Blocks=빨강 실선, WBSGantt FS=파랑, Relates=회색 점선 등).

## 사이클·고아 처리
- 사이클이 있어도 렌더가 멈추지 않게(방문 표시). 위상정렬은 best-effort, 실패 시 입력 순서.
- 상대 이슈가 현재 스냅샷 밖이면 칩에 "(외부)" 표시 + 외부 링크로만 연결.

## 연결 생성(쓰기, 선택)
- 상세에서 "연결 추가" → `create_link` 명령(`03`/`11`) → `jira_create_issue_link(inward, link_type, outward)`.
- `link_type`은 `02`의 실측 name 목록에서 선택(드롭다운으로 고정 제공).

## Definition of Done
- 모든 이슈의 연결관계가 카드/상세에 방향·관계문구와 함께 보인다.
- 관계 칩 클릭이 내부 이동 또는 외부 링크로 정확히 동작한다.
- 스냅샷 밖 이슈가 안전하게 처리된다(외부 표시).
