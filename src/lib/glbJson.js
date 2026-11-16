/**
 * Minimal GLB reader for Node tests and tools: returns the JSON chunk and
 * world matrices for every node (no mesh decoding needed).
 */

/** @param {Uint8Array} bytes @returns {any} */
export function readGlbJson(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  const len = dv.getUint32(12, true);
  const type = dv.getUint32(16, true);
  if (type !== 0x4e4f534a) throw new Error('First chunk is not JSON');
  return JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + len)));
}

/** column-major 4x4 multiply */
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

function localMatrix(n) {
  if (n.matrix) return n.matrix.slice();
  const [x, y, z, w] = n.rotation || [0, 0, 0, 1];
  const [sx, sy, sz] = n.scale || [1, 1, 1];
  const [tx, ty, tz] = n.translation || [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

/**
 * @param {any} json glTF JSON
 * @returns {Map<string,{index:number, world:number[], node:any}>}
 */
export function nodeWorldMatrices(json) {
  const out = new Map();
  const scene = json.scenes[json.scene || 0];
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const walk = (i, parent) => {
    const n = json.nodes[i];
    const w = mul(parent, localMatrix(n));
    out.set(n.name || `node_${i}`, { index: i, world: w, node: n });
    for (const c of n.children || []) walk(c, w);
  };
  for (const r of scene.nodes) walk(r, I);
  return out;
}
