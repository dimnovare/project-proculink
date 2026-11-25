import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiHttpError } from "@/lib/api/core";
import { ConnectedAccounts } from "./ConnectedAccounts";

const linked = vi.hoisted(() => ({
  GOOGLE_CONNECT_CHANNEL: "proculink:google-connect",
  listLinkedAccounts: vi.fn(),
  deleteLinkedAccount: vi.fn(),
}));
vi.mock("@/lib/api/linkedAccounts", () => linked);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const T = "2026-11-01T00:00:00Z";
const renderIt = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ConnectedAccounts />
    </QueryClientProvider>,
  );

describe("ConnectedAccounts", () => {
  it("lists every account, confirms inline before disconnecting, and says the server's refusal", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: true, microsoftAvailable: true, accounts: [
      { id: "acc-1", provider: "google", email: "drive@example.test", status: "active", createdAt: T },
      { id: "acc-2", provider: "outlook", email: "inbox@example.test", status: "reconnect", createdAt: T },
    ] });
    linked.deleteLinkedAccount.mockRejectedValueOnce(new ApiHttpError("in use", 409, { error: "account_in_use" }));
    renderIt();
    const list = await screen.findByTestId("connected-accounts");
    const [google, outlook] = within(list).getAllByRole("listitem");
    expect(google).toHaveTextContent(/drive@example\.test.*Google/);
    expect(outlook).toHaveTextContent(/inbox@example\.test.*Microsoft mailbox.*Reconnect needed/);
    fireEvent.click(within(outlook).getByRole("button", { name: "Disconnect inbox@example.test, Microsoft mailbox" }));
    expect(linked.deleteLinkedAccount).not.toHaveBeenCalled();
    fireEvent.click(within(outlook).getByRole("button", { name: "Disconnect" }));
    expect(await within(outlook).findByText("A destination or a pickup still uses this account. Change it first.")).toBeTruthy();
    expect(linked.deleteLinkedAccount.mock.calls[0][0]).toBe("acc-2");
  });

  it("says plainly when nothing is connected", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: false, accounts: [] });
    renderIt();
    expect(await screen.findByText("No accounts connected. You connect one when you add a pickup or a destination.")).toBeTruthy();
  });
});
