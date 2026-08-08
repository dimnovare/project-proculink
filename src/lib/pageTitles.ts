// Browser-tab titles for the authenticated app.
//
// A tab title is user-facing copy, and this product ships ONE vocabulary: the
// word on the tab has to be the word the navigation already teaches, or an
// operator with six tabs open is reading a second set of names for the same six
// screens. HUB_TABS (src/components/bridge/layout/HubTabs.tsx) owns those words.
//
// ── WHY THIS IS A MIRROR AND NOT AN IMPORT ───────────────────────────────────
// The obvious implementation — `import { HUB_TABS }` and read the labels — does
// not work, and fails in a way worth recording so nobody spends the afternoon
// re-discovering it. HubTabs.tsx is `"use client"` (it needs usePathname and
// <Link>). `export const metadata` is evaluated in the RSC layer, where a
// "use client" module has been replaced by a client-reference proxy, so its
// exports are not the real values. Building it produced:
//
//   Error: Failed to collect configuration for /operations/log
//   [cause]: Error: No tab title for "/operations/log".
//
// — i.e. HUB_TABS read as empty from the server. Moving HUB_TABS into a plain
// module would fix that, but four guards path-pin it where it is
// (check-vocabulary.mjs NOUN_REGISTRIES, route-reachability's REGISTRY_FILES,
// link-crawl's NAV_SOURCES, retired-routes' NAV_SOURCES), and quietly moving a
// registry out from under a guard is a worse defect than the one being fixed.
//
// So the labels are mirrored below, and src/test/pageTitles.test.ts pins the
// mirror against HUB_TABS in BOTH directions — same hrefs, same words. Rename a
// tab and CI names the exact line to change. This is the same arrangement
// src/lib/plans.ts has with the backend's PlanConstants.cs, for the same reason:
// two runtimes that cannot import from each other.

/** Every title reads "<Name> — ProcuLink": the page first, the product second. */
export const TITLE_SUFFIX = " — ProcuLink";

/**
 * MIRROR of HUB_TABS — href → the label the hub strip prints.
 *
 * Do not edit by hand to "fix" a title. Edit HUB_TABS; this follows.
 * Pinned by src/test/pageTitles.test.ts, both directions.
 */
export const HUB_TAB_TITLES: Record<string, string> = {
  // orders
  "/inbox": "Orders",
  "/library/buyers": "Buyers",
  "/inbound/invoices": "Invoices",
  "/inbound/asns": "Shipping notices",
  // suppliers
  "/library/suppliers": "Suppliers",
  "/library/mappings": "Item codes",
  "/connections": "Supplier changes",
  "/library/standards": "Format reference",
  "/operations/connectors": "Delivery channels",
  // activity
  "/bridge": "Overview",
  "/operations/log": "Deliveries",
  "/operations/exceptions": "Issues",
  "/operations/health": "System status",
};

/**
 * Routes whose shipped title deliberately differs from their hub tab label.
 *
 * Both predate this pass and are left as they are on purpose. A tab label
 * is read INSIDE the product, where the hub around it supplies the context; a
 * browser tab has no context at all and sometimes needs the longer word —
 * "Overview" among a dozen foreign tabs says nothing, "Dashboard" does. (No
 * spec depends on them either way: nothing under tests/ or src/ asserts on an
 * app route's title. The reason is copy quality, not a test.)
 *
 * /connections was a third entry, pinned to "Connections" because its hub tab
 * was the hidden, contentless "Changes". That tab is now a visible "Supplier
 * changes", which needs no context to read, so the divergence lost its reason
 * and the entry is gone — the browser tab and the nav word are the same word
 * again.
 *
 * Recorded here rather than silently reconciled so the divergence is a decision
 * with a reason, and so the drift guard has something to pin: every key must
 * still be a real HUB_TABS href.
 */
export const LABEL_PINNED_TO_A_DIFFERENT_TITLE: Record<string, string> = {
  // Hub tab: "Overview".
  "/bridge": "Dashboard",
  // Hub tab: "Orders" — which is also the hub's own name; the queue is the one
  // screen users already call the inbox.
  "/inbox": "Inbox",
};

/**
 * Routes with no hub tab of their own: the pinned upload action, the account
 * area, the staff-only admin area, and the supplier detail page.
 *
 * The detail page gets the singular of its list rather than the supplier's own
 * name: resolving the name in `generateMetadata` would add a server fetch on
 * every navigation — data the page already loads on the client — to change one
 * line of browser chrome.
 */
export const OFF_HUB_TITLES: Record<string, string> = {
  "/upload": "Upload",
  "/settings": "Settings",
  "/admin": "Admin",
  "/library/suppliers/[id]": "Supplier",
};

/** Route pattern → the page's own name (no product suffix). */
export const APP_PAGE_TITLES: Record<string, string> = {
  ...HUB_TAB_TITLES,
  ...LABEL_PINNED_TO_A_DIFFERENT_TITLE,
  ...OFF_HUB_TITLES,
};

/**
 * The `<title>` for an app route. Throws on an unknown route rather than
 * falling back to a generic string: a page added with no entry here has to fail
 * loudly at build time, which is exactly the defect this module exists to fix.
 */
export function appPageTitle(route: string): string {
  const name = APP_PAGE_TITLES[route];
  if (!name) {
    throw new Error(
      `No tab title for "${route}". Add it to APP_PAGE_TITLES in src/lib/pageTitles.ts ` +
        `(or give the route a hub tab, which supplies the label automatically).`,
    );
  }
  return `${name}${TITLE_SUFFIX}`;
}
