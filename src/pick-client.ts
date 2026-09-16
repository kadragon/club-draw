import { MAX_PICKS } from "./picks.js";
import { type FetchLike, request, SessionApiError, sessionPath } from "./session.js";

/**
 * Participant-side logic for `pick.html`: roster search, the per-device claim store,
 * and the two API calls a participant makes. DOM-free so vitest covers it; the page
 * wiring lives in `pick.ts`.
 */

export interface Entry {
  id: string;
  name: string;
}

export interface PickSession {
  closed: boolean;
  participants: Entry[];
  prizes: Entry[];
}

/** What this device remembers about one participant's submission. */
export interface Claim {
  claimToken: string;
  prizeIds: string[];
}

export type Claims = Record<string, Claim>;

const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();

/**
 * Roster entries whose name contains `query`, ignoring case and whitespace. A blank
 * query matches nothing so the page never lists the whole roster at once.
 */
export function searchRoster(roster: readonly Entry[], query: string, limit = 20): Entry[] {
  const q = squash(query);
  if (q === "") return [];
  const out: Entry[] = [];
  for (const entry of roster) {
    if (!squash(entry.name).includes(q)) continue;
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
}

/** localStorage key for one session's claims. */
export function claimKey(sessionId: string): string {
  return `club-draw:pick:${sessionId}`;
}

/** Parse the stored claims, dropping anything malformed rather than failing the page. */
export function readClaims(raw: string | null): Claims {
  let parsed: unknown;
  try {
    parsed = raw === null ? null : JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const out: Claims = {};
  for (const [participantId, v] of Object.entries(parsed)) {
    const c = v as Partial<Claim> | null;
    if (typeof c?.claimToken !== "string" || c.claimToken === "") continue;
    const prizeIds = Array.isArray(c.prizeIds)
      ? c.prizeIds.filter((id): id is string => typeof id === "string")
      : [];
    out[participantId] = { claimToken: c.claimToken, prizeIds };
  }
  return out;
}

export function withClaim(claims: Claims, participantId: string, claim: Claim): Claims {
  return { ...claims, [participantId]: claim };
}

const isEntries = (v: unknown): v is Entry[] =>
  Array.isArray(v) &&
  v.every((e) => typeof e?.id === "string" && typeof (e as Entry).name === "string");

export async function fetchPickSession(fetchFn: FetchLike, id: string): Promise<PickSession> {
  const body = await request<Partial<PickSession>>(fetchFn, sessionPath(id), { method: "GET" });
  if (
    typeof body.closed !== "boolean" ||
    !isEntries(body.participants) ||
    !isEntries(body.prizes)
  ) {
    throw new SessionApiError(200, "bad-response");
  }
  return { closed: body.closed, participants: body.participants, prizes: body.prizes };
}

export async function submitPicks(
  fetchFn: FetchLike,
  id: string,
  submission: { participantId: string; prizeIds: string[]; claimToken?: string },
): Promise<{ claimToken: string }> {
  const body = await request<{ claimToken?: unknown }>(fetchFn, sessionPath(id, "/pick"), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });
  if (typeof body.claimToken !== "string") throw new SessionApiError(200, "bad-response");
  return { claimToken: body.claimToken };
}

/** Participant-facing Korean text for an API failure. */
export function pickErrorMessage(err: unknown): string {
  if (!(err instanceof SessionApiError)) return "알 수 없는 오류가 발생했습니다.";
  switch (err.code) {
    case "network":
      return "서버에 연결할 수 없습니다. 네트워크를 확인하고 다시 시도하세요.";
    case "not-found":
      return "접수 세션을 찾을 수 없습니다. QR을 다시 찍어 주세요.";
    case "session-closed":
      return "접수가 마감되어 더 이상 제출하거나 수정할 수 없습니다.";
    case "already-submitted":
      return "이미 제출한 이름입니다. 처음 제출한 기기에서만 수정할 수 있습니다.";
    case "bad-claim":
      return "이 기기의 제출 기록이 서버와 맞지 않아 수정할 수 없습니다.";
    case "too-many":
      return `상품은 최대 ${MAX_PICKS}개까지 고를 수 있습니다.`;
    case "unknown-prize":
    case "unknown-participant":
      return "명단 또는 상품 정보가 바뀌었습니다. 페이지를 새로고침하세요.";
    case "empty":
      return "상품을 1개 이상 고르세요.";
    default:
      return `서버 오류 (${err.status} ${err.code})`;
  }
}
