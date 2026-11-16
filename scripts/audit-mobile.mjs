// Phone layout audit: screenshots of every screen at six phone sizes, with
// real mobile emulation (isMobile, hasTouch, device scale 2). One page is
// resized between sizes, so each screen is also seen after a rotation.
// Seeds a finished save in localStorage (so it works on old builds too).
//
//   DIST=/tmp/dist-before OUT=screens/mobile/before node scripts/audit-mobile.mjs
//   ONLY=hub,drone SIZES=390x844,844x390 node scripts/audit-mobile.mjs
//
// Writes <OUT>/<screen>-<w>x<h>.png and prints layout problems it can measure
// (elements past the viewport edge, small text, small or overlapping buttons).
import { startSmoke } from './smoke-common.mjs';
import { LEVELS as ROBOT_LEVELS } from '../src/stations/robot/levels.js';
import { solve as solveRobot } from '../src/stations/robot/solver.js';
import { layoutProblems } from './layout-check.mjs';

const OUT = process.env.OUT || 'screens/mobile/after';
process.env.DIST ||= 'dist';
const ALL_SIZES = ['360x640', '390x844', '412x915', '640x360', '844x390', '915x412'];
const SIZES = (process.env.SIZES ? process.env.SIZES.split(',') : ALL_SIZES).map((s) => s.split('x').map(Number));
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;
const want = (k) => !ONLY || ONLY.has(k);
const LONG = 300000;
const s = await startSmoke({ port: 4330 + Math.floor(Math.random() * 50), screens: OUT });
const report = [];

const full = (skill) => ({ levels: { 1: 3, 2: 3, 3: 3 }, stamp: { skill } });
const SEED = {
  v: 1, character: 'avatar_03', sound: false, flags: { driveReady: true },
  stations: {
    microscope: full('Spotted clues at tiny scales'), robot: full("Planned a robot's moves"),
    drone: { levels: { 1: 3, 2: 3 }, stamp: null },
    heroes: full('Matched problems to inventions'), sky: full('Star-hopped to a target'),
    cypher: full('Put science words on the beat'), badge: { levels: { 1: 3, 2: 3, 3: 3 }, stamp: null },
  },
  badge: { design: { shape: 'shield', body: 'teal', accent: 'yellow', slots: ['cell', 'gear', 'drone', 'spark', 'planet', 'wave'], initials: 'MCB' }, code: 'MCB-00000000', done: true },
};

async function sizes(page, name, { settle = 1400, before } = {}) {
  for (const [w, h] of SIZES) {
    await page.setViewportSize({ width: w, height: h });
    if (before) await before(w, h);
    await page.waitForTimeout(settle);
    await page.screenshot({ path: `${OUT}/${name}-${w}x${h}.png` });
    const probs = await page.evaluate(layoutProblems);
    for (const p of probs) report.push(`${name} ${w}x${h}: ${p}`);
    console.log(`shot ${name} ${w}x${h}${probs.length ? `  (${probs.length} problems)` : ''}`);
  }
  await page.setViewportSize({ width: SIZES[0][0], height: SIZES[0][1] });
}

async function goStation(page, id) {
  await page.evaluate((i) => (window.__mcb.teleport ? window.__mcb.teleport(i) : window.__mcb.walkToStation(i)), id);
  await page.waitForFunction((i) => window.__mcb.nearRing === i, id, { timeout: LONG });
  await page.waitForTimeout(300);
  await page.evaluate(() => document.querySelector('.prompt button')?.click());
  await page.waitForSelector('.level-card', { timeout: LONG });
  await page.waitForTimeout(1500);
}
async function leave(page) {
  await page.evaluate(() => document.querySelector('.back-btn')?.click());
  await page.waitForFunction(() => window.__mcb.mode === 'hub', null, { timeout: LONG });
  await page.waitForTimeout(500);
}
const clickText = (page, t) => page.locator(`button:has-text("${t}")`).first().evaluate((el) => el.click());
/** A DOM click: screenshots only, so it works even when the old layout hides a button. */
const dclick = async (page, sel) => { await page.waitForSelector(sel, { timeout: LONG }); await page.$eval(sel, (el) => el.click()); await page.waitForTimeout(120); };

try {
  // DESKTOP=1: a plain desktop window (mouse, no touch), for checking nothing changed there
  const phone = !process.env.DESKTOP;
  const ctx = await s.browser.newContext({ viewport: { width: SIZES[0][0], height: SIZES[0][1] }, isMobile: phone, hasTouch: phone, deviceScaleFactor: phone ? 2 : 1 });
  // the stamp card needs Drone Dash's stamp still to earn; otherwise every stamp is in
  if (!want('drone')) SEED.stations.drone = full('Used a loop');
  await ctx.addInitScript((seed) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mcb-challenge-v1', JSON.stringify(seed)); sessionStorage.setItem('seeded', '1'); } }, SEED);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  s.watch(page);
  await page.goto(`${s.base}/?debug`);
  if (want('loading')) {
    await page.waitForSelector('.loading', { timeout: 30000 }).catch(() => {});
    for (const [w, h] of SIZES) { await page.setViewportSize({ width: w, height: h }); await page.screenshot({ path: `${OUT}/loading-${w}x${h}.png` }); }
  }
  await page.waitForSelector('.char', { timeout: LONG });
  if (want('select')) await sizes(page, 'select', { settle: 600 });
  await page.evaluate(() => document.querySelector('button.big').click());
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
  await page.waitForTimeout(1500);
  if (want('hub')) await sizes(page, 'hub');
  if (want('passport')) {
    await page.evaluate(() => document.querySelector('.passport-btn').click());
    await sizes(page, 'passport', { settle: 800 });
    await page.evaluate(() => document.querySelector('.passport-btn').click());
  }
  if (want('prompt') || want('pause')) {
    await page.evaluate(() => (window.__mcb.teleport ? window.__mcb.teleport('robot') : window.__mcb.walkToStation('robot')));
    await page.waitForFunction(() => window.__mcb.nearRing === 'robot', null, { timeout: LONG });
    if (want('prompt')) await sizes(page, 'prompt');
    if (want('pause')) {
      await page.evaluate(() => document.querySelector('.topbar button[aria-label="Pause"]').click());
      await sizes(page, 'pause', { settle: 600 });
      await clickText(page, 'Keep playing');
    }
  }

  if (want('drone')) {
    await goStation(page, 'drone');
    await sizes(page, 'drone-levels');
    await dclick(page, '.level-card[data-level="3"]');
    const add = async (type, k = 1) => { for (let i = 0; i < k; i++) await dclick(page, `.bq-palette [data-type="${type}"]`); };
    await add('takeoff'); await add('repeat'); await add('forward', 2); await add('right');
    await dclick(page, '.bq-plus');
    await dclick(page, '.bq-inside');
    await add('land');
    await sizes(page, 'drone-l3-program');
    await dclick(page, 'button.run');
    await page.waitForSelector('.stamp-card', { timeout: LONG });
    await sizes(page, 'stamp-card', { settle: 800 });
    await dclick(page, '.stamp-card button');
    await sizes(page, 'drone-l3-result');
    await leave(page);
  }
  if (want('robot')) {
    await goStation(page, 'robot');
    await dclick(page, '.level-card[data-level="1"]');
    await sizes(page, 'robot-l1');
    await dclick(page, '.panel-body button.link');
    await dclick(page, '.level-card[data-level="3"]');
    await page.waitForTimeout(600);
    for (const t of solveRobot(ROBOT_LEVELS[2]).moves) await dclick(page, `.bq-palette [data-type="${t}"]`);
    await sizes(page, 'robot-l3-program');
    await leave(page);
  }
  if (want('heroes')) {
    await goStation(page, 'heroes');
    await sizes(page, 'heroes-levels');
    await dclick(page, '.level-card[data-level="3"]');
    await page.waitForSelector('.hh-choice', { timeout: LONG });
    await page.waitForTimeout(1500);
    await sizes(page, 'heroes-l3-choices', { settle: 2000 });
    await dclick(page, '.hh-choice >> nth=0');
    await page.waitForTimeout(800);
    await sizes(page, 'heroes-l3-after-pick');
    await leave(page);
  }
  if (want('microscope')) {
    await goStation(page, 'microscope');
    await dclick(page, '.level-card[data-level="3"]');
    await page.waitForSelector('.mm-answer:not([disabled])', { timeout: LONG });
    await sizes(page, 'microscope-l3');
    await dclick(page, '.mm-answer >> nth=0');
    await page.waitForTimeout(500);
    await sizes(page, 'microscope-l3-wrong');
    await leave(page);
  }
  if (want('sky')) {
    await goStation(page, 'sky');
    await dclick(page, '.level-card[data-level="1"]');
    await page.waitForTimeout(800);
    await sizes(page, 'sky-l1-finder');
    await dclick(page, '.sky-zoom[data-zoom="low"]');
    await sizes(page, 'sky-l1-low');
    await dclick(page, '.sky-zoom[data-zoom="high"]');
    await sizes(page, 'sky-l1-high');
    await leave(page);
  }
  if (want('cypher')) {
    await goStation(page, 'cypher');
    await sizes(page, 'cypher-levels');
    await dclick(page, '.level-card[data-level="1"]');
    const first = await Promise.race([
      page.waitForSelector('text=Start the timing check', { timeout: LONG }).then(() => 'calib'),
      page.waitForSelector('text=Play the verse', { timeout: LONG }).then(() => 'play'),
    ]);
    if (first === 'calib') {
      await sizes(page, 'cypher-calib-intro');
      await clickText(page, 'Start the timing check');
      await page.waitForFunction(() => window.__cypher.mode === 'calib');
      await sizes(page, 'cypher-calib-tap', { settle: 700 });
      // the screenshots took longer than the check, so it asks to try again: tap at once this time
      await page.waitForSelector('text=Try again', { timeout: LONG });
      await clickText(page, 'Try again');
      await page.waitForFunction(() => window.__cypher.mode === 'calib');
      await page.evaluate(() => { const spb = 60 / 90; for (const k of [4, 5, 6, 7]) window.__cypher.calTapAt(k * spb + 0.06); });
      await page.waitForSelector('text=Timing check done', { timeout: LONG });
      await clickText(page, 'Use this');
    }
    await page.waitForSelector('text=Play the verse');
    await clickText(page, 'Play the verse');
    await page.waitForFunction(() => window.__cypher.slot >= 0, null, { timeout: LONG });
    await sizes(page, 'cypher-l1-midverse', { settle: 900 });
    await leave(page);
  }
  if (want('badge')) {
    await goStation(page, 'badge');
    await sizes(page, 'badge-levels');
    await dclick(page, '.level-card[data-level="3"]');
    await dclick(page, '[data-shape="shield"]');
    await clickText(page, 'Next: Colors');
    await sizes(page, 'badge-l3-colors');
    await clickText(page, 'Next: Emblems');
    const order = ['cell', 'gear', 'drone', 'spark', 'planet', 'wave'];
    for (let i = 0; i < order.length; i++) { await dclick(page, `.bb-emblem[data-emblem="${order[i]}"]`); await dclick(page, `.bb-spot[data-slot="${i}"]`); }
    await sizes(page, 'badge-l3-emblems');
    await clickText(page, 'Next: Initials');
    await clickText(page, 'Next: Print');
    await page.waitForSelector('.bb-orient');
    await sizes(page, 'badge-l3-print');
    await page.evaluate(() => document.querySelector('.panel-body button.link')?.click());
    await page.waitForTimeout(300);
    await leave(page).catch(() => {});
    await goStation(page, 'badge');
    await clickText(page, 'See my badge');
    await page.waitForSelector('.bb-final', { timeout: LONG });
    await sizes(page, 'badge-finished');
    await leave(page);
  }
  if (want('drive')) {
    await page.evaluate(() => window.__mcb.startDrive ? (window.__mcb.teleport ? window.__mcb.teleport('drive') : window.__mcb.walkToStation('drive')) : null);
    await page.waitForFunction(() => window.__mcb.nearRing === 'drive', null, { timeout: LONG });
    await page.evaluate(() => window.__mcb.startDrive());
    await page.waitForFunction(() => window.__mcb.mode === 'drive' && window.__mcb.drive, null, { timeout: LONG });
    await page.waitForTimeout(1500);
    await sizes(page, 'drive', { settle: 1600 });
  }
} catch (e) {
  console.error('AUDIT FAILED:', e.message);
  report.push(`FAILED: ${e.message}`);
} finally {
  console.log('\n--- measured problems ---');
  for (const r of report) console.log(r);
  console.log('console errors:', s.errors.length ? s.errors.slice(0, 20) : 'none');
  console.log('external requests:', s.external.length ? s.external : 'none');
  await s.close();
}
