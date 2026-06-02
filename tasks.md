# tasks

## Review Backlog

### PR #1 — [FEAT] stage mode + Clay restyle + suspense spin (2026-06-02)

- [ ] [debt] Tighten CSP: drop `style-src 'unsafe-inline'` by moving `confetti.ts` `canvas.style.cssText` to a CSS class (apply on create, remove on teardown), then update `public/_headers` (source: security-review, pr-review-toolkit:review-pr) — public/_headers:2, src/confetti.ts:477
- [ ] [debt] Add `turns >= 1` assert (or explanatory comment) in `computeTargetRotation`; the `spinTo` forward-spin guard `while (target <= r0 + Math.PI)` is dead at runtime today but would silently add a revolution if a future caller passes `turns = 0` (source: pr-review-toolkit:review-pr) — src/wheel.ts:245, src/draw.ts
- [ ] [debt] Replace `wedgeAtPointer` unreachable trailing `return wheel.wedges.length - 1` with an explicit `// unreachable` marker for clarity (source: pr-review-toolkit:review-pr) — src/draw.ts:107

### PR #5 — [FEAT] winner reveal spotlight + reduced-motion + focus-visible (2026-06-02)

- [ ] [constraint] Extract `setHighlight` `isWinner`/`dim` decision into a pure function and cover in `test/`; the reveal-spotlight selection logic is browser-only render code today with zero unit coverage (source: pr-review-toolkit:review-pr) — src/wheel.ts:209

### PR #2 — [FEAT] on-screen draw results, pastel wheel, favicon (2026-06-02)

- [ ] [debt] Root `DESIGN.md` still holds the Clay.com design analysis (not club-draw); `clay/DESIGN.md` was deleted but AGENTS.md:10 still points to `DESIGN.md`. Either replace root `DESIGN.md` with real club-draw palette/layout docs or update the AGENTS.md pointer (source: pr-review-toolkit:review-pr) — DESIGN.md, AGENTS.md:10
