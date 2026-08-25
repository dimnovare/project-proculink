/* ── An unknown status must not render as a decided one ─────────────────────────
 *
 * THE DEFECT, in two files, one shape.
 *
 * `InboxView.mapStatus` ended `return "new"`, and its own comment admitted what that
 * meant: "landing here claims the pipeline never started". STATUS_PRESENTATION renders
 * `new` as the word "New" at stage 0, so an order whose status this build had never
 * heard of was drawn as brand new and untouched — a full verdict, invented out of not
 * knowing. Frontend and backend deploy separately, so an unrecognised status is a
 * routine event, not an exotic one, and the rows it lands on are the rows we understand
 * least.
 *
 * `UploadWorkbench.recentStatusFromOrder` had the same default under a different name:
 * every unrecognised status was toned `draft`, a decided state no order in this product
 * has ever been in. Nothing rendered the word "Draft" (the pill's text has come from
 * `statusLabel(rawStatus)` for a while), so the visible damage was smaller — but the
 * bucket was named for a real state and shared its treatment, which is how anything
 * Draft ever grew would have attached itself to every status the frontend cannot read.
 *
 * This is the recurring defect class in this codebase: an UNKNOWN value rendering as a
 * DECIDED one. The same shape produced "delivered", "succeeded" and "100%" from absent
 * data on four unrelated surfaces.
 *
 * WHAT THIS FILE PINS. Both halves, in both directions:
 *   • a genuinely unrecognised status renders the neutral, stage-less presentation, and
 *   • every status the order-status manifest DOES name still reaches a decided one.
 * The second half is the control. Without it the whole file would pass against a
 * `mapStatus` that answered "unknown" for everything, which is the opposite defect and
 * an easy one to ship while making this one green.
 *
 * The manifest walk is derived from `ORDER_STATUSES` (src/lib/orderStatusManifest.ts),
 * the registry that owns the question, rather than from a list retyped here — a
 * hand-typed copy is how nine status checklists came to disagree with each other.
 *
 * jsdom applies no Tailwind, so the inbox's mobile card list (`lg:hidden`) AND its
 * desktop table (`hidden lg:block`) both mount. That is used deliberately below: the
 * caption is expected TWICE, once per tree, so a fix that reached only one viewport
 * fails here.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import { ORDER_STATUSES } from "@/lib/orderStatusManifest";
import type { OrderSummary, Supplier } from "@/types/procurement";

/** A status string no ProcuLink build has ever produced. */
const ALIEN = "quantum_flux";

let searchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/inbox",
  useSearchParams: () => searchParams,
}));

const api = {
  getOrders: vi.fn(),
  getOrdersSummary: vi.fn(),
  getSuppliers: vi.fn(),
  redeliverOrder: vi.fn(),
  transformOrder: vi.fn(),
  detectFormat: vi.fn(),
  uploadPurchaseOrder: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  ApiHttpError: class ApiHttpError extends Error {
    status: number;
    body: unknown;
    constructor(message: string, status: number, body: unknown = null) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
      this.body = body;
    }
  },
  getBillingStatus: () =>
    Promise.resolve({ canProcessOrders: true, isTrialExpired: false, plan: "growth", accountStatus: "active" }),
  getOrgSettings: () => Promise.resolve({ direction: "outbound" }),
  apiClient: {
    getOrders: (...a: unknown[]) => api.getOrders(...a),
    getOrdersSummary: (...a: unknown[]) => api.getOrdersSummary(...a),
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    redeliverOrder: (...a: unknown[]) => api.redeliverOrder(...a),
    transformOrder: (...a: unknown[]) => api.transformOrder(...a),
    detectFormat: (...a: unknown[]) => api.detectFormat(...a),
    uploadPurchaseOrder: (...a: unknown[]) => api.uploadPurchaseOrder(...a),
  },
}));

vi.mock("@/lib/analytics", () => ({ capture: vi.fn() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOnboardingStatus", () => ({ useOnboardingStatus: () => ({ data: undefined }) }));
vi.mock("@/hooks/useSampleOrder", () => ({
  useSampleOrder: () => ({ runSample: vi.fn(), isPending: false, error: null }),
  usePracticeOrderEmail: () => "",
}));
vi.mock("@/hooks/useOrderDirection", async () => {
  const actual = await vi.importActual<typeof import("@/hooks/useOrderDirection")>(
    "@/hooks/useOrderDirection",
  );
  return {
    ...actual,
    useOrderDirection: () => ({ direction: "outbound", labels: actual.partyLabels("outbound") }),
  };
});

import { InboxView, mapStatus, journeyStage, STATUS_PRESENTATION } from "./InboxView";
import { UploadWorkbench, recentStatusFromOrder } from "./UploadWorkbench";
import { UNKNOWN_STAGE_CAPTION, pipelineCardLine } from "./pipelineIndicator";
import { statusLabel } from "./UnifiedStatusBadge";

let seq = 0;
function order(over: Partial<OrderSummary> = {}): OrderSummary {
  seq += 1;
  return {
    id: `ord-${seq}`,
    poNumber: `PO-9900${seq}`,
    supplierId: "sup-1",
    supplierName: "BoltWorks BV",
    buyerName: "Heinrich Industries",
    orderDate: "2026-08-20T09:00:00Z",
    status: "pending_review",
    lineCount: 4,
    unresolvedCount: 0,
    totalValue: 1200,
    currency: "EUR",
    sourceFormat: "csv",
    createdAt: new Date(Date.now() - seq * 60_000).toISOString(),
    updatedAt: new Date().toISOString(),
    ...over,
  } as OrderSummary;
}

async function renderInbox(items: OrderSummary[]) {
  api.getOrders.mockResolvedValue({ items, totalCount: items.length, page: 1, pageSize: 25 });
  api.getOrdersSummary.mockResolvedValue({ byStatus: {}, total: items.length });
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

const SUPPLIER = { id: "sup-1", name: "BoltWorks BV", code: "BOLT", status: "active" } as Supplier;

async function renderUpload(items: OrderSummary[]) {
  api.getSuppliers.mockResolvedValue([SUPPLIER]);
  api.getOrders.mockResolvedValue({ items, totalCount: items.length, page: 1, pageSize: 100 });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <UploadWorkbench />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(api.getOrders).toHaveBeenCalled());
  return view;
}

beforeEach(() => {
  searchParams = new URLSearchParams();
  Object.values(api).forEach((fn) => fn.mockReset());
  api.detectFormat.mockReturnValue(new Promise(() => {}));
});
afterEach(cleanup);

describe("mapStatus sorts ignorance from a verdict", () => {
  it("sends an unrecognised status to the unknown bucket rather than to 'New'", () => {
    expect(mapStatus(ALIEN)).toBe("unknown");
    expect(mapStatus(ALIEN)).not.toBe("new");
  });

  it("the manifest names enough statuses for the walk below to mean something", () => {
    // Anti-vacuity: an empty or truncated ORDER_STATUSES would make the control pass by
    // iterating nothing, which is exactly how a coverage test stops covering anything.
    expect(ORDER_STATUSES.length).toBeGreaterThanOrEqual(16);
  });

  it.each([...ORDER_STATUSES])(
    "%s is a status this build knows, so it still reaches a decided bucket",
    (status) => {
      expect(
        mapStatus(status),
        `${status} is in the order-status manifest but mapStatus has no arm for it`,
      ).not.toBe("unknown");
    },
  );

  it("keeps pending_parse on 'New' — the one status that really does mean nothing has run", () => {
    // The arm the unknown default must not swallow. `pending_parse` genuinely means
    // queued-and-untouched, which is what stage 0 says.
    expect(mapStatus("pending_parse")).toBe("new");
    expect(journeyStage("new", "pending_parse")).toBe(0);
  });
});

describe("the unknown bucket makes no stage claim", () => {
  it("has no preset stage, and journeyStage answers null rather than a node", () => {
    expect(STATUS_PRESENTATION.unknown.stage).toBeNull();
    expect(journeyStage(mapStatus(ALIEN), ALIEN)).toBeNull();
  });

  it("still places a status it does know (control)", () => {
    expect(journeyStage(mapStatus("pending_review"), "pending_review")).toBe(2);
    expect(journeyStage(mapStatus("delivered"), "delivered")).toBe(4);
  });

  it("prints words instead of a step for a null stage, and a step for a real one", () => {
    expect(pipelineCardLine(null)).toBe(UNKNOWN_STAGE_CAPTION);
    expect(UNKNOWN_STAGE_CAPTION).not.toMatch(/\d/);
    // Control: the caption function has not simply started saying "unknown" everywhere.
    expect(pipelineCardLine(0)).toBe("Step 1 of 5 · Parse");
    expect(pipelineCardLine({ failed: 3 })).toBe("Failed at step 4 of 5 · Transform");
  });
});

describe("an inbox row for an unreadable status says so on both viewports", () => {
  it("renders the neutral caption twice — desktop cell and mobile card — and claims no step", async () => {
    const { container } = await renderInbox([
      order({ status: ALIEN as OrderSummary["status"], poNumber: "PO-99101" }),
    ]);
    await screen.findAllByText("PO-99101");

    // Both breakpoint trees mount under jsdom, so both must carry it.
    expect(screen.getAllByText(UNKNOWN_STAGE_CAPTION)).toHaveLength(2);

    // The defect, verbatim: stage 0 is the Parse node, and "New" is the word that goes
    // with it. Neither may appear for a status we cannot read.
    expect(screen.queryByText(/Step 1 of 5/)).toBeNull();
    expect(screen.queryByText("New")).toBeNull();

    // A stage CLAIM is marked with data-pipeline (role="img" + a "step n of 5" name).
    // An unknown row must carry the absence marker instead of an empty claim.
    expect(container.querySelector("[data-pipeline]")).toBeNull();
    const absence = container.querySelector<HTMLElement>("[data-pipeline-unknown]");
    expect(absence).not.toBeNull();
    expect(absence!.textContent).toBe(UNKNOWN_STAGE_CAPTION);

    // The row still identifies the order: the badge humanizes the raw status rather
    // than hiding it, so an operator can quote it to support.
    expect(screen.getAllByText(statusLabel(ALIEN)).length).toBeGreaterThan(0);
  });

  it("a status it DOES know still renders its decided label and step (control)", async () => {
    const { container } = await renderInbox([order({ status: "pending_review", poNumber: "PO-99102" })]);
    await screen.findAllByText("PO-99102");

    expect(screen.queryByText(UNKNOWN_STAGE_CAPTION)).toBeNull();
    // Mobile card prints the step in words; the desktop cell carries it as the
    // accessible name of the dot track.
    expect(screen.getAllByText("Step 3 of 5 · Validate").length).toBeGreaterThan(0);
    const claim = container.querySelector<HTMLElement>("[data-pipeline]");
    expect(claim).not.toBeNull();
    expect(claim!.getAttribute("role")).toBe("img");
    expect(claim!.getAttribute("aria-label")).toMatch(/Step 3 of 5: Validate/);
    expect(container.querySelector("[data-pipeline-unknown]")).toBeNull();
  });
});

describe("the upload page's recent-uploads pill", () => {
  it("tones an unrecognised status as unknown, not as a decided state", () => {
    expect(recentStatusFromOrder(ALIEN)).toBe("unknown");
  });

  it("still tones the statuses it knows (control)", () => {
    expect(recentStatusFromOrder("delivered")).toBe("done");
    expect(recentStatusFromOrder("pending_review")).toBe("review");
    expect(recentStatusFromOrder("delivery_failed")).toBe("failed");
  });

  it.each([...ORDER_STATUSES])("%s is not toned as an unreadable status", (status) => {
    expect(recentStatusFromOrder(status)).not.toBe("unknown");
  });

  it("names the order by its humanized status in both viewports rather than a decided word", async () => {
    await renderUpload([order({ status: ALIEN as OrderSummary["status"], poNumber: "PO-99201.csv" })]);
    const cards = await screen.findByTestId("recent-uploads-cards");
    const table = await screen.findByTestId("recent-uploads-table");

    // Scoped per tree: both mount under jsdom, so an unscoped query would be answering
    // about whichever one it hit first.
    for (const tree of [cards, table]) {
      expect(within(tree).getAllByText(statusLabel(ALIEN)).length).toBe(1);
      expect(within(tree).queryByText("Draft")).toBeNull();
    }
  });

  it("a status it knows still reads as itself on the upload page (control)", async () => {
    await renderUpload([order({ status: "delivered", poNumber: "PO-99202.csv" })]);
    const cards = await screen.findByTestId("recent-uploads-cards");
    const table = await screen.findByTestId("recent-uploads-table");
    for (const tree of [cards, table]) {
      expect(within(tree).getAllByText(statusLabel("delivered")).length).toBe(1);
    }
  });
});
