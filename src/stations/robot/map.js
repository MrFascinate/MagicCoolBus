/**
 * Top-down map of the arm's stops for the side panel. It shows, in shapes
 * and words: where the arm points, what it holds, the tray line (front part
 * marked "Next"), each bin's icon, and the barrier. Colours always come with
 * a shape and a label.
 */
import { BINS, PARTS, TRAY } from './levels.js';

const NS = 'http://www.w3.org/2000/svg';
const COLORS = { teal: '#16a394', yellow: '#f2b51d', coral: '#ff6b4a' };
const INK = '#0b1530';

/** Stop positions on the map, in the same left-to-right order the player sees. */
const POS = [
  { x: 52, y: 52 },   // tray, back left
  { x: 70, y: 150 },  // bin 1
  { x: 170, y: 160 }, // bin 2
  { x: 270, y: 150 }, // bin 3
];
const ARM = { x: 170, y: 88 };

function el(tag, attrs, parent) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.append(e);
  return e;
}

/** Shape glyph for a part or bin icon. */
function glyph(shape, x, y, r, fill, parent, extra = {}) {
  const a = { fill, stroke: INK, 'stroke-width': 2.5, ...extra };
  if (shape === 'circle' || shape === 'cylinder') return el('circle', { cx: x, cy: y, r, ...a }, parent);
  if (shape === 'square' || shape === 'cube') return el('rect', { x: x - r, y: y - r, width: r * 2, height: r * 2, rx: 2, ...a }, parent);
  return el('path', { d: `M${x} ${y - r * 1.15}L${x + r * 1.15} ${y + r * 0.85}L${x - r * 1.15} ${y + r * 0.85}Z`, ...a }, parent);
}

/**
 * @param {import('./levels.js').RobotLevel} level
 */
export function createMap(level) {
  const wrap = document.createElement('figure');
  wrap.className = 'rr-map';
  const svg = el('svg', { viewBox: '0 0 340 222', role: 'img', 'aria-hidden': 'true' });
  const cap = document.createElement('figcaption');
  cap.className = 'sr-only';
  wrap.append(svg, cap);

  // ring path: Tray -> 1 -> 2 -> 3 along the front, and 3 -> Tray round the back
  el('path', { d: `M${POS[0].x} ${POS[0].y} Q 40 120 ${POS[1].x} ${POS[1].y} Q 120 168 ${POS[2].x} ${POS[2].y} Q 220 168 ${POS[3].x} ${POS[3].y}`, fill: 'none', stroke: '#9aa6c7', 'stroke-width': 4 }, svg);
  el('path', { d: `M${POS[3].x} ${POS[3].y} C 345 120 330 10 170 14 C 100 16 70 24 ${POS[0].x} ${POS[0].y}`, fill: 'none', stroke: '#9aa6c7', 'stroke-width': 4, 'stroke-dasharray': '8 6' }, svg);
  // direction hint for Rotate right
  const t = el('text', { x: 170, y: 216, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 700, fill: INK }, svg);
  t.textContent = 'Rotate right: Tray, 1, 2, 3, back to Tray';

  let barrierG = null;
  if (level.barrier) {
    barrierG = el('g', { class: 'rr-barrier' }, svg);
    el('rect', { x: 302, y: 52, width: 34, height: 12, fill: '#f2b51d', stroke: INK, 'stroke-width': 2.5, transform: 'rotate(-35 319 58)' }, barrierG);
    for (let i = 0; i < 3; i++) el('line', { x1: 306 + i * 10, y1: 64, x2: 312 + i * 10, y2: 52, stroke: INK, 'stroke-width': 3, transform: 'rotate(-35 319 58)' }, barrierG);
    const bt = el('text', { x: 300, y: 92, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800, fill: INK }, barrierG);
    bt.textContent = 'Barrier';
  }

  // tray box
  el('rect', { x: POS[0].x - 44, y: POS[0].y - 22, width: 88, height: 44, rx: 8, fill: '#eef3ff', stroke: INK, 'stroke-width': 3 }, svg);
  const trayLabel = el('text', { x: POS[0].x, y: POS[0].y - 28, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 800, fill: INK }, svg);
  trayLabel.textContent = 'Tray';
  const trayG = el('g', {}, svg);

  // bins
  const binG = [];
  for (let i = 0; i < 3; i++) {
    const kind = level.bins[i];
    const b = BINS[kind];
    const g = el('g', { class: 'rr-bin' }, svg);
    const p = POS[i + 1];
    el('rect', { x: p.x - 26, y: p.y - 20, width: 52, height: 40, rx: 8, fill: '#fff', stroke: INK, 'stroke-width': 3 }, g);
    glyph(b.icon, p.x, p.y - 2, 11, COLORS[b.color], g);
    const lab = el('text', { x: p.x, y: p.y + 36, 'text-anchor': 'middle', 'font-size': 15, 'font-weight': 800, fill: INK }, g);
    lab.textContent = `Bin ${i + 1}`;
    const count = el('text', { x: p.x + 20, y: p.y - 22, 'text-anchor': 'middle', 'font-size': 14, 'font-weight': 800, fill: INK }, g);
    binG.push({ g, count });
  }

  // arm
  el('circle', { cx: ARM.x, cy: ARM.y, r: 13, fill: '#d5dcef', stroke: INK, 'stroke-width': 3 }, svg);
  const armLine = el('line', { x1: ARM.x, y1: ARM.y, x2: ARM.x, y2: ARM.y, stroke: INK, 'stroke-width': 7, 'stroke-linecap': 'round' }, svg);
  const armTip = el('g', {}, svg);
  const armText = el('text', { x: ARM.x + 18, y: ARM.y - 14, 'text-anchor': 'start', 'font-size': 14, 'font-weight': 800, fill: INK }, svg);
  armText.textContent = 'Arm';

  /**
   * @param {import('./interpreter.js').ArmState} s
   * @param {{flashBin?:number, barrierHit?:boolean}} [fx]
   */
  function draw(s, fx = {}) {
    // tray line
    while (trayG.firstChild) trayG.firstChild.remove();
    s.tray.forEach((p, i) => {
      const x = POS[0].x + 26 - i * 26, y = POS[0].y;
      glyph(p, x, y, 9, COLORS[PARTS[p].color], trayG);
      if (i === 0) {
        const n = el('text', { x, y: POS[0].y + 38, 'text-anchor': 'middle', 'font-size': 13, 'font-weight': 800, fill: INK }, trayG);
        n.textContent = 'Next';
      }
    });
    // arm pointer
    const target = POS[s.stop];
    const dx = target.x - ARM.x, dy = target.y - ARM.y, d = Math.hypot(dx, dy);
    const k = s.down ? (d - 26) / d : 0.55;
    const tx = ARM.x + dx * k, ty = ARM.y + dy * k;
    armLine.setAttribute('x2', String(tx)); armLine.setAttribute('y2', String(ty));
    armLine.setAttribute('stroke-dasharray', s.down ? '' : '');
    while (armTip.firstChild) armTip.firstChild.remove();
    el('circle', { cx: tx, cy: ty, r: s.down ? 6 : 9, fill: s.down ? INK : '#fff', stroke: INK, 'stroke-width': 3 }, armTip);
    if (s.held) glyph(s.held, tx, ty, 8, COLORS[PARTS[s.held].color], armTip);
    // bins
    binG.forEach((b, i) => {
      const n = s.bins[i].length;
      b.count.textContent = n ? `${n}` : '';
      b.g.classList.toggle('flash', fx.flashBin === i + 1);
    });
    if (barrierG) barrierG.classList.toggle('flash', !!fx.barrierHit);
    cap.textContent = describe(level, s);
  }

  return { el: wrap, draw };
}

/** Words for the map, for screen readers and the panel. */
export function describe(level, s) {
  const where = s.stop === TRAY ? 'the tray' : `Bin ${s.stop} (${BINS[level.bins[s.stop - 1]].label})`;
  const parts = [`The arm points at ${where}${s.down ? ' and is down' : ''}.`];
  parts.push(s.held ? `It holds the ${PARTS[s.held].label}.` : 'It holds nothing.');
  parts.push(s.tray.length ? `On the tray: ${s.tray.map((p, i) => PARTS[p].label + (i === 0 ? ' (next)' : '')).join(', ')}.` : 'The tray is empty.');
  level.bins.forEach((k, i) => {
    const n = s.bins[i].length;
    parts.push(`Bin ${i + 1} has the ${BINS[k].icon} icon and ${n === 0 ? 'no parts' : n === 1 ? '1 part' : `${n} parts`}.`);
  });
  if (level.barrier) parts.push('A barrier blocks the turn between Bin 3 and the tray.');
  return parts.join(' ');
}
