import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { LookupsHome } from "./LookupsHome";
import { showLookupNotice } from "./lookupNotice";
import { usedByLine } from "@/lib/lookupUses";

const api = vi.hoisted(() => ({ listLookups: vi.fn(), createLookup: vi.fn(), deleteLookup: vi.fn() }));
const push = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/documents", () => api);
vi.mock("./LookupPage", () => ({ LookupPage: ({ lookupId }: { lookupId: string }) => <p>panel {lookupId}</p> }));
vi.mock("@/hooks/useDocumentEngine", () => ({ useDocumentEngine: () => "on", flowsQuery: { queryKey: ["flows"], queryFn: async () => [] } }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const show = (id?: string) => render(<QueryClientProvider client={new QueryClient()}><LookupsHome lookupId={id} /></QueryClientProvider>);
beforeEach(() => { vi.clearAllMocks(); showLookupNotice(null); api.listLookups.mockResolvedValue([
  { id: "a", name: "Item codes", count: 1, updatedAt: "", hasCandidates: false, suggestionsOn: false },
  { id: "b", name: "Units", count: 2, updatedAt: "", hasCandidates: false, suggestionsOn: false }]); });

describe("LookupsHome", () => {
  it("lists each lookup with its rows and what uses it, and says nothing about use before it knows", async () => {
    const view = show();
    const nav = await screen.findByRole("navigation", { name: "All lookups" });
    expect(await within(nav).findByText("1 row.")).toBeTruthy();
    expect(within(nav).getByText("2 rows.")).toBeTruthy();
    expect(within(nav).queryByText(/Not used yet/)).toBeNull();
    expect(within(nav).getByText("2 lookups")).toBeTruthy();
    api.listLookups.mockResolvedValue([
      { id: "a", name: "Item codes", count: 1, updatedAt: "", hasCandidates: false, suggestionsOn: false, usedBy: [{ flowId: "f1", flowName: "Supplier invoices" }] },
      { id: "b", name: "Units", count: 2, updatedAt: "", hasCandidates: false, suggestionsOn: false, usedBy: [] }]);
    view.unmount();
    show();
    const again = await screen.findByRole("navigation", { name: "All lookups" });
    expect(await within(again).findByText("1 row. Used by Supplier invoices.")).toBeTruthy();
    expect(within(again).getByText("2 rows. Not used yet.")).toBeTruthy();
    expect([usedByLine(["A"]), usedByLine(["A", "B"]), usedByLine(["A", "B", "C"]), usedByLine([]), usedByLine(undefined)])
      .toEqual(["Used by A.", "Used by A and B.", "Used by A, B and C.", "Not used yet.", null]);
  });

  it("Import a table saves the file as a new lookup at once, and Undo deletes it, or says why it can't", async () => {
    api.createLookup.mockResolvedValue({ id: "new-1", name: "supplier-codes", entries: [], updatedAt: "", candidates: [], suggestionsOn: false });
    api.deleteLookup.mockRejectedValueOnce(new ApiHttpError("in use", 409, { error: "lookup_in_use" })).mockResolvedValueOnce(undefined);
    show();
    const file = new File(["Code,Ours\nKS-100,NT-1\nks-100 ,NT-2\nKS-214,NT-3\n"], "supplier-codes.csv", { type: "text/csv" });
    fireEvent.change(await screen.findByTestId("import-table-input"), { target: { files: [file] } });
    await waitFor(() => expect(api.createLookup).toHaveBeenCalledWith("supplier-codes", [{ from: "ks-100", to: "NT-2" }, { from: "KS-214", to: "NT-3" }]));
    const notice = await screen.findByText("supplier-codes.csv imported. 2 rows saved as a new lookup, named after the file.");
    expect(push).toHaveBeenCalledWith("/lookups/new-1");
    const banner = notice.closest("[data-notice-tone]") as HTMLElement;
    fireEvent.click(within(banner).getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Couldn't undo. An output uses this lookup. Remove it from the output first.")).toBeTruthy();
    fireEvent.click(within(screen.getByText(/^Couldn't undo/).closest("[data-notice-tone]") as HTMLElement).getByRole("button", { name: "Undo" }));
    expect(await screen.findByText("Import undone. supplier-codes was deleted.")).toBeTruthy();
    expect(api.deleteLookup).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenLastCalledWith("/lookups");
  });

  it("a file we can't import says why and creates nothing", async () => {
    show();
    const input = await screen.findByTestId("import-table-input");
    fireEvent.change(input, { target: { files: [new File([new Uint8Array([0x50, 0x4b, 3, 4, 1, 2])], "old.xlsx")] } });
    expect(await screen.findByText("Couldn't import old.xlsx. We can read CSV files and Excel .xlsx files.")).toBeTruthy();
    fireEvent.change(input, { target: { files: [new File(["Code,Ours\n"], "empty.csv", { type: "text/csv" })] } });
    expect(await screen.findByText("Couldn't import empty.csv. It has no rows with a value in the first column.")).toBeTruthy();
    expect(api.createLookup).not.toHaveBeenCalled();
  });
});
