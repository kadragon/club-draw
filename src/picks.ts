/**
 * How many prizes one participant may pick.
 *
 * Shared by the participant form, the submission endpoint, and the tests, so the
 * cap can never drift between what the UI offers and what the server accepts.
 */
export const MAX_PICKS = 3;

export type NormalizedPicks =
  | { ok: true; prizeIds: string[] }
  | { ok: false; error: "unknown-prize" | "too-many" };

/**
 * Validate one participant's submitted selection against the session's prizes.
 *
 * Deliberately dependency-free (types only) so the Worker can import it and reject
 * a bad submission with the same rule the browser applied. Duplicates collapse
 * first — a double-tap is a UI artefact, not an attempt to exceed the cap — and
 * only then is {@link MAX_PICKS} enforced. An id absent from `knownPrizeIds`
 * (including a non-string that slipped through an untyped payload) is rejected
 * rather than dropped, because silently discarding it would confirm a submission
 * the participant did not make. A payload that is not an array at all is rejected
 * the same way rather than thrown on, so a malformed request stays a 400.
 */
export function normalizePicks(
  knownPrizeIds: readonly string[],
  selected: readonly string[],
): NormalizedPicks {
  if (!Array.isArray(selected)) return { ok: false, error: "unknown-prize" };
  const known = new Set(knownPrizeIds);
  const prizeIds: string[] = [];
  for (const id of selected) {
    if (typeof id !== "string" || !known.has(id)) return { ok: false, error: "unknown-prize" };
    if (!prizeIds.includes(id)) prizeIds.push(id);
  }
  if (prizeIds.length > MAX_PICKS) return { ok: false, error: "too-many" };
  return { ok: true, prizeIds };
}
