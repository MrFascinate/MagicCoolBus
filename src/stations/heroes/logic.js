/**
 * Hologram Heroes rules, kept free of DOM and three.js so they can be tested.
 *
 * A level is two rounds. In each round the player picks holograms until they
 * pick the invention that solved the problem. A wrong pick removes that
 * hologram (after it shows what it did solve) and counts toward the level's
 * wrong-pick limit. There is no timer and no cost for trying again.
 */

/**
 * @typedef {Object} Round
 * @property {string} id
 * @property {number} level
 * @property {string} problem
 * @property {string} answer   prop node name
 * @property {string[]} choices
 * @property {string} inventor  key in people
 * @property {string} partner   key in people
 */

/** Rounds for one level, in content order. */
export function roundsFor(content, levelId) {
  return content.rounds.filter((r) => r.level === levelId);
}

export function levelById(content, levelId) {
  return content.levels.find((l) => l.id === levelId);
}

/**
 * Stars, following the shared rules and the station spec:
 * 1 for finishing the level, 2 for staying within the wrong-pick limit,
 * 3 for every round right on the first pick.
 * @param {{finished:boolean, wrongPicks:number}} run
 * @param {{wrongLimit:number}} level
 */
export function starsFor(run, level) {
  const finished = !!run.finished;
  const withinLimit = finished && run.wrongPicks <= level.wrongLimit;
  const allFirst = withinLimit && run.wrongPicks === 0;
  return { stars: allFirst ? 3 : withinLimit ? 2 : finished ? 1 : 0, finished, withinLimit, allFirst };
}

/**
 * State for one play of one level.
 * @param {any} content
 * @param {number} levelId
 */
export function createLevelRun(content, levelId) {
  const level = levelById(content, levelId);
  if (!level) throw new Error(`No level ${levelId}`);
  const rounds = roundsFor(content, levelId);
  let index = 0;
  let wrongPicks = 0;
  /** @type {Set<string>} */
  let removed = new Set();
  let solved = false;
  const firstTry = [];
  let wrongThisRound = 0;

  return {
    level,
    rounds,
    get index() { return index; },
    get round() { return rounds[index]; },
    get wrongPicks() { return wrongPicks; },
    get solved() { return solved; },
    get finished() { return index >= rounds.length - 1 && solved; },
    /** Choices still standing in this round. */
    remaining() { return rounds[index].choices.filter((c) => !removed.has(c)); },
    isRemoved(propId) { return removed.has(propId); },
    /**
     * @param {string} propId
     * @returns {{result:'right'|'wrong'|'ignored', solvedLine?:string}}
     */
    pick(propId) {
      const r = rounds[index];
      if (solved || !r.choices.includes(propId) || removed.has(propId)) return { result: 'ignored' };
      if (propId === r.answer) {
        solved = true;
        firstTry[index] = wrongThisRound === 0;
        return { result: 'right' };
      }
      removed.add(propId);
      wrongPicks++;
      wrongThisRound++;
      return { result: 'wrong', solvedLine: content.props[propId]?.solved || '' };
    },
    /** Move to the next round. Returns false if there is none. */
    next() {
      if (!solved || index >= rounds.length - 1) return false;
      index++;
      solved = false;
      removed = new Set();
      wrongThisRound = 0;
      return true;
    },
    /** All rounds right on the first pick so far. */
    firstTryAll() { return firstTry.length === rounds.length && firstTry.every(Boolean); },
    result() { return starsFor({ finished: index >= rounds.length - 1 && solved, wrongPicks }, level); },
  };
}

/** A level opens once the one before it has at least one star. */
export function isUnlocked(levelId, starsOf) {
  return levelId === 1 || starsOf(levelId - 1) > 0;
}
