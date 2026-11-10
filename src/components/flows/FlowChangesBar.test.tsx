import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { Flow } from "@/lib/api/documents";
import { FlowChangesBar } from "./FlowChangesBar";

const api = vi.hoisted(() => ({ publishFlow: vi.fn(), restoreFlowVersion: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const flow = {
  id: "f", name: "Receipts", fieldsConfirmed: true, fields: { fields: [], tables: [] }, documentCount: 0,
  createdAt: "", automation: "review", publishedVersion: 3, hasChanges: true, noCorrectionStreak: null,
} as Flow;

const bar = (f: Flow) => <QueryClientProvider client={new QueryClient()}><FlowChangesBar flow={f} /></QueryClientProvider>;

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("confirm", vi.fn(() => true)); });

describe("FlowChangesBar", () => {
  it("publishes the changes and then says the new version is live", async () => {
    api.publishFlow.mockResolvedValue({ ...flow, publishedVersion: 4, hasChanges: false });
    const { rerender } = render(bar(flow));
    expect(screen.getByText("You have changes that aren't live yet. New work still uses version 3.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    await waitFor(() => expect(api.publishFlow).toHaveBeenCalledWith("f"));
    rerender(bar({ ...flow, publishedVersion: 4, hasChanges: false }));
    expect(await screen.findByText("Version 4 is live.")).toBeTruthy();
  });

  it("asks before discarding, then restores the published version", async () => {
    api.restoreFlowVersion.mockResolvedValue({ ...flow, hasChanges: false });
    render(bar(flow));
    fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    await waitFor(() => expect(api.restoreFlowVersion).toHaveBeenCalledWith("f", 3));
    const asked = vi.mocked(window.confirm).mock.calls[0][0];
    expect(asked).toContain("Discard your changes?");
    expect(asked).toContain("The flow goes back to version 3. This can't be undone.");
  });

  it("shows the conflict copy when someone else published first", async () => {
    api.publishFlow.mockRejectedValue(new ApiHttpError("conflict", 409, { error: "publish_conflict" }));
    render(bar(flow));
    fireEvent.click(screen.getByRole("button", { name: "Publish changes" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Someone else published this flow just now. Reload to see the latest version.");
  });
});
