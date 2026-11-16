// Builds public/assets/sky/sky.json, the only star data Sky Seeker ships.
// Run once, offline (not part of the game build):
//   node scripts/build-sky-data.mjs <hyg_v38.csv> <constellationship.fab> <path to astronomy-engine esm/astronomy.js>
// Sources (see src/stations/sky/SOURCES.md):
//   HYG database v3.8 (astronexus/HYG-Database on GitHub): star J2000 positions and V magnitudes
//   Stellarium 0.22.2 western sky culture constellationship.fab: constellation stick figures (HIP numbers)
//   Astronomy Engine 2.x (Don Cross, MIT licence): Moon, Saturn, Sun, rotation axes, J2000 -> horizon with refraction
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [hygPath, fabPath, aePath] = process.argv.slice(2);
const A = await import(pathToFileURL(aePath).href);

export const SKY_TIME = '2026-10-21T02:00:00Z'; // Tuesday 20 October 2026, 9:00 pm CDT
const PLACE = { name: 'Tulsa, Oklahoma', lat: 36.15, lon: -95.99, height: 220 };
const t = A.MakeTime(new Date(SKY_TIME));
const obs = new A.Observer(PLACE.lat, PLACE.lon, PLACE.height);
const rot = A.Rotation_EQJ_HOR(t, obs);
const D = Math.PI / 180;

/** J2000 RA (hours) / Dec (deg) -> apparent horizon {alt, az} with refraction. */
function hor(raH, decD) {
  const v = A.VectorFromSphere(new A.Spherical(decD, raH * 15, 1), t);
  const s = A.HorizonFromVector(A.RotateVector(rot, v), 'normal');
  return { alt: s.lat, az: (s.lon + 360) % 360 };
}
/** Point offset `deg` degrees from (ra,dec) toward (ra2,dec2), J2000. */
function toward(raH, decD, ra2H, dec2D, deg) {
  const u = (r, d) => [Math.cos(d * D) * Math.cos(r * 15 * D), Math.cos(d * D) * Math.sin(r * 15 * D), Math.sin(d * D)];
  const a = u(raH, decD), b = u(ra2H, dec2D);
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let tv = b.map((x, i) => x - dot * a[i]);
  const n = Math.hypot(...tv); tv = tv.map((x) => x / n);
  const p = a.map((x, i) => x * Math.cos(deg * D) + tv[i] * Math.sin(deg * D));
  return { ra: Math.atan2(p[1], p[0]) / D / 15, dec: Math.asin(p[2]) / D };
}
const sep = (r1, d1, r2, d2) => Math.acos(Math.min(1, Math.sin(d1 * D) * Math.sin(d2 * D) + Math.cos(d1 * D) * Math.cos(d2 * D) * Math.cos((r1 - r2) * 15 * D))) / D;
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// ---- stars ----
const lines = readFileSync(hygPath, 'utf8').split('\n');
const head = lines[0].split(',').map((s) => s.replace(/"/g, ''));
const col = Object.fromEntries(head.map((h, i) => [h, i]));
const all = [];
for (let i = 1; i < lines.length; i++) {
  const c = lines[i].split(',');
  if (c.length < head.length) continue;
  const mag = Number(c[col.mag]);
  if (!(mag <= 9.5)) continue;
  const proper = c[col.proper].replace(/"/g, '');
  if (proper === 'Sol') continue;
  all.push({ hip: Number(c[col.hip]) || 0, ra: Number(c[col.ra]), dec: Number(c[col.dec]), mag, proper, bayer: c[col.bayer].replace(/"/g, ''), con: c[col.con].replace(/"/g, '') });
}
const byHip = new Map(all.filter((s) => s.hip).map((s) => [s.hip, s]));

// Solar system bodies, topocentric, J2000 frame.
const eq = (body) => A.Equator(body, t, obs, false, true);
const moonEq = eq(A.Body.Moon), satEq = eq(A.Body.Saturn), sunEq = eq(A.Body.Sun);
const M31 = { ra: 0 + 42 / 60 + 44.3 / 3600, dec: 41 + 16 / 60 + 9 / 3600 }; // Wikipedia infobox, J2000
const named = (n) => all.find((s) => s.proper === n);
const muAnd = all.find((s) => s.bayer === 'Mu' && s.con === 'And');
const nuAnd = all.find((s) => s.bayer === 'Nu' && s.con === 'And');
const routes = [named('Alpheratz'), named('Algenib'), named('Mirach'), muAnd, nuAnd, { ra: satEq.ra, dec: satEq.dec }, M31, { ra: moonEq.ra, dec: moonEq.dec }];
const near = (s, list, deg) => list.some((p) => sep(s.ra, s.dec, p.ra, p.dec) <= deg);

// constellation figures
const fab = readFileSync(fabPath, 'utf8').trim().split('\n').map((l) => l.trim().split(/\s+/));
const lineHips = new Set();
for (const f of fab) for (const h of f.slice(2)) lineHips.add(Number(h));

const keep = [];
for (const s of all) {
  const h = hor(s.ra, s.dec);
  if (h.alt < -1) continue;
  const ok = (s.mag <= 5.2) || (s.mag <= 8.0 && near(s, routes, 7)) || (s.mag <= 9.5 && near(s, [routes[5], M31], 1.0)) || lineHips.has(s.hip);
  if (ok) keep.push({ ...s, ...h, src: s });
}
keep.sort((a, b) => a.mag - b.mag);
const index = new Map(keep.map((s, i) => [s.src, i]));

const cons = [];
for (const f of fab) {
  const abbr = f[0];
  const hips = f.slice(2).map(Number);
  const segs = [];
  for (let i = 0; i + 1 < hips.length; i += 2) {
    const a = byHip.get(hips[i]), b = byHip.get(hips[i + 1]);
    if (!a || !b || !index.has(a) || !index.has(b)) continue;
    segs.push(index.get(a), index.get(b));
  }
  if (segs.length) cons.push({ abbr, segs });
}

const names = {};
keep.forEach((s, i) => {
  if (s.proper && (s.mag <= 2.6 || ['Alpheratz', 'Algenib', 'Mirach', 'Markab', 'Scheat', 'Schedar'].includes(s.proper))) names[i] = s.proper;
});
names[index.get(muAnd)] = 'Mu Andromedae';
names[index.get(nuAnd)] = 'Nu Andromedae';

// ---- bodies ----
const moonH = hor(moonEq.ra, moonEq.dec);
const moonAxis = A.RotationAxis(A.Body.Moon, t);
const mN = toward(moonEq.ra, moonEq.dec, moonAxis.ra, moonAxis.dec, 0.25);
const sunH = hor(sunEq.ra, sunEq.dec);
const mill = A.Illumination(A.Body.Moon, t);
const lib = A.Libration(t);
const satH = hor(satEq.ra, satEq.dec);
const satAxis = A.RotationAxis(A.Body.Saturn, t);
const sN = toward(satEq.ra, satEq.dec, satAxis.ra, satAxis.dec, 0.01);
const sill = A.Illumination(A.Body.Saturn, t);
const satDiam = 2 * Math.atan(60268 / (satEq.dist * 149597870.7)) / D * 3600;
const m31H = hor(M31.ra, M31.dec);
// M31 major axis at position angle 38 deg (east of north): endpoints 1.58 deg each side (apparent size 3.17 x 1 deg)
const PA = 38;
const northPt = toward(M31.ra, M31.dec, M31.ra, 89.9, 1);
const majA = rotateAbout(M31, northPt, PA, 1.58), majB = rotateAbout(M31, northPt, PA + 180, 1.58);
function rotateAbout(c, n, paDeg, dist) {
  // tangent basis at c: north (toward celestial pole) and east (increasing RA)
  const u = (r, d) => [Math.cos(d * D) * Math.cos(r * 15 * D), Math.cos(d * D) * Math.sin(r * 15 * D), Math.sin(d * D)];
  const p = u(c.ra, c.dec);
  const north = [-Math.sin(c.dec * D) * Math.cos(c.ra * 15 * D), -Math.sin(c.dec * D) * Math.sin(c.ra * 15 * D), Math.cos(c.dec * D)];
  const east = [-Math.sin(c.ra * 15 * D), Math.cos(c.ra * 15 * D), 0];
  const dir = north.map((x, i) => x * Math.cos(paDeg * D) + east[i] * Math.sin(paDeg * D));
  const q = p.map((x, i) => x * Math.cos(dist * D) + dir[i] * Math.sin(dist * D));
  return { ra: ((Math.atan2(q[1], q[0]) / D / 15) + 24) % 24, dec: Math.asin(q[2]) / D };
}
const h4 = (h) => [r4(h.alt), r4(h.az)];

const out = {
  meta: {
    utc: SKY_TIME,
    local: 'Tuesday, October 20, 2026, at 9:00 pm (Central Daylight Time)',
    place: PLACE,
    note: 'Positions are apparent altitude and azimuth (degrees, azimuth from north through east), with refraction, for this one moment.',
  },
  // flat: alt, az, mag for each star, brightest first
  stars: keep.flatMap((s) => [Math.round(s.alt * 1000) / 1000, Math.round(s.az * 1000) / 1000, Math.round(s.mag * 100) / 100]),
  names,
  cons,
  moon: {
    pos: h4(moonH), north: h4(hor(mN.ra, mN.dec)), sun: h4(sunH),
    diam: r4(2 * Math.atan(1737.4 / (moonEq.dist * 149597870.7)) / D),
    phaseAngle: r4(mill.phase_angle), lit: r4(mill.phase_fraction),
    libLat: r4(lib.elat), libLon: r4(lib.elon),
    constellation: A.Constellation(moonEq.ra, moonEq.dec).name,
  },
  saturn: {
    pos: h4(satH), north: h4(hor(sN.ra, sN.dec)), mag: r4(sill.mag), ringTilt: r4(sill.ring_tilt),
    diam: r4(satDiam), constellation: A.Constellation(satEq.ra, satEq.dec).name,
  },
  m31: { pos: h4(m31H), majA: h4(hor(majA.ra, majA.dec)), majB: h4(hor(majB.ra, majB.dec)), minorDeg: 1, majorDeg: 3.17 },
};
writeFileSync(new URL('../public/assets/sky/sky.json', import.meta.url), JSON.stringify(out));
console.log('stars', keep.length, 'cons', cons.length, 'bytes', JSON.stringify(out).length);
console.log('moon', out.moon, '\nsaturn', out.saturn, '\nm31', out.m31);
for (const [i, n] of Object.entries(names)) if (['Alpheratz', 'Algenib', 'Mirach', 'Mu Andromedae', 'Nu Andromedae', 'Schedar'].includes(n)) console.log(n, keep[i].alt.toFixed(3), keep[i].az.toFixed(3), keep[i].mag);
