import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGLTF } from '../core/loaders.js';
import { NavGrid } from './nav.js';
import { REQUIRED_MARKERS, STATION_IDS } from './markers.js';

/**
 * Objects kept as separate nodes (markers, rings, and props that stations
 * hide or move). Everything else is merged by material to cut draw calls,
 * which matters most on low-end Chromebooks.
 */
export const KEEP = /^(walk_area|ring_|station_|cam_|spawn_|pad_|drone_start|stage_center|CAGE_|MCB_Pad|MCB_Cage|DR_|arm_base$|part_tray$|bin_\d$|barrier_\d$|holo_center$|print_bed$|MCB_AR_(Table|Top)$|MCB_SideCanopy$|MCB_CanopyLight\d$|MCB_Logo_Canopy$|MCB_Scope_Tube$|RB_(J1|Base|Part|Bin\d|Barrier|Tray)$)/;

/**
 * @typedef {Object} Hub
 * @property {THREE.Group} root
 * @property {NavGrid} nav
 * @property {(name:string)=>THREE.Object3D|null} get
 * @property {(name:string)=>THREE.Vector3} pos  world position of a marker
 * @property {(id:string)=>{position:THREE.Vector3, quaternion:THREE.Quaternion}} camPose
 * @property {(names:string[], visible:boolean)=>void} setVisible
 * @property {string[]} missing  required marker names not found
 * @property {number} drawCalls  approximate mesh count after merging
 */

function keepNode(o) {
  for (let p = o; p; p = p.parent) if (p.name && KEEP.test(p.name)) return true;
  return false;
}

/** Cheaper material with the same look for flat-coloured assets. */
function toLambert(mat, cache) {
  if (cache.has(mat)) return cache.get(mat);
  const l = new THREE.MeshLambertMaterial({
    name: mat.name,
    color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
    map: mat.map || null,
    emissive: mat.emissive ? mat.emissive.clone() : new THREE.Color(0),
    emissiveMap: mat.emissiveMap || null,
    emissiveIntensity: mat.emissiveIntensity ?? 1,
    transparent: mat.transparent,
    opacity: mat.opacity,
    alphaTest: mat.alphaTest,
    side: mat.side,
    vertexColors: mat.vertexColors,
    depthWrite: mat.depthWrite,
  });
  cache.set(mat, l);
  return l;
}

function geomKey(g) {
  const names = Object.keys(g.attributes).sort();
  return names.map((n) => {
    const a = g.attributes[n];
    return `${n}:${a.itemSize}:${a.array.constructor.name}:${a.normalized ? 1 : 0}`;
  }).join('|') + (g.index ? '|i' : '|n') + `|m${Object.keys(g.morphAttributes).length}`;
}

/**
 * @param {(fraction:number)=>void} onProgress
 * @returns {Promise<Hub>}
 */
export async function loadHub(onProgress) {
  const gltf = await loadGLTF('assets/hub.glb', onProgress);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // Group mergeable meshes by material and attribute layout.
  const matCache = new Map();
  /** @type {Map<string, {mat:THREE.Material, geos:THREE.BufferGeometry[]}>} */
  const groups = new Map();
  const toRemove = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (keepNode(o)) {
      if (!Array.isArray(o.material)) o.material = toLambert(o.material, matCache);
      return;
    }
    if (o.isSkinnedMesh || o.isInstancedMesh || Array.isArray(o.material) || !o.visible) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    const mat = toLambert(o.material, matCache);
    const key = mat.uuid + '#' + geomKey(g);
    if (!groups.has(key)) groups.set(key, { mat, geos: [] });
    groups.get(key).geos.push(g);
    toRemove.push(o);
  });
  for (const o of toRemove) {
    o.removeFromParent();
    o.geometry.dispose();
  }
  const merged = new THREE.Group();
  merged.name = 'hub_merged';
  for (const { mat, geos } of groups.values()) {
    const g = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    if (!g) continue;
    for (const x of geos) if (x !== g) x.dispose();
    const mesh = new THREE.Mesh(g, mat);
    mesh.matrixAutoUpdate = false;
    merged.add(mesh);
  }
  // Drop empty branches left behind, keeping named markers.
  const empties = [];
  root.traverse((o) => { if (o !== root && !o.isMesh && o.children.length === 0 && !keepNode(o) && !o.isLight && !o.isCamera) empties.push(o); });
  for (const o of empties) o.removeFromParent();
  root.add(merged);
  root.traverse((o) => { if (o.isLight) o.visible = false; });

  /** @type {Map<string, THREE.Object3D>} */
  const nodes = new Map();
  root.traverse((o) => { if (o.name && !nodes.has(o.name)) nodes.set(o.name, o); });
  // GLTFLoader strips dots and other reserved characters from node names
  // (MCB_CageBeam-4.45 becomes MCB_CageBeam-445), so look up the same way.
  const clean = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
  const byName = { get: (n) => nodes.get(clean(n)), has: (n) => nodes.has(clean(n)) };
  const missing = REQUIRED_MARKERS.filter((n) => !byName.has(n));

  // Navigation from walk_area, which is then hidden.
  const walk = byName.get('walk_area');
  let nav;
  if (walk) {
    walk.updateMatrixWorld(true);
    const positions = [];
    const indices = [];
    walk.traverse((o) => {
      if (!o.isMesh) return;
      const base = positions.length / 3;
      const pa = o.geometry.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrixWorld); positions.push(v.x, v.y, v.z); }
      if (o.geometry.index) for (const i of o.geometry.index.array) indices.push(base + i);
      else for (let i = 0; i < pa.count; i++) indices.push(base + i);
    });
    nav = NavGrid.fromTriangles(positions, indices, 0.25);
    walk.visible = false;
  } else {
    // Fallback: a plain rectangle so the game still runs.
    nav = NavGrid.fromTriangles([-20, 0, 2, 20, 0, 2, 20, 0, 15, -20, 0, 2, 20, 0, 15, -20, 0, 15], null, 0.25);
  }

  const tmpQ = new THREE.Quaternion();
  const camFix = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  const hub = {
    root,
    nav,
    missing,
    drawCalls: 0,
    get: (name) => byName.get(name) || null,
    pos(name) {
      const o = byName.get(name);
      const v = new THREE.Vector3();
      if (o) o.getWorldPosition(v);
      return v;
    },
    /**
     * cam_ markers are Blender empties. Blender's camera view axis (-Z) arrives
     * in three.js as the empty's local -Y, so rotate by -90 degrees about X.
     */
    camPose(id) {
      const o = byName.get(`cam_${id}`);
      const position = new THREE.Vector3();
      const quaternion = new THREE.Quaternion();
      if (o) {
        o.getWorldPosition(position);
        o.getWorldQuaternion(tmpQ);
        quaternion.copy(tmpQ).multiply(camFix);
      }
      return { position, quaternion };
    },
    setVisible(names, visible) {
      for (const n of names) { const o = byName.get(n); if (o) o.visible = visible; }
    },
  };
  let calls = 0;
  root.traverse((o) => { if (o.isMesh && o.visible) calls++; });
  hub.drawCalls = calls;
  return hub;
}

export { STATION_IDS };
