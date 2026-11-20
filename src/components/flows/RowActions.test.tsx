import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { DocumentFile } from "@/lib/api/documents";
import type { ListedDocument } from "./DocumentList";
import { RowActions, removalDialog } from "./RowActions";

const api = vi.hoisted(() => ({ sendDocument: vi.fn(), deleteDocument: vi.fn(), retryDocumentRead: vi.fn(), downloadDeliveryFile: vi.fn(), getInbox: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
const confirm = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/confirm", () => ({ useConfirm: () => confirm }));

const doc = (over: Partial<ListedDocument> = {}): ListedDocument => ({
  id: "d1", flowId: "f1", flowName: "invoices", fileName: "invoice-1042.pdf", status: "needs_review", statusReason: null,
  pageCount: 1, billingUnits: 1, failedChecks: 1, createdAt: "2026-11-20T10:00:00Z", source: "upload", sourceRef: null,
  inInbox: false, canRemove: true, ...over,
});
const file = (over: Partial<DocumentFile> = {}): DocumentFile => ({ deliveryId: "v1", fileName: "invoice-1042.csv", delivered: false, destination: null, ...over });

const draw = (d: ListedDocument, onRemoved = vi.fn()) =>
  render(<QueryClientProvider client={new QueryClient()}><RowActions d={d} sendable onSent={() => {}} onRemoved={onRemoved} /></QueryClientProvider>);
/** What a row offers, in order: its buttons, links and the drawn-only Review/Open. */
const offers = (d: ListedDocument) => {
  const { container, unmount } = draw(d);
  const out = [...container.querySelectorAll("button, a, span[aria-hidden]")].map((e) => `${e.tagName === "A" ? "link:" : ""}${e.textContent}`);
  unmount();
  return out;
};

beforeEach(() => vi.clearAllMocks());

describe("RowActions", () => {
  it("gives each state its buttons", () => {
    expect(offers(doc({ status: "sent", files: [file()] }))).toEqual(["Download"]);
    expect(offers(doc({ status: "sent", files: [file({ delivered: true, destination: "Accounting folder" })] }))).toEqual(["Download a copy"]);
    expect(offers(doc({ status: "sent", files: [file(), file({ deliveryId: "v2", fileName: "invoice-1042.xml" })] }))).toEqual(["link:Download"]);
    expect(offers(doc())).toEqual(["Review"]);
    expect(offers(doc({ statusReason: "duplicate_file" }))).toEqual(["Remove", "Read it anyway"]);
    expect(offers(doc({ status: "read_failed", statusReason: "ai_error" }))).toEqual(["Try again", "Remove"]);
    expect(offers(doc({ status: "ready", downloadOnly: true }))).toEqual(["Make the file"]);
    expect(offers(doc({ status: "ready", downloadOnly: false }))).toEqual(["Send"]);
    // The server said this person may not remove it: no Remove.
    expect(offers(doc({ status: "read_failed", statusReason: "ai_error", canRemove: false }))).toEqual(["Try again"]);
  });

  it("a removal answered 404 drops the row without an error", async () => {
    api.deleteDocument.mockRejectedValue(new ApiHttpError("gone", 404, { error: "document_not_found" }));
    confirm.mockResolvedValue(true);
    const onRemoved = vi.fn();
    draw(doc({ statusReason: "duplicate_file" }), onRemoved);
    fireEvent.click(screen.getByRole("button", { name: "Remove invoice-1042.pdf" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalledWith("d1"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("asks before removing, and says a read document still counts", () => {
    const counted = removalDialog([{ fileName: "invoice-1043.pdf", countsThisMonth: true }]);
    expect(counted.title).toBe("Remove invoice-1043.pdf?");
    const text = (d: ReturnType<typeof removalDialog>) => render(<p>{d.description}</p>).container.textContent;
    expect(text(counted)).toContain("We already read it, so it still counts toward your plan's documents.");
    expect(text(removalDialog([{ fileName: "invoice-1043.pdf", countsThisMonth: false }]))).not.toContain("We already read it");
    // Ticked documents only an admin may remove stay, and the dialog says so.
    expect(text(removalDialog([{ fileName: "invoice-1043.pdf" }], 2))).toContain("2 of the ticked documents can only be removed by an admin, so they stay.");
  });
});
