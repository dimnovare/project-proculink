import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";

const RAW = "example-not-a-real-key-1";
const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("tab=api"),
  useRouter: () => ({ replace: nav.replace }),
  usePathname: () => "/settings",
}));
vi.mock("@clerk/nextjs", () => ({ useOrganization: () => ({ organization: undefined }), useUser: () => ({ user: undefined }), useClerk: () => ({}) }));
const api = vi.hoisted(() => ({ getApiKeys: vi.fn(), createApiKey: vi.fn() }));
vi.mock("@/lib/api-client", async (o) => ({
  ...(await o<typeof import("@/lib/api-client")>()),
  getBillingStatus: vi.fn(() => new Promise(() => {})),
  getApiKeys: api.getApiKeys,
  createApiKey: api.createApiKey,
}));

import SettingsPage from "./page";

const key = { id: "key-9", label: "Accounting system", keyPrefix: "example-", isActive: true, createdAt: "2026-06-01T09:00:00Z", lastUsedAt: null, expiresAt: null };

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={qc}><SettingsPage /></QueryClientProvider>);
  return qc;
}

describe("Settings › API keys", () => {
  it("a new key is shown once: after I've saved it, it is in no element, no cache and no address", async () => {
    api.getApiKeys.mockResolvedValueOnce([]).mockResolvedValue([key]);
    api.createApiKey.mockResolvedValue({ ...key, rawKey: RAW });
    const qc = mount();
    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Accounting system" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy your new API key now" });
    expect(within(dialog).getByTestId("new-api-key")).toHaveTextContent(RAW);
    fireEvent.click(within(dialog).getByRole("button", { name: "I've saved it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.innerHTML).not.toContain(RAW);
    expect(JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data))).not.toContain(RAW);
    expect(JSON.stringify(qc.getMutationCache().getAll().map((m) => m.state.data))).not.toContain(RAW);
    expect(JSON.stringify(nav.replace.mock.calls)).not.toContain(RAW);
    expect((await screen.findAllByText("Never used")).length).toBeGreaterThan(0);
  });

  it("a member's create is told who can, and the typed name stays", async () => {
    api.getApiKeys.mockResolvedValue([]);
    api.createApiKey.mockRejectedValue(new ApiHttpError("forbidden", 403, { error: "requires_org_admin" }));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Create key" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Accounting system" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Only a workspace admin can change this.");
    expect(screen.getByLabelText("Name")).toHaveValue("Accounting system");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("while a revoke confirm is open, Create key steps back to outlined, and is filled again when it closes", async () => {
    api.getApiKeys.mockResolvedValue([key]);
    mount();
    const createKey = await screen.findByRole("button", { name: "Create key" });
    const table = within(screen.getByTestId("api-keys-table"));
    expect(createKey.className).toContain("bg-navy");
    fireEvent.click(table.getByRole("button", { name: "Revoke" }));
    const confirm = table.getByRole("group", { name: "Anything that uses this key stops working." });
    expect(createKey.className).not.toContain("bg-navy");
    fireEvent.click(within(confirm).getByRole("button", { name: "Cancel" }));
    expect(createKey.className).toContain("bg-navy");
  });
});
