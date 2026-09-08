// OS-level "reduce motion" preference, read from JS.
//
// `style.css` strips decorative CSS animation under the same query, but canvas- and
// JS-driven motion (confetti, idle drift) is invisible to the stylesheet — main.ts
// gates it on this module instead. Query string lives here only, so the CSS block
// and the JS gate can never drift apart silently.

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

type Matcher = (query: string) => MediaQueryList;

export interface MotionPreference {
  /** True when the viewer asked their OS to reduce motion. */
  reduced(): boolean;
  /** Run `cb` whenever the preference flips. Returns an unsubscribe. */
  subscribe(cb: () => void): () => void;
}

/**
 * Read the reduced-motion preference. `matcher` is injectable for tests; the default
 * is `window.matchMedia`. Where no matcher exists (non-DOM host), the preference reads
 * false and `subscribe` is a no-op — motion stays enabled rather than silently off.
 */
export function createMotionPreference(matcher?: Matcher): MotionPreference {
  const match = matcher ?? globalThis.matchMedia?.bind(globalThis);
  const mq = match ? match(REDUCE_QUERY) : null;
  if (!mq) {
    return { reduced: () => false, subscribe: () => () => {} };
  }
  return {
    reduced: () => mq.matches,
    subscribe(cb) {
      const listener = () => cb();
      mq.addEventListener("change", listener);
      return () => mq.removeEventListener("change", listener);
    },
  };
}
