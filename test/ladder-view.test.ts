import { describe, expect, it } from "vitest";
import { ladderLayout } from "../src/ladder-view.js";

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
