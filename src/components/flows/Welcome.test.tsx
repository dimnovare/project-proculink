import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { DocumentSummary, Flow } from "@/lib/api/documents";
import { COPY } from "@/lib/documentRefusals";
import { uploadRefusalMessage, UploadQueueProvider } from "./UploadQueue";
import { Welcome } from "./Welcome";

const api = vi.hoisted(() => ({
  createFlow: vi.fn<(name: string) => Promise<Flow>>(),
  uploadDocument: vi.fn<(flowId: string, file: File) => Promise<DocumentSummary>>(),
  createSampleDocument: vi.fn<(flowId: string) => Promise<DocumentSummary>>(),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
const analytics = vi.hoisted(() => ({ capture: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
const billing = vi.hoisted(() => ({ getBillingStatus: vi.fn() }));
vi.mock("@/lib/api-client", () => billing);
vi.mock("@/lib/api/linkedAccounts", () => ({ listLinkedAccounts: () => Promise.resolve({ available: false, accounts: [] }) }));
vi.mock("@/lib/analytics", () => analytics);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/documents" }));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: { firstName: "Alex" }, isLoaded: true }) }));

const emptyFlow: Flow = {
  id: "f-0", name: "New flow", fieldsConfirmed: false, fields: { fields: [], tables: [] }, documentCount: 0, createdAt: "2026-11-15T09:00:00Z",
  automation: "review", scansOn: true, formatsOn: false,
};
const summary: DocumentSummary = {
  id: "d-0", flowId: "f-0", flowName: "New flow", fileName: "po.pdf", status: "received", statusReason: null, pageCount: null,
  billingUnits: 1, failedChecks: 0, createdAt: "2026-11-15T09:00:00Z", source: "upload", sourceRef: null,
};
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <UploadQueueProvider>{children}</UploadQueueProvider>
  </QueryClientProvider>
);
const choose = (main: HTMLElement, file: File) => fireEvent.change(within(main).getByLabelText("Choose a file"), { target: { files: [file] } });

beforeEach(() => { vi.clearAllMocks(); billing.getBillingStatus.mockResolvedValue({ canProcessOrders: true }); });

describe("Welcome", () => {
  it("with processing paused, says so under the title and takes no file, photo or sample", async () => {
    billing.getBillingStatus.mockResolvedValue({ plan: "pilot", canProcessOrders: false, isTrialExpired: true, isOrderLimitReached: false });
    const main = render(<Welcome flows={[]} flowId={null} />, { wrapper }).container;
    expect(await within(main).findByText("Processing is paused, so new documents can't be read right now.")).toBeInTheDocument();
    expect(within(main).getByRole("alert")).toHaveTextContent("Your trial has ended.");
    for (const name of ["Choose a file", "Take a photo", "Use our sample invoice"]) expect(within(main).getByRole("button", { name })).toBeDisabled();
    choose(main, new File(["x"], "po.pdf", { type: "application/pdf" }));
    expect(api.createFlow).not.toHaveBeenCalled();
  });

  it("says why a file was refused, offers a way on, and reuses the flow it made", async () => {
    const unreadable = new ApiHttpError("x", 422, { error: "unreadable_file" });
    api.createFlow.mockResolvedValue({ ...emptyFlow, id: "f-new" });
    api.uploadDocument.mockRejectedValueOnce(unreadable).mockResolvedValueOnce({ ...summary, id: "d-1", flowId: "f-new" });
    // PageShell draws no <main> (the app layout does): the render's container stands for it.
    const main = render(<Welcome flows={[]} flowId={null} />, { wrapper }).container;
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent("Welcome, Alex. Let's read your first document.");
    const what = within(main).getByRole("heading", { name: "What is a flow?" }).closest("section")!.textContent;
    expect(what).toContain("We create your first flow from this document.");
    expect(what).not.toContain("We set this flow up from this document.");
    choose(main, new File(["x"], "po.pdf", { type: "application/pdf" }));
    expect(await within(main).findByText(`${uploadRefusalMessage(unreadable)} Choose another file.`)).toBeInTheDocument();
    choose(main, new File(["x"], "po.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/flows/new?step=check&flow=f-new&doc=d-1"));
    expect(api.createFlow).toHaveBeenCalledTimes(1);
    // On /flows/new the made flow is in the address before its file goes up, so a reload keeps the run's flow.
    expect(router.replace).toHaveBeenCalledWith("/flows/new?flow=f-new");
    expect(router.replace.mock.invocationCallOrder[0]).toBeLessThan(api.uploadDocument.mock.invocationCallOrder[0]);
    // A file the screen can already refuse never reaches the server.
    choose(main, new File(["x"], "notes.docx"));
    expect(within(main).getByText(COPY.unsupported_format)).toBeInTheDocument();
    expect(api.uploadDocument).toHaveBeenCalledTimes(2);
  });

  it("starts our sample once, says a paused workspace with its way on, and offers a photo only where it can be taken", async () => {
    let answer!: (d: DocumentSummary) => void;
    api.createSampleDocument
      .mockRejectedValueOnce(new ApiHttpError("x", 429, { error: "processing_paused" }))
      .mockReturnValueOnce(new Promise((r) => { answer = r; }));
    render(<Welcome flows={[{ ...emptyFlow, id: "f-1" }]} />, { wrapper });
    const box = within(screen.getByTestId("welcome-sample"));
    const sample = box.getByRole("button", { name: "Use our sample invoice" });
    fireEvent.click(sample);
    expect(await box.findByText(COPY.processing_paused)).toBeInTheDocument();
    expect(box.getByRole("link", { name: "Open Plan & billing" })).toHaveAttribute("href", "/settings?tab=billing");
    fireEvent.click(sample);
    await waitFor(() => expect(sample).toBeDisabled());
    fireEvent.click(sample);
    expect(box.getByText("Getting our sample invoice…")).toBeInTheDocument();
    expect(api.createFlow).not.toHaveBeenCalled();                     // R3: the unconfirmed empty flow is reused
    expect(api.createSampleDocument).toHaveBeenCalledTimes(2);
    answer({ ...summary, id: "d-s", flowId: "f-1" });
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/flows/new?step=check&flow=f-1&doc=d-s"));
    expect(analytics.capture).toHaveBeenCalledWith("first_upload_started", { file_kind: "sample" });
    expect(analytics.capture).toHaveBeenCalledWith("wizard_step_completed", { step: 1, step_name: "add", first: true });
    const drop = screen.getByTestId("welcome-drop");
    expect(within(drop).getByRole("button", { name: "Take a photo" }).className).toMatch(/\bsm:hidden\b/);
    expect(within(drop).getByRole("button", { name: "Choose a file" }).className).toMatch(/\bbg-brand-blue\b/);
  });

  it("on /flows/new another file stays in the run's flow, even once its fields are saved", async () => {
    const saved: Flow = { ...emptyFlow, id: "f-1", name: "Invoices", fieldsConfirmed: true, documentCount: 1 };
    api.uploadDocument.mockResolvedValue({ ...summary, id: "d-2", flowId: "f-1" });
    const main = render(<Welcome flows={[saved]} flowId="f-1" />, { wrapper }).container;
    choose(main, new File(["x"], "po.pdf", { type: "application/pdf" }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/flows/new?step=check&flow=f-1&doc=d-2"));
    expect(api.createFlow).not.toHaveBeenCalled();
    expect(api.uploadDocument.mock.calls[0][0]).toBe("f-1");
  });

  it("a later flow is told it is set up from this document, not the first", () => {
    const flows: Flow[] = [{ ...emptyFlow, id: "f-1", name: "Invoices", fieldsConfirmed: true, documentCount: 3 }, { ...emptyFlow, id: "f-2" }];
    render(<Welcome flows={flows} flowId="f-2" />, { wrapper });
    const what = screen.getByRole("heading", { name: "What is a flow?" }).closest("section")!.textContent;
    expect(what).toContain("We set this flow up from this document.");
    expect(what).not.toContain("your first flow");
  });
});
