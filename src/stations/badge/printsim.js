/**
 * Layer-by-layer print check for Badge Builder, on a 1 mm voxel grid.
 *
 * Rule (a simple version of desktop printer advice): every bit of a new
 * 1 mm layer needs printed material under it, or within REACH_MM to the side
 * in the layer below. So a layer may stick out about 2 mm past the one under
 * it (a short ledge, like a raised emblem's edge on a badge standing up).
 * More than that has nothing holding it up: it droops, and the preview stops
 * there. The doc asks for this rule to be fact-checked against the bus's
 * printer; change REACH_MM if that check says otherwise.
 *
 * Orientations: 'flat' (on its back, face up), 'face' (face down) and
 * 'edge' (standing on its bottom edge). `turn` spins the badge on the bed in
 * quarter turns before it is stood up, so it picks which edge is down.
 */
import { PIECES, partsFor, LAYER_MM } from './design.js';

const N = 128;           // plane grid cells per side (mm)
const HALF = N / 2;
const T = 6;             // layers of thickness, mm
export const REACH_MM = 2;

/** Decode a piece's row runs into a bitmap once. */
const bitmaps = new Map();
export function bitmap(name) {
  let b = bitmaps.get(name);
  if (b) return b;
  const p = PIECES[name];
  if (!p) throw new Error(`Unknown piece ${name}`);
  const bits = new Uint8Array(p.w * p.h);
  p.rows.forEach((runs, r) => { for (let i = 0; i < runs.length; i += 2) bits.fill(1, r * p.w + runs[i], r * p.w + runs[i] + runs[i + 1]); });
  b = { ...p, bits };
  bitmaps.set(name, b);
  return b;
}

/** Is glTF point (x, z) in mm inside the piece's outline? */
export function pieceHas(b, x, z) {
  const c = Math.floor(x - b.x0), r = Math.floor(z - b.z0);
  if (c < 0 || r < 0 || c >= b.w || r >= b.h) return false;
  return b.bits[r * b.w + c] === 1;
}

/**
 * Fill the plane grid. Returns a Uint8Array N*N*T, index (t*N + iy)*N + ix,
 * where cell (ix, iy) has its centre at plane (ix - HALF + 0.5, iy - HALF + 0.5).
 */
export function rasterize(parts) {
  const g = new Uint8Array(N * N * T);
  for (const part of parts) {
    const b = bitmap(part.piece);
    const s = part.s || 1;
    // bounds of the piece on the plane
    const minx = Math.max(0, Math.floor(part.cx + b.x0 * s + HALF) - 1);
    const maxx = Math.min(N - 1, Math.ceil(part.cx + (b.x0 + b.w) * s + HALF) + 1);
    const miny = Math.max(0, Math.floor(part.cy - (b.z0 + b.h) * s + HALF) - 1);
    const maxy = Math.min(N - 1, Math.ceil(part.cy - b.z0 * s + HALF) + 1);
    for (let iy = miny; iy <= maxy; iy++) {
      const py = iy - HALF + 0.5;
      for (let ix = minx; ix <= maxx; ix++) {
        const px = ix - HALF + 0.5;
        if (!pieceHas(b, (px - part.cx) / s, -(py - part.cy) / s)) continue;
        for (let t = part.t0; t < part.t0 + part.th && t < T; t++) g[(t * N + iy) * N + ix] = 1;
      }
    }
  }
  return g;
}

/**
 * Map plane cell centres to print coordinates (mm, Z up), for an
 * orientation and quarter turn. Returns the same transform for 3D use.
 * Plane (x, y, t) -> after turn (x', y', t) -> print (X, Y, Z).
 */
export function orientVec(orientation, turn, x, y, t, out) {
  const k = ((turn % 4) + 4) % 4;
  let a = x, b = y;
  for (let i = 0; i < k; i++) { const nx = -b, ny = a; a = nx; b = ny; }
  if (orientation === 'flat') { out[0] = a; out[1] = b; out[2] = t; }
  else if (orientation === 'face') { out[0] = a; out[1] = -b; out[2] = -t; }
  else { out[0] = a; out[1] = -t; out[2] = b; } // edge: stand up, plane y becomes Z
  return out;
}

/**
 * Simulate printing a design in one orientation.
 * @returns {{ok:boolean, heightMm:number, layers:number, cellCount:number,
 *   fail:null|{z:number, layer:number, cells:number[][], supported:number},
 *   min:number[], max:number[]}}
 *   Cells and min/max are in print mm (cell centres); Z starts at 0.5.
 */
export function simulate(design, orientation, turn = 0) {
  const g = rasterize(partsFor(design));
  const pts = [];
  const v = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < T; t++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++) {
    if (!g[(t * N + iy) * N + ix]) continue;
    orientVec(orientation, turn, ix - HALF + 0.5, iy - HALF + 0.5, t + 0.5, v);
    pts.push(v[0], v[1], v[2]);
    for (let i = 0; i < 3; i++) { if (v[i] < min[i]) min[i] = v[i]; if (v[i] > max[i]) max[i] = v[i]; }
  }
  const count = pts.length / 3;
  if (!count) return { ok: false, heightMm: 0, layers: 0, cellCount: 0, fail: null, min, max };
  // voxel grid in print space
  const W = Math.round(max[0] - min[0]) + 1, D = Math.round(max[1] - min[1]) + 1, H = Math.round(max[2] - min[2]) + 1;
  const vox = new Uint8Array(W * D * H);
  for (let i = 0; i < pts.length; i += 3) {
    const X = Math.round(pts[i] - min[0]), Y = Math.round(pts[i + 1] - min[1]), Z = Math.round(pts[i + 2] - min[2]);
    vox[(Z * D + Y) * W + X] = 1;
  }
  let fail = null;
  for (let Z = 1; Z < H && !fail; Z++) {
    const bad = [];
    let supported = 0;
    for (let Y = 0; Y < D; Y++) for (let X = 0; X < W; X++) {
      if (!vox[(Z * D + Y) * W + X]) continue;
      let ok = false;
      for (let dy = -REACH_MM; dy <= REACH_MM && !ok; dy++) for (let dx = -REACH_MM; dx <= REACH_MM && !ok; dx++) {
        const x2 = X + dx, y2 = Y + dy;
        if (x2 >= 0 && y2 >= 0 && x2 < W && y2 < D && vox[((Z - 1) * D + y2) * W + x2]) ok = true;
      }
      if (ok) supported++;
      else bad.push([X + min[0], Y + min[1], Z + min[2]]);
    }
    if (bad.length) fail = { z: Z, layer: Math.round(Z / LAYER_MM) + 1, cells: bad, supported };
  }
  const heightMm = H;
  return { ok: !fail, heightMm, layers: Math.round(heightMm / LAYER_MM), cellCount: count, fail, min, max };
}

export const ORIENTATIONS = [
  { id: 'flat', label: 'Flat on its back', hint: 'Face up, lying flat on the bed.' },
  { id: 'edge', label: 'Standing on its edge', hint: 'Standing up. Turn it to pick which edge is down.' },
  { id: 'face', label: 'Face down', hint: 'Upside down, raised pieces on the bed.' },
];

/** Every orientation and turn, with its result. Used for the three-star check. */
export function allOptions(design) {
  const out = [];
  for (const o of ORIENTATIONS) {
    const turns = o.id === 'edge' ? [0, 1, 2, 3] : [0];
    for (const turn of turns) {
      const r = simulate(design, o.id, turn);
      out.push({ orientation: o.id, turn, ok: r.ok, layers: r.layers });
    }
  }
  return out;
}

/** Fewest layers among the ways that print, or null if none print. */
export function fewestLayers(design) {
  const ok = allOptions(design).filter((o) => o.ok);
  return ok.length ? Math.min(...ok.map((o) => o.layers)) : null;
}
