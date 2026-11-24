/**
 * The shot list. One entry per screenshot referenced by a guide.
 *
 * `guide` + `name` must match the `<GuideShot name="…" />` inside that guide's
 * MDX, because the rendered path is `/guides/<guide>/<name>.png`. A guide can
 * reference a shot that is not in this list yet — the component renders nothing
 * in production and a labelled placeholder in dev — so adding the picture later
 * never breaks the page.
 *
 * Shots are viewport captures anchored on a piece of on-screen text rather than
 * a CSS selector. That is deliberate: class names and DOM structure change every
 * polish pass, but "Your inbound email address" is the copy the guide is
 * describing. If the anchor text disappears, the capture fails loudly, which is
 * the correct signal that the guide's prose is now wrong too.
 */

export interface Shot {
  /** Guide slug — becomes the folder under public/guides/. */
  guide: string;
  /** File name without extension. */
  name: string;
  /** Route to load, relative to the dev server. */
  path: string;
  /**
   * Visible text to wait for, and to scroll into view before capturing. The
   * capture fails if it never appears.
   */
  anchor: string;
  /**
   * Pixels of context to keep visible ABOVE the anchor. The anchor is scrolled
   * to the top of the viewport first, then the view is pulled back by this much.
   */
  offset?: number;
  /**
   * Visible text to click before framing the shot, in order. Use for
   * disclosures that hide the thing the guide is describing — a collapsed
   * section photographs as an empty page. Prefix with `button:` to click the
   * button with exactly that accessible name instead (e.g. an aria-label).
   */
  clickTexts?: string[];
  /** Selects to set after the clicks, in order: [the select's label, the option's text]. */
  selects?: [string, string][];
  /** sessionStorage to set before the page loads, e.g. the empty-workspace mock. */
  session?: Record<string, string>;
  /** Extra settle time in ms before the shutter (animations, lazy content). */
  settle?: number;
  /**
   * Crop the capture to this many CSS pixels of height from the top of the
   * viewport. Use when a screen is short and the rest of the frame is empty.
   */
  clipHeight?: number;
  /**
   * Mock-mode furniture to blank out — dev-only artefacts that would be
   * confusing in a customer-facing screenshot. Smallest element containing the
   * text is hidden with `visibility`, so layout does not move.
   */
  hideTexts?: string[];
}

/** The single mock supplier id seeded by the in-memory API client. */
const MOCK_SUPPLIER = "11111111-1111-1111-1111-111111111111";

/** The empty-workspace mock (src/lib/api/mockWorkspace.ts): no flow yet, so the first-run screen shows. */
const NEW_WORKSPACE = { "proculink.mock.workspace": "new" };
const FLOW = "/flows/flow-1";
const SAMPLE = ["Use our sample invoice"];
const NEW_DESTINATION: Pick<Shot, "path" | "clickTexts"> = {
  path: `${FLOW}?tab=send`,
  clickTexts: ["button:Change where the file goes"],
};

export const SHOTS: Shot[] = [
  // ── Start here: set-up-your-first-flow ───────────────────────────────────
  { guide: "set-up-your-first-flow", name: "add-a-document", path: "/documents", session: NEW_WORKSPACE, anchor: "Welcome", offset: 60, clipHeight: 560 },
  { guide: "set-up-your-first-flow", name: "check-what-we-read", path: "/documents", session: NEW_WORKSPACE, clickTexts: SAMPLE, anchor: "values and 1 table", offset: 300, settle: 1600 },
  {
    guide: "set-up-your-first-flow", name: "choose-where-it-goes", path: "/documents", session: NEW_WORKSPACE,
    clickTexts: [...SAMPLE, "Looks right, next"], anchor: "Step 3 of 3", offset: 120, settle: 800,
  },

  // ── Start here: check-and-send-a-document ────────────────────────────────
  { guide: "check-and-send-a-document", name: "needs-you", path: "/documents", anchor: "Needs you", offset: 200, clipHeight: 600 },
  { guide: "check-and-send-a-document", name: "compare", path: `${FLOW}/documents/doc-1`, anchor: "What we read", settle: 1200 },
  { guide: "check-and-send-a-document", name: "fix", path: `${FLOW}/documents/doc-1`, clickTexts: ["button:History"], anchor: "Lines, 3 rows", offset: 120, settle: 1200 },
  {
    guide: "check-and-send-a-document", name: "files", path: `${FLOW}/documents/doc-1`,
    clickTexts: ["button:Preview"], anchor: "What we'll send", offset: 40, settle: 1200,
  },
  { guide: "check-and-send-a-document", name: "sent", path: `${FLOW}/documents/doc-3`, anchor: "Deliveries", settle: 1200 },

  // ── Start here: send-to-a-destination ────────────────────────────────────
  { guide: "send-to-a-destination", name: "goes-to", ...NEW_DESTINATION, anchor: "Files we make", offset: 20 },
  {
    guide: "send-to-a-destination", name: "new-destination", ...NEW_DESTINATION,
    selects: [["Goes to", "New destination…"]], anchor: "Files we make", offset: 20,
  },
  {
    guide: "send-to-a-destination", name: "sign-in-and-save", ...NEW_DESTINATION,
    selects: [["Goes to", "New destination…"], ["Send by", "SFTP"]], anchor: "Goes to", offset: 180,
  },
  { guide: "send-to-a-destination", name: "send-a-test", path: `${FLOW}?tab=send`, anchor: "Files we make", offset: 20 },
  { guide: "send-to-a-destination", name: "deliveries", path: `${FLOW}/documents/doc-3`, anchor: "Deliveries", settle: 1200 },

  // ── onboard-a-new-client (admin) ─────────────────────────────────────────
  // The admin dashboard itself is NOT in this list: /api/admin/overview and
  // /api/admin/organisations have no mock implementation, so a capture in mock
  // mode would photograph an error state. Those slots stay empty until someone
  // captures them against a live API with an allowlisted session.
  {
    guide: "onboard-a-new-client",
    name: "supplier-catalog-tab",
    path: `/library/suppliers/${MOCK_SUPPLIER}?tab=catalog`,
    // The scheduled-pull configuration is behind a disclosure; collapsed, this
    // page photographs as a heading and nothing else.
    clickTexts: ["Keep the catalog in sync automatically"],
    anchor: "Product catalog",
    offset: 150,
    settle: 1600,
    clipHeight: 700,
  },
];
