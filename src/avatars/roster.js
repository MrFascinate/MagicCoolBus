import * as THREE from 'three';
import { loadGLTF } from '../core/loaders.js';
import { PLACEHOLDERS, buildPlaceholder, placeholderAnimator, placeholderPortrait } from './placeholder.js';

/**
 * Character roster. Reads assets/avatars/avatars.json if it exists:
 *   [{ id, file, portrait, height_m, label }]
 * Each GLB has one skeleton, animations idle, walk, cheer, dance,
 * faces +Z and has feet at y = 0. Without that file the built-in
 * placeholder set is used through the same interface.
 */

/**
 * @typedef {Object} RosterEntry
 * @property {string} id
 * @property {string} label
 * @property {string} portrait   image URL
 * @property {number} height_m
 * @property {string|null} file  GLB URL, or null for a placeholder
 */
/**
 * @typedef {Object} Avatar
 * @property {THREE.Object3D} root
 * @property {(name:'idle'|'walk'|'cheer'|'dance')=>void} play
 * @property {(dt:number)=>void} update
 * @property {(mps:number)=>void} [setSpeed]  ground speed in m/s; the walk loop plays fast enough that feet do not slide
 * @property {number} height
 */

const BASE = 'assets/avatars/';

/** Metres one loop of the walk clip covers at timeScale 1, for a 1.59 m character.
 * Measured on the v2 characters with scripts/measure-stride.mjs (planted-foot speed
 * times loop length): 1.31 to 1.34 m across all ten once scaled to 1.59 m, median 1.33.
 * (The v1 set measured 1.14 with the same script; the old constant was 1.16.) */
export const WALK_CYCLE_M = 1.33;

/** Walk clip timeScale for a ground speed; taller characters take longer steps. */
export function walkRate(mps, height = 1.59) {
  return mps / (WALK_CYCLE_M * (height / 1.59));
}

/** Validate a parsed avatars.json. Exported for tests. */
export function parseRoster(json) {
  if (!Array.isArray(json)) return null;
  const out = [];
  for (const e of json) {
    if (!e || typeof e.id !== 'string' || typeof e.file !== 'string') continue;
    out.push({
      id: e.id,
      label: typeof e.label === 'string' ? e.label : e.id,
      portrait: typeof e.portrait === 'string' ? BASE + e.portrait : '',
      height_m: Number(e.height_m) > 0 ? Number(e.height_m) : 1.5,
      file: BASE + e.file,
    });
  }
  return out.length ? out : null;
}

/** @returns {Promise<RosterEntry[]>} */
export async function loadRoster() {
  try {
    const res = await fetch(BASE + 'avatars.json', { cache: 'no-cache' });
    if (res.ok) {
      const txt = await res.text();
      const parsed = parseRoster(JSON.parse(txt)); // throws on an HTML fallback page
      if (parsed) return parsed;
    }
  } catch {
    /* no roster file: use placeholders */
  }
  return PLACEHOLDERS.map((p) => ({ id: p.id, label: p.label, portrait: placeholderPortrait(p), height_m: p.height_m, file: null }));
}

/**
 * @param {RosterEntry} entry
 * @param {{reduced:boolean}} opts
 * @returns {Promise<Avatar>}
 */
export async function createAvatar(entry, opts) {
  if (!entry.file) {
    const def = PLACEHOLDERS.find((p) => p.id === entry.id) || PLACEHOLDERS[0];
    const rig = buildPlaceholder(def);
    const anim = placeholderAnimator(rig, opts.reduced);
    return { root: rig.root, play: anim.play, update: anim.update, setSpeed: anim.setSpeed, height: def.height_m };
  }
  const gltf = await loadGLTF(entry.file);
  const root = new THREE.Group();
  const model = gltf.scene;
  root.add(model);
  const box = new THREE.Box3().setFromObject(model);
  const hgt = box.max.y - box.min.y;
  if (hgt > 0 && Math.abs(hgt - entry.height_m) / entry.height_m > 0.05) model.scale.setScalar(entry.height_m / hgt);
  mergeSkinnedParts(model);
  model.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  const mixer = new THREE.AnimationMixer(model);
  const actions = {};
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  // cheer plays once, then the avatar goes back to idle
  if (actions.cheer) { actions.cheer.setLoop(THREE.LoopOnce, 1); actions.cheer.clampWhenFinished = true; }
  let current = null;
  const play = (name) => {
    const next = actions[name] || actions.idle;
    if (!next || next === current) return;
    next.reset().setEffectiveWeight(1).play();
    if (current) current.crossFadeTo(next, 0.2, false);
    current = next;
  };
  mixer.addEventListener('finished', (e) => { if (e.action === actions.cheer && current === actions.cheer) play('idle'); });
  // Note: three.js strips dots from node names (upper_arm.L becomes upper_armL)
  // in both bones and animation tracks, so clips bind without any renaming here.
  play('idle');
  const setSpeed = (mps) => { if (actions.walk) actions.walk.timeScale = walkRate(mps, entry.height_m); };
  return { root, play, update: (dt) => mixer.update(dt), setSpeed, height: entry.height_m };
}

/**
 * The v2 characters are flat coloured, with one glTF primitive per colour
 * (about 20), which three.js draws as about 20 draw calls per character.
 * Fold parts that share the same skeleton and surface settings into one mesh,
 * carrying each part's colour as a vertex colour, so the look is unchanged
 * (colours are exact; each part's roughness goes into a tiny roughness map,
 * one texel per value, read through a per-vertex uv; metalness and sidedness group the parts).
 * Parts with textures, transparency or emissive light are left alone.
 * The GLB itself is not changed. Exported for tests.
 * @param {THREE.Object3D} model
 * @returns {number} draw calls saved
 */
export function mergeSkinnedParts(model) {
  /** @type {Map<string, THREE.SkinnedMesh[]>} */
  const groups = new Map();
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (!o.isSkinnedMesh || Array.isArray(o.material)) return;
    const m = o.material;
    const g = o.geometry;
    if (!m.isMeshStandardMaterial || m.map || m.roughnessMap || m.metalnessMap || m.aoMap || m.transparent || m.alphaTest > 0 || m.vertexColors || m.normalMap) return;
    if (m.emissive && (m.emissive.r || m.emissive.g || m.emissive.b)) return;
    if (!g.index || !g.attributes.position || !g.attributes.normal || !g.attributes.skinIndex || !g.attributes.skinWeight) return;
    if (Object.keys(g.morphAttributes).length) return;
    const key = [o.parent?.uuid, o.skeleton.uuid, m.metalness.toFixed(3), m.side, m.flatShading,
      o.matrix.elements.map((x) => x.toFixed(5)).join(','), o.bindMatrix.elements.map((x) => x.toFixed(5)).join(',')].join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  });
  let saved = 0;
  for (const parts of groups.values()) {
    if (parts.length < 2) continue;
    const first = parts[0];
    let nv = 0, ni = 0;
    for (const p of parts) { nv += p.geometry.attributes.position.count; ni += p.geometry.index.count; }
    const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3);
    const si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), uv = new Float32Array(nv * 2);
    const rough = [...new Set(parts.map((p) => Math.round(p.material.roughness * 255)))];
    const tex = new Uint8Array(rough.length * 4);
    rough.forEach((r, i) => { tex[i * 4] = 255; tex[i * 4 + 1] = r; tex[i * 4 + 2] = 0; tex[i * 4 + 3] = 255; });
    const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
    let vo = 0, io = 0;
    for (const p of parts) {
      const g = p.geometry, a = g.attributes, n = a.position.count, c = p.material.color;
      const u = (rough.indexOf(Math.round(p.material.roughness * 255)) + 0.5) / rough.length;
      for (let i = 0; i < n; i++) {
        const v = vo + i;
        pos[v * 3] = a.position.getX(i); pos[v * 3 + 1] = a.position.getY(i); pos[v * 3 + 2] = a.position.getZ(i);
        nor[v * 3] = a.normal.getX(i); nor[v * 3 + 1] = a.normal.getY(i); nor[v * 3 + 2] = a.normal.getZ(i);
        col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        uv[v * 2] = u; uv[v * 2 + 1] = 0.5;
        si[v * 4] = a.skinIndex.getX(i); si[v * 4 + 1] = a.skinIndex.getY(i); si[v * 4 + 2] = a.skinIndex.getZ(i); si[v * 4 + 3] = a.skinIndex.getW(i);
        sw[v * 4] = a.skinWeight.getX(i); sw[v * 4 + 1] = a.skinWeight.getY(i); sw[v * 4 + 2] = a.skinWeight.getZ(i); sw[v * 4 + 3] = a.skinWeight.getW(i);
      }
      const ix = g.index;
      for (let k = 0; k < ix.count; k++) idx[io + k] = ix.getX(k) + vo;
      vo += n; io += ix.count;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = first.material.clone();
    mat.color.setRGB(1, 1, 1);
    mat.vertexColors = true;
    if (rough.length > 1) {
      // roughness map: green channel times material.roughness (1)
      const map = new THREE.DataTexture(tex, rough.length, 1, THREE.RGBAFormat);
      map.magFilter = map.minFilter = THREE.NearestFilter;
      map.generateMipmaps = false;
      map.colorSpace = THREE.NoColorSpace;
      map.needsUpdate = true;
      mat.roughnessMap = map;
      mat.roughness = 1;
    } else {
      mat.roughness = rough[0] / 255;
    }
    mat.name = 'avatar_merged';
    const mesh = new THREE.SkinnedMesh(geo, mat);
    mesh.name = `${first.name}_merged`;
    mesh.position.copy(first.position); mesh.quaternion.copy(first.quaternion); mesh.scale.copy(first.scale);
    first.parent.add(mesh);
    mesh.updateMatrixWorld(true);
    mesh.bind(first.skeleton, first.bindMatrix);
    geo.computeBoundingSphere();
    for (const p of parts) { p.removeFromParent(); p.geometry.dispose(); p.material.dispose(); }
    mesh.userData.mergedParts = parts.length;
    saved += parts.length - 1;
  }
  return saved;
}
