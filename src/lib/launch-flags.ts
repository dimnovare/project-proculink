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
// standards, operations), set NEXT_PUBLIC_LAUNCH_FULL_NAV=true.

export const LAUNCH_CORE_ONLY =
  process.env.NEXT_PUBLIC_LAUNCH_FULL_NAV !== "true";

/**
 * hrefs that remain in the sidebar during the first launch.
 *
 * Includes the FIRST-TAB href of every announced hub so all four hubs the
 * sidebar promises survive the core filter and stay reachable on mobile
 * (Operations → /operations/health). The supplier
 * and item-code hubs went with their screens — see src/lib/retired-routes.ts.
 * Sibling tabs inside each hub are reached via the HubTabs bar; their routes all
 * resolve directly.
 */
export const LAUNCH_CORE_HREFS: ReadonlySet<string> = new Set([
  "/bridge",
  "/upload",
  "/inbox",
  "/operations/exceptions",
  "/operations/health",
  "/admin",
  "/settings",
  "/help",
]);
