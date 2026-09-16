import { describe, expect, it } from "vitest";
import {
  buildSessionPayload,
  countPickers,
  NAME_MAX,
  openSession,
  pickUrl,
  pullSnapshot,
  SessionApiError,
  sessionErrorMessage,
} from "../src/session.js";
import { makeParticipant, makePrize } from "../src/state.js";

describe("buildSessionPayload", () => {
  it("pushes local ids and names only (no carry-over, no draw flags)", () => {
    const p = { ...makeParticipant("김하나", 3), excluded: true };
    const z = { ...makePrize("A"), drawn: true, winnerId: p.id };
    expect(buildSessionPayload([p], [z])).toEqual({
      ok: true,
      payload: { participants: [{ id: p.id, name: "김하나" }], prizes: [{ id: z.id, name: "A" }] },
    });
  });

  it("rejects what the Worker would 400 on, with a reason", () => {
    const p = makeParticipant("a");
    const z = makePrize("b");
    expect(buildSessionPayload([], [z])).toEqual({ ok: false, error: "no-participants" });
    expect(buildSessionPayload([p], [])).toEqual({ ok: false, error: "no-prizes" });
    expect(buildSessionPayload([makeParticipant("  ")], [z])).toEqual({
      ok: false,
      error: "blank-name",
    });
    expect(buildSessionPayload([p], [makePrize("x".repeat(NAME_MAX + 1))])).toEqual({
      ok: false,
      error: "name-too-long",
    });
  });
});

describe("pickUrl", () => {
  it("builds the shared participant link with an encoded id", () => {
    expect(pickUrl("https://d.example", "a b")).toBe("https://d.example/pick?s=a%20b");
  });
});

describe("countPickers", () => {
  it("counts distinct participants across prizes", () => {
    expect(countPickers({ a: ["p1", "p2"], b: ["p1"], c: [] })).toBe(2);
  });
});

describe("request errors", () => {
  it("maps a thrown fetch to a network error", async () => {
    const err = await openSession(() => Promise.reject(new TypeError("offline")), {
      participants: [],
      prizes: [],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SessionApiError);
    expect((err as SessionApiError).code).toBe("network");
    expect(sessionErrorMessage(err)).toContain("네트워크");
  });

  it("carries the server error code and sanitizes a malformed snapshot", async () => {
    const reply = (status: number, body: unknown) => () =>
      Promise.resolve(new Response(JSON.stringify(body), { status }));
    const err = await pullSnapshot(reply(401, { error: "unauthorized" }), "s", "t").catch(
      (e: unknown) => e,
    );
    expect((err as SessionApiError).status).toBe(401);
    expect((err as SessionApiError).code).toBe("unauthorized");

    const snap = await pullSnapshot(
      reply(200, { closedAt: "2026-09-16T00:00:00Z", picks: { a: ["p1", 7, "p1"], b: "x" } }),
      "s",
      "t",
    );
    expect(snap.picks).toEqual({ a: ["p1"] });
  });
});
