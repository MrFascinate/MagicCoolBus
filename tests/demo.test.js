import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEMO_KEY, isDemoUrl, exitDemoUrl, demoData, createDemoSave, DEMO_SKILLS, DEMO_BADGE } from '../src/core/demo.js';
import { createSave, isDriveUnlocked, SAVE_KEY, OLD_BADGE_KEY } from '../src/core/save.js';
import { STAMP_STATIONS, STATIONS } from '../src/stations/registry.js';
import { encodeBadge } from '../src/stations/badge/code.js';
import { STAMP_SKILL as DRONE } from '../src/stations/drone/levels.js';
import { STAMP_SKILL as ROBOT } from '../src/stations/robot/levels.js';
import { STAMP_SKILL as MICRO } from '../src/stations/microscope/levels.js';
import { STAMP_SKILL as SKY } from '../src/stations/sky/levels.js';
import heroes from '../src/stations/heroes/content.json';
import { readFileSync } from 'node:fs';

/** A localStorage stand-in that counts every call. */
function spyStorage(init = {}) {
  const m = new Map(Object.entries(init));
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    calls, m,
    getItem(k) { calls.get++; return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { calls.set++; m.set(k, String(v)); },
    removeItem(k) { calls.remove++; m.delete(k); },
  };
}

describe('demo link key', () => {
  it('turns on only with the exact key', () => {
    expect(DEMO_KEY).toBe('mcb-tour-27');
    expect(isDemoUrl('?demo=mcb-tour-27')).toBe(true);
    expect(isDemoUrl('?debug&demo=mcb-tour-27')).toBe(true);
    expect(isDemoUrl('')).toBe(false);
    expect(isDemoUrl('?demo')).toBe(false);
    expect(isDemoUrl('?demo=1')).toBe(false);
    expect(isDemoUrl('?demo=MCB-TOUR-27')).toBe(false);
    expect(isDemoUrl('?demo=mcb-tour-27x')).toBe(false);
    expect(isDemoUrl('?demo=mcb-tour-2')).toBe(false);
    expect(isDemoUrl('?demox=mcb-tour-27')).toBe(false);
    expect(isDemoUrl(undefined)).toBe(false);
  });

  it('Exit demo drops only the demo parameter', () => {
    expect(exitDemoUrl('https://x.test/game/?demo=mcb-tour-27')).toBe('https://x.test/game/');
    expect(exitDemoUrl('https://x.test/?debug&demo=mcb-tour-27')).toBe('https://x.test/?debug=');
    expect(isDemoUrl(new URL(exitDemoUrl('https://x.test/?demo=mcb-tour-27#a')).search)).toBe(false);
  });
});

describe('demo save', () => {
  let real;
  beforeEach(() => {
    real = spyStorage();
    globalThis.localStorage = real;
  });
  afterEach(() => { delete globalThis.localStorage; });

  it('opens everything: six stamps, every level, a finished badge, the drive', () => {
    const d = createDemoSave();
    expect(d.stampCount(STAMP_STATIONS)).toBe(6);
    for (const s of STATIONS) for (const lv of [1, 2, 3]) expect(d.levelStars(s.id, lv)).toBeGreaterThan(0);
    expect(isDriveUnlocked(d.data)).toBe(true);
    expect(d.getBadge().design.initials).toBe('MCB');
    expect(d.getBadge().done).toBe(true);
    expect(d.data.character).toBe(null); // character select still comes first
    expect(d.flag('driveReady')).toBe(true); // no "bus is ready" note
    expect(d.persistent).toBe(false);
  });

  it('never touches localStorage, even while playing', () => {
    const d = createDemoSave();
    d.setCharacter('avatar_02');
    d.setSound(false);
    d.recordLevel('drone', 1, 1);
    d.awardStamp('robot', 'x');
    d.setBadge({ design: DEMO_BADGE.design, code: DEMO_BADGE.code, done: true });
    d.setFlag('driveReady');
    d.reset();
    expect(real.calls).toEqual({ get: 0, set: 0, remove: 0 });
    expect(real.m.size).toBe(0);
  });

  it('leaves a real save exactly as it was after a demo session', () => {
    const stored = JSON.stringify({ v: 1, character: 'avatar_05', sound: true, stations: { drone: { levels: { 1: 2, 2: 1, 3: 3 }, stamp: { skill: DRONE } }, robot: { levels: { 1: 3, 2: 3, 3: 1 }, stamp: { skill: ROBOT } } }, badge: null, flags: {} });
    real.m.set(SAVE_KEY, stored);
    real.m.set(OLD_BADGE_KEY, 'leftover');
    const before = new Map(real.m);
    const d = createDemoSave();
    for (const id of STAMP_STATIONS) d.recordLevel(id, 3, 3);
    d.setCharacter('avatar_01');
    d.setBadge({ ...DEMO_BADGE });
    d.reset();
    expect(real.calls.set + real.calls.remove).toBe(0);
    expect(new Map(real.m)).toEqual(before);
    const back = createSave(); // the normal game afterwards
    expect(back.stampCount(STAMP_STATIONS)).toBe(2);
    expect(back.data.character).toBe('avatar_05');
    expect(back.levelStars('drone', 1)).toBe(2);
    expect(isDriveUnlocked(back.data)).toBe(false);
  });

  it('starts fresh each time (a reload of the demo link)', () => {
    const a = createDemoSave();
    a.recordLevel('drone', 1, 1);
    a.setCharacter('avatar_04');
    a.setBadge(null);
    const b = createDemoSave();
    expect(b.data.character).toBe(null);
    expect(isDriveUnlocked(b.data)).toBe(true);
    expect(b.data).toEqual(createDemoSave().data);
  });

  it('gives each station its real stamp skill and a valid badge code', () => {
    const cypher = readFileSync(new URL('../src/stations/cypher/index.js', import.meta.url), 'utf8').match(/STAMP_SKILL = '([^']+)'/)[1];
    expect(DEMO_SKILLS).toEqual({ microscope: MICRO, robot: ROBOT, drone: DRONE, heroes: heroes.stampSkill, sky: SKY, cypher });
    expect(Object.keys(DEMO_SKILLS).sort()).toEqual([...STAMP_STATIONS].sort());
    expect(encodeBadge(DEMO_BADGE.design)).toBe(DEMO_BADGE.code);
    expect(demoData().badge).toEqual(DEMO_BADGE);
    expect(demoData().badge).not.toBe(DEMO_BADGE);
  });
});

describe('normal game is unchanged', () => {
  it('reads and writes the real save without the demo key', () => {
    const real = spyStorage();
    const s = createSave({ storage: real });
    expect(s.persistent).toBe(true);
    s.recordLevel('drone', 1, 2);
    expect(JSON.parse(real.m.get(SAVE_KEY)).stations.drone.levels['1']).toBe(2);
  });
});
