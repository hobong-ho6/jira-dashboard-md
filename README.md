# Jira MCP Dashboard

로컬 PC에서 구동하고 **웹브라우저로 보는** Jira 이슈 운영 대시보드입니다.
이 저장소에는 (1) 실제 동작하는 코드와 (2) 다른 Claude Code 세션(Opus 4.7)이 보고 유지·확장할 **모듈식 규칙 문서(`docs/`)** 가 함께 있습니다.

## 바로 실행 (데모 데이터로 화면 확인)
```bash
cd jira-dashboard
python3 server/serve.py          # 기본 포트 5173
# 브라우저에서 http://localhost:5173 접속
```
`data/snapshot.json`에 데모 8개 이슈가 들어 있어 **접속 즉시** 라벨 그룹·간트·카드·상세·코멘트가 보입니다.
상세 패널에서 상태/마감일 변경·코멘트 추가를 누르면 `data/commands.jsonl` 큐에 쌓입니다(아래 실데이터 흐름에서 반영).

## 실제 Jira 데이터로 쓰기 (Claude Code가 MCP로)
브라우저/서버는 Jira에 직접 접근하지 않습니다. 읽기·쓰기는 **Claude Code 세션이 MCP로** 합니다.
**대시보드의 시작점은 필터링 쿼리(JQL)입니다.**
1. **쿼리 입력(시작)**: 대시보드 상단 JQL 입력창에 쿼리를 넣고 "조회 시작"(→ `sync` 명령 큐 적재), 또는 Claude Code에게 직접 "이 JQL로 시작: …"이라고 말합니다.
2. **sync(읽기)**: Claude Code가 그 JQL을 `config.json.jql`에 저장하고 `jira_search` 결과를 `data/raw_issues.json`로 저장 → `python3 tools/normalize.py` → `data/snapshot.json` 생성. (`docs/04`)
3. **serve**: `python3 server/serve.py` 실행, 브라우저로 확인.
4. **조작**: 대시보드에서 상태/마감일/코멘트 변경 → `data/commands.jsonl`에 적재.
5. **process(쓰기)**: Claude Code가 큐를 읽어 `jira_transition_issue`/`jira_update_issue`/`jira_add_comment` 실행 후 해당 이슈 재동기화. (`docs/11`)

## 코드 구조
```
server/serve.py     로컬 서버(정적 + 명령 큐 메일박스). Jira 호출 안 함
tools/normalize.py  원시 Jira JSON -> snapshot.json (sync의 결정적 변환부)
web/                index.html, styles.css, js/*.js (무빌드 ES 모듈)
data/               config.json, snapshot.json(데모), commands.jsonl(런타임)
docs/               모듈식 규칙 문서 (설계 권위)
```

---

## 규칙 문서 세트 (docs/)
다른 Claude Code 세션이 이 문서만 보고 구현·운영·확장할 수 있도록 만든 단일 권위입니다.

## 핵심 구조 한눈에
- **Claude Code = 유일한 Jira MCP 호출자**(읽기·쓰기 전부).
- **mailbox 서버 = 정적 파일 + 명령 큐 중계만**(Jira 호출 안 함).
- **브라우저 = 보기 + 변경 의도 입력**.
- 연결은 두 파일뿐: `data/snapshot.json`(읽기), `data/commands.jsonl`(쓰기).

## 읽는 순서
1. `CLAUDE.md` — 진입점·황금규칙·명령 매핑
2. `docs/00-overview.md`, `docs/01-architecture.md` — 그림과 신뢰 경계
3. 작업할 기능의 모듈만 골라 읽기 (`docs/05`~`docs/13`)
4. `docs/14-conventions.md` — 작업 규칙·인수 체크리스트

## 다른 Claude Code 세션에 줄 한 줄 프롬프트(예)
> "이 저장소의 `CLAUDE.md`와 `docs/`를 읽고, 먼저 `config.json`을 세팅한 뒤 `docs/04`로 sync를 구현해 `data/snapshot.json`을 만들어줘. 그다음 `docs/12`로 대시보드 기본 렌더를 만들어줘. 모든 Jira 접근은 MCP로만, 신뢰 경계(`docs/01`)를 지켜."

## 구현 순서 권장 (마일스톤)
1. config + sync(`04`) → snapshot 생성 확인
2. 서버(`13`) + 기본 렌더(`12`): 라벨 그룹 + 카드(`05`,`09`)
3. 간트(`06`) + bucket 강조
4. Description 링크(`08`), 연결관계(`07`)
5. 상세 + 코멘트 지연 로드(`10`)
6. mutations 큐 처리(`11`): 상태·Due·코멘트
7. 폴링·접힘 상태·필터 마무리(`12`), 인수 체크리스트(`14`)

## 환경 사실(실측)
- Jira **Server/DC**, REST **v2**, base `https://jira.workers-hub.com`
- WBS Gantt-Chart 플러그인 링크 타입 존재 → 간트 의존성에 활용(`docs/02`,`06`)
- 설명/코멘트 입력은 기본 wiki markup(필요 시 markdown 플래그)
