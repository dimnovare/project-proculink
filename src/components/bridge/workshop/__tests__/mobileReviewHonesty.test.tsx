import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, within, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Order } from "@/types/procurement";
import type { AcceptanceGateDecision } from "@/lib/api/types";
import { readyBarLabel } from "../acceptanceGateModel";

// ─────────────────────────────────────────────────────────────────────────────
// Two places where the SMALLER screen gave the more confident answer.
//
// Both defects lived on the sub-lg review surface (<MobileTriage/>, rendered by
// OrderWorkshop below `lg`), and both had already been fixed on the desktop path —
// which is exactly why neither was caught: the desktop assertion passes.
//
// DEFECT 1 — a green `XML` badge on a supplier that receives CSV.
//   `outputArtifactType()` answered a hard-coded "XML" whenever the order held no
//   DELIVERABLE artifact:
//
//       const fmt = deliverableArtifact(artifacts)?.format?.toLowerCase();
//       if (!fmt) return "XML";
//
//   That is not an edge case, it is the ordinary pre-send state — `useSendFlow`
//   runs the transform PRECISELY BECAUSE no deliverable artifact exists yet. So
//   every order still awaiting review showed a confident format badge over
//   "What we will send · To the supplier", plus the sentence "A **XML** file is
//   generated for {supplier} when you send.", before anything had decided one —
//   and wrongly for every supplier that does not receive XML.
//
//   The honest twin already sat in the same file: `orderDeliveryFormat` returns
//   null with the doc "the confirmation says nothing rather than guessing", and the
//   send-confirmation modal was moved onto it. The mobile card was left behind, so
//   the badge and the modal it opened named different formats for the same order.
//
// DEFECT 2 — the mobile ready bar dropped the overridden-rules qualifier.
//   `MobileTriage` hard-coded "No open issues — ready to send." and received no
//   `readyLabel` and no advisory count. For an order whose supplier rules FAILED and
//   were OVERRIDDEN (`blocked:false` with a non-empty `blockers` list —
//   AcceptanceGate.cs:62-77), the desktop rail said:
//
//       No open issues, but 2 supplier rules did not pass and were overridden…
//
//   and the phone said everything was fine. Its send button was equally silent,
//   because `warningIssues` was recomputed here from FIELD issues alone, without the
//   `advisoryAcceptanceCount` the desktop path adds — so the desktop button read
//   "Send to supplier · 2 optional" and the mobile one read "Send to supplier".
//
//   OrderWorkshop's own header states the invariant this broke: the gate must
//   "evaluate identically at 390/768/1440".
//
// ── WHY EVERY ASSERTION BELOW IS SCOPED TO THE MOBILE SUBTREE ────────────────
// jsdom applies NO Tailwind, so `lg:hidden` / `hidden lg:flex` are inert and BOTH
// trees mount at every width. An unscoped `document.body.textContent` assertion is
// therefore VACUOUS for defect 2: the desktop rail renders the qualifier already, so
// the body contains it whether or not MobileTriage was ever fixed. Each test below
// reads the textContent of a node inside `data-testid="mobile-triage"`, and the last
// test in the file proves the scoping is load-bearing by showing the desktop rail
// carrying the same sentence in the same render.
// ─────────────────────────────────────────────────────────────────────────────

const mockState: {
  order: Order | null;
  gate: AcceptanceGateDecision;
  exceptionCount: number;
} = {
  order: null,
  gate: undefined as unknown as AcceptanceGateDecision,
  exceptionCount: 0,
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: {
      counterpartyNoun: "Supplier",
      counterpartyPlural: "Suppliers",
      railHeader: "Buyer → Supplier",
      unknownBuyer: "Buyer not detected",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent",
      deliveredLabel: "Delivered to supplier",
    },
  }),
}));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getAiCalibration: vi.fn().mockResolvedValue({ isActive: false, buckets: [] }),
    getOrderAudit: vi.fn().mockResolvedValue([]),
  },
  getMappingOverride: vi.fn().mockResolvedValue(null),
  // Empty preview → the "What we will send" card falls to its prose branch, which is
  // the half of defect 1 that named a format in a sentence rather than a badge.
  previewMappingOverride: vi.fn().mockResolvedValue({ content: "", error: null }),
  validateOrder: vi.fn().mockResolvedValue({ orderId: "ord-1", passed: true, results: [] }),
}));

vi.mock("@/lib/api/acceptance-gate", () => ({
  getAcceptanceGate: vi.fn(() => Promise.resolve(mockState.gate)),
}));

vi.mock("../../review/CatalogHintCard", () => ({
  CatalogHintCard: () => <div data-testid="catalog-hint-stub" />,
}));

vi.mock("../../review/hooks/useOrderReview", () => ({
  useOrderReview: () => ({
    order: mockState.order,
    isLoading: false,
    isError: false,
    refetchOrder: vi.fn().mockResolvedValue(undefined),
    exceptionCount: mockState.exceptionCount,
    isStuck: false,
  }),
}));

vi.mock("../../review/hooks/useSendFlow", () => ({
  useSendFlow: () => ({
    flowNotice: null,
    flowSeverity: "info",
    setFlow: vi.fn(),
    sendState: "idle",
    crossed: false,
    confirmSend: vi.fn(),
    showConfirm: false,
    setShowConfirm: vi.fn(),
  }),
}));

vi.mock("../../review/hooks/useResolveActions", () => ({
  useResolveActions: () => ({
    acceptSuggestion: vi.fn(),
    commitVersion: 0,
    lineEditId: null,
    lineDraft: "",
    setLineDraft: vi.fn(),
    startLineEdit: vi.fn(),
    commitLineCode: vi.fn(),
    cancelLineEdit: vi.fn(),
    confirmFlaggedLine: vi.fn(),
    acceptingLineId: null,
    bulkAcceptSuggestions: vi.fn(),
    bulkAccepting: false,
  }),
}));

// Stubbed to its issuesSlot only. The mapper owns the format TABS, and leaving it
// mounted would put the literal "XML" on screen from a control that is not under
// test — which would make defect 1's assertion fail for the wrong reason.
vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: Record<string, unknown>) => (
    <div data-testid="mock-mapper-workbench">
      <div data-testid="issues-slot">{props.issuesSlot as ReactNode}</div>
    </div>
  ),
}));

import { OrderWorkshop } from "../OrderWorkshop";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * A CLEAN order for a supplier that does NOT receive XML, holding NO artifacts —
 * the ordinary state of an order sitting in review, and the state defect 1 lied
 * about. Nothing here can be mistaken for the fix: an order that already carries a
 * CSV artifact renders "CSV" with the old code too.
 */
function cleanOrder(over: Partial<Order> = {}): Order {
  return {
    id: "ord-1",
    poNumber: "PO-1",
    supplierId: "sup-1",
    supplierName: "Nordkiosk Components",
    buyerName: "Buyer Co",
    orderDate: "2026-06-18",
    currency: "EUR",
    status: "ready",
    createdAt: "2026-06-18T00:00:00Z",
    updatedAt: "2026-06-18T00:00:00Z",
    lines: [
      {
        id: "l-1",
        lineNumber: 1,
        description: "Widget",
        quantity: 2,
        unitPrice: 10,
        supplierItemCode: "NRD-1",
        buyerItemCode: "B-1",
        needsReview: false,
      },
    ] as Order["lines"],
    artifacts: [],
    ...over,
  };
}

/** Nothing failed, nothing was overridden. */
const CLEAR: AcceptanceGateDecision = {
  blocked: false,
  reason: null,
  overridden: false,
  overriddenBy: null,
  overrideReason: null,
  blockers: [],
};

/**
 * Two supplier rules failed and an operator recorded an OVERRIDE. The server will
 * transform and deliver this order — `blocked:false` — while still listing the rules
 * that did not pass. This is the exact shape defect 2 rendered as "everything is
 * fine" on a phone.
 */
const OVERRIDDEN: AcceptanceGateDecision = {
  blocked: false,
  reason: "Nordkiosk Components flagged this order.",
  overridden: true,
  overriddenBy: "ops@example.com",
  overrideReason: "Agreed by phone with the supplier",
  blockers: [
    { code: "unitPrice.atMost", lineNumber: 1, message: "Unit price above the agreed ceiling" },
    { code: "quantity.multipleOf", lineNumber: 1, message: "Quantity is not a multiple of the pack size" },
  ],
};

/** The sentence the desktop rail shows for OVERRIDDEN — read from its producer, never retyped. */
const OVERRIDDEN_SENTENCE = readyBarLabel({ advisoryCount: 2, counterpartyNoun: "Supplier" });

const MOBILE = 390;

/**
 * Set the viewport. Honest limitation, stated rather than implied: nothing under
 * `workshop/` reads `innerWidth` or `matchMedia`, and jsdom lays out nothing, so this
 * does not make the desktop tree disappear. It puts the run at the width the defects
 * were reported at, and the scoping described in the header is what actually isolates
 * the mobile surface.
 */
function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, writable: true, configurable: true });
  Object.defineProperty(window, "outerWidth", { value: width, writable: true, configurable: true });
  window.matchMedia = ((query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const max = /max-width:\s*(\d+)px/.exec(query);
    let matches = false;
    if (min) matches = width >= Number(min[1]);
    else if (max) matches = width <= Number(max[1]);
    return {
      matches, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  window.dispatchEvent(new Event("resize"));
}

function renderWorkshop() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <OrderWorkshop orderId="ord-1" />
    </QueryClientProvider>,
  );
}

/** The sub-lg surface, as rendered text. Every assertion in this file reads from here. */
async function mobileText(testid: string): Promise<string> {
  const triage = await screen.findByTestId("mobile-triage");
  const node = await within(triage).findByTestId(testid);
  return node.textContent ?? "";
}

/**
 * "What we will send", EXPANDED, as rendered text.
 *
 * The card ships `defaultOpen={false}`, so its collapsed textContent is the header alone —
 * which is where the format BADGE lives, and where the operator sees it without touching
 * anything. The sentence that also named the format sits in the body, so the toggle has to
 * be pressed for an assertion to see both halves of the defect at once.
 */
async function sendCardText(): Promise<string> {
  const triage = await screen.findByTestId("mobile-triage");
  const card = await within(triage).findByTestId("mobile-card-send");
  const toggle = within(card).getByRole("button", { name: /what we will send/i });
  if (toggle.getAttribute("aria-expanded") !== "true") fireEvent.click(toggle);
  return card.textContent ?? "";
}

beforeEach(() => {
  mockState.order = cleanOrder();
  mockState.gate = CLEAR;
  mockState.exceptionCount = 0;
  setViewport(MOBILE);
});
afterEach(cleanup);

// ─────────────────────────────────────────────────────────────────────────────
// 1 — the format the supplier receives is named only once something has decided it.
// ─────────────────────────────────────────────────────────────────────────────
describe(`"What we will send" at ${MOBILE}px names no format until one exists`, () => {
  test("an order with NO deliverable artifact says nothing about XML", async () => {
    // The control the finding names: no artifact, and a supplier that does not
    // receive XML. Pre-fix this card carried an `XML` badge and the sentence
    // "A XML file is generated for Nordkiosk Components when you send."
    renderWorkshop();

    const card = await sendCardText();
    expect(
      card,
      "the mobile send card named a delivery format before any artifact decided one",
    ).not.toMatch(/XML/i);
    // The rest of the card still does its job — this is an omission, not a deletion.
    expect(card).toContain("A file is generated for Nordkiosk Components when you send.");
    expect(card).toContain("Open this order on a larger screen");
  });

  test("an order whose ONLY artifact is a re-processed preview also says nothing", async () => {
    // `deliverableArtifact` filters the `/reprocessed/` key namespace out, so this
    // order has no deliverable format either — the case OrderWorkshop's own
    // `sendModalFormat` comment calls "reachable rather than theoretical".
    mockState.order = cleanOrder({
      artifacts: [
        { id: "a-1", format: "json", fileKey: "orders/ord-1/reprocessed/preview.json", createdAt: "2026-06-19T00:00:00Z" },
      ],
    });
    renderWorkshop();

    const card = await sendCardText();
    expect(card).not.toMatch(/XML/i);
    // Nor does it promote the preview's own format to a delivery claim.
    expect(card).not.toMatch(/JSON/i);
  });

  test("ANTI-VACUITY — a real CSV artifact still prints CSV", async () => {
    // Without this, a change that simply deleted the badge and the format clause
    // would pass every assertion above. This is a positive control ONLY: it also
    // passed before the fix, because a present artifact never took the "XML" branch.
    mockState.order = cleanOrder({
      artifacts: [
        { id: "a-1", format: "csv", fileKey: "orders/ord-1/out/order.csv", createdAt: "2026-06-19T00:00:00Z" },
      ],
    });
    renderWorkshop();

    const card = await sendCardText();
    expect(card, "the format badge/sentence no longer render at all").toContain("CSV");
    expect(card).toContain("A CSV file is generated for Nordkiosk Components when you send.");
  });

  test("ANTI-VACUITY — the locator resolves the card it claims to read", async () => {
    // A stale testid would make every `not.toMatch` above vacuously green.
    renderWorkshop();
    const triage = await screen.findByTestId("mobile-triage");
    expect(within(triage).getByTestId("mobile-card-send")).toBeInTheDocument();
    // The card is collapsed by default; sendCardText() must actually open it, or every
    // `not.toMatch` above would be reading a two-word header and passing for free.
    const text = await sendCardText();
    expect(text).toContain("What we will send");
    expect(text, "sendCardText() did not expand the card — the sentence assertions are vacuous")
      .toContain("Open this order on a larger screen");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2 — an overridden order reads the same on a phone as on a laptop.
// ─────────────────────────────────────────────────────────────────────────────
describe(`the ready bar at ${MOBILE}px keeps the overridden-rules qualifier`, () => {
  test("blocked:false with a non-empty blockers list is qualified, not called clean", async () => {
    mockState.gate = OVERRIDDEN;
    renderWorkshop();

    await waitFor(async () => {
      const bar = await mobileText("mobile-triage-ready");
      // The producer's sentence, verbatim — not a second copy typed into this file.
      expect(
        bar,
        "the mobile all-clear said the order was clean while 2 overridden supplier rules stood",
      ).toContain(OVERRIDDEN_SENTENCE);
    });
  });

  test("the mobile send button counts the advisory rules the desktop button counts", async () => {
    mockState.gate = OVERRIDDEN;
    renderWorkshop();

    await waitFor(async () => {
      const bar = await mobileText("mobile-send-bar");
      expect(bar, 'the mobile send bar dropped the "· N optional" the desktop button shows')
        .toContain("2 optional");
    });
  });

  test("ANTI-VACUITY — a CLEAR gate gets the clean sentence and no qualifier", async () => {
    // Proves the bar is driven by the gate rather than by a new constant: with
    // nothing overridden it must NOT acquire the qualifier, and it must still say
    // the clean thing.
    renderWorkshop();

    const bar = await mobileText("mobile-triage-ready");
    expect(bar).toContain(readyBarLabel({ advisoryCount: 0, counterpartyNoun: "Supplier" }));
    expect(bar).not.toMatch(/overridden/i);
    expect(await mobileText("mobile-send-bar")).not.toMatch(/optional/i);
  });

  test("ANTI-VACUITY — an unscoped body assertion would have passed with the defect live", async () => {
    // The reason every test above reads a node INSIDE mobile-triage. jsdom applies no
    // Tailwind, so the desktop rail mounts at 390px too and already carried this
    // sentence before the fix — `document.body.textContent` therefore cannot tell the
    // two surfaces apart, and a body-level assertion is not a control at all.
    mockState.gate = OVERRIDDEN;
    renderWorkshop();

    // The desktop rail is <IssuesPanel>, mounted inside the mapper's issuesSlot. Its
    // clean-order early return carries no `issues-panel` testid, so the slot the stub
    // renders is the stable handle.
    await waitFor(() => {
      expect(screen.getByTestId("issues-slot").textContent ?? "").toContain("Ready to send");
    });
    const desktopRail = screen.getByTestId("issues-slot").textContent ?? "";
    expect(
      desktopRail,
      "the desktop rail is the surface that was already correct — if this ever fails, " +
        "the scoping rationale in this file's header is stale and the tests above need re-reading",
    ).toContain(OVERRIDDEN_SENTENCE);
    expect(document.body.textContent ?? "").toContain(OVERRIDDEN_SENTENCE);
  });
});
