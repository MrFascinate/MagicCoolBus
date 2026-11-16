/**
 * Sky Seeker levels and the named things in the sky the game can point at.
 * Every fact here is listed with its source in SOURCES.md.
 */
import { moonFeatureVec, sepDeg, starVec, CON_NAMES } from './sky.js';

/** Lunar features from the IAU Gazetteer of Planetary Nomenclature (USGS), lat, lon east, diameter km. */
export const MOON_FEATURES = [
  { id: 'tycho', name: 'Tycho', kind: 'crater', lat: -43.2958, lon: 348.7847, km: 85.3, rays: true },
  { id: 'copernicus', name: 'Copernicus', kind: 'crater', lat: 9.6209, lon: 339.9214, km: 96.1, rays: true },
  { id: 'kepler', name: 'Kepler', kind: 'crater', lat: 8.121, lon: 321.9913, km: 29.5, rays: true },
  { id: 'aristarchus', name: 'Aristarchus', kind: 'crater', lat: 23.7299, lon: 312.5099, km: 40.0 },
  { id: 'plato', name: 'Plato', kind: 'crater', lat: 51.6192, lon: 350.6175, km: 100.7, dark: true },
  { id: 'clavius', name: 'Clavius', kind: 'crater', lat: -58.6228, lon: 345.2725, km: 230.8 },
  { id: 'ptolemaeus', name: 'Ptolemaeus', kind: 'crater', lat: -9.1605, lon: 358.1627, km: 153.7 },
  { id: 'imbrium', name: 'Mare Imbrium', kind: 'mare', lat: 34.7244, lon: 345.0914, km: 1145.5 },
  { id: 'serenitatis', name: 'Mare Serenitatis', kind: 'mare', lat: 27.2879, lon: 18.3596, km: 674.3 },
  { id: 'tranquillitatis', name: 'Mare Tranquillitatis', kind: 'mare', lat: 8.3487, lon: 30.8346, km: 875.7 },
  { id: 'crisium', name: 'Mare Crisium', kind: 'mare', lat: 16.1774, lon: 59.1037, km: 555.9 },
  { id: 'fecunditatis', name: 'Mare Fecunditatis', kind: 'mare', lat: -7.835, lon: 53.6691, km: 840.4 },
  { id: 'nectaris', name: 'Mare Nectaris', kind: 'mare', lat: -15.1852, lon: 34.6021, km: 339.4 },
  { id: 'nubium', name: 'Mare Nubium', kind: 'mare', lat: -20.5894, lon: 342.7128, km: 714.5 },
  { id: 'humorum', name: 'Mare Humorum', kind: 'mare', lat: -24.4785, lon: 321.4284, km: 419.7 },
  { id: 'procellarum', name: 'Oceanus Procellarum', kind: 'mare', lat: 20.6714, lon: 303.3226, km: 2592.2 },
  { id: 'frigoris', name: 'Mare Frigoris', kind: 'mare', lat: 57.5923, lon: 359.9936, km: 1446.4, stretch: 3.2 },
  { id: 'vaporum', name: 'Mare Vaporum', kind: 'mare', lat: 13.2, lon: 4.09, km: 242.5 },
  { id: 'insularum', name: 'Mare Insularum', kind: 'mare', lat: 7.792, lon: 329.3598, km: 511.9 },
  { id: 'cognitum', name: 'Mare Cognitum', kind: 'mare', lat: -10.5308, lon: 337.6856, km: 350.0 },
];
export const MOON_RADIUS_KM = 1737.4;

/**
 * @typedef {Object} SkyObject
 * @property {string} id
 * @property {string} name        what the game calls it
 * @property {string} what        short description for "That is ..."
 * @property {number[]} v         unit vector
 * @property {string[]} zooms     zooms where it can be seen and centered
 * @property {number} [radius]    angular radius in degrees, for extended things
 */

/** Build the objects the levels use, from the parsed sky. */
export function makeObjects(sky) {
  const star = (name, what) => {
    const i = sky.nameIndex.get(name);
    return { id: name, name, what, v: starVec(sky, i), zooms: ['finder', 'low', 'high'], star: i };
  };
  /** @type {Record<string, SkyObject>} */
  const o = {
    moon: { id: 'moon', name: 'the Moon', what: `the Moon, in front of the stars of ${sky.moon.constellation} tonight`, v: sky.moon.v, zooms: ['finder', 'low', 'high'], radius: sky.moon.diam / 2 },
    saturn: { id: 'saturn', name: 'Saturn', what: `Saturn, a planet. Tonight it is in ${sky.saturn.constellation}`, v: sky.saturn.v, zooms: ['finder', 'low', 'high'] },
    m31: { id: 'm31', name: 'the Andromeda Galaxy', what: 'the Andromeda Galaxy, a huge group of stars far beyond our own galaxy', v: sky.m31.v, zooms: ['finder', 'low', 'high'], radius: 0.6 },
    Alpheratz: star('Alpheratz', 'Alpheratz, the star at the corner of the Great Square that Pegasus shares with Andromeda'),
    Algenib: star('Algenib', 'Algenib, a corner star of the Great Square of Pegasus'),
    Mirach: star('Mirach', 'Mirach, a bright star in Andromeda'),
    'Mu Andromedae': star('Mu Andromedae', 'Mu Andromedae, a fainter star in Andromeda'),
  };
  for (const f of MOON_FEATURES) {
    o[f.id] = {
      id: f.id, name: f.name,
      what: f.kind === 'mare' ? `${f.name}, a dark plain of old lava on the Moon` : `${f.name}, a crater on the Moon`,
      v: moonFeatureVec(sky.moon, f.lat, f.lon), zooms: ['high'], radius: ((f.km / 2) / MOON_RADIUS_KM) * (sky.moon.diam / 2),
      feature: f,
    };
  }
  return o;
}

/**
 * @typedef {Object} SkyStep
 * @property {string} id      object id
 * @property {string} text    clue line
 * @property {string[]} [zooms] zooms where centering it counts (default: any zoom that shows it)
 *
 * @typedef {Object} SkyLevel
 * @property {number} id
 * @property {string} title
 * @property {string} goal
 * @property {string} teaches
 * @property {SkyStep[]} steps   in order; the last step is the target
 * @property {string[]} confirmZooms
 * @property {{alt:number, az:number, zoom:'finder'|'low'|'high'}} start
 * @property {number} limit     looks for two stars
 * @property {number} best      fewest looks possible (checked by the solver test)
 * @property {string} fact      shown after the level
 */

/** @type {SkyLevel[]} */
export const LEVELS = [
  {
    id: 1,
    title: 'Moon crater',
    goal: 'Find the Moon, zoom in, and center the crater Tycho.',
    teaches: 'Zoom shows detail but narrows the view',
    steps: [
      { id: 'moon', text: 'Find the Moon. It is the brightest thing in tonight\'s sky, low in the south. Center it.' },
      { id: 'tycho', text: 'Zoom to High. Tycho is a bright crater in the lower part of the Moon, with light streaks called rays spreading out from it. Center Tycho, then tap Confirm.' },
    ],
    confirmZooms: ['high'],
    start: { alt: 30, az: 125, zoom: 'finder' },
    limit: 6,
    best: 3,
    fact: 'Tycho is about 85 kilometers wide. It is one of the youngest big craters on the Moon, so its bright rays have not faded yet.',
  },
  {
    id: 2,
    title: 'Saturn',
    goal: 'Star-hop from the Great Square of Pegasus to Saturn, then zoom in to see its rings.',
    teaches: 'Star-hopping from known stars to a target',
    steps: [
      { id: 'Alpheratz', text: 'Find the Great Square of Pegasus, a big box of four stars high in the east. Center Alpheratz, its left corner.' },
      { id: 'Algenib', text: 'Hop down the side of the square to Algenib, the bottom corner. Center it.' },
      { id: 'saturn', text: 'From Algenib, keep going down toward the horizon about the same distance again. Saturn is the brightest point there. Center it, zoom in, and tap Confirm.' },
    ],
    confirmZooms: ['low', 'high'],
    start: { alt: 35, az: 170, zoom: 'finder' },
    limit: 8,
    best: 4,
    fact: 'Planets do not twinkle like stars, and they slowly move against the stars. That is why this map needs a date: on another night Saturn would be in a different spot.',
  },
  {
    id: 3,
    title: 'Andromeda Galaxy',
    goal: 'Hop from Alpheratz to the faint Andromeda Galaxy. A wide view helps you find it first.',
    teaches: 'Faint targets need a wide view first',
    steps: [
      { id: 'Alpheratz', text: 'Center Alpheratz, the left corner of the Great Square of Pegasus.' },
      { id: 'Mirach', text: 'Follow the curved line of stars away from the square, two hops, to Mirach. Center it.' },
      { id: 'Mu Andromedae', zooms: ['low'], text: 'Zoom to Low. From Mirach, hop up and to the left to the fainter star Mu Andromedae. Center it at Low.' },
      { id: 'm31', text: 'Keep going the same way, about the same distance again. Look for a faint, fuzzy oval. Center it at Low and tap Confirm. If you get lost, tap Finder to see more sky.' },
    ],
    confirmZooms: ['low', 'high'],
    start: { alt: 35, az: 130, zoom: 'finder' },
    limit: 10,
    best: 5,
    fact: 'The Andromeda Galaxy is about 2.5 million light-years away. The light you see left it long before there were people on Earth.',
  },
];

export const STAMP_SKILL = 'Star-hopped to a target';

/** Constellation full name for a star index, or null. */
export function constellationOf(sky, i) {
  const a = sky.conOf.get(i);
  return a ? CON_NAMES[a] || a : null;
}

/** Angular distance helper used by rules and tests. */
export const distDeg = sepDeg;
