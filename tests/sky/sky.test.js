import { describe, it, expect } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import { parseSky, vec, sepDeg, sepAltAz, moonDisk, moonLit, moonSunDir, basis, project, scaleFor, dragView, arrowView, viewVec, centerTol, ZOOMS, CON_NAMES } from '../../src/stations/sky/sky.js';
import { LEVELS, makeObjects, STAMP_SKILL, MOON_FEATURES } from '../../src/stations/sky/levels.js';
import { newState, look, settle, confirm, starsFor, fewestLooks, arrowLooks, identify } from '../../src/stations/sky/rules.js';

const file = new URL('../../public/assets/sky/sky.json', import.meta.url);
const json = JSON.parse(readFileSync(file, 'utf8'));
const sky = parseSky(json);
const obj = makeObjects(sky);
const D = Math.PI / 180;

/** Low-precision check, independent of the build script: J2000 RA/Dec -> alt/az with GMST. */
function altAz(raH, decD, utc, lat, lon) {
  const jd = Date.parse(utc) / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const gmst = (280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * T * T) % 360;
  // precess RA/Dec roughly from J2000 to date (general precession 50.3"/yr along the ecliptic)
  const years = (jd - 2451545) / 365.25;
  const ra = raH * 15 + (3.075 + 1.336 * Math.sin(raH * 15 * D) * Math.tan(decD * D)) * years / 240 * 15 / 15;
  const dec = decD + (20.04 * Math.cos(raH * 15 * D)) * years / 3600;
  const ha = (gmst + lon - ra) * D;
  const sa = Math.sin(dec * D) * Math.sin(lat * D) + Math.cos(dec * D) * Math.cos(lat * D) * Math.cos(ha);
  const alt = Math.asin(sa);
  const az = Math.atan2(-Math.cos(dec * D) * Math.sin(ha), Math.sin(dec * D) * Math.cos(lat * D) - Math.cos(dec * D) * Math.sin(lat * D) * Math.cos(ha));
  return { alt: alt / D, az: ((az / D) + 360) % 360 };
}

describe('Sky Seeker data', () => {
  it('is small, and fixed to one date, time and place', () => {
    expect(statSync(file).size).toBeLessThan(60000);
    expect(json.meta.utc).toBe('2026-10-21T02:00:00Z');
    expect(json.meta.place.lat).toBeCloseTo(36.15, 2);
  });

  it('puts named stars where an independent formula puts them (HYG J2000 positions)', () => {
    // J2000 positions from the HYG database v3.8
    const check = { Alpheratz: [0.139791, 29.090432], Mirach: [1.162194, 35.620558], Algenib: [0.220598, 15.183596], Schedar: [0.675116, 56.537331], Vega: [18.615649, 38.783692], Polaris: [2.52975, 89.264109] };
    for (const [name, [ra, dec]] of Object.entries(check)) {
      const i = sky.nameIndex.get(name);
      const mine = altAz(ra, dec, json.meta.utc, json.meta.place.lat, json.meta.place.lon);
      const d = sepAltAz({ alt: sky.alt[i], az: sky.az[i] }, mine);
      expect(d, name).toBeLessThan(0.5); // refraction and the rough precession above
    }
  });

  it('Polaris sits at the observer latitude, due north', () => {
    const i = sky.nameIndex.get('Polaris');
    expect(Math.abs(sky.alt[i] - 36.15)).toBeLessThan(1); // Polaris is 0.7 degrees from the pole
    expect(Math.min(sky.az[i], 360 - sky.az[i])).toBeLessThan(1.5);
  });

  it('has the constellation figures the clues use', () => {
    const abbrs = json.cons.map((c) => c.abbr);
    for (const a of ['Peg', 'And', 'Cas', 'Psc', 'Cet']) expect(abbrs).toContain(a);
    for (const a of abbrs) expect(CON_NAMES[a], a).toBeTruthy();
    // Andromeda figure joins Alpheratz to Mirach through one star, and Mirach to Mu Andromedae
    const and = json.cons.find((c) => c.abbr === 'And').segs;
    const pairs = new Set();
    for (let k = 0; k < and.length; k += 2) { pairs.add(`${and[k]}-${and[k + 1]}`); pairs.add(`${and[k + 1]}-${and[k]}`); }
    const m = sky.nameIndex.get('Mirach'), mu = sky.nameIndex.get('Mu Andromedae');
    expect(pairs.has(`${m}-${mu}`)).toBe(true);
  });

  it('Moon, Saturn and the Andromeda Galaxy are all above the horizon', () => {
    for (const o of [sky.moon, sky.saturn, sky.m31]) expect(o.alt).toBeGreaterThan(30);
    expect(sky.moon.lit).toBeGreaterThan(0.6);   // waxing gibbous, about 73 percent lit
    expect(sky.moon.lit).toBeLessThan(0.8);
    expect(sky.saturn.constellation).toBe('Cetus');
    expect(sky.saturn.mag).toBeLessThan(1);
    expect(sky.moon.diam).toBeGreaterThan(0.48);
    expect(sky.moon.diam).toBeLessThan(0.56);
  });
});

describe('Sky Seeker facts the clues rely on', () => {
  it('Alpheratz is the left corner of the Great Square and Algenib the bottom corner, as seen tonight', () => {
    const pts = ['Alpheratz', 'Algenib', 'Markab', 'Scheat'].map((n) => ({ n, alt: sky.alt[sky.nameIndex.get(n)], az: sky.az[sky.nameIndex.get(n)] }));
    const minAz = pts.reduce((a, b) => (b.az < a.az ? b : a));
    const minAlt = pts.reduce((a, b) => (b.alt < a.alt ? b : a));
    expect(minAz.n).toBe('Alpheratz');     // smallest azimuth = furthest left when facing east
    expect(minAlt.n).toBe('Algenib');
    // and the square is high in the east
    for (const p of pts) { expect(p.az).toBeGreaterThan(60); expect(p.az).toBeLessThan(140); expect(p.alt).toBeGreaterThan(40); }
  });

  it('Saturn lies on from Algenib, toward the horizon, about one square-side further', () => {
    const side = sepDeg(obj.Alpheratz.v, obj.Algenib.v);
    const hop = sepDeg(obj.Algenib.v, obj.saturn.v);
    expect(hop / side).toBeGreaterThan(0.85);
    expect(hop / side).toBeLessThan(1.25);
    expect(sky.saturn.alt).toBeLessThan(sky.alt[sky.nameIndex.get('Algenib')] - 10);
    // nothing brighter than Saturn within 12 degrees of it
    for (let i = 0; i < sky.n; i++) if (sepDeg([sky.pos[i * 3], sky.pos[i * 3 + 1], sky.pos[i * 3 + 2]], obj.saturn.v) < 12) expect(sky.mag[i]).toBeGreaterThan(sky.saturn.mag);
  });

  it('the line from Mirach through Mu Andromedae runs on to the Andromeda Galaxy, the same distance again', () => {
    const a = sepDeg(obj.Mirach.v, obj['Mu Andromedae'].v);
    const b = sepDeg(obj['Mu Andromedae'].v, obj.m31.v);
    expect(Math.abs(a - b) / a).toBeLessThan(0.1);
    // nearly straight: Mirach to the galaxy is close to a + b
    expect(sepDeg(obj.Mirach.v, obj.m31.v)).toBeGreaterThan(0.95 * (a + b));
    // "up and to the left" from Mirach
    const mu = sky.nameIndex.get('Mu Andromedae'), mi = sky.nameIndex.get('Mirach');
    expect(sky.alt[mu]).toBeGreaterThan(sky.alt[mi]);
    expect(sky.az[mu]).toBeLessThan(sky.az[mi]);
  });

  it('the Moon is low in the south, and Tycho is sunlit, in the lower half of the disk', () => {
    expect(sky.moon.az).toBeGreaterThan(160); expect(sky.moon.az).toBeLessThan(200);
    const t = MOON_FEATURES.find((f) => f.id === 'tycho');
    const d = moonDisk(t.lat, t.lon, sky.moon.libLat, sky.moon.libLon);
    expect(d.y).toBeLessThan(-0.5);
    expect(moonLit(sky.moon, d.x, d.y)).toBe(true);
    // Tycho in the sky is below the Moon's centre
    expect(vecAlt(obj.tycho.v)).toBeLessThan(sky.moon.alt);
    // waxing Moon in the evening: the lit side faces the Sun in the west, which is IAU lunar east
    expect(moonSunDir(sky.moon).x).toBeGreaterThan(0.9);
    // Mare Crisium (IAU east) is lit, the far western Oceanus Procellarum edge is not
    const crisium = MOON_FEATURES.find((f) => f.id === 'crisium');
    const c = moonDisk(crisium.lat, crisium.lon, sky.moon.libLat, sky.moon.libLon);
    expect(moonLit(sky.moon, c.x, c.y)).toBe(true);
    const west = moonDisk(10, 285, sky.moon.libLat, sky.moon.libLon);
    expect(moonLit(sky.moon, west.x, west.y)).toBe(false);
  });
});

function vecAlt(v) { return Math.asin(v[2]) / D; }

describe('Sky Seeker view', () => {
  it('projects the centre of the view to the middle and keeps east on the left when facing south', () => {
    const view = { alt: 30, az: 180, zoom: 'finder' };
    const b = basis(view);
    const s = scaleFor(60, 300);
    const out = [0, 0];
    const c = vec(30, 180);
    project(b, s, c[0], c[1], c[2], out);
    expect(Math.abs(out[0]) + Math.abs(out[1])).toBeLessThan(1e-9);
    const e = vec(30, 170); // toward the east
    project(b, s, e[0], e[1], e[2], out);
    expect(out[0]).toBeLessThan(0);
    const up = vec(40, 180);
    project(b, s, up[0], up[1], up[2], out);
    expect(out[1]).toBeLessThan(0); // screen y runs down
    // the field edge lands on the eyepiece rim
    const edge = vec(30, 180 + 30 / Math.cos(30 * D));
    const r = vec(30 + 30, 180);
    project(b, s, r[0], r[1], r[2], out);
    expect(Math.abs(out[1])).toBeCloseTo(300, 0);
    expect(edge).toBeTruthy();
  });

  it('dragging moves the sky with the finger, and arrows step by a part of the field', () => {
    const v = { alt: 30, az: 180, zoom: 'finder' };
    dragView(v, 100, 0, 300); // drag right: the view swings left (east)
    expect(v.az).toBeLessThan(180);
    const w = { alt: 30, az: 180, zoom: 'low' };
    arrowView(w, 'up', 0.5);
    expect(w.alt).toBeCloseTo(33, 5);
    arrowView(w, 'right', 0.5);
    expect(w.az).toBeGreaterThan(180);
    const z = { alt: 85, az: 0, zoom: 'finder' };
    arrowView(z, 'up', 0.5);
    expect(z.alt).toBeLessThanOrEqual(86);
  });
});

describe('Sky Seeker levels', () => {
  it('has three levels with look limits 6, 8 and 10', () => {
    expect(LEVELS.map((l) => l.limit)).toEqual([6, 8, 10]);
    expect(STAMP_SKILL).toBe('Star-hopped to a target');
  });

  it('every level is solvable within its look limit, and the stored fewest looks are right', () => {
    for (const l of LEVELS) {
      const f = fewestLooks(l, obj);
      expect(f.looks, `level ${l.id}`).toBe(l.best);
      expect(f.looks).toBeLessThanOrEqual(l.limit);
      // with arrows only (hold to pan, one look per press) it still fits
      expect(arrowLooks(l)).toBeLessThanOrEqual(l.limit);
      // the target does not start in view, so the player has to hunt
      const startTol = ZOOMS[l.start.zoom].fov / 2;
      expect(sepDeg(viewVec(l.start), obj[l.steps.at(-1).id].v)).toBeGreaterThan(startTol);
    }
  });

  it('plays level 2 the clean way for three stars', () => {
    const l = LEVELS[1];
    const st = newState(l);
    const go = (id, zoom) => { const a = altOf(obj[id].v); st.view.alt = a.alt; st.view.az = a.az; st.view.zoom = zoom; return look(st, l, obj); };
    // two looks to cross the sky toward the square
    st.view.az = 130; st.view.alt = 50; look(st, l, obj);
    go('Alpheratz', 'finder');
    expect(st.found).toBe(1);
    go('Algenib', 'finder');
    go('saturn', 'finder');
    st.view.zoom = 'high'; settle(st, l, obj);
    expect(confirm(st, l, sky, obj).kind).toBe('win');
    const s = starsFor(st, l);
    expect(s.stars).toBe(3);
    expect(st.looks).toBe(4);
  });

  it('a wrong Confirm names what you are looking at and costs the third star only', () => {
    const l = LEVELS[1];
    const st = newState(l);
    const a = altOf(obj.Mirach.v);
    st.view = { alt: a.alt, az: a.az, zoom: 'finder' };
    look(st, l, obj);
    const r = confirm(st, l, sky, obj);
    expect(r.kind).toBe('wrong');
    expect(r.text).toMatch(/Mirach/);
    const sat = altOf(obj.saturn.v);
    st.view = { alt: sat.alt, az: sat.az, zoom: 'finder' };
    look(st, l, obj);
    expect(confirm(st, l, sky, obj).kind).toBe('zoom'); // close, but zoom in first
    st.view.zoom = 'low';
    expect(confirm(st, l, sky, obj).kind).toBe('win');
    const s = starsFor(st, l);
    expect(s.stars).toBe(2);
    expect(s.inOrder).toBe(false); // skipped the clue stars
  });

  it('level 1: the crater counts only at High, and the Moon is named when you confirm on it', () => {
    const l = LEVELS[0];
    const st = newState(l);
    const m = altOf(obj.moon.v);
    st.view = { alt: m.alt, az: m.az, zoom: 'low' };
    look(st, l, obj);
    expect(st.found).toBe(1);
    st.view.zoom = 'high';
    const r = confirm(st, l, sky, obj);
    expect(r.kind).toBe('wrong');
    expect(r.text).toMatch(/Moon/);
    const t = altOf(obj.tycho.v);
    st.view.alt = t.alt; st.view.az = t.az;
    look(st, l, obj);
    expect(identify(st.view, sky, obj).id).toBe('tycho');
    expect(confirm(st, l, sky, obj).kind).toBe('win');
  });

  it('copy has no em dashes', () => {
    const text = JSON.stringify(LEVELS) + Object.values(obj).map((o) => o.what).join(' ');
    expect(text).not.toMatch(/—/);
  });
});

function altOf(v) { return { alt: Math.asin(v[2]) / D, az: ((Math.atan2(v[0], v[1]) / D) + 360) % 360 }; }
