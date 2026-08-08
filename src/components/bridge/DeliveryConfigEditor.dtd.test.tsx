// T7 — Configurable cXML <!DOCTYPE> DTD, FE side.
//
// Pins the contract the spec asks for:
//   (1) the DTD field renders inside the cXML section (only when output = cXML);
//   (2) a custom (free-text) DTD URI persists into the SAVED cXML config payload under the
//       camelCase key dtdSystemId (what the backend reads from CxmlConfigJson);
//   (3) a <datalist> offers the common cXML DTD suggestions but ANY value is accepted (free-text,
//       not a closed dropdown).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryConfig, UpsertDeliveryConfigRequest } from "@/lib/api/types";

// Isolate the editor: stub the delivery API and the additive connector panel (TanStack-Query-backed).
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

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeliveryConfigEditor supplierId="sup-1" />
    </QueryClientProvider>,
  );
}

// A saved cXML delivery config so the editor mounts straight into the cXML section.
const SAVED_CXML: DeliveryConfig = {
  supplierId: "sup-1",
  protocol: "http",
  autoDeliver: false,
  configJson: JSON.stringify({ url: "https://supplier.example/orders", method: "POST", timeoutSeconds: 30 }),
  outputFormat: "cxml",
  hasCredentials: false,
  createdAt: "2026-06-21T00:00:00Z",
  updatedAt: "2026-06-21T00:00:00Z",
  cxmlCredentials: {
    fromDomain: "NetworkId",
    fromIdentity: "ExampleBuyer_SE",
    toDomain: "NetworkId",
    toIdentity: "ExampleSupplier_SE",
    senderDomain: "NetworkId",
    senderIdentity: "ExampleBuyer_SE",
    hasSharedSecret: false,
  },
};

beforeEach(() => {
  getDeliveryConfig.mockReset().mockResolvedValue(SAVED_CXML);
  upsertDeliveryConfig.mockReset().mockResolvedValue(SAVED_CXML);
  deleteDeliveryConfig.mockReset();
  testFireDelivery.mockReset();
});

afterEach(cleanup);

describe("DeliveryConfigEditor — configurable cXML DTD (T7)", () => {
  it("renders the DTD field in the cXML section with the suggestion datalist", async () => {
    renderEditor();
    const dtdInput = await screen.findByLabelText(/cXML DTD \(SYSTEM id/i);
    expect(dtdInput).toBeInTheDocument();
    // Free-text: bound to a <datalist>, NOT a closed <select>.
    expect(dtdInput.tagName).toBe("INPUT");
    expect(dtdInput).toHaveAttribute("list", "cxml-dtd-suggestions");

    // The optional Public id field is also present.
    expect(screen.getByLabelText(/Public id/i)).toBeInTheDocument();

    // Datalist offers the common cXML DTD URIs as suggestions (not a forced choice).
    const datalist = document.getElementById("cxml-dtd-suggestions") as HTMLDataListElement;
    expect(datalist).toBeTruthy();
    const values = Array.from(datalist.querySelectorAll("option")).map((o) => o.getAttribute("value"));
    expect(values).toContain("http://xml.cxml.org/schemas/cXML/1.2.024/cXML.dtd");
    expect(values).toContain("http://xml.cxml.org/schemas/cXML/1.2.014/cXML.dtd");
    expect(values).toContain("http://xml.cxml.org/schemas/cXML/1.2.040/cXML.dtd");
  });

  it("persists a CUSTOM (free-text) DTD URI into the saved cXML config as dtdSystemId", async () => {
    renderEditor();
    const dtdInput = await screen.findByLabelText(/cXML DTD \(SYSTEM id/i);

    // A value NOT in the datalist — proves free-text is accepted.
    const customUri = "http://supplier.example/private/cXML-2.0.dtd";
    fireEvent.change(dtdInput, { target: { value: customUri } });
    expect((dtdInput as HTMLInputElement).value).toBe(customUri);

    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    const [, payload] = upsertDeliveryConfig.mock.calls[0] as [string, UpsertDeliveryConfigRequest];
    expect(payload.cxmlCredentials?.dtdSystemId).toBe(customUri);
    // Public id left blank → null (no PUBLIC form).
    expect(payload.cxmlCredentials?.dtdPublicId).toBeNull();
  });

  it("hides the DTD field when the supplier output format is not cXML", async () => {
    getDeliveryConfig.mockResolvedValue({ ...SAVED_CXML, outputFormat: "xml", cxmlCredentials: null });
    renderEditor();
    // Wait for load to finish (the output-format select appears).
    await screen.findByText(/Output format/i);
    expect(screen.queryByLabelText(/cXML DTD \(SYSTEM id/i)).toBeNull();
  });
});
