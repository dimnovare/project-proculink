// Transport security, FE side.
//
// ProcuLink would send a purchase order and the credentials that authenticate it over plain
// http. The backend now refuses that on save; this pins that the EDITOR refuses it too, so the
// operator is told at the point of typing rather than after a round trip.
//
// Both directions are asserted on purpose. A form that refused every URL would satisfy a
// refusal-only test, so each refusal is paired with the save it must not break — https to a real
// host, and plain http on loopback for local development.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryConfig } from "@/lib/api/types";

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

vi.mock("@/hooks/useOnboardingStatus", () => ({
  invalidateOnboardingStatus: vi.fn(),
}));

import { DeliveryConfigEditor } from "./DeliveryConfigEditor";

function savedHttpConfig(overrides: Partial<DeliveryConfig> = {}): DeliveryConfig {
  return {
    supplierId: "sup-1",
    protocol: "http",
    autoDeliver: false,
    configJson: JSON.stringify({ url: "https://supplier.example/orders", method: "POST", timeoutSeconds: 30 }),
    outputFormat: null,
    hasCredentials: false,
    createdAt: "2026-08-06T00:00:00Z",
    updatedAt: "2026-08-06T00:00:00Z",
    ...overrides,
  };
}

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeliveryConfigEditor supplierId="sup-1" />
    </QueryClientProvider>,
  );
}

async function endpointInput(): Promise<HTMLInputElement> {
  return (await screen.findByPlaceholderText("https://supplier.example/orders")) as HTMLInputElement;
}

async function typeEndpoint(value: string) {
  const input = await endpointInput();
  fireEvent.change(input, { target: { value } });
  return input;
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /save/i }) as HTMLButtonElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  getDeliveryConfig.mockResolvedValue(savedHttpConfig());
  upsertDeliveryConfig.mockImplementation(async () => savedHttpConfig());
});

afterEach(cleanup);

describe("the delivery editor refuses a cleartext endpoint", () => {
  it("shows a readable reason for a plain http endpoint and does not call the API", async () => {
    renderEditor();
    await typeEndpoint("http://supplier.example.com/orders");

    const message = await screen.findByText(/must use https:\/\//i);
    // A code in the UI would be a defect; the operator must be told what to do.
    expect(message.textContent).toMatch(/purchase orders/i);
    expect(message.textContent).not.toMatch(/url_requires_tls/);

    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertDeliveryConfig).not.toHaveBeenCalled());
  });

  it("refuses credentials written into the endpoint without echoing the password", async () => {
    renderEditor();
    await typeEndpoint("https://apiuser:hunter2@supplier.example/orders");

    const message = await screen.findByText(/must not contain a username or password/i);
    expect(message.textContent).not.toContain("hunter2");

    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertDeliveryConfig).not.toHaveBeenCalled());
  });
});

describe("the delivery editor still saves what must keep working", () => {
  it("saves an https endpoint", async () => {
    renderEditor();
    await typeEndpoint("https://orders.supplier.example/inbound");

    expect(screen.queryByText(/must use https:\/\//i)).toBeNull();

    fireEvent.click(saveButton());
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    expect(upsertDeliveryConfig.mock.calls[0][1].configJson)
      .toContain("https://orders.supplier.example/inbound");
  });

  // The live failure-state e2e spec drives delivery against a loopback listener on an ephemeral
  // port, so this is not hypothetical: breaking it would break the local dev loop.
  it.each(["http://localhost:5223/api/delivery", "http://127.0.0.1:53412/reject"])(
    "saves plain http on loopback for local development: %s",
    async (url) => {
      renderEditor();
      await typeEndpoint(url);

      expect(screen.queryByText(/must use https:\/\//i)).toBeNull();

      fireEvent.click(saveButton());
      await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
      expect(upsertDeliveryConfig.mock.calls[0][1].configJson).toContain(url);
    },
  );
});

describe("a config saved before enforcement existed", () => {
  it("warns that the stored endpoint is not secure while delivery continues", async () => {
    getDeliveryConfig.mockResolvedValue(
      savedHttpConfig({
        configJson: JSON.stringify({ url: "http://erp.supplier.com/xmlcore" }),
        insecureTransportWarning:
          "Delivery endpoint must use https://. ProcuLink will not send purchase orders or supplier credentials over plain http.",
      }),
    );

    renderEditor();

    const banner = await screen.findByText(/saved endpoint is not secure/i);
    // The operator must learn BOTH facts: it is insecure, and nothing has stopped.
    expect(banner.parentElement?.textContent).toMatch(/still being delivered/i);
  });

  it("shows no warning for a config the policy accepts", async () => {
    getDeliveryConfig.mockResolvedValue(savedHttpConfig({ insecureTransportWarning: null }));

    renderEditor();
    await endpointInput();

    expect(screen.queryByText(/saved endpoint is not secure/i)).toBeNull();
  });
});
