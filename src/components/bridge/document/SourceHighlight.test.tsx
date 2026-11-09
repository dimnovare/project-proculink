import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import type { DocumentDetail, SourceLocation } from "@/lib/api/documents";
import { ReadValuesPanel } from "@/components/flows/ReadValuesPanel";
import { SourceDocumentBody } from "./SourceDocumentBody";
import { PdfDocumentView } from "./PdfDocumentView";

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "x" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 3,
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve(), cancel() {} }),
      }),
    }),
  }),
}));

afterEach(cleanup);
beforeAll(() => {
  URL.createObjectURL ??= () => "blob:photo";
  URL.revokeObjectURL ??= () => {};
});

const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.05 };
const location: SourceLocation = { page: 1, box, address: null };
const NL = String.fromCharCode(10);
const TXT = ["a", "Total 5", ""].join(NL);
const CSV = ["Item,Total", "Bolt,5"].join(NL);
const qc = new QueryClient();
const wrap = (ui: ReactNode) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;

function Screen({ file, loc = location }: { file?: { blob: Blob; contentType: string; filename: string }; loc?: SourceLocation } = {}) {
  const [spot, setSpot] = useState<SourceLocation | null>(null);
  const detail = {
    summary: { id: "d1" }, checks: [], read: { tables: [], truncated: false, kindLabel: null, fields: [
      { key: "po", label: "PO number", value: "PO-1", type: "text", meaning: null, confidence: 0.9, location: loc, notOnPage: false, listed: true, edited: false },
    ] },
  } as unknown as DocumentDetail;
  const document = file ?? { blob: new Blob(["x"], { type: "image/png" }), contentType: "image/png", filename: "photo.png" };
  return (
    <>
      <div data-testid="original"><SourceDocumentBody cacheKey="d" document={document} bounded={false} highlight={spot} /></div>
      <div data-testid="values"><ReadValuesPanel detail={detail} editable onLocate={setSpot} /></div>
    </>
  );
}

describe("highlight", () => {
  it("hovering a read value highlights its box on the image", async () => {
    render(wrap(<Screen />));
    const original = within(screen.getByTestId("original"));
    await original.findByRole("img", { name: "photo.png" });
    const row = within(screen.getByTestId("values")).getByLabelText("PO number").closest("div")!;
    fireEvent.mouseEnter(row);
    const mark = original.getByTestId("source-highlight");
    expect(mark.style.left).toBe("10%");
    expect(mark.style.top).toBe("20%");
    fireEvent.mouseLeave(row);
    expect(original.queryByTestId("source-highlight")).toBeNull();
  });

  it("the PDF view turns to the highlighted page", async () => {
    const blob = new Blob(["%PDF"], { type: "application/pdf" });
    blob.arrayBuffer = async () => new ArrayBuffer(4); // jsdom Blob lacks arrayBuffer
    const { rerender, container } = render(wrap(<PdfDocumentView cacheKey="p" blob={blob} bounded={false} />));
    await screen.findByText("Page 1 of 3");
    rerender(wrap(<PdfDocumentView cacheKey="p" blob={blob} bounded={false} highlight={{ page: 3, box, address: null }} />));
    await screen.findByText("Page 3 of 3");
    expect(within(container).getByTestId("source-highlight")).toBeTruthy();
  });

  it("the PDF page is sized to its row, not to the highlight wrapper", async () => {
    const width = vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
      return this.classList.contains("justify-center") ? 800 : 300;
    });
    try {
      const blob = new Blob(["%PDF"], { type: "application/pdf" });
      blob.arrayBuffer = async () => new ArrayBuffer(4);
      render(wrap(<PdfDocumentView cacheKey="row" blob={blob} bounded={false} />));
      const canvas = await screen.findByTestId("source-document-pdf-canvas");
      await vi.waitFor(() => expect(canvas.style.width).toBe("800px"));
    } finally {
      width.mockRestore();
    }
  });

  it("hovering a value read from a text line highlights that line", async () => {
    const blob = new Blob([TXT], { type: "text/plain" });
    blob.arrayBuffer = async () => new TextEncoder().encode(TXT).buffer as ArrayBuffer;
    render(wrap(<Screen file={{ blob, contentType: "text/plain", filename: "a.txt" }} loc={{ page: null, box: null, address: "line:2" }} />));
    const original = within(screen.getByTestId("original"));
    const items = await original.findAllByRole("listitem");
    fireEvent.mouseEnter(within(screen.getByTestId("values")).getByLabelText("PO number").closest("div")!);
    expect(items[1].getAttribute("data-highlighted")).toBe("true");
    expect(items[0].getAttribute("data-highlighted")).toBeNull();
  });

  it("hovering a value read from a cell highlights that cell", async () => {
    const blob = new Blob([CSV], { type: "text/csv" });
    blob.arrayBuffer = async () => new TextEncoder().encode(CSV).buffer as ArrayBuffer;
    render(wrap(<Screen file={{ blob, contentType: "text/csv", filename: "a.csv" }} loc={{ page: null, box: null, address: "cell:r2c2" }} />));
    const original = within(screen.getByTestId("original"));
    const cell = await original.findByText("5");
    expect(cell.getAttribute("data-highlighted")).toBeNull();
    fireEvent.mouseEnter(within(screen.getByTestId("values")).getByLabelText("PO number").closest("div")!);
    expect(cell.getAttribute("data-highlighted")).toBe("true");
    expect(cell.className).toContain("bg-brand-blue-soft");
    expect(original.getByText("Bolt").getAttribute("data-highlighted")).toBeNull();
  });
});
