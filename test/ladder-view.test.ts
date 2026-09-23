import { describe, expect, it } from "vitest";
import { labelRotates, ladderLayout, polylinePrefix, rungAt } from "../src/ladder-view.js";

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
