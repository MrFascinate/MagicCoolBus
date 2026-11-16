/**
 * The drivable loop for Drive the Bus. Pure maths, no three.js.
 *
 * World units are metres in the hub's frame (three.js: x east along the
 * street, z toward the plaza, y up). The hub street runs along x with its
 * kerbs at z = 1.7 (plaza side) and z = -8.85 (school side). The loop adds a
 * road round the school block: east and west side roads and a back road,
 * all 10.6 m wide like the street, with rounded inside corners.
 *
 * The drivable area is the outer rounded rectangle minus the inner block.
 * sd(x, z) is a signed distance: negative on the road, positive off it.
 */

export const ROAD_WIDTH = 10.6;
/** Outer edge of the loop. The two corners on the street side are square (the street carries on). */
export const OUTER = { minX: -72.6, maxX: 72.6, minZ: -60.6, maxZ: 1.7, rBack: 16.6, rFront: 0 };
/** The block in the middle (school, lawns). Its corners are rounded so the bus can take them. */
export const INNER = { minX: -62, maxX: 62, minZ: -50, maxZ: -8.85, r: 6 };
/** Road surface height off the street: the hub's lawns sit at about 7 cm. */
export const LOOP_Y = 0.08;

/**
 * Signed distance to a rounded box. rTop applies to corners with z below the
 * centre (the back), rBottom to corners with z above it (the street side).
 */
function sdRoundBox(x, z, b, rBack, rFront) {
  const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
  const hx = (b.maxX - b.minX) / 2, hz = (b.maxZ - b.minZ) / 2;
  const px = x - cx, pz = z - cz;
  const r = pz < 0 ? rBack : rFront;
  const qx = Math.abs(px) - hx + r, qz = Math.abs(pz) - hz + r;
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qz, 0));
  return Math.min(Math.max(qx, qz), 0) + outside - r;
}

/** Distance from (x, z) to the edge of the road: negative on the road. */
export function sd(x, z) {
  const outer = sdRoundBox(x, z, OUTER, OUTER.rBack, OUTER.rFront);
  const inner = sdRoundBox(x, z, INNER, INNER.r, INNER.r);
  return Math.max(outer, -inner);
}

/** Unit vector pointing away from the road (the direction sd grows fastest). */
export function gradient(x, z, out = { x: 0, z: 0 }) {
  const e = 0.01;
  let gx = sd(x + e, z) - sd(x - e, z);
  let gz = sd(x, z + e) - sd(x, z - e);
  const len = Math.hypot(gx, gz);
  if (len < 1e-9) {
    // flat spot (deep inside the block or far outside): push toward the nearest road line
    gx = 0; gz = 0;
    const toward = [
      [x - INNER.minX, -1, 0], [INNER.maxX - x, 1, 0], [z - INNER.minZ, 0, -1], [INNER.maxZ - z, 0, 1],
    ].sort((a, b) => a[0] - b[0])[0];
    out.x = -toward[1]; out.z = -toward[2];
    return out;
  }
  out.x = gx / len; out.z = gz / len;
  return out;
}

/** Height of the road surface: the street is at 0, the new loop sits on the lawns. */
export function groundHeight(x, z) {
  if (z >= -8.5) return 0;
  if (z <= -9.5) return LOOP_Y;
  const t = (-8.5 - z) / 1;
  return LOOP_Y * t * t * (3 - 2 * t);
}

/**
 * The middle of the loop as a closed polyline, driven anticlockwise seen from
 * above (east along the street, then up the east road, west along the back,
 * down the west road). Used for tests and for the camera's safe zone.
 * @param {number} [step] spacing of points in metres
 */
export function centreline(step = 2) {
  const midStreetZ = (OUTER.maxZ + INNER.maxZ) / 2;          // -3.575
  const eastX = (OUTER.maxX + INNER.maxX) / 2;                // 67.3
  const backZ = (OUTER.minZ + INNER.minZ) / 2;                // -55.3
  const rc = INNER.r + ROAD_WIDTH / 2;                         // corner radius of the middle line
  const pts = [];
  const line = (ax, az, bx, bz) => {
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / step));
    for (let i = 0; i < n; i++) pts.push({ x: ax + (bx - ax) * i / n, z: az + (bz - az) * i / n });
  };
  const arc = (cx, cz, a0, a1) => {
    const n = Math.max(2, Math.round(Math.abs(a1 - a0) * rc / step));
    for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push({ x: cx + Math.cos(a) * rc, z: cz + Math.sin(a) * rc }); }
  };
  const ix0 = INNER.minX + INNER.r, ix1 = INNER.maxX - INNER.r;
  const iz0 = INNER.minZ + INNER.r, iz1 = INNER.maxZ - INNER.r;
  // street, heading east, to the south-east inside corner
  line(-ix1, midStreetZ, ix1, midStreetZ);
  arc(ix1, iz1, Math.PI / 2, 0);                               // turn left, up the east road
  line(eastX, iz1, eastX, iz0);
  arc(ix1, iz0, 0, -Math.PI / 2);
  line(ix1, backZ, ix0, backZ);
  arc(ix0, iz0, -Math.PI / 2, -Math.PI);
  line(-eastX, iz0, -eastX, iz1);
  arc(ix0, iz1, Math.PI, Math.PI / 2);
  return pts;
}
