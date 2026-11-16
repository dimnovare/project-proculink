import { describe, it, expect, afterEach, beforeAll, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import type { DocumentDetail, SourceLocation } from "@/lib/api/documents";
import { ReadValuesPanel } from "@/components/flows/ReadValuesPanel";
import { useDocumentEdits } from "@/hooks/useDocumentEdits";
import { reviewMarks } from "@/lib/reviewMarks";
import { SourceDocumentBody } from "./SourceDocumentBody";
import { SpotButtons, SpotsContext } from "./SourceHighlight";
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
  const edits = useDocumentEdits("d1");
  const document = file ?? { blob: new Blob(["x"], { type: "image/png" }), contentType: "image/png", filename: "photo.png" };
  return (
    <>
      <div data-testid="original"><SourceDocumentBody cacheKey="d" document={document} bounded={false} highlight={spot} /></div>
      <div data-testid="values"><ReadValuesPanel detail={detail} editable edits={edits} marks={reviewMarks(detail, true)} onLocate={setSpot} /></div>
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
      return this.hasAttribute("data-pdf-row") ? 800 : 300;
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

  it("draws amber marks on the original, only on the page that holds them", async () => {
    const image = { blob: new Blob(["x"], { type: "image/png" }), contentType: "image/png", filename: "photo.png" };
    const marks: SourceLocation[] = [{ page: 1, box, address: null }, { page: 2, box, address: null }];
    render(wrap(<div data-testid="image"><SourceDocumentBody cacheKey="m-img" document={image} bounded={false} marks={marks} /></div>));
    const imageView = screen.getByTestId("image");
    await within(imageView).findByRole("img", { name: "photo.png" });

    const sheet = ["Supplier,Currency", "Example Supplier Ltd,EUR"].join(NL);
    const blob = new Blob([sheet], { type: "text/csv" });
    blob.arrayBuffer = async () => new TextEncoder().encode(sheet).buffer as ArrayBuffer;
    render(wrap(<div data-testid="sheet"><SourceDocumentBody cacheKey="m-csv" document={{ blob, contentType: "text/csv", filename: "a.csv" }} bounded={false} marks={[{ page: null, box: null, address: "cell:r2c1" }]} /></div>));
    const sheetView = screen.getByTestId("sheet");
    await within(sheetView).findByText("Example Supplier Ltd");

    expect(within(imageView).getAllByTestId("source-mark")).toHaveLength(1);
    expect(within(sheetView).getByRole("cell", { name: "Example Supplier Ltd" })).toHaveAttribute("data-marked");
    expect(within(sheetView).getByRole("cell", { name: "EUR" })).not.toHaveAttribute("data-marked");
  });
});

describe("the places of the values, as things to click", () => {
  it("draws the largest box first so a box inside it can be reached, keeps to its page, and goes to the value clicked", () => {
    const go = vi.fn();
    const at = (page: number | null, x: number, width: number) => ({ page, address: null, box: { x, y: 0.1, width, height: 0.1 } }) as SourceLocation;
    const spots = [
      { key: "field:postcode", label: "Postcode", location: at(1, 0.2, 0.1) },
      { key: "field:address", label: "Address", location: at(1, 0.1, 0.6) },       // contains the postcode, and comes later
      { key: "field:total", label: "Total", location: at(2, 0.1, 0.2) },
      { key: "field:stamp", label: "Stamp", location: at(null, 0.1, 0.05) },        // no page: a picture's, never a PDF page's
    ];
    const draw = (exact: boolean) => render(<SpotsContext.Provider value={{ spots, go }}><SpotButtons page={1} exact={exact} /></SpotsContext.Provider>);
    const pdf = draw(true);
    expect(screen.getAllByRole("button", { hidden: true }).map((b) => b.getAttribute("aria-label"))).toEqual(["Go to Address", "Go to Postcode"]);
    fireEvent.click(screen.getByLabelText("Go to Postcode"));
    expect(go).toHaveBeenCalledWith("field:postcode");
    pdf.unmount();
    draw(false);
    expect(screen.getAllByRole("button", { hidden: true }).map((b) => b.getAttribute("aria-label"))).toEqual(["Go to Address", "Go to Postcode", "Go to Stamp"]);
  });
});
