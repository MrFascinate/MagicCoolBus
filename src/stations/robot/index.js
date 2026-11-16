import * as THREE from 'three';
import './robot.css';
import { h, clear, announce } from '../../ui/dom.js';
import { icon, starRow } from '../../ui/icons.js';
import { createBlockQueue } from '../../ui/blockQueue.js';
import { LEVELS, STAMP_SKILL, PARTS, BINS, TRAY } from './levels.js';
import { runProgram, missMessage, initialState } from './interpreter.js';
import { starsFor } from './stars.js';
import { createMap } from './map.js';
import { ARM, HEIGHTS, CARRY_R, solveIK, sweep, angleDiff } from './arm.js';

/**
 * Robot Relay station module. Same interface as every station:
 * { id, title, load(ctx), start(ctx), update(dt), dispose() }.
 * @typedef {import('../registry.js').StationContext} StationContext
 */

const PALETTE = [
  { type: 'left', label: 'Rotate left', icon: 'rotL' },
  { type: 'right', label: 'Rotate right', icon: 'rotR' },
  { type: 'reach', label: 'Reach', icon: 'reach' },
  { type: 'grip', label: 'Grip', icon: 'grip' },
  { type: 'release', label: 'Release', icon: 'release' },
];

/** The hub's static arm and props, hidden while robot.glb is in their place,
 * plus the side canopy, which sits right where the station camera looks down from. */
const HIDE = ['RB_J1', 'RB_Base', 'RB_Part', 'RB_Bin1', 'RB_Bin2', 'RB_Bin3', 'RB_Barrier',
  'MCB_SideCanopy', 'MCB_CanopyLight0', 'MCB_CanopyLight1', 'MCB_CanopyLight2', 'MCB_CanopyLight3', 'MCB_Logo_Canopy'];

const SLOT_STEP = 0.07;        // spacing of parts on the tray (m)
const BIN_FLOOR = 0.012;       // part height when resting in a bin
const BARRIER_R = 0.34;        // barrier centre distance from the arm
const BARRIER_MARGIN = 0.21;   // radians short of the barrier centre where the arm touches it
const STEP_GAP = 0.08;
const PITCH = 18 * Math.PI / 180; // camera looks down this much

export default function createRobotRelay() {
  /** @type {StationContext} */ let ctx;
  let gltfScene = null;
  /** @type {THREE.Group} */ let rig;
  const n = {};                       // arm nodes
  /** @type {Record<string, THREE.Object3D>} */ const partObj = {};
  /** @type {Record<string, THREE.Object3D>} */ const binObj = {};
  /** @type {Record<string, THREE.MeshLambertMaterial[]>} */ const binMats = {};
  let barrier = null; let barrierMats = [];
  const stopPt = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const stopYaw = [0, 0, 0, 0];
  const stopR = [0, 0, 0, 0];
  const trayC = new THREE.Vector3();
  /** @type {THREE.Object3D[]} */ const trayPieces = [];
  let trayGripY = HEIGHTS.trayGrip;
  let barrierMid = 0;
  let level = LEVELS[0];
  /** @type {ReturnType<typeof createBlockQueue>|null} */ let queue = null;
  /** @type {ReturnType<typeof createMap>|null} */ let map = null;
  let ui = {};
  let lastRun = null;
  // arm pose: turret yaw, shoulder, elbow, wrist, grip opening
  const q = { yaw: 0, s: 0, e: 0, w: 0, g: ARM.gripOpen };
  const qFrom = { yaw: 0, s: 0, e: 0, w: 0, g: 0 };
  // playback
  let seq = null;
  let flash = { bin: 0, barrier: 0, t: 0 };
  // camera
  let camTween = null;
  const camFromPos = new THREE.Vector3(), camToPos = new THREE.Vector3();
  const camFromQ = new THREE.Quaternion(), camToQ = new THREE.Quaternion();

  const put = (el, ...kids) => el.append(...kids.filter(Boolean));
  const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  // ---------- 3D ----------
  async function load(c) {
    ctx = c;
    const gltf = await ctx.loadGLTF('assets/robot/robot.glb');
    gltfScene = gltf.scene;
    const lam = new Map();
    gltfScene.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material;
      o.material = new THREE.MeshLambertMaterial({ color: m.color, map: m.map || null, emissive: m.emissive || new THREE.Color(0), emissiveIntensity: 1 });
      lam.set(m, true);
    });
    for (const m of lam.keys()) m.dispose();
    const get = (name) => gltfScene.getObjectByName(name);
    for (const k of ['arm_root', 'arm_turret', 'arm_shoulder', 'arm_elbow', 'arm_wrist', 'grip_L', 'grip_R']) n[k] = get(k);
    if (!n.arm_root) throw new Error('robot.glb has no arm_root');

    const base = ctx.hub.pos('arm_base');
    rig = new THREE.Group();
    rig.name = 'rr_rig';
    rig.position.copy(base);
    rig.add(n.arm_root);
    for (const [shape, p] of Object.entries(PARTS)) {
      const o = get(p.node);
      if (o) { rig.add(o); o.visible = false; partObj[shape] = o; }
    }
    for (const [kind, b] of Object.entries(BINS)) {
      const o = get(b.node);
      if (!o) continue;
      rig.add(o);
      binObj[kind] = o;
      const mats = [];
      o.traverse((m) => { if (m.isMesh) mats.push(m.material); });
      binMats[kind] = mats;
    }
    barrier = get('barrier');
    if (barrier) {
      rig.add(barrier);
      barrier.traverse((m) => { if (m.isMesh) barrierMats.push(m.material); });
    }

    // Stops, in the rig's frame.
    trayC.copy(ctx.hub.pos('part_tray')).sub(base);
    // RB_Tray: keep its dark plate, hide the small modelled pieces on it while the station is open.
    trayPieces.length = 0;
    const tray = ctx.hub.get('RB_Tray');
    if (tray) {
      tray.updateMatrixWorld(true);
      tray.traverse((o) => {
        if (!o.isMesh) return;
        if (/RB_Dark/.test(o.material?.name || '')) {
          const box = new THREE.Box3().setFromObject(o);
          trayC.y = Math.max(trayC.y, box.max.y - base.y); // parts rest on the plate
        } else trayPieces.push(o);
      });
    }
    trayGripY = trayC.y + 0.01;
    slotPos(0, stopPt[0]);
    for (let i = 1; i <= 3; i++) stopPt[i].copy(ctx.hub.pos(`bin_${i}`)).sub(base);
    for (let i = 0; i < 4; i++) { stopYaw[i] = Math.atan2(stopPt[i].x, stopPt[i].z); stopR[i] = Math.hypot(stopPt[i].x, stopPt[i].z); }
    // The barrier sits half way along the turn it blocks (Bin 3 round to the tray),
    // where the arm sweeps through it. See SOURCES in the report.
    barrierMid = stopYaw[3] + sweep(stopYaw, 3, 0, 1) / 2;
    if (barrier) {
      barrier.position.set(Math.sin(barrierMid) * BARRIER_R, 0, Math.cos(barrierMid) * BARRIER_R);
      barrier.rotation.set(0, barrierMid - Math.PI / 2, 0);
      barrier.scale.set(1.3, 3.0, 1.6); // about 0.39 m tall: the gripper cannot pass over it
    }
  }

  /** Position of tray slot i (0 = pickup spot, nearest the arm). */
  function slotPos(i, out) {
    return out.set(trayC.x + SLOT_STEP - SLOT_STEP * i, trayC.y, trayC.z);
  }

  function applyPose() {
    n.arm_turret.rotation.y = q.yaw;
    n.arm_shoulder.rotation.x = q.s;
    n.arm_elbow.rotation.x = q.e;
    n.arm_wrist.rotation.x = q.w;
    n.grip_L.position.x = q.g;
    n.grip_R.position.x = -q.g;
  }

  /** Joint target for a stop. down: at work height; else the carry pose. */
  function poseAt(stop, down, out) {
    const r = down ? stopR[stop] : Math.min(stopR[stop], CARRY_R);
    const y = down ? (stop === TRAY ? trayGripY : HEIGHTS.binRelease) : HEIGHTS.carry;
    const sol = solveIK(r, y) || solveIK(Math.min(r, 0.7), y);
    out.yaw = q.yaw + angleDiff(q.yaw, stopYaw[stop]);
    out.s = sol.s; out.e = sol.e; out.w = sol.w;
    return out;
  }

  /** Put arm and parts in a level's start state, with no animation. */
  function resetScene() {
    seq = null;
    flash.bin = 0; flash.barrier = 0;
    for (const o of Object.values(partObj)) { rig.attach(o); o.visible = false; o.rotation.set(0, 0, 0); }
    level.parts.forEach((p, i) => { const o = partObj[p]; o.visible = true; slotPos(i, o.position); });
    level.bins.forEach((k, i) => { const o = binObj[k]; if (o) o.position.copy(stopPt[i + 1]).setY(0); });
    if (barrier) barrier.visible = level.barrier;
    q.yaw = stopYaw[0];
    const t = poseAt(TRAY, false, {});
    q.s = t.s; q.e = t.e; q.w = t.w; q.g = ARM.gripOpen;
    applyPose();
    setGlow(0, 0);
    map?.draw(initialState(level));
  }

  function setGlow(binLevel, barrierLevel) {
    level.bins.forEach((k, i) => {
      const on = flash.bin === i + 1 ? binLevel : 0;
      for (const m of binMats[k] || []) { m.emissive.setRGB(on, on * 0.15, on * 0.25); }
    });
    for (const m of barrierMats) m.emissive.setRGB(barrierLevel, 0, 0);
  }

  /** Frame tray, bins, barrier and arm in the view the panel leaves free. */
  function cameraTarget() {
    const cam = ctx.camera;
    const savedP = cam.position.clone(), savedQ = cam.quaternion.clone();
    const pts = [];
    const add = (v, dy = 0) => pts.push(new THREE.Vector3(v.x, v.y + dy, v.z).add(rig.position));
    for (let i = 0; i < 4; i++) { add(stopPt[i], -0.02); add(stopPt[i], 0.12); }
    add(new THREE.Vector3(0, 0, 0), 0.85);
    if (level.barrier && barrier) { add(barrier.position, 0.4); add(barrier.position, 0); }
    const look = new THREE.Vector3();
    for (const p of pts) look.add(p);
    look.divideScalar(pts.length);
    // Look in from the open side of the bay, the same side as cam_robot, but
    // flatter (about 18 degrees down) so the bus roof edge does not hide the arm.
    const pose = ctx.hub.camPose('robot');
    const side = pose.position.clone().sub(look).setY(0);
    if (side.lengthSq() < 1e-6) side.set(0, 0, 1);
    side.normalize();
    const dir = side.multiplyScalar(Math.cos(PITCH)).setY(Math.sin(PITCH)).normalize();
    const v = new THREE.Vector3();
    const fits = (d) => {
      cam.position.copy(look).addScaledVector(dir, d);
      cam.lookAt(look);
      cam.updateMatrixWorld(true);
      return pts.every((p) => { v.copy(p).project(cam); return Math.abs(v.x) <= 0.86 && Math.abs(v.y) <= 0.8 && v.z < 1; });
    };
    let lo = 0.6, hi = 10;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    fits(hi);
    camToPos.copy(cam.position);
    camToQ.copy(cam.quaternion);
    cam.position.copy(savedP); cam.quaternion.copy(savedQ); cam.updateMatrixWorld(true);
  }

  function start(c) {
    ctx = c;
    ctx.hub.setVisible(HIDE, false);
    for (const o of trayPieces) o.visible = false;
    ctx.scene.add(rig);
    const firstOpen = LEVELS.find((l) => ctx.save.levelStars(l.id) === 0) || LEVELS[0];
    level = isUnlocked(firstOpen.id) ? firstOpen : LEVELS[0];
    resetScene();
    cameraTarget();
    camFromPos.copy(ctx.camera.position);
    camFromQ.copy(ctx.camera.quaternion);
    if (ctx.reducedMotion) { ctx.camera.position.copy(camToPos); ctx.camera.quaternion.copy(camToQ); camTween = null; }
    else camTween = { t: 0, dur: 0.9 };
    ctx.onResize(() => { cameraTarget(); if (!camTween) { ctx.camera.position.copy(camToPos); ctx.camera.quaternion.copy(camToQ); } });
    showLevelSelect();
  }

  const isUnlocked = (id) => id === 1 || ctx.save.levelStars(id - 1) > 0;

  // ---------- panels ----------
  function showLevelSelect() {
    seq = null;
    const p = ctx.panel;
    clear(p);
    p.classList.add('rr');
    p.classList.remove('rr-play');
    p.append(
      h('h2', { text: 'Robot Relay' }),
      h('p', { text: 'Plan the robot arm\'s moves with blocks. Press Run and watch it sort parts into the bins. Each part goes in the bin with the same shape icon.' }),
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

  function showLevel(l) {
    level = l;
    lastRun = null;
    map = createMap(level);
    resetScene();
    cameraTarget();
    if (!camTween) { ctx.camera.position.copy(camToPos); ctx.camera.quaternion.copy(camToQ); }
    else { camFromPos.copy(ctx.camera.position); camFromQ.copy(ctx.camera.quaternion); camTween.t = 0; }
    announce(`Level ${l.id}. ${l.goal}`);
  }

  function showPlay() {
    const p = ctx.panel;
    clear(p);
    queue = createBlockQueue({
      palette: PALETTE,
      limit: level.limit,
      maxBlocks: 32,
      onChange: () => setMessage('', null),
    });
    ui.message = h('div.message', { role: 'status' });
    ui.run = h('button.primary.run', { type: 'button', onclick: () => run() }, icon('play'), h('span', { text: 'Run' }));
    ui.stop = h('button.stop', { type: 'button', hidden: true, onclick: () => stopRun() }, icon('stop'), h('span', { text: 'Stop' }));
    ui.replay = h('button', { type: 'button', hidden: true, onclick: () => replay() }, h('span', { text: 'Watch again' }));
    ui.clearBtn = h('button', { type: 'button', onclick: () => { queue.clear(); resetAfterEdit(); queue.el.querySelector('.block')?.focus(); } }, h('span', { text: 'Clear' }));
    // The program scrolls on its own; the Run controls sit below it, never on top of it.
    p.classList.add('rr-play');
    const scroller = h('div.rr-scroll');
    put(scroller,
      h('div.panel-head', null,
        h('button.link', { type: 'button', onclick: () => showLevelSelect() }, icon('back'), h('span', { text: 'Levels' })),
        h('h2', { text: `Level ${level.id}: ${level.title}` })),
      h('p.goal', null, h('strong', { text: 'Goal: ' }), level.goal),
      h('p.limit', { text: `Move budget: ${level.limit}. Use ${level.limit} moves or fewer for two stars.` }),
      map.el,
      level.id === 1 ? h('p.tip', { text: 'Tip: Reach lowers the gripper. After Grip or Release, the arm lifts by itself.' }) : null,
      level.id === 3 ? h('p.tip', { text: 'Tip: The arm cannot turn through the barrier. Go the long way around.' }) : null,
      queue.el,
    );
    p.append(scroller, h('div.rr-foot', null, ui.message, h('div.actions', null, ui.run, ui.stop, ui.clearBtn, ui.replay)));
    map.draw(initialState(level));
    p.querySelector('.block')?.focus();
  }

  function resetAfterEdit() {
    seq = null; lastRun = null;
    resetScene();
    queue?.setError(null);
    setMessage('', null);
    if (ui.replay) ui.replay.hidden = true;
  }

  function setMessage(text, kind) {
    if (!ui.message) return;
    clear(ui.message);
    ui.message.className = 'message' + (kind ? ` ${kind}` : '');
    if (!text) return;
    ui.message.append(icon(kind === 'miss' ? 'warn' : kind === 'win' ? 'check' : 'now'), h('span', { text }));
  }

  // ---------- running ----------
  function run() {
    if (!queue || seq) return;
    const result = runProgram(queue.getProgram(), level);
    if (result.reason === 'empty') { setMessage(missMessage(result, level), 'miss'); ctx.sound.play('miss'); return; }
    lastRun = result;
    play(result, false);
  }

  function replay() { if (lastRun && !seq) play(lastRun, true); }

  function play(result, isReplay) {
    queue.setError(null);
    queue.setLocked(true);
    ui.run.hidden = true; ui.stop.hidden = false; ui.replay.hidden = true; ui.clearBtn.disabled = true;
    setMessage(isReplay ? 'Watching the last run again.' : 'Running your program.', null);
    resetScene();
    const segs = [];
    for (const step of result.steps) segs.push(...stepSegs(step));
    seq = { segs, i: 0, t: 0, started: false, result, isReplay };
  }

  /** A segment: begin() once, tick(k) each frame with k in 0..1, end() once. */
  function seg(dur, tick, begin, end) { return { dur, tick, begin, end }; }

  function poseSeg(target, dur, extra) {
    return seg(dur, (k) => {
      q.yaw = qFrom.yaw + (target.yaw - qFrom.yaw) * k;
      q.s = qFrom.s + (target.s - qFrom.s) * k;
      q.e = qFrom.e + (target.e - qFrom.e) * k;
      q.w = qFrom.w + (target.w - qFrom.w) * k;
      applyPose();
      extra?.(k);
    }, () => { qFrom.yaw = q.yaw; qFrom.s = q.s; qFrom.e = q.e; qFrom.w = q.w; });
  }

  function gripSeg(to, dur, end) {
    let g0 = 0;
    return seg(dur, (k) => { q.g = g0 + (to - g0) * k; applyPose(); }, () => { g0 = q.g; }, end);
  }

  /** Slide tray parts to their slots for a tray line. */
  function slideSeg(tray, dur) {
    const from = [], to = [];
    return seg(dur, (k) => {
      tray.forEach((p, i) => partObj[p].position.lerpVectors(from[i], to[i], k));
    }, () => {
      tray.forEach((p, i) => { from[i] = partObj[p].position.clone(); to[i] = slotPos(i, new THREE.Vector3()); });
    });
  }

  function stepSegs(step) {
    const out = [];
    const beginStep = seg(STEP_GAP, null, () => {
      queue.setCurrent(step.id);
      map.draw(step.before);
    });
    out.push(beginStep);
    const s = step.before;
    const target = {};
    switch (step.event) {
      case 'turn': {
        const d = sweep(stopYaw, s.stop, step.after.stop, step.dir);
        const tgt = {};
        out.push(seg(0.3 + Math.abs(d) * 0.35, (k) => { q.yaw = qFrom.yaw + (tgt.yaw - qFrom.yaw) * k; applyPose(); },
          () => { qFrom.yaw = q.yaw; tgt.yaw = q.yaw + d; ctx.sound.play('turn'); }));
        break;
      }
      case 'bump': {
        const d = sweep(stopYaw, s.stop, (s.stop + step.dir + 4) % 4, step.dir);
        const reach = Math.abs(d) / 2 - BARRIER_MARGIN;
        const tgt = {};
        out.push(seg(0.25 + reach * 0.35, (k) => { q.yaw = qFrom.yaw + (tgt.yaw - qFrom.yaw) * k; applyPose(); },
          () => { qFrom.yaw = q.yaw; tgt.yaw = q.yaw + step.dir * reach; ctx.sound.play('turn'); }));
        out.push(seg(0.45, (k) => { q.yaw = tgt.yaw - step.dir * Math.sin(k * Math.PI) * 0.04; applyPose(); },
          () => { flash.barrier = 1; flash.t = 0; ctx.sound.play('miss'); }));
        break;
      }
      case 'reach':
        out.push(poseSeg(target, 0.55));
        out[out.length - 1].begin = wrapBegin(out[out.length - 1].begin, () => { poseAt(s.stop, true, target); ctx.sound.play('down'); });
        break;
      case 'grip': {
        const part = step.part;
        out.push(gripSeg(ARM.gripClosed, 0.25, () => { n.arm_wrist.attach(partObj[part]); }));
        const lift = poseSeg(target, 0.5);
        const slide = slideSeg(step.after.tray, 0.5);
        out.push(seg(0.5, (k) => { lift.tick(k); slide.tick(k); }, () => { poseAt(s.stop, false, target); lift.begin(); slide.begin(); ctx.sound.play('up'); }));
        break;
      }
      case 'release-tray': {
        const part = step.part;
        out.push(shiftBackSeg(step.after.tray.slice(1)));
        out.push(gripSeg(ARM.gripOpen, 0.2, () => { rig.attach(partObj[part]); slotPos(0, partObj[part].position); }));
        out.push(poseSeg(target, 0.45));
        out[out.length - 1].begin = wrapBegin(out[out.length - 1].begin, () => { poseAt(s.stop, false, target); ctx.sound.play('up'); });
        break;
      }
      case 'drop':
      case 'bounce': {
        const part = step.part;
        const o = partObj[part];
        out.push(gripSeg(ARM.gripOpen, 0.2, () => { rig.attach(o); }));
        let y0 = 0;
        out.push(seg(0.3, (k) => { o.position.y = y0 + (BIN_FLOOR - y0) * k * k; }, () => { y0 = o.position.y; ctx.sound.play('step'); }));
        if (step.event === 'drop') {
          out.push(poseSeg(target, 0.45));
          out[out.length - 1].begin = wrapBegin(out[out.length - 1].begin, () => { poseAt(s.stop, false, target); ctx.sound.play('up'); });
        } else {
          const from = new THREE.Vector3(), to = new THREE.Vector3();
          const lift = poseSeg(target, 0.8);
          out.push(seg(0.8, (k) => {
            o.position.lerpVectors(from, to, k);
            o.position.y += Math.sin(k * Math.PI) * 0.3;
            lift.tick(k);
          }, () => {
            from.copy(o.position);
            slotPos(step.after.tray.length - 1, to);
            poseAt(s.stop, false, target);
            lift.begin();
            flash.bin = s.stop; flash.t = 0;
            ctx.sound.play('miss');
          }));
        }
        break;
      }
      default: {
        // a move that could not happen: the gripper shakes where it is
        let w0 = 0;
        out.push(seg(0.5, (k) => { q.w = w0 + Math.sin(k * Math.PI * 4) * 0.08 * (1 - k); applyPose(); }, () => { w0 = q.w; ctx.sound.play('miss'); }));
      }
    }
    out.push(seg(0.01, null, null, () => map.draw(step.after, { flashBin: step.event === 'bounce' ? s.stop : 0, barrierHit: step.event === 'bump' })));
    return out;
  }

  function wrapBegin(a, b) { return () => { b(); a?.(); }; }

  /** Waiting parts move back one slot so a released part can sit at the pickup spot. */
  function shiftBackSeg(rest) {
    const from = [], to = [];
    return seg(0.25, (k) => rest.forEach((p, i) => partObj[p].position.lerpVectors(from[i], to[i], k)),
      () => rest.forEach((p, i) => { from[i] = partObj[p].position.clone(); to[i] = slotPos(i + 1, new THREE.Vector3()); }));
  }

  function finishRun() {
    const s = seq;
    seq = null;
    const res = s.result;
    queue.setCurrent(null);
    queue.setLocked(false);
    ui.run.hidden = false; ui.stop.hidden = true; ui.clearBtn.disabled = false;
    if (res.cleared) {
      ctx.sound.play('win');
      if (!s.isReplay) { onClear(res); return; }
      setMessage('That was your last run.', 'win');
      ui.replay.hidden = false;
      ui.run.focus();
      return;
    }
    queue.setError(res.failId);
    ctx.sound.play('miss');
    const msg = missMessage(res, level);
    setMessage(`${msg} The marked move is where it went wrong. Fix it and press Run again.`, 'miss');
    announce(msg);
    ui.replay.hidden = false;
    ui.run.focus();
  }

  function stopRun() {
    if (!seq) return;
    seq = null;
    resetScene();
    queue.setCurrent(null);
    queue.setLocked(false);
    ui.run.hidden = false; ui.stop.hidden = true; ui.clearBtn.disabled = false;
    setMessage('Stopped. The arm is back at the start.', null);
    ui.run.focus();
  }

  function onClear(res) {
    const s = starsFor(res, level);
    const best = ctx.save.recordLevel(level.id, s.stars);
    let newStamp = false;
    if (level.id === 3) newStamp = ctx.save.awardStamp(STAMP_SKILL);
    ctx.avatar.play('cheer');
    showResult(s, res.blocks, best);
    if (newStamp) ctx.showStamp(STAMP_SKILL);
  }

  function showResult(s, moves, best) {
    const p = ctx.panel;
    clear(p);
    p.classList.remove('rr-play');
    const row = (ok, text) => h('li', { class: ok ? 'yes' : 'no' }, icon(ok ? 'check' : 'dash'), h('span', { text: `${text} ${ok ? '(yes)' : '(not yet)'}` }));
    const next = LEVELS.find((l) => l.id === level.id + 1);
    const program = queue.getProgram();
    put(p,
      h('h2', { text: `Level ${level.id} cleared` }),
      h('p.result-stars', null, starRow(s.stars), h('span.sr-only', { text: `You got ${s.stars} of 3 stars.` })),
      h('ul.checklist', null,
        row(s.sorted, level.parts.length === 1 ? 'Sorted the part.' : 'Sorted every part.'),
        row(s.withinLimit, `Used ${level.limit} moves or fewer. You used ${moves}.`),
        row(s.shortest, `Matched the shortest program, ${level.shortest} moves.`),
      ),
      best > s.stars ? h('p', { text: `Your best for this level is still ${best} stars. A new try never takes stars away.` }) : null,
      !s.shortest ? h('p.tip', { text: `Want three stars? The shortest program uses ${level.shortest} moves.` }) : null,
      h('div.actions', null,
        h('button', { type: 'button', onclick: () => { showPlay(); queue.setProgram(program); resetAfterEdit(); } }, h('span', { text: 'Try again' })),
        next ? h('button.primary', { type: 'button', onclick: () => { showLevel(next); showPlay(); } }, h('span', { text: `Next: Level ${next.id}` })) : null,
        h('button', { type: 'button', onclick: () => showLevelSelect() }, h('span', { text: 'All levels' })),
      ),
    );
    announce(`Level ${level.id} cleared. ${s.stars} of 3 stars.`);
    p.querySelector('.actions .primary, .actions button')?.focus();
  }

  // ---------- frame update ----------
  function update(dt) {
    if (!rig) return;
    if (camTween) {
      camTween.t += dt;
      const k = ease(Math.min(1, camTween.t / camTween.dur));
      ctx.camera.position.lerpVectors(camFromPos, camToPos, k);
      ctx.camera.quaternion.slerpQuaternions(camFromQ, camToQ, k);
      if (k >= 1) camTween = null;
    }
    if (flash.bin || flash.barrier) {
      flash.t += dt;
      const on = ctx.reducedMotion ? 0.6 : 0.35 + 0.35 * Math.sin(flash.t * 12);
      setGlow(flash.bin ? on : 0, flash.barrier ? on : 0);
    }
    const s = seq;
    if (!s) return;
    let budget = dt;
    while (seq === s && budget >= 0) {
      const sg = s.segs[s.i];
      if (!sg) { finishRun(); return; }
      if (!s.started) {
        s.started = true; s.t = 0;
        sg.begin?.();
        if (ctx.reducedMotion) sg.tick?.(1); // cut straight to the new pose
      }
      const dur = ctx.reducedMotion ? Math.min(sg.dur, 0.3) : sg.dur;
      s.t += budget;
      const k = dur > 0 ? Math.min(1, s.t / dur) : 1;
      if (!ctx.reducedMotion) sg.tick?.(ease(k));
      if (k < 1) return;
      budget = s.t - dur;
      sg.end?.();
      s.i++; s.started = false;
    }
  }

  function dispose() {
    seq = null; camTween = null;
    if (ctx) {
      ctx.hub.setVisible(HIDE, true);
      for (const o of trayPieces) o.visible = true;
      if (rig) ctx.scene.remove(rig);
      ctx.panel.classList.remove('rr', 'rr-play');
    }
    const free = (root) => root?.traverse((o) => {
      if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.map?.dispose(); m.dispose(); }); }
    });
    free(rig);
    free(gltfScene);
    rig = null; gltfScene = null; queue = null; map = null; ui = {};
  }

  return { id: 'robot', title: 'Robot Relay', load, start, update, dispose };
}
