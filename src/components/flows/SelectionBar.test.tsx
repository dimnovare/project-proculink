import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { documentRefusalMessage } from "@/lib/documentRefusals";
import type { ListedDocument } from "./DocumentList";
import { SelectionBar, sendLabel } from "./SelectionBar";

const api = vi.hoisted(() => ({ sendDocument: vi.fn(), fetchDocumentSource: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const doc = (n: number): ListedDocument => ({
  id: `doc-${n}`, flowId: "f1", flowName: "Invoices", fileName: `invoice-100${n}.pdf`, status: "ready", statusReason: null,
  pageCount: 1, billingUnits: 1, failedChecks: 0, createdAt: "2026-11-01T00:00:00Z", source: "upload", sourceRef: null,
});

async function sendAll(answers: (unknown[] | Error)[]) {
  api.sendDocument.mockReset();
  for (const a of answers) {
    if (a instanceof Error) api.sendDocument.mockRejectedValueOnce(a);
    else api.sendDocument.mockResolvedValueOnce(a);
  }
  const onSent = vi.fn();
  // As the screen does: a document that went is unticked at once.
  function Harness() {
    const [selected, setSelected] = useState([doc(1), doc(2), doc(3)]);
    return <SelectionBar selected={selected} onClear={() => {}}
      onSent={(id) => { onSent(id); setSelected((s) => s.filter((d) => d.id !== id)); }} />;
  }
  const r = render(<QueryClientProvider client={new QueryClient()}><Harness /></QueryClientProvider>);
  const bar = within(screen.getByRole("region", { name: "3 documents selected" }));
  await act(async () => {
    fireEvent.click(bar.getByRole("button", { name: "Send all 3" }));
  });
  return { r, bar, onSent };
}

describe("SelectionBar", () => {
  it("says which went and which did not and why, and stops on a workspace refusal", async () => {
    const invalid = new ApiHttpError("refused", 422, { error: "output_invalid" });
    const first = await sendAll([[], invalid, []]);
    expect(await first.bar.findByRole("alert")).toHaveTextContent(`2 sent. invoice-1002.pdf couldn't be sent: ${documentRefusalMessage(invalid)}`);
    expect(first.onSent.mock.calls.map(([id]) => id)).toEqual(["doc-1", "doc-3"]);
    first.r.unmount();

    const second = await sendAll([[], new ApiHttpError("paused", 409, { error: "processing_paused" }), []]);
    expect(await second.bar.findByRole("alert")).toHaveTextContent("1 sent. Processing is paused on this workspace. 2 documents weren't sent.");
    expect(api.sendDocument).toHaveBeenCalledTimes(2);
    expect(second.onSent.mock.calls.map(([id]) => id)).toEqual(["doc-1"]);

    expect([sendLabel(1, 1), sendLabel(2, 2), sendLabel(4, 4), sendLabel(3, 1), sendLabel(5, 3), sendLabel(2, 0)])
      .toEqual(["Send", "Send both", "Send all 4", "Send the ready one", "Send the 3 ready", null]);
  });
});
