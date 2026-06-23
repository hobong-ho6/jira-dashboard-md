# 00 — Overview

## 목표
Jira 이슈를 라벨 중심으로 관리하고, Due date 기반 간트로 "오늘/이번주 집중할 일"을 보고,
이슈 간 연결관계와 Description 내 링크를 한 화면에서 다루며, 상태·Due date·코멘트를
대시보드에서 바꾸면 Claude Code가 Jira MCP로 반영하는 단일 작업대를 만든다.

## 비범위 (지금 만들지 않는다)
- 항상 떠 있는 데몬/트레이 앱/자동업데이트 시스템 (이전 프로토타입의 무거운 부분은 버린다).
- 브라우저에서 Jira 직접 호출, OAuth, 비밀번호/토큰 입력 UI.
- 멀티 유저 동시편집, 실시간 웹소켓.
- 이슈 *생성* 워크플로우(있으면 보너스지만 1차 범위 아님). 1차는 **읽기 + 상태/Due/코멘트 변경**.

## 용어
- **filter query (JQL)**: 대시보드의 **시작점**. 사용자가 입력한 JQL이 어떤 이슈를 불러올지 정한다. 이 쿼리가 들어와야 sync가 시작된다.
- **snapshot**: Claude Code가 Jira에서 읽어 정규화해 디스크에 쓴 데이터(`data/snapshot.json`). 대시보드의 유일한 읽기 소스.
- **command / 큐**: 대시보드에서 사용자가 만든 변경 의도(`data/commands.jsonl`). Claude Code가 드레인해 MCP로 실행.
- **mailbox 서버**: 정적 파일 제공 + 큐 파일 입출력만 하는 로컬 서버(`server/serve.py`). Jira를 절대 호출하지 않음.
- **bucket**: Due date 기준 분류(Overdue / Today / This week / Later / No due date).

## 요구사항 → 모듈 매핑
| 요구 | 내용 | 모듈 |
|------|------|------|
| A1 | 라벨로 그룹핑, 라벨별 티켓 관리 | `05-label-grouping.md` |
| A2 | Due date 간트, 오늘·이번주 강조 | `06-gantt-timeline.md` |
| A3 | Linked issue로 티켓 간 연결관계 확인 | `07-linked-issues.md` |
| B1 | Description 링크 파싱→라벨링→클릭 시 열기 | `08-description-links.md` |
| B2 | 간트를 라벨 그룹별 접기·펴기 | `06-gantt-timeline.md` |
| B3 | 간트 아래 라벨 그룹 카드, 접기·펴기 | `09-ticket-cards.md` |
| B4 | 티켓 선택 시 상세 + 코멘트 로드 | `10-ticket-detail-comments.md` |
| B5 | MCP로 코멘트/티켓 업데이트(특히 상태·Due date) | `11-mutations.md` |
| 공통 | 모든 동작을 Claude Code로 실행 | `13-operating-loop.md`, `CLAUDE.md` |

## 성공 기준 (전체)
1. **사용자가 필터링 쿼리(JQL)를 입력하면** 그 쿼리로 sync가 돌아 대상 이슈가 라벨 그룹·간트·카드에 나타난다. 쿼리 입력 전에는 대시보드가 "쿼리를 입력해 시작하세요" 상태다.
2. 간트에서 오늘 라인과 이번주 밴드가 보이고, 라벨 그룹을 접고 펼 수 있다.
3. 카드/상세에서 링크 칩을 누르면 새 탭으로 열리고, 연결 이슈 칩을 누르면 해당 카드로 이동한다.
4. 상세에서 상태/Due date 변경·코멘트 추가를 하면 큐에 쌓이고, `process` 후 Jira에 실제 반영되며 대시보드가 갱신된다.
5. 위 전 과정을 Opus 4.7 Claude Code 세션이 모듈 문서만 보고 재현할 수 있다.
