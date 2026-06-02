// WebAudio sound effects: spin tick + winner fanfare. No assets, fully synthesized.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

function blip(
  freq: number,
  start: number,
  dur: number,
  gain: number,
  type: OscillatorType = "triangle",
) {
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Short tick, played as the wheel passes a wedge. */
export function playTick(): void {
  const ac = audio();
  if (!ac) return;
  blip(660 + Math.random() * 80, ac.currentTime, 0.04, 0.05, "square");
}

/** Ascending fanfare on a win. */
export function playFanfare(): void {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  const notes = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  notes.forEach((f, i) => {
    blip(f, t + i * 0.12, 0.35, 0.12, "triangle");
  });
  blip(1318.5, t + 0.48, 0.5, 0.1, "sawtooth"); // sparkle
}

/** Resume the audio context after a user gesture (browsers require this). */
export function unlockAudio(): void {
  audio();
}
