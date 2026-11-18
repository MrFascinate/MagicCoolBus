// Browser smoke test: builds must exist in dist/. Serves dist with vite preview,
// drives the real UI in Chrome with software WebGL, saves screenshots.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const exe = process.env.CHROME || '/usr/bin/google-chrome';
const PORT = 4179;
mkdirSync('screens', { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));

const errors = [];
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const shot = (page, n) => { console.log('shot', n); return page.screenshot({ path: `screens/${n}.png` }); };
try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`); });
  page.on('requestfailed', (r) => errors.push(`requestfailed: ${r.url()}`));
  const external = [];
  page.on('request', (r) => { if (!r.url().startsWith(`http://localhost:${PORT}`) && !r.url().startsWith('data:') && !r.url().startsWith('blob:')) external.push(r.url()); });

  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForSelector('.char', { timeout: 90000 });
  await page.waitForTimeout(800);
  await shot(page, '01-select');
  const chars = await page.$$eval('.char', (b) => b.map((x) => x.textContent));
  console.log('characters:', chars.join(' | '));
  await page.click('.char[data-id="avatar_03"]');
  await page.click('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await shot(page, '02-hub');
  console.log('draw calls:', await page.evaluate(() => window.__mcb.info().calls), 'triangles:', await page.evaluate(() => window.__mcb.info().triangles));

  // walk with the keyboard a little, then path to the drone ring
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(600); await page.keyboard.up('ArrowUp');
  await page.evaluate(() => window.__mcb.walkToStation('drone'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'drone', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await shot(page, '03-drone-ring');
  console.log('fps in hub (software GL):', (await page.evaluate(() => window.__mcb.fps)).toFixed(1));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.level-card', { timeout: 30000 });
  await page.waitForTimeout(1300);
  await shot(page, '04-levels');
  await page.click('.level-card[data-level="1"]');
  const add = async (type, n = 1) => { for (let i = 0; i < n; i++) await page.click(`.bq-palette [data-type="${type}"]`); };
  const runAndWait = async () => {
    await page.click('button.run');
    await page.waitForFunction(() => !document.querySelector('button.run')?.hidden || /cleared/.test(document.querySelector('.panel-body h2')?.textContent || ''), null, { timeout: 60000 });
    await page.waitForTimeout(300);
  };
  // a miss: flies into the net
  await add('takeoff'); await add('forward', 5); await add('land');
  await shot(page, '05-program');
  await runAndWait();
  await shot(page, '06-miss-net');
  console.log('miss message:', await page.textContent('.message'));
  console.log('marked block:', await page.$eval('.is-error', (e) => e.textContent));
  // fix it
  await page.click('text=Clear');
  await add('takeoff'); await add('forward', 3); await add('land');
  await runAndWait();
  await shot(page, '07-level1-cleared');
  console.log('L1:', await page.textContent('.panel-body h2'), await page.getAttribute('.result-stars .stars', 'aria-label'));
  // level 2
  await page.click('text=Next: Level 2');
  await add('takeoff'); await add('forward', 2); await add('right'); await add('forward', 2); await add('land');
  await runAndWait();
  console.log('L2:', await page.textContent('.panel-body h2'), await page.getAttribute('.result-stars .stars', 'aria-label'));
  // level 3 with a loop
  await page.click('text=Next: Level 3');
  await add('takeoff'); await add('repeat'); await add('forward', 2); await add('right');
  await page.click('.bq-plus');
  await page.click('.bq-inside');
  await add('land');
  await shot(page, '08-level3-program');
  await runAndWait();
  await page.waitForSelector('.stamp-card', { timeout: 10000 });
  await shot(page, '09-stamp');
  console.log('stamp:', await page.textContent('.stamp-card'));
  await page.click('.stamp-card button');
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub');
  await page.waitForTimeout(800);
  await shot(page, '10-hub-after');
  console.log('passport:', await page.textContent('.passport-btn'));

  // badge locked
  await page.evaluate(() => window.__mcb.walkToStation('badge'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'badge', null, { timeout: 60000 });
  console.log('badge prompt:', await page.textContent('.prompt'));

  // saved progress survives a reload, and the saved character is preselected
  await page.reload();
  await page.waitForSelector('.char[aria-checked="true"]', { timeout: 90000 });
  console.log('preselected after reload:', await page.getAttribute('.char[aria-checked="true"]', 'data-id'));
  await page.click('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  console.log('after reload:', await page.textContent('.passport-btn'));

  // phone landscape layout, touch only
  const phone = await browser.newPage({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true });
  phone.on('pageerror', (e) => errors.push(`phone pageerror: ${e.message}`));
  await phone.goto(`http://localhost:${PORT}/?debug`);
  await phone.waitForSelector('.char', { timeout: 90000 });
  await phone.tap('.char[data-id="avatar_05"]');
  await shot(phone, '12-phone-select');
  await phone.tap('button.big');
  await phone.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await phone.evaluate(() => window.__mcb.walkToStation('drone'));
  await phone.waitForFunction(() => window.__mcb.nearRing === 'drone', null, { timeout: 60000 });
  await phone.tap('.prompt button');
  await phone.waitForSelector('.level-card');
  await phone.tap('.level-card[data-level="1"]');
  await phone.waitForTimeout(1200);
  for (const t of ['takeoff', 'forward', 'forward']) await phone.tap(`.bq-palette [data-type="${t}"]`);
  await phone.tap('button.run');
  await phone.waitForFunction(() => !document.querySelector('button.run')?.hidden, null, { timeout: 60000 });
  await phone.waitForTimeout(300);
  await shot(phone, '13-phone-level1-miss');
  console.log('phone passport:', await phone.textContent('.passport-btn').catch(() => 'hidden in station'));
  console.log('external requests:', external.length ? external : 'none');
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  process.exitCode = 1;
} finally {
  console.log('console errors/warnings:', errors.length ? errors : 'none');
  await browser.close();
  server.kill();
}
process.exit(process.exitCode ?? 0); // the preview server's pipes would keep Node alive
