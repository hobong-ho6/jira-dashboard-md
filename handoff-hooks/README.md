# HANDOFF 훅 세트

Claude Code 프로젝트에서 세션 간 핸드오프를 자동화하는 훅 스크립트 모음입니다.

- **SessionStart** → `HANDOFF.md`를 세션 컨텍스트로 자동 주입, Claude가 첫 응답에서 브리핑
- **SessionEnd** → 세션 트랜스크립트를 헤드리스 Claude(`claude -p`)로 요약시켜 `HANDOFF.md` 자동 갱신

## 구성 파일

```
.claude/
  settings.json            # 훅 등록
  hooks/
    handoff-start.sh       # 시작 훅: 컨텍스트 주입
    handoff-end.sh         # 종료 훅: HANDOFF.md 갱신
HANDOFF.md                 # 핸드오프 문서 (별도 템플릿 사용)
```

## 설치 (프로젝트당 1회)

1. 이 폴더의 `.claude/` 디렉토리를 프로젝트 루트에 복사합니다.
   - 이미 `.claude/settings.json`이 있다면 `hooks` 항목만 병합하세요.
2. 실행 권한을 부여합니다.

   ```bash
   chmod +x .claude/hooks/handoff-start.sh .claude/hooks/handoff-end.sh
   ```

3. 프로젝트 루트에 `HANDOFF.md` 템플릿을 놓습니다.
4. Claude Code를 재시작하면 훅이 로드됩니다. `/hooks` 명령으로 등록 상태를 확인할 수 있습니다.

## 동작 방식

### 시작 시
`handoff-start.sh`가 `HANDOFF.md` 전문을 `additionalContext`로 주입합니다.
Claude는 "지난 세션: X 완료. 오늘 예정: Y. 시작할까요?" 형태로 브리핑 후 시작합니다.
`HANDOFF.md`가 없으면 아무 일도 하지 않습니다.

### 종료 시
`handoff-end.sh`가 다음을 수행합니다.

1. stdin JSON에서 `transcript_path`를 읽어 세션 대화(JSONL)를 텍스트로 추출 (뒤에서 최대 6만 자)
2. 현재 `HANDOFF.md` + 트랜스크립트 요약본을 `claude -p`(sonnet)에 전달해 갱신본 생성
3. 출력 검증(`# HANDOFF`로 시작하는지) 후 `HANDOFF.md.bak` 백업을 남기고 원자적으로 교체

안전장치:

- **재귀 방지**: 헤드리스 세션에는 `CLAUDE_HANDOFF_UPDATING=1`이 설정되어 훅이 다시 돌지 않습니다.
- **짧은 세션 무시**: 대화가 500자 미만이면 갱신하지 않습니다 (빈 세션, 단순 조회 등).
- **실패 시 무해**: claude CLI 부재, 생성 실패, 형식 불일치 시 기존 파일을 건드리지 않고 로그만 남깁니다.
- **로그**: `.claude/handoff-hook.log`에서 동작 이력을 확인할 수 있습니다.

## 참고 사항

- 종료 훅은 요약 생성에 수십 초가 걸릴 수 있습니다 (timeout 300초 설정).
  세션을 닫을 때 백그라운드에서 도는 것이므로 평소 작업에는 영향이 없습니다.
- `claude -p` 호출은 일반 사용량과 동일하게 과금/한도에 포함됩니다.
- 갱신 결과가 마음에 들지 않으면 `HANDOFF.md.bak`으로 되돌릴 수 있습니다.
- `/clear`로 세션을 정리할 때도 SessionEnd가 발생해 갱신됩니다. 원치 않으면
  `handoff-end.sh`에서 `REASON` 값으로 분기 처리를 추가하세요.
- 팀 공유가 싫다면 `settings.json` 대신 `settings.local.json`에 훅을 넣으면
  git에 커밋되지 않는 개인 설정이 됩니다.

## 문제 해결

- 훅이 안 도는 것 같을 때: `claude --debug`로 실행하면 훅 매칭/실행 로그가 보입니다.
- `Permission denied`: `chmod +x` 재확인.
- 갱신이 자꾸 생략될 때: `.claude/handoff-hook.log`의 사유(트랜스크립트 없음, 세션 짧음 등)를 확인하세요.
