// B8 — DeliveryConfigEditor must not silently keep a stale SFTP password when the user
// switches the auth method to "Private key" and leaves the key blank. The save is blocked
// (no upsert call) and an inline message asks for the new secret. Re-saving the SAME shape
// without re-entering the secret must still work (keep-on-blank).

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

// A saved SFTP config WITH a (password) credential. The backend never tells us the saved
// shape — the editor opens it in "password" mode, which is the shape we record as loaded.
const SAVED_SFTP_PASSWORD: DeliveryConfig = {
  supplierId: "sup-1",
  protocol: "sftp",
  autoDeliver: false,
  configJson: JSON.stringify({ host: "sftp.supplier.example", port: 22, remotePath: "/in", makeDirectories: true, timeoutSeconds: 30 }),
  outputFormat: "xml",
  hasCredentials: true,
  credentialsDisplay: "********",
  createdAt: "2026-06-21T00:00:00Z",
  updatedAt: "2026-06-21T00:00:00Z",
  cxmlCredentials: null,
};

beforeEach(() => {
  getDeliveryConfig.mockReset().mockResolvedValue(SAVED_SFTP_PASSWORD);
  upsertDeliveryConfig.mockReset().mockResolvedValue(SAVED_SFTP_PASSWORD);
  deleteDeliveryConfig.mockReset();
  testFireDelivery.mockReset();
});

afterEach(cleanup);

describe("DeliveryConfigEditor — SFTP auth-method switch (B8)", () => {
  it("blocks save and shows a message when switching password→key with no new key", async () => {
    renderEditor();
    // Wait for load — the SFTP "Auth method" select appears for a saved SFTP config.
    const authSelect = await screen.findByLabelText(/Auth method/i);

    // Switch to Private key, leave the key blank.
    fireEvent.change(authSelect, { target: { value: "key" } });

    // Inline block message is shown…
    expect(await screen.findByRole("alert")).toHaveTextContent(/private key/i);

    // …and the Save button is disabled, so a click cannot persist anything.
    const saveBtn = screen.getByRole("button", { name: /Save delivery/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.click(saveBtn);
    expect(upsertDeliveryConfig).not.toHaveBeenCalled();
  });

  it("allows save once the new private key is entered for the switched method", async () => {
    renderEditor();
    const authSelect = await screen.findByLabelText(/Auth method/i);
    fireEvent.change(authSelect, { target: { value: "key" } });

    const keyInput = await screen.findByLabelText(/Private key/i);
    fireEvent.change(keyInput, { target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END" } });

    // Block clears; save now persists a KEY credential (not the kept password).
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    const [, payload] = upsertDeliveryConfig.mock.calls[0] as [string, { credentialsJson?: string | null }];
    expect(payload.credentialsJson).toBeTruthy();
    expect(JSON.parse(payload.credentialsJson as string)).toHaveProperty("privateKey");
  });

  it("still keeps the stored password when re-saving the SAME (password) shape with a blank secret", async () => {
    renderEditor();
    // No auth-method switch; just re-save. The keep-on-blank behaviour must be preserved.
    await screen.findByLabelText(/Auth method/i);
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    const [, payload] = upsertDeliveryConfig.mock.calls[0] as [string, { credentialsJson?: string | null }];
    // null = keep the saved secret (no new one entered, same shape).
    expect(payload.credentialsJson).toBeNull();
  });
});
