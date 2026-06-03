import type { DrawRecord, Participant, Prize, Settings } from "./types.js";

export interface AppState {
  participants: Participant[];
  prizes: Prize[];
  settings: Settings;
  records: DrawRecord[];
}

const KEY = "club-draw:v1";

export const DEFAULT_SETTINGS: Settings = { spinMs: 5000, sound: true };

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

/** Load persisted state, tolerating partial / legacy / corrupt payloads. */
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
      spinMs: clampInt(
        Number((data.settings as Settings)?.spinMs),
        1000,
        20000,
        DEFAULT_SETTINGS.spinMs,
      ),
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

export function makeParticipant(name: string, cumulativeWins = 0): Participant {
  return { id: uid(), name, cumulativeWins, excluded: false };
}

export function makePrize(name: string): Prize {
  return { id: uid(), name };
}
