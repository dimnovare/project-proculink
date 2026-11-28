import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FlowVersionsPanel } from "./FlowVersionsPanel";

const api = vi.hoisted(() => ({ listFlowVersions: vi.fn(), restoreFlowVersion: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("confirm", vi.fn(() => true));
  api.listFlowVersions.mockResolvedValue([
    { versionNo: 2, publishedAt: "2026-11-02T10:00:00Z", publishedBy: null, live: true, changes: [
      { section: "standard", action: "added", names: ["ubl-2-1-order"] }, { section: "value", action: "renamed", names: ["A", "B"] },
      { section: "check", action: "added", names: ["Total"] }, { section: "output", action: "when", names: ["Out"] }, { section: "new", action: "kind", names: [] },
    ] },
    { versionNo: 1, publishedAt: "2026-11-01T10:00:00Z", publishedBy: "a@b.co", live: false },
  ]);
});

describe("FlowVersionsPanel", () => {
  it("marks the live version and restores an older one after confirming", async () => {
    api.restoreFlowVersion.mockResolvedValue({ id: "f" });
    render(<QueryClientProvider client={new QueryClient()}><FlowVersionsPanel flowId="f" /></QueryClientProvider>);
    const live = (await screen.findByText("Version 2")).closest("li")!;
    expect(within(live).getByText("In use")).toBeTruthy();
    expect(within(live).queryByRole("button", { name: "Restore" })).toBeNull();
    expect(within(live).getByText("Added a standard file: UBL Order · Renamed 2 values · New check on Total and 2 more")).toBeTruthy();
    const older = screen.getByText("Version 1").closest("li")!;
    expect(within(older).getByText(/by a@b\.co/)).toBeTruthy();
    fireEvent.click(within(older).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(api.restoreFlowVersion).toHaveBeenCalledWith("f", 1));
    expect(vi.mocked(window.confirm).mock.calls[0][0]).toContain("Restore version 1?");
    expect(await screen.findByText("Version 1 is back in your changes. Press Use these changes to put it in use.")).toBeTruthy();
  });
});
