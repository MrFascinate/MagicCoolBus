/**
 * Pure game logic for Microscopic Madness (no DOM, no three.js).
 *
 * One round = one specimen. The player starts at the closest zoom step.
 * A wrong guess crosses that answer out and zooms out one step. The player
 * may also zoom out on purpose. With four answers and four steps, three
 * wrong guesses always leave one answer at the widest step, so every round
 * ends in a reveal.
 */
import { ZOOM_STEPS } from './levels.js';

/**
 * @param {{name:string, choices:string[]}} specimen
 */
export function createRound(specimen) {
  return {
    answer: specimen.name,
    choices: specimen.choices.slice(),
    crossed: /** @type {string[]} */ ([]),
    step: 0,            // 0 = closest zoom
    wrong: 0,
    zoomOuts: 0,
    solved: false,
    solvedAtStep: -1,
  };
}

/**
 * Apply a guess. Returns what happened; the round object is updated in place.
 * @param {ReturnType<typeof createRound>} round
 * @param {string} choice
 * @returns {{result:'right'|'wrong'|'ignored', step:number, hintIndex:number}}
 */
export function guess(round, choice) {
  if (round.solved || round.crossed.includes(choice) || !round.choices.includes(choice)) {
    return { result: 'ignored', step: round.step, hintIndex: -1 };
  }
  if (choice === round.answer) {
    round.solved = true;
    round.solvedAtStep = round.step;
    return { result: 'right', step: round.step, hintIndex: -1 };
  }
  round.crossed.push(choice);
  round.wrong += 1;
  round.step = Math.min(ZOOM_STEPS - 1, round.step + 1);
  return { result: 'wrong', step: round.step, hintIndex: round.wrong - 1 };
}

/** Zoom out one step on purpose. Returns false at the widest step. */
export function zoomOut(round) {
  if (round.solved || round.step >= ZOOM_STEPS - 1) return false;
  round.step += 1;
  round.zoomOuts += 1;
  return true;
}

/** Answers still open (not crossed out). */
export function openChoices(round) {
  return round.choices.filter((c) => !round.crossed.includes(c));
}

/** True when the round was named at the closest zoom with no help. */
export function namedClosest(round) {
  return round.solved && round.solvedAtStep === 0 && round.wrong === 0 && round.zoomOuts === 0;
}

/**
 * Stars for a finished level, following the shared rules and the station spec:
 * 1 for finishing, 2 for staying within the wrong-guess limit,
 * 3 for naming all three objects at the closest zoom.
 * @param {ReturnType<typeof createRound>[]} rounds
 * @param {{wrongLimit:number}} level
 */
export function starsFor(rounds, level) {
  const finished = rounds.length > 0 && rounds.every((r) => r.solved);
  const wrong = rounds.reduce((n, r) => n + r.wrong, 0);
  const withinLimit = finished && wrong <= level.wrongLimit;
  const allClosest = withinLimit && rounds.every(namedClosest);
  return { stars: allClosest ? 3 : withinLimit ? 2 : finished ? 1 : 0, finished, withinLimit, allClosest, wrong };
}

/**
 * A scale bar for an image that shows `widthUm` micrometres across.
 * Picks a 1, 2 or 5 times a power of ten length near a fifth of the view.
 * @param {number} widthUm
 * @param {number} [target] fraction of the image width to aim for
 * @returns {{um:number, fraction:number, label:string, spoken:string}}
 */
export function scaleBar(widthUm, target = 0.22) {
  const want = widthUm * target;
  const p = 10 ** Math.floor(Math.log10(want));
  let best = p;
  for (const m of [1, 2, 5, 10]) if (Math.abs(m * p - want) < Math.abs(best - want)) best = m * p;
  return { um: best, fraction: best / widthUm, label: formatLength(best), spoken: formatLength(best, true) };
}

/**
 * 40 -> "40 µm", 2400 -> "2.4 mm". Spoken form spells the unit out.
 * @param {number} um
 * @param {boolean} [spoken]
 */
export function formatLength(um, spoken = false) {
  const trim = (n) => String(Math.round(n * 1000) / 1000);
  if (um >= 1000) return `${trim(um / 1000)} ${spoken ? (um === 1000 ? 'millimeter' : 'millimeters') : 'mm'}`;
  return `${trim(um)} ${spoken ? (um === 1 ? 'micrometer' : 'micrometers') : 'µm'}`;
}

/**
 * Validate and index the image manifest.
 * @param {{images:{specimen:string, step:number, file:string, widthUm:number, simulated:boolean}[]}} manifest
 * @returns {Map<string, {file:string, widthUm:number, simulated:boolean}[]>} specimen -> steps (index 0 = closest)
 */
export function indexManifest(manifest) {
  const map = new Map();
  for (const im of manifest.images || []) {
    if (!map.has(im.specimen)) map.set(im.specimen, []);
    map.get(im.specimen)[im.step - 1] = { file: im.file, widthUm: im.widthUm, simulated: im.simulated !== false };
  }
  for (const [id, steps] of map) {
    if (steps.length !== ZOOM_STEPS || steps.some((s) => !s)) throw new Error(`manifest: ${id} needs ${ZOOM_STEPS} steps`);
    for (let i = 1; i < steps.length; i++) if (!(steps[i].widthUm > steps[i - 1].widthUm)) throw new Error(`manifest: ${id} steps must widen`);
  }
  return map;
}
