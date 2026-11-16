import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEVELS, LIMIT_MARGIN, PARTS, BINS, STAMP_SKILL } from '../../src/stations/robot/levels.js';
import { runProgram, missMessage, initialState, applyMove, blocked } from '../../src/stations/robot/interpreter.js';
import { solve, toProgram } from '../../src/stations/robot/solver.js';
import { starsFor } from '../../src/stations/robot/stars.js';
import { solveIK, fingertip, REST_DEG, ARM, HEIGHTS, CARRY_R, maxReach, sweep } from '../../src/stations/robot/arm.js';
import { readGlbJson, nodeWorldMatrices } from '../../src/lib/glbJson.js';

const prog = (...types) => types.map((type, i) => ({ id: `b${i}`, type }));
const deg = (r) => (r * 180) / Math.PI;

describe('Robot Relay levels', () => {
  it('has three levels with stored shortest programs that the solver confirms', () => {
    expect(LEVELS.map((l) => l.id)).toEqual([1, 2, 3]);
    for (const l of LEVELS) {
      const s = solve(l);
      expect(s, `level ${l.id} solvable`).not.toBeNull();
      expect(s.size, `level ${l.id} shortest`).toBe(l.shortest);
      // the solver's program really clears the level
      const r = runProgram(toProgram(s.moves), l);
      expect(r.cleared).toBe(true);
      expect(r.blocks).toBe(l.shortest);
      // and it fits the move budget
      expect(s.size).toBeLessThanOrEqual(l.limit);
    }
  });

  it('sets each move budget to the brief: shortest plus 2, 4, 4', () => {
    for (const l of LEVELS) expect(l.limit).toBe(l.shortest + LIMIT_MARGIN[l.id]);
  });

  it('every part has a matching bin, and later levels sort two different shapes', () => {
    for (const l of LEVELS) {
      for (const p of l.parts) expect(l.bins).toContain(PARTS[p].bin);
      expect(new Set(l.bins).size).toBe(3);
    }
    expect(new Set(LEVELS[1].parts).size).toBe(2);
    expect(new Set(LEVELS[2].parts).size).toBe(2);
  });

  it('keeps levels short (60 to 90 seconds) and rising in difficulty', () => {
    expect(LEVELS.map((l) => l.shortest)).toEqual([6, 11, 13]);
    expect(LEVELS[1].shortest).toBeGreaterThan(LEVELS[0].shortest);
    expect(LEVELS[2].shortest).toBeGreaterThan(LEVELS[1].shortest);
  });

  it('level 3 uses the barrier, and the barrier makes the shortest program longer', () => {
    expect(LEVELS[2].barrier).toBe(true);
    expect(LEVELS[0].barrier || LEVELS[1].barrier).toBe(false);
    const open = solve({ ...LEVELS[2], barrier: false });
    expect(open.size).toBeLessThan(LEVELS[2].shortest);
  });

  it('every bin and part differs by shape as well as colour', () => {
    const icons = Object.values(BINS).map((b) => b.icon);
    expect(new Set(icons).size).toBe(3);
    for (const p of Object.values(PARTS)) expect(BINS[p.bin].color).toBe(p.color);
  });

  it('names the skill in the stamp', () => {
    expect(STAMP_SKILL).toBe("Planned a robot's moves");
  });
});

describe('Robot Relay rules', () => {
  const L1 = LEVELS[0];
  it('clears level 1 with the shortest program', () => {
    const r = runProgram(prog('reach', 'grip', 'right', 'right', 'reach', 'release'), L1);
    expect(r.cleared).toBe(true);
    expect(r.blocks).toBe(6);
  });

  it('a part in the wrong bin bounces back to the tray and marks that move', () => {
    const p = prog('reach', 'grip', 'right', 'reach', 'release');
    const r = runProgram(p, L1);
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe('wrong-bin');
    expect(r.failId).toBe('b4');
    expect(r.final.tray).toEqual(['prism']);
    expect(r.steps.at(-1).event).toBe('bounce');
    expect(missMessage(r, L1)).toMatch(/triangle icon/);
  });

  it('stops at the barrier and marks the turn', () => {
    const L3 = LEVELS[2];
    expect(blocked(L3, 0, 3)).toBe(true);
    expect(blocked(L3, 3, 0)).toBe(true);
    expect(blocked(L3, 1, 2)).toBe(false);
    const r = runProgram(prog('reach', 'grip', 'left', 'reach', 'release'), L3);
    expect(r.reason).toBe('barrier');
    expect(r.failId).toBe('b2');
    expect(r.final.stop).toBe(0);
    expect(r.steps.at(-1).event).toBe('bump');
  });

  it('turning wraps round the ring when there is no barrier', () => {
    const s = initialState(LEVELS[1]);
    expect(applyMove(s, 'left', LEVELS[1]).ok).toBe(true);
    expect(s.stop).toBe(3);
    applyMove(s, 'right', LEVELS[1]);
    expect(s.stop).toBe(0);
  });

  it('explains every kind of miss', () => {
    const cases = [
      [prog('grip'), 'grip-up'],
      [prog('release'), 'release-up'],
      [prog('reach', 'reach'), 'already-down'],
      [prog('reach', 'right'), 'down'],
      [prog('right', 'reach', 'grip'), 'grip-bin'],
      [prog('reach', 'release'), 'empty-hand'],
      [prog('reach', 'grip', 'reach', 'grip'), 'full'],
      [prog('reach', 'grip'), 'unfinished'],
      [[], 'empty'],
    ];
    for (const [p, reason] of cases) {
      const r = runProgram(p, L1);
      expect(r.reason, JSON.stringify(p.map((b) => b.type))).toBe(reason);
      const m = missMessage(r, L1);
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/—/); // no em dashes in copy
    }
    const t = runProgram(prog('reach', 'grip', 'right', 'right', 'reach', 'release', 'left', 'left', 'reach', 'grip'), L1);
    expect(t.reason).toBe('tray-empty');
  });

  it('putting a part back on the tray is allowed', () => {
    const r = runProgram(prog('reach', 'grip', 'reach', 'release', 'reach', 'grip', 'right', 'right', 'reach', 'release'), L1);
    expect(r.cleared).toBe(true);
  });

  it('stars: one for sorting, two within the budget, three for the shortest; misses get none', () => {
    const l = LEVELS[1];
    expect(starsFor({ cleared: true, blocks: 11 }, l).stars).toBe(3);
    expect(starsFor({ cleared: true, blocks: 15 }, l).stars).toBe(2);
    expect(starsFor({ cleared: true, blocks: 16 }, l).stars).toBe(1);
    expect(starsFor({ cleared: false, blocks: 5 }, l).stars).toBe(0);
  });
});

describe('Robot Relay arm', () => {
  it('IK reproduces the rest pose stored in robot.glb', () => {
    const q = { s: (REST_DEG.s * Math.PI) / 180, e: (REST_DEG.e * Math.PI) / 180, w: (REST_DEG.w * Math.PI) / 180 };
    const t = fingertip(q);
    const back = solveIK(t.r, t.y);
    expect(deg(back.s)).toBeCloseTo(REST_DEG.s, 3);
    expect(deg(back.e)).toBeCloseTo(REST_DEG.e, 3);
    expect(deg(back.w)).toBeCloseTo(REST_DEG.w, 3);
  });

  it('matches the joint layout in robot.glb', () => {
    const json = readGlbJson(new Uint8Array(readFileSync(new URL('../../public/assets/robot/robot.glb', import.meta.url))));
    const n = Object.fromEntries(json.nodes.map((x) => [x.name, x]));
    expect(n.arm_turret.translation[1] + n.arm_shoulder.translation[1]).toBeCloseTo(ARM.shoulderY, 3);
    expect(n.arm_elbow.translation[1]).toBeCloseTo(ARM.upper, 3);
    expect(n.arm_wrist.translation[1]).toBeCloseTo(ARM.fore, 3);
    expect(n.grip_L.translation[0]).toBeCloseTo(ARM.gripOpen, 3);
    // rest rotations are about X only
    const ang = (q) => deg(2 * Math.atan2(q[0], q[3]));
    expect(ang(n.arm_shoulder.rotation)).toBeCloseTo(REST_DEG.s, 0);
    expect(ang(n.arm_elbow.rotation)).toBeCloseTo(REST_DEG.e, 0);
    expect(ang(n.arm_wrist.rotation)).toBeCloseTo(REST_DEG.w, 0);
  });

  it('can reach every stop in the hub with the gripper pointing down', () => {
    const json = readGlbJson(new Uint8Array(readFileSync(new URL('../../public/assets/hub.glb', import.meta.url))));
    const nodes = nodeWorldMatrices(json);
    const p = (name) => { const m = nodes.get(name).world; return { x: m[12], y: m[13], z: m[14] }; };
    const base = p('arm_base');
    for (const name of ['bin_1', 'bin_2', 'bin_3']) {
      const b = p(name);
      const r = Math.hypot(b.x - base.x, b.z - base.z);
      expect(r, name).toBeLessThan(maxReach(HEIGHTS.binRelease));
      const q = solveIK(r, HEIGHTS.binRelease);
      const t = fingertip(q);
      expect(t.r).toBeCloseTo(r, 4);
      expect(t.y).toBeCloseTo(HEIGHTS.binRelease, 4);
    }
    const tray = p('part_tray');
    const rt = Math.hypot(tray.x - base.x, tray.z - base.z);
    expect(solveIK(rt, HEIGHTS.trayGrip)).not.toBeNull();
    expect(solveIK(CARRY_R, HEIGHTS.carry)).not.toBeNull();
  });

  it('turns the short way between neighbours and the long way round only past the ring end', () => {
    const yaws = [-2.45, -0.56, -0.05, 0.49];
    expect(sweep(yaws, 0, 1, 1)).toBeGreaterThan(0);
    expect(sweep(yaws, 1, 0, -1)).toBeLessThan(0);
    expect(sweep(yaws, 3, 0, 1)).toBeCloseTo(2 * Math.PI - (0.49 + 2.45), 5);
    expect(sweep(yaws, 0, 3, -1)).toBeCloseTo(-(2 * Math.PI - (0.49 + 2.45)), 5);
  });
});
