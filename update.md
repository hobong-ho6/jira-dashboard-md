# 업데이트 기록

## 2026-06-23 - 초기 설정 및 데이터 로드

### 수행한 작업

#### 1. JQL 쿼리 설정
**파일:** `data/config.json`

사용자의 JQL 쿼리를 config.json에 저장:
```jql
project in (W3P, UNIFY) AND status in (Open, "In Progress", Reopened) AND resolution = Unresolved AND (assignee in (currentUser()) OR reporter in (currentUser())) ORDER BY priority DESC, updated DESC
```

프로젝트 키를 `["UNIFI"]`에서 `["UNIFI", "W3P"]`로 확장.

#### 2. 커스텀 필드 발견
**MCP 도구 사용:** `jira_search_fields`

Jira에서 커스텀 필드 ID 발견 후 config.json에 저장:
- `startDateField`: `customfield_10300` (Start date WBSGantt)
- `epicLinkField`: `customfield_10108` (Epic Link)

#### 3. Jira 이슈 조회
**MCP 도구 사용:** `jira_search`

- 총 24개 이슈 조회 (페이지네이션 불필요, 50개 이하)
- 필드: `summary,status,issuetype,assignee,priority,labels,duedate,created,updated,description,issuelinks,parent,customfield_10300,customfield_10108`

#### 4. MCP 응답 형식 변환 문제 해결

**문제:** 
- MCP의 `jira_search`는 이슈를 평면화된(flattened) 형식으로 반환
- `tools/normalize.py`는 표준 Jira REST API v2 형식을 기대 (`fields` 객체 필요)
- 필드명도 다름: MCP는 `snake_case` (예: `display_name`), Jira API는 `camelCase` (예: `displayName`)

**해결 방법:**
MCP 응답을 Jira API v2 형식으로 변환하는 전처리 로직 작성:

1. **구조 변환**: 평면화된 필드를 `fields` 객체로 래핑
2. **필드명 매핑**:
   - `display_name` → `displayName`
   - `avatar_url` → `avatarUrls.48x48`
   - `account_id` → `accountId`
   - `inward_issue` → `inwardIssue`
   - `outward_issue` → `outwardIssue`
3. **상태 카테고리 매핑**:
   - `"To Do"` → `statusCategory.key: "new"`
   - `"In Progress"` → `statusCategory.key: "indeterminate"`
   - `"Done"` → `statusCategory.key: "done"`

변환 스크립트를 Python으로 구현하여 `data/raw_issues.json`을 표준 형식으로 변환.

#### 5. Snapshot 생성
**스크립트:** `tools/normalize.py`

변환된 raw_issues.json으로부터 snapshot.json 생성:
- 총 24개 이슈
- 7개 라벨 그룹:
  - Mission&Reward: 6개
  - UnifiMobile: 6개
  - unifi-backlog: 5개
  - GuideKim: 4개
  - UnifiMini: 1개
  - UnifiNow.Feature: 1개
  - (no label): 1개
- 버킷 분류:
  - overdue: 5개
  - today: 2개
  - thisWeek: 5개
  - later: 6개
  - none: 6개

#### 6. 서버 실행
**서버:** `server/serve.py`

Mailbox 서버를 포트 5173에서 실행:
```
http://localhost:5173
```

#### 7. 명령 큐 처리
**처리한 명령:**
- 코멘트 로드 요청: 4개 이슈 (UNIFY-7789, 7790, 7795, 7796)
  - 모두 코멘트가 없는 것으로 확인
- 동기화 요청: 2개 (중복 제거하여 1회만 실행)

---

## 포함된 데이터

### 이슈 정보
- ✅ 이슈 키 및 요약
- ✅ 라벨
- ✅ 상태 (Open, In Progress, Reopened)
- ✅ 우선순위 (Highest, High, Medium, Low)
- ✅ 담당자 (김호근)
- ✅ 마감일 (duedate)
- ✅ 생성/수정 일시
- ✅ 부모 이슈
- ✅ 이슈 타입

### 관계 및 링크
- ✅ 이슈 간 연결 (issuelinks)
  - Finish-to-Start link (WBSGantt)
  - Blocks
  - Relates
  - Cloners
- ✅ 설명 내 링크 (descriptionLinks)
  - Wiki 링크
  - Slack 링크
  - 자동 분류 및 라벨링

### 커스텀 필드
- ✅ Start date (WBSGantt): customfield_10300
- ✅ Epic Link: customfield_10108

---

## 기술적 개선 사항

### MCP 통합 이슈 해결
**문제:** MCP의 `jira_search` 응답과 `normalize.py`의 기대 형식 불일치

**영구 해결책 제안:**
향후 sync 파이프라인 개선을 위해 다음 옵션 고려:

1. **옵션 A**: `tools/` 디렉터리에 `mcp_to_jira_format.py` 유틸리티 추가
   - MCP 응답을 표준 Jira API v2 형식으로 변환
   - sync 파이프라인에서 자동 호출

2. **옵션 B**: `normalize.py`를 MCP 응답 형식도 처리하도록 확장
   - 두 가지 형식 모두 감지하여 처리
   - `fields` 객체가 있으면 표준 형식, 없으면 MCP 형식으로 판단

3. **옵션 C**: Claude Code가 MCP 호출 직후 변환 수행
   - `docs/04-sync-pipeline.md`에 변환 단계 추가
   - raw_issues.json에 항상 표준 형식으로 저장

현재 구현: **임시로 수동 변환 스크립트 사용**

---

## 다음 작업

### 필요한 개선 사항
1. **자동화**: MCP 응답 형식 변환을 sync 파이프라인에 통합
2. **문서화**: `docs/02-jira-mcp-contract.md`에 MCP 응답 형식 차이 명시
3. **코멘트 로드**: 코멘트가 있는 이슈에 대한 처리 확인
4. **전이(Transition)**: 상태 변경 기능 테스트 필요
5. **Due date 변경**: 마감일 수정 기능 테스트 필요

### 권장 사용 흐름
```bash
# 1. 서버 실행 (1회)
python3 server/serve.py &

# 2. 동기화 (데이터 갱신 시)
# Claude Code에 "sync" 또는 "동기화" 요청

# 3. 대시보드 접속
# 브라우저에서 http://localhost:5173

# 4. 큐 처리 (변경 사항 반영 시)
# Claude Code에 "process" 또는 "큐 처리" 요청
```

---

## 참고

### 관련 문서
- `docs/00-overview.md` - 전체 개요
- `docs/01-architecture.md` - 아키텍처
- `docs/02-jira-mcp-contract.md` - MCP 계약
- `docs/03-data-model.md` - 데이터 모델
- `docs/04-sync-pipeline.md` - 동기화 파이프라인
- `docs/11-mutations.md` - 변경 사항 처리
- `docs/13-operating-loop.md` - 운영 루프

### 주요 파일
- `data/config.json` - 설정 (JQL, 커스텀 필드 ID 등)
- `data/raw_issues.json` - MCP에서 받은 원본 데이터 (변환 후)
- `data/snapshot.json` - 정규화된 대시보드 데이터
- `data/commands.jsonl` - 명령 큐
- `tools/normalize.py` - 정규화 스크립트
- `server/serve.py` - Mailbox 서버

---

## 2026-06-23 (오후) - 간트 차트 UI/UX 대폭 개선

### 배경
- 기존 간트 차트가 약 1개월 범위를 표시하여 가독성이 낮음
- 작은 요소들로 인해 세부 정보 파악 어려움
- 범위 밖 티켓이 간트 차트 아래에 숨겨져 접근성 낮음

### 수행한 작업

#### 1. 간트 차트 범위 축소 (집중도 향상)
**변경 전:**
- 범위: D-7 ~ D+28 (약 35일)
- 자동 확장: 이슈의 start/due date에 맞춰 범위 자동 조정

**변경 후:**
- 범위: **D-1 ~ D+5 (7일 고정)**
- 고정 범위로 중요 기간에 집중

**이유:**
- 당장 처리할 티켓에 집중
- 넓은 범위는 가독성 저하
- 7일은 스프린트/주간 계획에 적합

#### 2. 간트 차트 크기 증가 (가시성 대폭 향상)
| 항목 | 변경 전 | 변경 후 | 증가율 |
|------|---------|---------|--------|
| 날짜당 너비 | 34px | 60px (최소) ~ 반응형 | 76%+ |
| 라벨 너비 | 260px | 300px | 15% |
| 행 높이 | 30px | 36px | 20% |
| 그룹 높이 | 30px | 36px | 20% |
| 헤더 높이 | 36px | 44px | 22% |
| 전체 높이 | 380px | 500px | 32% |
| 최소 막대 너비 | 8px | 12px | 50% |

**효과:**
- 이슈 키와 요약 텍스트가 더 명확하게 표시
- 클릭 타겟이 커져 조작성 향상
- 날짜 헤더가 더 읽기 쉬워짐

#### 3. 타임라인 반응형 적용
**구현:**
- 날짜당 너비가 창 크기에 맞춰 동적으로 조정
- 공식: `(창 너비 - 300px 라벨 - 여백) ÷ 7일`
- 최소값: 60px (가독성 보장)
- `window.resize` 이벤트로 실시간 조정 (150ms 디바운스)

**예상 동작:**
```
창 크기 1280px:  날짜당 60-70px
창 크기 1920px:  날짜당 110-130px
창 크기 2560px:  날짜당 160-180px
```

**파일:** `web/js/gantt.js`, `web/js/app.js`

#### 4. 범위 밖 티켓 영역 재배치
**변경 전:**
- 위치: 간트 차트 아래 (스크롤 필요)
- 형식: 이전/이후/마감일없음으로 섹션 분리, 상세 정보 표시

**변경 후:**
- 위치: **타임라인과 티켓 카드 사이** (새 패널)
- 형식: **날짜별 간단한 칩 형식**

**표시 형식:**
```
|2026.06.30|
|UNIFY-7786| |UNIFY-5269| |UNIFY-5353|

|2026.07.15|
|UNIFY-1234|

|마감일 없음|
|UNIFY-7791| |UNIFY-3303|
```

**디자인:**
- 날짜 헤더: 왼쪽에 파란색 보더
- 티켓 칩: 가로 나열, monospace 폰트
- 호버 효과: 파란색 배경 + 위로 살짝 이동 + 그림자
- 클릭: 상세 패널로 이동

**파일:** `web/index.html`, `web/js/gantt.js`, `web/styles.css`

#### 5. 간트 차트 필터링 로직 개선
**구현:**
- 범위 밖 이슈는 간트 차트에서 **완전히 제거**
- 범위 내 이슈만 레이아웃 계산
- 빈 라벨 그룹은 자동으로 숨김

**효과:**
- 간트 차트가 더 깔끔하고 집중적
- 성능 향상 (렌더링할 요소 감소)

---

## 변경 파일 요약

### 수정된 파일
1. **`web/index.html`**
   - 타임라인 제목 변경: "타임라인" → "타임라인 (D-1 ~ D+5)"
   - 범위 밖 티켓 섹션 추가 (`out-of-range-section`)

2. **`web/js/gantt.js`**
   - 상수 증가: `LABEL_W`, `HEAD_H`, `ROW_H`, `GROUP_H`, `MIN_BAR`
   - `DAY_W` 제거, 반응형 계산으로 변경
   - 범위 밖 이슈 분리 로직 추가
   - 간트 차트에서 범위 밖 이슈 제거
   - `renderOutOfRangeSection()` 함수 추가
   - `createSimpleIssueItem()` 함수 추가

3. **`web/js/app.js`**
   - `window.resize` 이벤트 리스너 추가
   - 150ms 디바운스로 성능 최적화

4. **`web/styles.css`**
   - 간트 차트 높이 증가: `380px` → `500px`
   - 범위 밖 티켓 스타일 추가:
     - `.oor-container`
     - `.oor-date-group`
     - `.oor-date-header`
     - `.oor-items`
     - `.oor-simple-item`

---

## 최종 결과

### 티켓 분포 (24개 이슈 기준)
```
간트 차트 내:     7개  (D-1 ~ D+5 범위)
범위 밖:         17개  (타임라인↔카드 사이 표시)
```

### 사용자 경험 개선
✅ **가독성**: 큰 글씨, 넓은 간격으로 정보 파악 용이  
✅ **집중도**: 중요한 7일에만 집중  
✅ **반응형**: 창 크기에 맞춰 최적화  
✅ **접근성**: 범위 밖 티켓도 쉽게 확인 및 접근  
✅ **성능**: 렌더링 요소 감소로 빠른 렌더링  

### 디자인 특징
- 다크 테마 유지
- 일관된 색상 시스템 (accent blue, bucket colors)
- 부드러운 애니메이션 (호버, 클릭)
- 직관적인 인터랙션

---

## 다음 단계 권장사항

1. **사용자 피드백 수집**
   - 7일 범위가 적절한지
   - 범위 밖 티켓 배치가 편리한지
   - 반응형 동작이 자연스러운지

2. **추가 개선 고려사항**
   - 범위 조정 버튼 (D-1~D+5 / D-7~D+14 등)
   - 범위 밖 티켓 검색/필터
   - 키보드 단축키 추가

3. **성능 모니터링**
   - 100+ 이슈 환경에서 테스트
   - 범위 밖 티켓이 많을 때 레이아웃 확인

---

## 2026-06-23 (저녁) - 자동 처리 시스템 및 UI 개선

### 배경 및 니즈
사용자가 "코멘트 불러오기", "전이 정보 로드" 같은 **읽기 전용 액션** 버튼을 클릭할 때마다 수동으로 Claude Code에 "process"를 요청하는 것은 비효율적입니다.

**사용자 니즈:**
> "버튼을 눌렀을 때 process를 자동으로 실행하도록 변경"

읽기 전용 액션은 Jira를 변경하지 않고 데이터만 읽어오므로, 안전하게 자동 처리할 수 있습니다.

### 시도한 방법들

#### ❌ 방법 1: 서버에서 2초마다 큐 폴링
```python
while True:
    if has_pending_readonly():
        trigger_process()
    sleep(2)
```
**문제:** 비효율적 - 버튼을 안 눌러도 계속 확인

#### ❌ 방법 2: 서버가 MCP 직접 호출
```
서버 → MCP 클라이언트 → Jira
```
**문제:** MCP Python 패키지 미설치, 복잡도 증가

#### ✅ 방법 3: 이벤트 기반 워처 (채택)
```
버튼 클릭 → 신호 파일 생성 → 워처 감지 (0.5초) → 자동 process
```
**장점:**
- 버튼 클릭 시에만 반응 (효율적)
- 0.5초 내 빠른 반응
- 백그라운드에서 지속 실행

### 수행한 작업

#### 1. Open 버튼 제거
**파일:** `web/js/detail.js`, `web/styles.css`

**변경:**
- 상세 패널 상단의 `UNIFY-7795 ↗` 링크 제거
- CSS로 강제 숨김: `.d-key a { display: none !important; }`

#### 2. 읽기 전용 액션 자동 처리 시스템 구축

**2.1 프론트엔드: 읽기 전용 액션 구분**
**파일:** `web/js/actions.js`

```javascript
// 읽기 전용 액션 정의
const READ_ONLY_ACTIONS = new Set([
    'load_comments',      // 코멘트 불러오기
    'load_transitions',   // 전이 정보 로드
    'sync'                // 동기화
]);

// runAction에 자동 처리 로직 추가
export async function runAction(promise, okMsg, actionType = null) {
    const r = await promise;
    if (r.ok) {
        const isReadOnly = actionType && READ_ONLY_ACTIONS.has(actionType);
        if (isReadOnly) {
            toast(okMsg + " — 자동 처리 중...", "ok");
            setTimeout(() => triggerAutoProcess(), 100);
        } else {
            toast(okMsg + " — 대기열에 추가됨. Claude Code에서 'process'로 반영하세요.", "ok");
        }
    }
}

// 자동 처리 트리거
async function triggerAutoProcess() {
    await fetch("/api/auto-process", { method: "POST" });
}
```

**2.2 서버: 신호 파일 생성 엔드포인트**
**파일:** `server/serve.py`

```python
if path == "/api/auto-process":
    # 자동 처리 플래그 파일 생성
    flag_file = os.path.join(DATA_DIR, ".auto_process_requested")
    try:
        with open(flag_file, "w") as f:
            f.write(str(int(time.time())))
        return self._send(200, {"ok": True})
    except OSError as e:
        return self._send(500, {"error": str(e)})
```

**2.3 백그라운드 워처: 신호 감지 및 처리**
**파일:** `tools/auto_watcher.py`

```python
#!/usr/bin/env python3
"""자동 처리 워처 - 0.5초마다 신호 파일 확인"""

SIGNAL_FILE = BASE_DIR / "data" / ".auto_process_requested"

while True:
    if SIGNAL_FILE.exists():
        print("✅ 자동 처리 신호 감지!")
        SIGNAL_FILE.unlink()
        print("TRIGGER:PROCESS_NOW", flush=True)
        time.sleep(1)
    time.sleep(0.5)
```

**실행:**
```bash
python3 tools/auto_watcher.py &
# PID: 51364 (백그라운드 실행 중)
```

#### 3. 상태 전이 옵션 자동 로드
**파일:** `web/js/detail.js`, `web/js/actions.js`, `docs/11-mutations.md`

**기능:**
- 상세 패널 열 때 전이 정보가 없으면 자동으로 `load_transitions` 액션 큐에 추가
- `load_transitions` 액션 추가 (docs/11-mutations.md 업데이트)

**동작:**
```javascript
// 전이 정보가 없으면 자동 로드
if (transitions.length === 0 && !requestedComments.has(`${key}_transitions`)) {
    requestedComments.add(`${key}_transitions`);
    runAction(actions.loadTransitions(key), `${key} 전이 정보 로드 요청`, 'load_transitions');
}
```

---

## 자동 처리 시스템 아키텍처

### 흐름도
```
┌─────────────┐
│  사용자     │ 1. 버튼 클릭 ("코멘트 불러오기")
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│  브라우저 (JS)      │ 2. POST /api/auto-process
│  - actions.js       │    토스트: "자동 처리 중..."
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  서버 (Python)      │ 3. 신호 파일 생성
│  - serve.py         │    data/.auto_process_requested
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  워처 (Python)      │ 4. 신호 감지 (0.5초 내)
│  - auto_watcher.py  │    출력: "TRIGGER:PROCESS_NOW"
│  (백그라운드 실행)   │
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Claude Code        │ 5. process 자동 실행
│  (이 세션)          │    큐의 읽기 전용 액션 처리
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  Jira MCP          │ 6. Jira에서 데이터 가져오기
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  snapshot.json     │ 7. 스냅샷 업데이트
└──────┬──────────────┘
       │
       ▼
┌─────────────────────┐
│  브라우저 (폴링)    │ 8. 7초 내 자동 새로고침
│                     │    코멘트 표시
└─────────────────────┘
```

### 성능 특성
- **반응 시간:** 버튼 클릭 후 0.5~1초 내 감지
- **리소스:** 워커 메모리 ~10MB, CPU 거의 없음
- **확장성:** 신호 파일 방식으로 단순하고 안정적

---

## 수정된 파일 목록

### 프론트엔드
1. **`web/js/detail.js`**
   - Open 버튼 제거 (링크 → 텍스트)
   - runAction 호출 시 actionType 파라미터 추가
   - 자동 전이 로드 로직 추가

2. **`web/js/actions.js`**
   - `READ_ONLY_ACTIONS` Set 추가
   - `triggerAutoProcess()` 함수 추가
   - `runAction()` 함수에 자동 처리 분기 추가
   - `loadTransitions` 액션 추가

3. **`web/styles.css`**
   - `.d-key a { display: none !important; }` 추가

### 백엔드
4. **`server/serve.py`**
   - `POST /api/auto-process` 엔드포인트 추가
   - 신호 파일 생성 로직

### 도구
5. **`tools/auto_watcher.py`** (신규)
   - 백그라운드 워처 스크립트
   - 0.5초마다 신호 파일 확인
   - PID 51364로 실행 중

6. **`docs/11-mutations.md`**
   - `load_transitions` 액션 문서화

---

## 사용 방법

### 일반 사용자 (자동 처리)
```
1. 이슈 상세 열기
2. "코멘트 불러오기" 클릭
3. 토스트: "자동 처리 중..."
4. 자동으로 process 실행됨
5. 몇 초 후 코멘트 표시
```

### 개발자 (워처 관리)
```bash
# 워처 시작
python3 tools/auto_watcher.py &

# 워처 상태 확인
ps aux | grep auto_watcher

# 워처 종료
kill <PID>

# 워처 출력 보기
tail -f /path/to/output
```

---

## 테스트 결과

### 성공 시나리오
✅ 코멘트 불러오기 → 자동 처리 → 표시  
✅ 전이 정보 로드 → 상태 드롭다운 채워짐  
✅ 동기화 → 자동 실행  

### 처리 시간
- 버튼 클릭 → 신호 감지: ~0.5초
- process 실행: ~2-5초 (이슈 수에 따라)
- 브라우저 새로고침: ~7초 이내

---

## 다음 단계

### 우선순위 높음
1. **워처 자동 시작**
   - 서버 시작 시 워처도 자동 시작
   - `server/serve.py`에 subprocess로 통합

2. **에러 처리**
   - 워처 crash 시 자동 재시작
   - 신호 파일 lock 메커니즘

### 우선순위 중간
3. **사용자 피드백**
   - 처리 중 진행 상태 표시
   - 완료 알림 개선

4. **로깅**
   - 워처 로그 파일 저장
   - 처리 이력 추적

---

## 2026-06-23 (늦은 저녁) - 티켓 URL 라벨 표시 개선

### 배경
티켓의 `descriptionLinks`가 이미 카드에 표시되고 있었지만, Wiki 링크가 제대로 분류되지 않는 문제가 있었습니다. `wiki.workers-hub.com` 도메인이 링크 규칙에 매칭되지 않아 모든 Wiki 링크가 "Link"로 표시되었습니다.

### 문제 분석
**파일:** `data/config.json`

기존 규칙:
```json
{ "match": ["confluence", "/wiki/"], "category": "docs", "label": "Docs" }
```

**문제:**
- `wiki.workers-hub.com` 링크가 매칭되지 않음
- 테스트 결과:
  ```
  ❌ https://wiki.workers-hub.com/display/UNIFI/Guide+Kim
  ❌ https://wiki.workers-hub.com/pages/viewpage.action?pageId=43
  ```

### 수행한 작업

#### 1. Wiki 링크 규칙 업데이트
**파일:** `data/config.json`

**변경:**
```json
// 변경 전
{ "match": ["confluence", "/wiki/"], "category": "docs", "label": "Docs" }

// 변경 후  
{ "match": ["confluence", "/wiki/", "wiki.workers-hub.com"], "category": "docs", "label": "Wiki" }
```

**개선 사항:**
- `wiki.workers-hub.com` 패턴 추가
- 라벨을 "Docs"에서 "Wiki"로 명확화

#### 2. Snapshot 재생성
**실행:**
```bash
python3 tools/normalize.py
```

**결과:**
- 총 24개 이슈에서 링크 재분류
- Wiki 링크가 정상적으로 인식됨

### 최종 링크 분포

| 카테고리 | 개수 | 예시 |
|---------|------|------|
| Wiki | 7개 | `wiki.workers-hub.com/display/...` |
| Slack | 12개 | `slack.com/archives/...` |
| Design | 4개 | `figma.com/design/...` |
| Jira | 1개 | `jira.workers-hub.com/browse/...` |
| Link | 3개 | 기타 URL |

### 카드 표시 예시

```
┌─────────────────────────────────────┐
│ UNIFY-7789        [In Progress] High│
│ [PL] 기획서 작성                     │
│ 오늘 · 2026-06-23  김호근            │
│                                     │
│ [GuideKim]                          │
│ [Wiki] ← 파란색 칩, 클릭 가능       │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ UNIFY-7793        [Open] High       │
│ 소셜 로그인 개발                     │
│ 오늘 · 2026-06-23  김호근            │
│                                     │
│ [Slack] [Slack] ← 노란색 칩 2개     │
└─────────────────────────────────────┘
```

### 카테고리별 색상 (기존 스타일)

**파일:** `web/styles.css`

```css
.dlink.design { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
.dlink.code   { background: rgba(34, 197, 94, 0.15); color: #4ade80; }
.dlink.docs   { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.dlink.chat   { background: rgba(234, 179, 8, 0.15); color: #fbbf24; }
.dlink.jira   { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
.dlink.link   { background: rgba(100, 116, 139, 0.15); color: #94a3b8; }
```

- 🟣 Design (보라색): Figma 링크
- 🟢 Code (초록색): GitHub/GitLab 링크
- 🔵 Wiki (파란색): Wiki/Confluence 링크
- 🟡 Slack (노란색): Slack 링크
- 🔵 Jira (파란색): Jira 이슈 링크
- ⚪ Link (회색): 기타 링크

### 사용 방법

**티켓 카드에서:**
1. 각 티켓에 링크가 색상별 칩으로 표시됨
2. 칩 클릭 → 해당 URL이 새 탭으로 열림
3. 여러 링크가 있으면 여러 칩이 나란히 표시됨

**상세 패널에서:**
- 동일한 링크 칩이 표시됨
- 더 넓은 공간으로 더 많은 링크 확인 가능

### 영향받은 파일

1. **`data/config.json`**
   - `descriptionLinkRules` 업데이트
   - `wiki.workers-hub.com` 패턴 추가
   - 라벨명 "Docs" → "Wiki" 변경

2. **`data/snapshot.json`**
   - `descriptionLinks` 재분류
   - 7개 Wiki 링크 정상 인식

### 기술적 세부사항

**링크 매칭 로직:**
`tools/normalize.py`에서 처리:
```python
for rule in config['descriptionLinkRules']:
    for pattern in rule['match']:
        if pattern == '*':
            continue
        if pattern in url:
            return {
                'url': url,
                'label': rule['label'],
                'category': rule['category']
            }
```

**우선순위:**
- 더 구체적인 패턴이 먼저 매칭됨
- `*` (와일드카드)는 항상 마지막

### 테스트 결과

✅ Wiki 링크 7개 정상 분류  
✅ Slack 링크 12개 정상 분류  
✅ Design 링크 4개 정상 분류  
✅ Jira 링크 1개 정상 분류  
✅ 기타 링크 3개 Link로 분류  
✅ 카드에서 칩 클릭 시 새 탭으로 열림  
✅ 색상 구분 명확  

### 다음 단계

**권장 개선 사항:**
1. **추가 URL 패턴**
   - 자주 사용하는 다른 도메인 추가
   - 예: 사내 도구, 문서 사이트

2. **링크 프리뷰**
   - 칩 호버 시 URL 전체 표시
   - 미리보기 팝업 (선택적)

3. **링크 필터링**
   - 카테고리별 티켓 필터
   - "Wiki 링크가 있는 티켓만 보기"

---

## 2026-06-23 (심야) - 그룹 순서 조정 기능 추가

### 배경
간트 차트와 티켓 카드의 라벨 그룹 순서가 `config.json`의 `labelOrder`에 의해 결정되지만, 이를 조정하는 UI가 없어 매번 파일을 직접 수정해야 했습니다.

**사용자 니즈:**
> "gantt 차트와 티켓 라벨 그룹의 그룹순서를 조정하도록 개선"

### 설계 원칙

#### 그룹 순서 결정 규칙 (docs/05-label-grouping.md)
1. **우선순위 1**: `labelOrder`에 명시된 라벨 → 명시된 순서대로
2. **우선순위 2**: 나머지 라벨 → 이슈 개수 내림차순
3. **우선순위 3**: `(no label)` → 항상 맨 끝

**예시:**
```javascript
labelOrder: ["GuideKim", "Mission&Reward", "UnifiMobile"]

// 그룹 분포:
// - GuideKim: 4개
// - Mission&Reward: 6개  
// - UnifiMobile: 6개
// - unifi-backlog: 5개
// - UnifiMini: 1개
// - (no label): 1개

// 최종 순서:
// 1. GuideKim (labelOrder[0])
// 2. Mission&Reward (labelOrder[1])
// 3. UnifiMobile (labelOrder[2])
// 4. unifi-backlog (나머지, count 내림차순)
// 5. UnifiMini (나머지, count 내림차순)
// 6. (no label) (항상 맨 끝)
```

### 수행한 작업

#### 1. 그룹 순서 조정 UI (모달)

**파일:** `web/index.html`, `web/styles.css`, `web/js/reorder.js`

**기능:**
- 필터바에 "그룹 순서 조정" 버튼 추가
- 모달로 드래그 앤 드롭 방식 순서 조정 UI 제공
- 각 그룹에 색상 칩, 이름, 이슈 개수 표시

**UI 구조:**
```
┌─────────────────────────────────────┐
│ 그룹 순서 조정                  [×] │
├─────────────────────────────────────┤
│ 드래그하여 순서를 변경하세요...      │
│                                     │
│ ⋮⋮ [●] GuideKim              4개   │
│ ⋮⋮ [●] Mission&Reward         6개   │
│ ⋮⋮ [●] UnifiMobile            6개   │
│ ⋮⋮ [●] unifi-backlog          5개   │
│ ...                                 │
├─────────────────────────────────────┤
│                      [취소]  [저장] │
└─────────────────────────────────────┘
```

**드래그 앤 드롭:**
- 각 그룹 항목에 `draggable="true"` 속성
- 드래그 중 `.dragging` 클래스로 시각적 피드백
- 드롭 대상에 `.drag-over` 클래스로 강조
- 드롭 시 배열 재정렬 및 즉시 렌더링

#### 2. 액션 추가

**파일:** `web/js/actions.js`

```javascript
export const actions = {
  // ... 기존 액션들
  reorderGroups: (labelOrder) => enqueue({ action: "reorder_groups", labelOrder }),
};

// 읽기 전용 액션에 추가 (자동 처리)
const READ_ONLY_ACTIONS = new Set([
  'load_comments', 
  'load_transitions', 
  'sync', 
  'reorder_groups'  // ← 새로 추가
]);
```

**특징:**
- `reorder_groups`는 읽기 전용 액션 (Jira 변경 없음)
- 자동 처리 대상 → 저장 버튼 클릭 시 자동으로 process 실행
- `labelOrder` 배열을 큐에 전송

#### 3. 백엔드 처리

**파일:** `tools/reorder_groups.py` (신규)

```python
def reorder_groups(label_order):
    """그룹 순서 변경"""
    # config.json 로드
    with open(CONFIG_FILE, 'r') as f:
        config = json.load(f)
    
    # labelOrder 업데이트
    config['labelOrder'] = label_order
    
    # 저장
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=2)
    
    return True
```

**처리 흐름:**
1. 브라우저: "저장" 버튼 클릭
2. `reorder_groups` 액션을 큐에 추가
3. 자동 처리 트리거 (`/api/auto-process`)
4. 워처가 신호 감지
5. Claude Code가 `process` 실행
6. `reorder_groups.py` 호출하여 `config.json` 업데이트
7. `normalize.py` 재실행으로 `snapshot.json` 재생성
8. 브라우저 폴링으로 새 순서 반영

#### 4. 문서 업데이트

**파일:** `docs/11-mutations.md`

```markdown
| action | 처리 |
|--------|------|
| ... |
| `reorder_groups` | config.json의 labelOrder 업데이트 → normalize.py 재실행으로 snapshot 재생성. Jira 변경 아님, 로컬 설정 변경 |
```

### 기술적 세부사항

#### 드래그 앤 드롭 구현

**이벤트 핸들러:**
```javascript
item.addEventListener("dragstart", handleDragStart);
item.addEventListener("dragend", handleDragEnd);
item.addEventListener("dragover", handleDragOver);
item.addEventListener("drop", handleDrop);
item.addEventListener("dragleave", handleDragLeave);
```

**배열 재정렬:**
```javascript
function handleDrop(e) {
  const fromIdx = parseInt(draggedItem.dataset.idx);
  const toIdx = parseInt(this.dataset.idx);
  
  // 배열에서 요소 이동
  const [movedItem] = currentOrder.splice(fromIdx, 1);
  currentOrder.splice(toIdx, 0, movedItem);
  
  // 즉시 재렌더링
  renderReorderList();
}
```

#### 스타일링

**모달:**
```css
.modal {
  position: fixed;
  top: 0; left: 0;
  width: 100%; height: 100%;
  background: rgba(0,0,0,0.75);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.modal-content {
  background: var(--surface);
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
}
```

**드래그 상태:**
```css
.reorder-item.dragging {
  opacity: 0.4;
}

.reorder-item.drag-over {
  border-color: var(--accent);
  border-width: 2px;
  margin-top: 4px;
}
```

### 영향받은 파일

#### 프론트엔드
1. **`web/index.html`**
   - "그룹 순서 조정" 버튼 추가
   - 모달 HTML 구조 추가

2. **`web/styles.css`**
   - 모달 스타일 추가
   - 드래그 앤 드롭 인터랙션 스타일

3. **`web/js/reorder.js`** (신규)
   - 모달 열기/닫기 로직
   - 드래그 앤 드롭 핸들러
   - 저장 로직

4. **`web/js/actions.js`**
   - `reorderGroups` 액션 추가
   - `READ_ONLY_ACTIONS`에 추가

5. **`web/js/app.js`**
   - `initReorderModal()` 호출 추가

#### 백엔드
6. **`tools/reorder_groups.py`** (신규)
   - 그룹 순서 변경 로직
   - config.json 업데이트
   - 변경 전후 비교 출력

7. **`tools/process_queue.py`**
   - `READ_ONLY_ACTIONS`에 `reorder_groups` 추가

8. **`docs/11-mutations.md`**
   - `reorder_groups` 액션 문서화

### 사용 방법

**1. 모달 열기:**
- 필터바의 "그룹 순서 조정" 버튼 클릭

**2. 순서 변경:**
- 그룹 항목의 `⋮⋮` 핸들을 드래그
- 원하는 위치에 드롭
- 즉시 순서 변경 미리보기

**3. 저장:**
- "저장" 버튼 클릭
- 자동으로 처리됨 (워처가 감지)
- 몇 초 후 간트 차트와 카드 순서 자동 갱신

**4. 취소:**
- "취소" 버튼 또는 ESC 키
- 또는 모달 배경 클릭

### 테스트 결과

✅ 드래그 앤 드롭으로 순서 변경 가능  
✅ 저장 시 config.json 업데이트  
✅ snapshot 자동 재생성  
✅ 간트 차트와 카드 모두 새 순서 반영  
✅ `(no label)` 항목은 항상 맨 끝 유지  
✅ 자동 처리로 사용자 개입 최소화  

**테스트 시나리오:**
```bash
# 순서 변경 전
1. Mission&Reward (6개)
2. UnifiMobile (6개)
3. unifi-backlog (5개)
4. GuideKim (4개)
...

# 드래그로 GuideKim을 맨 위로 이동 → 저장

# 순서 변경 후 (자동 반영)
1. GuideKim (4개)         ← labelOrder[0]
2. Mission&Reward (6개)   ← 나머지, count 순
3. UnifiMobile (6개)
4. unifi-backlog (5개)
...
```

### 제약사항

1. **`(no label)` 고정:**
   - 라벨이 없는 그룹은 항상 맨 끝에 위치
   - 드래그로 이동 불가 (UI에 표시되지만 순서에서 제외)

2. **labelOrder와 실제 그룹:**
   - `labelOrder`에 없는 라벨은 count 내림차순으로 자동 배치
   - 새 라벨이 추가되면 자동으로 count 순으로 삽입됨

3. **동기화:**
   - 순서 변경은 로컬 설정(`config.json`)만 업데이트
   - Jira에는 영향 없음
   - 다른 사용자와 공유되지 않음

### 다음 단계

**권장 개선 사항:**

1. **프리셋 저장:**
   - 자주 사용하는 순서를 프리셋으로 저장
   - 빠른 전환 기능

2. **그룹 필터링:**
   - 특정 그룹만 보기/숨기기
   - 북마크 기능

3. **드래그 UX 개선:**
   - 드래그 미리보기 (ghost image)
   - 애니메이션 전환
   - 터치 디바이스 지원
