/**
 * Robot Relay levels.
 *
 * The arm turns between four fixed stops in a ring. Seen from the player's
 * camera, "Rotate right" moves one stop along Tray -> Bin 1 -> Bin 2 -> Bin 3
 * and from Bin 3 round the back to the Tray. "Rotate left" goes the other way.
 * Stop 0 is the tray; stops 1..3 are the bins at hub markers bin_1..bin_3.
 *
 * Parts wait on the tray in a line. The gripper always takes the part in the
 * pickup spot (the front of the line).
 */

/** @typedef {'cylinder'|'prism'|'cube'} PartShape */
/** @typedef {'a'|'b'|'c'} BinKind */

export const STOPS = 4;
export const TRAY = 0;

/** Bins as modeled in robot.glb: colour plus a shape icon. */
export const BINS = {
  a: { node: 'bin_a', icon: 'circle', color: 'teal', label: 'circle bin' },
  b: { node: 'bin_b', icon: 'triangle', color: 'yellow', label: 'triangle bin' },
  c: { node: 'bin_c', icon: 'square', color: 'coral', label: 'square bin' },
};

/** Parts as modeled in robot.glb. A part goes in the bin whose icon matches its shape. */
export const PARTS = {
  cylinder: { node: 'part_cylinder', bin: 'a', label: 'cylinder', color: 'teal' },
  prism: { node: 'part_prism', bin: 'b', label: 'triangle prism', color: 'yellow' },
  cube: { node: 'part_cube', bin: 'c', label: 'cube', color: 'coral' },
};

/**
 * @typedef {Object} RobotLevel
 * @property {number} id
 * @property {string} title
 * @property {string} goal
 * @property {string} teaches
 * @property {PartShape[]} parts    tray order, front first
 * @property {BinKind[]} bins       bin kind at stops 1, 2, 3
 * @property {boolean} barrier      true: the turn between Bin 3 and the Tray is blocked
 * @property {number} limit         move budget for two stars
 * @property {number} shortest      length of the shortest program (three stars)
 */

/** @type {RobotLevel[]} */
export const LEVELS = [
  {
    id: 1,
    title: 'One part',
    goal: 'Move the triangle prism into the triangle bin.',
    teaches: 'Order of steps',
    parts: ['prism'],
    bins: ['a', 'b', 'c'],
    barrier: false,
    shortest: 6,
    limit: 8,
  },
  {
    id: 2,
    title: 'Sort two',
    goal: 'Sort both parts. Each shape goes in the bin with the same icon.',
    teaches: 'Sorting by a property, planning a longer sequence',
    parts: ['cylinder', 'cube'],
    bins: ['a', 'b', 'c'],
    barrier: false,
    shortest: 11,
    limit: 15,
  },
  {
    id: 3,
    title: 'Around the barrier',
    goal: 'Sort both parts. A barrier blocks the turn between Bin 3 and the tray.',
    teaches: 'Planning around a constraint',
    parts: ['cube', 'prism'],
    bins: ['c', 'a', 'b'],
    barrier: true,
    shortest: 13,
    limit: 17,
  },
];

export const STAMP_SKILL = "Planned a robot's moves";

/** Shortest-plus margins from the build brief: +2, +4, +4. */
export const LIMIT_MARGIN = { 1: 2, 2: 4, 3: 4 };

/** Stop name for messages and the map. */
export function stopName(level, stop) {
  if (stop === TRAY) return 'the tray';
  return `Bin ${stop} (${BINS[level.bins[stop - 1]].label})`;
}
