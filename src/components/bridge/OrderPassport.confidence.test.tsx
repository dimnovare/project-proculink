import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PassportDto } from "@/types/procurement";

// The passport painted a fabricated 95% over a database lookup, and called it AI.
//
// `PassportMappingDecision.confidence` is projected from `PurchaseOrderLineEntity.Confidence`,
// which is only ever written from `AiSuggestionConfidence` when a reviewer accepts a suggestion.
// Ingestion was stamping a literal 0.95f onto that field for two DETERMINISTIC producers — an
// exact hit on the supplier's own catalog, and an echo of a manufacturer part number the source
// document prints — so accepting such a line promoted 0.95 into the confidence column and this
// screen printed a green "95%" under `aria-label="AI confidence 95%"`.
//
// The screen is the one place in the product whose entire job is to say how much to trust a code.
//
// `OrderPassport.tsx` carried a comment asserting "A number reaching here can now only be a real
// model confidence — which is why the accessible name is allowed to say so." That was the stated
// justification for the AI wording, and it was false when written. These tests hold the two halves
// apart: a deterministic decision must arrive with NO number, and a real model score must still
// render normally.

const api = {
  getOrderPassport: vi.fn(),
  getDownloadUrl: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    getOrderPassport: (...a: unknown[]) => api.getOrderPassport(...a),
    getDownloadUrl: (...a: unknown[]) => api.getDownloadUrl(...a),
  },
  ApiHttpError: class ApiHttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "ApiHttpError";
      this.status = status;
    }
  },
}));

import { OrderPassport } from "./OrderPassport";

const ORDER_ID = "b56ddb85-5b14-4367-bcc1-6f62a391a6a5";

function passport(mappingDecisions: PassportDto["mappingDecisions"]): PassportDto {
  return {
    order: {
      id: ORDER_ID,
      poNumber: "PO-CONF-001",
      status: "delivered",
      supplierId: "sup-1",
      supplierName: "Boltworks Components",
      buyerName: "Acme",
      currency: "EUR",
      orderDate: "2026-08-14",
      createdAt: "2026-08-14T09:00:00Z",
      updatedAt: "2026-08-14T09:30:00Z",
      isSample: false,
    },
    sourceArtifact: { storageKey: `org/${ORDER_ID}/source.xml`, detectedFormat: "cxml" },
    canonical: { lineCount: 1, currency: "EUR", totalValue: 600.4, totalQuantity: 2 },
    supplierProfile: null,
    validationResults: [],
    mappingDecisions,
    manualCorrections: [],
    aiSuggestions: [],
    outputArtifact: null,
    deliveryAttempts: [],
    supplierResponse: null,
    finalStatus: "delivered",
    timeline: [],
    notes: [],
  } as PassportDto;
}

function renderPassport() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OrderPassport orderId={ORDER_ID} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("order passport — a confidence is a measurement or it is absent", () => {
  it("a deterministically resolved line shows no percentage and makes no AI claim", async () => {
    // The shape the backend now sends for a line resolved by an exact catalog lookup: a real
    // supplier code, source 'deterministic', and NO confidence.
    api.getOrderPassport.mockResolvedValue(
      passport([
        {
          lineNumber: 1,
          buyerItemCode: "29954596",
          supplierItemCode: "FAB-SCAN-77120",
          source: "deterministic",
          confidence: null,
        },
      ]),
    );

    renderPassport();

    // The row really did render — otherwise the assertions below pass vacuously.
    expect(await screen.findByText("FAB-SCAN-77120")).toBeTruthy();

    // No percentage anywhere in the document. Deliberately a broad sweep rather than a query on
    // one node: the defect was a number appearing where none was earned, and it does not matter
    // which element carried it.
    expect(document.body.textContent).not.toMatch(/\d+%/);
    expect(document.body.textContent).not.toMatch(/95%/);

    // And no AI wording — checked separately, because the original defect lived in an ARIA
    // attribute that never appears in textContent. A textContent-only assertion would have passed
    // against the exact string it is supposed to stop.
    expect(screen.queryByLabelText(/AI confidence/i)).toBeNull();
    expect(document.querySelector('[aria-label*="AI confidence"]')).toBeNull();
  });

  it("an unresolved line shows no percentage either", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport([
        { lineNumber: 1, buyerItemCode: "29954596", supplierItemCode: null, source: "unresolved", confidence: null },
      ]),
    );

    renderPassport();

    // Scoped: "unresolved" is also the row's `source` badge text, so a bare text query matches
    // two nodes.
    const code = await screen.findByTestId("mapping-supplier-code");
    expect(code.textContent).toBe("unresolved");
    // This used to be a red 0% — "we are certain this is wrong" minted from an absence.
    expect(document.body.textContent).not.toMatch(/\d+%/);
    expect(document.querySelector('[aria-label*="AI confidence"]')).toBeNull();
  });

  it("CONTROL — a genuine model confidence still renders, and is still named as AI", async () => {
    // A line whose code came from an accepted model suggestion carries the model's real number.
    // The fix must remove fabricated numbers, not confidence reporting.
    api.getOrderPassport.mockResolvedValue(
      passport([
        {
          lineNumber: 1,
          buyerItemCode: "B-1",
          supplierItemCode: "SUP-FROM-MODEL",
          source: "ai",
          confidence: 0.82,
        },
      ]),
    );

    renderPassport();

    expect(await screen.findByText("SUP-FROM-MODEL")).toBeTruthy();
    expect(screen.getByLabelText("AI confidence 82%")).toBeTruthy();
    expect(document.body.textContent).toContain("82%");
  });
});
