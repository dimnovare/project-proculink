import { describe, test, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { IssuesPanel, type WorkshopIssue } from "./IssuesPanel";
import { MobileTriage, type MobileTriageProps } from "./MobileTriage";
import { readyBarLabel } from "./acceptanceGateModel";
import {
  PROBLEM_BUCKET_STATUSES,
  REACHABLE_STATUSES,
  isProblemBucketStatus,
  orderProblemState,
  statusFact,
} from "@/lib/orderStatusManifest";
import {
  CHECK_SCOPE_SENTENCE,
  READY_BAR_DEFAULT,
  STOPPED_ORDER_NOTE,
  UNVERIFIED_ORDER_NOTE,
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
  readyLabel: readyBarLabel({ advisoryCount: 0, counterpartyNoun: "Supplier" }),
  advisoryCount: 0,
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
    //
    // A healthy `orderStatus` is now required to reach the green bar at all: an omitted
    // one is "unknown", which draws the amber unverified bar instead (see the block
    // below). That is a change to how the bar is REACHED, not to what it says, which is
    // what this test is about.
    render(<IssuesPanel issues={[]} orderStatus="ready" onFocusField={vi.fn()} />);
    const rendered = document.body.textContent ?? "";

    expect(
      rendered,
      `the readyLabel fallback still renders "${RETIRED_CLAIM}"`,
    ).not.toContain(RETIRED_CLAIM);
    expect(rendered).toContain(READY_BAR_DEFAULT);
  });
});

// ── A status this build has never heard of ──────────────────────────────────────
//
// The Issues COLUMN HEAD already answers this in three states, not two: `clear` draws
// the green tick and "Nothing to fix", `problem` draws "Something else stopped this
// order", and `unknown` draws "We can't confirm this order is clear"
// (MapperWorkbench.issuesHeader.test.tsx). The head takes that verdict from
// `orderProblemState`.
//
// The panel and the mobile list took the SAME question to `isProblemBucketStatus`,
// which answers false for a status it does not recognise — so on one order, on one
// screen, the head said it could not confirm the order was clear and the panel
// directly beneath it said "Ready to send". The test that used to sit here pinned that
// permissive answer on the reasoning that "the conservative reading and the permissive
// one agree, so nothing regresses". Once the head learned the third answer they stopped
// agreeing, and the reasoning stopped being true.
//
// All three surfaces now read `orderProblemState`, and the two claims an unknown status
// must not produce are asserted separately: it is not an all-clear, and it is not a
// stoppage either. Nothing observed a stoppage — only that the state is unreadable.
//
// Asserted on `document.body.textContent`, never on a prop: the defect was always that a
// confident value reached the DOM and the DOM drew it faithfully. The expected sentence
// is IMPORTED from acceptanceGateModel for the reason the block above gives — a literal
// here would be a second copy, and a hand-typed string in a test is usually WHY a drift
// survives.

/** Deliberately absent from ORDER_STATUS_FACTS — a real backend status this build has not learned. */
const UNKNOWN_STATUS = "awaiting_supplier_ack";

describe("Issues rail — a status this build has never heard of", () => {
  test("the status under test really is unknown to the manifest", () => {
    // Without this the whole block silently stops testing unknowns the day
    // `awaiting_supplier_ack` is added to ORDER_STATUS_FACTS: every assertion below
    // would then be describing a healthy status and would keep passing for the wrong
    // reason. Fail loudly instead, and pick a new string.
    expect(statusFact(UNKNOWN_STATUS)).toBeNull();
    expect(orderProblemState(UNKNOWN_STATUS)).toBe("unknown");
  });

  test("the unverified note is a real, distinct sentence — anti-vacuity", () => {
    // Every `toContain(UNVERIFIED_ORDER_NOTE)` below would pass against an empty string,
    // and every `not.toContain(STOPPED_ORDER_NOTE)` would pass if the two were the same
    // sentence. Both directions are pinned here.
    expect(UNVERIFIED_ORDER_NOTE.length).toBeGreaterThan(40);
    expect(UNVERIFIED_ORDER_NOTE).not.toBe(STOPPED_ORDER_NOTE);
    // It shares the one scope clause with its two siblings rather than retyping it…
    expect(UNVERIFIED_ORDER_NOTE).toContain(CHECK_SCOPE_SENTENCE);
    // …carries neither the claim `readyBarLabel` retired…
    expect(UNVERIFIED_ORDER_NOTE).not.toContain(RETIRED_CLAIM);
    // …nor a stoppage nobody observed.
    expect(UNVERIFIED_ORDER_NOTE).not.toMatch(/stopped for another reason/i);
  });

  test("the panel does not claim the order is ready to send", () => {
    render(<IssuesPanel issues={[]} orderStatus={UNKNOWN_STATUS} onFocusField={vi.fn()} />);

    expect(document.body.textContent).not.toContain("Ready to send");
    expect(document.body.textContent).not.toContain("No open issues");
  });

  test("the panel does not invent a stoppage nobody observed", () => {
    render(<IssuesPanel issues={[]} orderStatus={UNKNOWN_STATUS} onFocusField={vi.fn()} />);

    expect(document.body.textContent).not.toContain("stopped for another reason");
    expect(document.body.textContent).not.toContain(STOPPED_ORDER_NOTE);
  });

  test("the panel says the fields are fine and that the rest is unverified", () => {
    render(<IssuesPanel issues={[]} orderStatus={UNKNOWN_STATUS} onFocusField={vi.fn()} />);
    const rendered = document.body.textContent ?? "";

    expect(rendered).toContain("No field problems");
    expect(rendered).toContain(UNVERIFIED_ORDER_NOTE);
    // The same clause the other two bars state, and not one word more than it licenses.
    expect(rendered).toContain(CHECK_SCOPE_SENTENCE);
    expect(rendered).not.toContain(RETIRED_CLAIM);
  });

  test("an omitted status is unknown too, not an all-clear", () => {
    // The head already ships this rule for its own prop: an omitted verdict is not
    // "zero issues". Nothing tells this panel the order is fine when no status arrives,
    // and a green bar drawn from an absent input is the same defect as one drawn from an
    // unreadable one. The only production call site (OrderWorkshop) always passes
    // `order.status`, so this governs the pure-view callers.
    render(<IssuesPanel issues={[]} onFocusField={vi.fn()} />);

    expect(document.body.textContent).not.toContain("Ready to send");
    expect(document.body.textContent).toContain(UNVERIFIED_ORDER_NOTE);
  });

  test("an explicit null status is unknown too", () => {
    render(<IssuesPanel issues={[]} orderStatus={null} onFocusField={vi.fn()} />);

    expect(document.body.textContent).not.toContain("Ready to send");
    expect(document.body.textContent).toContain(UNVERIFIED_ORDER_NOTE);
  });

  test("real field issues still win over the unverified note", () => {
    render(
      <IssuesPanel
        issues={[issue({ code: "a", title: "Needs a supplier code" })]}
        orderStatus={UNKNOWN_STATUS}
        onFocusField={vi.fn()}
      />,
    );

    expect(screen.getByText("Needs a supplier code")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(UNVERIFIED_ORDER_NOTE);
    expect(allClearIsOnScreen()).toBe(false);
  });

  test("mobile triage gives the panel's answer, not the opposite one", () => {
    render(<MobileTriage {...mobileProps({ status: UNKNOWN_STATUS })} />);
    const rendered = document.body.textContent ?? "";

    expect(screen.queryByTestId("mobile-triage-ready")).toBeNull();
    expect(screen.queryByTestId("mobile-triage-stopped")).toBeNull();
    expect(screen.getByTestId("mobile-triage-unverified")).toBeInTheDocument();
    expect(rendered).not.toContain("No open issues");
    expect(rendered).not.toContain(STOPPED_ORDER_NOTE);
    expect(rendered).not.toContain(RETIRED_CLAIM);
    expect(rendered).toContain("No field problems");
    // Byte for byte the desktop panel's sentence — one constant, two breakpoints.
    expect(rendered).toContain(UNVERIFIED_ORDER_NOTE);
  });

  test("the healthy control still draws the all-clear on both surfaces", () => {
    // The anti-vacuity half. Surfaces that never say "ready to send" would satisfy every
    // negative assertion above while being exactly as useless as ones that always do.
    render(<IssuesPanel issues={[]} orderStatus="ready" onFocusField={vi.fn()} />);
    expect(document.body.textContent).toContain("Ready to send");
    cleanup();

    render(<MobileTriage {...mobileProps({ status: "ready" })} />);
    expect(screen.getByTestId("mobile-triage-ready")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain(UNVERIFIED_ORDER_NOTE);
  });
});
