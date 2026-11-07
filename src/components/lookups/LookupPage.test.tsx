import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { LookupPage } from "./LookupPage";

const getLookup = vi.fn();
const updateLookup = vi.fn();
const deleteLookup = vi.fn();
vi.mock("@/lib/api/documents", () => ({
  getLookup: (id: string) => getLookup(id),
  updateLookup: (id: string, body: unknown) => updateLookup(id, body),
  deleteLookup: (id: string) => deleteLookup(id),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("LookupPage", () => {
  it("import then Save sends the merged table, and an in-use delete explains why", async () => {
    getLookup.mockResolvedValue({ id: "l1", name: "Item codes", entries: [{ from: "BLT-10", to: "old" }], updatedAt: "" });
    updateLookup.mockResolvedValue({});
    deleteLookup.mockRejectedValue(new ApiHttpError("no", 409, { error: "lookup_in_use" }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <LookupPage lookupId="l1" />
      </QueryClientProvider>,
    );
    const file = new File(["From,To\nBLT-10,A-7\nNUT-4,B-2\n"], "codes.csv", { type: "text/csv" });
    fireEvent.change(await screen.findByLabelText("Import CSV"), { target: { files: [file] } });
    expect(await screen.findByText("Imported 2 rows: 1 new, 1 changed.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Add row" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateLookup).toHaveBeenCalledWith("l1", {
        name: "Item codes",
        entries: [{ from: "BLT-10", to: "A-7" }, { from: "NUT-4", to: "B-2" }],
      }),
    );
    expect(await screen.findByText("Saved.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Delete lookup" }));
    expect(screen.getByText("Delete “Item codes”? This can't be undone.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Delete lookup" }));
    expect(await screen.findByText(/An output uses this lookup/)).toBeTruthy();
  });
});
