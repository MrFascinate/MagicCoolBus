import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { readGlbJson } from '../src/lib/glbJson.js';
import {
  newDesign, setShape, placeEmblem, removeEmblem, nudgeEmblem, setColor, placedCount, partsFor,
  LAYOUTS, EMBLEM_IDS, EMBLEMS, SHAPES, testToken, overhangToken,
} from '../src/stations/badge/design.js';
import { rasterize, simulate, allOptions, fewestLayers } from '../src/stations/badge/printsim.js';
import { encodeBadge, decodeBadge } from '../src/stations/badge/code.js';
import { cleanInitials, isBlocked, _blockedForTests } from '../src/stations/badge/initials.js';
import { LEVELS, starsFor } from '../src/stations/badge/levels.js';
import { PIECE_NAMES } from '../src/stations/badge/scene.js';
import { STATIONS } from '../src/stations/registry.js';

const full = (shape = 'circle') => {
  let d = setShape(newDesign(), shape);
  EMBLEM_IDS.slice(0, LAYOUTS[shape].snaps.length).forEach((e, i) => { d = placeEmblem(d, e, i); });
  return d;
};

describe('printer.glb', () => {
  const glb = readGlbJson(new Uint8Array(readFileSync('public/assets/badge/printer.glb')));
  const byName = new Map(glb.nodes.map((n, i) => [n.name, { n, i }]));
  it('has every node the station uses', () => {
    for (const n of ['printer_frame', 'print_bed', 'print_gantry', 'print_head', ...PIECE_NAMES]) expect(byName.has(n), n).toBe(true);
    expect(PIECE_NAMES).toHaveLength(4 + 6 + 26);
  });
  it('keeps the hierarchy the animation expects', () => {
    const kids = (name) => (byName.get(name).n.children || []).map((i) => glb.nodes[i].name);
    expect(kids('printer_frame')).toEqual(expect.arrayContaining(['print_bed', 'print_gantry']));
    expect(kids('print_gantry')).toContain('print_head');
  });
});

describe('badge design state', () => {
  it('starts empty and places each emblem once', () => {
    let d = newDesign();
    expect(placedCount(d)).toBe(0);
    d = placeEmblem(d, 'gear', 2);
    expect(d.slots[2]).toBe('gear');
    d = placeEmblem(d, 'gear', 4);
    expect(d.slots[2]).toBe(null);
    expect(d.slots[4]).toBe('gear');
    expect(placedCount(d)).toBe(1);
    expect(placeEmblem(d, 'nope', 0)).toBe(d);
    expect(placeEmblem(d, 'cell', 9)).toBe(d);
    d = removeEmblem(d, 4);
    expect(placedCount(d)).toBe(0);
  });
  it('nudges to the next spot and swaps', () => {
    let d = placeEmblem(placeEmblem(newDesign(), 'cell', 0), 'wave', 1);
    const r = nudgeEmblem(d, 0, 1);
    expect(r.slot).toBe(1);
    expect(r.design.slots.slice(0, 2)).toEqual(['wave', 'cell']);
    const back = nudgeEmblem(r.design, 1, -1);
    expect(back.slot).toBe(0);
    const wrap = nudgeEmblem(d, 0, -1);
    expect(wrap.slot).toBe(5);
  });
  it('switching to the star keeps emblems on its five spots', () => {
    const d = setShape(full('circle'), 'star');
    expect(d.shape).toBe('star');
    expect(d.slots.slice(0, 5).filter(Boolean)).toHaveLength(5);
    expect(d.slots[5]).toBe(null);
  });
  it('sets colours by name only', () => {
    const d = setColor(newDesign(), 'body', 'coral');
    expect(d.body).toBe('coral');
    expect(setColor(d, 'body', '#ff0000')).toBe(d);
  });
  it('each emblem matches a stamp station', () => {
    const ids = STATIONS.filter((s) => s.id !== 'badge').map((s) => s.emblem);
    expect(EMBLEMS.map((e) => e.id)).toEqual(ids);
    expect(EMBLEMS.map((e) => e.station)).toEqual(STATIONS.filter((s) => s.id !== 'badge').map((s) => s.id));
  });
});

describe('layouts fit their shapes', () => {
  const N = 128;
  for (const shape of SHAPES.map((s) => s.id)) {
    it(`${shape}: every emblem on every spot stays on the badge, and initials fit`, () => {
      const body = rasterize([{ piece: `badge_${shape}`, cx: 0, cy: 0, s: 1, t0: 0, th: 1 }]);
      const lay = LAYOUTS[shape];
      for (const [x, y] of lay.snaps) {
        for (const e of EMBLEM_IDS) {
          const g = rasterize([{ piece: `emblem_${e}`, cx: x, cy: y, s: lay.emblemScale, t0: 0, th: 1 }]);
          for (let k = 0; k < N * N; k++) if (g[k]) expect(body[k], `${e} at ${x},${y}`).toBe(1);
        }
      }
      for (const ini of ['WWW', 'MWM', 'QJW']) {
        const parts = partsFor({ ...newDesign(), shape, initials: ini }).filter((p) => p.kind === 'letter').map((p) => ({ ...p, t0: 0, th: 1 }));
        const g = rasterize(parts);
        let out = 0;
        for (let k = 0; k < N * N; k++) if (g[k] && !body[k]) out++;
        expect(out, ini).toBe(0);
      }
    });
  }
});

describe('print check', () => {
  it('level 1: only flat on its back prints', () => {
    for (const e of EMBLEM_IDS) {
      const ok = allOptions(testToken(e)).filter((o) => o.ok);
      expect(ok).toEqual([{ orientation: 'flat', turn: 0, ok: true, layers: 30 }]);
    }
  });
  it('level 2: only standing on the edge with the spark up prints', () => {
    const opts = allOptions(overhangToken());
    expect(opts.filter((o) => o.ok).map((o) => [o.orientation, o.turn])).toEqual([['edge', 0]]);
    const flat = simulate(overhangToken(), 'flat');
    expect(flat.ok).toBe(false);
    expect(flat.fail.z).toBe(4); // the first raised layer, where the spark leaves the edge
  });
  it('face down fails at the first badge layer over the raised pieces', () => {
    const r = simulate(full('hex'), 'face');
    expect(r.ok).toBe(false);
    expect(r.fail.z).toBe(2);
  });
  it('every full design prints flat with the fewest layers', () => {
    for (const s of SHAPES) {
      const d = { ...full(s.id), initials: 'ABC' };
      expect(simulate(d, 'flat').ok, s.id).toBe(true);
      expect(fewestLayers(d)).toBe(30);
    }
  });
  it('a plain badge with no raised pieces is 20 layers', () => {
    expect(simulate(newDesign(), 'flat').layers).toBe(20);
  });
});

describe('badge stars', () => {
  const [L1, L2] = LEVELS;
  it('follows the spec', () => {
    expect(starsFor({ printed: false, failedPreviews: 0, layers: 0, fewest: 30 }, L1).stars).toBe(0);
    expect(starsFor({ printed: true, failedPreviews: 0, layers: 30, fewest: 30 }, L1).stars).toBe(3);
    expect(starsFor({ printed: true, failedPreviews: 1, layers: 30, fewest: 30 }, L1).stars).toBe(3);
    expect(starsFor({ printed: true, failedPreviews: 2, layers: 30, fewest: 30 }, L1).stars).toBe(1);
    expect(starsFor({ printed: true, failedPreviews: 2, layers: 435, fewest: 435 }, L2).stars).toBe(3);
    expect(starsFor({ printed: true, failedPreviews: 0, layers: 350, fewest: 30 }, L2).stars).toBe(2);
  });
});

describe('initials', () => {
  it('keeps only A to Z, three at most', () => {
    expect(cleanInitials('a1b-c d')).toBe('ABC');
    expect(cleanInitials('Jo')).toBe('JO');
    expect(cleanInitials('')).toBe('');
  });
  it('blocks rude three-letter words and allows ordinary initials', () => {
    const list = _blockedForTests();
    expect(list.length).toBeGreaterThan(20);
    for (const w of list) { expect(w).toMatch(/^[A-Z]{3}$/); expect(isBlocked(w)).toBe(true); expect(isBlocked(w.toLowerCase())).toBe(true); }
    for (const ok of ['ABC', 'JMS', 'KLW', 'A', 'AS', 'MCB']) expect(isBlocked(ok)).toBe(false);
  });
});

describe('badge code', () => {
  it('is MCB- plus 8 characters and the same design gives the same code', () => {
    const d = { ...full('shield'), body: 'teal', accent: 'white', initials: 'JS' };
    const a = encodeBadge(d), b = encodeBadge(JSON.parse(JSON.stringify(d)));
    expect(a).toMatch(/^MCB-[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(a).toBe(b);
  });
  it('changes when the design changes and decodes back', () => {
    const d = { ...full('star'), initials: 'ZQ' };
    const codes = new Set([encodeBadge(d), encodeBadge({ ...d, initials: 'ZR' }), encodeBadge({ ...d, accent: 'coral' }), encodeBadge(setShape(d, 'hex')), encodeBadge(nudgeEmblem(d, 0, 1).design)]);
    expect(codes.size).toBe(5);
    const back = decodeBadge(encodeBadge(d));
    expect(back).toEqual({ shape: d.shape, body: d.body, accent: d.accent, slots: d.slots, initials: d.initials });
    expect(decodeBadge(encodeBadge(newDesign()))).toEqual(newDesign());
    expect(decodeBadge('MCB-ZZZZZZZZ')).toBe(null);
    expect(decodeBadge('hello')).toBe(null);
  });
});

describe('badge copy rules', () => {
  it('has no em dashes or banned phrasing', () => {
    for (const f of ['index.js', 'design.js', 'levels.js', 'printsim.js', 'code.js', 'svg.js', 'scene.js', 'initials.js']) {
      const t = readFileSync(`src/stations/badge/${f}`, 'utf8');
      expect(t, f).not.toMatch(/—/);
      expect(t, f).not.toMatch(/not just/i);
      expect(t, f).not.toMatch(/scholastic|magic school bus/i);
    }
  });
});
