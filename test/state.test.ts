import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyBackupData,
  canDeleteParticipant,
  DEFAULT_SETTINGS,
  defaultState,
  loadState,
  normalizeWins,
  resetSessionState,
  SPIN_MS_MAX,
  SPIN_MS_MIN,
  setParticipantWins,
} from "../src/state.js";
import type { Participant, Prize } from "../src/types.js";

const p = (id: string, over: Partial<Participant> = {}): Participant => ({
  id,
  name: id,
  cumulativeWins: 0,
  excluded: false,
  ...over,
});

describe("canDeleteParticipant", () => {
  it("allows deleting a participant who has not won this session", () => {
    const participants = [p("a"), p("b")];
    const prizes: Prize[] = [{ id: "z1", name: "gift" }];
    expect(canDeleteParticipant({ participants, prizes }, "a")).toBe(true);
  });

  it("blocks a participant flagged excluded (session winner)", () => {
    const participants = [p("a", { excluded: true })];
    expect(canDeleteParticipant({ participants, prizes: [] }, "a")).toBe(false);
  });

  it("blocks a participant referenced by a drawn prize even if excluded was cleared", () => {
    const participants = [p("a")];
    const prizes: Prize[] = [{ id: "z1", name: "gift", drawn: true, winnerId: "a" }];
    expect(canDeleteParticipant({ participants, prizes }, "a")).toBe(false);
  });

  it("does not block a bystander when someone else won", () => {
    const participants = [p("a", { excluded: true }), p("b")];
    const prizes: Prize[] = [{ id: "z1", name: "gift", drawn: true, winnerId: "a" }];
    expect(canDeleteParticipant({ participants, prizes }, "b")).toBe(true);
  });

  it("allows deleting an unknown id (already gone — nothing to protect)", () => {
    expect(canDeleteParticipant({ participants: [], prizes: [] }, "ghost")).toBe(true);
  });
});

// ── loadState ───────────────────────────────────────────────────────────────
// Runs in the `node` test environment (vite.config.ts), so localStorage is stubbed.
const KEY = "club-draw:v1";
let store: Map<string, string>;

beforeEach(() => {
  store = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

const put = (payload: unknown) => store.set(KEY, JSON.stringify(payload));

describe("loadState", () => {
  it("returns the default state when nothing is persisted", () => {
    expect(loadState()).toEqual(defaultState());
  });

  it("returns the default state on unparseable JSON", () => {
    store.set(KEY, "{not json");
    expect(loadState()).toEqual(defaultState());
  });

  it("returns the default state on a non-object payload", () => {
    put([1, 2, 3]);
    expect(loadState()).toEqual(defaultState());
  });

  it("clamps a negative cumulativeWins to 0 (a negative value would INVERT the handicap)", () => {
    put({ participants: [{ id: "a", name: "A", cumulativeWins: -5 }] });
    expect(loadState().participants[0]?.cumulativeWins).toBe(0);
  });

  it("floors a fractional cumulativeWins and defaults a non-numeric one to 0", () => {
    put({
      participants: [
        { id: "a", name: "A", cumulativeWins: 2.9 },
        { id: "b", name: "B", cumulativeWins: "oops" },
        { id: "c", name: "C" },
      ],
    });
    expect(loadState().participants.map((p) => p.cumulativeWins)).toEqual([2, 0, 0]);
  });

  it("drops non-object entries and coerces missing participant fields", () => {
    put({ participants: [null, "x", { name: 42 }] });
    const [only, ...rest] = loadState().participants;
    expect(rest).toEqual([]);
    expect(only?.name).toBe("42");
    expect(only?.id).toBeTruthy(); // generated
    expect(only?.excluded).toBe(false);
  });

  it("falls back to empty arrays when the collections are not arrays", () => {
    put({ participants: {}, prizes: "nope", records: 7 });
    const s = loadState();
    expect([s.participants, s.prizes, s.records]).toEqual([[], [], []]);
  });

  it("keeps a spinMs inside the supported range", () => {
    put({ settings: { spinMs: 7500, sound: false } });
    expect(loadState().settings).toEqual({ spinMs: 7500, sound: false, mode: "all" });
  });

  it("clamps spinMs to the SPIN_MS bounds and falls back on a non-finite value", () => {
    put({ settings: { spinMs: SPIN_MS_MIN - 1 } });
    expect(loadState().settings.spinMs).toBe(SPIN_MS_MIN);
    put({ settings: { spinMs: SPIN_MS_MAX + 1 } });
    expect(loadState().settings.spinMs).toBe(SPIN_MS_MAX);
    put({ settings: { spinMs: "fast" } });
    expect(loadState().settings.spinMs).toBe(DEFAULT_SETTINGS.spinMs);
  });

  it("defaults a missing settings block", () => {
    put({ participants: [] });
    expect(loadState().settings).toEqual(DEFAULT_SETTINGS);
  });

  it("ignores a legacy persisted baseSlots key (base is always recomputed)", () => {
    put({ baseSlots: 99, participants: [{ id: "a", name: "A", cumulativeWins: 1 }] });
    expect(loadState()).not.toHaveProperty("baseSlots");
  });

  it("preserves prize winner links and records", () => {
    put({
      prizes: [{ id: "z", name: "gift", drawn: true, winnerId: "a" }],
      records: [{ prize: "gift", winner: "A", winnerId: "a", at: "2026-01-01T00:00:00.000Z" }],
    });
    const s = loadState();
    expect(s.prizes[0]).toEqual({ id: "z", name: "gift", drawn: true, winnerId: "a" });
    expect(s.records[0]?.winnerId).toBe("a");
  });
});

describe("normalizeWins", () => {
  it("clamps a negative carry-over to 0", () => {
    expect(normalizeWins(-3)).toBe(0);
  });

  it("floors a fractional value", () => {
    expect(normalizeWins(2.9)).toBe(2);
  });

  it("falls back to 0 for NaN", () => {
    expect(normalizeWins(Number.NaN)).toBe(0);
  });

  it("passes a non-negative integer through", () => {
    expect(normalizeWins(4)).toBe(4);
  });
});

describe("setParticipantWins", () => {
  it("updates only the named participant and leaves the input untouched", () => {
    const participants = [p("a", { cumulativeWins: 1 }), p("b", { cumulativeWins: 2 })];
    const next = setParticipantWins(participants, "a", 5);
    expect(next.map((x) => x.cumulativeWins)).toEqual([5, 2]);
    expect(participants[0]!.cumulativeWins).toBe(1);
  });

  it("normalizes the entered value", () => {
    const next = setParticipantWins([p("a", { cumulativeWins: 1 })], "a", -2);
    expect(next[0]!.cumulativeWins).toBe(0);
  });

  it("returns the original array for an unknown id", () => {
    const participants = [p("a")];
    expect(setParticipantWins(participants, "zz", 3)).toBe(participants);
  });

  it("returns the original array when the value is unchanged", () => {
    const participants = [p("a", { cumulativeWins: 2 })];
    expect(setParticipantWins(participants, "a", 2.4)).toBe(participants);
  });

  it("preserves the excluded flag", () => {
    const next = setParticipantWins([p("a", { excluded: true })], "a", 3);
    expect(next[0]!.excluded).toBe(true);
  });
});

// ── preference mode schema (mode / picks / session) ─────────────────────────

describe("loadState — preference mode fields", () => {
  it("loads a pre-v2 payload with no mode/picks/session as the all-participants default", () => {
    put({
      participants: [{ id: "a", name: "A", cumulativeWins: 0 }],
      prizes: [{ id: "z1", name: "gift" }],
      settings: { spinMs: 5000, sound: true },
      records: [],
    });
    const s = loadState();
    expect(s.settings.mode).toBe("all");
    expect(s.picks).toEqual({});
    expect(s.session).toBeNull();
  });

  it("round-trips a preference-mode payload", () => {
    put({
      participants: [],
      prizes: [],
      settings: { spinMs: 5000, sound: true, mode: "preference" },
      records: [],
      picks: { z1: ["a", "b"], z2: [] },
      session: { id: "s1", adminToken: "t1", closedAt: "2026-09-16T00:00:00.000Z" },
    });
    const s = loadState();
    expect(s.settings.mode).toBe("preference");
    expect(s.picks).toEqual({ z1: ["a", "b"], z2: [] });
    expect(s.session).toEqual({
      id: "s1",
      adminToken: "t1",
      closedAt: "2026-09-16T00:00:00.000Z",
    });
  });

  it("falls back to all mode on an unrecognized mode string", () => {
    put({ settings: { spinMs: 5000, sound: true, mode: "roulette-supreme" } });
    expect(loadState().settings.mode).toBe("all");
  });

  it("drops a non-array picks entry and non-string ids, and collapses duplicates", () => {
    put({ picks: { z1: ["a", "a", 7, null, "b"], z2: "nope", z3: ["c"] } });
    expect(loadState().picks).toEqual({ z1: ["a", "b"], z3: ["c"] });
  });

  it("treats a non-object picks payload as empty", () => {
    put({ picks: ["a", "b"] });
    expect(loadState().picks).toEqual({});
  });

  it("drops a session without a usable id", () => {
    put({ session: { adminToken: "t1" } });
    expect(loadState().session).toBeNull();
  });

  it("keeps a session with no closedAt (still open)", () => {
    put({ session: { id: "s1", adminToken: "t1" } });
    expect(loadState().session).toEqual({ id: "s1", adminToken: "t1", closedAt: null });
  });

  it("defaultState starts in all mode with no picks or session", () => {
    const s = defaultState();
    expect(s.settings.mode).toBe("all");
    expect(s.picks).toEqual({});
    expect(s.session).toBeNull();
  });
});

describe("resetSessionState / applyBackupData — preference data", () => {
  const seeded = () => {
    const s = defaultState();
    s.settings.mode = "preference";
    s.participants = [p("a", { cumulativeWins: 2, excluded: true })];
    s.prizes = [{ id: "z1", name: "gift", drawn: true, winnerId: "a" }];
    s.records = [{ prize: "gift", winner: "a", winnerId: "a", at: "t" }];
    s.picks = { z1: ["a"] };
    s.session = { id: "s1", adminToken: "t1", closedAt: null };
    return s;
  };

  it("session reset clears picks and session but keeps roster, carry-over, and settings", () => {
    const s = seeded();
    resetSessionState(s);
    expect(s.picks).toEqual({});
    expect(s.session).toBeNull();
    expect(s.records).toEqual([]);
    expect(s.participants).toEqual([p("a", { cumulativeWins: 2, excluded: false })]);
    expect(s.prizes).toEqual([{ id: "z1", name: "gift", drawn: false, winnerId: undefined }]);
    expect(s.settings.mode).toBe("preference");
  });

  it("restore replaces roster/prizes with fresh ids and clears picks, session, and records", () => {
    const s = seeded();
    applyBackupData(s, {
      participants: [{ name: "B", cumulativeWins: 1 }],
      prizes: [{ name: "cup" }],
    });
    expect(s.picks).toEqual({});
    expect(s.session).toBeNull();
    expect(s.records).toEqual([]);
    expect(s.participants.map(({ name, cumulativeWins }) => ({ name, cumulativeWins }))).toEqual([
      { name: "B", cumulativeWins: 1 },
    ]);
    expect(s.participants[0]!.id).not.toBe("a");
    expect(s.prizes.map((z) => z.name)).toEqual(["cup"]);
    expect(s.settings.mode).toBe("preference");
  });
});
