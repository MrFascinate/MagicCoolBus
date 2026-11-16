import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { LEVELS, SPECIMENS, ZOOM_STEPS, STAMP_SKILL } from '../src/stations/microscope/levels.js';
import { createRound, guess, zoomOut, openChoices, namedClosest, starsFor, scaleBar, formatLength, indexManifest } from '../src/stations/microscope/logic.js';

const MAN_PATH = 'public/assets/microscope/manifest.json';
const manifest = JSON.parse(readFileSync(MAN_PATH, 'utf8'));

describe('microscope content', () => {
  it('has three levels of three specimens, nine specimens in all', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3]);
    const ids = LEVELS.flatMap((l) => l.specimens);
    expect(ids).toHaveLength(9);
    expect(new Set(ids).size).toBe(9);
    for (const id of ids) expect(SPECIMENS[id]).toBeTruthy();
  });

  it('gives every specimen four different answers, the right one included, a hint per wrong guess and a fact with a source', () => {
    for (const s of Object.values(SPECIMENS)) {
      expect(s.choices).toHaveLength(4);
      expect(new Set(s.choices).size).toBe(4);
      expect(s.choices).toContain(s.name);
      expect(s.hints).toHaveLength(3);
      expect(s.fact.length).toBeGreaterThan(20);
      expect(s.src.length).toBeGreaterThan(0);
    }
  });

  it('keeps the right answer out of the first slot in at least most specimens', () => {
    const first = Object.values(SPECIMENS).filter((s) => s.choices[0] === s.name).length;
    expect(first).toBeLessThanOrEqual(1);
  });

  it('uses the two-star limits from the spec and names the skill on the stamp', () => {
    expect(LEVELS.map((l) => l.wrongLimit)).toEqual([4, 3, 3]);
    expect(STAMP_SKILL).toBe('Spotted clues at tiny scales');
  });

  it('copy has no em dashes and no "not just" constructions', () => {
    const text = readFileSync('src/stations/microscope/levels.js', 'utf8') + readFileSync('src/stations/microscope/index.js', 'utf8');
    expect(text).not.toMatch(/—/);
    expect(text.toLowerCase()).not.toMatch(/not just|not only/);
  });

  it('every source id used is listed in SOURCES.md', () => {
    const md = readFileSync('src/stations/microscope/SOURCES.md', 'utf8');
    for (const s of Object.values(SPECIMENS)) for (const id of s.src) expect(md, id).toContain(`\`${id}\``);
  });
});

describe('guessing', () => {
  const salt = SPECIMENS.salt;
  const wrongs = salt.choices.filter((c) => c !== salt.name);

  it('a right first guess solves at the closest zoom', () => {
    const r = createRound(salt);
    expect(guess(r, salt.name)).toMatchObject({ result: 'right', step: 0 });
    expect(namedClosest(r)).toBe(true);
  });

  it('a wrong guess crosses the answer out, zooms out one step and gives the next hint', () => {
    const r = createRound(salt);
    expect(guess(r, wrongs[0])).toMatchObject({ result: 'wrong', step: 1, hintIndex: 0 });
    expect(openChoices(r)).not.toContain(wrongs[0]);
    expect(guess(r, wrongs[0]).result).toBe('ignored'); // crossed answers cannot be picked again
    expect(r.wrong).toBe(1);
  });

  it('three wrong guesses reach the widest step and leave exactly the right answer', () => {
    const r = createRound(salt);
    for (const w of wrongs) guess(r, w);
    expect(r.step).toBe(ZOOM_STEPS - 1);
    expect(openChoices(r)).toEqual([salt.name]);
    expect(guess(r, salt.name).result).toBe('right');
    expect(namedClosest(r)).toBe(false);
  });

  it('zooming out on purpose costs the closest-zoom star but not a wrong guess', () => {
    const r = createRound(salt);
    expect(zoomOut(r)).toBe(true);
    expect(r.wrong).toBe(0);
    guess(r, salt.name);
    expect(namedClosest(r)).toBe(false);
  });

  it('cannot zoom out past the widest step or after solving', () => {
    const r = createRound(salt);
    expect([zoomOut(r), zoomOut(r), zoomOut(r), zoomOut(r)]).toEqual([true, true, true, false]);
    const r2 = createRound(salt);
    guess(r2, salt.name);
    expect(zoomOut(r2)).toBe(false);
  });

  it('ignores answers that are not on the list', () => {
    const r = createRound(salt);
    expect(guess(r, 'A banana').result).toBe('ignored');
  });
});

describe('stars', () => {
  const L1 = LEVELS[0];
  const play = (plan) => L1.specimens.map((id, i) => {
    const s = SPECIMENS[id];
    const r = createRound(s);
    const wrongs = s.choices.filter((c) => c !== s.name);
    for (let k = 0; k < plan[i]; k++) guess(r, wrongs[k]);
    guess(r, s.name);
    return r;
  });

  it('three stars for naming all three at the closest zoom', () => {
    expect(starsFor(play([0, 0, 0]), L1)).toMatchObject({ stars: 3, wrong: 0 });
  });

  it('two stars when within the wrong-guess limit', () => {
    expect(starsFor(play([1, 2, 1]), L1)).toMatchObject({ stars: 2, wrong: 4 });
  });

  it('one star when finished over the limit', () => {
    expect(starsFor(play([3, 2, 0]), L1)).toMatchObject({ stars: 1, wrong: 5 });
  });

  it('no stars for an unfinished level', () => {
    const rounds = L1.specimens.map((id) => createRound(SPECIMENS[id]));
    expect(starsFor(rounds, L1).stars).toBe(0);
  });

  it('a level limit of 3 gives two stars at 3 wrong and one star at 4', () => {
    const L2 = LEVELS[1];
    const mk = (n) => L2.specimens.map((id, i) => {
      const s = SPECIMENS[id]; const r = createRound(s);
      const w = s.choices.filter((c) => c !== s.name);
      for (let k = 0; k < (i === 0 ? n : 0); k++) guess(r, w[k]);
      guess(r, s.name); return r;
    });
    expect(starsFor(mk(3), L2).stars).toBe(2);
    const four = mk(3); const s = SPECIMENS[L2.specimens[1]]; const r = createRound(s);
    guess(r, s.choices.find((c) => c !== s.name)); guess(r, s.name); four[1] = r;
    expect(starsFor(four, L2).stars).toBe(1);
  });
});

describe('scale bar', () => {
  it('picks a 1-2-5 length near a fifth of the view', () => {
    expect(scaleBar(40)).toMatchObject({ um: 10, label: '10 µm' });
    expect(scaleBar(150)).toMatchObject({ um: 20 });   // 33 wanted, 20 is nearer than 50
    expect(scaleBar(2400)).toMatchObject({ um: 500, label: '500 µm' });
    expect(scaleBar(12000)).toMatchObject({ um: 2000, label: '2 mm' });
    expect(scaleBar(8).label).toBe('2 µm');
  });

  it('keeps the bar between 10 and 40 percent of the width for every image', () => {
    for (const im of manifest.images) {
      const b = scaleBar(im.widthUm);
      expect(b.fraction).toBeGreaterThan(0.1);
      expect(b.fraction).toBeLessThan(0.4);
    }
  });

  it('spells units out for screen readers', () => {
    expect(formatLength(1, true)).toBe('1 micrometer');
    expect(formatLength(1000, true)).toBe('1 millimeter');
    expect(formatLength(2500, true)).toBe('2.5 millimeters');
  });
});

describe('image manifest', () => {
  it('lists four zoom steps for each of the nine specimens, widening each step', () => {
    const idx = indexManifest(manifest);
    expect([...idx.keys()].sort()).toEqual(Object.keys(SPECIMENS).sort());
    for (const steps of idx.values()) expect(steps).toHaveLength(ZOOM_STEPS);
  });

  it('marks every image simulated and names a description source', () => {
    for (const im of manifest.images) {
      expect(im.simulated).toBe(true);
      expect(im.descriptionSources.length).toBeGreaterThan(0);
      for (const u of im.descriptionSources) expect(u).toMatch(/^https:\/\//);
    }
  });

  it('every file exists and is under the size limit', () => {
    const limit = manifest.maxKB * 1024;
    expect(manifest.maxKB).toBeLessThanOrEqual(40);
    for (const im of manifest.images) {
      const p = `public/assets/microscope/${im.file}`;
      expect(existsSync(p), p).toBe(true);
      expect(statSync(p).size, p).toBeLessThanOrEqual(limit);
      // WebP signature
      const head = readFileSync(p).subarray(0, 12).toString('latin1');
      expect(head.startsWith('RIFF') && head.endsWith('WEBP'), p).toBe(true);
    }
  });

  it('rejects a manifest with a missing step', () => {
    expect(() => indexManifest({ images: [{ specimen: 'x', step: 1, file: 'a', widthUm: 1, simulated: true }] })).toThrow();
  });
});
