import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { DocumentPage, DocumentRow, DocumentSummary, Flow, Inbox } from "@/lib/api/documents";
import { resetMockEngine } from "@/lib/api/mockEngine";
import type { BillingStatus } from "@/types/procurement";
import { PLAN_BY_ID } from "@/lib/plans";
import type { ComponentProps } from "react";
import type { HeldRecord } from "@/lib/pwa/heldUploads";
import { UploadQueueProvider } from "./UploadQueue";
import { UploadToFlow } from "./UploadToFlow";

// Every call answers from the mock engine unless a test says otherwise.
vi.mock("@/lib/api/core", async (orig) => ({ ...(await orig<typeof import("@/lib/api/core")>()), isApiMockMode: true }));
const api = vi.hoisted(() => ({
  listFlows: vi.fn<() => Promise<Flow[]>>(),
  addDocument: vi.fn<(file: File) => Promise<DocumentSummary>>(),
  listDocumentPage: vi.fn<(params: object) => Promise<DocumentPage>>(),
  sendDocument: vi.fn(),
  getInbox: vi.fn<() => Promise<Inbox>>(),
}));
const billing = vi.hoisted(() => ({ getBillingStatus: vi.fn<() => Promise<BillingStatus>>() }));
vi.mock("@/lib/api/documents", async (orig) => ({ ...(await orig<typeof import("@/lib/api/documents")>()), ...api }));
vi.mock("@/lib/api-client", () => billing);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
let search = "";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }), usePathname: () => "/upload", useSearchParams: () => new URLSearchParams(search) }));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("@/lib/api/linkedAccounts", () => ({ listLinkedAccounts: () => Promise.resolve({ available: false, accounts: [] }) }));

const mount = (queue: Omit<ComponentProps<typeof UploadQueueProvider>, "children"> = {}) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UploadQueueProvider {...queue}><UploadToFlow /></UploadQueueProvider>
    </QueryClientProvider>,
  );

const flow = (id: string, name: string, automation: Flow["automation"], over: Partial<Flow> = {}): Flow => ({
  id, name, fieldsConfirmed: true, fields: { fields: [], tables: [] }, documentCount: 0, createdAt: "2026-11-01T10:00:00Z",
  automation, scansOn: true, formatsOn: false, ...over,
});
const summary = (id: string, name: string): DocumentSummary => ({
  id, flowId: "f1", flowName: "Supplier invoices", fileName: name, status: "received", statusReason: null, pageCount: null,
  billingUnits: 1, failedChecks: 0, createdAt: "2026-11-15T09:00:00Z", source: "upload", sourceRef: null,
});
const row = (id: string, name: string, over: Partial<DocumentRow> = {}): DocumentRow => ({
  ...summary(id, name), number: null, sender: null, checks: [], sentAt: null, failedAt: null, stop: null, isSample: false, ...over,
});
const status = (over: Partial<BillingStatus> = {}): BillingStatus => ({
  plan: "growth", accountStatus: "active", ordersThisMonth: 112, orderLimit: 150, suppliersUsed: 0, supplierLimit: 5,
  trialStartedAt: null, trialEndsAt: null, isTrialExpired: false, isOrderLimitReached: false, isSupplierLimitReached: false,
  canProcessOrders: true, canAddSupplier: true, stripeCustomerId: null, stripeSubscriptionId: null, overageOrders: 0,
  overageAmountEur: 0, nearLimit: false, atLimit: false, ...over,
});
const drop = (files: File[]) => fireEvent.drop(screen.getByRole("region", { name: "Add files" }), { dataTransfer: { files } });

beforeEach(async () => {
  vi.resetAllMocks();
  search = "";
  resetMockEngine();
  const real = await vi.importActual<typeof import("@/lib/api/documents")>("@/lib/api/documents");
  api.listFlows.mockImplementation(() => real.listFlows());
  api.addDocument.mockImplementation(real.addDocument);
  api.listDocumentPage.mockImplementation(real.listDocumentPage);
  api.sendDocument.mockImplementation(real.sendDocument);
  api.getInbox.mockImplementation(real.getInbox);
  billing.getBillingStatus.mockResolvedValue(status());
});

describe("UploadToFlow", () => {
  it("says when shared files could not be kept", async () => {
    search = "shared=none";
    mount();
    expect(await screen.findByText("The shared files couldn't be kept on this phone. It keeps up to 10 files, 50 MB in all. Share fewer at a time, or add them from Add documents.")).toBeInTheDocument();
  });

  it("on a phone, says how to send a file by Mail to the workspace address, from the inbox answer it already has", async () => {
    const real = await vi.importActual<typeof import("@/lib/api/documents")>("@/lib/api/documents");
    api.getInbox.mockImplementation(async () => ({ ...(await real.getInbox()), address: "documents@in.example.test" }));
    mount();
    const card = await screen.findByRole("region", { name: "Or send them by email" });
    expect(within(card).getByText("On a phone: in any app, tap Share, choose Mail, and send the file to this address.")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Copy address" })).toBeInTheDocument();
    expect(api.getInbox).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ scansOn: false, formatsOn: false }, ".pdf,.csv,.xlsx"],
    [{ scansOn: true, formatsOn: true }, ".pdf,.csv,.xlsx,.png,.jpg,.jpeg,.docx,.txt,.xml,.cxml,.json,.edi,.x12"],
  ])("the file picker takes what the inbox answer says the workspace reads (%o)", async (switches, accept) => {
    const real = await vi.importActual<typeof import("@/lib/api/documents")>("@/lib/api/documents");
    api.getInbox.mockImplementation(async () => ({ ...(await real.getInbox()), ...switches }));
    mount();
    await screen.findByRole("region", { name: "Add files" });
    expect(screen.getByTestId("upload-files-input")).toHaveAttribute("accept", accept);
  });

  it("adds any document with no flow question, offers the workspace address, and says what each file turned out to be", async () => {
    const spy = { calls: [] as string[] };
    (window as { __mockEngine?: typeof spy }).__mockEngine = spy;
    mount();
    const zone = await screen.findByRole("region", { name: "Add files" });
    expect(screen.getByRole("heading", { level: 1, name: "Add documents" })).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Which flow is this for?" })).toBeNull();
    expect(zone).toHaveTextContent("Invoices, orders, delivery notes, statements: any document.");
    expect(zone).toHaveTextContent("PDF, Word, Excel, CSV or a photo of paper, up to 10 MB each.");
    const email = within(await screen.findByRole("region", { name: "Or send them by email" }));
    expect(email.getByText("documents-7f3a@inbound.example.test")).toBeInTheDocument();
    expect(email.getByRole("button", { name: "Copy address" })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("upload-files-input"), { target: { files: [new File(["a"], "invoice-2310.pdf"), new File(["b"], "scan-7.pdf")] } });
    const panel = within(await screen.findByRole("region", { name: "Just added" }));
    expect(panel.getByText("2 documents")).toBeInTheDocument();
    const row = (name: string) => within(panel.getByText(name).closest("li")!);
    await waitFor(() => expect(row("invoice-2310.pdf").getByText("An invoice from Example Supplier Ltd")).toBeInTheDocument(), { timeout: 8000 });
    expect(row("invoice-2310.pdf").getByRole("link", { name: "invoice-2310.pdf" }).getAttribute("href")).toMatch(/^\/flows\/flow-1\/documents\//);
    await waitFor(() => expect(row("scan-7.pdf").getByText("A document. The first of its kind here.")).toBeInTheDocument(), { timeout: 8000 });
    expect(row("scan-7.pdf").getByText("New kind")).toBeInTheDocument();
    expect(row("scan-7.pdf").getByText("Open")).toBeInTheDocument();
    expect(spy.calls.filter((c) => c === "GET /inbox")).toHaveLength(1);
    delete (window as { __mockEngine?: unknown }).__mockEngine;
  }, 20_000);

  it("with no flows, welcomes and shows no select; while the flows are unknown, never the welcome", { timeout: 20_000 }, async () => {
    const welcome = () => screen.queryByRole("heading", { level: 1, name: /Let's read your first document/ });
    api.listFlows.mockReturnValue(new Promise(() => {}));
    const loading = mount();
    expect(await screen.findByText("Loading flows…")).toBeTruthy();
    expect(welcome()).toBeNull();
    loading.unmount();
    api.listFlows.mockRejectedValue(new ApiHttpError("down", 500, null));
    const failed = mount();
    expect(await screen.findByRole("button", { name: "Try again" }, { timeout: 10_000 })).toBeTruthy();
    expect(welcome()).toBeNull();
    failed.unmount();
    api.listFlows.mockResolvedValue([]);
    mount();
    expect(await screen.findByRole("heading", { level: 1, name: /Let's read your first document/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose a file" })).toBeTruthy();
    expect(api.getInbox).not.toHaveBeenCalled();
  });

  it("draws no drop zone and no address until the inbox has answered, and offers Try again when it fails", async () => {
    api.getInbox.mockReturnValue(new Promise(() => {}));
    const waiting = mount();
    await waitFor(() => expect(api.getInbox).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Add files" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Or send them by email" })).toBeNull();
    waiting.unmount();
    api.getInbox.mockRejectedValue(new ApiHttpError("down", 500, null));
    mount();
    expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Add files" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Or send them by email" })).toBeNull();
  });

  it("shows each file's status where it was dropped, from one list request, and stops asking when nothing is being read", { timeout: 20_000 }, async () => {
    api.listFlows.mockResolvedValue([flow("f1", "Supplier invoices", "review")]);
    api.addDocument.mockImplementation((f: File) => Promise.resolve(summary(({ "a.pdf": "d1", "b.csv": "d2" } as Record<string, string>)[f.name] ?? "d3", f.name)));
    let read = false;
    api.listDocumentPage.mockImplementation(async () => ({ page: 1, pageSize: 100, totalCount: 2, sampleCount: 0, items: read
      ? [row("d2", "b.csv", { status: "ready" }), row("d1", "a.pdf", { status: "needs_review", failedChecks: 1, checks: ["low_confidence"] })]
      : [row("d3", "c.pdf", { status: "sent" }), row("d2", "b.csv", { status: "reading" }), row("d1", "a.pdf", { status: "reading" })] }));
    mount();
    await screen.findByRole("region", { name: "Add files" });
    drop([new File(["x"], "a.pdf"), new File(["y"], "b.csv"), new File(["z"], "c.pdf")]);
    const panel = within(await screen.findByRole("region", { name: "Just added" }));
    expect(panel.getByText("3 documents")).toBeInTheDocument();
    const item = (name: string) => within(panel.getByText(name).closest("li")!);
    await waitFor(() => expect(item("a.pdf").getByText("Reading")).toBeInTheDocument());
    await waitFor(() => expect(item("c.pdf").getByText("Sent")).toBeInTheDocument());
    read = true;
    await waitFor(() => expect(item("b.csv").getByRole("button", { name: "Send b.csv" })).toBeInTheDocument(), { timeout: 5000 });
    expect(item("a.pdf").getByText("1 value to check")).toBeInTheDocument();
    expect(item("a.pdf").getByRole("link", { name: "a.pdf" })).toHaveAttribute("href", "/flows/f1/documents/d1");
    expect(api.listDocumentPage.mock.calls.every(([p]) => JSON.stringify(p) === JSON.stringify({ page: 1, pageSize: 100 }))).toBe(true);
    const asked = api.listDocumentPage.mock.calls.length;
    await new Promise((r) => setTimeout(r, 2500));
    expect(api.listDocumentPage).toHaveBeenCalledTimes(asked);        // nothing is being read: no more requests
    expect(item("c.pdf").getByText("Sent")).toBeInTheDocument();       // off the page now: its last known status, never Received again
  });

  it("says when uploads are refused by the plan, with a way on, and how much of the allowance is used", async () => {
    const next = PLAN_BY_ID[PLAN_BY_ID.pilot.next!].name;            // derived, never typed
    api.listFlows.mockResolvedValue([flow("f1", "Supplier invoices", "review")]);
    billing.getBillingStatus.mockResolvedValue(status({ plan: "pilot", ordersThisMonth: 20, orderLimit: 20, canProcessOrders: false, isTrialExpired: true }));
    const first = mount();
    const paused = await screen.findByRole("alert");
    expect(paused).toHaveTextContent("Your trial has ended. You can still view previous documents, but new processing is paused.");
    expect(within(paused).getByRole("link", { name: `Upgrade to ${next}` })).toHaveAttribute("href", "/settings?tab=billing");
    expect(await screen.findByText(/^20 of 20 trial documents used\./)).toBeInTheDocument();
    first.unmount();
    billing.getBillingStatus.mockResolvedValue(status({ plan: "pilot", ordersThisMonth: 5, orderLimit: 20, canProcessOrders: true }));
    api.addDocument.mockRejectedValue(new ApiHttpError("ended", 429, { error: "pilot_expired", plan: "pilot", limit: 20, upgradeUrl: "/settings" }));
    const second = mount();
    await screen.findByText(/^5 of 20 trial documents used\./);
    await screen.findByRole("region", { name: "Add files" });
    expect(screen.queryByRole("alert")).toBeNull();
    drop([new File(["x"], "a.pdf")]);
    const panel = within(await screen.findByRole("region", { name: "Just added" }));
    expect(await panel.findByText("Your trial has ended, so new documents aren't being accepted.")).toBeInTheDocument();
    expect(panel.getByText("Not uploaded")).toBeInTheDocument();
    expect(panel.queryByRole("button", { name: /again$/ })).toBeNull();
    expect(await screen.findByRole("link", { name: `Upgrade to ${next}` })).toBeInTheDocument();
    second.unmount();
    billing.getBillingStatus.mockRejectedValue(new Error("down"));
    mount();
    await screen.findByRole("region", { name: "Add files" });
    expect(screen.queryByText(/documents used/)).toBeNull();            // unknown: no number
  });

  it("puts the first file of the visit above the drop zone, with focus on its list, and later files never take focus", async () => {
    mount();
    await screen.findByRole("region", { name: "Add files" });
    drop([new File(["x"], "invoice-2310.pdf")]);
    const heading = await screen.findByRole("heading", { name: "Just added" });
    expect(heading.compareDocumentPosition(screen.getByTestId("upload-drop")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await waitFor(() => expect(heading).toHaveFocus());
    const choose = screen.getByRole("button", { name: "Choose files" });
    choose.focus();
    drop([new File(["y"], "scan-7.pdf")]);
    expect(await screen.findByText("2 documents")).toBeInTheDocument();
    expect(choose).toHaveFocus();
  });

  it("a held row says it is waiting and can be removed", async () => {
    api.listFlows.mockResolvedValue([flow("f1", "Supplier invoices", "review")]);
    const kept = new Map<string, HeldRecord>();
    const store = {
      all: async () => [...kept.values()], put: async (r: HeldRecord) => void kept.set(r.key, r),
      remove: async (key: string) => void kept.delete(key), clear: async () => kept.clear(), claim: async () => () => {},
    };
    api.getInbox.mockResolvedValue({ flowId: "flow-inbox", address: null, intakeId: null, scansOn: true });
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    mount({ owner: { userId: "u-alex", orgId: "o-1" }, store });
    await screen.findByRole("region", { name: "Add files" });
    drop([new File(["x"], "delivery-note-78.jpg")]);
    const panel = within(await screen.findByRole("region", { name: "Just added" }));
    expect(await panel.findByText("Waiting for connection")).toBeInTheDocument();
    expect(panel.getByText("It uploads when you're back online.")).toBeInTheDocument();
    expect(panel.queryByText("Uploaded")).toBeNull();
    expect(kept.size).toBe(1);
    fireEvent.click(panel.getByRole("button", { name: "Remove delivery-note-78.jpg" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Just added" })).toBeNull());
    await waitFor(() => expect(kept.size).toBe(0));
    expect(api.addDocument).not.toHaveBeenCalled();
    onLine.mockRestore();
  });
});
