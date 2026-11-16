/**
 * Arm geometry for robot.glb, pure math (no three.js) so it can be tested.
 *
 * In the turret's frame the arm reaches along +Z. Shoulder, elbow and wrist
 * pitch about local X; positive leans forward. With the angles s, e, w the
 * upper arm points s from straight up, the forearm s + e, and the gripper
 * s + e + w. The gripper points straight down when s + e + w = 180 degrees.
 */

/** Measured from robot.glb node translations (metres). */
export const ARM = {
  shoulderY: 0.17,  // shoulder pivot above arm_root (turret 0.12 + shoulder 0.05)
  upper: 0.40,      // shoulder to elbow
  fore: 0.36,       // elbow to wrist
  tip: 0.223,       // wrist pivot to fingertip (grip node 0.153 + finger 0.07)
  gripOpen: 0.05,   // grip_L x when open (grip_R mirrors)
  gripClosed: 0.036,
};

/** Rest pose stored in the file, in degrees. */
export const REST_DEG = { s: 33.4, e: 87.6, w: 59.0 };

/**
 * Joint angles (radians) that put the fingertip at horizontal distance r
 * and height y from arm_root, gripper pointing straight down. Elbow-up
 * solution. Returns null when the point is out of reach.
 * @param {number} r @param {number} y @param {typeof ARM} [dims]
 */
export function solveIK(r, y, dims = ARM) {
  const wz = r, wy = y + dims.tip - dims.shoulderY;
  const d = Math.hypot(wz, wy);
  const L1 = dims.upper, L2 = dims.fore;
  if (d > L1 + L2 - 1e-6 || d < Math.abs(L1 - L2) + 1e-6) return null;
  const phi = Math.atan2(wz, wy);                                  // from vertical to the wrist
  const alpha = Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d));
  const gamma = Math.acos((L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2));
  const s = phi - alpha;
  const e = Math.PI - gamma;
  const w = Math.PI - s - e;
  return { s, e, w };
}

/**
 * Forward kinematics: fingertip position {r, y} for joint angles (radians).
 * @param {{s:number,e:number,w:number}} q @param {typeof ARM} [dims]
 */
export function fingertip(q, dims = ARM) {
  const a1 = q.s, a2 = q.s + q.e, a3 = q.s + q.e + q.w;
  return {
    r: dims.upper * Math.sin(a1) + dims.fore * Math.sin(a2) + dims.tip * Math.sin(a3),
    y: dims.shoulderY + dims.upper * Math.cos(a1) + dims.fore * Math.cos(a2) + dims.tip * Math.cos(a3),
  };
}

/** Elbow position {r, y}, for clearance checks. */
export function elbowPoint(q, dims = ARM) {
  return { r: dims.upper * Math.sin(q.s), y: dims.shoulderY + dims.upper * Math.cos(q.s) };
}

/** Largest fingertip distance that keeps the gripper down at height y. */
export function maxReach(y, dims = ARM) {
  const wy = y + dims.tip - dims.shoulderY;
  const L = dims.upper + dims.fore - 1e-4;
  return Math.abs(wy) >= L ? 0 : Math.sqrt(L * L - wy * wy);
}

/** Heights used by the station, metres above arm_root. */
export const HEIGHTS = {
  carry: 0.24,      // fingertip while turning
  trayGrip: 0.05,   // fingertip when gripping a part on the tray
  binRelease: 0.14, // fingertip just above a bin rim
};
/** Turning radius: the arm pulls in to this when it carries, so it can lift high enough. */
export const CARRY_R = 0.5;

/** Shortest signed angle from a to b (radians). */
export function angleDiff(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Yaw change for one Rotate move: always the way round that does not cross
 * the fifth stop, i.e. right = positive sweep from stop i to i+1 in the ring.
 * @param {number[]} yaws  stop yaws in ring order (radians), increasing when turning right
 * @param {number} from @param {number} to @param {number} dir +1 right, -1 left
 */
export function sweep(yaws, from, to, dir) {
  let d = yaws[to] - yaws[from];
  if (dir > 0) while (d <= 0) d += Math.PI * 2;
  else while (d >= 0) d -= Math.PI * 2;
  return d;
}
