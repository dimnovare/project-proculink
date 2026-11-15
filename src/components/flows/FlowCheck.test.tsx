import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import type { Flow } from "@/lib/api/documents";
import { FlowCheck } from "./FlowCheck";

const api = vi.hoisted(() => ({ updateFlow: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);

const flow = {
  id: "flow-1", name: "Supplier invoices", fieldsConfirmed: true, fields: { fields: [], tables: [] }, documentCount: 3,
  createdAt: "", automation: "review", publishedVersion: 1, hasChanges: false, noCorrectionStreak: 8,
} as Flow;

const mount = () =>
  render(<QueryClientProvider client={new QueryClient()}><FlowCheck flow={flow} /></QueryClientProvider>);

beforeEach(() => vi.clearAllMocks());

describe("FlowCheck", () => {
  it("the mode applies at once", async () => {
    api.updateFlow.mockResolvedValueOnce({ ...flow, automation: "auto" });
    const { unmount } = mount();
    expect(screen.getByRole("radiogroup", { name: "When a document is ready" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Automatic delivery" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(api.updateFlow).toHaveBeenCalledTimes(1);
    expect(api.updateFlow).toHaveBeenCalledWith("flow-1", { automation: "auto" });
    unmount();

    api.updateFlow.mockRejectedValueOnce(new ApiHttpError("forbidden", 403, { error: "requires_org_admin" }));
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Automatic delivery" }));
    expect(await screen.findByText("Only a workspace admin can change this.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("radio", { name: "Review before delivery" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "Automatic delivery" })).not.toBeChecked();
  });

  it("never says a marked value waits", () => {
    const { container } = mount();
    const text = container.textContent ?? "";
    expect(text).toContain("A mark never stops a document being sent.");
    expect(text).not.toMatch(/marked value.*wait|uncertain.*wait/i);
  });
});
