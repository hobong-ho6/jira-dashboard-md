# 10 — Ticket Detail & Comments (요구 B4)

목적: 티켓을 선택하면 상세가 열리고, 코멘트를 불러올 수 있다.

## 상세 패널 (drawer/사이드패널)
- 헤더: `KEY` 외부링크, summary, 상태 pill, 우선순위, 담당자.
- 필드: Due date(편집 가능, `11`), 라벨, 타입, 부모/에픽, created/updated.
- Description: `descriptionText`(있으면) + 링크 칩(`08`).
- 연결관계: 방향·관계문구별 목록 + 칩(`07`).
- 코멘트 영역(아래).
- 액션: 상태 변경, Due 변경, 코멘트 추가(모두 `11`로 큐잉).

## 코멘트 지연 로드
브라우저는 Jira를 직접 못 부르므로 **큐 경유**로 로드한다.
1. 상세 열릴 때 `commentsLoaded=false`면 `load_comments` 명령 enqueue(`03`).
2. "코멘트 불러오기" 버튼도 같은 명령을 보냄(수동 새로고침).
3. Claude Code(`process`)가 `jira_get_issue(issue_key, comment_limit=50)` →
   `fields.comment.comments[]`를 snapshot의 해당 이슈 `comments[]`로 채우고 `commentsLoaded=true`,
   이때 **코멘트 본문의 링크도 `08` 규칙으로 추출해 `commentLinks[]`에 채운다**(`apply_queue.py`) → snapshot 저장.
4. 브라우저 폴링이 갱신을 감지해 코멘트 + 코멘트 링크 칩 렌더. (로드 중엔 스피너/"불러오는 중")

> 작은 보드 최적화: sync에서 모든 이슈 코멘트를 미리 받고 싶으면 이슈별 `jira_get_issue(comment_limit=N)`. 비용 크므로 기본은 지연 로드.

## 코멘트 표시
- 각 코멘트: 작성자, 작성/수정 시각, 본문. 본문은 wiki markup → 표시용 변환(링크는 `08` 규칙 재사용 가능).
- 최신순/오래된순 토글.

## Definition of Done
- 카드 클릭으로 상세가 열리고 모든 핵심 필드가 보인다.
- 코멘트가 지연 로드로 채워지고 폴링으로 표시된다.
- 로딩/빈 상태/실패가 명확히 표시된다.
- 상세에서 상태·Due·코멘트 액션이 큐로 연결된다(`11`).
