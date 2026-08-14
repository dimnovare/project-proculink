import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

function renderPane(format: string) {
  previewMappingOverride.mockResolvedValue({ format, content: "PO-1,ACM-BLT,4\n", error: null });
  return render(
    <MapperPreviewPane
      previewOrderId="ord-001"
      override={{} as never}
      lastTouched={null}
      supplierName="Nordmark"
    />,
  );
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
    renderPane("csv");
    await waitFor(() => expect(screen.getByText("Generated")).toBeInTheDocument());
  });

  it("never renders a verdict word on ANY format, including the three with no standard profile", async () => {
    for (const { value } of PREVIEW_FORMATS) {
      const { unmount } = renderPane(value);

      // TWO ANTI-VACUITY GUARDS, both learned the hard way while mutation-checking this
      // file. (1) Wait for the DOCUMENT, not for the chip's label: the header strip
      // renders long before the preview resolves, so sweeping it immediately passes with
      // no chip on screen at all — the sweep went green with "Valid" restored. (2) Anchor
      // the chip structurally, by the fact that it is the only element in the strip
      // carrying a `title`, never by the word it currently says. Querying it by label
      // would make the whole sweep throw-and-skip the moment someone renamed it back,
      // which is the one case this test exists for.
      await screen.findByText(/PO-1,ACM-BLT/);
      const heading = screen.getByText(/^Live preview · /);
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
      unmount();
    }
  });

  it("prints the denial on the screen rather than leaving it to a missing badge", async () => {
    renderPane("ubl");
    await waitFor(() => expect(screen.getByText("Generated")).toBeInTheDocument());
    // UBL is the STRONGEST case — it gained real OASIS XSD validation — and this pane
    // still runs no check, so the sentence holds there too.
    expect(
      screen.getByText(/nothing here has been checked against a standard/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Producing this document is not a check/i),
    ).toBeInTheDocument();
  });

  it("says the same thing for CSV, which has no standard to be checked against", async () => {
    renderPane("csv");
    await waitFor(() => expect(screen.getByText("Generated")).toBeInTheDocument());
    expect(
      screen.getByText(/nothing here has been checked against a standard/i),
    ).toBeInTheDocument();
  });

  it("claims nothing at all while the document is absent or the render failed", async () => {
    previewMappingOverride.mockResolvedValue({
      format: "csv",
      content: null,
      error: "Cannot transform: 2 lines still need review.",
    });
    render(
      <MapperPreviewPane
        previewOrderId="ord-001"
        override={{} as never}
        lastTouched={null}
        supplierName="Nordmark"
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(/lines still need review/i)).toBeInTheDocument(),
    );
    expect(screen.queryByText("Generated")).not.toBeInTheDocument();
  });
});
