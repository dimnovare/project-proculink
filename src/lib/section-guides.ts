// section-guides — "what is this screen" registry + pure helpers.
//
// One entry per in-app sidebar screen. HelpSlideover (opened from the topbar
// "?" button) is the ONLY home for guide content: it matches the current
// pathname against this registry and renders the entry in its "This screen"
// section. The topbar "?" button shows a small dot badge while the current
// route's guide is unseen (guideSeenKey absent); opening the slideover marks
// the route seen.
//
// CONTENT SOURCE (canonical — do not rewrite copy here):
// ProcuLink repo: docs/superpowers/plans/2026-06-12-section-guides-content.md
//
// `{supplier}` / `{suppliers}` / `{Supplier}` / `{Suppliers}` tokens are
// direction-aware party nouns resolved at render time via
// useOrderDirection().labels (outbound → Supplier, inbound → Customer).

export interface GuideLink {
  text: string;
  href?: string;
}

export interface SectionGuideEntry {
  route: string;
  title: string;
  purpose: string;
  bullets: GuideLink[];
  firstStep: GuideLink;
  /**
   * Related help-center article slugs for this screen ("Related reading" in
   * the help slideover; first 3 shown). Slugs are resolved against
   * HELP_ARTICLES and SILENTLY SKIPPED when no article exists yet — so this
   * list may reference articles the content pass hasn't written; they light
   * up as they ship, and nothing dead ever renders.
   */
  articleSlugs?: string[];
}

/** Minimal structural slice of PartyLabels — keeps this lib free of hook imports. */
export interface GuidePartyLabels {
  counterpartyNoun: string;
  counterpartyPlural: string;
}

export const SECTION_GUIDES: SectionGuideEntry[] = [
  {
    route: "/bridge",
    title: "Dashboard",
    purpose: "A live view of your order flow, delivery results, and {supplier} health.",
    bullets: [
      { text: "Watch live order flow between you and your {suppliers}" },
      { text: "Once orders arrive, filter stats by Today, 7d, 30d, or All" },
      { text: "See open exceptions and jump straight to them", href: "/operations/exceptions" },
      { text: "Track each {supplier}'s delivery health for the time window you pick", href: "/library/suppliers" },
      { text: "Export the current view as CSV — it covers your most recent 100 orders" },
    ],
    firstStep: { text: "Complete the two-step setup wizard — choose your order direction and add your first {supplier} — then use \"Try a practice order\" in the checklist." },
    articleSlugs: ["dashboard-and-statuses", "inbox-basics"],
  },
  {
    route: "/upload",
    title: "Upload an order",
    purpose: "Upload one purchase-order file, pick its {supplier}, and start the review.",
    bullets: [
      { text: "Upload a CSV, Excel, PDF, XML, EDIFACT, or X12 file" },
      { text: "See the detected format — and the PO number when one is found — before you upload" },
      { text: "Choose which {supplier} the order is for — the buyer is detected from the document" },
      { text: "Run a free sample order — it never counts toward your quota" },
      { text: "Check your plan's order and {supplier} usage in the side panel" },
    ],
    firstStep: { text: "Click \"Try with a sample order\" — it needs no setup and is free." },
    articleSlugs: ["order-intake-options", "csv-xlsx-field-guide", "troubleshooting"],
  },
  {
    route: "/inbox",
    title: "Inbox",
    purpose: "Your work queue of every order, with status filters, search, and bulk send.",
    bullets: [
      { text: "Filter by Needs review, Ready to send, Delivered, or Failed" },
      { text: "Search by PO number, buyer, or {supplier} name" },
      { text: "Track orders from Normalized to Ready to send to Delivered" },
      { text: "Select several orders and send them in one batch" },
      { text: "Move with j/k or arrow keys; Enter opens an order" },
    ],
    firstStep: { text: "If your inbox is empty, start with a practice order or upload your first file.", href: "/upload" },
    articleSlugs: ["inbox-basics", "dashboard-and-statuses", "item-codes"],
  },
  {
    route: "/inbox/[orderId]",
    title: "Order review",
    purpose: "Review one order — fix item codes and header details — before sending it on.",
    bullets: [
      { text: "Accept AI code suggestions or enter {supplier} codes manually" },
      { text: "Switch between “Fix issues” and “Map fields” at the top" },
      { text: "Save field fixes as a reusable {supplier} mapping (desktop view)" },
      { text: "Validate the output against cXML 1.2, UBL 2.1, or X12 850 profiles" },
      { text: "Download or copy the output after the order is transformed" },
    ],
    firstStep: { text: "Resolve each flagged line — accept a suggestion or set a code — then use the send/confirm button (shortcut C)." },
    articleSlugs: ["output-mapping-editor", "item-codes", "delivery-setup"],
  },
  {
    route: "/inbound/invoices",
    title: "Invoices",
    purpose: "Collect {supplier} invoices in one place — upload files, watch them parse, and track status.",
    bullets: [
      { text: "Upload {supplier} invoices as UBL 2.1 XML files" },
      { text: "Watch each invoice move from parsing to pending review" },
      { text: "Approve pending invoices from the list" },
      { text: "Download an invoice as CSV" },
    ],
    firstStep: { text: "Upload a UBL 2.1 XML invoice from a {supplier} — it parses automatically and appears in the list as pending review." },
    articleSlugs: ["order-intake-options"],
  },
  {
    route: "/inbound/asns",
    title: "Advance shipping notices",
    purpose: "Where {supplier} shipping notices will appear — ASN intake isn't available yet, so this list stays empty for now.",
    bullets: [
      { text: "See shipping notices from {suppliers}, once intake becomes available" },
      { text: "Uploading ASN files is not supported yet" },
      { text: "Contact support if you need ASN or EDIFACT DESADV intake" },
    ],
    firstStep: { text: "Nothing needs your attention here yet — if you want ASNs in ProcuLink, contact support; otherwise start with your invoices.", href: "/inbound/invoices" },
  },
  {
    route: "/library/suppliers",
    title: "{Suppliers}",
    purpose: "Every {supplier} you process orders for, with its configured output format, delivery channel, and auto-process status.",
    bullets: [
      { text: "Add a {supplier} by name — configure everything else afterwards" },
      { text: "See each {supplier}'s format, channel, and auto-process setting" },
      { text: "Open a row to set up mapping, catalog, and delivery" },
      { text: "Jump to a {supplier}'s versioned connection once one exists" },
      { text: "Plan limits apply — Pilot includes one {supplier}", href: "/settings?tab=billing" },
    ],
    firstStep: { text: "Click \"New {supplier}\" and enter a name — mapping, catalog, and delivery are configured afterwards on the detail page." },
    articleSlugs: ["managing-suppliers", "delivery-setup", "item-codes"],
  },
  {
    route: "/library/suppliers/[id]",
    title: "{Supplier} detail",
    purpose: "One {supplier}'s full setup across six tabs: overview, saved code mappings, product catalog, PO column mapping, delivery, and validation rules.",
    bullets: [
      { text: "Import the {supplier}'s product catalog (CSV or XLSX)", href: "?tab=catalog" },
      { text: "Set delivery format, channel, and credentials, then send a test", href: "?tab=delivery" },
      { text: "Map PO columns to fields after uploading a sample order" },
      { text: "Add validation rules — saved as draft until you activate them" },
      { text: "Edits on these tabs apply immediately to live processing" },
    ],
    firstStep: { text: "Import the {supplier}'s item catalog or set up delivery first — PO mapping only works after a sample order is uploaded.", href: "?tab=catalog" },
    articleSlugs: ["managing-suppliers", "delivery-setup", "catalog-csv-field-guide", "cxml-setup", "oauth2-delivery-setup", "sftp-ftps-delivery-keys", "erp-erply-and-directo", "item-codes", "mapping-basics"],
  },
  {
    route: "/library/buyers",
    title: "Buyers",
    purpose: "The organizations that send you purchase orders, with their observed formats and order history.",
    bullets: [
      { text: "Create a buyer with a name and short code" },
      { text: "Click a buyer to filter the Inbox to its orders", href: "/inbox" },
      { text: "See each buyer's primary format, order count, and last order" },
      { text: "Delete a buyer with the × on its row" },
    ],
    firstStep: { text: "Create one buyer, then upload a PO — formats and order history fill in from real orders." },
    articleSlugs: ["inbound-mode"],
  },
  {
    route: "/connections",
    title: "Connections",
    purpose: "How each {supplier}'s orders get mapped and delivered — every version kept so you can change it safely or roll back.",
    bullets: [
      { text: "Open one to see its mapping and version history" },
      { text: "See which {suppliers} have a live setup" },
      { text: "Created automatically when you configure a {supplier}" },
    ],
    firstStep: { text: "Configure a {supplier}'s mapping, output, and delivery — it shows up here automatically.", href: "/library/suppliers" },
    articleSlugs: ["connections"],
  },
  {
    route: "/connections/[connectionId]",
    title: "Connection detail",
    purpose: "Build how this {supplier}'s orders are mapped — drag their incoming fields across to the output — then make it live. Each order remembers the version that processed it.",
    bullets: [
      { text: "Drag incoming fields across to the output to build the mapping" },
      { text: "AI proposes likely matches as faint wires you accept or reject" },
      { text: "Add your own fields, and set transforms or fixed values per output field" },
      { text: "The full list of raw incoming fields is collapsed — search or expand it to find any field" },
      { text: "Preview what the {supplier} receives, then make it live; older versions stay so you can restore one" },
    ],
    firstStep: { text: "Click “Edit mapping”, drag incoming fields across to the output, preview the result, then make it live." },
    articleSlugs: ["connections", "output-mapping-editor", "mapping-basics"],
  },
  {
    route: "/library/mappings",
    title: "Item mappings",
    purpose: "Saved translations from your buyer item codes to each {supplier}'s item codes, applied automatically on every future order for that {supplier}.",
    bullets: [
      { text: "Pick a {supplier} to see its saved code mappings" },
      { text: "Add one buyer code → {supplier} code pair at a time" },
      { text: "Import many pairs from a CSV (buyer_code, supplier_code)" },
      { text: "Export the selected {supplier}'s mappings as a CSV file" },
      { text: "Filter by source: AI, Manual, Imported, or Inherited" },
    ],
    firstStep: { text: "Pick the {supplier} first, then import a CSV of your existing buyer-to-{supplier} code pairs." },
    articleSlugs: ["mapping-basics", "output-mapping-editor", "item-codes"],
  },
  {
    route: "/library/standards",
    title: "Standards reference",
    purpose: "A read-only table showing how each standard PO field maps to cXML, UBL, EDIFACT, X12, and Peppol BIS.",
    bullets: [
      { text: "Search fields or paths across all five standards" },
      { text: "Look up the exact reference for any field" },
      { text: "A dash means the standard has no mapped reference" },
      { text: "Request a format that's missing", href: "/support" },
    ],
    firstStep: { text: "Search a field like \"PO number\" or \"currency\" to read its exact reference in each standard." },
    articleSlugs: ["output-templates", "ubl-and-peppol", "x12-850", "edifact-orders", "sap-idoc-orders05", "cxml-setup", "order-intake-options"],
  },
  {
    route: "/operations/exceptions",
    title: "Exceptions",
    purpose: "Every order blocked on a human decision, in one workspace-wide list.",
    bullets: [
      { text: "Filter exceptions by Open, Resolved, or Ignored" },
      { text: "Expand a row to see what's wrong, why, and how to fix it" },
      { text: "Open the blocked order to fix the cause" },
      { text: "Ignore exceptions you won't act on" },
      { text: "Order exceptions can't be resolved from this list — fix the order instead" },
    ],
    firstStep: { text: "Nothing to do here until an order hits trouble — when an exception appears, expand it and use \"Open order to fix\"." },
    articleSlugs: ["exceptions-and-stuck-orders", "troubleshooting"],
  },
  {
    route: "/operations/health",
    title: "Pipeline health",
    purpose: "A live view of the worker and any orders stuck in a problem state.",
    bullets: [
      { text: "Check the worker banner — an offline worker stalls every upload" },
      { text: "Most count tiles link straight to the affected orders", href: "/inbox" },
      { text: "Requeue failed deliveries from the failed deliveries queue" },
      { text: "Open exceptions for anything needing a decision", href: "/operations/exceptions" },
      { text: "Counts refresh automatically every 45 seconds" },
    ],
    firstStep: { text: "Glance at the worker banner before your first upload — green means parsing will run." },
    articleSlugs: ["exceptions-and-stuck-orders"],
  },
  {
    route: "/operations/log",
    title: "Activity log",
    purpose: "A date-grouped audit trail of every order event in your workspace.",
    bullets: [
      { text: "Filter by event type or search by PO, buyer, or {supplier}" },
      { text: "Expand an entry to see details, errors, and field changes" },
      { text: "Jump to the order behind any event" },
      { text: "Export the current filtered view as CSV" },
      { text: "Only the latest 50 events load — exports cover those" },
    ],
    firstStep: { text: "Once orders exist, filter by Failed and open the order to retry it from there." },
    articleSlugs: ["dashboard-and-statuses", "delivery-setup"],
  },
  {
    route: "/operations/connectors",
    title: "Connectors",
    purpose: "A read-only overview of each {supplier}'s delivery channel, with safe test firing.",
    bullets: [
      { text: "See one card per {supplier} delivery channel" },
      { text: "Review what each connector type needs — fields, secrets, auth" },
      { text: "Test fire a {supplier}'s saved delivery endpoint" },
      { text: "Configure real endpoints on the {supplier} profile's Delivery tab", href: "/library/suppliers" },
    ],
    firstStep: { text: "Open a card and jump to the {supplier}'s Delivery tab to set up the real endpoint, then come back and test fire." },
    articleSlugs: ["delivery-setup", "oauth2-delivery-setup", "api-and-integrations", "api-order-schema-reference"],
  },
  {
    route: "/operations/webhooks",
    title: "Webhooks",
    purpose: "Send order events (created, delivered, failed) to your own systems automatically.",
    bullets: [
      { text: "Add endpoints for order.created, order.delivered, and order.failed" },
      { text: "Sign every payload with an optional HMAC-SHA256 secret" },
      { text: "Pause, resume, or delete endpoints anytime" },
      { text: "Editing isn't supported yet — delete and re-add instead" },
      { text: "Delivery history isn't recorded here yet" },
    ],
    firstStep: { text: "Add an endpoint for order.delivered with a signing secret, pointing at your ERP or automation tool's catch URL." },
    articleSlugs: ["api-and-integrations"],
  },
  {
    route: "/settings",
    title: "Settings",
    purpose: "Workspace name and order direction, billing, intake channels, API keys, and outbound webhooks.",
    bullets: [
      { text: "Set whether you send or receive purchase orders", href: "/settings?tab=org" },
      { text: "Check your plan, usage, and upgrade options", href: "/settings?tab=billing" },
      { text: "Pull orders from email, SFTP, or S3 (paid plans; add a {supplier} first)", href: "/settings?tab=email" },
      { text: "Create API keys and copy your order-intake URL", href: "/settings?tab=api" },
      { text: "Add webhooks — failure counts show here too", href: "/settings?tab=connectors" },
    ],
    firstStep: { text: "Set your order direction on the Organization tab first — it relabels the whole app.", href: "/settings?tab=org" },
    articleSlugs: ["imap-provider-setup", "sftp-polling-setup", "s3-polling-setup", "api-order-schema-reference", "billing-faq", "api-and-integrations", "inbound-mode"],
  },
];

// ─── Matching ────────────────────────────────────────────────────────────────

const segmentsOf = (route: string): string[] => route.split("/").filter(Boolean);
const isDynamicSegment = (seg: string): boolean => seg.startsWith("[") && seg.endsWith("]");

/**
 * Registry in match order: longest (most segments) first; among equal lengths,
 * static patterns before dynamic ones. This guarantees `/inbox/[orderId]` is
 * tried for `/inbox/<uuid>` while plain `/inbox` only matches `/inbox` exactly.
 */
const MATCH_ORDER: SectionGuideEntry[] = [...SECTION_GUIDES].sort((a, b) => {
  const sa = segmentsOf(a.route);
  const sb = segmentsOf(b.route);
  if (sb.length !== sa.length) return sb.length - sa.length;
  return sa.filter(isDynamicSegment).length - sb.filter(isDynamicSegment).length;
});

/**
 * Match a pathname against the registry. Exact segment match; `[param]`
 * segments match any single non-empty path segment. Trailing slashes and any
 * query/hash noise are ignored. Returns null when no guide exists.
 */
export function matchGuide(pathname: string | null | undefined): SectionGuideEntry | null {
  if (!pathname) return null;
  const path = pathname.split(/[?#]/)[0];
  const segs = path.split("/").filter(Boolean);
  if (segs.length === 0) return null;

  for (const entry of MATCH_ORDER) {
    const pattern = segmentsOf(entry.route);
    if (pattern.length !== segs.length) continue;
    let matches = true;
    for (let i = 0; i < pattern.length; i++) {
      if (isDynamicSegment(pattern[i])) continue; // any non-empty segment
      if (pattern[i] !== segs[i]) {
        matches = false;
        break;
      }
    }
    if (matches) return entry;
  }
  return null;
}

// ─── Token resolution ────────────────────────────────────────────────────────

/**
 * Resolve the direction-aware party tokens in guide copy.
 * `{Supplier}`/`{Suppliers}` keep the label's casing (it is capitalized);
 * `{supplier}`/`{suppliers}` are lower-cased. Text without tokens is unchanged.
 */
export function resolveGuideText(text: string, labels: GuidePartyLabels): string {
  return text
    .replaceAll("{Suppliers}", labels.counterpartyPlural)
    .replaceAll("{suppliers}", labels.counterpartyPlural.toLowerCase())
    .replaceAll("{Supplier}", labels.counterpartyNoun)
    .replaceAll("{supplier}", labels.counterpartyNoun.toLowerCase());
}

// ─── Seen state ──────────────────────────────────────────────────────────────

/** localStorage key marking a route's guide as seen (set when the help
 *  slideover is opened on that route; drives the topbar "?" dot badge).
 *  Keyed by the registry ROUTE pattern (e.g. `/inbox/[orderId]`), so seeing
 *  it once covers all instances. */
export function guideSeenKey(route: string): string {
  return `plk-guide-seen:${route}`;
}
