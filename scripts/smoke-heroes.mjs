// Browser smoke test for Hologram Heroes. Serves /tmp/dist-c (or $DIST) with
// vite preview, plays all three levels in Chrome with software WebGL
// (including wrong picks, one made by clicking a hologram in 3D), and saves
// screenshots to screens/heroes/.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const content = JSON.parse(readFileSync('src/stations/heroes/content.json', 'utf8'));
const exe = process.env.CHROME || '/usr/bin/google-chrome';
const dist = process.env.DIST || '/tmp/dist-c';
const PORT = Number(process.env.PORT || 4191);
const SCREENS = 'screens/heroes';
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
const roundsOf = (lv) => content.rounds.filter((r) => r.level === lv);

async function enterHeroes(page, char = 'avatar_02') {
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForSelector('.char', { timeout: 90000 });
  await page.click(`.char[data-id="${char}"]`);
  await page.click('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await page.evaluate(() => window.__mcb.walkToStation('heroes'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'heroes', null, { timeout: 60000 });
  await page.keyboard.press('Enter');
  await page.waitForSelector('.level-card', { timeout: 30000 });
  await page.waitForTimeout(1200);
}

/** Answer a round with the panel buttons, then go through both people. */
async function answerRound(page, round, { wrongFirst = false, tag } = {}) {
  await page.waitForSelector('.hh-choice');
  if (wrongFirst) {
    const wrong = round.choices.find((c) => c !== round.answer);
    await page.click(`.hh-choice[data-prop="${wrong}"]`);
    await page.waitForSelector(`.hh-choice[data-prop="${wrong}"][disabled]`);
    console.log('miss message:', (await page.textContent('.message')).trim());
  }
  await page.click(`.hh-choice[data-prop="${round.answer}"]`);
  await page.waitForSelector('.hh-person');
  await page.waitForTimeout(900);
  if (tag) await shot(page, `${tag}-inventor`);
  console.log('inventor:', await page.textContent('.hh-name'));
  await page.click('text=Meet someone working today');
  await page.waitForSelector('.hh-yourstep');
  await page.waitForTimeout(900);
  if (tag) await shot(page, `${tag}-partner`);
  console.log('partner:', await page.textContent('.hh-name'));
}

try {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  page.setDefaultTimeout(120000);
  watch(page);
  await enterHeroes(page);
  await shot(page, '01-levels');

  // Level 1 with a wrong pick made by clicking the hologram in 3D
  await page.click('.level-card[data-level="1"]');
  await page.waitForSelector('.hh-choice');
  await page.waitForTimeout(1200);
  await shot(page, '02-l1-round1');
  const r1 = roundsOf(1)[0];
  const wrong = r1.choices.find((c) => c !== r1.answer);
  const pos = await page.evaluate((id) => window.__mcbHeroes.holoScreen(id), wrong);
  console.log('wrong hologram on screen at', pos);
  await page.mouse.click(pos.x, pos.y);
  await page.waitForSelector(`.hh-choice[data-prop="${wrong}"][disabled]`, { timeout: 30000 });
  await page.waitForTimeout(400);
  await shot(page, '03-l1-wrong-pick-3d');
  console.log('3D wrong pick message:', (await page.textContent('.message')).trim());
  await page.waitForTimeout(3300);
  await shot(page, '04-l1-wrong-faded');
  await answerRound(page, r1, { tag: '05-l1r1' });
  await page.click('text=Next round');
  await answerRound(page, roundsOf(1)[1]);
  await page.click('text=Finish the level');
  await page.waitForSelector('.result-stars');
  await shot(page, '06-l1-result');
  console.log('L1:', await page.getAttribute('.result-stars .stars', 'aria-label'));

  // Level 2 with a wrong pick through the panel
  await page.click('text=Next: Level 2');
  await page.waitForTimeout(1000);
  await shot(page, '07-l2-round1');
  await answerRound(page, roundsOf(2)[0], { wrongFirst: true });
  await page.click('text=Next round');
  await answerRound(page, roundsOf(2)[1]);
  await page.click('text=Finish the level');
  await page.waitForSelector('.result-stars');
  console.log('L2:', await page.getAttribute('.result-stars .stars', 'aria-label'));

  // Level 3, keyboard only for the first round
  await page.click('text=Next: Level 3');
  await page.waitForSelector('.hh-choice');
  await page.waitForTimeout(1200);
  await shot(page, '08-l3-round1');
  const r5 = roundsOf(3)[0];
  const idx = r5.choices.indexOf(r5.answer);
  await page.focus('.hh-choice');
  for (let i = 0; i < idx; i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.hh-person');
  console.log('keyboard pick ok:', await page.textContent('.hh-name'));
  await page.keyboard.press('Enter'); // focus is on "Meet someone working today"
  await page.waitForSelector('.hh-yourstep');
  await page.keyboard.press('Enter'); // Next round
  await answerRound(page, roundsOf(3)[1], { tag: '09-l3r2' });
  await page.click('text=Finish the level');
  await page.waitForSelector('.stamp-card', { timeout: 10000 });
  await page.waitForTimeout(500);
  await shot(page, '10-stamp');
  console.log('stamp:', (await page.textContent('.stamp-card')).replace(/\s+/g, ' '));
  await page.click('.stamp-card button');
  console.log('L3:', await page.getAttribute('.result-stars .stars', 'aria-label'));
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub');
  console.log('passport:', await page.textContent('.passport-btn'));
  console.log('hub draw calls after leaving:', await page.evaluate(() => window.__mcb.info().calls));

  // Phone landscape, touch only, reduced motion
  const ctx2 = await browser.newContext({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  const phone = await ctx2.newPage();
  phone.setDefaultTimeout(120000);
  watch(phone, 'phone ');
  await phone.goto(`http://localhost:${PORT}/?debug`);
  await phone.waitForSelector('.char', { timeout: 90000 });
  await phone.tap('.char[data-id="avatar_06"]');
  await phone.tap('button.big');
  await phone.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await phone.evaluate(() => window.__mcb.walkToStation('heroes'));
  await phone.waitForFunction(() => window.__mcb.nearRing === 'heroes', null, { timeout: 60000 });
  await phone.tap('.prompt button');
  await phone.waitForSelector('.level-card');
  await phone.tap('.level-card[data-level="1"]');
  await phone.waitForSelector('.hh-choice');
  await phone.waitForTimeout(800);
  await shot(phone, '11-phone-round');
  const pr = roundsOf(1)[0];
  const pw = pr.choices.find((c) => c !== pr.answer);
  const pp = await phone.evaluate((id) => window.__mcbHeroes.holoScreen(id), pw);
  await phone.touchscreen.tap(pp.x, pp.y);
  await phone.waitForSelector(`.hh-choice[data-prop="${pw}"][disabled]`, { timeout: 30000 });
  await shot(phone, '12-phone-wrong');
  await phone.tap(`.hh-choice[data-prop="${pr.answer}"]`);
  await phone.waitForSelector('.hh-person');
  await phone.waitForTimeout(300);
  await shot(phone, '13-phone-inventor');
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
