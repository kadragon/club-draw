/** Honor the OS "reduce motion" setting — compress visuals only, never the result. */
export const prefersReducedMotion = (): boolean =>
  window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
