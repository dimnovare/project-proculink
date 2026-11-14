// Browser-tab titles for the authenticated app.
//
// A tab title is user-facing copy, and this product ships ONE vocabulary: the
// word on the tab has to be a word the product already teaches, or an operator
// with six tabs open is reading a second set of names for the same six screens.
//
// This used to carry a mirror of the order product's hub tabs (HUB_TABS in
// src/components/bridge/layout/HubTabs.tsx). The hubs went with the order screens
// on 2026-11-13, so every title is now written here directly. The words are the
// ones the routes already shipped with.

/** Every title reads "<Name> — ProcuLink": the page first, the product second. */
export const TITLE_SUFFIX = " — ProcuLink";

/**
 * Route pattern → the page's own name (no product suffix).
 *
 * The detail pages get the singular of their list rather than the record's own
 * name: resolving the name in `generateMetadata` would add a server fetch on
 * every navigation — data the page already loads on the client — to change one
 * line of browser chrome.
 */
export const APP_PAGE_TITLES: Record<string, string> = {
  "/upload": "Upload",
  "/documents": "Documents",
  "/archive": "Old orders",
  "/archive/[orderId]": "Old order",
  "/flows": "Flows",
  "/flows/new": "New flow",
  "/flows/[flowId]": "Flow",
  "/flows/[flowId]/documents/[documentId]": "Flow document",
  "/flows/[flowId]/outputs/[outputId]/advanced": "Advanced view",
  "/lookups": "Lookups",
  "/lookups/[lookupId]": "Lookup",
  "/operations/log": "Deliveries",
  "/settings": "Settings",
  "/settings/google-callback": "Google account",
  "/admin": "Admin",
};

/**
 * The `<title>` for an app route. Throws on an unknown route rather than
 * falling back to a generic string: a page added with no entry here has to fail
 * loudly at build time, which is exactly the defect this module exists to fix.
 */
export function appPageTitle(route: string): string {
  const name = APP_PAGE_TITLES[route];
  if (!name) {
    throw new Error(`No tab title for "${route}". Add it to APP_PAGE_TITLES in src/lib/pageTitles.ts.`);
  }
  return `${name}${TITLE_SUFFIX}`;
}
