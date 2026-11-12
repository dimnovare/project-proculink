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

// Help pages retired by the relaunch rewrite (plan 12b). The 46 order-era articles and
// guides were replaced by a smaller set around flows, documents, outputs and lookups, so
// every old URL points at the nearest new page. Article values are `/help/<slug>` tails;
// the `guides/` prefix marks a guide. One table here is the whole pairing — the retirement
// gate and src/lib/help-articles.test.ts read it, so a slug cannot be dropped without a 308.
const HELP_DIR = "src/app/(marketing)/help";
const HELP_WHY =
  "Rewritten for the document product at relaunch; the old page described purchase orders, "
  + "so its URL permanently points at the nearest page in the new help set.";

const RETIRED_HELP_ARTICLES: Record<string, string> = {
  "inbound-mode": "how-proculink-works",
  "dashboard-and-statuses": "documents-and-statuses",
  "inbox-basics": "documents-and-statuses",
  "x12-850": "what-we-read",
  "edifact-orders": "what-we-read",
  "sap-idoc-orders05": "what-we-read",
  "ubl-and-peppol": "what-we-read",
  "csv-xlsx-field-guide": "what-we-read",
  "validation-rules": "checks",
  "connections": "flows",
  "order-intake-options": "intake-channels",
  "mapping-basics": "outputs",
  "output-mapping-editor": "outputs",
  "output-templates": "outputs",
  "cxml-setup": "outputs",
  "delivery-setup": "destinations",
  "delivery-config": "destinations",
  "managing-suppliers": "destinations",
  "erp-erply-and-directo": "destinations",
  "oauth2-delivery-setup": "destination-sign-in",
  "sftp-ftps-delivery-keys": "destination-sign-in",
  "item-codes": "lookups",
  "catalog-csv-field-guide": "lookups",
  "ai-suggestions": "ai-in-proculink",
  "api-and-integrations": "api-reference",
  "api-order-schema-reference": "api-reference",
  "exceptions-and-stuck-orders": "troubleshooting",
  "first-upload": "guides/set-up-your-first-flow",
  "imap-provider-setup": "guides/collect-from-a-mailbox",
  "email-polling": "guides/collect-from-a-mailbox",
  "sftp-polling-setup": "guides/collect-from-a-server",
  "s3-polling-setup": "guides/collect-from-s3",
};

const RETIRED_HELP_GUIDES: Record<string, string> = {
  "set-up-your-workspace": "set-up-your-first-flow",
  "first-order-end-to-end": "set-up-your-first-flow",
  "upload-orders-manually": "set-up-your-first-flow",
  "receive-orders-by-email": "receive-documents-by-email",
  "poll-a-mailbox-over-imap": "collect-from-a-mailbox",
  "receive-orders-by-sftp": "collect-from-a-server",
  "receive-orders-from-s3": "collect-from-s3",
  "receive-orders-over-api": "send-documents-by-api",
  "add-a-supplier": "send-to-a-destination",
  "set-up-supplier-delivery": "send-to-a-destination",
  "import-a-supplier-catalog": "import-a-lookup",
  "keep-a-catalog-in-sync": "import-a-lookup",
  "resolve-item-codes": "import-a-lookup",
  "review-an-order": "check-and-send-a-document",
  "map-supplier-po-fields": "build-an-output",
  "automate-delivery": "publish-a-flow-version",
};

const RETIRED_HELP: RetiredRoute[] = [
  ...Object.entries(RETIRED_HELP_ARTICLES).map(([old, to]) => ({
    source: `/help/${old}`,
    destination: `/help/${to}`,
    deletedDir: `${HELP_DIR}/${old}`,
    why: HELP_WHY,
  })),
  ...Object.entries(RETIRED_HELP_GUIDES).map(([old, to]) => ({
    source: `/help/guides/${old}`,
    destination: `/help/guides/${to}`,
    deletedDir: `${HELP_DIR}/guides/${old}`,
    why: HELP_WHY,
  })),
];

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
    source: "/operations/connectors",
    destination: "/library/suppliers",
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
    source: "/customers",
    destination: "/book-demo",
    deletedDir: "src/app/(marketing)/customers",
    why:
      "A references page with no references: it existed to say there were none yet. That was "
      + "honest, but it made the absence the content. The demo page took over the job "
      + "a prospect came for. When approved references exist, a Clients page replaces this redirect.",
  },
  {
    source: "/pilot",
    destination: "/book-demo",
    deletedDir: "src/app/(marketing)/pilot",
    why:
      "The supported-pilot application sold the order product. The relaunch retired it; "
      + "a prospect who wants a conversation books a demo.",
  },
  {
    source: "/watch",
    destination: "/how-it-works",
    deletedDir: "src/app/(marketing)/watch",
    why:
      "The walkthrough video shows the order product and cannot be re-shot yet. "
      + "How it works carries the story until a new video exists.",
  },
  {
    source: "/one-pager",
    destination: "/",
    deletedDir: "src/app/(marketing)/one-pager",
    why:
      "A print page describing the order product. The landing page is the one place "
      + "that says what ProcuLink does.",
  },
  ...RETIRED_HELP,
];

/** The `redirects()` entries next.config.ts needs. `permanent: true` → HTTP 308. */
export const RETIRED_ROUTE_REDIRECTS = RETIRED_ROUTES.map(({ source, destination }) => ({
  source,
  destination,
  permanent: true,
}));
