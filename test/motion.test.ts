import { describe, expect, it } from "vitest";
import { createMotionPreference } from "../src/motion.js";

/** Minimal MediaQueryList stub — the only external IO this module touches. */
function fakeMq(matches: boolean) {
  const listeners = new Set<() => void>();
  const seen: string[] = [];
  const mq = {
    matches,
    addEventListener(type: string, cb: () => void) {
      seen.push(`add:${type}`);
      listeners.add(cb);
    },
    removeEventListener(type: string, cb: () => void) {
      seen.push(`remove:${type}`);
      listeners.delete(cb);
    },
  };
  return {
    matcher: (query: string) => {
      seen.push(`match:${query}`);
      return mq as unknown as MediaQueryList;
    },
    seen,
    flip(next: boolean) {
      mq.matches = next;
      for (const cb of [...listeners]) cb();
    },
    listenerCount: () => listeners.size,
  };
}

describe("createMotionPreference", () => {
  it("reports the media query state", () => {
    expect(createMotionPreference(fakeMq(true).matcher).reduced()).toBe(true);
    expect(createMotionPreference(fakeMq(false).matcher).reduced()).toBe(false);
  });

  it("queries prefers-reduced-motion: reduce", () => {
    const f = fakeMq(false);
    createMotionPreference(f.matcher);
    expect(f.seen).toContain("match:(prefers-reduced-motion: reduce)");
  });

  it("keeps motion enabled when no matcher exists", () => {
    // `globalThis.matchMedia` is absent under the node test environment.
    const pref = createMotionPreference();
    expect(pref.reduced()).toBe(false);
    const off = pref.subscribe(() => {
      throw new Error("must not fire");
    });
    expect(() => off()).not.toThrow();
  });

  it("notifies subscribers when the preference flips", () => {
    const f = fakeMq(false);
    const pref = createMotionPreference(f.matcher);
    let calls = 0;
    pref.subscribe(() => calls++);
    f.flip(true);
    expect(calls).toBe(1);
    expect(pref.reduced()).toBe(true);
  });

  it("stops notifying after unsubscribe", () => {
    const f = fakeMq(false);
    const pref = createMotionPreference(f.matcher);
    let calls = 0;
    const off = pref.subscribe(() => calls++);
    off();
    f.flip(true);
    expect(calls).toBe(0);
    expect(f.listenerCount()).toBe(0);
    expect(f.seen).toContain("remove:change");
  });
});
