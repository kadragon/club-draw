import { describe, expect, it, vi } from "vitest";
import {
  buildWheel,
  candidatesFrom,
  computeTargetRotation,
  randomBelow,
  selectIndex,
  selectWinner,
  slotsFor,
  wedgeAtPointer,
} from "../src/draw.js";
import type { Participant, RandomSource } from "../src/types.js";

const PI = Math.PI;
const TWO_PI = Math.PI * 2;

/** RandomSource stub: each call writes the next queued value into buf[0]. */
function stubRng(...values: number[]): { rng: RandomSource; calls: () => number } {
  let i = 0;
  let calls = 0;
  const rng: RandomSource = {
    getRandomValues: (a) => {
      calls++;
      a[0] = values[Math.min(i, values.length - 1)]!;
      i++;
      return a;
    },
  };
  return { rng, calls: () => calls };
}

function p(name: string, cumulativeWins = 0, excluded = false): Participant {
  return { id: name, name, cumulativeWins, excluded };
}

describe("slotsFor", () => {
  it("base minus cumulative wins", () => {
    expect(slotsFor(p("a", 0), 5)).toBe(5);
    expect(slotsFor(p("a", 2), 5)).toBe(3);
  });
  it("floors at 1 for heavy cumulative winners", () => {
    expect(slotsFor(p("a", 99), 5)).toBe(1);
    expect(slotsFor(p("a", 5), 5)).toBe(1);
  });
  it("reflects base changes", () => {
    expect(slotsFor(p("a", 1), 3)).toBe(2);
    expect(slotsFor(p("a", 1), 8)).toBe(7);
  });
});

describe("candidatesFrom", () => {
  it("drops session winners (excluded)", () => {
    const list = [p("a"), p("b", 0, true), p("c")];
    expect(candidatesFrom(list).map((x) => x.name)).toEqual(["a", "c"]);
  });
});

describe("buildWheel", () => {
  // base 3, cumulative [0,1,2] -> slots [3,2,1], total 6 — one wedge per person,
  // arc proportional to slots (more odds = a wider wedge).
  const wheel = buildWheel([p("a", 0), p("b", 1), p("c", 2)], 3);

  it("slot counts follow the weighting rule", () => {
    expect(wheel.totalSlots).toBe(6);
    expect(wheel.wedges.map((w) => w.slots)).toEqual([3, 2, 1]);
  });

  it("one wedge per participant", () => {
    expect(wheel.wedges).toHaveLength(3);
    expect(wheel.wedges.map((w) => w.participant.name)).toEqual(["a", "b", "c"]);
  });

  it("arc length is proportional to slots", () => {
    // a: 3/6 of 2π = π ; b: 2/6 = 2π/3 ; c: 1/6 = π/3
    expect(wheel.wedges[0]!.end - wheel.wedges[0]!.start).toBeCloseTo(PI, 10);
    expect(wheel.wedges[1]!.end - wheel.wedges[1]!.start).toBeCloseTo((2 * PI) / 3, 10);
    expect(wheel.wedges[2]!.end - wheel.wedges[2]!.start).toBeCloseTo(PI / 3, 10);
  });

  it("wedges are contiguous and cover the full circle", () => {
    expect(wheel.wedges[0]!.start).toBeCloseTo(0, 10);
    expect(wheel.wedges[1]!.start).toBeCloseTo(wheel.wedges[0]!.end, 10);
    expect(wheel.wedges[2]!.start).toBeCloseTo(wheel.wedges[1]!.end, 10);
    expect(wheel.wedges[2]!.end).toBeCloseTo(TWO_PI, 10);
  });

  it("mid sits inside each arc", () => {
    for (const w of wheel.wedges) {
      expect(w.mid).toBeGreaterThan(w.start);
      expect(w.mid).toBeLessThan(w.end);
    }
  });
});

describe("randomBelow", () => {
  it("rejects values in the top partial bucket and retries", () => {
    // n=6 -> max = floor(2^32 / 6) * 6 = 4294967292 (hardcoded, not derived from impl).
    const { rng, calls } = stubRng(4294967292, 5); // first rejected, second accepted
    expect(randomBelow(6, rng)).toBe(5);
    expect(calls()).toBe(2);
  });

  it("uses 2^32 (not 2^32-1) as the range — accepts 0xFFFFFFFF for n=2 (sign guard)", () => {
    // Correct constant 0x100000000: max = 2^32, so the largest Uint32 (0xFFFFFFFF)
    // is ACCEPTED in one call. The buggy 0xFFFFFFFF constant would reject it (2 calls).
    const { rng, calls } = stubRng(0xffffffff, 0);
    expect(randomBelow(2, rng)).toBe(1); // 0xFFFFFFFF % 2
    expect(calls()).toBe(1);
  });

  it("returns the stubbed residue when accepted immediately", () => {
    expect(randomBelow(6, stubRng(4).rng)).toBe(4);
    expect(randomBelow(6, stubRng(0).rng)).toBe(0);
  });

  it("throws on non-positive n", () => {
    expect(() => randomBelow(0)).toThrow(RangeError);
    expect(() => randomBelow(-3)).toThrow(RangeError);
  });

  it("is unbiased across a large sample (real crypto)", () => {
    const n = 6;
    const N = 60_000;
    const counts = new Array(n).fill(0) as number[];
    for (let i = 0; i < N; i++) counts[randomBelow(n)]!++;
    const expected = N / n;
    for (const c of counts) {
      // ±5% tolerance; true deviation is ~1σ ≈ 91, so this is ~5σ-safe.
      expect(Math.abs(c - expected)).toBeLessThan(expected * 0.05);
    }
  });
});

describe("selectIndex", () => {
  // slots [3,2,1]; cumulative ranges: idx0=[0,3) idx1=[3,5) idx2=[5,6)
  const wheel = buildWheel([p("a", 0), p("b", 1), p("c", 2)], 3);

  it.each([
    [0, 0],
    [2, 0],
    [3, 1],
    [4, 1],
    [5, 2],
  ])("r=%i selects index %i", (r, expectedIndex) => {
    expect(selectIndex(wheel, stubRng(r).rng)).toBe(expectedIndex);
  });
});

describe("wedgeAtPointer — absolute physical convention (sign-sensitive)", () => {
  // 4 equal wedges (base 5, no cumulative wins -> 5 slots each), boundaries at 0, π/2, π, 3π/2
  const wheel = buildWheel([p("w0"), p("w1"), p("w2"), p("w3")], 5);

  it("rotation 0 -> wedge 0 under the top pointer", () => {
    expect(wedgeAtPointer(wheel, 0)).toBe(0);
  });

  it("clockwise spin by 90deg brings the 9-o'clock wedge (3) to the top", () => {
    // Physical: rotating the wheel clockwise by π/2 lifts wedge 3 ([3π/2,2π)) to top.
    // This dies if the sign of the rotation->pointer mapping is flipped.
    expect(wedgeAtPointer(wheel, PI / 2)).toBe(3);
  });

  it("clockwise spin by 180deg brings wedge 2 to the top", () => {
    expect(wedgeAtPointer(wheel, PI)).toBe(2);
  });
});

describe("computeTargetRotation — absolute value (sign-sensitive)", () => {
  // 4 equal wedges (base 5, no cumulative wins -> 5 slots each), boundaries at 0, π/2, π, 3π/2
  const wheel = buildWheel([p("w0"), p("w1"), p("w2"), p("w3")], 5);

  it("winner 3, center fraction, 0 turns -> π/4", () => {
    // w3 = [3π/2, 2π), center target = 7π/4, R = norm(-7π/4) = π/4
    expect(computeTargetRotation(wheel, 3, 0, 0.5)).toBeCloseTo(PI / 4, 10);
  });

  it("winner 0, center fraction, 0 turns -> 7π/4", () => {
    // w0 = [0, π/2), center target = π/4, R = norm(-π/4) = 7π/4
    expect(computeTargetRotation(wheel, 0, 0, 0.5)).toBeCloseTo((7 * PI) / 4, 10);
  });

  it("adds full turns", () => {
    expect(computeTargetRotation(wheel, 3, 5, 0.5)).toBeCloseTo(5 * TWO_PI + PI / 4, 10);
  });
});

describe("fairness invariant (draw.ts internal round-trip)", () => {
  const wheel = buildWheel([p("a", 0), p("b", 1), p("c", 2)], 3);

  it("the wedge under the pointer is always the chosen winner", () => {
    for (let idx = 0; idx < wheel.wedges.length; idx++) {
      for (const turns of [0, 1, 4, 9]) {
        for (const frac of [0.01, 0.5, 0.99]) {
          const R = computeTargetRotation(wheel, idx, turns, frac);
          expect(wedgeAtPointer(wheel, R)).toBe(idx);
        }
      }
    }
  });

  it("target lands strictly inside the winner arc (independent angle check)", () => {
    const idx = 1;
    const R = computeTargetRotation(wheel, idx, 3, 0.5);
    const phi = ((-R % TWO_PI) + TWO_PI) % TWO_PI;
    const w = wheel.wedges[idx]!;
    expect(phi).toBeGreaterThan(w.start);
    expect(phi).toBeLessThan(w.end);
  });
});

describe("selectWinner integration", () => {
  it("returns null when no candidates remain", () => {
    expect(selectWinner([p("a", 0, true)], 5)).toBeNull();
  });

  it("excludes session winners then picks the weighted winner", () => {
    // candidates after exclusion: a(base5,slots5), c(base5,slots5) -> total 10
    // stub r=7 -> idx0 range [0,5), idx1 range [5,10) -> index 1 => "c"
    const list = [p("a"), p("b", 0, true), p("c")];
    const result = selectWinner(list, 5, stubRng(7).rng);
    expect(result).not.toBeNull();
    expect(result!.winner.name).toBe("c");
    expect(result!.index).toBe(1);
    expect(
      wedgeAtPointer(result!.wheel, computeTargetRotation(result!.wheel, result!.index, 6)),
    ).toBe(result!.index);
  });
});

describe("draw determinism with spied crypto fallback", () => {
  it("uses injected rng, not global crypto", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    randomBelow(10, stubRng(3).rng);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
