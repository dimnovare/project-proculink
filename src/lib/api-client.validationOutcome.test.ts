import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateOrder } from "@/lib/api-client";

// POST /api/orders/{id}/validate — the third outcome survives normalisation.
//
// This client used to collapse the row's outcome to `passed: r.status === "pass"`, and
// `OrderPassport.tsx` used to collapse the SAME field to `status === "fail"`. Two files
// reading one field, each inventing an answer for the half of the vocabulary it had not
// enumerated — and they landed on opposite answers:
//
//     api-client.ts:3018    not_evaluated → passed: false   (a failure)
//     OrderPassport.tsx:51  not_evaluated → not failed      (a pass)
//
// Nothing could catch the disagreement, because `OrderValidationResult.results[].passed`
// was a `boolean`: there was no shape in the type for a third answer to occupy.
// Backend PR 206 makes `not_evaluated` real — a rule whose input was absent, so nothing
// was examined — and this pairs with it.
//
// Every row fed below is either `not_evaluated` or a status outside the union. Rows of
// pass and fail alone reproduce nothing: the old code handled those two correctly.

const ORDER_ID = "9f1c0a44-6f2e-4b31-9d10-2c7e3b8a5f01";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // authHeader() polls for window.Clerk for up to 5s before giving up; a loaded stub
  // with no session short-circuits it to "no Authorization header".
  (window as unknown as { Clerk: unknown }).Clerk = { loaded: true };
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Clerk?: unknown }).Clerk;
});

/** The bare array of flat rows the endpoint returns. */
function respondWith(rows: Array<Record<string, unknown>>) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => rows,
    text: async () => JSON.stringify(rows),
  });
}

/** A rule that ran and cleared. */
const PASS_ROW = {
  lineNumber: 1, severity: "error", status: "pass",
  code: "invariant.quantity_positive", message: "Line 1: quantity 2 is valid.",
};

/**
 * `line_amount_reconcile` on an order whose document printed no line amount — the rule
 * compared the computed amount against itself and could not have rejected anything.
 * The message is the backend's, from `AcceptanceMessages.ForNotEvaluated`.
 */
const NOT_EVALUATED_ROW = {
  lineNumber: 1, severity: "warning", status: "not_evaluated",
  code: "rule.line_amount_reconcile",
  message: "Line 1: not checked — this document didn't state a line amount to reconcile against.",
};

/** A status this build has never heard of — the next outcome the backend adds. */
const UNRECOGNISED_ROW = {
  lineNumber: 2, severity: "warning", status: "waived_by_operator",
  code: "rule.some_future_operator", message: "Line 2: something this build cannot interpret.",
};

describe("validateOrder — `not_evaluated` is carried, not collapsed", () => {
  it("does not report a rule that could not run as a failure", async () => {
    respondWith([NOT_EVALUATED_ROW]);

    const result = await validateOrder(ORDER_ID);

    // The old line answered `passed: false` here, which reads as "this rule refused the
    // order". It did not: the backend's GetBlockingFailuresAsync skips this row.
    expect(result.results[0].outcome).toBe("not_evaluated");
  });

  it("does not report a rule that could not run as a pass", async () => {
    respondWith([NOT_EVALUATED_ROW]);

    const result = await validateOrder(ORDER_ID);

    // And the passport's old answer is refused too — this is the same field that read
    // as green on the audit trail.
    expect(result.results[0].outcome).not.toBe("pass");
  });

  it("keeps the backend's explanation, so a screen can say WHY it did not run", async () => {
    respondWith([NOT_EVALUATED_ROW]);

    const result = await validateOrder(ORDER_ID);

    expect(result.results[0].message).toContain("not checked");
    expect(result.results[0].message).toContain("didn't state a line amount");
  });

  it("will not call the ORDER passed when a rule could not run", async () => {
    respondWith([PASS_ROW, NOT_EVALUATED_ROW]);

    const result = await validateOrder(ORDER_ID);

    // "May I say this order cleared validation?" — no. One of its rules looked at
    // nothing, and the honest answer to a question about a check that did not happen
    // is not yes.
    expect(result.passed).toBe(false);
  });

  it("still reports a fully passing order as passed — the normal case is untaxed", async () => {
    // The negative control. Without it, `passed: false` everywhere would satisfy the
    // assertion above while breaking the screen.
    respondWith([PASS_ROW, { ...PASS_ROW, lineNumber: 2 }]);

    const result = await validateOrder(ORDER_ID);

    expect(result.passed).toBe(true);
    expect(result.results.map((r) => r.outcome)).toEqual(["pass", "pass"]);
  });

  it("still reports a real failure as a failure", async () => {
    respondWith([{ ...PASS_ROW, lineNumber: 2, status: "fail", message: "Line 2: quantity must be positive." }]);

    const result = await validateOrder(ORDER_ID);

    expect(result.results[0].outcome).toBe("fail");
    expect(result.passed).toBe(false);
  });
});

describe("validateOrder — a status outside the union is never a pass", () => {
  it("resolves an unknown status to `unrecognised`", async () => {
    respondWith([UNRECOGNISED_ROW]);

    const result = await validateOrder(ORDER_ID);

    expect(result.results[0].outcome).toBe("unrecognised");
  });

  it("does not let an unknown status claim the order passed", async () => {
    respondWith([PASS_ROW, UNRECOGNISED_ROW]);

    const result = await validateOrder(ORDER_ID);

    // `not_evaluated` was itself an unknown status until backend PR 206, and it rendered
    // green. The rule is that the NEXT one must not.
    expect(result.passed).toBe(false);
  });

  it("treats a missing status field the same way", async () => {
    respondWith([{ lineNumber: 1, severity: "error", code: "legacy.rule", message: "no status field" }]);

    const result = await validateOrder(ORDER_ID);

    expect(result.results[0].outcome).toBe("unrecognised");
    expect(result.passed).toBe(false);
  });

  it("still refuses to call an EMPTY result set a pass", async () => {
    // Pre-existing behaviour, re-pinned because the `passed` expression moved:
    // `[].every()` is vacuously true, which once reported a green "Passed" for an
    // order that was never checked at all.
    respondWith([]);

    const result = await validateOrder(ORDER_ID);

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(0);
  });
});
