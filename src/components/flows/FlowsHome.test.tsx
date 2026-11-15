import { afterEach, describe, it, expect, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { Flow, FlowSummary } from "@/lib/api/documents";
import { deliveryModeLabel } from "@/lib/deliveryMode";
import { PLAN_BY_ID, planName } from "@/lib/plans";
import { FlowsHome } from "./FlowsHome";

const listFlows = vi.fn();
const getBillingStatus = vi.fn();
vi.mock("@/lib/api/documents", () => ({ listFlows: () => listFlows() }));
vi.mock("@/lib/api/billing", () => ({ getBillingStatus: () => getBillingStatus() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

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
const SENTENCE = "Reads documents from email and upload. Sends Invoice CSV to Accounting inbox.";

const show = () => render(<QueryClientProvider client={new QueryClient()}><FlowsHome /></QueryClientProvider>);
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
    expect(screen.queryByText("Set up your first flow")).toBeNull();
  });

  it("a row without a summary says nothing it does not know", async () => {
    listFlows.mockResolvedValue([invoices, flow("flow-2", "Delivery notes", 4, null), flow("flow-3", "Quiet flow", 0, summary())]);
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
      expect(row.getByText(deliveryModeLabel(false))).toBeTruthy();
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
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("one New flow, and the plan line only when known", async () => {
    listFlows.mockResolvedValue([]);
    getBillingStatus.mockRejectedValue(new Error("down"));
    const empty = show();
    expect(await screen.findByText("Set up your first flow")).toBeTruthy();
    const named = [...screen.queryAllByRole("button", { name: "New flow" }), ...screen.queryAllByRole("link", { name: "New flow" })];
    expect(named).toHaveLength(1);
    empty.unmount();

    listFlows.mockResolvedValue([invoices]);
    getBillingStatus.mockResolvedValue({ plan: "pilot" });
    const known = show();
    const seePlans = await screen.findByRole("link", { name: "See plans" });
    expect(seePlans.getAttribute("href")).toBe("/settings?tab=billing");
    expect(seePlans.closest("p")?.textContent).toBe(`1 of ${PLAN_BY_ID.pilot.flowLimit} flows on ${planName("pilot")}. Need more? See plans`);
    known.unmount();

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
});
