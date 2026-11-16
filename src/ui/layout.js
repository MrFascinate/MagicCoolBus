/**
 * Screen layout maths shared by the shell and the stations (no DOM, no three.js).
 *
 * In landscape the station panel sits on the right. In portrait it is a sheet
 * along the bottom. Either way the 3D camera is shifted so the scene is centred
 * in the part of the screen the panel leaves free.
 */

const DEG = Math.PI / 180;
export const BASE_FOV = 50;

/**
 * The part of the screen the station panel covers.
 * @param {{left:number, top:number, width:number, height:number}|null} rect  the panel's box
 * @param {number} w  screen width
 * @param {number} h  screen height
 * @returns {{right:number, bottom:number}}
 */
export function panelInset(rect, w, h) {
  if (!rect || rect.width <= 0 || rect.height <= 0) return { right: 0, bottom: 0 };
  // side panel: hugs the right edge and runs most of the height
  if (rect.left > w * 0.3 && rect.height > h * 0.6) return { right: Math.max(0, Math.round(w - rect.left)), bottom: 0 };
  // bottom sheet: hugs the bottom edge and runs most of the width
  if (rect.top > h * 0.2 && rect.width > w * 0.6) return { right: 0, bottom: Math.max(0, Math.round(h - rect.top)) };
  return { right: 0, bottom: 0 };
}

/**
 * Vertical field of view for the walk-around and the drive. In a tall, narrow
 * window the view would be a thin slice, so it opens up (to 72 degrees at most).
 * @param {number} aspect  width / height
 */
export function hubFov(aspect, base = BASE_FOV) {
  if (!(aspect > 0) || aspect >= 1) return base;
  const t = Math.tan((base / 2) * DEG) * Math.sqrt(1 / aspect);
  return Math.min(72, 2 * Math.atan(t) / DEG);
}

/**
 * Camera framing for a station: a virtual image larger than the screen, with
 * the screen as a window into it, so the centre of the view lands in the
 * middle of the free area. With a bottom sheet the field of view grows so the
 * free strip still shows a normal amount of the scene.
 * @param {number} w @param {number} h  screen size
 * @param {{right:number, bottom:number}} inset
 * @returns {{offset:boolean, fullW:number, fullH:number, x:number, y:number, aspect:number, fov:number}}
 */
export function stationView(w, h, inset, base = BASE_FOV) {
  const right = Math.max(0, Math.min(inset.right || 0, w - 1));
  const bottom = Math.max(0, Math.min(inset.bottom || 0, h - 1));
  const fullW = w + right, fullH = h + bottom;
  let fov = base;
  if (bottom > 0) {
    const free = h - bottom;
    fov = Math.min(110, 2 * Math.atan(Math.tan((base / 2) * DEG) * fullH / Math.max(free, h * 0.25)) / DEG);
  }
  return { offset: right > 0 || bottom > 0, fullW, fullH, x: right, y: bottom, aspect: fullW / fullH, fov };
}

/**
 * Pixel ratio for the renderer: sharp on desktops, capped on phones, and
 * lowered further if frames run slow. Never above 1.5 or below 1.
 * @param {number} dpr  window.devicePixelRatio
 * @param {number} pixels  CSS pixels on screen (width x height)
 * @param {number} [step]  how many times frames ran slow so far
 * @param {boolean} [touch]  a phone or tablet (touch screen, no mouse)
 */
export function pixelRatioFor(dpr, pixels, step = 0, touch = false) {
  let cap = 1.5;
  // big tablets at 1.5 push a lot of pixels: hold touch screens near 1.4 million
  if (touch) cap = Math.min(cap, Math.max(1, Math.sqrt(1.4e6 / Math.max(1, pixels))));
  const pr = Math.min(dpr || 1, cap) - step * 0.25;
  return Math.max(1, Math.round(pr * 100) / 100);
}

/**
 * The box (in screen NDC, -1 to 1) a station's subject should fit inside.
 * With a side panel or no panel this is the plain |x| <= mx, |y| <= my box the
 * stations always used (the view offset already centres it in the free area).
 * With a bottom sheet, the box is the free strip above the sheet, so the
 * subject uses that strip instead of a sliver of it.
 * @param {{height:number, panelHeight?:number}} vp
 */
export function fitBox(vp, mx, my) {
  const ph = vp.panelHeight || 0;
  if (!ph || !(vp.height > ph)) return { x0: -mx, x1: mx, y0: -my, y1: my };
  const free = (vp.height - ph) / vp.height;  // share of the screen above the sheet
  const cy = 1 - free;                        // NDC height of the strip's middle (where the view is centred)
  return { x0: -mx, x1: mx, y0: cy - free * my, y1: cy + free * my };
}

/** True when a projected point (NDC) is inside the box. */
export const inBox = (v, b) => v.x >= b.x0 && v.x <= b.x1 && v.y >= b.y0 && v.y <= b.y1;
