import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

import {
  RevisionStatusBadge,
  revisionStatusLabel,
} from "@/components/connections/RevisionStatusBadge";

// ─────────────────────────────────────────────────────────────────────────────
// The `test` badge stated a verdict it never read.
//
// THE DEFECT, verbatim. `RevisionStatusBadge.tsx` mapped
//     test: { label: "Tested", tone: "info", title: "Passed its checks — ready to make live." }
// and resolved it through `META[(status ?? "").toLowerCase()]`. The component's
// ONLY input is `status`. Nothing about pass or fail reaches it.
//
// WHY THAT IS WRONG, from the C# rather than from a frontend comment:
//   ProcuLink.Api/Services/SupplierConnectionService.cs:259  `rev.Status = "test";`
// runs at the end of `MarkTestAsync`, AFTER the pack, OUTSIDE any `if (passed)`.
// The pack's own exceptions are caught and converted to `passed = false`
// (:229-237), and the endpoint returns 200 with `Passed=false`
// (ConnectionsController.cs:277-291). `test` therefore means the checks RAN.
// A revision whose pack FAILED rendered "Passed its checks — ready to make
// live." next to a correctly-disabled Make-live button.
//
// WHY THE BADGE CANNOT SIMPLY READ THE TRUTH. The pass column exists
// (`test_passed`, SupplierConnectionRevision.cs:60-62) but is surfaced only on
// the full revision DTO (ConnectionDto.cs:23). The ROW shape this badge renders
// from — `ConnectionRevisionSummaryDto`, ConnectionDto.cs:15-17, mirrored by
// `ConnectionRevisionSummary` in src/lib/api/types.ts — has no such field, and
// neither does the replay result behind the other call site. Hence the repair is
// to stop claiming, not to start reading.
//
// WHY THESE TESTS READ `title` AND NOT ONLY `textContent`. The defect string was
// never text — it lived in the `title` attribute. `document.body.textContent`
// does not include attributes, so a guard written against textContent alone
// would have passed against the exact sentence it was meant to stop. Every
// assertion below runs over `renderedSurface()`: the text a user reads PLUS the
// tooltip text a user hovers. That is the whole surface the badge speaks with.
//
// ANTI-VACUITY. `PASS_CLAIM` is proven to flag the original sentence verbatim
// before it is trusted to clear anything, and the surface is floored against the
// label the real META table returns — so "the regex broke" and "the render
// produced nothing" cannot both read as green.
// ─────────────────────────────────────────────────────────────────────────────

afterEach(cleanup);

/**
 * Everything the badge says to a user: rendered text + every tooltip.
 * The defect lived in an attribute, so textContent alone is not the surface.
 */
function renderedSurface(): string {
  const text = document.body.textContent ?? "";
  const titles = Array.from(document.body.querySelectorAll<HTMLElement>("[title]"))
    .map((el) => el.getAttribute("title") ?? "")
    .join(" ");
  return `${text} ${titles}`.trim();
}

/** Wordings that assert the checks came back clean. */
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

/** The sentence that shipped. Kept verbatim — it is the thing being guarded. */
const ORIGINAL_DEFECT = "Passed its checks — ready to make live.";

function passClaimsIn(surface: string): string[] {
  return PASS_CLAIM.filter((re) => re.test(surface)).map(String);
}

describe("the pass-claim matcher is not vacuous", () => {
  it("flags the original defect sentence verbatim", () => {
    // Without this, a broken regex clears every case below and the suite is decoration.
    expect(passClaimsIn(ORIGINAL_DEFECT)).not.toHaveLength(0);
  });

  it("does not flag a neutral sentence", () => {
    // Guards the opposite failure: a matcher so broad it can never be satisfied.
    expect(passClaimsIn("A work-in-progress you're editing.")).toHaveLength(0);
  });

  it("would catch the defect where it actually lived — in the title attribute", () => {
    render(<span title={ORIGINAL_DEFECT}>Tested</span>);
    // textContent misses it entirely; this is why renderedSurface() exists.
    expect(document.body.textContent ?? "").not.toContain("Passed its checks");
    expect(passClaimsIn(renderedSurface())).not.toHaveLength(0);
  });
});

describe("RevisionStatusBadge — `test` states no verdict", () => {
  it("renders something, and renders the registry's own label", () => {
    // Floor. An empty render must not be able to satisfy the sweeps below.
    render(<RevisionStatusBadge status="test" />);
    const surface = renderedSurface();
    expect(surface.length).toBeGreaterThan(0);
    // Derived from the real META table, never hard-typed here — a hard-coded
    // literal in a test is how drift survives in this repo.
    expect(surface).toContain(revisionStatusLabel("test"));
  });

  it("makes no pass claim for a revision whose checks were merely RUN", () => {
    render(<RevisionStatusBadge status="test" />);
    expect(passClaimsIn(renderedSurface())).toEqual([]);
  });

  it("never reproduces the shipped sentence", () => {
    render(<RevisionStatusBadge status="test" />);
    expect(renderedSurface()).not.toContain(ORIGINAL_DEFECT);
    expect(renderedSurface()).not.toContain("Passed its checks");
  });
});

describe("must-flag controls — the states the badge cannot distinguish", () => {
  // `testPassed` is what the backend really stores for a `test` revision. The
  // badge receives NONE of it. These are the three values that column takes, and
  // the rendered surface must be safe under every one of them.
  //
  //   false → the pack ran and FAILED (SupplierConnectionService.cs:241)
  //   null  → never tested, OR a legacy row the migration never backfilled, OR
  //           evidence voided by a content edit — UpdateDraftAsync:191 nulls the
  //           column WITHOUT resetting Status, so `test` + null is an ordinary
  //           present-day state, not just a historical one.
  //   true  → the pack's verdict was true, which is still not a clean bill:
  //           :614-625 returns true with zero orders and zero assertions run,
  //           :703 counts a skipped conformance leg as a pass, and :648 passes
  //           the replay leg when one order of five renders.
  const CASES: ReadonlyArray<{ testPassed: boolean | null; why: string }> = [
    { testPassed: false, why: "the pack ran and failed" },
    { testPassed: null, why: "no evidence exists" },
    { testPassed: true, why: "the verdict was true but may be vacuous" },
  ];

  it("covers every value the column can hold", () => {
    // Anti-vacuity: `[].every()` is true, so an empty case list would pass the
    // sweep below against a badge shouting "Passed its checks" in the tooltip.
    expect(CASES).toHaveLength(3);
  });

  CASES.forEach(({ testPassed, why }) => {
    it(`renders no pass wording when testPassed is ${String(testPassed)} — ${why}`, () => {
      // A revision as the history list really holds it: status is the only field
      // that reaches the badge, whatever the stored evidence says.
      const revision = { versionNo: 7, status: "test", testPassed };
      render(<RevisionStatusBadge status={revision.status} />);

      const surface = renderedSurface();
      expect(surface.length).toBeGreaterThan(0);
      expect(passClaimsIn(surface)).toEqual([]);
    });
  });

  it("renders identically across all three — proving it holds no verdict", () => {
    // The sharpest statement of the rule. If the output ever DIFFERS by
    // testPassed, the badge has started reading a signal, and these controls
    // must be rewritten to check it is read correctly rather than not at all.
    const surfaces = CASES.map(({ testPassed }) => {
      const revision = { status: "test", testPassed };
      render(<RevisionStatusBadge status={revision.status} />);
      const s = renderedSurface();
      cleanup();
      return s;
    });

    expect(surfaces[0].length).toBeGreaterThan(0);
    expect(new Set(surfaces).size).toBe(1);
  });
});

describe("no other lifecycle state claims a pass either", () => {
  // `published` is the one state a success reading would be defensible for, and
  // it still must not borrow the checks' voice: publishing is gated on evidence
  // server-side (SupplierConnectionService.cs:285), but this badge did not read
  // that either. It reports what orders are doing, not what a pack concluded.
  const STATUSES = ["draft", "test", "published", "archived"] as const;

  it("sweeps a non-empty status set", () => {
    expect(STATUSES.length).toBe(4);
  });

  STATUSES.forEach((status) => {
    it(`makes no pass claim for \`${status}\``, () => {
      render(<RevisionStatusBadge status={status} />);
      const surface = renderedSurface();
      expect(surface).toContain(revisionStatusLabel(status));
      expect(passClaimsIn(surface)).toEqual([]);
    });
  });

  it("does not turn an unrecognised status into a verdict", () => {
    // Across this codebase an unknown value has repeatedly fallen through to a
    // success reading. Here it must stay neutral and silent.
    render(<RevisionStatusBadge status="some_status_we_do_not_know" />);
    const surface = renderedSurface();
    expect(passClaimsIn(surface)).toEqual([]);
    expect(surface).not.toContain("Passed its checks");
  });

  it("does not turn an empty status into a verdict", () => {
    render(<RevisionStatusBadge status="" />);
    expect(passClaimsIn(renderedSurface())).toEqual([]);
  });
});
