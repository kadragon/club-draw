// Domain model for the club-draw roulette.

/** A person eligible to win. `excluded` flags session winners removed from later draws. */
export interface Participant {
  id: string;
  name: string;
  /** Historical carry-over wins. Reduces slot count; never auto-incremented within a session. */
  cumulativeWins: number;
  /** True once this participant has won in the current session (removed from the wheel). */
  excluded?: boolean;
}

/** A prize drawn in list order. */
export interface Prize {
  id: string;
  name: string;
  drawn?: boolean;
  winnerId?: string;
}

/**
 * How a prize's candidate pool is formed.
 *
 * - `"all"` — every participant who has not won yet (the original behaviour).
 * - `"preference"` — only those who picked that prize (see {@link PicksMap}).
 */
export type DrawMode = "all" | "preference";

/**
 * How a draw is staged. Orthogonal to {@link DrawMode} (which only shapes the pool).
 *
 * - `"wheel"` — one prize per spin, weighted by carry-over (the original).
 * - `"ladder"` — one 사다리 assigns the leading prizes to the remaining players at once,
 *   uniformly (no carry-over weighting). Unavailable under `"preference"` mode.
 */
export type DrawMethod = "wheel" | "ladder";

/**
 * Collected preferences: prize id -> ids of the participants who picked it.
 *
 * Keyed by prize because that is the lookup every draw performs. A participant
 * may appear under at most `MAX_PICKS` prizes; that cap is enforced on submission
 * (`normalizePicks`), not here.
 */
export type PicksMap = Readonly<Record<string, readonly string[]>>;

/** Operator-side handle on a preference-collection session. */
export interface SessionRef {
  /** Server-issued session id; the `?s=` value in the participant QR link. */
  id: string;
  /** Operator credential for closing the session and pulling the snapshot. */
  adminToken: string;
  /** ISO timestamp once submissions are closed; null while still open. */
  closedAt: string | null;
}

/** Operator-tunable settings. (Base slot count is auto-derived; see effectiveBaseSlots.) */
export interface Settings {
  /** Spin animation duration (ms). */
  spinMs: number;
  /** Sound effects on/off. */
  sound: boolean;
  /** Candidate-pool rule for every prize in the session. */
  mode: DrawMode;
  /** Presentation / allocation method; see {@link DrawMethod}. */
  method: DrawMethod;
}

/** A stamped draw result for the history log / CSV export. */
export interface DrawRecord {
  prize: string;
  winner: string;
  /** Winning participant's stable id; disambiguates duplicate display names. */
  winnerId?: string;
  /** ISO timestamp, stamped after the spin resolves. */
  at: string;
}

/** Minimal interface matching `crypto`; injectable for deterministic tests. */
export interface RandomSource {
  getRandomValues(array: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer>;
}

/**
 * One wedge of the wheel = one candidate. Angles are in **wheel space**: radians
 * measured clockwise from the top pointer (12 o'clock) when rotation = 0.
 */
export interface Wedge {
  participant: Participant;
  slots: number;
  /** Inclusive start angle (rad), clockwise from top. */
  start: number;
  /** Exclusive end angle (rad). */
  end: number;
  /** Arc midpoint (rad). */
  mid: number;
}

/** Pre-computed wheel layout. Arc length of each wedge is proportional to its slots. */
export interface Wheel {
  wedges: Wedge[];
  totalSlots: number;
}
