// Phone smoke on the built game in dist/ (or $DIST), software WebGL, touch only.
// 1. Portrait 390 x 844 and landscape 844 x 390 with touch emulation: character
//    select, the hub (tap to walk, double-tap to run), the passport, one full level
//    of each of the seven stations by touch, and the bus drive (Go and Left held
//    together). The phone turns in the middle of a station and in the middle of
//    the drive. At each step: nothing past the screen edge, no page scrolling,
//    no two controls overlapping or covering each other.
// 2. Demo link: a real save with two stamps, then ?demo=<key> shows everything
//    open, the Demo menu jumps to two stations and the drive, Exit demo goes back
//    to the normal game, and the real save still has exactly two stamps.
// Screens go to screens/mobile/smoke/. Fails on console errors or outside requests.
//
//   npm run build && node scripts/smoke-mobile.mjs
import { readFileSync } from 'node:fs';
import { startSmoke } from './smoke-common.mjs';
import { layoutProblems } from './layout-check.mjs';
import { LEVELS as ROBOT_LEVELS } from '../src/stations/robot/levels.js';
import { solve as solveRobot } from '../src/stations/robot/solver.js';
import { DEMO_KEY } from '../src/core/demo.js';

process.env.DIST ||= 'dist';
const s = await startSmoke({ port: 4360, screens: 'screens/mobile/smoke' });
const heroes = JSON.parse(readFileSync('src/stations/heroes/content.json', 'utf8'));
const LONG = 400000;
const PORTRAIT = { width: 390, height: 844 }, LANDSCAPE = { width: 844, height: 390 };
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };
let n = 0;
let tag = '';
const shot = (page, name) => s.shot(page, `${String(++n).padStart(2, '0')}-${tag}${name}`);
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null;

const full = (skill) => ({ levels: { 1: 3, 2: 3, 3: 3 }, stamp: { skill } });
const FINISHED = {
  v: 1, character: 'avatar_04', sound: false, flags: { driveReady: true },
  stations: {
    microscope: full('Spotted clues at tiny scales'), robot: full("Planned a robot's moves"), drone: full('Used a loop'),
    heroes: full('Matched problems to inventions'), sky: full('Star-hopped to a target'), cypher: full('Put science words on the beat'),
    badge: { levels: { 1: 3, 2: 3, 3: 3 }, stamp: null },
  },
  badge: { design: { shape: 'shield', body: 'teal', accent: 'yellow', slots: ['cell', 'gear', 'drone', 'spark', 'planet', 'wave'], initials: 'MCB' }, code: 'MCB-2Z9ZDEJD', done: true },
};

/** Layout check: everything on screen, nothing overlapping. Small text and targets fail too. */
async function layout(page, where) {
  await page.waitForTimeout(250);
  const probs = await page.evaluate(layoutProblems);
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, vv: Math.round(window.visualViewport?.offsetTop || 0), doc: document.scrollingElement.scrollTop }));
  if (scroll.x || scroll.y || scroll.vv || scroll.doc) probs.push(`page moved ${JSON.stringify(scroll)}`);
  check(probs.length === 0, `${tag}${where}: layout clean${probs.length ? ` (${probs.join('; ')})` : ''}`);
}

async function rotate(page, to) {
  await page.setViewportSize(to);
  await page.waitForTimeout(900);
}

/** Touch helpers on top of the DevTools protocol (two fingers at once for the drive). */
function touchKit(cdp) {
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p) => ({ x: p.x, y: p.y, id: p.id ?? 0, radiusX: 4, radiusY: 4, force: 1 })) });
  return {
    async drag(from, to, steps = 8) {
      await send('touchStart', [from]);
      for (let i = 1; i <= steps; i++) await send('touchMove', [{ x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }]);
      await send('touchEnd', []);
    },
    down: (pts) => send('touchStart', pts),
    up: () => send('touchEnd', []),
  };
}
const center = (page, sel) => page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

async function teleportAndPlay(page, id) {
  await page.evaluate((i) => window.__mcb.teleport(i), id);
  await page.waitForFunction((i) => window.__mcb.nearRing === i, id, { timeout: LONG });
  await page.tap('.prompt button');
  await page.waitForSelector('.level-card', { timeout: LONG });
  await page.waitForTimeout(1200);
}
async function backToBus(page) {
  await page.tap('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub', null, { timeout: LONG });
  await page.waitForTimeout(500);
}
const cleared = (page, lv, re = 'cleared') => page.waitForFunction(([l, r]) => new RegExp(`Level ${l} ${r}`).test(document.querySelector('.panel-body')?.textContent || ''), [lv, re], { timeout: LONG });

// ---------------------------------------------------------------- stations, by touch
const STATIONS = {
  async microscope(page, turn) {
    await page.tap('.level-card[data-level="1"]');
    const ans = { salt: 'Table salt', hair: 'A strand of hair', hooks: 'Hook-and-loop tape' };
    for (const [i, sp] of ['salt', 'hair', 'hooks'].entries()) {
      await page.waitForSelector('.mm-answer:not([disabled])', { timeout: LONG });
      if (i === 1) await turn();
      await page.tap(`.mm-answer[data-choice="${ans[sp]}"]`);
      const next = i < 2 ? 'Next object' : 'See your stars';
      await page.waitForSelector(`button:has-text("${next}")`, { timeout: LONG });
      await page.tap(`button:has-text("${next}")`);
    }
    await page.waitForSelector('.result-stars', { timeout: LONG });
  },
  async robot(page, turn) {
    await page.tap('.level-card[data-level="1"]');
    await page.waitForTimeout(500);
    const moves = solveRobot(ROBOT_LEVELS[0]).moves;
    for (const [i, t] of moves.entries()) {
      if (i === 2) await turn();
      await page.tap(`.bq-palette [data-type="${t}"]`);
    }
    await page.tap('button.run');
    await cleared(page, 1);
  },
  async drone(page, turn) {
    await page.tap('.level-card[data-level="1"]');
    for (const t of ['takeoff', 'forward', 'forward']) await page.tap(`.bq-palette [data-type="${t}"]`);
    await turn();
    for (const t of ['forward', 'land']) await page.tap(`.bq-palette [data-type="${t}"]`);
    await page.tap('button.run');
    await cleared(page, 1);
  },
  async heroes(page, turn) {
    await page.tap('.level-card[data-level="1"]');
    const rounds = heroes.rounds.filter((r) => r.level === 1);
    for (const [i, r] of rounds.entries()) {
      await page.waitForSelector('.hh-choice', { timeout: LONG });
      if (i === 0) { await page.waitForTimeout(1200); await turn(); }
      await page.tap(`.hh-choice[data-prop="${r.answer}"]`);
      await page.waitForSelector('.hh-person', { timeout: LONG });
      await page.tap('button:has-text("Meet someone working today")');
      await page.waitForSelector('.hh-yourstep', { timeout: LONG });
      await page.tap(i === 0 ? 'button:has-text("Next round")' : 'button:has-text("Finish the level")');
    }
    await page.waitForSelector('.result-stars', { timeout: LONG });
  },
  async sky(page, turn, touch) {
    await page.tap('.level-card[data-level="1"]');
    await page.waitForTimeout(500);
    const aimAt = async (id) => {
      for (let k = 0; k < 7; k++) {
        const a = await page.evaluate((i) => window.__sky.aim(i), id);
        const r = await page.evaluate(() => window.__sky.rect());
        const dist = Math.hypot(a.x, a.y);
        if (a.ok && dist < r.d * 0.012) return;
        const f = Math.min(1, (r.d * 0.4) / dist);
        // drag the sky with a finger: from the target's spot toward the middle
        await touch.drag({ x: r.x + a.x * f, y: r.y + a.y * f }, { x: r.x, y: r.y }, 6);
        await page.waitForTimeout(150);
      }
    };
    await aimAt('moon');
    await page.tap('.sky-zoom[data-zoom="low"]');
    await aimAt('moon');
    await turn();
    await page.tap('.sky-zoom[data-zoom="high"]');
    await aimAt('tycho');
    await page.tap('.sky-confirm');
    await cleared(page, 1);
  },
  async cypher(page, turn) {
    await page.tap('.level-card[data-level="1"]');
    const first = await Promise.race([
      page.waitForSelector('button:has-text("Start the timing check")', { timeout: LONG }).then(() => 'calib'),
      page.waitForSelector('button:has-text("Play the verse")', { timeout: LONG }).then(() => 'play'),
    ]);
    if (first === 'calib') {
      await page.tap('button:has-text("Start the timing check")');
      await page.waitForFunction(() => window.__cypher.mode === 'calib');
      // one real finger tap on the big Tap button registers...
      const before = await page.evaluate(() => window.__cypher.calTaps.length);
      const tb = await page.$eval('.cy-tap', (el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height, bottom: r.bottom }; });
      check(tb.w >= 120 && tb.h >= 48, `${tag}cypher: Tap button is large (${Math.round(tb.w)} x ${Math.round(tb.h)})`);
      await page.tap('.cy-tap');
      check(await page.evaluate((b) => window.__cypher.calTaps.length > b, before), `${tag}cypher: a finger tap on Tap counts`);
      // ...then the timing itself is scripted (software WebGL is too slow to tap in time)
      await page.waitForSelector('button:has-text("Try again"), h2:has-text("Timing check done")', { timeout: LONG });
      if (await page.$('button:has-text("Try again")')) {
        await page.tap('button:has-text("Try again")');
        await page.waitForFunction(() => window.__cypher.mode === 'calib');
        await page.evaluate(() => { const spb = 60 / 90; for (const k of [4, 5, 6, 7]) window.__cypher.calTapAt(k * spb + 0.06); });
      }
      await page.waitForSelector('button:has-text("Use this")', { timeout: LONG });
      await page.tap('button:has-text("Use this")');
    }
    await page.waitForSelector('button:has-text("Play the verse")', { timeout: LONG });
    await page.tap('button:has-text("Play the verse")');
    const run = page.evaluate(() => new Promise((resolve) => {
      const done = new Set();
      const t0 = performance.now();
      const step = () => {
        const c = window.__cypher;
        if (!c || c.mode !== 'play') { resolve(c && c.mode); return; }
        if (performance.now() - t0 > 380000) { resolve('timeout'); return; }
        const sl = c.slot;
        if (sl >= 0 && !done.has(sl) && !c.tapped && c.now() > c.star() - 0.9) { done.add(sl); c.tapAt(c.answerIndex(), c.star() + c.offset + 0.04); }
        setTimeout(step, 30);
      };
      step();
    }));
    await page.waitForFunction(() => window.__cypher.slot >= 1, null, { timeout: LONG });
    await turn();
    console.log(`${tag}cypher run:`, await run);
    await page.waitForSelector('.result-stars', { timeout: LONG });
  },
  async badge(page, turn) {
    await page.tap('.level-card[data-level="1"]');
    await page.tap('[data-emblem="gear"]');
    await page.tap('button:has-text("Next: place it on the bed")');
    await page.waitForSelector('.bb-orient');
    await turn();
    await page.tap('[data-orient="flat"]');
    await page.tap('.bb-go');
    await page.waitForTimeout(1200);
    if (await page.$('button:has-text("Skip to the end")')) await page.tap('button:has-text("Skip to the end")').catch(() => {});
    await cleared(page, 1, 'printed');
  },
};

/** Drag an emblem onto the badge with a finger (Badge Builder level 3). The panel must not scroll. */
async function badgeDrag(page, touch) {
  await page.tap(await page.$('button:has-text("All levels")') ? 'button:has-text("All levels")' : '.panel-body button.link');
  await page.waitForSelector('.level-card[data-level="3"]', { timeout: LONG });
  await page.tap('.level-card[data-level="3"]');
  await page.tap('[data-shape="circle"]');
  await page.tap('button:has-text("Next: Colors")');
  await page.tap('button:has-text("Next: Emblems")');
  await page.waitForSelector('.bb-emblem[data-emblem="cell"]');
  await page.$eval('.bb-spot[data-slot="0"]', (el) => el.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(300);
  const scrollBefore = await page.$eval('.panel-body', (el) => el.scrollTop);
  const from = await center(page, '.bb-emblem[data-emblem="cell"]');
  const to = await center(page, '.bb-spot[data-slot="0"]');
  await touch.drag(from, to, 10);
  await page.waitForTimeout(400);
  const placed = await page.$eval('.bb-spot[data-slot="0"]', (el) => /cell/i.test(el.textContent + el.getAttribute('aria-label')));
  const scrollAfter = await page.$eval('.panel-body', (el) => el.scrollTop);
  check(placed, `${tag}badge: a finger drag puts an emblem on the badge`);
  check(Math.abs(scrollAfter - scrollBefore) < 2, `${tag}badge: the panel stays put during the drag (${scrollBefore} -> ${scrollAfter})`);
}

async function drive(page, touch, other) {
  await page.evaluate(() => window.__mcb.teleport('drive'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'drive', null, { timeout: LONG });
  await page.tap('.prompt button');
  await page.waitForFunction(() => window.__mcb.mode === 'drive' && window.__mcb.drive, null, { timeout: LONG });
  await page.waitForTimeout(1500);
  await shot(page, 'drive');
  await layout(page, 'drive');
  const pads = await page.evaluate(() => Object.fromEntries(['dr-left', 'dr-right', 'dr-go', 'dr-back', 'dr-brake', 'dr-horn'].map((c) => { const r = document.querySelector(`.${c}`).getBoundingClientRect(); return [c, { x: r.left + r.width / 2, y: r.top + r.height / 2, bottom: r.bottom, w: r.width }]; })));
  const vh = await page.evaluate(() => window.innerHeight), vw = await page.evaluate(() => window.innerWidth);
  check(pads['dr-left'].x < vw / 2 && pads['dr-go'].x > vw / 2 && pads['dr-left'].bottom > vh * 0.7 && pads['dr-go'].bottom > vh * 0.7, `${tag}drive: steering under the left thumb, Go under the right`);
  const s0 = await page.evaluate(() => window.__mcb.drive.state);
  // two fingers: Go and Left held together
  await touch.down([{ ...pads['dr-go'], id: 1 }, { ...pads['dr-left'], id: 2 }]);
  await page.waitForTimeout(2500);
  const held = await page.evaluate(() => [...document.querySelectorAll('.dr-pad.down')].map((b) => b.className.match(/dr-(go|left|right|back|brake)/)?.[1]).filter(Boolean).sort().join(','));
  check(held === 'go,left', `${tag}drive: Go and Left held at the same time (${held})`);
  // the phone turns mid-drive, fingers still down
  await rotate(page, other);
  await layout(page, 'drive after turning the phone');
  await shot(page, 'drive-turned');
  await page.waitForTimeout(1500);
  await touch.up();
  const s1 = await page.evaluate(() => window.__mcb.drive.state);
  const moved = Math.hypot(s1.x - s0.x, s1.z - s0.z);
  check(moved > 0.3 && Math.abs(s1.h - s0.h) > 0.01, `${tag}drive: the bus moved (${moved.toFixed(2)} m) and turned (${(s1.h - s0.h).toFixed(2)} rad)`);
  check(await page.evaluate(() => document.querySelectorAll('.dr-pad.down').length === 0), `${tag}drive: buttons let go when the fingers lift`);
  await page.tap('.dr-park');
  await page.waitForFunction(() => window.__mcb.mode === 'hub', null, { timeout: LONG });
  await page.waitForTimeout(800);
  await layout(page, 'hub after the drive');
}

async function phoneRun(start, other) {
  tag = start.width < start.height ? 'portrait ' : 'landscape ';
  const ctx = await s.browser.newContext({ viewport: start, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
  await ctx.addInitScript((seed) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mcb-challenge-v1', JSON.stringify(seed)); sessionStorage.setItem('seeded', '1'); } }, FINISHED);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  s.watch(page, tag);
  const touch = touchKit(await ctx.newCDPSession(page));
  const turnTo = (sz) => async () => { await rotate(page, sz); await layout(page, `after turning to ${sz.width} x ${sz.height}`); };

  await page.goto(`${s.base}/?debug`);
  await page.waitForSelector('.char', { timeout: LONG });
  check(await page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), `${tag}touch-only device emulated`);
  await layout(page, 'character select');
  await shot(page, 'select');
  await page.tap('.char[data-id="avatar_06"]');
  await page.tap('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
  await page.waitForTimeout(1500);
  await layout(page, 'hub');
  await shot(page, 'hub');
  const pr = await page.evaluate(() => window.__mcb.pixelRatio);
  check(pr >= 1 && pr <= 1.5, `${tag}pixel ratio capped (${pr} on a device scale of 3)`);
  check(/Tap the ground/.test(await page.evaluate(() => [...document.querySelectorAll('.hint span')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.textContent).join(''))), `${tag}touch hint shows`);

  // tap the ground to walk, double-tap to run
  const vp = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const p0 = await page.evaluate(() => window.__mcb.player());
  await page.touchscreen.tap(vp.w * 0.5, vp.h * 0.82);
  await page.waitForFunction((a) => { const p = window.__mcb.player(); return Math.hypot(p.x - a.x, p.z - a.z) > 0.05; }, p0, { timeout: 60000 }).then(() => check(true, `${tag}tap on the ground walks`)).catch(() => check(false, `${tag}tap on the ground walks`));
  await page.waitForTimeout(400);
  // software WebGL draws a few frames a second, so a double tap can land too slowly: try a few spots
  let ran = false;
  for (const [fx, fy] of [[0.35, 0.6], [0.65, 0.66], [0.5, 0.72]]) {
    await page.touchscreen.tap(vp.w * fx, vp.h * fy);
    await page.waitForTimeout(60);
    await page.touchscreen.tap(vp.w * fx, vp.h * fy);
    ran = await page.waitForFunction(() => window.__mcb.speed > 5, null, { timeout: 20000 }).then(() => true).catch(() => false);
    if (ran) break;
  }
  check(ran, `${tag}double-tap runs`);

  // passport
  await page.tap('.passport-btn');
  await page.waitForTimeout(400);
  await layout(page, 'passport open');
  await shot(page, 'passport');
  await page.tap('.passport-btn');

  const sizes = { here: start, there: other };
  for (const id of ['microscope', 'robot', 'drone', 'heroes', 'sky', 'cypher', 'badge']) {
    if (ONLY && !ONLY.has(id)) continue;
    const t0 = Date.now();
    await teleportAndPlay(page, id);
    await layout(page, `${id} levels`);
    let turned = false;
    const turn = async () => {
      if (turned) return;
      turned = true;
      await layout(page, `${id} mid-level`);
      await shot(page, `${id}-mid`);
      await turnTo(sizes.there)();
      await shot(page, `${id}-mid-turned`);
    };
    await STATIONS[id](page, turn, touch);
    await layout(page, `${id} level 1 done`);
    await shot(page, `${id}-done`);
    if (id === 'badge') await badgeDrag(page, touch);
    await backToBus(page);
    await layout(page, `hub after ${id}`);
    [sizes.here, sizes.there] = [sizes.there, sizes.here];
    console.log(`${tag}${id} done in ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  if (!ONLY || ONLY.has('drive')) await drive(page, touch, sizes.there);
  await ctx.close();
}

async function demoCheck() {
  tag = 'demo ';
  const ctx = await s.browser.newContext({ viewport: PORTRAIT, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const realSave = JSON.stringify({ v: 1, character: 'avatar_02', sound: true, flags: {}, badge: null,
    stations: { drone: { levels: { 1: 3, 2: 2, 3: 1 }, stamp: { skill: 'Used a loop' } }, robot: { levels: { 1: 3, 2: 3, 3: 3 }, stamp: { skill: "Planned a robot's moves" } } } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  s.watch(page, tag);
  await page.goto(`${s.base}/?debug`);
  await page.waitForSelector('.char', { timeout: LONG }); // let it finish loading before going on
  await page.evaluate((v) => localStorage.setItem('mcb-challenge-v1', v), realSave);
  // a wrong key is the normal game
  await page.goto(`${s.base}/?debug&demo=mcb-tour-28`);
  await page.waitForSelector('.char', { timeout: LONG });
  check(!/Demo mode/.test(await page.textContent('.select')), 'demo: a wrong key opens the normal game');
  await page.waitForTimeout(1500);

  await page.goto(`${s.base}/?debug&demo=${DEMO_KEY}`);
  await page.waitForSelector('.char', { timeout: LONG });
  check(/Demo mode/.test(await page.textContent('.select')), 'demo: character select shows first and says demo mode');
  check(await page.$('.char[aria-checked="true"]') === null, 'demo: no character picked from the real save');
  await page.tap('.char[data-id="avatar_01"]');
  await page.tap('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => window.__mcb.demo === true), 'demo: demo mode on');
  check(/6 of 6/.test(await page.getAttribute('.passport-btn', 'aria-label')), 'demo: six stamps');
  check(await page.evaluate(() => document.querySelector('.toast').hidden), 'demo: no "bus is ready" note');
  check(await page.evaluate(() => window.__mcb.driveSpot), 'demo: Drive the bus is unlocked');
  await page.tap('.passport-btn');
  const pass = (await page.textContent('.passport-list')).replace(/\s+/g, ' ');
  check(/Badge built/.test(pass) && /Drive the bus/.test(pass), 'demo: passport shows the badge built and the drive');
  await page.tap('.passport-btn');
  await shot(page, 'hub');
  await layout(page, 'hub with the Demo chip');

  await page.tap('.demo-chip');
  await page.waitForSelector('.demo-menu:not([hidden])');
  await layout(page, 'Demo menu open');
  await shot(page, 'menu');
  await page.tap('.demo-menu button:has-text("Robot Relay")');
  await page.waitForFunction(() => window.__mcb.nearRing === 'robot', null, { timeout: LONG });
  check(true, 'demo: menu jumps to Robot Relay');
  await page.tap('.prompt button');
  await page.waitForSelector('.level-card', { timeout: LONG });
  const open = await page.$$eval('.level-card', (b) => b.map((x) => !x.disabled));
  check(open.length === 3 && open.every(Boolean), `demo: every Robot Relay level is open (${open})`);
  // jump straight from inside a station to another one
  await page.tap('.demo-chip');
  await page.tap('.demo-menu button:has-text("Badge Builder")');
  await page.waitForFunction(() => window.__mcb.mode === 'hub' && window.__mcb.nearRing === 'badge', null, { timeout: LONG });
  await page.tap('.prompt button');
  await page.waitForSelector('button:has-text("See my badge")', { timeout: LONG });
  await page.tap('button:has-text("See my badge")');
  await page.waitForSelector('.bb-final', { timeout: LONG });
  check(/MCB-2Z9ZDEJD/.test(await page.inputValue('.bb-code')), 'demo: Badge Builder is open with the sample MCB badge');
  await shot(page, 'badge');
  await page.tap('.demo-chip');
  await page.tap('.demo-menu button:has-text("Drive the bus")');
  await page.waitForFunction(() => window.__mcb.mode === 'drive' && window.__mcb.drive, null, { timeout: LONG });
  check(true, 'demo: menu starts the drive');
  await page.waitForTimeout(1000);
  await layout(page, 'drive in demo mode');
  await shot(page, 'drive');
  await page.tap('.demo-chip');
  await page.tap('.demo-menu button:has-text("Exit demo")');
  await page.waitForURL((u) => !/demo=/.test(u.search), { timeout: 60000 });
  await page.waitForSelector('.char', { timeout: LONG });
  check(!/Demo mode/.test(await page.textContent('.select')), 'demo: Exit demo goes back to the normal game');
  check((await page.getAttribute('.char[aria-checked="true"]', 'data-id')) === 'avatar_02', 'demo: the real character is picked again');
  const after = await page.evaluate(() => localStorage.getItem('mcb-challenge-v1'));
  const stamps = Object.values(JSON.parse(after).stations).filter((st) => st.stamp).length;
  check(after === realSave && stamps === 2, `demo: the real save is untouched and still has exactly two stamps (${stamps})`);
  await page.tap('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
  check(/2 of 6/.test(await page.getAttribute('.passport-btn', 'aria-label')) && !(await page.$('.demo-chip')), 'demo: normal game shows 2 of 6 and no Demo chip');
  await ctx.close();
}

const t0 = Date.now();
try {
  if (!process.env.SKIP_PHONE) {
    await phoneRun(PORTRAIT, LANDSCAPE);
    await phoneRun(LANDSCAPE, PORTRAIT);
  }
  if (!process.env.SKIP_DEMO) await demoCheck();
  console.log(`total time ${Math.round((Date.now() - t0) / 60000)} min`);
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
