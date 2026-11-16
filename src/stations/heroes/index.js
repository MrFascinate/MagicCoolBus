import * as THREE from 'three';
import './heroes.css';
import content from './content.json';
import { h, clear, announce } from '../../ui/dom.js';
import { icon, starRow } from '../../ui/icons.js';
import { DEBUG } from '../../core/env.js';
import { createLevelRun, isUnlocked } from './logic.js';
import { hologramize, makeLabel, drawLabel, drawCard, makeEmitter } from './holo.js';

/**
 * Hologram Heroes station module.
 * Each round: a real problem, a row of invention holograms, pick the one that
 * solved it, meet the inventor, then meet a person working in STEM today.
 * @typedef {import('../registry.js').StationContext} StationContext
 */

const TABLE_TOP_OFFSET = -0.475;   // table top (MCB_AR_Top) sits this far below holo_center
const PROP_SCALE = 0.5;
const SPACING = 0.56;
const SPACING_4 = 0.52;            // four choices sit a little closer so the end ones clear the bus walls
/**
 * The hologram table stands near the side wall (holo_center z 0.78, wall about
 * z 1.15), so a row of four could not be centred on it without hitting the
 * wall. While the station is open the table slides to the middle of the bay
 * (TABLE_Z) and the row is centred on it; dispose() puts it back.
 */
const TABLE_Z = 0;
const TABLE_NODES = ['MCB_AR_Table', 'MCB_AR_Top'];
const BASE_DROP = 0.3;             // hologram bottoms float this far below holo_center
const FADE_RATE = 2.2;             // opacity per second
const MOVE_TIME = 0.6;
const WRONG_SHOW = 2.8;            // seconds a wrong pick shows what it solved before fading
const MAX_SLOTS = 4;

export default function createHologramHeroes() {
  /** @type {StationContext} */ let ctx;
  let gltfScene = null;
  /** @type {THREE.Vector3} */ let center;
  /** @type {Map<string, any>} */ const holos = new Map();
  let holoBase = null, card = null, cardCanvas = null, cardTex = null, emitter = null;
  const slots = [];
  const root = new THREE.Group();
  root.name = 'hh_root';
  let run = null;
  let mode = 'select';           // select | round | inventor | partner | result
  let ui = {};
  let pointerDown = null;
  let canvasEl = null;
  // camera tween
  let camTween = null;
  const camFromPos = new THREE.Vector3(), camToPos = new THREE.Vector3();
  const camFromQ = new THREE.Quaternion(), camToQ = new THREE.Quaternion();
  const viewDir = new THREE.Vector3(-1, 0.4, 0.32).normalize();
  const rowCenter = new THREE.Vector3();
  const rowDir = new THREE.Vector3(0, 0, 1);
  let frameWidth = 1.2;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const hits = [];
  const pickables = [];
  let tableShift = 0;
  const movedTable = [];

  const put = (el, ...kids) => el.append(...kids.filter(Boolean));
  const props = content.props;
  const people = content.people;

  // ---------- 3D setup ----------
  async function load(c) {
    ctx = c;
    center = ctx.hub.pos('holo_center');
    tableShift = TABLE_Z - center.z;
    center.z = TABLE_Z;
    // View from the open rear of the bus, looking in at the table with the
    // LED wall behind it. (cam_heroes looks in from the side, where the bus
    // wall hides half the table.) The row of holograms runs across this view.
    rowCenter.set(center.x, center.y, center.z);
    rowDir.set(0, 0, 1);
    const gltf = await ctx.loadGLTF('assets/heroes/heroes.glb');
    gltfScene = gltf.scene;
    emitter = makeEmitter();
    const nodes = {};
    gltfScene.traverse((o) => { if (o.name) nodes[o.name] = o; });

    for (const id of Object.keys(props)) {
      const node = nodes[id];
      if (!node) { console.warn(`heroes.glb has no ${id}`); continue; }
      const wrap = new THREE.Group();
      wrap.name = `hh_${id}`;
      wrap.userData.holoId = id;
      node.removeFromParent();
      node.position.set(0, 0, 0);
      node.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(node);
      const turn = new THREE.Group();     // spins
      node.position.set(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      turn.add(node);
      wrap.add(turn);
      wrap.scale.setScalar(PROP_SCALE);
      wrap.rotation.y = Math.atan2(viewDir.x, viewDir.z); // front (+Z) toward the camera
      const mats = hologramize(node);
      const label = makeLabel();
      label.sp.userData.holoId = id;
      root.add(label.sp);
      label.sp.visible = false;
      wrap.visible = false;
      root.add(wrap);
      const hd = {
        id, wrap, turn, mats, label, height: (box.max.y - box.min.y) * PROP_SCALE,
        alpha: 0, alphaTarget: 0,
        from: new THREE.Vector3(), to: new THREE.Vector3(), moveT: 1,
        wrongTimer: 0,
      };
      holos.set(id, hd);
      pickables.push(wrap, label.sp);
    }

    // table emitter disc from the model, on the table top
    if (nodes.holo_base) {
      holoBase = nodes.holo_base;
      holoBase.removeFromParent();
      holoBase.position.set(center.x, center.y + TABLE_TOP_OFFSET + 0.003, center.z);
      root.add(holoBase);
    }
    // person card (no portrait, by rule)
    if (nodes.card_frame) {
      card = new THREE.Group();
      const cf = nodes.card_frame;
      cf.removeFromParent();
      cf.position.set(0, 0, 0);
      cardCanvas = document.createElement('canvas');
      cardCanvas.width = 512; cardCanvas.height = 704;
      cardTex = new THREE.CanvasTexture(cardCanvas);
      cardTex.colorSpace = THREE.SRGBColorSpace;
      cardTex.flipY = false; // glTF UV convention
      cf.traverse((o) => {
        if (!o.isMesh) return;
        const swap = (m) => {
          if (m.name === 'HH_CardFace') { m.dispose(); return new THREE.MeshBasicMaterial({ map: cardTex }); }
          const nm = new THREE.MeshLambertMaterial({ color: 0x8ff0ff, emissive: 0x1d5866 });
          m.dispose();
          return nm;
        };
        o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
      });
      card.add(cf);
      card.scale.setScalar(0.78);
      card.visible = false;
      root.add(card);
    }
    for (let i = 0; i < MAX_SLOTS; i++) {
      const e = emitter.make();
      e.visible = false;
      root.add(e);
      slots.push(e);
    }
  }

  const spacingFor = (n) => (n >= 4 ? SPACING_4 : SPACING);
  function slotPos(i, n, out) {
    out.copy(rowCenter).addScaledVector(rowDir, (i - (n - 1) / 2) * spacingFor(n));
    out.y = center.y - BASE_DROP;
    return out;
  }

  // ---------- camera ----------
  function cameraTarget() {
    const cam = ctx.camera;
    const savedP = cam.position.clone(), savedQ = cam.quaternion.clone();
    const look = new THREE.Vector3(rowCenter.x, center.y - 0.02, rowCenter.z);
    const half = frameWidth / 2;
    const pts = [];
    for (const a of [-half, half]) for (const y of [-0.42, 0.34]) for (const b of [-0.2, 0.2]) {
      pts.push(new THREE.Vector3(look.x + rowDir.x * a - rowDir.z * b, look.y + y, look.z + rowDir.z * a + rowDir.x * b));
    }
    const v = new THREE.Vector3();
    const fits = (d) => {
      cam.position.copy(look).addScaledVector(viewDir, d);
      cam.lookAt(look);
      cam.updateMatrixWorld(true);
      return pts.every((p) => { v.copy(p).project(cam); return Math.abs(v.x) <= 0.92 && Math.abs(v.y) <= 0.86; });
    };
    let lo = 0.6, hi = 12;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi);
    camToPos.copy(cam.position);
    camToQ.copy(cam.quaternion);
    cam.position.copy(savedP); cam.quaternion.copy(savedQ); cam.updateMatrixWorld(true);
  }

  function frameFor(width) {
    frameWidth = width;
    cameraTarget();
    camFromPos.copy(ctx.camera.position);
    camFromQ.copy(ctx.camera.quaternion);
    if (ctx.reducedMotion) { ctx.camera.position.copy(camToPos); ctx.camera.quaternion.copy(camToQ); camTween = null; }
    else camTween = { t: 0, dur: 0.8 };
  }

  // ---------- holograms ----------
  function showHolo(id, pos, number, instant) {
    const hd = holos.get(id);
    if (!hd) return;
    const was = hd.wrap.visible && hd.alpha > 0.01;
    hd.wrap.visible = true;
    hd.label.sp.visible = true;
    hd.alphaTarget = 1;
    hd.wrongTimer = 0;
    if (!was || instant || ctx.reducedMotion) {
      hd.wrap.position.copy(pos);
      hd.to.copy(pos); hd.moveT = 1;
      if (!was) hd.alpha = ctx.reducedMotion || instant ? 1 : 0;
    } else {
      hd.from.copy(hd.wrap.position); hd.to.copy(pos); hd.moveT = 0;
    }
    drawLabel(hd.label, { title: props[id].label, number });
    placeLabel(hd);
    applyAlpha(hd);
  }

  function placeLabel(hd) {
    // the label canvas is drawn bottom-up, so lift the sprite by half its extra height
    hd.label.sp.position.set(hd.wrap.position.x + viewDir.x * 0.14, hd.wrap.position.y - 0.12 + (hd.label.sp.scale.y - 0.244) / 2, hd.wrap.position.z + viewDir.z * 0.14);
  }

  function hideHolo(id, instant) {
    const hd = holos.get(id);
    if (!hd) return;
    hd.alphaTarget = 0;
    hd.wrongTimer = 0;
    if (instant || ctx.reducedMotion) { hd.alpha = 0; hd.wrap.visible = false; hd.label.sp.visible = false; }
  }

  function applyAlpha(hd) {
    for (let i = 0; i < hd.mats.length; i++) hd.mats[i].mat.opacity = hd.mats[i].base * hd.alpha;
    hd.label.mat.opacity = hd.alpha;
  }

  function hideAll() {
    for (const id of holos.keys()) hideHolo(id, true);
    for (const s of slots) s.visible = false;
    if (card) card.visible = false;
  }

  function layoutChoices() {
    const r = run.round;
    const n = r.choices.length;
    const p = new THREE.Vector3();
    for (const id of holos.keys()) if (!r.choices.includes(id)) hideHolo(id, true);
    r.choices.forEach((id, i) => {
      slotPos(i, n, p);
      if (run.isRemoved(id)) hideHolo(id, true);
      else showHolo(id, p, i + 1, true);
      const s = slots[i];
      s.visible = true;
      s.position.copy(p).add(new THREE.Vector3(0, -0.03, 0));
    });
    for (let i = n; i < MAX_SLOTS; i++) slots[i].visible = false;
    if (card) card.visible = false;
    frameFor(n * spacingFor(n) + 0.25);
  }

  function layoutMeet(propId, person) {
    const r = run.round;
    for (const id of holos.keys()) if (id !== propId) hideHolo(id, false);
    const p = new THREE.Vector3().copy(rowCenter).addScaledVector(rowDir, -0.3);
    p.y = center.y - BASE_DROP;
    showHolo(propId, p, 0, false);
    const hd = holos.get(propId);
    drawLabel(hd.label, { title: props[propId].label, kind: 'picked' });
    for (let i = 0; i < MAX_SLOTS; i++) slots[i].visible = false;
    slots[0].visible = true;
    slots[0].position.set(p.x, p.y - 0.03, p.z);
    if (card) {
      const living = !!person.living;
      drawCard(cardCanvas, living
        ? { role: 'STEM today', name: person.name, line1: person.field, line2: null, living }
        : { role: 'Inventor', name: person.name, line1: person.years, line2: person.invention, living });
      cardTex.needsUpdate = true;
      card.position.copy(rowCenter).addScaledVector(rowDir, 0.3);
      card.position.y = center.y - BASE_DROP - 0.02;
      card.rotation.y = Math.atan2(viewDir.x, viewDir.z); // face the camera
      card.visible = true;
    }
    frameFor(1.25);
    void r;
  }

  // ---------- picking in 3D ----------
  function onPointerDown(e) { pointerDown = { x: e.clientX, y: e.clientY }; }
  function onPointerUp(e) {
    if (!pointerDown || mode !== 'round') return;
    const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
    pointerDown = null;
    if (moved > 12) return;
    ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, ctx.camera);
    ray.camera = ctx.camera;
    hits.length = 0;
    ray.intersectObjects(pickables, true, hits);
    for (const hit of hits) {
      let o = hit.object;
      while (o && !o.userData.holoId) o = o.parent;
      if (!o || !o.visible) continue;
      const id = o.userData.holoId;
      const hd = holos.get(id);
      if (!hd || hd.alphaTarget === 0) continue;
      pick(id);
      return;
    }
  }

  // ---------- panels ----------
  function start(c) {
    ctx = c;
    ctx.scene.add(root);
    for (const n of TABLE_NODES) {
      const o = ctx.hub.get(n);
      if (o) { movedTable.push(o); o.position.z += tableShift; o.updateMatrixWorld(true); }
    }
    canvasEl = document.getElementById('view');
    canvasEl?.addEventListener('pointerdown', onPointerDown);
    canvasEl?.addEventListener('pointerup', onPointerUp);
    ctx.onResize(() => { cameraTarget(); if (!camTween) { ctx.camera.position.copy(camToPos); ctx.camera.quaternion.copy(camToQ); } });
    previewIdle();
    showLevelSelect();
    if (DEBUG) window.__mcbHeroes = { holoScreen, get mode() { return mode; }, camera: ctx.camera };
  }

  /** Before a level starts, show three holograms turning over the table. */
  function previewIdle() {
    hideAll();
    const ids = ['inv_electron_microscope', 'inv_robot_arm', 'inv_solar_still'];
    const p = new THREE.Vector3();
    ids.forEach((id, i) => {
      slotPos(i, ids.length, p);
      showHolo(id, p, 0, true);
      slots[i].visible = true;
      slots[i].position.set(p.x, p.y - 0.03, p.z);
    });
    frameFor(ids.length * spacingFor(ids.length) + 0.25);
  }

  const starsOf = (id) => ctx.save.levelStars(id);

  function showLevelSelect() {
    mode = 'select';
    const p = ctx.panel;
    clear(p);
    p.append(h('h2', { text: content.title }), h('p', { text: content.intro }));
    const list = h('ul.level-list');
    for (const l of content.levels) {
      const open = isUnlocked(l.id, starsOf);
      list.append(h('li', null,
        h('button.level-card', { type: 'button', disabled: !open, 'data-level': l.id, onclick: () => startLevel(l.id) },
          h('span.level-name', { text: `Level ${l.id}: ${l.title}` }),
          h('span.level-goal', { text: open ? l.goal : `Clear level ${l.id - 1} to open this level.` }),
          open ? starRow(starsOf(l.id)) : h('span.level-lock', null, icon('lock'), h('span', { text: 'Locked' })))));
    }
    p.append(list);
    if (ctx.save.hasStamp()) p.append(h('p.stamp-note', null, icon('stamp'), h('span', { text: `Stamp earned: ${content.stampSkill}.` })));
    p.querySelector('.level-card:not([disabled])')?.focus();
  }

  function startLevel(id) {
    run = createLevelRun(content, id);
    showRound();
  }

  function showRound() {
    mode = 'round';
    const r = run.round;
    const l = run.level;
    hideAll();
    layoutChoices();
    const p = ctx.panel;
    clear(p);
    ui.message = h('div.message', { role: 'status' });
    ui.choices = h('ul.hh-choices');
    put(p,
      h('div.panel-head', null,
        h('button.link', { type: 'button', onclick: () => { previewIdle(); showLevelSelect(); } }, icon('back'), h('span', { text: 'Levels' })),
        h('h2', { text: `Level ${l.id}: ${l.title}` })),
      h('p.hh-round', { text: `Round ${run.index + 1} of ${run.rounds.length}` }),
      h('div.hh-problem', null, h('h3', { text: 'The problem' }), h('p', { text: r.problem })),
      h('p', { text: 'Which invention solved it? Tap a hologram or pick a button.' }),
      ui.choices,
      h('p.limit', { text: `Wrong picks this level: ${run.wrongPicks}. Stay at ${l.wrongLimit} or fewer for two stars.` }),
      ui.message,
    );
    drawChoices();
    ui.choices.querySelector('button:not([disabled])')?.focus();
    announce(`Round ${run.index + 1}. The problem: ${r.problem}`);
  }

  function drawChoices() {
    const r = run.round;
    clear(ui.choices);
    r.choices.forEach((id, i) => {
      const out = run.isRemoved(id);
      ui.choices.append(h('li', null,
        h(`button.hh-choice${out ? '.is-out' : ''}`, { type: 'button', disabled: out, 'data-prop': id, onclick: () => pick(id) },
          h('span.hh-num', { text: String(i + 1) }),
          h('span.hh-choice-text', null,
            h('strong', { text: props[id].label }),
            out ? h('span.hh-out', null, icon('remove'), h('span', { text: `Not this one. ${props[id].solved}` })) : null))));
    });
  }

  function setMessage(text, kind) {
    if (!ui.message) return;
    clear(ui.message);
    ui.message.className = 'message' + (kind ? ` ${kind}` : '');
    if (text) ui.message.append(icon(kind === 'miss' ? 'warn' : 'check'), h('span', { text }));
  }

  function pick(id) {
    if (mode !== 'round') return;
    const res = run.pick(id);
    if (res.result === 'ignored') return;
    const hd = holos.get(id);
    if (res.result === 'wrong') {
      ctx.sound.play('miss');
      drawLabel(hd.label, { title: 'Not this one', note: res.solvedLine, kind: 'wrong' });
      hd.wrongTimer = WRONG_SHOW;
      const focusNext = ui.choices.contains(document.activeElement);
      drawChoices();
      setMessage(`Not this one. ${res.solvedLine} Try another.`, 'miss');
      ctx.panel.querySelector('.limit').textContent = `Wrong picks this level: ${run.wrongPicks}. Stay at ${run.level.wrongLimit} or fewer for two stars.`;
      announce(`Not this one. ${res.solvedLine}`);
      if (focusNext) ui.choices.querySelector('button:not([disabled])')?.focus();
      return;
    }
    ctx.sound.play('win');
    ctx.avatar.play('cheer');
    showInventor();
  }

  function personBlock(person) {
    return h('div.hh-person', null,
      h('p.hh-role', { text: person.living ? 'STEM today' : 'Inventor' }),
      h('h3.hh-name', { text: person.name }),
      h('p.hh-meta', { text: person.living ? person.field : person.years }));
  }

  function showInventor() {
    mode = 'inventor';
    const r = run.round;
    const person = people[r.inventor];
    layoutMeet(r.answer, person);
    const p = ctx.panel;
    clear(p);
    put(p,
      h('p.message.win', null, icon('check'), h('span', { text: `Yes. The ${props[r.answer].label} solved it.` })),
      personBlock(person),
      ...person.bio.map((s) => h('p', { text: s })),
      h('div.actions', null,
        h('button.primary', { type: 'button', onclick: () => showPartner() }, icon('now'), h('span', { text: 'Meet someone working today' }))),
    );
    announce(`Yes. ${props[r.answer].label}. Inventor: ${person.name}.`);
    p.querySelector('.actions button')?.focus();
  }

  function showPartner() {
    mode = 'partner';
    const r = run.round;
    const person = people[r.partner];
    layoutMeet(person.prop || r.answer, person);
    const p = ctx.panel;
    clear(p);
    const last = run.index >= run.rounds.length - 1;
    put(p,
      personBlock(person),
      h('p.hh-why', null, h('strong', { text: 'Why we picked them: ' }), person.why),
      h('h3', { text: 'Their work' }),
      h('ul.hh-list', null, ...person.work.map((s) => h('li', { text: s }))),
      h('h3', { text: 'Early steps' }),
      h('ul.hh-list', null, ...person.firstSteps.map((s) => h('li', { text: s }))),
      h('div.hh-yourstep', null, h('h3', { text: 'A step you could take' }), h('p', { text: person.yourStep })),
      h('div.actions', null,
        h('button.primary', { type: 'button', onclick: () => (last ? finishLevel() : nextRound()) }, icon('now'), h('span', { text: last ? 'Finish the level' : 'Next round' }))),
    );
    announce(`${person.name}, ${person.field}.`);
    p.querySelector('.actions button')?.focus();
  }

  function nextRound() {
    run.next();
    showRound();
  }

  function finishLevel() {
    mode = 'result';
    const s = run.result();
    const l = run.level;
    const before = ctx.save.levelStars(l.id);
    const best = ctx.save.recordLevel(l.id, s.stars);
    let newStamp = false;
    if (l.id === 3) newStamp = ctx.save.awardStamp(content.stampSkill);
    ctx.avatar.play('cheer');
    previewIdle();
    const p = ctx.panel;
    clear(p);
    const row = (ok, text) => h('li', { class: ok ? 'yes' : 'no' }, icon(ok ? 'check' : 'dash'), h('span', { text: `${text} ${ok ? '(yes)' : '(not yet)'}` }));
    const next = content.levels.find((x) => x.id === l.id + 1);
    put(p,
      h('h2', { text: `Level ${l.id} cleared` }),
      h('p.result-stars', null, starRow(s.stars), h('span.sr-only', { text: `You got ${s.stars} of 3 stars.` })),
      h('ul.checklist', null,
        row(s.finished, 'Finished both rounds.'),
        row(s.withinLimit, `Made ${l.wrongLimit} wrong ${l.wrongLimit === 1 ? 'pick' : 'picks'} or fewer. You made ${run.wrongPicks}.`),
        row(s.allFirst, 'Every round right on the first pick.')),
      best > s.stars ? h('p', { text: `Your best for this level is still ${best} stars. A new try never takes stars away.` }) : null,
      h('div.actions', null,
        h('button', { type: 'button', onclick: () => startLevel(l.id) }, h('span', { text: 'Try again' })),
        next ? h('button.primary', { type: 'button', onclick: () => startLevel(next.id) }, h('span', { text: `Next: Level ${next.id}` })) : null,
        h('button', { type: 'button', onclick: () => showLevelSelect() }, h('span', { text: 'All levels' }))),
    );
    void before;
    announce(`Level ${l.id} cleared. ${s.stars} of 3 stars.`);
    p.querySelector('.actions .primary, .actions button')?.focus();
    if (newStamp) ctx.showStamp(content.stampSkill);
  }

  // ---------- frame update ----------
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  function update(dt) {
    if (!ctx) return;
    if (camTween) {
      camTween.t += dt;
      const k = ease(Math.min(1, camTween.t / camTween.dur));
      ctx.camera.position.lerpVectors(camFromPos, camToPos, k);
      ctx.camera.quaternion.slerpQuaternions(camFromQ, camToQ, k);
      if (k >= 1) camTween = null;
    }
    const spin = ctx.reducedMotion ? 0 : 0.45 * dt;
    for (const hd of holos.values()) {
      if (!hd.wrap.visible) continue;
      hd.turn.rotation.y += spin;
      if (hd.wrongTimer > 0) {
        hd.wrongTimer -= dt;
        if (hd.wrongTimer <= 0) hideHolo(hd.id, false);
      }
      if (hd.moveT < 1) {
        hd.moveT = Math.min(1, hd.moveT + dt / MOVE_TIME);
        hd.wrap.position.lerpVectors(hd.from, hd.to, ease(hd.moveT));
        placeLabel(hd);
      }
      if (hd.alpha !== hd.alphaTarget) {
        const step = FADE_RATE * dt;
        hd.alpha = hd.alpha < hd.alphaTarget ? Math.min(hd.alphaTarget, hd.alpha + step) : Math.max(hd.alphaTarget, hd.alpha - step);
        applyAlpha(hd);
        if (hd.alpha === 0 && hd.alphaTarget === 0) { hd.wrap.visible = false; hd.label.sp.visible = false; }
      }
    }
  }

  function dispose() {
    camTween = null;
    canvasEl?.removeEventListener('pointerdown', onPointerDown);
    canvasEl?.removeEventListener('pointerup', onPointerUp);
    if (ctx) ctx.scene.remove(root);
    for (const o of movedTable) { o.position.z -= tableShift; o.updateMatrixWorld(true); }
    movedTable.length = 0;
    const geos = new Set(), mats = new Set(), texs = new Set();
    const collect = (o) => o.traverse((x) => {
      if (x.geometry) geos.add(x.geometry);
      if (x.material) for (const m of [].concat(x.material)) { mats.add(m); if (m.map) texs.add(m.map); }
    });
    collect(root);
    if (gltfScene) collect(gltfScene);
    for (const g of geos) g.dispose();
    for (const m of mats) m.dispose();
    for (const t of texs) t.dispose();
    emitter?.dispose();
    holos.clear();
    pickables.length = 0;
    slots.length = 0;
    root.clear();
    gltfScene = null; card = null; cardTex = null; cardCanvas = null; holoBase = null;
    ui = {}; run = null;
    if (DEBUG) delete window.__mcbHeroes;
  }

  /** Debug hook (only with ?debug): screen position of a hologram, for the smoke test. */
  function holoScreen(id) {
    const hd = holos.get(id);
    if (!hd || !hd.wrap.visible) return null;
    const v = hd.wrap.position.clone();
    v.y += hd.height * 0.5;
    v.project(ctx.camera);
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight };
  }

  return { id: 'heroes', title: content.title, load, start, update, dispose };
}
