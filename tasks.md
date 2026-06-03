# tasks

## Review Backlog

### PR #8 — [FEAT] ambient wheel motion: idle drift, pointer flap, reveal pulse (2026-06-03)

- [REJECTED] Multiply flap `speed` by 1000 to "fix a rad/ms→rad/s unit mismatch" (agy P1). **Won't fix — false positive.** `FLAP_KICK = 1500` already bakes the rad/ms→rad/s conversion *plus* gain together (peak `kick = 0.025 rad/ms × 1500 ≈ 37`, clamped to `FLAP_VMAX = 9` in the fast phase; below ~0.006 rad/ms it scales 9→0 — the intended punch-then-fade). Agy's change (leaving FLAP_KICK=1500) pins kick at the clamp through the whole suspense tail, so the flap stays maxed until the last instant and the fade dies. Makes it worse. — src/wheel.ts:420
- [ ] [decision] Reveal pulse grows `lineWidth` on the fixed wedge path rather than expanding an outward ring radius (agy P2). Cosmetic preference, not a bug; current look is a thickening-then-fading outline. Revisit if a true expanding halo is wanted (`ctx.arc(0,0,radius + revealPulse*25, …)`) — src/wheel.ts:281
- [ ] [debt] DRY: `reduceMotion()` (main.ts) and `prefersReducedMotion()` (wheel.ts) independently define the same `prefers-reduced-motion` matchMedia query (review-pr P3). Extract to a shared util or inject the flag into the wheel — src/main.ts:21, src/wheel.ts:94
- [ ] [decision] No `prefers-reduced-motion` change-event subscription: a mid-session OS toggle isn't honored until the next `refreshIdle()` (review-pr P3). Low value (refreshIdle fires on most actions); add `matchMedia(...).addEventListener("change", refreshIdle)` at boot if desired — src/main.ts:109

### PR #7 — [FEAT] auto-derive base slots + UI polish (2026-06-03)

- [ ] [decision] START hidden in setup via `body:not(.stage-mode) .spin-btn { display: none }` — reviewer flags discoverability/a11y regression (keyboard/SR users can't reach START in setup). Author intent is deliberate gating ("draw can't begin before presenting"). Needs UX call: keep, or swap to `visibility: hidden` / add an affordance (source: pr-review-toolkit:review-pr P1) — src/style.css:822
- [ ] [decision] Fairness copy changed "회전과 무관" → "중복 없는 추첨"; removed the visible statement of the golden principle (winner decided before spin). Consider restoring a one-line mention (source: pr-review-toolkit:review-pr P2) — index.html:222
- [ ] [debt] `effectiveBaseSlots(state.participants)` called twice per spin (rebuildWheel + spin). No real divergence today (pure fn, same input, mutations spin-locked), but a `currentBaseSlots()` helper would make call sites symmetric (source: pr-review-toolkit:review-pr P1/P3) — src/main.ts:81,257
- [ ] [debt] Add a `loadState` comment noting the legacy `baseSlots` key in stored `club-draw:v1` JSON is intentionally ignored (no migration) (source: type-design-analyzer P2) — src/state.ts:55

### PR #6 — [HARNESS] pin account_id for local wrangler deploy (2026-06-03)

- [REJECTED] Remove hardcoded `account_id` from `wrangler.jsonc`. Flagged by 3/4 reviewers (review-pr P0, agy P1; security-review P3 "no fix required"; codex none). **Won't fix.** (a) Security: a Cloudflare account_id is a non-secret identifier, not a credential — appears in dashboard URLs/deploy logs, grants no access without a separately-held API token (security-review 9/10 confidence, codex concurs); safe in source control even for a public repo. (b) Functional/intent: committing it is the PR's deliberate purpose (`pin account_id for local wrangler deploy`) and serves local deploy better than an env var each dev must re-set; removing it reverts the PR. — wrangler.jsonc:4
- [ ] [debt] CI deploy job absent: `bun run deploy` defined in package.json but no `.github/workflows` deploy step runs on main push. Consider a `jobs.deploy` (needs test, main-only) with `CF_API_TOKEN`/`CF_ACCOUNT_ID` secrets (source: pr-review-toolkit:review-pr P3) — .github/workflows, package.json:16
- [ ] [debt] Version bump (`1.1.2→1.1.3`) bundled into a `[HARNESS]` commit; AGENTS.md commit convention separates release/version churn from tooling changes. Split future version bumps into their own commit (source: pr-review-toolkit:review-pr P1) — package.json:3

### PR #1 — [FEAT] stage mode + Clay restyle + suspense spin (2026-06-02)

- [ ] [debt] Tighten CSP: drop `style-src 'unsafe-inline'` by moving `confetti.ts` `canvas.style.cssText` to a CSS class (apply on create, remove on teardown), then update `public/_headers` (source: security-review, pr-review-toolkit:review-pr) — public/_headers:2, src/confetti.ts:477
- [ ] [debt] Add `turns >= 1` assert (or explanatory comment) in `computeTargetRotation`; the `spinTo` forward-spin guard `while (target <= r0 + Math.PI)` is dead at runtime today but would silently add a revolution if a future caller passes `turns = 0` (source: pr-review-toolkit:review-pr) — src/wheel.ts:245, src/draw.ts
- [ ] [debt] Replace `wedgeAtPointer` unreachable trailing `return wheel.wedges.length - 1` with an explicit `// unreachable` marker for clarity (source: pr-review-toolkit:review-pr) — src/draw.ts:107

### PR #5 — [FEAT] winner reveal spotlight + reduced-motion + focus-visible (2026-06-02)

- [ ] [constraint] Extract `setHighlight` `isWinner`/`dim` decision into a pure function and cover in `test/`; the reveal-spotlight selection logic is browser-only render code today with zero unit coverage (source: pr-review-toolkit:review-pr) — src/wheel.ts:209

### PR #2 — [FEAT] on-screen draw results, pastel wheel, favicon (2026-06-02)

- [ ] [debt] Root `DESIGN.md` still holds the Clay.com design analysis (not club-draw); `clay/DESIGN.md` was deleted but AGENTS.md:10 still points to `DESIGN.md`. Either replace root `DESIGN.md` with real club-draw palette/layout docs or update the AGENTS.md pointer (source: pr-review-toolkit:review-pr) — DESIGN.md, AGENTS.md:10
