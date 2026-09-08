# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Tech debt

- [ ] `wheel.ts`의 `wedgeIndexAt`이 `draw.ts`의 `wedgeAtPointer`를 그대로 복제 — AGENTS.md가
  "각도 규약은 두 파일을 함께 바꿀 것"이라 명시한 바로 그 드리프트 지점. `wheel.ts`는 이미
  `draw.js`에서 `highlightState`를 임포트하므로 `wedgeAtPointer`도 임포트해 사본 제거.
  `src/wheel.ts:425`
- [ ] `loadState` 무테스트 — `test/state.test.ts`는 `canDeleteParticipant`만 커버. 손상 페이로드
  허용과 `cumulativeWins` 음수 클램프(뒤집히면 공정성 역전)는 공정성에 직결되는데 아직 회귀
  가드가 없음. 같은 파일에 케이스 추가. `src/state.ts:62`
- [ ] spinMs 경계(1000–20000ms)가 세 곳에 하드코딩 — `src/state.ts:62`(clampInt),
  `src/main.ts:510`, `index.html:90`(min/max, 초 단위). 한 곳으로 모으고 나머지가 참조하게.
- [ ] `bun run lint` 범위가 `src test`뿐 — `vite.config.ts` 등 루트 TS 설정이 biome 게이트 밖.
  범위 확대 또는 제외를 `biome.json`에 명시.
- [ ] `src/main.ts` 689줄에 DOM 배선·렌더·추첨 플로우·백업/복원이 모두 있음. `docs/architecture.md`는
  main을 "DOM 배선 + 오케스트레이션"으로 규정 — 렌더 함수군을 `ui.ts`로 분리해 문서와 일치시킬 것.

## Features

- [ ] 참가자 누적 당첨값 인라인 수정 — 현재는 삭제 후 재등록만 가능. 운영자 입력값이라 오타
  정정 수요가 실제로 발생. `src/main.ts:211`
- [ ] 명단 가져오기 중복 감지 — `applyRoster`가 무조건 append하므로 같은 CSV를 두 번 넣으면
  명단이 조용히 두 배가 되고 그대로 추첨에 들어감. 동명 감지 후 확인 모달. `src/main.ts:486`

## Ideas

- [ ] `prefers-reduced-motion`을 JS에서도 존중 — `style.css:886` 블록 주석은 "canvas 모션은 JS가
  spinMs로 처리"라 하지만 `src/*.ts` 어디에도 `matchMedia` 없음. 전체 화면 confetti 160입자
  (`src/main.ts:434`)와 idle 드리프트가 무조건 실행됨. 전정기관 자극 회피 옵션.
