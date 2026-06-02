import type { Participant, RandomSource, Wheel } from "./types.js";

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
  const max = Math.floor(0xffffffff / n) * n;
  const buf = new Uint32Array(1);
  let x: number;
  do {
    rng.getRandomValues(buf);
    x = buf[0]!;
  } while (x >= max);
  return x % n;
}

/** Slot count for a participant: `max(1, base - cumulativeWins)`. Floor of 1 keeps everyone in. */
export function slotsFor(participant: Participant, baseSlots: number): number {
  return Math.max(1, baseSlots - participant.cumulativeWins);
}

/** Candidates = participants not excluded (session winners are excluded). */
export function candidatesFrom(participants: readonly Participant[]): Participant[] {
  return participants.filter((p) => !p.excluded);
}

/**
 * Build the wheel layout. Each candidate gets one wedge whose arc is proportional
 * to its slots. Wedges are laid out in input order, clockwise from the top pointer.
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

/** Convenience: build wheel from live candidates and pick a weighted winner. */
export function selectWinner(
  participants: readonly Participant[],
  baseSlots: number,
  rng: RandomSource = defaultRng,
): WinnerResult | null {
  const candidates = candidatesFrom(participants);
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
  return wheel.wedges.length - 1; // phi === 2π edge → last wedge
}

/**
 * Rotation (rad) that lands the winner's wedge under the top pointer.
 *
 * `turns` full clockwise spins are added for the animation. A jitter within the
 * winner's arc (never the exact center) keeps repeated spins from looking canned,
 * while the pointer is guaranteed to remain inside the winner arc — the fairness
 * invariant holds regardless of `turns` or jitter.
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
