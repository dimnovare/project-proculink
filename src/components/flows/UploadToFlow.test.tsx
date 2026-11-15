import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { DocumentPage, DocumentRow, DocumentSummary, Flow } from "@/lib/api/documents";
import type { BillingStatus } from "@/types/procurement";
import { LAST_FLOW_KEY } from "@/lib/lastFlow";
import { PLAN_BY_ID } from "@/lib/plans";
import { UploadQueueProvider } from "./UploadQueue";
import { UploadToFlow } from "./UploadToFlow";

const api = vi.hoisted(() => ({
  listFlows: vi.fn<() => Promise<Flow[]>>(),
  uploadDocument: vi.fn<(flowId: string, file: File) => Promise<DocumentSummary>>(),
  listDocumentPage: vi.fn<(params: object) => Promise<DocumentPage>>(),
  sendDocument: vi.fn(),
}));
const billing = vi.hoisted(() => ({ getBillingStatus: vi.fn<() => Promise<BillingStatus>>() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/lib/api-client", () => billing);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/upload" }));

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UploadQueueProvider><UploadToFlow /></UploadQueueProvider>
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

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  billing.getBillingStatus.mockResolvedValue(status());
});

describe("UploadToFlow", () => {
  it("chooses the last flow used, lists every flow with how it delivers, and says where the files go", async () => {
    localStorage.setItem(LAST_FLOW_KEY, "f2");
    api.listFlows.mockResolvedValue([flow("f1", "Supplier invoices", "review"), flow("f2", "Delivery notes", "auto")]);
    const first = mount();
    const group = within(await screen.findByRole("group", { name: "Which flow is this for?" }));
    expect(group.getByRole("radio", { name: /^Delivery notes\s*Last used\s*Automatic delivery: each document is sent as soon as it is read\.$/ })).toBeChecked();
    expect(group.getByRole("radio", { name: /^Supplier invoices\s*Review before delivery: you check each document before it is sent\.$/ })).not.toBeChecked();
    const zone = screen.getByRole("region", { name: "Add files" });
    expect(zone).toHaveTextContent("Each file becomes its own document. PDF, Excel or CSV, or photos of paper documents. Up to 10 MB each.");
    expect(zone).toHaveTextContent("They go to Delivery notes.");
    expect(within(zone).getByLabelText("Choose files")).toHaveAttribute("accept", ".pdf,.csv,.xlsx,.png,.jpg,.jpeg");
    fireEvent.click(group.getByRole("radio", { name: /^Supplier invoices/ }));
    expect(zone).toHaveTextContent("They go to Supplier invoices.");
    expect(screen.getByRole("link", { name: "A new kind of document? Set up a new flow" })).toHaveAttribute("href", "/flows/new");
    first.unmount();
    localStorage.setItem(LAST_FLOW_KEY, "f-deleted");
    mount();
    const again = within(await screen.findByRole("group", { name: "Which flow is this for?" }));
    expect(again.getByRole("radio", { name: /^Supplier invoices/ })).toBeChecked();
    expect(again.queryByText("Last used")).toBeNull();
  });

  it("with no flows, offers the first-flow prompt and no select", async () => {
    api.listFlows.mockResolvedValue([]);
    mount();
    expect(await screen.findByText("Set up your first flow")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New flow" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Which flow is this for?" })).toBeNull();
  });

  it("shows each file's status where it was dropped, from one list request, and stops asking when nothing is being read", async () => {
    api.listFlows.mockResolvedValue([flow("f1", "Supplier invoices", "review")]);
    api.uploadDocument.mockImplementation((_f: string, f: File) => Promise.resolve(summary(({ "a.pdf": "d1", "b.csv": "d2" } as Record<string, string>)[f.name] ?? "d3", f.name)));
    let read = false;
    api.listDocumentPage.mockImplementation(async () => ({ page: 1, pageSize: 100, totalCount: 2, sampleCount: 0, items: read
      ? [row("d2", "b.csv", { status: "ready" }), row("d1", "a.pdf", { status: "needs_review", failedChecks: 1, checks: ["low_confidence"] })]
      : [row("d3", "c.pdf", { status: "sent" }), row("d2", "b.csv", { status: "reading" }), row("d1", "a.pdf", { status: "reading" })] }));
    mount();
    await screen.findByRole("region", { name: "Add files" });
    drop([new File(["x"], "a.pdf"), new File(["y"], "b.csv"), new File(["z"], "c.pdf")]);
    const panel = within(await screen.findByRole("region", { name: "Just uploaded" }));
    expect(panel.getByText("3 files to Supplier invoices")).toBeInTheDocument();
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
    api.uploadDocument.mockRejectedValue(new ApiHttpError("ended", 429, { error: "pilot_expired", plan: "pilot", limit: 20, upgradeUrl: "/settings" }));
    const second = mount();
    await screen.findByText(/^5 of 20 trial documents used\./);
    expect(screen.queryByRole("alert")).toBeNull();
    drop([new File(["x"], "a.pdf")]);
    const panel = within(await screen.findByRole("region", { name: "Just uploaded" }));
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
});
