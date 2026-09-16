import { describe, expect, it } from "vitest";
import {
  claimKey,
  fetchPickSession,
  pickErrorMessage,
  readClaims,
  searchRoster,
  submitPicks,
  withClaim,
} from "../src/pick-client.js";
import { SessionApiError } from "../src/session.js";

const ROSTER = [
  { id: "p1", name: "김하나" },
  { id: "p2", name: "이 둘" },
  { id: "p3", name: "Kim Hana" },
];

describe("searchRoster", () => {
  it("returns nothing for a blank query so the roster is not listed wholesale", () => {
    expect(searchRoster(ROSTER, "")).toEqual([]);
    expect(searchRoster(ROSTER, "   ")).toEqual([]);
  });

  it("matches substrings ignoring case and whitespace, preserving roster order", () => {
    expect(searchRoster(ROSTER, "하나").map((p) => p.id)).toEqual(["p1"]);
    expect(searchRoster(ROSTER, "이둘").map((p) => p.id)).toEqual(["p2"]);
    expect(searchRoster(ROSTER, "HANA").map((p) => p.id)).toEqual(["p3"]);
  });

  it("caps the result count", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ id: `x${i}`, name: `김${i}` }));
    expect(searchRoster(many, "김", 5)).toHaveLength(5);
  });
});

describe("claim storage", () => {
  it("keys claims per session", () => {
    expect(claimKey("s1")).not.toBe(claimKey("s2"));
  });

  it("round-trips claims per participant", () => {
    const raw = JSON.stringify(withClaim({}, "p1", { claimToken: "t1", prizeIds: ["a", "b"] }));
    expect(readClaims(raw)).toEqual({ p1: { claimToken: "t1", prizeIds: ["a", "b"] } });
  });

  it("tolerates missing, corrupt, and malformed payloads", () => {
    expect(readClaims(null)).toEqual({});
    expect(readClaims("{not json")).toEqual({});
    expect(readClaims("[1,2]")).toEqual({});
    expect(
      readClaims(
        JSON.stringify({
          ok: { claimToken: "t", prizeIds: ["a", 3] },
          noToken: { prizeIds: ["a"] },
          emptyToken: { claimToken: "", prizeIds: [] },
          nullish: null,
        }),
      ),
    ).toEqual({ ok: { claimToken: "t", prizeIds: ["a"] } });
  });

  it("replaces a participant's claim without touching others", () => {
    const claims = { p1: { claimToken: "t1", prizeIds: ["a"] } };
    const next = withClaim(claims, "p2", { claimToken: "t2", prizeIds: ["b"] });
    expect(next).toEqual({ ...claims, p2: { claimToken: "t2", prizeIds: ["b"] } });
    expect(claims).toEqual({ p1: { claimToken: "t1", prizeIds: ["a"] } });
  });
});

const respond = (status: number, body: unknown) => () =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("fetchPickSession", () => {
  it("rejects a malformed body instead of rendering it", async () => {
    await expect(fetchPickSession(respond(200, { closed: false }), "s")).rejects.toMatchObject({
      code: "bad-response",
    });
  });
});

describe("submitPicks", () => {
  it("surfaces the server error code", async () => {
    await expect(
      submitPicks(respond(409, { error: "session-closed" }), "s", {
        participantId: "p1",
        prizeIds: ["a"],
      }),
    ).rejects.toMatchObject({ status: 409, code: "session-closed" });
  });
});

describe("pickErrorMessage", () => {
  it("gives participant-facing text for each contract error", () => {
    for (const code of [
      "network",
      "not-found",
      "session-closed",
      "already-submitted",
      "bad-claim",
      "too-many",
      "unknown-prize",
      "unknown-participant",
      "empty",
    ]) {
      expect(pickErrorMessage(new SessionApiError(400, code))).not.toMatch(/서버 오류/);
    }
    expect(pickErrorMessage(new SessionApiError(500, "boom"))).toContain("500");
    expect(pickErrorMessage(new Error("x"))).toBeTruthy();
  });
});
