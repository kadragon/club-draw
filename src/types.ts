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

/** Operator-tunable settings. (Base slot count is auto-derived; see effectiveBaseSlots.) */
export interface Settings {
  /** Spin animation duration (ms). */
  spinMs: number;
  /** Sound effects on/off. */
  sound: boolean;
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
