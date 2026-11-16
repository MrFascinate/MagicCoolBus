import { h, clear, announce } from '../../ui/dom.js';
import { icon, starRow } from '../../ui/icons.js';
import { LEVELS, SPECIMENS, STAMP_SKILL, ZOOM_STEPS } from './levels.js';
import { createRound, guess, zoomOut, namedClosest, starsFor, scaleBar, formatLength, indexManifest } from './logic.js';
import './microscope.css';

/**
 * Microscopic Madness. Same interface as every station:
 * { id, title, load(ctx), start(ctx), update(dt), dispose() }.
 *
 * The image viewer lives in its own layer over the 3D view (left of the
 * station panel); the panel holds levels, progress, hints and results.
 * Only the twelve images of the level being played are fetched.
 * @typedef {import('../registry.js').StationContext} StationContext
 */

const BASE = 'assets/microscope/';
/** Keep a number and its unit on one line. */
const nb = (t) => t.replace(' ', '\u00a0');
const STEP_NAMES = ['closest', 'zoomed out once', 'zoomed out twice', 'widest'];

export default function createMicroscopicMadness() {
  /** @type {StationContext} */ let ctx;
  /** @type {Map<string, {file:string, widthUm:number, simulated:boolean}[]>} */ let images;
  let level = LEVELS[0];
  /** @type {ReturnType<typeof createRound>[]} */ let rounds = [];
  let ri = 0;                 // round index within the level
  let stage = null;           // viewer layer
  let ui = {};
  let loadToken = 0;
  /** @type {HTMLImageElement[]} */ let preloaded = [];
  let onKey = null;

  const round = () => rounds[ri];
  const spec = () => SPECIMENS[level.specimens[ri]];
  const put = (el, ...kids) => el.append(...kids.filter(Boolean));
  const blocked = () => !!document.querySelector('#ui > .overlay:not([hidden])');

  async function load(c) {
    ctx = c;
    const res = await fetch(BASE + 'manifest.json');
    if (!res.ok) throw new Error('microscope manifest missing');
    images = indexManifest(await res.json());
  }

  function start(c) {
    ctx = c;
    ctx.setSheet?.('short');
    buildStage();
    ctx.onResize(layoutStage);
    onKey = (e) => {
      if (!stage || stage.hidden || blocked() || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = /** @type {HTMLElement} */ (e.target);
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const n = '1234'.indexOf(e.key);
      if (n >= 0 && ui.answerBtns?.[n] && !ui.answerBtns[n].disabled) { e.preventDefault(); ui.answerBtns[n].click(); }
      else if ((e.key === 'z' || e.key === 'Z') && ui.zoomBtn && !ui.zoomBtn.disabled && !ui.zoomBtn.hidden) { e.preventDefault(); ui.zoomBtn.click(); }
    };
    window.addEventListener('keydown', onKey);
    showLevelSelect();
  }

  const isUnlocked = (id) => id === 1 || ctx.save.levelStars(id - 1) > 0;

  // ---------- viewer layer ----------
  function buildStage() {
    stage = h('div.mm-stage', { hidden: true, role: 'region', 'aria-label': 'Microscope view' });
    ui.sim = h('p.mm-sim', { title: 'Made on a computer to look like an electron microscope image. Not a real photo.' }, icon('warn'), h('span', { text: 'Simulated image' }));
    ui.img = h('img.mm-img', { alt: '' });
    ui.imgNext = h('img.mm-img.mm-img-next', { alt: '', 'aria-hidden': 'true' });
    ui.barLine = h('span.mm-bar-line');
    ui.barText = h('span.mm-bar-text');
    ui.bar = h('div.mm-bar', null, ui.barLine, ui.barText);
    ui.stepTag = h('p.mm-step');
    ui.frame = h('div.mm-frame', null, ui.img, ui.imgNext, ui.sim, ui.bar, ui.stepTag);
    ui.answers = h('div.mm-answers', { role: 'group', 'aria-label': 'Answers' });
    ui.card = h('div.mm-card', null, ui.frame, ui.answers);
    stage.append(ui.card);
    document.getElementById('ui')?.append(stage);
    layoutStage();
  }

  /**
   * Fit the square image and the answers into the space the panel leaves:
   * left of a side panel, or above a bottom sheet on an upright phone.
   */
  function layoutStage() {
    if (!stage) return;
    const { width, height, panelWidth, panelHeight = 0, safe = { t: 0, r: 0, b: 0, l: 0 } } = ctx.viewport();
    const freeW = Math.max(240, width - panelWidth - safe.l - (panelWidth ? 0 : safe.r));
    const freeH = Math.max(200, height - panelHeight - safe.t - (panelHeight ? 0 : safe.b));
    stage.style.right = `${panelWidth || safe.r}px`;
    stage.style.bottom = `${panelHeight || safe.b}px`;
    stage.style.top = `${safe.t}px`;
    stage.style.left = `${safe.l}px`;
    // answers beside the picture when the free area is short and wide (a phone on its side)
    const short = freeH < 560 && freeW > freeH * 1.15;
    stage.classList.toggle('mm-side', short);
    const narrow = !short && freeW < 480;
    stage.classList.toggle('mm-narrow', narrow);
    const pad = short || narrow ? 8 : 16;
    const side = 150;          // answer column width on short screens
    const answersH = narrow ? 112 : 150;
    let size;
    if (short) size = Math.min(freeH - pad * 2, freeW - pad * 2 - side - 8);
    else size = Math.min(freeW - pad * 2, freeH - pad * 2 - answersH - 8);
    size = Math.max(150, Math.floor(size));
    ui.frame.style.width = ui.frame.style.height = `${size}px`;
    ui.answers.style.width = short ? `${side}px` : `${Math.max(size, Math.min(freeW - pad * 2, 420))}px`;
  }

  function setImage(stepIndex, animate) {
    const s = images.get(spec().id)[stepIndex];
    const src = BASE + s.file;
    const bar = scaleBar(s.widthUm);
    ui.barLine.style.width = `${(bar.fraction * 100).toFixed(2)}%`;
    ui.barText.textContent = bar.label;
    ui.bar.setAttribute('aria-label', `Scale bar: ${bar.spoken}`);
    ui.sim.hidden = !s.simulated;
    ui.img.alt = `Mystery object, ${STEP_NAMES[stepIndex]} zoom. The view is ${formatLength(s.widthUm, true)} wide.`;
    ui.stepTag.textContent = `Zoom ${stepIndex + 1} of ${ZOOM_STEPS}. View: ${nb(formatLength(s.widthUm))} wide`;
    if (animate && !ctx.reducedMotion && ui.img.src) {
      // the old view shrinks toward the centre as the new, wider view fades in
      ui.imgNext.src = ui.img.src;
      ui.imgNext.classList.remove('mm-out');
      void ui.imgNext.offsetWidth;
      ui.imgNext.classList.add('mm-out');
    }
    ui.img.src = src;
  }

  // ---------- panels ----------
  function showLevelSelect() {
    if (stage) stage.hidden = true;
    const p = ctx.panel;
    clear(p);
    p.append(
      h('h2', { text: 'Microscopic Madness' }),
      h('p', { text: 'An electron microscope can zoom in far past what your eyes can see. Guess the mystery object from a close-up. A wrong guess zooms out and gives you a new clue.' }),
    );
    const list = h('ul.level-list');
    for (const l of LEVELS) {
      const open = isUnlocked(l.id);
      list.append(h('li', null,
        h('button.level-card', { type: 'button', disabled: !open, 'data-level': l.id, onclick: () => startLevel(l) },
          h('span.level-name', { text: `Level ${l.id}: ${l.title}` }),
          h('span.level-goal', { text: open ? l.goal : `Clear level ${l.id - 1} to open this level.` }),
          open ? starRow(ctx.save.levelStars(l.id)) : h('span.level-lock', null, icon('lock'), h('span', { text: 'Locked' })),
        )));
    }
    p.append(list);
    if (ctx.save.hasStamp()) p.append(h('p.stamp-note', null, icon('stamp'), h('span', { text: `Stamp earned: ${STAMP_SKILL}.` })));
    p.querySelector('.level-card:not([disabled])')?.focus();
  }

  async function startLevel(l) {
    level = l;
    rounds = l.specimens.map((id) => createRound(SPECIMENS[id]));
    ri = 0;
    const token = ++loadToken;
    const p = ctx.panel;
    clear(p);
    p.append(h('h2', { text: `Level ${l.id}: ${l.title}` }), h('p', { role: 'status', text: 'Loading the microscope images...' }));
    try {
      await preloadLevel(l);
    } catch (e) {
      console.error(e);
      if (token !== loadToken) return;
      clear(p);
      p.append(h('h2', { text: `Level ${l.id}: ${l.title}` }), h('p', { text: 'The images did not load. Check the connection and try again.' }),
        h('div.actions', null, h('button.primary', { type: 'button', onclick: () => startLevel(l) }, h('span', { text: 'Try again' })), h('button', { type: 'button', onclick: showLevelSelect }, h('span', { text: 'All levels' }))));
      return;
    }
    if (token !== loadToken || !stage) return;
    showRound();
  }

  /** Fetch only this level's twelve images and wait until they decode. */
  async function preloadLevel(l) {
    preloaded = [];
    const jobs = [];
    for (const id of l.specimens) {
      for (const s of images.get(id)) {
        const im = new Image();
        im.decoding = 'async';
        im.src = BASE + s.file;
        preloaded.push(im);
        jobs.push(im.decode());
      }
    }
    await Promise.all(jobs);
  }

  function showRound() {
    const r = round();
    const sp = spec();
    stage.hidden = false;
    layoutStage();
    ui.card.classList.remove('mm-revealed');
    setImage(r.step, false);
    // answers under the image
    clear(ui.answers);
    ui.answerBtns = sp.choices.map((c, i) => h('button.mm-answer', { type: 'button', 'data-choice': c, onclick: () => onGuess(c) },
      h('span.mm-key', { 'aria-hidden': 'true', text: String(i + 1) }), h('span.mm-answer-text', { text: c })));
    ui.answers.append(...ui.answerBtns);
    // panel
    const p = ctx.panel;
    clear(p);
    ui.msg = h('div.message', { role: 'status' });
    ui.zoomBtn = h('button', { type: 'button', onclick: onZoomOut }, h('span', { text: 'Zoom out for a clue' }));
    ui.progress = h('p.mm-progress');
    put(p,
      h('div.panel-head', null,
        h('button.link', { type: 'button', onclick: () => { loadToken++; showLevelSelect(); } }, icon('back'), h('span', { text: 'Levels' })),
        h('h2', { text: `Level ${level.id}: ${level.title}` })),
      h('p.goal', null, h('strong', { text: 'Goal: ' }), level.goal),
      ui.progress,
      h('p.limit', { text: `Two stars: ${level.wrongLimit} wrong guesses or fewer in this level. Three stars: name all three at the closest zoom.` }),
      h('p.tip', { text: 'Pick an answer under the picture, or press 1, 2, 3 or 4. Zooming out shows more, but the closest guess earns the most stars.' }),
      h('div.actions', null, ui.zoomBtn),
      ui.msg,
    );
    refreshProgress();
    announce(`Object ${ri + 1} of 3. What is it? Four answers are under the picture.`);
    ui.answerBtns[0].focus();
  }

  function refreshProgress() {
    const wrong = rounds.reduce((n, r) => n + r.wrong, 0);
    ui.progress.textContent = `Object ${ri + 1} of 3. Wrong guesses in this level: ${wrong}.`;
    ui.zoomBtn.disabled = round().step >= ZOOM_STEPS - 1 || round().solved;
  }

  function setMessage(text, kind) {
    clear(ui.msg);
    ui.msg.className = 'message' + (kind ? ` ${kind}` : '');
    if (text) ui.msg.append(icon(kind === 'miss' ? 'warn' : kind === 'win' ? 'check' : 'now'), h('span', { text }));
  }

  function onZoomOut() {
    const r = round();
    if (!zoomOut(r)) return;
    ctx.sound.play('turn');
    setImage(r.step, true);
    setMessage(`Zoomed out. You can see more of the object now.`, null);
    announce(`Zoomed out to step ${r.step + 1} of 4.`);
    refreshProgress();
  }

  function onGuess(choice) {
    const r = round();
    const res = guess(r, choice);
    if (res.result === 'ignored') return;
    if (res.result === 'wrong') {
      ctx.sound.play('miss');
      const btn = ui.answerBtns.find((b) => b.dataset.choice === choice);
      btn.disabled = true;
      btn.classList.add('mm-crossed');
      btn.setAttribute('aria-label', `${choice}, crossed out`);
      btn.append(h('span.mm-cross', { 'aria-hidden': 'true' }, icon('remove')));
      const hint = spec().hints[Math.min(res.hintIndex, spec().hints.length - 1)];
      setImage(r.step, true);
      setMessage(`Not ${choice}. ${hint}`, 'miss');
      announce(`Not ${choice}. ${hint} Zoomed out to step ${r.step + 1}.`);
      refreshProgress();
      // keep focus on an answer that is still open
      ui.answerBtns.find((b) => !b.disabled)?.focus();
      return;
    }
    reveal();
  }

  function reveal() {
    const r = round();
    const sp = spec();
    ctx.sound.play('win');
    ui.card.classList.add('mm-revealed');
    setImage(ZOOM_STEPS - 1, r.solvedAtStep < ZOOM_STEPS - 1);
    const widest = images.get(sp.id)[ZOOM_STEPS - 1];
    ui.img.alt = `${sp.name}, the whole view. It is ${formatLength(widest.widthUm, true)} wide.`;
    for (const b of ui.answerBtns) {
      b.disabled = true;
      if (b.dataset.choice === sp.name) { b.classList.add('mm-right'); b.append(h('span.mm-tick', { 'aria-hidden': 'true' }, icon('check'))); }
    }
    const closest = namedClosest(r);
    const last = ri === rounds.length - 1;
    const p = ctx.panel;
    clear(p);
    const next = h('button.primary', { type: 'button', onclick: () => { if (last) finishLevel(); else { ri++; showRound(); } } },
      h('span', { text: last ? 'See your stars' : 'Next object' }));
    put(p,
      h('h2', { text: `Answer: ${sp.name}` }),
      h('p.mm-found', null, icon('check'), h('span', { text: closest ? 'Named at the closest zoom. Sharp eyes!' : `Named at zoom ${r.solvedAtStep + 1} of 4.` })),
      h('p.mm-fact', { text: sp.fact }),
      h('p.small', { text: `The whole view is ${nb(formatLength(widest.widthUm))} wide. The first close-up was ${nb(formatLength(images.get(sp.id)[0].widthUm))} wide.` }),
      h('div.actions', null, next),
    );
    announce(`Right. It is ${sp.name}. ${sp.fact}`);
    next.focus();
  }

  function finishLevel() {
    const s = starsFor(rounds, level);
    const best = ctx.save.recordLevel(level.id, s.stars);
    let newStamp = false;
    if (level.id === 3) newStamp = ctx.save.awardStamp(STAMP_SKILL);
    ctx.avatar.play('cheer');
    stage.hidden = true;
    const p = ctx.panel;
    clear(p);
    const row = (ok, text) => h('li', { class: ok ? 'yes' : 'no' }, icon(ok ? 'check' : 'dash'), h('span', { text: `${text} ${ok ? '(yes)' : '(not yet)'}` }));
    const next = LEVELS.find((l) => l.id === level.id + 1);
    put(p,
      h('h2', { text: `Level ${level.id} cleared` }),
      h('p.result-stars', null, starRow(s.stars), h('span.sr-only', { text: `You got ${s.stars} of 3 stars.` })),
      h('ul.checklist', null,
        row(s.finished, 'Named all three objects.'),
        row(s.withinLimit, `Used ${level.wrongLimit} wrong guesses or fewer. You used ${s.wrong}.`),
        row(s.allClosest, 'Named all three at the closest zoom.'),
      ),
      best > s.stars ? h('p', { text: `Your best for this level is still ${best} stars. A new try never takes stars away.` }) : null,
      h('p.tip', { text: `What this level shows: ${level.teaches}` }),
      h('div.actions', null,
        h('button', { type: 'button', onclick: () => startLevel(level) }, h('span', { text: 'Try again' })),
        next ? h('button.primary', { type: 'button', onclick: () => startLevel(next) }, h('span', { text: `Next: Level ${next.id}` })) : null,
        h('button', { type: 'button', onclick: showLevelSelect }, h('span', { text: 'All levels' })),
      ),
    );
    announce(`Level ${level.id} cleared. ${s.stars} of 3 stars.`);
    p.querySelector('.actions .primary, .actions button')?.focus();
    if (newStamp) ctx.showStamp(STAMP_SKILL);
  }

  function dispose() {
    loadToken++;
    if (onKey) window.removeEventListener('keydown', onKey);
    onKey = null;
    stage?.remove();
    stage = null;
    for (const im of preloaded) im.src = '';
    preloaded = [];
    ui = {};
  }

  return { id: 'microscope', title: 'Microscopic Madness', load, start, dispose };
}
