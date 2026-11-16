/**
 * Pure timing logic for Science Cypher (no DOM, no Web Audio).
 * All times are in seconds of "song time": 0 is the first count-in beat.
 *
 * A verse is a run of slots. Each slot plays one lyric line over two bars
 * (8 beats). The blank is the last word of the line and lands on the
 * star beat (beat 7 of the slot). A right word on the star beat moves the
 * verse to the next line; anything else replays the same line in the next
 * slot, so the music never stops.
 */

export const BEATS_PER_BAR = 4;
export const BEATS_PER_SLOT = 8;
export const STAR_BEAT = 6;          // 0-based beat inside a slot: the 7th beat
export const COUNT_IN = 4;           // one bar of count-in before the first line
export const HIT_WINDOW = 0.25;      // seconds either side of the beat (spec: 250 ms)
export const TOO_SOON_BEATS = 1.5;   // taps earlier than this are ignored, not judged
export const MAX_FLASH_HZ = 3;       // safety ceiling for any pulse

/** Seconds per beat. */
export const spb = (bpm) => 60 / bpm;

/** Song time of beat n (n may be negative or fractional). */
export const beatTime = (n, bpm) => n * spb(bpm);

/** Timing of slot k. */
export function slotTimes(k, bpm) {
  const s = spb(bpm);
  const start = (COUNT_IN + k * BEATS_PER_SLOT) * s;
  return { start, star: start + STAR_BEAT * s, end: start + BEATS_PER_SLOT * s };
}

/** Which slot a song time falls in (-1 during the count-in). */
export function slotAt(t, bpm) {
  const b = t / spb(bpm) - COUNT_IN;
  return b < 0 ? -1 : Math.floor(b / BEATS_PER_SLOT);
}

/**
 * Judge the timing of a tap against a star beat.
 * `offset` is the player's calibrated delay: a tap at tapTime counts as if
 * it happened at tapTime - offset.
 * @returns {{kind:'hit'|'early'|'late'|'tooSoon', delta:number}} delta in seconds, after the offset
 */
export function judgeTap(tapTime, starTime, bpm, offset = 0, window = HIT_WINDOW) {
  const delta = tapTime - offset - starTime;
  if (delta < -TOO_SOON_BEATS * spb(bpm)) return { kind: 'tooSoon', delta };
  if (Math.abs(delta) <= window) return { kind: 'hit', delta };
  return { kind: delta < 0 ? 'early' : 'late', delta };
}

/**
 * Outcome of one slot from its first judged tap (or none).
 * @param {null|{kind:string}} timing
 * @param {boolean} rightWord
 * @returns {'right'|'wrong'|'early'|'late'|'none'}
 */
export function slotOutcome(timing, rightWord) {
  if (!timing) return 'none';
  if (!rightWord) return 'wrong';
  if (timing.kind === 'hit') return 'right';
  return timing.kind === 'early' ? 'early' : 'late';
}

/**
 * Verse state: which line is up, how many replays so far.
 * @param {number} lineCount
 */
export function createVerse(lineCount) {
  return { lineCount, line: 0, replays: 0, slots: 0, done: false, perLine: Array(lineCount).fill(0) };
}

/** Advance the verse after a slot ends. */
export function resolveSlot(verse, outcome) {
  if (verse.done) return verse;
  verse.slots += 1;
  if (outcome === 'right') {
    verse.line += 1;
    if (verse.line >= verse.lineCount) verse.done = true;
  } else {
    verse.replays += 1;
    verse.perLine[verse.line] += 1;
  }
  return verse;
}

/**
 * Stars: 1 for finishing the verse, 2 for staying within the replay limit,
 * 3 for every word right and on the beat the first time.
 */
export function starsFor(verse, replayLimit) {
  const finished = verse.done;
  const withinLimit = finished && verse.replays <= replayLimit;
  const perfect = withinLimit && verse.replays === 0;
  return { stars: perfect ? 3 : withinLimit ? 2 : finished ? 1 : 0, finished, withinLimit, perfect, replays: verse.replays };
}

/**
 * Calibration. The player taps along with beats at known times. Each tap is
 * matched to its nearest beat; taps further than `maxGap` from any beat are
 * dropped. The offset is the median delay, so one stray tap cannot skew it.
 * @param {number[]} taps   tap times
 * @param {number[]} beats  beat times the player was asked to tap
 * @returns {{ok:boolean, offset:number, used:number, spread:number}}
 */
export function calibrate(taps, beats, { maxGap = 0.45, need = 3, clamp = 0.35 } = {}) {
  const deltas = [];
  const usedBeats = new Set();
  for (const t of taps) {
    let best = -1, bd = Infinity;
    beats.forEach((b, i) => { const d = Math.abs(t - b); if (d < bd) { bd = d; best = i; } });
    if (best < 0 || bd > maxGap || usedBeats.has(best)) continue;
    usedBeats.add(best);
    deltas.push(t - beats[best]);
  }
  if (deltas.length < need) return { ok: false, offset: 0, used: deltas.length, spread: 0 };
  const sorted = deltas.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const spread = sorted[sorted.length - 1] - sorted[0];
  return { ok: true, offset: Math.max(-clamp, Math.min(clamp, median)), used: deltas.length, spread };
}

/** Pulses per second at a tempo, one soft pulse per beat. */
export const pulseHz = (bpm) => bpm / 60;

/** True if a one-pulse-per-beat effect stays under the flash ceiling. */
export const pulseSafe = (bpm) => pulseHz(bpm) < MAX_FLASH_HZ;

/**
 * Soft pulse level for a beat phase in [0,1): fast rise, gentle fall, never
 * a hard on/off. Returns 0..1.
 */
export function pulseLevel(phase) {
  const p = phase - Math.floor(phase);
  return p < 0.08 ? p / 0.08 : Math.exp(-(p - 0.08) * 5);
}

/**
 * Song events to schedule between two song times (lookahead window).
 * Returns beat numbers whose time t satisfies from <= t < to.
 */
export function beatsBetween(from, to, bpm) {
  const s = spb(bpm);
  const out = [];
  for (let n = Math.max(0, Math.ceil(from / s - 1e-9)); n * s < to; n++) out.push(n);
  return out;
}

/** Minutes and seconds a verse takes with no replays (for the design target of 60 to 90 s). */
export function verseSeconds(lineCount, bpm) {
  return slotTimes(lineCount - 1, bpm).end;
}
