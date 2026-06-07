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

// Inbound (Invoices / ASNs) is a real but pre-launch surface. It must stay
// hidden from the primary nav even when the full nav is revealed
// (NEXT_PUBLIC_LAUNCH_FULL_NAV=true), because those flows are not part of the
// outbound-PO wedge we sell today. Gate it on its own dedicated flag (default
// OFF) so revealing the full nav does NOT leak Inbound. The routes still
// resolve if navigated to directly.
export const INBOUND_ENABLED =
  process.env.NEXT_PUBLIC_INBOUND_ENABLED === "true";

/** hrefs that remain in the sidebar during the first launch. */
export const LAUNCH_CORE_HREFS: ReadonlySet<string> = new Set([
  "/bridge",
  "/upload",
  "/inbox",
  "/library/suppliers",
  "/operations/exceptions",
  "/operations/health",
  "/admin",
  "/settings",
  "/help",
]);
