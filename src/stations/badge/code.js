/**
 * Badge code: "MCB-" plus 8 characters that hold the whole design (shape,
 * two colours, which emblem sits on each spot, and up to three initials).
 * The same design always gives the same code, and the code can be turned back
 * into the design. It is a record of the design,
 * not an account: it holds nothing about the player.
 *
 * Packing (mixed radix, 40 bits): shape 4 x body colour 6 x accent colour 6 x
 * six spots of 7 (empty or one of six emblems) x three letters of 27 (none or
 * A to Z). Written in Crockford base 32, which leaves out I, L, O and U.
 */
import { SHAPES, COLORS, EMBLEM_IDS } from './design.js';

export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SPOTS = 6;
const SPOT_BASE = EMBLEM_IDS.length + 1;
const LETTERS = 3;
const LETTER_BASE = 27;

/** @param {{shape:string, body:string, accent:string, slots:(string|null)[], initials:string}} d */
export function encodeBadge(d) {
  const shape = SHAPES.findIndex((s) => s.id === d.shape);
  const body = COLORS.findIndex((c) => c.id === d.body);
  const accent = COLORS.findIndex((c) => c.id === d.accent);
  if (shape < 0 || body < 0 || accent < 0) throw new Error('Bad design');
  let n = shape;
  n = n * COLORS.length + body;
  n = n * COLORS.length + accent;
  for (let i = 0; i < SPOTS; i++) {
    const e = d.slots[i];
    n = n * SPOT_BASE + (e ? EMBLEM_IDS.indexOf(e) + 1 : 0);
  }
  const ini = (d.initials || '').toUpperCase();
  for (let i = 0; i < LETTERS; i++) {
    const ch = ini[i];
    n = n * LETTER_BASE + (ch && ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 64 : 0);
  }
  let out = '';
  for (let i = 0; i < 8; i++) { out = ALPHABET[n % 32] + out; n = Math.floor(n / 32); }
  return `MCB-${out}`;
}

/** Turn a code back into a design, or null if it is not a valid code. */
export function decodeBadge(code) {
  const m = /^MCB-([0-9A-Z]{8})$/.exec(String(code).trim().toUpperCase());
  if (!m) return null;
  let n = 0;
  for (const ch of m[1]) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    n = n * 32 + v;
  }
  const letters = [];
  for (let i = 0; i < LETTERS; i++) { letters.unshift(n % LETTER_BASE); n = Math.floor(n / LETTER_BASE); }
  const slots = [];
  for (let i = 0; i < SPOTS; i++) { slots.unshift(n % SPOT_BASE); n = Math.floor(n / SPOT_BASE); }
  const accent = n % COLORS.length; n = Math.floor(n / COLORS.length);
  const body = n % COLORS.length; n = Math.floor(n / COLORS.length);
  const shape = n;
  if (shape >= SHAPES.length) return null;
  // initials are packed from the left with no gaps
  const ini = letters.map((v) => (v ? String.fromCharCode(64 + v) : '')).join('');
  if (ini.length !== letters.filter(Boolean).length || letters.findIndex((v) => !v) !== -1 && letters.slice(letters.findIndex((v) => !v)).some(Boolean)) return null;
  return {
    shape: SHAPES[shape].id,
    body: COLORS[body].id,
    accent: COLORS[accent].id,
    slots: slots.map((v) => (v ? EMBLEM_IDS[v - 1] : null)),
    initials: ini,
  };
}
