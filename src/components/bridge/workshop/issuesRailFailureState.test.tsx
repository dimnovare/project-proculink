import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { IssuesPanel, type WorkshopIssue } from "./IssuesPanel";
import { MobileTriage, type MobileTriageProps } from "./MobileTriage";
import {
  PROBLEM_BUCKET_STATUSES,
  REACHABLE_STATUSES,
  isProblemBucketStatus,
} from "@/lib/orderStatusManifest";
import {
  CHECK_SCOPE_SENTENCE,
  READY_BAR_DEFAULT,
  STOPPED_ORDER_NOTE,
} from "./acceptanceGateModel";

// WP-39 §4.3 — after a live delivery failure the Issues rail still said there was
// nothing wrong.
//
// Immediately after a real 404 from a supplier's endpoint, ONE screen showed the
// failure panel and, in the right rail, at the same moment:
//
//   Ready to send
//   No open issues — every required field is filled and checked.
//
// while the header badge read "Couldn't send" and the API read
// `status: delivery_failed`.
//
// The gate was `issues.length === 0` and nothing else. `issues` are FIELD problems —
// a missing supplier code, a bad quantity — so on a failed delivery it is legitimately
// empty: every field really is filled. What is not true is the conclusion drawn from
// that, which the panel stated as fact in green.
//
// The walk below iterates PROBLEM_BUCKET_STATUSES from src/lib/orderStatusManifest.ts
// rather than a list typed into this file. WP-36 built that manifest precisely because
// nine hand-copied status lists had drifted from the backend and from each other; a
// tenth copy here would be the same mistake, and would go stale the first time a
// status is added.

afterEach(cleanup);

const issue = (over: Partial<WorkshopIssue> & { code: string }): WorkshopIssue => ({
  severity: "blocking",
  ref: over.code,
  title: "Needs a supplier code",
  ...over,
});

/** The green all-clear, by the three strings the QA pass caught on screen. */
function allClearIsOnScreen(): boolean {
  return (
    screen.queryByText("Ready to send") !== null ||
    screen.queryByText(/No open issues/i) !== null
  );
}

describe("Issues rail — an order that stopped (WP-39 §4.3)", () => {
  test("the manifest actually has problem statuses to walk", () => {
    // Anti-vacuity floor. If PROBLEM_BUCKET_STATUSES is ever empty or loses the status
    // this defect was found on, every assertion below passes without testing anything.
    expect(PROBLEM_BUCKET_STATUSES.length).toBeGreaterThan(0);
    expect(PROBLEM_BUCKET_STATUSES).toContain("delivery_failed");
  });

  test.each([...PROBLEM_BUCKET_STATUSES])(
    "does not claim the order is ready to send when its status is %s",
    (status) => {
      render(<IssuesPanel issues={[]} orderStatus={status} onFocusField={vi.fn()} />);

      expect(allClearIsOnScreen()).toBe(false);
    },
  );

  test.each([...PROBLEM_BUCKET_STATUSES])(
    "says the fields are fine and points at what did stop the order — %s",
    (status) => {
      render(<IssuesPanel issues={[]} orderStatus={status} onFocusField={vi.fn()} />);

      // The rail must not go blank either: an operator who cleared every field problem
      // needs to be told that is what they achieved, and that something else is wrong.
      expect(screen.getByText("No field problems")).toBeInTheDocument();
      expect(screen.getByText(/stopped for another reason/i)).toBeInTheDocument();
    },
  );

  test.each(REACHABLE_STATUSES.filter((s) => !isProblemBucketStatus(s)))(
    "still shows the all-clear on a healthy order — %s",
    (status) => {
      render(<IssuesPanel issues={[]} orderStatus={status} onFocusField={vi.fn()} />);

      expect(screen.getByText("Ready to send")).toBeInTheDocument();
      expect(screen.getByText(/No open issues/i)).toBeInTheDocument();
    },
  );

  test("an unknown status is not treated as a failure", () => {
    // isProblemBucketStatus answers false for anything it does not recognise, and every
    // caller is required to read that as "I cannot tell", not "it is fine". Here the
    // conservative reading and the permissive one agree: with zero field issues and no
    // recognised problem, the all-clear is what the screen already showed before this
    // change, so nothing regresses for a status the frontend has not learned yet.
    render(<IssuesPanel issues={[]} orderStatus="a_status_nobody_shipped" onFocusField={vi.fn()} />);

    expect(screen.getByText("Ready to send")).toBeInTheDocument();
  });

  test("omitting the status keeps the old behaviour for callers that do not pass one", () => {
    render(<IssuesPanel issues={[]} onFocusField={vi.fn()} />);

    expect(screen.getByText("Ready to send")).toBeInTheDocument();
  });

  test("real field issues still win — the list renders, not the stopped-order note", () => {
    render(
      <IssuesPanel
        issues={[issue({ code: "a", title: "Needs a supplier code" })]}
        orderStatus="delivery_failed"
        onFocusField={vi.fn()}
      />,
    );

    expect(screen.getByText("Needs a supplier code")).toBeInTheDocument();
    expect(screen.queryByText("No field problems")).toBeNull();
    expect(allClearIsOnScreen()).toBe(false);
  });
});

// The same all-clear is written in three places on the order screen — the rail panel
// above, the mobile triage list, and the desktop Issues column head. WP-39 §4.3 quoted
// two of them ("Nothing to fix" is the column head; "Ready to send / No open issues" is
// the panel) off ONE screenshot. Fixing one and leaving the others is how a contradiction
// survives a fix, so all three are held to the same rule here.

const mobileProps = (over: Partial<MobileTriageProps> = {}): MobileTriageProps => ({
  poNumber: "WP39-QA-001",
  buyerName: "Acme",
  supplierName: "ProcuLink Sample Supplier",
  grandTotalLabel: "€ 600.40",
  status: "pending_review",
  receivedFieldCount: 11,
  lineCount: 1,
  outputFormatLabel: "JSON",
  previewContent: null,
  issues: [],
  blockingIssues: 0,
  exceptionCount: 0,
  canSend: true,
  crossed: false,
  sendState: "idle",
  primaryCta: "Send to supplier",
  primaryCtaProgress: "Sending…",
  doneLabel: "Sent",
  onFix: vi.fn(),
  onFocusField: vi.fn(),
  onSend: vi.fn(),
  ...over,
});

describe("mobile triage — an order that stopped (WP-39 §4.3)", () => {
  test.each([...PROBLEM_BUCKET_STATUSES])(
    "does not say 'ready to send' when the status is %s",
    (status) => {
      render(<MobileTriage {...mobileProps({ status })} />);

      expect(screen.queryByTestId("mobile-triage-ready")).toBeNull();
      expect(screen.getByTestId("mobile-triage-stopped")).toBeInTheDocument();
      expect(screen.getByText(/stopped for another reason/i)).toBeInTheDocument();
    },
  );

  test("still says 'ready to send' on a healthy order with nothing open", () => {
    render(<MobileTriage {...mobileProps({ status: "ready" })} />);

    expect(screen.getByTestId("mobile-triage-ready")).toBeInTheDocument();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// What the bars SAY once inside the branch above.
//
// Everything above this line guards which BRANCH each surface takes. Nothing
// guarded the words, so the claim `readyBarLabel` retired went on rendering inside
// the branch this file created: "Every required field is filled and checked." sat on
// the stopped bar at BOTH breakpoints, and in IssuesPanel's `readyLabel ?? "…"`
// fallback, long after acceptanceGateModel had written out why no check runs behind
// it — POST /api/orders/{id}/validate has no caller anywhere in src/, so
// `validationResult` is permanently null, and AcceptanceGateDecision carries no
// signal for whether the counterparty even HAS an acceptance profile.
//
// ASSERTED ON document.body.textContent, NOT ON PROPS. A prop assertion is green
// while a hardcoded sentence sits in the JSX two lines below it — which is precisely
// how three copies of this survived the fix that named them.
//
// The expected strings are IMPORTED from the module that owns them, never retyped.
// A literal here would be a fourth copy, and this repo has been bitten by exactly
// that: a hand-typed string in a test is usually WHY a drift survived.
// ─────────────────────────────────────────────────────────────────────────────

/** The retired claim, verbatim — the one thing that must never render again. */
const RETIRED_CLAIM = "filled and checked";

describe("the stopped-order note claims only what was looked at", () => {
  test("acceptanceGateModel really owns one shared vocabulary — anti-vacuity", () => {
    // Without this, every assertion below could be comparing empty strings and pass.
    expect(CHECK_SCOPE_SENTENCE.length).toBeGreaterThan(20);
    expect(CHECK_SCOPE_SENTENCE).not.toContain(RETIRED_CLAIM);
    // Both surfaces compose from the SAME clause. If a future edit retypes the words
    // into one of them instead, this is what fails.
    expect(STOPPED_ORDER_NOTE).toContain(CHECK_SCOPE_SENTENCE);
    expect(READY_BAR_DEFAULT).toContain(CHECK_SCOPE_SENTENCE);
    expect(STOPPED_ORDER_NOTE).toMatch(/stopped for another reason/i);
  });

  test.each([...PROBLEM_BUCKET_STATUSES])(
    "IssuesPanel does not claim the fields were CHECKED — %s",
    (status) => {
      render(<IssuesPanel issues={[]} orderStatus={status} onFocusField={vi.fn()} />);
      const rendered = document.body.textContent ?? "";

      expect(
        rendered,
        `the stopped bar still renders "${RETIRED_CLAIM}" — no rule-level check runs on this screen`,
      ).not.toContain(RETIRED_CLAIM);
      expect(rendered).toContain(CHECK_SCOPE_SENTENCE);
      expect(rendered).toContain(STOPPED_ORDER_NOTE);
    },
  );

  test.each([...PROBLEM_BUCKET_STATUSES])(
    "MobileTriage says the same sentence as the desktop panel — %s",
    (status) => {
      render(<MobileTriage {...mobileProps({ status })} />);
      const rendered = document.body.textContent ?? "";

      expect(
        rendered,
        `the mobile stopped bar still renders "${RETIRED_CLAIM}" — no rule-level check runs on this screen`,
      ).not.toContain(RETIRED_CLAIM);
      expect(rendered).toContain(STOPPED_ORDER_NOTE);
    },
  );

  test("the green bar's own fallback no longer carries the retired claim", () => {
    // Every production call site passes `readyLabel` (readyBarClaim.test.ts asserts
    // it), so this default is what pure-view callers get — and it was the last live
    // copy of the sentence in src/.
    render(<IssuesPanel issues={[]} onFocusField={vi.fn()} />);
    const rendered = document.body.textContent ?? "";

    expect(
      rendered,
      `the readyLabel fallback still renders "${RETIRED_CLAIM}"`,
    ).not.toContain(RETIRED_CLAIM);
    expect(rendered).toContain(READY_BAR_DEFAULT);
  });
});
