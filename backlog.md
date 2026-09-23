# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Review Backlog

### PR #59 — ladder: build static view model once per render, animate progress only (2026-09-23)

- [ ] [debt] 키보드 커서 이동·포커스(`showLadderCursor`)가 `cursor`만 바뀌어도 `renderLadderCanvas`로 base 전체 재구성 — 커서만 갱신하는 경로 분리 (source: code-review) — `src/main.ts` `renderLadderCanvas`
- [ ] [constraint] 캐시된 프레임 경로(`ladderFrameBase`/`ladderModel`/`renderLadderFrame`)가 테스트 없는 `main.ts`에 있음 — 순수 `ladderFrame(base, anim)`로 추출해 `test/`에서 커버하거나 dev 전용 stale 단언 추가 (source: code-review) — `src/main.ts` `renderLadderFrame`
