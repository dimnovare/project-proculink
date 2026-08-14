import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor, within } from "@testing-library/react";
import { PREVIEW_FORMATS } from "@/lib/api/types";
import { MapperPreviewPane } from "./MapperPreviewPane";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, VERBATIM (audit 2026-08-13 v3, P0-5).
//
// The live output preview's header chip read a green, ticked "Valid", gated on
// `content && !err` — "the transform endpoint returned a non-empty string and did not
// throw". Nothing else. It sat directly under "Live preview · {FORMAT}" and "exactly
// what {supplier} receives", on the screen an operator reads most, and it fired for
// CSV, JSON and XML, which have NO named standard profile at all
// (ConformanceService.ProfileForFormat: "Xml / Csv / Json are generic supplier
// templates with no named standard profile" → null).
//
// That is a stronger word than the real standards check uses ("Checks passed"), on
// strictly less evidence. `Valid` had zero test coverage in this repo — which is how it
// survived — so these tests assert the RENDERED SENTENCE, not the prop or the gate.
//
// THE DIRECTION THE NEXT INSTANCE COMES FROM. The regression is not "someone types
// Valid again"; it is a NEW verdict word appearing on this chip for a format that
// cannot support it. So the sweep below runs every entry in PREVIEW_FORMATS and refuses
// a fixed vocabulary of verdicts on all of them — a claim added for UBL's sake fails on
// CSV, which is the bar: whatever the chip says must be true for the WEAKEST format it
// renders on.
// ─────────────────────────────────────────────────────────────────────────────

const previewMappingOverride = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ previewMappingOverride }));

/** Words that assert an outcome the pane has no evidence for, in any casing. */
const VERDICT_WORDS = [
  "valid",
  "invalid",
  "passed",
  "passes",
  "conforms",
  "conformant",
  "compliant",
  "verified",
  "validated",
  "accepted",
  "approved",
  "checked",
];

/**
 * Render one pane and return queries scoped to THAT PANE, never to `document.body`.
 *
 * WHY SCOPED, not `screen` (2026-08-14). The sweep below mounts six panes in one test.
 * A vitest timeout abandons the test but CANNOT cancel its coroutine: the loop resumes
 * afterwards and calls `render()` again — into the NEXT test's document. Probed:
 *
 *   next-test START panes=0          ← afterEach(cleanup) ran; the DOM really was clean
 *   next-test after render panes=1   ← this test's own pane
 *   sweep rendered x12; panes=2      ← the abandoned sweep, rendering into this test
 *
 * With `screen`, that second pane turned every unique-match assertion here into "Found
 * multiple elements" — a failure that reads exactly like the production copy having been
 * duplicated, and sent at least one reader looking for a desktop/mobile branch that does
 * not exist in this component. `getAllByText` would "fix" it by accepting duplicates,
 * which is the one thing these assertions must never accept. Scoping keeps the assertion
 * at full strength — EXACTLY ONE match inside this pane — and makes it immune to whatever
 * else is in the body.
 *
 * Note `render()`'s own returned queries are NOT a substitute: they bind to `baseElement`
 * (document.body by default), i.e. they are `screen` with extra steps. `within(container)`
 * is the thing that actually scopes.
 */
function renderPane(format: string) {
  previewMappingOverride.mockResolvedValue({ format, content: "PO-1,ACM-BLT,4\n", error: null });
  const { container, unmount } = render(
    <MapperPreviewPane
      previewOrderId="ord-001"
      override={{} as never}
      lastTouched={null}
      supplierName="Nordmark"
    />,
  );
  return { pane: within(container), unmount };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  previewMappingOverride.mockReset();
});

describe("the live preview chip claims production, not validity (P0-5)", () => {
  it("covers every format the pane can render", () => {
    // ANTI-VACUITY. Each assertion below is satisfied for free by an empty format list,
    // and a sweep over nothing passing everything is the exact shape of the defect.
    expect(PREVIEW_FORMATS.length).toBe(6);
    expect(PREVIEW_FORMATS.map((f) => f.value)).toEqual(
      expect.arrayContaining(["csv", "json", "xml", "cxml", "ubl", "x12"]),
    );
  });

  it('says "Generated" once the document exists — the one fact `content && !err` proves', async () => {
    const { pane } = renderPane("csv");
    await waitFor(() => expect(pane.getByText("Generated")).toBeInTheDocument());
  });

  it(
    "never renders a verdict word on ANY format, including the three with no standard profile",
    async () => {
      for (const { value } of PREVIEW_FORMATS) {
        const { pane, unmount } = renderPane(value);
        // `finally`, because a mid-loop failure that leaves a pane mounted turns THIS
        // test's failure into a second, misleading failure in the next one.
        try {
          // TWO ANTI-VACUITY GUARDS, both learned the hard way while mutation-checking this
          // file. (1) Wait for the DOCUMENT, not for the chip's label: the header strip
          // renders long before the preview resolves, so sweeping it immediately passes with
          // no chip on screen at all — the sweep went green with "Valid" restored. (2) Anchor
          // the chip structurally, by the fact that it is the only element in the strip
          // carrying a `title`, never by the word it currently says. Querying it by label
          // would make the whole sweep throw-and-skip the moment someone renamed it back,
          // which is the one case this test exists for.
          await pane.findByText(/PO-1,ACM-BLT/);
          const heading = pane.getByText(/^Live preview · /);
          const header = heading.closest("div");
          expect(header, "the pane header must exist").not.toBeNull();
          expect(
            header?.querySelector("[title]"),
            `${value}: the chip must be inside the strip being swept`,
          ).not.toBeNull();

          const headerText = (header?.textContent ?? "").toLowerCase();
          expect(headerText, "the header must have been read, not empty").toContain("live preview");
          for (const word of VERDICT_WORDS) {
            expect(headerText, `${value} header must not claim "${word}"`).not.toContain(word);
          }
        } finally {
          unmount();
        }
      }
    },
    // BUDGET, not slack. This test mounts SIX panes; every sibling in this file mounts one
    // and costs ~490ms, all of it the pane's own 300ms preview debounce plus the waitFor
    // poll. Six of those measured 2953ms against vitest's 5000ms default — 2s of headroom,
    // which parallel load on Windows routinely eats, and the resulting timeout then leaks a
    // pane into the next test (see renderPane). The number below is 6× the real cost with
    // room for a loaded machine; it does not relax a single assertion above.
    30_000,
  );

  it("prints the denial on the screen rather than leaving it to a missing badge", async () => {
    const { pane } = renderPane("ubl");
    await waitFor(() => expect(pane.getByText("Generated")).toBeInTheDocument());
    // UBL is the STRONGEST case — it gained real OASIS XSD validation — and this pane
    // still runs no check, so the sentence holds there too.
    //
    // `getByText`, deliberately: the denial must appear EXACTLY ONCE in this pane. There is
    // no desktop/mobile split here to justify getAllByText — the sentence has one home, the
    // band under the format bar — and accepting duplicates is the failure mode this whole
    // file exists to catch. Scoped, so a stray pane elsewhere in the body can't force that.
    expect(
      pane.getByText(/nothing here has been checked against a standard/i),
    ).toBeInTheDocument();
    expect(
      pane.getByText(/Producing this document is not a check/i),
    ).toBeInTheDocument();
  });

  it("says the same thing for CSV, which has no standard to be checked against", async () => {
    const { pane } = renderPane("csv");
    await waitFor(() => expect(pane.getByText("Generated")).toBeInTheDocument());
    expect(
      pane.getByText(/nothing here has been checked against a standard/i),
    ).toBeInTheDocument();
  });

  it("claims nothing at all while the document is absent or the render failed", async () => {
    previewMappingOverride.mockResolvedValue({
      format: "csv",
      content: null,
      error: "Cannot transform: 2 lines still need review.",
    });
    const { container } = render(
      <MapperPreviewPane
        previewOrderId="ord-001"
        override={{} as never}
        lastTouched={null}
        supplierName="Nordmark"
      />,
    );
    const pane = within(container);
    await waitFor(() =>
      expect(pane.getByText(/lines still need review/i)).toBeInTheDocument(),
    );
    // Scoped matters MOST here: an unscoped queryByText("Generated") is satisfied by any
    // other pane in the body, so a leak would make this negative assertion fail loudly —
    // or, with the leak on the other foot, pass for the wrong pane's reasons.
    expect(pane.queryByText("Generated")).not.toBeInTheDocument();
  });
});
