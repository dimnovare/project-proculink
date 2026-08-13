/**
 * inboundEmail.ts — the email addresses buyers send purchase orders to.
 *
 * These are not display strings. Each address IS the credential that authorises delivery into one
 * organisation (`ProcuLink.Core/Entities/OrgInboundAddress.cs`): the mail relay carries no other
 * per-tenant proof, so presenting the address is what names the tenant. That is why the list is
 * server-issued rather than derived on the client — the address the settings page used to show was
 * built here in the browser as `${slug}@orders.proculink.eu`, which could not reflect a rotation, a
 * revocation, or an expiry, because it never asked.
 *
 * Two kinds arrive (`InboundAddressKind` in the backend):
 *   primary      a minted, high-entropy address. No expiry.
 *   legacy_slug  the organisation's old public slug, backfilled with a hard expiry so mail already
 *                in a buyer's address book keeps arriving across the cutover, then stops.
 *
 * `address` is NULLABLE and that is meaningful, not an error: the row's ciphertext could not be
 * opened, so the address cannot be shown — but it may still be accepting mail, and an operator who
 * cannot see it must still be able to revoke it. Never render a null address as "none" or as blank.
 *
 * Conventions follow delivery.ts: module-local `apiFetch` over the shared core primitives.
 *
 * THE PATHS ARE BACKTICKED ON PURPOSE, even the two with nothing to interpolate.
 * `src/test/endpoint-reachability.test.ts` sweeps this directory and reads bare path fragments with
 * `BARE_FRAGMENT_RE`, which matches template literals ONLY. Written as "…" instead, a path is
 * invisible to the sweep and its endpoint is reported as having no caller — which is exactly what
 * happened to the rotate path first time round. Do not "tidy" these into ordinary strings.
 */

import { API_BASE_URL, authHeader, fetchWithTimeout } from "./core";
import { readRefusal } from "./refusal";

/** Mirrors `ProcuLink.Core/Constants/InboundAddressKind`. Persisted values — never retyped. */
export const INBOUND_KIND_PRIMARY = "primary";
export const INBOUND_KIND_LEGACY_SLUG = "legacy_slug";

/** One address, as the owning organisation sees it. Mirrors `InboundAddressDto`. */
export interface InboundAddress {
  id: string;
  /** `primary` | `legacy_slug`. Kept as a plain string: an unrecognised kind must not be coerced. */
  kind: string;
  label: string;
  /** The full mailbox. NULL when the stored ciphertext could not be opened — see the file header. */
  address: string | null;
  /** A fragment of the token, enough to tell two rows apart and never enough to rebuild one. */
  prefix: string;
  isActive: boolean;
  createdAt: string;
  /** When set, the address stops resolving at this instant. */
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
}

interface InboundAddressListResponse {
  addresses: InboundAddress[];
}

/**
 * Shared request shape. Failures go through `readRefusal`, which is what turns the backend's
 * `requires_org_admin` 403 into the one sentence the product uses for that refusal — rotate and
 * revoke are both `[RequireOrgAdmin]`, so this is the common case, not an edge.
 *
 * The fallback message deliberately carries only the status. An inbound address is a credential
 * and must never reach an error string, a log line, or a Sentry breadcrumb.
 */
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...auth, ...init?.headers },
  });
  if (!res.ok) throw await readRefusal(res, `inbound-email: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * The organisation's addresses, newest first. Open to every member — the backend gates only the
 * two mutations, because a member can already ingest by uploading, so showing them the address
 * grants nothing new and withholding it blocks the person who actually talks to the supplier.
 */
export async function getInboundAddresses(): Promise<InboundAddress[]> {
  const body = await apiFetch<InboundAddressListResponse>(`/settings/inbound-email`);
  return body.addresses ?? [];
}

/**
 * Mints a NEW primary address and returns the full updated list.
 *
 * The previous primary keeps working until it is explicitly revoked — the backend does not retire
 * it (`SettingsController.RotateInboundAddress`). Any copy describing this must say so, because an
 * operator who believes rotation is a cutover will stop watching an address that is still live.
 */
export async function rotateInboundAddress(): Promise<InboundAddress[]> {
  const body = await apiFetch<InboundAddressListResponse>(`/settings/inbound-email/rotate`, {
    method: "POST",
  });
  return body.addresses ?? [];
}

/** Revokes one address and returns the full updated list. Takes effect on the next message. */
export async function revokeInboundAddress(id: string): Promise<InboundAddress[]> {
  const body = await apiFetch<InboundAddressListResponse>(`/settings/inbound-email/${id}/revoke`, {
    method: "POST",
  });
  return body.addresses ?? [];
}

// ── Derived state ───────────────────────────────────────────────────────────
// Pure, so the rules that decide whether an address is still accepting mail can be tested without
// rendering anything.

export type InboundAddressState = "active" | "expired" | "revoked";

/**
 * Whether this address still accepts mail, and if not, why.
 *
 * Mirrors the backend resolve predicate, which requires active AND unrevoked AND unexpired. The
 * order matters for the label only: a revoked address that would also have expired reads as
 * revoked, because that is the thing a person did.
 */
export function inboundAddressState(
  address: Pick<InboundAddress, "isActive" | "expiresAt" | "revokedAt">,
  now: Date = new Date(),
): InboundAddressState {
  if (!address.isActive || address.revokedAt) return "revoked";
  if (address.expiresAt && new Date(address.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

/**
 * Whole days from `now` until `iso`, rounded up; negative once past. `null` for an unparseable
 * date, so a caller renders nothing rather than "NaN days".
 */
export function daysUntil(iso: string, now: Date = new Date()): number | null {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return null;
  return Math.ceil((target - now.getTime()) / 86_400_000);
}

/**
 * True for an address that carries a hard stop.
 *
 * Keyed on `expiresAt` rather than on `kind === "legacy_slug"` on purpose. The consequence being
 * warned about — mail to this address stops arriving on a date — follows from the expiry itself, so
 * a kind this build has never heard of still gets the warning. Matching the kind instead would let
 * a future expiring kind render as permanent, which is the failure this screen exists to prevent.
 */
export function hasExpiry(address: Pick<InboundAddress, "expiresAt">): boolean {
  return !!address.expiresAt;
}
