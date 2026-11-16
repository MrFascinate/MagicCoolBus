/**
 * Drone Dash levels. Grid cells are {c, r}: c = column 0..4 from west (-X) to east (+X),
 * r = row 0..4 from north (-Z, far side of the cage, toward the bus) to south (+Z, the door).
 * Directions: 0 = north, 1 = east, 2 = south, 3 = west.
 *
 * Pad positions are a game design choice. The pads in hub.glb (pad_1..3) do not fit the
 * spec (pad_1 sits on drone_start), so the board draws its own pads; see report.
 */

/** @typedef {{c:number, r:number}} Cell */
/** @typedef {'takeoff'|'forward'|'left'|'right'|'land'|'repeat'} BlockType */
/**
 * @typedef {Object} DroneLevel
 * @property {number} id
 * @property {string} title
 * @property {string} goal          short goal shown on screen
 * @property {string} teaches
 * @property {{c:number,r:number,dir:number}} start
 * @property {Cell} target          pad to land on
 * @property {number} targetPad     pad number shown on the board
 * @property {Cell|null} touch      pad to fly over first (level 3)
 * @property {number|null} touchPad
 * @property {number} limit         block limit for two stars
 * @property {number} shortest      size of the shortest possible program (three stars)
 * @property {BlockType[]} blocks   blocks in the palette
 */

export const GRID = 5;

/** Pads drawn on the board, by number. */
export const PADS = {
  1: { c: 2, r: 1, shape: 'circle' },
  2: { c: 4, r: 2, shape: 'square' },
  3: { c: 4, r: 4, shape: 'triangle' },
};

const START = { c: 2, r: 4, dir: 0 };
const BASIC = /** @type {BlockType[]} */ (['takeoff', 'forward', 'left', 'right', 'land']);

/** @type {DroneLevel[]} */
export const LEVELS = [
  {
    id: 1,
    title: 'Straight shot',
    goal: 'Land on Pad 1. It is straight ahead.',
    teaches: 'Order of steps',
    start: START,
    target: PADS[1], targetPad: 1,
    touch: null, touchPad: null,
    limit: 6,
    shortest: 5,
    blocks: BASIC,
  },
  {
    id: 2,
    title: 'Around the corner',
    goal: 'Land on Pad 2. It is off to one side.',
    teaches: 'Turns are relative to where the drone faces',
    start: START,
    target: PADS[2], targetPad: 2,
    touch: null, touchPad: null,
    limit: 8,
    shortest: 7,
    blocks: BASIC,
  },
  {
    id: 3,
    title: 'Loop it',
    goal: 'Fly over Pad 2, then land on Pad 3.',
    teaches: 'Repeat does the same steps again',
    start: START,
    target: PADS[3], targetPad: 3,
    touch: PADS[2], touchPad: 2,
    limit: 7,
    shortest: 6,
    blocks: [...BASIC, 'repeat'],
  },
];

export const STAMP_SKILL = 'Used a loop';
