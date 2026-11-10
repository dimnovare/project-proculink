import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { FlowPage } from "./FlowPage";

const replace = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  useRouter: () => ({ replace, push: vi.fn() }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({
  getFlow: vi.fn(), updateFlow: vi.fn(), listDocuments: vi.fn(), uploadDocument: vi.fn(), getDocument: vi.fn(),
  listOutputs: vi.fn(), deleteOutput: vi.fn(), listDestinations: vi.fn(),
  publishFlow: vi.fn(), restoreFlowVersion: vi.fn(), listFlowVersions: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);

const flow = {
  id: "f", name: "Receipts", fieldsConfirmed: true, fields: { fields: [], tables: [] },
  documentCount: 0, createdAt: "", automation: "review",
};
const DUPLICATE = "Documents with a number we've already received always wait for you.";

beforeEach(() => {
  vi.clearAllMocks();
  api.getFlow.mockResolvedValue(flow);
  api.listDocuments.mockResolvedValue([]);
  api.listOutputs.mockResolvedValue([]);
  api.listDestinations.mockResolvedValue([]);
});

const renderPage = () =>
  render(<QueryClientProvider client={new QueryClient()}><FlowPage flowId="f" /></QueryClientProvider>);

describe("FlowPage", () => {
  it("switching to automatic sends the new setting and keeps the duplicate rule visible", async () => {
    api.updateFlow.mockResolvedValue({ ...flow, automation: "auto" });
    renderPage();
    fireEvent.click(await screen.findByRole("radio", { name: "Automatic delivery" }));
    await waitFor(() => expect(api.updateFlow).toHaveBeenCalledWith("f", { automation: "auto" }));
    expect(screen.getByText(DUPLICATE)).toBeTruthy();
    await waitFor(() => expect((screen.getByRole("radio", { name: "Automatic delivery" }) as HTMLInputElement).checked).toBe(true));
  });

  it.each([[12, "The last 12 documents were sent without a correction."], [201, "The last 200+ documents were sent without a correction."]])(
    "shows the no-correction streak %i beside the automation choice", async (n, text) => {
      api.getFlow.mockResolvedValue({ ...flow, noCorrectionStreak: n });
      renderPage();
      expect(await screen.findByText(text)).toBeTruthy();
    });

  it("shows no streak text while the streak is absent", async () => {
    renderPage();
    await screen.findByRole("radio", { name: "Automatic delivery" });
    expect(screen.queryByText(/without a correction|needed a correction/)).toBeNull();
  });

  it("tabs are wired for screen readers and move with the arrow, Home and End keys", async () => {
    renderPage();
    const tabs = await screen.findAllByRole("tab");
    const panel = screen.getByRole("tabpanel");
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1, -1]);
    expect(panel.getAttribute("aria-labelledby")).toBe(tabs[0].id);
    tabs.forEach((t) => expect(document.getElementById(t.getAttribute("aria-controls")!)).toBe(panel));
    const press = (key: string, expectedTab: string, i: number) => {
      fireEvent.keyDown(tabs[0], { key });
      expect(replace).toHaveBeenLastCalledWith("/flows/f?tab=" + expectedTab);
      expect(document.activeElement).toBe(tabs[i]);
    };
    press("ArrowRight", "fields", 1);
    press("ArrowLeft", "versions", 4);
    press("End", "versions", 4);
    press("Home", "documents", 0);
  });

  it("shows the format copy when the server refuses the file type", async () => {
    api.uploadDocument.mockRejectedValue(new ApiHttpError("nope", 415, { error: "unsupported_format" }));
    renderPage();
    await screen.findByDisplayValue("Receipts");
    const input = screen.getByLabelText("Choose a file", { selector: "input" });
    fireEvent.change(input, { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
    expect((await screen.findByRole("alert")).textContent).toBe("This file type can't be read in this flow.");
  });
});
