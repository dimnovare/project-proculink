import { afterEach, describe, it, expect, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buttonClass } from "@/components/bridge/DSPrimitives";
import { ApiHttpError } from "@/lib/api/core";
import type { Flow, FlowSummary } from "@/lib/api/documents";
import { checkModeTitle } from "@/lib/deliveryMode";
import { PLAN_BY_ID, planName } from "@/lib/plans";
import { FlowsHome } from "./FlowsHome";
import { UploadQueueProvider } from "./UploadQueue";

const listFlows = vi.fn();
const getBillingStatus = vi.fn();
vi.mock("@/lib/api/documents", () => ({ listFlows: () => listFlows() }));
vi.mock("@/lib/api/billing", () => ({ getBillingStatus: () => getBillingStatus() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null, isLoaded: true }) }));
vi.mock("@/lib/api/linkedAccounts", () => ({ listLinkedAccounts: () => Promise.resolve({ available: false, accounts: [] }) }));

const flow = (id: string, name: string, documentCount: number, summary?: FlowSummary | null): Flow => ({
  id, name, documentCount, summary, fieldsConfirmed: true, createdAt: "2026-05-20T09:00:00Z", automation: "review", fields: { fields: [], tables: [] },
});
const summary = (s: Partial<FlowSummary> = {}): FlowSummary => ({
  needsYou: 0, couldNotSend: 0, couldNotRead: 0, lastDocumentAt: null, waysIn: [], outputs: [], ...s,
});
const invoices = flow("flow-1", "Supplier invoices", 3, summary({
  needsYou: 1, couldNotRead: 2, lastDocumentAt: "2026-05-20T09:00:00Z", waysIn: ["email"],
  outputs: [{ name: "Invoice CSV", format: "csv", standard: null, destination: "Accounting inbox" }],
}));
const SENTENCE = "Reads documents from email and upload. Sends “Invoice CSV” to Accounting inbox.";

const show = () => render(<QueryClientProvider client={new QueryClient()}><UploadQueueProvider><FlowsHome /></UploadQueueProvider></QueryClientProvider>);
const welcome = () => screen.queryByRole("heading", { level: 1, name: /Let's read your first document/ });
/** The row link of `name` in both breakpoint trees: jsdom draws both. */
const rows = async (name: string) => {
  await screen.findAllByRole("link", { name });
  return ["flows-table", "flows-phone-list"].map((id) => within(within(screen.getByTestId(id)).getByRole("link", { name })));
};

afterEach(() => {
  vi.useRealTimers();
  listFlows.mockReset();
  getBillingStatus.mockReset();
});

describe("FlowsHome", () => {
  it("says flows are off on the engine refusal, with no first-flow prompt", async () => {
    listFlows.mockRejectedValue(new ApiHttpError("no", 403, { error: "document_engine_not_enabled" }));
    getBillingStatus.mockRejectedValue(new Error("down"));
    show();
    expect(await screen.findByText("Flows aren't switched on for this workspace yet.")).toBeTruthy();
    expect(welcome()).toBeNull();
  });

  it("draws the welcome only once the flows answered that the workspace is new", { timeout: 20_000 }, async () => {
    listFlows.mockReturnValue(new Promise(() => {}));
    getBillingStatus.mockRejectedValue(new Error("down"));
    const loading = show();
    expect(await screen.findByText("Loading flows…")).toBeTruthy();
    expect(welcome()).toBeNull();
    loading.unmount();
    listFlows.mockRejectedValue(new ApiHttpError("down", 500, null));
    show();
    expect(await screen.findByRole("button", { name: "Try again" }, { timeout: 10_000 })).toBeTruthy();
    expect(welcome()).toBeNull();
  });

  it("a row without a summary says nothing it does not know", async () => {
    listFlows.mockResolvedValue([invoices, { ...flow("flow-2", "Delivery notes", 4, null), automation: "marked" }, flow("flow-3", "Quiet flow", 0, summary())]);
    getBillingStatus.mockRejectedValue(new Error("down"));
    show();
    for (const row of await rows("Supplier invoices")) {
      expect(row.getByText("1 needs you")).toBeTruthy();
      expect(row.getByText("2 couldn't be read")).toBeTruthy();
      expect(row.getByText(SENTENCE)).toBeTruthy();
      expect(row.queryByText(/couldn't be sent/)).toBeNull();
    }
    expect(within(screen.getByTestId("flows-table")).getByRole("link", { name: "Supplier invoices" }))
      .toHaveAccessibleDescription(expect.stringContaining("1 needs you"));
    const [desk, phone] = await rows("Delivery notes");
    for (const row of [desk, phone]) {
      for (const unknown of [/Reads documents/, /needs? you/, /couldn't be/, /Nothing waiting/, /Last one/, /No documents yet/]) {
        expect(row.queryByText(unknown)).toBeNull();
      }
      expect(row.getByText(checkModeTitle("marked"))).toBeTruthy();
    }
    expect(desk.getByText("4")).toBeTruthy();
    expect(phone.getByText("4 documents")).toBeTruthy();
    for (const row of await rows("Quiet flow")) {
      expect(row.getByText("Nothing waiting")).toBeTruthy();
      expect(row.getByText("No documents yet")).toBeTruthy();
    }
  });

  it("rows stay through a failed refresh", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    listFlows.mockResolvedValueOnce([invoices]);
    getBillingStatus.mockRejectedValue(new Error("down"));
    show();
    await rows("Supplier invoices");
    listFlows.mockRejectedValue(new Error("down"));
    await act(() => vi.advanceTimersByTimeAsync(70_000));
    expect(listFlows.mock.calls.length).toBeGreaterThan(1);
    expect(await rows("Supplier invoices")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("one New flow, and the plan line only when known", { timeout: 20_000 }, async () => {
    listFlows.mockResolvedValue([]);
    getBillingStatus.mockRejectedValue(new Error("down"));
    const empty = show();
    expect(await screen.findByRole("heading", { level: 1, name: /Let's read your first document/ })).toBeTruthy();
    // The welcome is the page: no header "New flow" beside its one filled button.
    const named = [...screen.queryAllByRole("button", { name: "New flow" }), ...screen.queryAllByRole("link", { name: "New flow" })];
    expect(named).toHaveLength(0);
    empty.unmount();

    // Under the limit: an outlined "New flow" and the quiet plan line.
    const limit = PLAN_BY_ID.pilot.flowLimit!;
    listFlows.mockResolvedValue(Array.from({ length: limit - 1 }, (_, i) => flow(`flow-${i}`, `Flow ${i}`, 0)));
    getBillingStatus.mockResolvedValue({ plan: "pilot" });
    const known = show();
    const seePlans = await screen.findByRole("link", { name: "See plans" });
    expect(seePlans.getAttribute("href")).toBe("/settings?tab=billing");
    expect(seePlans.closest("p")?.textContent).toBe(`${limit - 1} of ${limit} flows on ${planName("pilot")}. Need more? See plans`);
    expect(screen.getByText("A flow is what happens to one kind of document. We sort each document into the right one.")).toBeTruthy();
    const header = () => screen.getByRole("button", { name: "New flow" }).className;
    expect(header()).toBe(buttonClass("secondary", "md"));
    expect(header()).not.toBe(buttonClass("primary", "md"));
    known.unmount();

    // At or over the limit: no "New flow"; the header says "See plans" and an amber notice sits above the list.
    for (const [n, lead] of [[limit, `${limit} of ${limit} flows on the ${planName("pilot")}.`], [limit + 1, "You have more flows than your plan includes."]] as const) {
      listFlows.mockResolvedValue(Array.from({ length: n }, (_, i) => flow(`flow-${i}`, `Flow ${i}`, 0)));
      const full = show();
      expect(await screen.findByText(`${lead} To try another file, such as the KSeF invoice, add it to a flow you have: open the flow, go to We send and make another file there.`)).toBeTruthy();
      expect(screen.getByRole("link", { name: "Open Flow 0" })).toHaveAttribute("href", "/flows/flow-0");
      expect(screen.getByRole("link", { name: "See plans" }).className).toBe(buttonClass("secondary", "md"));
      expect(screen.queryByRole("button", { name: "New flow" })).toBeNull();
      full.unmount();
    }
    listFlows.mockResolvedValue([invoices]);

    const unlimited = Object.values(PLAN_BY_ID).find((p) => p.flowLimit === null)!;
    getBillingStatus.mockResolvedValue({ plan: unlimited.id });
    const open = show();
    await rows("Supplier invoices");
    await act(() => Promise.resolve());
    expect(getBillingStatus).toHaveBeenCalled();
    expect(screen.queryByText(/flows on/)).toBeNull();
    open.unmount();

    getBillingStatus.mockRejectedValue(new Error("down"));
    show();
    await rows("Supplier invoices");
    expect(screen.queryByText(/flows on/)).toBeNull();
  });

  it("reaches Lookups from the Flows page", async () => {
    listFlows.mockResolvedValue([invoices]);
    getBillingStatus.mockRejectedValue(new Error("down"));
    show();
    const link = await screen.findByRole("link", { name: "Lookups" });
    expect(link).toHaveAttribute("href", "/lookups");
    expect(link.parentElement).toHaveTextContent(/^The lists your flows use to change values are in Lookups\.$/);
  });
});
