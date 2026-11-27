import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Destination } from "@/lib/api/documents";
import { DestinationForm } from "./DestinationForm";

const api = vi.hoisted(() => ({
  createDestination: vi.fn(),
  updateDestination: vi.fn(),
  testDestination: vi.fn(),
  listDocumentPage: vi.fn(),
  sendDocument: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);
api.listDocumentPage.mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 50, sampleCount: 0 });
const linked = vi.hoisted(() => ({
  GOOGLE_CONNECT_CHANNEL: "proculink:google-connect",
  listLinkedAccounts: vi.fn(),
  getGooglePicker: vi.fn(),
  startGoogleConnect: vi.fn(),
  startMicrosoftConnect: vi.fn(),
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
  id: "d1", name: "Accounting", protocol: "http", hasCredentials: true, createdAt: "2026-11-01T00:00:00Z", usedBy: [], lastSend: null,
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
    expect(screen.getByText("A login is saved. Leave the login boxes blank to keep it.")).toBeTruthy();
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

  it("says what each box needs under it, marks it invalid, focuses the first, and saves nothing", async () => {
    api.createDestination.mockClear();
    const ui = newForm();
    fireEvent.change(ui.getByLabelText("Send to (separate addresses with commas)"), { target: { value: "accounts, books@example.test" } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    const name = ui.getByLabelText("Name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription("Give this destination a name.");
    expect(ui.getByLabelText("Send to (separate addresses with commas)")).toHaveAccessibleDescription("Enter an email address, like name@example.com.");
    await waitFor(() => expect(name).toHaveFocus());
    expect(api.createDestination).not.toHaveBeenCalled();
    fireEvent.change(name, { target: { value: "Books" } });
    expect(name).not.toHaveAttribute("aria-invalid");
    const to = ui.getByLabelText("Send to (separate addresses with commas)");
    fireEvent.change(to, { target: { value: "Books <books@example.test>, ap@example.test" } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    expect(to).not.toHaveAttribute("aria-invalid");
    await waitFor(() => expect(api.createDestination).toHaveBeenCalledTimes(1));
  });

  it("offers an email subject and message but no attachment file name, which a flow send ignores", () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    );
    fireEvent.change(within(container).getByLabelText("Send by"), { target: { value: "email" } });
    fireEvent.click(within(container).getByRole("button", { name: /^More options/ }));
    expect(within(container).getByLabelText("Subject")).toBeTruthy();
    expect(within(container).getByLabelText("Message")).toBeTruthy();
    expect(within(container).queryByLabelText(/attachment/i)).toBeNull();
    const language = within(container).getByLabelText("Language of the default message");
    expect(language).toHaveValue("");
    expect(within(language).getAllByRole("option").map((o) => o.textContent))
      .toEqual(["Same as the document", "English", "Deutsch", "Français", "Polski", "Eesti"]);
  });

  it("takes an SFTP private key in a textarea that keeps its line breaks, and does not show it after saving", async () => {
    api.createDestination.mockClear();
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
    fireEvent.change(ui.getByLabelText("Server"), { target: { value: "sftp.example.test" } });
    fireEvent.change(ui.getByLabelText("Username"), { target: { value: "ops" } });
    fireEvent.click(ui.getByRole("button", { name: /^More options/ }));
    const box = ui.getByLabelText("Private key (instead of password)") as HTMLTextAreaElement;
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveClass("font-mono");
    expect(box).not.toHaveClass("h-10");
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
    fireEvent.click(ui.getByRole("button", { name: /^More options/ }));
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

  it("Send by lists the same kinds, email first and the server kinds in one group", async () => {
    const ui = newForm();
    await waitFor(() => expect(linked.listLinkedAccounts).toHaveBeenCalled());
    const select = ui.getByLabelText("Send by") as HTMLSelectElement;
    expect(select).toHaveValue("email");
    expect(kinds(ui)).toEqual(["Email", "SFTP", "FTPS", "S3 bucket", "Web address (API)"]);
    expect(select.querySelector('optgroup[label="A server or another system"]')!.children).toHaveLength(4);
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
    expect(ui.queryByRole("button", { name: "Disconnect" })).toBeNull(); // accounts are removed in Settings only
    expect(ui.getByRole("link", { name: "Manage accounts in Workspace › Connected accounts" })).toHaveAttribute("href", "/settings?tab=org");
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

  it("offers OneDrive only when Microsoft is on, lists only its files accounts, and saves the pasted link", async () => {
    const ms = { ...account, id: "ms-1", provider: "microsoft" };
    linked.listLinkedAccounts.mockResolvedValue({ available: false, microsoftAvailable: true, accounts: [
      ms, { ...account, id: "g-1", email: "other@example.com" }, { ...account, id: "o-1", provider: "outlook", email: "mail@example.com" },
    ] });
    api.createDestination.mockClear().mockResolvedValue({ ...saved, protocol: "microsoft_onedrive", hasCredentials: false, config: {} });
    const ui = newForm();
    await waitFor(() => expect(kinds(ui)).toContain("OneDrive"));
    expect(kinds(ui)).not.toContain("Google Drive");
    fireEvent.change(ui.getByLabelText("Send by"), { target: { value: "microsoft_onedrive" } });
    expect(ui.getByText("user@example.com")).toBeTruthy();
    expect(ui.queryByText("other@example.com")).toBeNull();
    expect(ui.queryByText("mail@example.com")).toBeNull();
    expect(ui.queryByLabelText("Tab (optional)"), "the Sheets tab box is not OneDrive's (live 2026-11-25)").toBeNull();
    fireEvent.change(ui.getByLabelText("Folder link"), { target: { value: "https://contoso.sharepoint.com/:f:/s/team/EaBc1" } });
    fireEvent.change(ui.getByLabelText("Name"), { target: { value: "OneDrive" } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createDestination).toHaveBeenCalledTimes(1));
    expect(api.createDestination.mock.calls[0][0]).toEqual({
      name: "OneDrive", protocol: "microsoft_onedrive",
      config: { accountId: "ms-1", link: "https://contoso.sharepoint.com/:f:/s/team/EaBc1" }, credentials: null,
    });
  });

  it("offers B2Brouter only when the server says Peppol is available", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: false, accounts: [] });
    const hidden = newForm();
    await waitFor(() => expect(linked.listLinkedAccounts).toHaveBeenCalled());
    expect(kinds(hidden)).not.toContain("B2Brouter");
    linked.listLinkedAccounts.mockResolvedValue({ available: false, peppolAvailable: true, accounts: [] });
    const shown = newForm();
    await waitFor(() => expect(kinds(shown)).toContain("B2Brouter"));
    // An e-invoice network is early access: its group says so.
    expect(shown.getByRole("group", { name: "E-invoice network (early access)" })).toBeInTheDocument();
  });

  it("saves B2Brouter with the key as a credential, never in config", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: false, peppolAvailable: true, accounts: [] });
    api.createDestination.mockClear().mockResolvedValue({ ...saved, id: "b1", name: "E-invoices", protocol: "b2brouter", config: { account: "acc-1", sandbox: true } });
    const ui = newForm();
    await waitFor(() => expect(kinds(ui)).toContain("B2Brouter"));
    fireEvent.change(ui.getByLabelText("Send by"), { target: { value: "b2brouter" } });
    for (const [label, value] of [["Name", "E-invoices"], ["B2Brouter account ID", "acc-1"], ["API key", "test_k"]])
      fireEvent.change(ui.getByLabelText(label), { target: { value } });
    expect(ui.getByText("Sending invoices in France")).toBeTruthy();
    expect(ui.getByLabelText("API key").closest("label")!.parentElement!.parentElement).toHaveClass("col-span-full"); // its own row
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createDestination).toHaveBeenCalledTimes(1));
    expect(api.createDestination.mock.calls[0][0]).toEqual({
      name: "E-invoices", protocol: "b2brouter", config: { account: "acc-1" }, credentials: { apiKey: "test_k" },
    });
  });

  it("KSeF destination starts on Test and needs the issuer tick for Production", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: false, ksefAvailable: true, accounts: [] });
    const created: Destination = { ...saved, id: "k1", name: "KSeF", protocol: "ksef", config: { environment: "test", nip: "1111111111" } };
    api.createDestination.mockClear().mockResolvedValue(created);
    const ui = newForm();
    await waitFor(() => expect(kinds(ui)).toContain("KSeF"));
    fireEvent.change(ui.getByLabelText("Send by"), { target: { value: "ksef" } });
    expect(ui.queryByRole("radio", { name: /^Production/ })).toBeNull();
    expect(ui.getByRole("radio", { name: /^Test:/ })).toBeChecked();
    for (const [label, value] of [["Name", "KSeF"], ["NIP", "1111111111"], ["KSeF token", "t"]])
      fireEvent.change(ui.getByLabelText(label), { target: { value } });
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.createDestination).toHaveBeenCalledTimes(1));
    expect(api.createDestination.mock.calls[0][0]).toEqual({
      name: "KSeF", protocol: "ksef", config: { environment: "test", nip: "1111111111" }, credentials: { token: "t" },
    });
    // the saved destination is now edited: Production is offered, and Save says, under the issuer tick, that it waits for it
    api.updateDestination.mockClear().mockResolvedValue({ ...created, config: { environment: "production", nip: "1111111111" } });
    fireEvent.click(ui.getByRole("radio", { name: /^Production/ }));
    const save = ui.getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(api.updateDestination).not.toHaveBeenCalled();
    const tick = ui.getByRole("checkbox", { name: /^Required for Production: I confirm that every invoice sent from this destination/ });
    expect(tick).toHaveAttribute("aria-invalid", "true");
    expect(tick).toHaveAccessibleDescription("Tick this to send real invoices to KSeF Production.");
    await waitFor(() => expect(tick).toHaveFocus());
    fireEvent.click(tick);
    expect(ui.queryByText("Tick this to send real invoices to KSeF Production.")).toBeNull();
    fireEvent.click(save);
    await waitFor(() => expect(api.updateDestination).toHaveBeenCalledTimes(1));
    expect(api.updateDestination.mock.calls[0][1].config).toEqual({ environment: "production", nip: "1111111111", acceptedIssuerTerms: true });
  });

  it("asks for the issuer tick again when a Production KSeF destination's NIP changes", async () => {
    api.updateDestination.mockClear();
    linked.listLinkedAccounts.mockResolvedValue({ available: false, ksefAvailable: true, accounts: [] });
    const prod: Destination = { ...saved, id: "k2", name: "KSeF", protocol: "ksef", hasCredentials: true, config: { environment: "production", nip: "1111111111" } };
    const ui = within(render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm destination={prod} onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    ).container);
    await waitFor(() => expect(ui.getByRole("radio", { name: /^Production/ })).toBeChecked());
    expect(ui.queryByRole("checkbox", { name: /I confirm that every invoice sent from this destination/ })).toBeNull();
    fireEvent.change(ui.getByLabelText("NIP"), { target: { value: "PL 999-999-99-99" } });
    expect(ui.getByRole("checkbox", { name: /I confirm that every invoice sent from this destination/ })).toBeTruthy();
    fireEvent.click(ui.getByRole("button", { name: "Save" }));
    expect(ui.getByText("Tick this to send real invoices to KSeF Production.")).toBeTruthy();
    expect(api.updateDestination).not.toHaveBeenCalled();
  });

  it("holds Save and send a test until the issuer tick, on a destination switched to Production", async () => {
    linked.listLinkedAccounts.mockResolvedValue({ available: false, ksefAvailable: true, accounts: [] });
    const k: Destination = { ...saved, id: "k3", name: "KSeF", protocol: "ksef", hasCredentials: true, config: { environment: "test", nip: "1111111111" } };
    const ui = within(render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm destination={k} testAfterSave onSaved={() => {}} onCancel={() => {}} />
      </QueryClientProvider>,
    ).container);
    await waitFor(() => expect(ui.getByRole("radio", { name: /^Production/ })).toBeTruthy());
    expect(ui.getByLabelText("New KSeF token")).toBeTruthy();
    fireEvent.click(ui.getByRole("radio", { name: /^Production/ }));
    api.updateDestination.mockClear();
    fireEvent.click(ui.getByRole("button", { name: "Save and send a test" }));
    expect(ui.getByText("Tick this to send real invoices to KSeF Production.")).toBeTruthy();
    expect(api.updateDestination).not.toHaveBeenCalled();
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
    expect(await ui.findByText("That account is no longer connected.")).toBeTruthy();
    expect((ui.getByLabelText("Google account") as HTMLSelectElement).value).toBe("");
    expect(ui.queryByText("Old folder")).toBeNull();
    expect(ui.queryByRole("button", { name: "Choose folder" })).toBeNull();
    expect(ui.getByRole("button", { name: "Save" })).toBeDisabled(); // nothing to send with until an account is chosen
    expect(ui.getByText("Choose an account before you save.")).toBeTruthy();
  });

  it("Save and send a test saves, then tests, keeps the login write-only, and folds what is rarely changed", async () => {
    const sftp: Destination = {
      id: "d2", name: "Accounting server", protocol: "sftp", hasCredentials: true, createdAt: "2026-11-01T00:00:00Z", usedBy: [], lastSend: null,
      config: { host: "sftp.example.test", port: 22, remotePath: "/in/invoices", makeDirectories: true, overwriteExisting: true, timeoutSeconds: 30, hostKeyFingerprints: ["SHA256:example"] },
    };
    api.updateDestination.mockClear().mockResolvedValue(sftp);
    api.testDestination.mockClear().mockResolvedValue({ success: true, message: null, responseCode: null });
    const ui = within(render(
      <QueryClientProvider client={new QueryClient()}><DestinationForm destination={sftp} inline testAfterSave onSaved={() => {}} onCancel={() => {}} /></QueryClientProvider>,
    ).container);
    expect(ui.queryByLabelText("Send by")).toBeNull();
    expect(ui.queryByLabelText("Port")).toBeNull();
    expect(ui.getByLabelText("Username")).toHaveValue("");
    expect(ui.getByLabelText("New password")).toHaveAttribute("placeholder", "Leave blank to keep the saved one");
    fireEvent.click(ui.getByRole("button", { name: /^More options/ }));
    expect(ui.getByLabelText("Port")).toHaveValue(22);
    expect(ui.getByRole("button", { name: "Save" })).toBeInTheDocument(); // a plain save, which sends no test
    expect(ui.queryByRole("button", { name: "Send a test" })).toBeNull();
    const saveAndTest = ui.getByRole("button", { name: "Save and send a test" });
    fireEvent.click(saveAndTest);
    fireEvent.click(saveAndTest); // a second press in the same tick saves nothing more
    await waitFor(() => expect(api.testDestination).toHaveBeenCalledWith("d2"));
    expect(api.updateDestination).toHaveBeenCalledTimes(1);
    expect(api.updateDestination).toHaveBeenCalledWith("d2", { name: "Accounting server", protocol: "sftp", config: sftp.config, credentials: null });
    expect(api.updateDestination.mock.invocationCallOrder[0]).toBeLessThan(api.testDestination.mock.invocationCallOrder[0]);
    expect(await ui.findByText(/^Test file arrived at \d\d:\d\d\.$/)).toBeInTheDocument();
    expect(ui.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("a chosen form names the destination for the person and reports its test", async () => {
    const made: Destination = {
      id: "dest-9", name: "Invoices server", protocol: "sftp", hasCredentials: true, createdAt: "2026-11-15T09:00:00Z", usedBy: [], lastSend: null,
      config: { host: "sftp.example.test" },
    };
    api.createDestination.mockClear().mockResolvedValue(made);
    api.testDestination.mockClear().mockResolvedValue({ success: true, message: null, responseCode: null });
    const onTested = vi.fn();
    // The form is not a <form> (it sits inside other forms): the render's container stands for it.
    const form = within(render(
      <QueryClientProvider client={new QueryClient()}>
        <DestinationForm inline testAfterSave chosen={{ protocols: ["sftp", "ftps"], name: "Invoices server", onTested }} onSaved={vi.fn()} onCancel={vi.fn()} />
      </QueryClientProvider>,
    ).container);
    expect(form.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(form.getByText("We'll save this destination as Invoices server.")).toBeInTheDocument();
    expect(within(form.getByRole("combobox", { name: "Send by" })).getAllByRole("option").map((o) => o.getAttribute("value")))
      .toEqual(["sftp", "ftps"]);
    fireEvent.change(form.getByLabelText("Server"), { target: { value: "sftp.example.test" } });
    fireEvent.change(form.getByLabelText("Username"), { target: { value: "robot" } });
    fireEvent.change(form.getByLabelText("Password"), { target: { value: "pw" } });
    fireEvent.click(form.getByRole("button", { name: "Save and send a test" }));
    await waitFor(() => expect(onTested).toHaveBeenCalledWith({ destinationId: "dest-9", ok: true }));
    expect(api.createDestination.mock.calls[0][0]).toMatchObject({ name: "Invoices server", protocol: "sftp" });
    expect(form.getByLabelText("New password")).toHaveValue("");          // a saved secret is never shown back
    // Outlined after the save, so the step's own button is the one filled button.
    expect(form.getByRole("button", { name: "Save and send a test" }).className).toMatch(/\bbg-surface\b/);
  });
});
