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
// The /bridge, /upload, /inbox and /inbox/[orderId] guides went with the order
// screens they described on 2026-11-13, and with them the direction-aware
// `{supplier}` party tokens: the one survivor that used them, /operations/log,
// now reads "supplier", which is what every outbound workspace rendered.

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

export const SECTION_GUIDES: SectionGuideEntry[] = [
  {
    route: "/operations/log",
    title: "Activity log",
    purpose: "A date-grouped audit trail of every order event in your workspace.",
    bullets: [
      { text: "Filter by event type or search by PO, buyer, or supplier" },
      { text: "Expand an entry to see details, errors, and field changes" },
      { text: "Jump to the order behind any event" },
      { text: "Export the current filtered view as CSV" },
      { text: "Only the latest 50 events load — exports cover those" },
    ],
    firstStep: { text: "Once orders exist, filter by Failed and open the order to retry it from there." },
    articleSlugs: ["dashboard-and-statuses", "delivery-setup"],
  },
  // NOTE: /operations/connectors had a guide here until 2026-08-13, and the copy
  // went with the page because the page never delivered it: it promised "a
  // read-only overview of each supplier's delivery channel", while every live
  // row was hardcoded to one channel type. The overview it described is the
  // suppliers list, and test firing belongs to the supplier Delivery tab. The
  // route 308s to /settings.
  // NOTE: /operations/webhooks had a guide here until 2026-08-08. The page was a
  // duplicate of the Settings Connectors tab that no user could navigate to, so it was
  // deleted and now 308s to /settings.
  {
    route: "/settings",
    title: "Settings",
    purpose: "Workspace name, billing, notifications and API keys.",
    bullets: [
      { text: "Check your plan, usage, and upgrade options", href: "/settings?tab=billing" },
      { text: "Create API keys", href: "/settings?tab=api" },
    ],
    firstStep: { text: "Check your plan, usage, and upgrade options", href: "/settings?tab=billing" },
    articleSlugs: ["billing-faq"],
  },
];

// ─── Matching ────────────────────────────────────────────────────────────────

const segmentsOf = (route: string): string[] => route.split("/").filter(Boolean);
const isDynamicSegment = (seg: string): boolean => seg.startsWith("[") && seg.endsWith("]");

/**
 * Registry in match order: longest (most segments) first; among equal lengths,
 * static patterns before dynamic ones, so a static route is never shadowed by
 * a `[param]` pattern of the same length.
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

// ─── Seen state ──────────────────────────────────────────────────────────────

/** localStorage key marking a route's guide as seen (set when the help
 *  slideover is opened on that route; drives the topbar "?" dot badge).
 *  Keyed by the registry ROUTE pattern (e.g. `/operations/log`), so seeing
 *  it once covers all instances. */
export function guideSeenKey(route: string): string {
  return `plk-guide-seen:${route}`;
}
