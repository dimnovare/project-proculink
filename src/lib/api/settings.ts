/**
 * settings.ts — Organisation settings: org-level direction. Extracted from api-client.ts (behavior-preserving move).
 *
 * All exports from this module are re-exported from @/lib/api-client so
 * existing imports stay unchanged.
 */

import type {
  OrgSettings,
  OrderDirection,
} from "@/types/procurement";
import { API_BASE_URL, USE_MOCK, authHeader, fetchWithTimeout, delay } from "./core";
import { readRefusal } from "./refusal";

// `PUT /api/settings/organisation` is admin-gated only when it changes the invoice destination;
// it uses `readRefusal` for the refusal.

// ── Organisation settings (order direction) ───────────────────────────────

/** Lowercase whatever the API returns ("Outbound"/"Inbound") to our internal union. */
function normalizeDirection(raw: unknown): OrderDirection {
  return String(raw ?? "Outbound").toLowerCase() === "inbound" ? "inbound" : "outbound";
}

/** PascalCase for the wire ("inbound" -> "Inbound"). */
function toApiDirection(direction: OrderDirection): "Outbound" | "Inbound" {
  return direction === "inbound" ? "Inbound" : "Outbound";
}

type OrgSettingsWire = { direction?: unknown; slug?: unknown; invoiceDestinationSupplierId?: unknown };

function orgSettingsFrom(raw: OrgSettingsWire): OrgSettings {
  const slug = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : undefined;
  // Absent stays undefined (unknown); only an explicit null means "Not set".
  const d = raw.invoiceDestinationSupplierId;
  const dest = typeof d === "string" && d ? d : d === null ? null : undefined;
  return { direction: normalizeDirection(raw.direction), slug, invoiceDestinationSupplierId: dest };
}

export async function getOrgSettings(): Promise<OrgSettings> {
  if (USE_MOCK) {
    await delay(120); // mock reads simulate latency — see getBillingStatus in api/billing.ts
    return { direction: "outbound", slug: "demo-workspace", invoiceDestinationSupplierId: null };
  }

  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/organisation`, { headers });
  if (!res.ok) throw new Error(`settings/organisation: ${res.status}`);
  const body = await res.json().catch(() => ({}));
  return orgSettingsFrom(body as OrgSettingsWire);
}

/** Partial: a field left out is unchanged server-side; an explicit `null` clears the destination. */
export interface UpdateOrgSettingsPayload {
  direction?: OrderDirection;
  invoiceDestinationSupplierId?: string | null;
}

export async function updateOrgSettings(payload: UpdateOrgSettingsPayload): Promise<OrgSettings> {
  if (USE_MOCK) {
    // A destination-only save carries no direction; do not invent one.
    return { direction: payload.direction, invoiceDestinationSupplierId: payload.invoiceDestinationSupplierId } as OrgSettings;
  }

  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/organisation`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(payload.direction !== undefined && { direction: toApiDirection(payload.direction) }),
      ...(payload.invoiceDestinationSupplierId !== undefined && { invoiceDestinationSupplierId: payload.invoiceDestinationSupplierId }),
    }),
  }, 30000);

  if (!res.ok) {
    const err = await readRefusal(res, `settings/organisation: ${res.status}`);
    if (err.message === "invoice_destination_not_found") err.message = "That supplier no longer exists. Choose another destination.";
    throw err;
  }

  const body = await res.json().catch(() => ({}));
  return orgSettingsFrom(body as OrgSettingsWire);
}
