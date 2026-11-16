/**
 * Sky Seeker rules: looks, clue progress, Confirm, stars. Pure, no DOM.
 */
import { ZOOMS, centerTol, viewVec, sepDeg, starVec, DRAG_REACH } from './sky.js';
import { constellationOf } from './levels.js';

/**
 * @typedef {Object} SkyState
 * @property {import('./sky.js').View} view
 * @property {number} looks
 * @property {number} found        clue steps found so far, in order
 * @property {boolean} inOrder     false once a later step is centered before an earlier one
 * @property {number} wrong        Confirms on the wrong thing
 * @property {boolean} done
 */

/** @param {import('./levels.js').SkyLevel} level @returns {SkyState} */
export function newState(level) {
  return { view: { ...level.start }, looks: 0, found: 0, inOrder: true, wrong: 0, done: false };
}

/** Is object o centered in this view? zooms: where it counts (default: wherever it shows). */
export function isCentered(view, o, zooms = o.zooms) {
  if (!o.zooms.includes(view.zoom) || !zooms.includes(view.zoom)) return false;
  return sepDeg(viewVec(view), o.v) <= centerTol(view.zoom);
}

/**
 * Call after every look or zoom change. Marks clue steps found, in order.
 * @returns {number[]} indexes of steps found by this settle
 */
export function settle(state, level, objects) {
  const out = [];
  while (state.found < level.steps.length - 1 || (state.found === level.steps.length - 1 && !state.targetSeen)) {
    const step = level.steps[state.found];
    if (!step) break;
    if (isCentered(state.view, objects[step.id], step.zooms)) {
      out.push(state.found);
      if (state.found === level.steps.length - 1) { state.targetSeen = true; break; }
      state.found++;
    } else break;
  }
  // centering a later step before this one breaks the order
  for (let k = state.found + 1; k < level.steps.length; k++) {
    const st = level.steps[k];
    if (isCentered(state.view, objects[st.id], st.zooms)) state.inOrder = false;
  }
  return out;
}

/** One look: a drag that ended, or an arrow tap. */
export function look(state, level, objects) {
  state.looks++;
  return settle(state, level, objects);
}

/**
 * What is in the middle of the view, in words.
 * @returns {{id:string|null, text:string}}
 */
export function identify(view, sky, objects) {
  const c = viewVec(view);
  const tol = centerTol(view.zoom);
  const nearest = (pick, within) => {
    let best = null, bestD = Infinity;
    for (const o of Object.values(objects)) {
      if (!pick(o) || !o.zooms.includes(view.zoom)) continue;
      const d = sepDeg(c, o.v);
      if (d <= within(o) && d < bestD) { best = o; bestD = d; }
    }
    return best;
  };
  const hit =
    nearest((o) => o.feature?.kind === 'crater', (o) => (o.radius || 0) + tol * 0.5) ||
    nearest((o) => o.feature?.kind === 'mare', (o) => o.radius || 0) ||
    nearest((o) => !o.feature && o.id !== 'moon', (o) => (o.radius || 0) + tol) ||
    (view.zoom === 'high' ? null : nearest((o) => o.id === 'moon', (o) => (o.radius || 0) + tol));
  if (hit) return { id: hit.id, text: `That is ${hit.what}.` };
  // the Moon's disk at High with no named feature under the middle
  if (sepDeg(c, objects.moon.v) <= objects.moon.radius) return { id: 'moon', text: 'That is a patch of the Moon with no named feature in this game.' };
  // nearest star brighter than this zoom's limit
  let si = -1, sd = Infinity;
  for (let i = 0; i < sky.n; i++) {
    if (sky.mag[i] > ZOOMS[view.zoom].limitMag) continue;
    const d = sepDeg(c, starVec(sky, i));
    if (d < sd) { sd = d; si = i; }
  }
  if (si >= 0 && sd <= tol) {
    const name = sky.names.get(si);
    const con = constellationOf(sky, si);
    if (name) return { id: name, text: `That is ${name}, a star${con ? ` in ${con}` : ''}.` };
    return { id: null, text: con ? `That is a star in ${con}.` : 'That is a faint star with no common name.' };
  }
  return { id: null, text: 'There is only dark sky in the middle of the view.' };
}

/**
 * Tap Confirm.
 * @returns {{kind:'win'|'zoom'|'wrong', text:string}}
 */
export function confirm(state, level, sky, objects) {
  const target = objects[level.steps[level.steps.length - 1].id];
  const c = viewVec(state.view);
  const onTarget = sepDeg(c, target.v) <= centerTol(state.view.zoom) && target.zooms.includes(state.view.zoom);
  if (onTarget && level.confirmZooms.includes(state.view.zoom)) {
    // reaching the target also finishes the clue path
    settle(state, level, objects);
    state.done = true;
    return { kind: 'win', text: `You found ${target.name}.` };
  }
  if (onTarget || (state.view.zoom === 'finder' && sepDeg(c, target.v) <= centerTol('finder'))) {
    return { kind: 'zoom', text: `You are close. Zoom in to ${level.confirmZooms.map((z) => ZOOMS[z].label).join(' or ')} to check, then Confirm.` };
  }
  state.wrong++;
  const id = identify(state.view, sky, objects);
  return { kind: 'wrong', text: id.text };
}

/**
 * Stars from the spec: one for confirming the target, two for staying within
 * the look limit, three for centering each clue star in order and confirming
 * on the first try.
 */
export function starsFor(state, level) {
  const confirmed = !!state.done;
  const withinLimit = confirmed && state.looks <= level.limit;
  const allFound = state.found >= level.steps.length - 1;
  const clean = withinLimit && state.inOrder && allFound && state.wrong === 0;
  return { stars: clean ? 3 : withinLimit ? 2 : confirmed ? 1 : 0, confirmed, withinLimit, inOrder: state.inOrder && allFound, firstTry: state.wrong === 0 };
}

/**
 * Fewest looks to finish a level: each look is a drag that can move the view
 * by at most DRAG_REACH of the field, at the widest zoom where the next clue
 * object can be seen. Zooming is free. A clue step counts once it sits inside
 * the centre ring. Returns the look count and the route.
 */
export function fewestLooks(level, objects) {
  let p = viewSpot(level.start);
  let looks = 0;
  const legs = [];
  const reachF = ZOOMS.finder.fov * DRAG_REACH;
  level.steps.forEach((step, k) => {
    const o = objects[step.id];
    const last = k === level.steps.length - 1;
    const endTol = centerTol(last ? level.confirmZooms[0] : (step.zooms || o.zooms)[0]);
    const d = sepDeg(p, o.v);
    let n = 0;
    if (d > endTol) {
      if (o.zooms.includes('finder')) {
        // at a wide zoom a drag can land anywhere inside the ring; the target is
        // confirmed zoomed in, so that last hop lands right on it
        n = Math.ceil((last ? d : d - endTol) / reachF);
      } else {
        // seen only up close (a crater): it must already be inside the zoomed-in field,
        // or one wide look first brings the Moon to the middle
        const reachZ = ZOOMS[o.zooms[0]].fov * DRAG_REACH;
        n = d <= reachZ ? 1 : Math.ceil(d / reachF) + 1;
      }
      p = o.v;
    }
    looks += n;
    legs.push({ id: step.id, deg: d, looks: n });
  });
  return { looks, legs };
}

function viewSpot(v) {
  const D = Math.PI / 180;
  const ca = Math.cos(v.alt * D);
  return [ca * Math.sin(v.az * D), ca * Math.cos(v.az * D), Math.sin(v.alt * D)];
}

/**
 * Looks needed with the arrow buttons or keys only: hold an arrow to pan,
 * release to end the look. Each hop needs at most one up/down look and one
 * left/right look.
 */
export function arrowLooks(level) {
  return level.steps.length * 2;
}
