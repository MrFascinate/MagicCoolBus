/**
 * Star rules for Robot Relay, from the station spec:
 * 1 star for sorting every part, 2 for staying within the move budget,
 * 3 for matching the shortest possible program. Runs never cost a star.
 */
/**
 * @param {{cleared:boolean, blocks:number}} run
 * @param {{limit:number, shortest:number}} level
 */
export function starsFor(run, level) {
  const sorted = !!run.cleared;
  const withinLimit = sorted && run.blocks <= level.limit;
  const shortest = withinLimit && run.blocks <= level.shortest;
  return { stars: shortest ? 3 : withinLimit ? 2 : sorted ? 1 : 0, sorted, withinLimit, shortest };
}
