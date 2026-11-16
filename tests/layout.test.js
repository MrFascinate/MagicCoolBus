import { describe, it, expect } from 'vitest';
import { panelInset, stationView, hubFov, pixelRatioFor, BASE_FOV } from '../src/ui/layout.js';

describe('panel inset', () => {
  it('reads a side panel on the right', () => {
    expect(panelInset({ left: 896, top: 0, width: 470, height: 768 }, 1366, 768)).toEqual({ right: 470, bottom: 0 });
    expect(panelInset({ left: 422, top: 0, width: 422, height: 390 }, 844, 390)).toEqual({ right: 422, bottom: 0 });
  });
  it('reads a bottom sheet', () => {
    expect(panelInset({ left: 0, top: 371, width: 390, height: 473 }, 390, 844)).toEqual({ right: 0, bottom: 473 });
  });
  it('is zero when the panel is missing or odd', () => {
    expect(panelInset(null, 390, 844)).toEqual({ right: 0, bottom: 0 });
    expect(panelInset({ left: 0, top: 0, width: 0, height: 0 }, 390, 844)).toEqual({ right: 0, bottom: 0 });
    expect(panelInset({ left: 0, top: 0, width: 100, height: 100 }, 390, 844)).toEqual({ right: 0, bottom: 0 });
  });
});

/** Where the camera's centre line lands on screen, in CSS pixels. */
function axisOnScreen(w, h, v) {
  // the virtual image is v.fullW x v.fullH; the screen shows the window at (v.x, v.y)
  return { x: v.fullW / 2 - v.x, y: v.fullH / 2 - v.y };
}

describe('station view', () => {
  it('centres the view in the free area left of a side panel', () => {
    const v = stationView(1366, 768, { right: 470, bottom: 0 });
    expect(v.offset).toBe(true);
    expect(v.fov).toBe(BASE_FOV);
    const a = axisOnScreen(1366, 768, v);
    expect(a.x).toBeCloseTo((1366 - 470) / 2);
    expect(a.y).toBeCloseTo(768 / 2);
    expect(v.aspect).toBeCloseTo((1366 + 470) / 768);
  });
  it('centres the view in the free area above a bottom sheet, with a wider lens', () => {
    const v = stationView(390, 844, { right: 0, bottom: 473 });
    const a = axisOnScreen(390, 844, v);
    expect(a.x).toBeCloseTo(195);
    expect(a.y).toBeCloseTo((844 - 473) / 2);
    expect(v.fov).toBeGreaterThan(BASE_FOV);
    expect(v.fov).toBeLessThanOrEqual(110);
    // the free strip sees close to the base field of view (the lens stops at 110 degrees)
    const freeHalf = (844 - 473) / 2, fullHalf = (844 + 473) / 2;
    const freeFov = 2 * Math.atan(Math.tan((v.fov / 2) * Math.PI / 180) * freeHalf / fullHalf) * 180 / Math.PI;
    expect(freeFov).toBeGreaterThan(40);
  });
  it('is a plain view with no panel', () => {
    const v = stationView(800, 600, { right: 0, bottom: 0 });
    expect(v.offset).toBe(false);
    expect(v.aspect).toBeCloseTo(800 / 600);
  });
  it('never lets a huge inset swallow the screen', () => {
    const v = stationView(390, 844, { right: 0, bottom: 5000 });
    expect(v.y).toBeLessThan(844);
    expect(Number.isFinite(v.fov)).toBe(true);
  });
});

describe('walk-around field of view', () => {
  it('is unchanged in landscape and opens up in portrait, within limits', () => {
    expect(hubFov(1366 / 768)).toBe(BASE_FOV);
    expect(hubFov(1)).toBe(BASE_FOV);
    const p = hubFov(390 / 844);
    expect(p).toBeGreaterThan(BASE_FOV);
    expect(p).toBeLessThanOrEqual(72);
    expect(hubFov(0.1)).toBe(72);
    expect(hubFov(0)).toBe(BASE_FOV);
  });
});

describe('pixel ratio', () => {
  it('caps at 1.5 and never drops under 1', () => {
    expect(pixelRatioFor(1, 1366 * 768)).toBe(1);
    expect(pixelRatioFor(2, 1366 * 768)).toBe(1.5);
    expect(pixelRatioFor(3, 390 * 844, 0, true)).toBe(1.5);
    expect(pixelRatioFor(3, 390 * 844, 1, true)).toBe(1.25);
    expect(pixelRatioFor(3, 390 * 844, 9, true)).toBe(1);
  });
  it('holds big touch screens near the pixel budget', () => {
    expect(pixelRatioFor(2, 1024 * 1366, 0, true)).toBe(1);
    expect(pixelRatioFor(2, 800 * 1280, 0, true)).toBeCloseTo(1.17, 2);
    expect(pixelRatioFor(2, 1920 * 1080, 0, false)).toBe(1.5);
  });
});

describe('fit box', () => {
  it('is the old box without a bottom sheet', async () => {
    const { fitBox } = await import('../src/ui/layout.js');
    expect(fitBox({ height: 768, panelHeight: 0 }, 0.9, 0.8)).toEqual({ x0: -0.9, x1: 0.9, y0: -0.8, y1: 0.8 });
  });
  it('covers the strip above a bottom sheet, centred where the view is centred', async () => {
    const { fitBox, stationView } = await import('../src/ui/layout.js');
    const b = fitBox({ height: 844, panelHeight: 473 }, 0.9, 0.8);
    const toPx = (ndc) => (1 - ndc) / 2 * 844; // NDC height to pixels from the top
    expect(toPx(b.y1)).toBeGreaterThan(0);
    expect(toPx(b.y0)).toBeLessThan(844 - 473);
    const v = stationView(390, 844, { right: 0, bottom: 473 });
    expect(toPx((b.y0 + b.y1) / 2)).toBeCloseTo(v.fullH / 2 - v.y, 5);
  });
});
