// Single source of truth for first-launch product scope.
//
// For the initial commercial launch we deliberately show a narrow, calm shell —
// the hrefs in LAUNCH_CORE_HREFS below (dashboard, upload, inbox, suppliers,
// exceptions, system health, admin, settings, help). Every other route still
// exists and resolves if navigated to directly — it is just kept out of the
// primary navigation so the first-run product feels focused rather than like a
// broad integration toolkit. (STRUCT-1: "/connections" was dropped from the nav;
// a supplier's versioned connection now lives as the History tab on its supplier
// page — the /connections routes still resolve directly.)
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

/**
 * hrefs that remain in the sidebar during the first launch.
 *
 * Includes the FIRST-TAB href of every announced hub so all four hubs the
 * sidebar promises survive the core filter and stay reachable on mobile
 * (Partners → /library/suppliers, Rules & formats → /library/mappings,
 * Operations → /operations/health, Inbound → /inbound/invoices). It was five
 * until 2026-08-13: the Integrations entry pointed at /operations/connectors,
 * which was deleted (a read-only page nothing linked to) and now 308s to
 * /library/suppliers — see src/lib/retired-routes.ts.
 * Inbound additionally stays behind INBOUND_ENABLED
 * (its route is filtered out first in buildVisibleNav), so listing it here does
 * NOT leak it — it only lets it survive the core filter once inbound is enabled.
 * Sibling tabs inside each hub are reached via the HubTabs bar; their routes all
 * resolve directly.
 */
export const LAUNCH_CORE_HREFS: ReadonlySet<string> = new Set([
  "/bridge",
  "/upload",
  "/inbox",
  "/library/suppliers",
  "/library/mappings",
  "/operations/exceptions",
  "/operations/health",
  "/inbound/invoices",
  "/admin",
  "/settings",
  "/help",
]);
