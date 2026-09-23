# Architecture — club-draw

Vanilla TS SPA. 추첨 결과를 **먼저 결정**하고 원판은 연출만. 빌드 후 Cloudflare Worker
(`worker/index.ts`)가 `/api/*`만 처리하고 나머지 경로는 assets 레이어가 `dist/`를 SPA로
서빙(`wrangler.jsonc`의 `run_worker_first: ["/api/*"]`).

진입점은 셋이다.

| 진입점 | 번들 | 용도 |
|--------|------|------|
| `index.html` → `src/main.ts` | 운영자 SPA | 명부·상품·추첨·원판·기록. 선호 세션 개설·마감·pull·삭제 |
| `pick.html` → `src/pick.ts` | 참가자 페이지 | QR(`/pick?s={id}`)로 열어 본인 선택 후 상품 최대 `MAX_PICKS`개 제출 |
| `worker/index.ts` | Worker | D1(`DB`) 기반 세션 API + `ASSETS` 폴스루 |

`pick.html`은 vite rollup input이 따로 잡혀(`vite.config.ts`) 폰이 원판·컨페티·사운드 번들을
받지 않는다. CSS(`style.css`)만 공유한다.

## 의존 방향 (단방향)

```
types.ts        도메인 모델만. 의존 없음.
   ↑
picks.ts        MAX_PICKS·normalizePicks. types만 — Worker도 임포트.
   ↑
draw.ts  ladder.ts  csv.ts  state.ts   순수 로직 / 영속화. DOM 의존 없음(ladder → draw.randomBelow).
   ↑                ↑
   │            session.ts   운영자 API 클라이언트(fetch 주입). state.readPicks 사용.
   │                ↑
   │            pick-client.ts  참가자 API 클라이언트·claim 저장 형식. session.request 재사용.
   │                ↑
wheel.ts ladder-view.ts confetti.ts sound.ts motion.ts qr.ts   ui.ts
   ↑                                              ↑
main.ts   운영자 DOM 배선 + 오케스트레이션.      pick.ts   참가자 DOM 배선.

worker/index.ts  →  src/picks.ts   (이 한 방향만. Worker는 브라우저 모듈을 임포트하지 않음)
```

규칙: 화살표 거꾸로 의존 금지. `draw.ts`/`csv.ts`/`picks.ts`는 `window`/`document`/Canvas를
참조하지 않는다(테스트 가능성 유지). 효과 모듈은 도메인 로직을 호출하지 않는다.
`pick.ts`는 `draw`/`wheel`/효과 모듈을 임포트하지 않는다(번들 분리 유지).
선택 검증 규칙(`normalizePicks`)은 브라우저와 Worker가 **같은 함수**를 쓴다.

## 모듈 책임

| 파일 | 책임 | 순수? |
|------|------|-------|
| `src/types.ts` | 도메인 인터페이스(Participant·Prize·Settings·DrawMode·PicksMap·SessionRef·Wheel…) | — |
| `src/picks.ts` | `MAX_PICKS`·`normalizePicks`(중복 제거 → 미지 id 거부 → 개수 상한) | ✅ 테스트됨 |
| `src/draw.ts` | `selectWinner`(crypto 가중 추첨)·`candidatesFor`(모드별 후보·폴백)·`buildWheel`·`computeTargetRotation`·`wedgeAtPointer` | ✅ 테스트됨 |
| `src/ladder.ts` | 사다리 코어: `canPlaceRung`·`toggleRung`·`generateRungs`(밀도 3단계)·`traceLadder`·`shuffleSlots`(잠금 시 결정)·배치(`placeAt`·`fillRandom`) | ✅ 테스트됨 |
| `src/csv.ts` | `parseRoster`·`recordsToCSV` | ✅ 테스트됨 |
| `src/state.ts` | localStorage 로드/저장(`club-draw:v1`), 부분/손상 페이로드 허용, `picks`·`session` 필드, 리셋·백업 복원 | ✅ |
| `src/session.ts` | 운영자 API 클라이언트(`openSession`·`closeSession`·`pullSnapshot`·`deleteSession`), 페이로드 빌드·에러 메시지 | ✅ 테스트됨 |
| `src/pick-client.ts` | 참가자 API 클라이언트, claim 토큰 저장 키(`club-draw:pick:{sessionId}`) | ✅ 테스트됨 |
| `src/wheel.ts` | Canvas 렌더. 3시 기준 → `canvasAngle = φ − π/2` | 브라우저 |
| `src/ladder-view.ts` | 사다리 Canvas 렌더(계산된 path만 그림), `rungAt` hit-test, `polylinePrefix` 경로 애니메이션 | 브라우저(기하 함수 테스트됨) |
| `src/ui.ts` | 참가자·상품·기록 목록 DOM 생성(상태·정책 없음, `types.ts`만 의존) | 브라우저 |
| `src/qr.ts` | 참가자 링크 QR을 Canvas에 그림(번들 의존 `uqr`, 외부 CDN 없음) | 브라우저 |
| `src/motion.ts` | `prefers-reduced-motion` JS 게이트(컨페티·idle drift) | 브라우저 |
| `src/main.ts` | 운영자 DOM·이벤트·스핀 시퀀스·세션 카드 오케스트레이션 | 브라우저 |
| `src/pick.ts` | 참가자 폼: 세션 로드 → 본인 선택 → 제출/수정 | 브라우저 |
| `src/confetti.ts`·`sound.ts` | 당첨 효과 | 브라우저 |
| `worker/index.ts` | `/api/session*` 라우팅·D1 쿼리·토큰 해시 검증 | Worker |
| `migrations/*.sql` | D1 스키마(`session`·`session_participant`·`session_prize`·`pick`) | — |
| `public/_headers` | CSP allowlist (외부 CDN 추가 시 동기화) | — |

## 세션 API (`worker/index.ts`)

| 메서드·경로 | 인증 | 동작 |
|-------------|------|------|
| `POST /api/session` | — | 명부·상품 등록, `{ sessionId, adminToken }` 201 |
| `GET /api/session/:id` | — | 참가자용 명부·상품·마감 여부 |
| `PUT /api/session/:id/pick` | claim 토큰(수정 시) | 참가자 행 원자적 교체. 마감 후·토큰 불일치 거부 |
| `POST /api/session/:id/close` | 운영자 Bearer | 접수 마감(멱등) |
| `GET /api/session/:id/snapshot` | 운영자 Bearer | 마감 후에만 `picks` 반환(열려 있으면 409) |
| `DELETE /api/session/:id` | 운영자 Bearer | 세션·명단·상품·선택 행 일괄 삭제 |

토큰은 평문 저장하지 않는다 — D1엔 SHA-256 hex만. 운영자 토큰은 운영자 localStorage의
`state.session.adminToken`에만 있다.

## 핵심 불변식

추첨↔연출 각도 규약과 모드 불변식은 **AGENTS.md "Golden Principles"가 단일 출처**. 여기서
중복하지 않음. 요지: `selectWinner`가 당첨 결정 → 회전은 `wedgeAtPointer`가 가리키는 칸이 그
결과와 일치하도록만 계산. 선호 모드는 `candidatesFor`로 후보 집합만 바꾸고, pull 이후 추첨은
오프라인이다.
