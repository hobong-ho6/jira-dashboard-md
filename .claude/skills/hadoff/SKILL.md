---
name: handoff
description: 이 저장소의 HANDOFF.md를 읽고 갱신하며 Git으로 동기화하는 세션 인수인계 절차. 사용자가 "핸드오프", "핸드오프 갱신", "세션 정리", "handoff", "이어서 작업", "지난 세션 뭐 했지", "다른 PC에서 이어가게" 라고 말할 때 반드시 사용한다. 세션 시작 시 프로젝트 상태를 파악해야 할 때, 세션을 마무리하고 다음 세션·다른 PC로 넘길 때, WIP 변경을 원격에 남겨야 할 때도 사용한다.
---

# Handoff

이 저장소는 **HANDOFF.md + Git 히스토리**를 세션 간·PC 간 유일한 인수인계 채널로 쓴다.
로컬에만 있는 것(uncommitted 변경, `git stash`, 대화 기록)은 다른 PC에서 존재하지 않는 것으로 취급한다.

## 세션 시작

1. 상태 확인
   ```bash
   git status --short && git log --oneline -5 && git branch -a --sort=-committerdate | head -10
   ```
2. `git pull --rebase`
   - uncommitted 변경이 있으면 pull 하지 말고 먼저 사용자에게 알린다.
   - rebase 충돌 시 임의로 해결하지 말고 충돌 파일을 보여주고 물어본다.
3. `HANDOFF.md` 를 읽는다. "현재 상태" · "진행 중 작업(WIP)" · "다음 할 일" 우선.
4. `HANDOFF.md`의 `마지막 커밋` 해시와 실제 HEAD가 다르면 **먼저 그 불일치를 보고**한다.
   (다른 PC에서 커밋만 하고 문서를 갱신하지 않은 경우 → `git log` 를 근거로 삼는다.)
5. `.claude/skills/` 목록을 확인해 이 프로젝트에서 쓸 수 있는 스킬을 파악한다.
6. 한 줄 브리핑 후 착수 확인:
   > 지난 세션 #N (`{PC}`): {완료 요약}. WIP: {브랜치 또는 없음}. 다음 첫 작업: {항목}. 시작할까요?

## 세션 종료 (핸드오프 갱신)

순서를 지킨다. **문서 갱신보다 코드 보존이 먼저다.**

1. `git pull --rebase` — 다른 PC 변경 먼저 반영.
2. **미완성 작업 보존.** uncommitted 변경이 있으면:
   ```bash
   git checkout -b wip/{주제}-$(date +%Y%m%d)
   git add -A
   git commit -m "wip: {중단 지점 한 줄 요약}"
   git push -u origin HEAD
   ```
   - `git stash` 는 쓰지 않는다 (로컬 전용이라 다른 PC에서 사라진다).
   - 커밋 전 `git status` 로 비밀파일(`.env`, 키, 인증서)이 포함되지 않았는지 확인한다.
     포함될 위험이 있으면 커밋하지 말고 `.gitignore` 추가를 먼저 제안한다.
3. **HANDOFF.md 갱신** — 아래 "갱신 규칙" 참조.
4. 커밋 & 푸시
   ```bash
   git add -A
   git commit -m "chore(handoff): 세션 #N — {세션 제목}"
   git push
   git log --oneline -1
   ```
5. 마지막 커밋 해시를 `HANDOFF.md`의 "현재 상태"에 기록한다
   (`git commit --amend` 또는 짧은 후속 커밋 → 다시 push).
6. 푸시 성공을 확인한 뒤에만 완료 보고. 실패 시 원인과 사용자가 할 일을 알린다.

## 갱신 규칙

- **현재 상태**: 통째로 새로 작성(덮어쓰기). 날짜 · 세션 번호 · 작업 PC(`hostname`) · 브랜치 · 마지막 커밋 해시 포함.
- **진행 중 작업(WIP)**: wip 브랜치명 + 중단 지점(파일:줄) + 재개 명령. 없으면 "없음".
- **다음 할 일**: 완료 항목 `[x]` 처리 후 세션 기록의 완료 목록으로 이동. 새 항목은 P1/P2/P3로.
- **주요 결정 사항**: 되돌리기 어렵거나 이후 작업의 전제가 되는 것만. 관련 커밋 해시 포함.
- **최근 세션 기록**: 최신을 맨 위에, 최대 5개. 넘치면 가장 오래된 것을 "아카이브 요약"에 1~2줄로 압축 병합.
- **프로젝트 스킬 / 환경 / 머신 노트**: 이번 세션에 변경이 있었으면 함께 갱신.
- 전체 300줄 이내 유지. 넘치면 세션 기록을 먼저 압축한다.
- 추측은 `(미확인)` 으로 표기한다.

## 프로젝트 스킬 이식

프로젝트 전용 스킬은 **반드시 저장소 안**에 둔다. 개인 프로필에만 설치된 스킬에 의존하면 다른 PC에서 깨진다.

```
{repo}/
├── HANDOFF.md
├── CLAUDE.md
└── .claude/
    └── skills/
        └── {skill-name}/
            ├── SKILL.md          # 필수: YAML frontmatter(name, description) + 본문
            ├── scripts/          # (선택) 실행 스크립트
            ├── references/        # (선택) 필요 시 읽는 참고 문서
            └── assets/           # (선택) 출력에 쓰는 템플릿/파일
```

새 스킬을 만들 때:
1. `.claude/skills/{name}/SKILL.md` 생성. `description` 에는 **무엇을 하는지 + 언제 트리거되는지**를 트리거 문구와 함께 구체적으로 쓴다.
2. `HANDOFF.md` 의 "프로젝트 스킬" 표에 한 줄 등록.
3. 스킬 파일과 표 갱신을 **같은 커밋**으로 푸시.
4. 스킬이 외부 도구·패키지를 요구하면 "환경 / 머신 노트"의 초기 세팅에 설치 명령을 추가.

## Git / 인증

- Claude는 토큰·비밀번호를 채팅으로 요청하거나 입력하지 않는다.
- 원격이 없거나 push 권한이 없으면 사용자에게 다음을 안내하고 대기한다:
  - GitHub CLI: `gh auth login`
  - SSH: `ssh-keygen -t ed25519` → 공개키를 GitHub/GitLab 에 등록
  - HTTPS 캐시: macOS `git config --global credential.helper osxkeychain`
- 사용자에게 물어볼 것: **원격 저장소 URL, 기본 브랜치, push 권한 여부.** 토큰 값은 묻지 않는다.
- 원격 미설정 시:
  ```bash
  git remote add origin {사용자가 알려준 URL}
  git push -u origin main
  ```

## 충돌 완화 (여러 PC 동시 작업)

- `HANDOFF.md` 는 충돌이 잦다. 세션 종료 시 **반드시 pull --rebase 먼저**, 갱신은 그 다음.
- 충돌이 나면 자동 병합하지 말고: 양쪽 "최근 세션 기록"은 둘 다 살리고(세션 번호 순), "현재 상태"는 더 최신 날짜/커밋 쪽을 채택한 뒤 사용자에게 확인받는다.
- 한 PC에서 장시간 작업할 때는 "현재 상태"의 `작업 PC` 필드가 소유권 표시 역할을 한다. 다른 PC에서 그 값이 자기 hostname과 다르고 갱신이 최근이면, 작업 시작 전에 사용자에게 알린다.

## 새 프로젝트에 이식

`HANDOFF.md`, `CLAUDE.md`, `.claude/skills/handoff/` 세 개를 프로젝트 루트에 복사하고
"프로젝트 정보" 섹션을 채운 뒤 첫 커밋을 만든다.
