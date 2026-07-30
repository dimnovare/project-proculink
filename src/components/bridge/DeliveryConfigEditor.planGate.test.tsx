import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryConfig } from "@/lib/api/types";

// WP-11 follow-through — supplier delivery setup.
//
// Saving a delivery config can be refused for three different plan reasons:
//   protocol http           → webhook_delivery_requires_growth
//   protocol erp_erply/…    → erp_delivery_requires_enterprise
//   output format cxml      → cxml_output_requires_operations
// The api layer folds the response body into the Error message, so the editor's error banner
// used to print the raw snake_case token at the customer. The plan named in the sentence is
// derived from the code, never written in the component — re-tiering a capability on the
// server must not need a frontend change.

const getDeliveryConfig = vi.fn();
const upsertDeliveryConfig = vi.fn();
const deleteDeliveryConfig = vi.fn();
const testFireDelivery = vi.fn();

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: (...a: unknown[]) => getDeliveryConfig(...a),
  upsertDeliveryConfig: (...a: unknown[]) => upsertDeliveryConfig(...a),
  deleteDeliveryConfig: (...a: unknown[]) => deleteDeliveryConfig(...a),
  testFireDelivery: (...a: unknown[]) => testFireDelivery(...a),
}));

vi.mock("@/components/bridge/ConnectorRequirementsPanel", () => ({
  ConnectorRequirementsPanel: () => <div data-testid="mock-connector-panel" />,
}));

vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));

import { DeliveryConfigEditor } from "./DeliveryConfigEditor";

const SAVED_HTTP: DeliveryConfig = {
  supplierId: "sup-1",
  protocol: "http",
  autoDeliver: false,
  configJson: JSON.stringify({ url: "https://supplier.example/orders", timeoutSeconds: 30 }),
  outputFormat: "xml",
  hasCredentials: false,
  credentialsDisplay: null,
  createdAt: "2026-06-21T00:00:00Z",
  updatedAt: "2026-06-21T00:00:00Z",
  cxmlCredentials: null,
};

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeliveryConfigEditor supplierId="sup-1" />
    </QueryClientProvider>,
  );
}

async function saveAndFail(body: string) {
  upsertDeliveryConfig.mockRejectedValue(new Error(`API error 403: ${body}`));
  renderEditor();
  fireEvent.click(await screen.findByRole("button", { name: /Save delivery/i }));
}

beforeEach(() => {
  getDeliveryConfig.mockReset().mockResolvedValue(SAVED_HTTP);
  upsertDeliveryConfig.mockReset();
  deleteDeliveryConfig.mockReset();
  testFireDelivery.mockReset();
});

afterEach(cleanup);

describe("DeliveryConfigEditor — plan-gated save", () => {
  it("turns the HTTP-delivery gate into a sentence with an upgrade link", async () => {
    await saveAndFail(JSON.stringify({ error: "webhook_delivery_requires_growth", upgradeUrl: "/settings" }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/Growth/);
    expect(notice.textContent ?? "").not.toMatch(/_requires_|webhook_delivery/);
    expect(screen.getByRole("link", { name: /plans/i })).toHaveAttribute("href", "/settings");
  });

  it("names the plan the ERP gate asked for, not a plan of its own choosing", async () => {
    await saveAndFail(JSON.stringify({ error: "erp_delivery_requires_enterprise", upgradeUrl: "/settings" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Enterprise/);
  });

  it("names the plan the cXML output gate asked for", async () => {
    await saveAndFail(JSON.stringify({ error: "cxml_output_requires_operations", upgradeUrl: "/settings" }));

    expect(await screen.findByRole("status")).toHaveTextContent(/Operations/);
  });

  it("leaves an ordinary save failure showing the server's own message", async () => {
    upsertDeliveryConfig.mockRejectedValue(new Error("API error 400: Host is required."));
    renderEditor();

    fireEvent.click(await screen.findByRole("button", { name: /Save delivery/i }));

    expect(await screen.findByText(/Host is required/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /plans/i })).toBeNull();
  });
});
