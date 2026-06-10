import { describe, expect, it } from "vitest";
import { makeSpinEase } from "../src/wheel.js";

describe("makeSpinEase — fairness guards", () => {
  const DURATIONS = [2000, 5000, 10000, 20000];

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

  it("anticipation: e dips below 0 in the wind-up window", () => {
    for (const ms of DURATIONS) {
      // Sample at 60 ms — always inside the anticipation phase for these durations
      // (tA = min(0.04, 100/ms), so 60/ms < tA for all ms in [2000..20000])
      const e = makeSpinEase(ms);
      const t60 = 60 / ms;
      expect(e(t60), `ms=${ms} at t=60ms`).toBeLessThan(0);
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
