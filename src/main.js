import * as THREE from 'three';
import './ui/style.css';
import { loadHub } from './hub/hub.js';
import { PlayerController, FollowCamera } from './hub/player.js';
import { loadRoster, createAvatar } from './avatars/roster.js';
import { createSave, isDriveUnlocked } from './core/save.js';
import { isDemoUrl, createDemoSave, exitDemoUrl } from './core/demo.js';
import { panelInset, stationView, hubFov, pixelRatioFor, BASE_FOV } from './ui/layout.js';
import { createSound } from './core/sound.js';
import { reducedMotion, DEBUG } from './core/env.js';
import { loadGLTF } from './core/loaders.js';
import { STATIONS, STAMP_STATIONS } from './stations/registry.js';
import { h, clear, announce } from './ui/dom.js';
import { icon, ICONS } from './ui/icons.js';
import { EMBLEMS } from './ui/emblems.js';

/** @typedef {'loading'|'select'|'hub'|'station'|'drive'} Mode */

const RING_RADIUS = 0.6;
/** Drive the Bus: the marked spot on the walk outside the bus's front door, and where the parked bus sits. */
const DRIVE_SPOT = { x: 4.78, z: 2.75 };
const DOOR_STEP = { x: 4.78, z: 1.45 };
const BUS_PARKED = { x: 0.059, z: 0, h: Math.PI / 2 };
const ui = /** @type {HTMLElement} */ (document.getElementById('ui'));
const canvas = /** @type {HTMLCanvasElement} */ (document.getElementById('view'));
/** Demo mode (?demo=<key>): everything open, its own save in memory only. */
const DEMO = isDemoUrl(location.search);
const save = DEMO ? createDemoSave() : createSave();
const sound = createSound(save.data.sound);
const reduced = reducedMotion();

/** @type {Mode} */ let mode = 'loading';
/** Set the mode and mirror it on <html> for the stylesheet (mode-hub, mode-station, mode-drive). */
function setMode(m) {
  mode = m;
  const cl = document.documentElement.classList;
  for (const k of ['loading', 'select', 'hub', 'station', 'drive']) cl.toggle(`mode-${k}`, k === m);
}
let paused = false;
/** @type {import('./hub/hub.js').Hub} */ let hub;
/** @type {PlayerController} */ let player;
/** @type {import('./avatars/roster.js').Avatar} */ let avatar;
/** @type {FollowCamera} */ let follow;
/** @type {import('./stations/registry.js').StationModule|null} */ let station = null;
/** @type {import('./stations/registry.js').StationDef|null} */ let stationDef = null;
/** @type {string|null} */ let nearRing = null;
const resizeHandlers = new Set();

// ---------- renderer ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: window.devicePixelRatio < 1.5, powerPreference: 'high-performance' });
} catch (e) {
  fatal('This game needs WebGL, and this browser could not start it. Try turning on hardware acceleration in the browser settings.');
  throw e;
}
const touchOnly = typeof matchMedia === 'function' && matchMedia('(hover: none) and (pointer: coarse)').matches;
/** times the frame rate fell under target; each one lowers the pixel ratio a step */
let slowSteps = 0;
renderer.setPixelRatio(pixelRatioFor(window.devicePixelRatio, window.innerWidth * window.innerHeight, 0, touchOnly));
renderer.shadowMap.enabled = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fd3ff);
scene.fog = new THREE.Fog(0x9fd3ff, 30, 70);
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f7a, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(-6, 12, 9);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 150);
camera.position.set(1.5, 6, 22);
camera.lookAt(1.5, 1, 4);

const appEl = /** @type {HTMLElement} */ (document.getElementById('app'));
/** Size of the game area in CSS pixels (follows the phone's address bar as it shows and hides). */
function screenSize() {
  const r = appEl.getBoundingClientRect();
  return { w: Math.max(1, Math.round(r.width) || window.innerWidth), h: Math.max(1, Math.round(r.height) || window.innerHeight) };
}

/** What the station panel covers: a side panel (right) or a bottom sheet (bottom). */
function panelCover() {
  const p = document.getElementById('station-panel');
  if (!p || p.hidden) return { right: 0, bottom: 0 };
  const { w, h: ht } = screenSize();
  return panelInset(p.getBoundingClientRect(), w, ht);
}
function panelWidth() { return panelCover().right; }

/** Safe-area insets in CSS pixels (notch, rounded corners, gesture bar), read from a hidden probe. */
const saProbe = h('div', { 'aria-hidden': 'true', style: { position: 'fixed', left: '0', top: '0', width: '0', height: '0', visibility: 'hidden', pointerEvents: 'none',
  paddingTop: 'env(safe-area-inset-top, 0px)', paddingRight: 'env(safe-area-inset-right, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)', paddingLeft: 'env(safe-area-inset-left, 0px)' } });
document.body.append(saProbe);
function safeArea() {
  const cs = getComputedStyle(saProbe);
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}

function resize() {
  const { w, h: ht } = screenSize();
  renderer.setPixelRatio(pixelRatioFor(window.devicePixelRatio, w * ht, slowSteps, touchOnly));
  renderer.setSize(w, ht, false);
  document.documentElement.classList.toggle('portrait', ht > w);
  if (mode === 'station') {
    const v = stationView(w, ht, panelCover());
    if (v.offset) camera.setViewOffset(v.fullW, v.fullH, v.x, v.y, w, ht);
    else camera.clearViewOffset();
    camera.aspect = v.aspect;
    camera.fov = v.fov;
  } else {
    camera.clearViewOffset();
    camera.aspect = w / ht;
    camera.fov = hubFov(w / ht);
  }
  camera.updateProjectionMatrix();
  for (const f of resizeHandlers) f();
}
/** Resize now, on the next frame and once more a moment later: phones report the new size late after a rotation. */
let resizeTimer = 0;
function queueResize() {
  resize();
  requestAnimationFrame(resize);
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(resize, 350);
}
window.addEventListener('resize', queueResize);
window.addEventListener('orientationchange', queueResize);
window.visualViewport?.addEventListener('resize', queueResize);

// ---------- screens ----------
function fatal(text) {
  clear(ui);
  ui.append(h('div.screen.center', null, h('div.card', null, h('h1', { text: 'The Magic Cool Bus Challenge' }), h('p', { text }))));
}

function loadingScreen() {
  const bar = h('div.bar-fill');
  const pct = h('p.bar-text', { text: 'Loading the bus: 0%' });
  const track = h('div.bar', { role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0', 'aria-label': 'Loading' }, bar);
  clear(ui);
  ui.append(h('div.screen.center.loading', null, h('div.card', null,
    h('h1', { text: 'The Magic Cool Bus Challenge' }), track, pct)));
  return (f) => {
    const n = Math.round(f * 100);
    bar.style.width = `${n}%`;
    track.setAttribute('aria-valuenow', String(n));
    pct.textContent = `Loading the bus: ${n}%`;
  };
}

/** Title and character select on one screen (the brief makes it the first screen). */
function selectScreen(roster) {
  return new Promise((resolve) => {
    let chosen = roster.find((r) => r.id === save.data.character) || null;
    const startBtn = h('button.primary.big', { type: 'button', disabled: !chosen, onclick: () => chosen && resolve(chosen) }, h('span', { text: 'Start' }));
    const grid = h('div.char-grid', { role: 'radiogroup', 'aria-label': 'Characters' });
    const cards = roster.map((r, i) => {
      const b = h('button.char', { type: 'button', role: 'radio', 'aria-checked': chosen?.id === r.id ? 'true' : 'false', 'data-id': r.id, tabindex: (chosen ? chosen.id === r.id : i === 0) ? '0' : '-1' },
        h('img', { src: r.portrait, alt: '', width: '128', height: '128' }),
        h('span.char-name', { text: r.label }),
        h('span.char-check', { 'aria-hidden': 'true' }, icon('check')));
      b.addEventListener('click', () => pick(r));
      b.addEventListener('keydown', (e) => {
        const k = e.key;
        if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowUp') {
          e.preventDefault();
          const d = k === 'ArrowRight' || k === 'ArrowDown' ? 1 : -1;
          const next = roster[(i + d + roster.length) % roster.length];
          pick(next);
          grid.querySelector(`[data-id="${next.id}"]`).focus();
        }
      });
      return b;
    });
    grid.append(...cards);
    function pick(r) {
      chosen = r;
      sound.play('click');
      for (const c of cards) {
        const on = c.dataset.id === r.id;
        c.setAttribute('aria-checked', on ? 'true' : 'false');
        c.tabIndex = on ? 0 : -1;
      }
      startBtn.disabled = false;
      announce(`${r.label} picked.`);
    }
    clear(ui);
    ui.append(h('div.screen.center.select', null, h('div.card.wide', null,
      h('h1', { text: 'The Magic Cool Bus Challenge' }),
      h('p.lead', { text: 'Walk around the mobile STEM lab. Play the station games to collect six stamps, then build your badge.' }),
      h('h2', { text: 'Pick your character' }),
      grid,
      h('div.actions', null, startBtn),
      h('p.small', { text: DEMO ? 'Demo mode: every station is open and nothing is saved.' : save.persistent ? 'Your progress saves in this browser on this device only.' : 'This browser is not saving progress, so it will reset when you close the page.' }),
    )));
    (grid.querySelector('[tabindex="0"]'))?.focus();
  });
}

// ---------- HUD ----------
const hud = {};
function buildHud() {
  clear(ui);
  hud.passportStrip = h('div.strip', { 'aria-hidden': 'true' });
  hud.passportBtn = h('button.passport-btn', { type: 'button', 'aria-expanded': 'false', onclick: togglePassport });
  hud.passportList = h('ul.passport-list', { hidden: true });
  hud.passport = h('div.passport', { role: 'region', 'aria-label': 'Stamp passport' }, hud.passportBtn, hud.passportStrip, hud.passportList);
  hud.soundBtn = h('button.icon-btn', { type: 'button', onclick: toggleSound });
  hud.pauseBtn = h('button.icon-btn', { type: 'button', 'aria-label': 'Pause', onclick: () => setPaused(true) }, icon('pause'), h('span.btn-text', { text: 'Pause' }));
  hud.runBtn = h('button.icon-btn.run-btn', { type: 'button', 'aria-pressed': 'false', onclick: toggleRun }, icon('run'), h('span.btn-text', { text: 'Run: off' }));
  hud.top = h('div.topbar', null, hud.runBtn, hud.soundBtn, hud.pauseBtn);
  if (DEMO) buildDemoMenu();
  hud.prompt = h('div.prompt', { hidden: true, role: 'status' });
  hud.hint = h('p.hint', null,
    h('span.hint-mouse', { text: 'Click or tap the ground to walk. Double-click or double-tap to run. Arrow keys or W A S D walk; hold Shift to run.' }),
    h('span.hint-touch', { text: 'Tap the ground to walk there. Double-tap to run.' }));
  hud.panelBody = h('div.panel-body');
  hud.panelBack = h('button.back-btn', { type: 'button', onclick: () => exitStation() }, icon('back'), h('span', { text: 'Back to the bus' }));
  hud.panelTop = h('div.panel-top', null, hud.panelBack);
  hud.panel = h('aside#station-panel', { hidden: true, 'aria-label': 'Station' }, hud.panelTop, hud.panelBody);
  hud.overlay = h('div.overlay', { hidden: true });
  hud.toast = h('div.toast', { hidden: true, role: 'status' });
  hud.left = h('div.hud-left', null, hud.passport, hud.demo || null);
  ui.append(hud.left, hud.top, hud.prompt, hud.hint, hud.toast, hud.panel, hud.overlay);
  setMode(mode);
  refreshHud();
}

function stampCount() { return save.stampCount(STAMP_STATIONS); }

function refreshHud() {
  const n = stampCount();
  clear(hud.passportBtn);
  hud.passportBtn.setAttribute('aria-label', `Passport: ${n} of 6 stamps`);
  hud.passportBtn.append(icon('stamp'), h('span.pp-long', { text: `Passport: ${n} of 6 stamps`, 'aria-hidden': 'true' }), h('span.pp-short', { text: `Passport: ${n} of 6`, 'aria-hidden': 'true' }));
  clear(hud.passportStrip);
  clear(hud.passportList);
  for (const s of STATIONS) {
    const badgeBuilt = s.id === 'badge' && isDriveUnlocked(save.data);
    const earned = s.id === 'badge' ? badgeBuilt : save.hasStamp(s.id);
    const locked = s.id === 'badge' && !badgeBuilt && n < 6;
    const slot = h('span', { class: `slot ${earned ? 'earned' : ''} ${locked ? 'locked' : ''}`, title: s.title, html: EMBLEMS[s.emblem] });
    if (earned) slot.append(h('span.slot-mark', { html: ICONS.check }));
    if (locked) slot.append(h('span.slot-mark', { html: ICONS.lock }));
    hud.passportStrip.append(slot);
    const status = badgeBuilt ? 'Badge built' : earned ? `Stamp earned: ${save.data.stations[s.id].stamp.skill}` : locked ? `Locked: ${n} of 6 stamps` : s.id === 'badge' ? 'Open' : 'No stamp yet';
    hud.passportList.append(h('li', null,
      h('span.pl-icon', { html: EMBLEMS[s.emblem] }),
      h('span.pl-text', null, h('strong', { text: s.title }), h('span', { text: status })),
      h('button', { type: 'button', onclick: () => { togglePassport(); walkToStation(s.id); } }, h('span', { text: 'Walk there' }))));
  }
  if (isDriveUnlocked(save.data)) {
    hud.passportList.append(h('li', null,
      h('span.pl-icon', { html: BUS_ICON }),
      h('span.pl-text', null, h('strong', { text: 'Drive the bus' }), h('span', { text: 'Ready to drive' })),
      h('button', { type: 'button', onclick: () => { togglePassport(); walkToStation('drive'); } }, h('span', { text: 'Walk there' }))));
  }
  refreshDriveSpot();
  clear(hud.soundBtn);
  hud.soundBtn.append(icon(sound.on ? 'soundOn' : 'soundOff'), h('span.btn-text', { text: sound.on ? 'Sound on' : 'Sound off' }));
  hud.soundBtn.setAttribute('aria-pressed', sound.on ? 'true' : 'false');
  hud.soundBtn.setAttribute('aria-label', 'Sound');
  updateRingLabels();
}

function togglePassport() {
  const open = hud.passportList.hidden;
  if (open) { setDemoMenu(false); hud.hint.hidden = true; }
  hud.passportList.hidden = !open;
  hud.passportBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  hud.passport.classList.toggle('open', open);
  if (open) hud.passportList.querySelector('button')?.focus();
}

function toggleSound() {
  sound.on = !sound.on;
  save.setSound(sound.on);
  sound.play('click');
  refreshHud();
  announce(sound.on ? 'Sound on.' : 'Sound off.');
}

function toggleRun() {
  if (!player) return;
  player.runToggle = !player.runToggle;
  const on = player.runToggle;
  hud.runBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  hud.runBtn.querySelector('.btn-text').textContent = on ? 'Run: on' : 'Run: off';
  sound.play('click');
  announce(on ? 'Run is on. Every move runs.' : 'Run is off. Moves walk.');
}

function setPaused(v) {
  paused = v;
  drive?.clearInput();
  if (!v) {
    hud.overlay.hidden = true; clear(hud.overlay);
    if (mode === 'drive') /** @type {HTMLElement|null} */ (document.querySelector('.drive-hud'))?.focus();
    else (mode === 'station' ? hud.panelBody.querySelector('button') : hud.prompt.querySelector('button'))?.focus();
    return;
  }
  clear(hud.overlay);
  hud.overlay.hidden = false;
  const driving = mode === 'drive';
  const resume = h('button.primary', { type: 'button', onclick: () => setPaused(false) }, h('span', { text: driving ? 'Keep driving' : 'Keep playing' }));
  hud.overlay.append(h('div.card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Paused' },
    h('h2', { text: 'Paused' }),
    h('p', { text: 'Your progress is kept.' }),
    h('p', { text: driving
      ? (touchOnly ? 'To drive, hold Go and steer with Left and Right. Back backs up, Brake stops and Horn honks. You can hold two buttons at once.'
        : 'To drive, use the arrow keys or W A S D. Up goes, down backs up, left and right steer. Space brakes and H honks. On a touch screen, use the buttons.')
      : (touchOnly ? 'To walk, tap the ground. To run, double-tap, or turn on the Run button. Stand in a ring and tap Play.'
        : 'To walk, click or tap the ground, or use the arrow keys or W A S D. To run, double-click or double-tap, hold Shift with the keys, or turn on the Run button. Stand in a ring and press Enter or Space, or tap Play.') }),
    h('div.actions', null, resume,
      h('button', { type: 'button', onclick: () => { toggleSound(); setPaused(true); } }, h('span', { text: sound.on ? 'Turn sound off' : 'Turn sound on' })),
      mode === 'station' ? h('button', { type: 'button', onclick: () => { setPaused(false); exitStation(); } }, h('span', { text: 'Leave this station' })) : null,
      driving ? h('button', { type: 'button', onclick: () => { setPaused(false); exitDrive(); } }, h('span', { text: 'Park and get out' })) : null)));
  resume.focus();
}

function showStamp(skill) {
  sound.play('stamp');
  clear(hud.overlay);
  hud.overlay.hidden = false;
  const ok = h('button.primary', { type: 'button', onclick: () => { hud.overlay.hidden = true; clear(hud.overlay); hud.panelBody.querySelector('button')?.focus(); } }, h('span', { text: 'OK' }));
  hud.overlay.append(h('div.card.stamp-card', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Stamp earned' },
    h('div.stamp-art', { html: EMBLEMS[stationDef?.emblem || 'drone'] }),
    h('h2', { text: 'Stamp earned' }),
    h('p', null, h('strong', { text: `${stationDef?.title}: ` }), skill),
    h('p', { text: `You have ${stampCount()} of 6 stamps.` }),
    h('div.actions', null, ok)));
  refreshHud();
  ok.focus();
}

// ---------- demo mode: presenter menu ----------
/** A clearly labelled Demo chip that opens a menu to jump to any station or the drive. */
function buildDemoMenu() {
  hud.demoBtn = h('button.demo-chip', { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'demo-menu', onclick: () => setDemoMenu(hud.demoMenu.hidden) },
    h('span.demo-dot', { 'aria-hidden': 'true' }), h('span', { text: 'Demo' }));
  hud.demoMenu = h('div#demo-menu.demo-menu', { hidden: true, role: 'group', 'aria-label': 'Demo: jump to' });
  hud.demo = h('div.demo', null, hud.demoBtn, hud.demoMenu);
}
function fillDemoMenu() {
  clear(hud.demoMenu);
  const go = (label, fn, cls = '') => h(`button${cls}`, { type: 'button', onclick: fn }, h('span', { text: label }));
  hud.demoMenu.append(
    h('p.demo-head', { text: 'Demo mode. Nothing is saved. Jump to:' }),
    ...STATIONS.map((s) => go(s.title, () => demoJump(s.id))),
    go('Drive the bus', () => demoJump('drive')),
    go('Exit demo', () => { location.replace(exitDemoUrl(location.href)); }, '.demo-exit'));
}
function setDemoMenu(open) {
  if (!hud.demoMenu) return;
  if (open) {
    fillDemoMenu();
    if (!hud.passportList.hidden) togglePassport();
  }
  hud.demoMenu.hidden = !open;
  hud.demoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) hud.demoMenu.querySelector('button')?.focus();
}
/** Leave whatever is open, then stand in a station's ring, or start the drive. */
async function demoJump(id) {
  setDemoMenu(false);
  if (paused) setPaused(false);
  if (entering || leavingDrive) return;
  if (mode === 'station') exitStation();
  else if (mode === 'drive') await exitDrive();
  if (mode !== 'hub') return;
  hud.toast.hidden = true;
  teleport(id);
  if (id === 'drive') await startDrive();
  else hud.prompt.querySelector('button')?.focus();
}

/** Put the player in a ring, facing its station. */
function teleport(id) {
  if (mode !== 'hub') return;
  const p = ringPos.get(id);
  if (!p) return;
  let yaw = Math.PI; // the drive spot faces the bus door
  const sm = id === 'drive' ? null : hub.get(`station_${id}`);
  if (sm) {
    const q = new THREE.Quaternion(); sm.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    yaw = Math.atan2(fwd.x, fwd.z);
  }
  keysDown.clear();
  player.place(p.x, p.z, yaw);
  avatar.play('idle');
  follow.snap(player.position);
  hud.hint.hidden = true;
  updatePrompt(ringAtFast(p.x, p.z));
}

// ---------- ring labels ----------
const ringLabels = new Map();
function makeLabelSprite() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(1.45, 0.45, 1);
  sp.renderOrder = 10;
  return { sp, c, tex };
}
function drawLabel(l, title, sub, mark) {
  const g = l.c.getContext('2d');
  g.clearRect(0, 0, 512, 160);
  g.fillStyle = 'rgba(12,22,52,0.88)';
  g.beginPath(); g.roundRect(8, 8, 496, 144, 28); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 5; g.stroke();
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const fit = (text, weight, size) => {
    do { g.font = `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`; size -= 2; } while (g.measureText(text).width > 460 && size > 20);
  };
  fit(title, 'bold', 56);
  g.fillText(title, 256, sub ? 58 : 80);
  if (sub) { fit(sub, '600', 38); g.fillStyle = mark === 'check' ? '#ffe07a' : '#d8e4ff'; g.fillText(sub, 256, 112); }
  l.tex.needsUpdate = true;
}
/** Ring labels draw without depth testing, so they show through walls. Hide them in stations. */
function setRingLabelsVisible(v) {
  for (const l of ringLabels.values()) l.sp.visible = v;
  if (driveSpot?.label) driveSpot.label.visible = v;
}
function updateRingLabels() {
  if (!hub) return;
  const n = stampCount();
  for (const s of STATIONS) {
    let l = ringLabels.get(s.id);
    if (!l) {
      l = makeLabelSprite();
      const p = hub.pos(`ring_${s.id}`);
      l.sp.position.set(p.x, 1.95, p.z);
      scene.add(l.sp);
      ringLabels.set(s.id, l);
    }
    if (s.id === 'badge' && isDriveUnlocked(save.data)) drawLabel(l, s.title, '✓ Badge built', 'check');
    else if (s.id === 'badge') drawLabel(l, s.title, n < 6 ? `Locked: ${n} of 6 stamps` : 'Open', n < 6 ? 'lock' : null);
    else drawLabel(l, s.title, save.hasStamp(s.id) ? '✓ Stamp earned' : null, 'check');
  }
}

// ---------- hub interaction ----------
const ringPos = new Map();
function cacheRings() { for (const s of STATIONS) ringPos.set(s.id, hub.pos(`ring_${s.id}`)); }
function ringAtFast(x, z) {
  for (const [id, p] of ringPos) if ((p.x - x) ** 2 + (p.z - z) ** 2 <= RING_RADIUS * RING_RADIUS) return id;
  return null;
}

/** When the player last stepped into a ring, and when focus last moved. */
let ringEnteredAt = -1, focusMovedAt = 0;
document.addEventListener('focusin', () => { focusMovedAt = performance.now(); });

function updatePrompt(id) {
  nearRing = id;
  if (id) ringEnteredAt = performance.now();
  clear(hud.prompt);
  if (!id) { hud.prompt.hidden = true; return; }
  hud.prompt.hidden = false;
  hud.hint.hidden = true;
  if (id === 'drive') {
    hud.prompt.append(
      h('span.prompt-title', { text: 'Drive the bus' }),
      h('button.primary', { type: 'button', onclick: () => startDrive() }, icon('play'), h('span', { text: 'Drive' })),
      h('span.prompt-keys', { text: 'or press Enter' }));
    announce('Drive the bus. Press Enter or Space, or tap Drive.');
    return;
  }
  const def = STATIONS.find((s) => s.id === id);
  const n = stampCount();
  if (id === 'badge' && n < 6) {
    hud.prompt.append(icon('lock'), h('span', { text: `Badge Builder is locked. You have ${n} of 6 stamps. Earn all six to open it.` }));
    announce(`Badge Builder is locked. ${n} of 6 stamps.`);
    return;
  }
  hud.prompt.append(
    h('span.prompt-title', { text: def.title }),
    h('button.primary', { type: 'button', onclick: () => enterStation(id) }, icon('play'), h('span', { text: 'Play' })),
    h('span.prompt-keys', { text: 'or press Enter' }));
  announce(`${def.title}. Press Enter or Space, or tap Play.`);
}

function walkToStation(id) {
  if (mode !== 'hub') return;
  const p = ringPos.get(id);
  if (p) player.walkTo(p.x, p.z);
}

const keysDown = new Set();
let shiftHeld = false;
const keyVec = { x: 0, z: 0, run: false };
const camFwd = new THREE.Vector3();
function readKeys() {
  let f = 0, r = 0;
  if (keysDown.has('ArrowUp') || keysDown.has('KeyW')) f += 1;
  if (keysDown.has('ArrowDown') || keysDown.has('KeyS')) f -= 1;
  if (keysDown.has('ArrowRight') || keysDown.has('KeyD')) r += 1;
  if (keysDown.has('ArrowLeft') || keysDown.has('KeyA')) r -= 1;
  // camera-relative, on the ground plane
  camFwd.set(-follow.offset.x, 0, -follow.offset.z).normalize();
  keyVec.x = camFwd.x * f + -camFwd.z * r;
  keyVec.z = camFwd.z * f + camFwd.x * r;
  keyVec.run = shiftHeld;
  return keyVec;
}

window.addEventListener('keydown', (e) => {
  shiftHeld = e.shiftKey;
  if (mode === 'loading' || mode === 'select') return;
  if (e.key === 'Escape' && hud.demoMenu && !hud.demoMenu.hidden) { setDemoMenu(false); hud.demoBtn.focus(); e.preventDefault(); return; }
  if (e.key === 'Escape' && hud.passportList && !hud.passportList.hidden) { togglePassport(); hud.passportBtn.focus(); e.preventDefault(); return; }
  if (e.key === 'Escape' || (e.key.toLowerCase() === 'p' && (mode === 'hub' || mode === 'drive'))) {
    if (!hud.overlay.hidden && !paused) return; // stamp card open
    setPaused(!paused);
    e.preventDefault();
    return;
  }
  if (mode !== 'hub' || paused) return;
  const t = /** @type {HTMLElement} */ (e.target);
  const inControl = t && t !== document.body && /^(BUTTON|INPUT|SELECT|TEXTAREA|A)$/.test(t.tagName);
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) {
    if (inControl && e.code.startsWith('Arrow') && t.closest('.passport')) return;
    keysDown.add(e.code);
    e.preventDefault();
    hud.hint.hidden = true;
  } else if ((e.key === 'Enter' || e.key === ' ') && nearRing && (!inControl || (e.key === 'Enter' && staleHudFocus(t)))) {
    e.preventDefault();
    enterStation(nearRing);
  }
});
/**
 * Focus left behind on a HUD toggle (Passport, Run, Sound, Pause) after the
 * player walked into a ring. Enter then opens the station, as it would with
 * nothing focused. If the player moved focus to the button while already
 * standing in the ring, or the passport list is open, Enter acts on the button.
 */
function staleHudFocus(t) {
  if (!t.closest('.passport-btn, .topbar button')) return false;
  if (!hud.passportList.hidden) return false;
  return ringEnteredAt > focusMovedAt;
}

window.addEventListener('keyup', (e) => { keysDown.delete(e.code); shiftHeld = e.shiftKey; });
window.addEventListener('blur', () => { keysDown.clear(); shiftHeld = false; });

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.06);
const hit = new THREE.Vector3();
let down = null;
/** last tap, for double-click / double-tap to run */
const lastTap = { x: 0, y: 0, t: -1e9 };
const DOUBLE_MS = 400, DOUBLE_PX = 40;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  if (hud.demoMenu && !hud.demoMenu.hidden) setDemoMenu(false);
});
canvas.addEventListener('pointerup', (e) => {
  if (!down || mode !== 'hub' || paused) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  down = null;
  if (moved > 12) return;
  const now = performance.now();
  const dbl = now - lastTap.t < DOUBLE_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < DOUBLE_PX;
  lastTap.x = e.clientX; lastTap.y = e.clientY; lastTap.t = dbl ? -1e9 : now;
  const cr = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - cr.left) / cr.width) * 2 - 1, -((e.clientY - cr.top) / cr.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  if (!ray.ray.intersectPlane(ground, hit)) return;
  hud.hint.hidden = true;
  const ring = ringAtFast(hit.x, hit.z);
  if (ring) { const p = ringPos.get(ring); player.walkTo(p.x, p.z, { run: dbl }); }
  else player.walkTo(hit.x, hit.z, { run: dbl });
});

// ---------- stations ----------
let entering = false;
async function enterStation(id) {
  if (id === 'drive') return startDrive();
  if (mode !== 'hub' || entering || paused) return;
  const def = STATIONS.find((s) => s.id === id);
  if (!def) return;
  if (id === 'badge' && stampCount() < 6) return;
  entering = true;
  sound.play('click');
  keysDown.clear();
  player.stop();
  avatar.play('idle');
  const rp = ringPos.get(id);
  player.position.set(rp.x, player.position.y, rp.z);
  const sm = hub.get(`station_${id}`);
  if (sm) {
    const q = new THREE.Quaternion(); sm.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    player.yaw = Math.atan2(fwd.x, fwd.z);
    avatar.root.rotation.y = player.yaw;
  }
  stationDef = def;
  setMode('station');
  hud.toast.hidden = true;
  hud.prompt.hidden = true; hud.hint.hidden = true; hud.passport.hidden = true; hud.runBtn.hidden = true;
  if (!hud.passportList.hidden) togglePassport();
  setDemoMenu(false);
  // Sound and Pause ride in the panel's top row while a station is open, so the panel never covers them.
  hud.panelTop.append(hud.soundBtn, hud.pauseBtn);
  hud.panel.hidden = false;
  setRingLabelsVisible(false);
  clear(hud.panelBody);
  hud.panelBody.append(h('p', { text: `Opening ${def.title}...` }));
  // Cut to the station's camera marker.
  const pose = hub.camPose(id);
  camera.position.copy(pose.position);
  camera.quaternion.copy(pose.quaternion);
  resize();
  try {
    const mod = await def.module();
    station = mod.default(def);
    const ctx = makeContext(def);
    await station.load(ctx);
    station.start(ctx);
  } catch (err) {
    console.error(err);
    clear(hud.panelBody);
    hud.panelBody.append(h('h2', { text: def.title }), h('p', { text: 'This station could not load. Go back to the bus and try again.' }));
  } finally {
    entering = false;
  }
}

function makeContext(def) {
  return {
    scene, camera, hub,
    panel: hud.panelBody,
    avatar: { play: (n) => avatar.play(n) },
    sound,
    reducedMotion: reduced,
    loadGLTF: (url) => loadGLTF(url),
    viewport: () => { const { w, h: ht } = screenSize(); const c = panelCover(); return { width: w, height: ht, panelWidth: c.right, panelHeight: c.bottom, safe: safeArea() }; },
    /** Portrait only: how tall the bottom sheet is ('short' leaves more room for the station's own view). */
    setSheet: (size) => { hud.panel.classList.toggle('sheet-short', size === 'short'); hud.panel.classList.toggle('sheet-tall', size === 'tall'); resize(); },
    onResize: (fn) => resizeHandlers.add(fn),
    showStamp,
    exit: () => exitStation(),
    save: {
      levelStars: (lv) => save.levelStars(def.id, lv),
      recordLevel: (lv, stars) => save.recordLevel(def.id, lv, stars),
      awardStamp: (skill) => { const n = save.awardStamp(def.id, skill); refreshHud(); return n; },
      hasStamp: () => save.hasStamp(def.id),
      getBadge: () => save.getBadge(),
      setBadge: (b) => save.setBadge(b),
    },
  };
}

function exitStation() {
  if (mode !== 'station') return;
  try { station?.dispose(); } catch (e) { console.error(e); }
  station = null;
  resizeHandlers.clear();
  hud.panel.classList.remove('sheet-short', 'sheet-tall');
  setMode('hub');
  hud.panel.hidden = true;
  hud.top.append(hud.soundBtn, hud.pauseBtn);
  setRingLabelsVisible(true);
  clear(hud.panelBody);
  hud.passport.hidden = false;
  hud.runBtn.hidden = false;
  avatar.play('idle');
  resize();
  follow.snap(player.position);
  refreshHud();
  const id = stationDef?.id;
  stationDef = null;
  updatePrompt(id ? ringAtFast(player.position.x, player.position.z) : null);
  hud.prompt.querySelector('button')?.focus();
  maybeTellDriveReady();
}

// ---------- Drive the Bus (finale) ----------
const BUS_ICON = '<svg viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="7" width="26" height="15" rx="4" fill="none" stroke="currentColor" stroke-width="2.5"/><path d="M3 15h26M10 7v8M17 7v8M24 7v8" stroke="currentColor" stroke-width="2"/><circle cx="9" cy="24" r="3" fill="currentColor"/><circle cx="23" cy="24" r="3" fill="currentColor"/></svg>';
/** @type {{ring:THREE.Object3D|null, label:THREE.Sprite}|null} */ let driveSpot = null;
/** @type {any} */ let drive = null;
let leavingDrive = false;
const fadeEl = h('div.fade', { 'aria-hidden': 'true' });
document.getElementById('app')?.append(fadeEl);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function fade(on) {
  fadeEl.classList.toggle('on', on);
  await wait(reduced ? 30 : 340);
}

/** Once the badge is built, a marked spot appears by the bus door. Never shown before. */
function refreshDriveSpot() {
  if (driveSpot || !hub || !isDriveUnlocked(save.data)) return;
  let p = { x: DRIVE_SPOT.x, z: DRIVE_SPOT.z };
  if (!hub.nav.isWalkable(p.x, p.z)) p = hub.nav.nearestWalkable(p.x, p.z) || p;
  const src = hub.get('ring_badge');
  let ring = null;
  if (src) {
    ring = src.clone();
    ring.name = 'ring_drive';
    ring.position.set(p.x, src.position.y, p.z);
    hub.root.add(ring);
  }
  const l = makeLabelSprite();
  drawLabel(l, 'Drive the bus', null, null);
  l.sp.position.set(p.x, 1.95, p.z);
  l.sp.name = 'label_drive';
  l.sp.visible = mode !== 'station' && mode !== 'drive';
  hub.root.add(l.sp);
  driveSpot = { ring, label: l.sp, tex: l.tex };
  ringPos.set('drive', new THREE.Vector3(p.x, 0, p.z));
}

function showToast(text) {
  clear(hud.toast);
  const ok = h('button', { type: 'button', onclick: () => { hud.toast.hidden = true; } }, h('span', { text: 'OK' }));
  hud.toast.append(h('span.toast-icon', { html: BUS_ICON }), h('p', { text }), ok);
  hud.toast.hidden = false;
}

/** Tell the player once, after the badge is first built, that the bus is ready. */
function maybeTellDriveReady() {
  if (DEMO || !isDriveUnlocked(save.data) || save.flag('driveReady')) return;
  save.setFlag('driveReady');
  refreshDriveSpot();
  showToast('Your badge is done. The bus is ready to drive. Find the new ring by the bus door.');
}

async function startDrive() {
  if (mode !== 'hub' || entering || paused || !driveSpot) return;
  entering = true;
  sound.play('click');
  keysDown.clear();
  player.stop();
  avatar.play('idle');
  setMode('drive');
  hud.prompt.hidden = true; hud.hint.hidden = true; hud.passport.hidden = true; hud.runBtn.hidden = true; hud.toast.hidden = true;
  hud.passportList.hidden = true; hud.passportBtn.setAttribute('aria-expanded', 'false'); hud.passport.classList.remove('open');
  setDemoMenu(false);
  const note = h('p.drive-loading', { role: 'status', text: 'Getting the bus ready...' });
  ui.append(note);
  let d = null;
  try {
    const mod = await import('./drive/index.js');
    d = mod.default();
    const hide = [...hub.busSet, ...STATIONS.map((s) => hub.get(`ring_${s.id}`)).filter(Boolean),
      ...hub.mergedByMaterial('G_RowHouses'), avatar.root];
    if (driveSpot.ring) hide.push(driveSpot.ring);
    await d.load({
      scene, camera, ui, sound, reducedMotion: reduced,
      loadGLTF: (url) => loadGLTF(url),
      hide, start: BUS_PARKED,
      isPaused: () => paused,
      onPark: () => exitDrive(),
    });
    await fade(true);
    setRingLabelsVisible(false);
    d.start();
    drive = d;
    note.remove();
    await fade(false);
  } catch (err) {
    console.error(err);
    try { d?.dispose(); } catch { /* nothing to free */ }
    drive = null;
    note.remove();
    backToHub();
    fadeEl.classList.remove('on');
    showToast('The bus could not load. You are back at the bus door.');
  } finally {
    entering = false;
  }
}

/** Hub HUD and labels back, after a drive. */
function backToHub() {
  setMode('hub');
  setRingLabelsVisible(true);
  hud.passport.hidden = false;
  hud.runBtn.hidden = false;
  avatar.root.visible = true;
  resize();
  follow.snap(player.position);
  refreshHud();
}

async function exitDrive() {
  if (mode !== 'drive' || !drive || leavingDrive) return;
  leavingDrive = true;
  if (paused) { paused = false; hud.overlay.hidden = true; clear(hud.overlay); }
  sound.play('click');
  await fade(true);
  try { drive.dispose(); } catch (e) { console.error(e); }
  drive = null;
  // step out of the door and onto the walk, just past the drive spot
  player.place(DOOR_STEP.x, DOOR_STEP.z, 0);
  const spot = ringPos.get('drive') || DRIVE_SPOT;
  player.walkTo(spot.x, spot.z + RING_RADIUS + 0.35);
  backToHub();
  nearRing = null;
  hud.prompt.hidden = true;
  await fade(false);
  leavingDrive = false;
  /** @type {HTMLElement} */ (document.activeElement)?.blur?.();
  announce('You parked the bus and got out.');
}

// ---------- loop ----------
/**
 * Aim for 30 frames a second. If frames run slow for three seconds in a row
 * while playing, lower the pixel ratio a step (never under 1).
 */
let slowSeconds = 0;
function checkSpeed() {
  if (mode === 'loading' || mode === 'select' || paused || document.hidden) { slowSeconds = 0; return; }
  slowSeconds = fps < 27 ? slowSeconds + 1 : 0;
  if (slowSeconds < 3) return;
  slowSeconds = 0;
  const { w, h: ht } = screenSize();
  const now = renderer.getPixelRatio();
  if (pixelRatioFor(window.devicePixelRatio, w * ht, slowSteps + 1, touchOnly) < now) { slowSteps++; resize(); }
}

const timer = new THREE.Timer();
let frames = 0, fpsT = 0, fps = 0;
function tick() {
  timer.update();
  const dt = Math.min(0.1, timer.getDelta());
  frames++; fpsT += dt; if (fpsT >= 1) { fps = frames / fpsT; frames = 0; fpsT = 0; checkSpeed(); }
  if (!paused) {
    if (mode === 'hub') {
      player.update(dt, readKeys());
      follow.update(player.position, dt);
      const r = ringAtFast(player.position.x, player.position.z);
      if (r !== nearRing) updatePrompt(r);
    } else if (mode === 'station') {
      avatar.update(dt);
      station?.update?.(dt);
    } else if (mode === 'drive') {
      drive?.update(dt);
    } else if (mode === 'select' && !reduced) {
      const t = performance.now() * 0.00005;
      camera.position.set(1.5 + Math.sin(t) * 8, 6, 15 + Math.cos(t) * 4);
      camera.lookAt(1.5, 1, 3);
    }
  }
  renderer.render(scene, camera);
}

// ---------- boot ----------
async function boot() {
  const progress = loadingScreen();
  resize();
  const [h0, roster] = await Promise.all([loadHub((f) => progress(f * 0.97)), loadRoster()]);
  hub = h0;
  if (hub.missing.length) console.warn('hub.glb is missing markers:', hub.missing.join(', '));
  scene.add(hub.root);
  cacheRings();
  progress(1);
  renderer.compile(scene, camera);
  setMode('select');
  renderer.setAnimationLoop(tick);
  const entry = await selectScreen(roster);
  save.setCharacter(entry.id);
  sound.play('click');
  avatar = await createAvatar(entry, { reduced });
  scene.add(avatar.root);
  player = new PlayerController(avatar, hub.nav);
  const sp = hub.get('spawn_player');
  const spos = hub.pos('spawn_player');
  let yaw = Math.PI;
  if (sp) {
    const q = new THREE.Quaternion(); sp.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    yaw = Math.atan2(fwd.x, fwd.z); // avatar model faces +Z
  }
  player.place(spos.x, spos.z, yaw);
  follow = new FollowCamera(camera);
  follow.snap(player.position);
  buildHud();
  setMode('hub');
  resize();
  announce('You are outside the bus. Walk to a glowing ring to play a station.');
  maybeTellDriveReady();
  if (DEBUG) {
    window.__mcb = {
      get mode() { return mode; }, get fps() { return fps; }, get nearRing() { return nearRing; },
      get speed() { return player.speed; },
      scene, camera,
      drawCalls: hub.drawCalls,
      ring: (id) => { const p = ringPos.get(id); return { x: p.x, z: p.z }; },
      player: () => ({ x: player.position.x, z: player.position.z }),
      walkTo: (x, z) => player.walkTo(x, z),
      walkToStation, teleport, demo: DEMO, info: () => renderer.info.render, mem: () => ({ ...renderer.info.memory }),
      get pixelRatio() { return renderer.getPixelRatio(); },
      get drive() { return drive?.debug || null; },
      startDrive, exitDrive,
      get driveSpot() { return !!driveSpot; },
    };
  }
}

boot().catch((e) => {
  console.error(e);
  fatal('The game could not load. Check your connection to this page and reload.');
});
