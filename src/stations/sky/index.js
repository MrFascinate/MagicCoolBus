import * as THREE from 'three';
import './sky.css';
import { h, clear, announce } from '../../ui/dom.js';
import { icon, starRow } from '../../ui/icons.js';
import { parseSky, ZOOMS, ZOOM_ORDER, dragView, arrowView, viewVec, sepDeg, basis, scaleFor, project, moonDisk } from './sky.js';
import { LEVELS, STAMP_SKILL, makeObjects } from './levels.js';
import { newState, look, settle, confirm, starsFor } from './rules.js';
import { createRenderer } from './render.js';

/**
 * Sky Seeker station module. Same interface as every station:
 * { id, title, load(ctx), start(ctx), update(dt), dispose() }.
 * @typedef {import('../registry.js').StationContext} StationContext
 */

const TAP_FRAC = 0.04;      // an arrow tap moves this part of the field (small enough to land in the ring)
const HOLD_AFTER = 0.25;    // seconds before a held arrow starts to glide
const HOLD_SPEED = 0.4;     // fields per second while held
const DRAG_MIN = 4;         // px of movement before a press counts as a drag
const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

export default function createSkySeeker() {
  /** @type {StationContext} */ let ctx;
  let sky, objects, renderer;
  let level = LEVELS[0];
  let state = null;
  let ui = {};
  let stage = null, canvas = null, g = null, sizeCss = 300, sizePx = 300;
  let dirty = true;
  let hold = null;           // {dir, t, panned, source}
  let drag = null;           // {id, x, y, moved}
  let hint = null;           // hop arrow after a wrong Confirm
  let lost = false;
  let introT = 0, introDone = false;
  let tube = null; const tubeQ0 = new THREE.Quaternion(); let tubeYaw0 = 0;
  const yAxis = new THREE.Vector3(0, 1, 0), tubeDir = new THREE.Vector3();
  const labelIds = new Set();
  const listeners = [];
  /** append, skipping null and false (native append would print "null") */
  const put = (el, ...kids) => el.append(...kids.filter(Boolean));
  const on = (el, ev, fn, opt) => { el.addEventListener(ev, fn, opt); listeners.push([el, ev, fn, opt]); };

  // ---------- load ----------
  async function load(c) {
    ctx = c;
    const res = await fetch('assets/sky/sky.json');
    if (!res.ok) throw new Error('sky.json missing');
    sky = parseSky(await res.json());
    objects = makeObjects(sky);
    renderer = createRenderer(sky, objects);
    tube = ctx.hub.get('MCB_Scope_Tube');
    if (tube) {
      tubeQ0.copy(tube.quaternion);
      const a = yAxis.clone().applyQuaternion(tube.quaternion);
      tubeYaw0 = Math.atan2(a.x, a.z);
    }
  }

  // ---------- eyepiece overlay ----------
  function buildStage() {
    const root = document.getElementById('ui');
    canvas = h('canvas.sky-canvas', { tabindex: '0', role: 'img', 'aria-label': 'Telescope view. Drag the sky, or focus here and use the arrow keys. Hold a key to keep moving. Keys 1, 2 and 3 change the zoom. Enter confirms.' });
    g = canvas.getContext('2d');
    const arrowBtn = (dir, label, glyph) => {
      const b = h(`button.sky-arrow.sky-${dir}`, { type: 'button', 'aria-label': label, title: label }, h('span', { 'aria-hidden': 'true', text: glyph }));
      on(b, 'pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); startHold(dir, 'pointer'); });
      on(b, 'pointerup', () => endHold('pointer'));
      on(b, 'pointercancel', () => endHold('pointer'));
      on(b, 'keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); startHold(dir, 'key'); } });
      on(b, 'keyup', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); endHold('key'); } });
      return b;
    };
    ui.zoomBtns = {};
    const zoomGroup = h('div.sky-zooms', { role: 'group', 'aria-label': 'Zoom' });
    for (const z of ZOOM_ORDER) {
      const b = h('button.sky-zoom', { type: 'button', 'data-zoom': z, 'aria-pressed': 'false', onclick: () => setZoom(z) },
        h('span.sky-zoom-name', { text: ZOOMS[z].label }), h('span.sky-zoom-fov', { text: fovText(z) }));
      ui.zoomBtns[z] = b;
      zoomGroup.append(b);
    }
    ui.lostTip = h('p.sky-lost', { hidden: true, text: 'Lost? Tap Finder to see more sky.' });
    ui.confirm = h('button.primary.sky-confirm', { type: 'button', onclick: () => doConfirm() }, icon('check'), h('span', { text: 'Confirm' }));
    ui.lines = h('button.sky-toggle', { type: 'button', 'aria-pressed': 'true', onclick: () => toggle('lines') }, h('span', { text: 'Lines: on' }));
    ui.labels = h('button.sky-toggle', { type: 'button', 'aria-pressed': 'true', onclick: () => toggle('labels') }, h('span', { text: 'Names: on' }));
    ui.scope = h('div.sky-scope', null, canvas,
      arrowBtn('up', 'Move up', '▲'), arrowBtn('down', 'Move down', '▼'),
      arrowBtn('left', 'Move left', '◀'), arrowBtn('right', 'Move right', '▶'));
    ui.side = h('div.sky-side', null, zoomGroup, ui.lostTip, ui.confirm, ui.lines, ui.labels);
    stage = h('div.sky-stage', { hidden: true }, ui.scope, ui.side);
    root.prepend(stage);

    on(canvas, 'pointerdown', (e) => {
      if (!state || state.done) return;
      canvas.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
    });
    on(canvas, 'pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.x = e.clientX; drag.y = e.clientY;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.moved < DRAG_MIN) return;
      dragView(state.view, dx, dy, sizeCss / 2);
      dirty = true;
    });
    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved >= DRAG_MIN;
      drag = null;
      if (moved) afterLook();
    };
    on(canvas, 'pointerup', endDrag);
    on(canvas, 'pointercancel', endDrag);
    on(canvas, 'keydown', (e) => {
      const dir = DIRS[e.key];
      if (dir) { e.preventDefault(); if (!e.repeat) startHold(dir, 'key'); return; }
      if (e.key === '1' || e.key === '2' || e.key === '3') { setZoom(ZOOM_ORDER[Number(e.key) - 1]); e.preventDefault(); }
      else if (e.key === 'Enter') { e.preventDefault(); doConfirm(); }
    });
    on(canvas, 'keyup', (e) => { if (DIRS[e.key]) { e.preventDefault(); endHold('key'); } });
    on(window, 'blur', () => { if (hold) endHold(hold.source); });
    layout();
  }

  const fovText = (z) => `${ZOOMS[z].fov}\u00B0 wide`;

  function layout() {
    if (!stage) return;
    const vp = ctx.viewport();
    const w = vp.width - vp.panelWidth, ht = vp.height;
    const short = ht <= 520;
    const sideW = short ? 118 : 150;
    const d = Math.max(200, Math.floor(Math.min(w - sideW - (short ? 22 : 48), ht - (short ? 16 : 40))));
    stage.style.right = `${vp.panelWidth}px`;
    ui.scope.style.width = ui.scope.style.height = `${d}px`;
    ui.side.style.width = `${sideW}px`;
    sizeCss = d;
    sizePx = Math.round(d * Math.min(window.devicePixelRatio || 1, 1.5));
    canvas.width = canvas.height = sizePx;
    canvas.style.width = canvas.style.height = `${d}px`;
    dirty = true;
  }

  function toggle(which) {
    const b = which === 'lines' ? ui.lines : ui.labels;
    const onNow = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', onNow ? 'true' : 'false');
    b.firstChild.textContent = `${which === 'lines' ? 'Lines' : 'Names'}: ${onNow ? 'on' : 'off'}`;
    ctx.sound.play('click');
    dirty = true;
  }

  // ---------- looking ----------
  function startHold(dir, source) {
    if (!state || state.done) return;
    if (hold) endHold(hold.source);
    hold = { dir, t: 0, panned: false, source };
  }

  function endHold(source) {
    if (!hold || hold.source !== source) return;
    const hd = hold;
    hold = null;
    if (!hd.panned) arrowView(state.view, hd.dir, TAP_FRAC);
    dirty = true;
    afterLook();
  }

  function afterLook() {
    const found = look(state, level, objects);
    onFound(found);
    refreshPlay();
  }

  function setZoom(z) {
    if (!state || state.done) return;
    if (state.view.zoom === z) return;
    state.view.zoom = z;
    ctx.sound.play('click');
    onFound(settle(state, level, objects));
    announce(`Zoom: ${ZOOMS[z].label}, ${fovText(z)}.`);
    dirty = true;
    refreshPlay();
  }

  function onFound(list) {
    for (const k of list) {
      const step = level.steps[k];
      const last = k === level.steps.length - 1;
      if (!last) {
        labelIds.add(step.id);
        ctx.sound.play('step');
        announce(`Found ${objects[step.id].name}. ${level.steps[k + 1].text}`);
        hint = null;
      }
    }
  }

  function doConfirm() {
    if (!state || state.done) return;
    const r = confirm(state, level, sky, objects);
    if (r.kind === 'win') { win(); return; }
    if (r.kind === 'zoom') { setMessage(r.text, 'note'); announce(r.text); return; }
    ctx.sound.play('miss');
    const next = level.steps[Math.min(state.found, level.steps.length - 1)];
    const lastFound = state.found > 0 ? objects[level.steps[state.found - 1].id] : null;
    hint = { from: lastFound ? lastFound.v : viewVec(state.view), to: objects[next.id].v };
    const tail = lastFound ? `The arrow shows the next hop, from ${lastFound.name}.` : 'The arrow points toward the first clue.';
    setMessage(`${r.text} That is not the target. ${tail}`, 'miss');
    announce(`${r.text} That is not the target.`);
    dirty = true;
    refreshPlay();
  }

  // ---------- panels ----------
  const isUnlocked = (id) => id === 1 || ctx.save.levelStars(id - 1) > 0;

  function start(c) {
    ctx = c;
    buildStage();
    ctx.onResize(layout);
    ctx.panel.classList.add('sky');
    const firstOpen = LEVELS.find((l) => ctx.save.levelStars(l.id) === 0) || LEVELS[0];
    level = isUnlocked(firstOpen.id) ? firstOpen : LEVELS[0];
    state = newState(level);
    introT = 0; introDone = ctx.reducedMotion;
    if (/[?&]debug\b/.test(location.search)) {
      // test hook for scripts/smoke-sky.mjs: where an object is on the canvas, in CSS px from the centre
      window.__sky = {
        get state() { return state && { ...state, view: { ...state.view } }; },
        aim(id) {
          const o = objects[id];
          const b = basis(state.view), s = scaleFor(ZOOMS[state.view.zoom].fov, sizeCss / 2), out = [0, 0];
          const ok = project(b, s, o.v[0], o.v[1], o.v[2], out);
          return ok ? { x: out[0], y: out[1], ok } : { ok };
        },
        rect() { const r = canvas.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, d: r.width }; },
      };
    }
    if (introDone) showStage();
    showLevelSelect();
  }

  function showLevelSelect() {
    const p = ctx.panel;
    clear(p);
    p.append(
      h('h2', { text: 'Sky Seeker' }),
      h('p', { text: 'Steer the telescope across tonight\'s sky. Follow star-hopping clues from stars you know to a target, then zoom in to check it.' }),
      h('p.small', { text: `The sky is set for ${sky.meta.local}, from ${sky.meta.place.name}.` }),
    );
    const list = h('ul.level-list');
    for (const l of LEVELS) {
      const stars = ctx.save.levelStars(l.id);
      const open = isUnlocked(l.id);
      list.append(h('li', null,
        h('button.level-card', { type: 'button', disabled: !open, 'data-level': l.id, onclick: () => { showLevel(l); } },
          h('span.level-name', { text: `Level ${l.id}: ${l.title}` }),
          h('span.level-goal', { text: open ? l.goal : `Clear level ${l.id - 1} to open this level.` }),
          open ? starRow(stars) : h('span.level-lock', null, icon('lock'), h('span', { text: 'Locked' })),
        )));
    }
    p.append(list);
    if (ctx.save.hasStamp()) p.append(h('p.stamp-note', null, icon('stamp'), h('span', { text: `Stamp earned: ${STAMP_SKILL}.` })));
    p.querySelector('.level-card:not([disabled])')?.focus();
  }

  function showLevel(l) {
    level = l;
    state = newState(level);
    hint = null; lost = false; labelIds.clear();
    dirty = true;
    showPlay();
    announce(`Level ${l.id}. ${l.goal} ${l.steps[0].text}`);
  }

  function showPlay() {
    const p = ctx.panel;
    clear(p);
    ui.looks = h('p.sky-looks', { 'aria-live': 'polite' });
    ui.steps = h('ol.sky-steps');
    ui.message = h('div.message', { role: 'status' });
    let chart = null;
    if (level.steps.length > 2) {
      chart = h('canvas.sky-chart', { width: '440', height: '440', role: 'img', 'aria-label': `Clue chart: ${level.steps.map((s, i) => `${i + 1}, ${objects[s.id].name}`).join('; ')}.` });
    }
    put(p,
      h('div.panel-head', null,
        h('button.link', { type: 'button', onclick: () => { state = null; showLevelSelect(); dirty = true; } }, icon('back'), h('span', { text: 'Levels' })),
        h('h2', { text: `Level ${level.id}: ${level.title}` })),
      h('p.goal', null, h('strong', { text: 'Goal: ' }), level.goal),
      ui.looks,
      h('h3.sky-clue-head', { text: 'Clue card' }),
      ui.steps,
      chart ? h('figure.sky-chart-wrap', null, chart, h('figcaption', { text: 'Clue chart: the hops, drawn on the stars. Your view will be turned a little differently.' })) : null,
      ui.message,
      h('div.actions', null,
        h('button', { type: 'button', onclick: () => { showLevel(level); } }, h('span', { text: 'Start over' }))),
      h('p.small', { text: 'Drag the sky or use the arrow buttons. Each drag or arrow press is one look. Zooming is free.' }),
    );
    if (chart) drawChart(chart);
    refreshPlay();
    canvas?.focus({ preventScroll: true });
  }

  function drawChart(cv) {
    const ids = level.steps.map((s) => s.id);
    // centre on the middle of the hops
    let x = 0, y = 0, z = 0;
    for (const id of ids) { x += objects[id].v[0]; y += objects[id].v[1]; z += objects[id].v[2]; }
    const l = Math.hypot(x, y, z);
    const alt = Math.asin(z / l) * 180 / Math.PI, az = ((Math.atan2(x / l, y / l) * 180 / Math.PI) + 360) % 360;
    let span = 0;
    for (const a of ids) for (const b of ids) span = Math.max(span, sepDeg(objects[a].v, objects[b].v));
    const view = { alt, az, zoom: 'finder' };
    const saved = ZOOMS.finder.fov;
    ZOOMS.finder.fov = Math.min(60, Math.max(14, span * 1.5));
    renderer.draw(cv.getContext('2d'), cv.width, view, { lines: true, labels: false, reticle: false, ground: false, chart: { ids, tags: ids.map((id, i) => `${i + 1} ${objects[id].name.replace(/^the /, '')}`) } });
    ZOOMS.finder.fov = saved;
  }

  function refreshPlay() {
    if (!state || !ui.steps) return;
    ui.looks.textContent = `Looks used: ${state.looks}. Limit: ${level.limit}. Stay within ${level.limit} for two stars.`;
    ui.looks.classList.toggle('over', state.looks > level.limit);
    clear(ui.steps);
    level.steps.forEach((s, k) => {
      const done = k < state.found || (k === level.steps.length - 1 && state.done);
      const now = !done && k === state.found;
      ui.steps.append(h('li', { class: done ? 'done' : now ? 'now' : 'later' },
        h('span.sky-step-tag', null, icon(done ? 'check' : now ? 'now' : 'dash'), h('span', { text: done ? 'Found' : now ? 'Now' : 'Next' })),
        h('span.sky-step-text', { text: s.text })));
    });
    for (const z of ZOOM_ORDER) ui.zoomBtns[z].setAttribute('aria-pressed', state.view.zoom === z ? 'true' : 'false');
    // lost at High: the next thing to find is out of the field
    const next = objects[level.steps[Math.min(state.found, level.steps.length - 1)].id];
    const half = ZOOMS[state.view.zoom].fov / 2;
    lost = state.view.zoom === 'high' && sepDeg(viewVec(state.view), next.v) > half * 1.05 && sepDeg(viewVec(state.view), objects.moon.v) > half + 0.26;
    ui.zoomBtns.finder.classList.toggle('pulse', lost);
    ui.lostTip.hidden = !lost;
  }

  function setMessage(text, kind) {
    if (!ui.message) return;
    clear(ui.message);
    ui.message.className = 'message' + (kind ? ` ${kind}` : '');
    if (text) ui.message.append(icon(kind === 'miss' ? 'warn' : kind === 'win' ? 'check' : 'now'), h('span', { text }));
  }

  function win() {
    const s = starsFor(state, level);
    const best = ctx.save.recordLevel(level.id, s.stars);
    let newStamp = false;
    if (level.id === 3) newStamp = ctx.save.awardStamp(STAMP_SKILL);
    ctx.sound.play('win');
    ctx.avatar.play('cheer');
    hint = null;
    labelIds.add(level.steps.at(-1).id);
    dirty = true;
    showResult(s, best);
    if (newStamp) ctx.showStamp(STAMP_SKILL);
  }

  function showResult(s, best) {
    const p = ctx.panel;
    clear(p);
    const row = (ok, text) => h('li', { class: ok ? 'yes' : 'no' }, icon(ok ? 'check' : 'dash'), h('span', { text: `${text} ${ok ? '(yes)' : '(not yet)'}` }));
    const target = objects[level.steps.at(-1).id];
    const next = LEVELS.find((l) => l.id === level.id + 1);
    const close = h('canvas.sky-closeup', { width: '360', height: '220', role: 'img', 'aria-label': `Illustration of ${target.name}` });
    put(p,
      h('h2', { text: `Level ${level.id} cleared` }),
      h('p.result-stars', null, starRow(s.stars), h('span.sr-only', { text: `You got ${s.stars} of 3 stars.` })),
      h('ul.checklist', null,
        row(s.confirmed, `Confirmed ${target.name}.`),
        row(s.withinLimit, `Used ${level.limit} looks or fewer. You used ${state.looks}.`),
        row(s.inOrder && s.firstTry, 'Centered each clue in order and confirmed on the first try.'),
      ),
      best > s.stars ? h('p', { text: `Your best for this level is still ${best} stars. A new try never takes stars away.` }) : null,
      h('figure.sky-closeup-wrap', null, close, h('figcaption', { text: `Close-up of ${target.name}. This is an illustration: it shows more detail than a small telescope does.` })),
      h('p', { text: level.fact }),
      h('div.actions', null,
        h('button', { type: 'button', onclick: () => showLevel(level) }, h('span', { text: 'Try again' })),
        next ? h('button.primary', { type: 'button', onclick: () => showLevel(next) }, h('span', { text: `Next: Level ${next.id}` })) : null,
        h('button', { type: 'button', onclick: () => { state = null; showLevelSelect(); dirty = true; } }, h('span', { text: 'All levels' })),
      ),
    );
    drawCloseup(close, target.id);
    announce(`Level ${level.id} cleared. ${s.stars} of 3 stars.`);
    [...p.querySelectorAll('.actions button')].find((b) => b.classList.contains('primary'))?.focus() || p.querySelector('.actions button')?.focus();
  }

  /** Illustrated close-ups (labelled as illustrations on screen). */
  function drawCloseup(cv, id) {
    const c = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    c.fillStyle = '#0a1330'; c.fillRect(0, 0, W, H);
    if (id === 'tycho') {
      const tex = renderer.moonTex;
      const t = objects.tycho.feature;
      // crop around Tycho from the Moon drawing, zoomed in
      const sz = tex.width;
      const d = moonDisk(t.lat, t.lon, sky.moon.libLat, sky.moon.libLon);
      const tx = sz / 2 + d.x * sz / 2, ty = sz / 2 - d.y * sz / 2;
      const cw = sz * 0.3, chh = cw * (H / W);
      c.drawImage(tex, tx - cw / 2, ty - chh / 2, cw, chh, 0, 0, W, H);
      const rr = ((t.km / 2) / 1737.4) * (sz / 2) * (W / cw);
      c.strokeStyle = '#ffd34d'; c.lineWidth = 3;
      c.beginPath(); c.arc(W / 2, H / 2, rr * 1.6, 0, Math.PI * 2); c.stroke();
      c.fillStyle = '#ffd34d'; c.font = '700 18px system-ui, sans-serif'; c.fillText('Tycho', W / 2 + rr * 1.6 + 8, H / 2 - rr);
    } else if (id === 'saturn') {
      c.save(); c.translate(W / 2, H / 2);
      const tilt = Math.sin(Math.abs(sky.saturn.ringTilt) * Math.PI / 180);
      c.strokeStyle = '#e8d9a8'; c.lineWidth = 14;
      c.beginPath(); c.ellipse(0, 0, 150, 150 * tilt + 3, 0, Math.PI, Math.PI * 2); c.stroke();
      const grd = c.createLinearGradient(0, -60, 0, 60);
      grd.addColorStop(0, '#f6e6b8'); grd.addColorStop(0.5, '#e2c27e'); grd.addColorStop(1, '#f6e6b8');
      c.fillStyle = grd; c.beginPath(); c.ellipse(0, 0, 66, 60, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.ellipse(0, 0, 150, 150 * tilt + 3, 0, 0, Math.PI); c.stroke();
      c.restore();
      c.fillStyle = '#ffffff'; c.font = '600 16px system-ui, sans-serif';
      c.fillText(`Rings tipped about ${Math.round(Math.abs(sky.saturn.ringTilt))}° toward us this year`, 12, H - 14);
    } else {
      c.save(); c.translate(W / 2, H / 2); c.rotate(-0.5); c.scale(1, 0.32);
      const grd = c.createRadialGradient(0, 0, 0, 0, 0, 170);
      grd.addColorStop(0, 'rgba(255,248,230,1)'); grd.addColorStop(0.12, 'rgba(240,230,255,0.7)');
      grd.addColorStop(0.5, 'rgba(180,180,235,0.25)'); grd.addColorStop(1, 'rgba(150,160,220,0)');
      c.fillStyle = grd; c.beginPath(); c.arc(0, 0, 170, 0, Math.PI * 2); c.fill();
      c.restore();
    }
  }

  // ---------- frame ----------
  function update(dt) {
    if (!stage) return;
    if (!introDone) {
      introT += dt;
      if (introT > 0.9) { introDone = true; showStage(); stage.classList.add('in'); }
    }
    if (hold && state) {
      hold.t += dt;
      if (hold.t > HOLD_AFTER) { arrowView(state.view, hold.dir, HOLD_SPEED * dt); hold.panned = true; dirty = true; }
    }
    if (dirty && !stage.hidden) {
      dirty = false;
      const view = state ? state.view : LEVELS[0].start;
      renderer.draw(g, sizePx, view, {
        lines: ui.lines.getAttribute('aria-pressed') === 'true',
        labels: ui.labels.getAttribute('aria-pressed') === 'true',
        labelIds, arrow: hint, reticle: true,
      });
      aimTube(view);
    }
  }

  /** The eyepiece covers the 3D view, so stop drawing the hub behind it (a big saving on Chromebooks). */
  function showStage() {
    stage.hidden = false;
    ctx.hub.root.visible = false;
    dirty = true;
  }

  function aimTube(view) {
    if (!tube) return;
    const yaw = tubeYaw0 - (view.az - 180) * Math.PI / 180;
    const e = view.alt * Math.PI / 180;
    tubeDir.set(Math.cos(e) * Math.sin(yaw), Math.sin(e), Math.cos(e) * Math.cos(yaw));
    tube.quaternion.setFromUnitVectors(yAxis, tubeDir);
  }

  function dispose() {
    for (const [el, ev, fn, opt] of listeners) el.removeEventListener(ev, fn, opt);
    listeners.length = 0;
    stage?.remove();
    if (ctx) ctx.hub.root.visible = true;
    if (tube) tube.quaternion.copy(tubeQ0);
    if (ctx) ctx.panel.classList.remove('sky');
    if (renderer?.moonTex) { renderer.moonTex.width = 1; renderer.moonTex.height = 1; }
    if (canvas) { canvas.width = 1; canvas.height = 1; }
    if (window.__sky) delete window.__sky;
    stage = null; canvas = null; g = null; renderer = null; sky = null; objects = null; state = null; ui = {}; hold = null; drag = null;
  }

  return { id: 'sky', title: 'Sky Seeker', load, start, update, dispose };
}
