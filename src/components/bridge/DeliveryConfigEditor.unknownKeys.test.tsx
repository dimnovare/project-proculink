// WP-20 D2 — a save must not DELETE the per-supplier settings this editor has no field for.
//
// buildConfigObject() used to return a fixed whitelist of keys, and the save replaces the whole
// config object (backend: DeliveryConfigService `existing.ConfigJson = request.ConfigJson;`, whose
// only validation is that the JSON parses). So every key outside the whitelist was destroyed the
// next time an operator saved ANYTHING on this screen — including two settings that are live on the
// wire today:
//
//   * `headers` — declared for the http connector in ConnectorManifestCatalog and injected into
//     EVERY outbound request at HttpDeliveryDispatcher.cs:132-134. A supplier account header
//     vanishing means the supplier starts rejecting the orders.
//   * `fromAddress` — honoured at EmailApiDeliveryDispatcher.cs:94. The editor's From-address input
//     is inside `{protocol === "smtp" && …}`, so the EMAIL protocol has no field for it at all:
//     load-and-save silently reverted a supplier's verified sender to ProcuLink's default.
//
// The fix is to spread the loaded config and override the keys this editor owns, so an unknown key
// rides through untouched — while a key the editor DOES own is still genuinely removable.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryConfig, DeliveryProtocol } from "@/lib/api/types";

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

function savedConfig(protocol: DeliveryProtocol, config: Record<string, unknown>): DeliveryConfig {
  return {
    supplierId: "sup-1",
    protocol,
    autoDeliver: false,
    configJson: JSON.stringify(config),
    outputFormat: "cxml",
    hasCredentials: true,
    credentialsDisplay: "********",
    createdAt: "2026-07-30T00:00:00Z",
    updatedAt: "2026-07-30T00:00:00Z",
    cxmlCredentials: null,
  };
}

async function savedConfigJson(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
  const [, payload] = upsertDeliveryConfig.mock.calls[0] as [string, { configJson: string }];
  return JSON.parse(payload.configJson) as Record<string, unknown>;
}

function clickSave() {
  fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));
}

beforeEach(() => {
  getDeliveryConfig.mockReset();
  upsertDeliveryConfig
    .mockReset()
    .mockImplementation((_id: string, body: { protocol: DeliveryProtocol; configJson: string }) =>
      Promise.resolve(savedConfig(body.protocol, JSON.parse(body.configJson))),
    );
  deleteDeliveryConfig.mockReset();
  testFireDelivery.mockReset();
});

afterEach(cleanup);

describe("DeliveryConfigEditor — settings the editor has no field for (WP-20)", () => {
  it("HTTP: per-supplier custom request headers survive an unchanged save", async () => {
    getDeliveryConfig.mockResolvedValue(
      savedConfig("http", {
        url: "https://supplier.example/orders",
        method: "POST",
        timeoutSeconds: 30,
        headers: { "X-Supplier-Account": "ACME-4417" },
      }),
    );
    renderEditor();

    await screen.findByDisplayValue("https://supplier.example/orders");
    clickSave();

    const config = await savedConfigJson();
    expect(config.headers).toEqual({ "X-Supplier-Account": "ACME-4417" });
    expect(config.url).toBe("https://supplier.example/orders");
  });

  it("EMAIL: a per-supplier verified sender survives an unchanged save", async () => {
    getDeliveryConfig.mockResolvedValue(
      savedConfig("email", {
        toAddresses: ["po@supplier.example"],
        fromAddress: "po@buyer-verified.example",
      }),
    );
    renderEditor();

    await screen.findByDisplayValue("po@supplier.example");
    clickSave();

    expect((await savedConfigJson()).fromAddress).toBe("po@buyer-verified.example");
  });

  it("carries through a key no version of this editor has ever heard of", async () => {
    // The general contract. A setting the backend adds tomorrow must not need a frontend release
    // before it survives the first time an operator touches this screen.
    getDeliveryConfig.mockResolvedValue(
      savedConfig("http", {
        url: "https://supplier.example/orders",
        method: "POST",
        timeoutSeconds: 30,
        someSettingShippedAfterThisBuild: { nested: ["value"] },
      }),
    );
    renderEditor();

    await screen.findByDisplayValue("https://supplier.example/orders");
    clickSave();

    expect((await savedConfigJson()).someSettingShippedAfterThisBuild).toEqual({ nested: ["value"] });
  });

  it("still lets the operator CLEAR a setting the editor does own", async () => {
    // The other half: preserving unknown keys must not turn a managed key into a write-only one.
    // Clearing the reply-to address has to actually remove it, not silently keep the old value.
    getDeliveryConfig.mockResolvedValue(
      savedConfig("email", {
        toAddresses: ["po@supplier.example"],
        replyTo: "purchasing@buyer.example",
      }),
    );
    renderEditor();

    const replyTo = await screen.findByDisplayValue("purchasing@buyer.example");
    fireEvent.change(replyTo, { target: { value: "" } });
    clickSave();

    const config = await savedConfigJson();
    expect(config.replyTo).toBeUndefined();
    expect(config.toAddresses).toBe("po@supplier.example");
  });

  it("does not leak the old connector's keys when the operator switches protocol", async () => {
    // Preserving unknown keys is scoped to the protocol the config was LOADED for. An SFTP config
    // re-pointed at HTTP must not arrive carrying host/remotePath/overwriteExisting.
    getDeliveryConfig.mockResolvedValue(
      savedConfig("sftp", {
        host: "sftp.supplier.example",
        port: 22,
        remotePath: "/in",
        makeDirectories: true,
        overwriteExisting: false,
        timeoutSeconds: 30,
      }),
    );
    renderEditor();

    await screen.findByDisplayValue("/in");
    fireEvent.click(screen.getByRole("radio", { name: /^HTTP$/i }));
    fireEvent.change(screen.getByPlaceholderText("https://supplier.example/orders"), {
      target: { value: "https://supplier.example/orders" },
    });
    clickSave();

    const config = await savedConfigJson();
    expect(config.host).toBeUndefined();
    expect(config.remotePath).toBeUndefined();
    expect(config.overwriteExisting).toBeUndefined();
    expect(config.url).toBe("https://supplier.example/orders");
  });
});
