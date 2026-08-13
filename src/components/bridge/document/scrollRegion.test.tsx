import { describe, it, expect, afterEach, vi } from "vitest";
import { cleanup, render as rtlRender, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { scrollRegionProps } from "./scrollRegion";
import { SourceDocumentBody } from "./SourceDocumentBody";
import type { SourceDocument } from "@/lib/sourceDocument";

afterEach(cleanup);

// jsdom's Blob has no `arrayBuffer()`. Without this the decode query REJECTS and the views
// render their honest "we couldn't read this" branch — which is correct behaviour, and would
// have made every assertion below fail for a reason that has nothing to do with the DOM under
// test. Every browser this ships to has had Blob.arrayBuffer for years, and the e2e suite
// exercises the real one.
if (typeof Blob.prototype.arrayBuffer !== "function") {
  Blob.prototype.arrayBuffer = function arrayBuffer(this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

/** The views decode their blob through TanStack Query, so they need a client. */
function render(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// pdf.js is ESM-only and rasterises to a canvas jsdom does not implement. The PDF branch is
// covered end to end in tests/e2e/mobile-order-scroll.spec.ts against a real browser; here it
// is stubbed so the sheet and text branches can be asserted without it.
vi.mock("./PdfDocumentView", () => ({
  PdfDocumentView: () => <div data-testid="pdf-stub" />,
}));

describe("scrollRegionProps", () => {
  it("makes a scrolling box a NAMED keyboard stop, not a bare one", () => {
    // `tabIndex` alone satisfies axe and announces as nothing. The name is the half of the fix
    // a checker cannot ask for.
    expect(scrollRegionProps("Original document", true)).toEqual({
      tabIndex: 0,
      role: "region",
      "aria-label": "Original document",
    });
  });

  it("adds nothing to a box that does not scroll", () => {
    // A dead tab stop is its own accessibility defect: the operator tabs into a box that does
    // not move and has no controls.
    expect(scrollRegionProps("Original document", false)).toEqual({});
  });
});

function csv(body = "PO,Line\nPO-1,1\n"): SourceDocument {
  return { blob: new Blob([body], { type: "text/csv" }), contentType: "text/csv", filename: "po.csv" };
}
function edi(): SourceDocument {
  return {
    blob: new Blob(["UNB+UNOC:3+A+B'\nBGM+220+PO-1+9'\n"], { type: "text/plain" }),
    contentType: "text/plain",
    filename: "po.edi",
  };
}

// The regression axe caught: a scrollable box whose entire content is inert (a canvas, a table
// of text, a list of lines) cannot be scrolled by keyboard at all, because there is nothing to
// Tab to. Reported as `scrollable-region-focusable`, serious, WCAG 2.1.1.
describe("every scrolling document view is reachable by keyboard", () => {
  it("the spreadsheet grid is a named region when the pane bounds it", async () => {
    render(<SourceDocumentBody cacheKey="ord-003" document={csv()} bounded />);
    const region = await screen.findByRole("region", { name: "Original document" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region.className).toContain("overflow-auto");
  });

  it("the spreadsheet grid stays reachable unbounded, where it pans sideways", async () => {
    // On a phone the grid is not vertically bounded, but a wide sheet still scrolls
    // horizontally — and panning it is exactly what a keyboard user needs to do.
    render(<SourceDocumentBody cacheKey="ord-003" document={csv()} bounded={false} />);
    const region = await screen.findByRole("region", { name: "Original document" });
    expect(region.className).toContain("overflow-x-auto");
  });

  it("names the sheet when a workbook has more than one", async () => {
    render(<SourceDocumentBody cacheKey="ord-003" document={csv()} bounded />);
    // A single-sheet CSV keeps the plain name — no invented tab label.
    expect(await screen.findByRole("region", { name: "Original document" })).toBeInTheDocument();
  });

  it("the numbered-lines view is a named region when bounded", async () => {
    render(<SourceDocumentBody cacheKey="ord-005" document={edi()} bounded />);
    const region = await screen.findByRole("region", { name: "Original document" });
    expect(region).toHaveAttribute("tabindex", "0");
  });

  it("the numbered-lines view is NOT a tab stop when it grows with its content", async () => {
    // Unbounded it has no scroller — <main> scrolls the page — so a focus stop would be dead.
    render(<SourceDocumentBody cacheKey="ord-005" document={edi()} bounded={false} />);
    await screen.findByTestId("source-document-text");
    expect(screen.queryByRole("region", { name: "Original document" })).not.toBeInTheDocument();
  });

  it("draws its focus ring inside the box, because the bounded shell clips", async () => {
    // `:focus-visible` is a 2px outline at `outline-offset: 2px`; the bounded Shell is
    // `overflow-hidden`, so an outward ring on a full-bleed child is clipped away. A ring
    // nobody can see is not keyboard access.
    render(<SourceDocumentBody cacheKey="ord-003" document={csv()} bounded />);
    const region = await screen.findByRole("region", { name: "Original document" });
    expect(region.className).toContain("focus-visible:[outline-offset:-2px]");
  });
});
