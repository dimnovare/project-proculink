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
  | "Check and teach"
  | "Send documents in"
  | "Outputs and destinations"
  | "Lookups"
  | "Admin";

export const GUIDE_SECTIONS: GuideSection[] = [
  "Get started",
  "Check and teach",
  "Send documents in",
  "Outputs and destinations",
  "Lookups",
  "Admin",
];

/** One-line section descriptions for the index. Plain copy. */
export const SECTION_BLURB: Record<GuideSection, string> = {
  "Get started": "Set up a flow and take your first document through it.",
  "Check and teach": "Review what we read, teach a value, and publish changes to a flow.",
  "Send documents in": "Every way a document can reach a flow, set up step by step.",
  "Outputs and destinations": "Build the output your system needs and send it on.",
  Lookups: "Translate values with a list you import.",
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
  {
    slug: "set-up-your-first-flow",
    href: "/help/guides/set-up-your-first-flow",
    title: "Set up your first flow",
    blurb: "Create a flow, add a document, check what we read, and choose where the output goes.",
    section: "Get started",
    audience: "client",
    status: "live",
    minutes: 15,
    related: ["how-proculink-works", "flows", "documents-and-statuses"],
  },
  {
    slug: "check-and-send-a-document",
    href: "/help/guides/check-and-send-a-document",
    title: "Check and send a document",
    blurb: "Compare what we read with the original, fix anything wrong, and send the document on.",
    section: "Check and teach",
    audience: "client",
    status: "live",
    minutes: 8,
    related: ["documents-and-statuses", "checks", "troubleshooting"],
  },
  {
    slug: "teach-a-value",
    href: "/help/guides/teach-a-value",
    title: "Teach a value by pointing at the page",
    blurb: "Point at a value on the page so we find it in the same place next time.",
    section: "Check and teach",
    audience: "client",
    status: "live",
    minutes: 6,
    related: ["senders", "flows"],
  },
  {
    slug: "publish-a-flow-version",
    href: "/help/guides/publish-a-flow-version",
    title: "Publish and restore flow versions",
    blurb: "Change a flow, publish the new version, and restore an earlier one if you need to.",
    section: "Check and teach",
    audience: "client",
    status: "live",
    minutes: 8,
    related: ["flows", "activity-and-notifications"],
  },
  {
    slug: "receive-documents-by-email",
    href: "/help/guides/receive-documents-by-email",
    title: "Receive documents by email",
    blurb: "Forward documents to the flow's own email address.",
    section: "Send documents in",
    audience: "client",
    status: "live",
    minutes: 6,
    related: ["intake-channels"],
  },
  {
    slug: "collect-from-a-mailbox",
    href: "/help/guides/collect-from-a-mailbox",
    title: "Collect documents from a mailbox",
    blurb: "Let ProcuLink collect documents from a mailbox you already use.",
    section: "Send documents in",
    audience: "client",
    status: "live",
    minutes: 12,
    related: ["intake-channels", "troubleshooting"],
  },
  {
    slug: "collect-from-a-server",
    href: "/help/guides/collect-from-a-server",
    title: "Collect documents from an SFTP or FTP server",
    blurb: "Let ProcuLink collect new files from an SFTP or FTP server.",
    section: "Send documents in",
    audience: "client",
    status: "live",
    minutes: 12,
    related: ["intake-channels", "troubleshooting"],
  },
  {
    slug: "collect-from-s3",
    href: "/help/guides/collect-from-s3",
    title: "Collect documents from an S3 bucket",
    blurb: "Let ProcuLink collect new files from an S3 bucket.",
    section: "Send documents in",
    audience: "client",
    status: "live",
    minutes: 12,
    related: ["intake-channels", "troubleshooting"],
  },
  {
    slug: "send-documents-by-api",
    href: "/help/guides/send-documents-by-api",
    title: "Send documents by API",
    blurb: "Post a file to a flow and fetch the result, or have it sent to you by webhook.",
    section: "Send documents in",
    audience: "client",
    status: "live",
    minutes: 12,
    related: ["api-reference", "intake-channels", "workspace-and-team"],
  },
  {
    slug: "build-an-output",
    href: "/help/guides/build-an-output",
    title: "Build an output",
    blurb: "Choose the fields and format your receiving system expects.",
    section: "Outputs and destinations",
    audience: "client",
    status: "live",
    minutes: 15,
    related: ["outputs", "flows", "lookups"],
  },
  {
    slug: "build-an-output-from-a-sample",
    href: "/help/guides/build-an-output-from-a-sample",
    title: "Build an output from a sample file",
    blurb: "Upload a sample of the file your system expects and we propose the output to match.",
    section: "Outputs and destinations",
    audience: "client",
    status: "live",
    minutes: 10,
    related: ["outputs", "ai-in-proculink"],
  },
  {
    slug: "build-an-output-from-documentation",
    href: "/help/guides/build-an-output-from-documentation",
    title: "Build an output from documentation",
    blurb: "Upload your receiving system's documentation and we propose the output for you to check.",
    section: "Outputs and destinations",
    audience: "client",
    status: "live",
    minutes: 10,
    related: ["outputs", "ai-in-proculink"],
  },
  {
    slug: "send-to-a-destination",
    href: "/help/guides/send-to-a-destination",
    title: "Send outputs to a destination",
    blurb: "Send a flow's output by email, to a web address, to an SFTP or FTPS server, or as a download.",
    section: "Outputs and destinations",
    audience: "client",
    status: "live",
    minutes: 15,
    related: ["destinations", "destination-sign-in", "troubleshooting"],
  },
  {
    slug: "import-a-lookup",
    href: "/help/guides/import-a-lookup",
    title: "Import a lookup from a CSV file",
    blurb: "Import a CSV file so a value on a document is replaced by the one your system uses.",
    section: "Lookups",
    audience: "client",
    status: "live",
    minutes: 10,
    related: ["lookups", "ai-in-proculink"],
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
    status: "live",
    minutes: 10,
  },
  {
    slug: "erase-order-data",
    href: "/admin/guides/erase-order-data",
    title: "Erase a customer's order data",
    blurb:
      "The two erasure calls that deliberately have no button — what they require, what they return, and why they cannot be undone.",
    section: "Admin",
    audience: "admin",
    status: "live",
    minutes: 15,
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

/**
 * The guides this registry is actually rendered as a LINK for.
 *
 * GuideIndex renders a `status: "planned"` entry as a <span> plus a "Coming
 * soon" badge and offers its `related` articles instead — deliberately, so the
 * index can show the full taxonomy without a dead link. That makes the `href`
 * on a planned entry a PLAN, not navigation: nothing in the product will ever
 * take a user there.
 *
 * The general rule, which cost us a false-green route-reachability guard: a
 * registry that carries an href for something it never renders as a link is a
 * PHANTOM-TARGET SOURCE, not a dead link. Anything reasoning about which URLs
 * the product links to must read this function, never the GUIDES array and
 * never the file's text — otherwise a page created at a planned guide's path
 * looks reachable while no user can click through to it.
 *
 * Consumers: src/test/route-reachability.test.ts. src/app/sitemap.ts applies
 * the same `status === "live"` filter on top of publicGuides().
 */
export function linkedGuides(): Guide[] {
  return GUIDES.filter((g) => g.status === "live");
}
