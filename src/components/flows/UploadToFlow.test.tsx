import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { UploadToFlow } from "./UploadToFlow";

const listFlows = vi.fn();
vi.mock("@/lib/api/documents", () => ({ listFlows: () => listFlows() }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => "/upload" }));
vi.mock("./FlowUpload", () => ({ FlowUpload: ({ flowId }: { flowId: string }) => <div>uploading to {flowId}</div> }));

const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UploadToFlow />
    </QueryClientProvider>,
  );

describe("UploadToFlow", () => {
  it("lists every flow and uploads into the chosen one", async () => {
    listFlows.mockResolvedValue([{ id: "f1", name: "Invoices" }, { id: "f2", name: "Receipts" }]);
    renderIt();
    const select = await screen.findByLabelText("Flow");
    expect(screen.getByRole("option", { name: "Invoices" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Receipts" })).toBeTruthy();
    fireEvent.change(select, { target: { value: "f2" } });
    expect(screen.getByText("uploading to f2")).toBeTruthy();
  });

  it("with no flows, offers the first-flow prompt and no select", async () => {
    listFlows.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText("Set up your first flow")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New flow" })).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
  });
});
