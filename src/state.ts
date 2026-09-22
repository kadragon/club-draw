import type {
  DrawMethod,
  DrawMode,
  DrawRecord,
  Participant,
  PicksMap,
  Prize,
  SessionRef,
  Settings,
} from "./types.js";

export interface AppState {
  participants: Participant[];
  prizes: Prize[];
  settings: Settings;
  records: DrawRecord[];
  /** Preference snapshot pulled from the session; empty in `"all"` mode. */
  picks: PicksMap;
  /** Open/closed preference session, or null when none was opened. */
  session: SessionRef | null;
}

const KEY = "club-draw:v1";

/**
 * Spin duration bounds (ms) — the single source for the clamp in {@link loadState},
 * the settings-input handler, and the `#s-spin` min/max attributes, which `main.ts`
 * sets at boot. `index.html` carries no bound literals; do not re-add them.
 */
export const SPIN_MS_MIN = 1000;
export const SPIN_MS_MAX = 20000;

export const DEFAULT_SETTINGS: Settings = {
  spinMs: 5000,
  sound: true,
  mode: "all",
  method: "wheel",
};

/** Clamp an arbitrary spin duration (ms) into the supported range. NaN → default. */
export function clampSpinMs(ms: number): number {
  return clampInt(ms, SPIN_MS_MIN, SPIN_MS_MAX, DEFAULT_SETTINGS.spinMs);
}

/**
 * Clamp an operator-entered carry-over to a non-negative integer.
 *
 * A negative value would invert `slotsFor` (max(1, base − wins)) and raise the
 * participant's odds instead of lowering them; NaN would poison the wheel layout.
 * Single source for the persisted-payload sanitizer and the inline editor.
 */
export function normalizeWins(v: number): number {
  return Math.max(0, Math.floor(Number(v) || 0));
}

/**
 * Set one participant's carry-over total, returning a NEW array (input untouched).
 * The value is operator-entered, so it is normalized here rather than at the call
 * site. An unknown id, or a value that normalizes to the current one, returns the
 * original array — callers can skip a persist on identity.
 */
export function setParticipantWins(
  participants: readonly Participant[],
  id: string,
  wins: number,
): Participant[] {
  const next = normalizeWins(wins);
  const target = participants.find((p) => p.id === id);
  if (!target || target.cumulativeWins === next) return participants as Participant[];
  return participants.map((p) => (p.id === id ? { ...p, cumulativeWins: next } : p));
}

export function defaultState(): AppState {
  return {
    participants: [],
    prizes: [],
    settings: { ...DEFAULT_SETTINGS },
    records: [],
    picks: {},
    session: null,
  };
}

/** Coerce a persisted mode string; anything unrecognized degrades to the original behaviour. */
function readMode(v: unknown): DrawMode {
  return v === "preference" ? "preference" : "all";
}

/** Coerce a persisted draw method; anything unrecognized degrades to the wheel. */
function readMethod(v: unknown): DrawMethod {
  return v === "ladder" ? "ladder" : "wheel";
}

/**
 * Sanitize a persisted or freshly pulled picks payload into a {@link PicksMap}.
 *
 * The map is a pulled snapshot, not operator-typed, so it is normalized rather than
 * trusted: a non-object payload yields `{}`, a non-array entry is dropped entirely,
 * and within an entry only strings survive, deduplicated. A malformed entry must not
 * be able to widen or narrow a prize's candidate pool by accident.
 */
export function readPicks(v: unknown): PicksMap {
  if (!isObj(v) || Array.isArray(v)) return {};
  const out: Record<string, string[]> = {};
  for (const [prizeId, ids] of Object.entries(v)) {
    if (!Array.isArray(ids)) continue;
    out[prizeId] = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  }
  return out;
}

/** Read a persisted session handle; an entry without an id is unusable and becomes null. */
function readSession(v: unknown): SessionRef | null {
  if (!isObj(v)) return null;
  const id = typeof v.id === "string" ? v.id : "";
  if (id === "") return null;
  return {
    id,
    adminToken: typeof v.adminToken === "string" ? v.adminToken : "",
    closedAt: typeof v.closedAt === "string" ? v.closedAt : null,
  };
}

/** Stable id generator (crypto.randomUUID with a fallback). */
export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Load persisted state, tolerating partial / legacy / corrupt payloads.
 *
 * A legacy `baseSlots` key may exist in older `club-draw:v1` JSON; it is
 * intentionally ignored (no migration). Base slots are always recomputed from
 * the live roster via `effectiveBaseSlots`, never persisted.
 */
export function loadState(): AppState {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data = JSON.parse(raw) as unknown;
    if (!isObj(data)) return base;

    const participants = Array.isArray(data.participants)
      ? (data.participants as unknown[]).filter(isObj).map((p) => ({
          id: String(p.id ?? uid()),
          name: String(p.name ?? ""),
          cumulativeWins: normalizeWins(Number(p.cumulativeWins)),
          excluded: Boolean(p.excluded),
        }))
      : [];
    const prizes = Array.isArray(data.prizes)
      ? (data.prizes as unknown[]).filter(isObj).map((p) => ({
          id: String(p.id ?? uid()),
          name: String(p.name ?? ""),
          drawn: Boolean(p.drawn),
          winnerId: p.winnerId ? String(p.winnerId) : undefined,
        }))
      : [];
    const settings: Settings = {
      spinMs: clampSpinMs(Number((data.settings as Settings)?.spinMs)),
      sound: (data.settings as Settings)?.sound ?? DEFAULT_SETTINGS.sound,
      mode: readMode((data.settings as Settings)?.mode),
      method: readMethod((data.settings as Settings)?.method),
    };
    const records = Array.isArray(data.records)
      ? (data.records as unknown[]).filter(isObj).map((r) => ({
          prize: String(r.prize ?? ""),
          winner: String(r.winner ?? ""),
          winnerId: r.winnerId ? String(r.winnerId) : undefined,
          at: String(r.at ?? ""),
        }))
      : [];

    return {
      participants,
      prizes,
      settings,
      records,
      picks: readPicks(data.picks),
      session: readSession(data.session),
    };
  } catch {
    return base;
  }
}

function clampInt(v: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

export function saveState(state: AppState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // storage full / unavailable — non-fatal for an in-memory session.
  }
}

/**
 * Whether a participant may be removed from the roster.
 *
 * A session winner must stay: `state.records` and the CSV export are the audit
 * trail for a draw that already happened on stage, and `prize.winnerId` points at
 * this id — deleting them leaves a dangling reference that silently drops the
 * winner badge from the prize list. Both signals are checked because they can
 * diverge: `excluded` alone is the live-session flag, while a drawn prize keeps
 * the reference even if the flag were cleared. Session reset clears both, which is
 * the supported way to make a winner deletable again.
 */
export function canDeleteParticipant(
  state: { participants: readonly Participant[]; prizes: readonly Prize[] },
  id: string,
): boolean {
  const target = state.participants.find((p) => p.id === id);
  if (target?.excluded) return false;
  return !state.prizes.some((z) => z.winnerId === id);
}

/**
 * Clear per-session draw results in place: winners return to the wheel, prizes
 * become undrawn, records empty. Roster, prizes, carry-over, and settings stay.
 * The preference snapshot and session handle go too — they belong to the round
 * being reset, and a stale session would keep feeding its picks into the next one.
 */
export function resetSessionState(state: AppState): void {
  for (const p of state.participants) p.excluded = false;
  for (const z of state.prizes) {
    z.drawn = false;
    z.winnerId = undefined;
  }
  state.records = [];
  state.picks = {};
  state.session = null;
}

/**
 * Replace roster and prizes from a backup in place, issuing fresh ids. Picks and the
 * session handle are keyed by the old ids, so they are cleared rather than left to
 * silently match nothing (which degrades preference mode to the all-prizes fallback).
 */
export function applyBackupData(
  state: AppState,
  data: {
    participants: readonly { name: string; cumulativeWins: number }[];
    prizes: readonly { name: string }[];
  },
): void {
  state.participants = data.participants.map((p) => makeParticipant(p.name, p.cumulativeWins));
  state.prizes = data.prizes.map((z) => makePrize(z.name));
  state.records = [];
  state.picks = {};
  state.session = null;
}

/**
 * Apply one resolved draw in place: the winner leaves the pool (`excluded`), the prize
 * is marked drawn with its back-reference, and a record is appended. Shared by the
 * wheel and the ladder so both leave the same audit trail. `cumulativeWins` is never
 * touched — carry-over is operator-entered history. Returns false (and changes
 * nothing) when either id is unknown.
 */
export function recordWin(state: AppState, winnerId: string, prizeId: string, at: string): boolean {
  const winner = state.participants.find((p) => p.id === winnerId);
  const prize = state.prizes.find((p) => p.id === prizeId);
  if (!winner || !prize) return false;
  winner.excluded = true;
  prize.drawn = true;
  prize.winnerId = winner.id;
  state.records.push({ prize: prize.name, winner: winner.name, winnerId: winner.id, at });
  return true;
}

export function makeParticipant(name: string, cumulativeWins = 0): Participant {
  return { id: uid(), name, cumulativeWins, excluded: false };
}

export function makePrize(name: string): Prize {
  return { id: uid(), name };
}
