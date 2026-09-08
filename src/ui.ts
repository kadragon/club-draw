// List rendering for the setup panels. DOM construction only — no app state, no
// policy: every guard (spin lock, delete eligibility, status messages) stays in
// main.ts and reaches here as an `onDelete` callback. Depends on types.ts alone.
//
// Names are user input, so every insertion goes through `textContent`; `innerHTML`
// is never used (AGENTS.md).

import type { DrawRecord, Participant, Prize } from "./types.js";

function badge(text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "li-badge";
  el.textContent = text;
  return el;
}

function nameSpan(text: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "li-name";
  el.textContent = text;
  return el;
}

function deleteButton(onClick: () => void): HTMLButtonElement {
  const del = document.createElement("button");
  del.className = "li-del";
  del.type = "button";
  del.textContent = "×";
  del.title = "삭제";
  del.onclick = onClick;
  return del;
}

/** Roster list: name, carry-over badge, session-winner badge, delete control. */
export function renderParticipantList(
  el: HTMLElement,
  participants: readonly Participant[],
  onDelete: (participant: Participant) => void,
): void {
  el.replaceChildren();
  for (const p of participants) {
    const li = document.createElement("li");
    li.className = `list-item${p.excluded ? " is-won" : ""}`;
    li.appendChild(nameSpan(p.name));
    if (p.cumulativeWins > 0) li.appendChild(badge(`누적 ${p.cumulativeWins}`));
    if (p.excluded) li.appendChild(badge("당첨"));
    li.appendChild(deleteButton(() => onDelete(p)));
    el.appendChild(li);
  }
}

/**
 * Prize list in draw order. `currentPrize` is the next undrawn prize (marked
 * `is-current`); a drawn prize shows its winner's name resolved from `participants`.
 */
export function renderPrizeList(
  el: HTMLElement,
  prizes: readonly Prize[],
  participants: readonly Participant[],
  currentPrize: Prize | null,
  onDelete: (prize: Prize) => void,
): void {
  el.replaceChildren();
  for (const z of prizes) {
    const li = document.createElement("li");
    li.className = `list-item${z.drawn ? " is-won" : ""}${z === currentPrize ? " is-current" : ""}`;
    li.appendChild(nameSpan(z.name));
    if (z.drawn && z.winnerId) {
      const w = participants.find((p) => p.id === z.winnerId);
      if (w) li.appendChild(badge(w.name));
    }
    li.appendChild(deleteButton(() => onDelete(z)));
    el.appendChild(li);
  }
}

/** Locale timestamp for the history log; falls back to the raw string if unparseable. */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { hour12: false });
}

/** Session history, newest last. Empty history renders a placeholder row. */
export function renderRecordList(el: HTMLElement, records: readonly DrawRecord[]): void {
  el.replaceChildren();
  if (records.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "아직 당첨자가 없습니다";
    el.appendChild(empty);
    return;
  }
  for (const r of records) {
    const li = document.createElement("li");
    li.className = "record";
    const top = document.createElement("div");
    top.className = "record-top";
    const winner = document.createElement("span");
    winner.className = "record-winner";
    winner.textContent = r.winner;
    const prize = document.createElement("span");
    prize.className = "record-prize";
    prize.textContent = r.prize;
    top.append(winner, prize);
    const at = document.createElement("span");
    at.className = "record-at";
    at.textContent = formatTime(r.at);
    li.append(top, at);
    el.appendChild(li);
  }
}
