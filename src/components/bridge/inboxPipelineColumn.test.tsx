import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import type { OrderSummary } from "@/types/procurement";

// ─────────────────────────────────────────────────────────────────────────────
// WP-29 — the Pipeline column: five unlabelled dots in 184px.
//
// At 478b809 the cell rendered <StatusJourney compact/> and nothing else: no role,
// no aria-label, no title, no caption, no legend anywhere on the page. A screen
// reader announced the empty string, and a sighted operator was asked to count
// dots. At 390px the column does not render at all and the mobile card carried no
// pipeline information of any kind.
//
// The second half of the AC is the harder one: THE STAGE LABEL MUST MATCH THE LIT
// NODE. Two statuses failed it, and they failed it in a way that contradicted the
// DASHBOARD's own already-pinned map:
//
//   statusJourneyFailedStage.test.tsx:100  journeyStageFor("parsing")     === 0
//   statusJourneyFailedStage.test.tsx:102  journeyStageFor("transforming") === 3
//   InboxView STATUS_PRESENTATION          extracting.stage === 1  ← both of them
//
// One order, two screens, two lit nodes.
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
  redeliverOrder: vi.fn(),
  transformOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  apiClient: {
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => api.getOrdersSummary(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
  },
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
}));
vi.mock("@/hooks/useOrderDirection", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useOrderDirection")>(
    "@/hooks/useOrderDirection",
  );
  return { ...actual, useOrderDirection: () => ({ direction: "outbound", labels: actual.partyLabels("outbound") }) };
});

import { InboxView, mapStatus, journeyStage, STATUS_PRESENTATION } from "./InboxView";
import { journeyStageFor } from "./BridgeDashboard";
import { PIPELINE_STAGE_NAMES, pipelineCaption, pipelineAccessibleName } from "./pipelineIndicator";
import { statusLabel } from "./UnifiedStatusBadge";

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-6600${seq}`,
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-07-20T09:00:00Z",
    status: "pending_review",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    ...over,
  } as OrderSummary;
}

async function renderInbox(items: OrderSummary[]) {
  api.getOrders.mockResolvedValue({ items, totalCount: items.length, page: 1, pageSize: 25 });
  api.getOrdersSummary.mockResolvedValue({ byStatus: { pending_review: 1 }, total: 1 });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <ConfirmProvider>
        <InboxView />
      </ConfirmProvider>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrders).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe("the Pipeline column has an accessible name", () => {
  it("every rendered pipeline cell exposes role=img with a name that says the step AND the status", async () => {
    const { container } = await renderInbox([order({ status: "pending_review", poNumber: "PO-66001" })]);
    await screen.findAllByText("PO-66001");
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-pipeline]'));
    expect(cells.length, "the Pipeline cell must be findable").toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.getAttribute("role")).toBe("img");
      const name = cell.getAttribute("aria-label") ?? "";
      expect(name).toMatch(/Step 3 of 5: Validate/);
      expect(name).toMatch(/Needs review/);
    }
  });

  it("a failed order names the node it failed at, not a bare step number", async () => {
    const { container } = await renderInbox([order({ status: "transform_failed", poNumber: "PO-66002" })]);
    await screen.findAllByText("PO-66002");
    const cell = container.querySelector<HTMLElement>("[data-pipeline]")!;
    expect(cell.getAttribute("aria-label")).toMatch(/Failed at step 4 of 5: Transform/);
    expect(cell.getAttribute("aria-label")).toMatch(/Couldn.t build output/);
  });

  it("the five dots themselves are hidden from assistive tech — the name carries the meaning", async () => {
    const { container } = await renderInbox([order({ status: "delivered", poNumber: "PO-66003" })]);
    await screen.findAllByText("PO-66003");
    const cell = container.querySelector<HTMLElement>("[data-pipeline]")!;
    expect(cell.querySelector("[aria-hidden='true']")).toBeTruthy();
  });
});

describe("the Pipeline column has a legend", () => {
  it("names all five stages, in order, once", async () => {
    const { container } = await renderInbox([order({ status: "ready", poNumber: "PO-66004" })]);
    await screen.findAllByText("PO-66004");
    const legend = container.querySelector<HTMLElement>("[data-pipeline-legend]");
    expect(legend, "a 1-of-5 caption is meaningless without the key").toBeTruthy();
    const text = legend!.textContent ?? "";
    let cursor = -1;
    for (const [i, stage] of PIPELINE_STAGE_NAMES.entries()) {
      const at = text.indexOf(stage);
      expect(at, `legend must name "${stage}"`).toBeGreaterThan(-1);
      expect(at, `legend must list "${stage}" in pipeline order`).toBeGreaterThan(cursor);
      cursor = at;
      expect(text).toContain(String(i + 1));
    }
  });
});

describe("the stage label matches the lit node", () => {
  // Raw status → the node its own words name. Derived from the status LABEL, which is
  // what the operator reads: "Extracting" is the Parse node; "Preparing output" is the
  // Transform node; "Needs review" is Validate.
  // `pending_parse` is a raw backend status the OrderStatus union does not carry, so
  // the tuple is keyed on string — mapStatus takes a string for exactly that reason.
  const EXPECTED: Array<[string, number, string]> = [
    ["pending_parse", 0, "Parse"],
    ["parsing", 0, "Parse"],
    ["unrouted", 1, "Normalize"],
    ["pending_review", 2, "Validate"],
    ["ready", 3, "Transform"],
    ["transforming", 3, "Transform"],
    ["ready_to_deliver", 4, "Deliver"],
    ["delivering", 4, "Deliver"],
    ["delivered", 4, "Deliver"],
    ["delivery_held", 4, "Deliver"],
    ["delivery_unconfirmed", 4, "Deliver"],
  ];

  it.each(EXPECTED)("%s lights %i (%s)", (status, node) => {
    expect(journeyStage(mapStatus(status), status)).toBe(node);
  });

  it("the inbox and the dashboard light the SAME node for the same order", () => {
    // The two maps were built independently and drifted on exactly the two statuses
    // below. journeyStageFor's answers are already pinned by
    // statusJourneyFailedStage.test.tsx — the inbox is the side that was wrong.
    for (const [status] of EXPECTED) {
      const inbox = journeyStage(mapStatus(status), status);
      const dashboard = journeyStageFor(status);
      if (typeof dashboard === "number" && dashboard !== 0) {
        // journeyStageFor's `default: 0` covers statuses the dashboard's in-transit
        // list never shows, so only compare where it has a real answer.
        expect(inbox, `${status}: inbox lit ${JSON.stringify(inbox)}, dashboard lit ${dashboard}`).toBe(dashboard);
      }
    }
    expect(journeyStage(mapStatus("transforming"), "transforming")).toBe(journeyStageFor("transforming"));
    expect(journeyStage(mapStatus("parsing"), "parsing")).toBe(journeyStageFor("parsing"));
  });

  it("`transforming` is 'Preparing output' on BOTH viewports, never 'Extracting'", () => {
    // Desktop reads UnifiedStatusBadge(rawStatus); the mobile card read the collapsed
    // CrossingStatus, which folded `transforming` into `extracting` and printed
    // "Extracting" — the same order saying two different words on two screen sizes.
    expect(statusLabel("transforming")).toBe("Preparing output");
    expect(STATUS_PRESENTATION[mapStatus("transforming")].label).toBe("Preparing output");
    expect(STATUS_PRESENTATION[mapStatus("transforming")].label).not.toBe("Extracting");
  });

  it("the caption a row prints names the node the row lights", async () => {
    const { container } = await renderInbox([order({ status: "transforming", poNumber: "PO-66005" })]);
    await screen.findAllByText("PO-66005");
    const cell = container.querySelector<HTMLElement>("[data-pipeline]")!;
    expect(cell.textContent).toContain("4 of 5");
    expect(cell.textContent).toContain("Transform");
    // …and the row's status badge says the same thing in words.
    expect(screen.getAllByText("Preparing output").length).toBeGreaterThan(0);
  });
});

describe("pure helpers", () => {
  it("caption and accessible name agree about the node", () => {
    expect(pipelineCaption(2)).toBe("3 of 5 · Validate");
    expect(pipelineCaption({ failed: 3 })).toBe("Failed at Transform");
    expect(pipelineAccessibleName(2, "Needs review")).toBe("Step 3 of 5: Validate. Needs review.");
    expect(pipelineAccessibleName({ failed: 4 }, "Couldn't send")).toBe(
      "Failed at step 5 of 5: Deliver. Couldn't send.",
    );
  });

  it("the stage names are the locked five, in order", () => {
    expect([...PIPELINE_STAGE_NAMES]).toEqual([
      "Parse", "Normalize", "Validate", "Transform", "Deliver",
    ]);
  });
});

describe("390px: the card carries the pipeline as text", () => {
  it("prints the step caption instead of dots", async () => {
    await renderInbox([order({ status: "pending_review", poNumber: "PO-66006" })]);
    await screen.findAllByText("PO-66006");
    // The card's caption is plain text — legible at any width and announced without ARIA.
    expect(screen.getAllByText(/Step 3 of 5 · Validate/).length).toBeGreaterThan(0);
  });
});
