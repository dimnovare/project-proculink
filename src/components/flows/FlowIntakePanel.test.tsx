import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Flow } from "@/lib/api/documents";
import { FlowIntakePanel } from "./FlowIntakePanel";

vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const api = vi.hoisted(() => ({ listIntakes: vi.fn(), newIntakeAddress: vi.fn(), getInbox: vi.fn() }));
vi.mock("@/lib/api/documents", async () => ({ ...(await vi.importActual<object>("@/lib/api/documents")), ...api }));

const email = {
  id: "e1", kind: "email", config: {}, hasCredentials: false, isEnabled: true, address: "tok123@in.example.test",
  lastRunAt: null, lastStatus: null, lastMessage: null,
};
const inbox = { flowId: "inbox-1", address: null as string | null, intakeId: "i0" };

beforeEach(() => {
  vi.clearAllMocks();
  api.listIntakes.mockResolvedValue([email]);
  api.newIntakeAddress.mockResolvedValue({ ...email, address: "tok456@in.example.test" });
  api.getInbox.mockResolvedValue(inbox);
  vi.stubGlobal("confirm", () => true);
});

const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <FlowIntakePanel flow={{ id: "f1" } as Flow} />
      </QueryClientProvider>,
    ),
  };
};

describe("FlowIntakePanel", () => {
  it("shows the address with a copy button and the flow's API address", async () => {
    mount();
    expect(await screen.findByText("tok123@in.example.test")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy email address" })).toBeTruthy();
    expect(screen.getByText(/\/api\/v1\/flows\/f1\/documents$/)).toBeTruthy();
    const developers = screen.getByText("API address for this flow").closest("details")!;
    expect(developers.querySelector(":scope > summary")!.textContent).toMatch(/^For developers/);
  });

  it("asks before replacing the address, then replaces it once", async () => {
    mount();
    vi.stubGlobal("confirm", () => false);
    fireEvent.click(await screen.findByRole("button", { name: "Get a new address" }));
    // The answer is awaited inside the handler: let it finish, so "no" is what is checked.
    await act(async () => {});
    expect(api.newIntakeAddress).not.toHaveBeenCalled();
    vi.stubGlobal("confirm", () => true);
    fireEvent.click(screen.getByRole("button", { name: "Get a new address" }));
    await waitFor(() => expect(api.newIntakeAddress).toHaveBeenCalledTimes(1));
    expect(api.newIntakeAddress).toHaveBeenCalledWith("f1", "e1");
  });

  it("leads with the workspace address and folds this flow's own", async () => {
    api.getInbox.mockResolvedValue({ ...inbox, address: "documents@in.example.test" });
    const { client } = mount();
    const lead = await screen.findByText((_, el) => el?.tagName === "P" && el.textContent === "Send any document to documents@in.example.test");
    expect(within(lead.parentElement!).getByRole("button", { name: "Copy address" })).toBeTruthy();
    const fold = (await screen.findByText("tok123@in.example.test")).closest("details")!;
    expect(fold.hasAttribute("open")).toBe(false);
    expect(fold.querySelector(":scope > summary")!.textContent).toMatch(/^This flow's own address/);
    expect(within(fold).getByRole("button", { name: "Get a new address" })).toBeTruthy();
    expect(screen.getByText("Collect from a mailbox or a server")).toBeTruthy();

    api.getInbox.mockRejectedValue(new Error("down"));
    await act(() => client.refetchQueries({ queryKey: ["inbox"] }));
    await waitFor(() => expect(screen.queryByText(/Send any document to/)).toBeNull());
    expect(screen.getByText("tok123@in.example.test").closest("details")).toBeNull();
  });

  it("a paused address opens its own fold; the inbox's own flow is led by its Email card", async () => {
    api.getInbox.mockResolvedValue({ ...inbox, address: "documents@in.example.test" });
    api.listIntakes.mockResolvedValue([{ ...email, lastStatus: "paused", lastMessage: "Processing is paused for this workspace." }]);
    const first = mount();
    const note = await screen.findByText("Processing is paused for this workspace.");
    expect(note.closest("details")!.hasAttribute("open")).toBe(true);
    first.unmount();

    api.getInbox.mockResolvedValue({ ...inbox, flowId: "f1", address: "documents@in.example.test" });
    api.listIntakes.mockResolvedValue([email]);
    const second = mount();
    const own = await screen.findByText("tok123@in.example.test");
    await waitFor(() => expect(second.client.getQueryState(["inbox"])?.status).toBe("success"));
    expect(screen.queryByText(/Send any document to/)).toBeNull();
    expect(own.closest("details")).toBeNull();
    expect(screen.getByText("Email")).toBeTruthy();
  });

  it("with no workspace address the flow's own address leads, open; with none of its own it offers one without a warning", async () => {
    api.getInbox.mockRejectedValue(new Error("down"));
    const first = mount();
    const own = await screen.findByText("tok123@in.example.test");
    await waitFor(() => expect(first.client.getQueryState(["inbox"])?.status).toBe("error"));
    expect(own.closest("details")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy email address" }).closest("details")).toBeNull();
    expect(screen.queryByText(/Send any document to/)).toBeNull();
    first.unmount();

    api.getInbox.mockResolvedValue(inbox);
    api.listIntakes.mockResolvedValue([{ ...email, address: null }]);
    vi.stubGlobal("confirm", () => false);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Get an address" }));
    await waitFor(() => expect(api.newIntakeAddress).toHaveBeenCalledTimes(1));
    expect(api.newIntakeAddress).toHaveBeenCalledWith("f1", "e1");
  });
});
