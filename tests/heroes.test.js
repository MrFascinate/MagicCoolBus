import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import content from '../src/stations/heroes/content.json';
import { createLevelRun, starsFor, roundsFor, isUnlocked } from '../src/stations/heroes/logic.js';
import { readGlbJson } from '../src/lib/glbJson.js';

const glb = readGlbJson(new Uint8Array(readFileSync('public/assets/heroes/heroes.glb')));
const nodeNames = new Set(glb.nodes.map((n) => n.name));
const sources = readFileSync('src/stations/heroes/SOURCES.md', 'utf8');

describe('hologram heroes rounds', () => {
  it('has three levels of two rounds with the spec choice counts', () => {
    expect(content.levels.map((l) => [l.id, l.choices, l.wrongLimit])).toEqual([[1, 2, 1], [2, 3, 2], [3, 4, 2]]);
    for (const l of content.levels) {
      const rs = roundsFor(content, l.id);
      expect(rs).toHaveLength(2);
      for (const r of rs) {
        expect(r.choices).toHaveLength(l.choices);
        expect(new Set(r.choices).size).toBe(r.choices.length);
        expect(r.choices).toContain(r.answer);
      }
    }
  });

  it('a right first pick solves the round', () => {
    const run = createLevelRun(content, 1);
    expect(run.pick(run.round.answer)).toEqual({ result: 'right' });
    expect(run.solved).toBe(true);
    expect(run.wrongPicks).toBe(0);
  });

  it('a wrong pick shows what it solved, removes it and counts it', () => {
    const run = createLevelRun(content, 2);
    const wrong = run.round.choices.find((c) => c !== run.round.answer);
    const res = run.pick(wrong);
    expect(res.result).toBe('wrong');
    expect(res.solvedLine).toBe(content.props[wrong].solved);
    expect(run.isRemoved(wrong)).toBe(true);
    expect(run.remaining()).not.toContain(wrong);
    expect(run.pick(wrong)).toEqual({ result: 'ignored' });
    expect(run.wrongPicks).toBe(1);
    expect(run.pick(run.round.answer).result).toBe('right');
    expect(run.pick(run.round.answer).result).toBe('ignored');
  });

  it('next() resets removed choices and stops after the last round', () => {
    const run = createLevelRun(content, 3);
    expect(run.next()).toBe(false); // not solved yet
    run.pick(run.round.answer);
    expect(run.next()).toBe(true);
    expect(run.index).toBe(1);
    expect(run.remaining()).toHaveLength(4);
    run.pick(run.round.answer);
    expect(run.finished).toBe(true);
    expect(run.next()).toBe(false);
  });
});

describe('hologram heroes stars', () => {
  const l1 = content.levels[0], l3 = content.levels[2];
  it('follows 1 finish, 2 within limit, 3 all first pick', () => {
    expect(starsFor({ finished: false, wrongPicks: 0 }, l1).stars).toBe(0);
    expect(starsFor({ finished: true, wrongPicks: 0 }, l1).stars).toBe(3);
    expect(starsFor({ finished: true, wrongPicks: 1 }, l1).stars).toBe(2);
    expect(starsFor({ finished: true, wrongPicks: 2 }, l1).stars).toBe(1);
    expect(starsFor({ finished: true, wrongPicks: 2 }, l3).stars).toBe(2);
    expect(starsFor({ finished: true, wrongPicks: 3 }, l3).stars).toBe(1);
  });
  it('a full play with one wrong pick gives 2 stars on level 1', () => {
    const run = createLevelRun(content, 1);
    run.pick(run.round.choices.find((c) => c !== run.round.answer));
    run.pick(run.round.answer);
    run.next();
    run.pick(run.round.answer);
    expect(run.result()).toMatchObject({ stars: 2, finished: true, withinLimit: true, allFirst: false });
  });
  it('levels unlock in order', () => {
    expect(isUnlocked(1, () => 0)).toBe(true);
    expect(isUnlocked(2, () => 0)).toBe(false);
    expect(isUnlocked(2, (id) => (id === 1 ? 1 : 0))).toBe(true);
  });
});

describe('hologram heroes content', () => {
  it('every round and person names a prop that exists in heroes.glb', () => {
    for (const r of content.rounds) {
      for (const c of r.choices) expect(nodeNames.has(c), c).toBe(true);
      expect(content.props[r.answer]).toBeTruthy();
    }
    for (const id of Object.keys(content.props)) expect(nodeNames.has(id), id).toBe(true);
    for (const p of Object.values(content.people)) if (p.prop) expect(nodeNames.has(p.prop), p.prop).toBe(true);
    for (const n of ['holo_base', 'card_frame']) expect(nodeNames.has(n)).toBe(true);
  });

  it('uses the approved cast pairs', () => {
    const pairs = content.rounds.map((r) => [content.people[r.inventor].name, content.people[r.partner].name]);
    expect(pairs).toEqual(expect.arrayContaining([
      ['Ernst Ruska', 'Manu Prakash'], ['George Carruthers', 'Wanda Díaz-Merced'], ['George Devol', 'Ayanna Howard'],
      ['Stephanie Kwolek', 'Chuck Hull'], ['Patricia Bath', 'Ellen Ochoa'], ['Mária Telkes', 'Shuji Nakamura'],
    ]));
  });

  it('every person has a source entry in SOURCES.md', () => {
    for (const p of Object.values(content.people)) expect(sources.includes(`## ${p.name}`), p.name).toBe(true);
  });

  it('living people are marked permission pending, and nobody has a picture', () => {
    for (const p of Object.values(content.people)) {
      if (p.living) expect(p.permission).toBe('pending');
      expect(JSON.stringify(p)).not.toMatch(/\.(png|jpe?g|webp|gif|svg)\b|portrait|photo/i);
    }
  });

  it('inventor bios are two short paragraphs and credit co-inventors and teams', () => {
    for (const p of Object.values(content.people)) if (!p.living) expect(p.bio).toHaveLength(2);
    expect(content.people.ruska.bio.join(' ')).toMatch(/Max Knoll/);
    expect(content.people.prakash.work.join(' ')).toMatch(/Co-invented/);
    expect(content.people.prakash.work.join(' ')).toMatch(/James Cybulski and James Clements/);
    expect(content.people.carruthers.bio.join(' ')).toMatch(/led the team/);
    expect(content.people.diaz_merced.work.join(' ')).not.toMatch(/works at|professor at|employ/i);
    const all = JSON.stringify(content);
    expect(all).not.toMatch(/invented (it )?alone/i);
  });

  it('has no em dashes, no "not just" phrasing and no banned names', () => {
    const all = JSON.stringify(content) + readFileSync('src/stations/heroes/index.js', 'utf8');
    expect(all).not.toMatch(/—/);
    expect(all).not.toMatch(/not just/i);
    expect(all).not.toMatch(/scholastic|magic school bus/i);
  });

  it('keeps the doc "do not say" rules', () => {
    const all = JSON.stringify(content);
    expect(all).not.toMatch(/invented the (microscope|LED|light bulb)/i);
    expect(all).not.toMatch(/first robot\b/i);
    expect(all).not.toMatch(/laser eye surgery/i);
    expect(all).not.toMatch(/made the Moon landing possible/i);
    expect(all).not.toMatch(/bullet/i);
    expect(content.people.howard.work.join(' ')).toMatch(/president of Spelman College/i);
  });
});
