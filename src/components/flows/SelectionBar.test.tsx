import { Blob as NodeBlob } from "node:buffer";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { unzipSync } from "fflate";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import type { ListedDocument } from "./DocumentList";
import { SelectionBar, sendLabel, type BarReport } from "./SelectionBar";

const api = vi.hoisted(() => ({ sendDocument: vi.fn(), fetchDocumentSource: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
const save = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock("@/lib/saveBlob", () => save);
// jsdom's Blob has no arrayBuffer(); a browser's does.
vi.stubGlobal("Blob", NodeBlob);

const doc = (n: number): ListedDocument => ({
  id: `doc-${n}`, flowId: "f1", flowName: "Invoices", fileName: `invoice-100${n}.pdf`, status: "ready", statusReason: null,
  pageCount: 1, billingUnits: 1, failedChecks: 0, createdAt: "2026-11-01T00:00:00Z", source: "upload", sourceRef: null,
});

/** The bar as the screen holds it: a document that went is unticked at once, and the result is kept outside the bar. */
function mount() {
  const onSent = vi.fn();
  function Harness() {
    const [selected, setSelected] = useState([doc(1), doc(2), doc(3)]);
    const [report, setReport] = useState<BarReport | null>(null);
    return <SelectionBar selected={selected} sent={new Set()} report={report} onReport={setReport} onClear={() => {}}
      onSent={(id) => { onSent(id); setSelected((s) => s.filter((d) => d.id !== id)); }} />;
  }
  const r = render(<QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>);
  const bar = within(screen.getByRole("region", { name: "3 documents selected" }));
  const press = (name: string) => act(async () => { fireEvent.click(bar.getByRole("button", { name })); });
  return { r, bar, onSent, press };
}

async function sendAll(answers: (unknown[] | Error)[]) {
  api.sendDocument.mockReset();
  for (const a of answers) {
    if (a instanceof Error) api.sendDocument.mockRejectedValueOnce(a);
    else api.sendDocument.mockResolvedValueOnce(a);
  }
  const m = mount();
  await m.press("Send all 3");
  return m;
}

describe("SelectionBar", () => {
  it("says which went and which did not and why, and stops on a workspace refusal", async () => {
    const invalid = new ApiHttpError("refused", 422, { error: "output_invalid" });
    const first = await sendAll([[], invalid, []]);
    await waitFor(() => expect(first.bar.getByRole("alert")).toHaveTextContent(`2 sent. invoice-1002.pdf couldn't be sent: ${documentRefusalMessage(invalid)}`));
    expect(first.onSent.mock.calls.map(([id]) => id)).toEqual(["doc-1", "doc-3"]);
    first.r.unmount();

    const second = await sendAll([[], new ApiHttpError("paused", 409, { error: "processing_paused" }), []]);
    await waitFor(() => expect(second.bar.getByRole("alert")).toHaveTextContent("1 sent. Processing is paused on this workspace. 2 documents weren't sent."));
    expect(api.sendDocument).toHaveBeenCalledTimes(2);
    expect(second.onSent.mock.calls.map(([id]) => id)).toEqual(["doc-1"]);

    expect([sendLabel(1, 1), sendLabel(2, 2), sendLabel(4, 4), sendLabel(3, 1), sendLabel(5, 3), sendLabel(2, 0)])
      .toEqual(["Send", "Send both", "Send all 4", "Send the ready one", "Send the 3 ready", null]);
  });

  it("speaks the result into live elements that were there, empty, from the start, and gives focus to it when everything went", async () => {
    api.sendDocument.mockReset().mockResolvedValue([]);
    const m = mount();
    const status = m.bar.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    expect(m.bar.getByRole("alert")).toBeEmptyDOMElement();
    m.bar.getByRole("button", { name: "Send all 3" }).focus();
    await m.press("Send all 3");
    await waitFor(() => expect(status).toHaveTextContent("3 documents are on their way."));
    expect(m.bar.getByRole("status")).toBe(status); // the same element, filled: not a new one
    expect(m.bar.queryByRole("button", { name: /Send/ })).toBeNull();
    expect(document.activeElement).toBe(status.parentElement);
    expect(status.parentElement).toHaveAttribute("tabindex", "-1");
  });

  it("downloads the ticked originals in documents.zip", async () => {
    api.fetchDocumentSource.mockReset().mockImplementation(async (id: string) => new Blob([id]));
    const m = mount();
    await m.press("Download files");
    await waitFor(() => expect(m.bar.getByRole("status")).toHaveTextContent("3 files downloaded in documents.zip."));
    const [zip, name] = save.saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe("documents.zip");
    expect(Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer())))).toEqual(["invoice-1001.pdf", "invoice-1002.pdf", "invoice-1003.pdf"]);
    expect(m.onSent).not.toHaveBeenCalled(); // a download unticks nothing
  });
});
