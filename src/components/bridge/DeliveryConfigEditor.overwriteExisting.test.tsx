// WP-20 — the per-supplier "replace existing files" setting must SURVIVE a save.
//
// buildConfigObject() returns a fixed list of keys and the save replaces the whole config object,
// so a key the editor does not know about is destroyed the next time an operator touches anything
// on this screen. That is not hypothetical: it is how a backend setting can be completely correct
// and still never reach production. These tests round-trip the setting through a real render +
// save and assert on the JSON actually handed to the API.

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

function renderEditor() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeliveryConfigEditor supplierId="sup-1" />
    </QueryClientProvider>,
  );
}

function savedConfig(protocol: "sftp" | "ftps", config: Record<string, unknown>): DeliveryConfig {
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

const BASE_SFTP = { host: "sftp.supplier.example", port: 22, remotePath: "/in", makeDirectories: true, timeoutSeconds: 30 };

async function savedConfigJson(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
  const [, payload] = upsertDeliveryConfig.mock.calls[0] as [string, { configJson: string }];
  return JSON.parse(payload.configJson) as Record<string, unknown>;
}

beforeEach(() => {
  getDeliveryConfig.mockReset();
  upsertDeliveryConfig.mockReset().mockImplementation((_id: string, body: { configJson: string }) =>
    Promise.resolve(savedConfig("sftp", JSON.parse(body.configJson))),
  );
  deleteDeliveryConfig.mockReset();
  testFireDelivery.mockReset();
});

afterEach(cleanup);

describe("DeliveryConfigEditor — overwriteExisting round-trip (WP-20)", () => {
  it("keeps an operator's OFF setting when an unrelated field is edited and saved", async () => {
    // The failure this guards: the setting is saved by an operator, then silently reverts to ON the
    // next time anyone edits the remote path — because the key was not in the whitelist.
    getDeliveryConfig.mockResolvedValue(savedConfig("sftp", { ...BASE_SFTP, overwriteExisting: false }));
    renderEditor();

    const remotePath = await screen.findByDisplayValue("/in");
    fireEvent.change(remotePath, { target: { value: "/in/orders" } });
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    const config = await savedConfigJson();
    expect(config.overwriteExisting).toBe(false);
    expect(config.remotePath).toBe("/in/orders");
  });

  it("sends overwriteExisting: true for a config saved before the setting existed", async () => {
    // Every already-configured supplier has no such key. Loading and re-saving one must not quietly
    // change how its deliveries behave.
    getDeliveryConfig.mockResolvedValue(savedConfig("sftp", BASE_SFTP));
    renderEditor();

    await screen.findByDisplayValue("/in");
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    expect((await savedConfigJson()).overwriteExisting).toBe(true);
  });

  it("persists the checkbox when the operator turns it off", async () => {
    getDeliveryConfig.mockResolvedValue(savedConfig("sftp", BASE_SFTP));
    renderEditor();

    await screen.findByDisplayValue("/in");
    fireEvent.click(screen.getByRole("checkbox", { name: /Replace a file already at that path/i }));
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    expect((await savedConfigJson()).overwriteExisting).toBe(false);
  });

  it("round-trips the setting on FTPS too, alongside its own TLS opt-in", async () => {
    getDeliveryConfig.mockResolvedValue(
      savedConfig("ftps", {
        host: "ftps.supplier.example",
        port: 21,
        remotePath: "/in",
        makeDirectories: true,
        timeoutSeconds: 30,
        overwriteExisting: false,
        allowInvalidCertificate: true,
      }),
    );
    renderEditor();

    await screen.findByDisplayValue("/in");
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    const config = await savedConfigJson();
    expect(config.overwriteExisting).toBe(false);
    expect(config.allowInvalidCertificate).toBe(true);
  });
});
