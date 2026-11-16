import * as THREE from 'three';

/**
 * Built-in placeholder characters, made in code. Same interface as the
 * GLB avatars (see roster.js), so the real files drop in with no code change.
 * Each faces +Z with feet at y = 0.
 */

/** @typedef {{id:string, label:string, height_m:number, skin:string, shirt:string, pants:string, hair:string, style:'puffs'|'short'|'pony'}} PlaceholderDef */

/** @type {PlaceholderDef[]} */
export const PLACEHOLDERS = [
  { id: 'student_a', label: 'Nia', height_m: 1.5, skin: '#8d5524', shirt: '#2f6fdb', pants: '#2b2d42', hair: '#1b1b1b', style: 'puffs' },
  { id: 'student_b', label: 'Leo', height_m: 1.55, skin: '#e0ac69', shirt: '#e2533a', pants: '#34495e', hair: '#5a3825', style: 'short' },
  { id: 'student_c', label: 'Sam', height_m: 1.45, skin: '#c68642', shirt: '#2e9e5b', pants: '#3d3d5c', hair: '#2a1a10', style: 'pony' },
];

const box = (w, hgt, d, mat, y = 0) => {
  const g = new THREE.BoxGeometry(w, hgt, d);
  g.translate(0, y, 0);
  return new THREE.Mesh(g, mat);
};

/** @param {PlaceholderDef} def */
export function buildPlaceholder(def) {
  const s = def.height_m / 1.5;
  const m = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
  const skin = m(def.skin), shirt = m(def.shirt), pants = m(def.pants), hair = m(def.hair);
  const root = new THREE.Group();
  root.name = `avatar_${def.id}`;
  const body = new THREE.Group();
  body.scale.setScalar(s);
  root.add(body);

  const hips = new THREE.Group();
  hips.position.y = 0.72;
  body.add(hips);
  const legL = new THREE.Group(), legR = new THREE.Group();
  legL.position.set(-0.09, 0, 0); legR.position.set(0.09, 0, 0);
  legL.add(box(0.13, 0.72, 0.15, pants, -0.36)); legR.add(box(0.13, 0.72, 0.15, pants, -0.36));
  legL.add(box(0.14, 0.06, 0.22, m('#f4f4f4'), -0.69).translateZ(0.03));
  legR.add(box(0.14, 0.06, 0.22, m('#f4f4f4'), -0.69).translateZ(0.03));
  hips.add(legL, legR);

  const torso = new THREE.Group();
  hips.add(torso);
  torso.add(box(0.36, 0.5, 0.2, shirt, 0.25));
  const armL = new THREE.Group(), armR = new THREE.Group();
  armL.position.set(-0.23, 0.46, 0); armR.position.set(0.23, 0.46, 0);
  armL.add(box(0.1, 0.42, 0.11, shirt, -0.18)); armR.add(box(0.1, 0.42, 0.11, shirt, -0.18));
  armL.add(box(0.09, 0.1, 0.1, skin, -0.43)); armR.add(box(0.09, 0.1, 0.1, skin, -0.43));
  torso.add(armL, armR);

  const head = new THREE.Group();
  head.position.y = 0.62;
  torso.add(head);
  const skull = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 1), skin);
  skull.position.y = 0.1;
  head.add(skull);
  const eyeMat = m('#111111');
  for (const x of [-0.05, 0.05]) {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.02), eyeMat);
    e.position.set(x, 0.12, 0.14);
    head.add(e);
  }
  if (def.style === 'puffs') {
    for (const x of [-0.13, 0.13]) {
      const p = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), hair);
      p.position.set(x, 0.22, -0.02);
      head.add(p);
    }
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.155, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), hair);
    cap.position.y = 0.11; cap.rotation.x = -0.25;
    head.add(cap);
  } else if (def.style === 'short') {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), hair);
    cap.position.y = 0.1; cap.rotation.x = -0.3;
    head.add(cap);
  } else {
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.158, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), hair);
    cap.position.y = 0.11; cap.rotation.x = -0.2;
    head.add(cap);
    const tail = box(0.08, 0.22, 0.08, hair, -0.08);
    tail.position.set(0, 0.2, -0.16); tail.rotation.x = 0.4;
    head.add(tail);
  }
  return { root, parts: { body, hips, legL, legR, torso, armL, armR, head } };
}

/**
 * Procedural animation with the same clip names as the GLB contract.
 * @param {ReturnType<typeof buildPlaceholder>} rig
 */
export function placeholderAnimator(rig, reduced = false) {
  const p = rig.parts;
  let clip = 'idle';
  let t = 0;
  let rate = 1;
  const cur = { legL: 0, legR: 0, armL: 0, armR: 0, armLz: 0, armRz: 0, bob: 0, sway: 0, head: 0 };
  const tgt = { ...cur };
  const amp = reduced ? 0.4 : 1;
  return {
    play(name) { if (name !== clip) { clip = name; t = 0; } },
    get clip() { return clip; },
    get rate() { return rate; },
    /** ground speed in m/s; at rate 1 the placeholder's stride matches about 2.25 m/s */
    setSpeed(mps) { rate = mps / 2.25; },
    update(dt) {
      t += clip === 'walk' ? dt * rate : dt;
      for (const k in tgt) tgt[k] = 0;
      if (clip === 'walk') {
        const w = Math.sin(t * 9);
        tgt.legL = w * 0.6; tgt.legR = -w * 0.6; tgt.armL = -w * 0.5; tgt.armR = w * 0.5;
        tgt.bob = Math.abs(Math.cos(t * 9)) * 0.03;
      } else if (clip === 'cheer') {
        tgt.armL = -2.7; tgt.armR = -2.7;
        tgt.armLz = -0.3 + Math.sin(t * 10) * 0.25 * amp; tgt.armRz = 0.3 - Math.sin(t * 10) * 0.25 * amp;
        tgt.bob = Math.max(0, Math.sin(t * 7)) * 0.08 * amp;
      } else if (clip === 'dance') {
        const d = Math.sin(t * 6);
        tgt.sway = d * 0.15 * amp; tgt.armL = -1.2 + d * 0.8 * amp; tgt.armR = -1.2 - d * 0.8 * amp;
        tgt.legL = d * 0.2 * amp; tgt.legR = -d * 0.2 * amp; tgt.bob = Math.abs(d) * 0.05 * amp; tgt.head = d * 0.2 * amp;
      } else {
        tgt.bob = Math.sin(t * 2) * 0.008 * amp; tgt.armLz = -0.06; tgt.armRz = 0.06;
      }
      const k = Math.min(1, dt * 14);
      for (const key in cur) cur[key] += (tgt[key] - cur[key]) * k;
      p.legL.rotation.x = cur.legL; p.legR.rotation.x = cur.legR;
      p.armL.rotation.x = cur.armL; p.armR.rotation.x = cur.armR;
      p.armL.rotation.z = cur.armLz; p.armR.rotation.z = cur.armRz;
      p.hips.position.y = 0.72 + cur.bob;
      p.torso.rotation.z = cur.sway;
      p.head.rotation.z = cur.head;
    },
  };
}

/** Draw a simple portrait for the select screen. Returns a data URL. */
export function placeholderPortrait(def) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e8f1ff';
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = def.shirt;
  g.beginPath(); g.roundRect(48, 170, 160, 120, 40); g.fill();
  g.fillStyle = def.skin;
  g.beginPath(); g.arc(128, 115, 62, 0, Math.PI * 2); g.fill();
  g.fillStyle = def.hair;
  if (def.style === 'puffs') {
    g.beginPath(); g.arc(70, 70, 30, 0, Math.PI * 2); g.arc(186, 70, 30, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(128, 100, 64, Math.PI * 1.05, Math.PI * 1.95); g.fill();
  } else if (def.style === 'short') {
    g.beginPath(); g.arc(128, 105, 66, Math.PI, Math.PI * 2); g.fill();
  } else {
    g.beginPath(); g.arc(128, 102, 65, Math.PI * 1.02, Math.PI * 1.98); g.fill();
    g.beginPath(); g.ellipse(200, 120, 18, 44, 0.3, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = '#111';
  g.fillRect(104, 112, 10, 14); g.fillRect(142, 112, 10, 14);
  g.strokeStyle = '#111'; g.lineWidth = 4;
  g.beginPath(); g.arc(128, 140, 16, 0.2 * Math.PI, 0.8 * Math.PI); g.stroke();
  return c.toDataURL('image/png');
}
