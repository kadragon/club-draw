# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Review Backlog

### PR #56 — ladder rung editing, animated reveal, result table (2026-09-23)

- [ ] [debt] 밀도 select 변경이 잠금 전 사다리를 재생성해 캔버스로 수동 편집한 가로줄이 경고 없이 사라짐 — 확인 모달 또는 "새 사다리"에서만 밀도 적용 검토 (source: code-review) — `src/main.ts` `setLadderDensity`
- [ ] [debt] 가로줄 편집이 캔버스 클릭 전용(`role="img"`, 키보드 경로 없음) — 포커스 가능한 캔버스 + 방향키/Enter 편집 검토 (source: code-review) — `src/main.ts` `onLadderCanvasClick`
- [ ] [debt] 잠긴 사다리의 `traceLadder`를 애니메이션 프레임마다 전 열 재계산 — 잠금 시 trace를 `LadderRun`에 캐시해 모델·반영·결과표가 공유 (source: code-review) — `src/main.ts` `ladderModel`
