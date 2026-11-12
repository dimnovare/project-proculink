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
  /**
   * Set when the source's dynamic segment names something the destination has no
   * counterpart for (a supplier id is not a flow id), so the redirect cannot carry it.
   * The route test otherwise fails a redirect that drops a segment.
   */
  segmentHasNoSuccessor?: true;
}

export const RETIRED_ROUTES: RetiredRoute[] = [
  {
    source: "/library/templates",
    destination: "/flows",
    deletedDir: "src/app/(app)/library/templates",
    why:
      "The output-templates page could not change what any supplier receives — "
      + "the output format lives on each supplier's delivery config, and the page's "
      + "save posted a body the API never read. It described a control that did not exist.",
  },
  {
    source: "/library/rules",
    destination: "/flows",
    deletedDir: "src/app/(app)/library/rules",
    why:
      "The rule catalog was editable but inert: nothing in the parse, transform or "
      + "delivery path ever read those rules, and every rule reported 'Triggered 0 times'. "
      + "The checks that actually run are set on each flow.",
  },
  {
    source: "/library/rule-definitions",
    destination: "/flows",
    deletedDir: "src/app/(app)/library/rule-definitions",
    why:
      "A read-only list of rule shapes with no link into it from anywhere in the product. "
      + "The same standards references are shown inline where a flow's checks are set.",
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
    source: "/operations/connectors",
    destination: "/settings",
    deletedDir: "src/app/(app)/operations/connectors",
    why:
      "A read-only page nothing linked to, describing a channel it could not see. Zero inbound "
      + "links anywhere in src/, and its only registry entry was a `hidden: true` hub tab. Every "
      + "field on it was `readOnly` and the panel said so, because no create or update endpoint "
      + "for a connector exists — both \"Add connector\" buttons opened a panel whose only forward "
      + "action was a link to /library/suppliers, so \"Add\" navigated away instead of adding. In "
      + "live mode it derived nothing from delivery configs either: GET /api/suppliers carries no "
      + "delivery-config signal, so every row was hardcoded to type \"API (REST)\", and the "
      + "requirements panel keyed off that guess showed an SFTP or Erply supplier the HTTP field "
      + "list. The suppliers list prints each supplier's real channel, and the supplier Delivery "
      + "tab test-fires the same endpoint against the protocol actually chosen.",
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
  {
    source: "/library/suppliers",
    destination: "/flows",
    deletedDir: "src/app/(app)/library/suppliers",
    why:
      "Every workspace runs on the document tool, where what a supplier used to carry "
      + "(its output format and delivery channel) belongs to a flow and its destinations. "
      + "The supplier list had no counterpart left to open.",
  },
  {
    source: "/library/suppliers/:id",
    destination: "/flows",
    deletedDir: "src/app/(app)/library/suppliers/[id]",
    segmentHasNoSuccessor: true,
    why:
      "A supplier's detail page (delivery, mapping, catalog, rules) went with the supplier "
      + "list. A supplier id is not a flow id, so the link lands on the flow list.",
  },
  {
    source: "/library/buyers",
    destination: "/flows",
    deletedDir: "src/app/(app)/library/buyers",
    why:
      "A directory of buyers that no parse, mapping or delivery step ever read, kept for "
      + "orders that now live in the read-only archive.",
  },
  {
    source: "/library/mappings",
    destination: "/lookups",
    deletedDir: "src/app/(app)/library/mappings",
    why:
      "Supplier item-code mappings are what lookups hold now: a table a flow reads to turn "
      + "one code into another.",
  },
  {
    source: "/library/standards",
    destination: "/flows",
    deletedDir: "src/app/(app)/library/standards",
    why:
      "The field reference was written for purchase-order fields. The document tool has no "
      + "equivalent screen yet, so the link lands on the flow list.",
  },
  {
    source: "/connections",
    destination: "/flows",
    deletedDir: "src/app/(app)/connections",
    why:
      "Versioned supplier connections were replaced by flow versions: publish, restore and "
      + "the version history live on each flow.",
  },
  {
    source: "/connections/:connectionId",
    destination: "/flows",
    deletedDir: "src/app/(app)/connections/[connectionId]",
    segmentHasNoSuccessor: true,
    why:
      "A connection's revisions and replay panel went with the connections list. A connection "
      + "id is not a flow id, so the link lands on the flow list.",
  },
  {
    source: "/inbound/invoices",
    destination: "/documents",
    deletedDir: "src/app/(app)/inbound/invoices",
    why:
      "The legacy inbound invoice list ran on the order pipeline, which every workspace has left. "
      + "Documents of every kind, invoices included, now arrive through a flow and are listed on Documents.",
  },
  {
    source: "/inbound/asns",
    destination: "/documents",
    deletedDir: "src/app/(app)/inbound/asns",
    why:
      "A permanently empty list: shipping-notice intake was never built. "
      + "Documents of every kind now arrive through a flow and are listed on Documents.",
  },
  {
    source: "/documents/:id",
    destination: "/archive/:id",
    deletedDir: "src/app/(app)/documents/[id]",
    why:
      "The legacy invoice screen opened an invoice that was stored as an order row. Those rows "
      + "are read-only history now, and the archive opens the same id. The Documents list at "
      + "/documents is the engine's own page and is not affected.",
  },
  {
    source: "/customers",
    destination: "/pilot",
    deletedDir: "src/app/(marketing)/customers",
    why:
      "A references page with no references: it existed to say there were none yet. That was "
      + "honest, but it made the absence the content. The Pilot Programme page took over the job "
      + "a prospect came for — how to try ProcuLink on one repeat supplier, and how a named "
      + "reference is agreed (only with the client's approval of wording and figures). When "
      + "approved references exist, a Clients page replaces this redirect.",
  },
];

/** The `redirects()` entries next.config.ts needs. `permanent: true` → HTTP 308. */
export const RETIRED_ROUTE_REDIRECTS = RETIRED_ROUTES.map(({ source, destination }) => ({
  source,
  destination,
  permanent: true,
}));
