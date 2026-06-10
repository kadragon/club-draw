# DESIGN.md — club-draw

동호회 현장 추첨 SPA의 비주얼 규약. 팔레트·타이포·레이아웃의 단일 출처.
토큰 정의는 `src/style.css`의 `:root`, 원판 색은 `src/wheel.ts`의 `PALETTE`에 산다 —
이 문서는 그 의도를 설명한다.

## 분위기

크림빛 캔버스(`--canvas` #fffaf0) 위에 near-black 잉크, 파스텔 원판, 따뜻한 그라데이션 메시.
무대(stage) 모드에서는 양 사이드 패널이 사라지고 원판이 화면을 채운다 — 프로젝터 발표용.

## 색

### UI 토큰 (`src/style.css :root`)

- **표면**: `--canvas` #fffaf0 (기본 바닥, 크림 틴트) · `--surface-soft` #faf5e8 ·
  `--surface-card` #f5f0e0 · `--surface-strong` #ebe6d6 · `--card` #fffdf8
- **잉크/텍스트**: `--ink`/`--body-strong` 계열 near-black, `--body` #3a3a3a,
  `--muted` #6a6a6a, `--muted-soft` #9a9a9a
- **Primary CTA**: `--primary` #0a0a0a (near-black), `--primary-active` #1f1f1f,
  `--on-primary` #ffffff
- **브랜드 액센트**: `--pink` #ff4d8b · `--teal` #1a3a3a · `--lavender` #b8a4ed ·
  `--peach` #ffb084 · `--ochre` #e8b94a · `--coral` #ff6b5a · `--mint` #a4d4c5
  — 브랜드 마크 그라데이션·메시 배경·뱃지 강조에 사용
- **상태**: `--error` #ef4444
- **라인**: `--hairline` #e5e5e5, `--hairline-soft` #f0f0f0

### 원판 팔레트 (`src/wheel.ts` PALETTE)

참가자 한 명당 한 색 — 30색까지. 6색 순환이 아니라 각자 식별 가능한 고유색이 필요해서다.

- 색조는 **황금각 137.508°**로 배분 → 이웃한 칸끼리 강한 대비.
- 채도/명도 3밴드 회전(`sat=[0.55,0.48,0.6]`, `light=[0.82,0.86,0.78]`)으로 근접 색조 분리.
- **파스텔 계약**: `light ≥ ~0.78`을 지켜 모든 칸 휘도 > 0.5 → 라벨 잉크(`LABEL_INK`)가
  어두운색으로 해석됨. 팔레트를 어둡게 바꾸면 일부 라벨이 흰색으로 뒤집힌다 — 가독성 재확인 필수.

## 타이포

- **본문**: `--font` = `Pretendard Variable`(폴백: 시스템 한글 산세리프). 모든 UI·라벨.
- **강조**: `--font-display` = `Black Han Sans` — 둥글고 묵직한 디스플레이 페이스.
  현재 상품명, 당첨자 리빌 등 무대 강조 텍스트에만. 본문에 섞으면 시스템 위반.
- `font-feature-settings: "tnum"`을 수치 입력(누적 횟수, 회전 시간)에 적용.

## 레이아웃

- **셋업 모드**: 3열 그리드 — 좌(참가자) · 중앙(원판) · 우(상품/기록). 사이드 패널은
  내부 스크롤, 중앙 원판은 고정. `body`는 `100dvh` 뷰포트 락(페이지 자체는 안 늘어남).
- **무대 모드**(`body.stage-mode`): `.panel-left/.panel-right/.setup-only` 숨김,
  원판이 `min(58vh,90vw,880px)`로 확대, START 버튼이 원판 중앙에서 커진다.
- **START 게이트**: 셋업에서는 키보드/SR 도달은 되지만 `disabled`(툴팁 안내). 추첨은
  무대 모드에서만 시작 — `syncControls`가 stage 여부로 게이트한다.

## 모션 (연출 전용, 공정성 불변식과 분리)

- **스핀 이징**(`makeSpinEase`, `src/wheel.ts`): 4단계 속도 적분 곡선.
  1. **Anticipation**: ~100ms CCW 와인드업 — e(t) 살짝 음수로 당겼다가 발사.
  2. **Hard launch**: 피크 속도로 빠른 가속 — 기존보다 또렷한 출발감.
  3. **Body decel**: 피크 → 크롤 속도로 선형 감속.
  4. **Tail crawl**: 마지막 ~2–3s 졸깃한 정지.
  끝점 고정(e(0)=0, e(1)=1) — 추첨 결과 = 멈춤 칸 불변.
- **Ghost motion trails** (캔버스 내): 고속 시 라벨 없는 색 링 2개를 회전 오프셋으로 뒤에 그려
  모션블러 연출. 속도가 낮아지면 자연소멸. 프로젝터 jank 방지 위해 텍스트 재렌더 없음.
- **Rim glow** (캔버스 내): 바깥 림에 따뜻한 크림 방사 그라데이션 — 빠를 때 밝고 느려지며 식음.
  `--canvas` 크림 톤과 충돌 없게 `rgba(255, 252, 210, …)` 색조.
- **Landing punch** (CSS class): `onDone` 시 `.wheel-wrap.landed` 토글 → scale 1→1.046→0.982→1
  (270ms). `prefers-reduced-motion`에서 suppressed.
- **유휴 드리프트·리빌 펄스·포인터 플랩**: 무대가 살아있게 하는 ambient 모션.
- **reduce-motion**: OS 설정 존중. Canvas 모션은 JS(`spinMs`)로 조절, CSS 장식 애니메이션만 off.

## 규칙

- 새 색은 위 토큰/팔레트 안에서. 인라인 hex 금지 — `var(--token)` 또는 PALETTE 사용.
- 인라인 스타일 금지(CSP가 `style-src 'unsafe-inline'` 미허용) → 클래스로.
- 무대 강조만 `--font-display`. 나머지는 `--font`.
