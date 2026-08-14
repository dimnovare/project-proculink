// The send-confirmation dialog is the consent step for an irreversible action,
// and its checkbox label used to open with "Everything checks out."
//
// That was false twice over.
//
//   (a) It was computed from `exceptionCount` alone. The dialog's own prop doc
//       for `failingRuleCount` says the value is "0 if it passed or wasn't run",
//       and nothing in `src/` calls POST /api/orders/{id}/validate — so a zero
//       there means "we never asked", and the sentence reported a verdict on a
//       check that had not run.
//
//   (b) THE CONTRADICTION. Because the ternary ignored `failingRuleCount`
//       entirely, an order with zero exceptions and N failed acceptance rules
//       rendered "Everything checks out." at the checkbox AND
//       "N acceptance rules failed validation" in the panel eighteen lines
//       below — both on screen, at once, in the same dialog.
//
// Fixing only the wording would have left (b) intact, so the contradiction case
// is pinned here explicitly: the clean-bill sentence must be gone AND the
// warning panel must still render.
//
// Every assertion below reads the rendered DOM (`document.body.textContent`).
// A test that reads the props passes while the dialog says something else.

import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ConfirmDialog } from "./ConfirmDialog";
import type { PartyLabels } from "@/hooks/useOrderDirection";

const OUTBOUND: PartyLabels = {
  counterpartyNoun: "Supplier",
  counterpartyPlural: "Suppliers",
  railHeader: "Supplier",
  primaryCta: "Send to supplier",
  primaryCtaProgress: "Sending…",
  doneLabel: "Sent",
  deliveredLabel: "Delivered",
  unknownBuyer: "Unknown buyer",
};

const INBOUND: PartyLabels = {
  ...OUTBOUND,
  counterpartyNoun: "Customer",
  counterpartyPlural: "Customers",
  railHeader: "Customer",
  primaryCta: "Confirm order",
};

function renderDialog(over: { exceptionCount?: number; failingRuleCount?: number; labels?: PartyLabels } = {}) {
  return render(
    <ConfirmDialog
      exceptionCount={over.exceptionCount ?? 0}
      failingRuleCount={over.failingRuleCount ?? 0}
      onConfirm={() => {}}
      onCancel={() => {}}
      supplierName="BoltWorks BV"
      outputFormat="csv"
      grandTotal="EUR 1,200.00"
      lineCount={4}
      labels={over.labels ?? OUTBOUND}
    />,
  );
}

/** The label element the checkbox is bound to — the sentence under test. */
const ackLabel = () => document.querySelector('label[for="confirm-check"]')!;

afterEach(cleanup);

describe("the send confirmation never reports a verdict it has no evidence for", () => {
  it("a clean order names the issue list it read, not the order as a whole", () => {
    renderDialog({ exceptionCount: 0, failingRuleCount: 0 });
    expect(document.body.textContent).toContain("No open issues to review. Send to BoltWorks BV.");
    expect(document.body.textContent).not.toMatch(/everything checks out/i);
  });

  it("still asks the operator to affirm the issues they reviewed", () => {
    // Anti-vacuity for the case above: if the label had simply been deleted, the
    // "not everything checks out" assertions would all pass for the wrong reason.
    renderDialog({ exceptionCount: 3, failingRuleCount: 0 });
    expect(document.body.textContent).toContain("I've reviewed the 3 issues. Send to BoltWorks BV.");
    expect(ackLabel().textContent).toContain("3 issues");
  });

  it("uses singular grammar for one issue", () => {
    renderDialog({ exceptionCount: 1, failingRuleCount: 0 });
    expect(document.body.textContent).toContain("I've reviewed the 1 issue. Send to BoltWorks BV.");
  });

  it("routes the direction, so an inbound order reads Confirm and never Send", () => {
    renderDialog({ exceptionCount: 0, failingRuleCount: 0, labels: INBOUND });
    expect(ackLabel().textContent).toBe("No open issues to review. Confirm for BoltWorks BV.");
  });
});

describe("THE CONTRADICTION: zero exceptions with failing acceptance rules", () => {
  it("does not render a clean bill beside its own failed-rules warning", () => {
    renderDialog({ exceptionCount: 0, failingRuleCount: 2 });
    const body = document.body.textContent ?? "";

    // 1. The false sentence is gone.
    expect(body).not.toMatch(/everything checks out/i);
    // 2. …and so is the replacement, which would be just as wrong here: two
    //    acceptance rules failed, so "no open issues to review" is not true either.
    expect(body).not.toMatch(/no open issues/i);
    // 3. The checkbox still has a usable label — it states the action, nothing more.
    expect(ackLabel().textContent).toBe("Send to BoltWorks BV.");

    // 4. THE OTHER HALF OF THE DEFECT. The warning that used to sit eighteen
    //    lines under "Everything checks out." must still be on screen; a fix
    //    that silenced it would pass assertions 1-3 and be worse than the bug.
    expect(body).toContain("2 acceptance rules failed validation");
    expect(screen.getByLabelText(/Send anyway/)).toBeTruthy();
  });

  it("keeps the reviewed-issues wording when BOTH counts are non-zero", () => {
    // Exceptions still get their acknowledgement; the rules panel adds its own.
    renderDialog({ exceptionCount: 2, failingRuleCount: 1 });
    const body = document.body.textContent ?? "";
    expect(ackLabel().textContent).toBe("I've reviewed the 2 issues. Send to BoltWorks BV.");
    expect(body).not.toMatch(/everything checks out/i);
    expect(body).toContain("1 acceptance rule failed validation");
  });

  it("renders no failed-rules panel at all when no rule failed", () => {
    // Anti-vacuity for assertion 4: the panel is conditional, so a run where it
    // never renders must be distinguishable from one where it does.
    renderDialog({ exceptionCount: 0, failingRuleCount: 0 });
    expect(document.body.textContent).not.toMatch(/failed validation/i);
  });
});
