export type HelpCategory =
  | "Getting started"
  | "Documents"
  | "Flows"
  | "Sending in"
  | "Outputs and destinations"
  | "Lookups"
  | "Account"
  | "API";

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

/**
 * Registry array order = reading order (drives the prev/next article pager), so
 * it follows CATEGORY_ORDER. Every entry has a stub-or-written `page.mdx` under
 * src/app/(marketing)/help/<slug>/ — src/lib/help-articles.test.ts pins that in
 * both directions.
 */
export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: "how-proculink-works",
    title: "How ProcuLink works",
    blurb: "What happens to a document from the moment it arrives to the moment it is sent on.",
    category: "Getting started",
    keywords: ["overview", "introduction", "flows", "documents", "senders", "outputs", "destinations"],
    readMin: 3,
  },
  {
    slug: "ai-in-proculink",
    title: "How ProcuLink uses AI",
    blurb: "Where AI reads your documents and suggests values, and how you stay in control of what is sent.",
    category: "Getting started",
    keywords: ["ai", "confidence", "suggestions", "privacy", "accept", "reject"],
    readMin: 4,
  },
  {
    slug: "documents-and-statuses",
    title: "Documents and their statuses",
    blurb: "What each status on a document means, and what you can do from it.",
    category: "Documents",
    keywords: ["status", "documents", "reading", "needs review", "sent", "failed", "held"],
    readMin: 4,
  },
  {
    slug: "what-we-read",
    title: "Files we read",
    blurb: "The kinds of files ProcuLink reads, and what to expect from each.",
    category: "Documents",
    keywords: ["files", "formats", "pdf", "csv", "excel", "xlsx", "scan", "photo", "input"],
    readMin: 4,
  },
  {
    slug: "checks",
    title: "Checks",
    blurb: "The checks that run on every document, what they flag, and which ones hold a send.",
    category: "Documents",
    keywords: ["checks", "validation", "duplicate", "missing value", "hold"],
    readMin: 3,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    blurb: "What to do when a document cannot be read, a send fails, or a result looks wrong.",
    category: "Documents",
    keywords: ["troubleshooting", "error", "failed", "cannot read", "encoding", "retry"],
    readMin: 4,
  },
  {
    slug: "flows",
    title: "Flows: fields, automation and versions",
    blurb: "How a flow holds the fields to read, the output and the destination, and how to change it safely.",
    category: "Flows",
    keywords: ["flow", "fields", "automation", "versions", "publish", "restore", "advanced"],
    readMin: 5,
  },
  {
    slug: "senders",
    title: "Senders and what we learn from them",
    blurb: "How ProcuLink remembers where a sender puts each value, so the next document needs less checking.",
    category: "Flows",
    keywords: ["sender", "teach", "learn", "layout", "template"],
    readMin: 3,
  },
  {
    slug: "intake-channels",
    title: "Ways to send documents in",
    blurb: "Every way a document can reach a flow: upload, email, mailbox, SFTP, FTP, S3 and API.",
    category: "Sending in",
    keywords: ["intake", "upload", "email", "imap", "mailbox", "sftp", "ftp", "s3", "api", "inbound"],
    readMin: 4,
  },
  {
    slug: "outputs",
    title: "Output formats",
    blurb: "The formats a flow can produce, and how each field gets its value.",
    category: "Outputs and destinations",
    keywords: ["output", "csv", "json", "xml", "excel", "xlsx", "pdf", "text", "fixed-width", "format"],
    readMin: 5,
  },
  {
    slug: "destinations",
    title: "Destinations",
    blurb: "Where a flow sends its output: email, a web address, an SFTP or FTPS server, or a download.",
    category: "Outputs and destinations",
    keywords: ["destination", "email", "webhook", "http", "sftp", "ftps", "download", "delivery"],
    readMin: 4,
  },
  {
    slug: "destination-sign-in",
    title: "Destination sign-in, keys and signing",
    blurb: "How to give a destination the login, key or token it asks for.",
    category: "Outputs and destinations",
    keywords: ["sign in", "credentials", "oauth2", "token", "ssh key", "private key", "signing", "secret", "ppk"],
    readMin: 4,
  },
  {
    slug: "lookups",
    title: "Lookups",
    blurb: "How a lookup list turns one value into another, such as your item code into a supplier's.",
    category: "Lookups",
    keywords: ["lookup", "csv", "match", "item code", "translate", "list", "suggestions"],
    readMin: 4,
  },
  {
    slug: "activity-and-notifications",
    title: "Activity and notifications",
    blurb: "Where to see what happened to each document, and how ProcuLink tells you when something needs you.",
    category: "Account",
    keywords: ["activity", "audit", "history", "notifications", "alerts", "email"],
    readMin: 3,
  },
  {
    slug: "workspace-and-team",
    title: "Workspace, team and API keys",
    blurb: "Name your workspace, see who has access and what each role can do, and create the keys that let other systems use ProcuLink.",
    category: "Account",
    keywords: ["workspace", "team", "members", "roles", "administrator", "api key", "settings"],
    readMin: 3,
  },
  {
    slug: "billing-faq",
    title: "Plans and billing",
    blurb: "What each plan includes, what counts as a document, and what happens at the limit.",
    category: "Account",
    keywords: ["billing", "plans", "trial", "documents", "overage", "upgrade", "cancel", "invoice"],
    readMin: 4,
  },
  {
    slug: "old-orders",
    title: "Old orders",
    blurb: "Where your earlier purchase orders went, and how to read and export them.",
    category: "Account",
    keywords: ["orders", "old orders", "legacy", "archive", "export", "purchase orders"],
    readMin: 2,
  },
  {
    slug: "api-reference",
    title: "API reference: files, results and webhooks",
    blurb: "Send a file to a flow over the API, fetch the result, and receive webhooks when a document changes.",
    category: "API",
    keywords: ["api", "reference", "webhook", "signature", "hmac", "idempotency", "x-proculink-key", "rest", "events"],
    readMin: 6,
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
 * the Help center never invents a palette of its own. Text colours are the DEEP
 * member of each hue family so the 12px semibold eyebrow passes WCAG AA (4.5:1)
 * on its pastel `soft` background.
 */
export const CATEGORY_META: Record<
  HelpCategory,
  { color: string; soft: string; icon: HelpIconName }
> = {
  "Getting started":          { color: "#1E6D29", soft: "#DCFCE7", icon: "upload" },
  Documents:                  { color: "#7A4D0B", soft: "#FAEFD6", icon: "wrench" },
  Flows:                      { color: "#0F4FA8", soft: "#E3EDFB", icon: "connections" },
  "Sending in":               { color: "#56627A", soft: "#EFF2F7", icon: "integrations" },
  "Outputs and destinations": { color: "#1E6D29", soft: "#E2F1E2", icon: "deliver" },
  Lookups:                    { color: "#6F4FCE", soft: "#EEE7FB", icon: "map" },
  Account:                    { color: "#0F4FA8", soft: "#E3EDFB", icon: "billing" },
  API:                        { color: "#56627A", soft: "#EFF2F7", icon: "integrations" },
};

/** Category render order for filter chips — mirrors the learning path. */
export const CATEGORY_ORDER: HelpCategory[] = [
  "Getting started",
  "Documents",
  "Flows",
  "Sending in",
  "Outputs and destinations",
  "Lookups",
  "Account",
  "API",
];

/**
 * Curated "popular" slugs — shown on the /help index and as the slideover's
 * no-guide fallback. `resolveArticles` silently skips any slug without a
 * published article, so nothing dead ever renders.
 */
export const POPULAR_ARTICLE_SLUGS: string[] = [
  "how-proculink-works",
  "documents-and-statuses",
  "intake-channels",
  "outputs",
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
