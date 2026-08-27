/**
 * billing.ts — Stripe billing, plan status, checkout, portal, and org limit
 * overrides. Extracted from api-client.ts (behavior-preserving move).
 *
 * All exports from this module are re-exported from @/lib/api-client so
 * existing imports stay unchanged.
 */

import type { BillingStatus, SetOrgLimitsRequest, OrgLimitsResponse } from "@/types/procurement";
import {
  API_BASE_URL,
  USE_MOCK,
  authHeader,
  fetchWithTimeout,
  delay,
  ApiHttpError,
} from "./core";
import { readRefusal } from "./refusal";

// ── Admin access error (re-exported via api-client) ──────────────────────────

/** Thrown when an /api/admin call is refused — 401 (signed out) or 403 (not an admin). */
export class AdminAccessError extends Error {
  status: 401 | 403;
  constructor(status: 401 | 403) {
    super(status === 401 ? "Not authenticated" : "Not authorized for the admin area");
    this.name = "AdminAccessError";
    this.status = status;
  }
}

/** Read an /api/admin error body and re-throw as AdminAccessError (401/403) or a message-bearing Error. */
async function adminError(res: Response, label: string): Promise<never> {
  if (res.status === 401 || res.status === 403) {
    throw new AdminAccessError(res.status);
  }
  const body = await res.json().catch(() => null);
  const message =
    body && typeof body === "object" && "error" in body
      ? String((body as { error?: unknown }).error)
      : res.statusText;
  throw new ApiHttpError(`${label}: ${message || res.status}`, res.status, body);
}

// ── Billing ────────────────────────────────────────────────────────────────

export async function getBillingStatus(): Promise<BillingStatus> {
  if (USE_MOCK) {
    return {
      plan:                   "pilot",
      accountStatus:          "trialing",
      ordersThisMonth:        5,
      orderLimit:             20,
      suppliersUsed:          1,
      supplierLimit:          1,
      trialStartedAt:         new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      trialEndsAt:            new Date(Date.now() + 9 * 24 * 60 * 60 * 1000).toISOString(),
      isTrialExpired:         false,
      isOrderLimitReached:    false,
      isSupplierLimitReached: true,
      canProcessOrders:       true,
      canAddSupplier:         false,
      stripeCustomerId:       null,
      stripeSubscriptionId:   null,
      overageOrders:          0,
      overageAmountEur:       0,
      nearLimit:              false,
      atLimit:                false,
      billingInterval:        null, // Pilot has no Stripe subscription
    };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/billing/status`, { headers });
  if (!res.ok) throw new Error(`billing/status: ${res.status}`);
  return res.json();
}

export async function createCheckoutSession(
  plan: string,
  billingInterval: "monthly" | "yearly" = "monthly",
): Promise<string> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/billing/checkout`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ plan, billingInterval }),
  }, 30000);
  // Committing the organisation to a recurring charge is org-admin-gated, so a member who is
  // not an administrator lands here. `billing/checkout: 403` was not copy — it was a status
  // line — and the checkout buttons render this message verbatim.
  if (!res.ok) throw await readRefusal(res, `billing/checkout: ${res.status}`);
  const data = await res.json();
  return data.url as string;
}

export async function createPortalSession(): Promise<string> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/billing/portal`, {
    method: "POST",
    headers,
  }, 30000);
  // The Stripe Billing Portal is where a subscription is CANCELLED, which stops every ingest
  // path at once — the single most destructive action in the product, and now org-admin-gated.
  // This threw a bare `billing/portal: 403` with no copy at all, and the response body was
  // never read, so nothing downstream could tell a role refusal from any other failure.
  if (!res.ok) throw await readRefusal(res, `billing/portal: ${res.status}`);
  const data = await res.json();
  return data.url as string;
}

// ── Admin interfaces (exported for consumers that import from api-client) ─────

export interface AdminOverview {
  mrr: number;
  arr: number;
  stripeMrr: number | null;
  reconciled: boolean;
  countsByAccountStatus: Record<string, number>;
  newOrgsThisMonth: number;
  trialToPaidConversion: number;
}

export interface AdminOrganisation {
  id: string;
  name: string;
  slug: string;
  plan: string;
  accountStatus: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  mrrContribution: number;
  createdAt: string;
  lastOrderActivity: string | null;
  orderVolume30d: number;
  supplierCount: number;
}

export interface CreateAdminInvoiceLineItem {
  description: string;
  amountCents: number;
  quantity?: number;
}

export interface CreateAdminInvoiceRequest {
  organisationId: string;
  lineItems: CreateAdminInvoiceLineItem[];
  currency?: string;
}

export interface CreateAdminInvoiceResult {
  invoiceId: string;
  hostedInvoiceUrl: string | null;
  status: string;
}

/**
 * Admin-console fixtures for mock mode.
 *
 * `checkAdminAccess` has answered `if (USE_MOCK) return true` since it was
 * written — mock mode says "you are an admin" — while every admin READ below it
 * went straight to the network. So `/admin` granted itself access and then had
 * nothing to render: measured by the three-viewport control sweep on 2026-08-26,
 * which recorded `ERR_CONNECTION_REFUSED` on that route with no API running.
 * Mock mode is this repo's documented offline QA path, so a route that ignores
 * it cannot be QA'd, demoed, or screenshotted.
 *
 * READS ONLY, and that is the whole rule. The mutations in this file —
 * createCheckoutSession, createPortalSession, createAdminInvoice, setOrgLimits,
 * updateEmailSettings — deliberately keep no mock branch. A mocked mutation
 * reports success for something that did not happen, which is the exact class of
 * lie this codebase keeps removing (see the Group J2 fabricated-data purge in
 * CLAUDE.md). Offline, they fail loudly, which is the honest answer.
 *
 * The numbers below are obviously synthetic — an org literally named "Example
 * Workspace" — for the same reason `DEMO_MOCK` is named that: nobody should be
 * able to mistake a fixture for a customer.
 */
const MOCK_ADMIN = {
  overview: {
    mrr: 1_497,
    arr: 17_964,
    stripeMrr: 1_497,
    reconciled: true,
    countsByAccountStatus: { active: 6, trialing: 3, past_due: 1 },
    newOrgsThisMonth: 3,
    trialToPaidConversion: 0.42,
  } satisfies AdminOverview,

  organisations: [
    {
      id: "org_example_1",
      name: "Example Workspace",
      slug: "example-workspace",
      plan: "growth",
      accountStatus: "active",
      stripeCustomerId: "cus_example",
      stripeSubscriptionId: "sub_example",
      mrrContribution: 149,
      createdAt: "2026-06-01T09:00:00Z",
      lastOrderActivity: "2026-08-25T14:11:00Z",
      orderVolume30d: 84,
      supplierCount: 3,
    },
    {
      id: "org_example_2",
      name: "Second Example Workspace",
      slug: "second-example-workspace",
      plan: "pilot",
      accountStatus: "trialing",
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      mrrContribution: 0,
      createdAt: "2026-08-20T11:30:00Z",
      lastOrderActivity: null,
      orderVolume30d: 4,
      supplierCount: 1,
    },
  ] as AdminOrganisation[],

  jobFailures: {
    // Non-zero on purpose. A zero here would render the one state the type's own
    // caveat says is ambiguous — "no failures" and "the job store was
    // unreachable" are indistinguishable — so the fixture would be showing the
    // reader the least informative screen the panel has.
    totalFailed: 2,
    shown: 2,
    failures: [
      {
        id: "job-example-1",
        job: "ParseOrderJob",
        exceptionType: "System.TimeoutException",
        exceptionMessage: "The operation has timed out.",
        reason: "Exceeded retry attempts",
        failedAt: "2026-08-26T08:14:22Z",
      },
      {
        id: "job-example-2",
        job: "DeliverOrderJob",
        exceptionType: null,
        exceptionMessage: null,
        reason: null,
        failedAt: null,
      },
    ],
  } satisfies AdminJobFailures,

  itemMappingTwins: {
    totalGroups: 1,
    note: "Read-only. Codes differing only in case are shown so they can be reconciled by hand.",
    groups: [
      {
        organisationId: "org_example_1",
        supplierId: "s1",
        foldedCode: "hx-4410",
        rowCount: 2,
        spellings: ["HX-4410", "hx-4410"],
      },
    ],
  } satisfies AdminItemMappingTwins,
} as const;

export async function getAdminOverview(): Promise<AdminOverview> {
  if (USE_MOCK) return MOCK_ADMIN.overview;
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/overview`, { headers });
  if (!res.ok) return adminError(res, "admin/overview");
  return res.json() as Promise<AdminOverview>;
}

export async function getAdminOrganisations(): Promise<AdminOrganisation[]> {
  if (USE_MOCK) return [...MOCK_ADMIN.organisations];
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/organisations`, { headers });
  if (!res.ok) return adminError(res, "admin/organisations");
  return res.json() as Promise<AdminOrganisation[]>;
}

export async function checkAdminAccess(): Promise<boolean> {
  if (USE_MOCK) return true;
  try {
    const headers = await authHeader();
    const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/access`, { headers });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createAdminInvoice(
  req: CreateAdminInvoiceRequest,
): Promise<CreateAdminInvoiceResult> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/invoices`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(req),
  }, 30000);
  if (!res.ok) return adminError(res, "admin/invoices");
  return res.json() as Promise<CreateAdminInvoiceResult>;
}

/**
 * Adjust a single org's effective limits / pilot window.
 * POST /api/admin/organisations/{id}/limits
 */
export async function setOrgLimits(
  orgId: string,
  body: SetOrgLimitsRequest,
): Promise<OrgLimitsResponse> {
  if (USE_MOCK) {
    await delay(400);
    const now = Date.now();
    const trialEnd = body.clearTrialEnds
      ? null
      : body.trialEndsAtOverride
        ? body.trialEndsAtOverride
        : body.extendTrialDays != null
          ? new Date(now + body.extendTrialDays * 86_400_000).toISOString()
          : null;
    return {
      id: orgId,
      name: "Mock organisation",
      plan: "pilot",
      accountStatus: "trialing",
      orderLimitOverride: body.clearOrderLimit ? null : body.orderLimitOverride ?? null,
      supplierLimitOverride: body.clearSupplierLimit ? null : body.supplierLimitOverride ?? null,
      trialEndsAtOverride: trialEnd,
      effectiveOrderLimit: body.clearOrderLimit ? 20 : body.orderLimitOverride ?? 20,
      effectiveSupplierLimit: body.clearSupplierLimit ? 1 : body.supplierLimitOverride ?? 1,
      effectiveTrialEndsAt: trialEnd,
    };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/organisations/${orgId}/limits`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, 30000);
  if (!res.ok) return adminError(res, "admin/organisations/limits");
  return res.json() as Promise<OrgLimitsResponse>;
}

// ── Admin: the endpoints that had no caller ──────────────────────────────────
//
// AdminController exposes eleven actions; until now this module reached four of
// them (overview, organisations, invoices, limits) and every other one was
// reachable only from a terminal. The five below are the reversible or read-only
// half, and they are what /admin now calls.
//
// The two that are deliberately still absent are the erasure pair —
// `DELETE .../orders/{id}` and `POST .../orders/bulk-erase`. They hard-delete a
// customer's data and cannot be undone, so the friction of running them by hand
// IS the control. They are documented instead, in the admin runbook at
// /admin/guides/erase-order-data. Do not add wrappers for them here.

/** One order matched by the support PO-number lookup, with the org that owns it. */
export interface AdminOrderFindMatch {
  orgId: string;
  orgName: string;
  orgSlug: string;
  orderId: string;
  status: string;
  supplierName: string | null;
  poNumber: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * GET /api/admin/orders/find. `capped` is true when MORE orders matched than the
 * bounded response carries (the server takes one row over its cap so it can say
 * so honestly) — surface it, never round it down to "these are all of them".
 */
export interface AdminOrderFindResult {
  count: number;
  capped: boolean;
  matches: AdminOrderFindMatch[];
}

/** One recent Hangfire failure. Every field but `id` and `job` can be absent. */
export interface AdminJobFailure {
  id: string;
  job: string;
  exceptionType: string | null;
  exceptionMessage: string | null;
  reason: string | null;
  failedAt: string | null;
}

/**
 * GET /api/admin/job-failures.
 *
 * READ THE CAVEAT BEFORE RENDERING THIS. The backend catches an unavailable
 * Hangfire monitoring API and answers 200 with `{ totalFailed: 0, shown: 0,
 * failures: [] }` rather than a 500. An empty list is therefore NOT evidence the
 * worker is healthy — it is either "no failures" or "the job store could not be
 * reached", and this response cannot tell them apart. Any UI must say so.
 */
export interface AdminJobFailures {
  totalFailed: number;
  shown: number;
  failures: AdminJobFailure[];
}

/** One group of learned item mappings whose buyer codes differ only in case. */
export interface AdminItemMappingTwinGroup {
  organisationId: string;
  supplierId: string;
  foldedCode: string;
  rowCount: number;
  spellings: string[];
}

/** GET /api/admin/item-mapping-twins. `note` is the server's own read-only caveat. */
export interface AdminItemMappingTwins {
  totalGroups: number;
  note: string;
  groups: AdminItemMappingTwinGroup[];
}

/**
 * POST /api/admin/organisations/{id}/account-status.
 *
 * `accountStatus` is the EFFECTIVE status the database holds after the canonical
 * trial-window arbiter has run, which is not necessarily the one that was asked
 * for: when the org's Pilot window has already elapsed the arbiter re-freezes it
 * on the spot and `revertedByTrialWindow` is true. Treating a 200 here as
 * "un-frozen" is the mistake that field exists to prevent.
 */
export interface OrgAccountStatusResult {
  id: string;
  name: string;
  plan: string;
  previousAccountStatus: string;
  requestedAccountStatus: string;
  accountStatus: string;
  revertedByTrialWindow: boolean;
  effectiveTrialEndsAt: string | null;
  note: string | null;
}

/** POST /api/admin/organisations/{id}/retention — body. `clear` wins over days. */
export interface SetOrgRetentionRequest {
  retentionDays?: number;
  clear?: boolean;
}

/** POST /api/admin/organisations/{id}/retention — response. */
export interface OrgRetentionResult {
  id: string;
  name: string;
  retentionDays: number | null;
  retentionEnabled: boolean;
}

/**
 * Support triage: which organisation owns the PO number a customer quoted?
 *
 * The server refuses a blank query with 400, so callers must not send one; the
 * guard here keeps that refusal off the network entirely.
 */
export async function findAdminOrdersByPo(po: string): Promise<AdminOrderFindResult> {
  if (USE_MOCK) {
    // A lookup that finds nothing is the panel's other real state, so the
    // fixture answers on the search term rather than always returning a hit.
    const hit = po.trim().toUpperCase() === "PO-DEMO-001";
    return {
      count: hit ? 1 : 0,
      capped: false,
      matches: hit
        ? [{
            orgId: "org_example_1",
            orgName: "Example Workspace",
            orgSlug: "example-workspace",
            orderId: "ord-002",
            status: "review",
            supplierName: "Example Supplier",
            poNumber: "PO-DEMO-001",
            createdAt: "2026-08-25T13:02:00Z",
            updatedAt: "2026-08-25T14:11:00Z",
          }]
        : [],
    };
  }
  const trimmed = po.trim();
  if (!trimmed) {
    throw new Error("Enter the PO number the customer quoted.");
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/admin/orders/find?po=${encodeURIComponent(trimmed)}`,
    { headers },
  );
  if (!res.ok) return adminError(res, "admin/orders/find");
  return res.json() as Promise<AdminOrderFindResult>;
}

/** Recent Hangfire job failures. The server clamps `count` to 1..200. */
export async function getAdminJobFailures(count = 50): Promise<AdminJobFailures> {
  if (USE_MOCK) return MOCK_ADMIN.jobFailures;
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/admin/job-failures?count=${encodeURIComponent(String(count))}`,
    { headers },
  );
  if (!res.ok) return adminError(res, "admin/job-failures");
  return res.json() as Promise<AdminJobFailures>;
}

/** Learned item mappings whose buyer codes differ only in case. Read-only. */
export async function getAdminItemMappingTwins(): Promise<AdminItemMappingTwins> {
  if (USE_MOCK) return MOCK_ADMIN.itemMappingTwins;
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/item-mapping-twins`, { headers });
  if (!res.ok) return adminError(res, "admin/item-mapping-twins");
  return res.json() as Promise<AdminItemMappingTwins>;
}

/**
 * Move an organisation's account status by hand.
 *
 * The parameter is typed `"trialing"` rather than `string` on purpose: the server
 * permits EXACTLY ONE transition (`read_only` to `trialing`, on a Pilot org with
 * no live Stripe subscription) and answers 400 to every other value, because every
 * other status is derived from Stripe or from the trial window and a hand-written
 * one would be overwritten by the next reconcile.
 */
export async function setOrgAccountStatus(
  orgId: string,
  accountStatus: "trialing",
): Promise<OrgAccountStatusResult> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/admin/organisations/${orgId}/account-status`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ accountStatus }),
    },
    30000,
  );
  if (!res.ok) return adminError(res, "admin/organisations/account-status");
  return res.json() as Promise<OrgAccountStatusResult>;
}

/**
 * Set or clear an organisation's blob-retention window.
 *
 * CONSEQUENTIAL. A window opts the org into the daily sweep that permanently
 * deletes the stored source files and generated output of TERMINAL orders older
 * than the window. Order records, hashes, provenance and the audit trail are not
 * touched. `clear: true` disables it, which is the default state — no org is
 * swept until someone opts it in.
 */
export async function setOrgRetention(
  orgId: string,
  body: SetOrgRetentionRequest,
): Promise<OrgRetentionResult> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api/admin/organisations/${orgId}/retention`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    30000,
  );
  if (!res.ok) return adminError(res, "admin/organisations/retention");
  return res.json() as Promise<OrgRetentionResult>;
}
