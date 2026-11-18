import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { parseRoster, mergeSkinnedParts } from '../src/avatars/roster.js';
import { PLACEHOLDERS, buildPlaceholder, placeholderAnimator } from '../src/avatars/placeholder.js';
import { NodeDracoLoader } from './helpers/node-draco.js';

const dir = new URL('../public/assets/avatars/', import.meta.url);
const hasRoster = existsSync(new URL('avatars.json', dir));
const json = hasRoster ? JSON.parse(readFileSync(new URL('avatars.json', dir), 'utf8')) : [];

const parse = (file) => new Promise((resolve, reject) => {
  const buf = readFileSync(new URL(file, dir));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(new NodeDracoLoader()); // the v2 characters are Draco compressed
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject);
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
  it('lists 10 characters whose files exist, with avatar_01 to avatar_10 in order', () => {
    const r = parseRoster(json);
    expect(r.length).toBe(10);
    expect(json.map((e) => e.id)).toEqual(Array.from({ length: 10 }, (_, i) => `avatar_${String(i + 1).padStart(2, '0')}`));
    for (const e of json) {
      expect(existsSync(new URL(e.file, dir))).toBe(true);
      expect(existsSync(new URL(e.portrait, dir))).toBe(true);
      expect(e.portrait).toMatch(/\.webp$/);
      expect(e.label).toMatch(/\S/);
      // a light enough file for phones (v2 files are about 150 KB)
      expect(readFileSync(new URL(e.file, dir)).length).toBeLessThan(250 * 1024);
    }
  });

  it('keeps every character id an old save may hold (avatar_01 to avatar_08)', () => {
    const ids = new Set(json.map((e) => e.id));
    for (let i = 1; i <= 8; i++) expect(ids.has(`avatar_0${i}`)).toBe(true);
  });

  for (const e of json) {
    it(`${e.id}: clips bind, feet at 0, height matches, no root drift`, async () => {
      const g = await parse(e.file);
      const names = g.animations.map((a) => a.name).sort();
      expect(names).toEqual(['cheer', 'dance', 'idle', 'walk']);
      const bones = [];
      g.scene.traverse((o) => { if (o.isBone) bones.push(o.name); });
      expect(bones.length).toBe(12);
      expect(bones.sort()).toEqual(['forearmL', 'forearmR', 'head', 'hips', 'root', 'shinL', 'shinR', 'spine', 'thighL', 'thighR', 'upper_armL', 'upper_armR']);
      // the 24 fps clip lengths: idle 48 frames, walk 24, cheer 36, dance 96
      const len = Object.fromEntries(g.animations.map((a) => [a.name, Math.round(a.duration * 24)]));
      expect(len).toEqual({ idle: 48, walk: 24, cheer: 36, dance: 96 });
      let tris = 0;
      g.scene.traverse((o) => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      expect(tris).toBeGreaterThan(1000);
      expect(tris).toBeLessThan(16000);
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

  it('merging flat-coloured parts keeps every vertex where it was, in every clip (avatar_06)', async () => {
    const a = await parse('avatar_06.glb'), b = await parse('avatar_06.glb');
    let before = 0; a.scene.traverse((o) => { if (o.isSkinnedMesh) before++; });
    const saved = mergeSkinnedParts(b.scene);
    let after = 0; b.scene.traverse((o) => { if (o.isSkinnedMesh) after++; });
    expect(saved).toBeGreaterThan(5);
    expect(after).toBe(before - saved);
    expect(after).toBe(1); // all v2 parts share one skeleton and are opaque, so one draw call
    // each part keeps its own roughness through the little roughness map
    let mesh = null; b.scene.traverse((o) => { if (o.isSkinnedMesh) mesh = o; });
    const rmap = mesh.material.roughnessMap;
    expect(rmap).toBeTruthy();
    const want = new Set(); a.scene.traverse((o) => { if (o.isSkinnedMesh) want.add(Math.round(o.material.roughness * 255)); });
    const got = new Set(); for (let i = 0; i < rmap.image.width; i++) got.add(rmap.image.data[i * 4 + 1]);
    expect([...got].sort()).toEqual([...want].sort());
    // same triangles, and the same skinned shape at a few moments of each clip
    const tris = (s) => { let t = 0; s.traverse((o) => { if (o.isMesh) t += o.geometry.index.count / 3; }); return t; };
    expect(tris(b.scene)).toBe(tris(a.scene));
    const ma = new THREE.AnimationMixer(a.scene), mb = new THREE.AnimationMixer(b.scene);
    const v = new THREE.Vector3();
    const cloud = (s) => { const out = []; s.updateMatrixWorld(true); s.traverse((o) => { if (o.isSkinnedMesh) { const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += 1) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); out.push(Math.round(v.x * 1e4) + ',' + Math.round(v.y * 1e4) + ',' + Math.round(v.z * 1e4)); } } }); return out.sort(); };
    for (const name of ['walk', 'cheer', 'dance']) {
      ma.stopAllAction(); mb.stopAllAction();
      ma.clipAction(a.animations.find((c) => c.name === name)).play();
      mb.clipAction(b.animations.find((c) => c.name === name)).play();
      ma.setTime(0.37); mb.setTime(0.37);
      const ca = cloud(a.scene), cb = cloud(b.scene);
      expect(cb.length).toBe(ca.length);
      let diff = 0; for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) diff++;
      expect(diff / ca.length).toBeLessThan(0.01); // rounding at the 0.1 mm grid only
    }
  });
});
