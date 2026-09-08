# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Ideas

- [ ] `prefers-reduced-motion`을 JS에서도 존중 — `style.css:886` 블록 주석은 "canvas 모션은 JS가
  spinMs로 처리"라 하지만 `src/*.ts` 어디에도 `matchMedia` 없음. 전체 화면 confetti 160입자
  (`src/main.ts:380`)와 idle 드리프트가 무조건 실행됨. 전정기관 자극 회피 옵션.
