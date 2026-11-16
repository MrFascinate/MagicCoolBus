// Browser smoke test for Badge Builder. Serves /tmp/dist-c (or $DIST),
// seeds the save with all six stamps the way the game stores them
// (localStorage key mcb-challenge-v1), plays the three levels with failed
// previews, builds a badge end to end, and saves screenshots to screens/badge/.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const exe = process.env.CHROME || '/usr/bin/google-chrome';
const dist = process.env.DIST || '/tmp/dist-c';
const PORT = Number(process.env.PORT || 4192);
const SCREENS = 'screens/badge';
mkdirSync(SCREENS, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const errors = [], external = [];
const watch = (page, tag = '') => {
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(`${tag}${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag}pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${tag}http ${r.status()}: ${r.url()}`); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
};
const shot = (page, n) => { console.log('shot', n); return page.screenshot({ path: `${SCREENS}/${n}.png` }); };

// The shared save, as src/core/save.js writes it, with all six stamps.
const SEED = {
  v: 1, character: 'avatar_04', sound: false, badge: null,
  stations: Object.fromEntries([
    ['microscope', 'Measured tiny things'], ['robot', 'Planned robot moves'], ['drone', 'Programmed a drone flight'],
    ['heroes', 'Matched problems to inventions'], ['sky', 'Star-hopped to a target'], ['cypher', 'Put science words on the beat'],
  ].map(([id, skill]) => [id, { levels: { 1: 2, 2: 2, 3: 2 }, stamp: { skill } }])),
};

async function enterBadge(page) {
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForSelector('.char[aria-checked="true"]', { timeout: 120000 });
  await page.click('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 120000 });
  console.log('passport:', await page.textContent('.passport-btn'));
  await page.evaluate(() => window.__mcb.walkToStation('badge'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'badge', null, { timeout: 120000 });
  console.log('prompt:', (await page.textContent('.prompt')).replace(/\s+/g, ' '));
  await page.keyboard.press('Enter');
  await page.waitForSelector('.level-card', { timeout: 60000 });
  await page.waitForTimeout(1200);
}

/** Pick an orientation (and edge turns), run the preview, return the result text. */
async function preview(page, orient, turns = 0, skip = true) {
  await page.click(`[data-orient="${orient}"]`);
  for (let i = 0; i < turns; i++) await page.click('text=Turn it');
  await page.click('.bb-go');
  if (skip) {
    // software GL in a busy container runs at a few frames a second, so use Skip (it is part of the test too)
    await page.waitForTimeout(1500);
    await page.click('text=Skip to the end', { timeout: 5000 }).catch(() => {});
  }
  await page.waitForFunction(() => { const b = document.querySelector('.bb-go'); return !b || !b.hidden; }, null, { timeout: 120000 });
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => (document.querySelector('.panel-body h2')?.textContent || '') + ' | ' + (document.querySelector('.message')?.textContent || ''));
  console.log(`preview ${orient}${turns ? ` turn ${turns}` : ''}:`, res);
  return res;
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['clipboard-read', 'clipboard-write'], acceptDownloads: true });
  await ctx.addInitScript((seed) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mcb-challenge-v1', JSON.stringify(seed)); localStorage.removeItem('mcb-badge-builder-v1'); sessionStorage.setItem('seeded', '1'); } }, SEED);
  const page = await ctx.newPage();
  page.setDefaultTimeout(120000);
  watch(page);
  await enterBadge(page);
  await shot(page, '01-levels');

  // Level 1: pick an emblem, fail face down, then print flat
  await page.click('.level-card[data-level="1"]');
  await page.click('[data-emblem="gear"]');
  await page.waitForTimeout(600);
  await shot(page, '02-l1-emblem');
  await page.click('text=Next: place it on the bed');
  await page.waitForSelector('.bb-orient');
  await page.waitForTimeout(800);
  await shot(page, '03-l1-orient');
  await preview(page, 'face');
  await shot(page, '04-l1-fail-face-down');
  await preview(page, 'flat', 0, false);
  await shot(page, '05-l1-printed');
  console.log('L1 stars:', await page.getAttribute('.result-stars .stars', 'aria-label'));

  // Level 2: flat fails (overhang), standing on the edge prints
  await page.click('text=Next: Level 2');
  await page.waitForSelector('.bb-orient');
  await page.waitForTimeout(600);
  await preview(page, 'flat');
  await shot(page, '06-l2-fail-overhang');
  await page.click('[data-orient="edge"]');
  await page.waitForTimeout(600);
  await shot(page, '07-l2-edge-ready');
  await preview(page, 'edge');
  await shot(page, '08-l2-printed');
  console.log('L2 stars:', await page.getAttribute('.result-stars .stars', 'aria-label'));

  // Level 3: design a badge
  await page.click('text=Next: Level 3');
  await page.click('[data-shape="shield"]');
  await page.waitForTimeout(500);
  await shot(page, '09-l3-shape');
  await page.click('text=Next: Colors');
  await page.click('[aria-label="Badge color"] [data-color="teal"]');
  await page.click('[aria-label="Raised parts color"] [data-color="yellow"]');
  await page.click('text=Next: Emblems');
  // tap-to-place five emblems
  const order = ['cell', 'gear', 'drone', 'spark', 'planet'];
  for (let i = 0; i < order.length; i++) {
    await page.click(`.bb-emblem[data-emblem="${order[i]}"]`);
    await page.click(`.bb-spot[data-slot="${i}"]`);
  }
  // drag the sixth onto spot 6 in the preview picture
  const src = await page.locator('.bb-emblem[data-emblem="wave"]').boundingBox();
  const svgBox = await page.locator('.bb-preview svg').boundingBox();
  // spot 6 on the shield is plane (0, -26): svg viewBox -52..52
  const tx = svgBox.x + ((0 + 52) / 104) * svgBox.width, ty = svgBox.y + ((26 + 52) / 104) * svgBox.height;
  await page.mouse.move(src.x + src.width / 2, src.y + src.height / 2);
  await page.mouse.down();
  await page.mouse.move(src.x + 40, src.y - 30, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  console.log('spots:', (await page.$$eval('.bb-spot', (b) => b.map((x) => x.textContent.trim()))).join(' | '));
  // move spot 1 with the arrow buttons
  await page.click('.bb-spot[data-slot="0"]');
  await page.click('text=Next spot');
  await shot(page, '10-l3-emblems');
  await page.click('text=Next: Initials');
  // a blocked combination, quietly refused
  await page.selectOption('#bb-letter-0', 'A');
  await page.selectOption('#bb-letter-1', 'S');
  await page.selectOption('#bb-letter-2', 'S');
  console.log('blocked message:', (await page.textContent('.message')).trim());
  console.log('letters after block:', await page.$$eval('.bb-letter', (s) => s.map((x) => x.value || '-').join('')));
  await page.selectOption('#bb-letter-2', 'K');
  console.log('initials message:', (await page.textContent('.message')).trim());
  await shot(page, '11-l3-initials');
  await page.click('text=Next: Print');
  await page.waitForSelector('.bb-orient');
  await preview(page, 'face');
  await shot(page, '12-l3-fail-face-down');
  await page.click('[data-orient="flat"]');
  await page.click('.bb-go');
  await page.waitForTimeout(700);
  await shot(page, '13-l3-printing');
  await page.click('text=Skip to the end').catch(() => {});
  await page.waitForSelector('.bb-final', { timeout: 120000 });
  await page.waitForTimeout(600);
  await shot(page, '14-l3-finished');
  const code = await page.inputValue('.bb-code');
  console.log('badge code:', code, 'stars:', await page.getAttribute('.result-stars .stars', 'aria-label'));
  await page.click('text=Copy badge code');
  await page.waitForTimeout(500);
  console.log('copy message:', (await page.textContent('.panel-body .message')).trim());
  const dl = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);
  await page.click('text=Save a picture (optional)');
  const d = await dl;
  console.log('picture download:', d ? d.suggestedFilename() : 'none');
  await page.click('text=Show my badge big');
  await page.waitForSelector('.bb-overlay');
  await shot(page, '15-badge-big');
  await page.keyboard.press('Escape');
  console.log('overlay closed:', !(await page.$('.bb-overlay')));

  // the badge is kept: reload and look again
  await page.reload();
  await enterBadge(page);
  const stored = await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('mcb-challenge-v1')).badge));
  console.log('stored badge:', stored);
  await page.click('text=See my badge');
  await page.waitForSelector('.bb-final');
  console.log('same code after reload:', (await page.inputValue('.bb-code')) === code);

  // clipboard refused: the fallback message shows
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true }); });
  await page.click('text=Copy badge code');
  await page.waitForTimeout(300);
  console.log('refused clipboard message:', (await page.textContent('.panel-body .message')).trim());
  await shot(page, '16-copy-refused');

  // phone landscape, touch only, reduced motion: level 1 print
  const ctx2 = await browser.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  await ctx2.addInitScript((seed) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('mcb-challenge-v1', JSON.stringify(seed)); sessionStorage.setItem('seeded', '1'); } }, SEED);
  const phone = await ctx2.newPage();
  phone.setDefaultTimeout(120000);
  watch(phone, 'phone ');
  await phone.goto(`http://localhost:${PORT}/?debug`);
  await phone.waitForSelector('.char[aria-checked="true"]', { timeout: 120000 });
  await phone.tap('button.big');
  await phone.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 120000 });
  await phone.evaluate(() => window.__mcb.walkToStation('badge'));
  await phone.waitForFunction(() => window.__mcb.nearRing === 'badge', null, { timeout: 120000 });
  await phone.tap('.prompt button');
  await phone.waitForSelector('.level-card');
  await phone.tap('.level-card[data-level="1"]');
  await phone.tap('text=Next: place it on the bed');
  await phone.tap('[data-orient="flat"]');
  await phone.tap('.bb-go');
  await phone.waitForSelector('.result-stars', { timeout: 120000 });
  await shot(phone, '17-phone-printed');
  console.log('phone L1:', await phone.getAttribute('.result-stars .stars', 'aria-label'));
  console.log('external requests:', external.length ? external : 'none');
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  process.exitCode = 1;
} finally {
  console.log('console errors/warnings:', errors.length ? errors : 'none');
  await browser.close();
  server.kill();
}
