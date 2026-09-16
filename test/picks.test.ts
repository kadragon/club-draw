import { describe, expect, it } from "vitest";
import { MAX_PICKS, normalizePicks } from "../src/picks.js";

const KNOWN = ["z1", "z2", "z3", "z4"];

describe("normalizePicks", () => {
  it("accepts a selection within the limit, preserving order", () => {
    expect(normalizePicks(KNOWN, ["z3", "z1"])).toEqual({ ok: true, prizeIds: ["z3", "z1"] });
  });

  it("accepts an empty selection (opting out of every prize)", () => {
    expect(normalizePicks(KNOWN, [])).toEqual({ ok: true, prizeIds: [] });
  });

  it("collapses duplicates before applying the limit", () => {
    expect(normalizePicks(KNOWN, ["z1", "z1", "z2", "z2"])).toEqual({
      ok: true,
      prizeIds: ["z1", "z2"],
    });
  });

  it("rejects a prize id absent from the roster", () => {
    expect(normalizePicks(KNOWN, ["z1", "nope"])).toEqual({ ok: false, error: "unknown-prize" });
  });

  it("rejects more than MAX_PICKS distinct prizes", () => {
    expect(normalizePicks(KNOWN, ["z1", "z2", "z3", "z4"])).toEqual({
      ok: false,
      error: "too-many",
    });
  });

  it("allows exactly MAX_PICKS distinct prizes", () => {
    expect(MAX_PICKS).toBe(3);
    expect(normalizePicks(KNOWN, KNOWN.slice(0, MAX_PICKS))).toEqual({
      ok: true,
      prizeIds: ["z1", "z2", "z3"],
    });
  });

  it("rejects a non-array payload instead of throwing", () => {
    expect(normalizePicks(KNOWN, null as unknown as string[])).toEqual({
      ok: false,
      error: "unknown-prize",
    });
  });

  it("rejects non-string entries rather than coercing them", () => {
    expect(normalizePicks(KNOWN, ["z1", 7 as unknown as string])).toEqual({
      ok: false,
      error: "unknown-prize",
    });
  });
});
