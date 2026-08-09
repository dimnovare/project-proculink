import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PassportDto } from "@/types/procurement";

// WP-39 §4.1 + §4.7 — the audit trail contradicted the API it was rendering.
//
// On a clean, successfully DELIVERED production order the trail rendered a green
// "✓ Validated" node labelled "3 validation issues", and a MAPPING DECISIONS row
// reading "1 — → unresolved" in red beside a DETERMINISTIC 100% chip — for a line the
// API reported as fully resolved.
//
// Two field-name drifts, one family. The frontend type declared `passed` and
// `buyerCode`/`supplierCode`; the API sends `status` and `buyerItemCode`/
// `supplierItemCode`. Every field on the type was optional, so the compiler saw
// nothing. `v.passed === false` was always false, leaving `severity` as the fallback —
// and severity says how loud a rule is WHEN it fails, not whether it failed. The
// producer stamps passing rows with the severity the rule would carry if it failed,
// on purpose, so that a rule-less order cannot show a vacuous green "Passed".
//
// An audit trail that calls a pass a problem is worse than no audit trail: the
// operator learns to ignore it, and then it cannot warn them about anything.
//
// The payloads below reproduce the production responses recorded in
// docs/qa/2026-08-01-wp-39-authenticated-production-pass.md §4.1 and §4.7 —
// field-for-field, with the commercial values replaced by placeholders.

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

/**
 * The four rows GET /api/orders/{id}/passport returns on a delivered, fully
 * passing order. The SHAPE is copied from a real response; the amounts and the
 * supplier code are de-identified placeholders.
 */
const PRODUCTION_ALL_PASS: PassportDto["validationResults"] = [
  { code: "invariant.quantity_positive", lineNumber: 1, message: "Line 1: quantity 2 is valid.", severity: "error", status: "pass" },
  { code: "invariant.unit_price_valid", lineNumber: 1, message: "Line 1: unit price 300.2 is valid.", severity: "warning", status: "pass" },
  { code: "invariant.po_number_present", lineNumber: null, message: "PO number is present.", severity: "error", status: "pass" },
  { code: "invariant.currency_present", lineNumber: null, message: "Currency is set (EUR).", severity: "error", status: "pass" },
];

/** The mapping decision the same passport carried — fully resolved, deterministic. */
const PRODUCTION_RESOLVED_MAPPING: PassportDto["mappingDecisions"] = [
  { lineNumber: 1, buyerItemCode: "00010", supplierItemCode: "EXSUP12345", source: "deterministic", confidence: 1 },
];

function passport(overrides: Partial<PassportDto> = {}): PassportDto {
  return {
    order: {
      id: ORDER_ID,
      poNumber: "WP39-QA-001",
      status: "delivered",
      supplierId: "sup-1",
      supplierName: "ProcuLink Sample Supplier",
      buyerName: "Acme",
      currency: "EUR",
      orderDate: "2026-08-01",
      createdAt: "2026-08-01T09:00:00Z",
      updatedAt: "2026-08-01T09:30:00Z",
      isSample: false,
    },
    sourceArtifact: { storageKey: `org/${ORDER_ID}/source.csv`, detectedFormat: "csv" },
    canonical: { lineCount: 1, currency: "EUR", totalValue: 600.4, totalQuantity: 2 },
    supplierProfile: null,
    validationResults: PRODUCTION_ALL_PASS,
    mappingDecisions: PRODUCTION_RESOLVED_MAPPING,
    manualCorrections: [],
    aiSuggestions: [],
    outputArtifact: null,
    deliveryAttempts: [],
    supplierResponse: null,
    finalStatus: "delivered",
    timeline: [],
    notes: [],
    ...overrides,
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

describe("audit trail — validation outcome (WP-39 §4.1)", () => {
  it("does not call four passing checks 'validation issues'", async () => {
    api.getOrderPassport.mockResolvedValue(passport());

    renderPassport();

    expect(await screen.findByText(/checks passed/i)).toBeTruthy();
    expect(screen.queryByText(/validation issue/i)).toBeNull();
  });

  it("says how many checks ran, so a clean order still shows the checks happened", async () => {
    api.getOrderPassport.mockResolvedValue(passport());

    renderPassport();

    // Not a bare "Validated" with nothing behind it: the producer emits a row per check
    // performed precisely so an order with no rules cannot look green for free.
    expect(await screen.findByText("4 checks passed")).toBeTruthy();
  });

  it("counts a genuine failure as an issue even at severity 'warning'", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({
        validationResults: [
          ...PRODUCTION_ALL_PASS,
          { code: "rule.description_length", lineNumber: 1, message: "Line 1: description is longer than 40 characters.", severity: "warning", status: "fail" },
        ],
      }),
    );

    renderPassport();

    // Severity is not the signal. A consumer filtering on severity === "error" would
    // have dropped this row entirely.
    expect(await screen.findByText("1 validation issue")).toBeTruthy();
    expect(screen.queryByText(/checks passed/i)).toBeNull();
  });

  it("pluralises issues", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({
        validationResults: [
          { code: "a", lineNumber: 1, message: "no", severity: "error", status: "fail" },
          { code: "b", lineNumber: 2, message: "no", severity: "error", status: "fail" },
        ],
      }),
    );

    renderPassport();

    expect(await screen.findByText("2 validation issues")).toBeTruthy();
  });

  it("shows nothing rather than a guess when no checks were recorded", async () => {
    api.getOrderPassport.mockResolvedValue(passport({ validationResults: [] }));

    renderPassport();

    expect(await screen.findByText("Validated")).toBeTruthy();
    expect(screen.queryByText(/checks passed/i)).toBeNull();
    expect(screen.queryByText(/validation issue/i)).toBeNull();
  });

  it("still flags a failing row from an API too old to send `status`", async () => {
    // Deploy-order safety. Frontend and backend ship separately; a build that reads
    // only `status` would report every row from an older API as a pass and hide a real
    // failure. Absent `status` falls back to severity — the pre-fix behaviour, which
    // over-reports rather than under-reports.
    api.getOrderPassport.mockResolvedValue(
      passport({
        validationResults: [
          { code: "legacy.rule", lineNumber: 1, message: "Line 1: quantity must be positive.", severity: "error" },
        ],
      }),
    );

    renderPassport();

    expect(await screen.findByText("1 validation issue")).toBeTruthy();
  });
});

describe("audit trail — mapping decisions (WP-39 §4.7)", () => {
  it("does not render a resolved supplier code as 'unresolved'", async () => {
    api.getOrderPassport.mockResolvedValue(passport());

    renderPassport();

    // Scoped to the code slot: the source badge beside it legitimately reads
    // "unresolved" on an unresolved line, so a bare text query cannot tell them apart.
    expect((await screen.findByTestId("mapping-supplier-code")).textContent).toBe("EXSUP12345");
  });

  it("renders the buyer code the API actually sent", async () => {
    api.getOrderPassport.mockResolvedValue(passport());

    renderPassport();

    expect((await screen.findByTestId("mapping-buyer-code")).textContent).toBe("00010");
  });

  it("still says 'unresolved' when the supplier code really is missing", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({
        mappingDecisions: [
          { lineNumber: 1, buyerItemCode: "00010", supplierItemCode: null, source: "unresolved", confidence: 0 },
        ],
      }),
    );

    renderPassport();

    expect((await screen.findByTestId("mapping-supplier-code")).textContent).toBe("unresolved");
  });
});
