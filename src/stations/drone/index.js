import * as THREE from 'three';
import { h, clear, announce } from '../../ui/dom.js';
import { fitBox, inBox } from '../../ui/layout.js';
import { icon, starRow } from '../../ui/icons.js';
import { createBlockQueue } from '../../ui/blockQueue.js';
import { LEVELS, STAMP_SKILL } from './levels.js';
import { runProgram, missMessage, REPEAT_MIN, REPEAT_MAX } from './interpreter.js';
import { starsFor } from './stars.js';
import { createBoard } from './board.js';

/**
 * Drone Dash station module. Same interface as every station:
 * { id, title, load(ctx), start(ctx), update(dt), dispose() }.
 * @typedef {import('../registry.js').StationContext} StationContext
 */

const PALETTE = [
  { type: 'takeoff', label: 'Take off' },
  { type: 'forward', label: 'Forward' },
  { type: 'left', label: 'Turn left' },
  { type: 'right', label: 'Turn right' },
  { type: 'land', label: 'Land' },
  { type: 'repeat', label: 'Repeat', container: true },
];

/** Hub objects hidden while the board is up: the parked drones, the real
 * pads (they do not match the level layout) and the nets between camera and floor. */
const HIDE = ['DR_A_Rig', 'DR_B_Rig', 'DR_C_Rig', 'MCB_Pad0', 'MCB_Pad1', 'MCB_Pad2',
  'CAGE_NetTop', 'CAGE_NetS_L', 'CAGE_NetS_R', 'CAGE_NetS_Top', 'CAGE_DoorTop', 'CAGE_DoorPost0', 'CAGE_DoorPost1',
  'MCB_CageBeam-1.95', 'MCB_CageBeam-4.45', 'MCB_CageBeamX4.3', 'MCB_CageBeamX6.9', 'MCB_CagePost4.3-4.45', 'MCB_CagePost6.9-4.45'];

const ALT = 0.75;          // flight height, metres
const BOARD_PITCH = 66 * Math.PI / 180;

export default function createDroneDash() {
  /** @type {StationContext} */ let ctx;
  /** @type {ReturnType<typeof createBoard>} */ let board;
  /** @type {THREE.Object3D} */ let drone;
  /** @type {THREE.Object3D[]} */ let props = [];
  let shadow, nose;
  let level = LEVELS[0];
  /** @type {ReturnType<typeof createBlockQueue>|null} */ let queue = null;
  let ui = {};
  // playback state
  let anim = null;
  let lastRun = null;
  let propSpeed = 4;
  const pose = { c: 2, r: 4, dir: 0, alt: 0 };
  const from = { x: 0, z: 0, y: 0, yaw: 0 };
  const to = { x: 0, z: 0, y: 0, yaw: 0 };
  const tmp = new THREE.Vector3();
  let camTween = null;
  const camFromPos = new THREE.Vector3(), camToPos = new THREE.Vector3();
  const camFromQ = new THREE.Quaternion(), camToQ = new THREE.Quaternion();
  let center;

  const yawFor = (dir) => -dir * Math.PI / 2;
  /** append, skipping null and false (native append would print "null") */
  const put = (el, ...kids) => el.append(...kids.filter(Boolean));

  function placeDrone(c, r, dir, alt) {
    board.cellToWorld(c, r, alt + 0.06, tmp);
    drone.position.copy(tmp);
    drone.rotation.y = yawFor(dir);
    board.cellToWorld(c, r, 0.045, shadow.position);
    pose.c = c; pose.r = r; pose.dir = dir; pose.alt = alt;
  }

  // ---------- 3D setup ----------
  async function load(c) {
    ctx = c;
    // Cage floor centre from the nets, which bound the cage exactly.
    if (ctx.hub.get('CAGE_NetW') && ctx.hub.get('CAGE_NetE') && ctx.hub.get('CAGE_NetN') && ctx.hub.get('CAGE_NetS_L')) {
      const w = ctx.hub.pos('CAGE_NetW'), e = ctx.hub.pos('CAGE_NetE'), n = ctx.hub.pos('CAGE_NetN'), s = ctx.hub.pos('CAGE_NetS_L');
      center = new THREE.Vector3((w.x + e.x) / 2, ctx.hub.pos('drone_start').y, (n.z + s.z) / 2);
    } else {
      center = ctx.hub.pos('station_drone').add(new THREE.Vector3(0, 0, -2));
    }
    board = createBoard(center);

    const gltf = await ctx.loadGLTF('assets/drone.glb');
    drone = new THREE.Group();
    drone.name = 'dd_drone';
    const model = gltf.scene;
    model.scale.setScalar(0.85);
    drone.add(model);
    props = [];
    model.traverse((o) => {
      if (/^drone_prop_/.test(o.name)) { o.userData.spinDir = o.userData.spin || 1; props.push(o); }
      if (o.isMesh && o.material) o.material = new THREE.MeshLambertMaterial({ color: o.material.color, map: o.material.map || null });
    });
    // Nose arrow so the facing direction reads from above, in shape and colour.
    const ng = new THREE.ConeGeometry(0.07, 0.2, 3);
    ng.rotateX(-Math.PI / 2);
    nose = new THREE.Mesh(ng, new THREE.MeshBasicMaterial({ color: 0xffcf3f }));
    nose.position.set(0, 0.07, -0.25);
    drone.add(nose);
    // Floor marker under the drone: ring plus an arrow, so its cell is clear.
    shadow = new THREE.Group();
    const ringM = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.21, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false }));
    ringM.rotation.x = -Math.PI / 2;
    shadow.add(ringM);
    shadow.renderOrder = 2;
  }

  /**
   * Frame the board in the part of the screen the panel leaves free.
   * Finds the closest distance (along a fixed downward view) at which all
   * four board corners, plus a margin, project inside the view.
   */
  function cameraTarget() {
    const cam = ctx.camera;
    const savedP = cam.position.clone(), savedQ = cam.quaternion.clone();
    const look = center.clone();
    const dir = new THREE.Vector3(0, Math.sin(BOARD_PITCH), Math.cos(BOARD_PITCH));
    const half = 1.25 + 0.2;
    const corners = [[-half, -half], [half, -half], [half, half], [-half, half]].map(([x, z]) => new THREE.Vector3(look.x + x, look.y, look.z + z));
    const v = new THREE.Vector3();
    const box = fitBox(ctx.viewport(), 0.94, 0.92);
    const fits = (d) => {
      cam.position.copy(look).addScaledVector(dir, d);
      cam.lookAt(look);
      cam.updateMatrixWorld(true);
      return corners.every((c) => { v.copy(c).project(cam); return inBox(v, box); });
    };
    let lo = 1.5, hi = 14;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi);
    camToPos.copy(cam.position);
    camToQ.copy(cam.quaternion);
    cam.position.copy(savedP); cam.quaternion.copy(savedQ); cam.updateMatrixWorld(true);
  }

  function start(c) {
    ctx = c;
    ctx.hub.setVisible(HIDE, false);
    ctx.scene.add(board.mesh, drone, shadow);
    cameraTarget();
    camFromPos.copy(ctx.camera.position);
    camFromQ.copy(ctx.camera.quaternion);
    if (ctx.reducedMotion) { ctx.camera.position.copy(camToPos); ctx.camera.quaternion.copy(camToQ); camTween = null; }
    else camTween = { t: 0, dur: 0.9 };
    ctx.onResize(() => { cameraTarget(); if (!camTween) { ctx.camera.position.copy(camToPos); ctx.camera.quaternion.copy(camToQ); } });
    const firstOpen = LEVELS.find((l) => ctx.save.levelStars(l.id) === 0) || LEVELS[0];
    showLevel(isUnlocked(firstOpen.id) ? firstOpen : LEVELS[0], true);
    showLevelSelect();
  }

  const isUnlocked = (id) => id === 1 || ctx.save.levelStars(id - 1) > 0;

  // ---------- panels ----------
  function showLevelSelect() {
    stopAnim();
    const p = ctx.panel;
    clear(p);
    p.append(
      h('h2', { text: 'Drone Dash' }),
      h('p', { text: 'Build a program out of blocks. Press Run and watch the drone fly it. Land on the pad to clear a level.' }),
    );
    const list = h('ul.level-list');
    for (const l of LEVELS) {
      const stars = ctx.save.levelStars(l.id);
      const open = isUnlocked(l.id);
      list.append(h('li', null,
        h('button.level-card', { type: 'button', disabled: !open, 'data-level': l.id, onclick: () => { showLevel(l); showPlay(); } },
          h('span.level-name', { text: `Level ${l.id}: ${l.title}` }),
          h('span.level-goal', { text: open ? l.goal : `Clear level ${l.id - 1} to open this level.` }),
          open ? starRow(stars) : h('span.level-lock', null, icon('lock'), h('span', { text: 'Locked' })),
        )));
    }
    p.append(list);
    if (ctx.save.hasStamp()) p.append(h('p.stamp-note', null, icon('stamp'), h('span', { text: `Stamp earned: ${STAMP_SKILL}.` })));
    p.querySelector('.level-card:not([disabled])')?.focus();
  }

  function showLevel(l, quiet = false) {
    level = l;
    lastRun = null;
    placeDrone(l.start.c, l.start.r, l.start.dir, 0);
    propSpeed = 4;
    board.draw({ level, path: [], fail: null });
    if (!quiet) announce(`Level ${l.id}. ${l.goal}`);
  }

  function showPlay() {
    const p = ctx.panel;
    clear(p);
    queue = createBlockQueue({
      palette: PALETTE.filter((b) => level.blocks.includes(b.type)),
      limit: level.limit,
      repeatMin: REPEAT_MIN,
      repeatMax: REPEAT_MAX,
      onChange: () => { setMessage('', null); },
    });
    ui.message = h('div.message', { role: 'status' });
    ui.run = h('button.primary.run', { type: 'button', onclick: () => run() }, icon('play'), h('span', { text: 'Run' }));
    ui.stop = h('button.stop', { type: 'button', hidden: true, onclick: () => stopRun() }, icon('stop'), h('span', { text: 'Stop' }));
    ui.replay = h('button', { type: 'button', hidden: true, onclick: () => replay() }, h('span', { text: 'Watch again' }));
    ui.clearBtn = h('button', { type: 'button', onclick: () => { queue.clear(); resetBoard(); queue.el.querySelector('.block')?.focus(); } }, h('span', { text: 'Clear' }));
    put(p,
      h('div.panel-head', null,
        h('button.link', { type: 'button', onclick: () => showLevelSelect() }, icon('back'), h('span', { text: 'Levels' })),
        h('h2', { text: `Level ${level.id}: ${level.title}` })),
      h('p.goal', null, h('strong', { text: 'Goal: ' }), level.goal),
      h('p.limit', { text: `Block limit: ${level.limit}. Use ${level.limit} blocks or fewer for two stars.` }),
      level.id === 3 ? h('p.tip', { text: 'Tip: Repeat runs the blocks inside it again. A Repeat counts as one block, plus the blocks inside it.' }) : null,
      queue.el,
      h('div.actions', null, ui.run, ui.stop, ui.clearBtn, ui.replay),
      ui.message,
    );
    p.querySelector('.block')?.focus();
  }

  function setMessage(text, kind) {
    if (!ui.message) return;
    clear(ui.message);
    ui.message.className = 'message' + (kind ? ` ${kind}` : '');
    if (!text) return;
    ui.message.append(icon(kind === 'miss' ? 'warn' : kind === 'win' ? 'check' : 'now'), h('span', { text }));
  }

  function resetBoard() {
    stopAnim();
    lastRun = null;
    placeDrone(level.start.c, level.start.r, level.start.dir, 0);
    board.draw({ level, path: [], fail: null });
    queue?.setError(null);
    setMessage('', null);
    if (ui.replay) ui.replay.hidden = true;
  }

  // ---------- running ----------
  function run() {
    if (!queue || anim) return;
    const program = queue.getProgram();
    const result = runProgram(program, level);
    if (result.reason === 'empty') { setMessage(missMessage('empty', level), 'miss'); ctx.sound.play('miss'); return; }
    lastRun = result;
    play(result, false);
  }

  function replay() { if (lastRun && !anim) play(lastRun, true); }

  function play(result, isReplay) {
    queue.setError(null);
    queue.setLocked(true);
    ui.run.hidden = true; ui.stop.hidden = false; ui.replay.hidden = true; ui.clearBtn.disabled = true;
    setMessage(isReplay ? 'Watching the last run again.' : 'Running your program.', null);
    placeDrone(level.start.c, level.start.r, level.start.dir, 0);
    board.draw({ level, path: [], fail: null });
    anim = { result, i: -1, t: 0, dur: 0, path: [{ c: level.start.c, r: level.start.r }], phase: 'steps', isReplay };
    nextStep();
  }

  function stepDur() { return ctx.reducedMotion ? 0.3 : 0.55; }

  function nextStep() {
    const a = anim;
    a.i++;
    const step = a.result.steps[a.i];
    if (!step) { finishRun(); return; }
    queue.setCurrent(step.id);
    from.x = drone.position.x; from.y = drone.position.y; from.z = drone.position.z; from.yaw = drone.rotation.y;
    board.cellToWorld(step.c, step.r, (step.flying ? ALT : 0) + 0.06, tmp);
    to.x = tmp.x; to.y = tmp.y; to.z = tmp.z;
    let targetYaw = yawFor(step.dir);
    let d = targetYaw - from.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    to.yaw = from.yaw + d;
    a.t = 0; a.dur = step.event === 'noop' ? stepDur() * 0.5 : stepDur();
    a.bump = step.event === 'fail' && a.result.reason === 'net';
    if (step.event === 'move') ctx.sound.play('step');
    else if (step.event === 'turn') ctx.sound.play('turn');
    else if (step.event === 'takeoff') { ctx.sound.play('up'); propSpeed = 30; }
    else if (step.event === 'land') ctx.sound.play('down');
    if (step.event === 'move') { a.path.push({ c: step.c, r: step.r }); }
    a.step = step;
  }

  function endStepVisual() {
    const s = anim.step;
    pose.c = s.c; pose.r = s.r; pose.dir = s.dir;
    if (s.event === 'move') board.draw({ level, path: anim.path, fail: null });
    if (s.event === 'land') propSpeed = 4;
  }

  function finishRun() {
    const a = anim;
    const res = a.result;
    queue.setCurrent(null);
    if (res.cleared) {
      anim = null;
      unlockUi();
      ctx.sound.play('win');
      if (!a.isReplay) onClear(res);
      else { setMessage('That was your last run.', 'win'); ui.replay.hidden = false; }
      return;
    }
    // Miss: keep the path, mark the block, then float back to the start.
    const last = res.steps[res.steps.length - 1];
    const failStep = res.steps.findLast ? res.steps.findLast((s) => s.id === res.failId) : last;
    const fs = failStep || last;
    board.draw({ level, path: a.path, fail: fs ? { c: fs.c, r: fs.r, dir: fs.dir, kind: res.reason === 'net' ? 'net' : 'here' } : null });
    queue.setError(res.failId);
    ctx.sound.play('miss');
    setMessage(missMessage(res.reason, level) + ' The path stays on the board. Fix the marked block and run again.', 'miss');
    announce(missMessage(res.reason, level));
    if (ctx.reducedMotion) {
      placeDrone(level.start.c, level.start.r, level.start.dir, 0);
      anim = null; propSpeed = 4; unlockUi(); ui.replay.hidden = false;
      return;
    }
    a.phase = 'float';
    a.t = 0; a.dur = 1.4;
    from.x = drone.position.x; from.y = drone.position.y; from.z = drone.position.z; from.yaw = drone.rotation.y;
    board.cellToWorld(level.start.c, level.start.r, 0.06, tmp);
    to.x = tmp.x; to.y = tmp.y; to.z = tmp.z; to.yaw = yawFor(level.start.dir);
  }

  function unlockUi() {
    queue.setLocked(false);
    ui.run.hidden = false; ui.stop.hidden = true; ui.clearBtn.disabled = false;
    ui.run.focus();
  }

  function stopRun() {
    if (!anim) return;
    stopAnim();
    placeDrone(level.start.c, level.start.r, level.start.dir, 0);
    board.draw({ level, path: [], fail: null });
    queue.setCurrent(null);
    unlockUi();
    setMessage('Stopped. The drone is back at the start.', null);
  }

  function stopAnim() { anim = null; propSpeed = 4; }

  function onClear(res) {
    const s = starsFor(res, level);
    const before = ctx.save.levelStars(level.id);
    const best = ctx.save.recordLevel(level.id, s.stars);
    let newStamp = false;
    if (level.id === 3) newStamp = ctx.save.awardStamp(STAMP_SKILL);
    ctx.avatar.play('cheer');
    showResult(s, res.blocks, best, before);
    if (newStamp) ctx.showStamp(STAMP_SKILL);
  }

  function showResult(s, blocks, best, before) {
    const p = ctx.panel;
    clear(p);
    const row = (ok, text) => h('li', { class: ok ? 'yes' : 'no' }, icon(ok ? 'check' : 'dash'), h('span', { text: `${text} ${ok ? '(yes)' : '(not yet)'}` }));
    const next = LEVELS.find((l) => l.id === level.id + 1);
    put(p,
      h('h2', { text: `Level ${level.id} cleared` }),
      h('p.result-stars', null, starRow(s.stars), h('span.sr-only', { text: `You got ${s.stars} of 3 stars.` })),
      h('ul.checklist', null,
        row(s.landed, `Landed on Pad ${level.targetPad}.`),
        row(s.withinLimit, `Used ${level.limit} blocks or fewer. You used ${blocks}.`),
        row(s.shortest, `Matched the shortest program, ${level.shortest} blocks.`),
      ),
      best > s.stars ? h('p', { text: `Your best for this level is still ${best} stars. A new try never takes stars away.` }) : null,
      !s.shortest ? h('p.tip', { text: `Want three stars? The shortest program uses ${level.shortest} blocks.` }) : null,
      h('div.actions', null,
        h('button', { type: 'button', onclick: () => { const prog = queue.getProgram(); showPlay(); queue.setProgram(prog); resetBoard(); } }, h('span', { text: 'Try again' })),
        next ? h('button.primary', { type: 'button', onclick: () => { showLevel(next); showPlay(); } }, h('span', { text: `Next: Level ${next.id}` })) : null,
        h('button', { type: 'button', onclick: () => showLevelSelect() }, h('span', { text: 'All levels' })),
      ),
    );
    announce(`Level ${level.id} cleared. ${s.stars} of 3 stars.`);
    p.querySelector('.actions .primary, .actions button')?.focus();
  }

  // ---------- frame update ----------
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  function update(dt) {
    if (!drone) return;
    const spin = (ctx.reducedMotion ? 0.4 : 1) * propSpeed * dt;
    for (const pr of props) pr.rotation.y += spin * pr.userData.spinDir;

    if (camTween) {
      camTween.t += dt;
      const k = ease(Math.min(1, camTween.t / camTween.dur));
      ctx.camera.position.lerpVectors(camFromPos, camToPos, k);
      ctx.camera.quaternion.slerpQuaternions(camFromQ, camToQ, k);
      if (k >= 1) camTween = null;
    }

    const a = anim;
    if (!a) return;
    a.t += dt;
    const k = Math.min(1, a.t / a.dur);
    const e = ctx.reducedMotion ? k : ease(k);
    if (a.phase === 'steps') {
      if (a.bump) {
        // fly half a cell toward the net and bounce back
        const out = Math.sin(k * Math.PI) * 0.22;
        const dir = a.step.dir;
        drone.position.set(from.x + [0, 1, 0, -1][dir] * out, from.y, from.z + [-1, 0, 1, 0][dir] * out);
      } else {
        drone.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e, from.z + (to.z - from.z) * e);
        drone.rotation.y = from.yaw + (to.yaw - from.yaw) * e;
      }
      shadow.position.set(drone.position.x, shadow.position.y, drone.position.z);
      if (k >= 1) { endStepVisual(); nextStep(); }
    } else if (a.phase === 'float') {
      drone.position.set(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e + Math.sin(k * Math.PI) * 0.3, from.z + (to.z - from.z) * e);
      drone.rotation.y = from.yaw + (to.yaw - from.yaw) * e;
      shadow.position.set(drone.position.x, shadow.position.y, drone.position.z);
      if (k >= 1) {
        placeDrone(level.start.c, level.start.r, level.start.dir, 0);
        anim = null; propSpeed = 4;
        unlockUi();
        ui.replay.hidden = false;
      }
    }
  }

  function dispose() {
    anim = null; camTween = null;
    if (ctx) {
      ctx.hub.setVisible(HIDE, true);
      ctx.scene.remove(board?.mesh, drone, shadow);
    }
    board?.dispose();
    drone?.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    shadow?.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    queue = null; ui = {};
  }

  return { id: 'drone', title: 'Drone Dash', load, start, update, dispose };
}
