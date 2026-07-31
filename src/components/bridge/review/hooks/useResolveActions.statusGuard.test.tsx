import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Order } from "@/types/procurement";
import type { PartyLabels } from "@/hooks/useOrderDirection";
import { useResolveActions } from "./useResolveActions";

// What the OPERATOR reads when WP-23's resolve status guard refuses a correction.
//
// Every action in this hook funnels its failure into `setFlow(err.message, "error")`, so
// whatever the api-client puts in `message` is literally the flow notice on screen. That
// makes this the test that a 409 hold reads as a sentence and not as a serialised body:
// the api-client is NOT mocked here, only `fetch` is, so the whole chain runs for real —
// HTTP 409 + `{ error, status }` → api-client unwrap → hook catch → flow notice.
//
// The two doors are tested separately because they are two different endpoints with two
// different error-handling branches in the client: manual/AI single-line resolution goes
// through POST /resolve, the bulk button through POST /accept-ai-suggestions.

const ORDER_ID = "0a2f7f1e-1c2b-4a55-9a70-9f0d1f4bd001";

const UNROUTED_SENTENCE =
  "This order is still waiting to be routed. Route it first, then make your corrections — "
  + "correcting it now would take it out of the routing queue while it still has nowhere to go.";

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

const ORDER: Order = {
  id: ORDER_ID,
  poNumber: "PO-1",
  supplierId: null,
  supplierName: null,
  buyerName: "Buyer Co",
  orderDate: "2026-07-31",
  currency: "EUR",
  status: "unrouted",
  createdAt: "2026-07-31T00:00:00Z",
  updatedAt: "2026-07-31T00:00:00Z",
  lines: [
    {
      id: "line-1",
      lineNumber: 1,
      buyerItemCode: "BUY-1",
      supplierItemCode: null,
      description: "Widget",
      quantity: 2,
      unitPrice: 10,
      confidence: 0.4,
      needsReview: true,
      aiSuggestion: {
        supplierItemCode: "SUP-1",
        confidence: 0.91,
        reason: "Matched on description",
        provenance: "ai",
      },
    },
  ],
  artifacts: [],
};

let fetchMock: ReturnType<typeof vi.fn>;

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

function holdResponse() {
  const body = JSON.stringify({ error: UNROUTED_SENTENCE, status: "unrouted" });
  return {
    ok: false,
    status: 409,
    statusText: "Conflict",
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  } as unknown as Response;
}

function setup() {
  const setFlow = vi.fn();
  const refetchOrder = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    () => useResolveActions({ orderId: ORDER_ID, order: ORDER, nodes: [], labels: LABELS, setFlow, refetchOrder }),
    { wrapper },
  );
  return { setFlow, hook };
}

/** The message the operator actually sees, from the last error-severity setFlow call. */
function lastErrorNotice(setFlow: ReturnType<typeof vi.fn>): string {
  const call = [...setFlow.mock.calls].reverse().find(c => c[1] === "error");
  return String(call?.[0] ?? "");
}

beforeEach(() => {
  (window as unknown as { Clerk: unknown }).Clerk = { loaded: true };
  fetchMock = vi.fn().mockResolvedValue(holdResponse());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

describe("useResolveActions — a WP-23 hold shows the sentence, not the response body", () => {
  it("shows the backend's sentence when accepting an AI suggestion is refused", async () => {
    const { setFlow, hook } = setup();

    act(() => hook.result.current.acceptSuggestion("line-1"));

    await waitFor(() => expect(lastErrorNotice(setFlow)).not.toBe(""));
    expect(lastErrorNotice(setFlow)).toBe(UNROUTED_SENTENCE);
    // The defect this freezes: `Resolution failed: {"error":"…","status":"unrouted"}`.
    expect(lastErrorNotice(setFlow)).not.toMatch(/[{}]/);
  });

  it("shows the backend's sentence when a hand-typed supplier code is refused", async () => {
    const { setFlow, hook } = setup();

    act(() => hook.result.current.startLineEdit("line-1", ""));
    act(() => hook.result.current.setLineDraft("SUP-1"));
    act(() => hook.result.current.commitLineCode("line-1"));

    await waitFor(() => expect(lastErrorNotice(setFlow)).not.toBe(""));
    expect(lastErrorNotice(setFlow)).toBe(UNROUTED_SENTENCE);
    // Never the generic fallback either — the backend said something more useful.
    expect(lastErrorNotice(setFlow)).not.toContain("Try again");
  });

  it("shows the backend's sentence when the bulk accept is refused", async () => {
    const { setFlow, hook } = setup();

    act(() => hook.result.current.bulkAcceptSuggestions(0));

    await waitFor(() => expect(lastErrorNotice(setFlow)).not.toBe(""));
    expect(lastErrorNotice(setFlow)).toBe(UNROUTED_SENTENCE);
    expect(lastErrorNotice(setFlow)).not.toMatch(/[{}]/);
    expect(lastErrorNotice(setFlow)).not.toContain("accept-ai-suggestions failed");
  });
});
