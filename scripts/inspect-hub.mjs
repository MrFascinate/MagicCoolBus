import { readFileSync } from 'node:fs';
import { readGlbJson, nodeWorldMatrices } from '../src/lib/glbJson.js';
const json = readGlbJson(new Uint8Array(readFileSync(process.argv[2] || 'public/assets/hub.glb')));
const nodes = nodeWorldMatrices(json);
const re = process.argv[3] ? new RegExp(process.argv[3], 'i') : /^(spawn|walk|station_|cam_|ring_|drone|pad_|stage|cage|net|flight)/i;
const f = (a) => a.map((x) => x.toFixed(2)).join(',');
for (const [name, { world: m, node }] of nodes) {
  if (!re.test(name)) continue;
  let bb = '';
  if (node.mesh !== undefined) {
    const mesh = json.meshes[node.mesh];
    const acc = json.accessors[mesh.primitives[0].attributes.POSITION];
    bb = ' localbb ' + f(acc.min) + ' .. ' + f(acc.max) + ' prims ' + mesh.primitives.length;
  }
  const sc = [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])];
  console.log(name.padEnd(24), 'pos', f([m[12], m[13], m[14]]), '-Zaxis', f([-m[8], -m[9], -m[10]]), 'Yaxis', f([m[4], m[5], m[6]]), 'scale', f(sc), bb, node.extras ? JSON.stringify(node.extras) : '');
}
console.log('nodes', json.nodes.length, 'meshes', json.meshes.length, 'ext', json.extensionsRequired);
