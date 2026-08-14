/**
 * `/library/suppliers/{id}?tab=delivery` — the delivery-config cache, and what it kept saying
 * after the config underneath it changed.
 *
 * `["supplier-delivery-config", id]` is read by three surfaces and was written by exactly one
 * mutation: supplier CREATE. Save and delete — the two things that actually change a delivery
 * config — invalidated `["onboarding-status"]` and nothing else, and the read carries a
 * `staleTime`, so for the rest of that window every reader answered from an entry no longer
 * describing anything real.
 *
 * The second consequence is the one that destroys work. `FirstTimeDeliveryOffer` gates on a
 * definite `data === null`, which is correct — but fed a STALE null it renders
 *
 *     "Setting up delivery for this supplier? We can walk you through it."
 *
 * directly above an editor that has just printed "Delivery settings saved." Its wizard builds a
 * config from scratch, so accepting the offer overwrites the credential just stored and drops the
 * carried-over config keys. The offer is therefore the assertion target throughout this file: it
 * is the sentence a stale cache turns into a trap.
 *
 * ── WHY THIS FILE RENDERS THE REAL SCREEN ───────────────────────────────────────────────────
 * The sibling suites mock `@tanstack/react-query` wholesale, which makes them structurally
 * incapable of seeing this defect: with `useQueryClient` stubbed to `{ invalidateQueries: vi.fn() }`
 * there is no cache to go stale. So this file uses a REAL QueryClient and the REAL editor and
 * wizard, and drives the ACTUAL SEQUENCE — warm the cache, run the mutation, re-read the screen.
 * Mounting with an already-correct cache would pass against the broken code.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DeliveryConfig } from "@/lib/api/types";

// ── The claim, verbatim as it renders ───────────────────────────────────────
//
// `FirstTimeDeliveryOffer` interpolates the party noun, so this is matched as a regex against
// document.body.textContent rather than as a string literal.
const OFFER = /Setting up delivery for this supplier\? We can walk you through it\./;

const SUPPLIER_ID = "sup-1";

const SAVED_HTTP: DeliveryConfig = {
  supplierId: SUPPLIER_ID,
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

// ── API surface (mocked); react-query is NOT mocked ─────────────────────────

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

vi.mock("@/lib/api/mapping", () => ({
  getPoMapping: vi.fn().mockResolvedValue(null),
  upsertPoMapping: vi.fn(),
  deletePoMapping: vi.fn(),
}));

vi.mock("@/lib/api/settings", () => ({ getOrgSettings: vi.fn().mockResolvedValue({}) }));

vi.mock("@/lib/api-client", () => ({
  apiClient: {
    // Literals, not the consts above: vi.mock factories are hoisted above them.
    getSuppliers: vi.fn().mockResolvedValue([{ id: "sup-1", name: "Nordmark Handel GmbH" }]),
    deleteSupplier: vi.fn(),
    getOrders: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
  isApiMockMode: false,
  getAcceptanceProfile: vi.fn().mockResolvedValue(null),
  saveAcceptanceProfile: vi.fn(),
  activateAcceptanceVersion: vi.fn(),
  applyPoMappingTemplate: vi.fn(),
  getSupplierCatalog: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  importSupplierCatalog: vi.fn(),
  clearSupplierCatalog: vi.fn(),
  getSupplierRuleBindings: vi.fn().mockResolvedValue([]),
  listConnections: vi.fn().mockResolvedValue([]),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("tab=delivery"),
}));
vi.mock("@/lib/tab-param-sync", () => ({ useTabParamSync: () => {} }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({
    labels: { counterpartyNoun: "Supplier", counterpartyPlural: "Suppliers" },
  }),
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));

// The delete path is behind a confirm dialog; auto-accept so the mutation is reachable.
vi.mock("@/components/ui/confirm", () => ({ useConfirm: () => () => Promise.resolve(true) }));

// Out-of-scope neighbours on other tabs / inside the editor's chrome.
vi.mock("@/components/bridge/ConnectorRequirementsPanel", () => ({
  ConnectorRequirementsPanel: () => <div data-testid="mock-connector-panel" />,
}));
vi.mock("./SupplierIdentityCard", () => ({ SupplierIdentityCard: () => <div data-testid="supplier-identity-card" /> }));
vi.mock("./CatalogSourceEditor", () => ({ CatalogSourceEditor: () => <div data-testid="catalog-source-editor" /> }));
vi.mock("./PoMappingEditor", () => ({ PoMappingEditor: () => <div data-testid="po-mapping-editor" /> }));
vi.mock("@/components/connections/SupplierHistoryTab", () => ({
  SupplierHistoryTab: () => <div data-testid="supplier-history-tab" />,
}));

import { SupplierDockProfile } from "./SupplierDockProfile";

// ── Harness ─────────────────────────────────────────────────────────────────

/**
 * A real cache with the production staleTime intact. `staleTime: 30_000` is not incidental —
 * it is the reason an un-invalidated entry survives the mutation, so a test that zeroed it
 * would refetch on its own and pass against the broken code.
 */
function renderDeliveryTab() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupplierDockProfile id={SUPPLIER_ID} />
    </QueryClientProvider>,
  );
}

/** The assertion surface: what the operator can actually read on the page. */
const bodyText = () => document.body.textContent ?? "";

/** Wait until the delivery editor has finished its own load, so the tab is settled. */
async function awaitEditorReady() {
  await screen.findByRole("button", { name: /Save delivery/i });
}

beforeEach(() => {
  getDeliveryConfig.mockReset();
  upsertDeliveryConfig.mockReset();
  deleteDeliveryConfig.mockReset().mockResolvedValue(undefined);
  testFireDelivery.mockReset();
});

afterEach(cleanup);

describe("delivery config save — the offer to rebuild it from scratch must not survive the save", () => {
  it("stops offering the guided wizard once the editor has saved a config", async () => {
    // Nothing configured yet: the offer is CORRECT here, and this is the anti-vacuity half —
    // without it every assertion below would pass on a screen that never renders the sentence.
    getDeliveryConfig.mockResolvedValue(null);
    renderDeliveryTab();
    await awaitEditorReady();
    await waitFor(() => expect(bodyText()).toMatch(OFFER));

    // The save. From here on the API's answer is a configured supplier.
    upsertDeliveryConfig.mockResolvedValue(SAVED_HTTP);
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP);
    const readsBeforeSave = getDeliveryConfig.mock.calls.length;

    fireEvent.change(screen.getByLabelText(/Endpoint URL/i), {
      target: { value: "https://supplier.example/orders" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Save delivery/i }));
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));

    // The mechanical half: the cache entry was dropped, so the surface asked again.
    await waitFor(() => expect(getDeliveryConfig.mock.calls.length).toBeGreaterThan(readsBeforeSave));

    // The half that matters: pre-fix, this sentence sat above a confirmed save, and taking it
    // up replaced the credential that had just been stored.
    await waitFor(() => expect(bodyText()).not.toMatch(OFFER));
  });
});

describe("delivery config delete — the screen must stop describing a configuration that is gone", () => {
  it("offers setup again once the saved config has been deleted", async () => {
    // Configured: the offer is correctly absent, which is the anti-vacuity half for a test
    // whose payload is the sentence APPEARING.
    getDeliveryConfig.mockResolvedValue(SAVED_HTTP);
    renderDeliveryTab();
    await awaitEditorReady();
    await waitFor(() => expect(screen.getByRole("button", { name: /^Delete$/i })).toBeInTheDocument());
    expect(bodyText()).not.toMatch(OFFER);

    // The delete. The supplier now has no delivery config at all.
    getDeliveryConfig.mockResolvedValue(null);
    const readsBeforeDelete = getDeliveryConfig.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/i }));
    await waitFor(() => expect(deleteDeliveryConfig).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(getDeliveryConfig.mock.calls.length).toBeGreaterThan(readsBeforeDelete));

    // Pre-fix the cached config outlived the deletion, and every reader kept printing a channel,
    // a format and an "Auto-process · On" for a configuration that no longer existed.
    await waitFor(() => expect(bodyText()).toMatch(OFFER));
  });
});

describe("guided setup save — the wizard must retire the offer that launched it", () => {
  it("stops offering the wizard once the wizard itself has saved a config", async () => {
    getDeliveryConfig.mockResolvedValue(null);
    renderDeliveryTab();
    await awaitEditorReady();
    await waitFor(() => expect(bodyText()).toMatch(OFFER));

    upsertDeliveryConfig.mockResolvedValue(SAVED_HTTP);

    // Step 1 — channel. Step 2 — where. Step 3 — format, then save.
    // Scoped to the dialog: the editor behind it has its own "Endpoint URL" field, and an
    // unscoped query would match both and throw.
    fireEvent.click(screen.getByRole("button", { name: /Set up step by step/i }));
    const wizard = within(await screen.findByRole("dialog"));
    fireEvent.click(wizard.getByRole("button", { name: /HTTP webhook \/ API/i }));
    fireEvent.change(await wizard.findByLabelText(/Endpoint URL/i), {
      target: { value: "https://supplier.example/orders" },
    });
    fireEvent.click(wizard.getByRole("button", { name: /Continue/i }));

    getDeliveryConfig.mockResolvedValue(SAVED_HTTP);
    const readsBeforeSave = getDeliveryConfig.mock.calls.length;

    fireEvent.click(await screen.findByRole("button", { name: /Save & continue/i }));
    await waitFor(() => expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(getDeliveryConfig.mock.calls.length).toBeGreaterThan(readsBeforeSave));
  });
});
