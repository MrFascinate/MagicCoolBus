/** Badge Builder levels and star rules (from the station spec). */
export const STATION_TITLE = 'Badge Builder';

export const LEVELS = [
  { id: 1, title: 'Test token', goal: 'Print a plain disc with one raised emblem.', teaches: 'Print layers build up from the bed.', failLimit: 1 },
  { id: 2, title: 'Overhang', goal: 'Print a token with an emblem that sticks out past its edge.', teaches: 'A layer needs something under it.', failLimit: 2 },
  { id: 3, title: 'Your badge', goal: 'Design and print your own badge.', teaches: 'Pick the best way to lay your own design on the bed.', failLimit: 2 },
];

/**
 * 1 star for a print that works, 2 for staying within the failed-preview
 * limit, 3 for using the way that prints with the fewest layers.
 * Retries never cost a star: the count starts again on each new try of a level.
 * @param {{printed:boolean, failedPreviews:number, layers:number, fewest:number|null}} run
 * @param {{failLimit:number}} level
 */
export function starsFor(run, level) {
  const printed = !!run.printed;
  const withinLimit = printed && run.failedPreviews <= level.failLimit;
  const fewest = withinLimit && run.fewest !== null && run.layers <= run.fewest;
  return { stars: fewest ? 3 : withinLimit ? 2 : printed ? 1 : 0, printed, withinLimit, fewest };
}
