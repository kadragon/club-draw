import { describe, expect, it } from "vitest";
import {
  canPlaceRung,
  generateRungs,
  type LADDER_DENSITIES,
  type Ladder,
  shuffle,
  shuffleSlots,
  toggleRung,
  traceLadder,
} from "../src/ladder.js";
import type { RandomSource } from "../src/types.js";

/** RandomSource stub: each call writes the next queued value (last one repeats). */
function stubRng(...values: number[]): RandomSource {
  let i = 0;
  return {
    getRandomValues: (a) => {
      a[0] = values[Math.min(i, values.length - 1)]!;
      i++;
      return a;
    },
  };
}

/** Deterministic LCG so generated ladders are reproducible across runs. */
function lcgRng(seed: number): RandomSource {
  let s = seed >>> 0;
  return {
    getRandomValues: (a) => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      a[0] = s;
      return a;
    },
  };
}

// Hand-drawn: a staircase down-right.
//
//   col  0   1   2   3
//   r0   ├───┤   │   │
//   r1   │   ├───┤   │
//   r2   │   │   ├───┤
const STAIR: Ladder = {
  cols: 4,
  rows: 3,
  rungs: [
    { row: 0, col: 0 },
    { row: 1, col: 1 },
    { row: 2, col: 2 },
  ],
};

describe("traceLadder — absolute hand-computed endpoints (direction-sensitive)", () => {
  it("staircase maps 0→3, 1→0, 2→1, 3→2", () => {
    // A rung {row, col} joins col and col+1. Flipping that (col ↔ col-1) must fail here.
    expect([0, 1, 2, 3].map((c) => traceLadder(STAIR, c).endCol)).toEqual([3, 0, 1, 2]);
  });

  it("path vertices: start top, a horizontal hop per crossed rung at y = row + 1, end bottom", () => {
    expect(traceLadder(STAIR, 0).path).toEqual([
      { col: 0, y: 0 },
      { col: 0, y: 1 },
      { col: 1, y: 1 },
      { col: 1, y: 2 },
      { col: 2, y: 2 },
      { col: 2, y: 3 },
      { col: 3, y: 3 },
      { col: 3, y: 4 },
    ]);
    // Column 3 only meets the rung at row 2, from the right.
    expect(traceLadder(STAIR, 3).path).toEqual([
      { col: 3, y: 0 },
      { col: 3, y: 3 },
      { col: 2, y: 3 },
      { col: 2, y: 4 },
    ]);
  });

  it("no rungs → everyone goes straight down", () => {
    const flat: Ladder = { cols: 3, rows: 5, rungs: [] };
    expect([0, 1, 2].map((c) => traceLadder(flat, c).endCol)).toEqual([0, 1, 2]);
  });

  it("rung order in the array does not matter — rows are walked top to bottom", () => {
    const shuffled: Ladder = { ...STAIR, rungs: [...STAIR.rungs].reverse() };
    expect([0, 1, 2, 3].map((c) => traceLadder(shuffled, c).endCol)).toEqual([3, 0, 1, 2]);
  });

  it("throws on an out-of-range start column", () => {
    expect(() => traceLadder(STAIR, 4)).toThrow(RangeError);
    expect(() => traceLadder(STAIR, -1)).toThrow(RangeError);
  });
});

describe("canPlaceRung / toggleRung", () => {
  const base: Ladder = { cols: 4, rows: 3, rungs: [{ row: 1, col: 1 }] };

  it("rejects out-of-range positions", () => {
    expect(canPlaceRung(base, { row: -1, col: 0 })).toBe(false);
    expect(canPlaceRung(base, { row: 3, col: 0 })).toBe(false);
    expect(canPlaceRung(base, { row: 0, col: 3 })).toBe(false); // col+1 would be off the ladder
    expect(canPlaceRung(base, { row: 0, col: -1 })).toBe(false);
  });

  it("rejects a rung sharing a post with a same-row neighbour or duplicating one", () => {
    expect(canPlaceRung(base, { row: 1, col: 0 })).toBe(false);
    expect(canPlaceRung(base, { row: 1, col: 2 })).toBe(false);
    expect(canPlaceRung(base, { row: 1, col: 1 })).toBe(false);
  });

  it("accepts a free slot, including the same gap on another row", () => {
    expect(canPlaceRung(base, { row: 0, col: 0 })).toBe(true);
    expect(canPlaceRung(base, { row: 0, col: 1 })).toBe(true);
    expect(canPlaceRung(base, { row: 2, col: 1 })).toBe(true);
  });

  it("toggle adds a legal rung, removes an existing one, and ignores an illegal one", () => {
    const added = toggleRung(base, { row: 0, col: 2 });
    expect(added.rungs).toContainEqual({ row: 0, col: 2 });
    expect(added.rungs).toHaveLength(2);
    const removed = toggleRung(added, { row: 1, col: 1 });
    expect(removed.rungs).toEqual([{ row: 0, col: 2 }]);
    expect(toggleRung(base, { row: 1, col: 2 })).toBe(base);
    expect(base.rungs).toEqual([{ row: 1, col: 1 }]); // input untouched
  });
});

describe("generateRungs", () => {
  it("every generated rung is legal against the rest", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const l = generateRungs(8, 12, "normal", lcgRng(seed));
      for (const r of l.rungs) {
        const others: Ladder = { ...l, rungs: l.rungs.filter((x) => x !== r) };
        expect(canPlaceRung(others, r)).toBe(true);
      }
    }
  });

  it("every adjacent gap gets at least one rung, so no column drops straight down unconnected", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const l = generateRungs(6, 8, "low", lcgRng(seed));
      for (let col = 0; col < 5; col++) expect(l.rungs.some((r) => r.col === col)).toBe(true);
    }
  });

  it("density levels are ordered: more density → more rungs on average", () => {
    const avg = (d: (typeof LADDER_DENSITIES)[number]) => {
      let sum = 0;
      for (let seed = 1; seed <= 40; seed++)
        sum += generateRungs(10, 12, d, lcgRng(seed)).rungs.length;
      return sum / 40;
    };
    expect(avg("low")).toBeLessThan(avg("normal"));
    expect(avg("normal")).toBeLessThan(avg("high"));
  });

  it("a single column has no gaps and no rungs", () => {
    expect(generateRungs(1, 8, "high", lcgRng(1)).rungs).toEqual([]);
  });

  it("the traced outcome is always a bijection", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const l = generateRungs(9, 12, "high", lcgRng(seed));
      const ends = Array.from({ length: 9 }, (_, c) => traceLadder(l, c).endCol);
      expect(new Set(ends).size).toBe(9);
    }
  });
});

describe("shuffle (Fisher–Yates over randomBelow)", () => {
  it("absolute order for an all-zero rng", () => {
    // i=3 swap(3,0) → d b c a; i=2 swap(2,0) → c b d a; i=1 swap(1,0) → b c d a
    expect(shuffle(["a", "b", "c", "d"], stubRng(0))).toEqual(["b", "c", "d", "a"]);
  });

  it("reaches every permutation of 3 items (no parity or position bias in reach)", () => {
    const seen = new Set<string>();
    for (const j2 of [0, 1, 2]) {
      for (const j1 of [0, 1]) seen.add(shuffle(["a", "b", "c"], stubRng(j2, j1)).join(""));
    }
    expect(seen.size).toBe(6);
  });

  it("does not mutate its input", () => {
    const input = ["a", "b", "c"];
    shuffle(input, stubRng(0));
    expect(input).toEqual(["a", "b", "c"]);
  });
});

describe("shuffleSlots", () => {
  it("fewer prizes than columns pads with blanks (null)", () => {
    const slots = shuffleSlots(["p1", "p2"], 4, stubRng(0));
    // [p1 p2 ∅ ∅] with all-zero rng → [p2 ∅ ∅ p1]
    expect(slots).toEqual(["p2", null, null, "p1"]);
  });

  it("more prizes than columns keeps only the first N in list order", () => {
    const slots = shuffleSlots(["p1", "p2", "p3", "p4"], 2, stubRng(0));
    expect([...slots].sort()).toEqual(["p1", "p2"]);
  });

  it("equal counts: every prize exactly once, no blanks", () => {
    const slots = shuffleSlots(["p1", "p2", "p3"], 3, lcgRng(7));
    expect([...slots].sort()).toEqual(["p1", "p2", "p3"]);
  });
});
