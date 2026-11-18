// Walk stride check: node scripts/measure-stride.mjs [avatar dir/]
// For each avatar, tracks one mid-sole vertex per foot through the walk clip.
// While that vertex is on the floor it slides backward at the speed the body
// should move forward; that speed times the loop length is the metres one walk
// loop covers (WALK_CYCLE_M in src/avatars/roster.js, for a 1.59 m character).
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { NodeDracoLoader } from '../tests/helpers/node-draco.js';

const dir = process.argv[2] || 'public/assets/avatars/';
const json = JSON.parse(readFileSync(dir + 'avatars.json', 'utf8'));
const L = new GLTFLoader(); L.setDRACOLoader(new NodeDracoLoader());
const all = [];
for (const e of json) {
  const buf = readFileSync(dir + e.file);
  const g = await new Promise((res, rej) => L.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej));
  const meshes = []; g.scene.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
  g.scene.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  // each frame, the lowest vertex of each foot is the contact point; when the same
  // vertex stays lowest and on the floor across two frames, its z speed is a sample
  const sideOf = (x) => (x > 0.02 ? 'L' : x < -0.02 ? 'R' : null);
  const clip = g.animations.find((a) => a.name === 'walk');
  const mixer = new THREE.AnimationMixer(g.scene);
  mixer.clipAction(clip).play();
  const N = 240, dur = clip.duration;
  const prev = { L: null, R: null };
  const speeds = [];
  for (let i = 0; i <= N; i++) {
    mixer.setTime((i / N) * dur); g.scene.updateMatrixWorld(true);
    const low = { L: { y: 1e9 }, R: { y: 1e9 } };
    for (const m of meshes) {
      const pos = m.geometry.attributes.position;
      for (let k = 0; k < pos.count; k++) {
        m.getVertexPosition(k, v);
        if (v.y > 0.3) continue; // cheap skip (model space is close to world here)
        v.applyMatrix4(m.matrixWorld);
        const s = sideOf(v.x);
        if (s && v.y < low[s].y) low[s] = { y: v.y, z: v.z, id: m.id * 1e6 + k };
      }
    }
    for (const s of ['L', 'R']) {
      const p = prev[s], c = low[s];
      if (p && p.id === c.id && c.y < 0.006 && p.y < 0.006) speeds.push((p.z - c.z) / (dur / N));
      prev[s] = c;
    }
  }
  speeds.sort((a, b) => a - b);
  const vmed = speeds[Math.floor(speeds.length / 2)];
  const loop = vmed * dur, norm = loop * 1.59 / e.height_m;
  all.push(norm);
  console.log(`${e.id} h=${e.height_m} planted samples=${speeds.length} foot speed=${vmed.toFixed(3)} m/s  loop=${loop.toFixed(3)} m  at 1.59 m: ${norm.toFixed(3)} m`);
}
all.sort((a, b) => a - b);
console.log(`median metres per loop at 1.59 m: ${all[Math.floor(all.length / 2)].toFixed(3)} (range ${all[0].toFixed(3)} to ${all[all.length - 1].toFixed(3)})`);
