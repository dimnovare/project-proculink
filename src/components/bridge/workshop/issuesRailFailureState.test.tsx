import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { IssuesPanel, type WorkshopIssue } from "./IssuesPanel";
import { MobileTriage, type MobileTriageProps } from "./MobileTriage";
import {
  PROBLEM_BUCKET_STATUSES,
  REACHABLE_STATUSES,
  isProblemBucketStatus,
} from "@/lib/orderStatusManifest";

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
  grandTotalLabel: "€ 752.40",
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
