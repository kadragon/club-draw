# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Review Backlog

### PR #62 — ladder: dev-only stale assertion for cached frame base (2026-10-03)

- [ ] [debt] `LadderRun` 제자리 변경(`run.revealed[col] = true` 등) 대신 참조 교체로 바꾸고 base에 참조 저장 → `renderLadderFrame`이 모든 빌드에서 `===` 필드 비교로 stale 판정 (source: code-review) — `src/main.ts` `renderLadderFrame`
- [ ] [constraint] stale base 검사 자동 테스트 없음 — snapshot 비교 헬퍼를 순수 모듈로 빼서 제자리 `revealed`/`placement` 변경이 불일치를 내는지 단위 테스트 (source: code-review) — `src/main.ts` `ladderBaseSnapshot`
