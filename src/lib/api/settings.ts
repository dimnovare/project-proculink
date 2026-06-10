/**
 * settings.ts — Organisation and ingress settings: email (IMAP), SFTP, S3,
 * and org-level direction. Extracted from api-client.ts (behavior-preserving move).
 *
 * All exports from this module are re-exported from @/lib/api-client so
 * existing imports stay unchanged.
 */

import type {
  EmailSettings,
  UpdateEmailSettingsPayload,
  OrgSettings,
  OrderDirection,
} from "@/types/procurement";
import { API_BASE_URL, USE_MOCK, authHeader, fetchWithTimeout } from "./core";

// ── Email polling settings ────────────────────────────────────────────────

export async function getEmailSettings(): Promise<EmailSettings> {
  if (USE_MOCK) {
    return {
      enabled: false,
      host: "",
      port: 993,
      useSsl: true,
      username: "",
      folder: "INBOX",
      defaultSupplierId: null,
      hasPassword: false,
      passwordDisplay: null,
      lastPolledAt: null,
      updatedAt: null,
    };
  }

  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/email`, { headers });
  if (!res.ok) throw new Error(`settings/email: ${res.status}`);
  return res.json();
}

export async function updateEmailSettings(payload: UpdateEmailSettingsPayload): Promise<EmailSettings> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/email`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }, 30000);

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `settings/email: ${res.status}`);
  }

  return res.json();
}

// ── Organisation settings (order direction) ───────────────────────────────

/** Lowercase whatever the API returns ("Outbound"/"Inbound") to our internal union. */
function normalizeDirection(raw: unknown): OrderDirection {
  return String(raw ?? "Outbound").toLowerCase() === "inbound" ? "inbound" : "outbound";
}

/** PascalCase for the wire ("inbound" -> "Inbound"). */
function toApiDirection(direction: OrderDirection): "Outbound" | "Inbound" {
  return direction === "inbound" ? "Inbound" : "Outbound";
}

export async function getOrgSettings(): Promise<OrgSettings> {
  if (USE_MOCK) {
    return { direction: "outbound", slug: "demo-workspace" };
  }

  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/organisation`, { headers });
  if (!res.ok) throw new Error(`settings/organisation: ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const raw = body as { direction?: unknown; slug?: unknown };
  const slug = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : undefined;
  return { direction: normalizeDirection(raw.direction), slug };
}

export async function updateOrgSettings(direction: OrderDirection): Promise<OrgSettings> {
  if (USE_MOCK) {
    return { direction };
  }

  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/organisation`, {
    method: "PUT",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ direction: toApiDirection(direction) }),
  }, 30000);

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `settings/organisation: ${res.status}`);
  }

  const body = await res.json().catch(() => ({}));
  const raw = body as { direction?: unknown; slug?: unknown };
  const slug = typeof raw.slug === "string" && raw.slug.trim() ? raw.slug.trim() : undefined;
  return { direction: normalizeDirection(raw.direction), slug };
}

// ── SFTP / S3 pull-ingress settings ───────────────────────────────────────

export interface SftpIngressSettings {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  remoteDirectory: string;
  defaultSupplierId: string | null;
  hasPassword: boolean;
  passwordDisplay: string | null;
  updatedAt: string | null;
}

export interface UpdateSftpIngressPayload {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  password?: string | null;
  remoteDirectory: string;
  defaultSupplierId: string | null;
}

export interface S3IngressSettings {
  enabled: boolean;
  bucketName: string;
  keyPrefix: string;
  region: string;
  accessKeyId: string;
  defaultSupplierId: string | null;
  hasSecretKey: boolean;
  secretKeyDisplay: string | null;
  updatedAt: string | null;
  serviceUrl: string | null;
}

export interface UpdateS3IngressPayload {
  enabled: boolean;
  bucketName: string;
  keyPrefix: string;
  region: string;
  accessKeyId: string;
  secretKey?: string | null;
  defaultSupplierId: string | null;
  serviceUrl?: string | null;
}

export async function getSftpSettings(): Promise<SftpIngressSettings> {
  if (USE_MOCK) return { enabled: false, host: "", port: 22, username: "", remoteDirectory: "", defaultSupplierId: null, hasPassword: false, passwordDisplay: null, updatedAt: null };
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/sftp`, { headers });
  if (!res.ok) throw new Error(`settings/sftp: ${res.status}`);
  return res.json();
}

export async function updateSftpSettings(payload: UpdateSftpIngressPayload): Promise<SftpIngressSettings> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/sftp`, {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `settings/sftp: ${res.status}`); }
  return res.json();
}

export async function getS3Settings(): Promise<S3IngressSettings> {
  if (USE_MOCK) return { enabled: false, bucketName: "", keyPrefix: "", region: "", accessKeyId: "", defaultSupplierId: null, hasSecretKey: false, secretKeyDisplay: null, updatedAt: null, serviceUrl: null };
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/s3`, { headers });
  if (!res.ok) throw new Error(`settings/s3: ${res.status}`);
  return res.json();
}

export async function updateS3Settings(payload: UpdateS3IngressPayload): Promise<S3IngressSettings> {
  const headers = await authHeader();
  const res = await fetchWithTimeout(`${API_BASE_URL}/api/settings/s3`, {
    method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(payload),
  }, 30000);
  if (!res.ok) { const b = await res.json().catch(() => null); throw new Error(b?.error ?? `settings/s3: ${res.status}`); }
  return res.json();
}
