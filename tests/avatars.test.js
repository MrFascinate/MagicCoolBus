import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseRoster } from '../src/avatars/roster.js';
import { PLACEHOLDERS, buildPlaceholder, placeholderAnimator } from '../src/avatars/placeholder.js';

const dir = new URL('../public/assets/avatars/', import.meta.url);
const hasRoster = existsSync(new URL('avatars.json', dir));
const json = hasRoster ? JSON.parse(readFileSync(new URL('avatars.json', dir), 'utf8')) : [];

const parse = (file) => new Promise((resolve, reject) => {
  const buf = readFileSync(new URL(file, dir));
  new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject);
});

describe('avatar roster', () => {
  it('parses avatars.json and rejects bad input', () => {
    expect(parseRoster('nope')).toBeNull();
    expect(parseRoster([{ id: 1 }])).toBeNull();
    const r = parseRoster([{ id: 'a', file: 'a.glb', portrait: 'a.webp', height_m: 1.6, label: 'A' }]);
    expect(r[0]).toMatchObject({ id: 'a', file: 'assets/avatars/a.glb', portrait: 'assets/avatars/a.webp', height_m: 1.6 });
  });

  it('ships a placeholder set with idle, walk, cheer and dance', () => {
    expect(PLACEHOLDERS.length).toBe(3);
    for (const p of PLACEHOLDERS) {
      const rig = buildPlaceholder(p);
      const anim = placeholderAnimator(rig);
      for (const c of ['idle', 'walk', 'cheer', 'dance']) { anim.play(c); anim.update(0.1); expect(anim.clip).toBe(c); }
      const box = new THREE.Box3().setFromObject(rig.root);
      expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
      expect(box.max.y).toBeGreaterThan(1.3);
    }
  });
});

describe.runIf(hasRoster)('real characters', () => {
  it('lists 8 characters whose files exist', () => {
    const r = parseRoster(json);
    expect(r.length).toBe(8);
    for (const e of json) {
      expect(existsSync(new URL(e.file, dir))).toBe(true);
      expect(existsSync(new URL(e.portrait, dir))).toBe(true);
      expect(e.portrait).toMatch(/\.webp$/);
    }
  });

  for (const e of json) {
    it(`${e.id}: clips bind, feet at 0, height matches, no root drift`, async () => {
      const g = await parse(e.file);
      const names = g.animations.map((a) => a.name).sort();
      expect(names).toEqual(['cheer', 'dance', 'idle', 'walk']);
      const bones = [];
      g.scene.traverse((o) => { if (o.isBone) bones.push(o.name); });
      expect(bones.length).toBe(12);
      // three.js sanitises dotted names: upper_arm.L -> upper_armL
      expect(bones).toContain('upper_armL');
      for (const c of g.animations) for (const t of c.tracks) {
        expect(g.scene.getObjectByName(t.name.split('.')[0]), `${c.name} ${t.name}`).toBeTruthy();
      }
      g.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(g.scene);
      expect(Math.abs(box.min.y)).toBeLessThan(0.03);
      expect(Math.abs(box.max.y - e.height_m)).toBeLessThan(0.05);
      // walk should play in place (the game moves the avatar)
      const walk = g.animations.find((a) => a.name === 'walk');
      const rootPos = walk.tracks.find((t) => t.name === 'root.position');
      if (rootPos) {
        const v = rootPos.values;
        const dz = Math.abs(v[v.length - 1] - v[2]), dx = Math.abs(v[v.length - 3] - v[0]);
        expect(Math.max(dx, dz)).toBeLessThan(0.05);
      }
    });
  }
});
