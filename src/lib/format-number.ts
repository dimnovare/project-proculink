// Fixed-locale NUMBER formatting — the missing half of `format-date.ts`.
//
// That file already says the whole argument, for dates:
//
//   "Passing `undefined` as the locale (the old per-component helpers did)
//    resolves to the host's runtime locale, which differs between the server
//    process and the user's browser — the classic source of hydration drift on
//    dates. Do NOT swap this back to the ambient locale."
//
// Every word of that is equally true of numbers, and it was never applied to
// them: 40 call sites across the app called `n.toLocaleString()` with no locale.
// Grouping separators differ by locale — `1,284` (en-GB/en-IE/en-US) vs `1.284`
// (de-DE) vs `1 284` (fr-FR) — so a number rendered on the server and hydrated in
// a browser with a different locale produces two different strings and React
// throws the SSR tree away.
//
// This is not theoretical. The three-viewport control sweep caught it in the act
// on 2026-08-26, twice, in the same run:
//
//   /library/suppliers/s1 — server "1284", client "1,284"
//   /library/buyers       — server "1820", client "1,820"
//
// Both are hydration failures, both were invisible to every existing test,
// and both are one call each.
//
// Grouping only diverges at 1000 and above, which is why nobody hit it sooner and
// why it will keep being missed by eye: every count under a thousand renders
// identically in every locale. The first PRICE that would show it is Distributor
// at €1,499.
//
// LOCALE CHOICE. "en-GB", the same constant `format-date.ts` picked, so the
// product speaks one locale rather than two. Its grouping is identical to the
// "en-IE" already used explicitly on /pricing and /one-pager, so those pages are
// unaffected and stay consistent with these.
//
// Do NOT swap this back to the ambient locale.

/**
 * Exported so call sites can pass it inline — `n.toLocaleString(NUMBER_LOCALE)` —
 * rather than rewriting every receiver expression into a helper call. A one-token
 * change per site keeps the diff reviewable, and the guard in
 * src/test/ambientLocale.test.ts fails the build if a bare call comes back.
 */
export const NUMBER_LOCALE = "en-GB";

/**
 * A whole number with locale-stable grouping: `1284` → `"1,284"`.
 *
 * Use this instead of `n.toLocaleString()` anywhere the value can reach the
 * server render — which, in an App Router app, is very nearly everywhere.
 */
export function formatCount(n: number): string {
  return n.toLocaleString(NUMBER_LOCALE);
}

/**
 * A number with an explicit fraction range, for the few places that need
 * decimals. Options are spread over the fixed locale rather than replacing it,
 * so a caller cannot accidentally reintroduce the ambient-locale bug by passing
 * only options.
 */
export function formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
  return n.toLocaleString(NUMBER_LOCALE, options);
}
