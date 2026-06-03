# tasks

## Review Backlog

All actionable items cleared on branch `chore/groom-review-backlog` (commits below).
Remaining lines are REJECTED (false positives) or DEFERRED (needs operator action).

### PR #8 — [FEAT] ambient wheel motion: idle drift, pointer flap, reveal pulse (2026-06-03)

- [REJECTED] Multiply flap `speed` by 1000 to "fix a rad/ms→rad/s unit mismatch" (agy P1). **Won't fix — false positive.** `FLAP_KICK = 1500` already bakes the rad/ms→rad/s conversion *plus* gain together (peak `kick = 0.025 rad/ms × 1500 ≈ 37`, clamped to `FLAP_VMAX = 9` in the fast phase; below ~0.006 rad/ms it scales 9→0 — the intended punch-then-fade). Agy's change (leaving FLAP_KICK=1500) pins kick at the clamp through the whole suspense tail, so the flap stays maxed until the last instant and the fade dies. Makes it worse. — src/wheel.ts:420
- [CLOSED — won't-fix cosmetic] Reveal pulse grows `lineWidth` on the fixed wedge path rather than expanding an outward ring radius (agy P2). Reviewed: cosmetic preference, not a bug; current thickening-then-fading outline is intended. Revisit only if a true expanding halo is wanted (`ctx.arc(0,0,radius + revealPulse*25, …)`) — src/wheel.ts:281
- [DONE — commit REFACTOR dedup] DRY: `reduceMotion()`/`prefersReducedMotion()` duplicate matchMedia query. Extracted to shared `src/motion.ts`; both modules import it.
- [DONE — commit REFACTOR dedup] No `prefers-reduced-motion` change subscription. Added `matchMedia(...).addEventListener("change", refreshIdle)` at boot so a mid-session OS toggle is honored.

### PR #7 — [FEAT] auto-derive base slots + UI polish (2026-06-03)

- [DONE — commit FEAT START a11y] START hidden via `display:none` in setup (keyboard/SR regression). Resolved per user decision: START now renders in setup, `disabled` with an explanatory tooltip, and `syncControls` keys the spin gate on stage-mode so the draw still can't begin before presenting. NOTE: `disabled` restores SR/a11y-tree discoverability (verified in the snapshot) but is skipped in tab order — it is NOT a keyboard tab-stop. If a focusable setup tab-stop is later wanted, switch to `aria-disabled="true"` + keep it focusable + guard the click handler — src/main.ts, src/style.css
- [DONE — commit FEAT START a11y] Fairness copy dropped the golden-principle statement. Restored a one-line "추첨이 먼저" point: winner is decided before the spin; rotation only presents the result — index.html
- [DONE — commit REFACTOR dedup] `effectiveBaseSlots(state.participants)` called twice per spin. Wrapped in a `currentBaseSlots()` helper; both call sites (rebuildWheel, spin) now symmetric — src/main.ts
- [DONE — commit DOCS] Added a `loadState` comment noting the legacy `baseSlots` key in stored `club-draw:v1` JSON is intentionally ignored (no migration) — src/state.ts

### PR #6 — [HARNESS] pin account_id for local wrangler deploy (2026-06-03)

- [REJECTED] Remove hardcoded `account_id` from `wrangler.jsonc`. Flagged by 3/4 reviewers. **Won't fix.** (a) A Cloudflare account_id is a non-secret identifier, not a credential — grants no access without a separately-held API token; safe in source control. (b) Committing it is the PR's deliberate purpose and serves local deploy better than a per-dev env var. — wrangler.jsonc:4
- [DEFERRED — user decision] CI deploy job absent. User opted to keep manual `bun run deploy`; a `jobs.deploy` (needs test, main-only) with `CF_API_TOKEN`/`CF_ACCOUNT_ID` secrets can be added later once secrets are set — .github/workflows, package.json
- [CLOSED — moot] Version bump bundled into a `[HARNESS]` commit. A **local** `.git/hooks/post-commit` auto-bumps the version per commit type, so version churn is no longer hand-bundled into feature commits. (Local hook — not tracked in the repo; clones won't have it until set up.) — package.json

### PR #1 — [FEAT] stage mode + Clay restyle + suspense spin (2026-06-02)

- [DONE — commit CONSTRAINT CSP] Tightened CSP: dropped `style-src 'unsafe-inline'` by moving `confetti.ts`'s `canvas.style.cssText` to a `.confetti-canvas` class and updating `public/_headers`. Verified with wrangler dev (curl header + zero browser CSP violations across a full spin→confetti cycle) — public/_headers, src/confetti.ts
- [DONE — commit DOCS] Documented `computeTargetRotation`'s `turns >= 1` expectation; the `spinTo` forward-spin guard `while (target <= r0 + Math.PI)` is the runtime backstop — src/wheel.ts, src/draw.ts
- [DONE — commit DOCS] Marked `wedgeAtPointer`'s trailing `return wheel.wedges.length - 1` as an unreachable FP-safety fallback (`norm()` yields `[0,2π)`, wedges contiguous) — src/draw.ts

### PR #5 — [FEAT] winner reveal spotlight + reduced-motion + focus-visible (2026-06-02)

- [DONE — commit TEST highlightState] Extracted the `setHighlight` `isWinner`/`dim` decision into a pure `highlightState(highlightId, wedgeId)` in `src/draw.ts`, called from render(), and covered it in `test/draw.test.ts` (null / match / non-match) — src/draw.ts, src/wheel.ts, test/draw.test.ts

### PR #2 — [FEAT] on-screen draw results, pastel wheel, favicon (2026-06-02)

- [DONE — commit DOCS] Root `DESIGN.md` rewritten with the real club-draw palette/typography/layout/motion spec (replacing the leftover Clay.com analysis); AGENTS.md:10 pointer now valid — DESIGN.md

### PR #9 — review-cycle out-of-scope items (2026-06-03)

- [ ] [decision] START `disabled` in setup restores SR/a11y-tree discoverability but is skipped in tab order — keyboard-only users still can't `Tab` to it. Full fix = `aria-disabled="true"` + `tabindex="0"` + a click guard (`if aria-disabled return`) instead of HTML `disabled`. Deferred per the original START decision; revisit if a setup keyboard tab-stop is wanted (source: pr-review-toolkit:review-pr P1) — src/main.ts, index.html
- [ ] [debt] Boot `matchMedia(...).addEventListener("change", refreshIdle)` doesn't retain the `MediaQueryList` reference, so the listener can't be removed later. No impact for a page-lifetime SPA; retain the ref if teardown/HMR cleanup is ever added (source: pr-review-toolkit:review-pr P2) — src/main.ts
- [ ] [debt] `src/motion.ts` is a single-export 3-line module. Fine as the dedup target; if no second motion util appears, a future pass could fold it into a shared `utils.ts` (source: pr-review-toolkit:review-pr P3) — src/motion.ts
