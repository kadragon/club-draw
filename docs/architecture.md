# Architecture — club-draw

Vanilla TS SPA. 추첨 결과를 **먼저 결정**하고 원판은 연출만. 빌드 후 정적 자산을
Cloudflare Workers가 SPA로 서빙(`wrangler.jsonc` → `dist/`).

## 의존 방향 (단방향)

```
types.ts        도메인 모델만. 의존 없음.
   ↑
draw.ts  csv.ts  state.ts   순수 로직 / 영속화. DOM 의존 없음.
   ↑       ↑        ↑
wheel.ts confetti.ts sound.ts   브라우저 효과(Canvas/Audio).
   ↑
main.ts         DOM 배선 + 오케스트레이션. 위 전부를 묶는 유일한 진입점.
```

규칙: 화살표 거꾸로 의존 금지. `draw.ts`/`csv.ts`는 `window`/`document`/Canvas를
참조하지 않는다(테스트 가능성 유지). 효과 모듈은 도메인 로직을 호출하지 않는다.

## 모듈 책임

| 파일 | 책임 | 순수? |
|------|------|-------|
| `src/types.ts` | 도메인 인터페이스(Participant·Prize·Settings·Wheel·Wedge…) | — |
| `src/draw.ts` | `selectWinner`(crypto 가중 추첨)·`buildWheel`·`computeTargetRotation`·`wedgeAtPointer` | ✅ 테스트됨 |
| `src/csv.ts` | `parseRoster`·`recordsToCSV` | ✅ 테스트됨 |
| `src/state.ts` | localStorage 로드/저장(`club-draw:v1`), 부분/손상 페이로드 허용 | ✅ |
| `src/wheel.ts` | Canvas 렌더. 3시 기준 → `canvasAngle = φ − π/2` | 브라우저 |
| `src/main.ts` | DOM·이벤트·스핀 시퀀스 오케스트레이션 | 브라우저 |
| `src/confetti.ts`·`sound.ts` | 당첨 효과 | 브라우저 |
| `public/_headers` | CSP allowlist (외부 CDN 추가 시 동기화) | — |

## 핵심 불변식

추첨↔연출 각도 규약은 **AGENTS.md "핵심 불변식"이 단일 출처**. 여기서 중복하지 않음.
요지: `selectWinner`가 당첨 결정 → 회전은 `wedgeAtPointer`가 가리키는 칸이 그 결과와
일치하도록만 계산(`draw.ts` ↔ `wheel.ts` 공유 규약).
