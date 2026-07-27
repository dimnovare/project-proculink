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
   * section photographs as an empty page.
   */
  clickTexts?: string[];
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

/** The mock order that is parked with no supplier resolved. */
const MOCK_UNROUTED_ORDER = "ord-004";

/** The mock order sitting in review with unresolved lines. */
const MOCK_REVIEW_ORDER = "ord-002";

export const SHOTS: Shot[] = [
  // ── upload-orders-manually ───────────────────────────────────────────────
  {
    guide: "upload-orders-manually",
    name: "upload-screen",
    path: "/upload",
    anchor: "Add your order file",
    offset: 170,
    settle: 900,
  },

  // ── receive-orders-over-api ──────────────────────────────────────────────
  {
    guide: "receive-orders-over-api",
    name: "api-keys",
    path: "/settings?tab=api",
    anchor: "Your ingress endpoint",
    offset: 120,
    settle: 800,
  },

  // ── receive-orders-by-sftp ───────────────────────────────────────────────
  {
    guide: "receive-orders-by-sftp",
    name: "sftp-pull-form",
    path: "/settings?tab=sftp",
    anchor: "Poll this SFTP folder for orders",
    offset: 130,
    settle: 800,
  },

  // ── receive-orders-from-s3 ───────────────────────────────────────────────
  {
    guide: "receive-orders-from-s3",
    name: "s3-pull-form",
    path: "/settings?tab=s3",
    anchor: "Watch this bucket for orders",
    offset: 130,
    settle: 800,
  },

  // ── poll-a-mailbox-over-imap ─────────────────────────────────────────────
  {
    guide: "poll-a-mailbox-over-imap",
    name: "imap-mailbox-form",
    path: "/settings?tab=email",
    anchor: "IMAP mailbox",
    offset: 110,
    settle: 700,
  },

  // ── add-a-supplier ───────────────────────────────────────────────────────
  // The "New supplier" panel is NOT in this list. Mock billing reports Pilot at
  // its one-supplier limit (`canAddSupplier: false`, api/billing.ts), which is
  // correct for exercising the limit banner but leaves the add button disabled
  // and reading "Supplier limit reached" — so the panel cannot be opened in mock
  // mode. Capturing it needs a live workspace with headroom.
  {
    guide: "add-a-supplier",
    name: "supplier-identifiers",
    path: `/library/suppliers/${MOCK_SUPPLIER}?tab=overview`,
    anchor: "Identifiers",
    // Deliberately tight. A larger offset pulls in the Overview KPI strip,
    // whose numbers are mock furniture (SupplierDockProfile's DEMO_MOCK) —
    // shipping "1,284 orders · 97% acceptance" into the help centre would be a
    // fabricated statistic even though it is only sample data on screen.
    offset: 30,
    settle: 1200,
    clipHeight: 700,
  },

  // ── import-a-supplier-catalog ────────────────────────────────────────────
  {
    guide: "import-a-supplier-catalog",
    name: "catalog-tab",
    path: `/library/suppliers/${MOCK_SUPPLIER}?tab=catalog`,
    anchor: "Product catalog",
    offset: 130,
    settle: 1400,
    clipHeight: 700,
  },

  // ── review-an-order ──────────────────────────────────────────────────────
  {
    guide: "review-an-order",
    name: "needs-supplier",
    path: `/inbox/${MOCK_UNROUTED_ORDER}`,
    anchor: "needs a supplier",
    offset: 80,
    settle: 900,
  },

  // ── resolve-item-codes ───────────────────────────────────────────────────
  {
    guide: "resolve-item-codes",
    name: "issues-panel",
    path: `/inbox/${MOCK_REVIEW_ORDER}`,
    anchor: "Before you send",
    offset: 60,
    settle: 1200,
  },

  // ── set-up-supplier-delivery ─────────────────────────────────────────────
  // The Delivery tab is NOT in this list, for the same reason as the admin
  // dashboard below: `getDeliveryConfig` (src/lib/api/delivery.ts) has no mock
  // implementation, so in mock mode DeliveryConfigEditor takes its load-failure
  // branch and renders "Couldn't load delivery config". A capture here would
  // photograph an error state and teach the reader nothing. It needs a live API
  // session.

  // ── receive-orders-by-email (client) ─────────────────────────────────────
  {
    guide: "receive-orders-by-email",
    name: "settings-email-intake",
    path: "/settings?tab=email",
    anchor: "Your inbound email address",
    offset: 140,
    settle: 700,
  },
  {
    guide: "receive-orders-by-email",
    name: "imap-form",
    path: "/settings?tab=email",
    anchor: "IMAP mailbox",
    offset: 110,
    settle: 700,
  },
  {
    guide: "receive-orders-by-email",
    name: "needs-supplier-banner",
    path: `/inbox/${MOCK_UNROUTED_ORDER}`,
    anchor: "needs a supplier",
    offset: 80,
    settle: 900,
  },

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
