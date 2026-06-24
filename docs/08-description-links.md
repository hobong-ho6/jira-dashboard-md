# 08 — Description Links (요구 B1)

목적: 이슈 Description 안의 링크들을 파싱하고, 각 링크를 종류별로 라벨링하며, 라벨(칩)을 누르면 링크가 열리게 한다.

## 파싱 (sync에서 `descriptionLinks[]` 생성)
입력: `fields.description` 원문 = **Jira wiki markup**(v2). 다음을 모두 추출한다.
1. wiki 링크: `[표시텍스트|http(s)://url]` → `{text:"표시텍스트", url}`
2. 표시텍스트 없는 wiki 링크: `[http(s)://url]` → `{text:url, url}`
3. 본문 중 맨 URL: `http(s)://...` (이미 1·2로 잡힌 건 제외)
4. (선택) smart link / 첨부 매크로는 best-effort. 못 잡으면 무시.
- 중복 url 제거. 순서 보존.

> 참고: wiki markup 파싱이 부담되면 sync 시 `jira_get_issue(expand="renderedFields")`로 HTML 렌더를 받아 `<a href>`를 추출해도 된다(정확하지만 이슈별 추가 호출 발생 → 작은 보드에서만).

## 라벨링 (종류 판정)
- `config.descriptionLinkRules`를 위에서부터 검사, url에 `match`의 문자열이 포함되면 그 `category`/`label` 적용. `"*"`는 폴백.
- 결과: `{ url, text, category, label }`. 같은 category는 같은 색(토큰 `12`).
- 규칙은 전부 `config.json`에 있으므로 새 도메인 추가 시 코드 수정 불필요(유지보수성).

## 코멘트 링크 (`commentLinks[]`)
- **같은 규칙(`descriptionLinkRules`)을 코멘트 본문에도 적용**해 링크를 추출·분류한다. 결과는 이슈의 별도 필드 `commentLinks[]`(스키마 `03`)에 담는다. 형식은 description 링크와 동일(`{url,text,category,label}`).
- **지연 처리:** 코멘트는 상세 진입 시에만 로드되므로(`10`), sync 시점엔 `commentLinks=[]`. 코멘트가 로드될 때 `apply_queue.py`가 `normalize.comment_links_from()`으로 채운다(파서·규칙은 description과 공유).
- **중복 제거:** description 링크에 이미 있는 url 은 `commentLinks`에서 뺀다(같은 링크 두 번 표시 방지).

## UI
- 카드·상세에 링크 칩 행: `[Design] [Code] [Docs] ...` 형태. 칩 라벨/색 = category.
- description 링크와 **코멘트 링크를 같은 칩 행에 함께** 표시한다. 코멘트 출처 칩은 앞에 `💬`를 붙이고 툴팁에 "코멘트 링크"를 표기해 구분한다.
- 칩 클릭 → `window.open(url, "_blank", "noopener")`. (새 탭, opener 차단)
- 칩 hover 시 표시텍스트·url 툴팁.
- 같은 종류가 여럿이면 `Design ×2`처럼 묶거나 개별 칩 + 텍스트 병기(설정). 기본: 개별 칩, 라벨 옆에 짧은 text.

## 보안
- url은 표시·열기 용도로만. 자동 fetch/프리뷰 금지(서버 호출 유발 방지, 신뢰 경계 `01`).
- `javascript:` 등 비http 스킴은 칩으로 만들지 않는다(http/https만 허용).

## Definition of Done
- 다양한 wiki 링크 형식과 맨 URL이 모두 칩으로 나온다.
- 칩 종류·색이 `config` 규칙대로 결정된다.
- 칩 클릭 시 새 탭으로 안전하게 열린다.
- 새 도메인 매핑이 코드 수정 없이 `config.json`만으로 추가된다.
