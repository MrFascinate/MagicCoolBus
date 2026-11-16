import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { PlayerController, WALK_SPEED, RUN_SPEED } from '../src/hub/player.js';
import { NavGrid } from '../src/hub/nav.js';
import { walkRate, WALK_CYCLE_M } from '../src/avatars/roster.js';
import { PLACEHOLDERS, buildPlaceholder, placeholderAnimator } from '../src/avatars/placeholder.js';

function openNav(size = 40) {
  return NavGrid.fromTriangles([0, 0, 0, size, 0, 0, size, 0, size, 0, 0, 0, size, 0, size, 0, 0, size], null, 0.25);
}
function fakeAvatar() {
  const a = { root: new THREE.Group(), clip: 'idle', speeds: [], play(n) { a.clip = n; }, update() {}, setSpeed(v) { a.speeds.push(v); } };
  return a;
}
const NONE = { x: 0, z: 0, run: false };

describe('movement speed', () => {
  it('walks about 60 percent faster than the old 2 m/s, and runs at twice the walk', () => {
    expect(WALK_SPEED).toBeCloseTo(3.2, 5);
    expect(WALK_SPEED / 2).toBeGreaterThan(1.55);
    expect(RUN_SPEED).toBeCloseTo(WALK_SPEED * 2, 5);
  });

  it('keyboard walks at walk speed, and Shift runs', () => {
    const av = fakeAvatar();
    const p = new PlayerController(av, openNav());
    p.place(5, 5, 0);
    p.update(0.5, { x: 1, z: 0, run: false });
    expect(p.position.x).toBeCloseTo(5 + WALK_SPEED * 0.5, 4);
    expect(p.speed).toBeCloseTo(WALK_SPEED);
    p.update(0.5, { x: 1, z: 0, run: true });
    expect(p.position.x).toBeCloseTo(5 + WALK_SPEED * 0.5 + RUN_SPEED * 0.5, 4);
    expect(p.speed).toBeCloseTo(RUN_SPEED);
    expect(av.clip).toBe('walk');
  });

  it('a single click walks, a double click runs, and arriving ends the run', () => {
    const p = new PlayerController(fakeAvatar(), openNav());
    p.place(1, 1, 0);
    p.walkTo(21, 1);
    p.update(1, NONE);
    expect(p.position.x).toBeCloseTo(1 + WALK_SPEED, 4);
    p.walkTo(21, 1, { run: true });
    p.update(1, NONE);
    expect(p.position.x).toBeCloseTo(1 + WALK_SPEED + RUN_SPEED, 4);
    for (let i = 0; i < 10; i++) p.update(1, NONE);
    expect(p.position.x).toBeCloseTo(21, 4);
    expect(p.pathRun).toBe(false);
    expect(p.speed).toBe(0);
  });

  it('the Run toggle makes every move run, keys and clicks alike', () => {
    const p = new PlayerController(fakeAvatar(), openNav());
    p.place(1, 1, 0);
    p.runToggle = true;
    p.walkTo(30, 1);
    p.update(1, NONE);
    expect(p.position.x).toBeCloseTo(1 + RUN_SPEED, 4);
    p.update(0.25, { x: 0, z: 1, run: false });
    expect(p.speed).toBeCloseTo(RUN_SPEED);
  });

  it('tells the avatar its speed so the walk loop keeps pace with the ground', () => {
    const av = fakeAvatar();
    const p = new PlayerController(av, openNav());
    p.place(5, 5, 0);
    p.update(0.1, { x: 1, z: 0, run: false });
    p.update(0.1, { x: 1, z: 0, run: true });
    expect(av.speeds).toEqual([WALK_SPEED, RUN_SPEED]);
  });

  it('walk clip rate covers the ground: loops per second times metres per loop equals speed', () => {
    expect(walkRate(WALK_SPEED) * WALK_CYCLE_M).toBeCloseTo(WALK_SPEED, 5);
    expect(walkRate(RUN_SPEED)).toBeCloseTo(2 * walkRate(WALK_SPEED), 5);
    // a taller character takes longer steps, so its loop plays a little slower
    expect(walkRate(WALK_SPEED, 1.66)).toBeLessThan(walkRate(WALK_SPEED, 1.5));
  });

  it('the placeholder walk speeds up with ground speed', () => {
    const anim = placeholderAnimator(buildPlaceholder(PLACEHOLDERS[0]));
    anim.play('walk');
    anim.setSpeed(WALK_SPEED);
    const r1 = anim.rate;
    anim.setSpeed(RUN_SPEED);
    expect(anim.rate).toBeCloseTo(r1 * 2, 5);
  });

  it('does not walk through walls when running', () => {
    const p = new PlayerController(fakeAvatar(), openNav(4));
    p.place(3.5, 2, 0);
    for (let i = 0; i < 10; i++) p.update(0.1, { x: 1, z: 0, run: true });
    expect(p.position.x).toBeLessThan(4);
  });
});
