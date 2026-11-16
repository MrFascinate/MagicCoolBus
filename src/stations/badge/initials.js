/**
 * Initials: up to three letters, A to Z, nothing else. A small blocklist
 * stops three-letter combinations that spell rude words; the player is just
 * asked to pick different letters. The list is stored in ROT13 so the words
 * do not sit in the game files as plain text.
 */
const ROT13_BLOCK = [
  'NFF', 'PHZ', 'QVP', 'QVX', 'QVK', 'SNT', 'SPX', 'SHP', 'SHX', 'SHK', 'WVM', 'XXX', 'XHZ', 'ANM',
  'AVT', 'ATE', 'CVF', 'CBB', 'FRK', 'FUG', 'GVG', 'JGS', 'KKK', 'INT', 'PBX', 'PBP', 'XBX', 'UBR',
  'YFQ', 'CRR', 'SNC', 'SBX',
];

const rot13 = (s) => s.replace(/[A-Z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 65 + 13) % 26) + 65));
const BLOCKED = new Set(ROT13_BLOCK.map(rot13));

/** Keep only A to Z, upper case, at most three. */
export function cleanInitials(text) {
  return String(text || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
}

/** True if these initials should not be printed. */
export function isBlocked(initials) {
  const s = cleanInitials(initials);
  return s.length === 3 && BLOCKED.has(s);
}

/** For tests only: the plain list. */
export const _blockedForTests = () => [...BLOCKED];
