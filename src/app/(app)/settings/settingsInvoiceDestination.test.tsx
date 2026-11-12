// Settings ▸ Organisation ▸ "Where invoices go". Exercises the real settings.ts serialisation:
// only `fetch` and the auth header are stubbed, so the PUT body asserted here is the wire body.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/settings",
}));
vi.mock("@/hooks/useDocumentEngine", () => ({ useDocumentEngine: () => "unknown" }));
vi.mock("@clerk/nextjs", () => ({
  useOrganization: () => ({ organization: { name: "Test Org" } }),
}));
vi.mock("@/lib/api/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/core")>()),
  authHeader: async () => ({}),
}));
vi.mock("@/lib/api/delivery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/delivery")>()),
  getDeliveryConfig: vi.fn().mockResolvedValue({ protocol: "http", outputFormat: "csv" }),
}));
vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();
  return {
    ...actual,
    getBillingStatus: vi.fn().mockResolvedValue({ plan: "growth", status: "active" }),
    apiClient: { ...actual.apiClient, getSuppliers: vi.fn().mockResolvedValue([{ id: "sup-1", name: "Nordic Fasteners" }]) },
  };
});

import SettingsPage from "./page";

let orgBody: Record<string, unknown>;
const puts: unknown[] = [];

beforeEach(() => {
  puts.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const isOrg = String(url).endsWith("/api/settings/organisation");
      if (isOrg && init?.method === "PUT") {
        puts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify(orgBody), { status: 200 });
      }
      if (isOrg) return new Response(JSON.stringify(orgBody), { status: 200 });
      return new Response("{}", { status: 404 });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsPage />
    </QueryClientProvider>,
  );
}

describe("Settings ▸ Organisation — where invoices go", () => {
  it("choosing a supplier sends exactly the supplier id, and no direction", async () => {
    orgBody = { direction: "Outbound", invoiceDestinationSupplierId: null };
    renderPage();
    await screen.findByRole("option", { name: "Nordic Fasteners" });
    fireEvent.change(screen.getByLabelText("Where invoices go"), { target: { value: "sup-1" } });
    await waitFor(() => expect(puts).toEqual([{ invoiceDestinationSupplierId: "sup-1" }]));
  });

  it("choosing Not set sends an explicit null", async () => {
    orgBody = { direction: "Outbound", invoiceDestinationSupplierId: "sup-1" };
    renderPage();
    await screen.findByRole("option", { name: "Nordic Fasteners" });
    await waitFor(() => expect(screen.getByLabelText("Where invoices go")).toHaveValue("sup-1"));
    fireEvent.change(screen.getByLabelText("Where invoices go"), { target: { value: "" } });
    await waitFor(() => expect(puts).toEqual([{ invoiceDestinationSupplierId: null }]));
  });

  it("a destination that is no longer a supplier says so instead of showing Not set", async () => {
    orgBody = { direction: "Outbound", invoiceDestinationSupplierId: "gone-9" };
    renderPage();
    expect(await screen.findByRole("option", { name: "Supplier no longer exists" })).toBeInTheDocument();
    expect(screen.getByLabelText("Where invoices go")).toHaveValue("gone-9");
  });
});
