import { normalizePicks } from "../src/picks";

/**
 * Worker entry: `/api/*` is the preference-session API backed by D1; every other
 * path falls through to the static SPA assets (`run_worker_first` routes only
 * `/api/*` here, the rest is served by the assets layer directly).
 *
 * The draw itself never touches this API — the operator pulls one snapshot after
 * closing and draws offline.
 */

/** The subset of the D1 binding this Worker uses (kept local to avoid a types dependency). */
export interface D1Result<T> {
  results: T[];
  meta: { changes: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result<unknown>[]>;
}

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

/** Upper bounds on session size and field length; generous for a club, small enough to bound a request. */
export const LIMITS = { participants: 2000, prizes: 500, idLength: 100, nameLength: 100 } as const;

interface Entry {
  id: string;
  name: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

const fail = (status: number, error: string) => json(status, { error });

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Validate a roster/prize list: non-empty strings within limits, unique ids. */
function readEntries(v: unknown, max: number): Entry[] | null {
  if (!Array.isArray(v) || v.length === 0 || v.length > max) return null;
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const item of v) {
    const id = (item as Entry | null)?.id;
    const name = (item as Entry | null)?.name;
    if (typeof id !== "string" || id === "" || id.length > LIMITS.idLength) return null;
    if (typeof name !== "string" || name.trim() === "" || name.length > LIMITS.nameLength) {
      return null;
    }
    if (seen.has(id)) return null;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

function bearer(request: Request): string | null {
  const m = /^Bearer (.+)$/.exec(request.headers.get("Authorization") ?? "");
  return m ? m[1]! : null;
}

interface SessionRow {
  admin_token_hash: string;
  closed_at: string | null;
}

async function createSession(request: Request, env: Env): Promise<Response> {
  const body = (await readJson(request)) as { participants?: unknown; prizes?: unknown } | null;
  const participants = readEntries(body?.participants, LIMITS.participants);
  if (!participants) return fail(400, "invalid-participants");
  const prizes = readEntries(body?.prizes, LIMITS.prizes);
  if (!prizes) return fail(400, "invalid-prizes");

  const sessionId = crypto.randomUUID();
  const adminToken = newToken();
  // json_each keeps each insert one statement regardless of roster size (D1 caps bound params).
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO session (id, admin_token_hash, closed_at, created_at) VALUES (?1, ?2, NULL, ?3)",
    ).bind(sessionId, await sha256Hex(adminToken), new Date().toISOString()),
    env.DB.prepare(
      `INSERT INTO session_participant (session_id, participant_id, name)
       SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.name') FROM json_each(?2)`,
    ).bind(sessionId, JSON.stringify(participants)),
    env.DB.prepare(
      `INSERT INTO session_prize (session_id, prize_id, name, ord)
       SELECT ?1, json_extract(value, '$.id'), json_extract(value, '$.name'), CAST(key AS INTEGER)
       FROM json_each(?2)`,
    ).bind(sessionId, JSON.stringify(prizes)),
  ]);
  return json(201, { sessionId, adminToken });
}

async function getSession(env: Env, id: string): Promise<Response> {
  const session = await env.DB.prepare("SELECT closed_at FROM session WHERE id = ?1")
    .bind(id)
    .first<SessionRow>();
  if (!session) return fail(404, "not-found");
  const [participants, prizes] = await env.DB.batch([
    env.DB.prepare(
      "SELECT participant_id AS id, name FROM session_participant WHERE session_id = ?1 ORDER BY rowid",
    ).bind(id),
    env.DB.prepare(
      "SELECT prize_id AS id, name FROM session_prize WHERE session_id = ?1 ORDER BY ord",
    ).bind(id),
  ]);
  return json(200, {
    closed: session.closed_at !== null,
    participants: participants!.results,
    prizes: prizes!.results,
  });
}

/**
 * Submit or replace one participant's picks.
 *
 * Delete and insert run in one D1 batch (a transaction), and each carries its own
 * guard, so no check-then-write race exists: the delete only removes rows holding
 * the caller's claim hash, and the insert only lands when no rows for that
 * participant remain and the session is still open. A zero-row insert therefore
 * means nothing changed, and the reason is read back afterwards.
 */
async function submitPicks(request: Request, env: Env, id: string): Promise<Response> {
  const body = (await readJson(request)) as {
    participantId?: unknown;
    prizeIds?: unknown;
    claimToken?: unknown;
  } | null;
  const session = await env.DB.prepare("SELECT closed_at FROM session WHERE id = ?1")
    .bind(id)
    .first<SessionRow>();
  if (!session) return fail(404, "not-found");

  const participantId = body?.participantId;
  const member =
    typeof participantId === "string" &&
    (await env.DB.prepare(
      "SELECT 1 AS ok FROM session_participant WHERE session_id = ?1 AND participant_id = ?2",
    )
      .bind(id, participantId)
      .first());
  if (!member) return fail(400, "unknown-participant");

  const prizeRows = await env.DB.prepare("SELECT prize_id FROM session_prize WHERE session_id = ?1")
    .bind(id)
    .all<{ prize_id: string }>();
  const normalized = normalizePicks(
    prizeRows.results.map((r) => r.prize_id),
    body?.prizeIds as string[],
  );
  if (!normalized.ok) return fail(400, normalized.error);
  if (normalized.prizeIds.length === 0) return fail(400, "empty");

  const supplied = typeof body?.claimToken === "string" && body.claimToken !== "";
  const claimToken = supplied ? (body!.claimToken as string) : newToken();
  const claimHash = await sha256Hex(claimToken);
  const open = "EXISTS (SELECT 1 FROM session WHERE id = ?1 AND closed_at IS NULL)";

  const [, inserted] = await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM pick WHERE session_id = ?1 AND participant_id = ?2 AND claim_hash = ?3 AND ${open}`,
    ).bind(id, participantId, claimHash),
    env.DB.prepare(
      `INSERT INTO pick (session_id, participant_id, prize_id, claim_hash, at)
       SELECT ?1, ?2, value, ?3, ?4 FROM json_each(?5)
       WHERE ${open}
         AND NOT EXISTS (SELECT 1 FROM pick WHERE session_id = ?1 AND participant_id = ?2)`,
    ).bind(
      id,
      participantId,
      claimHash,
      new Date().toISOString(),
      JSON.stringify(normalized.prizeIds),
    ),
  ]);
  if (inserted!.meta.changes > 0) return json(200, { claimToken });

  const now = await env.DB.prepare("SELECT closed_at FROM session WHERE id = ?1")
    .bind(id)
    .first<SessionRow>();
  if (now?.closed_at != null) return fail(409, "session-closed");
  return supplied ? fail(403, "bad-claim") : fail(409, "already-submitted");
}

/** Load the session and check the operator token; returns the row or an error response. */
async function authorize(request: Request, env: Env, id: string): Promise<SessionRow | Response> {
  const session = await env.DB.prepare(
    "SELECT admin_token_hash, closed_at FROM session WHERE id = ?1",
  )
    .bind(id)
    .first<SessionRow>();
  if (!session) return fail(404, "not-found");
  const token = bearer(request);
  if (!token || (await sha256Hex(token)) !== session.admin_token_hash) {
    return fail(401, "unauthorized");
  }
  return session;
}

async function closeSession(request: Request, env: Env, id: string): Promise<Response> {
  const session = await authorize(request, env, id);
  if (session instanceof Response) return session;
  if (session.closed_at !== null) return json(200, { closedAt: session.closed_at });
  const closedAt = new Date().toISOString();
  await env.DB.prepare("UPDATE session SET closed_at = ?2 WHERE id = ?1 AND closed_at IS NULL")
    .bind(id, closedAt)
    .run();
  const row = await env.DB.prepare("SELECT closed_at FROM session WHERE id = ?1")
    .bind(id)
    .first<SessionRow>();
  return json(200, { closedAt: row?.closed_at ?? closedAt });
}

/** Closed-only: the draw must read a selection set that can no longer change. */
async function snapshot(request: Request, env: Env, id: string): Promise<Response> {
  const session = await authorize(request, env, id);
  if (session instanceof Response) return session;
  if (session.closed_at === null) return fail(409, "session-open");
  const [prizes, picks] = await env.DB.batch([
    env.DB.prepare("SELECT prize_id FROM session_prize WHERE session_id = ?1 ORDER BY ord").bind(
      id,
    ),
    env.DB.prepare(
      `SELECT pick.prize_id, pick.participant_id FROM pick
       JOIN session_participant sp
         ON sp.session_id = pick.session_id AND sp.participant_id = pick.participant_id
       WHERE pick.session_id = ?1 ORDER BY sp.rowid`,
    ).bind(id),
  ]);
  const map: Record<string, string[]> = {};
  for (const r of prizes!.results as { prize_id: string }[]) map[r.prize_id] = [];
  for (const r of picks!.results as { prize_id: string; participant_id: string }[]) {
    map[r.prize_id]?.push(r.participant_id);
  }
  return json(200, { closedAt: session.closed_at, picks: map });
}

/**
 * Operator-only erase of everything the session put on the server (roster names
 * included). Retention is manual: nothing expires on its own, so this is the path
 * that takes the names back off D1 after the event.
 */
async function deleteSession(request: Request, env: Env, id: string): Promise<Response> {
  const session = await authorize(request, env, id);
  if (session instanceof Response) return session;
  await env.DB.batch(
    ["pick", "session_prize", "session_participant"]
      .map((table) => env.DB.prepare(`DELETE FROM ${table} WHERE session_id = ?1`).bind(id))
      .concat(env.DB.prepare("DELETE FROM session WHERE id = ?1").bind(id)),
  );
  return json(200, { deleted: true });
}

async function handleApi(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;
  if (path === "/api/session") {
    return method === "POST" ? createSession(request, env) : fail(405, "method-not-allowed");
  }
  const m = /^\/api\/session\/([^/]+)(?:\/(pick|close|snapshot))?$/.exec(path);
  if (!m) return fail(404, "not-found");
  let id: string;
  try {
    id = decodeURIComponent(m[1]!);
  } catch {
    return fail(404, "not-found");
  }
  const tail = m[2] ?? "";
  if (tail === "" && method === "DELETE") return deleteSession(request, env, id);
  const expected = { "": "GET", pick: "PUT", close: "POST", snapshot: "GET" }[tail];
  if (method !== expected) return fail(405, "method-not-allowed");
  switch (m[2]) {
    case "pick":
      return submitPicks(request, env, id);
    case "close":
      return closeSession(request, env, id);
    case "snapshot":
      return snapshot(request, env, id);
    default:
      return getSession(env, id);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/")) return handleApi(request, env, path);
    return env.ASSETS.fetch(request);
  },
};
