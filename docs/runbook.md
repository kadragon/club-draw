# Runbook — club-draw

## 명령

```bash
bun install        # 의존 설치
bun run dev        # vite 개발 서버 (HMR)
bun run test       # vitest run — 커밋 전 필수, 통과해야 함 (bun test 아님: 내장 러너로 빠짐)
bun run test:watch # vitest watch
bun run lint       # biome check (lint+format 검사) — 커밋 전 필수
bun run lint:fix   # biome check --write (safe+unsafe 수정 적용)
bun run format     # biome format --write (포맷만)
bun run typecheck  # tsc --noEmit
bun run build      # tsc --noEmit + vite build → dist/
bun run cf:dev     # build + wrangler dev (로컬서 _headers/CSP·Worker·로컬 D1 적용)
bun run deploy     # build + D1 migrations apply --remote + wrangler deploy
```

## D1 마이그레이션

스키마는 `migrations/NNNN_*.sql`(`wrangler.jsonc`의 `migrations_dir`). DB 이름 `club-draw-db`.

```bash
bunx wrangler d1 migrations list  club-draw-db --local    # 미적용 목록(로컬)
bunx wrangler d1 migrations apply club-draw-db --local    # cf:dev 전에 1회
bunx wrangler d1 migrations list  club-draw-db --remote   # 배포 전 원격 확인
bunx wrangler d1 migrations apply club-draw-db --remote   # `bun run deploy`가 자동 실행(미적용분만)
```

- 적용된 마이그레이션 파일은 **수정 금지** — 변경은 새 번호 파일로.
- `test/worker-api.test.ts`는 `0001_init.sql`만 `?raw`로 읽어 인메모리 D1에 적용한다.
  마이그레이션을 추가하면 테스트 `beforeAll`에도 같은 파일을 넣을 것(안 넣으면 테스트는
  옛 스키마로 초록불).

## 선호 세션 운영

1. 운영자 SPA에서 추첨 방식 **선호**로 전환 → 서버 저장 고지 확인 → 세션 개설.
   화면의 운영자 토큰을 **복사해 보관**(토큰은 이 브라우저 localStorage에만 있음).
2. QR(`/pick?s={id}`)을 스크린·인쇄물로 배포. 참가자는 명부에서 본인 선택 → 최대 3개 제출.
   같은 기기에서는 마감 전까지 수정 가능(claim 토큰 `club-draw:pick:{id}`).
3. **마감** → 자동으로 스냅샷 pull. pull 실패 시 "선택 결과 가져오기"로 재시도. 이후 추첨은 오프라인.
4. 행사 후 **서버에서 세션 삭제**(되돌릴 수 없음) → 명단·선택 행 삭제. 이후 `GET /api/session/:id`가 404를 돌려주고 `/pick?s=` 페이지(200)는 오류 문구를 띄운다. 로컬 picks는 남는다.
5. 세션 초기화·백업 복원은 로컬 `state.session`(운영자 토큰)을 비운다 → 서버 세션이 열려 있거나
   삭제 전이면 **먼저 마감·삭제**하고 초기화할 것(UI는 토큰을 다시 입력받지 못한다 — 잃으면 아래 curl로만 정리한다).

## 버전

`package.json`의 `version`은 **손대지 말 것**. `.githooks/post-commit`이 커밋 메시지의
`[TYPE]`을 읽어 자동 bump한다(`[FEAT]`→minor, 그 외 `[TYPE]`→patch, major는 수동, 머지·리베이스
커밋은 건너뜀). 수동으로 고쳐두면 훅이 "이미 bump됨"으로 보고 건너뛰고, `package.json`에
커밋 안 된 변경이 남아 있으면 그 커밋의 bump 자체가 조용히 생략된다.

## 배포 전 체크

1. `bun run lint` 그린(biome).
2. `bun run test` 그린.
3. `bun run build` 성공(타입 에러 0).
4. 각도 규약/스핀 건드렸으면 브라우저서 실제 스핀 → "포인터 아래 이름 == 표시 당첨자"
   (개발 빌드 `window.__cd` 시드, prod strip).
5. `bun run deploy`는 build → `migrations apply --remote` → `wrangler deploy` 순서라 마이그레이션이 Worker보다 먼저 적용된다. `wrangler deploy`를 직접 쓰지 말 것(스키마 없이 배포돼 `/api/*` 500이 난다).
6. Worker/세션 흐름 건드렸으면 `bun run cf:dev`에서 두 번째 브라우저 프로필로 개설→제출→마감·pull→
   네트워크 끊고 추첨 끝까지 한 바퀴.
7. CSP 건드렸으면 `bun run cf:dev` 후 `curl -sI http://localhost:8787` 로 CSP 헤더 +
   브라우저 콘솔 위반 0 확인.

## 실패 모드

| 증상 | 원인/조치 |
|------|-----------|
| `crypto.getRandomValues` 타입 에러 | 주입 타입을 `Uint32Array<ArrayBuffer>`로(맨 `Uint32Array` 금지). AGENTS.md Gotchas. |
| vitest `test` 키 무시됨 | `vite.config.ts`가 `defineConfig`를 `vitest/config`에서 임포트해야 함. |
| 폰트/외부 CDN 차단 | `public/_headers` CSP allowlist 갱신. |
| `/api/*` 500 `no such table` | D1 마이그레이션 미적용 → 위 `migrations apply`(`--local`/`--remote`). |
| 마감·pull·삭제 401 | 운영자 토큰 불일치/분실(초기화·복원·다른 브라우저). UI에 토큰 입력란이 없어 복구 불가 — 보관한 토큰으로 `curl -X POST …/api/session/:id/close`, `curl …/snapshot`, `curl -X DELETE …/api/session/:id`에 `-H 'Authorization: Bearer <token>'`. |
| pull 409 `session-open` | 아직 마감 전. 마감 먼저. |
| 참가자 제출 409 `already-submitted` / 403 `bad-claim` | 다른 기기(또는 저장소 삭제)에서 이미 제출됨 — claim 토큰은 기기별. |
| `/pick`에 원판 번들이 실림 | `pick.ts`가 `draw`/`wheel`/효과 모듈을 임포트함 → 제거(architecture.md 의존 방향). |
| 스핀 후 당첨자 불일치 | 각도 규약 깨짐 → `test/draw.test.ts` "absolute physical convention" 확인. |

## _workspace/

해당 없음(Lean 하네스, 멀티에이전트 오케스트레이션 미사용).
