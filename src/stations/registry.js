/**
 * Station list. Each entry lazy-loads its module with a dynamic import.
 * A module's default export is a factory returning a StationModule.
 *
 * @typedef {Object} StationModule
 * @property {string} id
 * @property {string} title
 * @property {(ctx: StationContext) => Promise<void>} load   fetch own files (runs once per visit)
 * @property {(ctx: StationContext) => void} start           build the station UI in ctx.panel
 * @property {(dt: number) => void} [update]                 called every frame while open and not paused
 * @property {() => void} dispose                            free memory, restore hub objects
 *
 * @typedef {Object} StationSaveApi
 * @property {(level:number) => number} levelStars
 * @property {(level:number, stars:number) => number} recordLevel   returns best stars
 * @property {(skill:string) => boolean} awardStamp                  true if new
 * @property {() => boolean} hasStamp
 * @property {() => any} getBadge                                   Badge Builder only: saved badge or null
 * @property {(badge:any) => void} setBadge                         Badge Builder only
 *
 * @typedef {Object} StationContext
 * @property {import('three').Scene} scene
 * @property {import('three').PerspectiveCamera} camera   already cut to the cam_<id> marker
 * @property {import('../hub/hub.js').Hub} hub
 * @property {HTMLElement} panel                          the station side panel
 * @property {{play:(name:string)=>void}} avatar
 * @property {StationSaveApi} save
 * @property {{play:(name:string)=>void}} sound
 * @property {boolean} reducedMotion
 * @property {(url:string) => Promise<any>} loadGLTF
 * @property {() => {width:number, height:number, panelWidth:number, panelHeight:number, safe:{t:number,r:number,b:number,l:number}}} viewport
 *   panelWidth: a side panel's width (landscape); panelHeight: a bottom sheet's height (portrait). One of them is 0.
 * @property {(size:'short'|'normal'|'tall') => void} [setSheet]  portrait sheet height; 'short' gives the station's own view more room
 * @property {(fn: () => void) => void} onResize
 * @property {(skill:string) => void} showStamp          shell shows the stamp card
 * @property {() => void} exit                           back to the hub
 */

/**
 * @typedef {Object} StationDef
 * @property {string} id
 * @property {string} title
 * @property {string} emblem      badge piece, for the passport
 * @property {() => Promise<{default: (def: StationDef) => StationModule}>} module
 */

/** @type {StationDef[]} */
export const STATIONS = [
  { id: 'microscope', title: 'Microscopic Madness', emblem: 'cell', module: () => import('./microscope/index.js') },
  { id: 'robot', title: 'Robot Relay', emblem: 'gear', module: () => import('./robot/index.js') },
  { id: 'drone', title: 'Drone Dash', emblem: 'drone', module: () => import('./drone/index.js') },
  { id: 'heroes', title: 'Hologram Heroes', emblem: 'spark', module: () => import('./heroes/index.js') },
  { id: 'sky', title: 'Sky Seeker', emblem: 'planet', module: () => import('./sky/index.js') },
  { id: 'cypher', title: 'Science Cypher', emblem: 'wave', module: () => import('./cypher/index.js') },
  { id: 'badge', title: 'Badge Builder', emblem: 'badge', module: () => import('./badge/index.js') },
];

/** The six stamp stations (Badge Builder is the seventh and comes last). */
export const STAMP_STATIONS = STATIONS.filter((s) => s.id !== 'badge').map((s) => s.id);
