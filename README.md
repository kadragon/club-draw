# Club Draw — 동호회 룰렛 추첨

현장에서 운영자 1명이 화면에 띄워 진행하는 원판 룰렛 추첨 웹앱.
**공정성 보장**: 당첨자는 crypto 가중 추첨으로 먼저 결정되고, 원판 회전은 이미 정해진
칸에 멈추는 순수 연출이다. 회전 속도·물리와 무관하게 결과는 동일하다.

## 기능

- 중앙 START → 회전 → 1명 추첨, 상품 목록 **순서대로** 진행.
- **누적 당첨이 많을수록 칸이 적게** 배정(`slots = max(1, base − 누적당첨)`) → 당첨 확률↓, 시각적으로도 작은 칸.
- 세션 당첨자는 이후 추첨에서 제외(원판에서 사라짐).
- 당첨 기록 + **CSV 내보내기**, 명단 **붙여넣기 / CSV 가져오기**, 컨페티 + 사운드.
- 상태는 전부 `localStorage`에 저장(서버 없음).

## 두 가지 제외 메커니즘 (구분)

| | 효과 | 변화 시점 |
|---|---|---|
| **세션 당첨** (`excluded`) | 다음 추첨에서 완전 제거 | 당첨 즉시 자동 |
| **누적 과거 당첨** (`cumulativeWins`) | 칸 수만 줄임(최소 1칸) | 운영자가 직접 입력. 세션 중 자동 증가 안 함 |

## 개발

```bash
bun install
bun run dev        # Vite 개발 서버
bun run test       # Vitest (불변식·RNG·칸·CSV 테스트)
bun run build      # tsc --noEmit + vite build → dist/
```

## 배포 (Cloudflare Workers Static Assets)

```bash
bun run cf:dev     # build 후 wrangler dev 로컬 확인
bun run deploy     # build 후 wrangler deploy
```

별도 Worker 스크립트 없이 `dist/`를 정적 자산으로 서빙한다(`wrangler.jsonc`의 `assets`).

## 스택

Vite + TypeScript(vanilla) + Canvas. 프레임워크 없음. 미학은 `DESIGN.md`(Stripe) 토큰 기반.
