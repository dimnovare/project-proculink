/**
 * msSinceNavigationStart — how long this document has existed.
 *
 * WHY IT EXISTS (WP-32 follow-up). A bounded wait for a dependency the DOCUMENT
 * requested cannot start its clock when React mounts. `<ClerkProvider>` renders
 * a `<script src="https://<clerk-host>/…/clerk.browser.js" async>` element, so
 * the browser starts fetching it while the HTML is still parsing — long before
 * the app bundle has downloaded, parsed and hydrated. A `setTimeout` inside a
 * `useEffect` therefore measures "8s after hydration", while the product
 * promise ("an explanatory card within 10s") is wall clock from navigation.
 * Whatever hydration consumed has already been spent out of that budget, and
 * measuring from mount silently adds it back on.
 *
 * `performance.now()` is time since `performance.timeOrigin`, which for a
 * Window is the start of the document's navigation — exactly the anchor we
 * want. It is NOT reset by a client-side (soft) navigation, and that is
 * correct here rather than a bug: the script was requested by the document, so
 * a user who spends a minute on a marketing page before entering the app has
 * genuinely given it a minute.
 *
 * A one-line module for the same reason as src/lib/reload.ts: it makes the
 * clock mockable, so a test can pin the anchoring behaviour instead of
 * depending on how the test runner happens to fake `performance`.
 */
export function msSinceNavigationStart(): number {
  if (typeof window === "undefined" || typeof performance === "undefined") return 0;
  const elapsed = performance.now();
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : 0;
}
