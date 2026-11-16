// End-to-end browser run of the whole game, built in dist/ (npm run build first).
// Fresh save, pick a character, walk to each of the six stamp stations and clear
// all three levels, confirm six stamps, open Badge Builder, build a badge, reload
// and confirm progress and the badge are kept. Between stations it checks for
// state one station could leave behind for the next: hub objects, ring labels,
// panel and station layers, camera, global listeners, GPU memory.
// Screenshots go to screens/all/. Fails on console errors or outside requests.
//
//   npm run build && node scripts/smoke-all.mjs
import { readFileSync } from 'node:fs';
import { startSmoke } from './smoke-common.mjs';
import { LEVELS as ROBOT_LEVELS } from '../src/stations/robot/levels.js';
import { solve as solveRobot } from '../src/stations/robot/solver.js';

process.env.DIST ||= 'dist';
const s = await startSmoke({ port: 4310, screens: 'screens/all' });
const heroes = JSON.parse(readFileSync('src/stations/heroes/content.json', 'utf8'));
const MICRO = [['salt', 'hair', 'hooks'], ['pollen', 'wing', 'leaf'], ['paper', 'cotton', 'graphite']];
const MICRO_ANSWER = { salt: 'Table salt', hair: 'A strand of hair', hooks: 'Hook-and-loop tape', pollen: 'Sunflower pollen', wing: 'Butterfly wing', leaf: 'Leaf surface', paper: 'Paper', cotton: 'Cotton fabric', graphite: 'Pencil tip' };
const LONG = 400000; // software WebGL runs at a few frames a second
let n = 0;
const shot = (page, name) => s.shot(page, `${String(++n).padStart(2, '0')}-${name}`);
const problems = [];
const check = (ok, what) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`); if (!ok) problems.push(what); };

// Count global listeners added and removed on window and document, by type.
const LISTENER_SPY = () => {
  const counts = (window.__listeners = {});
  for (const target of [window, document]) {
    const tag = target === window ? 'window' : 'document';
    const add = target.addEventListener.bind(target), rem = target.removeEventListener.bind(target);
    const seen = new Set();
    target.addEventListener = (type, fn, opt) => { const k = `${tag}:${type}`; if (!seen.has(fn)) { seen.add(fn); counts[k] = (counts[k] || 0) + 1; } return add(type, fn, opt); };
    target.removeEventListener = (type, fn, opt) => { const k = `${tag}:${type}`; if (seen.has(fn)) { seen.delete(fn); counts[k] -= 1; } return rem(type, fn, opt); };
  }
};

/** Hub state that every station must hand back unchanged. */
const hubState = (page) => page.evaluate(() => {
  const m = window.__mcb;
  const sc = m.scene;
  const labels = sc.children.filter((o) => o.isSprite);
  const hidden = [];
  sc.traverse((o) => { if (o.isMesh && !o.visible && o.parent && o.parent.visible) hidden.push(o.name || o.material?.name || '?'); });
  return {
    mode: m.mode,
    children: sc.children.length,
    labelsShown: labels.filter((l) => l.visible).length,
    labels: labels.length,
    hiddenMeshes: hidden.sort().join(','),
    panelHidden: document.getElementById('station-panel').hidden,
    layers: ['.mm-stage', '.cy-stage', '.sky-stage', '.bb-overlay', '.bb-ghost'].filter((q) => document.querySelector(q)).join(','),
    listeners: JSON.stringify(Object.fromEntries(Object.entries(window.__listeners).filter(([, v]) => v !== 0).sort())),
    mem: m.mem(),
    table: sc.getObjectByName('MCB_AR_Top')?.position.z.toFixed(2),
    viewOffset: !!m.camera.view?.enabled,
  };
});

async function walkIn(page, id) {
  await page.evaluate((i) => window.__mcb.walkToStation(i), id);
  await page.waitForFunction((i) => window.__mcb.nearRing === i, id, { timeout: LONG });
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.level-card', { timeout: LONG });
  await page.waitForTimeout(1200);
  check(await page.evaluate(() => window.__mcb.scene.children.filter((o) => o.isSprite && o.visible && o.material.depthTest === false).length === 0), `${id}: ring labels hidden while the station is open`);
}

async function stampAndLeave(page, id, base) {
  await page.waitForSelector('.stamp-card', { timeout: 60000 });
  await page.waitForTimeout(500);
  await shot(page, `${id}-stamp`);
  const card = (await page.textContent('.stamp-card')).replace(/\s+/g, ' ');
  console.log(`${id} stamp card:`, card);
  check(/Stamp earned/.test(card), `${id}: stamp card shows`);
  await page.click('.stamp-card button');
  const stars = await page.$$eval('.level-card, .result-stars .stars', (e) => e.map((x) => x.getAttribute('aria-label')).filter(Boolean));
  console.log(`${id} result:`, stars.join(' | '));
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await page.waitForTimeout(1000);
  await shot(page, `${id}-hub-after`);
  const st = await hubState(page);
  console.log(`${id} hub after:`, JSON.stringify(st));
  check(st.panelHidden && !st.layers, `${id}: panel closed and station layers removed`);
  check(st.labelsShown === st.labels, `${id}: ring labels shown again`);
  check(st.children === base.children, `${id}: scene has the same top-level objects as before (${st.children} vs ${base.children})`);
  check(st.hiddenMeshes === base.hiddenMeshes, `${id}: no hub meshes left hidden`);
  check(st.listeners === base.listeners, `${id}: no global listeners left behind (${st.listeners})`);
  check(st.table === base.table, `${id}: hologram table back in place`);
  check(!st.viewOffset, `${id}: camera view offset cleared`);
  check(st.mem.geometries <= base.mem.geometries + 6 && st.mem.textures <= base.mem.textures + 2, `${id}: GPU memory back near the hub level (geometries ${st.mem.geometries} vs ${base.mem.geometries}, textures ${st.mem.textures} vs ${base.mem.textures})`);
  return st;
}

// ---------------------------------------------------------------- stations
async function playMicroscope(page) {
  for (let lv = 1; lv <= 3; lv++) {
    if (lv === 1) await page.click('.level-card[data-level="1"]');
    else await page.click(`text=Next: Level ${lv}`);
    for (const [i, sp] of MICRO[lv - 1].entries()) {
      await page.waitForSelector('.mm-answer:not([disabled])', { timeout: LONG });
      await page.waitForTimeout(300);
      if (lv === 2 && i === 0) {
        // the pause card must sit above the microscope's picture layer
        await page.keyboard.press('Escape');
        await page.waitForSelector('text=Keep playing');
        await shot(page, 'microscope-paused');
        const top = await page.evaluate(() => { const c = document.querySelector('.overlay .card').getBoundingClientRect(); const el = document.elementFromPoint(c.left + 10, c.bottom - 10); return !!el?.closest('.overlay'); });
        check(top, 'pause card is on top of the station layer');
        await page.click('text=Keep playing');
      }
      if (lv === 2 && i === 1) await shot(page, 'microscope-wing-closest');
      await page.click(`.mm-answer[data-choice="${MICRO_ANSWER[sp]}"]`);
      const nextText = i < 2 ? 'Next object' : 'See your stars';
      await page.waitForSelector(`text=${nextText}`, { timeout: LONG });
      await page.click(`text=${nextText}`);
    }
    await page.waitForSelector('.result-stars', { timeout: LONG });
  }
}

async function playRobot(page) {
  const add = async (types) => { for (const t of types) { await page.focus(`.bq-palette [data-type="${t}"]`); await page.keyboard.press('Enter'); } };
  for (let lv = 1; lv <= 3; lv++) {
    if (lv === 1) await page.click('.level-card[data-level="1"]');
    else await page.click(`text=Next: Level ${lv}`);
    await page.waitForTimeout(600);
    await add(solveRobot(ROBOT_LEVELS[lv - 1]).moves);
    if (lv === 3) await shot(page, 'robot-l3-program');
    await page.click('button.run');
    await page.waitForFunction((l) => new RegExp(`Level ${l} cleared`).test(document.querySelector('.panel-body h2')?.textContent || ''), lv, { timeout: LONG });
  }
}

async function playDrone(page) {
  const add = async (type, k = 1) => { for (let i = 0; i < k; i++) await page.click(`.bq-palette [data-type="${type}"]`); };
  const run = async (lv) => {
    await page.click('button.run');
    await page.waitForFunction((l) => new RegExp(`Level ${l} cleared`).test(document.querySelector('.panel-body h2')?.textContent || ''), lv, { timeout: LONG });
  };
  await page.click('.level-card[data-level="1"]');
  await add('takeoff'); await add('forward', 3); await add('land');
  await run(1);
  await page.click('text=Next: Level 2');
  await add('takeoff'); await add('forward', 2); await add('right'); await add('forward', 2); await add('land');
  await run(2);
  await page.click('text=Next: Level 3');
  await add('takeoff'); await add('repeat'); await add('forward', 2); await add('right');
  await page.click('.bq-plus');
  await page.click('.bq-inside');
  await add('land');
  await shot(page, 'drone-l3-program');
  await run(3);
}

async function playHeroes(page) {
  const rounds = (lv) => heroes.rounds.filter((r) => r.level === lv);
  for (let lv = 1; lv <= 3; lv++) {
    if (lv === 1) await page.click('.level-card[data-level="1"]');
    else await page.click(`text=Next: Level ${lv}`);
    for (const [i, r] of rounds(lv).entries()) {
      await page.waitForSelector('.hh-choice', { timeout: LONG });
      if (i === 0) { await page.waitForTimeout(1500); await shot(page, `heroes-l${lv}-choices`); }
      await page.click(`.hh-choice[data-prop="${r.answer}"]`);
      await page.waitForSelector('.hh-person', { timeout: LONG });
      await page.click('text=Meet someone working today');
      await page.waitForSelector('.hh-yourstep', { timeout: LONG });
      await page.click(i === 0 ? 'text=Next round' : 'text=Finish the level');
    }
    await page.waitForSelector('.result-stars', { timeout: LONG });
  }
}

async function playSky(page) {
  const center = async (id, maxLooks = 6) => {
    for (let k = 0; k < maxLooks; k++) {
      const a = await page.evaluate((i) => window.__sky.aim(i), id);
      const r = await page.evaluate(() => window.__sky.rect());
      const dist = Math.hypot(a.x, a.y);
      if (a.ok && dist < r.d * 0.012) return;
      const f = Math.min(1, (r.d * 0.4) / dist);
      const sx = r.x + a.x * f, sy = r.y + a.y * f;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let t = 1; t <= 6; t++) await page.mouse.move(sx + (r.x - sx) * t / 6, sy + (r.y - sy) * t / 6);
      await page.mouse.up();
      await page.waitForTimeout(150);
    }
  };
  const zoom = (z) => page.click(`.sky-zoom[data-zoom="${z}"]`);
  await page.click('.level-card[data-level="1"]');
  await page.waitForTimeout(500);
  await center('moon'); await zoom('low'); await center('moon'); await zoom('high'); await center('tycho');
  await page.click('.sky-confirm');
  await page.waitForSelector('text=Level 1 cleared', { timeout: LONG });
  await page.click('text=Next: Level 2');
  await page.waitForTimeout(400);
  await center('Alpheratz'); await center('Algenib'); await center('saturn');
  await zoom('low'); await center('saturn'); await zoom('high'); await center('saturn');
  await page.click('.sky-confirm');
  await page.waitForSelector('text=Level 2 cleared', { timeout: LONG });
  await page.click('text=Next: Level 3');
  await page.waitForTimeout(400);
  await center('Alpheratz'); await center('Mirach'); await zoom('low'); await center('Mu Andromedae'); await center('m31');
  await shot(page, 'sky-l3-m31');
  await page.click('.sky-confirm');
}

const CAL_SCRIPT = (late) => { const spb = 60 / 90; for (const k of [4, 5, 6, 7]) window.__cypher.calTapAt(k * spb + late); return 4; };
const PLAY_SCRIPT = () => new Promise((resolve) => {
  const done = new Set();
  const t0 = performance.now();
  const step = () => {
    const c = window.__cypher;
    if (!c || c.mode !== 'play') { resolve(c && c.mode); return; }
    if (performance.now() - t0 > 380000) { resolve('timeout'); return; }
    const sl = c.slot;
    if (sl >= 0 && !done.has(sl) && !c.tapped && c.now() > c.star() - 0.9) {
      done.add(sl);
      c.tapAt(c.answerIndex(), c.star() + c.offset + 0.04);
    }
    setTimeout(step, 30);
  };
  step();
});

async function playCypher(page) {
  for (let lv = 1; lv <= 3; lv++) {
    if (lv === 1) await page.click('.level-card[data-level="1"]');
    else await page.click(`text=Next: Level ${lv}`);
    const first = await Promise.race([
      page.waitForSelector('text=Start the timing check', { timeout: LONG }).then(() => 'calib'),
      page.waitForSelector('text=Play the verse', { timeout: LONG }).then(() => 'play'),
    ]);
    if (first === 'calib') {
      await page.click('text=Start the timing check');
      await page.waitForFunction(() => window.__cypher.mode === 'calib');
      await page.evaluate(CAL_SCRIPT, 0.06);
      await page.waitForSelector('text=Timing check done', { timeout: LONG });
      await page.click('text=Use this');
      await page.waitForSelector('text=Play the verse');
    }
    await page.click('text=Play the verse');
    const p = page.evaluate(PLAY_SCRIPT);
    if (lv === 1) {
      await page.waitForFunction(() => window.__cypher.line === 1 && window.__cypher.slot >= 1, null, { timeout: LONG });
      await shot(page, 'cypher-l1-ruska-line');
      console.log('cypher line 2:', await page.textContent('.cy-line'));
    }
    console.log(`cypher L${lv} run:`, await p);
    await page.waitForSelector('.result-stars', { timeout: LONG });
  }
}

async function badgePreview(page, orient) {
  await page.click(`[data-orient="${orient}"]`);
  await page.click('.bb-go');
  await page.waitForTimeout(1500);
  await page.click('text=Skip to the end', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => { const b = document.querySelector('.bb-go'); return !b || !b.hidden; }, null, { timeout: LONG });
  await page.waitForTimeout(400);
}

async function playBadge(page) {
  await page.click('.level-card[data-level="1"]');
  await page.click('[data-emblem="gear"]');
  await page.click('text=Next: place it on the bed');
  await page.waitForSelector('.bb-orient');
  await badgePreview(page, 'flat');
  await page.waitForSelector('text=Level 1 printed', { timeout: LONG });
  await page.click('text=Next: Level 2');
  await page.waitForSelector('.bb-orient');
  await badgePreview(page, 'edge');
  await page.waitForSelector('text=Level 2 printed', { timeout: LONG });
  await page.click('text=Next: Level 3');
  await page.click('[data-shape="shield"]');
  await page.click('text=Next: Colors');
  await page.click('[aria-label="Badge color"] [data-color="teal"]');
  await page.click('[aria-label="Raised parts color"] [data-color="yellow"]');
  await page.click('text=Next: Emblems');
  const order = ['cell', 'gear', 'drone', 'spark', 'planet', 'wave'];
  for (let i = 0; i < order.length; i++) {
    await page.click(`.bb-emblem[data-emblem="${order[i]}"]`);
    await page.click(`.bb-spot[data-slot="${i}"]`);
  }
  await shot(page, 'badge-l3-emblems');
  await page.click('text=Next: Initials');
  await page.selectOption('#bb-letter-0', 'M');
  await page.selectOption('#bb-letter-1', 'C');
  await page.selectOption('#bb-letter-2', 'B');
  await page.click('text=Next: Print');
  await page.waitForSelector('.bb-orient');
  await page.click('[data-orient="flat"]');
  await page.click('.bb-go');
  await page.waitForTimeout(1500);
  await page.click('text=Skip to the end', { timeout: 5000 }).catch(() => {});
  await page.waitForSelector('.bb-final', { timeout: LONG });
  await page.waitForTimeout(800);
  await shot(page, 'badge-finished');
  const text = (await page.textContent('.panel-body')).replace(/\s+/g, ' ');
  check(!/print your badge|bus can/i.test(text), 'badge: finished screen makes no printing promise');
  return page.inputValue('.bb-code');
}

// ---------------------------------------------------------------- run
const STAMP_RUN = [
  ['microscope', playMicroscope], ['robot', playRobot], ['drone', playDrone],
  ['heroes', playHeroes], ['sky', playSky], ['cypher', playCypher],
];
const t0 = Date.now();
try {
  const ctx = await s.browser.newContext({ viewport: { width: 1366, height: 768 } });
  await ctx.addInitScript(LISTENER_SPY);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  s.watch(page);
  await page.goto(`${s.base}/?debug`);
  await page.waitForSelector('.char', { timeout: LONG });
  check(await page.evaluate(() => !localStorage.getItem('mcb-challenge-v1') || !JSON.parse(localStorage.getItem('mcb-challenge-v1')).character), 'fresh save');
  await shot(page, 'select');
  await page.click('.char[data-id="avatar_05"]');
  await page.click('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
  await page.waitForTimeout(1500);
  await shot(page, 'hub-start');
  const base = await hubState(page);
  console.log('hub at start:', JSON.stringify(base));
  for (const [id, play] of STAMP_RUN) {
    const ts = Date.now();
    await walkIn(page, id);
    await shot(page, `${id}-levels`);
    await play(page);
    await stampAndLeave(page, id, base);
    const pass = await page.textContent('.passport-btn');
    console.log(`${id} done in ${Math.round((Date.now() - ts) / 1000)} s. ${pass}`);
  }
  const pass = await page.textContent('.passport-btn');
  check(/6 of 6/.test(pass), `six stamps (${pass})`);
  await page.click('.passport-btn');
  await page.waitForTimeout(400);
  await shot(page, 'passport-six');
  await page.click('.passport-btn');

  // Badge Builder unlocks
  await page.evaluate(() => window.__mcb.walkToStation('badge'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'badge', null, { timeout: LONG });
  const prompt = (await page.textContent('.prompt')).replace(/\s+/g, ' ');
  check(!/locked/i.test(prompt), `Badge Builder unlocked (${prompt.trim()})`);
  await page.click('.prompt button');
  await page.waitForSelector('.level-card', { timeout: LONG });
  await page.waitForTimeout(1200);
  const code = await playBadge(page);
  console.log('badge code:', code);
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub');
  await page.waitForTimeout(800);
  const after = await hubState(page);
  check(after.hiddenMeshes === base.hiddenMeshes && !after.layers && after.children === base.children, 'badge: hub restored after leaving');
  const saved = await page.evaluate(() => ({ save: JSON.parse(localStorage.getItem('mcb-challenge-v1')), old: localStorage.getItem('mcb-badge-builder-v1') }));
  check(saved.save.badge?.code === code && !saved.old, 'badge stored in the shared save');

  // Reload: progress and badge persist
  await page.reload();
  await page.waitForSelector('.char[aria-checked="true"]', { timeout: LONG });
  check((await page.getAttribute('.char[aria-checked="true"]', 'data-id')) === 'avatar_05', 'character kept after reload');
  await page.click('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: LONG });
  const pass2 = await page.textContent('.passport-btn');
  check(/6 of 6/.test(pass2), `stamps kept after reload (${pass2})`);
  await page.evaluate(() => window.__mcb.walkToStation('badge'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'badge', null, { timeout: LONG });
  await page.click('.prompt button');
  await page.waitForSelector('text=See my badge', { timeout: LONG });
  await page.click('text=See my badge');
  await page.waitForSelector('.bb-final', { timeout: LONG });
  await page.waitForTimeout(600);
  await shot(page, 'badge-after-reload');
  check((await page.inputValue('.bb-code')) === code, 'same badge code after reload');
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
