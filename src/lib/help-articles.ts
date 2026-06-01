export type HelpCategory =
  | "Getting started"
  | "Mapping"
  | "Delivery"
  | "AI"
  | "Billing"
  | "Email"
  | "Troubleshooting";

export interface HelpArticle {
  slug: string;
  title: string;
  blurb: string;
  category: HelpCategory;
}

export const HELP_ARTICLES: HelpArticle[] = [
  { slug: "order-intake-options", title: "Ways to send orders to ProcuLink", blurb: "Manual upload, email, API, SFTP, and storage-folder options for getting POs into ProcuLink.", category: "Getting started" },
  { slug: "first-upload",     title: "Your first purchase order upload",   blurb: "Walk through uploading a purchase order file and getting it parsed.",   category: "Getting started" },
  { slug: "mapping-basics",   title: "PO field mapping basics",            blurb: "Map your CSV columns to the canonical purchase-order fields ProcuLink expects.", category: "Mapping" },
  { slug: "delivery-config",  title: "Configuring supplier delivery",      blurb: "Set up HTTP webhook delivery with credentials and test-fire.",         category: "Delivery" },
  { slug: "ai-suggestions",   title: "How AI mapping suggestions work",    blurb: "When OpenAI runs, what confidence means, and how to confirm or clear suggestions.", category: "AI" },
  { slug: "billing-faq",      title: "Billing and plans FAQ",              blurb: "Pilot, Growth, Operations, Integration, Enterprise — what's included and what happens at quota.", category: "Billing" },
  { slug: "email-polling",    title: "Email polling (IMAP) setup",         blurb: "Receive POs as email attachments — only on Integration and above.",   category: "Email" },
  { slug: "troubleshooting",  title: "Troubleshooting common parse errors",blurb: "Date format mismatches, missing columns, encoding issues — what to fix.", category: "Troubleshooting" },
];

/** Icon keys are rendered by `<HelpIcon name=… />` — one cohesive line-icon set. */
export type HelpIconName = "upload" | "map" | "deliver" | "ai" | "billing" | "email" | "wrench";

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
  Mapping:           { color: "#C97A14", soft: "#FAEFD6", icon: "map" },
  Delivery:          { color: "#2E8E3A", soft: "#E2F1E2", icon: "deliver" },
  AI:                { color: "#6F4FCE", soft: "#EEE7FB", icon: "ai" },
  Billing:           { color: "#0F4FA8", soft: "#DCFCE7", icon: "billing" },
  Email:             { color: "#56627A", soft: "#EFF2F7", icon: "email" },
  Troubleshooting:   { color: "#C53A3A", soft: "#FBE3E3", icon: "wrench" },
};

/** Category render order for filter chips — Getting started first. */
export const CATEGORY_ORDER: HelpCategory[] = [
  "Getting started",
  "Mapping",
  "Delivery",
  "AI",
  "Billing",
  "Email",
  "Troubleshooting",
];

export function getArticleBySlug(slug: string): HelpArticle | undefined {
  return HELP_ARTICLES.find((a) => a.slug === slug);
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
