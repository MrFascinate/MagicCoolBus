import { describe, it, expect } from 'vitest';
import { createSave, memoryStorage, sanitize, sanitizeBadge, SAVE_KEY, OLD_BADGE_KEY } from '../src/core/save.js';

describe('save and load', () => {
  it('round-trips character, stars and stamps through storage', () => {
    const storage = memoryStorage();
    const a = createSave({ storage });
    expect(a.persistent).toBe(true);
    a.setCharacter('kid_2');
    expect(a.recordLevel('drone', 1, 2)).toBe(2);
    expect(a.recordLevel('drone', 1, 1)).toBe(2); // best kept
    expect(a.awardStamp('drone', 'Used a loop')).toBe(true);
    expect(a.awardStamp('drone', 'Used a loop')).toBe(false);
    const b = createSave({ storage });
    expect(b.data.character).toBe('kid_2');
    expect(b.levelStars('drone', 1)).toBe(2);
    expect(b.hasStamp('drone')).toBe(true);
    expect(b.stampCount(['drone', 'robot'])).toBe(1);
  });

  it('falls back to memory when storage throws', () => {
    const bad = { getItem() { throw new Error('no'); }, setItem() { throw new Error('blocked'); }, removeItem() {} };
    const s = createSave({ storage: bad });
    expect(s.persistent).toBe(false);
    s.recordLevel('drone', 2, 3);
    expect(s.levelStars('drone', 2)).toBe(3);
  });

  it('keeps working when storage fills up mid-session', () => {
    let full = false;
    const mem = memoryStorage();
    const flaky = { getItem: mem.getItem, removeItem: mem.removeItem, setItem(k, v) { if (full) throw new Error('quota'); mem.setItem(k, v); } };
    const s = createSave({ storage: flaky });
    full = true;
    s.recordLevel('drone', 1, 3);
    expect(s.levelStars('drone', 1)).toBe(3);
    expect(s.persistent).toBe(false);
  });

  it('ignores corrupt or hostile saves', () => {
    const storage = memoryStorage();
    storage.setItem(SAVE_KEY, '{not json');
    expect(createSave({ storage }).data.stations).toEqual({});
    const d = sanitize({ character: 5, stations: { drone: { levels: { 1: 99, 2: 'x' }, stamp: { skill: 3 } } } });
    expect(d.character).toBeNull();
    expect(d.stations.drone.levels).toEqual({ 1: 3 });
    expect(d.stations.drone.stamp).toBeNull();
  });

  it('works with no storage at all', () => {
    const s = createSave({ storage: null });
    s.setCharacter('a');
    expect(s.data.character).toBe('a');
  });
});

describe('badge in the shared save', () => {
  const okStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
  const badge = { design: { shape: 'shield', slots: [] }, code: 'MCB-00000000', done: true };
  it('saves and loads the badge with the rest of the progress', () => {
    const s = okStore();
    createSave({ storage: s }).setBadge(badge);
    expect(createSave({ storage: s }).getBadge()).toMatchObject({ code: 'MCB-00000000', done: true });
  });
  it('moves a badge from the old Badge Builder key and removes that key', () => {
    const s = okStore();
    s.setItem(OLD_BADGE_KEY, JSON.stringify({ ...badge, savedAt: '2026-11-15' }));
    const sv = createSave({ storage: s });
    expect(sv.getBadge()).toMatchObject({ code: 'MCB-00000000', savedAt: '2026-11-15' });
    expect(s.m.has(OLD_BADGE_KEY)).toBe(false);
    expect(JSON.parse(s.getItem(SAVE_KEY)).badge.code).toBe('MCB-00000000');
  });
  it('keeps a newer shared badge over the old key', () => {
    const s = okStore();
    createSave({ storage: s }).setBadge({ ...badge, code: 'MCB-NEW' });
    s.setItem(OLD_BADGE_KEY, JSON.stringify(badge));
    expect(createSave({ storage: s }).getBadge().code).toBe('MCB-NEW');
  });
  it('ignores junk badges', () => {
    const s = okStore();
    s.setItem(OLD_BADGE_KEY, '{nope');
    expect(createSave({ storage: s }).getBadge()).toBe(null);
    expect(sanitizeBadge({ code: 5 })).toBe(null);
    expect(sanitizeBadge({ code: 'x' })).toBe(null);
  });
});
