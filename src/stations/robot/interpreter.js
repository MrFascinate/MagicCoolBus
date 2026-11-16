/**
 * Pure Robot Relay rules. No three.js, no DOM: the station plays back the
 * steps this returns, and the tests and solver run it directly.
 */
import { STOPS, TRAY, PARTS, BINS } from './levels.js';

/** @typedef {'left'|'right'|'reach'|'grip'|'release'} MoveType */
export const MOVES = /** @type {MoveType[]} */ (['left', 'right', 'reach', 'grip', 'release']);

/**
 * @typedef {Object} ArmState
 * @property {number} stop
 * @property {boolean} down
 * @property {string|null} held
 * @property {string[]} tray       front first
 * @property {string[][]} bins     parts in bins 1..3
 */

/** @param {import('./levels.js').RobotLevel} level @returns {ArmState} */
export function initialState(level) {
  return { stop: TRAY, down: false, held: null, tray: level.parts.slice(), bins: [[], [], []] };
}

const copy = (s) => ({ stop: s.stop, down: s.down, held: s.held, tray: s.tray.slice(), bins: s.bins.map((b) => b.slice()) });

/** True when the turn between two neighbouring stops is blocked by the barrier. */
export function blocked(level, from, to) {
  if (!level.barrier) return false;
  return (from === 3 && to === TRAY) || (from === TRAY && to === 3);
}

/**
 * Apply one move. Returns the event name, or a miss reason.
 * @param {ArmState} s  changed in place
 * @param {MoveType} type
 * @param {import('./levels.js').RobotLevel} level
 * @returns {{ok:boolean, event:string, reason?:string, part?:string, to?:number, dir?:number}}
 */
export function applyMove(s, type, level) {
  switch (type) {
    case 'left':
    case 'right': {
      if (s.down) return { ok: false, event: 'fail', reason: 'down' };
      const dir = type === 'right' ? 1 : -1;
      const to = (s.stop + dir + STOPS) % STOPS;
      if (blocked(level, s.stop, to)) return { ok: false, event: 'bump', reason: 'barrier', dir, to };
      s.stop = to;
      return { ok: true, event: 'turn', dir, to };
    }
    case 'reach':
      if (s.down) return { ok: false, event: 'fail', reason: 'already-down' };
      s.down = true;
      return { ok: true, event: 'reach' };
    case 'grip': {
      if (!s.down) return { ok: false, event: 'fail', reason: 'grip-up' };
      if (s.held) return { ok: false, event: 'fail', reason: 'full' };
      if (s.stop !== TRAY) return { ok: false, event: 'fail', reason: 'grip-bin' };
      if (!s.tray.length) return { ok: false, event: 'fail', reason: 'tray-empty' };
      s.held = s.tray.shift();
      s.down = false;
      return { ok: true, event: 'grip', part: s.held };
    }
    case 'release': {
      if (!s.down) return { ok: false, event: 'fail', reason: 'release-up' };
      if (!s.held) return { ok: false, event: 'fail', reason: 'empty-hand' };
      const part = s.held;
      if (s.stop === TRAY) {
        s.tray.unshift(part);
        s.held = null; s.down = false;
        return { ok: true, event: 'release-tray', part };
      }
      const kind = level.bins[s.stop - 1];
      s.held = null; s.down = false;
      if (PARTS[part].bin === kind) {
        s.bins[s.stop - 1].push(part);
        return { ok: true, event: 'drop', part };
      }
      s.tray.push(part); // bounces back to the end of the tray line
      return { ok: false, event: 'bounce', reason: 'wrong-bin', part };
    }
    default:
      return { ok: false, event: 'fail', reason: 'unknown' };
  }
}

/** Every part sorted: tray empty and nothing held. */
export function isSorted(s) {
  return s.tray.length === 0 && !s.held;
}

/** Flatten a block-queue program (Robot Relay has no Repeat). */
export function flatten(program) {
  const out = [];
  for (const b of program) {
    if (b.body) for (let i = 0; i < (b.count || 1); i++) out.push(...flatten(b.body));
    else out.push(b);
  }
  return out;
}

/**
 * @typedef {Object} RunStep
 * @property {string} id         block id
 * @property {MoveType} type
 * @property {string} event      turn | bump | reach | grip | release-tray | drop | bounce | fail
 * @property {ArmState} before
 * @property {ArmState} after
 * @property {number} [dir]
 * @property {string} [part]
 *
 * @typedef {Object} RunResult
 * @property {boolean} cleared
 * @property {string|null} reason   null when cleared
 * @property {string|null} failId   block that went wrong
 * @property {RunStep[]} steps
 * @property {number} blocks        program size (the move count)
 * @property {ArmState} final
 * @property {string|null} part     part involved in the miss
 */

/**
 * @param {{id:string,type:string}[]} program
 * @param {import('./levels.js').RobotLevel} level
 * @returns {RunResult}
 */
export function runProgram(program, level) {
  const flat = flatten(program);
  const s = initialState(level);
  const steps = [];
  if (!flat.length) return { cleared: false, reason: 'empty', failId: null, steps, blocks: 0, final: s, part: null };
  for (const b of flat) {
    const before = copy(s);
    const r = applyMove(s, /** @type {MoveType} */ (b.type), level);
    steps.push({ id: b.id, type: /** @type {MoveType} */ (b.type), event: r.event, before, after: copy(s), dir: r.dir, part: r.part });
    if (!r.ok) return { cleared: false, reason: r.reason || 'fail', failId: b.id, steps, blocks: flat.length, final: s, part: r.part || before.held };
  }
  const cleared = isSorted(s);
  const left = s.tray.length + (s.held ? 1 : 0);
  return { cleared, reason: cleared ? null : 'unfinished', failId: cleared ? null : flat[flat.length - 1].id, steps, blocks: flat.length, final: s, part: null, left };
}

/**
 * Words for a miss, grade 5 to 6 reading level.
 * @param {RunResult} res
 * @param {import('./levels.js').RobotLevel} level
 */
export function missMessage(res, level) {
  switch (res.reason) {
    case 'empty': return 'Your program is empty. Tap a block to add it first.';
    case 'down': return 'The arm is still down, so it cannot turn. Grip or Release lifts it first.';
    case 'barrier': return 'The arm hit the barrier. Go the other way around.';
    case 'already-down': return 'The arm is already down. Use Grip or Release next.';
    case 'grip-up': return 'The gripper is up in the air. Use Reach first to lower it.';
    case 'full': return 'The gripper is already holding a part. Release it before you grip again.';
    case 'grip-bin': return 'Parts wait on the tray. Turn to the tray before you Grip.';
    case 'tray-empty': return 'The tray is empty, so there is nothing to grip.';
    case 'release-up': return 'The gripper is up high. Use Reach first so the part does not fall.';
    case 'empty-hand': return 'The gripper is not holding a part, so there is nothing to release.';
    case 'wrong-bin': {
      const p = PARTS[res.part];
      const want = BINS[p.bin];
      return `Wrong bin. The ${p.label} goes in the bin with the ${want.icon} icon, so it bounced back to the tray.`;
    }
    case 'unfinished': {
      const n = res.left ?? 0;
      return n === 1 ? 'The program ended with 1 part not sorted yet. Add more moves.' : `The program ended with ${n} parts not sorted yet. Add more moves.`;
    }
    default: return 'Something went wrong. Check the marked move.';
  }
}
