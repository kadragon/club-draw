// Canvas renderer for the ladder. Draws a precomputed model only — it never traces,
// shuffles or decides anything, so what it shows is exactly what ladder.ts resolved.

import type { Ladder, PathPoint } from "./ladder.js";
import { LABEL_INK, PALETTE } from "./wheel.js";

const FONT = '"Pretendard Variable", system-ui, sans-serif';
const INK = "#0a0a0a";
const POST = "#3a3a3a";
const COVER = "#1a3a3a"; // --teal
const PRIZE = "#ff4d8b"; // --pink
const BLANK = "#ebe6d6"; // --surface-strong
const MUTED = "#6a6a6a";

export interface LadderTopLabel {
  name: string;
  /** Index into the wheel PALETTE, so a player keeps one color across views. */
  color: number;
}

export interface LadderBottomLabel {
  /** Covered slots hide their content (pre-lock, or not yet reached). */
  covered: boolean;
  /** Prize name, or null for a blank (꽝). Ignored while covered. */
  prize: string | null;
}

export interface LadderPath {
  points: readonly PathPoint[];
  color: number;
}

export interface LadderViewModel {
  ladder: Ladder;
  /** One per column; null = slot still empty (drawn as its 1-based number). */
  top: readonly (LadderTopLabel | null)[];
  bottom: readonly LadderBottomLabel[];
  paths: readonly LadderPath[];
}

export interface LadderView {
  setModel(model: LadderViewModel | null): void;
  render(): void;
}

export interface LadderLayout {
  /** Lane width: post c sits at (c + 0.5) × spacing. */
  spacing: number;
  /** Narrow lanes turn names vertical so 20–30 players still read on a projector. */
  vertical: boolean;
  /** Height of the top (and bottom) label band. */
  band: number;
}

/**
 * Lane geometry for a `w`×`h` CSS-px canvas. Exported so the slot buttons laid over
 * the top band line up with the lanes the canvas draws.
 */
export function ladderLayout(w: number, h: number, cols: number): LadderLayout {
  const spacing = w / Math.max(1, cols);
  const vertical = spacing < 64;
  return { spacing, vertical, band: vertical ? Math.min(130, h * 0.24) : 52 };
}

/** Truncate `text` with an ellipsis until it fits `max` px in the current ctx font. */
function ellipsize(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

export function createLadderView(canvas: HTMLCanvasElement): LadderView {
  const ctx = canvas.getContext("2d")!;
  let model: LadderViewModel | null = null;

  function render() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth || 640;
    const h = canvas.clientHeight || 480;
    const pw = Math.round(w * dpr);
    const ph = Math.round(h * dpr);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (!model || model.ladder.cols === 0) {
      ctx.fillStyle = MUTED;
      ctx.font = `400 16px ${FONT}`;
      ctx.fillText("참가자와 상품을 추가하세요", w / 2, h / 2);
      return;
    }

    const { ladder, top, bottom, paths } = model;
    const cols = ladder.cols;
    // Each post sits in the middle of an equal-width lane, so labels never cross the edge.
    const { spacing, vertical, band } = ladderLayout(w, h, cols);
    const colX = (c: number) => (c + 0.5) * spacing;
    const y0 = band + 8;
    const y1 = h - band - 8;
    const yAt = (y: number) => y0 + (y / (ladder.rows + 1)) * (y1 - y0);
    const labelW = Math.min(240, Math.max(18, spacing - 6));
    const fontPx = Math.max(
      12,
      Math.min(vertical ? 17 : 22, vertical ? spacing * 0.45 : spacing * 0.28),
    );

    // Posts and rungs.
    ctx.strokeStyle = POST;
    ctx.lineCap = "round";
    ctx.lineWidth = 3;
    for (let c = 0; c < cols; c++) {
      ctx.beginPath();
      ctx.moveTo(colX(c), y0);
      ctx.lineTo(colX(c), y1);
      ctx.stroke();
    }
    for (const r of ladder.rungs) {
      const y = yAt(r.row + 1);
      ctx.beginPath();
      ctx.moveTo(colX(r.col), y);
      ctx.lineTo(colX(r.col + 1), y);
      ctx.stroke();
    }

    // Traced paths on top of the ladder.
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(4, Math.min(8, spacing * 0.12));
    for (const p of paths) {
      if (p.points.length < 2) continue;
      ctx.strokeStyle = PALETTE[p.color % PALETTE.length]!;
      ctx.beginPath();
      ctx.moveTo(colX(p.points[0]!.col), yAt(p.points[0]!.y));
      for (const pt of p.points.slice(1)) ctx.lineTo(colX(pt.col), yAt(pt.y));
      ctx.stroke();
    }

    const label = (x: number, cy: number, text: string, fill: string, ink: string) => {
      const boxW = vertical ? Math.max(18, spacing - 6) : labelW;
      const boxH = vertical ? band - 8 : 40;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.roundRect(x - boxW / 2, cy - boxH / 2, boxW, boxH, 8);
      ctx.fill();
      ctx.fillStyle = ink;
      ctx.font = `600 ${fontPx}px ${FONT}`;
      // Short text ("?", "꽝") that fits across the lane stays upright even when narrow.
      if (vertical && ctx.measureText(text).width > boxW - 6) {
        ctx.save();
        ctx.translate(x, cy);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(ellipsize(ctx, text, boxH - 8), 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(ellipsize(ctx, text, boxW - 10), x, cy);
      }
    };

    const topY = band / 2 + 2;
    const botY = h - band / 2 - 2;
    for (let c = 0; c < cols; c++) {
      const t = top[c];
      if (t) {
        const k = t.color % PALETTE.length;
        label(colX(c), topY, t.name, PALETTE[k]!, LABEL_INK[k]!);
      } else {
        label(colX(c), topY, String(c + 1), BLANK, MUTED);
      }
      const b = bottom[c];
      if (!b) continue;
      if (b.covered) label(colX(c), botY, "?", COVER, "#ffffff");
      else if (b.prize === null) label(colX(c), botY, "꽝", BLANK, MUTED);
      else label(colX(c), botY, b.prize, PRIZE, INK);
    }
  }

  return {
    setModel(next) {
      model = next;
      render();
    },
    render,
  };
}
