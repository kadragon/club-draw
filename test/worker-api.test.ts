import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import initSql from "../migrations/0001_init.sql?raw";
import {
  fetchPickSession as clientFetchPick,
  submitPicks as clientSubmit,
} from "../src/pick-client";
import {
  closeSession as clientClose,
  deleteSession as clientDelete,
  openSession as clientOpen,
  pullSnapshot as clientPull,
} from "../src/session";
import worker, { type Env } from "../worker/index";

/**
 * Contract tests for the preference-session API against a real local D1
 * (workerd via wrangler's platform proxy, in-memory, migrations applied fresh).
 */

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let env: Env;

beforeAll(async () => {
  proxy = await getPlatformProxy({ configPath: "wrangler.jsonc", persist: false });
  env = {
    DB: (proxy.env as unknown as Env).DB,
    ASSETS: { fetch: async () => new Response("asset", { status: 200 }) },
  };
  const sql = initSql.replace(/--.*$/gm, "");
  const statements = sql
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

function call(method: string, path: string, body?: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(
    new Request(`http://local${path}`, {
      method,
      headers,
      body: body === undefined ? null : JSON.stringify(body),
    }),
    env,
  );
}

const roster = {
  participants: [
    { id: "p1", name: "김하나" },
    { id: "p2", name: "이둘" },
    { id: "p3", name: "박셋" },
  ],
  prizes: [
    { id: "a", name: "A" },
    { id: "b", name: "B" },
    { id: "c", name: "C" },
    { id: "d", name: "D" },
  ],
};

async function openSession(): Promise<{ sessionId: string; adminToken: string }> {
  const res = await call("POST", "/api/session", roster);
  expect(res.status).toBe(201);
  return (await res.json()) as { sessionId: string; adminToken: string };
}

function pick(sessionId: string, body: Record<string, unknown>): Promise<Response> {
  return call("PUT", `/api/session/${sessionId}/pick`, body);
}

describe("session creation", () => {
  it("returns an id and token, stores only the token hash, and serves roster in order", async () => {
    const { sessionId, adminToken } = await openSession();
    expect(adminToken.length).toBeGreaterThanOrEqual(40);
    const row = await env.DB.prepare("SELECT admin_token_hash FROM session WHERE id = ?1")
      .bind(sessionId)
      .first<{ admin_token_hash: string }>();
    expect(row!.admin_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row!.admin_token_hash).not.toBe(adminToken);

    const res = await call("GET", `/api/session/${sessionId}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ closed: false, ...roster });
  });

  it("rejects duplicate participant ids and empty prize lists", async () => {
    const dup = { ...roster, participants: [roster.participants[0], roster.participants[0]] };
    expect((await call("POST", "/api/session", dup)).status).toBe(400);
    expect((await call("POST", "/api/session", { ...roster, prizes: [] })).status).toBe(400);
  });

  it("404s an unknown session", async () => {
    expect((await call("GET", "/api/session/nope")).status).toBe(404);
  });
});

describe("pick submission", () => {
  it("accepts a first submission and returns a claim token", async () => {
    const { sessionId } = await openSession();
    const res = await pick(sessionId, { participantId: "p1", prizeIds: ["a", "b"] });
    expect(res.status).toBe(200);
    const { claimToken } = (await res.json()) as { claimToken: string };
    expect(typeof claimToken).toBe("string");
  });

  it("rejects a duplicate submission without a token with 409", async () => {
    const { sessionId } = await openSession();
    await pick(sessionId, { participantId: "p1", prizeIds: ["a"] });
    const res = await pick(sessionId, { participantId: "p1", prizeIds: ["b"] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already-submitted" });
  });

  it("rejects four picks", async () => {
    const { sessionId } = await openSession();
    const res = await pick(sessionId, { participantId: "p1", prizeIds: ["a", "b", "c", "d"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "too-many" });
  });

  it("rejects unknown participants, unknown prizes, and an empty selection", async () => {
    const { sessionId } = await openSession();
    expect((await pick(sessionId, { participantId: "zz", prizeIds: ["a"] })).status).toBe(400);
    expect((await pick(sessionId, { participantId: "p1", prizeIds: ["x"] })).status).toBe(400);
    expect((await pick(sessionId, { participantId: "p1", prizeIds: [] })).status).toBe(400);
  });

  it("replaces picks atomically with the right token and rejects a wrong one", async () => {
    const { sessionId, adminToken } = await openSession();
    const first = await pick(sessionId, { participantId: "p1", prizeIds: ["a", "b"] });
    const { claimToken } = (await first.json()) as { claimToken: string };

    const bad = await pick(sessionId, { participantId: "p1", prizeIds: ["c"], claimToken: "x" });
    expect(bad.status).toBe(403);

    const edit = await pick(sessionId, { participantId: "p1", prizeIds: ["c"], claimToken });
    expect(edit.status).toBe(200);

    await call("POST", `/api/session/${sessionId}/close`, undefined, adminToken);
    const snap = await call("GET", `/api/session/${sessionId}/snapshot`, undefined, adminToken);
    const { picks } = (await snap.json()) as { picks: Record<string, string[]> };
    expect(picks).toEqual({ a: [], b: [], c: ["p1"], d: [] });
  });

  it("rejects submissions after close", async () => {
    const { sessionId, adminToken } = await openSession();
    const first = await pick(sessionId, { participantId: "p1", prizeIds: ["a"] });
    const { claimToken } = (await first.json()) as { claimToken: string };
    expect(
      (await call("POST", `/api/session/${sessionId}/close`, undefined, adminToken)).status,
    ).toBe(200);

    const late = await pick(sessionId, { participantId: "p2", prizeIds: ["a"] });
    expect(late.status).toBe(409);
    expect(await late.json()).toEqual({ error: "session-closed" });
    const edit = await pick(sessionId, { participantId: "p1", prizeIds: ["b"], claimToken });
    expect(edit.status).toBe(409);
  });
});

describe("operator endpoints", () => {
  it("require the admin token", async () => {
    const { sessionId } = await openSession();
    expect((await call("POST", `/api/session/${sessionId}/close`)).status).toBe(401);
    expect((await call("POST", `/api/session/${sessionId}/close`, undefined, "wrong")).status).toBe(
      401,
    );
    expect((await call("GET", `/api/session/${sessionId}/snapshot`)).status).toBe(401);
  });

  it("refuse a snapshot while open, then return the picks map after close", async () => {
    const { sessionId, adminToken } = await openSession();
    await pick(sessionId, { participantId: "p1", prizeIds: ["a", "b"] });
    await pick(sessionId, { participantId: "p3", prizeIds: ["a"] });
    await pick(sessionId, { participantId: "p2", prizeIds: ["a", "a", "c"] });

    const early = await call("GET", `/api/session/${sessionId}/snapshot`, undefined, adminToken);
    expect(early.status).toBe(409);

    const close = await call("POST", `/api/session/${sessionId}/close`, undefined, adminToken);
    const { closedAt } = (await close.json()) as { closedAt: string };
    expect(Number.isNaN(Date.parse(closedAt))).toBe(false);

    const res = await call("GET", `/api/session/${sessionId}/snapshot`, undefined, adminToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      closedAt,
      picks: { a: ["p1", "p2", "p3"], b: ["p1"], c: ["p2"], d: [] },
    });
    expect((await call("GET", `/api/session/${sessionId}`)).status).toBe(200);
  });
});

describe("session deletion", () => {
  async function rowCounts(sessionId: string): Promise<number[]> {
    const tables = ["session", "session_participant", "session_prize", "pick"];
    return Promise.all(
      tables.map(async (t) => {
        const col = t === "session" ? "id" : "session_id";
        const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${col} = ?1`)
          .bind(sessionId)
          .first<{ n: number }>();
        return row!.n;
      }),
    );
  }

  it("refuses deletion without or with a wrong token and keeps the data", async () => {
    const { sessionId } = await openSession();
    await pick(sessionId, { participantId: "p1", prizeIds: ["a"] });
    expect((await call("DELETE", `/api/session/${sessionId}`)).status).toBe(401);
    expect((await call("DELETE", `/api/session/${sessionId}`, undefined, "wrong")).status).toBe(
      401,
    );
    expect(await rowCounts(sessionId)).toEqual([1, 3, 4, 1]);
    expect((await call("GET", `/api/session/${sessionId}`)).status).toBe(200);
  });

  it("removes every row of the session so the pick page 404s, leaving other sessions", async () => {
    const other = await openSession();
    const { sessionId, adminToken } = await openSession();
    await pick(sessionId, { participantId: "p2", prizeIds: ["b", "c"] });

    const res = await call("DELETE", `/api/session/${sessionId}`, undefined, adminToken);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(await rowCounts(sessionId)).toEqual([0, 0, 0, 0]);
    expect((await call("GET", `/api/session/${sessionId}`)).status).toBe(404);
    expect((await call("DELETE", `/api/session/${sessionId}`, undefined, adminToken)).status).toBe(
      404,
    );
    expect((await call("GET", `/api/session/${other.sessionId}`)).status).toBe(200);
  });

  it("deletes through src/session.ts and treats an already-deleted session as done", async () => {
    const fetchApi = (url: string, init?: RequestInit) =>
      worker.fetch(new Request(`http://local${url}`, init), env);
    const { sessionId, adminToken } = await clientOpen(fetchApi, roster);
    await expect(clientDelete(fetchApi, sessionId, "wrong")).rejects.toMatchObject({
      code: "unauthorized",
    });
    await clientDelete(fetchApi, sessionId, adminToken);
    await clientDelete(fetchApi, sessionId, adminToken);
    await expect(clientFetchPick(fetchApi, sessionId)).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("operator client round-trip", () => {
  it("opens, closes and pulls through src/session.ts against the real Worker", async () => {
    const fetchApi = (url: string, init?: RequestInit) =>
      worker.fetch(new Request(`http://local${url}`, init), env);
    const { sessionId, adminToken } = await clientOpen(fetchApi, roster);
    await pick(sessionId, { participantId: "p2", prizeIds: ["b", "d"] });

    await expect(clientPull(fetchApi, sessionId, adminToken)).rejects.toMatchObject({
      status: 409,
      code: "session-open",
    });
    await expect(clientClose(fetchApi, sessionId, "wrong")).rejects.toMatchObject({
      code: "unauthorized",
    });
    const { closedAt } = await clientClose(fetchApi, sessionId, adminToken);
    expect(await clientPull(fetchApi, sessionId, adminToken)).toEqual({
      closedAt,
      picks: { a: [], b: ["p2"], c: [], d: ["p2"] },
    });
  });
});

describe("participant client round-trip", () => {
  it("loads, submits, edits with the claim token, and is refused after close", async () => {
    const fetchApi = (url: string, init?: RequestInit) =>
      worker.fetch(new Request(`http://local${url}`, init), env);
    const { sessionId, adminToken } = await openSession();

    expect(await clientFetchPick(fetchApi, sessionId)).toEqual({ closed: false, ...roster });
    const { claimToken } = await clientSubmit(fetchApi, sessionId, {
      participantId: "p1",
      prizeIds: ["a", "b"],
    });
    await expect(
      clientSubmit(fetchApi, sessionId, { participantId: "p1", prizeIds: ["c"] }),
    ).rejects.toMatchObject({ code: "already-submitted" });
    expect(
      await clientSubmit(fetchApi, sessionId, { participantId: "p1", prizeIds: ["c"], claimToken }),
    ).toEqual({ claimToken });

    await call("POST", `/api/session/${sessionId}/close`, undefined, adminToken);
    expect((await clientFetchPick(fetchApi, sessionId)).closed).toBe(true);
    await expect(
      clientSubmit(fetchApi, sessionId, { participantId: "p1", prizeIds: ["d"], claimToken }),
    ).rejects.toMatchObject({ status: 409, code: "session-closed" });
    await expect(clientFetchPick(fetchApi, "nope")).rejects.toMatchObject({ code: "not-found" });
  });
});

describe("routing", () => {
  it("passes non-API paths to assets and 404s unknown API paths", async () => {
    expect(await (await call("GET", "/")).text()).toBe("asset");
    expect((await call("GET", "/api/unknown")).status).toBe(404);
    expect((await call("PATCH", "/api/session/x")).status).toBe(405);
    expect((await call("DELETE", "/api/session")).status).toBe(405);
  });
});
