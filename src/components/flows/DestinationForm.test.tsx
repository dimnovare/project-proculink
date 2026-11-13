import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Destination } from "@/lib/api/documents";
import { DestinationForm } from "./DestinationForm";

const api = vi.hoisted(() => ({
  createDestination: vi.fn(),
  updateDestination: vi.fn(),
  testDestination: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);
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
linked.listLinkedAccounts.mockResolvedValue({ available: false, accounts: [] });

const account = { id: "acc-1", provider: "google", email: "user@example.com", status: "active", createdAt: "2026-11-01T00:00:00Z" };
const newForm = () => within(render(
  <QueryClientProvider client={new QueryClient()}>
    <DestinationForm onSaved={() => {}} onCancel={() => {}} />
  </QueryClientProvider>,
).container);
const kinds = (ui: ReturnType<typeof newForm>) =>
  Array.from((ui.getByLabelText("Send by") as HTMLSelectElement).options).map((o) => o.textContent);

const saved: Destination = {
  id: "d1", name: "Accounting", protocol: "http", hasCredentials: true, createdAt: "2026-11-01T00:00:00Z",
  config: { url: "https://example.test/in", method: "POST", timeoutSeconds: 30, headers: { "X-Org": "a" } },
};

describe("DestinationForm", () => {
  it("keeps saved credentials and the config when only the name changes, then sends a test", async () => {
    api.updateDestination.mockResolvedValue({ ...saved, name: "Books" });
    api.testDestination.mockResolvedValue({ success: true, message: "Receiver answered 200.", responseCode: 200 });
    const onSaved = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm destination={saved} onSaved={onSaved} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Saved")).toBeTruthy();
    const name = screen.getByLabelText("Name");
    fireEvent.change(name, { target: { value: "Books" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(api.updateDestination).toHaveBeenCalledWith("d1", {
      name: "Books", protocol: "http", config: saved.config, credentials: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Send a test" }));
    expect(await screen.findByText("Receiver answered 200.")).toBeTruthy();
    expect(api.testDestination).toHaveBeenCalledWith("d1");
  });

  it("refuses a half-filled login and does not call the API", () => {
    api.updateDestination.mockClear();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm destination={saved} onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Sign in with"), { target: { value: "basic" } });
    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ops" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(/Fill in every login field/)).toBeTruthy();
    expect(api.updateDestination).not.toHaveBeenCalled();
  });

  it("offers an email subject and message but no attachment file name, which a flow send ignores", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.change(within(container).getByLabelText("Send by"), { target: { value: "email" } });
    expect(within(container).getByLabelText("Subject")).toBeTruthy();
    expect(within(container).getByLabelText("Message")).toBeTruthy();
    expect(within(container).queryByLabelText(/attachment/i)).toBeNull();
  });

  it("takes an SFTP private key in a textarea that keeps its line breaks, and does not show it after saving", async () => {
    const key = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\nBBBB\n-----END OPENSSH PRIVATE KEY-----\n";
    api.createDestination.mockResolvedValue({ ...saved, id: "d2", protocol: "sftp", config: {} });
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    const ui = within(container);
    fireEvent.change(ui.getByLabelText("Send by"), { target: { value: "sftp" } });
    fireEvent.change(ui.getByLabelText("Name"), { target: { value: "Files" } });
    fireEvent.change(ui.getByLabelText("Username"), { target: { value: "ops" } });
    const box = ui.getByLabelText("Private key (instead of password)") as HTMLTextAreaElement;
    expect(box.tagName).toBe("TEXTAREA");
    fireEvent.change(box, { target: { value: key } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createDestination).toHaveBeenCalled());
    expect(api.createDestination.mock.calls[0][0].credentials).toEqual({ username: "ops", privateKey: key });
    await waitFor(() => expect(box.value).toBe(""));
  });

  it("takes an S3 bucket and posts exactly the bucket keys, with the secret as the credential", async () => {
    api.createDestination.mockResolvedValue({ ...saved, id: "d3", protocol: "s3", config: {} });
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    const ui = within(container);
    fireEvent.change(ui.getByLabelText("Send by"), { target: { value: "s3" } });
    for (const [label, value] of [["Name", "Archive"], ["Bucket", "orders"], ["Folder", "out/"], ["Region", "auto"],
      ["Endpoint URL", "https://r2.example.test"], ["Access key ID", "AKIA1"], ["Secret access key", "shh"]])
      fireEvent.change(ui.getByLabelText(label), { target: { value } });
    expect(ui.getByText(/Only for R2, MinIO/)).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createDestination).toHaveBeenCalled());
    expect(api.createDestination.mock.calls.at(-1)![0]).toEqual({
      name: "Archive", protocol: "s3",
      config: { bucket: "orders", prefix: "out/", region: "auto", serviceUrl: "https://r2.example.test", accessKeyId: "AKIA1" },
      credentials: { secretKey: "shh" },
    });
  });

  it("offers Google only when the server says it is available", async () => {
    const ui = newForm();
    await waitFor(() => expect(linked.listLinkedAccounts).toHaveBeenCalled());
    expect(kinds(ui)).not.toContain("Google Drive");
    expect(kinds(ui)).not.toContain("Google Sheets");
  });

  it("sends to a picked Google Drive folder with no login fields", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: true, accounts: [account] });
    linked.getGooglePicker.mockResolvedValue({ accessToken: "at", apiKey: "k", appId: "1" });
    picker.openGooglePicker.mockResolvedValue({ id: "fold-1", name: "Invoices" });
    api.createDestination.mockReset().mockResolvedValue({ ...saved, id: "d4", protocol: "google_drive", config: {} });
    const ui = newForm();
    await waitFor(() => expect(kinds(ui)).toContain("Google Drive"));
    fireEvent.change(ui.getByLabelText("Send by"), { target: { value: "google_drive" } });
    expect(ui.getByText("user@example.com")).toBeTruthy();
    expect(ui.queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(document.querySelector("input[type=password], textarea")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Choose folder" }));
    expect(await ui.findByText("Invoices")).toBeTruthy();
    expect(picker.openGooglePicker).toHaveBeenCalledWith({ kind: "folder", accessToken: "at", apiKey: "k", appId: "1" });
    fireEvent.change(ui.getByLabelText("Name"), { target: { value: "Drive" } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createDestination).toHaveBeenCalledTimes(1));
    expect(api.createDestination.mock.calls[0][0]).toEqual({
      name: "Drive", protocol: "google_drive",
      config: { accountId: "acc-1", folderId: "fold-1", folderName: "Invoices" }, credentials: null,
    });
  });

  it("offers Reconnect for an account whose Google access was removed", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: true, accounts: [{ ...account, status: "reconnect" }] });
    const ui = newForm();
    await waitFor(() => expect(kinds(ui)).toContain("Google Sheets"));
    fireEvent.change(ui.getByLabelText("Send by"), { target: { value: "google_sheets" } });
    expect(ui.getByRole("button", { name: "Reconnect" })).toBeTruthy();
    expect((ui.getByRole("button", { name: "Choose spreadsheet" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says a saved account is gone instead of showing another account as chosen", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: true, accounts: [account] });
    const gone: Destination = { ...saved, protocol: "google_drive", hasCredentials: false,
      config: { accountId: "acc-gone", folderId: "f0", folderName: "Old folder" } };
    const ui = within(render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm destination={gone} onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    ).container);
    expect(await ui.findByText("That Google account is no longer connected.")).toBeTruthy();
    expect((ui.getByLabelText("Google account") as HTMLSelectElement).value).toBe("");
    expect(ui.queryByText("Old folder")).toBeNull();
    expect(ui.queryByRole("button", { name: "Choose folder" })).toBeNull();
  });
});
