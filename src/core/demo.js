/**
 * Demo mode for showing the whole game to visitors without a full playthrough.
 * Opening the game with ?demo=<DEMO_KEY> turns it on. The key is unlisted, not
 * secret (the code is public); it only unlocks game content.
 *
 * Demo mode runs on its own save held in memory. It never reads, writes or
 * removes the player's real saved progress, and reloading starts it fresh.
 */
import { createSave, memoryStorage, SAVE_KEY } from './save.js';

export const DEMO_KEY = 'mcb-tour-27';

/** True only when the query string has demo=<DEMO_KEY> exactly. */
export function isDemoUrl(search) {
  try {
    return new URLSearchParams(search || '').get('demo') === DEMO_KEY;
  } catch {
    return false;
  }
}

/** The page address without the demo parameter (other parameters kept). */
export function exitDemoUrl(href) {
  const u = new URL(href);
  u.searchParams.delete('demo');
  return u.toString();
}

/** Stamp skills, one per stamp station. Tests check these match each station. */
export const DEMO_SKILLS = {
  microscope: 'Spotted clues at tiny scales',
  robot: "Planned a robot's moves",
  drone: 'Used a loop',
  heroes: 'Matched problems to inventions',
  sky: 'Star-hopped to a target',
  cypher: 'Put science words on the beat',
};

/** A finished sample badge (initials MCB). Tests check the code matches the design. */
export const DEMO_BADGE = {
  design: { shape: 'shield', body: 'teal', accent: 'yellow', slots: ['cell', 'gear', 'drone', 'spark', 'planet', 'wave'], initials: 'MCB' },
  code: 'MCB-2Z9ZDEJD',
  done: true,
};

/** Save data with every stamp earned, every level open and the badge built. */
export function demoData() {
  const stations = {};
  for (const [id, skill] of Object.entries(DEMO_SKILLS)) stations[id] = { levels: { 1: 3, 2: 3, 3: 3 }, stamp: { skill } };
  stations.badge = { levels: { 1: 3, 2: 3, 3: 3 }, stamp: null };
  return {
    v: 1, character: null, sound: true, stations,
    badge: JSON.parse(JSON.stringify(DEMO_BADGE)),
    // the one-time "bus is ready" note never shows in demo mode
    flags: { driveReady: true },
  };
}

/** A save that lives in memory only, filled with the demo data. */
export function createDemoSave() {
  const storage = memoryStorage();
  storage.setItem(SAVE_KEY, JSON.stringify(demoData()));
  return createSave({ storage, memoryOnly: true });
}
