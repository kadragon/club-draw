import "./style.css";
import { fireConfetti } from "./confetti.js";
import {
  type BackupData,
  backupFilename,
  decodeBackup,
  encodeBackup,
  mergeSessionWins,
  parseRoster,
  participantsToCSV,
  recordsToCSV,
  splitDuplicateRows,
} from "./csv.js";
import {
  buildWheel,
  type CandidatePool,
  candidatesFor,
  candidatesFrom,
  computeTargetRotation,
  effectiveBaseSlots,
  randomBelow,
  selectWinner,
  type WinnerResult,
  wedgeAtPointer,
} from "./draw.js";
import { createMotionPreference } from "./motion.js";
import { drawQr } from "./qr.js";
import {
  buildSessionPayload,
  closeSession,
  countPickers,
  deleteSession,
  openSession,
  pickUrl,
  pullSnapshot,
  sessionErrorMessage,
} from "./session.js";
import { playFanfare, playTick, unlockAudio } from "./sound.js";
import {
  type AppState,
  applyBackupData,
  canDeleteParticipant,
  clampSpinMs,
  DEFAULT_SETTINGS,
  loadState,
  makeParticipant,
  makePrize,
  resetSessionState,
  SPIN_MS_MAX,
  SPIN_MS_MIN,
  saveState,
  setParticipantWins,
} from "./state.js";
import type { DrawMode, PicksMap, Prize } from "./types.js";
import { renderParticipantList, renderPrizeList, renderRecordList } from "./ui.js";
import { createWheel, getTailTime } from "./wheel.js";

const TWO_PI = Math.PI * 2;

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
  sMode: $("s-mode") as HTMLSelectElement,
  currentPrize: $("current-prize"),
  progress: $("progress"),
  modeBadge: $("mode-badge"),
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
  backupDownload: $("backup-download") as HTMLButtonElement,
  backupShow: $("backup-show") as HTMLButtonElement,
  restoreText: $("restore-text") as HTMLTextAreaElement,
  restoreApply: $("restore-apply") as HTMLButtonElement,
  restoreFile: $("restore-file") as HTMLInputElement,
  confirmOverlay: $("confirm-overlay"),
  confirmMessage: $("confirm-message"),
  confirmOk: $("confirm-ok") as HTMLButtonElement,
  confirmCancel: $("confirm-cancel") as HTMLButtonElement,
  sessionCard: $("session-card"),
  sessionNew: $("session-new"),
  sessionOpen: $("session-open") as HTMLButtonElement,
  sessionLive: $("session-live"),
  sessionQr: $("session-qr") as HTMLCanvasElement,
  sessionLink: $("session-link") as HTMLInputElement,
  sessionLinkCopy: $("session-link-copy") as HTMLButtonElement,
  sessionToken: $("session-token") as HTMLInputElement,
  sessionTokenCopy: $("session-token-copy") as HTMLButtonElement,
  sessionClose: $("session-close") as HTMLButtonElement,
  sessionPull: $("session-pull") as HTMLButtonElement,
  sessionDelete: $("session-delete") as HTMLButtonElement,
  sessionMsg: $("session-msg"),
};

// ── Helpers ───────────────────────────────────────────────────────────────
function persist() {
  saveState(state);
}

/** Trigger a file download in the browser without any server round-trip. */
function downloadText(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  // Firefox needs the anchor in the document for a programmatic click, and it reads
  // the blob URL asynchronously afterwards — revoking on the next macrotask can still
  // land before the download task is queued (FileSaver.js settled on a delay for the
  // same case). Hold the URL for a second; it is one small text blob.
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * In-app confirm dialog — works in sandboxed/cross-origin iframes where the
 * native `confirm()` is silently suppressed. Returns a Promise that resolves
 * `true` (확인) or `false` (취소 / Escape / backdrop click).
 */
function confirmModal(message: string): Promise<boolean> {
  if (!els.confirmOverlay.hidden) return Promise.resolve(false); // re-entrancy guard
  return new Promise((resolve) => {
    els.confirmMessage.textContent = message;
    els.confirmOverlay.hidden = false;
    els.confirmOk.focus();
    const finish = (result: boolean) => {
      els.confirmOverlay.hidden = true;
      els.confirmOk.onclick = null;
      els.confirmCancel.onclick = null;
      els.confirmOverlay.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", trapFocus);
      resolve(result);
    };
    // Trap Tab/Shift-Tab within the two buttons — prevents keyboard escape from the dialog.
    const focusables = [els.confirmOk, els.confirmCancel];
    function trapFocus(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      e.preventDefault();
      const idx = focusables.indexOf(document.activeElement as HTMLButtonElement);
      const next = e.shiftKey ? (idx <= 0 ? 1 : 0) : idx >= 1 ? 0 : 1;
      focusables[next]!.focus();
    }
    function onBackdrop(e: MouseEvent) {
      if (e.target === els.confirmOverlay) finish(false);
    }
    document.addEventListener("keydown", trapFocus);
    els.confirmOverlay.addEventListener("click", onBackdrop);
    els.confirmOk.onclick = () => finish(true);
    els.confirmCancel.onclick = () => finish(false);
  });
}

function currentPrize() {
  return state.prizes.find((p) => !p.drawn) ?? null;
}

/**
 * Candidate pool for one prize under the active mode — the single source every
 * call site shares.
 *
 * The displayed wheel, the START gate, the candidate counts and `spin()` all read
 * it, so the wedges on screen and the pool the winner is drawn from can never
 * diverge. With no pending prize there is nothing to intersect against, so the
 * all-remaining pool stands in (used only for gating, never for a draw).
 */
function poolFor(prize: Prize | null): CandidatePool {
  if (!prize) return { candidates: candidatesFrom(state.participants), fellBack: false };
  return candidatesFor(state.participants, state.settings.mode, state.picks, prize.id);
}

/** Base slots derived from the live roster — keeps rebuild and spin call sites symmetric. */
const currentBaseSlots = (): number => effectiveBaseSlots(state.participants);

function rebuildWheel() {
  const cands = poolFor(currentPrize()).candidates;
  wheel.setWheel(cands.length ? buildWheel(cands, currentBaseSlots()) : null);
  refreshIdle();
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

const motion = createMotionPreference();

/**
 * The wheel drifts slowly while idle so the stage feels alive. Allowed only when
 * a draw is actually possible and nothing else owns the wheel: a pending prize
 * and live candidates exist, no spin/reveal in flight, no winner modal open.
 * Without the pending-prize gate the idle RAF
 * would run forever in a finished session (all prizes drawn) with nothing to spin.
 * Re-evaluated after every state change that could flip one of those conditions.
 * Unprompted ambient motion is also skipped entirely under `prefers-reduced-motion`.
 */
function refreshIdle() {
  const allowed =
    els.overlay.hidden &&
    !spinLocked() &&
    currentPrize() !== null &&
    poolFor(currentPrize()).candidates.length > 0 &&
    !motion.reduced();
  wheel.setIdle(allowed);
}

// ── Rendering ───────────────────────────────────────────────────────────────
// DOM construction lives in ui.ts; these wrappers bind it to the live state and
// keep the delete policy (spin lock, delete eligibility, status text) here.

/**
 * Which roster row is showing its inline carry-over editor. Held here rather than in
 * ui.ts so every re-render (delete, import, session reset) closes a stale editor.
 */
let editingWinsId: string | null = null;

function renderParticipants() {
  renderParticipantList(
    els.pList,
    state.participants,
    (p) => {
      if (spinLocked()) return;
      if (!canDeleteParticipant(state, p.id)) {
        els.status.textContent = "당첨자는 세션을 초기화한 뒤 삭제할 수 있습니다.";
        return;
      }
      state.participants = state.participants.filter((x) => x.id !== p.id);
      editingWinsId = null;
      persist();
      renderRoster();
    },
    {
      editingId: editingWinsId,
      // The carry-over drives slot counts, so editing it mid-spin would desync the
      // visible stop from the chosen winner — same gate as delete.
      onStart: (p) => {
        if (spinLocked()) return;
        editingWinsId = p.id;
        renderParticipants();
      },
      onDone: (p, next) => {
        editingWinsId = null;
        if (next === null || spinLocked()) {
          renderParticipants();
          return;
        }
        const updated = setParticipantWins(state.participants, p.id, next);
        if (updated === state.participants) {
          renderParticipants();
          return;
        }
        state.participants = updated;
        persist();
        renderRoster();
      },
    },
  );
}

function renderPrizes() {
  const showPools = state.settings.mode === "preference";
  renderPrizeList(
    els.zList,
    state.prizes,
    state.participants,
    currentPrize(),
    (z) => {
      if (spinLocked()) return;
      // Symmetric with the participant guard: a drawn prize is the winner's only
      // back-reference. Deleting it strands them excluded-but-unspinnable and, since
      // the participant guard then still fires on `excluded`, undeletable too.
      if (z.drawn) {
        els.status.textContent = "추첨된 상품은 세션을 초기화한 뒤 삭제할 수 있습니다.";
        return;
      }
      state.prizes = state.prizes.filter((x) => x.id !== z.id);
      persist();
      renderPrizes();
      syncControls();
      // The pool is prize-scoped, so changing WHICH prize is current is wheel
      // geometry: without the rebuild the canvas would keep the deleted prize's
      // pool while spin() draws from the next one. rebuildWheel also refreshes
      // idle, which removing the last pending prize must do.
      rebuildWheel();
    },
    (z) => {
      if (!showPools) return null;
      const pool = poolFor(z);
      return { count: pool.candidates.length, fellBack: pool.fellBack };
    },
  );
}

function renderRecords() {
  renderRecordList(els.recordList, state.records);
}

function syncControls() {
  els.sSpin.value = String(state.settings.spinMs / 1000);
  els.sSound.checked = state.settings.sound;
  els.sMode.value = state.settings.mode;

  const cur = currentPrize();
  const pool = poolFor(cur);
  const cands = pool.candidates;
  const drawnCount = state.prizes.filter((p) => p.drawn).length;

  // Preference badge is stage-visible on purpose: the operator has to be able to say
  // out loud why a non-picker is on the wheel the moment the pool falls back. With no
  // pending prize there is no pool to describe (`poolFor(null)` never falls back), so
  // the badge would otherwise claim a filter that is not being applied to anything.
  if (state.settings.mode !== "preference" || !cur) {
    els.modeBadge.hidden = true;
    els.modeBadge.textContent = "";
    els.modeBadge.classList.remove("is-fallback");
  } else {
    els.modeBadge.hidden = false;
    els.modeBadge.classList.toggle("is-fallback", pool.fellBack);
    els.modeBadge.textContent = pool.fellBack
      ? "선호 모드 · 고른 사람이 없어 미당첨자 전원으로 추첨"
      : "선호 모드 · 이 상품을 고른 사람만";
  }

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

  // START is reachable (keyboard/SR) in both modes: aria-disabled keeps it in the
  // tab order while gated; the click handler guards against aria-disabled="true".
  // In setup it stays gated with an explanatory tooltip; stage mode applies the
  // real prize/candidate gate.
  const inStage = document.body.classList.contains("stage-mode");
  const canSpin = inStage && !!cur && cands.length > 0 && !spinLocked();
  els.spinBtn.setAttribute("aria-disabled", canSpin ? "false" : "true");
  els.spinBtn.title = inStage ? "" : "발표 모드에서 추첨을 시작할 수 있습니다";
  if (cur && cands.length === 0) {
    els.status.textContent = "남은 후보가 없습니다.";
  } else {
    els.status.textContent = "";
  }
}

/**
 * Re-render everything a roster change touches. The prize list carries per-prize
 * candidate counts under preference mode, so adding, removing or re-weighting a
 * participant changes it too — rendering only the roster leaves those badges stale.
 */
function renderRoster() {
  renderParticipants();
  renderPrizes();
  rebuildWheel();
  syncControls();
}

function renderAll() {
  renderParticipants();
  renderPrizes();
  renderRecords();
  syncControls();
  rebuildWheel();
  renderSession();
}

// ── Preference session (network only here; the draw stays offline) ─────────
/** True while a session request is in flight; blocks double-submits of the same step. */
let sessionBusy = false;
/** QR is redrawn only when the session id changes, not on every render. */
let qrFor: string | null = null;

const fetchApi = (url: string, init?: RequestInit) => fetch(url, init);

/**
 * Card is shown in preference mode, and also whenever a session handle exists so the
 * operator token never becomes unreachable just because the mode was toggled.
 */
function renderSession() {
  const s = state.session;
  els.sessionCard.hidden = state.settings.mode !== "preference" && !s;
  els.sessionNew.hidden = !!s;
  els.sessionLive.hidden = !s;
  els.sessionOpen.disabled = sessionBusy;
  if (!s) {
    qrFor = null;
    return;
  }
  const link = pickUrl(location.origin, s.id);
  els.sessionLink.value = link;
  els.sessionToken.value = s.adminToken;
  // A closed session accepts nothing, so the QR would only invite failed submissions.
  els.sessionQr.hidden = s.closedAt !== null;
  if (s.closedAt === null && qrFor !== link) {
    drawQr(els.sessionQr, link);
    qrFor = link;
  }
  els.sessionClose.disabled = sessionBusy || s.closedAt !== null;
  els.sessionPull.disabled = sessionBusy || s.closedAt === null;
  els.sessionDelete.disabled = sessionBusy;
}

async function runSessionStep(step: () => Promise<void>) {
  if (sessionBusy) return;
  sessionBusy = true;
  renderSession();
  try {
    await step();
  } catch (err) {
    els.sessionMsg.textContent = sessionErrorMessage(err);
  } finally {
    sessionBusy = false;
    renderSession();
  }
}

/** Replace local picks with the closed session's snapshot. Pools change, so it is wheel geometry. */
async function pullPicks() {
  const s = state.session;
  if (!s) return;
  const snap = await pullSnapshot(fetchApi, s.id, s.adminToken);
  // The request is awaited: the session may have been reset, or a spin started, meanwhile.
  if (state.session !== s) return;
  if (spinLocked()) {
    els.sessionMsg.textContent = "추첨 중에는 반영할 수 없습니다. 멈춘 뒤 다시 가져오세요.";
    return;
  }
  state.picks = snap.picks;
  s.closedAt = snap.closedAt;
  persist();
  renderAll();
  els.sessionMsg.textContent = `${countPickers(snap.picks)}명의 선택을 반영했습니다. 이제 네트워크 없이 추첨할 수 있습니다.`;
}

// ── Draw flow ───────────────────────────────────────────────────────────────
let lastResult: WinnerResult | null = null;

function spin() {
  unlockAudio();
  if (els.spinBtn.getAttribute("aria-disabled") === "true") return;
  const prize = currentPrize();
  if (!prize || wheel.isSpinning()) return;

  // Same pool object shape the wheel was rebuilt from, so the wedges on screen and
  // the wedge the winner is drawn from are one layout.
  const result = selectWinner(poolFor(prize).candidates, currentBaseSlots());
  if (!result) {
    syncControls();
    return;
  }
  lastResult = result;

  const turns = 4 + randomBelow(3); // 4–6 full spins
  const frac = 0.12 + randomBelow(76) / 100; // inside arc, away from edges
  const target = computeTargetRotation(result.wheel, result.index, turns, frac);

  els.spinBtn.setAttribute("aria-disabled", "true");
  els.spinBtn.classList.add("is-spinning");
  els.spinBtn.textContent = "…";
  els.status.textContent = "추첨 중…";

  // Launch jolt: camera-shake on the wheel-wrap (CSS, reduced-motion-safe).
  const ww = $("wheel").parentElement as HTMLElement;
  ww.classList.add("launching");
  window.setTimeout(() => ww.classList.remove("launching"), 400);

  let lastPhase = -1;
  let lastTickAt = 0;
  const seg = TWO_PI / Math.max(1, result.wheel.totalSlots);

  const spinMs = state.settings.spinMs;

  // Tail zoom: scale up slightly as the wheel slows to the final result.
  const tailTime = getTailTime(spinMs);
  const tailStartMs = spinMs * (1 - tailTime);
  const zoomDurMs = Math.round(tailTime * spinMs * 0.75); // zoom in over first 75% of tail
  ww.style.setProperty("--zoom-dur", `${zoomDurMs}ms`);
  const zoomTimerId = window.setTimeout(() => ww.classList.add("zooming"), tailStartMs);

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
      // Cancel pending zoom timer (race: tab-switch can delay setTimeout past onDone).
      clearTimeout(zoomTimerId);
      ww.classList.remove("zooming");
      ww.style.removeProperty("--zoom-dur");
      // Landing punch — squash-and-stretch scale on the wheel-wrap (CSS animation).
      ww.classList.add("landed");
      window.setTimeout(() => ww.classList.remove("landed"), 350);
      wheel.setHighlight(result.winner.id);
      const beat = 700;
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
  // Full-screen particle burst — the one motion a reduced-motion viewer never asked
  // for (the spin itself follows their own START press).
  if (!motion.reduced()) fireConfetti();

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
  if (els.spinBtn.getAttribute("aria-disabled") !== "true") els.spinBtn.focus(); // restore focus to the wheel control
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
  renderRoster();
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
  // Same reason as the delete path: a first/again-available prize changes the pool
  // the wheel must show (and may permit idle drift again).
  rebuildWheel();
});

/**
 * Import a pasted/loaded roster, appending only names the roster does not already
 * have. Without the duplicate gate, re-importing the same CSV silently doubles the
 * roster and the doubled entries go straight into the draw.
 */
async function applyRoster(text: string) {
  if (spinLocked()) return; // guard the async FileReader path too, not just the call sites
  const rows = parseRoster(text);
  if (rows.length === 0) {
    els.status.textContent = "가져올 명단이 없습니다.";
    return;
  }
  const { fresh, duplicates } = splitDuplicateRows(state.participants, rows);
  if (duplicates.length > 0) {
    const sample = duplicates.slice(0, 5).join(", ");
    const more = duplicates.length > 5 ? " 외" : "";
    const ok = await confirmModal(
      `이미 명단에 있는 이름 ${duplicates.length}명(${sample}${more})이 포함되어 있습니다.` +
        ` 중복을 제외하고 ${fresh.length}명만 추가할까요?`,
    );
    if (!ok) return;
    // The modal is awaited, so a spin could have started while it was open.
    if (spinLocked()) return;
  }
  if (fresh.length === 0) {
    els.status.textContent = "추가할 새 이름이 없습니다.";
    return;
  }
  for (const row of fresh) state.participants.push(makeParticipant(row.name, row.cumulativeWins));
  els.rosterText.value = "";
  persist();
  renderRoster();
  els.status.textContent =
    duplicates.length > 0
      ? `${fresh.length}명 추가됨 · 중복 ${duplicates.length}명 제외`
      : `${fresh.length}명 추가됨`;
}

els.rosterApply.addEventListener("click", () => {
  void applyRoster(els.rosterText.value);
});
els.rosterFile.addEventListener("change", () => {
  const file = els.rosterFile.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    void applyRoster(String(reader.result ?? ""));
  };
  reader.onerror = () => {
    els.status.textContent = "파일 읽기 실패.";
  };
  reader.readAsText(file);
  els.rosterFile.value = "";
});

// state.ts owns the bounds; the input attributes are set from them at boot.
els.sSpin.min = String(SPIN_MS_MIN / 1000);
els.sSpin.max = String(SPIN_MS_MAX / 1000);
els.sSpin.addEventListener("change", () => {
  // A cleared number input reads as "" → 0 (and a junk one as NaN); both would clamp
  // to SPIN_MS_MIN rather than restore the default, so fall back explicitly. Echo the
  // clamped value back so the field never disagrees with what was persisted.
  const seconds = Number(els.sSpin.value);
  state.settings.spinMs = clampSpinMs(seconds ? seconds * 1000 : DEFAULT_SETTINGS.spinMs);
  els.sSpin.value = String(state.settings.spinMs / 1000);
  persist();
});
els.sSound.addEventListener("change", () => {
  state.settings.sound = els.sSound.checked;
  if (state.settings.sound) unlockAudio();
  persist();
});
// Mode changes the candidate pool, so it is wheel geometry — gated like a delete
// and followed by a full re-render (wheel, counts, badge, START gate).
els.sMode.addEventListener("change", () => {
  if (spinLocked()) {
    els.sMode.value = state.settings.mode;
    return;
  }
  state.settings.mode = els.sMode.value === "preference" ? "preference" : "all";
  persist();
  renderAll();
});

els.sessionOpen.addEventListener("click", () => {
  if (spinLocked()) return;
  const built = buildSessionPayload(state.participants, state.prizes);
  if (!built.ok) {
    els.sessionMsg.textContent = {
      "no-participants": "참가자를 먼저 추가하세요.",
      "no-prizes": "상품을 먼저 추가하세요.",
      "blank-name": "이름이 빈 참가자·상품이 있습니다.",
      "name-too-long": "100자를 넘는 이름이 있습니다.",
    }[built.error];
    return;
  }
  void runSessionStep(async () => {
    const { sessionId, adminToken } = await openSession(fetchApi, built.payload);
    // The request is awaited. A backup restore meanwhile re-issued every id, so the
    // server roster would match nothing locally and every prize would silently fall back.
    const known = new Set(state.participants.map((p) => p.id));
    if (!built.payload.participants.some((p) => known.has(p.id))) {
      els.sessionMsg.textContent = "요청 중 명단이 교체되었습니다. 세션을 다시 개설하세요.";
      return;
    }
    // Picks from any earlier round belong to that round's session, not this one.
    state.session = { id: sessionId, adminToken, closedAt: null };
    state.picks = {};
    persist();
    // Never rebuild the wheel mid-spin/reveal: the landing wedge must stay the drawn one.
    // The token is already saved; the post-reveal advance re-renders the cleared pools.
    if (spinLocked()) renderSession();
    else renderAll();
    els.sessionMsg.textContent = "세션을 열었습니다. 운영자 토큰을 복사해 보관하세요.";
  });
});
els.sessionClose.addEventListener("click", () => {
  const s = state.session;
  if (!s) return;
  void runSessionStep(async () => {
    const { closedAt } = await closeSession(fetchApi, s.id, s.adminToken);
    s.closedAt = closedAt;
    persist();
    // Close and pull are one operator intent; a failed pull leaves the retry button.
    await pullPicks();
  });
});
els.sessionPull.addEventListener("click", () => void runSessionStep(pullPicks));
els.sessionDelete.addEventListener("click", async () => {
  const s = state.session;
  if (!s || sessionBusy) return;
  const warn =
    s.closedAt === null ? " 접수가 아직 열려 있어 참가자가 더는 선택할 수 없게 됩니다." : "";
  if (!(await confirmModal(`서버에서 세션과 명단 이름을 삭제할까요?${warn} (되돌릴 수 없음)`))) {
    return;
  }
  void runSessionStep(async () => {
    await deleteSession(fetchApi, s.id, s.adminToken);
    // The request is awaited: a reset or a new session meanwhile owns the handle now.
    if (state.session !== s) return;
    // Pulled picks stay: they are local and the draw runs offline from them.
    state.session = null;
    persist();
    renderSession();
    els.sessionMsg.textContent = "서버에서 세션을 삭제했습니다.";
  });
});

async function copyField(input: HTMLInputElement, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(input.value);
    button.textContent = "복사됨 ✓";
  } catch (err) {
    console.warn("clipboard write failed:", err);
    input.select(); // fall back to a manual copy
    button.textContent = "복사 실패";
  }
  window.setTimeout(() => {
    button.textContent = "복사";
  }, 1500);
}
els.sessionLinkCopy.addEventListener("click", () =>
  copyField(els.sessionLink, els.sessionLinkCopy),
);
els.sessionTokenCopy.addEventListener("click", () =>
  copyField(els.sessionToken, els.sessionTokenCopy),
);

// ── Stage (presentation) mode ────────────────────────────────────────────────
// Same single page; a body class swaps the setup grid for a full-screen wheel.
// State lives in memory the whole time — switching never reloads or re-inits.
function enterStage() {
  document.body.classList.add("stage-mode");
  syncControls(); // re-evaluate the START gate now that we're presenting
  // The canvas sizes itself from its CSS box on render; let the new layout settle,
  // then redraw so the wheel fills the stage.
  requestAnimationFrame(() => {
    wheel.render();
    refreshIdle();
  });
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
  if (!els.confirmOverlay.hidden) {
    els.confirmCancel.click();
    return;
  } // dismiss as cancel
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

els.resetSession.addEventListener("click", async () => {
  if (spinLocked()) return;
  if (
    !(await confirmModal(
      "세션 당첨/기록과 선호 선택·세션 연결을 초기화할까요? (참가자·상품·누적값은 유지)",
    ))
  )
    return;
  resetSessionState(state);
  els.overlay.hidden = true;
  wheel.setHighlight(null); // drop any lingering reveal spotlight before rebuilding
  closeResult(); // result modal may hold now-stale roster/records
  persist();
  renderAll();
});

// ── Backup / Restore ─────────────────────────────────────────────────────────
els.backupDownload.addEventListener("click", () =>
  downloadText(backupFilename(new Date()), encodeBackup(state)),
);
els.backupShow.addEventListener("click", () => {
  els.restoreText.value = encodeBackup(state);
  els.restoreText.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

async function applyRestore(token: string) {
  if (spinLocked()) return;
  let data: BackupData;
  try {
    data = decodeBackup(token);
  } catch {
    els.status.textContent = "백업 형식이 올바르지 않습니다.";
    return;
  }
  // AND: partial restores (participants-only or prizes-only) are valid use cases.
  if (data.participants.length === 0 && data.prizes.length === 0) {
    els.status.textContent = "백업이 비어 있습니다.";
    return;
  }
  if (!(await confirmModal("현재 데이터를 백업 내용으로 교체할까요? (세션 기록은 초기화됩니다)")))
    return;
  applyBackupData(state, data);
  els.overlay.hidden = true;
  wheel.setHighlight(null);
  closeResult();
  els.restoreText.value = "";
  persist();
  renderAll();
  els.status.textContent = `복원 완료 — 참가자 ${state.participants.length}명, 상품 ${state.prizes.length}개`;
}

els.restoreApply.addEventListener("click", () => applyRestore(els.restoreText.value));
els.restoreFile.addEventListener("change", () => {
  const file = els.restoreFile.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => applyRestore(String(reader.result ?? ""));
  reader.onerror = () => {
    els.status.textContent = "파일 읽기 실패.";
  };
  reader.readAsText(file, "utf-8");
  els.restoreFile.value = "";
});

window.addEventListener("resize", () => wheel.render());

// Toggling the OS setting mid-session must start/stop the drift without a reload.
motion.subscribe(refreshIdle);

// Dev-only verification seam (stripped from production build): lets an automated
// browser check confirm the canvas rotation actually lands the chosen winner
// under the pointer — the cross-module draw.ts ↔ wheel.ts fairness binding.
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__cd = {
    wedgeAtPointer,
    getRotation: () => wheel.getRotation(),
    isSpinning: () => wheel.isSpinning(),
    lastResult: () => lastResult,
    // Preference seed that bypasses the session API, for browser checks without a Worker.
    setPicks: (picks: PicksMap) => {
      state.picks = picks;
      persist();
      renderAll();
    },
    setMode: (mode: DrawMode) => {
      state.settings.mode = mode;
      persist();
      renderAll();
    },
  };
}

// ── Boot ────────────────────────────────────────────────────────────────────
renderAll();
