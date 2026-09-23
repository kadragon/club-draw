# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Review Backlog

### PR #57 — ladder keyboard rung editing, density confirm, cached traces (2026-09-23)

- [ ] [debt] `ladderModel`이 애니메이션 프레임마다 열별 `playerAt`(find)·`colorFor`(findIndex)로 O(N²) 선형 탐색 — run 단위로 id→player/color 맵을 한 번 만들어 재사용 (source: code-review) — `src/main.ts` `ladderModel`
