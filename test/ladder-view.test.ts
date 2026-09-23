import { describe, expect, it } from "vitest";
import {
  type LadderPath,
  type LadderViewModel,
  labelRotates,
  ladderFrame,
  ladderLayout,
  moveRungCursor,
  polylinePrefix,
  rungAt,
} from "../src/ladder-view.js";

describe("ladderLayout — lane geometry shared by canvas and slot buttons", () => {
  it("wide lanes: horizontal labels in a fixed 52px band", () => {
    expect(ladderLayout(640, 480, 5)).toEqual({ spacing: 128, vertical: false, band: 52 });
  });

  it("lanes under 64px turn vertical with a band of 24% height, capped at 130", () => {
    expect(ladderLayout(1200, 400, 30)).toEqual({ spacing: 40, vertical: true, band: 96 });
    expect(ladderLayout(1200, 800, 30)).toEqual({ spacing: 40, vertical: true, band: 130 });
  });

  it("zero columns does not divide by zero", () => {
    expect(ladderLayout(640, 480, 0).spacing).toBe(640);
  });
});

describe("labelRotates — vertical threshold matches the ellipsis width (boxW - 10)", () => {
  it("text in (boxW-10, boxW-6] would be cut to '…' upright, so it turns sideways", () => {
    expect(labelRotates(32, 40, true)).toBe(true);
    expect(labelRotates(34, 40, true)).toBe(true);
  });

  it("text that fits boxW-10 stays upright", () => {
    expect(labelRotates(30, 40, true)).toBe(false);
  });

  it("wide lanes never rotate", () => {
    expect(labelRotates(500, 40, false)).toBe(false);
  });
});

// 640×480, 5 posts, 11 rows: spacing 128 (posts at x = 64, 192, 320, 448, 576),
// band 52 → rails y0 = 60 .. y1 = 420, row step 360 / 12 = 30 (row r at y = 90 + 30r).
describe("rungAt — canvas CSS px → (row, gap) hit-test", () => {
  const at = (x: number, y: number) => rungAt(x, y, 640, 480, 5, 11);

  it("maps a point to the gap right of the post on its left and the nearest row", () => {
    expect(at(256, 90)).toEqual({ row: 0, col: 1 });
    expect(at(100, 390)).toEqual({ row: 10, col: 0 });
    expect(at(500, 210)).toEqual({ row: 4, col: 3 });
  });

  it("rounds to the nearest row line", () => {
    expect(at(256, 104)).toEqual({ row: 0, col: 1 });
    expect(at(256, 106)).toEqual({ row: 1, col: 1 });
  });

  it("misses outside the gaps: left of the first post, right of the last", () => {
    expect(at(50, 90)).toBeNull();
    expect(at(600, 90)).toBeNull();
  });

  it("misses the label bands above the top row and below the bottom row", () => {
    expect(at(256, 74)).toBeNull();
    expect(at(256, 406)).toBeNull();
  });

  it("a one-post ladder has no gaps", () => {
    expect(rungAt(320, 90, 640, 480, 1, 11)).toBeNull();
  });
});

describe("polylinePrefix — the drawn part of an animating path", () => {
  // Down 10, then right 10: total length 20.
  const pts = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
  ];

  it("cuts at the fraction of total length, interpolating inside a segment", () => {
    expect(polylinePrefix(pts, 0.25)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 5 },
    ]);
    expect(polylinePrefix(pts, 0.75)).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 10 },
      { x: 5, y: 10 },
    ]);
  });

  it("t = 0 is the start point, t ≥ 1 the whole path", () => {
    expect(polylinePrefix(pts, 0)).toEqual([{ x: 0, y: 0 }]);
    expect(polylinePrefix(pts, 1)).toEqual(pts);
    expect(polylinePrefix(pts, 2)).toEqual(pts);
  });
});

describe("moveRungCursor — keyboard rung cursor, clamped to the grid", () => {
  // 5 posts → gaps 0..3; 12 rows → rows 0..11.
  const move = (row: number, col: number, dRow: number, dCol: number) =>
    moveRungCursor({ row, col }, dRow, dCol, 5, 12);

  it("steps one row or one gap", () => {
    expect(move(3, 1, 1, 0)).toEqual({ row: 4, col: 1 });
    expect(move(3, 1, -1, 0)).toEqual({ row: 2, col: 1 });
    expect(move(3, 1, 0, 1)).toEqual({ row: 3, col: 2 });
    expect(move(3, 1, 0, -1)).toEqual({ row: 3, col: 0 });
  });

  it("stops at every edge instead of wrapping", () => {
    expect(move(0, 0, -1, 0)).toEqual({ row: 0, col: 0 });
    expect(move(0, 0, 0, -1)).toEqual({ row: 0, col: 0 });
    expect(move(11, 3, 1, 0)).toEqual({ row: 11, col: 3 });
    expect(move(11, 3, 0, 1)).toEqual({ row: 11, col: 3 });
  });

  it("pulls a stale out-of-grid cursor back inside (ladder shrank)", () => {
    expect(moveRungCursor({ row: 20, col: 9 }, 0, 0, 3, 12)).toEqual({ row: 11, col: 1 });
  });
});

describe("ladderFrame — per-frame overlay on the cached static model", () => {
  // 4 posts → gaps 0..2; 12 rows → rows 0..11.
  const revealed: LadderPath = { points: [{ col: 0, y: 0 }], color: 0, progress: 1 };
  const base: LadderViewModel = {
    ladder: { cols: 4, rows: 12, rungs: [] },
    top: [null, null, null, null],
    bottom: [],
    paths: [revealed],
  };
  const pathAt: LadderPath[] = [0, 1, 2, 3].map((c) => ({
    points: [
      { col: c, y: 0 },
      { col: c, y: 13 },
    ],
    color: c + 10,
  }));

  it("no animation, no cursor: the base paths, cursor null", () => {
    const m = ladderFrame(base, pathAt, null, null);
    expect(m.paths).toEqual([revealed]);
    expect(m.cursor).toBeNull();
    expect(m.ladder).toBe(base.ladder);
  });

  it("an animation at t = 0 draws nothing yet", () => {
    expect(ladderFrame(base, pathAt, { col: 2, t: 0 }, null).paths).toEqual([revealed]);
  });

  it("appends the moving column's path at progress t, after the revealed ones", () => {
    const m = ladderFrame(base, pathAt, { col: 2, t: 0.25 }, null);
    expect(m.paths).toEqual([revealed, { ...pathAt[2], progress: 0.25 }]);
  });

  it("an animation on a column with no path adds nothing", () => {
    expect(ladderFrame(base, pathAt, { col: 7, t: 0.5 }, null).paths).toEqual([revealed]);
  });

  it("draws the cursor clamped to the grid (stale cursor after the ladder shrank)", () => {
    expect(ladderFrame(base, pathAt, null, { row: 3, col: 1 }).cursor).toEqual({ row: 3, col: 1 });
    expect(ladderFrame(base, pathAt, null, { row: 20, col: 9 }).cursor).toEqual({
      row: 11,
      col: 2,
    });
  });

  it("a one-post ladder has no gap, so no cursor", () => {
    const solo = { ...base, ladder: { cols: 1, rows: 12, rungs: [] } };
    expect(ladderFrame(solo, pathAt, null, { row: 0, col: 0 }).cursor).toBeNull();
  });

  it("never mutates the cached base or its path table", () => {
    const before = structuredClone({ base, pathAt });
    ladderFrame(base, pathAt, { col: 1, t: 0.5 }, { row: 2, col: 2 });
    expect({ base, pathAt }).toEqual(before);
  });
});
