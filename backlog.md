# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## Review Backlog

### PR #45 — clear preference picks and session on backup restore and session reset (2026-09-16)

- [ ] [debt] 세션 리셋·백업 복원이 `state.session`(운영자 `adminToken` 포함)을 비워, 서버 세션이 열린 채면 마감·재pull·삭제 경로를 잃음. 운영자 세션 UI 구현 시 열린 세션이 있으면 리셋/복원 전에 마감·삭제를 유도하거나 차단할 것 (source: code-review) — src/state.ts:220
