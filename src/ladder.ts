// Pure ladder (사다리 타기 / amidakuji) core. No DOM — same layer as draw.ts.
//
// Fairness does NOT come from the ladder's shape. A random ladder is a biased
// permutation (paths drift little from their start column; rung parity fixes the
// permutation's parity). Instead the bottom slots are shuffled uniformly with
// `shuffleSlots` at lock time, after placement and rung editing are final. A fixed
// permutation composed with a uniform one is uniform, so any ladder — hand-edited
// or not — hands each player each slot with equal probability.

import { randomBelow } from "./draw.js";
import type { RandomSource } from "./types.js";

/** A horizontal rung on `row` joining post `col` and post `col + 1`. */
export interface Rung {
  row: number;
  col: number;
}

/** `cols` vertical posts, `rows` rung levels (0 = top), and the rungs placed on them. */
export interface Ladder {
  cols: number;
  rows: number;
  rungs: readonly Rung[];
}

/**
 * A point on a traced path in ladder units: `col` is the post index, `y` runs from
 * 0 (top) to `rows + 1` (bottom); a rung on row r sits at y = r + 1.
 */
export interface PathPoint {
  col: number;
  y: number;
}

export interface Trace {
  endCol: number;
  /** Corner points from top to bottom; consecutive points differ in exactly one axis. */
  path: PathPoint[];
}

export const LADDER_DENSITIES = ["low", "normal", "high"] as const;
export type LadderDensity = (typeof LADDER_DENSITIES)[number];

/** Chance (percent) a legal (row, gap) cell receives a rung in the random pass. */
const DENSITY_PERCENT: Record<LadderDensity, number> = { low: 20, normal: 35, high: 55 };

/**
 * Most posts one ladder takes. Past this the names stop fitting the stage canvas,
 * and the wheel palette (30 colors) would start repeating path colors.
 */
export const LADDER_MAX_COLS = 30;

/** Rung levels per ladder. Enough for several crossings per path at any column count. */
export const LADDER_ROWS = 12;

/** Whether `l` has a rung on `row` between post `col` and post `col + 1`. */
export const hasRung = (l: Ladder, row: number, col: number): boolean =>
  l.rungs.some((r) => r.row === row && r.col === col);

/**
 * Whether a rung may go at `rung`: inside the ladder, not already there, and not
 * sharing a post with a same-row neighbour (two rungs meeting at one post on one
 * row would make the path ambiguous).
 */
export function canPlaceRung(l: Ladder, rung: Rung): boolean {
  const { row, col } = rung;
  if (!Number.isInteger(row) || !Number.isInteger(col)) return false;
  if (row < 0 || row >= l.rows || col < 0 || col >= l.cols - 1) return false;
  return !hasRung(l, row, col) && !hasRung(l, row, col - 1) && !hasRung(l, row, col + 1);
}

/**
 * Remove the rung at `rung` if present, else add it when {@link canPlaceRung} allows.
 * Returns a NEW ladder on change, the same object when the add is illegal.
 */
export function toggleRung(l: Ladder, rung: Rung): Ladder {
  if (hasRung(l, rung.row, rung.col)) {
    return { ...l, rungs: l.rungs.filter((r) => !(r.row === rung.row && r.col === rung.col)) };
  }
  if (!canPlaceRung(l, rung)) return l;
  return { ...l, rungs: [...l.rungs, { row: rung.row, col: rung.col }] };
}

/**
 * Random ladder at a density level. Each legal (row, gap) cell gets a rung with the
 * level's probability; afterwards every gap still without a rung gets one on a
 * random legal row, so no post is left hanging straight down. Visual variety only —
 * the outcome's fairness comes from {@link shuffleSlots}, not from here.
 */
export function generateRungs(
  cols: number,
  rows: number,
  density: LadderDensity,
  rng?: RandomSource,
): Ladder {
  let l: Ladder = { cols, rows, rungs: [] };
  const pct = DENSITY_PERCENT[density];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols - 1; col++) {
      if (canPlaceRung(l, { row, col }) && randomBelow(100, rng) < pct) {
        l = { ...l, rungs: [...l.rungs, { row, col }] };
      }
    }
  }
  for (let col = 0; col < cols - 1; col++) {
    if (l.rungs.some((r) => r.col === col)) continue;
    const free = [];
    for (let row = 0; row < rows; row++) if (canPlaceRung(l, { row, col })) free.push(row);
    if (free.length === 0) continue;
    const row = free[randomBelow(free.length, rng)]!;
    l = { ...l, rungs: [...l.rungs, { row, col }] };
  }
  return l;
}

/**
 * Follow the ladder from `startCol` at the top: row by row, a rung on the right
 * (`{row, col}`) moves the path to col + 1, one on the left (`{row, col - 1}`) to
 * col − 1. Returns the bottom post and the corner points for rendering.
 */
export function traceLadder(l: Ladder, startCol: number): Trace {
  if (!Number.isInteger(startCol) || startCol < 0 || startCol >= l.cols) {
    throw new RangeError(`traceLadder: startCol ${startCol} outside 0..${l.cols - 1}`);
  }
  let col = startCol;
  const path: PathPoint[] = [{ col, y: 0 }];
  for (let row = 0; row < l.rows; row++) {
    let next = col;
    if (hasRung(l, row, col)) next = col + 1;
    else if (hasRung(l, row, col - 1)) next = col - 1;
    if (next === col) continue;
    path.push({ col, y: row + 1 }, { col: next, y: row + 1 });
    col = next;
  }
  path.push({ col, y: l.rows + 1 });
  return { endCol: col, path };
}

/** Uniform Fisher–Yates shuffle into a NEW array, drawing from `randomBelow` (no modulo bias). */
export function shuffle<T>(items: readonly T[], rng?: RandomSource): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomBelow(i + 1, rng);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/**
 * Bottom slots for a ladder of `cols` posts: the first `min(M, cols)` prize ids in
 * list order plus `null` blanks (꽝) for the rest, uniformly shuffled. Call it once,
 * at lock time — this is the draw.
 */
export function shuffleSlots(
  prizeIds: readonly string[],
  cols: number,
  rng?: RandomSource,
): (string | null)[] {
  const slots: (string | null)[] = prizeIds.slice(0, cols);
  while (slots.length < cols) slots.push(null);
  return shuffle(slots, rng);
}

/** Top slots: column → player id, `null` while the slot is empty. */
export type Placement = readonly (string | null)[];

/**
 * Put `id` on `col`. A player holds one slot, so an earlier slot of theirs is
 * cleared; a different occupant of `col` is bumped back to unplaced. Returns a NEW
 * placement, the same one when `col` is out of range.
 */
export function placeAt(p: Placement, col: number, id: string): Placement {
  if (!Number.isInteger(col) || col < 0 || col >= p.length) return p;
  return p.map((cur, c) => (c === col ? id : cur === id ? null : cur));
}

/** Empty slot `col`, returning a NEW placement. */
export function clearAt(p: Placement, col: number): (string | null)[] {
  return p.map((cur, c) => (c === col ? null : cur));
}

/** Roster ids not on any slot, in roster order. */
export function unplacedIds(p: Placement, ids: readonly string[]): string[] {
  const placed = new Set(p);
  return ids.filter((id) => !placed.has(id));
}

/**
 * "나머지 랜덤 배치": shuffle the unplaced roster ids into the empty slots, left to
 * right. Placed players stay put. Where players start does not affect fairness
 * (the bottom shuffle at lock does); this only saves the operator clicks.
 */
export function fillRandom(
  p: Placement,
  ids: readonly string[],
  rng?: RandomSource,
): (string | null)[] {
  const queue = shuffle(unplacedIds(p, ids), rng);
  return p.map((cur) => (cur === null ? (queue.shift() ?? null) : cur));
}
