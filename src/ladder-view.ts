// Canvas renderer for the ladder. Draws a precomputed model only — it never traces,
// shuffles or decides anything, so what it shows is exactly what ladder.ts resolved.

import type { Ladder, PathPoint, Rung } from "./ladder.js";
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
  /** Drawn fraction of the path's length, 0..1; below 1 the path is still animating. */
  progress?: number;
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

/** Top and bottom rails (y of path points 0 and rows + 1) inside the label bands. */
function rails(h: number, band: number): { y0: number; y1: number } {
  return { y0: band + 8, y1: h - band - 8 };
}

/**
 * Hit-test a click at CSS px (`x`, `y`) on a `w`×`h` canvas against the rung grid:
 * the gap is the lane between the posts left and right of `x`, the row is the
 * nearest rung line. Null outside the gaps or beyond the top/bottom row. Uses the
 * same geometry as the renderer, so a click lands on the rung drawn under it.
 */
export function rungAt(
  x: number,
  y: number,
  w: number,
  h: number,
  cols: number,
  rows: number,
): Rung | null {
  if (cols < 2) return null;
  const { spacing, band } = ladderLayout(w, h, cols);
  const { y0, y1 } = rails(h, band);
  const row = Math.round(((y - y0) / (y1 - y0)) * (rows + 1)) - 1;
  const col = Math.floor(x / spacing - 0.5);
  if (row < 0 || row >= rows || col < 0 || col > cols - 2) return null;
  return { row, col };
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The first `t` (0..1) of a polyline by length, cut inside a segment where needed.
 * Drives the reveal animation: the pen moves at a constant speed along the path.
 */
export function polylinePrefix(pts: readonly Point[], t: number): Point[] {
  if (pts.length === 0) return [];
  // Exact end, not a float-accumulated near miss: the pen must stop on the drawn slot.
  if (t >= 1) return [...pts];
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y));
  let left = Math.max(0, Math.min(1, t)) * seg.reduce((a, b) => a + b, 0);
  const out: Point[] = [pts[0]!];
  for (let i = 0; i < seg.length; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const len = seg[i]!;
    if (left >= len) {
      out.push(b);
      left -= len;
      continue;
    }
    if (left > 0) {
      const f = left / len;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
    }
    break;
  }
  return out;
}

/** Gap kept between a label's text and its box edge, for both fit tests and ellipsis. */
const LABEL_PAD = 10;

/**
 * Whether a label in a narrow (vertical) lane turns sideways: exactly when upright
 * text would not fit the width {@link ellipsize} truncates to, so short labels
 * ("?", "꽝") that fit stay upright and nothing upright is ever cut to "…".
 */
export function labelRotates(textW: number, boxW: number, vertical: boolean): boolean {
  return vertical && textW > boxW - LABEL_PAD;
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
    const { y0, y1 } = rails(h, band);
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
      const t = p.progress ?? 1;
      const pts = polylinePrefix(
        p.points.map((pt) => ({ x: colX(pt.col), y: yAt(pt.y) })),
        t,
      );
      if (pts.length === 0) continue;
      const color = PALETTE[p.color % PALETTE.length]!;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.moveTo(pts[0]!.x, pts[0]!.y);
      for (const pt of pts.slice(1)) ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      if (t < 1) {
        // Pen head, so the moving end reads even on a dense ladder.
        const head = pts[pts.length - 1]!;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(head.x, head.y, ctx.lineWidth * 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
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
      if (labelRotates(ctx.measureText(text).width, boxW, vertical)) {
        ctx.save();
        ctx.translate(x, cy);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(ellipsize(ctx, text, boxH - 8), 0, 0);
        ctx.restore();
      } else {
        ctx.fillText(ellipsize(ctx, text, boxW - LABEL_PAD), x, cy);
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
