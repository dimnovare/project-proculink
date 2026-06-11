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
  if (!res.ok) throw new Error(`billing/checkout: ${res.status}`);
  const data = await res.json();
  return data.url as string;
}

export async function createPortalSession(): Promise<string> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/billing/portal`, {
    method: "POST",
    headers,
  }, 30000);
  if (!res.ok) throw new Error(`billing/portal: ${res.status}`);
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

export async function getAdminOverview(): Promise<AdminOverview> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/admin/overview`, { headers });
  if (!res.ok) return adminError(res, "admin/overview");
  return res.json() as Promise<AdminOverview>;
}

export async function getAdminOrganisations(): Promise<AdminOrganisation[]> {
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
