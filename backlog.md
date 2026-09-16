# Backlog — club-draw

진행 중이 아닌 작업 큐. 스프린트 시작 시 `tasks.md`로 이동(스키마는 진행 중에만 존재).
섹션은 항목 생길 때 추가(Features / Bugs / Tech debt / Ideas).

## 선호 모드 — Worker + D1 API

- [ ] [FEAT] `wrangler.jsonc`에 Worker 엔트리(`main`)와 D1 바인딩을 추가하고 `assets.binding`으로 기존 정적 SPA 서빙을 유지. 마이그레이션 SQL(session / session_participant / session_prize / pick)과 `/api` 계약 구현: 세션 개설(운영자 토큰 해시 저장), 명부·상품 조회, 선택 제출·수정(참가자별 delete→insert 원자 교체, 클레임 토큰), 마감, 스냅샷 pull. 근거: `docs/design/preference-draw-mode.md`. 검증: `wrangler dev` + 로컬 D1 계약 테스트 — 중복 제출 409, 4개 제출 거부, 마감 후 제출 거부, 토큰 없는 수정 거부, 스냅샷 응답 형태.

## 선호 모드 — 운영자 세션 UI

- [ ] [FEAT] 운영자 화면에 세션 개설(명부·상품 push) → `sessionId`·운영자 토큰 발급(토큰은 localStorage 보관 + 복사 가능하게 노출) → `/pick?s={id}` QR 표시(번들 의존성으로 생성, CSP 변경 없음) → 접수 마감 → 스냅샷 1회 pull로 로컬 `picks` 채우기 흐름을 추가. pull 이후 추첨·원판·기록·CSV는 네트워크 불요. 근거: `docs/design/preference-draw-mode.md`. 검증: `bun run cf:dev`에서 개설→마감→pull 후 오프라인으로 끝까지 추첨. *(blocked by: 3-worker-api-d1)*

## 선호 모드 — 참가자 선택 화면

- [ ] [FEAT] `pick.html`을 vite rollup input으로 추가하고(운영자 번들의 Canvas·컨페티·사운드 미포함), 명부 검색 → 본인 선택 → 상품 최대 3개 선택 → 제출 화면을 구현. 제출 시 받은 클레임 토큰을 참가자 localStorage에 저장해 마감 전까지 수정 허용, 마감 후에는 읽기 전용 안내. 이름 삽입은 `textContent`만. 근거: `docs/design/preference-draw-mode.md`. 검증: `bun run cf:dev`에서 폰(또는 두 번째 브라우저 프로필)으로 제출→수정→마감 후 거부 확인. *(blocked by: 3-worker-api-d1)*

## 선호 모드 — 개인정보 고지 + 세션 삭제

- [ ] [FEAT] 세션 개설 UI에 "명부 이름이 서버에 저장된다"는 고지를 넣고, 행사 종료 후 세션 데이터를 지우는 경로(`DELETE /api/session`, 운영자 토큰 필요)와 운영자 화면 버튼을 추가. 여기서 확정되는 보존 정책을 스펙 `## Not yet specified`에서 지운다. 근거: `docs/design/preference-draw-mode.md`(Further Notes 위험 항목). 검증: 삭제 후 `/pick?s=` 접근이 404, 토큰 없는 삭제 거부. *(blocked by: 4-operator-session-ui)*

## 선호 모드 — 문서 동기화

- [ ] [DOCS] `AGENTS.md`(모드 불변식·Docs Index), `docs/architecture.md`(Worker/D1·`pick.html` 의존 방향), `docs/runbook.md`(D1 마이그레이션·세션 운영·배포 체크)를 선호 모드 기준으로 갱신. 근거: `docs/design/preference-draw-mode.md`. 검증: `bun run lint` green, AGENTS.md 100줄 목표 유지. *(blocked by: 4-operator-session-ui)* *(blocked by: 5-participant-pick-page)*

## Review Backlog

### PR #45 — clear preference picks and session on backup restore and session reset (2026-09-16)

- [ ] [debt] 세션 리셋·백업 복원이 `state.session`(운영자 `adminToken` 포함)을 비워, 서버 세션이 열린 채면 마감·재pull·삭제 경로를 잃음. 운영자 세션 UI 구현 시 열린 세션이 있으면 리셋/복원 전에 마감·삭제를 유도하거나 차단할 것 (source: code-review) — src/state.ts:220 *(blocked by: 4-operator-session-ui)*
