import type { DrawRecord, Participant, Prize, Settings } from "./types.js";

export interface AppState {
  participants: Participant[];
  prizes: Prize[];
  settings: Settings;
  records: DrawRecord[];
}

const KEY = "club-draw:v1";

/**
 * Spin duration bounds (ms) — the single source for the clamp in {@link loadState},
 * the settings-input handler, and the `#s-spin` min/max attributes (set from JS at
 * boot; `index.html` carries the same numbers only as a no-JS fallback).
 */
export const SPIN_MS_MIN = 1000;
export const SPIN_MS_MAX = 20000;

export const DEFAULT_SETTINGS: Settings = { spinMs: 5000, sound: true };

/** Clamp an arbitrary spin duration (ms) into the supported range. NaN → default. */
export function clampSpinMs(ms: number): number {
  return clampInt(ms, SPIN_MS_MIN, SPIN_MS_MAX, DEFAULT_SETTINGS.spinMs);
}

export function defaultState(): AppState {
  return { participants: [], prizes: [], settings: { ...DEFAULT_SETTINGS }, records: [] };
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
          // Clamp to a non-negative integer: a negative value would invert slotsFor
          // (max(1, base − wins)) and raise the participant's odds instead of lowering them.
          cumulativeWins: Math.max(0, Math.floor(Number(p.cumulativeWins) || 0)),
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
    };
    const records = Array.isArray(data.records)
      ? (data.records as unknown[]).filter(isObj).map((r) => ({
          prize: String(r.prize ?? ""),
          winner: String(r.winner ?? ""),
          winnerId: r.winnerId ? String(r.winnerId) : undefined,
          at: String(r.at ?? ""),
        }))
      : [];

    return { participants, prizes, settings, records };
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

export function makeParticipant(name: string, cumulativeWins = 0): Participant {
  return { id: uid(), name, cumulativeWins, excluded: false };
}

export function makePrize(name: string): Prize {
  return { id: uid(), name };
}
