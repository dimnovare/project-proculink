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

const mount = (f: Flow = flow) =>
  render(<QueryClientProvider client={new QueryClient()}><FlowCheck flow={f} /></QueryClientProvider>);

beforeEach(() => vi.clearAllMocks());

describe("FlowCheck", () => {
  it("the mode applies at once", async () => {
    api.updateFlow.mockResolvedValueOnce({ ...flow, automation: "auto" });
    const { unmount } = mount();
    expect(screen.getByRole("radiogroup", { name: "Which documents wait for you" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Check nothing" }));
    expect(await screen.findByText("Saved")).toBeTruthy();
    expect(api.updateFlow).toHaveBeenCalledTimes(1);
    expect(api.updateFlow).toHaveBeenCalledWith("flow-1", { automation: "auto" });
    unmount();

    api.updateFlow.mockRejectedValueOnce(new ApiHttpError("forbidden", 403, { error: "requires_org_admin" }));
    mount();
    fireEvent.click(screen.getByRole("radio", { name: "Check nothing" }));
    expect(await screen.findByText("Only a workspace admin can change this.")).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("radio", { name: "Check every document" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "Check nothing" })).not.toBeChecked();
  });

  it("with changes waiting elsewhere, says the mode is not one of them (B-01)", () => {
    mount({ ...flow, hasChanges: true });
    expect(screen.getByText("Saved as soon as you pick. This is not part of the changes waiting below.")).toBeTruthy();
  });

  it("offers the three modes in order, with download-only words", () => {
    mount({ ...flow, automation: "marked", downloadOnly: true });
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("aria-labelledby") && document.getElementById(r.getAttribute("aria-labelledby")!)!.textContent))
      .toEqual(["Check only what we marked", "Check every document", "Check nothing"]);
    expect(screen.getByText("New flows start here")).toBeTruthy();
    expect(screen.getByText("Every document waits in Needs you until someone presses Make the file.")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Which documents wait for you" })).toBeTruthy();
    expect(screen.queryByText(/A mark never stops/)).toBeNull();
  });
});
