/**
 * Flat picture of a badge design, as an SVG string. Used for the design
 * preview, the finished badge (big enough to screenshot) and the optional
 * picture download. Emblems use the same drawings as the passport stamps.
 */
import { EMBLEMS as STAMP_ICONS } from '../../ui/emblems.js';
import { PIECES, COLORS, partsFor, LAYOUTS } from './design.js';

const inner = (svg) => svg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const colorHex = (id) => (COLORS.find((c) => c.id === id) || COLORS[0]).hex;
/** Dark or light outline, whichever stands out on this fill. */
function edgeFor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#0b1530' : '#ffffff';
}

/**
 * @param {any} design
 * @param {{size?:number, title?:string, showSnaps?:boolean, selectedSlot?:number, emblemFor?:(e:string)=>string}} [opts]
 */
export function badgeSvg(design, opts = {}) {
  const size = opts.size || 240;
  const body = colorHex(design.body);
  const accent = colorHex(design.accent);
  const parts = partsFor(design);
  const out = [];
  const bodyPart = parts.find((p) => p.kind === 'body');
  const shapePath = PIECES[bodyPart.piece].path;
  out.push(`<path d="${shapePath}" fill="${body}" stroke="#0b1530" stroke-width="1.6" stroke-linejoin="round"/>`);
  const edge = edgeFor(accent);
  for (const p of parts) {
    if (p.kind === 'emblem') {
      const id = p.piece.replace('emblem_', '');
      const w = 35 * p.s;
      const icon = STAMP_ICONS[id] ? inner(STAMP_ICONS[id]) : '';
      const tr = `translate(${(p.cx - w / 2).toFixed(2)} ${(-p.cy - w / 2).toFixed(2)}) scale(${(w / 32).toFixed(4)})`;
      // outline pass, then colour pass, so the raised piece reads on any body colour
      out.push(`<g transform="${tr}" fill="none" stroke="${edge}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${icon}</g>`);
      out.push(`<g transform="${tr}" fill="none" stroke="${accent}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${icon}</g>`);
    } else if (p.kind === 'letter') {
      const ch = p.piece.replace('letter_', '');
      const fs = 16.6 * p.s;
      out.push(`<text x="${p.cx.toFixed(2)}" y="${(-p.cy + fs * 0.36).toFixed(2)}" font-size="${fs.toFixed(2)}" font-weight="900" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" fill="${accent}" stroke="${edge}" stroke-width="${(0.9 * p.s).toFixed(2)}" paint-order="stroke">${ch}</text>`);
    }
  }
  if (opts.showSnaps && !design.parts) {
    const lay = LAYOUTS[design.shape];
    lay.snaps.forEach(([x, y], i) => {
      const r = 17.5 * lay.emblemScale + 1.5;
      const sel = opts.selectedSlot === i;
      out.push(`<circle cx="${x}" cy="${-y}" r="${r.toFixed(1)}" fill="none" stroke="${sel ? '#ffcf3f' : '#ffffff'}" stroke-width="${sel ? 2.4 : 1.1}" stroke-dasharray="${sel ? '' : '2.5 2'}"/>`);
      out.push(`<text x="${x - r + 1}" y="${-y - r + 4}" font-size="5" font-weight="800" fill="#ffffff" stroke="#0b1530" stroke-width="1" paint-order="stroke" font-family="system-ui, sans-serif">${i + 1}</text>`);
    });
  }
  const title = opts.title ? `<title>${opts.title}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-52 -52 104 104" width="${size}" height="${size}" role="img"${opts.title ? ` aria-label="${opts.title}"` : ' aria-hidden="true"'}>${title}${out.join('')}</svg>`;
}

/** Plain words for a design, for screen readers and the finished-badge card. */
export function describeDesign(d, labels) {
  const shape = labels.shape(d.shape);
  const emblems = d.slots.filter(Boolean).map(labels.emblem);
  const bits = [`${labels.color(d.body)} ${shape.toLowerCase()}`];
  if (emblems.length) bits.push(`with ${emblems.length === 1 ? 'a' : emblems.length} raised ${emblems.length === 1 ? 'emblem' : 'emblems'} in ${labels.color(d.accent).toLowerCase()}: ${emblems.join(', ')}`);
  if (d.initials) bits.push(`and the initials ${d.initials.split('').join(' ')}`);
  return `${bits.join(' ')}.`;
}
