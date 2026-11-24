import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FlowIntake } from "@/lib/api/documents";
import { PickupForm } from "./PickupForm";

const api = vi.hoisted(() => ({ createIntake: vi.fn(), updateIntake: vi.fn(), testIntake: vi.fn() }));
vi.mock("@/lib/api/documents", () => api);
const linked = vi.hoisted(() => ({
  GOOGLE_CONNECT_CHANNEL: "proculink:google-connect",
  listLinkedAccounts: vi.fn(async (): Promise<{ available: boolean; microsoftAvailable?: boolean; accounts: unknown[] }> => ({ available: false, accounts: [] })),
  startOutlookConnect: vi.fn(), startGoogleConnect: vi.fn(), deleteLinkedAccount: vi.fn(), getGooglePicker: vi.fn(),
}));
vi.mock("@/lib/api/linkedAccounts", () => linked);
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const wrap = (intake?: FlowIntake) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PickupForm flowId="f1" intake={intake} onDone={() => {}} />
    </QueryClientProvider>,
  );

const saved: FlowIntake = {
  id: "i1", kind: "sftp", hasCredentials: true, isEnabled: true, address: null, lastRunAt: null, lastStatus: null, lastMessage: null,
  config: { host: "sftp.example.test", port: 22, username: "ops", directory: "/in", hostKeyFingerprints: ["SHA256:abc"] },
};

describe("PickupForm", () => {
  it("creates an SFTP pickup with the password as credentials", async () => {
    api.createIntake.mockResolvedValue({ ...saved });
    wrap();
    fireEvent.change(screen.getByLabelText("Server"), { target: { value: "sftp.example.test" } });
    fireEvent.change(screen.getByLabelText("User name"), { target: { value: "ops" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createIntake).toHaveBeenCalled());
    expect(api.createIntake.mock.calls[0][1]).toMatchObject({
      kind: "sftp", credentials: { password: "pw" }, config: { host: "sftp.example.test", username: "ops", port: 22 },
    });
  });

  it("keeps the saved password and fingerprint when the password is left blank", async () => {
    api.updateIntake.mockResolvedValue(saved);
    wrap(saved);
    expect(screen.getByLabelText("Password").getAttribute("placeholder")).toBe("Leave blank to keep the saved one");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.updateIntake).toHaveBeenCalled());
    const [, id, req] = api.updateIntake.mock.calls[0];
    expect(id).toBe("i1");
    expect(req.credentials).toBeNull();
    expect(req.config).not.toHaveProperty("hostKeyFingerprints");
  });

  it("warns that FTP is unencrypted", () => {
    wrap();
    expect(screen.queryByText(/sends your password unencrypted/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "ftp" } });
    expect(screen.getByText(/FTP sends your password unencrypted/)).toBeTruthy();
  });

  it("offers the Outlook mailbox only when Microsoft is on, lists only Outlook accounts, and saves the account and folder", async () => {
    const account = { status: "active", createdAt: "2026-11-24T00:00:00Z" };
    linked.listLinkedAccounts.mockResolvedValue({
      available: false, microsoftAvailable: true,
      accounts: [{ id: "ms-1", provider: "outlook", email: "user@example.com", ...account }, { id: "g-1", provider: "google", email: "other@example.com", ...account },
        { id: "ms-2", provider: "outlook", email: "new@example.com", ...account, status: "later" }], // a status this build does not know
    });
    api.createIntake.mockResolvedValue({ ...saved, kind: "outlook", config: { accountId: "ms-1", folder: "Inbox" } });
    const ui = wrap();
    const option = await screen.findByRole("option", { name: "Outlook or Microsoft 365 mailbox" });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: (option as HTMLOptionElement).value } });
    expect(await screen.findByRole("option", { name: "user@example.com" })).toBeTruthy();
    expect(screen.queryByText("other@example.com")).toBeNull();
    expect(screen.getByRole("option", { name: "new@example.com (Reconnect needed)" })).toBeTruthy();
    expect(screen.queryByLabelText("Password")).toBeNull();
    fireEvent.change(screen.getByLabelText("Microsoft account"), { target: { value: "ms-1" } });
    expect(screen.getByRole("button", { name: "Disconnect" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createIntake).toHaveBeenCalledWith("f1", {
      kind: "outlook", config: { accountId: "ms-1", folder: "Inbox", fromFilter: "", subjectFilter: "" }, credentials: null,
    }));
    // Saved, the pickup holds that account, so disconnecting it is not offered.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Disconnect" })).toBeNull());

    ui.unmount();
    linked.listLinkedAccounts.mockResolvedValue({ available: false, microsoftAvailable: false, accounts: [] });
    const calls = linked.listLinkedAccounts.mock.calls.length;
    wrap();
    await waitFor(() => expect(linked.listLinkedAccounts.mock.calls.length).toBeGreaterThan(calls));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByRole("option", { name: "Outlook or Microsoft 365 mailbox" })).toBeNull();
  });
});
