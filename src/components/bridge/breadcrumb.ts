import { getGuideBySlug } from "@/lib/guides";

// breadcrumb.ts — pure helpers for the topbar auto-breadcrumb.
//
// Separated from BridgeTopbar so the label/href logic is unit-testable and the
// component stays presentational. Two concerns:
//   • crumbHref(segments, index) — the link target for a non-terminal crumb
//     (cumulative path up to and including that segment).
//   • formatCrumbLabel(segment, index, segments, ctx) — the HUMAN-READABLE label
//     for a segment. Static route segments use the LABELS map / title-case; a
//     DYNAMIC detail segment (an id/uuid that has no static label) resolves to a
//     real name from the loaded query cache (PO number, supplier name, connection
//     name) when available, and otherwise falls back to a sensible noun + short
//     id — NEVER a bare full UUID (the founder-reported bug).

/**
 * Static segment → display label. Mirrors the nav vocabulary, so the words a
 * crumb prints are the words the sidebar and hub tabs print (HUB_TABS /
 * HUB_LABELS / NAV_MAIN). The KEYS are route segments — code — and never change;
 * only the labels do (WP-25 / DESIGN-DB-1 §6.1).
 */
export const CRUMB_LABELS: Record<string, string> = {
  bridge: "Overview",
  inbox: "Orders",
  upload: "Upload",
  settings: "Settings",
  library: "Library",
  suppliers: "Suppliers",
  buyers: "Buyers",
  mappings: "Item codes",
  // NOTE: `rules` and `templates` are absent on purpose. FE #47 retired
  // /library/rules and /library/templates behind permanent redirects, so no
  // crumb is ever rendered for them (see src/lib/retired-routes.ts).
  standards: "Format reference",
  operations: "Activity",
  log: "Deliveries",
  connectors: "Delivery channels",
  // The tab a user clicks to get here now reads "Supplier changes"
  // (HubTabs.tsx, suppliers hub), so the crumb it lands under says the same
  // word. The per-record child crumb below stays "Connection <id>": that names
  // ONE record, exactly as "Order 008412" sits under "Orders".
  connections: "Supplier changes",
  webhooks: "Webhooks",
  admin: "Admin",
  help: "Help",
  inbound: "Inbound",
  invoices: "Invoices",
  // "ASN" is trade jargon; the plain phrase is unambiguous (§6.1 #13).
  asns: "Shipping notices",
  exceptions: "Issues",
  health: "System status",
};

/** Title-case an unmapped slug: "order-detail" → "Order Detail". */
export function titleCaseSegment(s: string): string {
  return s.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * A segment "looks like an id" — a UUID, or any opaque token that is long
 * and/or contains digits and has no static label. Such segments are the ones
 * that need a readable label resolved from data rather than shown raw.
 */
export function looksLikeId(segment: string): boolean {
  if (CRUMB_LABELS[segment]) return false;
  // RFC-4122-ish UUID, or a long hyphen/hex token, or anything with a digit run.
  const uuidish = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment);
  return uuidish || segment.length >= 12 || /\d{4,}/.test(segment);
}

/** Short, recognisable tail of an id for fallback labels: "a8c18df7…". */
export function shortId(segment: string): string {
  const head = segment.split("-")[0] ?? segment;
  return head.length > 8 ? `${head.slice(0, 8)}…` : head;
}

/** Truncate a long label for display, preserving whole words/ids. */
export function truncateLabel(label: string, max = 28): string {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1).trimEnd()}…`;
}

/** Resolved names available from the query cache, keyed by the dynamic segment. */
export interface CrumbContext {
  /** PO number for the active /inbox/[orderId]. */
  orderPoNumber?: string | null;
  /** Connection name for /connections/[connectionId]. */
  connectionName?: string | null;
  /** Supplier name for /library/suppliers/[id]. */
  supplierName?: string | null;
}

/**
 * Human-readable label for one breadcrumb segment.
 *
 * @param segment   the raw path segment
 * @param index     its index within `segments`
 * @param segments  the full ordered list of path segments
 * @param ctx       names resolved from the query cache (optional)
 */
export function formatCrumbLabel(
  segment: string,
  index: number,
  segments: string[],
  ctx: CrumbContext = {},
): string {
  // Static, mapped segment.
  const mapped = CRUMB_LABELS[segment];
  if (mapped) return mapped;

  // /admin/guides/[slug] — a guide slug is hyphenated, so looksLikeId() below
  // would claim it and render "Item onboard". The registry knows its real title.
  if (index > 0 && segments[index - 1] === "guides") {
    const guide = getGuideBySlug(segment);
    if (guide) return guide.title;
  }

  // Dynamic id segment — resolve a real name from context, else noun + short id.
  if (looksLikeId(segment)) {
    const parent = index > 0 ? segments[index - 1] : undefined;

    // /inbox/[orderId]
    if (parent === "inbox") {
      if (ctx.orderPoNumber && ctx.orderPoNumber.trim().length > 0) return ctx.orderPoNumber;
      return `Order ${shortId(segment)}`;
    }
    // /connections/[connectionId]
    if (parent === "connections") {
      if (ctx.connectionName && ctx.connectionName.trim().length > 0) return ctx.connectionName;
      return `Connection ${shortId(segment)}`;
    }
    // /library/suppliers/[id]
    if (parent === "suppliers") {
      if (ctx.supplierName && ctx.supplierName.trim().length > 0) return ctx.supplierName;
      return `Supplier ${shortId(segment)}`;
    }
    // Unknown dynamic segment — a sensible noun, never a bare UUID.
    return `Item ${shortId(segment)}`;
  }

  // Unmapped but not an id (e.g. a future static route) — title-case it.
  return titleCaseSegment(segment);
}

/** Cumulative href for a non-terminal crumb (root-anchored path up to `index`). */
export function crumbHref(segments: string[], index: number): string {
  return "/" + segments.slice(0, index + 1).join("/");
}

/** One assembled crumb: label + (link target for non-terminal crumbs). */
export interface Crumb {
  label: string;
  /** Set for every crumb except the current (last) one. */
  href: string | null;
}

/**
 * Top-level route roots that belong to the WORKBENCH group in the v2 nav
 * (screenshots: "Workbench / Inbound documents"). Their trail gets an UNLINKED
 * "Workbench" head crumb — there is no /workbench route, so the head is context,
 * not a link. /inbox intentionally stays bare ("Inbox"), matching the design
 * captures.
 */
const WORKBENCH_GROUP_ROOTS: ReadonlySet<string> = new Set(["inbound"]);

/**
 * Top-level segments that name a NAV GROUP but have NO index route of their own —
 * "/library", "/operations", "/inbound" all 404 live. Their crumb is CONTEXT
 * (the hub the page belongs to), never a link, exactly like the "Workbench" head.
 * Nulling the href here keeps every breadcrumb off a dead 404 target.
 */
const UNLINKED_GROUP_ROOTS: ReadonlySet<string> = new Set(["library", "operations", "inbound"]);

/**
 * True when a pathname's trail is a SINGLE crumb — the current page, which by
 * definition carries no href. Such a trail offers nothing to navigate to; it
 * only repeats the page name. The topbar uses this to drop its context row at
 * the widths where the primary nav row is visible and already names the page
 * (founder-reported "double navbar": "Dashboard" in the nav and again as a lone
 * strip below it).
 */
export function isLonePageCrumb(pathname: string): boolean {
  return buildCrumbTrail(pathname).length === 1;
}

/**
 * Build the full ordered crumb trail for a pathname.
 * The last segment is the current page (no href); all earlier segments link,
 * EXCEPT group-root segments (library / operations / inbound) which have no
 * index route — those stay unlinked context crumbs so no crumb points at a 404.
 * Workbench-group routes are prefixed with an unlinked "Workbench" head crumb.
 */
export function buildCrumbTrail(pathname: string, ctx: CrumbContext = {}): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  const trail = segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    // A group-root at index 0 (e.g. "library") has no index route — never link it.
    const isUnlinkedGroupRoot = index === 0 && UNLINKED_GROUP_ROOTS.has(segment);
    return {
      label: formatCrumbLabel(segment, index, segments, ctx),
      href: isLast || isUnlinkedGroupRoot ? null : crumbHref(segments, index),
    };
  });
  if (segments.length > 0 && WORKBENCH_GROUP_ROOTS.has(segments[0])) {
    return [{ label: "Workbench", href: null }, ...trail];
  }
  return trail;
}
