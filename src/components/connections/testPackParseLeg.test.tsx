import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The test-pack parse leg — the connection check that failed with no reason shown.
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
// The consequence was not cosmetic. `passed` is
// `replayPassed && (conformance skipped || passed) && parsePassed` (:703), so a pack
// that failed ONLY on re-parsing turned the evidence panel red while the replay and
// conformance lines both printed normally — and `parseLeg.note`, the single sentence
// that says what went wrong, was unreachable. On a pass, the informational
// "N order(s) would parse differently under this revision" was unreachable too.

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

/** A pack that failed ONLY on the parse leg — the case that showed nothing at all. */
const PARSE_ONLY_FAILURE_JSON = JSON.stringify({
  replay: {
    passed: true,
    orderCount: 2,
    outputErrors: 0,
    outputChanged: 0,
    validationChanged: 0,
    note: null,
  },
  conformance: { skipped: true, passed: null, profile: null, errors: 0, warnings: 0, note: null },
  error: null,
  parseLeg: {
    passed: false,
    ordersReParsed: 0,
    parseChanges: 0,
    failures: 2,
    skipped: 0,
    // SupplierConnectionService.cs:696, verbatim.
    note: "2 of 2 order(s) with source files failed to re-parse under this revision's input mapping.",
  },
});

/** A pack that PASSED but had something informational to say about parsing. */
const PASSED_WITH_PARSE_CHANGES_JSON = JSON.stringify({
  replay: {
    passed: true,
    orderCount: 3,
    outputErrors: 0,
    outputChanged: 1,
    validationChanged: 0,
    note: null,
  },
  conformance: {
    skipped: false,
    passed: true,
    profile: "cXML 1.2",
    errors: 0,
    warnings: 0,
    note: null,
  },
  error: null,
  parseLeg: {
    passed: true,
    ordersReParsed: 3,
    parseChanges: 1,
    failures: 0,
    skipped: 0,
    // SupplierConnectionService.cs:699, verbatim.
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
  it("finds nothing to say about a parse-leg-only failure", () => {
    const summary = parseTestSummary(PARSE_ONLY_FAILURE_JSON);
    expect(summary).not.toBeNull();
    // The whole defect in one assertion: a failed pack, and not one word of explanation.
    expect(originalEvidenceNotes(summary)).toEqual([]);
  });

  it("also loses the informational note on a pack that passed", () => {
    expect(originalEvidenceNotes(parseTestSummary(PASSED_WITH_PARSE_CHANGES_JSON))).toEqual([]);
  });
});

// ── The reader now ───────────────────────────────────────────────────────────

describe("parseTestSummary reads the leg the cast hid", () => {
  it("keeps every field of the parse leg, typed", () => {
    const summary = parseTestSummary(PARSE_ONLY_FAILURE_JSON);
    expect(summary?.parseLeg).toEqual({
      passed: false,
      ordersReParsed: 0,
      parseChanges: 0,
      failures: 2,
      skipped: 0,
      note: "2 of 2 order(s) with source files failed to re-parse under this revision's input mapping.",
    });
  });

  it("mirrors the record field for field, so no field is quietly missing", () => {
    // Anti-vacuity for the assertion above: reading one leg correctly proves nothing
    // about the other three. The lists are what backendMirror.test.ts diffs against
    // the C#, so pinning them here ties this suite to that diff.
    expect(TEST_PACK_BACKEND_RECORDS.TestPackSummary).toEqual([
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

    // A leg present but malformed is read down to safe values rather than trusted.
    const junk = parseTestSummary('{"parseLeg":{"passed":"yes","failures":"lots"}}');
    expect(junk?.parseLeg).toEqual({
      passed: false,
      ordersReParsed: 0,
      parseChanges: 0,
      failures: 0,
      skipped: 0,
      note: null,
    });
  });

  it("still reads a payload written before the leg existed", () => {
    // `ParseLegSummary? ParseLeg = null` is defaulted, and rows stored before the leg
    // shipped have no key at all. That must stay a legible summary, not a null one.
    const old = parseTestSummary(
      '{"replay":{"passed":true,"orderCount":1,"outputErrors":0,"outputChanged":0,"validationChanged":0,"note":null},"conformance":null,"error":null}',
    );
    expect(old).not.toBeNull();
    expect(old?.parseLeg).toBeNull();
    expect(old?.replay?.orderCount).toBe(1);
  });
});

describe("evidenceNotes surfaces the parse note", () => {
  it("carries the sentence that explains a parse-leg-only failure", () => {
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
        replay: { passed: false, orderCount: 1, outputErrors: 1, outputChanged: 0, validationChanged: 0, note: "replay note" },
        conformance: { skipped: false, passed: false, profile: "cXML 1.2", errors: 2, warnings: 0, note: "conformance note" },
        error: "top-level error",
        parseLeg: { passed: false, ordersReParsed: 0, parseChanges: 0, failures: 1, skipped: 0, note: "parse note" },
      }),
    );
    expect(evidenceNotes(summary)).toEqual([
      "replay note",
      "conformance note",
      "parse note",
      "top-level error",
    ]);
  });
});

describe("failedLegLabels names which check failed", () => {
  it("names the parse leg, and only it, on a parse-only failure", () => {
    expect(failedLegLabels(parseTestSummary(PARSE_ONLY_FAILURE_JSON))).toEqual([
      "re-parsing the source files",
    ]);
  });

  it("names nothing on a pack that passed", () => {
    expect(failedLegLabels(parseTestSummary(PASSED_WITH_PARSE_CHANGES_JSON))).toEqual([]);
  });

  it("does not call a skipped conformance leg a failure", () => {
    // The backend's own conjunction treats `Skipped` as satisfying the term
    // (SupplierConnectionService.cs:703). Reporting it as failed would be the same
    // class of lie in the other direction.
    const summary = parseTestSummary(PARSE_ONLY_FAILURE_JSON)!;
    expect(summary.conformance?.skipped).toBe(true);
    expect(failedLegLabels(summary)).not.toContain("standards conformance");
  });

  it("names every leg that really failed", () => {
    const summary = parseTestSummary(
      JSON.stringify({
        replay: { passed: false, orderCount: 1, outputErrors: 1, outputChanged: 0, validationChanged: 0, note: null },
        conformance: { skipped: false, passed: false, profile: "X12", errors: 1, warnings: 0, note: null },
        error: null,
        parseLeg: { passed: false, ordersReParsed: 0, parseChanges: 0, failures: 1, skipped: 0, note: null },
      }),
    );
    expect(failedLegLabels(summary)).toEqual([
      "replay",
      "standards conformance",
      "re-parsing the source files",
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

const evidenceFrom = (json: string, passed: boolean): RevisionTestEvidence => ({
  revisionId: "rev-2",
  passed,
  testedAt: "2026-01-02T09:00:00Z",
  summary: parseTestSummary(json),
});

describe("the evidence panel explains a parse-leg-only failure", () => {
  it("names the failed check instead of only going red", () => {
    renderHistory(evidenceFrom(PARSE_ONLY_FAILURE_JSON, false));
    expect(screen.getByText(/Checks failed — re-parsing the source files/)).toBeTruthy();
  });

  it("shows the sentence that says what happened", () => {
    renderHistory(evidenceFrom(PARSE_ONLY_FAILURE_JSON, false));
    expect(
      screen.getByText(
        "2 of 2 order(s) with source files failed to re-parse under this revision's input mapping.",
      ),
    ).toBeTruthy();
  });

  it("counts the orders the leg actually re-parsed and failed", () => {
    renderHistory(evidenceFrom(PARSE_ONLY_FAILURE_JSON, false));
    expect(screen.getByText(/Re-parse: 0 orders, 2 failed/)).toBeTruthy();
  });

  it("still shows the legs that passed, so the reader can see what was ruled out", () => {
    // Anti-vacuity: without this, a panel that had been reduced to the parse leg alone
    // would satisfy every assertion above while being a worse screen.
    renderHistory(evidenceFrom(PARSE_ONLY_FAILURE_JSON, false));
    expect(screen.getByText(/Replay: 2 orders/)).toBeTruthy();
    expect(screen.getByText(/Conformance: skipped/)).toBeTruthy();
  });
});

describe("the evidence panel on a pack that passed", () => {
  it("reports the informational parse difference without calling it a failure", () => {
    renderHistory(evidenceFrom(PASSED_WITH_PARSE_CHANGES_JSON, true));
    expect(screen.getByText(/Checks passed/)).toBeTruthy();
    expect(screen.getByText(/Re-parse: 3 orders, 1 would parse differently/)).toBeTruthy();
    expect(
      screen.getByText(
        "1 order(s) would parse differently under this revision (informational, not a failure).",
      ),
    ).toBeTruthy();
  });

  it("names no failed leg", () => {
    renderHistory(evidenceFrom(PASSED_WITH_PARSE_CHANGES_JSON, true));
    expect(screen.queryByText(/Checks passed —/)).toBeNull();
  });
});

describe("a failure the payload does not explain says so", () => {
  it("admits it rather than leaving a bare red box", () => {
    // Every leg reports passing, the pack says failed, and there is no note. Silence
    // here is what the parse-leg case looked like from the reader's side, and it must
    // not be reachable by any other route either.
    renderHistory(
      evidenceFrom(
        JSON.stringify({
          replay: { passed: true, orderCount: 1, outputErrors: 0, outputChanged: 0, validationChanged: 0, note: null },
          conformance: { skipped: true, passed: null, profile: null, errors: 0, warnings: 0, note: null },
          error: null,
          parseLeg: { passed: true, ordersReParsed: 1, parseChanges: 0, failures: 0, skipped: 0, note: null },
        }),
        false,
      ),
    );
    expect(screen.getByText("The server did not say which check failed.")).toBeTruthy();
  });
});
