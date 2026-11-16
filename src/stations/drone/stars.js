/**
 * Star rules for Drone Dash, following the shared rules:
 * 1 star for landing on the pad, 2 for staying within the block limit,
 * 3 for matching the shortest possible program. Retries never cost a star.
 */

/**
 * @param {{cleared:boolean, blocks:number}} run
 * @param {{limit:number, shortest:number}} level
 */
export function starsFor(run, level) {
  const landed = !!run.cleared;
  const withinLimit = landed && run.blocks <= level.limit;
  const shortest = withinLimit && run.blocks <= level.shortest;
  return { stars: shortest ? 3 : withinLimit ? 2 : landed ? 1 : 0, landed, withinLimit, shortest };
}

/** Stars are kept from the best run. */
export function bestStars(previous, next) {
  return Math.max(previous || 0, next || 0);
}
