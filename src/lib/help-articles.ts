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
    slug: "mapping-basics",
    title: "PO field mapping basics",
    blurb: "Map your CSV columns to the canonical purchase-order fields ProcuLink expects.",
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
    slug: "output-mapping-editor",
    title: "Editing the output your supplier receives",
    blurb: "Per-order output overrides: pick sources, chain manipulators, write Scriban expressions or a whole-document template, and preview live.",
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
    blurb: "What lands in Exceptions, what Resolve and Ignore really do, and how to requeue a dead-lettered delivery.",
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
  "Getting started": { color: "#28C55E", soft: "#DCFCE7", icon: "upload" },
  Connections:       { color: "#1E66C9", soft: "#E3EDFB", icon: "connections" },
  Mapping:           { color: "#C97A14", soft: "#FAEFD6", icon: "map" },
  Delivery:          { color: "#2E8E3A", soft: "#E2F1E2", icon: "deliver" },
  Integrations:      { color: "#56627A", soft: "#EFF2F7", icon: "integrations" },
  AI:                { color: "#6F4FCE", soft: "#EEE7FB", icon: "ai" },
  Billing:           { color: "#0F4FA8", soft: "#E3EDFB", icon: "billing" },
  Troubleshooting:   { color: "#C53A3A", soft: "#FBE3E3", icon: "wrench" },
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
