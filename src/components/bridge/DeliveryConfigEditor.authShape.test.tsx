// The saved HTTP auth shape is not on the contract, and the editor used to pretend otherwise.
//
// `GET /suppliers/{id}/delivery-config` returns `hasCredentials: boolean` plus a
// `credentialsDisplay` the backend sets to a CONSTANT mask (`hasCredentials ? "********" : null`
// — DeliveryConfigService.cs). Nothing in the response says which auth type is stored, on which
// header, or against which token URL. The editor's `authType` therefore stayed at its initial
// "none", and `apiKeyHeader` at its initial "X-Api-Key", for every saved http / Erply supplier.
//
// Two failures came out of that, and these tests pin both:
//
//   1. DISPLAY — a supplier with a stored Bearer credential opened showing "Auth type: None",
//      directly beside the note saying a credential was saved.
//   2. WRITE — the per-type `if (!secret && hasSavedCredentials) return null` shortcuts only
//      asked whether the SECRET was blank. An operator rotating a key supplied the secret, sailed
//      past the shortcut, and wrote the form's DEFAULTS over every non-secret field in the same
//      stored record: a custom `Authorization` header replaced by `X-Api-Key`, an OAuth2
//      `tokenUrl` / `clientId` / `scope` replaced by empty strings, a Basic username emptied.
//
// The tests below are written against the ORIGINAL behaviour: each "blocks" case fails on the
// pre-fix code because the write went through and carried the wrong value.

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

/** A saved HTTP config WITH a credential. Which KIND of credential is unknowable from this. */
const SAVED_HTTP_WITH_CREDENTIAL: DeliveryConfig = {
  supplierId: "sup-1",
  protocol: "http",
  autoDeliver: false,
  configJson: JSON.stringify({ url: "https://supplier.example/orders", method: "POST", timeoutSeconds: 30 }),
  outputFormat: "xml",
  hasCredentials: true,
  credentialsDisplay: "********",
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
  cxmlCredentials: null,
};

const SAVED_HTTP_NO_CREDENTIAL: DeliveryConfig = {
  ...SAVED_HTTP_WITH_CREDENTIAL,
  hasCredentials: false,
  credentialsDisplay: null,
};

type UpsertBody = { credentialsJson?: string | null };

function lastCredentialsJson(): string | null | undefined {
  const call = upsertDeliveryConfig.mock.calls.at(-1) as [string, UpsertBody] | undefined;
  return call?.[1].credentialsJson;
}

beforeEach(() => {
  getDeliveryConfig.mockReset().mockResolvedValue(SAVED_HTTP_WITH_CREDENTIAL);
  upsertDeliveryConfig.mockReset().mockResolvedValue(SAVED_HTTP_WITH_CREDENTIAL);
  deleteDeliveryConfig.mockReset();
  testFireDelivery.mockReset();
});

afterEach(cleanup);

describe("DeliveryConfigEditor — the saved HTTP auth shape is unknown, not 'None'", () => {
  it("does not present 'None' as the saved auth type when a credential is stored", async () => {
    renderEditor();
    const select = (await screen.findByLabelText(/Auth type/i)) as HTMLSelectElement;

    // The original defect verbatim: the select sat on "none" for a supplier the same card
    // simultaneously described as having a saved credential.
    expect(select.value).not.toBe("none");
    expect(
      screen.getByRole("option", { name: /Keep the saved sign-in/i }),
    ).toBeInTheDocument();
  });

  it("says the type is not readable rather than leaving the reader to infer it", async () => {
    renderEditor();
    await screen.findByLabelText(/Auth type/i);
    expect(screen.getByText(/type is not stored anywhere we can\s+read it back/i)).toBeInTheDocument();
  });

  it("shows the real saved type once there is no credential to be unsure about", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP_NO_CREDENTIAL);
    renderEditor();
    const select = (await screen.findByLabelText(/Auth type/i)) as HTMLSelectElement;

    // Nothing stored → the form's own state IS the truth, and "None" is an honest answer.
    expect(select.value).toBe("none");
    expect(screen.queryByRole("option", { name: /Keep the saved sign-in/i })).toBeNull();
  });
});

describe("DeliveryConfigEditor — replacing an HTTP credential never writes a default over a saved value", () => {
  it("blocks the save that would overwrite a custom API-key header with 'X-Api-Key'", async () => {
    renderEditor();
    const select = await screen.findByLabelText(/Auth type/i);

    // Rotating the key: pick API key, paste the new value, leave the header alone — it shows
    // "X-Api-Key" because nothing filled it in, NOT because that is what is stored.
    fireEvent.change(select, { target: { value: "apikey" } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: "sk_live_rotated" } });

    // Pre-fix this saved `{"type":"apikey","header":"X-Api-Key","value":"sk_live_rotated"}`,
    // silently retargeting a supplier whose key belonged on `Authorization`.
    const saveBtn = screen.getByRole("button", { name: /Save delivery/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.click(saveBtn);
    expect(upsertDeliveryConfig).not.toHaveBeenCalled();

    expect(await screen.findByRole("alert")).toHaveTextContent(/Header/);
  });

  it("blocks the OAuth2 secret rotation that would blank the token URL and client id", async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText(/Auth type/i), { target: { value: "oauth2" } });
    fireEvent.change(screen.getByLabelText(/Client secret/i), { target: { value: "rotated-secret" } });

    // Pre-fix this wrote tokenUrl:"" and clientId:"", leaving the token fetch with nothing to call.
    const saveBtn = screen.getByRole("button", { name: /Save delivery/i });
    expect(saveBtn).toBeDisabled();
    fireEvent.click(saveBtn);
    expect(upsertDeliveryConfig).not.toHaveBeenCalled();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Token URL/);
    expect(alert).toHaveTextContent(/Client ID/);
  });

  it("blocks the Basic password rotation that would empty the saved username", async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText(/Auth type/i), { target: { value: "basic" } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: "rotated" } });

    expect(screen.getByRole("button", { name: /Save delivery/i })).toBeDisabled();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Username/);
  });

  it("allows the replacement once every field of the new credential is supplied", async () => {
    renderEditor();
    fireEvent.change(await screen.findByLabelText(/Auth type/i), { target: { value: "apikey" } });
    fireEvent.change(screen.getByLabelText(/^Header$/i), { target: { value: "Authorization" } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: "sk_live_rotated" } });

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    // The header the operator typed — not the placeholder default.
    expect(JSON.parse(lastCredentialsJson() as string)).toMatchObject({
      type: "apikey",
      header: "Authorization",
      value: "sk_live_rotated",
    });
  });
});

describe("DeliveryConfigEditor — leaving the credential alone still leaves it alone", () => {
  it("sends no credential at all when only the address was changed", async () => {
    renderEditor();
    await screen.findByLabelText(/Auth type/i);

    fireEvent.change(screen.getByLabelText(/Endpoint URL/i), {
      target: { value: "https://supplier.example/v2/orders" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    // null = "keep whatever is stored". The anti-vacuity floor for the block above: the guard
    // must not have turned every save into a refusal.
    expect(lastCredentialsJson()).toBeNull();
  });

  it("does not block first-time setup, where there is nothing to overwrite", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP_NO_CREDENTIAL);
    upsertDeliveryConfig.mockResolvedValue(SAVED_HTTP_WITH_CREDENTIAL);
    renderEditor();

    fireEvent.change(await screen.findByLabelText(/Auth type/i), { target: { value: "bearer" } });
    fireEvent.change(screen.getByLabelText(/^Token$/i), { target: { value: "first-token" } });

    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));

    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));
    expect(JSON.parse(lastCredentialsJson() as string)).toMatchObject({
      type: "bearer",
      token: "first-token",
    });
  });

  it("returns to 'keep the saved sign-in' after a save, so a second save cannot be refused", async () => {
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP_NO_CREDENTIAL);
    upsertDeliveryConfig.mockResolvedValue(SAVED_HTTP_WITH_CREDENTIAL);
    renderEditor();

    fireEvent.change(await screen.findByLabelText(/Auth type/i), { target: { value: "bearer" } });
    fireEvent.change(screen.getByLabelText(/^Token$/i), { target: { value: "first-token" } });
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));

    // The save cleared the secret field. Were the form still treated as authoritative, the very
    // next save would be blocked for a blank token the operator never emptied.
    const select = (await screen.findByLabelText(/Auth type/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("__unknown__"));
    expect(screen.getByRole("button", { name: /Save delivery/i })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(2));
    expect(lastCredentialsJson()).toBeNull();
  });
});

describe("DeliveryConfigEditor — a passed connection test does not survive an unsaved credential edit", () => {
  it("clears the pass when the API-key value is edited afterwards", async () => {
    testFireDelivery.mockResolvedValue({ success: true, errorMessage: null, responseCode: 200 });
    renderEditor();
    fireEvent.change(await screen.findByLabelText(/Auth type/i), { target: { value: "apikey" } });
    fireEvent.change(screen.getByLabelText(/^Header$/i), { target: { value: "Authorization" } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: "sk_live_a" } });

    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    expect(await screen.findByText(/The supplier's system answered/i)).toBeInTheDocument();

    // The six HTTP credential inputs were the only ones in the form that did not call
    // markEdited(), so the green result outlived the credential it was a result for.
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: "sk_live_b" } });
    await waitFor(() =>
      expect(screen.queryByText(/The supplier's system answered/i)).toBeNull(),
    );
  });

  it("clears the pass when the API-key header is edited afterwards", async () => {
    testFireDelivery.mockResolvedValue({ success: true, errorMessage: null, responseCode: 200 });
    renderEditor();
    fireEvent.change(await screen.findByLabelText(/Auth type/i), { target: { value: "apikey" } });
    fireEvent.change(screen.getByLabelText(/^Header$/i), { target: { value: "Authorization" } });
    fireEvent.change(screen.getByLabelText(/^Value$/i), { target: { value: "sk_live_a" } });

    fireEvent.click(screen.getByRole("button", { name: /Test connection/i }));
    expect(await screen.findByText(/The supplier's system answered/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/^Header$/i), { target: { value: "X-Other-Key" } });
    await waitFor(() =>
      expect(screen.queryByText(/The supplier's system answered/i)).toBeNull(),
    );
  });
});
