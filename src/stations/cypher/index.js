import * as THREE from 'three';
import { h, clear, announce } from '../../ui/dom.js';
import { icon, starRow } from '../../ui/icons.js';
import LYRICS from './lyrics.json';
import {
  spb, beatTime, slotTimes, slotAt, judgeTap, slotOutcome, createVerse, resolveSlot, starsFor,
  calibrate, pulseLevel, COUNT_IN, BEATS_PER_SLOT, STAR_BEAT,
} from './beat.js';
import { createBeatEngine } from './audio.js';
import { DEBUG } from '../../core/env.js';
import './cypher.css';

/**
 * Science Cypher. Same interface as every station:
 * { id, title, load(ctx), start(ctx), update(dt), dispose() }.
 *
 * A beat plays (synthesised, no audio files) and a lyric line shows with its
 * last word blank. A star rides a track toward the tap line; the player taps
 * the right word as the star reaches the line. Timing is judged against the
 * audio clock with sound on and against the screen clock with sound off.
 * @typedef {import('../registry.js').StationContext} StationContext
 */

export const STAMP_SKILL = 'Put science words on the beat';
const LEVELS = LYRICS.levels;
const CAL_BPM = 90;
const CAL_BEATS = 8;            // 4 to listen, 4 to tap
const CAL_TAP_FROM = 4;
const LEAD = 0.6;               // seconds from Start to the first beat

/** Calibrated delays, kept while the game is open. One per clock, because speakers add delay and screens do not. */
const CALIB = { audio: /** @type {number|null} */ (null), visual: /** @type {number|null} */ (null) };

/** Space the lyric bar takes on a short screen (phone on its side), in CSS pixels. */
const SHORT_BAR_PX = 172;

export default function createScienceCypher() {
  /** @type {StationContext} */ let ctx;
  const engine = createBeatEngine();
  let level = LEVELS[0];
  let mode = 'select';          // select | calib | calibDone | play | paused | result
  let stage = null;
  let ui = {};
  let canvas = null, g = null, dpr = 1, cw = 0, chh = 0;
  let starPath = null;
  // clock
  let soundClock = false, p0 = 0, bpm = 90, startPerf = 0;
  let lastFrame = 0, maxGap = 0;
  // run state
  let verse = null, curSlot = -1, slotTap = null, judged = null, feedbackUntil = -1, feedbackText = '';
  let pendingStart = null;
  let lastInput = null;          // debug only: the last word press, for the smoke test
  // calibration state
  let calTaps = [];
  // avatar placement
  let avatarObj = null; const avatarSaved = { x: 0, y: 0, z: 0, ry: 0 };
  let camSaved = null;
  let onKey = null, onVis = null, pauseWatch = null;
  // strings drawn on the track, made once so drawing a frame allocates nothing
  const PULSE = Array.from({ length: 21 }, (_, i) => `rgba(255,207,63,${(0.18 + 0.45 * i / 20).toFixed(3)})`);
  const READY = [1, 2, 3, 4].map((n) => `Get ready: ${n}`);
  const LISTEN = [1, 2, 3, 4].map((n) => `Listen: ${n}`);
  const TAPN = [1, 2, 3, 4].map((n) => `Tap: ${n}`);

  const put = (el, ...kids) => el.append(...kids.filter(Boolean));
  const blocked = () => !!document.querySelector('#ui > .overlay:not([hidden])');
  const offset = () => (soundClock ? CALIB.audio : CALIB.visual) ?? 0;
  const calibratedFor = (sound) => (sound ? CALIB.audio : CALIB.visual) !== null;

  async function load(c) { ctx = c; }

  function start(c) {
    ctx = c;
    buildStage();
    placeAvatar();
    frameCamera();
    ctx.onResize(() => { layoutStage(); frameCamera(); });
    onKey = (e) => {
      if (blocked() || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return;
      const n = '123'.indexOf(e.key);
      if (mode === 'play' && n >= 0 && ui.choiceBtns?.[n]) { e.preventDefault(); choose(n, e.timeStamp); }
      else if (mode === 'calib' && (e.key === ' ' || e.key === 'Enter' || e.key === 't' || e.key === 'T')) { e.preventDefault(); calTap(e.timeStamp); }
    };
    window.addEventListener('keydown', onKey);
    onVis = () => { if (document.hidden) interrupt(); };
    document.addEventListener('visibilitychange', onVis);
    // The shell's pause card is the overlay in #ui. When it opens mid-song, stop the song
    // so the player does not miss lines while paused.
    const ov = document.querySelector('#ui > .overlay');
    if (ov && typeof MutationObserver === 'function') {
      pauseWatch = new MutationObserver(() => { if (!ov.hidden && (mode === 'play' || mode === 'calib')) interrupt(); });
      pauseWatch.observe(ov, { attributes: true, attributeFilter: ['hidden'] });
    }
    lastFrame = performance.now();
    if (DEBUG) {
      window.__cypher = {
        get mode() { return mode; }, get slot() { return curSlot; }, get line() { return verse ? verse.line : -1; },
        get tapped() { return slotTap; }, get offset() { return offset(); }, get soundClock() { return soundClock; },
        get bpm() { return bpm; }, get maxGap() { return maxGap; },
        get lastInput() { return lastInput; },
        now: () => songNow(performance.now()),
        star: () => (curSlot >= 0 ? slotTimes(curSlot, bpm).star : null),
        answerIndex: () => { const l = level.lines[verse.line]; return l.choices.indexOf(l.answer); },
        // Test hooks: an input event stamped at a given song time, the way a real tap carries its own
        // timestamp even when the page is busy drawing (software WebGL in CI runs near 1 fps).
        tapAt: (k, t) => choose(k, stampFor(t)),
        calTapAt: (t) => calTap(stampFor(t)),
        get calTaps() { return calTaps.slice(); },
      };
    }
    showLevelSelect();
  }

  const isUnlocked = (id) => id === 1 || ctx.save.levelStars(id - 1) > 0;

  // ---------- 3D: avatar on the stage, camera on the stage ----------
  function placeAvatar() {
    const ring = ctx.hub.pos('ring_cypher');
    for (const o of ctx.scene.children) {
      if (o === ctx.hub.root || o.isSprite || o.isLight || o.isCamera) continue;
      if (Math.abs(o.position.x - ring.x) < 0.4 && Math.abs(o.position.z - ring.z) < 0.4) {
        let mesh = false;
        o.traverse((k) => { if (k.isMesh || k.isSkinnedMesh) mesh = true; });
        if (mesh) { avatarObj = o; break; }
      }
    }
    if (!avatarObj || !ctx.hub.get('stage_center')) return;
    avatarSaved.x = avatarObj.position.x; avatarSaved.y = avatarObj.position.y; avatarSaved.z = avatarObj.position.z;
    avatarSaved.ry = avatarObj.rotation.y;
    const sc = ctx.hub.pos('stage_center');
    avatarObj.position.set(sc.x, sc.y, sc.z);
    avatarObj.rotation.y = 0; // the avatar model faces +Z, toward the street and the camera
  }

  /**
   * Camera on the stage. It stands off to the hinge side of the open rear
   * hatch at rail height, so the hatch (the stage canopy) stays above the
   * character's head, then tilts so the character sits in the middle of the
   * part of the screen the lyric bar does not cover.
   */
  function frameCamera() {
    if (!ctx.hub.get('stage_center')) return;
    const sc = ctx.hub.pos('stage_center');
    const cam = ctx.camera;
    if (!camSaved) camSaved = { p: cam.position.clone(), q: cam.quaternion.clone() };
    const { height } = ctx.viewport();
    const short = height < 560;
    const bar = stage && !stage.hidden ? ui.bar?.getBoundingClientRect() : null;
    let free;
    if (short) {
      // A phone on its side: the lyric bar takes about 170 px whatever the line says, so
      // keep the camera steady and stand back far enough that the whole character,
      // feet to head, fits in the band above the bar.
      free = Math.max(0.35, (height - SHORT_BAR_PX) / height);
      const tall = avatarHeight() + 0.35;                 // a little room above the head and below the feet
      const halfTan = Math.tan((cam.fov * Math.PI) / 360);
      const dist = Math.max(2.4, tall / (2 * halfTan * free));
      const mid = sc.y + tall / 2 - 0.15;
      const dir = new THREE.Vector3(0.18, 0, 1).normalize();
      cam.position.set(sc.x + dir.x * dist, mid, sc.z + dir.z * dist);
      cam.lookAt(sc.x - 0.05, mid, sc.z);
    } else {
      cam.position.set(sc.x + 0.45, sc.y + 1.0, sc.z + 2.8);
      cam.lookAt(sc.x - 0.05, sc.y + 1.25, sc.z);        // between the rail top and the head
      free = bar && bar.top > 0 ? Math.min(1, bar.top / height) : 1; // share of the screen above the bar
    }
    const ndcY = 1 - free;                              // middle of the free band, in NDC
    const tilt = Math.atan(ndcY * Math.tan((cam.fov * Math.PI) / 360));
    cam.rotateX(-tilt);
    cam.updateMatrixWorld(true);
  }

  /** Height of the character on the stage, in metres (1.5 if it cannot be measured). */
  function avatarHeight() {
    if (!avatarObj) return 1.5;
    const b = new THREE.Box3().setFromObject(avatarObj);
    const hgt = b.max.y - b.min.y;
    return Number.isFinite(hgt) && hgt > 0.5 && hgt < 3 ? hgt : 1.5;
  }

  // ---------- stage layer: track, lyric bar, word buttons ----------
  function buildStage() {
    stage = h('div.cy-stage', { hidden: true, role: 'region', 'aria-label': 'Science Cypher' });
    canvas = h('canvas.cy-track', { 'aria-hidden': 'true' });
    g = canvas.getContext('2d');
    starPath = new Path2D();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.45 : 1, a = -Math.PI / 2 + i * Math.PI / 5;
      starPath[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r);
    }
    starPath.closePath();
    ui.status = h('p.cy-status', { 'aria-hidden': 'true' });
    ui.line = h('p.cy-line');
    ui.next = h('p.cy-next');
    ui.choices = h('div.cy-choices', { role: 'group', 'aria-label': 'Word choices' });
    // three word buttons, made once and relabelled for each line so focus stays put
    ui.choiceBtns = [0, 1, 2].map((k) => h('button.cy-choice', {
      type: 'button',
      onpointerdown: (e) => { if (e.button === 0) { e.preventDefault(); choose(k, e.timeStamp); } },
      onclick: (e) => { if (e.detail === 0) choose(k, e.timeStamp); }, // keyboard Enter or Space on a focused word
    }, h('span.cy-key', { 'aria-hidden': 'true', text: String(k + 1) }), h('span.cy-word')));
    ui.choices.append(...ui.choiceBtns);
    ui.tapBtn = h('button.primary.cy-tap', { type: 'button', hidden: true, onpointerdown: (e) => { e.preventDefault(); calTap(e.timeStamp); }, onclick: (e) => { if (e.detail === 0) calTap(e.timeStamp); } },
      h('span', { text: 'Tap' }));
    ui.bar = h('div.cy-bar', null, ui.status, canvas, ui.line, ui.choices, ui.tapBtn, ui.next);
    stage.append(ui.bar);
    document.getElementById('ui')?.append(stage);
    layoutStage();
  }

  function layoutStage() {
    if (!stage) return;
    const { width, height, panelWidth } = ctx.viewport();
    stage.style.right = `${panelWidth}px`;
    stage.classList.toggle('cy-short', height < 560);
    const w = Math.max(220, Math.min(width - panelWidth - 24, 860));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    // the canvas sits inside the bar's padding and border (12 + 4 px a side, 8 + 3 on short screens)
    cw = w - (height < 560 ? 22 : 32); chh = height < 560 ? 40 : 76;
    canvas.width = Math.round(cw * dpr); canvas.height = Math.round(chh * dpr);
    canvas.style.width = `${cw}px`; canvas.style.height = `${chh}px`;
    ui.bar.style.width = `${w}px`;
  }

  // ---------- clocks ----------
  /** Song time now, as the player perceives it. */
  function songNow(perf) {
    return soundClock ? engine.heardNow(perf) : (perf - p0) / 1000;
  }
  /** performance-clock timestamp of a song time (inverse of songAt). */
  function stampFor(t) {
    const perf = performance.now();
    return perf - (songNow(perf) - t) * 1000;
  }
  /** Song time of an input event. */
  function songAt(ts) {
    const perf = performance.now();
    return soundClock ? engine.heardAt(ts, perf) : (ts - p0) / 1000;
  }
  function startClock(tempo, sound, clicks = 0) {
    bpm = tempo;
    soundClock = false;
    if (sound) {
      engine.unlock();
      const ok = clicks ? engine.clicks(tempo, clicks, LEAD) : engine.start(tempo, LEAD);
      if (ok) soundClock = true;
    }
    startPerf = performance.now();
    p0 = startPerf + LEAD * 1000;
    lastFrame = startPerf;
  }

  // ---------- panels ----------
  function showLevelSelect() {
    stopSong();
    mode = 'select';
    if (stage) stage.hidden = true;
    ctx.avatar.play('idle');
    const p = ctx.panel;
    clear(p);
    p.append(
      h('h2', { text: 'Science Cypher' }),
      h('p', { text: 'A beat plays and a line of a science rap appears with its last word missing. Tap the right word as the star reaches the line.' }),
      h('p.small', { text: 'Works with sound off: the moving star shows every beat. Placeholder lyrics, no vocals yet.' }),
    );
    const list = h('ul.level-list');
    for (const l of LEVELS) {
      const open = isUnlocked(l.id);
      list.append(h('li', null,
        h('button.level-card', { type: 'button', disabled: !open, 'data-level': l.id, onclick: () => chooseLevel(l) },
          h('span.level-name', { text: `Level ${l.id}: ${l.title}` }),
          h('span.level-goal', { text: open ? `Finish an 8-line verse about ${l.topic.split(' (')[0].toLowerCase()}.` : `Clear level ${l.id - 1} to open this level.` }),
          open ? starRow(ctx.save.levelStars(l.id)) : h('span.level-lock', null, icon('lock'), h('span', { text: 'Locked' })),
        )));
    }
    p.append(list);
    if (calibratedFor(ctx.sound.on)) p.append(h('div.actions', null, h('button', { type: 'button', onclick: () => showCalibration(null) }, h('span', { text: 'Check my timing again' }))));
    if (ctx.save.hasStamp()) p.append(h('p.stamp-note', null, icon('stamp'), h('span', { text: `Stamp earned: ${STAMP_SKILL}.` })));
    p.querySelector('.level-card:not([disabled])')?.focus();
  }

  function chooseLevel(l) {
    level = l;
    if (!calibratedFor(ctx.sound.on)) showCalibration(l);
    else showReady();
  }

  // ---------- calibration ----------
  function showCalibration(thenLevel) {
    stopSong();
    pendingStart = thenLevel;
    mode = 'calibIdle';
    stage.hidden = false;
    frameCamera();
    layoutStage();
    ui.line.textContent = 'Timing check';
    ui.next.textContent = '';
    ui.choices.hidden = true;
    ui.tapBtn.hidden = false;
    ui.tapBtn.disabled = true;
    const sound = ctx.sound.on;
    const p = ctx.panel;
    clear(p);
    ui.calMsg = h('div.message', { role: 'status' });
    const go = h('button.primary', { type: 'button', onclick: () => runCalibration() }, icon('play'), h('span', { text: 'Start the timing check' }));
    put(p,
      h('h2', { text: 'Timing check' }),
      h('p', { text: sound
        ? 'Some computers play sound a little late. This check measures that, so your taps are judged fairly.'
        : 'Sound is off, so the game follows the moving dots. This check measures how you tap along with them.' }),
      h('ol.cy-steps', null,
        h('li', { text: sound ? 'Listen to four clicks.' : 'Watch four dots reach the line.' }),
        h('li', { text: 'Then tap the Tap button, or press Space, on each of the next four beats.' })),
      h('div.actions', null, go,
        h('button', { type: 'button', onclick: () => { CALIB[sound ? 'audio' : 'visual'] = 0; afterCalibration(); } }, h('span', { text: 'Skip' }))),
      ui.calMsg,
    );
    go.focus();
  }

  function runCalibration() {
    calTaps = [];
    mode = 'calib';
    startClock(CAL_BPM, ctx.sound.on, CAL_BEATS);
    ui.tapBtn.disabled = false;
    ui.tapBtn.focus();
    setCalMsg('Listen for the first four beats, then tap on the next four.', null);
    announce('Timing check started. Wait four beats, then tap on each of the next four.');
  }

  function calTap(ts) {
    if (mode !== 'calib') return;
    const t = songAt(ts);
    calTaps.push(t);
    engine.feedback('tap');
    ui.tapBtn.classList.remove('cy-pressed'); void ui.tapBtn.offsetWidth; ui.tapBtn.classList.add('cy-pressed');
  }

  function finishCalibration() {
    const beats = [];
    for (let i = CAL_TAP_FROM; i < CAL_BEATS; i++) beats.push(beatTime(i, CAL_BPM));
    const res = calibrate(calTaps, beats);
    mode = 'calibDone';
    ui.tapBtn.disabled = true;
    const key = soundClock ? 'audio' : 'visual';
    const p = ctx.panel;
    clear(p);
    if (!res.ok) {
      put(p, h('h2', { text: 'Timing check' }),
        h('p', { text: `The game caught ${res.used} of the 4 taps it needs at least 3 of. Try again, and tap on beats 5, 6, 7 and 8.` }),
        h('div.actions', null,
          h('button.primary', { type: 'button', onclick: () => runCalibration() }, h('span', { text: 'Try again' })),
          h('button', { type: 'button', onclick: () => { CALIB[key] = 0; afterCalibration(); } }, h('span', { text: 'Skip' }))));
      p.querySelector('button')?.focus();
      announce('Not enough taps. Try again.');
      return;
    }
    const ms = Math.round(res.offset * 1000);
    const desc = Math.abs(ms) < 25 ? 'right on the beat' : ms > 0 ? `${ms} ms after the beat` : `${-ms} ms before the beat`;
    put(p, h('h2', { text: 'Timing check done' }),
      h('p', { text: `Your taps landed about ${desc}. The game will allow for that.` }),
      h('div.actions', null,
        h('button.primary', { type: 'button', onclick: () => { CALIB[key] = res.offset; afterCalibration(); } }, h('span', { text: 'Use this' })),
        h('button', { type: 'button', onclick: () => runCalibration() }, h('span', { text: 'Try again' }))));
    announce(`Timing check done. Your taps landed about ${desc}.`);
    p.querySelector('button')?.focus();
  }

  function afterCalibration() {
    stopSong();
    ui.tapBtn.hidden = true;
    if (pendingStart) { level = pendingStart; pendingStart = null; showReady(); }
    else showLevelSelect();
  }

  function setCalMsg(text, kind) {
    if (!ui.calMsg) return;
    clear(ui.calMsg);
    ui.calMsg.className = 'message' + (kind ? ` ${kind}` : '');
    if (text) ui.calMsg.append(icon('now'), h('span', { text }));
  }

  // ---------- play ----------
  function showReady() {
    stopSong();
    mode = 'ready';
    stage.hidden = false;
    frameCamera();
    ui.tapBtn.hidden = true;
    layoutStage();
    verse = createVerse(level.lines.length);
    showLine(0, false);
    const p = ctx.panel;
    clear(p);
    const go = h('button.primary.big', { type: 'button', onclick: () => startRun() }, icon('play'), h('span', { text: 'Play the verse' }));
    put(p,
      h('div.panel-head', null,
        h('button.link', { type: 'button', onclick: showLevelSelect }, icon('back'), h('span', { text: 'Levels' })),
        h('h2', { text: `Level ${level.id}: ${level.title}` })),
      h('p.goal', null, h('strong', { text: 'Goal: ' }), `Finish the 8-line verse. Tap the missing word as the star reaches the line.`),
      h('p.limit', { text: `Two stars: ${level.replayLimit} replays or fewer. Three stars: every word right and on the beat the first time.` }),
      h('p.tip', { text: 'Pick a word with a tap or a click, or press 1, 2 or 3. A miss just plays the line again.' }),
      !ctx.sound.on ? h('p.cy-note', null, icon('soundOff'), h('span', { text: 'Sound is off. Follow the moving dots and the star.' })) : null,
      h('div.actions', null, go),
    );
    go.focus();
  }

  function startRun(resume = false) {
    if (!resume) verse = createVerse(level.lines.length);
    curSlot = -1; slotTap = null; judged = null; feedbackUntil = -1;
    mode = 'play';
    startClock(level.bpm, ctx.sound.on);
    ctx.avatar.play('dance');
    showLine(verse.line, false);
    buildPlayPanel();
    announce(`Get ready. Four counts, then line ${verse.line + 1}.`);
  }

  function buildPlayPanel() {
    const p = ctx.panel;
    clear(p);
    ui.progress = h('p.cy-progress');
    ui.msg = h('div.message', { role: 'status' });
    put(p,
      h('h2', { text: `Level ${level.id}: ${level.title}` }),
      ui.progress,
      h('p.limit', { text: `Two stars: ${level.replayLimit} replays or fewer.` }),
      !soundClock ? h('p.cy-note', null, icon('soundOff'), h('span', { text: 'Sound is off. Tap as the star reaches the line.' })) : null,
      ui.msg,
      h('div.actions', null, h('button', { type: 'button', onclick: showReady }, icon('stop'), h('span', { text: 'Stop' }))),
    );
    refreshProgress();
    ui.choiceBtns?.[0]?.focus();
  }

  function refreshProgress() {
    if (!ui.progress || !verse) return;
    ui.progress.textContent = `Line ${Math.min(verse.line + 1, verse.lineCount)} of ${verse.lineCount}. Replays: ${verse.replays}.`;
  }

  function setMessage(text, kind) {
    if (!ui.msg) return;
    clear(ui.msg);
    ui.msg.className = 'message' + (kind ? ` ${kind}` : '');
    if (text) ui.msg.append(icon(kind === 'miss' ? 'warn' : kind === 'win' ? 'check' : 'now'), h('span', { text }));
  }

  /** Show line i in the lyric bar with its blank and word buttons. */
  function showLine(i, again) {
    const line = level.lines[Math.min(i, level.lines.length - 1)];
    clear(ui.line);
    if (again) ui.line.append(h('span.cy-again', { text: 'Again: ' }));
    ui.line.append(document.createTextNode(line.before + ' '));
    ui.blank = h('span.cy-blank', { 'aria-label': 'missing word' }, h('span', { text: '?' }));
    ui.line.append(ui.blank);
    ui.choices.hidden = false;
    ui.choiceBtns.forEach((b, k) => {
      b.className = 'cy-choice';
      b.disabled = false;
      b.dataset.word = line.choices[k];
      b.querySelector('.cy-word').textContent = line.choices[k];
      b.querySelector('.cy-mark')?.remove();
    });
    const nx = level.lines[i + 1];
    ui.next.textContent = nx ? `Next: ${nx.before} ...` : 'Last line';
  }

  function choose(k, ts) {
    if (DEBUG) lastInput = { k, mode, slot: curSlot, at: soundClock || mode === 'play' ? +songAt(ts).toFixed(3) : null };
    if (mode !== 'play' || !verse || verse.done) return;
    const line = level.lines[verse.line];
    const word = line.choices[k];
    if (curSlot < 0) { setMessage('Wait for the count-in to finish. The first star is coming.', null); return; }
    if (slotTap) return; // one judged tap per line
    const t = songAt(ts);
    const st = slotTimes(curSlot, bpm).star;
    const j = judgeTap(t, st, bpm, offset());
    if (j.kind === 'tooSoon') { setMessage('Too soon. Wait until the star is close to the line.', null); return; }
    const right = word === line.answer;
    slotTap = slotOutcome(j, right);
    judged = j;
    const btn = ui.choiceBtns[k];
    clear(ui.blank);
    ui.blank.append(h('span', { text: right ? line.answer : word }));
    for (const b of ui.choiceBtns) b.disabled = true;
    if (slotTap === 'right') {
      engine.feedback('right');
      btn.classList.add('cy-right');
      btn.append(h('span.cy-mark', { 'aria-hidden': 'true' }, icon('check')));
      ui.blank.classList.add('cy-ok');
      feedbackText = 'On the beat!';
      setMessage(`Yes: "${line.answer}". On the beat!`, 'win');
      announce(`Right. ${line.answer}. On the beat.`);
    } else if (slotTap === 'wrong') {
      engine.feedback('miss');
      btn.classList.add('cy-wrong');
      btn.append(h('span.cy-mark', { 'aria-hidden': 'true' }, icon('remove')));
      ui.blank.classList.add('cy-bad');
      clear(ui.blank); ui.blank.append(h('s', { text: word }), document.createTextNode(` ${line.answer}`));
      feedbackText = 'Not that word';
      setMessage(`The word is "${line.answer}". ${line.meaning} The line plays again.`, 'miss');
      announce(`Not ${word}. The word is ${line.answer}. ${line.meaning}`);
    } else {
      engine.feedback('miss');
      btn.classList.add('cy-offbeat');
      const early = slotTap === 'early';
      feedbackText = early ? 'Early: before the line' : 'Late: after the line';
      const ms = Math.round(Math.abs(j.delta) * 1000);
      setMessage(`Right word, ${early ? 'early' : 'late'} by ${ms} ms. ${early ? 'Wait a little longer' : 'Tap a little sooner'} next time. The line plays again.`, 'miss');
      announce(`Right word, a little ${early ? 'early' : 'late'}. The line plays again.`);
    }
    feedbackUntil = t + 0.9;
  }

  /** Called when the song moves into slot k: settle the slot that just ended. */
  function enterSlot(k) {
    if (curSlot >= 0) {
      const outcome = slotTap || 'none';
      if (outcome === 'none') {
        const line = level.lines[verse.line];
        setMessage(`No word that time. The missing word was "${line.answer}". The line plays again.`, 'miss');
        announce(`Missed. The word was ${line.answer}. The line plays again.`);
      }
      resolveSlot(verse, outcome);
      refreshProgress();
      if (verse.done) { finishRun(); return; }
      showLine(verse.line, outcome !== 'right');
    }
    curSlot = k;
    slotTap = null; judged = null;
  }

  function finishRun() {
    stopSong();
    mode = 'result';
    ctx.avatar.play('cheer');
    const s = starsFor(verse, level.replayLimit);
    const best = ctx.save.recordLevel(level.id, s.stars);
    let newStamp = false;
    if (level.id === 3) newStamp = ctx.save.awardStamp(STAMP_SKILL);
    ctx.sound.play('win');
    stage.hidden = true;
    const p = ctx.panel;
    clear(p);
    const row = (ok, text) => h('li', { class: ok ? 'yes' : 'no' }, icon(ok ? 'check' : 'dash'), h('span', { text: `${text} ${ok ? '(yes)' : '(not yet)'}` }));
    const next = LEVELS.find((l) => l.id === level.id + 1);
    put(p,
      h('h2', { text: `Level ${level.id} cleared` }),
      h('p.result-stars', null, starRow(s.stars), h('span.sr-only', { text: `You got ${s.stars} of 3 stars.` })),
      h('ul.checklist', null,
        row(s.finished, 'Finished the verse.'),
        row(s.withinLimit, `Used ${level.replayLimit} replays or fewer. You used ${s.replays}.`),
        row(s.perfect, 'Every word right and on the beat the first time.'),
      ),
      best > s.stars ? h('p', { text: `Your best for this level is still ${best} stars. A new try never takes stars away.` }) : null,
      h('details.cy-verse', null, h('summary', { text: 'Read the whole verse' }),
        h('ol', null, ...level.lines.map((l) => h('li', { text: `${l.before} ${l.answer}.` })))),
      h('div.actions', null,
        h('button', { type: 'button', onclick: () => { showReady(); } }, h('span', { text: 'Try again' })),
        next ? h('button.primary', { type: 'button', onclick: () => chooseLevel(next) }, h('span', { text: `Next: Level ${next.id}` })) : null,
        h('button', { type: 'button', onclick: showLevelSelect }, h('span', { text: 'All levels' })),
      ),
    );
    announce(`Level ${level.id} cleared. ${s.stars} of 3 stars.`);
    p.querySelector('.actions .primary, .actions button')?.focus();
    if (newStamp) ctx.showStamp(STAMP_SKILL);
  }

  /** The game was paused or the tab was hidden: stop the song and offer to pick up at the same line. */
  function interrupt() {
    if (mode === 'calib') { stopSong(); showCalibration(pendingStart); return; }
    if (mode !== 'play') return;
    stopSong();
    mode = 'paused';
    ctx.avatar.play('idle');
    const p = ctx.panel;
    clear(p);
    const go = h('button.primary', { type: 'button', onclick: () => startRun(true) }, icon('play'), h('span', { text: `Play from line ${verse.line + 1}` }));
    put(p, h('h2', { text: `Level ${level.id}: ${level.title}` }),
      h('p', { text: 'The song stopped because the game was paused. Nothing is lost.' }),
      h('div.actions', null, go, h('button', { type: 'button', onclick: showReady }, h('span', { text: 'Start the verse over' }))));
    go.focus();
  }

  function stopSong() {
    engine.stop();
    soundClock = false;
  }

  // ---------- frame ----------
  function update() {
    const perf = performance.now();
    const gap = perf - lastFrame;
    lastFrame = perf;
    if (gap > maxGap) maxGap = gap;
    // backstop for a frozen tab; slow frames alone are fine because taps carry their own timestamps
    if (gap > 10000 && (mode === 'play' || mode === 'calib')) { interrupt(); return; }
    // if the audio clock never starts (no output device, blocked audio), fall back to the screen clock
    if (soundClock && perf - startPerf > 1500 && engine.songNow() < -LEAD + 0.05) {
      soundClock = false;
      engine.stop();
      if (mode === 'play') setMessage('Sound did not start, so the game is following the moving dots.', null);
    }
    if (mode === 'play') {
      if (soundClock) {
        engine.setMuted(!ctx.sound.on);
        // one second ahead: a slow frame (or a busy Chromebook) cannot starve the beat
        engine.schedule(engine.songNow() + 1.0);
      }
      const t = songNow(perf);
      const k = slotAt(t, bpm);
      if (k > curSlot) enterSlot(k);
      if (mode === 'play') drawTrack(t);
    } else if (mode === 'calib') {
      const t = songNow(perf);
      drawTrack(t);
      if (t > beatTime(CAL_BEATS - 1, CAL_BPM) + 0.6) finishCalibration();
    } else if (mode === 'calibIdle' || mode === 'calibDone' || mode === 'ready') {
      drawTrack(null);
    }
  }

  /**
   * Beat track: dots slide right to left into the tap line. Bar downbeats are
   * bigger dots, the star beat is a star. The tap line pulses softly once per
   * beat (well under 3 pulses a second); with reduced motion it stays still.
   */
  function drawTrack(t) {
    if (!g) return;
    const W = cw, H = chh;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#0f1b3d';
    g.beginPath(); g.roundRect(0, 0, W, H, 12); g.fill();
    const hitX = 72, mid = H / 2, ppb = (W - hitX - 24) / 4.5;
    const tempo = mode === 'play' || mode === 'ready' ? (mode === 'ready' ? level.bpm : bpm) : CAL_BPM;
    const s = spb(tempo);
    // lane
    g.strokeStyle = '#3a4a7a'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(hitX, mid); g.lineTo(W - 8, mid); g.stroke();
    // tap line with a soft pulse
    let pulse = 0;
    if (t !== null && !ctx.reducedMotion && t >= 0) pulse = pulseLevel(t / s);
    g.fillStyle = PULSE[Math.round(pulse * 20)];
    g.fillRect(hitX - 16, 4, 32, H - 8);
    g.strokeStyle = '#ffffff'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(hitX, 6); g.lineTo(hitX, H - 6); g.stroke();
    g.fillStyle = '#ffffff'; g.font = '700 16px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText('TAP', 26, mid + 6);
    if (t === null) return;
    const first = Math.max(0, Math.floor(t / s) - 1), last = Math.ceil(t / s + 5);
    for (let n = first; n <= last; n++) {
      if (mode === 'calib' && n >= CAL_BEATS) break;
      const x = hitX + (n * s - t) / s * ppb;
      if (x < hitX - 18 || x > W - 8) continue;
      const slotBeat = n - COUNT_IN;
      const isStar = mode === 'play' && slotBeat >= 0 && slotBeat % BEATS_PER_SLOT === STAR_BEAT;
      const isTarget = mode === 'calib' && n >= CAL_TAP_FROM;
      if (isStar) {
        g.save(); g.translate(x, mid); g.scale(20, 20);
        g.fillStyle = '#ffcf3f'; g.fill(starPath);
        g.lineWidth = 0.12; g.strokeStyle = '#ffffff'; g.stroke(starPath);
        g.restore();
      } else if (isTarget) {
        g.strokeStyle = '#ffcf3f'; g.lineWidth = 4;
        g.beginPath(); g.arc(x, mid, 13, 0, Math.PI * 2); g.stroke();
      } else {
        const down = mode === 'play' ? (slotBeat >= 0 && slotBeat % 4 === 0) : n % 4 === 0;
        g.fillStyle = n < COUNT_IN && mode === 'play' ? '#9fb3e8' : '#ffffff';
        g.beginPath(); g.arc(x, mid, down ? 8 : 5, 0, Math.PI * 2); g.fill();
      }
    }
    // count-in and feedback words on the track
    g.textAlign = 'left'; g.font = '800 18px system-ui, sans-serif';
    if (mode === 'play' && t < COUNT_IN * s) {
      g.fillStyle = '#ffffff';
      g.fillText(READY[Math.min(3, Math.max(0, Math.floor(t / s)))], hitX + 34, 22);
    } else if (mode === 'calib') {
      const b = Math.floor(t / s);
      g.fillStyle = '#ffffff';
      g.fillText(b < CAL_TAP_FROM ? LISTEN[Math.max(0, b)] : TAPN[Math.min(3, b - CAL_TAP_FROM)], hitX + 34, 22);
    } else if (mode === 'play' && t < feedbackUntil && feedbackText) {
      g.fillStyle = slotTap === 'right' ? '#8ff0c8' : '#ffd0d8';
      g.fillText(feedbackText, hitX + 34, 22);
    }
  }

  function dispose() {
    mode = 'gone';
    if (DEBUG) delete window.__cypher;
    engine.close();
    if (onKey) window.removeEventListener('keydown', onKey);
    if (onVis) document.removeEventListener('visibilitychange', onVis);
    pauseWatch?.disconnect(); pauseWatch = null;
    onKey = onVis = null;
    if (avatarObj) {
      avatarObj.position.set(avatarSaved.x, avatarSaved.y, avatarSaved.z);
      avatarObj.rotation.y = avatarSaved.ry;
      avatarObj = null;
    }
    if (camSaved && ctx) { ctx.camera.position.copy(camSaved.p); ctx.camera.quaternion.copy(camSaved.q); }
    stage?.remove();
    stage = null; canvas = null; g = null; ui = {};
  }

  return { id: 'cypher', title: 'Science Cypher', load, start, update, dispose };
}
