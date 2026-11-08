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
const qc = new QueryClient();
const wrap = (ui: ReactNode) => <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;

function Screen() {
  const [spot, setSpot] = useState<SourceLocation | null>(null);
  const detail = {
    summary: { id: "d1" }, checks: [], read: { tables: [], truncated: false, kindLabel: null, fields: [
      { key: "po", label: "PO number", value: "PO-1", type: "text", meaning: null, confidence: 0.9, location, notOnPage: false, listed: true, edited: false },
    ] },
  } as unknown as DocumentDetail;
  const document = { blob: new Blob(["x"], { type: "image/png" }), contentType: "image/png", filename: "photo.png" };
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
});
