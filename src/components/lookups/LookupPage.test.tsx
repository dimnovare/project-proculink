import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { LookupPage } from "./LookupPage";
import { LookupNoticeBanner, showLookupNotice } from "./lookupNotice";

const api = vi.hoisted(() => ({ getLookup: vi.fn(), updateLookup: vi.fn(), deleteLookup: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const lookup = (entries: { from: string; to: string }[], extra = {}) =>
  ({ id: "l1", name: "Item codes", entries, updatedAt: "2026-05-20T09:00:00Z", candidates: [], suggestionsOn: false, ...extra });
const show = (qc = new QueryClient()) => ({ qc, ...render(<QueryClientProvider client={qc}><LookupPage lookupId="l1" usedBy={[]} /></QueryClientProvider>) });
const table = () => screen.getByRole("table", { name: "Rows of Item codes" });
beforeEach(() => { vi.clearAllMocks(); showLookupNotice(null); api.updateLookup.mockImplementation(async (_id, b) => ({ ...lookup(b.entries), name: b.name, updatedAt: new Date().toISOString() })); });

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

  it("Replace from a file swaps every row at once, and Undo saves the previous rows again", async () => {
    api.getLookup.mockResolvedValue(lookup([{ from: "A", to: "1" }, { from: "B", to: "2" }, { from: "C", to: "3" }]));
    render(<QueryClientProvider client={new QueryClient()}><LookupNoticeBanner /><LookupPage lookupId="l1" usedBy={[]} /></QueryClientProvider>);
    const file = new File(["From,To\nX,9\nY,8\n"], "codes.csv", { type: "text/csv" });
    fireEvent.change(await screen.findByTestId("replace-table-input"), { target: { files: [file] } });
    await waitFor(() => expect(api.updateLookup).toHaveBeenLastCalledWith("l1", { name: "Item codes", entries: [{ from: "X", to: "9" }, { from: "Y", to: "8" }] }));
    const notice = await screen.findByText("codes.csv imported. 2 rows replace the 3 that were here.");
    api.updateLookup.mockRejectedValueOnce(new Error("network"));
    fireEvent.click(within(notice.closest("[data-notice-tone]") as HTMLElement).getByRole("button", { name: "Undo" }));
    expect(await screen.findByText(/^Couldn't undo\./)).toBeTruthy();
    expect(within(table()).getByLabelText("To value for A")).toBeTruthy();              // the previous rows are on screen
    expect(screen.getByText("Couldn't save. Your changes are kept on this page.")).toBeTruthy();
    fireEvent.click(within(screen.getByText(/^Couldn't undo\./).closest("[data-notice-tone]") as HTMLElement).getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Import undone. The 3 rows from before are back.")).toBeTruthy();
    expect(api.updateLookup.mock.lastCall![1].entries.map((e: { from: string }) => e.from)).toEqual(["A", "B", "C"]);
  });

  it("Delete asks first, and a lookup in use says why and stays", async () => {
    api.getLookup.mockResolvedValue(lookup([{ from: "A", to: "1" }]));
    api.deleteLookup.mockRejectedValue(new ApiHttpError("in use", 409, { error: "lookup_in_use" }));
    show();
    fireEvent.change(await screen.findByLabelText("To value for A"), { target: { value: "typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete lookup" }));
    expect(screen.getByText("Delete “Item codes”? This can't be undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete lookup" }));
    expect(await screen.findByText("A file uses this lookup. Remove it from the file first.")).toBeTruthy();
    expect(api.deleteLookup).toHaveBeenCalledTimes(1);
    // The delete was refused: what was typed is saved after all.
    await waitFor(() => expect(api.updateLookup).toHaveBeenLastCalledWith("l1", { name: "Item codes", entries: [{ from: "A", to: "typed" }] }));
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByText("Delete “Item codes”? This can't be undone.")).toBeNull();
  });

  it("shows suggestions only when they are switched on, behind Set up suggestions, and saves the list by itself", async () => {
    api.getLookup.mockResolvedValue(lookup([], { suggestionsOn: false }));
    const off = show();
    await screen.findByText("No rows yet. Add a row, or replace from a file.");
    expect(screen.queryByRole("button", { name: "Set up suggestions" })).toBeNull();
    off.unmount();
    api.getLookup.mockResolvedValue(lookup([], { suggestionsOn: true }));
    show();
    const open = await screen.findByRole("button", { name: "Set up suggestions" });
    expect(open.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(open);
    expect(screen.getByText("No list yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Import list (CSV)"), { target: { files: [new File(["Code,Name\nSUP-1,Pilsner bottle"], "list.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(api.updateLookup).toHaveBeenLastCalledWith("l1", expect.objectContaining({ candidates: [{ value: "SUP-1", description: "Pilsner bottle" }] })));
    expect(await screen.findByText("Imported 1 value.")).toBeTruthy();
  });

  it("a list file with no values is refused in words and the stored list stays", async () => {
    api.getLookup.mockResolvedValue(lookup([], { suggestionsOn: true, candidates: [{ value: "SUP-1", description: null }] }));
    render(<QueryClientProvider client={new QueryClient()}><LookupNoticeBanner /><LookupPage lookupId="l1" usedBy={[]} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Set up suggestions" }));
    fireEvent.change(screen.getByLabelText("Import list (CSV)"), { target: { files: [new File(["Code,Name\n"], "list.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("Couldn't import list.csv. This file has no values. The list was not changed.")).toBeTruthy();
    expect(api.updateLookup).not.toHaveBeenCalled();
    expect(screen.getByText("1 value")).toBeTruthy();
  });

  it("its own save is not a change made elsewhere: the same moment written another way keeps the screen, a later one replaces the rows", async () => {
    api.getLookup.mockResolvedValue(lookup([{ from: "KS-100", to: "A" }], { updatedAt: "2026-05-20T09:00:00.123456Z" }));
    // The save answers with 7 fraction digits, a later read of the same moment with 6.
    api.updateLookup.mockImplementation(async (_id, b) => lookup(b.entries, { updatedAt: "2026-05-20T09:30:00.1234567Z" }));
    const { qc } = show();
    const to = await screen.findByLabelText("To value for KS-100");
    fireEvent.change(to, { target: { value: "NT-1" } });
    fireEvent.blur(to);
    expect(await screen.findByText("Saved, edits save as you type")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a row" }));
    expect(document.activeElement).toBe(within(table()).getByLabelText("From value, row 2"));
    // The query cache tells its observers on a timer: wait one turn so the screen has the new copy.
    const answer = (l: ReturnType<typeof lookup>) => act(async () => { qc.setQueryData(["lookup", "l1"], l); await new Promise((r) => setTimeout(r, 0)); });
    await answer(lookup([{ from: "KS-100", to: "NT-1" }], { updatedAt: "2026-05-20T09:30:00.123456Z" }));
    expect(document.activeElement).toBe(within(table()).getByLabelText("From value, row 2"));     // the blank row stays, focused
    await answer(lookup([{ from: "KS-100", to: "NT-1" }, { from: "KS-300", to: "B" }], { updatedAt: "2026-05-20T10:00:00.123456Z" }));
    expect((within(table()).getByLabelText("From value, row 2") as HTMLInputElement).value).toBe("KS-300");
  });

  it("an old Excel file is refused in words before anything is read into rows, and nothing is sent", async () => {
    api.getLookup.mockResolvedValue(lookup([{ from: "A", to: "1" }]));
    render(<QueryClientProvider client={new QueryClient()}><LookupNoticeBanner /><LookupPage lookupId="l1" usedBy={[]} /></QueryClientProvider>);
    const old = new File([new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "\nX,9\n"], "codes.xls");
    fireEvent.change(await screen.findByTestId("replace-table-input"), { target: { files: [old] } });
    expect(await screen.findByText("Couldn't import codes.xls. This file can't be read as a table. Save it as .xlsx or CSV and try again.")).toBeTruthy();
    expect(api.updateLookup).not.toHaveBeenCalled();
  });

  it("a lookup that was deleted sends no late save", async () => {
    api.getLookup.mockResolvedValue(lookup([{ from: "A", to: "1" }]));
    api.deleteLookup.mockResolvedValue(undefined);
    const { unmount } = show();
    fireEvent.change(await screen.findByLabelText("To value for A"), { target: { value: "typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete lookup" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete lookup" }));
    await waitFor(() => expect(api.deleteLookup).toHaveBeenCalledTimes(1));
    unmount();                                                   // the page goes back to the list
    await new Promise((r) => setTimeout(r, 0));
    expect([api.updateLookup.mock.calls.length, api.deleteLookup.mock.calls.length]).toEqual([0, 1]);
  });
});
