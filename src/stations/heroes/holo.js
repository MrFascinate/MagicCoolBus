import * as THREE from 'three';

/**
 * Hologram helpers for Hologram Heroes: material swap, text labels and the
 * card face. Everything made here is listed so the station can dispose it.
 */

const CYAN = new THREE.Color(0x6fe8ff);
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/**
 * Turn every mesh under `root` into a soft cyan hologram. Returns the new
 * materials with their base opacity, so fades can scale them without
 * allocating. Old materials are disposed.
 * @param {THREE.Object3D} root
 */
export function hologramize(root) {
  /** @type {{mat:THREE.MeshLambertMaterial, base:number}[]} */
  const mats = [];
  const made = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const conv = (m) => {
      if (made.has(m)) return made.get(m);
      const c = (m.color ? m.color.clone() : new THREE.Color(0xffffff)).lerp(CYAN, 0.35);
      const base = m.transparent ? Math.min(0.6, m.opacity ?? 0.6) : 0.9;
      const nm = new THREE.MeshLambertMaterial({
        color: c,
        emissive: c.clone().multiplyScalar(0.35).add(CYAN.clone().multiplyScalar(0.18)),
        transparent: true,
        opacity: base,
        depthWrite: base > 0.7,
        side: m.side,
      });
      nm.name = `holo_${m.name || ''}`;
      mats.push({ mat: nm, base });
      made.set(m, nm);
      m.dispose();
      return nm;
    };
    o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
  });
  return mats;
}

/** Word-wrap text for a canvas context. */
export function wrapLines(g, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (g.measureText(t).width > maxWidth && line) { lines.push(line); line = w; } else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

/** A text label sprite that always faces the camera and draws on top. */
export function makeLabel() {
  const c = document.createElement('canvas');
  c.width = 640; c.height = 420;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const sp = new THREE.Sprite(mat);
  sp.scale.set(0.52, 0.52 * 420 / 640, 1);
  sp.renderOrder = 20;
  return { sp, c, tex, mat };
}

/**
 * @param {{c:HTMLCanvasElement, tex:THREE.CanvasTexture}} l
 * @param {{title:string, number?:number, note?:string, kind?:'normal'|'wrong'|'picked'}} o
 */
export function drawLabel(l, o) {
  const g = l.c.getContext('2d');
  const W = l.c.width, H = l.c.height;
  g.clearRect(0, 0, W, H);
  const wrong = o.kind === 'wrong';
  g.font = `bold 64px ${FONT}`;
  const titleLines = wrapLines(g, o.number ? `${o.number}. ${o.title}` : o.title, W - 50).slice(0, 3);
  g.font = `600 34px ${FONT}`;
  const noteLines = o.note ? wrapLines(g, o.note, W - 50).slice(0, 4) : [];
  const hgt = 26 + titleLines.length * 68 + noteLines.length * 40 + 10;
  const top = H - hgt - 6;
  g.fillStyle = wrong ? 'rgba(70,10,24,0.92)' : 'rgba(8,24,52,0.9)';
  g.beginPath(); g.roundRect(6, top, W - 12, hgt, 24); g.fill();
  g.lineWidth = 6;
  g.strokeStyle = wrong ? '#ff8fa6' : o.kind === 'picked' ? '#ffe07a' : '#8ff0ff';
  g.setLineDash(wrong ? [16, 10] : []);
  g.stroke();
  g.setLineDash([]);
  g.textAlign = 'center'; g.textBaseline = 'top';
  let y = top + 14;
  g.fillStyle = '#ffffff';
  g.font = `bold 64px ${FONT}`;
  for (const ln of titleLines) { g.fillText(ln, W / 2, y); y += 68; }
  g.font = `600 34px ${FONT}`;
  g.fillStyle = wrong ? '#ffd9e1' : '#d8f6ff';
  for (const ln of noteLines) { g.fillText(ln, W / 2, y); y += 40; }
  l.tex.needsUpdate = true;
}

/**
 * Draw a person card for the card_frame face. No portrait or face, by rule:
 * a large icon, the role, the name and one or two short lines.
 * @param {HTMLCanvasElement} c 512 x 704
 * @param {{role:string, name:string, line1?:string, line2?:string, living:boolean}} o
 */
export function drawCard(c, o) {
  const g = c.getContext('2d');
  const W = c.width, H = c.height;
  g.fillStyle = '#0d1f45';
  g.fillRect(0, 0, W, H);
  g.strokeStyle = '#8ff0ff'; g.lineWidth = 10;
  g.strokeRect(14, 14, W - 28, H - 28);
  // role band
  g.fillStyle = o.living ? '#ffe07a' : '#8ff0ff';
  g.fillRect(14, 14, W - 28, 84);
  g.fillStyle = '#0d1f45';
  g.font = `bold 44px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(o.role.toUpperCase(), W / 2, 58);
  // icon: lightbulb for inventors, atom for people working today
  g.save();
  g.translate(W / 2, 230);
  g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.lineCap = 'round'; g.lineJoin = 'round';
  if (o.living) {
    g.beginPath(); g.arc(0, 0, 14, 0, Math.PI * 2); g.fillStyle = '#ffe07a'; g.fill();
    for (const a of [0, Math.PI / 3, -Math.PI / 3]) { g.save(); g.rotate(a); g.beginPath(); g.ellipse(0, 0, 100, 36, 0, 0, Math.PI * 2); g.stroke(); g.restore(); }
  } else {
    g.beginPath(); g.arc(0, -20, 64, Math.PI * 0.8, Math.PI * 2.2); g.lineTo(28, 60); g.lineTo(-28, 60); g.closePath(); g.stroke();
    g.beginPath(); g.moveTo(-30, 82); g.lineTo(30, 82); g.moveTo(-22, 104); g.lineTo(22, 104); g.stroke();
  }
  g.restore();
  g.fillStyle = '#ffffff';
  g.textBaseline = 'top';
  let y = 380;
  g.font = `bold 52px ${FONT}`;
  for (const ln of wrapLines(g, o.name, W - 70).slice(0, 2)) { g.fillText(ln, W / 2, y); y += 60; }
  y += 14;
  g.font = `600 34px ${FONT}`;
  g.fillStyle = '#d8f6ff';
  for (const t of [o.line1, o.line2]) {
    if (!t) continue;
    for (const ln of wrapLines(g, t, W - 70).slice(0, 2)) { g.fillText(ln, W / 2, y); y += 42; }
    y += 8;
  }
}

/** Shared emitter pieces (beam and floor ring) under each hologram slot. */
export function makeEmitter() {
  const beamGeo = new THREE.CylinderGeometry(0.17, 0.21, 0.34, 20, 1, true);
  beamGeo.translate(0, 0.17, 0);
  const ringGeo = new THREE.RingGeometry(0.16, 0.21, 32);
  ringGeo.rotateX(-Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0x6fe8ff, transparent: true, opacity: 0.1, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x9ff4ff, transparent: true, opacity: 0.75, depthWrite: false });
  return {
    beamGeo, ringGeo, beamMat, ringMat,
    make() {
      const gr = new THREE.Group();
      gr.add(new THREE.Mesh(beamGeo, beamMat), new THREE.Mesh(ringGeo, ringMat));
      return gr;
    },
    dispose() { beamGeo.dispose(); ringGeo.dispose(); beamMat.dispose(); ringMat.dispose(); },
  };
}
