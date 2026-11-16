import * as THREE from 'three';
import './badge.css';
import { h, clear, announce } from '../../ui/dom.js';
import { icon, starRow } from '../../ui/icons.js';
import { EMBLEMS as STAMP_ICONS } from '../../ui/emblems.js';
import { DEBUG } from '../../core/env.js';
import {
  SHAPES, EMBLEMS, COLORS, LAYOUTS, newDesign, setShape, placeEmblem, removeEmblem, nudgeEmblem, setColor,
  placedCount, testToken, overhangToken, snapCount,
} from './design.js';
import { simulate, fewestLayers, ORIENTATIONS } from './printsim.js';
import { encodeBadge } from './code.js';
import { cleanInitials, isBlocked } from './initials.js';
import { LEVELS, starsFor, STATION_TITLE } from './levels.js';
import { badgeSvg, describeDesign } from './svg.js';
import { createPrinterScene } from './scene.js';

/**
 * Badge Builder: the last station. Three levels: a test token, an overhang
 * token, then the player's own badge, which ends with a badge code.
 * @typedef {import('../registry.js').StationContext} StationContext
 */

const EDGE_DOWN = ['bottom', 'left', 'top', 'right'];
const STEPS = ['shape', 'colors', 'emblems', 'initials', 'print'];
const STEP_TITLES = { shape: 'Shape', colors: 'Colors', emblems: 'Emblems', initials: 'Initials', print: 'Print' };

const shapeLabel = (id) => SHAPES.find((s) => s.id === id)?.label || id;
const colorLabel = (id) => COLORS.find((c) => c.id === id)?.label || id;
const emblemLabel = (id) => EMBLEMS.find((e) => e.id === id)?.label || id;
const LABELS = { shape: shapeLabel, color: colorLabel, emblem: emblemLabel };

export default function createBadgeBuilder() {
  /** @type {StationContext} */ let ctx;
  let printer = null;
  let level = LEVELS[0];
  let design = null;
  let myDesign = null;           // the level 3 design, kept between visits
  let orientation = 'flat';
  let turn = 0;
  let failedPreviews = 0;
  let sim = null;
  let step = 'shape';
  let pickedEmblem = null;       // emblem chosen in the palette, waiting for a spot
  let selectedSlot = -1;         // placed emblem chosen for moving
  let token1Emblem = 'spark';
  let ui = {};
  let busy = false;
  let camTween = null;
  const camFromPos = new THREE.Vector3(), camToPos = new THREE.Vector3();
  const camFromQ = new THREE.Quaternion(), camToQ = new THREE.Quaternion();
  const viewDir = new THREE.Vector3(0, 0.6, 1).normalize();
  let overlayEl = null;
  let drag = null;

  const put = (el, ...kids) => el.append(...kids.filter(Boolean));

  // ---------- 3D ----------
  async function load(c) {
    ctx = c;
    const gltf = await ctx.loadGLTF('assets/badge/printer.glb');
    printer = createPrinterScene(ctx, gltf);
    const saved = ctx.save.getBadge();
    myDesign = saved?.design && saved.design.slots ? { ...newDesign(), ...saved.design } : newDesign();
  }

  function cameraTarget() {
    const cam = ctx.camera;
    const savedP = cam.position.clone(), savedQ = cam.quaternion.clone();
    const look = printer.focus(new THREE.Vector3());
    look.y += 0.035;
    const pts = [];
    for (const x of [-0.08, 0.08]) for (const y of [-0.03, 0.075]) for (const z of [-0.07, 0.07]) pts.push(new THREE.Vector3(look.x + x, look.y + y, look.z + z));
    const v = new THREE.Vector3();
    const fits = (d) => {
      cam.position.copy(look).addScaledVector(viewDir, d);
      cam.lookAt(look);
      cam.updateMatrixWorld(true);
      return pts.every((p) => { v.copy(p).project(cam); return Math.abs(v.x) <= 0.9 && Math.abs(v.y) <= 0.86; });
    };
    let lo = 0.12, hi = 6;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi);
    camToPos.copy(cam.position);
    camToQ.copy(cam.quaternion);
    cam.position.copy(savedP); cam.quaternion.copy(savedQ); cam.updateMatrixWorld(true);
  }

  function start(c) {
    ctx = c;
    ctx.scene.add(printer.root);
    cameraTarget();
    camFromPos.copy(ctx.camera.position);
    camFromQ.copy(ctx.camera.quaternion);
    if (ctx.reducedMotion) { ctx.camera.position.copy(camToPos); ctx.camera.quaternion.copy(camToQ); }
    else camTween = { t: 0, dur: 0.9 };
    ctx.onResize(() => { cameraTarget(); if (!camTween) { ctx.camera.position.copy(camToPos); ctx.camera.quaternion.copy(camToQ); } });
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    showDesignOnBed(myDesign, 'flat', 0);
    showLevelSelect();
    if (DEBUG) window.__mcbBadge = { get sim() { return sim; }, get orientation() { return orientation; }, get turn() { return turn; }, camera: ctx.camera };
  }

  function showDesignOnBed(d, o, t) {
    sim = simulate(d, o, t);
    printer.show(d, o, t, sim);
  }

  // ---------- level select ----------
  const isUnlocked = (id) => id === 1 || ctx.save.levelStars(id - 1) > 0;

  function showLevelSelect() {
    closeOverlay();
    const p = ctx.panel;
    clear(p);
    p.append(
      h('h2', { text: STATION_TITLE }),
      h('p', { text: 'Design a badge, choose how it sits on the printer bed, and watch it print one layer at a time.' }),
    );
    const list = h('ul.level-list');
    for (const l of LEVELS) {
      const open = isUnlocked(l.id);
      list.append(h('li', null,
        h('button.level-card', { type: 'button', disabled: !open, 'data-level': l.id, onclick: () => startLevel(l) },
          h('span.level-name', { text: `Level ${l.id}: ${l.title}` }),
          h('span.level-goal', { text: open ? l.goal : `Clear level ${l.id - 1} to open this level.` }),
          open ? starRow(ctx.save.levelStars(l.id)) : h('span.level-lock', null, icon('lock'), h('span', { text: 'Locked' })))));
    }
    p.append(list);
    const saved = ctx.save.getBadge();
    if (saved?.done) {
      p.append(h('div.actions', null, h('button', { type: 'button', onclick: () => showFinished(saved.design, saved.code, null) }, icon('stamp'), h('span', { text: 'See my badge' }))));
    }
    p.querySelector('.level-card:not([disabled])')?.focus();
  }

  function startLevel(l) {
    level = l;
    failedPreviews = 0;
    orientation = 'flat';
    turn = 0;
    if (l.id === 1) { showTokenEmblem(); return; }
    if (l.id === 2) { design = overhangToken(); showPrintStep(); return; }
    design = myDesign;
    step = 'shape';
    showDesignStep();
  }

  function head(sub) {
    return h('div.panel-head', null,
      h('button.link', { type: 'button', onclick: () => { if (!busy) showLevelSelect(); } }, icon('back'), h('span', { text: 'Levels' })),
      h('h2', { text: `Level ${level.id}: ${level.title}` }),
      sub ? h('p.bb-sub', { text: sub }) : null);
  }

  // ---------- level 1: pick the token's emblem ----------
  function showTokenEmblem() {
    design = testToken(token1Emblem);
    showDesignOnBed(design, 'flat', 0);
    const p = ctx.panel;
    clear(p);
    const grid = h('div.bb-grid', { role: 'radiogroup', 'aria-label': 'Emblem for the test token' });
    for (const e of EMBLEMS) {
      grid.append(h('button.bb-tile', { type: 'button', role: 'radio', 'aria-checked': token1Emblem === e.id ? 'true' : 'false', 'data-emblem': e.id, onclick: () => { token1Emblem = e.id; showTokenEmblem(); ctx.panel.querySelector(`[data-emblem="${e.id}"]`)?.focus(); } },
        h('span.bb-tile-icon', { html: STAMP_ICONS[e.id] }), h('span', { text: e.label })));
    }
    put(p,
      head('Step 1 of 2'),
      h('p.goal', null, h('strong', { text: 'Goal: ' }), level.goal),
      h('h3', { text: 'Pick the emblem for your test token' }),
      grid,
      h('div.actions', null, h('button.primary', { type: 'button', onclick: () => showPrintStep() }, icon('now'), h('span', { text: 'Next: place it on the bed' }))),
    );
    p.querySelector('[aria-checked="true"]')?.focus();
  }

  // ---------- level 3: design steps ----------
  function stepNav() {
    const i = STEPS.indexOf(step);
    const prev = STEPS[i - 1], next = STEPS[i + 1];
    return h('div.actions.bb-nav', null,
      prev ? h('button', { type: 'button', onclick: () => { step = prev; showDesignStep(); } }, icon('back'), h('span', { text: `Back: ${STEP_TITLES[prev]}` })) : null,
      next ? h('button.primary', { type: 'button', onclick: () => goNext(next) }, icon('now'), h('span', { text: `Next: ${STEP_TITLES[next]}` })) : null);
  }

  function goNext(next) {
    if (step === 'emblems' && placedCount(design) === 0) {
      setMsg('Place at least one emblem on a spot first.', 'miss');
      return;
    }
    step = next;
    if (next === 'print') { showPrintStep(); return; }
    showDesignStep();
  }

  function previewBox() {
    ui.preview = h('div.bb-preview', { html: badgeSvg(design, { size: 200, showSnaps: step === 'emblems', selectedSlot: selectedSlot, title: `Your badge: ${describeDesign(design, LABELS)}` }) });
    if (step === 'emblems') {
      ui.preview.addEventListener('click', (e) => {
        const slot = slotFromPoint(e.clientX, e.clientY);
        if (slot >= 0) onSpot(slot);
      });
    }
    return ui.preview;
  }

  function refreshPreview() {
    if (!ui.preview) return;
    ui.preview.innerHTML = badgeSvg(design, { size: 200, showSnaps: step === 'emblems', selectedSlot, title: `Your badge: ${describeDesign(design, LABELS)}` });
    showDesignOnBed(design, 'flat', 0);
  }

  function updateDesign(d) {
    design = d;
    myDesign = d;
    refreshPreview();
  }

  function showDesignStep() {
    const p = ctx.panel;
    clear(p);
    showDesignOnBed(design, 'flat', 0);
    ui.message = h('div.message', { role: 'status' });
    const i = STEPS.indexOf(step);
    const body = h('div.bb-step');
    if (step === 'shape') {
      const grid = h('div.bb-grid', { role: 'radiogroup', 'aria-label': 'Badge shape' });
      for (const s of SHAPES) {
        grid.append(h('button.bb-tile', { type: 'button', role: 'radio', 'aria-checked': design.shape === s.id ? 'true' : 'false', 'data-shape': s.id, onclick: () => {
          updateDesign(setShape(design, s.id));
          for (const b of grid.children) b.setAttribute('aria-checked', b.dataset.shape === s.id ? 'true' : 'false');
          if (s.id === 'star') setMsg('The star has five emblem spots, and its emblems and initials print smaller.', null);
          else setMsg('', null);
        } }, h('span', { text: s.label })));
      }
      body.append(h('h3', { text: 'Pick a shape' }), grid);
    } else if (step === 'colors') {
      for (const which of ['body', 'accent']) {
        const grid = h('div.bb-grid.bb-colors', { role: 'radiogroup', 'aria-label': which === 'body' ? 'Badge color' : 'Raised parts color' });
        for (const c of COLORS) {
          grid.append(h('button.bb-tile.bb-color', { type: 'button', role: 'radio', 'aria-checked': design[which] === c.id ? 'true' : 'false', 'data-color': c.id, onclick: () => {
            updateDesign(setColor(design, which, c.id));
            for (const b of grid.children) b.setAttribute('aria-checked', b.dataset.color === c.id ? 'true' : 'false');
          } }, h('span.bb-swatch', { style: { background: c.hex }, 'aria-hidden': 'true' }), h('span', { text: c.label })));
        }
        body.append(h('h3', { text: which === 'body' ? 'Badge color' : 'Color for the raised emblems and initials' }), grid);
      }
    } else if (step === 'emblems') {
      body.append(emblemEditor());
    } else if (step === 'initials') {
      body.append(initialsEditor());
    }
    put(p,
      head(`Step ${i + 1} of ${STEPS.length}: ${STEP_TITLES[step]}`),
      previewBox(),
      body,
      ui.message,
      stepNav());
    (p.querySelector('.bb-step [aria-checked="true"]') || p.querySelector('.bb-step button, .bb-step select'))?.focus();
  }

  // emblem placing: tap an emblem, then tap a spot; or drag it onto a spot
  function emblemEditor() {
    const wrap = h('div');
    const n = snapCount(design.shape);
    const palette = h('div.bb-grid', { role: 'group', 'aria-label': 'Emblems' });
    for (const e of EMBLEMS) {
      const placedAt = design.slots.indexOf(e.id);
      const b = h('button.bb-tile.bb-emblem', { type: 'button', 'aria-pressed': pickedEmblem === e.id ? 'true' : 'false', 'data-emblem': e.id, onclick: () => {
        if (drag?.moved) return;
        pickedEmblem = pickedEmblem === e.id ? null : e.id;
        selectedSlot = -1;
        redrawEmblems();
        setMsg(pickedEmblem ? `${e.label} picked. Now tap a spot on the badge, or a spot button.` : '', null);
      } },
      h('span.bb-tile-icon', { html: STAMP_ICONS[e.id] }),
      h('span', { text: e.label }),
      h('span.bb-tile-note', { text: placedAt >= 0 ? `On spot ${placedAt + 1}` : e.stationTitle }));
      b.addEventListener('pointerdown', (ev) => startDrag(ev, e.id));
      palette.append(b);
    }
    const spots = h('div.bb-spots', { role: 'group', 'aria-label': 'Spots on the badge' });
    for (let i = 0; i < n; i++) {
      const e = design.slots[i];
      spots.append(h('button.bb-spot', { type: 'button', 'data-slot': i, 'aria-pressed': selectedSlot === i ? 'true' : 'false', onclick: () => onSpot(i) },
        h('span.bb-spot-num', { text: String(i + 1) }),
        e ? h('span.bb-spot-icon', { html: STAMP_ICONS[e] }) : null,
        h('span', { text: e ? emblemLabel(e) : 'Empty' })));
    }
    const sel = selectedSlot >= 0 && design.slots[selectedSlot];
    const moveRow = h('div.actions.bb-move', null,
      h('button', { type: 'button', disabled: !sel, onclick: () => nudge(-1), 'aria-label': 'Move to the previous spot' }, icon('back'), h('span', { text: 'Previous spot' })),
      h('button', { type: 'button', disabled: !sel, onclick: () => nudge(1), 'aria-label': 'Move to the next spot' }, h('span', { text: 'Next spot' }), icon('now')),
      h('button', { type: 'button', disabled: !sel, onclick: () => { updateDesign(removeEmblem(design, selectedSlot)); selectedSlot = -1; redrawEmblems(); setMsg('Emblem taken off.', null); } }, icon('remove'), h('span', { text: 'Take off' })));
    wrap.append(
      h('h3', { text: 'Your six stamps are your six emblems' }),
      h('p.small', { text: `Tap an emblem, then tap a spot. You can also drag an emblem onto the badge. This shape has ${n} spots.` }),
      palette,
      h('h3', { text: 'Spots' }),
      spots,
      h('p.small', { text: 'To move an emblem, tap its spot, then use these buttons.' }),
      moveRow);
    ui.emblemWrap = wrap;
    return wrap;
  }

  function redrawEmblems() {
    if (!ui.emblemWrap) return;
    const focusKey = document.activeElement?.dataset?.emblem ? `[data-emblem="${document.activeElement.dataset.emblem}"]`
      : document.activeElement?.dataset?.slot !== undefined ? `[data-slot="${document.activeElement.dataset.slot}"]` : null;
    const old = ui.emblemWrap;
    const fresh = emblemEditor(); // sets ui.emblemWrap to the new block
    old.replaceWith(fresh);
    refreshPreview();
    if (focusKey) fresh.querySelector(focusKey)?.focus();
  }

  function onSpot(i) {
    if (pickedEmblem) {
      const label = emblemLabel(pickedEmblem);
      updateDesign(placeEmblem(design, pickedEmblem, i));
      pickedEmblem = null;
      selectedSlot = i;
      redrawEmblems();
      setMsg(`${label} is on spot ${i + 1}.`, null);
      announce(`${label} placed on spot ${i + 1}.`);
      return;
    }
    if (design.slots[i]) {
      selectedSlot = selectedSlot === i ? -1 : i;
      redrawEmblems();
      setMsg(selectedSlot === i ? `Spot ${i + 1} picked. Use Previous spot or Next spot to move it.` : '', null);
    } else {
      setMsg('Tap an emblem first, then tap this spot.', null);
    }
  }

  function nudge(dir) {
    if (selectedSlot < 0) return;
    const r = nudgeEmblem(design, selectedSlot, dir);
    selectedSlot = r.slot;
    updateDesign(r.design);
    redrawEmblems();
    setMsg(`${emblemLabel(design.slots[selectedSlot])} moved to spot ${selectedSlot + 1}.`, null);
    announce(`Moved to spot ${selectedSlot + 1}.`);
  }

  /** Which spot is under a screen point on the preview, or -1. */
  function slotFromPoint(x, y) {
    const svg = ui.preview?.querySelector('svg');
    if (!svg) return -1;
    const r = svg.getBoundingClientRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) return -1;
    const px = ((x - r.left) / r.width) * 104 - 52;
    const py = -(((y - r.top) / r.height) * 104 - 52);
    const lay = LAYOUTS[design.shape];
    let best = -1, bd = 1e9;
    lay.snaps.forEach(([sx, sy], i) => { const d = Math.hypot(px - sx, py - sy); if (d < bd) { bd = d; best = i; } });
    return bd <= 17.5 * lay.emblemScale + 8 ? best : -1;
  }

  function startDrag(ev, emblemId) {
    if (ev.button !== undefined && ev.button !== 0) return;
    drag = { id: emblemId, x: ev.clientX, y: ev.clientY, moved: false, ghost: null };
  }
  function onDragMove(ev) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) > 10) {
      drag.moved = true;
      drag.ghost = h('div.bb-ghost', { html: STAMP_ICONS[drag.id], 'aria-hidden': 'true' });
      document.body.append(drag.ghost);
    }
    if (drag.ghost) { drag.ghost.style.left = `${ev.clientX}px`; drag.ghost.style.top = `${ev.clientY}px`; }
  }
  function onDragEnd(ev) {
    if (!drag) return;
    const d = drag;
    drag.ghost?.remove();
    if (d.moved) {
      let slot = slotFromPoint(ev.clientX, ev.clientY);
      if (slot < 0) {
        const el = document.elementFromPoint(ev.clientX, ev.clientY)?.closest?.('[data-slot]');
        if (el) slot = Number(el.dataset.slot);
      }
      if (slot >= 0) { pickedEmblem = d.id; onSpot(slot); }
      // keep the click that follows a drag from toggling the palette
      setTimeout(() => { drag = null; }, 0);
      return;
    }
    drag = null;
  }

  function initialsEditor() {
    const wrap = h('div');
    const letters = (design.initials || '').split('');
    const sels = [0, 1, 2].map((i) => {
      const s = h('select.bb-letter', { 'aria-label': `Letter ${i + 1}`, id: `bb-letter-${i}` },
        h('option', { value: '', text: 'None' }),
        ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((ch) => h('option', { value: ch, text: ch, selected: letters[i] === ch })));
      s.addEventListener('change', () => apply());
      return s;
    });
    function apply() {
      const next = cleanInitials(sels.map((s) => s.value).join(''));
      if (isBlocked(next)) {
        // quietly ask for a different pick and put the last good letters back
        const prev = (design.initials || '').split('');
        sels.forEach((s, i) => { s.value = prev[i] || ''; });
        setMsg('Please pick different letters.', 'miss');
        return;
      }
      updateDesign({ ...design, initials: next });
      const now = next.split('');
      sels.forEach((s, i) => { s.value = now[i] || ''; });
      setMsg(next ? `Initials: ${now.join(' ')}.` : 'No initials. That is fine too.', null);
    }
    wrap.append(
      h('h3', { text: 'Initials (optional)' }),
      h('p.small', { text: 'Up to three letters, A to Z. Use initials only, not a full name.' }),
      h('div.bb-letters', null, ...sels.map((s, i) => h('label.bb-letter-label', { for: `bb-letter-${i}` }, h('span', { text: `Letter ${i + 1}` }), s))),
      h('div.actions', null, h('button', { type: 'button', onclick: () => { sels.forEach((s) => { s.value = ''; }); apply(); } }, icon('remove'), h('span', { text: 'Clear letters' }))));
    return wrap;
  }

  // ---------- print step (all levels) ----------
  function showPrintStep() {
    closeOverlay();
    const p = ctx.panel;
    clear(p);
    ui.message = h('div.message', { role: 'status' });
    ui.orient = h('div.bb-grid.bb-orient', { role: 'radiogroup', 'aria-label': 'How it sits on the bed' });
    for (const o of ORIENTATIONS) {
      ui.orient.append(h('button.bb-tile', { type: 'button', role: 'radio', 'aria-checked': orientation === o.id ? 'true' : 'false', 'data-orient': o.id, onclick: () => setOrientation(o.id) },
        h('span.bb-tile-icon', { html: orientIcon(o.id) }), h('strong', { text: o.label }), h('span.bb-tile-note', { text: o.hint })));
    }
    ui.turn = h('button', { type: 'button', onclick: () => { turn = (turn + 1) % 4; refreshOrientation(); announce(`The ${EDGE_DOWN[turn]} edge is down.`); } }, icon('repeat'), h('span', { text: '' }));
    ui.preview3 = h('button.primary.bb-go', { type: 'button', onclick: () => preview() }, icon('play'), h('span', { text: 'Preview the print' }));
    ui.skip = h('button', { type: 'button', hidden: true, onclick: () => printer.skip() }, h('span', { text: 'Skip to the end' }));
    ui.layer = h('p.bb-layer', { 'aria-hidden': 'true' });
    ui.count = h('p.limit');
    const sub = level.id === 3 ? `Step ${STEPS.length} of ${STEPS.length}: ${STEP_TITLES.print}` : level.id === 1 ? 'Step 2 of 2' : null;
    put(p,
      head(sub),
      h('p.goal', null, h('strong', { text: 'Goal: ' }), level.goal),
      level.id === 3 ? h('div.bb-preview.small', { html: badgeSvg(design, { size: 120, title: `Your badge: ${describeDesign(design, LABELS)}` }) }) : null,
      level.id === 2 ? h('p.tip', { text: 'Look at where the spark sticks out. A new layer can only reach about 2 mm past the layer under it.' }) : null,
      h('h3', { text: 'How should it sit on the bed?' }),
      ui.orient,
      h('div.actions', null, ui.turn),
      ui.count,
      h('div.actions', null, ui.preview3, ui.skip),
      ui.layer,
      ui.message,
      level.id === 3 ? h('div.actions', null, h('button', { type: 'button', onclick: () => { step = 'initials'; showDesignStep(); } }, icon('back'), h('span', { text: 'Back: change the design' }))) : null,
    );
    refreshOrientation();
    p.querySelector('[aria-checked="true"]')?.focus();
  }

  function orientIcon(id) {
    const s = (b) => `<svg viewBox="0 0 40 32" width="40" height="32" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M2 29h36"/>${b}</svg>`;
    if (id === 'flat') return s('<rect x="8" y="22" width="24" height="5" rx="1"/><rect x="15" y="18" width="10" height="4"/>');
    if (id === 'face') return s('<rect x="15" y="24" width="10" height="4"/><rect x="8" y="19" width="24" height="5" rx="1"/>');
    return s('<rect x="17" y="5" width="5" height="22" rx="1"/><rect x="22" y="11" width="4" height="10"/>');
  }

  function setOrientation(id) {
    if (busy) return;
    orientation = id;
    refreshOrientation();
    ctx.panel.querySelector(`[data-orient="${id}"]`)?.focus();
  }

  function refreshOrientation() {
    for (const b of ui.orient.children) b.setAttribute('aria-checked', b.dataset.orient === orientation ? 'true' : 'false');
    ui.turn.hidden = orientation !== 'edge';
    ui.turn.querySelector('span:last-child').textContent = `Turn it (${EDGE_DOWN[turn]} edge is down)`;
    const t = orientation === 'edge' ? turn : 0;
    showDesignOnBed(design, orientation, t);
    ui.count.textContent = `Failed previews: ${failedPreviews}. Stay at ${level.failLimit} or fewer for two stars.`;
    setMsg('', null);
    ui.layer.textContent = '';
  }

  function missWhy() {
    if (orientation === 'face') return 'Face down, the raised pieces print first. The wide badge layers above them hang out over empty space.';
    if (orientation === 'edge') return 'Standing this way, the next layers spread out too fast, so the edges hang in the air.';
    return 'Part of the design sticks out past the edge of the badge, so that part prints over empty space.';
  }

  async function preview() {
    if (busy) return;
    busy = true;
    const t = orientation === 'edge' ? turn : 0;
    showDesignOnBed(design, orientation, t);
    const s = sim;
    for (const b of ui.orient.children) b.disabled = true;
    ui.turn.disabled = true;
    ui.preview3.hidden = true;
    ui.skip.hidden = false;
    ui.skip.focus();
    setMsg('Printing the preview, one layer at a time.', null);
    ctx.sound.play('click');
    const total = s.layers;
    await printer.play({
      reduced: ctx.reducedMotion,
      onLayer: (n) => { ui.layer.textContent = `Layer ${Math.min(n, total)} of ${total}`; },
    });
    busy = false;
    if (!ctx || !ui.orient) return;
    for (const b of ui.orient.children) b.disabled = false;
    ui.turn.disabled = false;
    ui.skip.hidden = true;
    ui.preview3.hidden = false;
    if (s.fail) {
      failedPreviews++;
      ctx.sound.play('miss');
      ui.layer.textContent = `Stopped at layer ${s.fail.layer} of ${total}.`;
      ui.count.textContent = `Failed previews: ${failedPreviews}. Stay at ${level.failLimit} or fewer for two stars.`;
      setMsg(`Layer ${s.fail.layer}: nothing is holding this layer up, so it droops. ${missWhy()} Try another way.`, 'miss');
      announce(`The print failed at layer ${s.fail.layer}. Nothing is holding that layer up.`);
      ui.preview3.querySelector('span:last-child').textContent = 'Preview again';
      ui.orient.querySelector('[aria-checked="true"]')?.focus();
      return;
    }
    ctx.sound.play('win');
    ctx.avatar.play('cheer');
    onPrinted(s);
  }

  function onPrinted(s) {
    const fewest = fewestLayers(design);
    const st = starsFor({ printed: true, failedPreviews, layers: s.layers, fewest }, level);
    const best = ctx.save.recordLevel(level.id, st.stars);
    if (level.id === 3) {
      const code = encodeBadge(design);
      ctx.save.setBadge({ design: { shape: design.shape, body: design.body, accent: design.accent, slots: design.slots, initials: design.initials }, code, done: true, savedAt: new Date().toISOString().slice(0, 10) });
      showFinished(design, code, { st, s, fewest, best });
      return;
    }
    showResult(st, s, fewest, best);
  }

  function resultList(st, s, fewest) {
    const row = (ok, text) => h('li', { class: ok ? 'yes' : 'no' }, icon(ok ? 'check' : 'dash'), h('span', { text: `${text} ${ok ? '(yes)' : '(not yet)'}` }));
    return h('ul.checklist', null,
      row(st.printed, `The print worked: ${s.layers} layers.`),
      row(st.withinLimit, `Failed previews: ${failedPreviews}. The limit for two stars is ${level.failLimit}.`),
      row(st.fewest, `Used the way that prints with the fewest layers${fewest ? ` (${fewest})` : ''}.`));
  }

  function showResult(st, s, fewest, best) {
    const p = ctx.panel;
    clear(p);
    const next = LEVELS.find((l) => l.id === level.id + 1);
    put(p,
      h('h2', { text: `Level ${level.id} printed` }),
      h('p.result-stars', null, starRow(st.stars), h('span.sr-only', { text: `You got ${st.stars} of 3 stars.` })),
      resultList(st, s, fewest),
      h('p', { text: level.teaches }),
      best > st.stars ? h('p', { text: `Your best for this level is still ${best} stars. A new try never takes stars away.` }) : null,
      !st.fewest ? h('p.tip', { text: 'Want three stars? Find the way that still prints but uses the fewest layers.' }) : null,
      h('div.actions', null,
        h('button', { type: 'button', onclick: () => startLevel(level) }, h('span', { text: 'Try again' })),
        next ? h('button.primary', { type: 'button', onclick: () => startLevel(next) }, h('span', { text: `Next: Level ${next.id}` })) : null,
        h('button', { type: 'button', onclick: () => showLevelSelect() }, h('span', { text: 'All levels' }))));
    announce(`Level ${level.id} printed. ${st.stars} of 3 stars.`);
    p.querySelector('.actions .primary, .actions button')?.focus();
  }

  // ---------- finished badge ----------
  function showFinished(d, code, res) {
    const p = ctx.panel;
    clear(p);
    showDesignOnBed(d, 'flat', 0);
    const desc = describeDesign(d, LABELS);
    ui.copyMsg = h('p.message', { role: 'status' });
    ui.codeBox = h('input.bb-code', { type: 'text', readonly: true, value: code, 'aria-label': 'Badge code', size: '12' });
    put(p,
      h('h2', { text: 'Your badge is printed' }),
      res ? h('p.result-stars', null, starRow(res.st.stars), h('span.sr-only', { text: `You got ${res.st.stars} of 3 stars.` })) : null,
      res ? resultList(res.st, res.s, res.fewest) : null,
      h('div.bb-final', null,
        h('div.bb-final-art', { html: badgeSvg(d, { size: 260, title: `Your badge: ${desc}` }) }),
        h('p.bb-final-desc', { text: desc })),
      h('p.bb-done', null, icon('stamp'), h('span', { text: 'You finished the Magic Cool Bus Challenge.' })),
      h('h3', { text: 'Your badge code' }),
      ui.codeBox,
      h('p.small', { text: 'This code is a record of your badge design. It is not an account and holds nothing about you.' }),
      h('div.actions', null,
        h('button.primary', { type: 'button', onclick: () => copyCode(code) }, h('span', { text: 'Copy badge code' })),
        h('button', { type: 'button', onclick: () => openOverlay(d, code) }, h('span', { text: 'Show my badge big' })),
        h('button', { type: 'button', onclick: () => savePicture(d, code) }, h('span', { text: 'Save a picture (optional)' }))),
      ui.copyMsg,
      h('p.small', { text: 'To keep it, take a screenshot of the big badge, or write down the code.' }),
      h('div.actions', null,
        h('button', { type: 'button', onclick: () => { design = myDesign; level = LEVELS[2]; step = 'shape'; failedPreviews = 0; showDesignStep(); } }, h('span', { text: 'Change my badge' })),
        h('button', { type: 'button', onclick: () => showLevelSelect() }, h('span', { text: 'All levels' }))),
    );
    announce('Your badge is printed. You finished the Magic Cool Bus Challenge.');
    p.querySelector('.actions .primary')?.focus();
  }

  async function copyCode(code) {
    const done = (ok) => {
      clear(ui.copyMsg);
      if (ok) { ui.copyMsg.className = 'message win'; ui.copyMsg.append(icon('check'), h('span', { text: `Copied ${code}.` })); return; }
      ui.copyMsg.className = 'message';
      ui.copyMsg.append(icon('warn'), h('span', { text: 'This browser would not copy it. The code is selected: press Ctrl and C, or write it down.' }));
      ui.codeBox.focus();
      ui.codeBox.select();
    };
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(code);
      done(true);
    } catch {
      done(false);
    }
  }

  function savePicture(d, code) {
    const fail = () => {
      clear(ui.copyMsg);
      ui.copyMsg.className = 'message';
      ui.copyMsg.append(icon('warn'), h('span', { text: 'Saving a picture is blocked here. Use Show my badge big and take a screenshot.' }));
    };
    try {
      const svgText = badgeSvg(d, { size: 600 });
      const blob = new Blob([svgText], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = 640; c.height = 720;
          const g = c.getContext('2d');
          g.fillStyle = '#ffffff'; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 20, 10, 600, 600);
          g.fillStyle = '#0b1530'; g.font = 'bold 40px system-ui, sans-serif'; g.textAlign = 'center';
          g.fillText(code, 320, 670);
          URL.revokeObjectURL(url);
          c.toBlob((png) => {
            try {
              if (!png) throw new Error('no image');
              const a = document.createElement('a');
              a.href = URL.createObjectURL(png);
              a.download = `${code}.png`;
              document.body.append(a);
              a.click();
              a.remove();
              setTimeout(() => URL.revokeObjectURL(a.href), 4000);
              clear(ui.copyMsg);
              ui.copyMsg.className = 'message';
              ui.copyMsg.append(icon('check'), h('span', { text: 'If your browser allows downloads, the picture is saved.' }));
            } catch { fail(); }
          }, 'image/png');
        } catch { fail(); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); fail(); };
      img.src = url;
    } catch {
      fail();
    }
  }

  function openOverlay(d, code) {
    closeOverlay();
    const close = h('button.primary', { type: 'button', onclick: () => closeOverlay(true) }, h('span', { text: 'Close' }));
    overlayEl = h('div.bb-overlay', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Your badge' },
      h('div.bb-overlay-card', null,
        h('div.bb-overlay-art', { html: badgeSvg(d, { size: 420, title: `Your badge: ${describeDesign(d, LABELS)}` }) }),
        h('p.bb-overlay-code', { text: code }),
        h('p.small', { text: 'The Magic Cool Bus Challenge. Take a screenshot to keep it.' }),
        h('div.actions', null, close)));
    overlayEl.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeOverlay(true); } });
    (document.getElementById('ui') || document.body).append(overlayEl);
    close.focus();
  }

  function closeOverlay(refocus) {
    if (!overlayEl) return;
    overlayEl.remove();
    overlayEl = null;
    if (refocus) ctx?.panel.querySelector('.actions .primary')?.focus();
  }

  function setMsg(text, kind) {
    if (!ui.message) return;
    clear(ui.message);
    ui.message.className = 'message' + (kind ? ` ${kind}` : '');
    if (text) ui.message.append(icon(kind === 'miss' ? 'warn' : 'now'), h('span', { text }));
  }

  // ---------- frame ----------
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
  function update(dt) {
    if (!ctx || !printer) return;
    if (camTween) {
      camTween.t += dt;
      const k = ease(Math.min(1, camTween.t / camTween.dur));
      ctx.camera.position.lerpVectors(camFromPos, camToPos, k);
      ctx.camera.quaternion.slerpQuaternions(camFromQ, camToQ, k);
      if (k >= 1) camTween = null;
    }
    printer.update(dt);
  }

  function dispose() {
    camTween = null;
    closeOverlay();
    drag?.ghost?.remove();
    drag = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    printer?.dispose();
    printer = null;
    ui = {};
    if (DEBUG) delete window.__mcbBadge;
  }

  return { id: 'badge', title: STATION_TITLE, load, start, update, dispose };
}
