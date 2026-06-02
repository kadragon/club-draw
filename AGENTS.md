# AGENTS.md — club-draw

소형 vanilla TS SPA. 에이전트가 반드시 지켜야 할 불변식과 작업 규칙.

## Docs Index (필요할 때만 읽기)

- `docs/architecture.md` — 모듈 책임·의존 방향
- `docs/runbook.md` — 명령·배포 체크·실패 모드
- `backlog.md` — 작업 큐
- `DESIGN.md` — 비주얼/팔레트/레이아웃

## Golden Principles — 핵심 불변식 (절대 깨지 말 것)

**당첨자는 `selectWinner`(crypto 가중 추첨)로 먼저 결정되고, 원판 회전은 그 결과를 연출만 한다.**
회전 각도/속도/turns/jitter 무엇을 바꿔도, 멈췄을 때 포인터 아래 칸 = 추첨된 칸이어야 한다.

- 각도 규약(`src/draw.ts` ↔ `src/wheel.ts`가 공유):
  - 휠 공간 각도 φ는 상단(12시)에서 **시계방향**으로 증가.
  - 회전 R 적용 시 포인터 아래 칸 = `φ = (−R) mod 2π` → `wedgeAtPointer`.
  - Canvas는 3시 기준이므로 그릴 때 `canvasAngle = φ − π/2`, `ctx.rotate(+R)`, 포인터는 상단 고정.
- 이 규약을 바꾸면 **두 파일을 함께** 바꾸고, 부호 뒤집기 테스트로 검증할 것(아래).

## TDD / 검증

- 행위 변경은 Red → Green. `src/draw.ts`, `src/csv.ts`는 순수 함수, `test/`에서 커버.
- **순환 테스트 금지**: 각도 규약은 손계산한 **절대값** assert로 고정한다(`test/draw.test.ts`의
  "absolute physical convention" 블록). round-trip만으로는 부호 오류를 못 잡는다.
- 회귀 가드: `wedgeAtPointer`의 `norm(-rotation)` 또는 `computeTargetRotation`의 `norm(-target)`
  부호를 뒤집으면 테스트가 **빨개져야** 한다.
- 크로스모듈(draw↔canvas) 바인딩은 브라우저에서만 검증 가능 → 변경 시 실제 스핀 후
  "포인터 아래 이름 == 표시된 당첨자" 확인(개발 빌드에 `window.__cd` 시드, prod에서 strip됨).

## 명령

```bash
npm run lint       # biome check (lint+format) — 필수: 통과해야 커밋
npm run lint:fix   # biome 자동 수정(safe+unsafe)
npm test           # 필수: 통과해야 커밋
npm run build      # tsc --noEmit + vite build
npm run cf:dev     # wrangler dev 로컬 확인
```

> 정적 분석 = Biome(`biome.json`). recommended 규칙 + 포맷. `noNonNullAssertion` off(DOM `!` 관용),
> tsconfig `strict`가 타입 가드. pre-commit/CI 게이트에 `npm run lint` 포함.

## 규칙

- 누적 당첨(`cumulativeWins`)은 세션 당첨으로 **자동 증가시키지 말 것**(역사적 이월값, 운영자 입력).
- DOM 삽입은 `textContent`만(이름은 사용자 입력). `innerHTML`은 비우기 용도로만(`replaceChildren()`).
- 새 색은 DESIGN.md 그라데이션 팔레트 안에서. 본문 폰트 `Pretendard Variable`, 강조(당첨자·현재 상품)는 `--font-display`(`Black Han Sans`).

## Gotchas (이 세션서 막힌 것)

- **TS 5.7 typed-array 제네릭**: Web Crypto 래퍼/주입 타입은 `Uint32Array<ArrayBuffer>`로.
  맨 `Uint32Array`는 `<ArrayBufferLike>`로 추론돼 `crypto.getRandomValues`에 할당 불가.
- **vitest 설정**: `vite.config.ts`의 `test` 키는 `defineConfig`를 `vitest/config`에서 임포트(아닌 `vite`).
- **CSP/_headers**: 외부 CDN(폰트 등) 추가 시 `public/_headers` CSP allowlist도 갱신.
  `wrangler dev`가 로컬서 `_headers`를 적용 → 배포 전 `curl -sI`로 CSP 헤더 + 브라우저 콘솔(위반 0) 검증.

## Token Economy

- 이 맵을 먼저 읽고, 세부는 `docs/`를 **필요할 때만** 연다. 전부 미리 읽지 말 것.
- `*.png`(스크린샷)·`dist/`·`node_modules`·`package-lock.json`은 읽지 말 것(`.claudeignore`).
- 넓은 검색은 본문 직접 읽기보다 `Explore`/grep으로.

## Maintenance

이 파일은 **맵**(목표 ≤100줄). 아래 4조건 **모두** 충족할 때만 추가:
1. 불변식·규칙이라 깨지면 버그/회귀가 난다, 2. 코드/CLAUDE.md/git 이력에서 자명하지 않다,
3. 한 줄로 줄일 수 없다, 4. 세부는 `docs/`에 두고 여기엔 포인터만.
워크플로 세부·아키텍처 심화는 `docs/`로. 줄이 늘면 "지우면 실수가 나나?"로 가지치기.

