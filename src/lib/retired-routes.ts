// Retired surfaces — one list, two consumers.
//
// When a page is removed from ProcuLink the URL must NOT start 404-ing. People
// bookmark screens, help articles name them, and search engines keep them
// indexed for months. So every removal ships a permanent redirect to the screen
// that took over the job, and this file is the single place that pairing lives:
//
//   • next.config.ts spreads RETIRED_ROUTE_REDIRECTS into its redirects().
//   • src/test/retired-routes.test.ts asserts the page is really gone, the
//     redirect is really wired, and the destination is really a live page.
//
// `permanent: true` is what makes Next.js answer 308 Permanent Redirect (a 301
// would let a browser rewrite the follow-up request to GET; 308 preserves the
// method and is what Next emits for permanent redirects). tests/e2e/retired-
// routes.spec.ts asserts the literal 308 against a running server.
//
// Adding an entry here is a product decision, not a refactor: only add a route
// whose removal has been decided, and only point at a destination that exists.

export interface RetiredRoute {
  /** The dead path, in Next.js redirect `source` syntax (`:param` for segments). */
  source: string;
  /** Where the visitor lands instead. Must resolve to a real page. */
  destination: string;
  /**
   * Directory under the repo root that must no longer exist. The route test
   * fails if the page is still on disk, which is what makes "delete + redirect"
   * a single indivisible change rather than two that can drift apart.
   */
  deletedDir: string;
  /** Why it went away, in plain language. Surfaces in review, not in the UI. */
  why: string;
}

export const RETIRED_ROUTES: RetiredRoute[] = [
  {
    source: "/library/templates",
    destination: "/library/suppliers",
    deletedDir: "src/app/(app)/library/templates",
    why:
      "The output-templates page could not change what any supplier receives — "
      + "the output format lives on each supplier's delivery config, and the page's "
      + "save posted a body the API never read. It described a control that did not exist.",
  },
  {
    source: "/library/rules",
    destination: "/library/suppliers",
    deletedDir: "src/app/(app)/library/rules",
    why:
      "The rule catalog was editable but inert: nothing in the parse, transform or "
      + "delivery path ever read those rules, and every rule reported 'Triggered 0 times'. "
      + "The checks that actually run are each supplier's Validation rules tab.",
  },
  {
    source: "/library/rule-definitions",
    destination: "/library/suppliers",
    deletedDir: "src/app/(app)/library/rule-definitions",
    why:
      "A read-only list of rule shapes with no link into it from anywhere in the product. "
      + "The same standards references are shown inline on the supplier Validation rules tab.",
  },
  {
    source: "/drafts",
    destination: "/inbox",
    deletedDir: "src/app/(app)/drafts",
    why:
      "A permanently empty list — orders cannot be saved as drafts, so nothing could "
      + "ever appear here. Unsent orders live in the Inbox.",
  },
  {
    source: "/operations/webhooks",
    destination: "/settings?tab=connectors",
    deletedDir: "src/app/(app)/operations/webhooks",
    why:
      "A second copy of Settings ▸ Connectors that no user could open — zero inbound links "
      + "anywhere in src/, and its only registry entry was a `hidden: true` hub tab. Both screens "
      + "called the same four endpoints (getIntegrations, createIntegration, toggleIntegration, "
      + "deleteIntegration) under the same TanStack key, and this copy was the lossier one: it "
      + "hardcoded platform:\"webhook\", a value Settings has no label for, so an endpoint created "
      + "here rendered there as a raw string. Settings owns the data.",
  },
  {
    source: "/upload/preview/:orderId",
    destination: "/inbox/:orderId",
    deletedDir: "src/app/(app)/upload/preview",
    why:
      "Unreachable: uploading has routed straight to the order review screen since the "
      + "review screen became a superset of this one. The order id is preserved so an old "
      + "link opens the same order.",
  },
];

/** The `redirects()` entries next.config.ts needs. `permanent: true` → HTTP 308. */
export const RETIRED_ROUTE_REDIRECTS = RETIRED_ROUTES.map(({ source, destination }) => ({
  source,
  destination,
  permanent: true,
}));
