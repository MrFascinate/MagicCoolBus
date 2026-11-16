/**
 * Progress saving. localStorage inside try/catch, with an in-memory fallback.
 * Nothing leaves the device. No accounts.
 */

export const SAVE_KEY = 'mcb-challenge-v1';
/** Badge Builder's older separate key. Read once, moved into the shared save, then removed. */
export const OLD_BADGE_KEY = 'mcb-badge-builder-v1';

/**
 * A stored badge: the design, its badge code and whether it was printed.
 * Anything else is dropped. Returns null for junk.
 * @returns {{design:any, code:string, done:boolean, savedAt?:string}|null}
 */
export function sanitizeBadge(v) {
  if (!v || typeof v !== 'object' || typeof v.code !== 'string' || !v.design || typeof v.design !== 'object') return null;
  const out = { design: v.design, code: v.code, done: !!v.done };
  if (typeof v.savedAt === 'string') out.savedAt = v.savedAt;
  return out;
}

/**
 * Drive the Bus opens once the badge is finished in Badge Builder.
 * @param {{badge:any}} data
 */
export function isDriveUnlocked(data) {
  return !!(data && data.badge && data.badge.done === true);
}

/** @typedef {{levels: Record<string, number>, stamp: null | {skill: string}}} StationSave */
/**
 * @typedef {Object} SaveData
 * @property {number} v
 * @property {string|null} character
 * @property {boolean} sound
 * @property {Record<string, StationSave>} stations
 * @property {any} badge
 * @property {Record<string, boolean>} flags  one-time notes already shown (driveReady)
 */

/** @returns {SaveData} */
export function defaults() {
  return { v: 1, character: null, sound: true, stations: {}, badge: null, flags: {} };
}

/** Memory-backed object with the Storage methods we use. */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
  };
}

/** Pick localStorage if it works, else memory. */
export function pickStorage(candidate) {
  try {
    const s = candidate === undefined ? globalThis.localStorage : candidate;
    if (!s) return { storage: memoryStorage(), persistent: false };
    const probe = '__mcb_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return { storage: s, persistent: true };
  } catch {
    return { storage: memoryStorage(), persistent: false };
  }
}

/** Clean up whatever was read so a bad or old save never crashes the game. */
export function sanitize(raw) {
  const d = defaults();
  if (!raw || typeof raw !== 'object') return d;
  if (typeof raw.character === 'string') d.character = raw.character;
  if (typeof raw.sound === 'boolean') d.sound = raw.sound;
  if (raw.stations && typeof raw.stations === 'object') {
    for (const [id, st] of Object.entries(raw.stations)) {
      if (!st || typeof st !== 'object') continue;
      const levels = {};
      for (const [lv, stars] of Object.entries(st.levels || {})) {
        const n = Number(stars);
        if (Number.isFinite(n)) levels[lv] = Math.max(0, Math.min(3, Math.round(n)));
      }
      const stamp = st.stamp && typeof st.stamp.skill === 'string' ? { skill: st.stamp.skill } : null;
      d.stations[id] = { levels, stamp };
    }
  }
  d.badge = sanitizeBadge(raw.badge);
  if (raw.flags && typeof raw.flags === 'object') {
    for (const [k, v] of Object.entries(raw.flags)) if (v === true && /^[a-zA-Z]{1,24}$/.test(k)) d.flags[k] = true;
  }
  return d;
}

/**
 * @param {{storage?: any, key?: string, memoryOnly?: boolean}} [opts]
 *   memoryOnly: the given storage is a memory store (demo mode); report it as not persistent.
 */
export function createSave(opts = {}) {
  const key = opts.key || SAVE_KEY;
  let { storage, persistent } = pickStorage(opts.storage);
  if (opts.memoryOnly) persistent = false;
  /** @type {SaveData} */
  let data = defaults();
  try {
    const txt = storage.getItem(key);
    if (txt) data = sanitize(JSON.parse(txt));
  } catch {
    data = defaults();
  }
  // Move a badge saved under Badge Builder's old key into the shared save.
  let migrated = false;
  try {
    const old = storage.getItem(OLD_BADGE_KEY);
    if (old) {
      if (!data.badge) { data.badge = sanitizeBadge(JSON.parse(old)); migrated = !!data.badge; }
      storage.removeItem(OLD_BADGE_KEY);
    }
  } catch { /* junk in the old key: ignore it */ }

  function write() {
    try {
      storage.setItem(key, JSON.stringify(data));
    } catch {
      // Storage full or blocked mid-session: keep going in memory.
      const mem = memoryStorage();
      mem.setItem(key, JSON.stringify(data));
      storage = mem;
      persistent = false;
    }
  }

  if (migrated) write();

  const station = (id) => (data.stations[id] ||= { levels: {}, stamp: null });

  return {
    get data() { return data; },
    get persistent() { return persistent; },
    /** @param {string} id */
    setCharacter(id) { data.character = id; write(); },
    setSound(on) { data.sound = !!on; write(); },
    /** Stars for a level, best run kept. Returns the stored best. */
    recordLevel(stationId, level, stars) {
      const st = station(stationId);
      const prev = st.levels[level] || 0;
      st.levels[level] = Math.max(prev, Math.max(0, Math.min(3, stars | 0)));
      write();
      return st.levels[level];
    },
    levelStars(stationId, level) { return data.stations[stationId]?.levels[level] || 0; },
    /** Award a stamp. Returns true if it is new. */
    awardStamp(stationId, skill) {
      const st = station(stationId);
      const isNew = !st.stamp;
      st.stamp = { skill };
      write();
      return isNew;
    },
    hasStamp(stationId) { return !!data.stations[stationId]?.stamp; },
    stampCount(ids) {
      return ids.filter((id) => data.stations[id]?.stamp).length;
    },
    /** The saved badge (design, code, done) or null. */
    getBadge() { return data.badge; },
    setBadge(badge) { data.badge = sanitizeBadge(badge); write(); },
    /** One-time notes: true once shown. */
    flag(name) { return !!data.flags[name]; },
    setFlag(name) { data.flags[name] = true; write(); },
    reset() { data = defaults(); write(); },
  };
}
