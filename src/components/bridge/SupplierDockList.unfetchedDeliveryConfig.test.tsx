// `/library/suppliers` — the delivery verdict printed for rows nobody asked about.
//
// The list enriches each row with `GET /api/suppliers/{id}/delivery-config`, but
// bounded: only the first DELIVERY_FETCH_CAP rows pass `enabled`. A disabled
// TanStack v5 query reports `isLoading === false` with `data === undefined` —
// the SAME shape a settled "this supplier has no config" read produces. The row
// derived its cells from `!config`, so every supplier past the cap printed:
//
//     Format  —      Channel  —      Auto-process  [ Not set ]
//
// …with the shimmer explicitly suppressed (`fetchConfig && isLoading`), so
// nothing on screen suggested the question had never been put. The file's own
// doc comment called "Not set" *"the honest empty state — distinct from a
// configured-but-manual supplier"*, which is exactly the claim that stops being
// true at row 51.
//
// The SAME cells had a second, worse cause of the same lie: `isError` was never
// destructured either, and `getDeliveryConfig` throws on any non-ok response. A
// settled-errored query also reports `isLoading === false` with `data ===
// undefined`, so a supplier with a live, working delivery config read "Not set"
// the moment its request failed — after the query had run and retried, and on a
// screen that fires up to DELIVERY_FETCH_CAP of them in parallel on mount. Both
// causes are pinned here, because a fix for either one alone leaves the cells
// saying the same false thing.
//
// THE VACUITY TRAP THIS FILE IS BUILT AGAINST. A fixture with fewer suppliers
// than the cap never produces one un-fetched row, so every assertion below would
// pass against the SHIPPED code. So:
//
//   • the fixture size is DERIVED from the exported DELIVERY_FETCH_CAP, never
//     typed — it cannot silently fall under the cap when the cap is raised;
//   • a floor asserts the fixture really straddles the cap AND that every one of
//     its rows really rendered, so a fixture that shrank fails loudly here
//     instead of turning the negative assertions green;
//   • the expected counts are computed from the fixture, not written down;
//   • `getDeliveryConfig` call counts are asserted, so "this row never fetched"
//     is established mechanically and not inferred from the copy on screen.
//
// A REAL QueryClient is used, not a mocked `useQuery`. The defect lives in what
// a DISABLED query returns; a hand-stubbed hook would let this file assert
// whatever it liked about a state TanStack actually owns.
//
// Every assertion reads `document.body.textContent`, which is what an operator
// reads. Props are not evidence.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus } from "@/types/procurement";

vi.mock("next/navigation", () => ({
  usePathname: () => "/library/suppliers",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: "org_1", userId: "user_1" }),
}));

const getSuppliers = vi.fn();
const getBillingStatus = vi.fn();
const listConnections = vi.fn();
const getOrgSettings = vi.fn();

vi.mock("@/lib/api-client", () => ({
  isApiMockMode: false,
  isQaBypass: false,
  getBillingStatus: (...a: unknown[]) => getBillingStatus(...a),
  listConnections: (...a: unknown[]) => listConnections(...a),
  getOrgSettings: (...a: unknown[]) => getOrgSettings(...a),
  apiClient: {
    createSupplier: vi.fn(),
    getSuppliers: (...a: unknown[]) => getSuppliers(...a),
  },
}));

const getDeliveryConfig = vi.fn();

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: (...a: unknown[]) => getDeliveryConfig(...a),
  upsertDeliveryConfig: vi.fn(),
}));

import { SupplierDockList, DELIVERY_FETCH_CAP } from "./SupplierDockList";

// ── The two sentences under test, verbatim ──────────────────────────────────

/** The verdict that may only follow a completed read. */
const ABSENCE_CLAIM = "Not set";
/** What an un-fetched cell says instead. */
const NOT_LOADED_CLAIM = "Not loaded";
const NOT_LOADED_TITLE =
  'Not loaded — not the same as "not configured". Open the supplier to see its delivery setup.';

// ── Fixture ─────────────────────────────────────────────────────────────────
//
// Straddles the cap by construction. `EXTRA_PAST_CAP` is the only number typed
// in this file, and the floor below proves it produced un-fetched rows.

const EXTRA_PAST_CAP = 8;
const SUPPLIER_COUNT = DELIVERY_FETCH_CAP + EXTRA_PAST_CAP;

/** Each supplier renders twice — the ≥sm table row and the phone card. */
const LAYOUTS = 2;
/** Cells on a row that are driven by the delivery config: Format, Channel, Auto-process. */
const CONFIG_CELLS_PER_ROW = 3;

const pad = (n: number) => String(n).padStart(3, "0");

const SUPPLIERS = Array.from({ length: SUPPLIER_COUNT }, (_, i) => ({
  id: `sup-${pad(i)}`,
  name: `Supplier ${pad(i)}`,
}));

const IN_CAP = SUPPLIERS.slice(0, DELIVERY_FETCH_CAP);
const PAST_CAP = SUPPLIERS.slice(DELIVERY_FETCH_CAP);

/** An arbitrary row on each side of the cap, used for the per-row assertions. */
const IN_CAP_CONFIGURED = IN_CAP[0];
const IN_CAP_UNCONFIGURED = IN_CAP[1];
const PAST_CAP_ROW = PAST_CAP[PAST_CAP.length - 1];

const CONFIG = {
  supplierId: "",
  protocol: "http",
  autoDeliver: true,
  configJson: "{}",
  outputFormat: "cxml",
  hasCredentials: true,
  credentialsDisplay: "API key ••••4821",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
};

/**
 * Half the suppliers genuinely have a config and half genuinely do not — so the
 * screen has a real "Not set" population to print. Without it, "'Not set'
 * appears exactly N times" could be satisfied by deleting the pill.
 */
const hasConfig = (index: number) => index % 2 === 0;
const configFor = (id: string) => {
  const index = SUPPLIERS.findIndex((s) => s.id === id);
  return hasConfig(index) ? { ...CONFIG, supplierId: id } : null;
};

const IN_CAP_WITH_CONFIG = IN_CAP.filter((_, i) => hasConfig(i)).length;
const IN_CAP_WITHOUT_CONFIG = IN_CAP.length - IN_CAP_WITH_CONFIG;

const BILLING: BillingStatus = {
  plan: "enterprise",
  accountStatus: "active",
  ordersThisMonth: 0,
  orderLimit: 100000,
  suppliersUsed: SUPPLIER_COUNT,
  supplierLimit: 100000,
  trialStartedAt: null,
  trialEndsAt: null,
  isTrialExpired: false,
  isOrderLimitReached: false,
  isSupplierLimitReached: false,
  canProcessOrders: true,
  canAddSupplier: true,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
} as BillingStatus;

// ── Harness ─────────────────────────────────────────────────────────────────

const bodyText = () => document.body.textContent ?? "";
/** Occurrences of `needle` in what the operator actually reads. */
const occurrences = (needle: string) => bodyText().split(needle).length - 1;

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupplierDockList />
    </QueryClientProvider>,
  );
}

/** Render, then wait until every enabled delivery-config read has landed on screen. */
async function renderSettled() {
  renderList();
  await waitFor(() =>
    expect(getDeliveryConfig).toHaveBeenCalledTimes(DELIVERY_FETCH_CAP),
  );
  // The configs are on screen, not merely resolved: CXML is printed once per
  // configured row per layout, and that count is derived from the fixture.
  await waitFor(() =>
    expect(occurrences("CXML")).toBe(IN_CAP_WITH_CONFIG * LAYOUTS),
  );
}

/** The desktop `<tr>` for one supplier. */
const rowFor = (name: string) => screen.getAllByText(name)[0].closest("tr") as HTMLElement;
/** The phone card `<li>` for one supplier. */
const cardFor = (name: string) => screen.getAllByText(name)[1].closest("li") as HTMLElement;

beforeEach(() => {
  vi.clearAllMocks();
  getBillingStatus.mockResolvedValue(BILLING);
  listConnections.mockResolvedValue([]);
  getOrgSettings.mockResolvedValue({ orderDirection: "outbound" });
  getSuppliers.mockResolvedValue(SUPPLIERS);
  getDeliveryConfig.mockImplementation((id: string) => Promise.resolve(configFor(id)));
});
afterEach(cleanup);

// ── Floor ───────────────────────────────────────────────────────────────────

describe("SupplierDockList — un-fetched delivery config, anti-vacuity floor", () => {
  it("uses a fixture that actually straddles the fetch cap", () => {
    expect(DELIVERY_FETCH_CAP).toBeGreaterThan(0);
    expect(SUPPLIER_COUNT).toBeGreaterThan(DELIVERY_FETCH_CAP);
    expect(PAST_CAP.length).toBe(EXTRA_PAST_CAP);
    expect(PAST_CAP.length).toBeGreaterThan(0);
    // Both in-cap populations are non-empty, so "Not set" has a real reason to
    // render and a real reason not to.
    expect(IN_CAP_WITH_CONFIG).toBeGreaterThan(0);
    expect(IN_CAP_WITHOUT_CONFIG).toBeGreaterThan(0);
  });

  it("renders every supplier in the fixture, in both layouts", async () => {
    await renderSettled();
    // A fixture that silently shrank — or a list that quietly truncated itself —
    // fails HERE, before any count below can pass for the wrong reason.
    for (const s of SUPPLIERS) {
      expect(occurrences(s.name), `${s.name} rendered`).toBe(LAYOUTS);
    }
  });

  it("fetches exactly the rows inside the cap, and none past it", async () => {
    await renderSettled();
    // The mechanical half of the contract: "this row never asked" is established
    // by the absence of the call, not by reading the copy it printed.
    expect(getDeliveryConfig).toHaveBeenCalledTimes(DELIVERY_FETCH_CAP);
    const askedFor = new Set(getDeliveryConfig.mock.calls.map((c) => c[0] as string));
    for (const s of IN_CAP) expect(askedFor.has(s.id), `${s.id} inside cap`).toBe(true);
    for (const s of PAST_CAP) expect(askedFor.has(s.id), `${s.id} past cap`).toBe(false);
  });
});

// ── The defect ──────────────────────────────────────────────────────────────

describe("SupplierDockList — a row past the fetch cap does not report an absence", () => {
  it("prints 'Not set' exactly as often as a completed read returned no config", async () => {
    await renderSettled();

    // POSITIVE FIRST: the pill provably renders, so the count below is a real
    // count and not a deleted component.
    expect(occurrences(ABSENCE_CLAIM)).toBeGreaterThan(0);
    // Derived, never typed. The shipped code printed
    // (IN_CAP_WITHOUT_CONFIG + PAST_CAP.length) * LAYOUTS here.
    expect(occurrences(ABSENCE_CLAIM)).toBe(IN_CAP_WITHOUT_CONFIG * LAYOUTS);
  });

  it("says the config was not loaded on every cell of every un-fetched row", async () => {
    await renderSettled();

    expect(occurrences(NOT_LOADED_CLAIM)).toBe(
      PAST_CAP.length * CONFIG_CELLS_PER_ROW * LAYOUTS,
    );
  });

  it("a row past the cap claims nothing about its delivery setup", async () => {
    await renderSettled();

    const row = rowFor(PAST_CAP_ROW.name);
    const text = row.textContent ?? "";
    // POSITIVE FIRST — the row is on screen and says what it does not know.
    expect(text).toContain(NOT_LOADED_CLAIM);
    // …and none of the three verdicts the delivery config could have produced.
    expect(text).not.toContain(ABSENCE_CLAIM);
    expect(text).not.toContain("On");
    expect(text).not.toContain("Off");
    expect(text).not.toContain("CXML");
    expect(text).not.toContain("HTTP");
  });

  it("names where the answer actually lives, on every un-fetched cell", async () => {
    await renderSettled();

    for (const container of [rowFor(PAST_CAP_ROW.name), cardFor(PAST_CAP_ROW.name)]) {
      const explained = Array.from(container.querySelectorAll("[title]")).filter(
        (el) => el.getAttribute("title") === NOT_LOADED_TITLE,
      );
      expect(explained).toHaveLength(CONFIG_CELLS_PER_ROW);
    }
    // The sentence names the reading it is NOT, which is the one the cell used
    // to give: an operator must not read this dash as "nothing is configured".
    expect(NOT_LOADED_TITLE).toContain('not the same as "not configured"');
  });

  it("the phone card past the cap makes the same claim as its table row", async () => {
    await renderSettled();

    const card = cardFor(PAST_CAP_ROW.name).textContent ?? "";
    expect(card).toContain(NOT_LOADED_CLAIM);
    expect(card).not.toContain(ABSENCE_CLAIM);
  });
});

// ── The control: the rows that DID fetch still report what they found ───────

describe("SupplierDockList — a completed read still reports what it found", () => {
  it("prints the saved format, channel and auto-process for a configured supplier", async () => {
    await renderSettled();

    const text = rowFor(IN_CAP_CONFIGURED.name).textContent ?? "";
    expect(text).toContain("CXML");
    expect(text).toContain("HTTP");
    expect(text).toContain("On");
    expect(text).not.toContain(NOT_LOADED_CLAIM);
  });

  it("still says 'Not set' for a supplier the server said has no config", async () => {
    await renderSettled();

    const text = rowFor(IN_CAP_UNCONFIGURED.name).textContent ?? "";
    expect(text).toContain(ABSENCE_CLAIM);
    // The fix must not turn a real absence into a shrug.
    expect(text).not.toContain(NOT_LOADED_CLAIM);
  });
});

// ── The other two ways a cell can have no answer ────────────────────────────

describe("SupplierDockList — an outstanding or failed read is not an absence either", () => {
  it("claims nothing while the delivery-config reads are still in flight", async () => {
    getDeliveryConfig.mockImplementation(() => new Promise(() => {}));
    renderList();

    // POSITIVE FIRST: the list rendered.
    expect((await screen.findAllByText(IN_CAP_CONFIGURED.name)).length).toBe(LAYOUTS);
    await waitFor(() =>
      expect(getDeliveryConfig).toHaveBeenCalledTimes(DELIVERY_FETCH_CAP),
    );

    // Nothing has answered, so nothing may be reported: the in-cap rows shimmer
    // and the past-cap rows say they were not loaded.
    expect(occurrences(ABSENCE_CLAIM)).toBe(0);
    expect(occurrences(NOT_LOADED_CLAIM)).toBe(
      PAST_CAP.length * CONFIG_CELLS_PER_ROW * LAYOUTS,
    );
  });

  it("does not report a failed read as a supplier with no config", async () => {
    // The second, worse half of the same defect: `getDeliveryConfig` throws on
    // any non-ok response, `isError` was never destructured, and a settled-
    // errored query also reports isLoading === false / data === undefined. A
    // supplier with a live, working delivery config read "Not set" the moment
    // its request 5xx'd — and this list fires up to DELIVERY_FETCH_CAP of them
    // in parallel on mount.
    getDeliveryConfig.mockRejectedValue(new Error("boom"));
    renderList();

    expect((await screen.findAllByText(IN_CAP_CONFIGURED.name)).length).toBe(LAYOUTS);
    // The per-row query retries once (retryDelay 800ms) before settling to error.
    // Every row is now unknown — the failed ones AND the ones past the cap.
    await waitFor(
      () =>
        expect(occurrences(NOT_LOADED_CLAIM)).toBe(
          SUPPLIER_COUNT * CONFIG_CELLS_PER_ROW * LAYOUTS,
        ),
      { timeout: 8000 },
    );
    expect(occurrences(ABSENCE_CLAIM)).toBe(0);

    // Named row, both layouts: a supplier whose read FAILED (inside the cap, so
    // it really was requested) says nothing about its delivery setup.
    expect(getDeliveryConfig.mock.calls.some((c) => c[0] === IN_CAP_CONFIGURED.id)).toBe(true);
    for (const text of [
      rowFor(IN_CAP_CONFIGURED.name).textContent ?? "",
      cardFor(IN_CAP_CONFIGURED.name).textContent ?? "",
    ]) {
      expect(text).toContain(NOT_LOADED_CLAIM);
      expect(text).not.toContain(ABSENCE_CLAIM);
      expect(text).not.toContain("CXML");
    }
  }, 15000);
});
