import "./style.css";
import {
  type Claims,
  claimKey,
  type Entry,
  fetchPickSession,
  type PickSession,
  pickErrorMessage,
  readClaims,
  searchRoster,
  submitPicks,
  withClaim,
} from "./pick-client.js";
import { MAX_PICKS } from "./picks.js";
import { SessionApiError } from "./session.js";

/**
 * Participant page (`/pick?s=<sessionId>`): find yourself in the roster, pick up to
 * MAX_PICKS prizes, submit. The claim token from the first submission is kept in this
 * device's localStorage so the same device can edit until the operator closes.
 *
 * Separate entry from the operator SPA — no wheel, confetti, or sound in this bundle.
 * Names are user input: DOM insertion is `textContent` only.
 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const el = {
  status: $<HTMLParagraphElement>("pick-status"),
  closed: $<HTMLElement>("pick-closed"),
  closedMine: $<HTMLSpanElement>("pick-closed-mine"),
  find: $<HTMLElement>("pick-find"),
  search: $<HTMLInputElement>("pick-search"),
  results: $<HTMLUListElement>("pick-results"),
  resultsHint: $<HTMLParagraphElement>("pick-results-hint"),
  form: $<HTMLElement>("pick-form"),
  change: $<HTMLButtonElement>("pick-change"),
  name: $<HTMLSpanElement>("pick-name"),
  count: $<HTMLParagraphElement>("pick-count"),
  prizes: $<HTMLOListElement>("pick-prizes"),
  submit: $<HTMLButtonElement>("pick-submit"),
  msg: $<HTMLParagraphElement>("pick-msg"),
};

const sessionId = new URLSearchParams(location.search).get("s") ?? "";
const fetchApi = (url: string, init?: RequestInit) => fetch(url, init);

let session: PickSession | null = null;
let claims: Claims = {};
let me: Entry | null = null;
let selected: string[] = [];
let busy = false;

function loadClaims(): Claims {
  try {
    return readClaims(localStorage.getItem(claimKey(sessionId)));
  } catch {
    return {};
  }
}

function saveClaims(): void {
  try {
    localStorage.setItem(claimKey(sessionId), JSON.stringify(claims));
  } catch {
    // Storage blocked (private mode): the submission still landed; only editing is lost.
  }
}

function renderResults(): void {
  if (!session) return;
  const matches = searchRoster(session.participants, el.search.value);
  el.results.replaceChildren(
    ...matches.map((p) => {
      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "list-item pick-result";
      btn.textContent = p.name;
      if (claims[p.id]) {
        const tag = document.createElement("span");
        tag.className = "pick-tag";
        tag.textContent = "제출함";
        btn.append(tag);
      }
      btn.addEventListener("click", () => choose(p));
      li.append(btn);
      return li;
    }),
  );
  const blank = el.search.value.trim() === "";
  el.resultsHint.hidden = !blank && matches.length > 0;
  el.resultsHint.textContent = blank ? "이름 일부를 입력하세요." : "일치하는 이름이 없습니다.";
}

function renderForm(): void {
  if (!session || !me) return;
  const readOnly = session.closed;
  const claim = claims[me.id];
  el.name.textContent = me.name;
  el.change.hidden = readOnly;
  // Switching participant mid-submit would land the response message on the wrong name.
  el.change.disabled = busy;
  el.count.textContent = readOnly
    ? `선택 ${selected.length}개`
    : `${selected.length} / ${MAX_PICKS}개 선택 · 최대 ${MAX_PICKS}개`;

  const full = selected.length >= MAX_PICKS;
  el.prizes.replaceChildren(
    ...session.prizes.map((z) => {
      const li = document.createElement("li");
      const label = document.createElement("label");
      label.className = "list-item pick-prize";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = selected.includes(z.id);
      box.disabled = readOnly || busy || (full && !box.checked);
      box.addEventListener("change", () => {
        selected = box.checked ? [...selected, z.id] : selected.filter((id) => id !== z.id);
        el.msg.textContent = "";
        renderForm();
      });
      const name = document.createElement("span");
      name.className = "li-name";
      name.textContent = z.name;
      label.append(box, name);
      li.append(label);
      return li;
    }),
  );

  el.submit.hidden = readOnly;
  el.submit.disabled = busy || selected.length === 0;
  el.submit.textContent = claim ? "수정 제출" : "제출";
}

function choose(p: Entry): void {
  if (!session) return;
  const known = new Set(session.prizes.map((z) => z.id));
  me = p;
  selected = (claims[p.id]?.prizeIds ?? []).filter((id) => known.has(id));
  el.msg.textContent = claims[p.id] ? "제출한 선택입니다. 마감 전까지 수정할 수 있습니다." : "";
  el.find.hidden = true;
  el.form.hidden = false;
  renderForm();
}

function showFind(): void {
  me = null;
  selected = [];
  el.form.hidden = true;
  el.find.hidden = false;
  renderResults();
  el.search.focus();
}

function showClosed(): void {
  if (!session) return;
  session.closed = true;
  el.closed.hidden = false;
  el.find.hidden = true;
  // Only a device that submitted has anything to show; otherwise the notice stands alone.
  const mine = me && claims[me.id] ? me : session.participants.find((p) => claims[p.id]);
  el.closedMine.hidden = !mine;
  if (!mine) {
    el.form.hidden = true;
    return;
  }
  choose(mine);
  el.msg.textContent = "";
}

async function submit(): Promise<void> {
  if (!session || !me || busy || selected.length === 0) return;
  const who = me;
  const prizeIds = [...selected];
  const claimToken = claims[who.id]?.claimToken;
  busy = true;
  el.msg.textContent = "제출 중…";
  renderForm();
  try {
    const res = await submitPicks(fetchApi, sessionId, {
      participantId: who.id,
      prizeIds,
      ...(claimToken ? { claimToken } : {}),
    });
    claims = withClaim(claims, who.id, { claimToken: res.claimToken, prizeIds });
    saveClaims();
    el.msg.textContent = claimToken
      ? "수정했습니다. 마감 전까지 다시 바꿀 수 있습니다."
      : "제출했습니다. 마감 전까지 이 기기에서 수정할 수 있습니다.";
  } catch (err) {
    if (err instanceof SessionApiError && err.code === "session-closed") showClosed();
    el.msg.textContent = pickErrorMessage(err);
  } finally {
    busy = false;
  }
  renderForm();
}

async function boot(): Promise<void> {
  if (sessionId === "") {
    el.status.textContent = "잘못된 링크입니다. 운영자가 보여 준 QR을 다시 찍어 주세요.";
    return;
  }
  claims = loadClaims();
  try {
    session = await fetchPickSession(fetchApi, sessionId);
  } catch (err) {
    el.status.textContent = pickErrorMessage(err);
    return;
  }
  el.status.hidden = true;
  if (session.closed) {
    showClosed();
    return;
  }
  const submitted = session.participants.filter((p) => claims[p.id]);
  if (submitted.length === 1) choose(submitted[0]!);
  else showFind();
}

el.search.addEventListener("input", renderResults);
el.change.addEventListener("click", showFind);
el.submit.addEventListener("click", () => void submit());

void boot();
