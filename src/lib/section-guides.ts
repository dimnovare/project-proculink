// section-guides — the help for each app screen, and the pages that have none.
//
// One entry per app screen, keyed by its App Router pattern. The help panel
// matches the current pathname against this registry and shows "On this
// screen", the screen's name, three tasks (each opens a help page) and a
// "Start here" line. Every page under src/app/(app) is either here or in
// NO_SCREEN_HELP; src/lib/section-guides.test.ts walks the route tree to keep
// it that way.
//
// Every sentence must be true on main when it ships: never describe a screen's
// behaviour before it is live.

export interface HelpTask {
  title: string;
  line: string;
  /** "/help/<slug>" or "/help/guides/<slug>" */
  href: string;
}

export interface SectionGuideEntry {
  /** App Router pattern, e.g. "/flows/[flowId]". */
  route: string;
  /** Shown after "On this screen". */
  screen: string;
  tasks: [HelpTask, HelpTask, HelpTask];
  startHere: string;
}

const SET_UP_FIRST_FLOW = "/help/guides/set-up-your-first-flow";
const FILES_WE_READ: HelpTask = { title: "Files we read", line: "The kinds of files we read, and what to expect from each.", href: "/help/what-we-read" };
const BUILD_AN_OUTPUT: HelpTask = { title: "Make a file", line: "The file we make from each document, and its columns.", href: "/help/guides/build-an-output" };
const IMPORT_A_LOOKUP: HelpTask = { title: "Import a lookup", line: "Make one from a table you already have.", href: "/help/guides/import-a-lookup" };
const USE_A_LOOKUP: HelpTask = { title: "Use a lookup in a file", line: "Swap a column's value for the one the lookup gives.", href: "/help/lookups" };
const EMAIL_WHEN_NEEDED: HelpTask = { title: "Get an email when something needs you", line: "Choose what you are emailed about.", href: "/help/activity-and-notifications" };

export const SECTION_GUIDES: SectionGuideEntry[] = [
  {
    route: "/documents",
    screen: "Documents",
    tasks: [
      { title: "What \"Needs you\" means", line: "The documents waiting for you to check or send them.", href: "/help/documents-and-statuses" },
      { title: "Review and send a document", line: "Open one, check the marked values, then send it.", href: "/help/guides/check-and-send-a-document" },
      { title: "Find an older document", line: "Look under Sent or All, or search by name or number.", href: "/help/documents-and-statuses" },
    ],
    startHere: "Press Review next. It opens the first document that needs you.",
  },
  {
    route: "/flows/[flowId]/documents/[documentId]",
    screen: "A document",
    tasks: [
      { title: "Check and send a document", line: "Change any value that is wrong, then send it.", href: "/help/guides/check-and-send-a-document" },
      { title: "Teach a value we missed", line: "Point at it on the page, and we read it there next time.", href: "/help/guides/teach-a-value" },
      { title: "What each status means", line: "From Received to Sent, and what you can do at each.", href: "/help/documents-and-statuses" },
    ],
    startHere: "Compare what we read with the original, then send it.",
  },
  {
    route: "/upload",
    screen: "Upload",
    tasks: [
      { title: "Ways to send documents in", line: "Upload, email, or a pickup from a server.", href: "/help/intake-channels" },
      FILES_WE_READ,
      { title: "Set up your first flow", line: "Tell us what to read and where to send it.", href: SET_UP_FIRST_FLOW },
    ],
    startHere: "Drop in any document. We work out what it is.",
  },
  {
    route: "/flows",
    screen: "Flows",
    tasks: [
      { title: "What a flow is", line: "What it reads, what it checks and where it sends.", href: "/help/flows" },
      { title: "Set up your first flow", line: "Tell us what to read and where to send it.", href: SET_UP_FIRST_FLOW },
      { title: "Receive documents by email", line: "Every flow has its own address to send documents to.", href: "/help/guides/receive-documents-by-email" },
    ],
    startHere: "Open a flow to see what it reads and where it sends.",
  },
  {
    route: "/flows/new",
    screen: "New flow",
    tasks: [
      { title: "Set up your first flow", line: "Step by step, from an example document to the first send.", href: SET_UP_FIRST_FLOW },
      FILES_WE_READ,
      BUILD_AN_OUTPUT,
    ],
    startHere: "Start with an example of the document this flow will receive.",
  },
  {
    route: "/flows/[flowId]",
    screen: "A flow",
    tasks: [
      { title: "Use your changes", line: "Put your changes in use, or go back to an earlier version.", href: "/help/guides/publish-a-flow-version" },
      BUILD_AN_OUTPUT,
      { title: "Send files to a destination", line: "Choose where each file goes, and send a test.", href: "/help/guides/send-to-a-destination" },
    ],
    startHere: "Once the setup is saved, changes to what we read and the files we make wait until you use them.",
  },
  {
    route: "/lookups",
    screen: "Lookups",
    tasks: [
      { title: "What a lookup does", line: "It turns one value into another as a document is sent.", href: "/help/lookups" },
      IMPORT_A_LOOKUP,
      USE_A_LOOKUP,
    ],
    startHere: "Make a lookup from a table you already have, then use it in a file.",
  },
  {
    route: "/lookups/[lookupId]",
    screen: "A lookup",
    tasks: [
      { title: "Change a lookup's rows", line: "Each row has a From value and what it becomes.", href: "/help/lookups" },
      IMPORT_A_LOOKUP,
      USE_A_LOOKUP,
    ],
    startHere: "Each row turns one value into another when a document is sent.",
  },
  {
    route: "/operations/log",
    screen: "Activity",
    tasks: [
      { title: "What Activity shows", line: "Everything that happened to your documents, newest first.", href: "/help/activity-and-notifications" },
      { title: "When a document couldn't be sent", line: "See where it stopped, fix the destination, then send it again.", href: "/help/destinations" },
      EMAIL_WHEN_NEEDED,
    ],
    startHere: "Open a row to see where a document was sent and what the destination answered.",
  },
  {
    route: "/settings",
    screen: "Settings",
    tasks: [
      { title: "Plans and billing", line: "Your plan, what you have used, and how to change it.", href: "/help/billing-faq" },
      { title: "Create an API key", line: "For sending documents from your own systems.", href: "/help/workspace-and-team" },
      EMAIL_WHEN_NEEDED,
    ],
    startHere: "Use the tabs at the top to move between the parts of Settings.",
  },
];

const OLD_ORDERS = "Read-only history of the old order screens.";
const FOUNDER_ONLY = "Founder-only.";

/** App pages with no help of their own, and why. */
export const NO_SCREEN_HELP: Record<string, string> = {
  "/archive": OLD_ORDERS,
  "/archive/[orderId]": OLD_ORDERS,
  "/settings/google-callback": "Returns from Google and moves on by itself.",
  "/flows/[flowId]/outputs/[outputId]/advanced": "The field-by-field view for professionals; search and popular articles still show.",
  "/admin": FOUNDER_ONLY,
  "/admin/guides": FOUNDER_ONLY,
  "/admin/guides/erase-order-data": FOUNDER_ONLY,
  "/admin/guides/onboard-a-new-client": FOUNDER_ONLY,
  "/admin/guides/unfreeze-a-pilot-workspace": FOUNDER_ONLY,
};

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
