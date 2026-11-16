// Browser smoke test for Microscopic Madness. Serves /tmp/dist-b (build it first with
//   npx vite build --outDir /tmp/dist-b --emptyOutDir
// ), drives the real UI in Chrome with software WebGL, saves screenshots to
// screens/microscope/ and fails on console errors.
//
// Level 1: two wrong guesses on the first object (cross-outs, zoom-outs, hints), one zoom-out on purpose.
// Level 2: all right at the closest zoom. Level 3: one wrong guess, then the stamp.
// Also checks that only the images of the level being played are fetched,
// keyboard-only answering, and a phone in landscape with touch.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';

const exe = process.env.CHROME || '/usr/bin/google-chrome';
const PORT = 4291;
const DIR = 'screens/microscope';
mkdirSync(DIR, { recursive: true });
const LEVELS = [['salt', 'hair', 'hooks'], ['pollen', 'wing', 'leaf'], ['paper', 'cotton', 'graphite']];
const ANSWERS = { salt: 'Table salt', hair: 'A strand of hair', hooks: 'Hook-and-loop tape', pollen: 'Sunflower pollen', wing: 'Butterfly wing', leaf: 'Leaf surface', paper: 'Paper', cotton: 'Cotton fabric', graphite: 'Pencil tip' };
// sanity: the answers above must match levels.js
const src = readFileSync('src/stations/microscope/levels.js', 'utf8');
for (const a of Object.values(ANSWERS)) if (!src.includes(`name: '${a}'`)) throw new Error(`answer out of date: ${a}`);

const server = spawn('npx', ['vite', 'preview', '--outDir', '/tmp/dist-b', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));

const errors = [];
const external = [];
const images = [];
const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const shot = (page, n) => { console.log('shot', n); return page.screenshot({ path: `${DIR}/${n}.png` }); };
const watch = (page, tag) => {
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall due to ReadPixels/.test(m.text())) errors.push(`${tag} ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${tag} http ${r.status()}: ${r.url()}`); });
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u);
    const m = u.match(/assets\/microscope\/([a-z]+)_\d\.webp/);
    if (m && tag === 'desktop') images.push(m[1]);
  });
};
const levelOf = (spec) => LEVELS.findIndex((l) => l.includes(spec)) + 1;

let failed = false;
try {
  if (!process.env.PHONE_ONLY) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  watch(page, 'desktop');
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForSelector('.char', { timeout: 90000 });
  await page.click('.char[data-id="avatar_04"]');
  await page.click('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__mcb.walkToStation('microscope'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'microscope', null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await shot(page, '01-ring');
  await page.click('.prompt button');
  await page.waitForSelector('.level-card', { timeout: 30000 });
  await page.waitForTimeout(800);
  await shot(page, '02-levels');
  console.log('images fetched before a level starts:', images.length);

  // ---------- level 1 ----------
  await page.click('.level-card[data-level="1"]');
  await page.waitForSelector('.mm-answer', { timeout: 30000 });
  await page.waitForTimeout(400);
  await shot(page, '03-salt-closest');
  console.log('simulated label:', await page.textContent('.mm-sim'), '| scale bar:', await page.textContent('.mm-bar-text'), '|', await page.textContent('.mm-step'));
  // wrong, wrong
  await page.click('.mm-answer[data-choice="Sand"]');
  await page.waitForTimeout(700);
  await shot(page, '04-salt-wrong1');
  console.log('hint 1:', await page.textContent('.panel-body .message'));
  await page.click('.mm-answer[data-choice="Sugar"]');
  await page.waitForTimeout(700);
  console.log('after 2 wrong:', await page.textContent('.mm-step'), '| crossed:', await page.$$eval('.mm-crossed', (b) => b.map((x) => x.dataset.choice).join(', ')));
  await shot(page, '05-salt-wrong2');
  await page.click(`.mm-answer[data-choice="${ANSWERS.salt}"]`);
  await page.waitForSelector('text=Next object');
  await page.waitForTimeout(400);
  await shot(page, '06-salt-reveal');
  console.log('reveal:', (await page.textContent('.mm-fact')));
  await page.click('text=Next object');
  // hair: zoom out on purpose, then answer with the keyboard only
  await page.waitForSelector('.mm-answer');
  await page.click('text=Zoom out for a clue');
  await page.waitForTimeout(500);
  console.log('zoomed out on purpose:', await page.textContent('.mm-step'));
  const hairKey = await page.$$eval('.mm-answer', (b, a) => b.findIndex((x) => x.dataset.choice === a) + 1, ANSWERS.hair);
  await page.keyboard.press(String(hairKey));
  await page.waitForSelector('text=Next object');
  await page.keyboard.press('Enter'); // focus is on Next object
  await page.waitForSelector('.mm-answer:not([disabled])');
  await page.waitForTimeout(400);
  await shot(page, '07-hooks-closest');
  await page.click(`.mm-answer[data-choice="${ANSWERS.hooks}"]`);
  await page.waitForSelector('text=See your stars');
  await shot(page, '08-hooks-reveal');
  await page.click('text=See your stars');
  await page.waitForSelector('.result-stars');
  await shot(page, '09-level1-result');
  console.log('L1:', await page.getAttribute('.result-stars .stars', 'aria-label'), '|', (await page.textContent('.checklist')).replace(/\s+/g, ' '));
  console.log('images fetched for level 1:', [...new Set(images)].join(','), images.length);

  // ---------- level 2: all at the closest zoom ----------
  const before2 = images.length;
  await page.click('text=Next: Level 2');
  for (const [i, s] of LEVELS[1].entries()) {
    await page.waitForSelector('.mm-answer:not([disabled])');
    await page.waitForTimeout(300);
    await shot(page, `10-${s}-closest`);
    await page.click(`.mm-answer[data-choice="${ANSWERS[s]}"]`);
    await page.waitForSelector(i < 2 ? 'text=Next object' : 'text=See your stars');
    await page.waitForTimeout(300);
    await shot(page, `11-${s}-reveal`);
    await page.click(i < 2 ? 'text=Next object' : 'text=See your stars');
  }
  await page.waitForSelector('.result-stars');
  console.log('L2:', await page.getAttribute('.result-stars .stars', 'aria-label'));
  const lv2 = images.slice(before2);
  console.log('level 2 fetched only its own images:', lv2.every((s) => levelOf(s) === 2), lv2.length);

  // ---------- level 3: one wrong, then the stamp ----------
  await page.click('text=Next: Level 3');
  for (const [i, s] of LEVELS[2].entries()) {
    await page.waitForSelector('.mm-answer:not([disabled])');
    await page.waitForTimeout(300);
    await shot(page, `12-${s}-closest`);
    if (s === 'cotton') {
      await page.click('.mm-answer[data-choice="A spider web"]');
      await page.waitForTimeout(600);
      await shot(page, '13-cotton-wrong');
      console.log('cotton hint:', await page.textContent('.panel-body .message'));
    }
    await page.click(`.mm-answer[data-choice="${ANSWERS[s]}"]`);
    await page.waitForSelector(i < 2 ? 'text=Next object' : 'text=See your stars');
    await page.waitForTimeout(300);
    await shot(page, `14-${s}-reveal`);
    await page.click(i < 2 ? 'text=Next object' : 'text=See your stars');
  }
  await page.waitForSelector('.stamp-card', { timeout: 10000 });
  await shot(page, '15-stamp');
  console.log('stamp:', (await page.textContent('.stamp-card')).replace(/\s+/g, ' '));
  await page.click('.stamp-card button');
  console.log('L3:', await page.getAttribute('.result-stars .stars', 'aria-label'));
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub');
  await page.waitForTimeout(600);
  await shot(page, '16-hub-after');
  console.log('passport:', await page.textContent('.passport-btn'), '| viewer removed:', await page.evaluate(() => !document.querySelector('.mm-stage')));

  }

  // ---------- phone landscape, touch only ----------
  const phone = await browser.newPage({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true });
  watch(phone, 'phone');
  await phone.goto(`http://localhost:${PORT}/?debug`);
  await phone.waitForSelector('.char', { timeout: 90000 });
  await phone.tap('.char[data-id="avatar_07"]');
  await phone.tap('button.big');
  await phone.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await phone.evaluate(() => window.__mcb.walkToStation('microscope'));
  await phone.waitForFunction(() => window.__mcb.nearRing === 'microscope', null, { timeout: 60000 });
  await phone.tap('.prompt button');
  await phone.waitForSelector('.level-card');
  await phone.tap('.level-card[data-level="1"]');
  await phone.waitForSelector('.mm-answer');
  await phone.waitForTimeout(500);
  await phone.tap('.mm-answer[data-choice="Glitter"]');
  await phone.waitForTimeout(600);
  await shot(phone, '17-phone-wrong');
  const box = await phone.evaluate(() => {
    const f = document.querySelector('.mm-frame').getBoundingClientRect();
    const a = [...document.querySelectorAll('.mm-answer')].map((b) => b.getBoundingClientRect());
    const panel = document.getElementById('station-panel').getBoundingClientRect();
    return { frame: Math.round(f.width), inside: a.every((r) => r.right <= panel.left + 1 && r.bottom <= window.innerHeight && r.height >= 44) && f.bottom <= window.innerHeight };
  });
  console.log('phone layout:', JSON.stringify(box));
  console.log('external requests:', external.length ? external : 'none');
} catch (e) {
  console.error('SMOKE FAILED:', e.message);
  failed = true;
} finally {
  console.log('console errors/warnings:', errors.length ? errors : 'none');
  if (errors.length) failed = true;
  process.exitCode = failed ? 1 : 0;
  await browser.close();
  server.kill();
}
