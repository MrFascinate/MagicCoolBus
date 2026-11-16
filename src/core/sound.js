/**
 * Tiny synthesized sounds (no audio files, no network). Every sound has a
 * visible partner in the UI, so the game works with sound off.
 */

/** @typedef {'click'|'step'|'turn'|'up'|'down'|'win'|'miss'|'stamp'} SoundName */

const NOTES = {
  click: [[660, 0.05]],
  step: [[520, 0.06]],
  turn: [[440, 0.05], [560, 0.05]],
  up: [[392, 0.07], [523, 0.09]],
  down: [[523, 0.07], [392, 0.09]],
  win: [[523, 0.1], [659, 0.1], [784, 0.18]],
  miss: [[330, 0.12], [262, 0.18]],
  stamp: [[523, 0.08], [659, 0.08], [784, 0.08], [1047, 0.2]],
};

export function createSound(initialOn = true) {
  let on = initialOn;
  /** @type {AudioContext|null} */
  let ctx = null;
  const ensure = () => {
    if (!on) return null;
    try {
      if (!ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    } catch {
      return null;
    }
  };
  return {
    get on() { return on; },
    /** The shared AudioContext when sound is on, for modules that make their own sounds; null when off. */
    audio() { return ensure(); },
    set on(v) { on = !!v; if (on) ensure(); },
    /** @param {SoundName} name */
    play(name) {
      const ac = ensure();
      if (!ac) return;
      let t = ac.currentTime + 0.01;
      for (const [freq, dur] of NOTES[name] || []) {
        const o = ac.createOscillator();
        const g = ac.createGain();
        o.type = 'triangle';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + dur + 0.02);
        t += dur * 0.9;
      }
    },
  };
}
