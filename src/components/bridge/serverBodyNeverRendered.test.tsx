import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Order } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";
import { PRODUCTION_404_ERROR_MESSAGE } from "@/components/bridge/problem/__tests__/productionDefectStrings";

/**
 * The RENDER half of the server-body guard. Its companion, `src/lib/serverText.test.ts`, pins the
 * cleaning; this file pins that the screens actually do it.
 *
 * That split is the whole point. The reason this defect survived two fixes is that unit tests
 * pinned the sanitiser while nothing pinned that the render sites call it — deleting the call left
 * every unit test green. So each test below renders the REAL component and asserts on
 * `document.body.textContent`: what a person actually reads.
 *
 * These sites carry a different string from the one `ApiHttpError` now cleans at construction.
 * `order.errorMessage`, `deadLetterOrder.lastError` and `catalogSource.lastSyncError` arrive on a
 * 200, as persisted fields, and the backend concatenates the supplier's response body after its own
 * sentence ("Response summary: …"). They stay raw in the data layer on purpose — production logic
 * reads them, e.g. `problemCopy.isDeliveryConfigMissing` matches
 * `/delivery config(uration)? is missing/i` on `order.errorMessage` to decide whether to offer the
 * "add a delivery endpoint" arm — so they are cleaned where they become prose.
 *
 * FIXTURE DISCIPLINE. FE #98's post-mortem: an earlier render test set `errorMessage: null`, so the
 * fixture, not the code, was what passed. Every test here therefore asserts BOTH directions — the
 * markup is gone AND something from the message survived — so a fixture that stops carrying the
 * defect fails instead of passing quietly.
 */

// A real gateway page appended to a backend sentence: the exact shape production produced.
const APPENDED_HTML =
  "HTTP 502: the supplier endpoint returned an error. Response summary: " +
  "<!-- Tip: set Accept to application/json for errors in JSON. -->" +
  "<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head>" +
  "<body><center><h1>502 Bad Gateway</h1></center></body></html>";

function expectNoMarkupOnScreen() {
  const shown = document.body.textContent ?? "";
  expect(shown).not.toContain("<!DOCTYPE");
  expect(shown).not.toContain("<html");
  expect(shown).not.toContain("<head");
  expect(shown).not.toContain("<body");
  expect(shown).not.toContain("<!--");
  expect(shown).not.toContain("-->");
  expect(shown).not.toContain("<h1>");
  expect(shown).not.toContain("<center>");
  return shown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Family 1 — /operations/health: deadLetterOrder.lastError, and the requeue
// mutation's ApiHttpError.message.
// ─────────────────────────────────────────────────────────────────────────────

const HEALTH = {
  parsingStuck: 0, deliveringStuck: 0, transformFailed: 0, deliveryFailed: 0,
  deliveryDeadLetter: 1, rejectedBySupplier: 0, failed: 0, slaBreached: 0,
  openExceptions: 0, pendingReview: 0, deliveryHeld: 0, stuckThresholdMinutes: 30,
  totalProblemOrders: 1, workerHealthy: true, activeWorkers: 1,
  lastWorkerHeartbeatUtc: "2026-08-06T09:00:00Z", secondsSinceWorkerHeartbeat: 4,
};

const opsApi = vi.hoisted(() => ({
  getOpsHealth: vi.fn(),
  getDeadLetterOrders: vi.fn(),
  requeueDelivery: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/operations/health",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getOpsHealth: (...a: unknown[]) => opsApi.getOpsHealth(...a),
    getDeadLetterOrders: (...a: unknown[]) => opsApi.getDeadLetterOrders(...a),
    requeueDelivery: (...a: unknown[]) => opsApi.requeueDelivery(...a),
    apiClient: { ...actual.apiClient, getOrderById: vi.fn() },
  };
});

import OperationsHealthPage from "@/app/(app)/operations/health/page";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OperationsHealthPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  opsApi.getOpsHealth.mockResolvedValue(HEALTH);
  opsApi.getDeadLetterOrders.mockResolvedValue([]);
  opsApi.requeueDelivery.mockReset();
});
afterEach(cleanup);

describe("/operations/health — the dead-letter row's lastError", () => {
  it("shows the reason without the supplier's markup", async () => {
    opsApi.getDeadLetterOrders.mockResolvedValue([
      {
        orderId: "ord-dl-1",
        poNumber: "PO-4091678643",
        supplierName: "ProcuLink Sample Supplier",
        status: "delivery_dead_letter",
        deliveryAttempts: 3,
        // NOT null. The fixture must carry the defect or this test proves nothing.
        lastError: APPENDED_HTML,
        lastResponseCode: 502,
        lastAttemptAt: "2026-08-06T09:00:00Z",
      },
    ]);

    renderPage();
    await screen.findAllByText("PO-4091678643");

    const shown = expectNoMarkupOnScreen();
    // Anti-vacuity: the field really reached the screen, cleaned rather than dropped.
    expect(shown).toContain("HTTP 502");
  });

  it("does not smuggle the markup through the cell's title tooltip", async () => {
    // The desktop cell sets `title={o.lastError}` for the truncated text. A tooltip is prose the
    // operator reads too, and it is invisible to `document.body.textContent`.
    opsApi.getDeadLetterOrders.mockResolvedValue([
      {
        orderId: "ord-dl-2", poNumber: "PO-TOOLTIP", supplierName: "S",
        status: "delivery_dead_letter", deliveryAttempts: 3,
        lastError: APPENDED_HTML, lastResponseCode: 502,
        lastAttemptAt: "2026-08-06T09:00:00Z",
      },
    ]);

    renderPage();
    await screen.findAllByText("PO-TOOLTIP");

    const titles = Array.from(document.querySelectorAll("[title]"))
      .map((n) => n.getAttribute("title") ?? "")
      .join(" ");
    expect(titles).not.toContain("<!DOCTYPE");
    expect(titles).not.toContain("<html");
    expect(titles).toContain("HTTP 502");
  });
});

describe("/operations/health — a requeue that fails with a gateway page", () => {
  it("puts the cleaned reason in the notice, not the page source", async () => {
    const { ApiHttpError } = await import("@/lib/api/core");
    opsApi.getDeadLetterOrders.mockResolvedValue([
      {
        orderId: "ord-dl-3", poNumber: "PO-REQUEUE", supplierName: "S",
        status: "delivery_dead_letter", deliveryAttempts: 3,
        lastError: "Connection timed out", lastResponseCode: null,
        lastAttemptAt: "2026-08-06T09:00:00Z",
      },
    ]);
    // Built exactly as api-client builds it — the prefix is client copy, the tail is the body.
    opsApi.requeueDelivery.mockRejectedValue(
      new ApiHttpError(`requeue-delivery failed: ${APPENDED_HTML}`, 502),
    );

    renderPage();
    const buttons = await screen.findAllByRole("button", { name: /start sending again/i });
    fireEvent.click(buttons[0]);

    await waitFor(() => expect(document.body.textContent).toContain("requeue-delivery failed"));
    const shown = expectNoMarkupOnScreen();
    expect(shown).toContain("502");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 2 — ExceptionDetail: order.errorMessage, standalone and via deliveryNote.
// ─────────────────────────────────────────────────────────────────────────────

describe("ExceptionDetail — order.errorMessage", () => {
  async function renderException(order: Partial<Order>) {
    const { apiClient } = await import("@/lib/api-client");
    (apiClient.getOrderById as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ord-1", poNumber: "PO-1", supplierId: "sup-1", supplierName: "S",
      currency: "EUR", orderDate: "2026-08-01", lines: [], artifacts: [],
      status: "delivery_failed",
      ...order,
    });
    const { ExceptionDetail } = await import("@/components/bridge/ExceptionDetail");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ExceptionDetail
          exc={{ id: "exc-1", orderId: "ord-1", code: "delivery_failed", stage: "deliver", message: "Delivery failed" } as never}
        />
      </QueryClientProvider>,
    );
  }

  it("renders the reason block without markup", async () => {
    await renderException({ status: "delivery_failed", errorMessage: APPENDED_HTML });
    await waitFor(() => expect(document.body.textContent).toContain("HTTP 502"));
    expectNoMarkupOnScreen();
  });

  it("cleans the delivery_unconfirmed note, which renders errorMessage as its whole sentence", async () => {
    await renderException({ status: "delivery_unconfirmed", errorMessage: APPENDED_HTML });
    await waitFor(() => expect(document.body.textContent).toContain("HTTP 502"));
    expectNoMarkupOnScreen();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 3 — OrderDetailsDrawer: the rejection block's errorMessage.
// ─────────────────────────────────────────────────────────────────────────────

describe("OrderDetailsDrawer — the rejection reason", () => {
  it("shows the supplier's refusal without their error page", async () => {
    const { OrderDetailsDrawer } = await import("@/components/bridge/workshop/OrderDetailsDrawer");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <OrderDetailsDrawer
          open
          onClose={() => {}}
          tab="response"
          onTab={() => {}}
          orderId="ord-1"
          poNumber="PO-1"
          supplierName="Nordmark"
          currency="EUR"
          status="rejected_by_supplier"
          errorMessage={PRODUCTION_404_ERROR_MESSAGE}
          counterpartyNoun="supplier"
        />
      </QueryClientProvider>,
    );

    await waitFor(() => expect(document.body.textContent).toContain("HTTP 404"));
    const shown = expectNoMarkupOnScreen();
    expect(shown).not.toContain("Response summary:");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 4 — the send flow's notice. finalDeliveryMessage interpolates
// order.errorMessage into a sentence, so a whole document lands mid-prose.
// Driven through the real useSendFlow, not by calling the formatter directly.
// ─────────────────────────────────────────────────────────────────────────────

const flowApi = vi.hoisted(() => ({
  getOrderById: vi.fn(),
  transformOrder: vi.fn(),
  redeliverOrder: vi.fn(),
  markDelivered: vi.fn(),
  getOrderAudit: vi.fn(),
}));

vi.mock("@/hooks/useProcessingStatus", () => ({
  useProcessingStatus: () => ({ paused: false, lastSeen: null }),
}));

const LABELS: PartyLabels = {
  counterpartyNoun: "Supplier",
  counterpartyPlural: "Suppliers",
  railHeader: "Supplier",
  primaryCta: "Send to supplier",
  primaryCtaProgress: "Sending…",
  doneLabel: "Sent",
  deliveredLabel: "Delivered to supplier",
  unknownBuyer: "Unknown buyer",
};

describe("the send flow's notice — finalDeliveryMessage", () => {
  it("never interpolates a whole HTML document into 'We couldn't send this order: …'", async () => {
    const { finalDeliveryMessage } = await import("@/components/bridge/review/hooks/useOrderReview");
    const msg = finalDeliveryMessage("delivery_failed", APPENDED_HTML, LABELS);

    expect(msg).toContain("We couldn't send this order:");
    expect(msg).toContain("HTTP 502");
    expect(msg).not.toContain("<!DOCTYPE");
    expect(msg).not.toContain("<html");
    expect(msg).not.toContain("<!--");
  });

  it("falls back to written copy when the body cleans to nothing", async () => {
    const { finalDeliveryMessage } = await import("@/components/bridge/review/hooks/useOrderReview");
    const msg = finalDeliveryMessage("delivery_failed", "<html><head></head><body></body></html>", LABELS);
    expect(msg).not.toContain("<");
    // The reason-free branch, verbatim — a colon with nothing after it reads as a broken screen.
    expect(msg).toContain("Check the supplier's Delivery tab");
  });

  it("cleans the rejection sentence too", async () => {
    const { finalDeliveryMessage } = await import("@/components/bridge/review/hooks/useOrderReview");
    const msg = finalDeliveryMessage("rejected_by_supplier", PRODUCTION_404_ERROR_MESSAGE, LABELS);
    expect(msg).toContain("Supplier rejected the order:");
    expect(msg).toContain("HTTP 404");
    expect(msg).not.toContain("<!DOCTYPE");
  });

  it("cleans the parked delivery_unconfirmed sentence, which is errorMessage alone", async () => {
    const { finalDeliveryMessage } = await import("@/components/bridge/review/hooks/useOrderReview");
    const msg = finalDeliveryMessage("delivery_unconfirmed", APPENDED_HTML, LABELS);
    expect(msg).not.toContain("<!DOCTYPE");
    expect(msg).toContain("HTTP 502");
  });

  it("reaches the flow notice through the real hook, not only the formatter", async () => {
    // The wiring, not the unit: a send whose order comes back delivery_failed with a markup
    // errorMessage must produce a clean notice string from useSendFlow itself.
    vi.doMock("@/lib/api-client", () => ({
      apiClient: {
        getOrderById: (...a: unknown[]) => flowApi.getOrderById(...a),
        transformOrder: (...a: unknown[]) => flowApi.transformOrder(...a),
        redeliverOrder: (...a: unknown[]) => flowApi.redeliverOrder(...a),
        markDelivered: (...a: unknown[]) => flowApi.markDelivered(...a),
        getOrderAudit: (...a: unknown[]) => flowApi.getOrderAudit(...a),
      },
    }));
    vi.resetModules();
    const { useSendFlow } = await import("@/components/bridge/review/hooks/useSendFlow");

    const failed = {
      id: "ord-1", poNumber: "PO-1", supplierId: "sup-1", supplierName: "Acme",
      orderDate: "2026-08-01", currency: "EUR", status: "delivery_failed",
      createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
      lines: [], artifacts: [{ id: "a1", format: "cxml", fileKey: "k", createdAt: "x" }],
      errorMessage: APPENDED_HTML,
    } as unknown as Order;

    flowApi.transformOrder.mockResolvedValue({ artifactId: "a1", format: "cxml", createdAt: "x" });
    flowApi.getOrderById.mockResolvedValue(failed);

    const { result } = renderHook(() =>
      useSendFlow({
        orderId: "ord-1",
        order: failed,
        exceptionCount: 0,
        refetchOrder: vi.fn().mockResolvedValue(undefined),
        labels: LABELS,
      } as never),
    );

    await act(async () => {
      await result.current.confirmSend();
    });

    const notice = result.current.flowNotice ?? "";
    expect(notice).not.toContain("<!DOCTYPE");
    expect(notice).not.toContain("<html");
    expect(notice).toContain("HTTP 502");
    vi.doUnmock("@/lib/api-client");
  });

  it("cleans the transform_failed notice, which is its own branch in useSendFlow", async () => {
    // Found by mutation, not by reading: reverting this branch to `current.errorMessage ??` left
    // every other test in this file green. A branch with no test is a branch that will be
    // reverted by the next refactor, which is how this defect class keeps coming back.
    vi.doMock("@/lib/api-client", () => ({
      apiClient: {
        getOrderById: (...a: unknown[]) => flowApi.getOrderById(...a),
        transformOrder: (...a: unknown[]) => flowApi.transformOrder(...a),
        redeliverOrder: (...a: unknown[]) => flowApi.redeliverOrder(...a),
        markDelivered: (...a: unknown[]) => flowApi.markDelivered(...a),
        getOrderAudit: (...a: unknown[]) => flowApi.getOrderAudit(...a),
      },
    }));
    vi.resetModules();
    const { useSendFlow } = await import("@/components/bridge/review/hooks/useSendFlow");

    // No artifacts and not ready_to_deliver — the only way into the transform arm.
    const pending = {
      id: "ord-2", poNumber: "PO-2", supplierId: "sup-1", supplierName: "Acme",
      orderDate: "2026-08-01", currency: "EUR", status: "pending_review",
      createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z",
      lines: [], artifacts: [], errorMessage: null,
    } as unknown as Order;

    flowApi.transformOrder.mockResolvedValue({ artifactId: "", format: "cxml", createdAt: "x" });
    flowApi.getOrderById.mockResolvedValue({
      ...pending,
      status: "transform_failed",
      errorMessage: APPENDED_HTML,
    });

    const { result } = renderHook(() =>
      useSendFlow({
        orderId: "ord-2",
        order: pending,
        exceptionCount: 0,
        refetchOrder: vi.fn().mockResolvedValue(undefined),
        labels: LABELS,
      } as never),
    );

    await act(async () => {
      await result.current.confirmSend();
    });

    const notice = result.current.flowNotice ?? "";
    expect(notice).not.toContain("<!DOCTYPE");
    expect(notice).not.toContain("<html");
    expect(notice).not.toContain("<!--");
    // Anti-vacuity: the branch really ran and really carried the field.
    expect(notice).toContain("HTTP 502");
    vi.doUnmock("@/lib/api-client");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Family 5 — the catalog source's lastSyncError, interpolated the same way.
// ─────────────────────────────────────────────────────────────────────────────

describe("formatLastSync — catalogSource.lastSyncError", () => {
  it("does not interpolate a fetched error page into 'Last sync failed: …'", async () => {
    const { formatLastSync } = await import("@/components/bridge/catalogSourceHelpers");
    const line = formatLastSync({
      lastSyncStatus: "failed",
      lastSyncAt: "2026-08-06T09:00:00Z",
      lastSyncError: APPENDED_HTML,
    } as never);

    expect(line.text).not.toContain("<!DOCTYPE");
    expect(line.text).not.toContain("<html");
    expect(line.text).toContain("HTTP 502");
  });

  it("still says only 'Last sync failed' when nothing legible came back", async () => {
    const { formatLastSync } = await import("@/components/bridge/catalogSourceHelpers");
    const line = formatLastSync({
      lastSyncStatus: "failed",
      lastSyncAt: "2026-08-06T09:00:00Z",
      lastSyncError: "<html><head></head><body></body></html>",
    } as never);
    expect(line.text).toBe("Last sync failed");
  });
});
