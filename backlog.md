# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## 3-ladder-rung-edit — 가로줄 밀도·수동 편집

- [ ] [FEAT] 가로줄 밀도 3단계(적게/보통/많이) 생성 + 캔버스 클릭 hit-test로 가로줄 추가/삭제(인접 동일 높이 거부), 잠금 후 편집 불가. 수용: 밀도 단조 증가·hit-test 좌표 변환 테스트 + 브라우저 확인. 출처: `docs/design/ladder-draw-mode.md`

## 4-ladder-reveal — 경로 애니메이션·결과표

- [ ] [FEAT] 이름 클릭 개별 공개 + "전체 공개" 순차 재생, 참가자별 팔레트 색 경로, spinMs 기반 속도, 당첨 칸 컨페티·사운드, reduced-motion 즉시 표시, 전체 공개 후 결과표. 수용: 애니메이션 종료 칸 == 반영 상품 == 기록(브라우저), 콘솔 CSP 위반 0. 출처: `docs/design/ladder-draw-mode.md`

## 5-ladder-docs — 공정성 안내·문서 동기화

- [ ] [DOCS] 공정성 모달에 사다리 항목(crypto 셔플·잠금 시 확정·가로줄 편집 결과 무관·가중치 없음) + AGENTS.md Golden Principles 사다리 불변식 한 줄 + `docs/architecture.md` 모듈 표 + `docs/runbook.md` 무대 규칙(잠금 후 새로고침). 출처: `docs/design/ladder-draw-mode.md` *(blocked by: 4-ladder-reveal)*

## Review Backlog

- [ ] [FIX] `src/ladder-view.ts` 라벨 회전 기준(`boxW - 6`)과 말줄임 폭(`boxW - 10`) 불일치 → 좁은 칸에서 폭이 (boxW−10, boxW−6]인 "꽝"·짧은 이름이 가로로 놓여 "…"로 잘림. 회전 기준을 `boxW - 10`으로 맞출 것(agy 리뷰, PR #54 머지 후 도착)
