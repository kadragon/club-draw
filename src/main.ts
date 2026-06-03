import "./style.css";
import { fireConfetti } from "./confetti.js";
import { mergeSessionWins, parseRoster, participantsToCSV, recordsToCSV } from "./csv.js";
import {
  buildWheel,
  candidatesFrom,
  computeTargetRotation,
  effectiveBaseSlots,
  randomBelow,
  selectWinner,
  type WinnerResult,
  wedgeAtPointer,
} from "./draw.js";
import { playFanfare, playTick, unlockAudio } from "./sound.js";
import { type AppState, loadState, makeParticipant, makePrize, saveState } from "./state.js";
import { createWheel } from "./wheel.js";

const TWO_PI = Math.PI * 2;

/** Honor the OS "reduce motion" setting — compress visuals only, never the result. */
const reduceMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const state: AppState = loadState();
const wheel = createWheel($("wheel") as HTMLCanvasElement);

// ── Element refs ──────────────────────────────────────────────────────────
const els = {
  pForm: $("participant-form") as HTMLFormElement,
  pName: $("p-name") as HTMLInputElement,
  pWins: $("p-wins") as HTMLInputElement,
  pList: $("participant-list"),
  rosterText: $("roster-text") as HTMLTextAreaElement,
  rosterApply: $("roster-apply"),
  rosterFile: $("roster-file") as HTMLInputElement,
  zForm: $("prize-form") as HTMLFormElement,
  zName: $("z-name") as HTMLInputElement,
  zList: $("prize-list"),
  sSpin: $("s-spin") as HTMLInputElement,
  sSound: $("s-sound") as HTMLInputElement,
  currentPrize: $("current-prize"),
  progress: $("progress"),
  spinBtn: $("spin-btn") as HTMLButtonElement,
  status: $("status"),
  recordList: $("record-list"),
  exportCsv: $("export-csv"),
  resetSession: $("reset-session"),
  overlay: $("winner-overlay"),
  winnerName: $("winner-name"),
  winnerPrize: $("winner-prize"),
  winnerNext: $("winner-next"),
  enterStage: $("enter-stage") as HTMLButtonElement,
  exitStage: $("exit-stage") as HTMLButtonElement,
  fairnessBtn: $("fairness-btn") as HTMLButtonElement,
  fairnessOverlay: $("fairness-overlay"),
  fairnessClose: $("fairness-close") as HTMLButtonElement,
  resultOverlay: $("result-overlay"),
  resultRoster: $("result-roster") as HTMLPreElement,
  resultRecords: $("result-records") as HTMLPreElement,
  resultCopy: $("result-copy") as HTMLButtonElement,
  resultClose: $("result-close") as HTMLButtonElement,
};

// ── Helpers ───────────────────────────────────────────────────────────────
function persist() {
  saveState(state);
}

function currentPrize() {
  return state.prizes.find((p) => !p.drawn) ?? null;
}

function liveCandidates() {
  return candidatesFrom(state.participants);
}

function rebuildWheel() {
  const cands = liveCandidates();
  wheel.setWheel(cands.length ? buildWheel(cands, effectiveBaseSlots(state.participants)) : null);
}

/**
 * While a spin animates, the wheel rotates toward a target computed from the
 * geometry captured at spin start. Mutating candidates, base slots, or the prize/
 * session mid-spin would desync the visible stop from the chosen winner (breaking
 * the draw invariant) and can strand the UI. Mutating handlers no-op until the
 * spin settles. Pure-settings (spin time, sound) and stage/overlay navigation stay
 * live — they never change wheel geometry or the in-flight prize.
 *
 * `isRevealing` extends the lock across the post-spin reveal beat: `spinTo` flips
 * `spinning` to false the instant the animation lands, but the winner isn't
 * persisted until `onWin` fires after the beat delay. Without this, a delete/reset/
 * import in that window could drop the pending winner before it's recorded.
 */
let isRevealing = false;
function spinLocked(): boolean {
  return wheel.isSpinning() || isRevealing;
}

// ── Rendering ───────────────────────────────────────────────────────────────
function renderParticipants() {
  els.pList.replaceChildren();
  for (const p of state.participants) {
    const li = document.createElement("li");
    li.className = `list-item${p.excluded ? " is-won" : ""}`;
    const name = document.createElement("span");
    name.className = "li-name";
    name.textContent = p.name;
    li.appendChild(name);
    if (p.cumulativeWins > 0) {
      const badge = document.createElement("span");
      badge.className = "li-badge";
      badge.textContent = `누적 ${p.cumulativeWins}`;
      li.appendChild(badge);
    }
    if (p.excluded) {
      const won = document.createElement("span");
      won.className = "li-badge";
      won.textContent = "당첨";
      li.appendChild(won);
    }
    const del = document.createElement("button");
    del.className = "li-del";
    del.type = "button";
    del.textContent = "×";
    del.title = "삭제";
    del.onclick = () => {
      if (spinLocked()) return;
      state.participants = state.participants.filter((x) => x.id !== p.id);
      persist();
      renderParticipants();
      rebuildWheel();
      syncControls();
    };
    li.appendChild(del);
    els.pList.appendChild(li);
  }
}

function renderPrizes() {
  els.zList.replaceChildren();
  const cur = currentPrize();
  for (const z of state.prizes) {
    const li = document.createElement("li");
    li.className = `list-item${z.drawn ? " is-won" : ""}${z === cur ? " is-current" : ""}`;
    const name = document.createElement("span");
    name.className = "li-name";
    name.textContent = z.name;
    li.appendChild(name);
    if (z.drawn && z.winnerId) {
      const w = state.participants.find((p) => p.id === z.winnerId);
      if (w) {
        const badge = document.createElement("span");
        badge.className = "li-badge";
        badge.textContent = w.name;
        li.appendChild(badge);
      }
    }
    const del = document.createElement("button");
    del.className = "li-del";
    del.type = "button";
    del.textContent = "×";
    del.title = "삭제";
    del.onclick = () => {
      if (spinLocked()) return;
      state.prizes = state.prizes.filter((x) => x.id !== z.id);
      persist();
      renderPrizes();
      syncControls();
    };
    li.appendChild(del);
    els.zList.appendChild(li);
  }
}

function renderRecords() {
  els.recordList.replaceChildren();
  if (state.records.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "아직 당첨자가 없습니다";
    els.recordList.appendChild(empty);
    return;
  }
  for (const r of state.records) {
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
    els.recordList.appendChild(li);
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ko-KR", { hour12: false });
}

function syncControls() {
  els.sSpin.value = String(state.settings.spinMs / 1000);
  els.sSound.checked = state.settings.sound;

  const cur = currentPrize();
  const cands = liveCandidates();
  const drawnCount = state.prizes.filter((p) => p.drawn).length;

  if (state.prizes.length === 0) {
    els.currentPrize.textContent = "상품을 추가하세요";
    els.progress.textContent = "";
  } else if (!cur) {
    els.currentPrize.textContent = "추첨 완료 🎉";
    els.progress.textContent = `${drawnCount} / ${state.prizes.length} 상품`;
  } else {
    els.currentPrize.textContent = cur.name;
    els.progress.textContent = `${drawnCount + 1} / ${state.prizes.length} 상품 · 후보 ${cands.length}명`;
  }

  const canSpin = !!cur && cands.length > 0 && !wheel.isSpinning();
  els.spinBtn.disabled = !canSpin;
  if (cur && cands.length === 0) {
    els.status.textContent = "남은 후보가 없습니다.";
  } else {
    els.status.textContent = "";
  }
}

function renderAll() {
  renderParticipants();
  renderPrizes();
  renderRecords();
  syncControls();
  rebuildWheel();
}

// ── Draw flow ───────────────────────────────────────────────────────────────
let lastResult: WinnerResult | null = null;

function spin() {
  unlockAudio();
  const prize = currentPrize();
  if (!prize || wheel.isSpinning()) return;

  const result = selectWinner(state.participants, effectiveBaseSlots(state.participants));
  if (!result) {
    syncControls();
    return;
  }
  lastResult = result;

  const turns = 4 + randomBelow(3); // 4–6 full spins
  const frac = 0.12 + randomBelow(76) / 100; // inside arc, away from edges
  const target = computeTargetRotation(result.wheel, result.index, turns, frac);

  els.spinBtn.disabled = true;
  els.spinBtn.classList.add("is-spinning");
  els.spinBtn.textContent = "…";
  els.status.textContent = "추첨 중…";

  let lastPhase = -1;
  let lastTickAt = 0;
  const seg = TWO_PI / Math.max(1, result.wheel.totalSlots);

  // reduce-motion: keep the full result path, just collapse the animation to a beat.
  const spinMs = reduceMotion() ? 1 : state.settings.spinMs;

  wheel.spinTo(target, spinMs, {
    onTick: () => {
      if (!state.settings.sound) return;
      const phase = Math.floor(wheel.getRotation() / seg);
      const now = performance.now();
      if (phase !== lastPhase && now - lastTickAt > 35) {
        playTick();
        lastPhase = phase;
        lastTickAt = now;
      }
    },
    onDone: () => {
      els.spinBtn.classList.remove("is-spinning");
      els.spinBtn.textContent = "START";
      els.status.textContent = "당첨자 확인 중…"; // a11y: spin ended; don't leave "추첨 중…" announced
      // Reveal beat: spotlight the wedge the wheel landed on — the pointer sits over
      // it, making "휠이 멈춘 칸 == 당첨자" visible — then pop the modal. Hold the lock
      // across the beat so the pending winner can't be deleted before it's recorded.
      isRevealing = true;
      wheel.setHighlight(result.winner.id);
      const beat = reduceMotion() ? 150 : 700;
      window.setTimeout(() => {
        isRevealing = false;
        onWin(result.winner.id, prize.id);
      }, beat);
    },
  });
}

function onWin(winnerId: string, prizeId: string) {
  const winner = state.participants.find((p) => p.id === winnerId);
  const prize = state.prizes.find((p) => p.id === prizeId);
  if (!winner || !prize) return;

  winner.excluded = true; // session removal; cumulativeWins stays historical
  prize.drawn = true;
  prize.winnerId = winner.id;
  state.records.push({
    prize: prize.name,
    winner: winner.name,
    winnerId: winner.id,
    at: new Date().toISOString(),
  });
  persist();

  if (state.settings.sound) playFanfare();
  if (!reduceMotion()) fireConfetti();

  els.winnerName.textContent = winner.name;
  els.winnerPrize.textContent = prize.name;
  els.overlay.hidden = false;
  els.winnerNext.focus(); // move focus into the modal for keyboard users

  renderParticipants();
  renderPrizes();
  renderRecords();
}

function closeOverlayAndAdvance() {
  if (els.overlay.hidden) return;
  els.overlay.hidden = true;
  wheel.setHighlight(null); // drop the reveal spotlight before rebuilding
  rebuildWheel();
  syncControls();
  if (!els.spinBtn.disabled) els.spinBtn.focus(); // restore focus to the wheel control
}

// ── Events ──────────────────────────────────────────────────────────────────
els.pForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (spinLocked()) return;
  const name = els.pName.value.trim();
  if (!name) return;
  const wins = Math.max(0, Math.floor(Number(els.pWins.value) || 0));
  state.participants.push(makeParticipant(name, wins));
  els.pName.value = "";
  els.pWins.value = "0";
  els.pName.focus();
  persist();
  renderParticipants();
  rebuildWheel();
  syncControls();
});

els.zForm.addEventListener("submit", (e) => {
  e.preventDefault();
  if (spinLocked()) return;
  const name = els.zName.value.trim();
  if (!name) return;
  state.prizes.push(makePrize(name));
  els.zName.value = "";
  els.zName.focus();
  persist();
  renderPrizes();
  syncControls();
});

function applyRoster(text: string) {
  if (spinLocked()) return; // guard the async FileReader path too, not just the call sites
  const rows = parseRoster(text);
  if (rows.length === 0) return;
  for (const row of rows) state.participants.push(makeParticipant(row.name, row.cumulativeWins));
  els.rosterText.value = "";
  persist();
  renderParticipants();
  rebuildWheel();
  syncControls();
  els.status.textContent = `${rows.length}명 추가됨`;
}

els.rosterApply.addEventListener("click", () => applyRoster(els.rosterText.value));
els.rosterFile.addEventListener("change", () => {
  const file = els.rosterFile.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => applyRoster(String(reader.result ?? ""));
  reader.readAsText(file);
  els.rosterFile.value = "";
});

els.sSpin.addEventListener("change", () => {
  state.settings.spinMs = Math.min(
    20000,
    Math.max(1000, Math.round((Number(els.sSpin.value) || 5) * 1000)),
  );
  persist();
});
els.sSound.addEventListener("change", () => {
  state.settings.sound = els.sSound.checked;
  if (state.settings.sound) unlockAudio();
  persist();
});

// ── Stage (presentation) mode ────────────────────────────────────────────────
// Same single page; a body class swaps the setup grid for a full-screen wheel.
// State lives in memory the whole time — switching never reloads or re-inits.
function enterStage() {
  document.body.classList.add("stage-mode");
  // The canvas sizes itself from its CSS box on render; let the new layout settle,
  // then redraw so the wheel fills the stage.
  requestAnimationFrame(() => wheel.render());
}
function exitStage() {
  document.body.classList.remove("stage-mode");
  renderAll();
}

// ── Fairness modal ────────────────────────────────────────────────────────────
function openFairness() {
  els.fairnessOverlay.hidden = false;
  els.fairnessClose.focus();
}
function closeFairness() {
  if (els.fairnessOverlay.hidden) return;
  els.fairnessOverlay.hidden = true;
  els.fairnessBtn.focus();
}

els.spinBtn.addEventListener("click", spin);
els.winnerNext.addEventListener("click", closeOverlayAndAdvance);
els.enterStage.addEventListener("click", enterStage);
els.exitStage.addEventListener("click", exitStage);
els.fairnessBtn.addEventListener("click", openFairness);
els.fairnessClose.addEventListener("click", closeFairness);
els.fairnessOverlay.addEventListener("click", (e) => {
  if (e.target === els.fairnessOverlay) closeFairness(); // click on backdrop, not card
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.fairnessOverlay.hidden) closeFairness();
  else if (!els.resultOverlay.hidden) closeResult();
  else if (!els.overlay.hidden) closeOverlayAndAdvance();
});

// ── Result modal (updated roster + session records, copyable) ───────────────
// The roster column folds this session's wins into each person's carry-over total
// for DISPLAY only — state.participants.cumulativeWins is never auto-incremented
// (operator-entered carry-over invariant). Operator copies it as the next round's
// roster if they choose to.
function closeResult() {
  if (els.resultOverlay.hidden) return;
  els.resultOverlay.hidden = true;
  els.exportCsv.focus();
}
els.exportCsv.addEventListener("click", () => {
  if (state.records.length === 0) {
    els.status.textContent = "내보낼 기록이 없습니다.";
    return;
  }
  els.resultRoster.textContent = participantsToCSV(
    mergeSessionWins(state.participants, state.records),
  );
  els.resultRecords.textContent = recordsToCSV(state.records);
  els.resultCopy.textContent = "명단 복사";
  els.resultOverlay.hidden = false;
  els.resultClose.focus();
});
els.resultClose.addEventListener("click", closeResult);
els.resultOverlay.addEventListener("click", (e) => {
  if (e.target === els.resultOverlay) closeResult(); // backdrop, not card
});
els.resultCopy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(els.resultRoster.textContent ?? "");
    els.resultCopy.textContent = "복사됨 ✓";
  } catch (err) {
    console.warn("clipboard write failed:", err);
    els.resultCopy.textContent = "복사 실패";
  }
});

els.resetSession.addEventListener("click", () => {
  if (spinLocked()) return;
  if (!confirm("세션 당첨/기록을 초기화할까요? (참가자·상품·누적값은 유지)")) return;
  for (const p of state.participants) p.excluded = false;
  for (const z of state.prizes) {
    z.drawn = false;
    z.winnerId = undefined;
  }
  state.records = [];
  els.overlay.hidden = true;
  wheel.setHighlight(null); // drop any lingering reveal spotlight before rebuilding
  closeResult(); // result modal may hold now-stale roster/records
  persist();
  renderAll();
});

// Also allow exporting roster could be future; keep MVP focused.

window.addEventListener("resize", () => wheel.render());

// Dev-only verification seam (stripped from production build): lets an automated
// browser check confirm the canvas rotation actually lands the chosen winner
// under the pointer — the cross-module draw.ts ↔ wheel.ts fairness binding.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__cd = {
    wedgeAtPointer,
    getRotation: () => wheel.getRotation(),
    isSpinning: () => wheel.isSpinning(),
    lastResult: () => lastResult,
  };
}

// ── Boot ────────────────────────────────────────────────────────────────────
renderAll();
