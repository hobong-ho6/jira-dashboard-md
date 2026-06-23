# 06 — Gantt Timeline (요구 A2 + B2)

목적: Due date 기반 간트 타임라인으로 "오늘/이번주 집중할 일"을 본다. 라벨 그룹 단위로 접고 편다.

## 시간 모델
- 막대 = `startDate .. duedate`.
  - `duedate`가 없으면 간트에 막대를 그리지 않고 별도 "No due date" 레인에 칩으로만 표시.
  - `startDate >= duedate`이거나 start가 없으면 최소 폭(예: 0.5일) 막대로 그린다.
- 기본 가시 범위: `오늘-7일 .. 오늘+21일`(설정 가능). 범위 밖 항목은 양끝에 클램프 마커.

## Bucket 분류 (sync가 계산, `03.bucket`)
기준일 `D` = `generatedAt`의 로컬 날짜. `weekStart`(기본 monday)로 이번주 [weekStart, weekEnd] 계산.
```
duedate == null            -> none
duedate <  D               -> overdue
duedate == D               -> today
weekStart <= duedate <= weekEnd -> thisWeek   (단, today 우선)
그 외                       -> later
```
- 색상: overdue=red, today=amber/strong, thisWeek=blue, later=neutral, none=muted. (토큰은 `12`)

## 강조 요소
1. **오늘 라인**: 세로선 + "오늘" 라벨.
2. **이번주 밴드**: weekStart~weekEnd 배경 음영.
3. 막대 색을 bucket 색과 일치시켜 한눈에 우선순위가 보이게.
4. 막대 끝에 due 날짜, 막대 안에 `KEY summary`(말줄임).

## 그룹 접기/펴기 (B2)
- 행 구성: **라벨 그룹 헤더 행** → 그 아래 그룹 소속 이슈 막대들.
- 헤더 클릭 시 그룹의 막대 영역 collapse/expand. 상태 키는 `group:{name}`(카드와 공유, `05`).
- 그룹 헤더 행 자체에 그룹 요약 막대(그룹 내 최소 start ~ 최대 due의 범위 바)를 옅게 표시하면 접은 상태에서도 기간 감을 준다(선택).

## 의존성 화살표 (A3 연동)
- `config.ganttDependencyLinkTypes`(기본: `Finish-to-Start link (WBSGantt)`, `Blocks`)에 해당하는 `links`만 화살표로 그린다.
- 선행(blocking) 막대 끝 → 후행 막대 시작으로 화살표. 방향은 `07`의 정규화 결과 사용.
- 화살표가 많아 지저분하면 "의존성 표시" 토글로 on/off. 상세(`10`) 진입 이슈의 의존성만 하이라이트하는 모드 권장.

## 렌더 기술
- SVG 또는 absolute-positioned div 레인. 날짜→x좌표 매핑 함수 하나로 일관.
- 가로 스크롤 + 헤더(날짜 눈금) sticky. 그룹 헤더는 왼쪽 라벨 컬럼에 sticky.
- 외부 차트 라이브러리 없이 구현 가능(권장). 쓰더라도 의존성은 최소화(`12`).

## Definition of Done
- 오늘 라인과 이번주 밴드가 보인다.
- 막대 색이 bucket과 일치한다.
- 라벨 그룹을 접고 펼 수 있고 카드 영역과 상태가 공유된다.
- duedate 없는 이슈는 막대 대신 "No due date"에 표시된다.
- 의존성 화살표를 토글할 수 있다.
