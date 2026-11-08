import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { LookupMisses } from "./LookupMisses";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({ listLookups: vi.fn(), suggestLookupMatches: vi.fn(), addLookupEntry: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const summary = (over = {}) => ({ id: "L1", name: "Codes", count: 0, updatedAt: "", hasCandidates: true, suggestionsOn: true, ...over });
const misses = [{ lookupId: "L1", value: "A1" }, { lookupId: "L1", value: "B2" }];
const suggestions = [
  { lookupId: "L1", value: "A1", to: "SUP-1", confidence: 0.9, description: "Pilsner bottle 0.5L" },
  { lookupId: "L1", value: "B2", to: "SUP-2", confidence: 0.4, description: null },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.listLookups.mockResolvedValue([summary()]);
  api.suggestLookupMatches.mockResolvedValue(suggestions);
  api.addLookupEntry.mockResolvedValue({});
});

const renderMisses = (onChanged = () => {}) =>
  render(<QueryClientProvider client={new QueryClient()}>
    <LookupMisses documentId="d" outputId="o" misses={misses} onChanged={onChanged} />
  </QueryClientProvider>);

describe("LookupMisses", () => {
  it("suggests, accepts and rejects matches for missed values", async () => {
    const onChanged = vi.fn();
    renderMisses(onChanged);
    expect(await screen.findByText("Not in “Codes”: A1, B2.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest matches" }));
    expect(await screen.findByText("A1 → SUP-1")).toBeTruthy();
    expect(screen.getByText("AI · 90%")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]);
    await waitFor(() => expect(screen.queryByText("A1 → SUP-1")).toBeNull());
    expect(api.addLookupEntry).toHaveBeenCalledWith("L1", { from: "A1", to: "SUP-1" });
    expect(onChanged).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(screen.queryByText("B2 → SUP-2")).toBeNull();
    expect(api.addLookupEntry).toHaveBeenCalledTimes(1);
  });

  it("offers no suggestions when the lookup has no list or they are off", async () => {
    api.listLookups.mockResolvedValue([summary({ hasCandidates: false })]);
    const first = renderMisses();
    expect(await screen.findByText("Not in “Codes”: A1, B2.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Suggest matches" })).toBeNull();
    first.unmount();
    api.listLookups.mockResolvedValue([summary({ suggestionsOn: false })]);
    renderMisses();
    expect(await screen.findByText("Not in “Codes”: A1, B2.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Suggest matches" })).toBeNull();
  });

  it("keeps the suggestion and shows the refusal when the value is already in the lookup", async () => {
    api.addLookupEntry.mockRejectedValue(new ApiHttpError("put", 422, { error: "lookup_invalid", detail: "'A1' appears more than once." }));
    const onChanged = vi.fn();
    renderMisses(onChanged);
    fireEvent.click(await screen.findByRole("button", { name: "Suggest matches" }));
    await screen.findByText("A1 → SUP-1");
    fireEvent.click(screen.getAllByRole("button", { name: "Accept" })[0]);
    expect(await screen.findByText("'A1' appears more than once.")).toBeTruthy();
    expect(screen.getByText("A1 → SUP-1")).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });
});
