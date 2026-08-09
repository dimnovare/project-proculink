// Creating a supplier is TWO writes, and the second one can fail on its own.
//
//   step 1  POST /api/suppliers                              creates the supplier
//   step 2  PUT  /api/suppliers/{id}/delivery-config         stores the chosen channel
//
// Step 2 used to be wrapped in a bare `catch {}` that kept only a boolean. Every reason
// it can fail collapsed into one sentence — "Set it on the supplier's Delivery tab" —
// shipped with a button straight to that tab. That instruction is impossible to follow
// for the reason that is now the DEFAULT one: the backend gates delivery-config writes
// on the organisation-admin role, so an ordinary member creating a supplier with a
// channel gets the supplier, no channel, and a button to a screen that will refuse them
// again. A plan gate is the same shape with a different fix.
//
// This file pins the whole contract:
//
//   • step 2 failing NEVER reads as success — the notice is always there and always
//     says the channel was not saved;
//   • the next step it offers is derived from the CAUSE, and the two 403s stay apart —
//     nobody is told to upgrade a plan because they merely lack a role;
//   • the true-success path still reads as success, so this cannot be passed by making
//     everything look like a failure.
//
// ORDERING. Every "the dead-end link is absent" assertion is preceded, in the same test,
// by an assertion that the notice is PRESENT and carries the right sentence. A negative
// assertion on a component that failed to render at all passes for the wrong reason;
// the positive one throws first and takes the vacuous pass with it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus, Supplier } from "@/types/procurement";
import { orgAdminMessage } from "@/lib/planGate";

vi.mock("next/navigation", () => ({
  usePathname: () => "/library/suppliers",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@clerk/nextjs", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: "org_1", userId: "user_1" }),
}));

const createSupplier = vi.fn();
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
    createSupplier: (...a: unknown[]) => createSupplier(...a),
    getSuppliers: (...a: unknown[]) => getSuppliers(...a),
  },
}));

const upsertDeliveryConfig = vi.fn();

vi.mock("@/lib/api/delivery", () => ({
  getDeliveryConfig: vi.fn().mockResolvedValue(null),
  upsertDeliveryConfig: (...a: unknown[]) => upsertDeliveryConfig(...a),
}));

import { SupplierDockList } from "./SupplierDockList";

const NEW_SUPPLIER: Supplier = { id: "sup-new", name: "Acme Components" };

const BILLING: BillingStatus = {
  plan: "growth",
  accountStatus: "active",
  ordersThisMonth: 0,
  orderLimit: 150,
  suppliersUsed: 0,
  supplierLimit: 5,
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

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SupplierDockList />
    </QueryClientProvider>,
  );
}

/**
 * Drive the real path: open the New-supplier panel, name it, pick a delivery channel,
 * save. Picking a channel is what makes this a TWO-step create — without it step 2 is
 * never attempted and there is nothing to swallow.
 */
async function createSupplierWithChannel() {
  renderList();
  fireEvent.click(await screen.findByRole("button", { name: /New supplier/i }));
  fireEvent.change(await screen.findByLabelText(/Supplier name/i), {
    target: { value: "Acme Components" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Email" }));
  fireEvent.click(screen.getByRole("button", { name: /^Add supplier$/i }));
}

beforeEach(() => {
  vi.clearAllMocks();
  getBillingStatus.mockResolvedValue(BILLING);
  listConnections.mockResolvedValue([]);
  getOrgSettings.mockResolvedValue({ orderDirection: "outbound" });
  getSuppliers.mockResolvedValue([]);
  createSupplier.mockResolvedValue(NEW_SUPPLIER);
  upsertDeliveryConfig.mockResolvedValue({});
});

// ─── The three causes, and the fact that they are three ──────────────────────
//
// The table is the corpus this file sweeps. A cause that stops being reachable, or a
// fourth that is added without a decision about what to tell the reader, changes this
// length — and the floor below fails before any per-arm assertion gets to run.

const CAUSES = [
  {
    id: "org_admin",
    // What `src/lib/api/delivery.ts` throws for a 403 `requires_org_admin`: the code has
    // already been swapped for the finished sentence by the time it reaches the component.
    thrown: () => new Error(orgAdminMessage()),
    /** The fix is another person, so there is nowhere in the product to send this reader. */
    offersDeliveryTab: false,
    offersUpgrade: false,
  },
  {
    id: "org_admin_raw_code",
    // The same refusal from a caller the api layer has not converted — the raw code.
    thrown: () => new Error("API error 403: requires_org_admin"),
    offersDeliveryTab: false,
    offersUpgrade: false,
  },
  {
    id: "plan_gate",
    thrown: () =>
      new Error(
        `API error 403: ${JSON.stringify({
          error: "webhook_delivery_requires_growth",
          upgradeUrl: "/settings",
        })}`,
      ),
    offersDeliveryTab: false,
    offersUpgrade: true,
  },
  {
    id: "server_error",
    thrown: () => new Error("API error 500: Internal Server Error"),
    /** Nothing about the reader blocks them here — the Delivery tab really is the fix. */
    offersDeliveryTab: true,
    offersUpgrade: false,
  },
] as const;

describe("SupplierDockList — the delivery-channel write is a second step that can fail alone", () => {
  it("covers every cause the second step can fail for (anti-vacuity floor)", () => {
    expect(CAUSES.length).toBeGreaterThan(0);
    expect(CAUSES).toHaveLength(4);
    // Both 403s are represented, and they are not the same arm as each other.
    expect(CAUSES.filter((c) => c.offersUpgrade)).toHaveLength(1);
    expect(CAUSES.filter((c) => !c.offersDeliveryTab && !c.offersUpgrade)).toHaveLength(2);
  });

  for (const cause of CAUSES) {
    it(`${cause.id}: says the channel was not saved instead of reporting success`, async () => {
      upsertDeliveryConfig.mockRejectedValue(cause.thrown());

      await createSupplierWithChannel();

      // POSITIVE FIRST — this throws if nothing rendered, so the negatives below
      // cannot pass on an empty screen.
      const notice = await screen.findByRole("status");
      expect(notice).toHaveTextContent(/delivery channel was not saved/i);
      expect(notice).toHaveTextContent(/orders cannot be sent to this supplier yet/i);

      // The supplier itself was created — the notice must not claim otherwise.
      expect(createSupplier).toHaveBeenCalledTimes(1);
      expect(notice).toHaveTextContent(/^Supplier created/);

      // No raw machine code ever reaches the reader.
      expect(notice.textContent ?? "").not.toMatch(/requires_org_admin|_requires_|API error \d/);
    });

    it(`${cause.id}: offers only a next step that can actually work`, async () => {
      upsertDeliveryConfig.mockRejectedValue(cause.thrown());

      await createSupplierWithChannel();

      const notice = await screen.findByRole("status");
      expect(notice).toBeInTheDocument();

      const deliveryTab = screen.queryByRole("link", { name: /Open Delivery tab/i });
      const upgrade = screen.queryByRole("link", { name: /See plans/i });

      if (cause.offersDeliveryTab) {
        expect(deliveryTab).toHaveAttribute(
          "href",
          `/library/suppliers/${NEW_SUPPLIER.id}?tab=delivery`,
        );
      } else {
        expect(deliveryTab).toBeNull();
      }

      if (cause.offersUpgrade) {
        expect(upgrade).toHaveAttribute("href", "/settings");
      } else {
        expect(upgrade).toBeNull();
      }
    });
  }

  it("tells a member who is not an administrator to ask one — and never to upgrade", async () => {
    upsertDeliveryConfig.mockRejectedValue(new Error(orgAdminMessage()));

    await createSupplierWithChannel();

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/Only an administrator of your organisation can do this/i);
    // A fabricated reason to spend money is worse than no explanation at all.
    expect(notice.textContent ?? "").not.toMatch(/upgrade|plan/i);
  });

  it("tells an org whose plan lacks the channel to upgrade — naming the plan the server named", async () => {
    upsertDeliveryConfig.mockRejectedValue(
      new Error(
        `API error 403: ${JSON.stringify({
          error: "webhook_delivery_requires_growth",
          upgradeUrl: "/settings",
        })}`,
      ),
    );

    await createSupplierWithChannel();

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/Growth/);
    // ...and not the OTHER 403's fix, which would send a blocked org to a colleague
    // who is equally blocked.
    expect(notice.textContent ?? "").not.toMatch(/administrator/i);
  });

  // ─── The control: success must still read as success ───────────────────────

  it("reports a clean two-step create as success, with no warning at all", async () => {
    getSuppliers.mockResolvedValueOnce([]).mockResolvedValue([NEW_SUPPLIER]);

    await createSupplierWithChannel();

    // POSITIVE FIRST: the supplier is on screen and the panel has closed.
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The list renders each supplier twice — a desktop table row and a mobile card —
    // so this is deliberately "at least one", not "exactly one".
    expect((await screen.findAllByText("Acme Components")).length).toBeGreaterThan(0);

    expect(upsertDeliveryConfig).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/was not saved/i)).toBeNull();
  });

  it("does not invent a channel failure when no channel was chosen", async () => {
    getSuppliers.mockResolvedValueOnce([]).mockResolvedValue([NEW_SUPPLIER]);
    renderList();

    fireEvent.click(await screen.findByRole("button", { name: /New supplier/i }));
    fireEvent.change(await screen.findByLabelText(/Supplier name/i), {
      target: { value: "Acme Components" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^Add supplier$/i }));

    // The list renders each supplier twice — a desktop table row and a mobile card —
    // so this is deliberately "at least one", not "exactly one".
    expect((await screen.findAllByText("Acme Components")).length).toBeGreaterThan(0);
    expect(upsertDeliveryConfig).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
