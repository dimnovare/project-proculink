import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderStatus, OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// WP-29 — one label, one number, everywhere.
//
// At 478b809 the dashboard printed "Ready to send" over `ready + ready_to_deliver`
// (BridgeDashboard.tsx:947 reading :643) while the inbox badged only `ready` with
// those words (UnifiedStatusBadge.tsx:99) and offered no chip for it at all. The
// operator read a number on one screen and could not find it on the other. Neither
// computation was wrong on its own — that is the point. Two independent derivations
// of one label IS the defect.
//
// THIS TEST IS THE PACKET'S REAL DELIVERABLE, and it is deliberately GENERAL: it
// walks ORDER_COUNT_CONTRACT rather than naming "Ready to send". A future count that
// diverges fails here without anyone writing a new test — which is the only kind of
// guard that survives the next packet.
//
// Both surfaces tag every contract count with data-count-label / data-count-value.
// The tag is not an escape hatch: REQUIRED_ON_* below asserts which labels each
// surface must carry, so deleting a tag fails just as loudly as printing a wrong
// number.
//
// ── AND THE TAG IS NOT THE CORPUS EITHER (added after this test missed the
//    very defect it names) ─────────────────────────────────────────────────────
//
// At 68ed5f2 this file was GREEN with the regression live on the dashboard.
// BridgeDashboard's "Ready to send" SECTION printed `readyRows.length`, and
// `readyRows` was `status === "ready" || status === "ready_to_deliver"` — the
// removed sum, under the removed label, in the same viewport as the stat tile
// that had been fixed. `printedCounts` walked `[data-count-label]`, and
// SectionHead's count span carries no attribute, so the sum was invisible here.
//
// An opt-in marker means a NEW count is unguarded BY DEFAULT — the failure is
// never "someone deleted a tag", it is "someone wrote markup and did not know a
// tag existed". So `printedCounts` now reads the rendered DOM as well: it finds
// the label and reads the number printed against it (src/test/printedCounts.ts).
// Untagged counts are in the corpus whether or not anyone opted them in, and
// "the sweep is not vacuous" below asserts the untagged path really fires.
// ─────────────────────────────────────────────────────────────────────────────

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => searchParams,
}));

const api = {
  getOrders: vi.fn(),
  getOrdersSummary: vi.fn(),
  getSuppliers: vi.fn(),
  getDashboardTopology: vi.fn(),
  redeliverOrder: vi.fn(),
  transformOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => api.getOrdersSummary(...a),
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getDashboardTopology: (...a: unknown[]) => api.getDashboardTopology(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
  },
}));

// DashboardContextLine reads Clerk's useUser() for the operator's first name; the
// dashboard is not mounted inside a ClerkProvider here.
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({
  ONBOARDING_STATUS_QUERY_KEY: ["onboarding-status"],
  useOnboardingStatus: () => ({
    data: { hasSupplier: true, hasUpload: true, hasResolvedMapping: true, hasDelivery: true },
  }),
  invalidateOnboardingStatus: vi.fn(),
}));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    direction: "outbound",
    labels: {
      counterpartyNoun: "Supplier",
      counterpartyPlural: "Suppliers",
      railHeader: "Buyer → Supplier",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent to supplier",
      deliveredLabel: "Delivered to supplier",
      unknownBuyer: "Unknown buyer",
    },
  }),
}));

import { InboxView, FILTER_CHIPS } from "./InboxView";
import { BridgeDashboard } from "./BridgeDashboard";
import {
  ORDER_COUNT_CONTRACT,
  INBOX_CHIP_LABELS,
  countFor,
  chipIndexForStatus,
} from "./orderCountContract";
import {
  anchorsFor,
  bareNumber,
  collectPrintedCounts,
  labelRemainder,
  type PrintedCount,
} from "@/test/printedCounts";

// ── ONE fixture, rendered into both screens ──────────────────────────────────
// Every status carries a DIFFERENT count, and no two contract labels sum to the
// same number, so a wrong status set can never coincidentally print the right
// figure. `ready` (5) and `ready_to_deliver` (7) matter most: the old dashboard
// summed them to 12, a number that must now appear nowhere.
const BY_STATUS: Partial<Record<OrderStatus, number>> = {
  parsing: 1,
  unrouted: 3,
  pending_review: 9,
  ready: 5,
  ready_to_deliver: 7,
  transforming: 1,
  delivering: 2,
  delivered: 11,
  delivery_held: 1,
  delivery_unconfirmed: 1,
  failed: 2,
  transform_failed: 1,
  delivery_failed: 4,
  delivery_dead_letter: 6,
  rejected_by_supplier: 8,
};
const TOTAL = Object.values(BY_STATUS).reduce((a, b) => a + b, 0); // 62

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-7000${seq}`,
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-07-20T09:00:00Z",
    status: "ready",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

const ROWS: OrderSummary[] = [
  order({ status: "ready" }),
  order({ status: "ready_to_deliver" }),
  order({ status: "pending_review", unresolvedCount: 2 }),
  order({ status: "delivered" }),
  order({ status: "delivery_failed" }),
];

function mockApi() {
  api.getOrders.mockResolvedValue({
    items: ROWS,
    totalCount: TOTAL,
    page: 1,
    pageSize: 25,
  });
  api.getOrdersSummary.mockResolvedValue({ byStatus: BY_STATUS, total: TOTAL });
  api.getSuppliers.mockResolvedValue([]);
  api.getDashboardTopology.mockResolvedValue({ buyers: [], suppliers: [], wires: [] });
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const CONTRACT_LABELS = ORDER_COUNT_CONTRACT.map((r) => r.label);

/** Every occurrence of a contract count on a surface — tagged or merely printed. */
function occurrencesOf(container: HTMLElement): PrintedCount[] {
  return collectPrintedCounts(container, CONTRACT_LABELS);
}

/** Every contract count a surface printed, as {label → number}. */
function printedCounts(container: HTMLElement): Map<string, number> {
  const found = new Map<string, number>();
  for (const occurrence of occurrencesOf(container)) {
    const { label, value } = occurrence;
    const prev = found.get(label);
    if (prev !== undefined) {
      // The SAME label twice on ONE screen must also agree — the dashboard prints
      // several of these in the stat row, the proportion-bar legend AND a section
      // head, and the section head is the one that carries no tag.
      expect(
        value,
        `"${label}" printed twice on one screen with different numbers ` +
          `(${prev} vs ${value}); the second was found by ${occurrence.via} in:\n  ${occurrence.where}`,
      ).toBe(prev);
    }
    found.set(label, value);
  }
  return found;
}

async function renderInbox() {
  mockApi();
  const { container } = render(
    <QueryClientProvider client={newClient()}>
      <ConfirmProvider>
        <InboxView />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrdersSummary).toHaveBeenCalled());
  await waitFor(() =>
    expect(container.querySelector('[data-count-label="All orders"]')).toBeTruthy(),
  );
  return container;
}

async function renderDashboard() {
  mockApi();
  const { container } = render(
    <QueryClientProvider client={newClient()}>
      <ConfirmProvider>
        <BridgeDashboard />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrdersSummary).toHaveBeenCalled());
  await waitFor(() =>
    expect(container.querySelectorAll("[data-count-label]").length).toBeGreaterThan(0),
  );
  return container;
}

/** Labels each surface MUST print — the guard against a silently-untagged count. */
const REQUIRED_ON_INBOX = [
  "All orders",
  "Needs review",
  "Ready to send",
  "Queued to send",
  "Delivered",
  "Failed",
];
const REQUIRED_ON_DASHBOARD = [
  "Received",
  "Needs review",
  "Ready to send",
  "Queued to send",
  "Delivered",
  "Failed",
];

beforeEach(() => {
  searchParams = new URLSearchParams();
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe("cross-screen count parity — one label, one number", () => {
  it("every count the inbox prints equals the contract's number for that label", async () => {
    const container = await renderInbox();
    const printed = printedCounts(container);
    for (const [label, value] of printed) {
      expect(value, `inbox printed "${label}"`).toBe(countFor(label, BY_STATUS, TOTAL));
    }
  });

  it("every count the dashboard prints equals the contract's number for that label", async () => {
    const container = await renderDashboard();
    const printed = printedCounts(container);
    for (const [label, value] of printed) {
      expect(value, `dashboard printed "${label}"`).toBe(countFor(label, BY_STATUS, TOTAL));
    }
  });

  it("a label on BOTH screens prints the SAME number for the same fixture", async () => {
    const inbox = printedCounts(await renderInbox());
    cleanup();
    const dashboard = printedCounts(await renderDashboard());

    const shared = [...inbox.keys()].filter((l) => dashboard.has(l));
    // Not a vacuous intersection: these five labels are the whole reason the test exists.
    expect(shared.sort()).toEqual(
      ["Delivered", "Failed", "Needs review", "Queued to send", "Ready to send"].sort(),
    );
    for (const label of shared) {
      expect(
        dashboard.get(label),
        `"${label}" — inbox says ${inbox.get(label)}, dashboard says ${dashboard.get(label)}`,
      ).toBe(inbox.get(label));
    }
  });

  it('"Ready to send" means `ready` only — not `ready + ready_to_deliver`', async () => {
    // The exact regression. 5 is `ready`; 12 is the old sum. If 12 ever comes back,
    // the dashboard is summing two statuses under one label again.
    const inbox = printedCounts(await renderInbox());
    cleanup();
    const dashboard = printedCounts(await renderDashboard());
    for (const surface of [inbox, dashboard]) {
      expect(surface.get("Ready to send")).toBe(5);
      expect(surface.get("Ready to send")).not.toBe(12);
      expect(surface.get("Queued to send")).toBe(7);
    }
  });

  it("neither surface silently drops a contract count", async () => {
    const inbox = printedCounts(await renderInbox());
    for (const label of REQUIRED_ON_INBOX) {
      expect(inbox.has(label), `inbox must print "${label}"`).toBe(true);
    }
    cleanup();
    const dashboard = printedCounts(await renderDashboard());
    for (const label of REQUIRED_ON_DASHBOARD) {
      expect(dashboard.has(label), `dashboard must print "${label}"`).toBe(true);
    }
  });

  it("every printed label is a contract label (nothing computes counts beside the markup)", async () => {
    const known = new Set(ORDER_COUNT_CONTRACT.map((r) => r.label));
    const inbox = printedCounts(await renderInbox());
    cleanup();
    const dashboard = printedCounts(await renderDashboard());
    for (const label of [...inbox.keys(), ...dashboard.keys()]) {
      expect(known.has(label), `"${label}" is tagged as a count but is not in ORDER_COUNT_CONTRACT`).toBe(true);
    }
  });
});

describe("the sweep sees counts that never opted in", () => {
  const fixture = (html: string): HTMLElement => {
    const el = document.createElement("div");
    el.innerHTML = html;
    return el;
  };

  it("reads a SectionHead-shaped count that carries no data-count-* attribute", () => {
    // BridgeDashboard's SectionHead, in shape: a title element and a bare count
    // pill beside it. THIS is what the attribute-only sweep could not see, so it
    // is pinned as a fixture rather than left to the live component — a fixture
    // does not change when the dashboard's markup does.
    const head = fixture(
      `<div><h3>Ready to send</h3><span class="tabular-nums">12</span>` +
        `<span>validated — nothing blocking</span><a href="/inbox">See all</a></div>`,
    );
    const all = collectPrintedCounts(head, CONTRACT_LABELS);
    expect(all.map((o) => [o.label, o.value, o.via, o.tagged])).toEqual([
      ["Ready to send", 12, "adjacency", false],
    ]);
    // …and the OLD corpus — attribute-tagged elements only — saw nothing at all.
    // That equality is the regression, stated as an assertion instead of prose.
    expect(head.querySelectorAll("[data-count-label]")).toHaveLength(0);
    expect(all.filter((o) => o.via === "attribute")).toEqual([]);
  });

  it("attributes a number to a label only across a word boundary", () => {
    // useOrderDirection ships `deliveredLabel: "Delivered to supplier"`. Reading
    // that as the "Delivered" count would attach the contract label to whatever
    // figure sat beside a shipping confirmation.
    expect(labelRemainder("Delivered to supplier", "Delivered")).toBeNull();
    expect(labelRemainder("Delivered", "Delivered")).toBe("");
    expect(labelRemainder("Delivered · 11", "Delivered")).toBe("· 11");
    expect(labelRemainder("Ready to send 5", "Ready to send")).toBe("5");
    expect(labelRemainder("Undelivered 3", "Delivered")).toBeNull();
    expect(
      collectPrintedCounts(fixture(`<div><span>Delivered to supplier</span><b>9</b></div>`), CONTRACT_LABELS),
    ).toEqual([]);
  });

  it("credits the label's own element, not every wrapper around it", () => {
    // Without the minimal-anchor rule every ancestor up to the container anchors
    // the label, and a section's unrelated figures become its count.
    const nested = fixture(
      `<section><div><h3>Needs review</h3><span>9</span></div><p>PO-70001 · 4 lines</p></section>`,
    );
    expect(anchorsFor(nested, "Needs review").map((el) => el.tagName)).toEqual(["H3"]);
    expect(collectPrintedCounts(nested, CONTRACT_LABELS).map((o) => o.value)).toEqual([9]);
  });

  it("reads a number nested INSIDE the label element (the proportion-bar legend)", () => {
    const legend = fixture(`<span><i></i>Failed <b>21</b></span>`);
    expect(collectPrintedCounts(legend, CONTRACT_LABELS).map((o) => [o.label, o.value])).toEqual([
      ["Failed", 21],
    ]);
  });

  it("does not reach past the immediately adjacent sibling", () => {
    // An order row badges its status and then prints unrelated figures — a line
    // count, a total. Reaching further than one sibling would read those as the
    // queue count and make the guard noise, which is how a guard gets deleted.
    const row = fixture(
      `<div><span>Ready to send</span><span>PO-70001</span><span>4</span><span>1200</span></div>`,
    );
    expect(collectPrintedCounts(row, CONTRACT_LABELS)).toEqual([]);
  });

  it("only bare integers count — not money, percentages or '+n more'", () => {
    expect(bareNumber("5")).toBe(5);
    expect(bareNumber(" 1,204 ")).toBe(1204);
    expect(bareNumber("+4 more")).toBeNull();
    expect(bareNumber("62%")).toBeNull();
    expect(bareNumber("€1,200")).toBeNull();
    expect(bareNumber("1.5")).toBeNull();
    expect(bareNumber("")).toBeNull();
  });

  it("a tagged count and an untagged one for the same label must agree", () => {
    // The overlap is the mechanism that caught the section head: the stat tile
    // declared 5, the section head merely printed 12, and one screen cannot mean
    // both. Pinned on a fixture so it holds when the dashboard changes shape.
    const disagreeing = fixture(
      `<div><span data-count-label="Ready to send" data-count-value="5">5</span>` +
        `<div><h3>Ready to send</h3><span>12</span></div></div>`,
    );
    const values = collectPrintedCounts(disagreeing, CONTRACT_LABELS)
      .filter((o) => o.label === "Ready to send")
      .map((o) => o.value)
      .sort((a, b) => a - b);
    expect(values).toEqual([5, 12]);
  });
});

describe("the sweep is not vacuous on the real screens", () => {
  // ANTI-VACUITY FLOORS. A sweep that finds nothing passes everything, which is
  // exactly the shape of the defect this packet fixes. If the machinery breaks —
  // a selector typo, a render that never settles — these fail instead of every
  // later assertion quietly succeeding over an empty corpus.

  it("the dashboard prints a floor of contract counts, and some carry NO tag", async () => {
    const occurrences = occurrencesOf(await renderDashboard());
    // 5 stat tiles + 5 legend cells + at least one section head, each seen by at
    // least one sweep. A number well under what the screen really prints, so this
    // fails on a broken sweep rather than on a layout tweak.
    expect(occurrences.length).toBeGreaterThanOrEqual(12);

    const untagged = occurrences.filter((o) => !o.tagged);
    expect(
      untagged.length,
      "no untagged occurrence found — the adjacency sweep is dead code, and an " +
        "untagged count would be invisible again",
    ).toBeGreaterThanOrEqual(1);
  });

  it("the 'Ready to send' SECTION head is in the corpus, and prints `ready` only", async () => {
    // The regression, named at the exact element that carried it. The section
    // head is deliberately left WITHOUT a data-count-label: tagging it would fix
    // this one number and leave the next untagged count unguarded all over again.
    const container = await renderDashboard();
    const readyOccurrences = occurrencesOf(container).filter((o) => o.label === "Ready to send");
    const untagged = readyOccurrences.filter((o) => !o.tagged);
    expect(
      untagged.length,
      "the dashboard's 'Ready to send' section head must be read by the adjacency " +
        "sweep; if it is 0 the section stopped rendering and this test is vacuous",
    ).toBeGreaterThanOrEqual(1);
    // 5 is `ready`. 12 is `ready + ready_to_deliver` — the sum WP-29 removed and
    // this section restored.
    for (const occurrence of readyOccurrences) {
      expect(occurrence.value, `"Ready to send" printed in:\n  ${occurrence.where}`).toBe(5);
    }
  });

  it("the inbox prints a floor of contract counts", async () => {
    const occurrences = occurrencesOf(await renderInbox());
    // Six chips, each read by both sweeps.
    expect(occurrences.length).toBeGreaterThanOrEqual(6);
  });

  it("'Ready to send' on the dashboard links to the queue that prints the same number", async () => {
    // WP-29's other half. The stat tiles were pointed at `/inbox?status=ready` so
    // that the number you click is the number you land on; the section below them
    // still linked to a bare `/inbox`, where no 5 exists. Every link inside the
    // section must carry the filter.
    const container = await renderDashboard();
    const section = container.querySelector<HTMLElement>('section[aria-label="Orders ready to send"]');
    expect(section, "the 'Ready to send' section must render for this fixture").toBeTruthy();
    const hrefs = Array.from(section!.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.length, "the section must carry its links").toBeGreaterThanOrEqual(2);
    for (const href of hrefs) {
      expect(href, "a bare /inbox lands on an unfiltered queue").toBe("/inbox?status=ready");
    }
  });
});

describe("the chip table is derived, not hand-written", () => {
  it("InboxView's FILTER_CHIPS renders exactly INBOX_CHIP_LABELS, in order", () => {
    expect(FILTER_CHIPS.map((c) => c.label)).toEqual([...INBOX_CHIP_LABELS]);
  });

  it("each chip's summary keys are the contract's statuses for its own label", () => {
    for (const chip of FILTER_CHIPS) {
      const expected = ORDER_COUNT_CONTRACT.find((r) => r.label === chip.label)?.statuses;
      // `null` (the account total) is carried as an absent summaryKeys.
      expect(chip.summaryKeys ?? null, `chip "${chip.label}"`).toEqual(expected ?? null);
    }
  });

  it("chip highlight indices are derived from the chip order, so inserting a chip can't mis-light another", () => {
    expect(chipIndexForStatus("pending_review")).toBe(INBOX_CHIP_LABELS.indexOf("Needs review"));
    expect(chipIndexForStatus("ready")).toBe(INBOX_CHIP_LABELS.indexOf("Ready to send"));
    expect(chipIndexForStatus("ready_to_deliver")).toBe(INBOX_CHIP_LABELS.indexOf("Queued to send"));
    expect(chipIndexForStatus("delivered")).toBe(INBOX_CHIP_LABELS.indexOf("Delivered"));
    for (const s of ["failed", "transform_failed", "delivery_failed", "delivery_dead_letter", "rejected_by_supplier"]) {
      expect(chipIndexForStatus(s), s).toBe(INBOX_CHIP_LABELS.indexOf("Failed"));
    }
    // No chip of their own — they stay deep-linkable and fall back to "All orders".
    for (const s of ["unrouted", "parsing", "delivering", "delivery_held", "delivery_unconfirmed"]) {
      expect(chipIndexForStatus(s), s).toBe(0);
    }
    expect(chipIndexForStatus(null)).toBe(0);
    expect(chipIndexForStatus("nonsense")).toBe(0);
  });

  it("the `ready` deep link lights the Ready to send chip, not All orders", async () => {
    // C6: INBOX_FILTERABLE_STATUSES accepted ?status=ready, so the server filter ran,
    // but CHIP_FOR_STATUS had no entry — the view showed only `ready` orders while the
    // toolbar claimed "All orders" was selected.
    searchParams = new URLSearchParams("status=ready");
    const container = await renderInbox();
    // Queried through the count tag, not by accessible name: the mobile card is itself
    // a <button> whose name contains its status badge, so /Ready to send/ matches both.
    const chip = (label: string) =>
      container.querySelector(`[data-count-label="${label}"]`)!.closest("button")!;
    expect(chip("Ready to send").getAttribute("aria-pressed")).toBe("true");
    expect(chip("All orders").getAttribute("aria-pressed")).toBe("false");
  });
});
