// Single source of truth for first-launch product scope.
//
// For the initial commercial launch we deliberately show a narrow, calm shell:
// Dashboard · Upload · Inbox · Suppliers · Settings · Help. Every other route
// still exists and resolves if navigated to directly — it is just kept out of
// the primary navigation so the first-run product feels focused rather than
// like a broad integration toolkit.
//
// To reveal the full product surface (drafts, buyers, rules, templates,
// standards, operations, inbound docs), set NEXT_PUBLIC_LAUNCH_FULL_NAV=true.

export const LAUNCH_CORE_ONLY =
  process.env.NEXT_PUBLIC_LAUNCH_FULL_NAV !== "true";

/** hrefs that remain in the sidebar during the first launch. */
export const LAUNCH_CORE_HREFS: ReadonlySet<string> = new Set([
  "/bridge",
  "/upload",
  "/inbox",
  "/library/suppliers",
  "/settings",
  "/help",
]);
