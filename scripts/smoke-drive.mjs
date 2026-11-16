// Drive the Bus browser smoke on the built game in dist/ (or $DIST), software WebGL.
// 1. Fresh save: the drive spot is absent.
// 2. Six stamps and a built badge: the one-time note shows, walk to the bus door, start
//    the drive, drive forward with the keys, honk, take corners, back up, run into an
//    edge on purpose and see the bus nudged back, pause, park, and check the hub is
//    exactly as it was and a station still opens.
// 3. Phone in landscape, touch only, reduced motion: drive with the on-screen buttons and park.
// Screens go to screens/drive/. Fails on console errors or outside requests.
import { startSmoke } from './smoke-common.mjs';

process.env.DIST ||= 'dist';
const s = await startSmoke({ port: 4330, screens: 'screens/drive' });
const LONG = 400000;
let n = 0;
const shot = (page, name) => s.shot(page, `${String(++n).padStart(2, '0')}-${name}`);
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };
const STAMPS = Object.fromEntries(['microscope', 'robot', 'drone', 'heroes', 'sky', 'cypher'].map((id) => [id, { levels: { 1: 3, 2: 3, 3: 3 }, stamp: { skill: 'Test skill' } }]));
const BADGE = { design: { shape: 'shield', body: 'teal', accent: 'yellow', slots: ['cell', 'gear', 'drone', 'spark', 'planet', 'wave'], initials: 'MCB' }, code: 'MCB-TEST', done: true, savedAt: '2026-11-16' };
const SEED = (save) => { if (!localStorage.getItem('mcb-challenge-v1')) localStorage.setItem('mcb-challenge-v1', JSON.stringify(save)); };

/** Hub state that a drive must hand back unchanged. */
const hubState = (page) => page.evaluate(() => {
  const m = window.__mcb, sc = m.scene;
  const hidden = [];
  sc.traverse((o) => { if (o.isMesh && !o.visible && o.parent && o.parent.visible) hidden.push(o.name || o.material?.name || '?'); });
  const invisibleRoots = [];
  sc.traverse((o) => { if (!o.visible) invisibleRoots.push(o.name || o.type); });
  return {
    mode: m.mode,
    children: sc.children.length,
    hubRootChildren: sc.children.find((c) => c.getObjectByName && c.getObjectByName('walk_area'))?.children.length,
    invisible: invisibleRoots.sort().join(','),
    labelsShown: sc.children.filter((o) => o.isSprite && o.visible).length,
    fog: sc.fog ? [sc.fog.near, sc.fog.far].join('/') : 'none',
    mem: m.mem(),
    hud: ['.passport', '.run-btn', '.topbar'].map((q) => !document.querySelector(q)?.hidden).join(','),
    driveHud: !!document.querySelector('.drive-hud'),
  };
});

const camAt = (page) => page.evaluate(() => { const c = window.__mcb.camera; return { x: +c.position.x.toFixed(2), y: +c.position.y.toFixed(2), z: +c.position.z.toFixed(2) }; });

try {
  // ---------- 1. fresh save: no drive spot ----------
  {
    const ctx = await s.browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    s.watch(page, 'fresh ');
    await s.enterHub(page);
    const fresh = await page.evaluate(() => ({ spot: window.__mcb.driveSpot, ring: !!window.__mcb.scene.getObjectByName('ring_drive'), label: !!window.__mcb.scene.getObjectByName('label_drive'), toast: !document.querySelector('.toast')?.hidden }));
    check(!fresh.spot && !fresh.ring && !fresh.label, 'fresh save: no drive spot, ring or label');
    check(!fresh.toast, 'fresh save: no bus-ready note');
    await page.click('.passport-btn');
    const pass = await page.textContent('.passport-list');
    check(!/Drive the bus/.test(pass), 'fresh save: passport does not mention driving');
    await shot(page, 'fresh-no-drive-spot');
    await ctx.close();
  }

  // ---------- 2. after the badge: drive ----------
  const ctx = await s.browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(SEED, { v: 1, character: 'avatar_02', sound: true, stations: STAMPS, badge: BADGE, flags: {} });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  s.watch(page);
  await s.enterHub(page, 'avatar_02');
  const toast = await page.evaluate(() => !document.querySelector('.toast').hidden && document.querySelector('.toast').textContent);
  check(/ready to drive/.test(toast || ''), `bus-ready note shows once (${toast})`);
  await shot(page, 'badge-done-note');
  await page.click('.toast button');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('mcb-challenge-v1')).flags);
  check(saved?.driveReady === true, 'note is remembered so it is not shown again');
  check(await page.evaluate(() => window.__mcb.driveSpot && !!window.__mcb.scene.getObjectByName('ring_drive')), 'drive spot is there after the badge');

  await page.evaluate(() => window.__mcb.walkToStation('drive'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'drive', null, { timeout: LONG });
  await page.waitForTimeout(600);
  const prompt = (await page.textContent('.prompt')).replace(/\s+/g, ' ').trim();
  check(/Drive the bus/.test(prompt), `prompt at the bus door: ${prompt}`);
  await shot(page, 'drive-spot-at-door');
  const before = await hubState(page);
  const camBefore = await camAt(page);
  console.log('hub before:', JSON.stringify(before));

  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__mcb.mode === 'drive' && window.__mcb.drive && window.__mcb.drive.state, null, { timeout: LONG });
  await page.waitForFunction(() => !document.querySelector('.fade.on'), null, { timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot(page, 'drive-start');
  const startInfo = await page.evaluate(() => ({ st: window.__mcb.drive.state, info: window.__mcb.info(), busTris: window.__mcb.drive.busTriangles, worldTris: window.__mcb.drive.worldTriangles, avatar: (() => { let v = null; window.__mcb.scene.traverse((o) => { if (o.isSkinnedMesh && v === null) { let p = o; v = true; while (p) { if (!p.visible) v = false; p = p.parent; } } }); return v; })() }));
  console.log('drive start:', JSON.stringify(startInfo));
  check(startInfo.info.triangles <= 150000, `triangles on screen ${startInfo.info.triangles} (budget 150,000)`);
  check(startInfo.avatar === false, 'character hidden while driving');
  check(await page.evaluate(() => !!document.querySelector('.dr-park') && document.activeElement !== document.querySelector('.dr-park')), 'Park and get out shows, without focus on it');

  // forward with the keys (real key presses)
  const x0 = startInfo.st.x;
  await page.keyboard.down('ArrowUp');
  await page.waitForFunction((x) => window.__mcb.drive.state.x > x + 2, x0, { timeout: LONG });
  await page.keyboard.up('ArrowUp');
  const fwd = await page.evaluate(() => window.__mcb.drive.state);
  check(fwd.x > x0 + 2, `drove forward with the up arrow (x ${x0.toFixed(1)} to ${fwd.x.toFixed(1)})`);
  await shot(page, 'drive-forward');
  // space brakes even though buttons are on screen
  await page.keyboard.down('Space');
  await page.waitForTimeout(1500);
  await page.keyboard.up('Space');
  check(await page.evaluate(() => window.__mcb.mode === 'drive'), 'Space brakes and does not press a button');

  // honk
  await page.keyboard.press('KeyH');
  await page.waitForTimeout(100);
  check(await page.evaluate(() => !document.querySelector('.dr-beep').hidden), 'H honks (Beep beep shows for players with sound off)');
  await shot(page, 'drive-honk');

  // corners: follow the loop like a careful driver
  const leg1 = await page.evaluate(() => window.__mcb.drive.follow(16));
  await page.waitForTimeout(1200);
  await shot(page, 'drive-east-road');
  const leg2 = await page.evaluate(() => window.__mcb.drive.follow(22));
  await page.waitForTimeout(1200);
  await shot(page, 'drive-back-road');
  const leg3 = await page.evaluate(() => window.__mcb.drive.follow(20));
  await page.waitForTimeout(1200);
  await shot(page, 'drive-west-road');
  const corners = leg1.corners + leg2.corners + leg3.corners;
  console.log('legs:', JSON.stringify([leg1, leg2, leg3].map((l) => ({ x: l.x.toFixed(1), z: l.z.toFixed(1), corners: l.corners }))));
  check(corners >= 2, `took ${corners} corners`);
  const info2 = await page.evaluate(() => window.__mcb.info());
  console.log('render on the back road:', JSON.stringify(info2));

  // reverse with the down arrow (real key presses)
  await page.evaluate(() => window.__mcb.drive.simulate({ throttle: 0, steer: 0, brake: true }, 3));
  const r0 = await page.evaluate(() => window.__mcb.drive.state);
  await page.keyboard.down('ArrowDown');
  await page.waitForFunction(() => window.__mcb.drive.state.v < -0.5, null, { timeout: LONG });
  await page.waitForTimeout(800);
  await page.keyboard.up('ArrowDown');
  const r1 = await page.evaluate(() => window.__mcb.drive.state);
  const back = (r1.x - r0.x) * Math.sin(r0.h) + (r1.z - r0.z) * Math.cos(r0.h);
  check(r1.v < 0 && back < -0.2, `backed up with the down arrow (moved ${back.toFixed(2)} m along the bus)`);
  await shot(page, 'drive-reverse');

  // into the edge on purpose: full steer right at speed
  const edge = await page.evaluate(() => {
    const d = window.__mcb.drive;
    d.simulate({ throttle: 1, steer: 0 }, 3);
    const r = d.simulate({ throttle: 1, steer: -1 }, 4);
    return r;
  });
  await page.waitForTimeout(700);
  const status = await page.evaluate(() => !document.querySelector('.dr-status').hidden && document.querySelector('.dr-status').textContent);
  check(edge.touchedDuring && Math.abs(edge.v) <= 2.6, `hit the edge, slowed to ${edge.v.toFixed(2)} m/s`);
  const ovl = await page.evaluate(() => { const d = window.__mcb.drive; return d.state; });
  check(await page.evaluate(() => window.__mcb.mode === 'drive'), 'no game over at the edge');
  check(/edge of the road/i.test(status || ''), `edge note shows: ${status}`);
  await shot(page, 'drive-edge-nudged');
  const away = await page.evaluate(() => window.__mcb.drive.simulate({ throttle: 1, steer: 1 }, 3));
  check(Math.abs(away.v) > 0.5, 'can drive away from the edge');
  void ovl;

  // pause works while driving
  await page.keyboard.press('Escape');
  await page.waitForSelector('text=Keep driving');
  await shot(page, 'drive-paused');
  const pausedAt = await page.evaluate(() => window.__mcb.drive.state);
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(800); await page.keyboard.up('ArrowUp');
  const stillAt = await page.evaluate(() => window.__mcb.drive.state);
  check(Math.abs(stillAt.x - pausedAt.x) < 1e-6 && Math.abs(stillAt.z - pausedAt.z) < 1e-6, 'bus stays put while paused');
  await page.click('text=Keep driving');

  // park and get out
  const during = await page.evaluate(() => window.__mcb.mem());
  await page.click('.dr-park');
  await page.waitForFunction(() => window.__mcb.mode === 'hub' && !document.querySelector('.drive-hud'), null, { timeout: LONG });
  await page.waitForFunction(() => !document.querySelector('.fade.on'), null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await shot(page, 'parked-hub-restored');
  const after = await hubState(page);
  console.log('hub after:', JSON.stringify(after));
  check(after.children === before.children && after.hubRootChildren === before.hubRootChildren, 'scene has the same objects as before the drive');
  check(after.invisible === before.invisible, 'same objects hidden as before (opened bus, stations, rings back)');
  check(after.labelsShown === before.labelsShown, 'ring labels back');
  check(after.fog === before.fog, 'fog back');
  check(after.hud === before.hud && !after.driveHud, 'hub buttons back, drive buttons gone');
  // hub parts first seen from the road stay uploaded, so compare with the count while driving
  check(after.mem.geometries <= during.geometries - 8, `drive geometry freed (geometries ${after.mem.geometries} after, ${during.geometries} while driving, ${before.mem.geometries} before)`);
  const p = await page.evaluate(() => window.__mcb.player());
  check(Math.abs(p.x - 4.78) < 0.6 && p.z > 1.8 && p.z < 4.5, `player beside the bus door (${p.x.toFixed(2)}, ${p.z.toFixed(2)})`);
  const camAfter = await camAt(page);
  console.log('camera before/after:', JSON.stringify(camBefore), JSON.stringify(camAfter));
  check(Math.abs(camAfter.y - camBefore.y) < 0.3, 'hub follow camera back');

  // a station still opens
  await page.evaluate(() => window.__mcb.walkToStation('badge'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'badge', null, { timeout: LONG });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.level-card') || /See my badge/.test(document.querySelector('.panel-body')?.textContent || ''), null, { timeout: LONG });
  check(await page.evaluate(() => window.__mcb.mode === 'station'), 'Badge Builder still opens after the drive');
  await page.waitForTimeout(1000);
  await shot(page, 'station-after-drive');
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub');
  // the note is not shown a second time
  check(await page.evaluate(() => document.querySelector('.toast').hidden), 'bus-ready note not shown again');
  await ctx.close();

  // ---------- 3. phone in landscape, touch only, reduced motion ----------
  const pctx = await s.browser.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  await pctx.addInitScript(SEED, { v: 1, character: 'avatar_07', sound: false, stations: STAMPS, badge: BADGE, flags: { driveReady: true } });
  const phone = await pctx.newPage();
  phone.setDefaultTimeout(120000);
  s.watch(phone, 'phone ');
  await phone.goto(`${s.base}/?debug`);
  await phone.waitForSelector('.char', { timeout: 90000 });
  await phone.tap('.char[data-id="avatar_07"]');
  await phone.tap('button.big');
  await phone.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
  await phone.evaluate(() => window.__mcb.walkToStation('drive'));
  await phone.waitForFunction(() => window.__mcb.nearRing === 'drive', null, { timeout: LONG });
  await phone.tap('.prompt button');
  await phone.waitForFunction(() => window.__mcb.mode === 'drive' && window.__mcb.drive && window.__mcb.drive.state, null, { timeout: LONG });
  await phone.waitForTimeout(1200);
  const hold = async (sel, ms) => {
    await phone.dispatchEvent(sel, 'pointerdown', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0 });
    await phone.waitForTimeout(ms);
    await phone.dispatchEvent(sel, 'pointerup', { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0 });
  };
  const px0 = await phone.evaluate(() => window.__mcb.drive.state.x);
  await phone.dispatchEvent('.dr-go', 'pointerdown', { pointerId: 3, pointerType: 'touch', isPrimary: true, button: 0 });
  await phone.waitForFunction((x) => window.__mcb.drive.state.x > x + 1.5, px0, { timeout: LONG });
  await hold('.dr-left', 600);
  await phone.dispatchEvent('.dr-go', 'pointerup', { pointerId: 3, pointerType: 'touch', isPrimary: true, button: 0 });
  const pst = await phone.evaluate(() => window.__mcb.drive.state);
  check(pst.x > px0 + 1.5, 'touch: Go button drives the bus');
  await phone.tap('.dr-horn');
  await phone.waitForTimeout(150);
  check(await phone.evaluate(() => !document.querySelector('.dr-beep').hidden), 'touch: Horn shows Beep beep with sound off');
  await shot(phone, 'phone-driving');
  const sizes = await phone.evaluate(() => [...document.querySelectorAll('.dr-pad, .dr-park')].map((b) => { const r = b.getBoundingClientRect(); return [b.textContent.trim(), Math.round(r.width), Math.round(r.height), Math.round(r.left), Math.round(r.top)]; }));
  console.log('phone buttons:', JSON.stringify(sizes));
  check(sizes.every(([, w, hh]) => w >= 44 && hh >= 44), 'touch buttons at least 44 px');
  const overlap = await phone.evaluate(() => {
    const rs = [...document.querySelectorAll('.dr-pad, .dr-park, .topbar button')].map((b) => b.getBoundingClientRect());
    for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) return true;
    }
    return false;
  });
  check(!overlap, 'phone: drive buttons do not overlap each other or the top bar');
  // rigid camera under reduced motion: exactly behind the bus each frame
  const rig = await phone.evaluate(() => { const st = window.__mcb.drive.state, c = window.__mcb.camera.position; return Math.hypot(c.x - (st.x - Math.sin(st.h) * 12.5), c.z - (st.z - Math.cos(st.h) * 12.5)); });
  check(rig < 0.6, `reduced motion: camera fixed behind the bus (off by ${rig.toFixed(2)} m)`);
  await phone.tap('.dr-park');
  await phone.waitForFunction(() => window.__mcb.mode === 'hub' && !document.querySelector('.drive-hud'), null, { timeout: LONG });
  await phone.waitForTimeout(1500);
  await shot(phone, 'phone-parked');
  await pctx.close();
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  problems.push(e.message);
} finally {
  console.log('external requests:', s.external.length ? s.external : 'none');
  console.log('console errors/warnings:', s.errors.length ? s.errors : 'none');
  if (s.external.length || s.errors.length) problems.push('console errors or outside requests');
  console.log(problems.length ? `FAILED: ${problems.length} problem(s)` : 'PASSED');
  process.exitCode = problems.length ? 1 : 0;
  await s.close();
}
