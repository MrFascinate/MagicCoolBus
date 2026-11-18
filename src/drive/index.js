import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import './drive.css';
import { h, clear, announce } from '../ui/dom.js';
import { createBus, settleBus, stepBus, PARAMS } from './physics.js';
import { sd, gradient, centreline } from './track.js';
import { buildWorld } from './world.js';

/**
 * Drive the Bus: the free-play finale. Loaded only when a drive starts.
 * No score, no timer, nothing to fail: the bus drives round the school block
 * and the player parks when they like.
 *
 * @typedef {Object} DriveContext
 * @property {THREE.Scene} scene
 * @property {THREE.PerspectiveCamera} camera
 * @property {HTMLElement} ui                 the #ui layer
 * @property {{on:boolean, play:(n:string)=>void, audio:()=>AudioContext|null}} sound
 * @property {boolean} reducedMotion
 * @property {(url:string)=>Promise<any>} loadGLTF
 * @property {THREE.Object3D[]} hide          hub objects to hide while driving (restored on dispose)
 * @property {{x:number, z:number, h:number}} start   where the hub's bus is parked
 * @property {() => boolean} isPaused
 * @property {() => void} onPark              the player pressed Park and get out
 * @property {{portrait:string, label:string}|null} [driver]  the picked character, shown as a driver badge
 */

const WHEELS = ['wheel_front_left', 'wheel_front_right', 'wheel_rear_left_a', 'wheel_rear_left_b', 'wheel_rear_right_a', 'wheel_rear_right_b'];
const CAM = { back: 12.5, up: 4.8, ahead: 4.5, lookUp: 1.4, margin: 1.5 };
const DRIVE_KEYS = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'brake',
};

const SVG = {
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4l7 9h-4.5v7h-5v-7H5z" fill="currentColor"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20l-7-9h4.5V4h5v7H19z" fill="currentColor"/></svg>',
  left: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12l9-7v4.5h7v5h-7V19z" fill="currentColor"/></svg>',
  right: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12l-9 7v-4.5H4v-5h7V5z" fill="currentColor"/></svg>',
  brake: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="3"/><path d="M9 9h6v6H9z" fill="currentColor"/></svg>',
  horn: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10h3l8-5v14l-8-5H3z" fill="currentColor"/><path d="M17 8c1.5 1.2 1.5 6.8 0 8M19.5 6c2.6 2.6 2.6 9.4 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  park: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M9 17V7h4a3 3 0 010 6H9" fill="none" stroke="currentColor" stroke-width="2.5"/></svg>',
};

/** Merge a glTF node's primitives into one mesh with vertex colours (one draw call). */
function flatten(node, side) {
  node.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
  const geos = [];
  node.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    if (o !== node) g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const m = o.material;
    const col = new THREE.Color(0xcccccc);
    if (m?.color) col.copy(m.color);
    if (m?.emissive && (m.emissive.r + m.emissive.g + m.emissive.b) > 0.05) col.add(m.emissive);
    col.r = Math.min(1, col.r); col.g = Math.min(1, col.g); col.b = Math.min(1, col.b);
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geos.push(g.index ? g.toNonIndexed() : g);
    if (g.index) g.dispose();
  });
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
  for (const g of geos) if (g !== merged) g.dispose();
  const mesh = new THREE.Mesh(merged, new THREE.MeshLambertMaterial({ vertexColors: true, side }));
  mesh.name = node.name;
  mesh.position.copy(node.position);
  return mesh;
}

/** A short two-tone horn, made on the spot (no audio files). */
function honk(ac) {
  const t = ac.currentTime + 0.01;
  const out = ac.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.16, t + 0.02);
  out.gain.setValueAtTime(0.16, t + 0.32);
  out.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 1800;
  lp.connect(out).connect(ac.destination);
  for (const f of [349, 440]) {
    const o = ac.createOscillator();
    o.type = 'square'; o.frequency.value = f;
    o.connect(lp);
    o.start(t); o.stop(t + 0.48);
  }
}

export default function createDrive() {
  /** @type {DriveContext} */ let ctx;
  let bus, body, wheelNodes = [], world, gltfScene;
  let state;
  const keys = new Set();
  const touch = new Set();
  let spin = 0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const wantPos = new THREE.Vector3(), wantLook = new THREE.Vector3();
  const g2 = { x: 0, z: 0 };
  let hud = {};
  const restoreVis = [];
  let savedFog = null;
  let edgeT = 99, hornT = 99, usedInput = false;
  let listeners = [];

  // ---------- loading ----------
  async function load(c) {
    ctx = c;
    const gltf = await ctx.loadGLTF('assets/drive/bus_closed.glb');
    gltfScene = gltf.scene;
    bus = new THREE.Group();
    bus.name = 'drive_bus';
    const src = gltfScene.getObjectByName('bus_body');
    body = flatten(src, THREE.DoubleSide);
    bus.add(body);
    wheelNodes = [];
    for (const n of WHEELS) {
      const w = gltfScene.getObjectByName(n);
      if (!w) continue;
      const mesh = flatten(w, THREE.FrontSide);
      mesh.rotation.order = 'YXZ';
      mesh.userData.front = n.startsWith('wheel_front');
      bus.add(mesh);
      wheelNodes.push(mesh);
    }
    // the loaded glTF is only a source: free it now
    gltfScene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
    gltfScene = null;
    world = buildWorld();
  }

  // ---------- start ----------
  function start() {
    for (const o of ctx.hide) { restoreVis.push([o, o.visible]); o.visible = false; }
    ctx.scene.add(world.group, bus);
    savedFog = ctx.scene.fog ? { near: ctx.scene.fog.near, far: ctx.scene.fog.far } : null;
    if (ctx.scene.fog) { ctx.scene.fog.near = 40; ctx.scene.fog.far = 110; }
    state = settleBus(createBus(ctx.start.x, ctx.start.z, ctx.start.h));
    placeBus();
    cameraTarget(wantPos, wantLook);
    camPos.copy(wantPos); camLook.copy(wantLook);
    applyCamera();
    buildHud();
    const on = (target, type, fn, opt) => { target.addEventListener(type, fn, opt); listeners.push([target, type, fn, opt]); };
    on(window, 'keydown', onKeyDown);
    on(window, 'keyup', onKeyUp);
    on(window, 'blur', clearInput);
    announce('You are driving the bus. Drive around the school block. Press Park and get out when you are done.');
  }

  // ---------- HUD ----------
  function pad(cls, label, svg, name) {
    const b = h(`button.dr-pad.${cls}`, { type: 'button', tabindex: '-1', 'aria-label': label },
      h('span.dr-ico', { html: svg }), h('span.dr-lbl', { text: label }));
    const down = (e) => {
      e.preventDefault();
      if (ctx.isPaused()) return;
      try { b.setPointerCapture(e.pointerId); } catch { /* not all pointers can be captured */ }
      if (name === 'horn') { hornNow(); return; }
      touch.add(name); b.classList.add('down'); usedInput = true; hud.help.hidden = true;
    };
    const up = () => { touch.delete(name); b.classList.remove('down'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
    return b;
  }

  function buildHud() {
    hud.park = h('button.primary.dr-park', { type: 'button', onclick: () => park() }, h('span.dr-ico', { html: SVG.park }), h('span', { text: 'Park and get out' }));
    hud.help = h('p.dr-help', { text: 'Up arrow or W to go. Down arrow or S to back up. Left and right to steer. Space to brake. H to honk.' });
    hud.status = h('p.dr-status', { role: 'status', hidden: true });
    hud.beep = h('p.dr-beep', { 'aria-hidden': 'true', hidden: true, text: 'Beep beep' });
    hud.steer = h('div.dr-steer', null, pad('dr-left', 'Left', SVG.left, 'left'), pad('dr-right', 'Right', SVG.right, 'right'));
    hud.pedals = h('div.dr-pedals', null,
      pad('dr-horn', 'Horn', SVG.horn, 'horn'), pad('dr-go', 'Go', SVG.up, 'up'),
      pad('dr-brake', 'Brake', SVG.brake, 'brake'), pad('dr-back', 'Back', SVG.down, 'down'));
    // the bus has no windows, so the player's character rides along as a driver badge
    hud.driver = ctx.driver?.portrait
      ? h('div.dr-driver', null, h('img', { src: ctx.driver.portrait, alt: `${ctx.driver.label} is driving`, width: '64', height: '64' }))
      : null;
    hud.root = h('div.drive-hud', { role: 'region', 'aria-label': 'Driving the bus', tabindex: '-1' },
      hud.park, ...(hud.driver ? [hud.driver] : []), hud.help, hud.status, hud.beep, hud.steer, hud.pedals);
    ctx.ui.append(hud.root);
    hud.root.focus({ preventScroll: true });
  }

  function say(text) {
    hud.status.textContent = text;
    hud.status.hidden = false;
  }

  // ---------- input ----------
  function onKeyDown(e) {
    if (ctx.isPaused()) return;
    const t = /** @type {HTMLElement} */ (e.target);
    if (t && t.closest && t.closest('.overlay')) return;
    const k = DRIVE_KEYS[e.code];
    if (k) {
      // Space brakes even when a button has focus; Enter still presses buttons
      e.preventDefault();
      keys.add(k);
      if (!usedInput) { usedInput = true; hud.help.hidden = true; }
    } else if (e.code === 'KeyH' && !e.repeat) {
      e.preventDefault();
      hornNow();
    }
  }
  function onKeyUp(e) {
    const k = DRIVE_KEYS[e.code];
    if (k) { keys.delete(k); if (e.code === 'Space') e.preventDefault(); }
  }
  function clearInput() {
    keys.clear(); touch.clear();
    hud.root?.querySelectorAll('.dr-pad.down').forEach((b) => b.classList.remove('down'));
  }
  const held = (n) => keys.has(n) || touch.has(n);
  function readInput() {
    return {
      throttle: (held('up') ? 1 : 0) - (held('down') ? 1 : 0),
      steer: (held('left') ? 1 : 0) - (held('right') ? 1 : 0),
      brake: held('brake'),
    };
  }

  function hornNow() {
    hornT = 0;
    hud.beep.hidden = false;
    hud.root.querySelector('.dr-horn')?.classList.add('down');
    if (ctx.sound.on) { const ac = ctx.sound.audio(); if (ac) honk(ac); }
  }

  // ---------- bus and camera ----------
  function placeBus() {
    bus.position.set(state.x, state.y, state.z);
    bus.rotation.y = state.h;
    for (const w of wheelNodes) {
      w.rotation.x = spin;
      w.rotation.y = w.userData.front ? state.steer : 0;
    }
  }

  function cameraTarget(pos, look) {
    const fx = Math.sin(state.h), fz = Math.cos(state.h);
    pos.set(state.x - fx * CAM.back, state.y + CAM.up, state.z - fz * CAM.back);
    // never let the camera leave the road and walk: buildings and trees stand beyond
    const d = sd(pos.x, pos.z);
    if (d > CAM.margin) { gradient(pos.x, pos.z, g2); pos.x -= g2.x * (d - CAM.margin); pos.z -= g2.z * (d - CAM.margin); }
    look.set(state.x + fx * CAM.ahead, state.y + CAM.lookUp, state.z + fz * CAM.ahead);
  }

  function applyCamera() {
    ctx.camera.position.copy(camPos);
    ctx.camera.lookAt(camLook);
  }

  // ---------- frame ----------
  function update(dt) {
    if (!state) return;
    stepBus(state, readInput(), dt);
    spin += (state.v / 0.535) * Math.min(dt, 0.1);
    placeBus();
    cameraTarget(wantPos, wantLook);
    if (ctx.reducedMotion) {
      // rigid: the camera stays fixed behind the bus, no lag or sway
      camPos.copy(wantPos); camLook.copy(wantLook);
    } else {
      camPos.lerp(wantPos, 1 - Math.exp(-dt * 3.2));
      camLook.lerp(wantLook, 1 - Math.exp(-dt * 6));
      const d = sd(camPos.x, camPos.z);
      if (d > CAM.margin) { gradient(camPos.x, camPos.z, g2); camPos.x -= g2.x * (d - CAM.margin); camPos.z -= g2.z * (d - CAM.margin); }
    }
    applyCamera();
    // edge note, at most every few seconds
    edgeT += dt;
    if (state.touching && edgeT > 4) {
      edgeT = 0;
      say('That is the edge of the road. Steer back to the middle.');
    } else if (!state.touching && edgeT > 2.5 && !hud.status.hidden) {
      hud.status.hidden = true;
    }
    hornT += dt;
    if (hornT > 0.7 && !hud.beep.hidden) {
      hud.beep.hidden = true;
      if (!touch.has('horn')) hud.root.querySelector('.dr-horn')?.classList.remove('down');
    }
  }

  function park() {
    clearInput();
    ctx.onPark();
  }

  // ---------- clean up ----------
  function dispose() {
    for (const [t, type, fn, opt] of listeners) t.removeEventListener(type, fn, opt);
    listeners = [];
    hud.root?.remove();
    hud = {};
    if (bus) {
      bus.removeFromParent();
      bus.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }
    world?.dispose();
    for (const [o, v] of restoreVis) o.visible = v;
    restoreVis.length = 0;
    if (savedFog && ctx?.scene.fog) { ctx.scene.fog.near = savedFog.near; ctx.scene.fog.far = savedFog.far; }
    bus = null; body = null; wheelNodes = []; world = null; state = null;
    keys.clear(); touch.clear();
  }

  // ---------- test hooks (only used with ?debug) ----------
  const debug = {
    get state() { return state && { ...state }; },
    get busObject() { return bus; },
    get worldTriangles() { return world?.triangles; },
    get busTriangles() { let t = 0; bus?.traverse((o) => { if (o.isMesh) t += o.geometry.attributes.position.count / 3; }); return t; },
    /** Drive with fixed steps (software WebGL runs at a few frames a second). */
    simulate(input, seconds, dt = 1 / 30) {
      let touched = false;
      for (let t = 0; t < seconds; t += dt) { stepBus(state, input, dt); touched ||= state.touching; spin += state.v / 0.535 * dt; }
      placeBus(); cameraTarget(camPos, camLook); applyCamera();
      return { ...state, touchedDuring: touched };
    },
    /** Follow the middle of the loop for some seconds, the way a careful driver would. */
    follow(seconds, dt = 1 / 30) {
      const line = centreline(1);
      let corners = 0, lastSide = side(state.h);
      for (let t = 0; t < seconds; t += dt) {
        let best = 0, bd = Infinity;
        for (let i = 0; i < line.length; i++) { const d = (line[i].x - state.x) ** 2 + (line[i].z - state.z) ** 2; if (d < bd) { bd = d; best = i; } }
        let k = best;
        while (Math.hypot(line[k % line.length].x - state.x, line[k % line.length].z - state.z) < 9) k++;
        const tg = line[k % line.length];
        let diff = Math.atan2(tg.x - state.x, tg.z - state.z) - state.h;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        stepBus(state, { throttle: Math.abs(diff) > 0.25 && state.v > 5 ? 0 : 1, steer: Math.max(-1, Math.min(1, diff * 3)), brake: false }, dt);
        spin += state.v / 0.535 * dt;
        const s = side(state.h);
        if (s !== lastSide) { corners++; lastSide = s; }
      }
      placeBus(); cameraTarget(camPos, camLook); applyCamera();
      return { ...state, corners };
    },
    params: PARAMS,
  };
  /** Which way the bus faces, to the nearest quarter turn. */
  function side(hh) { return ((Math.round(hh / (Math.PI / 2)) % 4) + 4) % 4; }

  return { id: 'drive', load, start, update, dispose, clearInput, debug };
}
