import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The check-run source-re-read leg — the connection check that failed with no reason shown.
//
// THE DEFECT THIS PINS, verbatim. The backend has sent four fields since replay flip A:
//
//   ProcuLink.Api/Services/SupplierConnectionService.cs:587
//     record TestPackSummary(ReplayLeg? Replay, ConformanceLeg? Conformance,
//                            string? Error, ParseLegSummary? ParseLeg = null)
//
// The frontend declared three, twice — once in useConnectionRevisions.ts and once in
// HistoryDrawer.tsx — and read the payload with `JSON.parse(json) as TestPackSummary`.
// The leg arrived in the object every time; the cast is what buried it, because a
// value asserted into a three-field type makes `summary.parseLeg` a compile error and
// type-checks every consumer into ignoring it. `evidenceNotes` collected three notes
// because three was all the interface offered.
//
// The consequence was not cosmetic: a run that failed ONLY on re-reading the source
// files turned the evidence panel red while the other two legs printed normally — and
// `parseLeg.note`, the single sentence that says what went wrong, was unreachable.
//
// ── Updated for BE PR 207 ──────────────────────────────────────────────────────
//
// Every leg's `passed` boolean became an `outcome` string, because four separate paths
// were setting that boolean to `true` over a leg that had not run. The payloads below
// are the new wire bytes. The parse-leg question this file exists for is unchanged and
// still asserted; what a leg that did NOT run must render as is asserted next door, in
// testPackOutcome.test.tsx.

import { HistoryContent } from "./HistoryDrawer";
import {
  TEST_PACK_BACKEND_RECORDS,
  evidenceNotes,
  failedLegLabels,
  parseTestSummary,
  type RevisionTestEvidence,
  type TestPackSummary,
} from "./testPackSummary";
import type { ConnectionRevisionSummary } from "@/lib/api/types";

afterEach(cleanup);

// ── The payloads the backend really writes ───────────────────────────────────
//
// Both are the serializer's own output shape (camelCase, SupplierConnectionService.cs:36)
// with the note strings copied from the C# that builds them, so these are the wire
// bytes rather than a convenient approximation of them.

/** A run that failed ONLY on the source re-read — the case that showed nothing at all. */
const PARSE_ONLY_FAILURE_JSON = JSON.stringify({
  outcome: "failed",
  replay: {
    outcome: "passed",
    orderCount: 2,
    outputErrors: 0,
    outputChanged: 0,
    validationChanged: 0,
    note: null,
  },
  // CSV has no named standards profile and no operator action can create one, so this
  // leg is permanently NOT APPLICABLE rather than skipped-and-counted-as-a-pass.
  conformance: { outcome: "not_applicable", profile: null, errors: 0, warnings: 0, note: null },
  error: null,
  parseLeg: {
    outcome: "failed",
    ordersReParsed: 0,
    parseChanges: 0,
    failures: 2,
    skipped: 0,
    // SupplierConnectionService.cs:826, verbatim.
    note: "2 of 2 order(s) with source files failed to re-parse under this revision's input mapping.",
  },
});

/** A run that PASSED but had something informational to say about re-reading. */
const PASSED_WITH_PARSE_CHANGES_JSON = JSON.stringify({
  outcome: "passed",
  replay: {
    outcome: "passed",
    orderCount: 3,
    outputErrors: 0,
    outputChanged: 1,
    validationChanged: 0,
    note: null,
  },
  conformance: {
    outcome: "passed",
    profile: "cXML 1.2",
    errors: 0,
    warnings: 0,
    note: null,
  },
  error: null,
  parseLeg: {
    outcome: "passed",
    ordersReParsed: 3,
    parseChanges: 1,
    failures: 0,
    skipped: 0,
    // SupplierConnectionService.cs:828, verbatim.
    note: "1 order(s) would parse differently under this revision (informational, not a failure).",
  },
});

// ── The reader that shipped, reconstructed ───────────────────────────────────

/**
 * `evidenceNotes` exactly as it was written — three fields, no parse leg.
 *
 * Kept so a green result below means the code changed, not that the assertion drifted
 * somewhere harmless. If this control ever starts surfacing the parse note, the
 * control is wrong.
 */
const originalEvidenceNotes = (summary: TestPackSummary | null): string[] => {
  if (!summary) return [];
  return [summary.replay?.note, summary.conformance?.note, summary.error].filter(
    (n): n is string => typeof n === "string" && n.length > 0,
  );
};

describe("the reader that shipped", () => {
  it("finds nothing to say about a source-re-read-only failure", () => {
    const summary = parseTestSummary(PARSE_ONLY_FAILURE_JSON);
    expect(summary).not.toBeNull();
    // The whole defect in one assertion: a failed run, and not one word of explanation.
    expect(originalEvidenceNotes(summary)).toEqual([]);
  });

  it("also loses the informational note on a run that passed", () => {
    expect(originalEvidenceNotes(parseTestSummary(PASSED_WITH_PARSE_CHANGES_JSON))).toEqual([]);
  });
});

// ── The reader now ───────────────────────────────────────────────────────────

describe("parseTestSummary reads the leg the cast hid", () => {
  it("keeps every field of the parse leg, typed", () => {
    const summary = parseTestSummary(PARSE_ONLY_FAILURE_JSON);
    expect(summary?.parseLeg).toEqual({
      outcome: "failed",
      ordersReParsed: 0,
      parseChanges: 0,
      failures: 2,
      skipped: 0,
      note: "2 of 2 order(s) with source files failed to re-parse under this revision's input mapping.",
      // Scaffolding: null because this payload is the PR-207 shape and carries no
      // pre-PR-207 boolean. Delete with the compatibility block in testPackSummary.ts.
      legacyPassed: null,
    });
  });

  it("mirrors the record field for field, so no field is quietly missing", () => {
    // Anti-vacuity for the assertion above: reading one leg correctly proves nothing
    // about the other three. The lists are what backendMirror.test.ts diffs against
    // the C#, so pinning them here ties this suite to that diff.
    expect(TEST_PACK_BACKEND_RECORDS.TestPackSummary).toEqual([
      "outcome",
      "replay",
      "conformance",
      "error",
      "parseLeg",
    ]);
    const summary = parseTestSummary(PARSE_ONLY_FAILURE_JSON)!;
    for (const field of TEST_PACK_BACKEND_RECORDS.TestPackSummary) {
      expect(Object.keys(summary), `parseTestSummary never produces ${field}`).toContain(field);
    }
  });

  it("is a parse and not a cast — a payload of the wrong shape is refused", () => {
    // `JSON.parse(x) as TestPackSummary` accepted any of these and handed back a value
    // whose type was a lie; the first property read downstream would then be undefined.
    expect(parseTestSummary("[1,2,3]")).toBeNull();
    expect(parseTestSummary('"a string"')).toBeNull();
    expect(parseTestSummary("null")).toBeNull();
    expect(parseTestSummary("not json at all")).toBeNull();

    // A leg present but malformed is read down to safe values rather than trusted. The
    // outcome specifically is NOT defaulted to a known member — a non-string becomes
    // null, which the manifest reads as `unrecognised`.
    const junk = parseTestSummary('{"parseLeg":{"outcome":true,"failures":"lots","passed":"yes"}}');
    expect(junk?.parseLeg).toEqual({
      outcome: null,
      ordersReParsed: 0,
      parseChanges: 0,
      failures: 0,
      skipped: 0,
      note: null,
      // A non-boolean `passed` is not a legacy signal either — it stays null, so
      // `isLegacyTestPackPayload` cannot be fooled into explaining a malformed payload
      // as an older backend.
      legacyPassed: null,
    });
  });

  it("still reads a payload written before the leg existed", () => {
    // `ParseLegSummary? ParseLeg = null` is defaulted, and rows stored before the leg
    // shipped have no key at all. That must stay a legible summary, not a null one.
    const old = parseTestSummary(
      '{"outcome":"passed","replay":{"outcome":"passed","orderCount":1,"outputErrors":0,"outputChanged":0,"validationChanged":0,"note":null},"conformance":null,"error":null}',
    );
    expect(old).not.toBeNull();
    expect(old?.parseLeg).toBeNull();
    expect(old?.replay?.orderCount).toBe(1);
  });
});

describe("evidenceNotes surfaces the parse note", () => {
  it("carries the sentence that explains a source-re-read-only failure", () => {
    expect(evidenceNotes(parseTestSummary(PARSE_ONLY_FAILURE_JSON))).toEqual([
      "2 of 2 order(s) with source files failed to re-parse under this revision's input mapping.",
    ]);
  });

  it("carries the informational note on a pass", () => {
    expect(evidenceNotes(parseTestSummary(PASSED_WITH_PARSE_CHANGES_JSON))).toEqual([
      "1 order(s) would parse differently under this revision (informational, not a failure).",
    ]);
  });

  it("still carries the notes it always did, in leg order", () => {
    // Anti-vacuity: the two assertions above would pass just as well if the function
    // had been rewritten to return only the parse note.
    const summary = parseTestSummary(
      JSON.stringify({
        outcome: "failed",
        replay: { outcome: "failed", orderCount: 1, outputErrors: 1, outputChanged: 0, validationChanged: 0, note: "replay note" },
        conformance: { outcome: "failed", profile: "cXML 1.2", errors: 2, warnings: 0, note: "standards note" },
        error: "top-level error",
        parseLeg: { outcome: "failed", ordersReParsed: 0, parseChanges: 0, failures: 1, skipped: 0, note: "parse note" },
      }),
    );
    expect(evidenceNotes(summary)).toEqual([
      "replay note",
      "standards note",
      "parse note",
      "top-level error",
    ]);
  });
});

describe("failedLegLabels names which check failed", () => {
  it("names the source-re-read leg, and only it, on a re-read-only failure", () => {
    expect(failedLegLabels(parseTestSummary(PARSE_ONLY_FAILURE_JSON))).toEqual([
      "re-reading the source files",
    ]);
  });

  it("names nothing on a run that passed", () => {
    expect(failedLegLabels(parseTestSummary(PASSED_WITH_PARSE_CHANGES_JSON))).toEqual([]);
  });

  it("does not call an inapplicable standards leg a failure", () => {
    // A standards check that does not EXIST for CSV is a fact about the format, not a
    // fault in this version. Reporting it as failed would be the same class of lie in
    // the other direction — and reporting it as passed was the original one.
    const summary = parseTestSummary(PARSE_ONLY_FAILURE_JSON)!;
    expect(summary.conformance?.outcome).toBe("not_applicable");
    expect(failedLegLabels(summary)).not.toContain("the standards check");
  });

  it("names every leg that really failed", () => {
    const summary = parseTestSummary(
      JSON.stringify({
        outcome: "failed",
        replay: { outcome: "failed", orderCount: 1, outputErrors: 1, outputChanged: 0, validationChanged: 0, note: null },
        conformance: { outcome: "failed", profile: "X12", errors: 1, warnings: 0, note: null },
        error: null,
        parseLeg: { outcome: "failed", ordersReParsed: 0, parseChanges: 0, failures: 1, skipped: 0, note: null },
      }),
    );
    expect(failedLegLabels(summary)).toEqual([
      "rebuilding recent orders",
      "the standards check",
      "re-reading the source files",
    ]);
  });
});

// ── On the screen ────────────────────────────────────────────────────────────

const REVISIONS: ConnectionRevisionSummary[] = [
  {
    id: "rev-2",
    versionNo: 2,
    status: "draft",
    effectiveFrom: null,
    effectiveTo: null,
    publishedAt: null,
    createdAt: "2026-01-02T00:00:00Z",
  },
];

function renderHistory(evidence: RevisionTestEvidence) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, enabled: false } } });
  render(
    <QueryClientProvider client={qc}>
      <HistoryContent
        connectionId="conn-1"
        revisions={REVISIONS}
        activeRevisionId={null}
        liveSummary={null}
        liveVersionNo={null}
        testEvidence={evidence}
        busy={false}
        testingRevisionId={null}
        rollingBackRevisionId={null}
        discardingRevisionId={null}
        onTest={vi.fn()}
        onRequestPublish={vi.fn()}
        onRequestRollback={vi.fn()}
        onRequestArchive={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

const evidenceFrom = (json: string, outcome: string | null): RevisionTestEvidence => ({
  revisionId: "rev-2",
  outcome,
  testedAt: "2026-01-02T09:00:00Z",
  summary: parseTestSummary(json),
});

describe("the evidence panel explains a source-re-read-only failure", () => {
  it("names the failed check instead of only going red", () => {
    renderHistory(evidenceFrom(PARSE_ONLY_FAILURE_JSON, "failed"));
    expect(screen.getByText(/Checks failed — re-reading the source files/)).toBeTruthy();
  });

  it("shows the sentence that says what happened", () => {
    renderHistory(evidenceFrom(PARSE_ONLY_FAILURE_JSON, "failed"));
    expect(
      screen.getByText(
        "2 of 2 order(s) with source files failed to re-parse under this revision's input mapping.",
      ),
    ).toBeTruthy();
  });

  it("counts the orders the leg actually re-read and failed", () => {
    renderHistory(evidenceFrom(PARSE_ONLY_FAILURE_JSON, "failed"));
    expect(document.body.textContent).toContain("Source files re-read: failed · 0 orders, 2 failed");
  });

  it("still shows the legs that passed, so the reader can see what was ruled out", () => {
    // Anti-vacuity: without this, a panel that had been reduced to the parse leg alone
    // would satisfy every assertion above while being a worse screen.
    renderHistory(evidenceFrom(PARSE_ONLY_FAILURE_JSON, "failed"));
    const body = document.body.textContent ?? "";
    expect(body).toContain("Recent orders rebuilt: passed · 2 orders");
    expect(body).toContain("Standards: no such check for this setup");
  });
});

describe("the evidence panel on a run that passed", () => {
  it("reports the informational difference without calling it a failure", () => {
    renderHistory(evidenceFrom(PASSED_WITH_PARSE_CHANGES_JSON, "passed"));
    const body = document.body.textContent ?? "";
    expect(body).toContain("Checks passed");
    expect(body).toContain("Source files re-read: passed · 3 orders, 1 would read differently");
    expect(body).toContain(
      "1 order(s) would parse differently under this revision (informational, not a failure).",
    );
  });

  it("names no failed leg", () => {
    renderHistory(evidenceFrom(PASSED_WITH_PARSE_CHANGES_JSON, "passed"));
    expect(screen.queryByText(/Checks passed —/)).toBeNull();
  });
});

describe("a failure the payload does not explain says so", () => {
  it("admits it rather than leaving a bare red box", () => {
    // Every leg reports passing, the run says failed, and there is no note. Silence
    // here is what the parse-leg case looked like from the reader's side, and it must
    // not be reachable by any other route either.
    renderHistory(
      evidenceFrom(
        JSON.stringify({
          outcome: "failed",
          replay: { outcome: "passed", orderCount: 1, outputErrors: 0, outputChanged: 0, validationChanged: 0, note: null },
          conformance: { outcome: "not_applicable", profile: null, errors: 0, warnings: 0, note: null },
          error: null,
          parseLeg: { outcome: "passed", ordersReParsed: 1, parseChanges: 0, failures: 0, skipped: 0, note: null },
        }),
        "failed",
      ),
    );
    expect(screen.getByText("The server did not say which check failed.")).toBeTruthy();
  });
});
