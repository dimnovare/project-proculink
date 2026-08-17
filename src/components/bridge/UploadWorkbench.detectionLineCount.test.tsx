/* ── "PO DO-4711 · 0 lines" — the sibling of the confidence defect ────────────
 *
 * THE DEFECT, VERBATIM (UploadWorkbench.tsx, one line from the chip that
 * UploadWorkbench.detectionConfidence.test.tsx already exists for):
 *
 *     PO {detection.detectedPoNumber} · {detection.estimatedLineCount ?? 0} lines
 *
 * `estimatedLineCount` is `number | null`, and null is what the backend sends
 * DELIBERATELY, not by omission:
 *
 *   • cXML / UBL — the detector peeks at the first 1 KiB. A document whose header
 *     runs past that peek is detected with certainty and counted not at all.
 *   • EDIFACT / X12 — never counted. There is no cheap line count in an interchange.
 *
 * `?? 0` turns "we did not count" into "we counted, and there are none", printed in
 * mono next to a PO number the detector DID read. An operator looking at a 40-line
 * order is told it has zero lines by the same pill that just correctly named its PO.
 *
 * Same failure mode as `confidence`, same file, and the fix that removed the
 * fabricated 95% walked straight past it.
 *
 * WHY BOTH A UNIT AND A DOM TEST. The helper alone would be a new function asserting
 * itself — it cannot fail against the old code because the old code had no helper.
 * The DOM case mounts the real screen and fails against the shipped JSX. jsdom applies
 * no Tailwind, so the detection pill's subtree is scoped by testid rather than read off
 * whole-body text.
 * ──────────────────────────────────────────────────────────────────────────── */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DetectFormatResult } from "@/lib/api-client";
import type { Supplier } from "@/types/procurement";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/upload",
  useSearchParams: () => new URLSearchParams(),
}));

const api = {
  getSuppliers: vi.fn(),
  getOrders: vi.fn(),
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
    getSuppliers: (...a: unknown[]) => api.getSuppliers(...a),
    getOrders: (...a: unknown[]) => api.getOrders(...a),
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

import { UploadWorkbench, detectionPoSummary } from "./UploadWorkbench";

function detection(over: Partial<DetectFormatResult>): DetectFormatResult {
  return {
    format: "cxml",
    confidence: null,
    basis: "magic_bytes",
    suggestedParser: "CxmlOrderParser",
    detectedPoNumber: "DO-4711",
    detectedSupplier: null,
    estimatedLineCount: null,
    reasoning: [],
    seenCount: null,
    ...over,
  };
}

const SUPPLIER: Supplier = { id: "sup-1", name: "BoltWorks BV", code: "BOLT", status: "active" } as Supplier;

/** Mount, choose a file, and let format detection resolve with `result`. */
async function mountWithDetection(result: DetectFormatResult): Promise<HTMLElement | null> {
  api.getSuppliers.mockResolvedValue([SUPPLIER]);
  api.getOrders.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 100 });
  api.detectFormat.mockResolvedValue(result);

  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UploadWorkbench />
    </QueryClientProvider>,
  );
  await waitFor(() => {
    if (!document.body.textContent?.includes(SUPPLIER.name)) throw new Error("suppliers not resolved");
  });

  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input rendered");
  await act(async () => {
    fireEvent.change(input, {
      target: { files: [new File(["<cXML/>"], "order.xml", { type: "application/xml" })] },
    });
  });
  await waitFor(() => {
    if (api.detectFormat.mock.calls.length === 0) throw new Error("detection was never requested");
  });
  return screen.queryByTestId("detection-po-summary");
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe("detection pill — an uncounted document is not a zero-line document", () => {
  it("prints no line clause at all when the backend counted nothing", async () => {
    // A cXML header past the 1 KiB peek: PO read, lines not counted.
    const pill = await mountWithDetection(detection({ estimatedLineCount: null }));

    // The floor first: a screen that rendered no pill would satisfy every negative below.
    expect(pill, "the detection pill did not render — the negatives below would be vacuous").not.toBeNull();
    expect(pill!.textContent).toContain("PO DO-4711");
    // The defect, stated as the assertion.
    expect(pill!.textContent).not.toContain("0 lines");
    expect(pill!.textContent).not.toMatch(/lines?/);
  });

  it("still prints a real count, including a real zero", async () => {
    // ANTI-VACUITY. The test above passes against a pill that says nothing about lines
    // ever. A counted document must still say how many — and a backend that says "I read
    // it and found no lines" is a measurement, not an absence, so 0 is printed.
    const counted = await mountWithDetection(detection({ estimatedLineCount: 42 }));
    expect(counted!.textContent).toContain("PO DO-4711 · 42 lines");

    cleanup();
    vi.clearAllMocks();

    const zero = await mountWithDetection(detection({ format: "csv", estimatedLineCount: 0 }));
    expect(zero!.textContent).toContain("0 lines");
  });
});

describe("detectionPoSummary — the pure derivation", () => {
  it("drops the clause for every shape that carries no count", () => {
    // The two shapes the backend really sends null for, plus the undefined an older
    // API response would arrive as.
    expect(detectionPoSummary(detection({ format: "cxml", estimatedLineCount: null }))).toBe("PO DO-4711");
    expect(detectionPoSummary(detection({ format: "edifact", estimatedLineCount: null }))).toBe("PO DO-4711");
    expect(
      detectionPoSummary(detection({ estimatedLineCount: undefined as unknown as number })),
    ).toBe("PO DO-4711");
  });

  it("keeps a counted document's count, and agrees on singular", () => {
    expect(detectionPoSummary(detection({ estimatedLineCount: 12 }))).toBe("PO DO-4711 · 12 lines");
    expect(detectionPoSummary(detection({ estimatedLineCount: 1 }))).toBe("PO DO-4711 · 1 line");
    expect(detectionPoSummary(detection({ estimatedLineCount: 0 }))).toBe("PO DO-4711 · 0 lines");
  });

  it("says nothing when there is no PO number to name", () => {
    expect(detectionPoSummary(detection({ detectedPoNumber: null }))).toBeNull();
    expect(detectionPoSummary(detection({ detectedPoNumber: "   " }))).toBeNull();
  });
});
