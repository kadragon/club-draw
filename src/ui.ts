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

function editButton(onClick: () => void): HTMLButtonElement {
  const edit = document.createElement("button");
  edit.className = "li-edit";
  edit.type = "button";
  edit.textContent = "✎";
  edit.title = "누적 당첨 수정";
  edit.setAttribute("aria-label", "누적 당첨 수정");
  edit.onclick = onClick;
  return edit;
}

/**
 * Inline editor for the carry-over count. Commits on Enter/blur and cancels on
 * Escape; both paths report through the same callback (`null` = cancel) so the
 * caller only has to re-render. `commit` is one-shot because Enter blurs the
 * field, which would otherwise fire the handler a second time.
 */
function winsInput(value: number, onDone: (next: number | null) => void): HTMLInputElement {
  const input = document.createElement("input");
  input.className = "li-wins-input";
  input.type = "number";
  input.min = "0";
  input.step = "1";
  input.value = String(value);
  input.title = "누적 당첨 수";
  input.setAttribute("aria-label", "누적 당첨 수");
  let done = false;
  const finish = (next: number | null) => {
    if (done) return;
    done = true;
    onDone(next);
  };
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      finish(Number(input.value));
    } else if (e.key === "Escape") {
      e.preventDefault();
      finish(null);
    }
  };
  input.onblur = () => finish(Number(input.value));
  return input;
}

/**
 * Carry-over editing hooks. The caller owns `editingId` (which row shows the input)
 * so this module stays stateless: `onStart` asks it to flip that id and re-render,
 * `onDone` delivers the committed value or `null` for a cancel — in both cases the
 * caller clears `editingId` and re-renders, which is what closes the editor.
 */
export interface WinsEditor {
  editingId: string | null;
  onStart: (participant: Participant) => void;
  onDone: (participant: Participant, next: number | null) => void;
}

/** Roster list: name, carry-over badge, session-winner badge, edit and delete controls. */
export function renderParticipantList(
  el: HTMLElement,
  participants: readonly Participant[],
  onDelete: (participant: Participant) => void,
  editor?: WinsEditor,
): void {
  el.replaceChildren();
  let focusTarget: HTMLInputElement | null = null;
  for (const p of participants) {
    const li = document.createElement("li");
    li.className = `list-item${p.excluded ? " is-won" : ""}`;
    li.appendChild(nameSpan(p.name));
    if (editor && editor.editingId === p.id) {
      focusTarget = winsInput(p.cumulativeWins, (next) => editor.onDone(p, next));
      li.appendChild(focusTarget);
    } else if (p.cumulativeWins > 0) {
      li.appendChild(badge(`누적 ${p.cumulativeWins}`));
    }
    if (p.excluded) li.appendChild(badge("당첨"));
    if (editor) li.appendChild(editButton(() => editor.onStart(p)));
    li.appendChild(deleteButton(() => onDelete(p)));
    el.appendChild(li);
  }
  // Focus only once the input is in the document — a detached node cannot take it.
  focusTarget?.focus();
  focusTarget?.select();
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
