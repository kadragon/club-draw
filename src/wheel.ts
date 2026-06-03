import { highlightState } from "./draw.js";
import { prefersReducedMotion } from "./motion.js";
import type { Wheel } from "./types.js";

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;

const INK = "#0a0a0a";

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ch = (x: number): number => {
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [
    Math.round(ch(h + 1 / 3) * 255),
    Math.round(ch(h) * 255),
    Math.round(ch(h - 1 / 3) * 255),
  ];
}
const hex2 = (n: number): string => n.toString(16).padStart(2, "0");
const linear = (c: number): number => {
  const x = c / 255;
  return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};

/**
 * 30 visually distinct cell colors — one per participant (the wheel supports up to
 * ~30 people, so each person needs their own recognizable color rather than a
 * 6-color cycle that repeats). Hues are dealt by the golden angle (137.5°) so
 * participants placed next to each other get strongly contrasting colors, while
 * three rotating lightness/saturation bands separate any two hues that still land
 * close. `LABEL_INK[k]` is the readable text color for `PALETTE[k]`, chosen from
 * its relative luminance.
 */
const { PALETTE, LABEL_INK } = ((): { PALETTE: string[]; LABEL_INK: string[] } => {
  const fills: string[] = [];
  const inks: string[] = [];
  // Pastel contract: keep `light` ≥ ~0.78 so every wedge's computed luminance
  // stays > 0.5 below and LABEL_INK resolves to dark ink. Darkening the palette
  // flips some labels to white — re-check label legibility if you retune these.
  const sat = [0.55, 0.48, 0.6];
  const light = [0.82, 0.86, 0.78];
  for (let k = 0; k < 30; k++) {
    const [r, g, b] = hslToRgb(((k * 137.508) % 360) / 360, sat[k % 3]!, light[k % 3]!);
    fills.push(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
    const lum = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
    inks.push(lum > 0.5 ? "#0a0a0a" : "#ffffff");
  }
  return { PALETTE: fills, LABEL_INK: inks };
})();

/**
 * Spin easing with a long, suspenseful tail.
 *
 * A fast opening phase decelerates into a slow crawl, then the crawl eases gently
 * to a dead stop over the final ~2–3 seconds — the "쫄깃한" near-miss build-up. The
 * curve is built from a piecewise-linear *velocity* profile (continuous, strictly
 * positive until the very end) integrated to position, normalized so `e(0)=0` and
 * `e(1)=1`. Because the easing only reshapes the motion — never the endpoint — the
 * wheel always settles on exactly the chosen cell (fairness invariant untouched).
 *
 * @param durationMs total spin time; the tail is held to ~2–3s of it.
 */
function makeSuspenseEase(durationMs: number): (t: number) => number {
  const tailDist = 0.12; // fraction of the rotation saved for the slow crawl
  const tailTime = Math.min(0.6, Math.max(0.35, 3000 / durationMs)); // ~2–3s tail
  const ts = 1 - tailTime;
  const v1 = (2 * tailDist) / tailTime; // crawl speed entering the tail
  const v0 = (2 * (1 - tailDist)) / ts - v1; // fast opening speed
  const a1 = 1 - tailDist; // normalized distance reached at the seam
  return (t: number): number => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    if (t < ts) {
      const v = v0 + (v1 - v0) * (t / ts); // linear v0 → v1
      return (t * (v0 + v)) / 2;
    }
    const u = (t - ts) / tailTime; // 0..1 across the tail
    const v = v1 * (1 - u); // linear v1 → 0
    return a1 + ((t - ts) * (v1 + v)) / 2;
  };
}

/** Normalize an angle into [0, 2π). */
function norm(a: number): number {
  return ((a % TWO_PI) + TWO_PI) % TWO_PI;
}

// ── Presentation-only motion (never touches the fairness angle convention) ───
// Idle ambient drift: the wheel turns slowly while waiting so the stage feels
// alive. A new spin reads the current rotation and lands exactly on the chosen
// wedge regardless of where idle left it, so this can't desync the draw.
const IDLE_SPEED = TWO_PI / 40000; // rad/ms — one slow revolution per ~40s

// Pointer "peg" flap: each time a wedge edge passes under the pointer the flap
// is kicked, then a damped spring pulls it back to rest. Kick scales with the
// wheel's instantaneous speed, so ticks are punchy at full spin and fade out as
// it crawls to a stop — purely a pointer-draw deflection, not a rotation change.
const FLAP_K = 900; // spring stiffness (rad/s²)
const FLAP_C = 45; // damping
const FLAP_KICK = 1500; // speed(rad/ms) → velocity bump(rad/s)
const FLAP_VMAX = 9; // clamp per-tick velocity bump
const FLAP_MAX = 0.32; // ~18° max deflection

// Winner reveal pulse: an expanding, fading ring on the winning wedge. One cycle
// only — the winner modal opens ~700ms after the spin lands (the reveal beat), so
// further cycles would repaint the whole canvas behind an opaque overlay where
// they're never seen. Keep REVEAL_CYCLE_MS * REVEAL_CYCLES ≤ that beat.
const REVEAL_CYCLE_MS = 600;
const REVEAL_CYCLES = 1;

export interface SpinOptions {
  /** Called every frame with the spin progress in [0,1]. */
  onTick?: (progress: number) => void;
  /** Called once the spin settles. */
  onDone?: () => void;
}

export interface WheelHandle {
  setWheel(wheel: Wheel | null): void;
  render(): void;
  /** Animate from the current rotation to `targetRotation` over `durationMs`. */
  spinTo(targetRotation: number, durationMs: number, opts?: SpinOptions): void;
  /**
   * Spotlight one participant's wedge (full color + accent ring) and dim the rest.
   * Pass `null` to clear. Purely a render hint — never touches rotation or the
   * fairness result path. Used for the post-spin reveal beat.
   */
  setHighlight(participantId: string | null): void;
  /**
   * Start/stop the idle ambient drift (slow continuous rotation while waiting).
   * Presentation only — a subsequent `spinTo` lands on the chosen wedge from any
   * idle rotation, so this never affects the draw result. No-ops while spinning
   * or when the wheel is empty.
   */
  setIdle(on: boolean): void;
  getRotation(): number;
  isSpinning(): boolean;
  stop(): void;
}

/**
 * Canvas wheel renderer.
 *
 * Convention (must match draw.ts): wheel-space angle φ increases clockwise from
 * the top. Canvas `arc()` measures clockwise from 3 o'clock, so a wedge is drawn
 * at `φ − π/2`. The whole wheel is rotated by `+rotation`; the pointer is fixed at
 * the top. Thus the wedge under the pointer is the one at φ = −rotation — exactly
 * what `wedgeAtPointer` computes.
 */
export function createWheel(canvas: HTMLCanvasElement): WheelHandle {
  const ctx = canvas.getContext("2d")!;
  let wheel: Wheel | null = null;
  let rotation = 0;
  let rafId = 0;
  let spinning = false;
  let highlightId: string | null = null;

  // Ambient/reveal motion state (presentation only — see constants above).
  let idleRaf = 0;
  let idleOn = false;
  let idleLast = 0;
  let revealRaf = 0;
  let revealStart = 0;
  let revealPulse = 0; // 0..1 ring emphasis, 0 = static
  let flapAngle = 0; // pointer deflection (rad, ≥0)
  let flapVel = 0;

  function sizeToBox(): { cx: number; cy: number; radius: number } {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssSize = canvas.clientWidth || 480;
    const px = Math.round(cssSize * dpr);
    if (canvas.width !== px || canvas.height !== px) {
      canvas.width = px;
      canvas.height = px;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = cssSize / 2;
    const cy = cssSize / 2;
    const radius = cssSize / 2 - 10;
    return { cx, cy, radius };
  }

  function drawPointer(cx: number, cy: number, radius: number) {
    // Fixed pointer at the top (12 o'clock), aiming down into the wheel.
    // White outline keeps it visible even over a dark wedge. The flap pivots at
    // its mount (top center) and deflects by `flapAngle` as pegs pass — drawing
    // only, never the wheel rotation, so the fairness convention is untouched.
    const pivotY = cy - radius;
    const apex = 26; // mount → tip length
    ctx.save();
    ctx.translate(cx, pivotY);
    ctx.rotate(flapAngle);
    ctx.beginPath();
    ctx.moveTo(-17, 0);
    ctx.lineTo(17, 0);
    ctx.lineTo(0, apex);
    ctx.closePath();
    ctx.fillStyle = INK;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
    ctx.restore();
  }

  function drawHub(cx: number, cy: number) {
    ctx.beginPath();
    ctx.arc(cx, cy, 34, 0, TWO_PI);
    ctx.fillStyle = "#ffffff";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#e5e5e5";
    ctx.stroke();
  }

  function render() {
    const { cx, cy, radius } = sizeToBox();
    ctx.clearRect(0, 0, canvas.clientWidth || 480, canvas.clientHeight || 480);

    if (!wheel || wheel.wedges.length === 0) {
      ctx.fillStyle = "#faf5e8";
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = "#6a6a6a";
      ctx.font = '400 16px "Pretendard Variable", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("참가자를 추가하세요", cx, cy);
      drawHub(cx, cy);
      return;
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    const rLabel = radius * 0.94;

    // Color is keyed to the PARTICIPANT (input order → palette slot), so each person
    // has one recognizable wedge color. Consecutive wedges get strongly contrasting
    // hues (golden-angle palette); two people only share a color past 30 of them.
    const colorOf = new Map<string, number>();
    for (const w of wheel.wedges) {
      if (!colorOf.has(w.participant.id)) colorOf.set(w.participant.id, colorOf.size);
    }

    wheel.wedges.forEach((w) => {
      const ci = colorOf.get(w.participant.id)! % PALETTE.length;
      const a0 = w.start - HALF_PI;
      const a1 = w.end - HALF_PI;
      // Reveal beat: spotlight the winner's wedge, dim the rest. Decision is the
      // pure highlightState (covered in test/); here we only paint it.
      const { isWinner, dim } = highlightState(highlightId, w.participant.id);
      ctx.globalAlpha = dim ? 0.3 : 1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, a0, a1);
      ctx.closePath();
      ctx.fillStyle = PALETTE[ci]!;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.stroke();
      if (isWinner) {
        // Accent ring on the winning wedge — ink outline at full opacity.
        ctx.lineWidth = 4;
        ctx.strokeStyle = INK;
        ctx.stroke();
        // Reveal pulse: an expanding outline that fades out, drawing the eye to
        // the winner. `revealPulse` (0..1) is driven by the reveal RAF loop.
        if (revealPulse > 0) {
          ctx.save();
          ctx.globalAlpha = (1 - revealPulse) * 0.55;
          ctx.lineWidth = 3 + revealPulse * 12;
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.restore();
        }
      }

      // Label sized to the wedge's own arc (one wedge per person now), so wide
      // wedges get big, projector-readable names. Skip only when a wedge is too
      // thin for any legible text.
      const arc = w.end - w.start;
      if (arc < 0.05) {
        ctx.globalAlpha = 1;
        return;
      }
      const fontPx = Math.max(13, Math.min(radius * 0.13, radius * 0.16 * Math.min(1, arc / 0.5)));
      // Radial label: text runs along the wedge's mid-radius and rotates rigidly
      // with the wheel. No rotation-dependent flip → no mid-spin 180° snap (the
      // old `Math.cos(mid + rotation)` heuristic caused that).
      ctx.save();
      ctx.rotate(w.mid - HALF_PI);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = LABEL_INK[ci]!;
      ctx.font = `400 ${fontPx}px "Black Han Sans", "Pretendard Variable", system-ui, sans-serif`;
      ctx.fillText(truncate(w.participant.name, 12), rLabel, 0);
      ctx.restore();
      ctx.globalAlpha = 1;
    });

    ctx.restore();
    drawHub(cx, cy);
    drawPointer(cx, cy, radius);
  }

  function truncate(s: string, n: number): string {
    return s.length > n ? `${s.slice(0, n - 1)}…` : s;
  }

  /** Index of the wedge currently under the pointer (φ = −rotation), or −1. */
  function wedgeIndexAt(rot: number): number {
    if (!wheel) return -1;
    const phi = norm(-rot);
    const ws = wheel.wedges;
    for (let i = 0; i < ws.length; i++) {
      if (phi >= ws[i]!.start && phi < ws[i]!.end) return i;
    }
    return ws.length - 1; // wrap guard
  }

  /** Advance the flap spring one step (dt in ms); kick is an optional impulse. */
  function stepFlap(dtMs: number, kick = 0) {
    const s = dtMs / 1000;
    flapVel += Math.min(kick, FLAP_VMAX);
    flapVel += (-FLAP_K * flapAngle - FLAP_C * flapVel) * s;
    flapAngle += flapVel * s;
    if (flapAngle <= 0) {
      flapAngle = 0;
      if (flapVel < 0) flapVel = 0;
    } else if (flapAngle > FLAP_MAX) {
      flapAngle = FLAP_MAX;
      if (flapVel > 0) flapVel = 0;
    }
  }

  function stopIdle() {
    idleOn = false;
    cancelAnimationFrame(idleRaf);
    idleRaf = 0;
    idleLast = 0;
  }

  function idleFrame(now: number) {
    if (!idleOn) return;
    const dt = idleLast ? Math.min(now - idleLast, 64) : 16;
    idleLast = now;
    rotation = (rotation + IDLE_SPEED * dt) % TWO_PI;
    if (flapAngle !== 0 || flapVel !== 0) stepFlap(dt); // let residual flap settle
    render();
    idleRaf = requestAnimationFrame(idleFrame);
  }

  function setIdle(on: boolean) {
    const want = on && !!wheel && wheel.wedges.length > 0 && !spinning;
    if (want === idleOn) return;
    stopIdle();
    if (want) {
      idleOn = true;
      idleRaf = requestAnimationFrame(idleFrame);
    }
  }

  function stopReveal() {
    cancelAnimationFrame(revealRaf);
    revealRaf = 0;
    revealPulse = 0;
  }

  function revealFrame(now: number) {
    const elapsed = now - revealStart;
    if (elapsed >= REVEAL_CYCLE_MS * REVEAL_CYCLES) {
      revealPulse = 0; // settle to the static ring and stop redrawing
      render();
      revealRaf = 0;
      return;
    }
    revealPulse = (elapsed % REVEAL_CYCLE_MS) / REVEAL_CYCLE_MS; // expanding sawtooth
    render();
    revealRaf = requestAnimationFrame(revealFrame);
  }

  function spinTo(targetRotation: number, durationMs: number, opts: SpinOptions = {}) {
    cancelAnimationFrame(rafId);
    stopIdle(); // idle must not write `rotation` while the spin owns it
    stopReveal();
    highlightId = null; // a new spin clears any prior reveal spotlight
    const r0 = norm(rotation);
    rotation = r0;
    let target = targetRotation;
    while (target <= r0 + Math.PI) target += TWO_PI; // always a meaningful forward spin
    const delta = target - r0;
    const ease = makeSuspenseEase(durationMs);
    const startTs = performance.now();
    spinning = true;

    let prevNow = startTs;
    let prevRot = r0;
    let prevIdx = wedgeIndexAt(r0);

    const frame = (now: number) => {
      const t = Math.min(1, (now - startTs) / durationMs);
      rotation = r0 + delta * ease(t);
      // Pointer flap: kick on each peg (wedge-edge) crossing, scaled by the
      // wheel's instantaneous speed; the spring settles it between pegs. Cap dt
      // (as idleFrame does): the flap's explicit-Euler spring is only stable for
      // dt < ~66ms, so a tab-away/return frame gap must not blow it up.
      const dt = Math.min(64, Math.max(1, now - prevNow));
      const speed = Math.abs(rotation - prevRot) / dt; // rad/ms
      const idx = wedgeIndexAt(rotation);
      const kick = idx !== prevIdx ? speed * FLAP_KICK : 0;
      stepFlap(dt, kick);
      prevNow = now;
      prevRot = rotation;
      prevIdx = idx;
      render();
      opts.onTick?.(t);
      if (t < 1) {
        rafId = requestAnimationFrame(frame);
      } else {
        rotation = target;
        flapAngle = 0; // rest the flap so the static pointer reads clean
        flapVel = 0;
        render();
        spinning = false;
        opts.onDone?.();
      }
    };
    rafId = requestAnimationFrame(frame);
  }

  return {
    setWheel(w) {
      wheel = w;
      if (!w || w.wedges.length === 0) stopIdle(); // nothing to drift
      render();
    },
    render,
    spinTo,
    setHighlight(id) {
      highlightId = id;
      stopReveal();
      render();
      if (id !== null && !prefersReducedMotion()) {
        revealStart = performance.now();
        revealRaf = requestAnimationFrame(revealFrame);
      }
    },
    setIdle,
    getRotation: () => rotation,
    isSpinning: () => spinning,
    stop() {
      cancelAnimationFrame(rafId);
      stopIdle();
      stopReveal();
      spinning = false;
    },
  };
}
