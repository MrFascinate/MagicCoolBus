import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  spb, beatTime, slotTimes, slotAt, judgeTap, slotOutcome, createVerse, resolveSlot, starsFor,
  calibrate, pulseHz, pulseSafe, pulseLevel, beatsBetween, verseSeconds,
  COUNT_IN, BEATS_PER_SLOT, STAR_BEAT, HIT_WINDOW, MAX_FLASH_HZ,
} from '../src/stations/cypher/beat.js';

const LYRICS = JSON.parse(readFileSync('src/stations/cypher/lyrics.json', 'utf8'));

describe('beat scheduling', () => {
  it('converts tempo to seconds per beat', () => {
    expect(spb(60)).toBe(1);
    expect(spb(90)).toBeCloseTo(0.6667, 4);
    expect(beatTime(3, 120)).toBeCloseTo(1.5);
  });

  it('puts slot 0 after a one-bar count-in, with the star on beat 7 of 8', () => {
    const s = slotTimes(0, 60);
    expect(s.start).toBe(COUNT_IN);
    expect(s.star).toBe(COUNT_IN + STAR_BEAT);
    expect(s.end).toBe(COUNT_IN + BEATS_PER_SLOT);
    expect(slotTimes(2, 60).start).toBe(COUNT_IN + 2 * BEATS_PER_SLOT);
  });

  it('finds the slot for a song time', () => {
    expect(slotAt(0, 60)).toBe(-1);
    expect(slotAt(COUNT_IN - 0.01, 60)).toBe(-1);
    expect(slotAt(COUNT_IN, 60)).toBe(0);
    expect(slotAt(COUNT_IN + 8.5, 60)).toBe(1);
  });

  it('lists each beat exactly once across back-to-back lookahead windows', () => {
    const bpm = 88;
    const seen = [];
    let t = 0;
    for (let i = 0; i < 200; i++) { const next = t + 0.033 + (i % 7) * 0.01; seen.push(...beatsBetween(t, next, bpm)); t = next; }
    const want = [];
    for (let n = 0; beatTime(n, bpm) < t; n++) want.push(n);
    expect(seen).toEqual(want);
  });

  it('keeps every verse within the play-time design target when played straight through', () => {
    for (const l of LYRICS.levels) {
      const sec = verseSeconds(l.lines.length, l.bpm);
      expect(sec).toBeGreaterThan(40);
      expect(sec).toBeLessThan(90);
    }
  });
});

describe('hit judging', () => {
  const bpm = 90, star = 10;
  it('counts taps within 250 ms either side as on the beat', () => {
    expect(HIT_WINDOW).toBe(0.25);
    expect(judgeTap(star, star, bpm).kind).toBe('hit');
    expect(judgeTap(star + 0.25, star, bpm).kind).toBe('hit');
    expect(judgeTap(star - 0.25, star, bpm).kind).toBe('hit');
    expect(judgeTap(star + 0.251, star, bpm).kind).toBe('late');
    expect(judgeTap(star - 0.3, star, bpm).kind).toBe('early');
  });

  it('ignores taps far too early instead of judging them', () => {
    expect(judgeTap(star - 1.5 * spb(bpm) - 0.01, star, bpm).kind).toBe('tooSoon');
    expect(judgeTap(star - 1.5 * spb(bpm) + 0.01, star, bpm).kind).toBe('early');
  });

  it('applies the calibrated offset: a player who taps 120 ms late is on the beat', () => {
    expect(judgeTap(star + 0.32, star, bpm).kind).toBe('late');
    expect(judgeTap(star + 0.32, star, bpm, 0.12).kind).toBe('hit');
    expect(judgeTap(star + 0.32, star, bpm, 0.12).delta).toBeCloseTo(0.2);
  });

  it('turns timing plus word into one outcome', () => {
    expect(slotOutcome(null, true)).toBe('none');
    expect(slotOutcome({ kind: 'hit' }, false)).toBe('wrong');
    expect(slotOutcome({ kind: 'hit' }, true)).toBe('right');
    expect(slotOutcome({ kind: 'early' }, true)).toBe('early');
    expect(slotOutcome({ kind: 'late' }, true)).toBe('late');
  });
});

describe('verse and stars', () => {
  it('advances only on a right word on the beat and counts every other slot as a replay', () => {
    const v = createVerse(3);
    resolveSlot(v, 'right');
    resolveSlot(v, 'late');
    resolveSlot(v, 'none');
    resolveSlot(v, 'wrong');
    expect(v).toMatchObject({ line: 1, replays: 3, done: false });
    resolveSlot(v, 'right'); resolveSlot(v, 'right');
    expect(v.done).toBe(true);
    expect(v.perLine).toEqual([0, 3, 0]);
  });

  it('three stars for a perfect verse, two within the replay limit, one over it', () => {
    const play = (misses) => { const v = createVerse(8); for (let i = 0; i < misses; i++) resolveSlot(v, 'wrong'); for (let i = 0; i < 8; i++) resolveSlot(v, 'right'); return v; };
    expect(starsFor(play(0), 3).stars).toBe(3);
    expect(starsFor(play(3), 3).stars).toBe(2);
    expect(starsFor(play(4), 3).stars).toBe(1);
    expect(starsFor(play(2), 2).stars).toBe(2);
    expect(starsFor(createVerse(8), 3).stars).toBe(0);
  });
});

describe('calibration', () => {
  const beats = [4, 5, 6, 7].map((n) => beatTime(n, 90));

  it('measures a steady delay as the median', () => {
    const r = calibrate(beats.map((b) => b + 0.11), beats);
    expect(r.ok).toBe(true);
    expect(r.offset).toBeCloseTo(0.11, 5);
  });

  it('is not thrown off by one stray tap', () => {
    const taps = [beats[0] + 0.1, beats[1] + 0.12, beats[2] + 0.09, beats[3] + 0.4];
    expect(calibrate(taps, beats).offset).toBeCloseTo(0.11, 2);
  });

  it('handles early tappers too', () => {
    expect(calibrate(beats.map((b) => b - 0.06), beats).offset).toBeCloseTo(-0.06, 5);
  });

  it('needs at least three matched taps and ignores double taps on one beat', () => {
    expect(calibrate([beats[0], beats[0] + 0.01, beats[1]], beats).ok).toBe(false);
    expect(calibrate([beats[0] + 2, beats[1] + 2], beats).ok).toBe(false);
  });

  it('caps the offset so a confused run cannot wreck judging', () => {
    // at 90 BPM a beat is 667 ms, so delays past half a beat read as early taps for the next beat
    expect(calibrate(beats.map((b) => b + 0.3), beats, { clamp: 0.2 }).offset).toBe(0.2);
    expect(calibrate(beats.map((b) => b + 0.3), beats).offset).toBeCloseTo(0.3, 5);
  });
});

describe('flash safety', () => {
  it('every level tempo pulses well under three times a second', () => {
    for (const l of LYRICS.levels) {
      expect(pulseSafe(l.bpm)).toBe(true);
      expect(pulseHz(l.bpm)).toBeLessThan(MAX_FLASH_HZ / 1.5);
    }
  });

  it('the pulse ramps instead of switching hard on and off', () => {
    let maxJump = 0, prev = pulseLevel(0);
    for (let i = 1; i <= 600; i++) { const v = pulseLevel(i / 600); maxJump = Math.max(maxJump, Math.abs(v - prev)); prev = v; }
    expect(maxJump).toBeLessThan(0.05);
    expect(pulseLevel(0.08)).toBeCloseTo(1, 5);
    expect(pulseLevel(0.9)).toBeLessThan(0.05);
  });
});

describe('lyrics', () => {
  it('are marked as placeholder with three levels of eight lines', () => {
    expect(LYRICS.placeholder).toBe(true);
    expect(LYRICS.levels.map((l) => l.lines.length)).toEqual([8, 8, 8]);
    expect(LYRICS.levels.map((l) => l.replayLimit)).toEqual([3, 3, 2]);
  });

  it('each line has three different choices with the answer among them, a meaning and a source', () => {
    const md = readFileSync('src/stations/cypher/SOURCES.md', 'utf8');
    for (const l of LYRICS.levels) for (const line of l.lines) {
      expect(line.choices).toHaveLength(3);
      expect(new Set(line.choices).size).toBe(3);
      expect(line.choices).toContain(line.answer);
      expect(line.meaning.length).toBeGreaterThan(20);
      for (const id of line.src) expect(md, id).toContain(`\`${id}\``);
      expect(line.before.endsWith(' ')).toBe(false);
    }
  });

  it('does not always put the answer in the same slot', () => {
    for (const l of LYRICS.levels) {
      const pos = new Set(l.lines.map((x) => x.choices.indexOf(x.answer)));
      expect(pos.size).toBeGreaterThan(1);
    }
  });

  it('copy has no em dashes and no "not just" constructions', () => {
    const text = readFileSync('src/stations/cypher/lyrics.json', 'utf8') + readFileSync('src/stations/cypher/index.js', 'utf8');
    expect(text).not.toMatch(/—/);
    expect(text.toLowerCase()).not.toMatch(/not just|not only/);
  });
});

describe('cypher facts', () => {
  it('credits Ruska and Max Knoll together for the first electron microscope (1931)', () => {
    const line = LYRICS.levels[0].lines.find((l) => /Ruska/.test(l.before));
    expect(line.before).toMatch(/Knoll/);
    expect(line.answer).toBe('one');
    expect(line.meaning).toMatch(/Max Knoll/);
    expect(line.meaning).toMatch(/1931/);
    const all = JSON.stringify(LYRICS);
    expect(all).not.toMatch(/Ruska built the first/);
  });
});
