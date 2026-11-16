/**
 * Arcade driving for the bus. Pure maths, no three.js, no DOM.
 *
 * Heading h follows the three.js convention for a model that faces +Z:
 * forward is (sin h, cos h) in (x, z). h = PI/2 faces +X, east along the street.
 * A bicycle model turns the bus about its rear axles, so it swings like a bus.
 */
import { sd, gradient, groundHeight } from './track.js';

export const PARAMS = {
  maxForward: 8.33,      // m/s, about 30 km/h
  maxReverse: 3.0,       // m/s
  accel: 2.6,            // m/s^2 going forward
  reverseAccel: 1.8,
  brake: 7.0,            // m/s^2 with the brake or the opposite pedal
  coast: 1.4,            // m/s^2 with nothing pressed
  maxSteer: 0.62,        // radians at the front wheels when stopped (about 35 degrees)
  steerAtTopSpeed: 0.42, // share of maxSteer left at top speed
  steerRate: 1.8,        // radians per second the wheels turn toward the target
  steerReturn: 2.6,      // radians per second back to straight when nothing is pressed
  wheelbase: 6.65,       // front axle to the middle of the rear axles
  rearAxle: 2.96,        // rear axles behind the middle of the bus
  edgeSpeed: 2.5,        // most the bus may go while it rubs the edge
  edgeDrag: 4.0,         // how quickly the edge slows it
};

/** Circles that cover the bus body: offsets along the bus from its middle, and a shared radius. */
export const BODY = { offsets: [4.45, 1.5, -1.5, -4.45], radius: 1.32 };

/**
 * @typedef {{x:number, z:number, h:number, v:number, steer:number, y:number, touching:boolean}} BusState
 * @typedef {{throttle:number, steer:number, brake:boolean}} BusInput  throttle -1..1 (down to up), steer -1..1 (right to left)
 */

/** @returns {BusState} */
export function createBus(x, z, h) {
  return { x, z, h, v: 0, steer: 0, y: groundHeight(x, z), touching: false };
}

/** Most the front wheels may turn at speed v: less the faster the bus goes. */
export function maxSteerAt(v, p = PARAMS) {
  const k = Math.min(1, Math.abs(v) / p.maxForward);
  return p.maxSteer * (1 - (1 - p.steerAtTopSpeed) * k);
}

function approach(cur, target, rate) {
  if (cur < target) return Math.min(target, cur + rate);
  return Math.max(target, cur - rate);
}

/** Speed change for one step. */
export function nextSpeed(v, input, dt, p = PARAMS) {
  const t = Math.max(-1, Math.min(1, input.throttle || 0));
  if (input.brake) return approach(v, 0, p.brake * dt);
  if (t > 0) {
    if (v < -0.05) return approach(v, 0, p.brake * dt);
    return Math.min(p.maxForward, v + p.accel * t * dt);
  }
  if (t < 0) {
    if (v > 0.05) return approach(v, 0, p.brake * dt);
    return Math.max(-p.maxReverse, v + p.reverseAccel * t * dt);
  }
  return approach(v, 0, p.coast * dt);
}

const g = { x: 0, z: 0 };

/**
 * Keep every body circle on the road. Treats the bus as one rigid piece:
 * each circle that pokes off the road asks to be moved back in, and the bus
 * slides and turns as a whole to agree with all of them. Never a crash; it
 * just says whether the bus touched the edge.
 * @param {BusState} s
 */
export function keepOnRoad(s, iterations = 12) {
  let touched = false;
  let inertia = 0;
  for (const off of BODY.offsets) inertia += off * off;
  for (let it = 0; it < iterations; it++) {
    const fx = Math.sin(s.h), fz = Math.cos(s.h);
    let tx = 0, tz = 0, dh = 0, n = 0;
    for (const off of BODY.offsets) {
      const cx = s.x + fx * off, cz = s.z + fz * off;
      const d = sd(cx, cz) + BODY.radius;
      if (d > 0) {
        gradient(cx, cz, g);
        const px = -g.x * (d + 0.001), pz = -g.z * (d + 0.001);
        tx += px; tz += pz; n++;
        // turning by dh moves this circle along off * (cos h, -sin h)
        dh += off * (px * fz - pz * fx);
      }
    }
    if (!n) break;
    touched = true;
    s.x += tx / n; s.z += tz / n;
    s.h += dh / inertia;
  }
  return touched;
}

/**
 * Put a bus that starts anywhere (even across the road or inside the school
 * block) fully onto the road. Used when a drive starts.
 * @param {BusState} s
 */
export function settleBus(s) {
  for (let i = 0; i < 400; i++) {
    keepOnRoad(s, 4);
    if (overlap(s) <= 0.005) break;
    // exactly crosswise the pushes can cancel out: give it a small turn
    if (i % 20 === 19) s.h += 0.15;
  }
  s.y = groundHeight(s.x, s.z);
  return s;
}

/**
 * Advance the bus by dt seconds.
 * @param {BusState} s
 * @param {BusInput} input
 * @param {number} dt
 */
export function stepBus(s, input, dt, p = PARAMS) {
  dt = Math.min(dt, 0.1);
  s.v = nextSpeed(s.v, input, dt, p);
  const want = Math.max(-1, Math.min(1, input.steer || 0)) * maxSteerAt(s.v, p);
  s.steer = approach(s.steer, want, (input.steer ? p.steerRate : p.steerReturn) * dt);
  // bicycle model about the rear axles
  const fx = Math.sin(s.h), fz = Math.cos(s.h);
  let rx = s.x - fx * p.rearAxle, rz = s.z - fz * p.rearAxle;
  rx += fx * s.v * dt; rz += fz * s.v * dt;
  s.h += (s.v * Math.tan(s.steer) / p.wheelbase) * dt;
  s.x = rx + Math.sin(s.h) * p.rearAxle;
  s.z = rz + Math.cos(s.h) * p.rearAxle;
  s.touching = keepOnRoad(s);
  if (s.touching && overlap(s) > 0.01) {
    // wedged across the road (the pushes cancel out): turn it a little toward the road
    s.h += 0.03;
    keepOnRoad(s);
  }
  if (s.touching) {
    // rubbing the edge: slow down gently, never stop dead
    const cap = p.edgeSpeed;
    s.v *= Math.max(0, 1 - p.edgeDrag * dt);
    if (s.v > cap) s.v = cap; else if (s.v < -cap) s.v = -cap;
  }
  s.y = groundHeight(s.x, s.z);
  return s;
}

/** Largest overlap of the body with the off-road area (0 when fully on the road). */
export function overlap(s) {
  const fx = Math.sin(s.h), fz = Math.cos(s.h);
  let worst = 0;
  for (const off of BODY.offsets) worst = Math.max(worst, sd(s.x + fx * off, s.z + fz * off) + BODY.radius);
  return worst;
}
