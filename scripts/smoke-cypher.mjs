// Browser smoke test for Science Cypher. Serves /tmp/dist-b (build it first with
//   npx vite build --outDir /tmp/dist-b --emptyOutDir
// ), drives the real UI in Chrome with software WebGL, saves screenshots to
// screens/cypher/ and fails on console errors.
//
// Level 1 (sound on): timing check, then one line with no tap and one wrong word.
// Level 2 (sound on): one right word tapped early.
// Level 3 (sound OFF): timing check against the moving dots, then a clean verse and the stamp.
// Phone in landscape with touch and reduced motion: layout check and one tap.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const exe = process.env.CHROME || '/usr/bin/google-chrome';
const PORT = 4292;
const DIR = 'screens/cypher';
mkdirSync(DIR, { recursive: true });
const server = spawn('npx', ['vite', 'preview', '--outDir', '/tmp/dist-b', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));

const errors = [];
const external = [];
const browser = await chromium.launch({
  executablePath: exe,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox', '--autoplay-policy=user-gesture-required'],
});
const shot = (page, n) => { console.log('shot', n); return page.screenshot({ path: `${DIR}/${n}.png` }); };
const watch = (page, tag) => {
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall due to ReadPixels/.test(m.text())) errors.push(`${tag} ${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`${tag} pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`${tag} http ${r.status()}: ${r.url()}`); });
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(`http://localhost:${PORT}`) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
};

// Software WebGL here can run near 1 frame per second, so in-page timers fire late.
// The game judges taps by their event timestamps, so the scripts below hand it
// taps stamped at chosen song times through the debug hooks (?debug only).

/** In-page: four calibration taps, `late` seconds after beats 5 to 8. */
const CAL_SCRIPT = (late) => {
  const spb = 60 / 90;
  for (const n of [4, 5, 6, 7]) window.__cypher.calTapAt(n * spb + late);
  return 4;
};

/**
 * In-page: play the verse. `plan` maps a line index to what to do the FIRST time
 * that line comes up: 'skip' (no tap), 'wrong' (wrong word on the beat), 'early'
 * (right word 400 ms early). Every other slot gets the right word 40 ms after the star.
 */
const PLAY_SCRIPT = (plan) => new Promise((resolve) => {
  const used = new Set();
  const done = new Set();
  const log = [];
  const t0 = performance.now();
  const step = () => {
    const c = window.__cypher;
    if (!c || c.mode !== 'play') { resolve({ mode: c && c.mode, log }); return; }
    if (performance.now() - t0 > 240000) { resolve({ mode: 'timeout', log }); return; }
    const s = c.slot;
    if (s >= 0 && !done.has(s) && !c.tapped && c.now() > c.star() - 0.9) {
      const line = c.line;
      const what = !used.has(line) && plan[line] ? plan[line] : 'right';
      used.add(line); done.add(s);
      if (what === 'skip') log.push(`${s}:${line}:skip`);
      else {
        const ai = c.answerIndex();
        const k = what === 'wrong' ? (ai + 1) % 3 : ai;
        const at = c.star() + c.offset + (what === 'early' ? -0.4 : 0.04);
        c.tapAt(k, at);
        log.push(`${s}:${line}:${what}->${c.tapped}`);
        (window.__events = window.__events || []).push(`${what}->${c.tapped}`);
      }
    }
    setTimeout(step, 30);
  };
  step();
});

let failed = false;
try {
  if (!process.env.PHONE_ONLY) {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  watch(page, 'desktop');
  await page.goto(`http://localhost:${PORT}/?debug`);
  await page.waitForSelector('.char', { timeout: 90000 });
  await page.click('.char[data-id="avatar_02"]');
  await page.click('button.big');
  await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await page.waitForTimeout(800);

  // walk to the ring and enter with the keyboard
  await page.evaluate(() => window.__mcb.walkToStation('cypher'));
  await page.waitForFunction(() => window.__mcb.nearRing === 'cypher', null, { timeout: 60000 });
  await page.waitForTimeout(400);
  await shot(page, '01-ring');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.level-card', { timeout: 30000 });
  await page.waitForTimeout(800);
  await shot(page, '02-levels');

  // ---------- level 1, sound on ----------
  await page.click('.level-card[data-level="1"]');
  await page.waitForSelector('text=Start the timing check');
  await shot(page, '03-calibration');
  await page.click('text=Start the timing check');
  await page.waitForTimeout(300);
  await page.waitForFunction(() => window.__cypher.mode === 'calib');
  let tapped = await page.evaluate(CAL_SCRIPT, 0.08);
  console.log('cal taps recorded:', await page.evaluate(() => JSON.stringify({ taps: window.__cypher.calTaps.map((x) => +x.toFixed(3)), now: +window.__cypher.now().toFixed(3), sound: window.__cypher.soundClock })));
  await page.waitForTimeout(500);
  console.log('after calibration:', tapped, 'taps; max frame gap', Math.round(await page.evaluate(() => window.__cypher.maxGap)), 'ms;', (await page.textContent('.panel-body')).slice(0, 160));
  if (await page.$('text=Try again') && !(await page.$('text=Timing check done'))) {
    await page.click('text=Try again'); await page.waitForFunction(() => window.__cypher.mode === 'calib'); tapped = await page.evaluate(CAL_SCRIPT, 0.08);
  }
  await page.waitForSelector('text=Timing check done', { timeout: 30000 });
  console.log('calibration (sound) taps:', tapped, '|', await page.textContent('.panel-body p'));
  await shot(page, '04-calibration-done');
  await page.click('text=Use this');
  await page.waitForSelector('text=Play the verse');
  await shot(page, '05-ready');
  await page.click('text=Play the verse');
  console.log('sound clock:', await page.evaluate(() => window.__cypher.soundClock), 'offset:', await page.evaluate(() => window.__cypher.offset.toFixed(3)));
  // mid-verse screenshot while playing
  const p1 = page.evaluate(PLAY_SCRIPT, { 1: 'skip', 3: 'wrong' });
  await page.waitForFunction(() => window.__cypher.line === 1 && window.__cypher.slot >= 1, null, { timeout: 60000 });
  await shot(page, '06-play-line2');
  await page.waitForFunction(() => (window.__events || []).includes('wrong->wrong'), null, { timeout: 120000 });
  await shot(page, '07-wrong-word');
  console.log('wrong-word message:', await page.textContent('.panel-body .message'));
  const r1 = await p1;
  console.log('L1 run:', r1.mode, r1.log.join(' '));
  await page.waitForSelector('.result-stars', { timeout: 60000 });
  await shot(page, '08-level1-result');
  console.log('L1:', await page.textContent('.panel-body h2'), await page.getAttribute('.result-stars .stars', 'aria-label'), '|', (await page.textContent('.checklist')).replace(/\s+/g, ' '));

  // ---------- level 2, sound on, one early tap ----------
  await page.click('text=Next: Level 2');
  await page.waitForSelector('text=Play the verse');
  await page.click('text=Play the verse');
  const p2 = page.evaluate(PLAY_SCRIPT, { 2: 'early' });
  await page.waitForFunction(() => (window.__events || []).includes('early->early'), null, { timeout: 120000 });
  await shot(page, '09-early');
  console.log('early message:', await page.textContent('.panel-body .message'));
  const r2 = await p2;
  console.log('L2 run:', r2.mode, r2.log.join(' '));
  await page.waitForSelector('.result-stars', { timeout: 60000 });
  console.log('L2:', await page.getAttribute('.result-stars .stars', 'aria-label'));

  // ---------- level 3, sound OFF ----------
  // In a station the side panel covers the HUD sound button, so use the pause card's sound button.
  await page.keyboard.press('Escape');
  await page.waitForSelector('text=Turn sound off');
  await page.click('text=Turn sound off');
  await page.waitForSelector('text=Turn sound on');
  await page.click('text=Keep playing');
  console.log('sound now:', await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /mcb/i.test(k)) || '{}')).sound));
  await page.click('text=Next: Level 3');
  await page.waitForSelector('text=Start the timing check');
  console.log('visual calibration text:', await page.textContent('.panel-body p'));
  await page.click('text=Start the timing check');
  await page.waitForFunction(() => window.__cypher.mode === 'calib');
  await page.evaluate(CAL_SCRIPT, 0.05);
  await page.waitForSelector('text=Timing check done', { timeout: 30000 });
  console.log('visual calibration:', await page.textContent('.panel-body p'));
  await page.click('text=Use this');
  await page.waitForSelector('text=Play the verse');
  await page.click('text=Play the verse');
  console.log('sound clock (should be false):', await page.evaluate(() => window.__cypher.soundClock));
  const p3 = page.evaluate(PLAY_SCRIPT, {});
  await page.waitForFunction(() => window.__cypher.slot >= 1, null, { timeout: 60000 });
  await shot(page, '10-sound-off-play');
  const r3 = await p3;
  console.log('L3 run:', r3.mode, r3.log.join(' '));
  await page.waitForSelector('.stamp-card', { timeout: 60000 });
  await shot(page, '11-stamp');
  console.log('stamp:', (await page.textContent('.stamp-card')).replace(/\s+/g, ' '));
  await page.click('.stamp-card button');
  console.log('L3:', await page.getAttribute('.result-stars .stars', 'aria-label'));
  await shot(page, '12-level3-result');
  await page.click('.back-btn');
  await page.waitForFunction(() => window.__mcb.mode === 'hub');
  await page.waitForTimeout(800);
  await shot(page, '13-hub-after');
  console.log('passport:', await page.textContent('.passport-btn'));
  console.log('stage layer removed:', await page.evaluate(() => !document.querySelector('.cy-stage')));
  }

  // ---------- phone landscape, touch only, reduced motion ----------
  const phone = await browser.newPage({ viewport: { width: 800, height: 360 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' });
  watch(phone, 'phone');
  await phone.goto(`http://localhost:${PORT}/?debug`);
  await phone.waitForSelector('.char', { timeout: 90000 });
  await phone.tap('.char[data-id="avatar_06"]');
  await phone.tap('button.big');
  await phone.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
  await phone.evaluate(() => window.__mcb.walkToStation('cypher'));
  await phone.waitForFunction(() => window.__mcb.nearRing === 'cypher', null, { timeout: 60000 });
  await phone.tap('.prompt button');
  await phone.waitForSelector('.level-card');
  await phone.tap('.level-card[data-level="1"]');
  await phone.waitForSelector('text=Skip');
  await phone.tap('text=Skip');
  await phone.waitForSelector('text=Play the verse');
  await phone.tap('text=Play the verse');
  await phone.waitForFunction(() => window.__cypher.slot >= 0, null, { timeout: 60000 });
  // touch the right word as the star arrives
  // a real touch on the right word (timing here depends on how slow software GL is; any judged outcome is fine)
  await phone.waitForFunction(() => window.__cypher.now() > window.__cypher.star() - 0.9, null, { timeout: 60000 });
  const ai = await phone.evaluate(() => window.__cypher.answerIndex());
  await phone.tap(`.cy-choice >> nth=${ai}`);
  await phone.waitForTimeout(250);
  await shot(phone, '14-phone-tap');
  console.log('phone touch judged as:', await phone.evaluate(() => window.__cypher.tapped), '| input reached the game:', await phone.evaluate(() => JSON.stringify(window.__cypher.lastInput)), '| star at', await phone.evaluate(() => window.__cypher.star()));
  const sizes = await phone.evaluate(() => [...document.querySelectorAll('.cy-choice, .cy-line')].map((e) => `${e.className.split(' ')[0]} ${Math.round(e.getBoundingClientRect().height)}px font ${getComputedStyle(e).fontSize}`));
  console.log('phone sizes:', sizes.join(' | '));
  const fits = await phone.evaluate(() => { const r = document.querySelector('.cy-bar').getBoundingClientRect(); return r.top >= 0 && r.right <= window.innerWidth - document.getElementById('station-panel').getBoundingClientRect().width + 1; });
  console.log('phone bar fits left of panel:', fits);
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
