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

/**
 * A rule that COULD NOT RUN, shaped as backend PR 206 emits it.
 *
 * `line_amount_reconcile` on a CSV order: nine of the eleven line-producing parsers
 * never populate `LineAmount`, so the evaluator compared the computed amount against
 * itself and the rule was arithmetically incapable of rejecting anything. The
 * `message` is the backend's own sentence, from `AcceptanceMessages.ForNotEvaluated`.
 */
const NOT_EVALUATED_ROW: PassportDto["validationResults"][number] = {
  code: "rule.line_amount_reconcile",
  lineNumber: 1,
  message: "Line 1: not checked — this document didn't state a line amount to reconcile against.",
  severity: "warning",
  status: "not_evaluated",
};

/**
 * A status no build in this repo has ever heard of.
 *
 * Not a hypothetical: `not_evaluated` itself was one of these until backend PR 206, and
 * the frontend rendered it green. The next outcome the backend adds must not get the
 * same free pass on this screen's schedule.
 */
const UNRECOGNISED_ROW: PassportDto["validationResults"][number] = {
  code: "rule.some_future_operator",
  lineNumber: 2,
  message: "Line 2: something this build cannot interpret.",
  severity: "warning",
  status: "waived_by_operator",
};

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

  it("counts only the rows that passed, so a partial run cannot inflate the number", async () => {
    // The arithmetic the fix replaces was `rows.length`, which enrolled EVERY row that
    // was not a failure into the "checks passed" claim.
    api.getOrderPassport.mockResolvedValue(
      passport({
        validationResults: [
          ...PRODUCTION_ALL_PASS,                                   // 4 real passes
          NOT_EVALUATED_ROW,                                        // + 1 that never ran
        ],
      }),
    );

    renderPassport();

    // Four, not five.
    expect(await screen.findByText("4 checks passed · 1 not checked")).toBeTruthy();
    expect(screen.queryByText("5 checks passed")).toBeNull();
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

// ── The "Validated" node must be evidenced by a validation ──────────────────────
//
// `reached` is a high-water mark: evidence for a LATER stage drags every earlier node to
// "done". Nothing that raises it is a validation, and two ordinary orders reached this
// node without one — an order merely HOLDING an output artifact (`hasOutput` forces
// `reached >= 4`) and an order sitting in `pending_review` (rank 2). Both drew the green
// ✓ beside the word "Validated", and since `detail(2)` returns undefined for an empty
// `validationResults`, what rendered was a bare green "Validated" with nothing under it.
//
// The claim and the evidence were independent, which is the whole defect: the strongest
// mark on the timeline appeared on the orders the API had said least about.
//
// Asserted on the node's rendered text — the ✓ glyph an operator actually sees — not on
// the derivation. A test reading `stages[2].state` passes while the DOM shows the check.
const OUTPUT_ARTIFACT: PassportDto["outputArtifact"] = {
  artifactId: "art-1",
  format: "csv",
  fileKey: `org/${ORDER_ID}/out.csv`,
  createdAt: "2026-08-01T09:20:00Z",
  artifactSha256: null,
};

/** The ✓ the "done" state paints into the node's dot. */
function validatedNodeText(): string {
  return screen.getByTestId("timeline-node-validated").textContent ?? "";
}

describe("audit trail — the Validated node claims a check that ran", () => {
  it("does not mark Validated done just because a transform artifact exists", async () => {
    // An order that transformed and then failed to deliver, with no validation recorded.
    // Pre-fix: hasOutput → reached 4 → nodes 0..4 green, including this one.
    api.getOrderPassport.mockResolvedValue(
      passport({
        order: { ...passport().order, status: "delivery_failed" },
        finalStatus: "delivery_failed",
        outputArtifact: OUTPUT_ARTIFACT,
        validationResults: [],
      }),
    );

    renderPassport();

    await screen.findByTestId("timeline-node-validated");
    expect(validatedNodeText()).not.toContain("✓");
  });

  it("does not mark Validated done just because the order is in pending_review", async () => {
    // The second path, independent of the first: STATUS_RANK.pending_review is 2, and its
    // comment used to read "parsed + validated done".
    api.getOrderPassport.mockResolvedValue(
      passport({
        order: { ...passport().order, status: "pending_review" },
        finalStatus: "pending_review",
        outputArtifact: null,
        validationResults: [],
      }),
    );

    renderPassport();

    await screen.findByTestId("timeline-node-validated");
    expect(validatedNodeText()).not.toContain("✓");
  });

  it("says nothing under a Validated node it cannot evidence", async () => {
    // Not a bare green "Validated" AND not a fabricated count either.
    api.getOrderPassport.mockResolvedValue(
      passport({ outputArtifact: OUTPUT_ARTIFACT, validationResults: [] }),
    );

    renderPassport();

    await screen.findByTestId("timeline-node-validated");
    expect(document.body.textContent).toContain("Validated");
    expect(document.body.textContent).not.toContain("checks passed");
    expect(document.body.textContent).not.toContain("validation issue");
  });

  it("still marks Validated done when checks were actually recorded", async () => {
    // Anti-vacuity. A node that never goes green would satisfy every assertion above and
    // would have made the audit trail useless in the other direction.
    api.getOrderPassport.mockResolvedValue(
      passport({
        order: { ...passport().order, status: "pending_review" },
        finalStatus: "pending_review",
        validationResults: PRODUCTION_ALL_PASS,
      }),
    );

    renderPassport();

    await screen.findByTestId("timeline-node-validated");
    expect(validatedNodeText()).toContain("✓");
    expect(document.body.textContent).toContain("4 checks passed");
  });

  it("leaves the later stages alone — only the unevidenced node loses its check", async () => {
    // The fix must not un-do Transformed, which an output artifact really does evidence.
    api.getOrderPassport.mockResolvedValue(
      passport({ outputArtifact: OUTPUT_ARTIFACT, validationResults: [] }),
    );

    renderPassport();

    expect((await screen.findByTestId("timeline-node-transformed")).textContent).toContain("✓");
    expect(screen.getByTestId("timeline-node-delivered").textContent).toContain("✓");
  });
});

describe("audit trail — a check that could not run is not a check that passed", () => {
  // THE CONTROLS FOR THE DEFECT (pairs with backend PR 206).
  //
  // `validationRowFailed` returned `status === "fail"`, so EVERY value that was not
  // literally "fail" was counted into `${rows.length} checks passed`. When the backend
  // gained a third outcome for rules that could not run, that turned "we could not check
  // this" into a green tick on the passport — a fresh instance of exactly the defect the
  // third outcome was added to remove.
  //
  // Note what these feed: a `not_evaluated` row AND a status outside the union. A
  // control built from pass/fail rows alone goes green against the defective code and
  // proves nothing.
  //
  // Every assertion is SCOPED to the Validated node rather than to the document. jsdom
  // applies no Tailwind, so a `lg:hidden` and a `hidden lg:block` copy of a subtree both
  // mount here — an unscoped `document.body.textContent` check can be satisfied by a
  // tree the operator never sees at that width.
  async function validatedDetail(): Promise<string> {
    return (await screen.findByTestId("timeline-node-validated")).textContent ?? "";
  }

  it("does not count a not-evaluated rule as a check that passed", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({ validationResults: [NOT_EVALUATED_ROW] }),
    );

    renderPassport();

    // The one thing that must never render: a green claim over a rule that looked at
    // nothing. Before the fix this node read "1 checks passed".
    const detail = await validatedDetail();
    expect(detail).toContain("1 check not run");
    expect(detail).not.toContain("passed");
  });

  it("does not call a not-evaluated rule a failure either", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({ validationResults: [NOT_EVALUATED_ROW] }),
    );

    renderPassport();

    // The opposite over-correction, and the one api-client.ts made on the same field.
    // Nothing failed: the backend never blocks on this row.
    const detail = await validatedDetail();
    expect(detail).toContain("1 check not run");
    expect(detail).not.toContain("validation issue");
  });

  it("says how many checks did not run alongside the ones that did", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({ validationResults: [...PRODUCTION_ALL_PASS, NOT_EVALUATED_ROW] }),
    );

    renderPassport();

    expect(await validatedDetail()).toContain("4 checks passed · 1 not checked");
    // And exactly one node makes the claim — not a second copy in a hidden subtree.
    expect(screen.getAllByText("4 checks passed · 1 not checked")).toHaveLength(1);
  });

  it("keeps the not-run count visible next to a real failure", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({
        validationResults: [
          { code: "rule.qty", lineNumber: 1, message: "Line 1: quantity must be positive.", severity: "error", status: "fail" },
          NOT_EVALUATED_ROW,
        ],
      }),
    );

    renderPassport();

    // The failure still leads — but the operator is not told the remaining rule cleared.
    const detail = await validatedDetail();
    expect(detail).toContain("1 validation issue · 1 not checked");
    expect(detail).not.toContain("passed");
  });

  it("does not count a status outside the union as a check that passed", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({ validationResults: [...PRODUCTION_ALL_PASS, UNRECOGNISED_ROW] }),
    );

    renderPassport();

    // Four passes and one row nobody can read. It is surfaced as something to look at,
    // never folded into the pass count — "5 checks passed" is the failure mode.
    const detail = await validatedDetail();
    expect(detail).toContain("1 validation issue");
    expect(detail).not.toContain("passed");
  });

  it("does not silently drop a status outside the union", async () => {
    api.getOrderPassport.mockResolvedValue(
      passport({ validationResults: [UNRECOGNISED_ROW] }),
    );

    renderPassport();

    // Hiding it would be the other way to lie about it: the node would read as a clean
    // "Validated" with no evidence at all behind it.
    expect(await validatedDetail()).toContain("1 validation issue");
  });

  it("still reports a clean order cleanly — the fix does not tax the normal case", async () => {
    // The negative control. If this ever fails, the change has started treating ordinary
    // passes as suspect, which is its own kind of false claim.
    api.getOrderPassport.mockResolvedValue(passport());

    renderPassport();

    const detail = await validatedDetail();
    expect(detail).toContain("4 checks passed");
    expect(detail).not.toContain("not checked");
    expect(detail).not.toContain("not run");
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
