// Download leads where downloading cannot send: a review-before-delivery supplier (Automatic
// delivery off) or a "manual" one. Harness mirrors confirmDeliveryCheck.test.tsx; the header
// bar is rendered by OrderWorkshop itself (MobileTriage is stubbed), so this is one tree.

import { describe, test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Order } from "@/types/procurement";
import type { DeliveryConfig } from "@/lib/api/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: {
      counterpartyNoun: "Supplier",
      primaryCta: "Send to supplier",
      primaryCtaProgress: "Sending…",
      doneLabel: "Sent",
      deliveredLabel: "Delivered to supplier",
    },
  }),
}));
const calls: string[] = [];
const resolvePurchaseOrder = vi.fn(async () => { calls.push("resolve"); });
const transformOrder = vi.fn(async () => { calls.push("transform"); });
const markDelivered = vi.fn(async () => {});
vi.mock("@/lib/api-client", () => ({
  apiClient: {
    resolvePurchaseOrder: (...a: unknown[]) => (resolvePurchaseOrder as (...x: unknown[]) => unknown)(...a),
    transformOrder: (...a: unknown[]) => (transformOrder as (...x: unknown[]) => unknown)(...a),
    markDelivered: (...a: unknown[]) => (markDelivered as (...x: unknown[]) => unknown)(...a),
    getOrderById: vi.fn().mockResolvedValue({ id: "ord-1", status: "transform_failed", artifacts: [] }),
    getAiCalibration: vi.fn().mockResolvedValue({ isActive: false, buckets: [] }),
    getOrderAudit: vi.fn().mockResolvedValue([]),
    getOnboardingStatus: vi.fn().mockResolvedValue({ hasSupplier: true, hasUpload: true, hasDelivery: false }),
  },
  getMappingOverride: vi.fn().mockResolvedValue(null),
  previewMappingOverride: vi.fn().mockResolvedValue({ content: "", error: null }),
  validateOrder: vi.fn().mockResolvedValue({ orderId: "ord-1", passed: true, results: [] }),
}));
vi.mock("@/lib/api/acceptance-gate", () => ({
  getAcceptanceGate: vi.fn(() =>
    Promise.resolve({ blocked: false, reason: null, overridden: false, overriddenBy: null, overrideReason: null, blockers: [] }),
  ),
}));
const getDeliveryConfigMock = vi.fn<(supplierId: string) => Promise<DeliveryConfig | null>>();
vi.mock("@/lib/api/delivery", () => ({ getDeliveryConfig: (id: string) => getDeliveryConfigMock(id) }));
vi.mock("../../review/CatalogHintCard", () => ({ CatalogHintCard: () => <div /> }));

const mockState: { order: Order | null } = { order: null };
vi.mock("../../review/hooks/useOrderReview", () => ({
  useOrderReview: () => ({
    order: mockState.order,
    isLoading: false,
    isError: false,
    refetchOrder: vi.fn().mockResolvedValue(undefined),
    exceptionCount: 0,
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
    acceptSuggestion: vi.fn(), commitVersion: 0, lineEditId: null, lineDraft: "", setLineDraft: vi.fn(),
    startLineEdit: vi.fn(), commitLineCode: vi.fn(), cancelLineEdit: vi.fn(), confirmFlaggedLine: vi.fn(),
    acceptingLineId: null, bulkAcceptSuggestions: vi.fn(), bulkAccepting: false,
  }),
}));
vi.mock("../../mapper/MapperWorkbench", () => ({
  MapperWorkbench: (props: Record<string, unknown>) => <div>{props.issuesSlot as ReactNode}</div>,
}));
vi.mock("../MobileTriage", () => ({ MobileTriage: () => <div /> }));

import { OrderWorkshop } from "../OrderWorkshop";

function config(over: Partial<DeliveryConfig>): DeliveryConfig {
  return {
    supplierId: "sup-1", protocol: "email", autoDeliver: false, configJson: "{}", outputFormat: "csv",
    hasCredentials: false, createdAt: "2026-08-01T00:00:00Z", updatedAt: "2026-08-01T00:00:00Z", ...over,
  };
}

function renderWorkshop(cfg: DeliveryConfig, status = "pending_review") {
  getDeliveryConfigMock.mockResolvedValue(cfg);
  mockState.order = {
    id: "ord-1", poNumber: "PO-1", supplierId: "sup-1", supplierName: "Acme", buyerName: "Buyer Co",
    orderDate: "2026-06-18", currency: "EUR", status,
    createdAt: "2026-06-18T00:00:00Z", updatedAt: "2026-06-18T00:00:00Z", artifacts: [],
    lines: [{ id: "l-1", lineNumber: 1, description: "Widget", quantity: 2, unitPrice: 10, supplierItemCode: "ACM-1", buyerItemCode: "B-1", needsReview: false }],
  } as unknown as Order;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <OrderWorkshop orderId="ord-1" />
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe("review bar: download first where downloading cannot send", () => {
  test("download is the primary action and send is secondary", async () => {
    renderWorkshop(config({ protocol: "email", autoDeliver: false }));

    const download = await screen.findByRole("button", { name: "Download" });
    const send = screen.getByRole("button", { name: /^Send to supplier/ });
    // Download comes first and carries the filled primary treatment; Send is the outlined one.
    expect(download.compareDocumentPosition(send) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(download.dataset.ctaWeight).toBe("primary");
    expect(send.dataset.ctaWeight).toBe("secondary");
  });

  test("a manual supplier gets Download and no Send at all", async () => {
    renderWorkshop(config({ protocol: "manual" as DeliveryConfig["protocol"], autoDeliver: true }));

    await screen.findByRole("button", { name: "Download" });
    expect(screen.queryByRole("button", { name: /Send to supplier/ })).toBeNull();
    // Not built yet, so nothing to mark as sent.
    expect(screen.queryByRole("button", { name: "Mark as sent" })).toBeNull();
  });

  test("a manual supplier's ready order can be marked as sent", async () => {
    renderWorkshop(config({ protocol: "manual" as DeliveryConfig["protocol"] }), "ready_to_deliver");

    fireEvent.click(await screen.findByRole("button", { name: "Mark as sent" }));

    await waitFor(() => expect(markDelivered).toHaveBeenCalledWith("ord-1"));
  });

  test("downloading an unbuilt, unheld order holds it before the transform", async () => {
    renderWorkshop(config({ protocol: "email", autoDeliver: false }));

    fireEvent.click(await screen.findByRole("button", { name: "Download" }));

    await waitFor(() => expect(transformOrder).toHaveBeenCalled());
    expect(resolvePurchaseOrder).toHaveBeenCalledWith("ord-1", expect.objectContaining({ holdForReview: true }));
    expect(calls).toEqual(["resolve", "transform"]);
  });
});
