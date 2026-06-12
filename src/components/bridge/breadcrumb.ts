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

/** Static segment → display label. Mirrors the nav vocabulary. */
export const CRUMB_LABELS: Record<string, string> = {
  bridge: "Dashboard",
  inbox: "Inbox",
  upload: "Upload",
  preview: "Preview",
  drafts: "Drafts",
  settings: "Settings",
  library: "Library",
  suppliers: "Suppliers",
  buyers: "Buyers",
  mappings: "Mappings",
  rules: "Validation rules",
  templates: "Output templates",
  standards: "Standards",
  operations: "Operations",
  log: "Delivery log",
  connectors: "Connectors",
  connections: "Connections",
  webhooks: "Webhooks",
  admin: "Admin",
  help: "Help",
  inbound: "Inbound",
  invoices: "Invoices",
  asns: "ASNs",
  exceptions: "Exceptions",
  health: "System health",
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
  /** PO number for the active /inbox/[orderId] or /upload/preview/[orderId]. */
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

  // Dynamic id segment — resolve a real name from context, else noun + short id.
  if (looksLikeId(segment)) {
    const parent = index > 0 ? segments[index - 1] : undefined;

    // /inbox/[orderId]  ·  /upload/preview/[orderId]
    if (parent === "inbox" || parent === "preview") {
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
 * Build the full ordered crumb trail for a pathname.
 * The last segment is the current page (no href); all earlier segments link.
 */
export function buildCrumbTrail(pathname: string, ctx: CrumbContext = {}): Crumb[] {
  const segments = pathname.split("/").filter(Boolean);
  return segments.map((segment, index) => {
    const isLast = index === segments.length - 1;
    return {
      label: formatCrumbLabel(segment, index, segments, ctx),
      href: isLast ? null : crumbHref(segments, index),
    };
  });
}
