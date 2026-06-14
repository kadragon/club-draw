import { describe, expect, it } from "vitest";
import { LABEL_INK, PALETTE } from "../src/wheel.js";

/** WCAG relative luminance from a #rrggbb hex string. */
function hexLum(hex: string): number {
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const lin = (c: number): number => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colors. */
function contrast(a: string, b: string): number {
  const l1 = Math.max(hexLum(a), hexLum(b));
  const l2 = Math.min(hexLum(a), hexLum(b));
  return (l1 + 0.05) / (l2 + 0.05);
}

describe("PALETTE — projector contract", () => {
  it("generates 30 fill colors and 30 ink colors", () => {
    expect(PALETTE).toHaveLength(30);
    expect(LABEL_INK).toHaveLength(30);
  });

  it("every LABEL_INK meets WCAG AA contrast ≥ 4.5 against its wedge color", () => {
    for (let k = 0; k < 30; k++) {
      const ratio = contrast(PALETTE[k]!, LABEL_INK[k]!);
      expect(ratio, `k=${k}  palette=${PALETTE[k]}  ink=${LABEL_INK[k]}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("no wedge luminance > 0.65 — projector no-bloom guard (pastel regression)", () => {
    for (let k = 0; k < 30; k++) {
      const lum = hexLum(PALETTE[k]!);
      expect(lum, `k=${k}  palette=${PALETTE[k]}  lum=${lum.toFixed(3)}`).toBeLessThanOrEqual(0.65);
    }
  });
});
