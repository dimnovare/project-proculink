import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfirmProvider } from "@/components/ui/confirm";
import { ApiHttpError } from "@/lib/api/core";
import type { Destination } from "@/lib/api/documents";
import { DestinationsSection } from "./DestinationsSection";

const api = vi.hoisted(() => ({
  listDestinations: vi.fn(), testDestination: vi.fn(), deleteDestination: vi.fn(), createDestination: vi.fn(),
  updateDestination: vi.fn(), listDocumentPage: vi.fn(), sendDocument: vi.fn(),
}));
vi.mock("@/lib/api/documents", () => api);
const linked = vi.hoisted(() => ({
  GOOGLE_CONNECT_CHANNEL: "proculink:google-connect",
  listLinkedAccounts: vi.fn().mockResolvedValue({ available: false, accounts: [] }),
  getGooglePicker: vi.fn(),
  startGoogleConnect: vi.fn(),
  deleteLinkedAccount: vi.fn(),
}));
vi.mock("@/lib/api/linkedAccounts", () => linked);
const replace = vi.hoisted(() => vi.fn());
const search = vi.hoisted(() => ({ q: "" }));
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(search.q),
  useRouter: () => ({ replace, push: vi.fn() }),
}));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useTenantQueriesEnabled: () => true }));

const inbox: Destination = {
  id: "dest-1", name: "Accounting inbox", protocol: "email", config: { toAddresses: "accounting@example.test" },
  hasCredentials: false, createdAt: "2026-05-01T00:00:00Z",
  usedBy: [{ flowId: "flow-1", flowName: "Supplier invoices", outputId: "out-1", outputName: "Invoice CSV" }],
  lastSend: { kind: "document", at: "2026-05-24T09:10:00Z", ok: false },
};
const server: Destination = {
  id: "dest-3", name: "Accounting server", protocol: "sftp", config: { host: "sftp.example.test", remotePath: "/in/invoices" },
  hasCredentials: true, createdAt: "2026-05-01T00:00:00Z", usedBy: [], lastSend: null,
};

let qc: QueryClient;
const section = () => (
  <ConfirmProvider><QueryClientProvider client={qc}><DestinationsSection /></QueryClientProvider></ConfirmProvider>
);
const renderSection = () => {
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(section());
};

beforeEach(() => {
  vi.clearAllMocks();
  // "on 24 May" is said without a year only within the same year.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 5, 1, 15, 0));
});
afterEach(() => vi.useRealTimers());

describe("DestinationsSection", () => {
  it("lists each destination with where, what uses it and the last send, and says nothing while the list is unknown", async () => {
    let answer!: (v: Destination[]) => void;
    api.listDestinations.mockReturnValueOnce(new Promise((r) => { answer = r; }));
    search.q = "tab=destinations";
    renderSection();
    expect(screen.getByText("Loading destinations…")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Destinations" })).toBeNull();
    expect(document.body).not.toHaveTextContent(/Never sent|Not used|No destinations yet/);
    act(() => answer([inbox, server]));
    const rows = within(await screen.findByRole("list", { name: "Destinations" })).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent(/Accounting inbox.*Email to accounting@example\.test.*1 output.*Couldn't send on 24 May/);
    expect(rows[1]).toHaveTextContent(/Accounting server.*SFTP, sftp\.example\.test, folder \/in\/invoices.*Not used.*Never sent/);
    api.testDestination.mockResolvedValue({ success: false, message: "The server refused the login.", responseCode: null });
    const test = within(rows[1]).getByRole("button", { name: "Test Accounting server" });
    fireEvent.click(test);
    fireEvent.click(test);
    expect(await within(rows[1]).findByRole("alert")).toHaveTextContent("The test didn't arrive: The server refused the login.");
    expect(api.testDestination).toHaveBeenCalledTimes(1);
    expect(within(rows[0]).queryByRole("alert")).toBeNull();
    cleanup();
    api.listDestinations.mockResolvedValueOnce([]);
    renderSection();
    expect(await screen.findByText("No destinations yet.")).toBeInTheDocument();
  });

  it("Edit opens in place from the address; outputs that use one are named and it can't be deleted; an unused one is deleted after asking", async () => {
    api.listDestinations.mockResolvedValue([inbox, server]);
    search.q = "tab=destinations&open=dest-1";
    const { rerender } = renderSection();
    const panel = await screen.findByRole("region", { name: "Edit Accounting inbox" });
    expect(panel).toHaveTextContent("One output uses this destination, so it can't be deleted.");
    expect(within(panel).getByRole("link", { name: "Invoice CSV in Supplier invoices" })).toHaveAttribute("href", "/flows/flow-1?tab=outputs");
    expect(within(panel).queryByRole("button", { name: "Delete destination" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Accounting server" }));
    expect(replace).toHaveBeenLastCalledWith("/settings?tab=destinations&open=dest-3", { scroll: false });
    search.q = "tab=destinations&open=dest-3";
    rerender(section());
    const second = await screen.findByRole("region", { name: "Edit Accounting server" });
    expect(screen.queryByRole("region", { name: "Edit Accounting inbox" })).toBeNull();
    api.deleteDestination.mockRejectedValueOnce(new ApiHttpError("in use", 409, { error: "destination_in_use" }));
    fireEvent.click(within(second).getByRole("button", { name: "Delete destination" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await within(second).findByRole("alert")).toHaveTextContent("An output still sends here. Change that output first.");
    await waitFor(() => expect(api.listDestinations).toHaveBeenCalledTimes(2));
    api.deleteDestination.mockResolvedValueOnce(undefined);
    fireEvent.click(within(second).getByRole("button", { name: "Delete destination" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    expect(await screen.findByText("Accounting server was deleted.")).toBeInTheDocument();
    expect(api.deleteDestination).toHaveBeenLastCalledWith("dest-3");
    expect(replace).toHaveBeenLastCalledWith("/settings?tab=destinations", { scroll: false });
  });

  it("a member's press and an address that names nothing are said in words", async () => {
    api.listDestinations.mockResolvedValue([inbox, server]);
    search.q = "tab=destinations&open=dest-9";
    renderSection();
    expect(await screen.findByText("We can't find that destination. It may have been deleted.")).toBeInTheDocument();
    api.testDestination.mockRejectedValueOnce(new ApiHttpError("forbidden", 403, { error: "requires_org_admin" }));
    const rows = within(screen.getByRole("list", { name: "Destinations" })).getAllByRole("listitem");
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Test Accounting inbox" }));
    expect(await within(rows[0]).findByRole("alert")).toHaveTextContent("Only a workspace admin can change this.");
    cleanup();
    search.q = "tab=destinations&open=new";
    renderSection();
    const fresh = await screen.findByRole("region", { name: "New destination" });
    expect(within(fresh).getByLabelText("Send by")).toBeInTheDocument();
    expect(within(fresh).getByRole("button", { name: "Save and send a test" })).toBeInTheDocument();
  });
});
