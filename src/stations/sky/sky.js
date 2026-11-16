/**
 * Sky Seeker: pure sky math and data, no DOM. The sky is fixed: one date,
 * time and place (see SOURCES.md), stored as apparent altitude/azimuth.
 *
 * Vectors are east-north-up: x = east, y = north, z = up.
 * Azimuth runs from north (0) through east (90).
 */

const D = Math.PI / 180;

export const CON_NAMES = {
  And: 'Andromeda', Aql: 'Aquila', Aqr: 'Aquarius', Ari: 'Aries', Aur: 'Auriga', Boo: 'Bootes', Cam: 'Camelopardalis',
  Cap: 'Capricornus', Cas: 'Cassiopeia', Cep: 'Cepheus', Cet: 'Cetus', CrA: 'Corona Australis', CrB: 'Corona Borealis',
  Cyg: 'Cygnus', Del: 'Delphinus', Dra: 'Draco', Equ: 'Equuleus', Eri: 'Eridanus', Gru: 'Grus', Her: 'Hercules',
  Ind: 'Indus', Lac: 'Lacerta', Lyn: 'Lynx', Lyr: 'Lyra', Mic: 'Microscopium', Oph: 'Ophiuchus', Peg: 'Pegasus',
  Per: 'Perseus', Phe: 'Phoenix', PsA: 'Piscis Austrinus', Psc: 'Pisces', Scl: 'Sculptor', Sct: 'Scutum', Ser: 'Serpens',
  Sge: 'Sagitta', Sgr: 'Sagittarius', Tau: 'Taurus', Tri: 'Triangulum', UMa: 'Ursa Major', UMi: 'Ursa Minor', Vul: 'Vulpecula',
};

/** Zoom levels: full field of view across the eyepiece, in degrees. */
export const ZOOMS = {
  // center: radius of the centre ring as a part of the field. At Finder and Low the ring is
  // smaller than the next zoom's field, so whatever is in the ring is still in view after zooming in.
  finder: { label: 'Finder', fov: 60, limitMag: 5.2, center: 0.045 },
  low: { label: 'Low', fov: 6, limitMag: 8.0, center: 0.03 },
  high: { label: 'High', fov: 0.4, limitMag: 9.5, center: 0.12 },
};
export const ZOOM_ORDER = ['finder', 'low', 'high'];
/** A drag can move the view by at most this fraction of the field (a point near the edge to the middle). */
export const DRAG_REACH = 0.45;
export const ALT_MIN = 0, ALT_MAX = 86;

/** @returns {[number,number,number]} */
export function vec(alt, az) {
  const ca = Math.cos(alt * D);
  return [ca * Math.sin(az * D), ca * Math.cos(az * D), Math.sin(alt * D)];
}
export function toAltAz(v) {
  const alt = Math.asin(Math.max(-1, Math.min(1, v[2]))) / D;
  let az = Math.atan2(v[0], v[1]) / D;
  if (az < 0) az += 360;
  return { alt, az };
}
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
/** Angle between two unit vectors, degrees. */
export function sepDeg(a, b) { return Math.acos(Math.max(-1, Math.min(1, dot(a, b)))) / D; }
export function sepAltAz(a, b) { return sepDeg(vec(a.alt, a.az), vec(b.alt, b.az)); }

/**
 * Parse sky.json into the shape the game uses.
 * @param {any} json
 */
export function parseSky(json) {
  const n = json.stars.length / 3;
  const pos = new Float32Array(n * 3);
  const mag = new Float32Array(n);
  const alt = new Float32Array(n), az = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = json.stars[i * 3], z = json.stars[i * 3 + 1];
    const v = vec(a, z);
    pos[i * 3] = v[0]; pos[i * 3 + 1] = v[1]; pos[i * 3 + 2] = v[2];
    mag[i] = json.stars[i * 3 + 2];
    alt[i] = a; az[i] = z;
  }
  /** star index -> constellation abbreviation, for stars in a stick figure */
  const conOf = new Map();
  for (const c of json.cons) for (const i of c.segs) if (!conOf.has(i)) conOf.set(i, c.abbr);
  const names = new Map(Object.entries(json.names).map(([k, v]) => [Number(k), v]));
  const nameIndex = new Map([...names].map(([i, v]) => [v, i]));
  const m = json.moon, s = json.saturn, g = json.m31;
  const moon = {
    v: vec(m.pos[0], m.pos[1]), alt: m.pos[0], az: m.pos[1], diam: m.diam,
    northV: vec(m.north[0], m.north[1]), sunV: vec(m.sun[0], m.sun[1]),
    phaseAngle: m.phaseAngle, lit: m.lit, libLat: m.libLat, libLon: m.libLon, constellation: m.constellation,
  };
  const saturn = { v: vec(s.pos[0], s.pos[1]), alt: s.pos[0], az: s.pos[1], northV: vec(s.north[0], s.north[1]), mag: s.mag, ringTilt: s.ringTilt, diam: s.diam, constellation: s.constellation };
  const m31 = { v: vec(g.pos[0], g.pos[1]), alt: g.pos[0], az: g.pos[1], aV: vec(g.majA[0], g.majA[1]), bV: vec(g.majB[0], g.majB[1]), major: g.majorDeg, minor: g.minorDeg };
  return { n, pos, mag, alt, az, names, nameIndex, conOf, cons: json.cons, moon, saturn, m31, meta: json.meta };
}

export function starVec(sky, i) { return [sky.pos[i * 3], sky.pos[i * 3 + 1], sky.pos[i * 3 + 2]]; }

/** Tangent directions at a point on the sky: north-ish toward `towardV`, and the one 90 degrees round. */
export function tangentFrame(p, towardV) {
  const d = dot(p, towardV);
  const n = norm([towardV[0] - d * p[0], towardV[1] - d * p[1], towardV[2] - d * p[2]]);
  // For a viewer inside the sphere looking out along p with n up, sky west is p x n.
  const w = cross(p, n);
  return { n, w };
}

/**
 * Lunar feature at selenographic lat/lon (degrees, longitude positive east, IAU)
 * as an offset on the Moon's disk in Moon radii: x toward IAU east (sky west),
 * y toward lunar north. Libration sets the centre of the disk. Null if on the far side.
 */
export function moonDisk(lat, lon, libLat = 0, libLon = 0) {
  const l = lat * D, dl = (lon - libLon) * D, l0 = libLat * D;
  const cosc = Math.sin(l0) * Math.sin(l) + Math.cos(l0) * Math.cos(l) * Math.cos(dl);
  if (cosc < 0) return null;
  return { x: Math.cos(l) * Math.sin(dl), y: Math.cos(l0) * Math.sin(l) - Math.sin(l0) * Math.cos(l) * Math.cos(dl) };
}

/** Sky direction of a lunar feature. */
export function moonFeatureVec(moon, lat, lon) {
  const d = moonDisk(lat, lon, moon.libLat, moon.libLon);
  const { n, w } = tangentFrame(moon.v, moon.northV);
  const r = (moon.diam / 2) * D;
  const p = moon.v;
  return norm([p[0] + r * (d.x * w[0] + d.y * n[0]), p[1] + r * (d.x * w[1] + d.y * n[1]), p[2] + r * (d.x * w[2] + d.y * n[2])]);
}

/**
 * Sun direction on the Moon's disk, as a unit 2D vector in the disk frame
 * (x toward IAU east / sky west, y toward lunar north).
 */
export function moonSunDir(moon) {
  const { n, w } = tangentFrame(moon.v, moon.northV);
  const d = dot(moon.v, moon.sunV);
  const t = [moon.sunV[0] - d * moon.v[0], moon.sunV[1] - d * moon.v[1], moon.sunV[2] - d * moon.v[2]];
  const x = dot(t, w), y = dot(t, n), l = Math.hypot(x, y);
  return { x: x / l, y: y / l };
}

/** True if disk point (x, y) in Moon radii is sunlit. */
export function moonLit(moon, x, y, sun = moonSunDir(moon)) {
  const xs = x * sun.x + y * sun.y;          // toward the Sun
  const ys = -x * sun.y + y * sun.x;
  const edge = Math.sqrt(Math.max(0, 1 - ys * ys));
  return xs > -Math.cos(moon.phaseAngle * D) * edge;
}

// ---------- the view ----------

/**
 * @typedef {{alt:number, az:number, zoom:'finder'|'low'|'high'}} View
 */

/** Camera basis for a view: forward, right (increasing azimuth), up. */
export function basis(view, out = { f: [0, 0, 0], r: [0, 0, 0], u: [0, 0, 0] }) {
  const ca = Math.cos(view.alt * D), sa = Math.sin(view.alt * D), cz = Math.cos(view.az * D), sz = Math.sin(view.az * D);
  out.f[0] = ca * sz; out.f[1] = ca * cz; out.f[2] = sa;
  out.r[0] = cz; out.r[1] = -sz; out.r[2] = 0;
  // u = r x f
  out.u[0] = out.r[1] * out.f[2] - out.r[2] * out.f[1];
  out.u[1] = out.r[2] * out.f[0] - out.r[0] * out.f[2];
  out.u[2] = out.r[0] * out.f[1] - out.r[1] * out.f[0];
  return out;
}

/** Pixels per unit of stereographic plane for a view of field `fov` drawn in a circle of radius R. */
export function scaleFor(fov, R) { return R / (2 * Math.tan((fov / 4) * D)); }

/**
 * Stereographic projection of unit vector (x,y,z). Writes screen offsets from
 * the centre into out[0], out[1] (y down). Returns false if far behind.
 */
export function project(b, s, x, y, z, out) {
  const Z = x * b.f[0] + y * b.f[1] + z * b.f[2];
  if (Z < -0.2) return false;
  const k = (2 * s) / (1 + Z);
  out[0] = k * (x * b.r[0] + y * b.r[1] + z * b.r[2]);
  out[1] = -k * (x * b.u[0] + y * b.u[1] + z * b.u[2]);
  return true;
}

export function clampView(v) {
  v.alt = Math.max(ALT_MIN, Math.min(ALT_MAX, v.alt));
  v.az = ((v.az % 360) + 360) % 360;
  return v;
}

/**
 * Pan the view by a screen drag of (dx, dy) pixels (the sky follows the finger).
 * @param {View} view @param {number} dx @param {number} dy @param {number} R eyepiece radius in px
 */
export function dragView(view, dx, dy, R) {
  const degPerPx = ZOOMS[view.zoom].fov / (2 * R);
  view.alt += dy * degPerPx;
  view.az -= (dx * degPerPx) / Math.max(0.1, Math.cos(view.alt * D));
  return clampView(view);
}

/** Pan by a fraction of the field in an arrow direction: 'up' | 'down' | 'left' | 'right'. */
export function arrowView(view, dir, frac) {
  const step = ZOOMS[view.zoom].fov * frac;
  if (dir === 'up') view.alt += step;
  else if (dir === 'down') view.alt -= step;
  else {
    const dAz = step / Math.max(0.1, Math.cos(view.alt * D));
    view.az += dir === 'right' ? dAz : -dAz;
  }
  return clampView(view);
}

export function viewVec(view) { return vec(view.alt, view.az); }
/** "Centered" means within this many degrees of the middle: the ring drawn in the eyepiece. */
export function centerTol(zoom) { return ZOOMS[zoom].fov * ZOOMS[zoom].center; }
