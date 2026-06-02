# Runbook — club-draw

## 명령

```bash
npm install        # 의존 설치
npm run dev        # vite 개발 서버 (HMR)
npm test           # vitest run — 커밋 전 필수, 통과해야 함
npm run test:watch # vitest watch
npm run lint       # biome check (lint+format 검사) — 커밋 전 필수
npm run lint:fix   # biome check --write (safe+unsafe 수정 적용)
npm run format     # biome format --write (포맷만)
npm run typecheck  # tsc --noEmit
npm run build      # tsc --noEmit + vite build → dist/
npm run cf:dev     # build + wrangler dev (로컬서 _headers/CSP 적용)
npm run deploy     # build + wrangler deploy
```

## 배포 전 체크

1. `npm run lint` 그린(biome).
2. `npm test` 그린.
3. `npm run build` 성공(타입 에러 0).
4. 각도 규약/스핀 건드렸으면 브라우저서 실제 스핀 → "포인터 아래 이름 == 표시 당첨자"
   (개발 빌드 `window.__cd` 시드, prod strip).
5. CSP 건드렸으면 `npm run cf:dev` 후 `curl -sI http://localhost:8787` 로 CSP 헤더 +
   브라우저 콘솔 위반 0 확인.

## 실패 모드

| 증상 | 원인/조치 |
|------|-----------|
| `crypto.getRandomValues` 타입 에러 | 주입 타입을 `Uint32Array<ArrayBuffer>`로(맨 `Uint32Array` 금지). AGENTS.md Gotchas. |
| vitest `test` 키 무시됨 | `vite.config.ts`가 `defineConfig`를 `vitest/config`에서 임포트해야 함. |
| 폰트/외부 CDN 차단 | `public/_headers` CSP allowlist 갱신. |
| 스핀 후 당첨자 불일치 | 각도 규약 깨짐 → `test/draw.test.ts` "absolute physical convention" 확인. |

## _workspace/

해당 없음(Lean 하네스, 멀티에이전트 오케스트레이션 미사용).
