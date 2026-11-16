import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { DocumentSummary, Flow } from "@/lib/api/documents";
import { AddSheet } from "./AddSheet";
import { photoName } from "./PhotoCheck";
import { UploadQueueProvider } from "./UploadQueue";

const api = vi.hoisted(() => ({
  listFlows: vi.fn<() => Promise<Flow[]>>(),
  uploadDocument: vi.fn<(flowId: string, file: File) => Promise<DocumentSummary>>(),
  addDocument: vi.fn<(file: File) => Promise<DocumentSummary>>(),
}));
const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }), usePathname: () => "/documents" }));

const mount = (ui: ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UploadQueueProvider>{ui}</UploadQueueProvider>
    </QueryClientProvider>,
  );

const flow = (id: string, name: string, over: Partial<Flow> = {}): Flow => ({
  id, name, fieldsConfirmed: true, fields: { fields: [], tables: [] }, documentCount: 0, createdAt: "2026-11-01T10:00:00Z",
  automation: "review", scansOn: true, formatsOn: false, ...over,
});
const summary = (id: string, name: string): DocumentSummary => ({
  id, flowId: "f1", flowName: "Supplier invoices", fileName: name, status: "received", statusReason: null, pageCount: null,
  billingUnits: 1, failedChecks: 0, createdAt: "2026-11-15T09:00:00Z", source: "upload", sourceRef: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  URL.createObjectURL = vi.fn(() => "blob:photo");
  URL.revokeObjectURL = vi.fn();
});

describe("AddSheet", () => {
  it("offers a photo, a file or the photos, and sends a chosen file to the workspace", async () => {
    api.listFlows.mockResolvedValue([flow("f1", "Supplier invoices"), flow("f2", "Delivery notes")]);
    api.addDocument.mockResolvedValue(summary("d1", "a.pdf"));
    const onClose = vi.fn();
    const first = mount(<AddSheet onClose={onClose} />);
    const sheet = within(await screen.findByRole("dialog", { name: "Add a document" }));
    for (const name of ["Take a photo", "Choose a file", "Choose from your photos", "Close"]) expect(sheet.getByRole("button", { name })).toBeInTheDocument();
    expect(screen.getByTestId("sheet-photos-input")).toHaveAttribute("accept", "image/jpeg,image/png");
    fireEvent.change(screen.getByTestId("sheet-file-input"), { target: { files: [new File(["x"], "a.pdf")] } });
    await waitFor(() => expect(api.addDocument).toHaveBeenCalledWith(expect.objectContaining({ name: "a.pdf" })));
    expect(api.uploadDocument).not.toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/upload");
    expect(onClose).toHaveBeenCalledTimes(1);
    first.unmount();
    api.listFlows.mockResolvedValue([flow("f1", "Supplier invoices", { scansOn: false })]);
    mount(<AddSheet onClose={() => {}} />);
    const plain = within(await screen.findByRole("dialog", { name: "Add a document" }));
    expect(plain.queryByRole("button", { name: "Take a photo" })).toBeNull();
    expect(plain.queryByRole("button", { name: "Choose from your photos" })).toBeNull();
  });

  it("a photo checked in the sheet goes to the workspace, once, with no flow to choose", async () => {
    api.listFlows.mockResolvedValue([flow("f1", "Supplier invoices"), flow("f2", "Delivery notes")]);
    api.addDocument.mockResolvedValue(summary("d1", "photo.jpg"));
    const click = vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
    mount(<AddSheet onClose={() => {}} />);
    const sheet = within(await screen.findByRole("dialog", { name: "Add a document" }));
    expect(sheet.queryByRole("button", { name: /^Goes to/ })).toBeNull();
    const camera = screen.getByTestId("sheet-camera-input");
    expect(camera).toHaveAttribute("capture", "environment");
    fireEvent.click(sheet.getByRole("button", { name: "Take a photo" }));
    expect(click).toHaveBeenCalledTimes(1);
    const shoot = () => fireEvent.change(camera, { target: { files: [new File(["p"], "image.jpg", { type: "image/jpeg" })] } });
    shoot();
    let check = within(screen.getByRole("dialog", { name: "Check the photo" }));
    expect(check.getByRole("img", { name: "The photo you took" })).toHaveAttribute("src", "blob:photo");
    expect(check.getByText("Make sure the whole page is in the picture and the text is sharp.")).toBeInTheDocument();
    fireEvent.click(check.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("dialog", { name: "Add a document" })).toBeInTheDocument();
    shoot();
    check = within(screen.getByRole("dialog", { name: "Check the photo" }));
    fireEvent.click(check.getByRole("button", { name: "Retake" }));
    expect(click).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("dialog", { name: "Check the photo" })).toBeNull();   // the photo is discarded at once
    expect(screen.getByRole("dialog", { name: "Add a document" })).toBeInTheDocument();
    shoot();
    check = within(screen.getByRole("dialog", { name: "Check the photo" }));
    expect(check.queryByRole("button", { name: /^Change/ })).toBeNull();
    const use = check.getByRole("button", { name: "Use this photo" });
    fireEvent.click(use);
    fireEvent.click(use);
    await waitFor(() => expect(api.addDocument).toHaveBeenCalledTimes(1));
    expect(api.uploadDocument).not.toHaveBeenCalled();
    expect(api.addDocument.mock.calls[0][0].name).toMatch(/^photo-\d{8}-\d{6}\.jpg$/);
    expect(push).toHaveBeenCalledWith("/upload");
    expect(photoName(new Date(2026, 10, 15, 9, 3, 7), "image/png")).toBe("photo-20261115-090307.png");
  });

  it("offline, choosing a file closes the sheet without leaving the page", async () => {
    api.listFlows.mockResolvedValue([flow("f1", "Supplier invoices")]);
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const onClose = vi.fn();
    mount(<AddSheet onClose={onClose} />);
    await screen.findByRole("dialog", { name: "Add a document" });
    fireEvent.change(screen.getByTestId("sheet-file-input"), { target: { files: [new File(["x"], "a.pdf")] } });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    onLine.mockRestore();
  });
});
