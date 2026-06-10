import { describe, expect, it } from "vitest";
import { makeSpinEase } from "../src/wheel.js";

describe("makeSpinEase — fairness guards", () => {
  const DURATIONS = [1000, 2000, 5000, 10000, 20000];

  it("e(0) === 0 exactly", () => {
    for (const ms of DURATIONS) {
      expect(makeSpinEase(ms)(0), `ms=${ms}`).toBe(0);
    }
  });

  it("e(1) === 1 exactly", () => {
    for (const ms of DURATIONS) {
      expect(makeSpinEase(ms)(1), `ms=${ms}`).toBe(1);
    }
  });

  it("formula approaches 1 at t→1⁻", () => {
    for (const ms of DURATIONS) {
      expect(makeSpinEase(ms)(1 - 1e-8), `ms=${ms}`).toBeCloseTo(1, 4);
    }
  });

  it("anticipation: e dips below 0 in the wind-up window", () => {
    for (const ms of DURATIONS) {
      // Sample at half of tA — always strictly inside Phase 1 for any durationMs > 0.
      // (tA = min(0.04, 100/ms); at ms=1000 this puts the sample at t=0.02, inside [0, 0.04])
      const e = makeSpinEase(ms);
      const tSample = 0.5 * Math.min(0.04, 100 / ms);
      expect(e(tSample), `ms=${ms} at t=${tSample}`).toBeLessThan(0);
    }
  });

  it("body decelerates: earlier increment > later increment", () => {
    // Body phase spans [tL, tS]. For all durations: tL ≤ 0.10, tS ≥ 0.40.
    // t ∈ [0.15, 0.35] is safely inside the body phase for all valid durations.
    for (const ms of DURATIONS) {
      const e = makeSpinEase(ms);
      const early = e(0.2) - e(0.15);
      const late = e(0.35) - e(0.3);
      expect(early, `ms=${ms}`).toBeGreaterThan(late);
    }
  });

  it("no end-overshoot: e(t) ≤ 1 throughout [0, 1]", () => {
    for (const ms of DURATIONS) {
      const e = makeSpinEase(ms);
      for (let i = 0; i <= 200; i++) {
        expect(e(i / 200), `ms=${ms} t=${i / 200}`).toBeLessThanOrEqual(1 + 1e-10);
      }
    }
  });

  it("monotone tail: e is non-decreasing over [0.7, 1]", () => {
    // tS = 1 - tailTime. tailTime ∈ [0.35, 0.6] → tS ∈ [0.4, 0.65].
    // t=0.7 is safely inside the tail for all valid durations.
    for (const ms of DURATIONS) {
      const e = makeSpinEase(ms);
      let prev = e(0.7);
      for (let i = 1; i <= 30; i++) {
        const t = 0.7 + (i / 30) * 0.3;
        const cur = e(t);
        expect(cur, `ms=${ms} t=${t.toFixed(3)}`).toBeGreaterThanOrEqual(prev - 1e-10);
        prev = cur;
      }
    }
  });
});
