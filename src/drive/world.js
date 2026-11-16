import * as THREE from 'three';
import { OUTER, INNER, LOOP_Y, ROAD_WIDTH, centreline, groundHeight } from './track.js';

/**
 * The block of road round the school for Drive the Bus, built in code from
 * simple shapes in the hub's flat-colour style. Everything shares vertex
 * colours, so the whole loop is three draw calls: flat ground (road, walks,
 * lawns, lines), raised things (kerbs, buildings, lamps, barriers) and trees
 * (one instanced mesh). The hub's street, school and trees stay where they are.
 */

// Linear colours, matching hub.glb's flattened materials.
const C = {
  asphalt: [0.068, 0.08, 0.089],
  walk: [0.624, 0.584, 0.509],
  grass: [0.109, 0.462, 0.117],
  kerb: [0.584, 0.558, 0.503],
  line: [0.807, 0.807, 0.761],
  yellow: [0.76, 0.45, 0.042],
  window: [0.025, 0.048, 0.068],
  frame: [0.847, 0.83, 0.79],
  roof: [0.06, 0.065, 0.072],
  door: [0.006, 0.275, 0.162],
  pole: [0.018, 0.068, 0.058],
  lampHead: [0.023, 0.025, 0.03],
  lampGlow: [1, 0.86, 0.55],
  trunk: [0.195, 0.084, 0.037],
  leaf: [0.05, 0.423, 0.144],
  leafDark: [0.023, 0.254, 0.095],
  coral: [1, 0.147, 0.105],
  white: [0.92, 0.92, 0.9],
};
const WALLS = [
  [0.434, 0.091, 0.048], [0.62, 0.42, 0.22], [0.35, 0.52, 0.66], [0.78, 0.66, 0.42],
  [0.3, 0.42, 0.3], [0.85, 0.78, 0.66], [0.55, 0.25, 0.2], [0.42, 0.45, 0.6],
];

/** Collects triangles with normals and vertex colours. */
class Builder {
  constructor() { this.p = []; this.n = []; this.c = []; }
  tri(a, b, c, col) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [a, b, c]) { this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); }
  }
  /** Quad a b c d, counter-clockwise seen from the front. */
  quad(a, b, c, d, col) { this.tri(a, b, c, col); this.tri(a, c, d, col); }
  /** Flat quad on the ground (y up) from x0,z0 to x1,z1. */
  flat(x0, z0, x1, z1, y, col) { this.quad([x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0], col); }
  /**
   * Box with its base centre at (x, y, z), size (sx, sy, sz), turned ry about y.
   * Skips the bottom face.
   */
  box(x, y, z, sx, sy, sz, col, ry = 0, topCol = col) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const P = (lx, ly, lz) => [x + lx * c + lz * s, y + ly, z - lx * s + lz * c];
    const hx = sx / 2, hz = sz / 2;
    const v = [P(-hx, 0, -hz), P(hx, 0, -hz), P(hx, 0, hz), P(-hx, 0, hz), P(-hx, sy, -hz), P(hx, sy, -hz), P(hx, sy, hz), P(-hx, sy, hz)];
    this.quad(v[3], v[2], v[6], v[7], col); // +z
    this.quad(v[1], v[0], v[4], v[5], col); // -z
    this.quad(v[2], v[1], v[5], v[6], col); // +x
    this.quad(v[0], v[3], v[7], v[4], col); // -x
    this.quad(v[7], v[6], v[5], v[4], topCol); // top
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.computeBoundingSphere();
    return g;
  }
  get triangles() { return this.p.length / 9; }
}

/**
 * Points along the edge of a rounded rectangle, anticlockwise seen from above
 * (as x goes right and z goes down the screen), as an open path that keeps
 * only the stretch with z below zCut (away from the street).
 * Each point has its outward normal.
 */
function edgePath(b, rBack, rFront, zCut, step = 1.5) {
  const pts = [];
  const push = (x, z, nx, nz) => pts.push({ x, z, nx, nz });
  const arc = (cx, cz, r, a0, a1) => {
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * Math.max(r, 1) / step));
    for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; push(cx + Math.cos(a) * r, cz + Math.sin(a) * r, Math.cos(a), Math.sin(a)); }
  };
  const line = (ax, az, bx, bz, nx, nz) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (step * 4)));
    for (let i = 0; i <= n; i++) {
      const z0 = az + (bz - az) * (i - 1) / n, z1 = az + (bz - az) * i / n;
      // add a point exactly where the path crosses zCut, so the cut edge lines up with the street
      if (i > 0 && (z0 - zCut) * (z1 - zCut) < 0) { const t = (zCut - az) / (bz - az); push(ax + (bx - ax) * t, zCut, nx, nz); }
      push(ax + (bx - ax) * i / n, z1, nx, nz);
    }
  };
  // east side going toward the back (z decreasing), back side west, west side toward the street
  const rf = rFront, rb = rBack;
  if (rf > 0) arc(b.maxX - rf, b.maxZ - rf, rf, Math.PI / 2, 0);
  line(b.maxX, b.maxZ - rf, b.maxX, b.minZ + rb, 1, 0);
  arc(b.maxX - rb, b.minZ + rb, rb, 0, -Math.PI / 2);
  line(b.maxX - rb, b.minZ, b.minX + rb, b.minZ, 0, -1);
  arc(b.minX + rb, b.minZ + rb, rb, -Math.PI / 2, -Math.PI);
  line(b.minX, b.minZ + rb, b.minX, b.maxZ - rf, -1, 0);
  if (rf > 0) arc(b.minX + rf, b.maxZ - rf, rf, Math.PI, Math.PI / 2);
  const out = [];
  for (const p of pts) {
    if (p.z > zCut) continue;
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - p.x, last.z - p.z) < 0.05) continue;
    out.push(p);
  }
  return out;
}

/** A strip of width w along path, from offset o0 to o1 along the normals, at height y. */
function strip(bld, path, o0, o1, y, col) {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const a0 = [a.x + a.nx * o0, y, a.z + a.nz * o0], a1 = [a.x + a.nx * o1, y, a.z + a.nz * o1];
    const b0 = [b.x + b.nx * o0, y, b.z + b.nz * o0], b1 = [b.x + b.nx * o1, y, b.z + b.nz * o1];
    bld.quad(a0, b0, b1, a1, col);
    // faces may be wound either way along the path; add the reverse so the top always shows
    bld.quad(a1, b1, b0, a0, col);
  }
}

/** A kerb along path: a low block from offset o0 to o1, top at y1. */
function kerb(bld, path, o0, o1, y0, y1, col) {
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i], b = path[i + 1];
    const P = (p, o, y) => [p.x + p.nx * o, y, p.z + p.nz * o];
    const top = [P(a, o0, y1), P(b, o0, y1), P(b, o1, y1), P(a, o1, y1)];
    bld.quad(top[0], top[1], top[2], top[3], col); bld.quad(top[3], top[2], top[1], top[0], col);
    const f = [P(a, o0, y0), P(b, o0, y0), P(b, o0, y1), P(a, o0, y1)];
    bld.quad(f[0], f[1], f[2], f[3], col); bld.quad(f[3], f[2], f[1], f[0], col);
  }
}

/**
 * Road surface of the side roads and the back road: a ribbon either side of
 * the middle line, so its edges follow the kerbs exactly round the corners.
 * Where it overlaps the street it drops to street level (same colour).
 */
function loopRibbon(bld) {
  const half = ROAD_WIDTH / 2;
  const pts = centreline(1).filter((p) => !(p.z > -3.6 && Math.abs(p.x) < INNER.maxX - INNER.r - 0.01));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const pa = pts[Math.max(0, i - 1)], nb = pts[Math.min(pts.length - 1, i + 2)];
    const na = norm(b.x - pa.x, b.z - pa.z), nbv = norm(nb.x - a.x, nb.z - a.z);
    const V = (p, n, o) => [p.x + n.z * o, groundHeight(p.x + n.z * o, p.z - n.x * o) + 0.002, p.z - n.x * o];
    const a0 = V(a, na, -half), a1 = V(a, na, half), b0 = V(b, nbv, -half), b1 = V(b, nbv, half);
    bld.quad(a0, b0, b1, a1, C.asphalt);
    bld.quad(a1, b1, b0, a0, C.asphalt);
  }
}
function norm(x, z) { const l = Math.hypot(x, z) || 1; return { x: x / l, z: z / l }; }

/** A building with rows of windows on the side that faces the road. */
function building(bld, x, z, w, d, hgt, faceAngle, wall, floors, cols) {
  bld.box(x, 0.06, z, w, hgt, d, wall, faceAngle, C.roof);
  bld.box(x, 0.06 + hgt, z, w + 0.4, 0.35, d + 0.4, C.roof, faceAngle); // roof edge
  // front face is local +z
  const c = Math.cos(faceAngle), s = Math.sin(faceAngle);
  const P = (lx, ly, lz) => [x + lx * c + lz * s, 0.06 + ly, z - lx * s + lz * c];
  const fz = d / 2 + 0.03;
  const cw = w / cols, fh = (hgt - 0.6) / floors;
  for (let f = 0; f < floors; f++) {
    for (let k = 0; k < cols; k++) {
      const lx = -w / 2 + cw * (k + 0.5);
      if (f === 0 && k === Math.floor(cols / 2)) {
        // door, with a light frame round it so it reads without colour
        bld.quad(P(lx - 0.75, 0, fz), P(lx + 0.75, 0, fz), P(lx + 0.75, 2.5, fz), P(lx - 0.75, 2.5, fz), C.frame);
        bld.quad(P(lx - 0.6, 0, fz + 0.01), P(lx + 0.6, 0, fz + 0.01), P(lx + 0.6, 2.35, fz + 0.01), P(lx - 0.6, 2.35, fz + 0.01), C.door);
        continue;
      }
      const y0 = 0.6 + f * fh + fh * 0.25, y1 = y0 + fh * 0.5;
      const hw = Math.min(0.8, cw * 0.32);
      bld.quad(P(lx - hw - 0.12, y0 - 0.12, fz), P(lx + hw + 0.12, y0 - 0.12, fz), P(lx + hw + 0.12, y1 + 0.12, fz), P(lx - hw - 0.12, y1 + 0.12, fz), C.frame);
      bld.quad(P(lx - hw, y0, fz + 0.01), P(lx + hw, y0, fz + 0.01), P(lx + hw, y1, fz + 0.01), P(lx - hw, y1, fz + 0.01), C.window);
    }
  }
}

/** Street lamp: pole, arm over the road, head with a pale lamp under it. */
function lamp(bld, x, z, ry) {
  bld.box(x, 0.06, z, 0.16, 5.4, 0.16, C.pole, ry);
  const c = Math.cos(ry), s = Math.sin(ry);
  const ax = x + s * 0.8, az = z + c * 0.8;
  bld.box(ax, 5.25, az, 0.1, 0.1, 1.7, C.pole, ry);
  const hx = x + s * 1.6, hz = z + c * 1.6;
  bld.box(hx, 5.0, hz, 0.35, 0.28, 0.6, C.lampHead, ry);
  bld.box(hx, 4.96, hz, 0.25, 0.04, 0.45, C.lampGlow, ry);
}

/** Striped barrier across the street where the loop ends, so the edge reads as an edge. */
function barrier(bld, x, z0, z1) {
  const len = z1 - z0;
  bld.box(x, 0, z0 + 0.3, 0.12, 1.1, 0.12, C.white);
  bld.box(x, 0, z1 - 0.3, 0.12, 1.1, 0.12, C.white);
  bld.box(x, 0, (z0 + z1) / 2, 0.12, 1.1, 0.12, C.white);
  const n = Math.round(len / 0.9);
  for (let i = 0; i < n; i++) {
    const za = z0 + len * i / n, zb = z0 + len * (i + 1) / n;
    bld.box(x, 0.65, (za + zb) / 2, 0.08, 0.35, zb - za, i % 2 ? C.white : C.coral);
  }
}

/** One low-poly tree (trunk and two leaf blobs), to be instanced. */
function treeGeometry() {
  const bld = new Builder();
  bld.box(0, 0, 0, 0.3, 1.6, 0.3, C.trunk);
  // leaf blob: a six-sided double cone, low-poly like the hub's trees
  const add = (ox, oy, oz, r, hgt, col) => {
    const ring = [];
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; ring.push([ox + Math.cos(a) * r, oy, oz + Math.sin(a) * r]); }
    const top = [ox, oy + hgt * 0.6, oz], bot = [ox, oy - hgt * 0.4, oz];
    for (let k = 0; k < 6; k++) {
      const p0 = ring[k], p1 = ring[(k + 1) % 6];
      bld.tri(p1, p0, top, col);
      bld.tri(p0, p1, bot, col);
    }
  };
  add(0, 2.7, 0, 1.6, 2.6, C.leaf);
  add(0.35, 3.6, -0.2, 1.05, 1.8, C.leafDark);
  return bld.geometry();
}

/**
 * Build the loop. Returns the group to add to the scene, a dispose function and counts.
 */
export function buildWorld() {
  const group = new THREE.Group();
  group.name = 'drive_world';
  const flat = new Builder();
  const raised = new Builder();

  // ---- road surface of the side roads and the back road
  loopRibbon(flat);
  // the street-side corners are square (the street carries on), so fill past the curve
  for (const sgn of [1, -1]) {
    const a = sgn * INNER.maxX, b = sgn * OUTER.maxX;
    flat.flat(Math.min(a, b), INNER.maxZ - INNER.r, Math.max(a, b), -9.3, LOOP_Y, C.asphalt);
  }
  // a short ramp from the street up over the hub's far kerb into each side road
  for (const sgn of [1, -1]) {
    const xa = sgn * (INNER.maxX - INNER.r), xb = sgn * OUTER.maxX;
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb);
    flat.quad([x0, 0.005, -8.45], [x1, 0.005, -8.45], [x1, LOOP_Y, -8.95], [x0, LOOP_Y, -8.95], C.asphalt);
    flat.flat(x0, -9.35, x1, -8.95, LOOP_Y, C.asphalt);
  }

  // ---- kerbs and walks along both edges of the loop (the street keeps its own)
  const outerPath = edgePath(OUTER, OUTER.rBack, 0, -8.85);
  const innerPath = edgePath(INNER, INNER.r, INNER.r, -8.85);
  kerb(raised, outerPath, 0, 0.25, LOOP_Y - 0.02, LOOP_Y + 0.07, C.kerb);
  kerb(raised, innerPath, 0, -0.25, LOOP_Y - 0.02, LOOP_Y + 0.07, C.kerb);
  strip(flat, outerPath.filter((p) => p.z < -11.1), 0.25, 3.6, 0.078, C.walk);
  strip(flat, innerPath.filter((p) => p.z < -11.1), -0.25, -2.6, 0.078, C.walk);

  // ---- lawns where the hub only has bare ground now the backdrop cards are gone
  for (const sgn of [1, -1]) {
    const a = sgn * 45, b = sgn * (INNER.maxX - 2.6);
    flat.flat(Math.min(a, b), -30, Math.max(a, b), -16, 0.072, C.grass);
    const c = sgn * (OUTER.maxX + 3.6), d = sgn * 170;
    flat.flat(Math.min(c, d), -30, Math.max(c, d), -16, 0.072, C.grass);
  }

  // ---- dashed middle line round the loop (the street already has its yellow line)
  const mid = centreline(1).filter((p) => p.z < -10.5);
  for (let i = 0; i + 3 < mid.length; i += 6) {
    const a = mid[i], b = mid[i + 3];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * 0.08, nz = dx / l * 0.08;
    if (Math.hypot(dx, dz) > 4) continue; // skip across the wrap-around
    flat.quad([a.x - nx, LOOP_Y + 0.008, a.z - nz], [b.x - nx, LOOP_Y + 0.008, b.z - nz], [b.x + nx, LOOP_Y + 0.008, b.z + nz], [a.x + nx, LOOP_Y + 0.008, a.z + nz], C.yellow);
    flat.quad([a.x + nx, LOOP_Y + 0.008, a.z + nz], [b.x + nx, LOOP_Y + 0.008, b.z + nz], [b.x - nx, LOOP_Y + 0.008, b.z - nz], [a.x - nx, LOOP_Y + 0.008, a.z - nz], C.yellow);
  }

  // ---- buildings outside the loop, facing the road
  let w = 0;
  const wall = () => WALLS[(w++) % WALLS.length];
  const east = OUTER.maxX + 3.6 + 4;     // set back behind the walk
  for (const [z, d, hgt] of [[-17, 11, 8], [-30, 12, 11], [-43, 10, 7]]) {
    building(raised, east + 6, z, d, 11, hgt, -Math.PI / 2, wall(), hgt > 9 ? 3 : 2, 4);
    building(raised, -(east + 6), z - 2, d, 11, hgt + 1, Math.PI / 2, wall(), hgt > 8 ? 3 : 2, 4);
  }
  const back = OUTER.minZ - 3.6 - 4;
  for (const [x, wd, hgt] of [[-48, 14, 9], [-28, 12, 7], [-10, 16, 12], [10, 12, 8], [28, 14, 10], [48, 12, 7]]) {
    building(raised, x, back - 6, wd, 11, hgt, 0, wall(), hgt > 9 ? 3 : 2, Math.round(wd / 3.5));
  }
  // in place of the flat row-house cards behind the plaza: a row of low buildings across the lawn
  for (const [x, wd, hgt] of [[-36, 12, 8], [-20, 14, 10], [-6, 10, 7], [26, 12, 9], [42, 14, 8], [57, 11, 10]]) {
    building(raised, x, 50, wd, 10, hgt, Math.PI, wall(), hgt > 8 ? 3 : 2, Math.round(wd / 3.5));
  }
  for (const [x, z, wd, hgt] of [[-60, 50, 12, 9], [72, 50, 12, 8]]) building(raised, x, z, wd, 10, hgt, Math.PI, wall(), 2, 3);
  // corner blocks beside the far ends of the loop (where the cards stood)
  for (const sgn of [1, -1]) building(raised, sgn * (east + 7), -60, 12, 12, 9, sgn > 0 ? -Math.PI / 2 : Math.PI / 2, wall(), 2, 3);

  // ---- lamps along the outer walk, arms over the road
  for (const z of [-14, -32, -50]) {
    lamp(raised, OUTER.maxX + 0.9, z, -Math.PI / 2);
    lamp(raised, OUTER.minX - 0.9, z, Math.PI / 2);
  }
  for (const x of [-48, -24, 0, 24, 48]) lamp(raised, x, OUTER.minZ - 0.9, 0);

  // ---- barriers across the street at both ends of the loop
  barrier(raised, OUTER.maxX + 1.2, -8.5, 1.5);
  barrier(raised, OUTER.minX - 1.2, -8.5, 1.5);

  // ---- trees: outside the walks, and on the block lawns well back from the kerb
  const trees = [];
  for (const z of [-22, -38, -54]) { trees.push([OUTER.maxX + 5.2, z], [OUTER.minX - 5.2, z]); }
  for (const x of [-60, -36, -12, 14, 38, 60]) trees.push([x, OUTER.minZ - 5.2]);
  for (const z of [-33, -42]) { trees.push([INNER.maxX - 5.5, z], [INNER.minX + 5.5, z]); }
  for (const x of [-40, -20, 0, 20, 40]) trees.push([x, INNER.minZ + 5.5]);
  for (const x of [-78, 78, -95, 95]) trees.push([x, 22]);
  const treeGeo = treeGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const flatMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const treeMesh = new THREE.InstancedMesh(treeGeo, mat, trees.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  trees.forEach(([x, z], i) => {
    const k = 0.85 + ((i * 37) % 10) / 30;
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 1.7);
    m.compose(p.set(x, 0.07, z), q, sc.set(k, k, k));
    treeMesh.setMatrixAt(i, m);
  });
  treeMesh.computeBoundingSphere();
  treeMesh.name = 'drive_trees';

  const flatMesh = new THREE.Mesh(flat.geometry(), flatMat);
  flatMesh.name = 'drive_ground';
  flatMesh.renderOrder = -1;
  const raisedMesh = new THREE.Mesh(raised.geometry(), mat);
  raisedMesh.name = 'drive_raised';
  for (const o of [flatMesh, raisedMesh, treeMesh]) { o.matrixAutoUpdate = false; o.updateMatrix(); group.add(o); }

  const triangles = flat.triangles + raised.triangles + (treeGeo.attributes.position.count / 3) * trees.length;
  return {
    group,
    triangles,
    drawCalls: 3,
    dispose() {
      group.removeFromParent();
      flatMesh.geometry.dispose(); raisedMesh.geometry.dispose(); treeGeo.dispose();
      treeMesh.dispose();
      mat.dispose(); flatMat.dispose();
    },
  };
}
