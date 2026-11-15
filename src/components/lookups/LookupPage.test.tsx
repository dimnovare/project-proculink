import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LookupPage } from "./LookupPage";

const api = vi.hoisted(() => ({ getLookup: vi.fn(), updateLookup: vi.fn(), deleteLookup: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const lookup = (entries: { from: string; to: string }[], extra = {}) =>
  ({ id: "l1", name: "Item codes", entries, updatedAt: "2026-05-20T09:00:00Z", candidates: [], suggestionsOn: false, ...extra });
const show = (qc = new QueryClient()) => ({ qc, ...render(<QueryClientProvider client={qc}><LookupPage lookupId="l1" usedBy={[]} /></QueryClientProvider>) });
const table = () => screen.getByRole("table", { name: "Rows of Item codes" });
beforeEach(() => { vi.clearAllMocks(); api.updateLookup.mockImplementation(async (_id, b) => ({ ...lookup(b.entries), name: b.name, updatedAt: new Date().toISOString() })); });

describe("LookupPage", () => {
  it("a change saves the whole table, and a row the server would refuse is held back and says why", async () => {
    api.getLookup.mockResolvedValue(lookup([{ from: "KS-100", to: "A" }, { from: "KS-200", to: "B" }]));
    show();
    const to = await screen.findByLabelText("To value for KS-100");
    fireEvent.change(to, { target: { value: "NT-1" } });
    fireEvent.blur(to);
    await waitFor(() => expect(api.updateLookup).toHaveBeenLastCalledWith("l1", { name: "Item codes", entries: [{ from: "KS-100", to: "NT-1" }, { from: "KS-200", to: "B" }] }));
    expect(await screen.findByText("Saved, edits save as you type")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    const from = within(table()).getByLabelText("From value, row 3");
    fireEvent.change(from, { target: { value: " ks-200 " } });
    fireEvent.blur(from);
    expect(await within(table()).findByText("Not saved: ks-200 is already in this lookup.")).toBeTruthy();
    expect(await screen.findByText("Saved, except 1 row")).toBeTruthy();
    expect(api.updateLookup.mock.lastCall![1].entries).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Rename this lookup" }));
    const name = screen.getByLabelText("Lookup name");
    fireEvent.change(name, { target: { value: "Supplier item codes" } });
    fireEvent.keyDown(name, { key: "Enter" });
    await waitFor(() => expect(api.updateLookup.mock.lastCall![1].name).toBe("Supplier item codes"));
  });

  it("Couldn't save keeps the typing, Try again sends it, and a change made elsewhere is shown when nothing waits here", async () => {
    api.getLookup.mockResolvedValue(lookup([{ from: "KS-100", to: "A" }]));
    api.updateLookup.mockRejectedValueOnce(new Error("network"));
    const { qc } = show();
    const to = await screen.findByLabelText("To value for KS-100");
    fireEvent.change(to, { target: { value: "typed" } });
    fireEvent.blur(to);
    expect(await screen.findByText("Couldn't save. Your changes are kept on this page.")).toBeTruthy();
    expect((screen.getByLabelText("To value for KS-100") as HTMLInputElement).value).toBe("typed");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Saved, edits save as you type")).toBeTruthy();
    expect(api.updateLookup.mock.calls.map((c) => c[1].entries[0].to)).toEqual(["typed", "typed"]);
    qc.setQueryData(["lookup", "l1"], lookup([{ from: "KS-100", to: "typed" }, { from: "KS-300", to: "accepted" }], { updatedAt: "2030-01-01T00:00:00Z" }));
    expect(await screen.findByLabelText("To value for KS-300")).toBeTruthy();
  });

  it("search and paging show and edit the right rows", async () => {
    api.getLookup.mockResolvedValue(lookup(Array.from({ length: 120 }, (_, i) => ({ from: `K${i}`, to: `V${i}` }))));
    show();
    expect(await screen.findByText("Rows 1 to 50 of 120")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("Rows 51 to 100 of 120")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search rows"), { target: { value: "v77" } });
    expect(screen.getByText("Rows 1 to 1 of 1 that match")).toBeTruthy();
    const to = within(table()).getByLabelText("To value for K77");
    fireEvent.change(to, { target: { value: "V77-new" } });
    fireEvent.blur(to);
    await waitFor(() => expect(api.updateLookup).toHaveBeenCalled());
    const sent = api.updateLookup.mock.lastCall![1].entries;
    expect(sent).toHaveLength(120);
    expect(sent.filter((e: { to: string }, i: number) => e.to !== `V${i}`)).toEqual([{ from: "K77", to: "V77-new" }]);
    fireEvent.change(screen.getByLabelText("Search rows"), { target: { value: "zzz" } });
    expect(screen.getByText("No rows match “zzz”.")).toBeTruthy();
  });
});
