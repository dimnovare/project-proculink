import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Flow } from "@/lib/api/documents";
import { FlowIntakePanel } from "./FlowIntakePanel";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({ listIntakes: vi.fn(), newIntakeAddress: vi.fn() }));
vi.mock("@/lib/api/documents", async () => ({ ...(await vi.importActual<object>("@/lib/api/documents")), ...api }));

const email = {
  id: "e1", kind: "email", config: {}, hasCredentials: false, isEnabled: true, address: "tok123@in.example.test",
  lastRunAt: null, lastStatus: null, lastMessage: null,
};

beforeEach(() => {
  api.listIntakes.mockResolvedValue([email]);
  api.newIntakeAddress.mockResolvedValue({ ...email, address: "tok456@in.example.test" });
  vi.stubGlobal("confirm", () => true);
});

const mount = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FlowIntakePanel flow={{ id: "f1" } as Flow} />
    </QueryClientProvider>,
  );

describe("FlowIntakePanel", () => {
  it("shows the address with a copy button and the flow's API address", async () => {
    mount();
    expect(await screen.findByText("tok123@in.example.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy email address" })).toBeTruthy();
    expect(screen.getByText(/\/api\/v1\/flows\/f1\/documents$/)).toBeTruthy();
    const developers = screen.getByText("API address for this flow").closest("details")!;
    expect(developers.querySelector(":scope > summary")!.textContent).toBe("For developers");
  });

  it("asks before replacing the address, then replaces it once", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Get a new address" }));
    await waitFor(() => expect(api.newIntakeAddress).toHaveBeenCalledTimes(1));
    expect(api.newIntakeAddress).toHaveBeenCalledWith("f1", "e1");
  });
});
