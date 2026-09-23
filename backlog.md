# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Review Backlog

### PR #60 — ladder: pure ladderFrame overlay, cursor moves reuse cached base (2026-09-23)

- [ ] [constraint] 커서 이동·포커스까지 캐시된 base를 재사용 — "run 제자리 변경은 `syncControls`/`renderLadderCanvas`로 끝난다" 불변식이 주석뿐. `renderLadderFrame`에 dev 전용 run fingerprint stale 단언 추가 (source: code-review) — `src/main.ts` `renderLadderFrame`
