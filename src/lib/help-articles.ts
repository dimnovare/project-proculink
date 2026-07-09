export type HelpCategory =
  | "Getting started"
  | "Connections"
  | "Mapping"
  | "Delivery"
  | "Integrations"
  | "AI"
  | "Billing"
  | "Troubleshooting";

export interface HelpArticle {
  slug: string;
  title: string;
  blurb: string;
  category: HelpCategory;
  /** Curated search terms — indexed by the shared Fuse instance (help-search). */
  keywords: string[];
  /** Estimated read time in minutes — single source (no page-local maps). */
  readMin: number;
  /**
   * Hosted per-tool walkthrough video (mp4). set ONLY when the mp4 is uploaded +
   * verified (offer⇔works). At most one article carries a given videoUrl.
   */
  videoUrl?: string;
  /**
   * Poster frame for the video element. set ONLY when the mp4 is uploaded +
   * verified (offer⇔works).
   */
  videoPosterUrl?: string;
}

/** Public R2 base for the per-tool walkthrough videos (assets.proculink.eu). */
const TOOL_VIDEO_BASE = "https://assets.proculink.eu/marketing/tools";

/**
 * Registry array order = reading order (drives the prev/next article pager).
 * Learning path: Getting started → Connections → Mapping → Delivery →
 * Integrations → AI → Billing → Troubleshooting.
 */
export const HELP_ARTICLES: HelpArticle[] = [
  // ── Getting started ──────────────────────────────────────────────────────
  {
    slug: "first-upload",
    title: "Your first purchase order upload",
    blurb: "Walk through uploading a purchase order file and getting it parsed.",
    category: "Getting started",
    keywords: ["upload", "csv", "xlsx", "pdf", "parse", "sample order", "preview", "format detection", "auto-detect"],
    readMin: 4,
    videoUrl: `${TOOL_VIDEO_BASE}/upload.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/upload-poster.jpg`,
  },
  {
    slug: "order-intake-options",
    title: "Ways to send orders to ProcuLink",
    blurb: "Manual upload, email, API, SFTP, and storage-folder options for getting POs into ProcuLink.",
    category: "Getting started",
    keywords: ["email", "imap", "api", "sftp", "s3", "intake", "ingestion", "channels", "idoc", "inbound email"],
    readMin: 5,
  },
  {
    slug: "inbound-mode",
    title: "Receiving orders from your customers (inbound mode)",
    blurb: "Flip your workspace from sending POs to suppliers to receiving POs from customers — labels change, the pipeline doesn't.",
    category: "Getting started",
    keywords: ["inbound", "customers", "direction", "receive orders", "relabel", "outbound"],
    readMin: 3,
  },
  {
    slug: "dashboard-and-statuses",
    title: "Order statuses from upload to delivered",
    blurb: "What Parsing, Needs review, Normalized, Ready to send, Sending, Delivered, and the failure states actually mean.",
    category: "Getting started",
    keywords: ["status", "normalized", "ready to send", "needs review", "sending", "delivered", "rejected", "dead-letter", "lifecycle"],
    readMin: 4,
    videoUrl: `${TOOL_VIDEO_BASE}/dashboard.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/dashboard-poster.jpg`,
  },
  {
    slug: "inbox-basics",
    title: "Working the Inbox",
    blurb: "The order work queue: status filters, search, keyboard navigation, and bulk send.",
    category: "Getting started",
    keywords: ["inbox", "work queue", "bulk send", "send selected", "filters", "search", "keyboard", "j/k", "pagination", "queue"],
    readMin: 5,
    videoUrl: `${TOOL_VIDEO_BASE}/inbox.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/inbox-poster.jpg`,
  },
  {
    slug: "csv-xlsx-field-guide",
    title: "CSV and XLSX field guide",
    blurb: "Which columns a CSV or XLSX purchase order needs, what ProcuLink infers for you, and the encoding and decimal-separator rules that keep numbers exact.",
    category: "Getting started",
    keywords: ["csv", "xlsx", "excel", "columns", "headers", "encoding", "utf-8", "decimal separator", "delimiter", "purchase order upload"],
    readMin: 4,
    videoUrl: `${TOOL_VIDEO_BASE}/csv-xlsx-field-guide.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/csv-xlsx-field-guide-poster.jpg`,
  },
  // ── Connections ──────────────────────────────────────────────────────────
  {
    slug: "connections",
    title: "Supplier connections: draft, test, publish, roll back",
    blurb: "Version a supplier's whole setup — mapping, rules, output, delivery — and change it safely with tests, replay, and rollback.",
    category: "Connections",
    keywords: ["connection", "revision", "draft", "publish", "test pack", "replay", "rollback", "version", "archive", "pinned"],
    readMin: 6,
    videoUrl: `${TOOL_VIDEO_BASE}/connections.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/connections-poster.jpg`,
  },
  // ── Mapping ──────────────────────────────────────────────────────────────
  {
    slug: "managing-suppliers",
    title: "Managing suppliers and their catalogs",
    blurb: "The suppliers list, the six-tab supplier profile, and the three ways to fill a catalog: file upload, scheduled pull, and API push.",
    category: "Mapping",
    keywords: ["suppliers", "customers", "supplier list", "catalog import", "catalog sync", "sftp", "ftps", "http api", "push", "auto-process", "tabs", "profile"],
    readMin: 6,
    videoUrl: `${TOOL_VIDEO_BASE}/suppliers.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/suppliers-poster.jpg`,
  },
  {
    slug: "mapping-basics",
    title: "PO field mapping basics",
    blurb: "Map your CSV columns to the standard purchase-order fields ProcuLink expects.",
    category: "Mapping",
    keywords: ["mapping", "columns", "fields", "manipulators", "starter template", "scriban", "erply", "directo", "expression", "auto-map"],
    readMin: 6,
    videoUrl: `${TOOL_VIDEO_BASE}/po-mapping.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/po-mapping-poster.jpg`,
  },
  {
    slug: "item-codes",
    title: "Supplier item codes, catalogs, and mappings",
    blurb: "What supplier item codes are, how a catalog upload powers auto-matching, and how resolutions are remembered.",
    category: "Mapping",
    keywords: ["item codes", "catalog", "sku", "auto-match", "code mappings", "resolve", "catalog import", "barcode", "gtin", "ean"],
    readMin: 5,
    videoUrl: `${TOOL_VIDEO_BASE}/review.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/review-poster.jpg`,
  },
  {
    slug: "catalog-csv-field-guide",
    title: "Supplier catalog CSV — field guide",
    blurb: "Which columns a supplier catalog CSV needs (only code is required), how re-import upserts by code, and how to map a supplier's own headers or positional columns.",
    category: "Mapping",
    keywords: ["supplier catalog", "catalog csv", "code column", "column mapping", "upsert by code", "decimal separator", "encoding windows-1252", "barcode gtin", "column aliases", "catalog import"],
    readMin: 4,
  },
  {
    slug: "output-mapping-editor",
    title: "Editing the output your supplier receives",
    blurb: "Per-order output overrides: pick sources, chain manipulators, write custom expressions or a whole-document template, and preview live.",
    category: "Mapping",
    keywords: ["output mapping", "override", "scriban", "template", "manipulators", "preview", "custom field", "promote", "expression"],
    readMin: 6,
  },
  {
    slug: "validation-rules",
    title: "Validation rules and rule definitions",
    blurb: "The rule catalog, reusable rule definitions, and the supplier acceptance rules that actually check orders.",
    category: "Mapping",
    keywords: ["validation", "rules", "rule definitions", "severity", "acceptance", "operators", "required", "blocking"],
    readMin: 5,
  },
  // ── Delivery ─────────────────────────────────────────────────────────────
  {
    slug: "delivery-setup",
    title: "Setting up delivery and test-fire",
    blurb: "Choose a protocol, send a test payload, and what a successful test does — and doesn't — prove.",
    category: "Delivery",
    keywords: ["delivery", "test-fire", "http", "webhook", "sftp", "ftps", "smtp", "erply", "directo", "oauth2"],
    readMin: 5,
    videoUrl: `${TOOL_VIDEO_BASE}/delivery.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/delivery-poster.jpg`,
  },
  {
    slug: "output-templates",
    title: "Output templates and formats",
    blurb: "Which output formats ProcuLink can actually send today, and what the templates page does (and doesn't do).",
    category: "Delivery",
    keywords: ["templates", "output format", "csv", "xml", "cxml", "ubl", "x12", "json", "peppol", "edifact", "scriban"],
    readMin: 4,
  },
  {
    slug: "cxml-setup",
    title: "Setting up cXML delivery",
    blurb: "Parse inbound cXML 1.2 orders and deliver cXML output, with a walkthrough of the From / To / Sender credential fields and the write-only shared secret.",
    category: "Delivery",
    keywords: ["cxml", "coupa", "ariba", "OrderRequest", "network id", "shared secret", "punchout", "supplier network", "credential domain", "sap"],
    readMin: 4,
    videoUrl: `${TOOL_VIDEO_BASE}/cxml-setup.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/cxml-setup-poster.jpg`,
  },
  {
    slug: "oauth2-delivery-setup",
    title: "OAuth2 client-credentials for HTTP delivery",
    blurb: "Fill in the OAuth2 fetch-token fields (tokenUrl, clientId, clientSecret, scope, grantType, authStyle, requestStyle, tokenPath) so ProcuLink mints a fresh access token before each HTTP delivery.",
    category: "Delivery",
    keywords: ["oauth2", "client credentials", "access token", "token endpoint", "http delivery", "bearer", "authStyle", "tokenPath", "webhook auth"],
    readMin: 4,
    videoUrl: `${TOOL_VIDEO_BASE}/oauth2-delivery-setup.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/oauth2-delivery-setup-poster.jpg`,
  },
  {
    slug: "sftp-ftps-delivery-keys",
    title: "SFTP and FTPS delivery keys and credentials",
    blurb: "Password vs private-key auth for SFTP/FTPS delivery, converting PuTTY .ppk keys to OpenSSH, directory auto-create behaviour, the FTPS certificate toggle, and the leave-blank-to-keep secret rule.",
    category: "Delivery",
    keywords: ["sftp", "ftps", "private key", "openssh", "ppk", "puttygen", "certificate validation", "delivery credentials", "file delivery", "leave blank to keep"],
    readMin: 5,
    videoUrl: `${TOOL_VIDEO_BASE}/sftp-ftps-delivery-keys.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/sftp-ftps-delivery-keys-poster.jpg`,
  },
  {
    slug: "erp-erply-and-directo",
    title: "Erply and Directo ERP delivery adapters",
    blurb: "Configure the Erply (base URL + client code) and Directo (base URL + company + basic auth) delivery adapters, and understand they ship the generated order artifact into the ERP — validated by tests, not a live sandbox.",
    category: "Delivery",
    keywords: ["erply", "directo", "erp adapter", "delivery channel", "client code", "company database", "basic auth", "order artifact", "field mapping", "test-fire"],
    readMin: 5,
  },
  // ── Integrations ─────────────────────────────────────────────────────────
  {
    slug: "email-polling",
    title: "Email polling (IMAP) setup",
    blurb: "Receive POs as email attachments — available on any paid plan.",
    category: "Integrations",
    keywords: ["imap", "email", "mailbox", "attachments", "polling", "app password", "growth"],
    readMin: 5,
  },
  {
    slug: "api-and-integrations",
    title: "API keys, inbound API, webhooks, and connectors",
    blurb: "Create plk_ API keys, push orders in over REST, and get signed webhooks out when orders are created, delivered, or fail.",
    category: "Integrations",
    keywords: ["api key", "plk_", "webhook", "hmac", "signature", "ingress", "zapier", "make", "idempotency", "rest"],
    readMin: 7,
    videoUrl: `${TOOL_VIDEO_BASE}/settings-integrations.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/settings-integrations-poster.jpg`,
  },
  {
    slug: "api-order-schema-reference",
    title: "Inbound order API — schema reference",
    blurb: "The endpoint, X-ProcuLink-Key header, JSON order body, success response, and Zapier/Make wiring for pushing structured purchase orders into ProcuLink.",
    category: "Integrations",
    keywords: ["inbound order api", "ingress endpoint", "X-ProcuLink-Key", "api key", "json order body", "zapier", "make webhooks", "idempotency key", "push order", "workspace slug"],
    readMin: 4,
    videoUrl: `${TOOL_VIDEO_BASE}/api-order-schema-reference.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/api-order-schema-reference-poster.jpg`,
  },
  {
    slug: "sftp-polling-setup",
    title: "Polling an SFTP folder for order files",
    blurb: "Set up ProcuLink to pull purchase-order files from an SFTP server on a schedule, and learn what fails silently when the path is wrong.",
    category: "Integrations",
    keywords: ["sftp", "polling", "pull", "order files", "host", "port 22", "private key", "password", "folder path", "schedule"],
    readMin: 3,
    videoUrl: `${TOOL_VIDEO_BASE}/sftp-polling-setup.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/sftp-polling-setup-poster.jpg`,
  },
  {
    slug: "s3-polling-setup",
    title: "Polling an S3 or R2 bucket for order files",
    blurb: "Set up ProcuLink to pull purchase-order files from an S3-compatible bucket on a schedule, with a minimal read-only IAM policy.",
    category: "Integrations",
    keywords: ["s3", "r2", "cloudflare", "bucket", "prefix", "region", "iam policy", "s3:ListBucket", "s3:GetObject", "access key", "polling"],
    readMin: 3,
  },
  {
    slug: "imap-provider-setup",
    title: "Polling an existing mailbox with IMAP",
    blurb: "Connect ProcuLink to a mailbox you already own so it imports order attachments, with per-provider host/port settings and app-password guidance.",
    category: "Integrations",
    keywords: ["imap", "email intake", "mailbox", "gmail", "office 365", "outlook", "proton bridge", "app password", "port 993", "tls"],
    readMin: 3,
  },
  {
    slug: "x12-850",
    title: "ANSI X12 850 purchase orders",
    blurb: "What an X12 850 purchase order is, its ISA/GS/ST envelope and key segments, and how ProcuLink parses inbound and emits outbound X12 850.",
    category: "Integrations",
    keywords: ["X12 850", "ANSI X12", "EDI", "purchase order", "ISA GS ST envelope", "BEG segment", "PO1 segment", "North American EDI", "004010", "005010"],
    readMin: 4,
  },
  {
    slug: "edifact-orders",
    title: "EDIFACT ORDERS purchase orders",
    blurb: "How ProcuLink reads inbound UN/EDIFACT ORDERS (D96A/D01B) messages, its envelope segments, and which related messages are not yet available.",
    category: "Integrations",
    keywords: ["EDIFACT", "ORDERS", "UN/EDIFACT", "D96A", "D01B", "UNB UNH BGM LIN", "purchase order", "EDI", "INVOIC coming soon", "DESADV coming soon"],
    readMin: 4,
  },
  {
    slug: "sap-idoc-orders05",
    title: "SAP IDoc ORDERS05 purchase orders",
    blurb: "What a SAP IDoc ORDERS05 is, its control record and E1EDK01/E1EDP01 segments, and how ProcuLink parses it inbound as XML.",
    category: "Integrations",
    keywords: ["SAP IDoc", "ORDERS05", "EDI_DC40", "E1EDK01", "E1EDP01", "purchase order", "SAP export", "XML", "inbound only", "mid-market SAP"],
    readMin: 4,
  },
  {
    slug: "ubl-and-peppol",
    title: "UBL and Peppol BIS Order",
    blurb: "Parse UBL 2.1 Order documents inbound and emit UBL / Peppol BIS Order 3 output for European e-procurement and Peppol networks.",
    category: "Integrations",
    keywords: ["UBL", "Peppol", "BIS Order 3", "OASIS", "e-procurement", "Order-2 namespace", "UBL invoice", "XML order", "Access Point"],
    readMin: 3,
  },
  // ── AI ───────────────────────────────────────────────────────────────────
  {
    slug: "ai-suggestions",
    title: "How AI mapping suggestions work",
    blurb: "When OpenAI runs, what confidence means, how catalog grounding works, and what the monthly AI budget does.",
    category: "AI",
    keywords: ["ai", "openai", "confidence", "suggestions", "provenance", "catalog grounding", "token budget", "no-egress", "cap"],
    readMin: 5,
  },
  // ── Billing ──────────────────────────────────────────────────────────────
  {
    slug: "billing-faq",
    title: "Billing and plans FAQ",
    blurb: "Pilot, Growth, Operations, Integration, Distributor, Enterprise — what's included and what happens at quota.",
    category: "Billing",
    keywords: ["billing", "plans", "quota", "overage", "soft cap", "429", "pilot", "upgrade", "read-only", "distributor", "cancel"],
    readMin: 4,
  },
  // ── Troubleshooting ──────────────────────────────────────────────────────
  {
    slug: "troubleshooting",
    title: "Troubleshooting common parse errors",
    blurb: "Date format mismatches, missing columns, encoding issues — what to fix.",
    category: "Troubleshooting",
    keywords: ["parse error", "encoding", "bom", "date format", "missing columns", "scanned pdf", "comma decimal", "idoc"],
    readMin: 3,
  },
  {
    slug: "exceptions-and-stuck-orders",
    title: "Working the exceptions queue",
    blurb: "What lands in Exceptions, what Resolve and Ignore really do, and how to requeue a failed delivery.",
    category: "Troubleshooting",
    keywords: ["exceptions", "stuck", "dead-letter", "requeue", "ignore", "resolve", "worker", "health", "delivery failed"],
    readMin: 5,
    videoUrl: `${TOOL_VIDEO_BASE}/exceptions.mp4`,
    videoPosterUrl: `${TOOL_VIDEO_BASE}/exceptions-poster.jpg`,
  },
];

/** Icon keys are rendered by `<HelpIcon name=… />` — one cohesive line-icon set. */
export type HelpIconName =
  | "upload"
  | "connections"
  | "map"
  | "deliver"
  | "ai"
  | "billing"
  | "integrations"
  | "wrench";

/**
 * Per-category visual identity. Colours are pulled straight from the locked
 * Bridge Layer token set (`color` = solid accent, `soft` = tinted surface) so
 * the Help center never invents a palette of its own.
 */
export const CATEGORY_META: Record<
  HelpCategory,
  { color: string; soft: string; icon: HelpIconName }
> = {
  // Text colors are the DEEP member of each hue family so the 12px semibold
  // eyebrow text passes WCAG AA (4.5:1) on its pastel `soft` background — the
  // bright/mid variants (#28C55E, #2E8E3A, #C97A14, #C53A3A) measured 1.9–3.9:1
  // there (Lighthouse color-contrast). Fills/illustrations keep the brand mids.
  "Getting started": { color: "#1E6D29", soft: "#DCFCE7", icon: "upload" },
  Connections:       { color: "#0F4FA8", soft: "#E3EDFB", icon: "connections" },
  Mapping:           { color: "#7A4D0B", soft: "#FAEFD6", icon: "map" },
  Delivery:          { color: "#1E6D29", soft: "#E2F1E2", icon: "deliver" },
  Integrations:      { color: "#56627A", soft: "#EFF2F7", icon: "integrations" },
  AI:                { color: "#6F4FCE", soft: "#EEE7FB", icon: "ai" },
  Billing:           { color: "#0F4FA8", soft: "#E3EDFB", icon: "billing" },
  Troubleshooting:   { color: "#9E2B2B", soft: "#FBE3E3", icon: "wrench" },
};

/** Category render order for filter chips — mirrors the learning path. */
export const CATEGORY_ORDER: HelpCategory[] = [
  "Getting started",
  "Connections",
  "Mapping",
  "Delivery",
  "Integrations",
  "AI",
  "Billing",
  "Troubleshooting",
];

/**
 * Curated "popular" slugs — shown on the /help index and as the slideover's
 * no-guide fallback. May list slugs the content pass hasn't written yet;
 * `resolveArticles` silently skips those, so nothing dead ever renders.
 */
export const POPULAR_ARTICLE_SLUGS: string[] = [
  "first-upload",
  "connections",
  "delivery-setup",
  "output-mapping-editor",
  "billing-faq",
];

export function getArticleBySlug(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
}

/**
 * Resolve a list of article slugs against the registry, silently skipping any
 * slug without a published article. This is the forward-compatibility seam:
 * section guides and curated lists may reference articles before the content
 * pass ships them — a missing slug renders nothing rather than a dead link.
 */
export function resolveArticles(
  slugs: string[] | undefined,
  max = 3,
): HelpArticle[] {
  if (!slugs || slugs.length === 0) return [];
  return slugs
    .map(getArticleBySlug)
    .filter((a): a is HelpArticle => a !== undefined)
    .slice(0, max);
}

/**
 * Previous / next article in reading order, used by the article footer's
 * "Keep reading" pager. Does not wrap around — ends are `undefined`.
 */
export function getAdjacentArticles(slug: string): {
  prev?: HelpArticle;
  next?: HelpArticle;
} {
  const i = HELP_ARTICLES.findIndex((a) => a.slug === slug);
  if (i === -1) return {};
  return {
    prev: i > 0 ? HELP_ARTICLES[i - 1] : undefined,
    next: i < HELP_ARTICLES.length - 1 ? HELP_ARTICLES[i + 1] : undefined,
  };
}
