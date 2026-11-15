/**
 * A server page's own total. A documents page lists every row it counts (a sample document is a row,
 * and `sampleCount` is always 0 there), so there is no second population to choose from; orders go
 * through `orderCountContract.ts` instead. Not known yet stays `undefined`, never 0.
 */
export const pageTotal = (page: { totalCount: number } | undefined): number | undefined => page?.totalCount;
