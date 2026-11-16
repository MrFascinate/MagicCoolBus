// Shared helpers for the station smoke tests: serve /tmp/dist-a (or $DIST),
// open Chrome with software WebGL, collect console errors and outside requests.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

export async function startSmoke({ port, screens }) {
  const exe = process.env.CHROME || '/usr/bin/google-chrome';
  const dist = process.env.DIST || '/tmp/dist-a';
  mkdirSync(screens, { recursive: true });
  const server = spawn('npx', ['vite', 'preview', '--outDir', dist, '--port', String(port), '--strictPort'], { stdio: 'pipe', detached: true });
  await new Promise((r) => setTimeout(r, 2500));
  const browser = await chromium.launch({ executablePath: exe, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const errors = [];
  const external = [];
  const watch = (page, tag = '') => {
    page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !/GL Driver Message|GPU stall due to ReadPixels/.test(m.text())) errors.push(`${tag}${m.type()}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${tag}pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) errors.push(`${tag}http ${r.status()}: ${r.url()}`); });
    page.on('requestfailed', (r) => errors.push(`${tag}requestfailed: ${r.url()}`));
    page.on('request', (r) => { const u = r.url(); if (!u.startsWith(`http://localhost:${port}`) && !u.startsWith('data:') && !u.startsWith('blob:')) external.push(u); });
  };
  const shot = (page, n) => { console.log('shot', n); return page.screenshot({ path: `${screens}/${n}.png` }); };
  /** Open the game, pick a character, wait for the hub. */
  const enterHub = async (page, char = 'avatar_03') => {
    await page.goto(`http://localhost:${port}/?debug`);
    await page.waitForSelector('.char', { timeout: 90000 });
    await page.click(`.char[data-id="${char}"]`);
    await page.click('button.big');
    await page.waitForFunction(() => window.__mcb && window.__mcb.mode === 'hub', null, { timeout: 60000 });
    await page.waitForTimeout(800);
  };
  const close = async () => { await browser.close(); try { process.kill(-server.pid); } catch { server.kill(); } };
  return { browser, errors, external, watch, shot, enterHub, close, base: `http://localhost:${port}` };
}
