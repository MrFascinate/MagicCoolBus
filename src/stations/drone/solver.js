/**
 * Brute-force solver used by tests (and handy for level design).
 * Finds the smallest program that clears a level.
 */
import { runProgram } from './interpreter.js';
import { REPEAT_MIN, REPEAT_MAX } from './interpreter.js';

const BASIC = ['takeoff', 'forward', 'left', 'right', 'land'];

function* sequences(n, alphabet) {
  const idx = new Array(n).fill(0);
  if (n === 0) { yield []; return; }
  while (true) {
    yield idx.map((i) => alphabet[i]);
    let k = n - 1;
    while (k >= 0 && ++idx[k] === alphabet.length) { idx[k] = 0; k--; }
    if (k < 0) return;
  }
}

let uid = 0;
const mk = (types) => types.map((type) => ({ id: `s${uid++}`, type }));

/** All programs with exactly n blocks. */
export function* programsOfSize(n, { allowRepeat }) {
  for (const seq of sequences(n, BASIC)) yield mk(seq);
  if (!allowRepeat) return;
  // prefix + Repeat(k){body} + suffix, sizes p + 1 + b + s = n, b >= 1
  for (let b = 1; b <= n - 1; b++) {
    for (let p = 0; p <= n - 1 - b; p++) {
      const s = n - 1 - b - p;
      for (const pre of sequences(p, BASIC)) for (const body of sequences(b, BASIC)) for (const suf of sequences(s, BASIC)) {
        for (let k = REPEAT_MIN; k <= REPEAT_MAX; k++) {
          yield [...mk(pre), { id: `s${uid++}`, type: 'repeat', count: k, body: mk(body) }, ...mk(suf)];
        }
      }
    }
  }
}

/**
 * @param {import('./levels.js').DroneLevel} level
 * @param {{maxBlocks?:number, allowRepeat?:boolean}} [opts]
 * @returns {{size:number, program:any[]}|null}
 */
export function solve(level, opts = {}) {
  const allowRepeat = opts.allowRepeat ?? level.blocks.includes('repeat');
  const max = opts.maxBlocks ?? 12;
  for (let n = 1; n <= max; n++) {
    for (const prog of programsOfSize(n, { allowRepeat })) {
      if (runProgram(prog, level).cleared) return { size: n, program: prog };
    }
  }
  return null;
}
