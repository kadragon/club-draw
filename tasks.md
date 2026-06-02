# tasks

## Review Backlog

### PR #1 — [FEAT] stage mode + Clay restyle + suspense spin (2026-06-02)

- [ ] [debt] Tighten CSP: drop `style-src 'unsafe-inline'` by moving `confetti.ts` `canvas.style.cssText` to a CSS class (apply on create, remove on teardown), then update `public/_headers` (source: security-review, pr-review-toolkit:review-pr) — public/_headers:2, src/confetti.ts:477
- [ ] [debt] Add `turns >= 1` assert (or explanatory comment) in `computeTargetRotation`; the `spinTo` forward-spin guard `while (target <= r0 + Math.PI)` is dead at runtime today but would silently add a revolution if a future caller passes `turns = 0` (source: pr-review-toolkit:review-pr) — src/wheel.ts:245, src/draw.ts
- [ ] [debt] Replace `wedgeAtPointer` unreachable trailing `return wheel.wedges.length - 1` with an explicit `// unreachable` marker for clarity (source: pr-review-toolkit:review-pr) — src/draw.ts:107
