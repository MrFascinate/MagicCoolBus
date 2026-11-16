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
 * Measured from avatar_03's walk: each foot travels about 0.58 m per step, two steps a loop. */
export const WALK_CYCLE_M = 1.16;

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
