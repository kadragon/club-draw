import { readPicks } from "./state.js";
import type { Participant, PicksMap, Prize } from "./types.js";

/**
 * Operator-side client for the preference-session API (`worker/index.ts`).
 *
 * Network is touched only while opening, closing and pulling; once the snapshot is in
 * `state.picks` the draw never calls back here. `fetch` is injectable so the tests can
 * drive the real Worker in-process instead of mocking the contract.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Mirrors the Worker's `LIMITS.nameLength`; checked here so the operator gets a reason, not a 400. */
export const NAME_MAX = 100;

export interface SessionPayload {
  participants: { id: string; name: string }[];
  prizes: { id: string; name: string }[];
}

export type PayloadResult =
  | { ok: true; payload: SessionPayload }
  | { ok: false; error: "no-participants" | "no-prizes" | "blank-name" | "name-too-long" };

/**
 * The roster and prizes pushed on open, keyed by the LOCAL ids so the pulled picks map
 * lands on `state` without translation. Names are validated with the Worker's rule.
 */
export function buildSessionPayload(
  participants: readonly Participant[],
  prizes: readonly Prize[],
): PayloadResult {
  if (participants.length === 0) return { ok: false, error: "no-participants" };
  if (prizes.length === 0) return { ok: false, error: "no-prizes" };
  const entries = [...participants, ...prizes];
  if (entries.some((e) => e.name.trim() === "")) return { ok: false, error: "blank-name" };
  if (entries.some((e) => e.name.length > NAME_MAX)) return { ok: false, error: "name-too-long" };
  return {
    ok: true,
    payload: {
      participants: participants.map(({ id, name }) => ({ id, name })),
      prizes: prizes.map(({ id, name }) => ({ id, name })),
    },
  };
}

/** Participant link encoded in the QR: one shared URL for the whole session. */
export function pickUrl(origin: string, sessionId: string): string {
  return `${origin}/pick?s=${encodeURIComponent(sessionId)}`;
}

export class SessionApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`session api ${status}: ${code}`);
  }
}

async function request<T>(fetchFn: FetchLike, url: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new SessionApiError(0, "network");
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!res.ok || body === null) {
    throw new SessionApiError(
      res.status,
      typeof body?.error === "string" ? body.error : "bad-response",
    );
  }
  return body;
}

const path = (id: string, tail = "") => `/api/session/${encodeURIComponent(id)}${tail}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

export async function openSession(
  fetchFn: FetchLike,
  payload: SessionPayload,
): Promise<{ sessionId: string; adminToken: string }> {
  const body = await request<{ sessionId?: unknown; adminToken?: unknown }>(
    fetchFn,
    "/api/session",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
  if (typeof body.sessionId !== "string" || typeof body.adminToken !== "string") {
    throw new SessionApiError(200, "bad-response");
  }
  return { sessionId: body.sessionId, adminToken: body.adminToken };
}

export async function closeSession(
  fetchFn: FetchLike,
  id: string,
  token: string,
): Promise<{ closedAt: string }> {
  const body = await request<{ closedAt?: unknown }>(fetchFn, path(id, "/close"), {
    method: "POST",
    headers: auth(token),
  });
  if (typeof body.closedAt !== "string") throw new SessionApiError(200, "bad-response");
  return { closedAt: body.closedAt };
}

export async function pullSnapshot(
  fetchFn: FetchLike,
  id: string,
  token: string,
): Promise<{ closedAt: string; picks: PicksMap }> {
  const body = await request<{ closedAt?: unknown; picks?: unknown }>(
    fetchFn,
    path(id, "/snapshot"),
    { method: "GET", headers: auth(token) },
  );
  if (typeof body.closedAt !== "string") throw new SessionApiError(200, "bad-response");
  return { closedAt: body.closedAt, picks: readPicks(body.picks) };
}

/** How many distinct participants made at least one pick — the operator's pull summary. */
export function countPickers(picks: PicksMap): number {
  return new Set(Object.values(picks).flat()).size;
}

/** Operator-facing Korean text for an API failure. */
export function sessionErrorMessage(err: unknown): string {
  if (!(err instanceof SessionApiError)) return "알 수 없는 오류가 발생했습니다.";
  switch (err.code) {
    case "network":
      return "서버에 연결할 수 없습니다. 네트워크를 확인하세요.";
    case "unauthorized":
      return "운영자 토큰이 맞지 않습니다.";
    case "not-found":
      return "세션을 찾을 수 없습니다.";
    case "session-open":
      return "접수를 먼저 마감하세요.";
    case "invalid-participants":
      return "명단을 서버가 거부했습니다(중복 id·빈 이름·인원 초과).";
    case "invalid-prizes":
      return "상품 목록을 서버가 거부했습니다(중복 id·빈 이름·개수 초과).";
    default:
      return `서버 오류 (${err.status} ${err.code})`;
  }
}
