// Characters v2 check on the built game in dist/ (or $DIST), software WebGL:
// select screen at desktop and phone sizes, the hub with avatars 04, 06 and 10,
// a cheer, the Science Cypher dance on the stage, the drive with its driver badge,
// an old save (avatar_01..08) still loading, and a rough hub frame-time reading with
// avatar_06 walking (4x CPU throttle through the DevTools protocol).
// JPEGs go to screens/v2chars/. Fails on console errors or outside requests.
//
//   npm run build && node scripts/shots-v2chars.mjs
import { startSmoke } from './smoke-common.mjs';
import { layoutProblems } from './layout-check.mjs';

process.env.DIST ||= 'dist';
const OUT = process.env.OUT || 'screens/v2chars';
const s = await startSmoke({ port: 4390, screens: OUT });
const LONG = 400000;
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const jpg = (page, name) => { console.log('shot', name); return page.screenshot({ path: `${OUT}/${name}.jpg`, type: 'jpeg', quality: 78 }); };
const KEY = 'mcb-challenge-v1';

async function open({ width, height, touch = false, save = null }) {
  const ctx = await s.browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  if (save) await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, [KEY, JSON.stringify(save)]);
  const page = await ctx.newPage();
  s.watch(page, `${width}x${height} `);
  await page.goto(`${s.base}/?debug`);
  await page.waitForSelector('.char', { timeout: LONG });
  await page.waitForTimeout(800);
  return { ctx, page };
}
async function enter(page, id, touch = false) {
  if (touch) await page.tap(`.char[data-id="${id}"]`); else await page.click(`.char[data-id="${id}"]`);
  if (touch) await page.tap('button.big'); else await page.click('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => window.__mcb.character) === id, `${id} is the character in the hub`);
}
/** Let the follow camera settle, mid-walk, by stepping a few real frames. */
async function walkShot(page, name) {
  const p = await page.evaluate(() => window.__mcb.player());
  await page.evaluate(([x, z]) => window.__mcb.walkTo(x + 6, z - 3), [p.x, p.z]);
  await page.waitForFunction(() => window.__mcb.speed > 0, null, { timeout: 20000 });
  await page.waitForTimeout(700);
  await jpg(page, name);
}

// ---- 1. character select ----
if (want('select')) {
  for (const [name, w, h, touch] of [['select_desktop', 1366, 768, false], ['select_phone_portrait', 390, 844, true], ['select_phone_portrait_360', 360, 740, true], ['select_phone_landscape', 844, 390, true]]) {
    const { ctx, page } = await open({ width: w, height: h, touch });
    const n = await page.$$eval('.char', (b) => b.length);
    check(n === 10, `${name}: ten cards (${n})`);
    const probs = await page.evaluate(layoutProblems);
    check(probs.length === 0, `${name}: layout clean${probs.length ? ` (${probs.join('; ')})` : ''}`);
    const sc = await page.evaluate(() => { const c = document.querySelector('.select .card'), g = document.querySelector('.char-grid'); return { card: c.scrollHeight - c.clientHeight, grid: g.scrollHeight - g.clientHeight, min: Math.min(...[...document.querySelectorAll('.char')].map((b) => Math.min(b.getBoundingClientRect().width, b.getBoundingClientRect().height))) }; });
    check(sc.card <= 1 && sc.grid <= 1, `${name}: no scrolling needed (${JSON.stringify(sc)})`);
    check(sc.min >= 44, `${name}: cards at least 44 px (${Math.round(sc.min)})`);
    if (name === 'select_desktop') {
      // focus starts on avatar_01; nine presses of the right arrow reach avatar_10
      for (let i = 0; i < 9; i++) await page.keyboard.press('ArrowRight');
      check(await page.getAttribute('.char[aria-checked="true"]', 'data-id') === 'avatar_10', 'arrow keys reach avatar_10');
      await page.keyboard.press('ArrowRight');
      check(await page.getAttribute('.char[aria-checked="true"]', 'data-id') === 'avatar_01', 'arrow keys wrap back to avatar_01');
      await page.click('.char[data-id="avatar_10"]');
    }
    if (!name.endsWith('_360')) await jpg(page, name);
    await ctx.close();
  }
}

// ---- 2. old saves keep their character ----
if (want('oldsave')) {
  for (const id of ['avatar_01', 'avatar_08']) {
    const { ctx, page } = await open({ width: 1024, height: 640, save: { v: 1, character: id, sound: false, stations: {}, badge: null, flags: {} } });
    check(await page.getAttribute('.char[aria-checked="true"]', 'data-id') === id, `old save with ${id}: picked on the select screen`);
    await page.click('button.big');
    await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
    check(await page.evaluate(() => window.__mcb.character) === id, `old save with ${id}: loads into the hub`);
    await ctx.close();
  }
  // a save naming a character that does not exist shows the select screen with nothing picked
  const { ctx, page } = await open({ width: 1024, height: 640, save: { v: 1, character: 'avatar_99', sound: false, stations: {}, badge: null, flags: {} } });
  check(await page.$('.char[aria-checked="true"]') === null && await page.isDisabled('button.big'), 'unknown character in a save: nothing picked, Start waits');
  await ctx.close();
}

// ---- 3. hub: walk with 06, 10, 04; cheer; phone hub ----
if (want('hub')) {
  for (const id of ['avatar_06', 'avatar_10', 'avatar_04']) {
    const { ctx, page } = await open({ width: 1366, height: 768, save: { v: 1, character: null, sound: false, stations: {}, badge: null, flags: {} } });
    await enter(page, id);
    const dims = await page.evaluate(() => {
      const r = window.__mcb.avatarRoot; let tris = 0, bones = 0;
      r.traverse((o) => { if (o.isMesh) tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3; if (o.isBone) bones++; });
      return { tris, bones };
    });
    check(dims.bones === 12, `${id}: 12 bones in the scene (${dims.bones}), ${dims.tris} triangles`);
    if (id === 'avatar_04') { await jpg(page, 'hub_04'); }
    else await walkShot(page, `hub_walk_${id.slice(-2)}`);
    if (id === 'avatar_04') {
      await page.evaluate(() => window.__mcb.playAvatar('cheer'));
      await page.waitForTimeout(700);
      await jpg(page, 'cheer');
    }
    await ctx.close();
  }
  const { ctx, page } = await open({ width: 390, height: 844, touch: true, save: { v: 1, character: null, sound: false, stations: {}, badge: null, flags: {} } });
  await enter(page, 'avatar_09', true);
  const probs = await page.evaluate(layoutProblems);
  check(probs.length === 0, `phone hub: layout clean${probs.length ? ` (${probs.join('; ')})` : ''}`);
  await jpg(page, 'phone_hub');
  await ctx.close();
}

// ---- 4. Science Cypher: dance on the stage ----
if (want('cypher')) {
  const { ctx, page } = await open({ width: 1366, height: 768, save: { v: 1, character: null, sound: false, stations: {}, badge: null, flags: {} } });
  await enter(page, 'avatar_06');
  await page.evaluate(() => window.__mcb.teleport('cypher'));
  await page.waitForTimeout(600);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__mcb.mode === 'station', null, { timeout: 60000 });
  await page.waitForSelector('.level-card', { timeout: 60000 });
  await page.click('.level-card[data-level="1"]');
  await page.click('text=Skip');                       // skip the timing check
  await page.click('text=Play the verse');             // the real dance starts here
  await page.waitForTimeout(2500);
  await jpg(page, 'cypher_dance');
  const fit = await page.evaluate(() => {
    const m = window.__mcb; const THREE = m.scene.constructor; // no THREE import here: project by hand
    const r = m.avatarRoot; const cam = m.camera; cam.updateMatrixWorld(); r.updateMatrixWorld(true);
    let minY = 1e9, maxY = -1e9; const v = r.position.clone();
    const pts = [];
    r.traverse((o) => { if (o.isSkinnedMesh) { const pos = o.geometry.attributes.position; for (let i = 0; i < pos.count; i += 7) { o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld); v.project(cam); minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); } } });
    const bar = document.querySelector('.cy-bar')?.getBoundingClientRect();
    const H = innerHeight; return { headPx: Math.round((1 - maxY) / 2 * H), feetPx: Math.round((1 - minY) / 2 * H), barTop: bar ? Math.round(bar.top) : null, H };
  });
  // on desktop the stage camera frames the rail top to the head (legs behind the rail and bar, as with v1)
  check(fit.headPx >= 0 && fit.headPx < (fit.barTop ?? fit.H) - 150, `cypher: head and body on screen above the lyric bar while dancing (${JSON.stringify(fit)})`);
  await ctx.close();
}

// ---- 5. drive with the driver badge ----
if (want('drive')) {
  const STAMPS = Object.fromEntries(['microscope', 'robot', 'drone', 'heroes', 'sky', 'cypher'].map((id) => [id, { levels: { 1: 3, 2: 3, 3: 3 }, stamp: { skill: 'Test skill' } }]));
  const save = { v: 1, character: 'avatar_10', sound: false, flags: { driveReady: true }, stations: { ...STAMPS, badge: { levels: { 1: 3, 2: 3, 3: 3 }, stamp: null } },
    badge: { design: { shape: 'shield', body: 'teal', accent: 'yellow', slots: ['cell', 'gear', 'drone', 'spark', 'planet', 'wave'], initials: 'MCB' }, code: 'MCB-TEST', done: true } };
  for (const [w, h, touch, name] of [[1366, 768, false, 'drive'], [844, 390, true, 'drive_phone_landscape'], [390, 844, true, 'drive_phone_portrait']]) {
    const { ctx, page } = await open({ width: w, height: h, touch, save });
    if (touch) await page.tap('button.big'); else await page.click('button.big');
    await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
    await page.evaluate(() => window.__mcb.startDrive());
    await page.waitForFunction(() => window.__mcb.mode === 'drive' && window.__mcb.drive && window.__mcb.drive.state, null, { timeout: LONG });
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__mcb.drive.simulate({ throttle: 1, steer: 0, brake: false }, 2.5));
    await page.waitForTimeout(600);
    const alt = await page.getAttribute('.dr-driver img', 'alt');
    check(alt === 'Explorer 10 is driving', `${name}: driver badge shows the picked character (${alt})`);
    const loaded = await page.evaluate(() => { const i = document.querySelector('.dr-driver img'); return i.complete && i.naturalWidth > 0; });
    check(loaded, `${name}: driver portrait loaded`);
    const probs = await page.evaluate(layoutProblems);
    check(probs.length === 0, `${name}: layout clean${probs.length ? ` (${probs.join('; ')})` : ''}`);
    await jpg(page, name);
    await page.evaluate(() => window.__mcb.exitDrive());
    await page.waitForFunction(() => window.__mcb.mode === 'hub', null, { timeout: 60000 });
    check(await page.evaluate(() => window.__mcb.avatarRoot.visible), `${name}: character visible again after parking`);
    await ctx.close();
  }
}

// ---- 6. frame time in the hub ----
// Software WebGL runs the GPU work on the CPU in another process, so these numbers
// are a rough guide only. Each run walks back and forth for 6 s with the character
// shown, then 6 s with it hidden, so the difference is the character's own cost.
if (want('perf')) {
  const char = process.env.PERF_CHAR || 'avatar_06';
  for (const rate of [1, 4]) {
    const { ctx, page } = await open({ width: 1280, height: 720, save: { v: 1, character: null, sound: false, stations: {}, badge: null, flags: {} } });
    await page.click(`.char[data-id="${char}"]`); await page.click('button.big');
    await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
    await page.waitForTimeout(1500);
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const run = (hidden) => page.evaluate(async (hide) => {
      const m = window.__mcb; const p = m.player();
      const root = m.avatarRoot || m.scene.children.find((o) => o.type === 'Group' && Math.abs(o.position.x - p.x) < 0.01 && Math.abs(o.position.z - p.z) < 0.01);
      if (root) root.visible = !hide;
      const legs = [[p.x + 5, p.z - 2], [p.x, p.z]];
      const gaps = []; let last = performance.now(); let leg = 0;
      m.walkTo(...legs[0]);
      const t0 = performance.now();
      await new Promise((done) => {
        const f = (t) => { gaps.push(t - last); last = t; if (m.speed === 0) { leg ^= 1; m.walkTo(...legs[leg]); } if (t - t0 < 6000) requestAnimationFrame(f); else done(); };
        requestAnimationFrame(f);
      });
      if (root) root.visible = true;
      gaps.shift(); gaps.sort((a, b) => a - b);
      const q = (x) => gaps[Math.floor(x * (gaps.length - 1))];
      return { frames: gaps.length, median: q(0.5), p90: q(0.9), tris: m.info().triangles, calls: m.info().calls, found: !!root };
    }, hidden);
    const shown = await run(false), hid = await run(true);
    const f = (r) => `${r.frames} frames, median ${r.median.toFixed(0)} ms, p90 ${r.p90.toFixed(0)} ms, ${r.calls} calls, ${r.tris} tris`;
    console.log(`PERF ${char} cpu x${rate} character shown: ${f(shown)} | hidden: ${f(hid)}${shown.found ? '' : ' (character not found)'}`);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await ctx.close();
  }
}

check(s.errors.length === 0, `no console errors${s.errors.length ? `: ${s.errors.slice(0, 6).join(' | ')}` : ''}`);
check(s.external.length === 0, `no outside requests${s.external.length ? `: ${s.external.slice(0, 4).join(', ')}` : ''}`);
await s.close();
console.log(problems.length ? `\n${problems.length} problem(s)` : '\nall checks passed');
process.exit(problems.length ? 1 : 0);
