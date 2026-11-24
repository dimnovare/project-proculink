import { describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import { ApiHttpError } from "@/lib/api/core";
import type { Destination } from "@/lib/api/documents";
import { GoogleAccounts } from "./GoogleAccounts";

const linked = vi.hoisted(() => ({
  GOOGLE_CONNECT_CHANNEL: "proculink:google-connect",
  listLinkedAccounts: vi.fn(),
  getGooglePicker: vi.fn(),
  startGoogleConnect: vi.fn(),
  deleteLinkedAccount: vi.fn(),
}));
vi.mock("@/lib/api/linkedAccounts", () => linked);
const picker = vi.hoisted(() => ({ openGooglePicker: vi.fn() }));
vi.mock("@/lib/googlePicker", () => picker);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const T = "2026-11-01T00:00:00Z";
const base: Destination = {
  id: "", name: "", protocol: "google_drive", config: {}, hasCredentials: false, createdAt: T, usedBy: [], lastSend: null,
};
let qc: QueryClient;
const renderAccounts = (destinations: Destination[] | undefined) => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ConfirmProvider>
      <QueryClientProvider client={qc}>
        <GoogleAccounts destinations={destinations} />
      </QueryClientProvider>
    </ConfirmProvider>,
  );
};

describe("GoogleAccounts", () => {
  it("lists each connected account with what uses it, asks before disconnecting, says a refusal, and is absent when Google is not offered", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: true, accounts: [
      { id: "acc-1", provider: "google", email: "accounts@example.test", status: "active", createdAt: T },
      { id: "acc-2", provider: "google", email: "old@example.test", status: "reconnect", createdAt: T },
      { id: "acc-3", provider: "google", email: "next@example.test", status: "suspended", createdAt: T },
    ] });
    const uses = [
      { ...base, id: "g1", name: "Invoices folder", protocol: "google_drive", config: { accountId: "acc-1", folderName: "Invoices 2026" } },
      { ...base, id: "g2", name: "Weekly log", protocol: "google_sheets", config: { accountId: "acc-1" } },
    ];
    renderAccounts(uses);
    const block = await screen.findByRole("region", { name: "Google accounts" });
    const [first, second, third] = within(block).getAllByRole("listitem");
    // A status this build does not know says nothing about the connection, and Reconnect stays offered.
    expect([third.textContent?.match(/Connected|Reconnect needed/), within(third).getAllByRole("button").map((b) => b.getAttribute("aria-label"))])
      .toEqual([null, ["Reconnect next@example.test", "Disconnect next@example.test"]]);
    expect(first).toHaveTextContent(/accounts@example\.test.*Used by Invoices folder and Weekly log.*Connected/);
    expect(second).toHaveTextContent(/old@example\.test.*Not used by a destination yet\..*Reconnect needed/);
    expect(block).toHaveTextContent("Keep the Google Drive box ticked, or we can't save files or add rows.");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    linked.deleteLinkedAccount.mockRejectedValueOnce(new ApiHttpError("in use", 409, { error: "account_in_use" }));
    fireEvent.click(within(first).getByRole("button", { name: "Disconnect accounts@example.test" }));
    fireEvent.click(await screen.findByRole("button", { name: "Disconnect" }));
    expect(await within(first).findByRole("alert")).toHaveTextContent("A destination or a pickup still uses this account. Change it first.");
    expect(linked.deleteLinkedAccount).toHaveBeenCalledWith("acc-1");
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["destinations"] }); // so the use line can name what holds it
    cleanup();
    renderAccounts(undefined);
    expect(await screen.findByRole("region", { name: "Google accounts" })).not.toHaveTextContent(/Used by|Not used/);
    cleanup();
    linked.listLinkedAccounts.mockResolvedValue({ available: false, accounts: [] });
    renderAccounts(uses);
    // Asserted only once the answer has landed: while loading the block is absent anyway.
    await waitFor(() => expect(qc.getQueryState(["linked-accounts"])?.status).toBe("success"));
    await act(() => new Promise((r) => setTimeout(r, 0)));
    expect(screen.queryByRole("region", { name: "Google accounts" })).toBeNull();
  });
});
