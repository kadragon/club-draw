# 선호 기반 추첨 모드 (Preference Draw Mode)

## Problem Statement

현재 club-draw는 상품 목록을 순서대로 돌면서 **매번 미당첨자 전원**을 후보로 추첨한다.
누가 어떤 상품을 원하는지는 전혀 반영되지 않아, 관심 없는 경품이 당첨되고 정작 원하던
사람은 이미 제외되는 배정이 자주 나온다. 상품 가치 편차가 큰 행사일수록 체감 불만이 크다.

현장에서 선호를 모으려면 참가자 입력 경로가 필요한데, 저장소는 현재 **순수 클라이언트
SPA**다(localStorage `club-draw:v1`, Cloudflare Workers가 `dist/`를 정적 서빙, 바인딩 없음).
즉 선호 수집은 기능 추가가 아니라 **백엔드 신설**이다. 동시에 무대 위 추첨이 네트워크에
묶이면 안 되므로, 백엔드를 들이되 추첨 경로는 오프라인으로 유지해야 한다.

## Solution

앱에 **추첨 방식 토글(전원 / 선호)** 을 둔다. 기존 전원 모드는 코드·동작·저장 스키마가
그대로다. 선호 모드는 다음 4단계로 동작한다.

1. **세션 개설** — 운영자가 명부·상품을 D1에 올려 세션을 만든다. 서버가 `sessionId`와
   운영자 토큰을 돌려주고, 화면에 `/pick?s={sessionId}` QR을 띄운다(스크린·인쇄물 공용 1개).
2. **선택 접수** — 참가자가 폰으로 QR을 열어 명부에서 본인을 찾고 상품을 **최대 3개** 고른다.
   서버는 `participant_id` UNIQUE로 1인 1제출을 강제하고, 제출 시 발급한 클레임 토큰을
   참가자 브라우저에 저장해 마감 전까지 본인 선택 수정을 허용한다.
3. **마감 + 스냅샷 pull** — 운영자가 접수를 닫고 **1회** 선택 결과를 내려받아 로컬
   `AppState`에 박는다. 이 시점 이후 추첨·원판·기록·CSV는 전부 오프라인이다.
4. **추첨** — 상품별 후보 = `그 상품 선택자 ∩ 미당첨자`. 후보가 0명이면 **미당첨자 전원**으로
   폴백하고 화면에 폴백 배지를 띄운다. 후보 집합만 바뀔 뿐, 가중치(`cumulativeWins` 핸디캡)와
   `selectWinner` → 원판 각도 규약은 손대지 않는다.

선례로 RandomPicker의 *Preferred Prizes* 모듈이 같은 형태(선호 지정 → 해당 추첨만 후보)이고,
EasyRaffle·Raffleway가 앱 설치 없이 QR로 폰 응모를 받는 패턴을 쓴다.

## User Stories

- 참가자로서, QR을 찍어 원하는 상품을 최대 3개 고르고 싶다. 관심 있는 경품 추첨에만
  들어가기 위해서다.
- 참가자로서, 마감 전까지 내 선택을 고치고 싶다. 잘못 눌렀을 때 운영자를 찾지 않기 위해서다.
- 운영자로서, 명부·상품을 올리면 QR 하나가 나오길 바란다. 개인별 링크를 배포하지 않기 위해서다.
- 운영자로서, 접수를 닫고 결과를 한 번 내려받고 싶다. 무대에서 인터넷이 끊겨도 행사가
  멈추지 않기 위해서다.
- 운영자로서, 아무도 고르지 않은 상품도 추첨이 진행되길 바란다. 재고가 남지 않기 위해서다.
- 운영자로서, 기존 전원 방식도 그대로 쓰고 싶다. 선호를 모을 시간이 없는 행사를 위해서다.

## Implementation Decisions

### 백엔드: Cloudflare Worker + D1

이미 `wrangler`로 배포 중이라 D1 바인딩 추가가 가장 짧은 경로다. SQL UNIQUE 제약이 1인
1제출을 서버에서 강제하고, 상품별 후보 집계가 조인 한 번이다. KV는 결과적 일관성이라
"제출했는데 운영자 화면에 없다"가 가능하고, Durable Object는 실시간 브로드캐스트를 위해
WebSocket 배선까지 끌고 와야 해 이번 범위에 과하다.

Worker 엔트리는 **신규**다(현재 `wrangler.jsonc`는 `assets`만 있고 `main` 없음).
`main`을 추가하고 `assets.binding`으로 정적 자산을 넘겨, `/api/*`는 Worker가 처리하고
나머지는 기존처럼 SPA 자산으로 떨어뜨린다.

스키마(초안):

```sql
CREATE TABLE session (
  id TEXT PRIMARY KEY, admin_token_hash TEXT NOT NULL,
  closed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE session_participant (
  session_id TEXT NOT NULL, participant_id TEXT NOT NULL, name TEXT NOT NULL,
  PRIMARY KEY (session_id, participant_id)
);
CREATE TABLE session_prize (
  session_id TEXT NOT NULL, prize_id TEXT NOT NULL, name TEXT NOT NULL, ord INTEGER NOT NULL,
  PRIMARY KEY (session_id, prize_id)
);
CREATE TABLE pick (
  session_id TEXT NOT NULL, participant_id TEXT NOT NULL, prize_id TEXT NOT NULL,
  claim_hash TEXT NOT NULL, at TEXT NOT NULL,
  PRIMARY KEY (session_id, participant_id, prize_id)
);
```

1인 최대 3개는 서버가 제출 트랜잭션에서 **원자적 교체**(해당 참가자 행 delete → insert)로
검증한다. 부분 제출·중복 행은 존재할 수 없다.

### 신원 확인: 공용 QR + 명부 본인 선택

QR 하나만 띄우면 되고 배포 운영 부담이 없다. 제출 시 서버가 클레임 토큰을 발급해 참가자
localStorage에 저장하고, 수정 요청은 그 토큰을 요구한다(토큰 없는 재제출은 이미 제출된
participant면 409). 사칭은 이론상 가능하나 동아리 규모에서 실질 리스크가 낮고, PIN·개인
토큰 QR은 둘 다 운영 비용이 이득보다 크다고 판단했다.

### 추첨 규칙

- **후보** — `candidatesFor(state, prize)`: 선호 모드면 `picks[prize.id] ∩ 미당첨자`,
  전원 모드면 기존 `candidatesFrom`. `draw.ts`에 순수 함수로 추가한다.
- **폴백** — 후보 0명 → 미당첨자 전원. 함수는 후보 배열과 `fellBack: boolean`을 함께
  반환해, UI가 폴백 배지를 띄우는 근거를 추측하지 않게 한다.
- **1인 1회** — 두 모드 공통. 기존 `excluded` 플래그를 그대로 쓴다.
- **가중치** — `effectiveBaseSlots`는 지금처럼 **전체 명부**로 계산한다(후보 부분집합이
  아니라). 상품마다 base가 출렁이면 핸디캡 의미가 무너진다.
- **상품 순서가 결과에 영향을 준다.** 앞 순번 상품의 당첨자가 뒤 상품 후보에서 빠지므로,
  이 방식은 배정이론의 **RSD(Random Serial Dictatorship)** 와 같은 성질을 갖는다 —
  strategyproof·비례공정하지만 envy-free는 아니다(내가 못 받은 상품을 남이 받는 상황이
  구조적으로 생길 수 있다). PS(Probabilistic Serial)는 envy-free지만 전략조작 여지가 있고
  현장 설명이 불가능해 채택하지 않았다. 운영자는 **상품 순서를 미리 공지**하는 것이 좋다.

### 상태·호환성

`club-draw:v1` 키와 스키마를 유지하고 필드만 더한다: `settings.mode: "all" | "preference"`,
`picks: Record<prizeId, participantId[]>`, `session: { id, closedAt } | null`. `loadState`는
지금도 부분/손상 페이로드를 관용하므로 구버전 페이로드는 기본값(`mode: "all"`, 빈 picks)으로
그대로 로드된다. 마이그레이션 코드는 없다.

### 프런트엔드 구성

- 참가자 화면은 **별도 진입점** `pick.html`(vite rollup input 추가). 운영자 SPA와 CSS·폰트는
  공유하되 번들은 분리해, 폰에서 Canvas·컨페티·사운드를 받지 않게 한다.
- QR은 **번들 의존성**으로 생성한다(외부 CDN 아님) — `_headers` CSP를 건드리지 않고
  오프라인에서도 QR이 뜬다. 대신 `connect-src`에 자기 오리진만 있으면 되므로 CSP 변경은
  `/api` 호출 기준 불필요하다(이미 `'self'`).
- DOM 삽입은 기존 규칙대로 `textContent`만. 상품·참가자 이름은 전부 사용자 입력이다.

## Testing Decisions

- **순수 로직(vitest, `test/`)** — `candidatesFor`의 교집합·폴백·`fellBack` 플래그,
  선택 제출 검증(최대 3개·중복 제거·미지 상품 id 거부), 확장된 `loadState`의 구버전
  페이로드 하위호환과 손상 `picks` 관용, 모드별 `selectWinner` 후보 집합.
- **각도 불변식 회귀** — 기존 `test/draw.test.ts`의 절대값 assert 블록은 손대지 않는다.
  후보 집합만 바뀌므로 `wedgeAtPointer`/`computeTargetRotation` 부호 테스트가 계속 빨개져야 한다.
- **Worker API** — `wrangler dev` + 로컬 D1로 계약 테스트: 1인 1제출(중복 409),
  4개 제출 거부, 마감 후 제출 거부, 토큰 없는 수정 거부, 스냅샷 pull 응답 형태.
- **게이트** — `bun run lint`, `bun run test`, `bun run build` 전부 green.
- **수동 검증** — `bun run cf:dev`에서 폰(또는 두 번째 브라우저 프로필)으로 QR 흐름을
  한 바퀴 돌린 뒤, pull → 네트워크 끊고 → 끝까지 추첨. 스핀 후 "포인터 아래 이름 ==
  표시된 당첨자" 확인(크로스모듈 바인딩은 브라우저에서만 검증 가능).
- **CSP** — 배포 전 `curl -sI`로 헤더 확인 + 브라우저 콘솔 위반 0.

## Out of Scope

- 개인별 토큰 QR 배포, PIN·로그인 인증
- 실시간 접수 현황 브로드캐스트(WebSocket/DO)
- 상품별로 모드를 섞는 혼합 진행
- 선호 **순위** 가중(1~3순위 차등) — 이번엔 3개 모두 동등
- 유찰 처리(아무도 안 고른 상품 건너뛰기)
- 기존 localStorage 데이터의 서버 마이그레이션

## Not yet specified

- 명부가 큰 경우 `/pick` 초기 로드 크기 — 수백 명 이름을 한 번에 내려줄지 검색 API로 뺄지.
  실제 명부 규모를 확인한 뒤 결정.

## Further Notes

- **위험: 운영자 토큰 분실.** 세션 개설 화면을 새로고침하면 토큰이 사라져 마감·pull이
  막힌다. 토큰을 운영자 localStorage에 저장하고 화면에 복사 가능한 형태로 노출할 것.
- **위험: 명부를 D1에 올린다 = 이름이 서버에 남는다.** 지금까지 이 앱은 개인정보를 서버로
  보낸 적이 없다. 세션 개설 UI에 이 사실을 명시하고, 마감·행사 종료 후 삭제 경로를 둔다.
  **결정(보존 정책)**: 자동 만료 없이 운영자 수동 삭제로 정리한다. `DELETE /api/session/:id`
  (운영자 토큰)가 세션·명단·상품·선택 행을 한 배치로 지우고, 이후 `/pick?s=`는 404다. 개설 전
  화면이 서버 저장 사실을 고지하고, 운영자 카드의 "서버에서 세션 삭제"가 이 경로를 부른다.
- **후속 후보**: 선호 순위 가중, 접수 현황 실시간 표시, 유찰 처리.
