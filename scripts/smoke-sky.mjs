// Sky Seeker browser smoke: serves /tmp/dist-a, walks to the telescope ring,
// plays all three levels with real drags, arrow presses and keys (level 1 with
// a deliberate wrong Confirm first), checks the stamp, a phone layout and
// console errors. Screens go to screens/sky/.
import { startSmoke } from './smoke-common.mjs';

const s = await startSmoke({ port: 4185, screens: 'screens/sky' });
const shot = s.shot;
try {
  const page = await s.browser.newPage({ viewport: { width: 1366, height: 768 } });
  s.watch(page);
  await s.enterHub(page);
  await page.evaluate(() => window.__mcb.walkToStation('sky'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'sky', null, { timeout: 60000 });
  await page.waitForTimeout(300);
  await shot(page, '01-ring');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.level-card', { timeout: 30000 });
  await page.waitForTimeout(1800);
  await shot(page, '02-levels');

  /** Drag the sky so object `id` comes to the middle, in hops no longer than 40% of the eyepiece. */
  const center = async (id, maxLooks = 6) => {
    for (let n = 0; n < maxLooks; n++) {
      const a = await page.evaluate((i) => window.__sky.aim(i), id);
      const r = await page.evaluate(() => window.__sky.rect());
      const dist = Math.hypot(a.x, a.y);
      if (a.ok && dist < r.d * 0.012) return;
      const k = Math.min(1, (r.d * 0.4) / dist);
      const sx = r.x + a.x * k, sy = r.y + a.y * k;
      await page.mouse.move(sx, sy);
      await page.mouse.down();
      for (let t = 1; t <= 6; t++) await page.mouse.move(sx + (r.x - sx) * t / 6, sy + (r.y - sy) * t / 6);
      await page.mouse.up();
      await page.waitForTimeout(150);
    }
  };
  const zoom = (z) => page.click(`.sky-zoom[data-zoom="${z}"]`);
  const looks = () => page.evaluate(() => window.__sky.state.looks);

  // ---- level 1 ----
  await page.click('.level-card[data-level="1"]');
  await page.waitForTimeout(500);
  await shot(page, '03-l1-start');
  await center('moon');
  await shot(page, '04-l1-moon-finder');
  await zoom('low'); await center('moon'); await page.waitForTimeout(200);
  await shot(page, '05-l1-moon-low');
  await zoom('high'); await page.waitForTimeout(200);
  await shot(page, '06-l1-moon-high');
  // deliberate mistake: confirm on the middle of the Moon, not on Tycho
  await page.click('.sky-confirm');
  await page.waitForTimeout(300);
  console.log('L1 wrong confirm:', await page.textContent('.message'));
  await shot(page, '07-l1-wrong');
  await center('tycho');
  await shot(page, '08-l1-tycho');
  await page.click('.sky-confirm');
  await page.waitForSelector('text=Level 1 cleared', { timeout: 20000 });
  await page.waitForTimeout(300);
  await shot(page, '09-l1-cleared');
  console.log('L1:', await page.getAttribute('.result-stars .stars', 'aria-label'));
  // clean run of level 1 for three stars
  await page.click('text=Try again');
  await center('moon'); await zoom('low'); await center('moon'); await zoom('high'); await center('tycho');
  console.log('L1 clean looks:', await looks());
  await page.click('.sky-confirm');
  await page.waitForSelector('text=Level 1 cleared', { timeout: 20000 });
  console.log('L1 clean:', await page.getAttribute('.result-stars .stars', 'aria-label'));

  // ---- level 2: keyboard for the first look ----
  await page.click('text=Next: Level 2');
  await page.waitForTimeout(400);
  await page.focus('.sky-canvas');
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(1600); await page.keyboard.up('ArrowLeft');
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(700); await page.keyboard.up('ArrowUp');
  console.log('L2 after keys, looks:', await looks());
  await shot(page, '10-l2-keys');
  await center('Alpheratz');
  await shot(page, '11-l2-alpheratz');
  await center('Algenib');
  await center('saturn');
  await shot(page, '12-l2-saturn-finder');
  await zoom('low'); await center('saturn');
  await zoom('high'); await center('saturn'); await page.waitForTimeout(200);
  await shot(page, '13-l2-saturn-high');
  await page.click('.sky-confirm');
  await page.waitForSelector('text=Level 2 cleared', { timeout: 20000 });
  await page.waitForTimeout(300);
  await shot(page, '14-l2-cleared');
  console.log('L2:', await page.getAttribute('.result-stars .stars', 'aria-label'), 'looks', await looks());

  // ---- level 3 ----
  await page.click('text=Next: Level 3');
  await page.waitForTimeout(400);
  await shot(page, '15-l3-start');
  await center('Alpheratz');
  await center('Mirach');
  await zoom('low');
  await center('Mu Andromedae');
  await shot(page, '16-l3-mu-low');
  await center('m31');
  await shot(page, '17-l3-m31-low');
  await page.click('.sky-confirm');
  await page.waitForSelector('.stamp-card', { timeout: 20000 });
  await shot(page, '18-stamp');
  console.log('stamp:', await page.textContent('.stamp-card'));
  await page.click('.stamp-card button');
  console.log('L3:', await page.getAttribute('.result-stars .stars', 'aria-label'), 'looks', await looks());
  await shot(page, '19-l3-cleared');
  // lost at High: Finder pulses
  await page.click('text=Try again');
  await zoom('high');
  await page.waitForTimeout(300);
  console.log('lost tip shown:', await page.isVisible('.sky-lost'));
  await shot(page, '20-l3-lost-high');
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub');
  console.log('overlay removed:', !(await page.$('.sky-stage')), 'passport:', await page.textContent('.passport-btn'));
  await shot(page, '21-hub-after');

  // ---- phone landscape, touch only ----
  const phone = await s.browser.newPage({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true });
  s.watch(phone, 'phone ');
  await phone.goto(`${s.base}/?debug`);
  await phone.waitForSelector('.char', { timeout: 90000 });
  await phone.tap('.char[data-id="avatar_05"]');
  await phone.tap('button.big');
  await phone.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await phone.evaluate(() => window.__mcb.walkToStation('sky'));
  await phone.waitForFunction(() => window.__mcb.nearRing === 'sky', null, { timeout: 60000 });
  await phone.tap('.prompt button');
  await phone.waitForSelector('.level-card');
  await phone.tap('.level-card[data-level="1"]');
  await phone.waitForTimeout(1500);
  await phone.tap('.sky-right'); await phone.tap('.sky-right'); await phone.tap('.sky-zoom[data-zoom="low"]');
  await phone.waitForTimeout(300);
  console.log('phone looks after two taps:', await phone.evaluate(() => window.__sky.state.looks));
  await shot(phone, '22-phone');
  console.log('external requests:', s.external.length ? s.external : 'none');
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  process.exitCode = 1;
} finally {
  console.log('console errors/warnings:', s.errors.length ? s.errors : 'none');
  await s.close();
}
