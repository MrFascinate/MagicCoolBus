/**
 * Breadth-first search over arm states. Each edge is one move, so the first
 * time a sorted state is reached gives the shortest possible program.
 * Used by the tests (and handy for level design).
 */
import { initialState, applyMove, isSorted, MOVES } from './interpreter.js';

const key = (s) => `${s.stop}|${s.down ? 1 : 0}|${s.held || '-'}|${s.tray.join(',')}|${s.bins.map((b) => b.join(',')).join('/')}`;
const copy = (s) => ({ stop: s.stop, down: s.down, held: s.held, tray: s.tray.slice(), bins: s.bins.map((b) => b.slice()) });

/**
 * @param {import('./levels.js').RobotLevel} level
 * @returns {{size:number, moves:string[]}|null}
 */
export function solve(level) {
  const start = initialState(level);
  const seen = new Set([key(start)]);
  /** @type {{s:any, moves:string[]}[]} */
  let frontier = [{ s: start, moves: [] }];
  while (frontier.length) {
    const next = [];
    for (const { s, moves } of frontier) {
      for (const m of MOVES) {
        const t = copy(s);
        const r = applyMove(t, m, level);
        if (!r.ok) continue;
        const mv = [...moves, m];
        if (isSorted(t)) return { size: mv.length, moves: mv };
        const k = key(t);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ s: t, moves: mv });
      }
    }
    frontier = next;
  }
  return null;
}

/** Turn a move list into a block-queue program. */
export function toProgram(moves) {
  return moves.map((type, i) => ({ id: `m${i}`, type }));
}
