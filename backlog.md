# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Review Backlog

### PR #58 — ladderModel: index players and roster colors once per frame (2026-09-23)

- [ ] [debt] `ladderModel`이 경로 애니메이션 중 매 프레임 top/bottom 등 정적 부분까지 재구성 — 정적 부분은 run/상태 변경 시 1회, 프레임마다 `paths[].progress`만 갱신 (stale 위험 주의: placement·roster 변동) (source: code-review) — `src/main.ts` `ladderModel`
