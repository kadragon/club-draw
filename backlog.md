# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Features

- [ ] 참가자 누적 당첨값 인라인 수정 — 현재는 삭제 후 재등록만 가능. 운영자 입력값이라 오타
  정정 수요가 실제로 발생. `src/main.ts:206`
- [ ] 명단 가져오기 중복 감지 — `applyRoster`가 무조건 append하므로 같은 CSV를 두 번 넣으면
  명단이 조용히 두 배가 되고 그대로 추첨에 들어감. 동명 감지 후 확인 모달. `src/main.ts:432`

## Ideas

- [ ] `prefers-reduced-motion`을 JS에서도 존중 — `style.css:886` 블록 주석은 "canvas 모션은 JS가
  spinMs로 처리"라 하지만 `src/*.ts` 어디에도 `matchMedia` 없음. 전체 화면 confetti 160입자
  (`src/main.ts:380`)와 idle 드리프트가 무조건 실행됨. 전정기관 자극 회피 옵션.
