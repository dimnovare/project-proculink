// Settings writes that fail must say so — and the API-key revoke must say the key is still live.
//
// Three mutations on this screen had no error branch at all: the API-key revoke
// (`revoke`), and the webhook `toggle` and `remove`. None declared `onError`, and none
// of their `isError` flags was rendered anywhere, so every one of them failed in total
// silence. The revoke is a security control: someone revoking a leaked credential got
// no protest and concluded the key was dead while it was still being accepted.
//
// These tests exercise the ERROR path specifically. A test that only proves the success
// path still works is exactly how this shipped in the first place.
//
// Breakpoint scoping: jsdom applies no Tailwind, so `hidden md:table` and `md:hidden`
// BOTH mount. Every assertion about a specific tree is scoped through `within(
// getByTestId(...))`, and one test pins that the scoping actually bites by showing the
// global count is 2 while each scoped count is 1.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(mockTab.value),
  usePathname: () => "/settings",
}));

vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org", membersCount: 1 } }),
}));

// The inbound-address panel renders inside the API-keys tab; keep it quiet and empty.
vi.mock("@/lib/api/inboundEmail", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/inboundEmail")>();
  return { ...actual, getInboundAddresses: vi.fn().mockResolvedValue([]) };
});

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth", status: "active" }),
    getOrgSettings: vi.fn().mockResolvedValue({ slug: "test-org", orderDirection: "outbound" }),
    getApiKeys: vi.fn().mockResolvedValue([]),
    revokeApiKey: vi.fn(),
    getIntegrations: vi.fn().mockResolvedValue([]),
    toggleIntegration: vi.fn(),
    deleteIntegration: vi.fn(),
  };
});

import {
  getApiKeys,
  revokeApiKey,
  getIntegrations,
  toggleIntegration,
  deleteIntegration,
  type ApiKey,
  type IntegrationSubscription,
} from "@/lib/api-client";
import { ORG_ADMIN_ERROR_CODE, orgAdminMessage } from "@/lib/planGate";
import SettingsPage from "./page";

const mockTab = { value: "tab=api" };

const key = (over: Partial<ApiKey> = {}): ApiKey => ({
  id: "key-1",
  label: "Production integration",
  keyPrefix: "pk_live_abc",
  isActive: true,
  createdAt: "2026-08-01T10:00:00Z",
  lastUsedAt: null,
  expiresAt: null,
  ...over,
});

const sub = (over: Partial<IntegrationSubscription> = {}): IntegrationSubscription => ({
  id: "sub-1",
  platform: "zapier",
  eventType: "order.created",
  targetUrl: "https://hooks.zapier.com/hooks/catch/1/abc",
  isActive: true,
  failureCount: 0,
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-01T10:00:00Z",
  ...over,
});

function renderSettings() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

/** Opens the row's InlineConfirm and clicks through it, scoped to one breakpoint tree. */
function confirmIn(container: HTMLElement, label: RegExp) {
  fireEvent.click(within(container).getAllByRole("button", { name: label })[0]);
  fireEvent.click(within(container).getAllByRole("button", { name: label })[0]);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockTab.value = "tab=api";
});

// ── API key revoke — the security control ───────────────────────────────────

describe("Settings — a failed API-key revoke says the key is still live", () => {
  it("renders a failure that leads with the key still being active, in the desktop table", async () => {
    vi.mocked(getApiKeys).mockResolvedValue([key()]);
    vi.mocked(revokeApiKey).mockRejectedValue(new Error("Network request failed"));
    renderSettings();

    const table = await screen.findByTestId("api-keys-table");
    confirmIn(table, /^revoke$/i);

    const alert = await within(table).findByRole("alert");
    // The first thing the reader gets is the key's status, not "something went wrong".
    expect(alert).toHaveTextContent(/^Still active — do not assume this key is revoked\./);
    expect(alert).toHaveTextContent(/Anyone holding it can still use the API until this row shows Revoked\./);
    expect(alert).toHaveTextContent(/We could not complete the change — try again in a moment\./);
  });

  it("renders the same failure in the mobile card tree", async () => {
    vi.mocked(getApiKeys).mockResolvedValue([key()]);
    vi.mocked(revokeApiKey).mockRejectedValue(new Error("Network request failed"));
    renderSettings();

    const cards = await screen.findByTestId("api-keys-cards");
    confirmIn(cards, /^revoke$/i);

    expect(await within(cards).findByRole("alert")).toHaveTextContent(/^Still active/);
  });

  it("scoping control: the failure renders once per tree, twice in the document", async () => {
    // If this ever reads 1 globally, the two breakpoint trees stopped both mounting and
    // every `within(...)` assertion above would be passing against a single tree.
    vi.mocked(getApiKeys).mockResolvedValue([key()]);
    vi.mocked(revokeApiKey).mockRejectedValue(new Error("Network request failed"));
    renderSettings();

    const table = await screen.findByTestId("api-keys-table");
    const cards = screen.getByTestId("api-keys-cards");
    confirmIn(table, /^revoke$/i);

    await within(table).findByRole("alert");
    expect(within(table).getAllByRole("alert")).toHaveLength(1);
    expect(within(cards).getAllByRole("alert")).toHaveLength(1);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });

  it("never claims the key is revoked, and never uses reassuring words", async () => {
    vi.mocked(getApiKeys).mockResolvedValue([key()]);
    vi.mocked(revokeApiKey).mockRejectedValue(new Error("Network request failed"));
    renderSettings();

    const table = await screen.findByTestId("api-keys-table");
    confirmIn(table, /^revoke$/i);

    const text = (await within(table).findByRole("alert")).textContent ?? "";
    // "Revoked" appears once, and only as the thing to LOOK FOR — never as a claim.
    expect(text).not.toMatch(/\b(revoked successfully|has been revoked|no longer works|is now dead)\b/i);
    expect(text).toMatch(/until this row shows Revoked/);
    // The row itself must not have flipped to the Revoked badge.
    expect(within(table).queryByText("Revoked")).not.toBeInTheDocument();
  });

  it("marks only the key that failed, not every key in the list", async () => {
    vi.mocked(getApiKeys).mockResolvedValue([
      key({ id: "key-1", label: "Production integration" }),
      key({ id: "key-2", label: "Staging webhook" }),
    ]);
    vi.mocked(revokeApiKey).mockRejectedValue(new Error("Network request failed"));
    renderSettings();

    const table = await screen.findByTestId("api-keys-table");
    // Two rows, two Revoke triggers — act on the first.
    expect(within(table).getAllByRole("button", { name: /^revoke$/i })).toHaveLength(2);
    confirmIn(table, /^revoke$/i);

    await within(table).findByRole("alert");
    expect(within(table).getAllByRole("alert")).toHaveLength(1);
  });

  it("says an admin is needed AND that the key is still live, when the server refuses on role", async () => {
    // The refusal is the one cause retrying cannot fix — but the key is live either way,
    // so the lead-in must survive this branch too.
    vi.mocked(getApiKeys).mockResolvedValue([key()]);
    vi.mocked(revokeApiKey).mockRejectedValue(
      // The code is read from the module that owns it, not retyped here.
      Object.assign(new Error("forbidden"), { body: { error: ORG_ADMIN_ERROR_CODE } }),
    );
    renderSettings();

    const table = await screen.findByTestId("api-keys-table");
    confirmIn(table, /^revoke$/i);

    const alert = await within(table).findByRole("alert");
    expect(alert).toHaveTextContent(/^Still active — do not assume this key is revoked\./);
    expect(alert).toHaveTextContent(orgAdminMessage());
    expect(alert).not.toHaveTextContent(/try again in a moment/);
  });

  it("negative control: a revoke that succeeds shows no failure line", async () => {
    vi.mocked(getApiKeys).mockResolvedValue([key()]);
    vi.mocked(revokeApiKey).mockResolvedValue(undefined);
    renderSettings();

    const table = await screen.findByTestId("api-keys-table");
    confirmIn(table, /^revoke$/i);

    await waitFor(() => expect(revokeApiKey).toHaveBeenCalledWith("key-1"));
    expect(within(table).queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText(/Still active/)).not.toBeInTheDocument();
  });
});

// ── Webhook toggle + delete ─────────────────────────────────────────────────

describe("Settings — failed webhook toggle and delete name the state you are still in", () => {
  it("a failed pause says the webhook is still active and still sending", async () => {
    mockTab.value = "tab=connectors";
    vi.mocked(getIntegrations).mockResolvedValue([sub({ isActive: true })]);
    vi.mocked(toggleIntegration).mockRejectedValue(new Error("Network request failed"));
    renderSettings();

    const list = await screen.findByTestId("webhook-list");
    fireEvent.click(within(list).getByRole("button", { name: /^pause$/i }));

    const alert = await within(list).findByRole("alert");
    expect(alert).toHaveTextContent(
      /^Still active — this webhook was not paused\. Events are still being sent to this URL\./,
    );
    // The button label is server-driven, so it is unchanged — which is precisely why
    // the line above has to exist.
    expect(within(list).getByRole("button", { name: /^pause$/i })).toBeInTheDocument();
  });

  it("a failed resume says the webhook is still paused and still not sending", async () => {
    mockTab.value = "tab=connectors";
    vi.mocked(getIntegrations).mockResolvedValue([sub({ isActive: false })]);
    vi.mocked(toggleIntegration).mockRejectedValue(new Error("Network request failed"));
    renderSettings();

    const list = await screen.findByTestId("webhook-list");
    fireEvent.click(within(list).getByRole("button", { name: /^resume$/i }));

    expect(await within(list).findByRole("alert")).toHaveTextContent(
      /^Still paused — this webhook was not resumed\. Events are still not being sent to this URL\./,
    );
  });

  it("a failed delete says the subscription is still there and still sending", async () => {
    mockTab.value = "tab=connectors";
    vi.mocked(getIntegrations).mockResolvedValue([sub({ isActive: true })]);
    vi.mocked(deleteIntegration).mockRejectedValue(new Error("Network request failed"));
    renderSettings();

    const list = await screen.findByTestId("webhook-list");
    fireEvent.click(within(list).getByRole("button", { name: /delete webhook subscription/i }));
    fireEvent.click(within(list).getByRole("button", { name: /^delete$/i }));

    expect(await within(list).findByRole("alert")).toHaveTextContent(
      /^Still here — this webhook was not deleted, and events are still being sent to this URL\./,
    );
  });

  it("negative control: a delete that succeeds shows no failure line", async () => {
    mockTab.value = "tab=connectors";
    vi.mocked(getIntegrations).mockResolvedValue([sub({ isActive: true })]);
    vi.mocked(deleteIntegration).mockResolvedValue(undefined);
    renderSettings();

    const list = await screen.findByTestId("webhook-list");
    fireEvent.click(within(list).getByRole("button", { name: /delete webhook subscription/i }));
    fireEvent.click(within(list).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteIntegration).toHaveBeenCalledWith("sub-1"));
    expect(within(list).queryByRole("alert")).not.toBeInTheDocument();
  });
});
