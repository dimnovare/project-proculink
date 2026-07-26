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
    title: "Set up your workspace and first supplier",
    blurb: "Name the workspace, add one supplier, and decide how orders will arrive.",
    section: "Get started",
    audience: "client",
    status: "planned",
    related: ["first-upload", "managing-suppliers"],
  },
  {
    slug: "first-order-end-to-end",
    href: "/help/guides/first-order-end-to-end",
    title: "Take your first order from upload to delivered",
    blurb: "Upload a real purchase order, review it, and send it to the supplier.",
    section: "Get started",
    audience: "client",
    status: "planned",
    related: ["first-upload", "inbox-basics", "dashboard-and-statuses"],
  },

  // ── Receive orders ───────────────────────────────────────────────────────
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
    related: ["order-intake-options", "imap-provider-setup", "email-polling"],
  },
  {
    slug: "receive-orders-over-api",
    href: "/help/guides/receive-orders-over-api",
    title: "Push orders in over the API",
    blurb: "Create an API key and post structured orders from an ERP or automation tool.",
    section: "Receive orders",
    audience: "client",
    status: "planned",
    related: ["api-and-integrations", "api-order-schema-reference"],
  },
  {
    slug: "receive-orders-from-a-folder",
    href: "/help/guides/receive-orders-from-a-folder",
    title: "Pull order files from SFTP or S3",
    blurb: "Point ProcuLink at a folder another system exports to, on a schedule.",
    section: "Receive orders",
    audience: "client",
    status: "planned",
    related: ["sftp-polling-setup", "s3-polling-setup"],
  },

  // ── Suppliers & catalogs ─────────────────────────────────────────────────
  {
    slug: "add-a-supplier-and-catalog",
    href: "/help/guides/add-a-supplier-and-catalog",
    title: "Add a supplier and import their catalog",
    blurb: "Create the supplier record and load their item codes from a file.",
    section: "Suppliers & catalogs",
    audience: "client",
    status: "planned",
    related: ["managing-suppliers", "catalog-csv-field-guide", "item-codes"],
  },
  {
    slug: "keep-a-catalog-in-sync",
    href: "/help/guides/keep-a-catalog-in-sync",
    title: "Keep a catalog in sync on a schedule",
    blurb: "Set up a scheduled pull so item codes and prices stay current.",
    section: "Suppliers & catalogs",
    audience: "client",
    status: "planned",
    related: ["managing-suppliers", "catalog-csv-field-guide"],
  },

  // ── Review & mapping ─────────────────────────────────────────────────────
  {
    slug: "resolve-item-codes",
    href: "/help/guides/resolve-item-codes",
    title: "Resolve item codes in review",
    blurb: "Match a buyer code to the supplier's own code once, and have it remembered.",
    section: "Review & mapping",
    audience: "client",
    status: "planned",
    related: ["item-codes", "ai-suggestions"],
  },
  {
    slug: "map-supplier-po-fields",
    href: "/help/guides/map-supplier-po-fields",
    title: "Map a supplier's purchase-order fields",
    blurb: "Tell ProcuLink which column means what, and preview the result.",
    section: "Review & mapping",
    audience: "client",
    status: "planned",
    related: ["mapping-basics", "output-mapping-editor", "validation-rules"],
  },

  // ── Deliver ──────────────────────────────────────────────────────────────
  {
    slug: "set-up-http-delivery",
    href: "/help/guides/set-up-http-delivery",
    title: "Set up HTTP delivery and test-fire it",
    blurb: "Configure the endpoint, authenticate, and prove it accepts a real order.",
    section: "Deliver",
    audience: "client",
    status: "planned",
    related: ["delivery-setup", "oauth2-delivery-setup"],
  },
  {
    slug: "set-up-file-delivery",
    href: "/help/guides/set-up-file-delivery",
    title: "Set up SFTP, FTPS, or email delivery",
    blurb: "Deliver the finished order as a file or an attachment.",
    section: "Deliver",
    audience: "client",
    status: "planned",
    related: ["delivery-setup", "sftp-ftps-delivery-keys", "output-templates"],
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
