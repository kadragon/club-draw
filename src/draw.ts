import type { DrawMode, Participant, PicksMap, RandomSource, Wheel } from "./types.js";

/** Web Crypto adapter satisfying the narrow {@link RandomSource} shape. */
const defaultRng: RandomSource = {
  getRandomValues: (a) => crypto.getRandomValues(a),
};

/**
 * Uniform integer in [0, n) with **no modulo bias** (rejection sampling).
 *
 * Rejects the top partial bucket [max, 2^32) so every residue is equally likely.
 * `rng` is injectable for deterministic tests; defaults to the Web Crypto API.
 *
 * @throws if n <= 0.
 */
export function randomBelow(n: number, rng: RandomSource = defaultRng): number {
  if (!Number.isInteger(n) || n <= 0) {
    throw new RangeError(`randomBelow: n must be a positive integer, got ${n}`);
  }
  const max = Math.floor(0x100000000 / n) * n; // 2^32; accept region is a multiple of n (no bias)
  const buf = new Uint32Array(1);
  let x: number;
  do {
    rng.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= max);
  return x % n;
}

/**
 * Hard ceiling on the derived base. A pathological `cumulativeWins` (operator typo,
 * bad CSV) would otherwise push `buildWheel`'s `totalSlots` past 2^32, where
 * `randomBelow`'s accept region collapses to 0 and its rejection loop never
 * terminates — freezing the spin. 1000 is orders of magnitude above any real club
 * carry-over, so it never alters a legitimate draw.
 */
const MAX_BASE_SLOTS = 1000;

/**
 * Auto base slot count derived from the roster: `max(cumulativeWins) + 1`,
 * clamped to {@link MAX_BASE_SLOTS}.
 *
 * Anchors the wheel so the heaviest carry-over winner gets exactly 1 slot and a
 * zero-wins participant gets the most — the largest fair handicap with no operator
 * knob. Counts ALL participants (including session-excluded winners) so base stays
 * a stable property of the roster across the session. Empty roster → 1.
 */
export function effectiveBaseSlots(participants: readonly Participant[]): number {
  const base = participants.reduce((m, p) => Math.max(m, p.cumulativeWins), 0) + 1;
  return Math.min(MAX_BASE_SLOTS, base);
}

/** Slot count for a participant: `max(1, base - cumulativeWins)`. Floor of 1 keeps everyone in. */
export function slotsFor(participant: Participant, baseSlots: number): number {
  return Math.max(1, baseSlots - participant.cumulativeWins);
}

/** Candidates = participants not excluded (session winners are excluded). */
export function candidatesFrom(participants: readonly Participant[]): Participant[] {
  return participants.filter((p) => !p.excluded);
}

/** Outcome of {@link candidatesFor}: the pool, plus whether the preference filter was abandoned. */
export interface CandidatePool {
  candidates: Participant[];
  /**
   * True when preference mode found no eligible picker and widened the pool to
   * every remaining participant. The UI surfaces this as a badge — the operator
   * must be able to say on stage why a non-picker is on the wheel.
   */
  fellBack: boolean;
}

/**
 * Candidate pool for one prize.
 *
 * `"all"` mode is the original behaviour: everyone who has not won yet. `"preference"`
 * intersects that with the prize's pickers, and falls back to the same all-remaining
 * pool when the intersection is empty — nobody picked it, or every picker already won
 * an earlier prize. Falling back rather than skipping keeps the prize from going
 * unclaimed; the caller shows a badge on `fellBack`.
 *
 * `fellBack` reports that the pool was genuinely widened past the pickers, so it stays
 * false when nothing remained to widen to — an empty wheel is not a fallback.
 *
 * Roster order is preserved (not pick order) so the wheel layout stays stable across
 * prizes. Ids in `picks` that are not on the roster are ignored — a snapshot can
 * outlive a roster edit.
 */
export function candidatesFor(
  participants: readonly Participant[],
  mode: DrawMode,
  picks: PicksMap,
  prizeId: string,
): CandidatePool {
  const remaining = candidatesFrom(participants);
  if (mode !== "preference") return { candidates: remaining, fellBack: false };
  const pickers = new Set(picks[prizeId] ?? []);
  const preferred = remaining.filter((p) => pickers.has(p.id));
  if (preferred.length > 0) return { candidates: preferred, fellBack: false };
  return { candidates: remaining, fellBack: remaining.length > 0 };
}

/**
 * Build the wheel layout. Each candidate gets one wedge whose arc is proportional
 * to its slots (more odds = a wider wedge). Wedges are laid out in input order,
 * clockwise from the top pointer.
 */
export function buildWheel(candidates: readonly Participant[], baseSlots: number): Wheel {
  const TWO_PI = Math.PI * 2;
  const slots = candidates.map((p) => slotsFor(p, baseSlots));
  const totalSlots = slots.reduce((a, b) => a + b, 0);
  let acc = 0;
  const wedges = candidates.map((participant, i) => {
    const s = slots[i]!;
    const start = (acc / totalSlots) * TWO_PI;
    acc += s;
    const end = (acc / totalSlots) * TWO_PI;
    return { participant, slots: s, start, end, mid: (start + end) / 2 };
  });
  return { wedges, totalSlots };
}

/**
 * Weighted winner selection. Draws `r = randomBelow(totalSlots)` and walks the
 * cumulative slot ranges, returning the index of the wedge that contains `r`.
 */
export function selectIndex(wheel: Wheel, rng: RandomSource = defaultRng): number {
  const r = randomBelow(wheel.totalSlots, rng);
  let acc = 0;
  for (let i = 0; i < wheel.wedges.length; i++) {
    acc += wheel.wedges[i]!.slots;
    if (r < acc) return i;
  }
  return wheel.wedges.length - 1; // unreachable: r < totalSlots
}

export interface WinnerResult {
  wheel: Wheel;
  index: number;
  winner: Participant;
}

/**
 * Build the wheel from an already-formed candidate pool and pick a weighted winner.
 *
 * Takes the pool rather than the roster because the pool is prize-scoped under
 * preference mode: the caller runs {@link candidatesFor} once and feeds the SAME
 * array to the displayed wheel and to this selection, so the rendered wedges and
 * the drawn winner can never come from two different pools.
 */
export function selectWinner(
  candidates: readonly Participant[],
  baseSlots: number,
  rng: RandomSource = defaultRng,
): WinnerResult | null {
  if (candidates.length === 0) return null;
  const wheel = buildWheel(candidates, baseSlots);
  const index = selectIndex(wheel, rng);
  return { wheel, index, winner: wheel.wedges[index]!.participant };
}

const TWO_PI = Math.PI * 2;

/** Normalize an angle into [0, 2π). */
function norm(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

/**
 * Which wedge sits under the top pointer for a given rotation.
 *
 * Wheel space: angle increases clockwise from the top. Rotating the wheel by `R`
 * moves a point at wheel angle φ to screen angle φ + R. The pointer is at screen
 * angle 0, so the wheel angle under it is φ = (−R) mod 2π.
 */
export function wedgeAtPointer(wheel: Wheel, rotation: number): number {
  const phi = norm(-rotation);
  for (let i = 0; i < wheel.wedges.length; i++) {
    const w = wheel.wedges[i]!;
    if (phi >= w.start && phi < w.end) return i;
  }
  // Unreachable: norm() yields [0, 2π) and the wedges are contiguous over that
  // range, so some wedge always matches. Kept as an FP-safety fallback.
  return wheel.wedges.length - 1;
}

/**
 * Reveal-beat spotlight decision for one wedge. Render-only: an identity match,
 * never angle math, so the fairness convention is untouched. Pure so the
 * spotlight/dim logic can be unit-tested without a canvas.
 *
 * @param highlightId the spotlighted participant id, or null when no reveal is active.
 * @param wedgeId the participant id of the wedge being rendered.
 */
export function highlightState(
  highlightId: string | null,
  wedgeId: string,
): { isWinner: boolean; dim: boolean } {
  const isWinner = highlightId !== null && wedgeId === highlightId;
  const dim = highlightId !== null && !isWinner;
  return { isWinner, dim };
}

/**
 * Rotation (rad) that lands the winner's wedge under the top pointer.
 *
 * `turns` full clockwise spins are added for the animation. A jitter within the
 * winner's arc (never the exact center) keeps repeated spins from looking canned,
 * while the pointer is guaranteed to remain inside the winner arc — the fairness
 * invariant holds regardless of `turns` or jitter.
 *
 * Callers must pass `turns >= 1`; with `turns = 0` the returned rotation can be
 * less than the current angle, and `spinTo`'s `while (target <= r0 + Math.PI)`
 * guard would silently add a revolution. Today every caller passes 4–6.
 *
 * @param fraction position within the arc in (0,1); default 0.5 (center).
 */
export function computeTargetRotation(
  wheel: Wheel,
  winnerIndex: number,
  turns: number,
  fraction = 0.5,
): number {
  const w = wheel.wedges[winnerIndex]!;
  const f = Math.min(0.999, Math.max(0.001, fraction));
  const target = w.start + (w.end - w.start) * f; // wheel angle we want under pointer
  return turns * TWO_PI + norm(-target);
}
