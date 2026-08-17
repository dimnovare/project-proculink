import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BillingStatus } from "@/types/procurement";
import type { SftpIngressSettings, S3IngressSettings } from "@/lib/api/settings";

// ─────────────────────────────────────────────────────────────────────────────
// THE DEFECT, exactly.
//
// `canEnable` on both pull-ingress panels was
//
//     const canEnable = !!billing && billing.plan !== "pilot";
//
// and `useBilling()` is `retry: false`. So `billing` is undefined in TWO states that
// have nothing in common: the first fetch is in flight, and — permanently — after a
// single failed `GET /api/billing/status`. Both panels answered all of it with one
// sentence, stated as fact:
//
//     "turning on polling needs a paid plan — your current plan doesn't include it"
//
// and disabled the toggle. A Distributor workspace whose billing lookup blipped was
// told it did not have a channel it pays €1,499/month for, and had the switch taken
// away. The identical defect was already fixed one tab over on Email
// (src/app/(app)/settings/page.tsx:782-811), whose comment records that it "got told
// it was on Pilot and offered a €1,350/month downgrade".
//
// So EVERY assertion below distinguishes the two states by QUERY STATE ALONE — same
// component, same props, only `getBillingStatus` differs (rejects / resolves pilot /
// resolves distributor / never settles). A test that only rendered the pilot case
// passes against the broken code, which is exactly how this survived.
// ─────────────────────────────────────────────────────────────────────────────

const api = {
  getBillingStatus: vi.fn(),
  getSuppliers: vi.fn(),
  getSftpSettings: vi.fn(),
  updateSftpSettings: vi.fn(),
  getS3Settings: vi.fn(),
  updateS3Settings: vi.fn(),
};

vi.mock("@/lib/api-client", () => ({
  apiClient: { getSuppliers: () => api.getSuppliers() },
  getBillingStatus: () => api.getBillingStatus(),
  getSftpSettings: () => api.getSftpSettings(),
  updateSftpSettings: (...a: unknown[]) => api.updateSftpSettings(...a),
  getS3Settings: () => api.getS3Settings(),
  updateS3Settings: (...a: unknown[]) => api.updateS3Settings(...a),
}));

import { SftpPullSettings, S3PullSettings } from "./PullIngressSettings";
import { PLAN_BY_ID } from "@/lib/plans";
import { minimumPlanId } from "@/lib/gatedCapabilities";

function billing(over: Partial<BillingStatus> = {}): BillingStatus {
  return {
    plan: "distributor",
    accountStatus: "active",
    ordersThisMonth: 120,
    orderLimit: 2500,
    suppliersUsed: 7,
    supplierLimit: 30,
    trialStartedAt: null,
    trialEndsAt: null,
    isTrialExpired: false,
    isOrderLimitReached: false,
    isSupplierLimitReached: false,
    canProcessOrders: true,
    canAddSupplier: true,
    stripeCustomerId: "cus_live",
    stripeSubscriptionId: "sub_live",
    overageOrders: 0,
    overageAmountEur: 0,
    nearLimit: false,
    atLimit: false,
    billingInterval: "monthly",
    ...over,
  };
}

const SFTP: SftpIngressSettings = {
  enabled: false, host: "", port: 22, username: "", remoteDirectory: "",
  defaultSupplierId: null, hasPassword: false, passwordDisplay: null, updatedAt: null,
};

const S3: S3IngressSettings = {
  enabled: false, bucketName: "", keyPrefix: "", region: "", accessKeyId: "",
  defaultSupplierId: null, hasSecretKey: false, secretKeyDisplay: null, updatedAt: null, serviceUrl: null,
};

/** A real supplier, so "no suppliers yet" never becomes the reason the toggle is off. */
const SUPPLIERS = [{ id: "sup-1", name: "Nordmark Tooling" }];

type Panel = "sftp" | "s3";

async function renderPanel(panel: Panel) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Ui = panel === "sftp" ? SftpPullSettings : S3PullSettings;
  const view = render(
    <QueryClientProvider client={qc}>
      <Ui />
    </QueryClientProvider>,
  );
  // The panel's own GET must have landed before anything is asserted, or "no notice"
  // would just mean "still on the loading skeleton".
  await screen.findByLabelText(
    panel === "sftp" ? "Poll this SFTP folder for orders" : "Watch this bucket for orders",
  );
  return view;
}

function toggle(panel: Panel): HTMLInputElement {
  return screen.getByLabelText(
    panel === "sftp" ? "Poll this SFTP folder for orders" : "Watch this bucket for orders",
  ) as HTMLInputElement;
}

function gate(panel: Panel): HTMLElement | null {
  return screen.queryByTestId(`pull-ingress-plan-gate-${panel === "sftp" ? "sftpIngestion" : "s3Ingestion"}`);
}

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.getSuppliers.mockResolvedValue(SUPPLIERS);
  api.getSftpSettings.mockResolvedValue(SFTP);
  api.getS3Settings.mockResolvedValue(S3);
});
afterEach(cleanup);

const PANELS: Panel[] = ["sftp", "s3"];

describe.each(PANELS)("%s panel — a failed billing lookup is not a statement about anyone's plan", (panel) => {
  it("never asserts the workspace's plan lacks the channel when billing simply failed", async () => {
    api.getBillingStatus.mockRejectedValue(new Error("billing/status: 503"));
    await renderPanel(panel);

    const notice = gate(panel);
    expect(notice, "a notice is still owed — enabling may genuinely be refused").not.toBeNull();
    const said = notice!.textContent ?? "";

    expect(said, "the flat-fact sentence is the defect").not.toMatch(
      /your current plan doesn.t include it/i,
    );
    expect(said, "must not name a tier as the one this workspace is on").not.toMatch(
      /\b(Pilot|Growth|Operations|Integration|Distributor|Enterprise) plan doesn.t include/i,
    );
    // What it must say instead: we do not know, and the backend is the authority.
    expect(said).toMatch(/couldn.t check which plan this workspace is on/i);
    expect(said).toMatch(/will be refused/i);
    expect(notice!.querySelector('a[href="/settings?tab=billing"]')).not.toBeNull();
  });

  it("leaves the toggle usable, because only the server may take it away", async () => {
    api.getBillingStatus.mockRejectedValue(new Error("billing/status: 503"));
    await renderPanel(panel);

    expect(
      toggle(panel).disabled,
      "a paying workspace must not lose the switch to one failed status request",
    ).toBe(false);
  });
});

describe.each(PANELS)("%s panel — a server that DID name a plan is quoted, not guessed", (panel) => {
  it("names the tier the server sent and the tier that unlocks the channel", async () => {
    api.getBillingStatus.mockResolvedValue(billing({ plan: "pilot", supplierLimit: 1, orderLimit: 20 }));
    await renderPanel(panel);

    const said = gate(panel)?.textContent ?? "";
    const unlock = PLAN_BY_ID[minimumPlanId(panel === "sftp" ? "sftpIngestion" : "s3Ingestion")];

    expect(said).toContain(`the ${PLAN_BY_ID.pilot.name} plan doesn’t include it`);
    expect(said).toContain(`Upgrade to ${unlock.name} (${unlock.billingPriceLabel})`);
    // ANTI-VACUITY: the "unknown" sentence must NOT also be on screen here. Without this the
    // two arms could both render and every assertion in this file would pass on a component
    // that had simply stopped branching.
    expect(said).not.toMatch(/couldn.t check which plan/i);
  });

  it("disables the toggle only on a plan the server actually named", async () => {
    api.getBillingStatus.mockResolvedValue(billing({ plan: "pilot" }));
    await renderPanel(panel);
    expect(toggle(panel).disabled, "Pilot really is refused — this arm must still bite").toBe(true);
  });

  it("says nothing at all to a paid workspace, and leaves its toggle alone", async () => {
    api.getBillingStatus.mockResolvedValue(billing({ plan: "distributor" }));
    await renderPanel(panel);

    expect(gate(panel), "no gate notice is owed to a €1,499/mo workspace").toBeNull();
    expect(toggle(panel).disabled).toBe(false);
  });

  it("flashes neither sentence while the plan is still being fetched", async () => {
    // Never settles: the loading state, told apart from the failure state above by
    // query state alone. Before the fix this rendered the flat-fact sentence too.
    api.getBillingStatus.mockReturnValue(new Promise<BillingStatus>(() => {}));
    await renderPanel(panel);

    expect(gate(panel), "neither arm is known to be true yet").toBeNull();
  });
});

describe.each(PANELS)("%s panel — a save failure is a sentence, not a status line", (panel) => {
  it("never shows the client-built `settings/<x>: <status>` label to a customer", async () => {
    api.getBillingStatus.mockResolvedValue(billing());
    await renderPanel(panel);

    // Exactly what api/settings.ts throws when a 500 body carries no `error` field:
    // readRefusal(res, `settings/sftp: ${res.status}`).
    const raw = panel === "sftp" ? "settings/sftp: 500" : "settings/s3: 500";
    const update = panel === "sftp" ? api.updateSftpSettings : api.updateS3Settings;
    update.mockRejectedValue(new Error(raw));

    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    const notice = await screen.findByRole("status");
    expect(notice.textContent).not.toContain(raw);
    expect(notice.textContent).not.toMatch(/\b500\b/);
    expect(notice.textContent).not.toMatch(/settings\//);
    expect(notice.textContent).toMatch(/Could not save these settings/i);
  });

  it("still forwards the sentences it is meant to — the arm is not a blanket swallow", async () => {
    // ANTI-VACUITY for the test above: if humanizeError had simply been replaced with a
    // constant, this would fail. A plan-gate code must still produce the server's tier.
    api.getBillingStatus.mockResolvedValue(billing());
    await renderPanel(panel);

    const update = panel === "sftp" ? api.updateSftpSettings : api.updateS3Settings;
    update.mockRejectedValue(new Error("sftp_ingestion_requires_growth"));

    fireEvent.click(screen.getByRole("button", { name: /Save/ }));

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(/Automated pull ingestion is not available on your plan/i);
    expect(notice.textContent).toMatch(/Growth/);
    expect(notice.textContent).not.toContain("sftp_ingestion_requires_growth");
  });

  it("keeps its own client-side validation copy, which IS prose someone wrote", async () => {
    // The other anti-vacuity direction: the inline checks must survive untouched.
    api.getBillingStatus.mockResolvedValue(billing());
    const view = await renderPanel(panel);

    fireEvent.click(toggle(panel));
    fireEvent.click(within(view.container).getByRole("button", { name: /Save/ }));

    const notice = await screen.findByRole("status");
    expect(notice.textContent).toMatch(
      panel === "sftp" ? /Enter the SFTP host before enabling\./ : /Enter a bucket name before enabling\./,
    );
    await waitFor(() => expect((panel === "sftp" ? api.updateSftpSettings : api.updateS3Settings)).not.toHaveBeenCalled());
  });
});
