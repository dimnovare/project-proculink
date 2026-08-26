import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, renderHook, act, waitFor, cleanup, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { ConnectionDetail, ConnectionRevisionSummary, ConnectionTestEvidence } from "@/lib/api/types";

// ─────────────────────────────────────────────────────────────────────────────
// A check that did not run is not a check that passed — on the screen.
//
// THE DEFECT, verbatim. `SupplierConnectionService.ExecuteTestPackAsync` had four paths
// that returned a pass over a run that had executed nothing. The one that matters most
// is a supplier with NO ORDERS — the default state at onboarding, i.e. exactly when an
// operator runs checks:
//
//     new ReplayLeg(true, 0, 0, 0, 0, "No orders exist for this supplier yet — replay pass-with-note.")
//     new ConformanceLeg(true, null, null, 0, 0, "No replayed output available to conformance-check.")
//     new ParseLegSummary(true, 0, 0, 0, 0, "No orders exist for this supplier yet — nothing to re-parse.")
//     return (true, …)
//
// Two frontend surfaces then read that boolean and composed their own sentence:
//
//     useConnectionRevisions.ts:135  "Checks passed — this version is ready to make live."
//     HistoryDrawer.tsx:470          Checks {passed ? "passed" : "failed"}
//     HistoryDrawer.tsx:491          `${conformance.passed ? "passed" : "failed"}`
//
// so a connection whose endpoint, credentials and output format had never been exercised
// was announced as ready to go live, and real deliveries routed through it.
//
// WHY THE CONTROLS BELOW ARE THE SHAPE THEY ARE. A suite that only feeds passed and
// failed goes green against the original code — both of those rendered correctly. The
// defect lives in the THIRD answer (the checks ran and tested nothing) and in the
// FOURTH (an answer this page cannot read), so those are the payloads that carry the
// weight here. `ZERO_ORDER_SUMMARY_JSON` is the real wire bytes for a supplier with no
// orders, notes copied from the C# that writes them.
//
// PAIRS WITH BACKEND PR 207 (`fix/publish-gate-empty-test-pack`).
// ─────────────────────────────────────────────────────────────────────────────

const getConnection = vi.fn();
const getConnectionRevision = vi.fn();
const createConnectionDraft = vi.fn();
const publishConnectionRevision = vi.fn();
const markConnectionRevisionTest = vi.fn();
const archiveConnectionRevision = vi.fn();
const rollbackConnectionRevision = vi.fn();

const { FakeApiHttpError } = vi.hoisted(() => {
  class FakeApiHttpError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  }
  return { FakeApiHttpError };
});

vi.mock("@/lib/api-client", () => ({
  getConnection: (...a: unknown[]) => getConnection(...a),
  getConnectionRevision: (...a: unknown[]) => getConnectionRevision(...a),
  createConnectionDraft: (...a: unknown[]) => createConnectionDraft(...a),
  publishConnectionRevision: (...a: unknown[]) => publishConnectionRevision(...a),
  markConnectionRevisionTest: (...a: unknown[]) => markConnectionRevisionTest(...a),
  archiveConnectionRevision: (...a: unknown[]) => archiveConnectionRevision(...a),
  rollbackConnectionRevision: (...a: unknown[]) => rollbackConnectionRevision(...a),
  ApiHttpError: FakeApiHttpError,
}));

vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));

import { HistoryContent } from "./HistoryDrawer";
import { ConnectionNotice, NOTICE_TONE_STYLE } from "./ConnectionLifecycleUI";
import { useConnectionRevisions } from "./useConnectionRevisions";
import {
  isLegacyTestPackPayload,
  parseTestSummary,
  type RevisionTestEvidence,
} from "./testPackSummary";

afterEach(cleanup);

// ── The pass-claim matcher, proven before it is trusted ──────────────────────

const PASS_CLAIM: readonly RegExp[] = [
  /\bpass(ed|es|ing)?\b/i,
  /ready to (make|go) live/i,
  /\bsucceed(ed|s)?\b/i,
  /\bsuccessful\b/i,
  /all (checks )?(clear|good|green)/i,
  /no (problems|issues|errors)\b/i,
  /looks good/i,
  /\bverified\b/i,
];

/** The two sentences that shipped over a run which tested nothing. Kept verbatim. */
const ORIGINAL_NOTICE = "Checks passed — this version is ready to make live.";
const ORIGINAL_HEADLINE = "Checks passed";

function passClaimsIn(text: string): string[] {
  return PASS_CLAIM.filter((re) => re.test(text)).map(String);
}

/**
 * Everything the surface says: rendered text PLUS every tooltip.
 *
 * The "Make live" explanation lives in a `title` attribute, and
 * `document.body.textContent` does not include attributes — a guard reading text alone
 * would pass against a button whose tooltip announced a pass. (RevisionStatusBadge's
 * own defect was exactly that: a claim in a `title`.)
 */
function renderedSurface(): string {
  const text = document.body.textContent ?? "";
  const titles = Array.from(document.body.querySelectorAll<HTMLElement>("[title]"))
    .map((el) => el.getAttribute("title") ?? "")
    .join(" ");
  return `${text} ${titles}`.trim();
}

/**
 * The two places the screen states a VERDICT: the evidence panel's headline, and the
 * Make-live button's explanation of why it is open or shut.
 *
 * Narrower than `renderedSurface()` on purpose. The leg lines legitimately print
 * "passed" for a leg that passed, and the backend's own standards note contains the word
 * "verified" — sweeping the whole screen for pass words would flag honest detail and
 * force the assertions to be loosened until they stopped meaning anything. The defect
 * was never in the detail; it was the headline and the button.
 */
function verdictSurface(): string {
  const headline = screen.queryByTestId("revision-check-headline")?.textContent ?? "";
  const titles = Array.from(document.body.querySelectorAll<HTMLElement>("[title]"))
    .map((el) => el.getAttribute("title") ?? "")
    .join(" ");
  return `${headline} ${titles}`.trim();
}

describe("the pass-claim matcher is not vacuous", () => {
  it("flags both sentences that shipped, verbatim", () => {
    expect(passClaimsIn(ORIGINAL_NOTICE)).not.toHaveLength(0);
    expect(passClaimsIn(ORIGINAL_HEADLINE)).not.toHaveLength(0);
  });

  it("flags the old Make-live tooltip too", () => {
    expect(
      passClaimsIn(
        "Applies this version to new orders. Orders already sent keep their original format.",
      ),
    ).toHaveLength(0);
    // The gate's own wording DID claim one, and it is in a title attribute.
    expect(passClaimsIn("Run tests — checks must pass before going live.")).not.toHaveLength(0);
  });

  it("would catch a claim hiding in a title attribute", () => {
    render(<span title={ORIGINAL_NOTICE}>Make live</span>);
    expect(document.body.textContent ?? "").not.toContain("Checks passed");
    expect(passClaimsIn(renderedSurface())).not.toHaveLength(0);
  });

  it("does not flag the sentences this change introduces", () => {
    expect(
      passClaimsIn(
        "The checks ran and nothing objected, but they never tested this version — there were no " +
          "orders to run it against.",
      ),
    ).toHaveLength(0);
  });
});

// ── The wire bytes for a supplier with no orders ─────────────────────────────
//
// SupplierConnectionService.cs:692-707 (BE PR 207), verbatim — every leg reports
// `not_exercised`, and the pack rolls up to `not_exercised`. This is the payload the old
// code turned into "Checks passed — this version is ready to make live."

const NO_ORDERS_NOTE =
  "No orders exist for this supplier yet, so this version has not been run against anything. " +
  "Put one order through for this supplier, then re-run the checks.";

const ZERO_ORDER_SUMMARY_JSON = JSON.stringify({
  outcome: "not_exercised",
  replay: {
    outcome: "not_exercised",
    orderCount: 0,
    outputErrors: 0,
    outputChanged: 0,
    validationChanged: 0,
    note: NO_ORDERS_NOTE,
  },
  conformance: {
    outcome: "not_exercised",
    profile: null,
    errors: 0,
    warnings: 0,
    note: "No output was produced, so there was nothing to standards-check.",
  },
  error: null,
  parseLeg: {
    outcome: "not_exercised",
    ordersReParsed: 0,
    parseChanges: 0,
    failures: 0,
    skipped: 0,
    note: "No orders exist for this supplier yet — nothing to re-parse.",
  },
});

/** A run whose only un-passing leg is the permanently-inapplicable standards check. */
const CSV_PASS_SUMMARY_JSON = JSON.stringify({
  outcome: "passed",
  replay: {
    outcome: "passed",
    orderCount: 4,
    outputErrors: 0,
    outputChanged: 0,
    validationChanged: 0,
    note: null,
  },
  conformance: {
    outcome: "not_applicable",
    profile: null,
    errors: 0,
    warnings: 0,
    note:
      "No standards check exists for 'csv' — it is a flexible supplier format with no published " +
      "standard to check it against. Nothing was verified here. Your output still delivers normally.",
  },
  error: null,
  parseLeg: {
    outcome: "passed",
    ordersReParsed: 4,
    parseChanges: 0,
    failures: 0,
    skipped: 0,
    note: null,
  },
});

// ── The version-history row ──────────────────────────────────────────────────

const REVISIONS: ConnectionRevisionSummary[] = [
  {
    id: "rev-9",
    versionNo: 9,
    // `test` means the checks RAN, never that they passed — MarkTestAsync sets it
    // unconditionally. A row in this state with unproven evidence is the ordinary case.
    status: "test",
    effectiveFrom: null,
    effectiveTo: null,
    publishedAt: null,
    createdAt: "2026-02-01T00:00:00Z",
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
  revisionId: "rev-9",
  outcome,
  testedAt: "2026-02-02T09:00:00Z",
  summary: parseTestSummary(json),
});

const makeLiveButton = () => screen.getByRole("button", { name: "Make live" });

describe("the panel renders at all", () => {
  it("shows a version row and a Make-live button", () => {
    // Floor. Every sweep below is a must-NOT assertion, and a component that rendered
    // nothing would satisfy all of them.
    renderHistory(evidenceFrom(CSV_PASS_SUMMARY_JSON, "passed"));
    expect(document.body.textContent).toContain("v9");
    expect(makeLiveButton()).toBeTruthy();
    expect(screen.getByTestId("revision-check-evidence")).toBeTruthy();
  });

  it("still unlocks Make live for a run that really passed", () => {
    // The other floor: a gate that refuses everything would clear every control below
    // while breaking the product.
    renderHistory(evidenceFrom(CSV_PASS_SUMMARY_JSON, "passed"));
    expect(makeLiveButton()).not.toBeDisabled();
    expect(document.body.textContent).toContain(ORIGINAL_HEADLINE);
  });
});

describe("THE DEFECT — a supplier with zero orders", () => {
  it("does not render the run as a pass", () => {
    renderHistory(evidenceFrom(ZERO_ORDER_SUMMARY_JSON, "not_exercised"));
    expect(passClaimsIn(renderedSurface())).toEqual([]);
  });

  it("never reproduces either sentence that shipped", () => {
    renderHistory(evidenceFrom(ZERO_ORDER_SUMMARY_JSON, "not_exercised"));
    const surface = renderedSurface();
    expect(surface).not.toContain(ORIGINAL_NOTICE);
    expect(surface).not.toContain(ORIGINAL_HEADLINE);
  });

  it("keeps Make live shut, and its tooltip says why without claiming a failure", () => {
    renderHistory(evidenceFrom(ZERO_ORDER_SUMMARY_JSON, "not_exercised"));
    const button = makeLiveButton();
    expect(button).toBeDisabled();
    const title = button.getAttribute("title") ?? "";
    expect(title).toContain("Put one order through for this supplier");
    expect(passClaimsIn(title)).toEqual([]);
    expect(title).not.toMatch(/\bfail(ed|s|ure)?\b/i);
  });

  it("does not render it as a failure either — nothing failed, nothing ran", () => {
    // The other half of the rule. "Your checks failed" sends the operator to debug a
    // version that may be perfectly fine, and it is not what happened.
    renderHistory(evidenceFrom(ZERO_ORDER_SUMMARY_JSON, "not_exercised"));
    const panel = within(screen.getByTestId("revision-check-evidence"));
    expect(panel.queryByText(/Checks failed/)).toBeNull();
    expect(document.body.textContent).toContain("Checks did not test this version");
  });

  it("names each leg as not run, rather than reporting each as passed", () => {
    renderHistory(evidenceFrom(ZERO_ORDER_SUMMARY_JSON, "not_exercised"));
    // Scoped to the evidence panel: `within` so a sentence elsewhere on the screen
    // cannot satisfy an assertion about this panel's own leg lines.
    const panel = screen.getByTestId("revision-check-evidence");
    const text = panel.textContent ?? "";
    expect(text).toContain("Recent orders rebuilt: not run");
    expect(text).toContain("Standards: not run");
    expect(text).toContain("Source files re-read: not run");
    expect(passClaimsIn(text)).toEqual([]);
  });

  it("carries the backend's own sentence saying what to do", () => {
    renderHistory(evidenceFrom(ZERO_ORDER_SUMMARY_JSON, "not_exercised"));
    expect(document.body.textContent).toContain(NO_ORDERS_NOTE);
  });

  it("is painted as neither green nor red", () => {
    renderHistory(evidenceFrom(ZERO_ORDER_SUMMARY_JSON, "not_exercised"));
    expect(screen.getByTestId("revision-check-evidence").getAttribute("data-outcome")).toBe(
      "not_exercised",
    );
  });
});

describe("an outcome this page cannot read falls to not-favourable", () => {
  // The standing rule (orderStatusManifest.ts): an unknown answer means "I cannot offer
  // an action here", never "carry on". Across this codebase an unrecognised value has
  // repeatedly fallen through to a success reading.
  const UNREADABLE: ReadonlyArray<{ outcome: string | null; why: string }> = [
    { outcome: "totally_new_outcome_value", why: "a value this page has never heard of" },
    { outcome: "", why: "an empty string" },
    { outcome: null, why: "no outcome at all — a backend older than BE PR 207" },
  ];

  it("covers every unreadable value", () => {
    expect(UNREADABLE).toHaveLength(3);
  });

  UNREADABLE.forEach(({ outcome, why }) => {
    it(`renders no pass and keeps Make live shut for ${JSON.stringify(outcome)} — ${why}`, () => {
      renderHistory(evidenceFrom(CSV_PASS_SUMMARY_JSON, outcome));
      // Deliberately paired with a summary whose LEGS all passed: the run's own outcome
      // is the authority, and a page that re-derived a verdict from the legs would call
      // this a pass. It must not.
      expect(verdictSurface().length).toBeGreaterThan(0);
      expect(passClaimsIn(verdictSurface())).toEqual([]);
      expect(makeLiveButton()).toBeDisabled();
      expect(document.body.textContent).toContain("Checks returned a result this page can't read");
    });
  });
});

describe("a standards check that does not exist for this format reads as a fact", () => {
  it("is not a pass, not a failure, and not a gap", () => {
    renderHistory(evidenceFrom(CSV_PASS_SUMMARY_JSON, "passed"));
    const text = screen.getByTestId("revision-check-evidence").textContent ?? "";
    // Not "skipped" — the word the old payload used and the pack then counted as a pass.
    expect(text).toContain("Standards: no such check for this setup");
    expect(text).not.toContain("Standards: passed");
    expect(text).not.toContain("Standards: failed");
    expect(text).not.toContain("Standards: skipped");
    // And it does not appear as something the operator failed to do.
    expect(text).not.toContain("Not proven here");
  });

  it("does not block a run whose load-bearing leg really ran", () => {
    // CSV, JSON and XML can never have a standards profile. Gating on that would strand
    // the most common supplier formats on a check nothing could ever satisfy.
    renderHistory(evidenceFrom(CSV_PASS_SUMMARY_JSON, "passed"));
    expect(makeLiveButton()).not.toBeDisabled();
  });
});

// ── Both wire shapes, side by side ───────────────────────────────────────────
//
// This frontend may deploy BEFORE the backend that carries PR 207, so it has to render
// honest copy for BOTH payloads. The pair below is the proof: the SAME situation — a
// supplier with no orders — expressed once in each shape.
//
// The legacy payload is the sharper of the two. Every leg says `passed: true` and the
// standards leg says `skipped: true`, and that is exactly what the old backend sent for
// a run that had executed nothing. A page that reads those booleans announces a pass.

/** The zero-order run as a PRE-PR-207 backend sends it: booleans, no `outcome`. */
const LEGACY_ZERO_ORDER_SUMMARY_JSON = JSON.stringify({
  replay: {
    passed: true,
    orderCount: 0,
    outputErrors: 0,
    outputChanged: 0,
    validationChanged: 0,
    note: "No orders exist for this supplier yet — replay pass-with-note.",
  },
  conformance: {
    skipped: true,
    passed: null,
    profile: null,
    errors: 0,
    warnings: 0,
    note: "No replayed output available to conformance-check.",
  },
  error: null,
  parseLeg: {
    passed: true,
    ordersReParsed: 0,
    parseChanges: 0,
    failures: 0,
    skipped: 0,
    note: "No orders exist for this supplier yet — nothing to re-parse.",
  },
});

describe("both wire shapes render honest copy", () => {
  const SHAPES: ReadonlyArray<{
    label: string;
    evidence: RevisionTestEvidence;
  }> = [
    {
      label: "PR 207 — every leg carries an `outcome`",
      evidence: evidenceFrom(ZERO_ORDER_SUMMARY_JSON, "not_exercised"),
    },
    {
      label: "pre-PR-207 — every leg carries `passed: true` and nothing else",
      evidence: {
        ...evidenceFrom(LEGACY_ZERO_ORDER_SUMMARY_JSON, null),
        // What the old endpoint really sent alongside it. `true` is the value that made
        // this a pass on screen.
        legacyPassed: true,
      },
    },
  ];

  it("covers both shapes", () => {
    // Anti-vacuity: one shape alone proves nothing about the ordering risk this pair
    // exists for.
    expect(SHAPES).toHaveLength(2);
  });

  it("the legacy payload really is the old shape, and the reader really sees it", () => {
    // Floor for the sweep below. If `parseTestSummary` silently dropped the booleans
    // there would be nothing to refuse, and "refused it" would be indistinguishable from
    // "never read it".
    const summary = parseTestSummary(LEGACY_ZERO_ORDER_SUMMARY_JSON)!;
    expect(summary.outcome).toBeNull();
    expect(summary.replay?.outcome).toBeNull();
    expect(summary.replay?.legacyPassed).toBe(true);
    expect(summary.conformance?.legacySkipped).toBe(true);
    expect(summary.parseLeg?.legacyPassed).toBe(true);
    expect(isLegacyTestPackPayload(summary)).toBe(true);
    // And the new shape is NOT mistaken for it.
    expect(isLegacyTestPackPayload(parseTestSummary(ZERO_ORDER_SUMMARY_JSON))).toBe(false);
  });

  SHAPES.forEach(({ label, evidence }) => {
    it(`renders no pass and keeps Make live shut — ${label}`, () => {
      renderHistory(evidence);
      expect(verdictSurface().length).toBeGreaterThan(0);
      expect(passClaimsIn(verdictSurface())).toEqual([]);
      expect(makeLiveButton()).toBeDisabled();
    });

    it(`renders no leg as passed — ${label}`, () => {
      renderHistory(evidence);
      const text = screen.getByTestId("revision-check-evidence").textContent ?? "";
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toContain("Recent orders rebuilt: passed");
      expect(text).not.toContain("Standards: passed");
      expect(text).not.toContain("Source files re-read: passed");
    });
  });

  it("says WHY it cannot read the legacy payload, rather than only that it cannot", () => {
    renderHistory(SHAPES[1].evidence);
    expect(document.body.textContent).toContain(
      "This result came from an earlier version of these checks",
    );
  });

  it("does not show that sentence for a payload it CAN read", () => {
    // The scaffolding must not leak into the ordinary case — otherwise deleting it later
    // would look like a copy regression.
    renderHistory(SHAPES[0].evidence);
    expect(document.body.textContent).not.toContain("earlier version of these checks");
  });
});

describe("a run with no evidence at all", () => {
  it("keeps Make live shut without inventing a verdict", () => {
    // Evidence is session state: it is null on first load, and `UpdateDraftAsync` nulls
    // the stored column on every content edit. `test` + no evidence is ordinary.
    renderHistory({ ...evidenceFrom(CSV_PASS_SUMMARY_JSON, "passed"), revisionId: "some-other-rev" });
    expect(makeLiveButton()).toBeDisabled();
    const surface = renderedSurface();
    expect(passClaimsIn(surface)).toEqual([]);
    expect(screen.queryByTestId("revision-check-evidence")).toBeNull();
  });
});

// ── The banner the hook writes ───────────────────────────────────────────────

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const CONNECTION: ConnectionDetail = {
  id: "conn-1",
  supplierId: "sup-1",
  name: "Acme connection",
  activeRevisionId: null,
  createdAt: "2026-02-01T00:00:00Z",
  updatedAt: "2026-02-01T00:00:00Z",
  revisions: REVISIONS,
};

beforeEach(() => {
  getConnection.mockReset().mockResolvedValue(CONNECTION);
  getConnectionRevision.mockReset().mockResolvedValue(null);
  markConnectionRevisionTest.mockReset();
});

/** Run the checks through the real hook and hand back the banner it wrote. */
async function noticeAfterTest(evidence: ConnectionTestEvidence) {
  markConnectionRevisionTest.mockResolvedValue(evidence);
  const { result } = renderHook(() => useConnectionRevisions("conn-1"), { wrapper });
  await waitFor(() => expect(result.current.revisions).toHaveLength(1));
  act(() => result.current.onTest("rev-9"));
  await waitFor(() => expect(result.current.notice).not.toBeNull());
  return result.current.notice!;
}

describe("the banner after running the checks", () => {
  it("says the pass sentence when the run really passed", () => {
    // Floor: without this the sweeps below are satisfied by a hook that never sets a
    // notice at all.
    return noticeAfterTest({
      outcome: "passed",
      passed: true,
      testedAt: "2026-02-02T09:00:00Z",
      summaryJson: CSV_PASS_SUMMARY_JSON,
    }).then((notice) => {
      expect(notice.text).toBe(ORIGINAL_NOTICE);
      expect(notice.kind).toBe("ok");
    });
  });

  it("THE DEFECT — makes no pass claim for a supplier with zero orders", async () => {
    // `passed: true` is set deliberately: it is what the OLD backend sent for this exact
    // payload, and reading it is the defect. The hook must read `outcome`.
    const notice = await noticeAfterTest({
      outcome: "not_exercised",
      passed: true,
      testedAt: "2026-02-02T09:00:00Z",
      summaryJson: ZERO_ORDER_SUMMARY_JSON,
    });
    expect(notice.text).not.toBe(ORIGINAL_NOTICE);
    expect(passClaimsIn(notice.text)).toEqual([]);
    expect(notice.kind).toBe("warn");
    expect(notice.text).toContain("Put one order through for this supplier");
  });

  it("makes no pass claim for an outcome it cannot read", async () => {
    const notice = await noticeAfterTest({
      outcome: "a_brand_new_outcome",
      passed: true,
      testedAt: "2026-02-02T09:00:00Z",
      summaryJson: CSV_PASS_SUMMARY_JSON,
    });
    expect(passClaimsIn(notice.text)).toEqual([]);
    expect(notice.kind).not.toBe("ok");
  });

  it("makes no pass claim when the backend sends no outcome at all", async () => {
    // A backend older than BE PR 207. `passed: true` is all it sends, and that value is
    // precisely the one that could mean "we tested nothing".
    const notice = await noticeAfterTest({
      passed: true,
      testedAt: "2026-02-02T09:00:00Z",
      summaryJson: '{"replay":{"passed":true,"orderCount":0,"outputErrors":0,"outputChanged":0,"validationChanged":0,"note":null},"conformance":null,"error":null}',
    });
    expect(passClaimsIn(notice.text)).toEqual([]);
    expect(notice.kind).not.toBe("ok");
  });

  it("falls back to the summary's own outcome when the envelope omits it", async () => {
    // A half-deployed backend. Both fields are written from the same value, so reading
    // the second is recovery, not a second opinion.
    const notice = await noticeAfterTest({
      passed: true,
      testedAt: "2026-02-02T09:00:00Z",
      summaryJson: ZERO_ORDER_SUMMARY_JSON,
    });
    expect(passClaimsIn(notice.text)).toEqual([]);
    expect(notice.kind).toBe("warn");
  });

  it("still says a failure is a failure", async () => {
    const notice = await noticeAfterTest({
      outcome: "failed",
      passed: false,
      testedAt: "2026-02-02T09:00:00Z",
      summaryJson: JSON.stringify({
        outcome: "failed",
        replay: { outcome: "failed", orderCount: 3, outputErrors: 2, outputChanged: 0, validationChanged: 0, note: null },
        conformance: { outcome: "not_applicable", profile: null, errors: 0, warnings: 0, note: null },
        error: null,
        parseLeg: { outcome: "passed", ordersReParsed: 3, parseChanges: 0, failures: 0, skipped: 0, note: null },
      }),
    });
    expect(notice.kind).toBe("err");
    expect(passClaimsIn(notice.text)).toEqual([]);
  });
});

describe("the banner's three tones are all reachable and distinct", () => {
  // `warn` had to be added: the type was `"ok" | "err"`, so a run that proved nothing
  // could only be painted as good news or as a breakage, and both are false.
  const TONES = ["ok", "warn", "err"] as const;

  it("renders each one", () => {
    for (const kind of TONES) {
      cleanup();
      render(<ConnectionNotice notice={{ text: `a ${kind} sentence`, kind }} />);
      const banner = screen.getByTestId("connection-notice");
      expect(banner.getAttribute("data-tone")).toBe(kind);
      expect(banner.textContent).toContain(`a ${kind} sentence`);
    }
  });

  it("paints them differently, so `warn` is not green by another name", () => {
    // Asserted against the tone table rather than the rendered node: every value here is
    // a `var(--token)`, and jsdom's CSS parser drops those, so `el.style.background` and
    // even the serialized `style` attribute read empty for ALL THREE — three empty
    // strings agreeing with each other is exactly the vacuous pass this suite is about.
    const backgrounds = TONES.map((kind) => NOTICE_TONE_STYLE[kind].background);
    expect(backgrounds.every((b) => typeof b === "string" && b.length > 0)).toBe(true);
    expect(new Set(backgrounds).size).toBe(3);
    // And specifically: the unproven state does not borrow the colour that means "fine".
    expect(NOTICE_TONE_STYLE.warn.background).not.toBe(NOTICE_TONE_STYLE.ok.background);
  });
});
