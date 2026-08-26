import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// WP-11 follow-through — supplier acceptance profile (the "Validation rules" tab).
//
// Custom supplier rules are gated at Enterprise (`custom_supplier_rules_requires_enterprise`)
// on BOTH the create-version and the activate call. Both mutations wrote
// `Save failed: <raw code>` into `saveNotice` — which this tab renders in a GREEN success
// box, so a refusal read as a confirmation with a snake_case token stapled to it.

const getAcceptanceProfile = vi.fn();
const saveAcceptanceProfile = vi.fn();
const activateAcceptanceVersion = vi.fn();

vi.mock("@/lib/api-client", () => ({
  apiClient: { getSuppliers: vi.fn().mockResolvedValue([{ id: "sup-1", name: "Acme Components" }]), deleteSupplier: vi.fn() },
  isApiMockMode: false,
  getAcceptanceProfile: (...a: unknown[]) => getAcceptanceProfile(...a),
  saveAcceptanceProfile: (...a: unknown[]) => saveAcceptanceProfile(...a),
  activateAcceptanceVersion: (...a: unknown[]) => activateAcceptanceVersion(...a),
  applyPoMappingTemplate: vi.fn(),
  getSupplierCatalog: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  importSupplierCatalog: vi.fn(),
  clearSupplierCatalog: vi.fn(),
  getSupplierRuleBindings: vi.fn().mockResolvedValue([]),
  listConnections: vi.fn().mockResolvedValue([]),
}));

const searchParams = new URLSearchParams("tab=acceptance");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
}));
vi.mock("@/lib/tab-param-sync", () => ({ useTabParamSync: () => {} }));
vi.mock("@/hooks/useQueriesEnabled", () => ({ useQueriesEnabled: () => true, useTenantQueriesEnabled: () => true }));
vi.mock("@/hooks/useOrderDirection", () => ({
  useOrderDirection: () => ({ labels: { counterpartyNoun: "Supplier", counterpartyPlural: "Suppliers" } }),
}));
vi.mock("@/hooks/useOnboardingStatus", () => ({ invalidateOnboardingStatus: vi.fn() }));
vi.mock("@/components/connections/SupplierHistoryTab", () => ({ SupplierHistoryTab: () => null }));

import { SupplierDockProfile } from "./SupplierDockProfile";

function renderProfile() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <SupplierDockProfile id="sup-1" />
    </QueryClientProvider>,
  );
}

/** Open the rule editor on a supplier with no profile yet, then save. */
async function saveRules() {
  fireEvent.click(await screen.findByRole("button", { name: /Add profile/i }));
  fireEvent.click(screen.getByRole("button", { name: /Save rules/i }));
}

beforeEach(() => {
  getAcceptanceProfile.mockReset().mockResolvedValue(null);
  saveAcceptanceProfile.mockReset();
  activateAcceptanceVersion.mockReset();
});

afterEach(cleanup);

describe("SupplierDockProfile — plan-gated acceptance profile", () => {
  it("explains the plan and links to the upgrade page when saving a version is refused", async () => {
    saveAcceptanceProfile.mockRejectedValue(
      new Error(JSON.stringify({ error: "custom_supplier_rules_requires_enterprise", upgradeUrl: "/settings" })),
    );

    renderProfile();
    await saveRules();

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/Enterprise/);
    expect(notice.textContent ?? "").not.toMatch(/_requires_|custom_supplier_rules/);
    expect(screen.getByRole("link", { name: /plans/i })).toHaveAttribute("href", "/settings");
  });

  it("does not dress an ordinary save failure as a success", async () => {
    saveAcceptanceProfile.mockRejectedValue(new Error("Rule 2: expected value is required."));

    renderProfile();
    await saveRules();

    const notice = await screen.findByText(/Rule 2: expected value is required/);
    // The success green (#1E6D29) must not be what a failure is painted in.
    expect(notice).not.toHaveStyle({ color: "#1E6D29" });
  });
});
