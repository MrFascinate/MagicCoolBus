import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createBus, stepBus, settleBus, nextSpeed, maxSteerAt, overlap, PARAMS, BODY } from '../src/drive/physics.js';
import { sd, centreline, OUTER, INNER, groundHeight } from '../src/drive/track.js';
import { isDriveUnlocked, sanitize, defaults } from '../src/core/save.js';
import { readGlbJson } from '../src/lib/glbJson.js';

const DT = 1 / 30;
const run = (s, input, seconds) => { for (let t = 0; t < seconds; t += DT) stepBus(s, input, DT); return s; };
const START = () => createBus(0.06, 0, Math.PI / 2); // where the hub's bus is parked, facing east

describe('drive: speed', () => {
  it('speeds up smoothly and never passes about 30 km/h', () => {
    const s = START();
    stepBus(s, { throttle: 1, steer: 0 }, DT);
    expect(s.v).toBeGreaterThan(0);
    expect(s.v).toBeLessThan(0.2); // no jump to top speed
    let top = 0;
    for (let t = 0; t < 20; t += DT) { stepBus(s, { throttle: 1, steer: 0 }, DT); top = Math.max(top, s.v); }
    expect(top).toBeLessThanOrEqual(PARAMS.maxForward + 1e-9);
    expect(top * 3.6).toBeGreaterThan(25);
    expect(top * 3.6).toBeLessThanOrEqual(30.1);
  });
  it('slows to a stop on its own and faster with the brake', () => {
    const coast = nextSpeed(8, { throttle: 0, steer: 0 }, 1);
    const brake = nextSpeed(8, { throttle: 0, steer: 0, brake: true }, 1);
    expect(coast).toBeLessThan(8);
    expect(brake).toBeLessThan(coast);
    expect(nextSpeed(0.5, { throttle: 0, steer: 0, brake: true }, 1)).toBe(0);
    expect(nextSpeed(0, { throttle: 0, steer: 0 }, 1)).toBe(0);
  });
});

describe('drive: reverse', () => {
  it('down from a stop backs up slowly, and down while moving brakes first', () => {
    const s = START();
    const x0 = s.x;
    run(s, { throttle: -1, steer: 0 }, 6);
    expect(s.v).toBeLessThan(0);
    expect(s.v).toBeGreaterThanOrEqual(-PARAMS.maxReverse - 1e-9);
    expect(s.x).toBeLessThan(x0 - 3); // facing east, so backing up goes west
    expect(nextSpeed(5, { throttle: -1, steer: 0 }, 0.1)).toBeGreaterThan(0); // still slowing, not reversing yet
  });
});

describe('drive: steering', () => {
  it('turns the wheels less the faster the bus goes', () => {
    expect(maxSteerAt(0)).toBeCloseTo(PARAMS.maxSteer);
    expect(maxSteerAt(PARAMS.maxForward)).toBeCloseTo(PARAMS.maxSteer * PARAMS.steerAtTopSpeed);
    expect(maxSteerAt(4)).toBeLessThan(maxSteerAt(1));
  });
  it('left turns a bus heading east toward the school (negative z), and turns ease in', () => {
    const s = START();
    run(s, { throttle: 1, steer: 0 }, 2);
    stepBus(s, { throttle: 1, steer: 1 }, DT);
    expect(s.steer).toBeGreaterThan(0);
    expect(s.steer).toBeLessThan(0.1);
    run(s, { throttle: 1, steer: 1 }, 1.5);
    expect(s.h).toBeGreaterThan(Math.PI / 2);
  });
  it('turning circle is tight enough for the corners', () => {
    const R = PARAMS.wheelbase / Math.tan(PARAMS.maxSteer);
    expect(R).toBeLessThan(INNER.r + 10.6 / 2); // smaller than the corner radius of the middle of the road
  });
});

describe('drive: the road', () => {
  it('the parked bus starts fully on the road', () => {
    expect(overlap(START())).toBeLessThanOrEqual(0);
  });
  it('the middle of the loop is all road with room for the bus', () => {
    for (const p of centreline(1)) expect(sd(p.x, p.z)).toBeLessThan(-BODY.radius);
  });
  it('the school and the plaza are off the road', () => {
    expect(sd(0, -25)).toBeGreaterThan(0);     // school
    expect(sd(0, 8)).toBeGreaterThan(0);       // plaza
    expect(sd(120, -3)).toBeGreaterThan(0);    // the street past the barrier
  });
  it('road height: street at 0, loop on the lawns, smooth between', () => {
    expect(groundHeight(0, 0)).toBe(0);
    expect(groundHeight(67, -30)).toBeGreaterThan(0.05);
    const a = groundHeight(67, -9), b = groundHeight(67, -9.05);
    expect(Math.abs(a - b)).toBeLessThan(0.01);
  });

  it('stays on the road from any start with any driving, nudged back at the edges', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let touchedSomewhere = false;
    for (let trial = 0; trial < 60; trial++) {
      // start anywhere, on or off the road, even inside the school or out on the lawns
      const s = settleBus(createBus(-90 + rnd() * 180, -75 + rnd() * 90, rnd() * Math.PI * 2));
      expect(overlap(s)).toBeLessThan(0.02);
      let input = { throttle: 1, steer: 0, brake: false };
      for (let i = 0; i < 900; i++) {
        if (i % 45 === 0) input = { throttle: rnd() < 0.75 ? 1 : -1, steer: Math.round(rnd() * 2 - 1), brake: rnd() < 0.05 };
        stepBus(s, input, DT);
        if (s.touching) touchedSomewhere = true;
        expect(overlap(s)).toBeLessThan(0.02);
        expect(Number.isFinite(s.x) && Number.isFinite(s.z) && Number.isFinite(s.h)).toBe(true);
      }
    }
    expect(touchedSomewhere).toBe(true);
  });

  it('driving into the edge slows the bus but never stops the game', () => {
    const s = START();
    run(s, { throttle: 1, steer: 0 }, 4);
    // steer hard right into the plaza kerb
    let touched = false;
    for (let t = 0; t < 4; t += DT) { stepBus(s, { throttle: 1, steer: -1 }, DT); if (s.touching) { touched = true; break; } }
    expect(touched).toBe(true);
    expect(Math.abs(s.v)).toBeLessThanOrEqual(PARAMS.edgeSpeed + 1e-9);
    // it can still drive away
    run(s, { throttle: 1, steer: 1 }, 3);
    expect(overlap(s)).toBeLessThan(0.02);
  });

  it('a simple driver following the middle line gets all the way round, corners included', () => {
    const line = centreline(1);
    const s = START();
    let idx = 0;
    for (let i = 1; i < line.length; i++) if (Math.hypot(line[i].x - s.x, line[i].z - s.z) < Math.hypot(line[idx].x - s.x, line[idx].z - s.z)) idx = i;
    let progress = 0;
    for (let t = 0; t < 120 && progress < line.length; t += DT) {
      // pure pursuit on a point 9 m ahead
      let k = idx;
      while (Math.hypot(line[k % line.length].x - s.x, line[k % line.length].z - s.z) < 9) k++;
      progress += k - idx; idx = k - 1;
      const tg = line[k % line.length];
      const want = Math.atan2(tg.x - s.x, tg.z - s.z);
      let diff = want - s.h; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      const slow = Math.abs(diff) > 0.25;
      stepBus(s, { throttle: slow && s.v > 5 ? 0 : 1, steer: Math.max(-1, Math.min(1, diff * 3)), brake: false }, DT);
      expect(overlap(s)).toBeLessThan(0.02);
    }
    expect(progress).toBeGreaterThanOrEqual(line.length);
  });
});

describe('drive: unlock', () => {
  it('is hidden before the badge is built and shown after', () => {
    expect(isDriveUnlocked(defaults())).toBe(false);
    const half = sanitize({ badge: { code: 'MCB-1', design: {}, done: false } });
    expect(isDriveUnlocked(half)).toBe(false);
    const done = sanitize({ badge: { code: 'MCB-2ZJDTHZC', design: { shape: 'shield' }, done: true } });
    expect(isDriveUnlocked(done)).toBe(true);
    expect(isDriveUnlocked(sanitize({ badge: 'junk' }))).toBe(false);
  });
});

describe('drive: bus_closed.glb', () => {
  const json = readGlbJson(new Uint8Array(readFileSync('public/assets/drive/bus_closed.glb')));
  it('has the six wheels as separate named nodes, and nothing else moving', () => {
    const names = json.nodes.map((n) => n.name);
    for (const w of ['wheel_front_left', 'wheel_front_right', 'wheel_rear_left_a', 'wheel_rear_left_b', 'wheel_rear_right_a', 'wheel_rear_right_b']) {
      const n = json.nodes.find((x) => x.name === w);
      expect(n, w).toBeTruthy();
      expect(n.mesh).toBeTypeOf('number');
      expect(n.translation[1]).toBeGreaterThan(0.4); // wheel centre about one radius up
    }
    expect(names).toContain('bus_body');
    expect(json.animations || []).toHaveLength(0);
    expect(json.cameras || []).toHaveLength(0);
    expect(json.extensionsUsed || []).toContain('KHR_draco_mesh_compression');
    expect(JSON.stringify(json.extensions || {})).not.toMatch(/KHR_lights/);
  });
  it('front wheels sit ahead of the middle (the bus faces +Z), ground at y = 0', () => {
    const z = (n) => json.nodes.find((x) => x.name === n).translation[2];
    expect(z('wheel_front_left')).toBeGreaterThan(2);
    expect(z('wheel_rear_left_a')).toBeLessThan(-1);
    const body = json.nodes.find((x) => x.name === 'bus_body');
    const acc = json.accessors[json.meshes[body.mesh].primitives[0].attributes.POSITION];
    expect(Math.abs(acc.min[1])).toBeLessThan(0.6);
  });
  it('stays under about 40,000 triangles, plain colours only, no sponsor signs', () => {
    let tris = 0;
    for (const m of json.meshes) for (const p of m.primitives) tris += json.accessors[p.indices].count / 3;
    expect(tris).toBeLessThanOrEqual(40000);
    expect(json.textures || []).toHaveLength(0);
    expect(json.images || []).toHaveLength(0);
    const all = JSON.stringify(json.nodes.map((n) => n.name)) + JSON.stringify(json.materials.map((m) => m.name));
    expect(all).not.toMatch(/SPZ|sponsor|your.?logo/i);
  });
});
