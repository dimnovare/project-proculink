/**
 * Guide registry — the single source of truth for the step-by-step setup guides.
 *
 * A GUIDE is not a help article. An article explains a surface ("what the IMAP
 * fields mean"); a guide walks one task end to end, in numbered steps, with
 * screenshots and a failure branch per step. Articles stay the reference layer;
 * guides are the "do this now" layer and link down into them.
 *
 * Two audiences share one framework:
 *   - `client` guides render in the public help center under /help/guides/*.
 *   - `admin`  guides render ONLY behind the admin allowlist under /admin/guides/*
 *     (see src/lib/admin-guard.ts — the route refuses to render for anyone else).
 *
 * `status: "planned"` entries exist so the index can show the full taxonomy
 * honestly. A planned guide renders as a non-link row — never a dead link — and
 * offers its `related` reference articles instead, which do exist today.
 */

export type GuideAudience = "client" | "admin";

/** Index taxonomy. Order here is the order sections render on /help/guides. */
export type GuideSection =
  | "Get started"
  | "Receive orders"
  | "Suppliers & catalogs"
  | "Review & mapping"
  | "Deliver"
  | "Admin";

export const GUIDE_SECTIONS: GuideSection[] = [
  "Get started",
  "Receive orders",
  "Suppliers & catalogs",
  "Review & mapping",
  "Deliver",
  "Admin",
];

/** One-line section descriptions for the index. Plain procurement copy. */
export const SECTION_BLURB: Record<GuideSection, string> = {
  "Get started": "Set up the workspace and get one order through end to end.",
  "Receive orders": "Every way an order can reach ProcuLink, set up step by step.",
  "Suppliers & catalogs": "Add a supplier, load their item codes, keep them current.",
  "Review & mapping": "Fix what parsing could not decide, and teach it for next time.",
  Deliver: "Get the finished order into the supplier's system.",
  Admin: "Internal runbooks. Visible only to ProcuLink admins.",
};

export interface Guide {
  /** URL slug — last path segment. Unique across both audiences. */
  slug: string;
  /** Full route. Client guides live under /help/guides, admin under /admin/guides. */
  href: string;
  title: string;
  blurb: string;
  section: GuideSection;
  audience: GuideAudience;
  /** "live" = the route exists and is written. "planned" = index-only, no link. */
  status: "live" | "planned";
  /** Estimated minutes end to end. Set only on live guides. */
  minutes?: number;
  /**
   * Help-article slugs this guide is the procedure for. Live guides link down
   * to them for reference detail; planned guides offer them as the interim
   * answer so the index never shows a dead end.
   */
  related?: string[];
}

export const GUIDES: Guide[] = [
  // ── Get started ──────────────────────────────────────────────────────────
  {
    slug: "set-up-your-workspace",
    href: "/help/guides/set-up-your-workspace",
    title: "Set up your workspace and invite your team",
    blurb: "Name the workspace, choose its direction, and give colleagues access.",
    section: "Get started",
    audience: "client",
    status: "planned",
    related: ["inbound-mode", "billing-faq"],
  },
  {
    slug: "first-order-end-to-end",
    href: "/help/guides/first-order-end-to-end",
    title: "Take your first order from upload to delivered",
    blurb: "Upload a real purchase order, review it, and send it to the supplier.",
    section: "Get started",
    audience: "client",
    status: "live",
    minutes: 20,
    related: ["order-intake-options", "inbox-basics", "dashboard-and-statuses"],
  },

  // ── Receive orders ───────────────────────────────────────────────────────
  {
    slug: "upload-orders-manually",
    href: "/help/guides/upload-orders-manually",
    title: "Upload order files by hand",
    blurb: "Drop one or more files on the upload screen — the channel that needs no set-up.",
    section: "Receive orders",
    audience: "client",
    status: "live",
    minutes: 8,
    related: ["order-intake-options", "csv-xlsx-field-guide", "troubleshooting"],
  },
  {
    slug: "receive-orders-by-email",
    href: "/help/guides/receive-orders-by-email",
    title: "Receive orders by email",
    blurb:
      "Use the address ProcuLink gives your workspace, add a forwarding rule, or read a mailbox you already own over IMAP.",
    section: "Receive orders",
    audience: "client",
    status: "live",
    minutes: 12,
    related: ["order-intake-options", "imap-provider-setup"],
  },
  {
    slug: "poll-a-mailbox-over-imap",
    href: "/help/guides/poll-a-mailbox-over-imap",
    title: "Poll a mailbox you already own over IMAP",
    blurb: "Per-provider hosts, app passwords, and the folder to read — set up once and checked every five minutes.",
    section: "Receive orders",
    audience: "client",
    status: "live",
    minutes: 15,
    related: ["imap-provider-setup", "order-intake-options", "troubleshooting"],
  },
  {
    slug: "receive-orders-over-api",
    href: "/help/guides/receive-orders-over-api",
    title: "Push orders in over the API",
    blurb: "Create an API key and post order files or structured orders from an ERP or automation tool.",
    section: "Receive orders",
    audience: "client",
    status: "live",
    minutes: 15,
    related: ["api-and-integrations", "api-order-schema-reference", "troubleshooting"],
  },
  {
    slug: "receive-orders-by-sftp",
    href: "/help/guides/receive-orders-by-sftp",
    title: "Pull order files from an SFTP folder",
    blurb: "Point ProcuLink at a folder another system exports to, and let it collect new files.",
    section: "Receive orders",
    audience: "client",
    status: "live",
    minutes: 12,
    related: ["sftp-polling-setup", "order-intake-options", "troubleshooting"],
  },
  {
    slug: "receive-orders-from-s3",
    href: "/help/guides/receive-orders-from-s3",
    title: "Pull order files from S3 or Cloudflare R2",
    blurb: "Watch a bucket prefix for new order objects, with a read-only key.",
    section: "Receive orders",
    audience: "client",
    status: "live",
    minutes: 12,
    related: ["s3-polling-setup", "order-intake-options", "troubleshooting"],
  },

  // ── Suppliers & catalogs ─────────────────────────────────────────────────
  {
    slug: "add-a-supplier",
    href: "/help/guides/add-a-supplier",
    title: "Add a supplier and fill in their identifiers",
    blurb:
      "Create the supplier record, then add the VAT number, registry code, GLN, and domain that let ProcuLink recognise their documents.",
    section: "Suppliers & catalogs",
    audience: "client",
    status: "live",
    minutes: 10,
    related: ["managing-suppliers", "item-codes", "inbound-mode"],
  },
  {
    slug: "import-a-supplier-catalog",
    href: "/help/guides/import-a-supplier-catalog",
    title: "Import a supplier catalog from a file",
    blurb: "Load the supplier's item codes from a CSV or XLSX so suggestions are grounded in real codes.",
    section: "Suppliers & catalogs",
    audience: "client",
    status: "live",
    minutes: 12,
    related: ["catalog-csv-field-guide", "item-codes", "managing-suppliers"],
  },
  {
    slug: "keep-a-catalog-in-sync",
    href: "/help/guides/keep-a-catalog-in-sync",
    title: "Keep a catalog in sync automatically",
    blurb: "Point ProcuLink at the supplier's own feed, test the fetch, then let it re-import on a schedule.",
    section: "Suppliers & catalogs",
    audience: "client",
    status: "live",
    minutes: 25,
    related: ["catalog-csv-field-guide", "managing-suppliers", "billing-faq"],
  },

  // ── Review & mapping ─────────────────────────────────────────────────────
  {
    slug: "review-an-order",
    href: "/help/guides/review-an-order",
    title: "Review an order and send it",
    blurb:
      "Work the issue list, assign a supplier when the document did not name one, and send — or find out honestly why you cannot yet.",
    section: "Review & mapping",
    audience: "client",
    status: "live",
    minutes: 15,
    related: ["inbox-basics", "dashboard-and-statuses", "exceptions-and-stuck-orders"],
  },
  {
    slug: "resolve-item-codes",
    href: "/help/guides/resolve-item-codes",
    title: "Resolve item codes in review",
    blurb: "Match a buyer code to the supplier's own code once, and have it remembered.",
    section: "Review & mapping",
    audience: "client",
    status: "live",
    minutes: 12,
    related: ["item-codes", "ai-suggestions", "catalog-csv-field-guide"],
  },
  {
    slug: "map-supplier-po-fields",
    href: "/help/guides/map-supplier-po-fields",
    title: "Map a supplier's purchase-order fields",
    blurb: "Tell ProcuLink which field means what in the document you send out, and preview the result.",
    section: "Review & mapping",
    audience: "client",
    status: "live",
    minutes: 18,
    related: ["mapping-basics", "output-mapping-editor", "validation-rules"],
  },

  // ── Deliver ──────────────────────────────────────────────────────────────
  {
    slug: "set-up-supplier-delivery",
    href: "/help/guides/set-up-supplier-delivery",
    title: "Set up delivery to a supplier and test-fire it",
    blurb:
      "Pick the channel the supplier actually uses — HTTP, cXML, SFTP/FTPS, email, or an ERP adapter — then prove it before the first real order.",
    section: "Deliver",
    audience: "client",
    status: "live",
    minutes: 25,
    related: ["delivery-setup", "cxml-setup", "oauth2-delivery-setup", "sftp-ftps-delivery-keys"],
  },

  // ── Admin (allowlist only) ───────────────────────────────────────────────
  {
    slug: "onboard-a-new-client",
    href: "/admin/guides/onboard-a-new-client",
    title: "Onboard a new client end-to-end",
    blurb:
      "Create the workspace, clear the plan gates that actually bite, load the first catalog, and walk one real order through.",
    section: "Admin",
    audience: "admin",
    status: "live",
    minutes: 45,
  },
  {
    slug: "unfreeze-a-pilot-workspace",
    href: "/admin/guides/unfreeze-a-pilot-workspace",
    title: "Unfreeze a read-only Pilot workspace",
    blurb: "The account-status call, what it refuses, and when to extend the trial instead.",
    section: "Admin",
    audience: "admin",
    status: "planned",
  },
];

export function getGuideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug);
}

/**
 * Resolve a pathname to a guide. Used by the MDX wrapper to pick guide chrome
 * over article chrome, so guides stay plain `.mdx` files with no boilerplate.
 * Tolerates a trailing slash and an empty/undefined pathname.
 */
export function getGuideByPath(pathname: string | null | undefined): Guide | undefined {
  if (!pathname) return undefined;
  const clean = pathname.replace(/\/+$/, "") || "/";
  return GUIDES.find((g) => g.href === clean);
}

/** Guides in one section, live first, in registry order within each group. */
export function guidesInSection(section: GuideSection): Guide[] {
  const inSection = GUIDES.filter((g) => g.section === section);
  return [
    ...inSection.filter((g) => g.status === "live"),
    ...inSection.filter((g) => g.status !== "live"),
  ];
}

/** Public guides only — what the marketing help center and the sitemap may list. */
export function publicGuides(): Guide[] {
  return GUIDES.filter((g) => g.audience === "client");
}
