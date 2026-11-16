// Checks for three small fixes, on the built game in dist/ (or $DIST):
// 1. Science Cypher on a phone in landscape: the whole character shows above the lyric bar.
// 2. Robot Relay at 1366 x 768: the program list and the Run controls never overlap.
// 3. Enter opens the station when focus was left on the Passport button,
//    and still opens the passport when the player moved focus there on purpose.
// Screens go to screens/polish/.
import { startSmoke } from './smoke-common.mjs';

process.env.DIST ||= 'dist';
const s = await startSmoke({ port: 4320, screens: 'screens/polish' });
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };
const SEED = (save) => { if (!localStorage.getItem('mcb-challenge-v1')) localStorage.setItem('mcb-challenge-v1', JSON.stringify(save)); };
const seed = { v: 1, character: 'avatar_03', sound: false, stations: { robot: { levels: { 1: 2, 2: 2 }, stamp: null } }, badge: null };

try {
  // ---------- desktop: Enter with focus on Passport, then Robot Relay layout ----------
  const ctx = await s.browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(SEED, seed);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  s.watch(page);
  await s.enterHub(page);
  // Tab to the Passport button while standing outside any ring, then walk into a ring.
  await page.click('.passport-btn'); // open
  await page.click('.passport-btn'); // close; focus stays on the button
  check(await page.evaluate(() => document.activeElement?.classList.contains('passport-btn')), 'focus is on the Passport button');
  await page.evaluate(() => window.__mcb.walkToStation('robot'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'robot', null, { timeout: 300000 });
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__mcb.mode === 'station', null, { timeout: 30000 }).catch(() => {});
  check(await page.evaluate(() => window.__mcb.mode === 'station'), 'Enter with stale focus on Passport opens Robot Relay');
  check(await page.evaluate(() => document.querySelector('.passport-list').hidden), 'passport list stayed closed');
  await page.waitForSelector('.level-card');
  await page.click('.level-card[data-level="3"]');
  await page.waitForTimeout(500);
  const moves = ['right', 'right', 'right', 'reach', 'grip', 'left', 'left', 'left', 'reach', 'release', 'right', 'right', 'reach', 'grip', 'left', 'left', 'reach'];
  for (const t of moves) { await page.focus(`.bq-palette [data-type="${t}"]`); await page.keyboard.press('Enter'); }
  await page.evaluate(() => { const sc = document.querySelector('.rr-scroll'); sc.scrollTop = sc.scrollHeight; });
  await page.waitForTimeout(600);
  await s.shot(page, '01-robot-l3-17-blocks');
  const lay = await page.evaluate(() => {
    const sc = document.querySelector('.rr-scroll').getBoundingClientRect();
    const foot = document.querySelector('.rr-foot').getBoundingClientRect();
    const rows = [...document.querySelectorAll('.bq-program > .bq-row')];
    const last = rows[rows.length - 1].getBoundingClientRect();
    const run = document.querySelector('button.run').getBoundingClientRect();
    const scroller = document.querySelector('.rr-scroll');
    return { scBottom: sc.bottom, footTop: foot.top, lastTop: last.top, lastBottom: last.bottom, runBottom: run.bottom, vh: innerHeight, rows: rows.length, canScroll: scroller.scrollHeight > scroller.clientHeight };
  });
  console.log('robot layout:', JSON.stringify(lay));
  check(lay.scBottom <= lay.footTop + 1, 'program scroll area ends above the Run controls');
  check(lay.lastBottom <= lay.footTop + 1 && lay.lastTop >= 0, 'scrolled to the end, the last block sits fully above the Run bar');
  check(lay.runBottom <= lay.vh, 'Run button is on screen');
  // Back to the hub, then Tab to Passport while standing in the ring: Enter opens the passport.
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub');
  await page.waitForTimeout(500);
  await page.focus('.passport-btn');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check(await page.evaluate(() => window.__mcb.mode === 'hub' && !document.querySelector('.passport-list').hidden), 'Enter on Passport focused on purpose opens the passport');
  await page.keyboard.press('Escape');
  await page.click('text=Keep playing').catch(() => {});

  // ---------- phone in landscape: Science Cypher ----------
  const phoneCtx = await s.browser.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true });
  await phoneCtx.addInitScript(SEED, { ...seed, character: 'avatar_06' });
  const phone = await phoneCtx.newPage();
  phone.setDefaultTimeout(120000);
  s.watch(phone, 'phone ');
  await phone.goto(`${s.base}/?debug`);
  await phone.waitForSelector('.char', { timeout: 90000 });
  await phone.tap('.char[data-id="avatar_06"]');
  await phone.tap('button.big');
  await phone.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 90000 });
  await phone.evaluate(() => window.__mcb.walkToStation('cypher'));
  await phone.waitForFunction(() => window.__mcb.nearRing === 'cypher', null, { timeout: 300000 });
  await phone.tap('.prompt button');
  await phone.waitForSelector('.level-card');
  await phone.tap('.level-card[data-level="1"]');
  await phone.waitForSelector('text=Skip');
  await phone.tap('text=Skip');
  await phone.waitForSelector('text=Play the verse');
  await phone.tap('text=Play the verse');
  await phone.waitForFunction(() => window.__cypher.slot >= 0, null, { timeout: 60000 });
  await phone.waitForTimeout(800);
  await s.shot(phone, '02-cypher-phone');
  const fit = await phone.evaluate(() => {
    const m = window.__mcb; const cam = m.camera;
    let av = null;
    m.scene.traverse((o) => { if (!av && o.isSkinnedMesh) av = o; });
    let root = av; while (root.parent && root.parent !== m.scene) root = root.parent;
    // project the top and bottom of the character's box
    const pts = [];
    root.updateMatrixWorld(true);
    root.traverse((o) => { if (o.isSkinnedMesh || o.isMesh) { o.geometry.computeBoundingBox(); const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld); pts.push(bb.min.clone(), bb.max.clone()); } });
    let top = Infinity, bottom = -Infinity, left = Infinity, right = -Infinity;
    for (const p of pts) { p.project(cam); const y = (1 - p.y) / 2 * innerHeight; const x = (p.x + 1) / 2 * innerWidth; top = Math.min(top, y); bottom = Math.max(bottom, y); left = Math.min(left, x); right = Math.max(right, x); }
    const bar = document.querySelector('.cy-bar').getBoundingClientRect();
    return { top, bottom, left, right, barTop: bar.top, barBottom: bar.bottom };
  });
  console.log('cypher phone framing:', JSON.stringify(fit));
  check(fit.top >= 0 && fit.bottom <= fit.barTop + 8, `character fits above the lyric bar (head ${Math.round(fit.top)} px, feet ${Math.round(fit.bottom)} px, bar top ${Math.round(fit.barTop)} px)`);
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
