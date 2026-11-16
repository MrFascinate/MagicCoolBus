import { describe, it, expect } from 'vitest';
import { LEVELS } from '../src/stations/drone/levels.js';
import { runProgram, countBlocks, flatten, missMessage } from '../src/stations/drone/interpreter.js';
import { starsFor, bestStars } from '../src/stations/drone/stars.js';
import { solve, programsOfSize } from '../src/stations/drone/solver.js';
import { runProgram as run } from '../src/stations/drone/interpreter.js';

let n = 0;
const P = (...types) => types.map((t) => (typeof t === 'string' ? { id: `b${n++}`, type: t } : t));
const R = (count, ...body) => ({ id: `b${n++}`, type: 'repeat', count, body: P(...body) });
const [L1, L2, L3] = LEVELS;

describe('interpreter', () => {
  it('clears level 1 with the straight program', () => {
    const r = runProgram(P('takeoff', 'forward', 'forward', 'forward', 'land'), L1);
    expect(r.cleared).toBe(true);
    expect(r.blocks).toBe(5);
    expect(r.steps.at(-1)).toMatchObject({ c: 2, r: 1, flying: false, event: 'land' });
  });

  it('flags Forward on the ground and marks that block', () => {
    const prog = P('forward', 'takeoff', 'land');
    const r = runProgram(prog, L1);
    expect(r).toMatchObject({ cleared: false, reason: 'ground', failId: prog[0].id });
  });

  it('flags flying into the net at the block that did it', () => {
    const prog = P('takeoff', 'forward', 'forward', 'forward', 'forward', 'forward', 'land');
    const r = runProgram(prog, L1);
    expect(r.reason).toBe('net');
    expect(r.failId).toBe(prog[5].id); // 5th forward leaves row 0
  });

  it('flags a program that ends in the air at its last block', () => {
    const prog = P('takeoff', 'forward');
    const r = runProgram(prog, L1);
    expect(r).toMatchObject({ reason: 'air', failId: prog[1].id });
  });

  it('flags landing off the pad at the Land block', () => {
    const prog = P('takeoff', 'forward', 'land', 'right');
    const r = runProgram(prog, L1);
    expect(r).toMatchObject({ reason: 'offPad', failId: prog[2].id });
  });

  it('flags an empty program and a program that never takes off', () => {
    expect(runProgram([], L1).reason).toBe('empty');
    const prog = P('left', 'right');
    expect(runProgram(prog, L1)).toMatchObject({ reason: 'noFlight', failId: prog[1].id });
  });

  it('turns are relative to the facing direction', () => {
    const r = runProgram(P('takeoff', 'forward', 'forward', 'right', 'forward', 'forward', 'land'), L2);
    expect(r.cleared).toBe(true);
    const wrong = runProgram(P('takeoff', 'forward', 'forward', 'left', 'forward', 'forward', 'land'), L2);
    expect(wrong.reason).toBe('offPad');
    expect(wrong.steps.at(-1)).toMatchObject({ c: 0, r: 2 });
  });

  it('expands Repeat and counts it as one block plus its body', () => {
    const prog = P('takeoff', R(3, 'forward', 'forward', 'right'), 'land');
    expect(countBlocks(prog)).toBe(6);
    expect(flatten(prog).length).toBe(11);
    const r = runProgram(prog, L3);
    expect(r.cleared).toBe(true);
    expect(r.touched).toBe(true);
  });

  it('level 3 needs the drone to fly over Pad 2 first', () => {
    // Reach Pad 3 by going right first, then down, never touching Pad 2.
    const prog = P('takeoff', 'right', 'forward', 'forward', 'land');
    const r = runProgram(prog, L3);
    expect(r).toMatchObject({ cleared: false, reason: 'missedTouch', failId: prog[4].id });
  });

  it('a highlighted step id exists for every executed block', () => {
    const prog = P('takeoff', R(2, 'forward'), 'land');
    const r = runProgram(prog, L1);
    const ids = new Set([prog[0].id, prog[1].body[0].id, prog[2].id]);
    for (const s of r.steps) expect(ids.has(s.id)).toBe(true);
  });

  it('every miss reason has a message without em dashes', () => {
    for (const reason of ['empty', 'ground', 'net', 'air', 'noFlight', 'offPad', 'missedTouch']) {
      const m = missMessage(reason, L3);
      expect(m.length).toBeGreaterThan(10);
      expect(m).not.toMatch(/—/);
    }
  });
});

describe('stars', () => {
  it('gives 0 for a miss and 1, 2, 3 by the rules', () => {
    expect(starsFor({ cleared: false, blocks: 3 }, L1).stars).toBe(0);
    expect(starsFor({ cleared: true, blocks: 9 }, L1).stars).toBe(1);
    expect(starsFor({ cleared: true, blocks: 6 }, L1).stars).toBe(2);
    expect(starsFor({ cleared: true, blocks: 5 }, L1).stars).toBe(3);
  });
  it('keeps the best run, so a retry never costs a star', () => {
    expect(bestStars(3, 1)).toBe(3);
    expect(bestStars(1, 2)).toBe(2);
    expect(bestStars(undefined, 0)).toBe(0);
  });
});

describe('solver', () => {
  for (const level of LEVELS) {
    it(`level ${level.id} is solvable and its stored shortest length (${level.shortest}) is right`, () => {
      const s = solve(level, { maxBlocks: level.limit });
      expect(s).not.toBeNull();
      expect(s.size).toBe(level.shortest);
      expect(level.shortest).toBeLessThanOrEqual(level.limit);
      // The found program really clears the level.
      expect(run(s.program, level).cleared).toBe(true);
    });
  }

  it('level 3 cannot be done within the block limit without a loop', () => {
    const s = solve(L3, { maxBlocks: L3.limit, allowRepeat: false });
    expect(s).toBeNull();
  });

  it('enumerates programs of a given size', () => {
    let count = 0;
    for (const p of programsOfSize(2, { allowRepeat: false })) { count++; expect(countBlocks(p)).toBe(2); }
    expect(count).toBe(25);
    for (const p of programsOfSize(3, { allowRepeat: true })) expect(countBlocks(p)).toBe(3);
  });
});
