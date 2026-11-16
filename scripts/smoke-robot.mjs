// Robot Relay browser smoke: serves /tmp/dist-a, walks to the ring, plays all
// three levels (level 1 with one deliberate mistake, then a clean keyboard run),
// checks the stamp, a phone layout and console errors. Screens go to screens/robot/.
import { startSmoke } from './smoke-common.mjs';
import { LEVELS } from '../src/stations/robot/levels.js';
import { solve } from '../src/stations/robot/solver.js';

const s = await startSmoke({ port: 4181, screens: 'screens/robot' });
const shot = s.shot;
// RB_Tray's child meshes: the dark plate stays, the small modelled pieces hide in the station.
const trayState = (page) => page.evaluate(() => {
  const t = window.__mcb.scene.getObjectByName('RB_Tray');
  if (!t) return 'no RB_Tray';
  const out = [];
  t.traverse((o) => { if (o.isMesh) out.push(`${o.material.name}:${o.visible ? 'shown' : 'hidden'}`); });
  return out.join(' ');
});
const label = { left: 'left', right: 'right', reach: 'reach', grip: 'grip', release: 'release' };
try {
  const page = await s.browser.newPage({ viewport: { width: 1366, height: 768 } });
  s.watch(page);
  await s.enterHub(page);
  // walk there by clicking (double click runs)
  await page.evaluate(() => window.__mcb.walkToStation('robot'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'robot', null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await shot(page, '01-ring');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.level-card', { timeout: 30000 });
  await page.waitForTimeout(1300);
  await shot(page, '02-levels');
  console.log('tray in station:', await trayState(page));
  console.log('hub arm hidden:', await page.evaluate(() => window.__mcb.drawCalls));
  await page.click('.level-card[data-level="1"]');
  page.setDefaultTimeout(120000);
  // keyboard adds: no waiting for the page to be "stable" between software-GL frames
  const add = async (types) => { for (const t of types) { await page.focus(`.bq-palette [data-type="${label[t]}"]`); await page.keyboard.press('Enter'); } };
  const runAndWait = async (midShot) => {
    await page.click('button.run');
    if (midShot) { await page.waitForTimeout(midShot.at); await shot(page, midShot.name); }
    await page.waitForFunction(() => !document.querySelector('button.run')?.hidden || /cleared/.test(document.querySelector('.panel-body h2')?.textContent || ''), null, { timeout: 400000 });
    await page.waitForTimeout(400);
  };
  // Level 1, deliberate mistake: one turn right puts the prism over the circle bin
  await add(['reach', 'grip', 'right', 'reach', 'release']);
  await shot(page, '03-l1-program');
  await runAndWait({ at: 2600, name: '04-l1-mid' });
  await shot(page, '05-l1-miss');
  console.log('miss message:', await page.textContent('.message'));
  console.log('marked move:', await page.$eval('.is-error', (e) => e.textContent));
  // clean run, keyboard only
  await page.click('text=Clear');
  const kb = async (type) => { await page.focus(`.bq-palette [data-type="${type}"]`); await page.keyboard.press('Enter'); };
  for (const t of ['reach', 'grip', 'right', 'right', 'reach', 'release']) await kb(t);
  await page.focus('button.run');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /cleared/.test(document.querySelector('.panel-body h2')?.textContent || ''), null, { timeout: 400000 });
  await page.waitForTimeout(400);
  await shot(page, '06-l1-cleared');
  console.log('L1:', await page.textContent('.panel-body h2'), await page.getAttribute('.result-stars .stars', 'aria-label'));
  for (const id of [2, 3]) {
    await page.click(`text=Next: Level ${id}`);
    await page.waitForTimeout(600);
    const sol = solve(LEVELS[id - 1]);
    await add(sol.moves);
    await shot(page, String(5 + id * 2).padStart(2, '0') + `-l${id}-program`);
    await runAndWait({ at: id === 3 ? 9000 : 6000, name: String(6 + id * 2).padStart(2, '0') + `-l${id}-mid` });
    console.log(`L${id}:`, await page.textContent('.panel-body h2'), await page.getAttribute('.result-stars .stars', 'aria-label').catch(() => 'none'));
  }
  await page.waitForSelector('.stamp-card', { timeout: 10000 });
  await shot(page, '11-stamp');
  console.log('stamp:', await page.textContent('.stamp-card'));
  await page.click('.stamp-card button');
  // the barrier: replay level 3 with a wrong turn
  await page.click('text=Try again');
  await page.click('text=Clear');
  await add(['reach', 'grip', 'left']);
  await runAndWait();
  await shot(page, '12-l3-barrier');
  console.log('barrier message:', await page.textContent('.message'));
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub');
  await page.waitForTimeout(800);
  await shot(page, '13-hub-after');
  console.log('passport:', await page.textContent('.passport-btn'));
  console.log('tray after:', await trayState(page));
  console.log('hub arm restored:', await page.evaluate(() => window.__mcb.info().calls));

  // phone landscape, touch only
  const phone = await s.browser.newPage({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true });
  s.watch(phone, 'phone ');
  await phone.goto(`${s.base}/?debug`);
  await phone.waitForSelector('.char', { timeout: 90000 });
  await phone.tap('.char[data-id="avatar_05"]');
  await phone.tap('button.big');
  await phone.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await phone.evaluate(() => window.__mcb.walkToStation('robot'));
  await phone.waitForFunction(() => window.__mcb.nearRing === 'robot', null, { timeout: 60000 });
  await phone.tap('.prompt button');
  await phone.waitForSelector('.level-card');
  await phone.tap('.level-card[data-level="1"]');
  await phone.waitForTimeout(1200);
  for (const t of ['reach', 'grip', 'left', 'left', 'reach', 'release']) await phone.tap(`.bq-palette [data-type="${t}"]`);
  await shot(phone, '14-phone-program');
  await phone.tap('button.run');
  await phone.waitForFunction(() => /cleared/.test(document.querySelector('.panel-body h2')?.textContent || ''), null, { timeout: 400000 });
  await shot(phone, '15-phone-cleared');
  console.log('external requests:', s.external.length ? s.external : 'none');
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  process.exitCode = 1;
} finally {
  console.log('console errors/warnings:', s.errors.length ? s.errors : 'none');
  await s.close();
}
