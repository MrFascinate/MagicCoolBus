/** Small environment helpers shared by the shell and stations. */

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/** True when the player asked the system for less motion. */
export function reducedMotion() {
  return !!(mq && mq.matches);
}

/** Debug hooks only with ?debug in the URL. */
export const DEBUG = typeof location !== 'undefined' && /[?&]debug\b/.test(location.search);
