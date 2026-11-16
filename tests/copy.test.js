import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Every source file a player can read text from: shell, UI, all seven stations and their content. */
function files(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(js|json|css|html)$/.test(n)) out.push(p);
  }
  return out;
}
const ALL = [...files('src'), 'index.html'];

describe('player-facing copy rules, all stations and the shell', () => {
  it('scans every station', () => {
    for (const id of ['drone', 'robot', 'sky', 'microscope', 'cypher', 'heroes', 'badge']) {
      expect(ALL.some((f) => f.includes(join('stations', id))), id).toBe(true);
    }
  });
  it('has no em dash anywhere', () => {
    for (const f of ALL) expect(readFileSync(f, 'utf8'), f).not.toMatch(/—/);
  });
  it('has no "not just X but Y" phrasing', () => {
    for (const f of ALL) expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bnot (just|only)\b[^.]{0,80}\bbut\b/i);
  });
  it('never names Scholastic or The Magic School Bus', () => {
    for (const f of ALL) expect(readFileSync(f, 'utf8'), f).not.toMatch(/scholastic|magic school bus/i);
  });
  it('makes no promise about the real bus printing, prizes or visits', () => {
    for (const f of ALL) expect(readFileSync(f, 'utf8'), f).not.toMatch(/bus (can|will) (use it to )?print|win a prize|come back tomorrow/i);
  });
});
