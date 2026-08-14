import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type {
  ConnectionRevisionSummary,
  ReplayOrderDiff,
  ReplayResponse,
  ReplayValidationFlip,
} from "@/lib/api/types";
import { VALIDATION_OUTCOME_FACTS } from "@/lib/validationOutcomeManifest";

// ─────────────────────────────────────────────────────────────────────────────
// The replay screen's validation diff draws ONE token per side of a comparison,
// and it has FOUR facts to tell apart — not three:
//
//   pass / fail    the rule ran and gave a verdict
//   not_evaluated  the rule COULD NOT RUN; the order didn't carry the value it
//                  judges (backend PR 206)
//   absent (null)  the rule doesn't exist on that side of the comparison
//
// Before this test, `StatusToken` compared two literals and fell through to a
// grey em dash for everything else. `not_evaluated` therefore landed on the
// SAME GLYPH as an absent rule — safe in the sense that it is not a false pass,
// but wrong in the one way that matters on a screen whose entire purpose is
// comparing two sides: "the rule wasn't there" and "the rule ran nothing" were
// drawn identically, side by side, in the same row.
//
// A status this build has never heard of took that glyph too, which is the
// failure mode `deliveryAttemptManifest` was written to stop — an unreadable
// status must render as its own thing and never as a success.
//
// The assertions below are keyed off `VALIDATION_OUTCOME_FACTS` rather than
// hard-coded wire strings, so a renamed or added backend outcome moves this
// test instead of quietly passing beside it.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return { ...actual, replayConnectionRevision: vi.fn(), reprocessOrderUnderRevision: vi.fn() };
});

import * as apiClient from "@/lib/api-client";
import { ReplayPanel } from "@/components/connections/ReplayPanel";

const replayMock = vi.mocked(apiClient.replayConnectionRevision);

const REVISIONS: ConnectionRevisionSummary[] = [
  { id: "rev-3", versionNo: 3, status: "draft", effectiveFrom: null, effectiveTo: null, publishedAt: null, createdAt: "2026-01-03T00:00:00Z" },
  { id: "rev-2", versionNo: 2, status: "published", effectiveFrom: null, effectiveTo: null, publishedAt: "2026-01-02T00:00:00Z", createdAt: "2026-01-02T00:00:00Z" },
];

/** The exact wire string the backend sends for a given outcome — never re-typed here. */
function wireStatus(outcome: "pass" | "fail" | "not_evaluated"): string {
  const fact = VALIDATION_OUTCOME_FACTS.find((f) => f.outcome === outcome);
  if (!fact) throw new Error(`validationOutcomeManifest has no row for "${outcome}"`);
  return fact.status;
}

const PASS = wireStatus("pass");
const FAIL = wireStatus("fail");
const NOT_EVALUATED = wireStatus("not_evaluated");

function flip(partial: Partial<ReplayValidationFlip>): ReplayValidationFlip {
  return { code: "rule_code", lineNumber: null, currentStatus: PASS, draftStatus: FAIL, message: "", ...partial };
}

function orderWith(flips: ReplayValidationFlip[]): ReplayOrderDiff {
  return {
    orderId: "ord-1",
    poNumber: "PO-1",
    outputFormat: "Csv",
    outputChanged: false,
    currentOutput: "PoNumber\nPO-1",
    draftOutput: "PoNumber\nPO-1",
    outputError: null,
    effectiveValueChanges: [],
    validationChanged: true,
    currentValidation: { passed: true, passCount: 3, failCount: 0, hasProfile: true },
    draftValidation: { passed: true, passCount: 2, failCount: 0, hasProfile: true },
    validationFlips: flips,
  } as ReplayOrderDiff;
}

/** Run a replay of one order and expand its detail so the validation diff is on screen. */
async function showFlips(flips: ReplayValidationFlip[]): Promise<void> {
  const response: ReplayResponse = {
    connectionId: "conn-1",
    revisionId: "rev-3",
    revisionVersionNo: 3,
    revisionStatus: "draft",
    orderCount: 1,
    orders: [orderWith(flips)],
  };
  replayMock.mockResolvedValue(response);
  render(
    <Wrapper>
      <ReplayPanel connectionId="conn-1" revisions={REVISIONS} activeRevisionId="rev-2" />
    </Wrapper>,
  );
  fireEvent.click(screen.getByRole("button", { name: /run replay/i }));
  await screen.findByText(/1 order replayed/);
  fireEvent.click(screen.getByRole("button", { name: /PO-1/ }));
  await screen.findByText(/Validation changes/);
}

/** The one `<li>` for a rule, so a token read here cannot come from another row. */
function flipRow(code: string): HTMLElement {
  const row = screen.getByText(code).closest("li");
  if (!row) throw new Error(`no validation-flip row rendered for "${code}"`);
  return row as HTMLElement;
}

function Wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  replayMock.mockReset();
});
afterEach(() => cleanup());

describe("ReplayPanel validation tokens — four facts, four renderings", () => {
  it("draws the two real verdicts, and no dash, for a rule that ran on both sides", async () => {
    // Anti-vacuity floor: if this fails, the harness never reached the flip list and
    // every "absent" assertion below would pass for the wrong reason.
    await showFlips([flip({ code: "qty_positive", currentStatus: PASS, draftStatus: FAIL })]);

    const row = flipRow("qty_positive");
    expect(within(row).getByText("pass")).toBeTruthy();
    expect(within(row).getByText("fail")).toBeTruthy();
    expect(within(row).queryAllByText("—")).toHaveLength(0);
  });

  it("does not draw the absent-rule dash for a rule the server said it could not run", async () => {
    await showFlips([
      flip({ code: "line_amount_reconcile", currentStatus: PASS, draftStatus: NOT_EVALUATED }),
    ]);

    const row = flipRow("line_amount_reconcile");
    expect(
      within(row).queryByText("not checked"),
      `a "${NOT_EVALUATED}" status has no token of its own — it fell through to the grey "—" that means the rule was not present`,
    ).toBeTruthy();
    expect(
      within(row).queryAllByText("—"),
      `"${NOT_EVALUATED}" is being drawn as the absent-rule dash: a rule that ran nothing is indistinguishable from a rule that does not exist`,
    ).toHaveLength(0);
  });

  it("tells an absent rule apart from an unevaluated one inside a single row", async () => {
    // The whole point of the screen: two sides, side by side. If these two collapse
    // into one glyph the row says nothing about which side is which.
    await showFlips([
      flip({ code: "vat_format", currentStatus: null, draftStatus: NOT_EVALUATED, message: "not checked — this document didn't state a VAT number." }),
    ]);

    const row = flipRow("vat_format");
    expect(
      within(row).queryAllByText("—"),
      `both sides of this row render as "—": the absent rule (current) and the unevaluated one (draft) are drawn identically`,
    ).toHaveLength(1);
    expect(within(row).getByText("not checked")).toBeTruthy();
  });

  it("keeps the dash for a rule that does not exist on one side", async () => {
    await showFlips([flip({ code: "supplier_code_known", currentStatus: null, draftStatus: FAIL })]);

    const row = flipRow("supplier_code_known");
    expect(within(row).getAllByText("—")).toHaveLength(1);
    expect(within(row).getByText("fail")).toBeTruthy();
    expect(within(row).queryByText("not checked")).toBeNull();
  });

  it("never renders a status it does not recognise as a pass, and never as the dash", async () => {
    await showFlips([flip({ code: "future_rule", currentStatus: FAIL, draftStatus: "quarantined" })]);

    const row = flipRow("future_rule");
    expect(
      within(row).queryByText("pass"),
      `an unrecognised status rendered as a pass — the one direction "unrecognised" may never resolve to`,
    ).toBeNull();
    expect(
      within(row).queryAllByText("—"),
      `an unrecognised status rendered as the absent-rule dash, hiding that the server sent something this build cannot read`,
    ).toHaveLength(0);
    // The raw value is shown rather than swallowed: it is the only evidence of what arrived.
    expect(row.textContent).toContain("quarantined");
    expect(row.textContent).toContain("unknown");
  });

  it("reads the status through the manifest, so case and padding do not change the answer", async () => {
    // A hand-rolled `=== "not_evaluated"` would fail this; the manifest trims + lowercases.
    await showFlips([
      flip({ code: "date_sanity", currentStatus: `  ${PASS.toUpperCase()} `, draftStatus: ` ${NOT_EVALUATED.toUpperCase()}  ` }),
    ]);

    const row = flipRow("date_sanity");
    expect(within(row).getByText("pass")).toBeTruthy();
    expect(within(row).getByText("not checked")).toBeTruthy();
    expect(within(row).queryAllByText("—")).toHaveLength(0);
  });

  it("gives every status the manifest knows a token of its own", async () => {
    // A registry walk, not a list of three literals: the next backend outcome
    // lands here as a failing row rather than as a silent grey dash.
    expect(VALIDATION_OUTCOME_FACTS.length).toBeGreaterThanOrEqual(3);

    await showFlips(
      VALIDATION_OUTCOME_FACTS.map((f) =>
        flip({ code: `walk_${f.outcome}`, currentStatus: null, draftStatus: f.status }),
      ),
    );

    for (const fact of VALIDATION_OUTCOME_FACTS) {
      const row = flipRow(`walk_${fact.outcome}`);
      // One dash only — the `null` current side. The draft side must be something else.
      expect(
        within(row).queryAllByText("—"),
        `status "${fact.status}" (${fact.outcome}) draws the absent-rule dash instead of a token of its own`,
      ).toHaveLength(1);
    }
  });

  it("explains what the dash and the unevaluated token mean", async () => {
    await showFlips([flip({ code: "vat_format", currentStatus: null, draftStatus: NOT_EVALUATED })]);

    const legend = screen.getByTestId("validation-token-legend").textContent ?? "";
    expect(legend).toContain("not checked");
    expect(legend.toLowerCase()).toContain("couldn't run");
    expect(legend).toMatch(/isn't (part of|in)/i);
  });
});
