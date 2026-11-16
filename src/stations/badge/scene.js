import * as THREE from 'three';
import { partsFor, COLORS, PIECES } from './design.js';
import { orientVec } from './printsim.js';

/**
 * The 3D printer for Badge Builder: places printer.glb in the hub's print
 * cabinet, shows the badge on the bed, and plays the layer-by-layer print.
 */

/** Where printer.glb's frame stands, relative to print_bed: on the hub printer's own bed, clear of its gantry. */
const FRAME_OFFSET = new THREE.Vector3(-0.05, -0.015, 0.07);
const MM = 0.001;
const MAX_FAIL_CELLS = 2500;

export const PIECE_NAMES = [
  ...['circle', 'shield', 'hex', 'star'].map((s) => `badge_${s}`),
  ...['cell', 'gear', 'drone', 'spark', 'planet', 'wave'].map((s) => `emblem_${s}`),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => `letter_${c}`),
];

/** Patch a material so everything above a world height is cut away. */
function addClip(mat, uniform) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uClipY = uniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vClipWorldY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvClipWorldY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vClipWorldY;\nuniform float uClipY;')
      .replace('void main() {', 'void main() {\n  if (vClipWorldY > uClipY) discard;');
  };
  mat.customProgramCacheKey = () => 'mcb-badge-clip';
}

/** Label sprite for the droop warning. */
function makeWarning() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 140;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(70,10,24,0.94)';
  g.beginPath(); g.roundRect(6, 6, 628, 128, 24); g.fill();
  g.lineWidth = 6; g.strokeStyle = '#ff8fa6'; g.setLineDash([16, 10]); g.stroke();
  g.fillStyle = '#fff'; g.font = 'bold 44px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('Nothing holding this layer up', 320, 72);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.12, 0.026, 1);
  sp.renderOrder = 30;
  sp.visible = false;
  return { sp, tex, mat };
}

/**
 * @param {import('../registry.js').StationContext} ctx
 * @param {any} gltf printer.glb
 */
export function createPrinterScene(ctx, gltf) {
  const root = new THREE.Group();
  root.name = 'bb_root';
  const nodes = {};
  gltf.scene.traverse((o) => { if (o.name) nodes[o.name] = o; });
  const frame = nodes.printer_frame;
  const bed = nodes.print_bed;
  const gantry = nodes.print_gantry;
  const head = nodes.print_head;
  const bedMarker = ctx.hub.pos('print_bed');
  frame.removeFromParent();
  frame.position.copy(bedMarker).add(FRAME_OFFSET);
  frame.rotation.set(0, 0, 0);
  root.add(frame);
  // Cheaper materials for a low-end Chromebook.
  frame.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => { const n = new THREE.MeshLambertMaterial({ color: m.color, emissive: m.emissive, map: m.map || null }); m.dispose(); return n; };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
  const rest = { bedZ: bed.position.z, gantryY: gantry.position.y, headX: head.position.x };
  // Parked pose while not printing: head to the side and up, so the badge is in plain view.
  const PARK = { gantryUp: 0.07, headX: -0.13 };
  function park() { gantry.position.y = rest.gantryY + PARK.gantryUp; head.position.x = rest.headX + PARK.headX; bed.position.z = rest.bedZ; }
  park();
  // The hub's own printer holds a finished teal print (merged meshes with the
  // MCB_PrintTeal material) that sits where this printer stands. Hide it while
  // the station is open.
  const hubHidden = [];
  ctx.hub.root.traverse((o) => { if (o.isMesh && o.visible && o.material && o.material.name === 'MCB_PrintTeal') { o.visible = false; hubHidden.push(o); } });
  // Bed top: print_bed's origin is the top centre of the bed sheet.

  // Piece geometry (shared); the source nodes are hidden.
  const geos = {};
  for (const name of PIECE_NAMES) {
    const n = nodes[name];
    if (n && n.isMesh) { geos[name] = n.geometry; n.removeFromParent(); }
  }

  const clipY = { value: 1e9 };
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  const accentMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 1 });
  addClip(bodyMat, clipY);
  addClip(accentMat, clipY);

  const badge = new THREE.Group();
  badge.name = 'bb_badge';
  bed.add(badge);
  const content = new THREE.Group();
  badge.add(content);
  const meshPool = [];
  // a see-through copy of the whole design, so the part not printed yet (or
  // the part that drooped) can still be seen
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0xbfe6ff, transparent: true, opacity: 0.28, depthWrite: false });
  const ghost = new THREE.Group();
  ghost.visible = false;
  badge.add(ghost);

  // droop cells
  const cellGeo = new THREE.BoxGeometry(MM * 1.05, MM * 0.6, MM * 1.05);
  const cellMat = new THREE.MeshLambertMaterial({ color: 0xe0284f, emissive: 0x4a0010 });
  const failMesh = new THREE.InstancedMesh(cellGeo, cellMat, MAX_FAIL_CELLS);
  failMesh.count = 0;
  failMesh.visible = false;
  failMesh.frustumCulled = false;
  bed.add(failMesh);
  const warning = makeWarning();
  bed.add(warning.sp);

  // orientation basis (print coords -> bed-local metres)
  const vtmp = [0, 0, 0];
  const m4 = new THREE.Matrix4();
  const tmpObj = new THREE.Object3D();
  let current = null; // { sim, orientation, turn }
  let anim = null;

  function colorOf(id) { return (COLORS.find((c) => c.id === id) || COLORS[0]).hex; }

  /** print (X, Y, Z) mm -> bed-local metres (x, y, z) */
  function printToBed(X, Y, Z, out) { return out.set(X * MM, Z * MM, -Y * MM); }

  /**
   * Show a design on the bed in an orientation. `sim` is the simulate() result
   * for the same design and orientation (it gives the size and the offset).
   */
  function show(design, orientation, turn, sim) {
    bodyMat.color.set(colorOf(design.body));
    accentMat.color.set(colorOf(design.accent));
    // rebuild the meshes (geometry is shared, so this is cheap)
    for (const m of meshPool) m.removeFromParent();
    meshPool.length = 0;
    for (const p of partsFor(design)) {
      const g = geos[p.piece];
      if (!g) continue;
      const mesh = new THREE.Mesh(g, p.kind === 'body' ? bodyMat : accentMat);
      const thick = PIECES[p.piece].thick || 2;
      mesh.position.set(p.cx * MM, p.t0 * MM, -p.cy * MM);
      mesh.scale.set(p.s, p.th / thick, p.s);
      content.add(mesh);
      meshPool.push(mesh);
      const gm = new THREE.Mesh(g, ghostMat);
      gm.position.copy(mesh.position);
      gm.scale.copy(mesh.scale);
      ghost.add(gm);
      meshPool.push(gm);
    }
    // content frame is "glTF flat" (x, t, -y). Build the orientation matrix
    // column by column from the same math the print check uses.
    const col = (gx, gy, gz) => {
      orientVec(orientation, turn, gx, -gz, gy, vtmp);
      return new THREE.Vector3(vtmp[0], vtmp[2], -vtmp[1]); // unit axes, no mm scaling
    };
    const cx = col(1, 0, 0), cy = col(0, 1, 0), cz = col(0, 0, 1);
    m4.makeBasis(cx, cy, cz);
    badge.matrixAutoUpdate = false;
    // centre on the bed and set the lowest layer on the bed top
    const cX = (sim.min[0] + sim.max[0]) / 2, cY = (sim.min[1] + sim.max[1]) / 2, z0 = sim.min[2] - 0.5;
    const off = printToBed(-cX, -cY, -z0, new THREE.Vector3());
    m4.setPosition(off);
    badge.matrix.copy(m4);
    badge.matrixWorldNeedsUpdate = true;
    current = { sim, orientation, turn, cX, cY, z0 };
    clearFail();
    setClip(Infinity);
    setOpacity(1);
  }

  function bedTopWorld() {
    bed.updateMatrixWorld(true);
    return bed.getWorldPosition(new THREE.Vector3()).y;
  }

  function setClip(heightMm) {
    clipY.value = Number.isFinite(heightMm) ? bedTopWorld() + heightMm * MM : 1e9;
    ghost.visible = !!(Number.isFinite(heightMm) && current && heightMm < current.sim.heightMm);
  }
  function setOpacity(a) { bodyMat.opacity = a; accentMat.opacity = a; bodyMat.depthWrite = a > 0.99; accentMat.depthWrite = a > 0.99; }

  function clearFail() {
    failMesh.visible = false;
    failMesh.count = 0;
    warning.sp.visible = false;
  }

  /** Show the cells with nothing under them, sagging, plus the warning label. */
  function showFail(fail) {
    const cells = fail.cells;
    const step = Math.max(1, Math.ceil(cells.length / MAX_FAIL_CELLS));
    let n = 0;
    let sx = 0, sy = 0, maxZ = 0;
    for (let i = 0; i < cells.length && n < MAX_FAIL_CELLS; i += step) {
      const [X, Y, Z] = cells[i];
      printToBed(X - current.cX, Y - current.cY, Z - current.z0 - 0.9, tmpObj.position);
      tmpObj.rotation.set(0, 0, 0);
      tmpObj.updateMatrix();
      failMesh.setMatrixAt(n++, tmpObj.matrix);
      sx += X - current.cX; sy += Y - current.cY; maxZ = Math.max(maxZ, Z - current.z0);
    }
    failMesh.count = n;
    failMesh.instanceMatrix.needsUpdate = true;
    failMesh.visible = n > 0;
    if (n) {
      printToBed(sx / n, sy / n, maxZ + 30, warning.sp.position);
      warning.sp.visible = true;
    }
  }

  /**
   * Play the print. Resolves when done or skipped.
   * @param {{reduced:boolean, onLayer?:(layer:number)=>void}} o
   */
  function play(o) {
    return new Promise((resolve) => {
      const sim = current.sim;
      // stop under the failing layer (fail.z counts mm up from the bed); that layer shows as drooping cells
      const endMm = sim.fail ? sim.fail.z : sim.heightMm;
      const halfW = Math.max(0.01, (sim.max[0] - sim.min[0]) * MM * 0.5);
      const halfD = Math.max(0.006, (sim.max[1] - sim.min[1]) * MM * 0.5);
      clearFail();
      if (o.reduced) {
        setClip(sim.fail ? endMm : Infinity);
        setOpacity(0);
        anim = { kind: 'fade', t: 0, dur: 0.6, endMm, resolve, onLayer: o.onLayer };
      } else {
        const dur = Math.min(7, 2.2 + endMm * 0.05);
        setClip(0);
        anim = { kind: 'print', t: 0, dur, endMm, halfW, halfD, resolve, onLayer: o.onLayer, lastLayer: -1 };
      }
    });
  }

  function finish() {
    if (!anim) return;
    const a = anim;
    anim = null;
    // A finished print shows whole: clipping at its exact top height would
    // cut away the top faces of the raised pieces and leave only their walls.
    setClip(current.sim.fail ? a.endMm : Infinity);
    setOpacity(1);
    park();
    if (current.sim.fail) showFail(current.sim.fail);
    a.onLayer?.(Math.round(a.endMm / 0.2));
    a.resolve();
  }

  function skip() { finish(); }

  function update(dt) {
    const a = anim;
    if (!a) return;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    if (a.kind === 'fade') {
      setOpacity(k);
    } else {
      const hmm = a.endMm * k;
      setClip(hmm);
      gantry.position.y = rest.gantryY + hmm * MM;
      head.position.x = rest.headX + Math.sin(a.t * 14) * a.halfW;
      bed.position.z = rest.bedZ + Math.sin(a.t * 3.1) * a.halfD;
      const layer = Math.floor(hmm / 0.2);
      if (layer !== a.lastLayer) { a.lastLayer = layer; a.onLayer?.(layer); }
    }
    if (k >= 1) finish();
  }

  /** Camera framing target: bed top centre in world space. */
  function focus(out) { return bed.getWorldPosition(out); }

  function dispose() {
    anim = null;
    for (const o of hubHidden) o.visible = true;
    hubHidden.length = 0;
    root.removeFromParent();
    const g = new Set(), m = new Set(), t = new Set();
    const collect = (o) => o.traverse((x) => {
      if (x.geometry) g.add(x.geometry);
      if (x.material) for (const mm of [].concat(x.material)) { m.add(mm); if (mm.map) t.add(mm.map); }
    });
    collect(root);
    collect(gltf.scene);
    for (const geo of Object.values(geos)) g.add(geo);
    g.add(cellGeo); m.add(cellMat); m.add(ghostMat); m.add(bodyMat); m.add(accentMat); m.add(warning.mat); t.add(warning.tex);
    for (const x of g) x.dispose();
    for (const x of m) x.dispose();
    for (const x of t) x.dispose();
    failMesh.dispose();
  }

  return { root, show, play, skip, update, focus, dispose, get busy() { return !!anim; } };
}
