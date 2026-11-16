/**
 * Drone Dash interpreter. Pure: no DOM, no three.js.
 */
import { GRID } from './levels.js';

/** @typedef {import('./levels.js').BlockType} BlockType */
/** @typedef {import('./levels.js').DroneLevel} DroneLevel */
/**
 * @typedef {Object} Block
 * @property {string} id
 * @property {BlockType} type
 * @property {number} [count]   repeat count (2..5)
 * @property {Block[]} [body]   repeat body (one level, no nesting)
 */
/**
 * @typedef {Object} Step
 * @property {string} id        block id that ran
 * @property {BlockType} type
 * @property {number} c
 * @property {number} r
 * @property {number} dir
 * @property {boolean} flying
 * @property {'move'|'turn'|'takeoff'|'land'|'noop'|'fail'} event
 */
/**
 * @typedef {Object} RunResult
 * @property {boolean} cleared
 * @property {null|'empty'|'ground'|'net'|'air'|'offPad'|'missedTouch'|'noFlight'} reason
 * @property {string|null} failId  block where it went wrong
 * @property {Step[]} steps
 * @property {boolean} touched     flew over the touch pad (or none needed)
 * @property {number} blocks       program size
 */

export const DX = [0, 1, 0, -1];
export const DR = [-1, 0, 1, 0];
export const REPEAT_MIN = 2;
export const REPEAT_MAX = 5;

/** Number of blocks a program uses. A Repeat counts as one block plus its body. */
export function countBlocks(program) {
  let n = 0;
  for (const b of program) n += 1 + (b.type === 'repeat' ? countBlocks(b.body || []) : 0);
  return n;
}

/**
 * Expand repeats into a flat list of executed blocks.
 * @param {Block[]} program
 * @returns {{id:string, type:BlockType}[]}
 */
export function flatten(program) {
  const out = [];
  for (const b of program) {
    if (b.type === 'repeat') {
      const n = Math.max(REPEAT_MIN, Math.min(REPEAT_MAX, b.count ?? REPEAT_MIN));
      const body = flatten(b.body || []);
      for (let i = 0; i < n; i++) out.push(...body);
    } else out.push({ id: b.id, type: b.type });
  }
  return out;
}

const same = (a, b) => !!a && !!b && a.c === b.c && a.r === b.r;

/**
 * Run a program on a level.
 * @param {Block[]} program
 * @param {DroneLevel} level
 * @returns {RunResult}
 */
export function runProgram(program, level) {
  const blocks = countBlocks(program);
  const flat = flatten(program);
  /** @type {Step[]} */
  const steps = [];
  let c = level.start.c, r = level.start.r, dir = level.start.dir;
  let flying = false;
  let touched = !level.touch;
  let everFlew = false;
  let lastLandId = null;
  const fail = (reason, id) => ({ cleared: false, reason, failId: id, steps, touched, blocks });

  if (flat.length === 0) return fail('empty', null);

  for (const b of flat) {
    const push = (event) => steps.push({ id: b.id, type: b.type, c, r, dir, flying, event });
    switch (b.type) {
      case 'takeoff':
        if (flying) { push('noop'); break; }
        flying = true; everFlew = true; push('takeoff');
        break;
      case 'land':
        if (!flying) { push('noop'); lastLandId = b.id; break; }
        flying = false; lastLandId = b.id;
        if (level.touch && same({ c, r }, level.touch)) touched = true;
        push('land');
        break;
      case 'left': dir = (dir + 3) % 4; push('turn'); break;
      case 'right': dir = (dir + 1) % 4; push('turn'); break;
      case 'forward': {
        if (!flying) { push('fail'); return fail('ground', b.id); }
        const nc = c + DX[dir], nr = r + DR[dir];
        if (nc < 0 || nr < 0 || nc >= GRID || nr >= GRID) {
          steps.push({ id: b.id, type: b.type, c, r, dir, flying, event: 'fail' });
          return fail('net', b.id);
        }
        c = nc; r = nr;
        if (level.touch && same({ c, r }, level.touch)) touched = true;
        push('move');
        break;
      }
      default:
        push('noop');
    }
  }
  const lastId = flat[flat.length - 1].id;
  if (flying) return fail('air', lastId);
  if (!everFlew) return fail('noFlight', lastId);
  if (!same({ c, r }, level.target)) return fail('offPad', lastLandId ?? lastId);
  if (!touched) return fail('missedTouch', lastLandId ?? lastId);
  return { cleared: true, reason: null, failId: null, steps, touched, blocks };
}

/** Plain-language message for a miss. Grade 5 to 6 reading level. */
export function missMessage(reason, level) {
  switch (reason) {
    case 'empty': return 'Add some blocks first, then press Run.';
    case 'ground': return 'The drone tried to fly forward while it was still on the ground. Add Take off before it.';
    case 'net': return 'The drone flew into the net. Check which way it was facing at the marked block.';
    case 'air': return 'The program ended with the drone still in the air. End with Land.';
    case 'noFlight': return 'The drone never left the ground. Start with Take off.';
    case 'offPad': return `The drone landed, but not on Pad ${level.targetPad}. Look at the drawn path to see where it went.`;
    case 'missedTouch': return `The drone landed on Pad ${level.targetPad}, but it did not fly over Pad ${level.touchPad} first.`;
    default: return 'Something went wrong. Try again.';
  }
}
