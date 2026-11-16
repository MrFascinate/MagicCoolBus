/**
 * Badge Builder design data and rules (no DOM, no three.js).
 *
 * Coordinates: "plane" millimetres on the badge face, x to the right, y up,
 * origin at the badge centre. A piece's glTF frame has x right and z toward
 * the viewer when lying flat, so plane y = -glTF z. "t" is height above the
 * bed when the badge lies flat (body 0 to 4 mm, raised pieces 4 to 6 mm).
 */
import pieces from './pieces.json';

export const PIECES = pieces;

export const SHAPES = [
  { id: 'circle', label: 'Circle' },
  { id: 'shield', label: 'Shield' },
  { id: 'hex', label: 'Hexagon' },
  { id: 'star', label: 'Star' },
];

/** The six emblems, one per stamp station, in passport order. */
export const EMBLEMS = [
  { id: 'cell', label: 'Cell', station: 'microscope', stationTitle: 'Microscopic Madness' },
  { id: 'gear', label: 'Gear', station: 'robot', stationTitle: 'Robot Relay' },
  { id: 'drone', label: 'Drone', station: 'drone', stationTitle: 'Drone Dash' },
  { id: 'spark', label: 'Spark', station: 'heroes', stationTitle: 'Hologram Heroes' },
  { id: 'planet', label: 'Ringed planet', station: 'sky', stationTitle: 'Sky Seeker' },
  { id: 'wave', label: 'Sound wave', station: 'cypher', stationTitle: 'Science Cypher' },
];
export const EMBLEM_IDS = EMBLEMS.map((e) => e.id);

/** Filament colours. Each has a name, so colour is never the only clue. */
export const COLORS = [
  { id: 'navy', label: 'Navy', hex: '#22356f' },
  { id: 'teal', label: 'Teal', hex: '#139c8e' },
  { id: 'yellow', label: 'Yellow', hex: '#ffcc33' },
  { id: 'coral', label: 'Coral', hex: '#ff6b4a' },
  { id: 'white', label: 'White', hex: '#f4f6fb' },
  { id: 'purple', label: 'Purple', hex: '#7a3fc0' },
];

export const BODY_T = 4;     // mm
export const RAISED_T = 2;   // mm
export const LAYER_MM = 0.2; // printed layer height used for the layer count
export const SMALL_EMBLEM = 0.5; // emblem scale on a full badge (35 mm becomes about 18 mm)
export const LETTER_GAP = 1.5;   // mm between initials

/**
 * Snap points for the six emblems on each shape (plane mm), and where the
 * initials sit. Checked by tests: every spot keeps its piece on the badge.
 */
export const LAYOUTS = {
  circle: { snaps: [[-20, 20], [0, 22], [20, 20], [-20, -20], [0, -22], [20, -20]], initialsY: 0, emblemScale: SMALL_EMBLEM, letterScale: 1 },
  shield: { snaps: [[-22, 30], [0, 30], [22, 30], [-20, -8], [20, -8], [0, -26]], initialsY: 10, emblemScale: SMALL_EMBLEM, letterScale: 1 },
  hex: { snaps: [[-16, 18], [0, 21], [16, 18], [-16, -18], [0, -21], [16, -18]], initialsY: 0, emblemScale: SMALL_EMBLEM, letterScale: 1 },
  // the star is narrow, so its emblems and initials print smaller, and it has five spots
  star: { snaps: [[0, 19], [-16.2, 5.3], [-12.3, -17], [12.3, -17], [16.2, 5.3]], initialsY: -4, emblemScale: 0.35, letterScale: 0.6 },
};

/** A fresh level 3 design. */
export function newDesign() {
  return { shape: 'circle', body: 'navy', accent: 'yellow', slots: [null, null, null, null, null, null], initials: '' };
}

/** Number of snap points on a shape. */
export const snapCount = (shape) => LAYOUTS[shape].snaps.length;

export function setShape(d, shape) {
  if (!LAYOUTS[shape]) return d;
  const n = snapCount(shape);
  const slots = d.slots.slice(0, 6);
  // emblems on spots the new shape lacks move to the first free spot, or come off
  const keep = slots.slice(0, n);
  for (let i = n; i < slots.length; i++) {
    if (!slots[i]) continue;
    const free = keep.indexOf(null);
    if (free >= 0) keep[free] = slots[i];
  }
  while (keep.length < 6) keep.push(null);
  return { ...d, shape, slots: keep };
}

/** Put an emblem on a spot. An emblem is used once: placing it again moves it. */
export function placeEmblem(d, emblem, slot) {
  if (!EMBLEM_IDS.includes(emblem) || slot < 0 || slot >= snapCount(d.shape)) return d;
  const slots = d.slots.map((e) => (e === emblem ? null : e));
  slots[slot] = emblem;
  return { ...d, slots };
}

export function removeEmblem(d, slot) {
  const slots = d.slots.slice();
  slots[slot] = null;
  return { ...d, slots };
}

/** Move the emblem at `slot` to the next spot (dir +1 or -1), swapping if taken. */
export function nudgeEmblem(d, slot, dir) {
  const n = snapCount(d.shape);
  if (!d.slots[slot]) return { design: d, slot };
  const to = (slot + dir + n) % n;
  const slots = d.slots.slice();
  [slots[slot], slots[to]] = [slots[to], slots[slot]];
  return { design: { ...d, slots }, slot: to };
}

export function setColor(d, which, color) {
  if (!COLORS.some((c) => c.id === color) || (which !== 'body' && which !== 'accent')) return d;
  return { ...d, [which]: color };
}

export const placedCount = (d) => d.slots.filter(Boolean).length;

/** Width of a letter piece in mm. */
export function letterWidth(ch) {
  const p = PIECES[`letter_${ch}`];
  return p ? p.w : 0;
}

/**
 * Pieces to print for a design.
 * @returns {{piece:string, cx:number, cy:number, s:number, t0:number, th:number, kind:'body'|'emblem'|'letter'}[]}
 */
export function partsFor(d) {
  if (d.parts) return d.parts; // fixed test pieces (levels 1 and 2)
  const parts = [{ piece: `badge_${d.shape}`, cx: 0, cy: 0, s: 1, t0: 0, th: BODY_T, kind: 'body' }];
  const lay = LAYOUTS[d.shape];
  lay.snaps.forEach(([x, y], i) => {
    const e = d.slots[i];
    if (e) parts.push({ piece: `emblem_${e}`, cx: x, cy: y, s: lay.emblemScale, t0: BODY_T, th: RAISED_T, kind: 'emblem' });
  });
  const letters = (d.initials || '').split('');
  if (letters.length) {
    const ls = lay.letterScale;
    const widths = letters.map((ch) => letterWidth(ch) * ls);
    const total = widths.reduce((a, b) => a + b, 0) + LETTER_GAP * ls * (letters.length - 1);
    let x = -total / 2;
    letters.forEach((ch, i) => {
      parts.push({ piece: `letter_${ch}`, cx: x + widths[i] / 2, cy: lay.initialsY, s: ls, t0: BODY_T, th: RAISED_T, kind: 'letter' });
      x += widths[i] + LETTER_GAP * ls;
    });
  }
  return parts;
}

/** Fixed designs for the two practice levels. */
export function testToken(emblem) {
  return {
    shape: 'circle', body: 'teal', accent: 'yellow', slots: [], initials: '',
    parts: [
      { piece: 'badge_circle', cx: 0, cy: 0, s: 1, t0: 0, th: BODY_T, kind: 'body' },
      { piece: `emblem_${emblem}`, cx: 0, cy: 0, s: 1, t0: BODY_T, th: RAISED_T, kind: 'emblem' },
    ],
  };
}

/** Hexagon token with a spark emblem sticking out past its top edge. */
export function overhangToken() {
  return {
    shape: 'hex', body: 'purple', accent: 'yellow', slots: [], initials: '',
    parts: [
      { piece: 'badge_hex', cx: 0, cy: 0, s: 1, t0: 0, th: BODY_T, kind: 'body' },
      { piece: 'emblem_spark', cx: 0, cy: 35, s: 1, t0: BODY_T, th: RAISED_T, kind: 'emblem' },
    ],
  };
}
