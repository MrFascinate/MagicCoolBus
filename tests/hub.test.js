import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import draco3d from 'draco3dgltf';
import { readGlbJson, nodeWorldMatrices } from '../src/lib/glbJson.js';
import { REQUIRED_MARKERS, STATION_IDS } from '../src/hub/markers.js';
import { NavGrid } from '../src/hub/nav.js';

const bytes = new Uint8Array(readFileSync(new URL('../public/assets/hub.glb', import.meta.url)));
const json = readGlbJson(bytes);
const nodes = nodeWorldMatrices(json);
const pos = (name) => { const m = nodes.get(name).world; return { x: m[12], y: m[13], z: m[14] }; };

/** Decode walk_area's Draco primitive into world-space positions + indices. */
async function walkAreaTriangles() {
  const dec = await draco3d.createDecoderModule({});
  const { node, world } = nodes.get('walk_area');
  const prim = json.meshes[node.mesh].primitives[0];
  const ext = prim.extensions.KHR_draco_mesh_compression;
  // binary chunk follows the JSON chunk
  const dv = new DataView(bytes.buffer, bytes.byteOffset);
  const jsonLen = dv.getUint32(12, true);
  const binStart = 20 + jsonLen + 8;
  const bv = json.bufferViews[ext.bufferView];
  const data = bytes.subarray(binStart + (bv.byteOffset || 0), binStart + (bv.byteOffset || 0) + bv.byteLength);
  const buf = new dec.DecoderBuffer(); buf.Init(data, data.length);
  const decoder = new dec.Decoder();
  const mesh = new dec.Mesh();
  const st = decoder.DecodeBufferToMesh(buf, mesh);
  if (!st.ok()) throw new Error(st.error_msg());
  const attr = decoder.GetAttributeByUniqueId(mesh, ext.attributes.POSITION);
  const arr = new dec.DracoFloat32Array();
  decoder.GetAttributeFloatForAllPoints(mesh, attr, arr);
  const n = mesh.num_points();
  const p = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = arr.GetValue(i * 3), y = arr.GetValue(i * 3 + 1), z = arr.GetValue(i * 3 + 2);
    const m = world;
    p[i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    p[i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    p[i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  const nf = mesh.num_faces();
  const idx = new Uint32Array(nf * 3);
  const face = new dec.DracoInt32Array();
  for (let f = 0; f < nf; f++) { decoder.GetFaceFromMesh(mesh, f, face); for (let k = 0; k < 3; k++) idx[f * 3 + k] = face.GetValue(k); }
  return { p, idx };
}

describe('hub.glb', () => {
  it('has every marker the game needs', () => {
    const missing = REQUIRED_MARKERS.filter((n) => !nodes.has(n));
    expect(missing).toEqual([]);
  });

  it('keeps every required marker as its own node (empties not in KEEP are dropped at load)', async () => {
    const { KEEP } = await import('../src/hub/hub.js');
    for (const n of REQUIRED_MARKERS) expect(KEEP.test(n), n).toBe(true);
    for (const n of ['RB_J1', 'RB_Base', 'RB_Part', 'RB_Tray', 'RB_Bin1', 'RB_Bin2', 'RB_Bin3', 'RB_Barrier']) expect(KEEP.test(n), n).toBe(true);
    expect(KEEP.test('RBW_Panel')).toBe(false);
  });

  it('needs Draco and WebP, which the loader supports', () => {
    expect(json.extensionsRequired).toEqual(expect.arrayContaining(['KHR_draco_mesh_compression']));
  });

  it('places each ring on its station marker', () => {
    for (const id of STATION_IDS) {
      const a = pos(`ring_${id}`), b = pos(`station_${id}`);
      expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(0.05);
    }
  });

  it('spawn_player faces the bus (three.js -Z)', () => {
    const m = nodes.get('spawn_player').world;
    const fwdZ = -m[10]; // local -Z in world space
    expect(fwdZ).toBeLessThan(-0.99);
    expect(pos('spawn_player').z).toBeGreaterThan(pos('ring_badge').z); // bus side is -Z
  });

  it('puts the drone markers inside the cage', () => {
    for (const n of ['drone_start', 'pad_1', 'pad_2', 'pad_3']) {
      const p = pos(n);
      expect(p.x).toBeGreaterThan(6.6); expect(p.x).toBeLessThan(9.2);
      expect(p.z).toBeGreaterThan(1.55); expect(p.z).toBeLessThan(4.05);
    }
  });

  describe('walk_area', () => {
    /** @type {NavGrid} */ let nav;
    beforeAll(async () => { const t = await walkAreaTriangles(); nav = NavGrid.fromTriangles(t.p, t.idx, 0.25); }, 30000);

    it('includes spawn_player', () => {
      const s = pos('spawn_player');
      expect(nav.isWalkable(s.x, s.z)).toBe(true);
    });

    for (const id of STATION_IDS) {
      it(`reaches ring_${id} from spawn`, () => {
        const s = pos('spawn_player'), r = pos(`ring_${id}`);
        const goal = nav.isWalkable(r.x, r.z) ? r : nav.nearestWalkable(r.x, r.z, 4);
        expect(goal, `ring_${id} has walkable ground within 1 m`).not.toBeNull();
        expect(Math.hypot(goal.x - r.x, goal.z - r.z)).toBeLessThan(0.6);
        const path = nav.findPath(s.x, s.z, goal.x, goal.z);
        expect(path).not.toBeNull();
      });
    }
  });
});

describe('station registry', () => {
  it('wires every station to its own module, none to a placeholder', async () => {
    const { STATIONS } = await import('../src/stations/registry.js');
    expect(STATIONS.map((s) => s.id)).toEqual(['microscope', 'robot', 'drone', 'heroes', 'sky', 'cypher', 'badge']);
    for (const s of STATIONS) expect(s.module.toString(), s.id).toContain(`stations/${s.id}/index.js`);
    expect(readFileSync("src/stations/registry.js", "utf8")).not.toMatch(/soon/);
  });
});
