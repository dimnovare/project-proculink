// WP-27 — the practice-order banner is SERVER-driven, not URL-driven.
//
// It used to key off `?sample=1`, a parameter only useSampleOrder appended. That made
// the framing an accident of navigation: open the same practice order from a bookmark,
// the back button, an inbox row, or a hand-typed /inbox/{id} and it rendered as a real
// order — no "free", no "doesn't count against your plan", no warning about what
// pressing send would do. And a REAL order opened with `?sample=1` pasted on rendered
// as practice, which is worse.
//
// `order.isSample` comes from PurchaseOrderEntity.IsSample via OrderDto, so it is true
// wherever the order is opened from and false everywhere else.

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { Order, OrderValidationResult } from "@/types/procurement";
import { PRACTICE_DELIVERY_STATES, type PracticeDeliveryState } from "@/lib/practiceDelivery";

const mockState: {
  order: Order | null | undefined;
  searchParams: URLSearchParams;
} = {
  order: undefined,
  searchParams: new URLSearchParams(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => mockState.searchParams,
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

// The banner's pre-send promise is conditional on what THIS session actually started
// (see practiceDeliveryKnown). The default here is "we don't know" — a bookmark — so the
// framing tests below assert the framing, not the promise.
vi.mock("@/hooks/useSampleOrder", () => ({
  practiceDeliveryKnown: () => practiceDelivery,
}));

let practiceDelivery: PracticeDeliveryState | null = null;

// Party labels are per-ORG (outbound → "Supplier", inbound → "Customer"), so the mock
// has to be switchable: a string that reads correctly in one direction and nonsense in
// the other is exactly the regression the last test in this file exists to catch.
let counterpartyNoun = "Supplier";

vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: {
      counterpartyNoun,
      primaryCta: `Send to ${counterpartyNoun.toLowerCase()}`,
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent",
      deliveredLabel: `Delivered to ${counterpartyNoun.toLowerCase()}`,
    },
  }),
}));

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getAiCalibration: vi.fn().mockResolvedValue({ isActive: false, buckets: [] }),
    getOrderAudit: vi.fn().mockResolvedValue([]),
    getOrderPassport: vi.fn().mockResolvedValue(null),
    getOrderById: vi.fn(),
    transformOrder: vi.fn(),
    retryDelivery: vi.fn(),
    redeliverOrder: vi.fn(),
    markDelivered: vi.fn(),
  },
  requeueDelivery: vi.fn(),
  getOpsHealth: vi.fn(),
  getMappingOverride: vi.fn().mockResolvedValue(null),
  previewMappingOverride: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../review/hooks/useOrderReview", () => ({
  useOrderReview: () => ({
    order: mockState.order,
    isLoading: false,
    isError: false,
    refetchOrder: vi.fn().mockResolvedValue(undefined),
    exceptionCount: 0,
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

vi.mock("../../review/hooks/useAcceptanceValidation", () => ({
  useAcceptanceValidation: () => ({
    validationResult: { passed: true, results: [] } as OrderValidationResult,
    failingRuleCount: 0,
    isStale: false,
  }),
}));

// The mock MUST render issuesSlot. WP-28 moved the practice note out of its own
// chrome band and into the Issues column, which OrderWorkshop passes down as
// `issuesSlot` — a mock that drops the slot makes every assertion here look like
// "the note does not render" when the note is simply not being handed anywhere.
// Same shape as invariants.test.tsx:209 and validationEveryBreakpoint.test.tsx:140,
// which already mock it this way for exactly this reason.
vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: { issuesSlot?: React.ReactNode }) => (
    <div data-testid="mock-mapper-workbench">{props.issuesSlot}</div>
  ),
}));
vi.mock("../../problem/OrderProblemPanel", () => ({
  OrderProblemPanel: () => <div data-testid="mock-problem-panel" />,
}));
vi.mock("../MobileTriage", () => ({ MobileTriage: () => <div data-testid="mock-mobile-triage" /> }));

import { OrderWorkshop } from "../OrderWorkshop";

function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: "ord-1",
    poNumber: "DEMO-2026-001",
    supplierId: "sup-1",
    supplierName: "ProcuLink Sample Supplier",
    buyerName: "Buyer Co",
    orderDate: "2026-06-18",
    currency: "EUR",
    status: "pending_review",
    createdAt: "2026-06-18T00:00:00Z",
    updatedAt: "2026-06-18T00:00:00Z",
    lines: [],
    artifacts: [],
    ...over,
  };
}

const banner = () => screen.queryByRole("note", { name: /practice order/i });

beforeEach(() => {
  mockState.order = undefined;
  mockState.searchParams = new URLSearchParams();
  practiceDelivery = null;
  counterpartyNoun = "Supplier";
});
afterEach(cleanup);

describe("practice-order framing", () => {
  test("shows for a sample order with NO ?sample=1 in the URL", () => {
    mockState.order = makeOrder({ isSample: true });
    mockState.searchParams = new URLSearchParams(); // bookmark / back button / inbox row
    render(<OrderWorkshop orderId="ord-1" />);

    const note = banner();
    expect(note).not.toBeNull();
    // Both apostrophes: WP-28's copy uses the typographic U+2019 (&rsquo;), the
    // earlier band used U+0027. A test that fails on a curly quote is testing the
    // glyph, not the promise.
    expect(note!.textContent).toMatch(/doesn['’]?t count against your plan/i);
  });

  test("does NOT show for a real order, even with ?sample=1 pasted on", () => {
    mockState.order = makeOrder({ isSample: false });
    mockState.searchParams = new URLSearchParams("sample=1");
    render(<OrderWorkshop orderId="ord-1" />);

    expect(banner()).toBeNull();
  });

  test("does not show when the backend omits the flag entirely (pre-WP-27 API)", () => {
    // `isSample` is optional on the Order type precisely because an older backend
    // sends nothing. Absent must read as "not a practice order", never as practice.
    mockState.order = makeOrder();
    render(<OrderWorkshop orderId="ord-1" />);

    expect(banner()).toBeNull();
  });

  test("names the delivered outcome once the practice order has been sent", () => {
    mockState.order = makeOrder({ isSample: true, status: "delivered" });
    render(<OrderWorkshop orderId="ord-1" />);

    const note = banner();
    expect(note).not.toBeNull();
    expect(note!.textContent).toMatch(/practice order delivered/i);
    expect(note!.textContent).toMatch(/emailed you the finished file/i);
    // …and invites the real thing.
    expect(note!.querySelector('a[href="/upload"]')).not.toBeNull();
  });

  test("promises an email ONLY when this run really has a delivery set up", async () => {
    // A deployment with no email provider seeds nothing, and the backend says so via
    // practiceDelivery="not_set_up". Promising "we'll email you the finished file" there
    // would be a promise we cannot keep — the run stops at "no delivery is set up".
    practiceDelivery = "emailed_to_you";
    mockState.order = makeOrder({ isSample: true });
    const { unmount } = render(<OrderWorkshop orderId="ord-1" />);
    await waitFor(() =>
      expect(banner()!.textContent).toMatch(/finished file is emailed to you/i),
    );
    unmount();

    practiceDelivery = "not_set_up";
    mockState.order = makeOrder({ isSample: true });
    render(<OrderWorkshop orderId="ord-1" />);
    await waitFor(() =>
      // "deployment", not "workspace": the condition is !_email.IsConfigured, an
      // env var on the ProcuLink deployment. No workspace setting can fix it, so
      // the old copy sent the user hunting in Settings.
      expect(banner()!.textContent).toMatch(/email sending isn'?t configured on this proculink deployment/i),
    );
    expect(banner()!.textContent).not.toMatch(/finished file is emailed to you/i);
  });

  test("does not promise a stop when the supplier already has a delivery target", async () => {
    // WP-39 §4.5. This is the case the old bool could not express: the seeder found a
    // delivery config it did not write and could not replace, so it left it alone — and
    // pressing send dispatches through it. The screen used to render this identically to
    // "not_set_up" and tell the operator the run would stop.
    practiceDelivery = "existing_target";
    mockState.order = makeOrder({ isSample: true });
    render(<OrderWorkshop orderId="ord-1" />);

    await waitFor(() =>
      expect(banner()!.textContent).toMatch(/already has a delivery target/i),
    );
    expect(banner()!.textContent).not.toMatch(/will stop at/i);
    expect(banner()!.textContent).not.toMatch(/finished file is emailed to you/i);
  });

  test("promises nothing about email when this session did not start the run", () => {
    // A bookmark, the back button, an inbox row — none of them carry the state, so
    // practiceDeliveryKnown answers null and this screen cannot account for the run.
    //
    // It used to print "Nothing reaches a real supplier." here, which is the WP-39 §4.5
    // promise a second time: an existing_target run opened from a bookmark lands on this
    // exact branch, and pressing send DOES dispatch through the target already set up.
    // No backend change is needed to reach it.
    practiceDelivery = null;
    mockState.order = makeOrder({ isSample: true });
    render(<OrderWorkshop orderId="ord-1" />);

    expect(banner()!.textContent).not.toMatch(/nothing reaches a real/i);
    expect(banner()!.textContent).not.toMatch(/emailed to you/i);
    expect(banner()!.textContent).not.toMatch(/will stop at/i);
    // …and it does say which of those it is, rather than going quiet.
    expect(banner()!.textContent).toMatch(/can.t tell/i);
  });

  test("never hardcodes a party noun — an inbound org reads 'customer', not 'supplier'", async () => {
    // WAVE4 binding constraint: party nouns route through partyLabels(direction).
    // An inbound org has CUSTOMERS, not suppliers, so a hardcoded "supplier" here is
    // four sentences about a party that org does not have. lint:vocab cannot catch it —
    // it checks nav labels against the nine-noun budget, not body copy.
    counterpartyNoun = "Customer";

    // EVERY pre-send branch, plus the delivered branch: every sentence the banner can
    // render has to survive the relabel, not just the one that happens to be default.
    // Driven off PRACTICE_DELIVERY_STATES rather than a list typed here — this walk used
    // to enumerate [null, true, false], and a state added to the table would have slipped
    // past it unrelabelled, which is how "supplier" survives into an inbound org.
    for (const known of [null, ...PRACTICE_DELIVERY_STATES]) {
      practiceDelivery = known;
      mockState.order = makeOrder({ isSample: true });
      const { unmount } = render(<OrderWorkshop orderId="ord-1" />);
      await waitFor(() => expect(banner()).not.toBeNull());
      expect(banner()!.textContent ?? "").not.toMatch(/supplier/i);
      unmount();
    }

    mockState.order = makeOrder({ isSample: true, status: "delivered" });
    render(<OrderWorkshop orderId="ord-1" />);
    expect(banner()!.textContent ?? "").not.toMatch(/supplier/i);
  });

  test("uses a system icon, never an emoji", () => {
    mockState.order = makeOrder({ isSample: true });
    render(<OrderWorkshop orderId="ord-1" />);

    // Emoji-as-icon is banned by the design system; this note used to open with a
    // green-circle emoji (U+1F7E2). Written as a codepoint deliberately — WP-28's
    // no-emoji-icons guard scans comments too, so spelling the glyph out here would
    // make a comment about the ban trip the ban.
    expect(banner()!.textContent ?? "").not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
