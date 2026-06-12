/**
 * catalogSources.ts — supplier catalog PULL-source config.
 *
 * Channels: file-server (SFTP / FTP / FTPS) and HTTP/HTTPS API pull.
 *
 * Backend: SuppliersController GET/PUT/DELETE /api/suppliers/{id}/catalog/source
 * + POST .../catalog/source/test-fetch (read-only honesty probe).
 *
 * Field names match the backend wire contract verbatim (camelCase of
 * CatalogSourceResponse / UpsertCatalogSourceRequest): remotePath,
 * syncIntervalHours, fileFormat, url, authMethod, authConfig, httpMethod.
 *
 * Conventions mirror settings.ts / delivery.ts: shared core primitives
 * (API_BASE_URL, USE_MOCK, authHeader, fetchWithTimeout, delay), write-only
 * masked secrets (null = keep, "" = clear, value = set — both `password` and
 * the per-method `authConfig` fields), and a USE_MOCK branch so the supplier
 * Catalog tab renders in dev mock mode without a backend.
 *
 * Re-exported from @/lib/api-client so existing import sites stay unchanged.
 */

import { API_BASE_URL, USE_MOCK, authHeader, fetchWithTimeout, delay } from "./core";

export type CatalogSourceProtocol = "sftp" | "ftp" | "ftps" | "http" | "https";
export type CatalogSyncStatus = "running" | "ok" | "unchanged" | "failed";

/**
 * HTTP auth methods. Only the five the backend implements — no POST, no extra
 * schemes. `oauth2_client_credentials` matches the backend discriminator verbatim.
 */
export type CatalogHttpAuthMethod =
  | "none"
  | "apikey"
  | "bearer"
  | "basic"
  | "oauth2_client_credentials";

/** Masked pull-source config as returned by GET (never carries a secret). */
export interface CatalogSource {
  protocol: CatalogSourceProtocol;
  host: string;
  port: number;
  remotePath: string;
  username: string | null;
  hasPassword: boolean;
  fileFormat: string; // auto | csv | xlsx | json
  syncIntervalHours: number;
  isEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: CatalogSyncStatus | null;
  lastSyncError: string | null;
  // http/https only — null for sftp/ftp. Secrets NEVER returned; only presence.
  url: string | null;
  authMethod: CatalogHttpAuthMethod | null;
  hasAuthConfig: boolean;
  httpMethod: string | null; // "GET" for v2 http sources
}

/**
 * Write-only HTTP auth secrets supplied on PUT. The field set used depends on
 * `authMethod`. Mirrors the backend CatalogHttpAuthConfig record exactly.
 * A missing field follows the same keep/clear/set semantics as `password`:
 * the whole object is null = keep stored, present = re-encrypt the new values.
 */
export interface CatalogHttpAuthConfig {
  apiKeyHeader?: string;
  apiKeyValue?: string;
  bearerToken?: string;
  basicUsername?: string;
  basicPassword?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  scope?: string;
}

/**
 * Upsert payload. Secret semantics (both `password` and `authConfig`):
 *   null  → keep the stored secret
 *   ""    → clear the stored secret (password); cleared values clear (authConfig)
 *   value → set a new secret
 *
 * For sftp/ftp/ftps the host/port/username/password/remotePath fields apply.
 * For http/https the url/authMethod/authConfig/httpMethod fields apply.
 */
export interface UpsertCatalogSourcePayload {
  protocol: CatalogSourceProtocol;
  host: string;
  port: number;
  remotePath: string;
  username: string | null;
  password: string | null;
  fileFormat: string;
  syncIntervalHours: number;
  isEnabled: boolean;
  // http/https only (null/ignored for sftp/ftp):
  url?: string | null;
  authMethod?: CatalogHttpAuthMethod | null;
  authConfig?: CatalogHttpAuthConfig | null;
  httpMethod?: string | null;
}

export interface UpsertCatalogSourceResult {
  source: CatalogSource;
  syncEnqueued: boolean;
}

/** A single mapped catalog column (header → canonical field). */
export interface CatalogMappedField {
  field: string;
  column: string;
}

/** Read-only honesty probe result. */
export interface CatalogSourceTestResult {
  ok: boolean;
  error: string | null;
  fileName: string | null;
  bytes: number | null;
  detectedFormat: string | null;
  headerColumns: string[];
  mappedFields: CatalogMappedField[];
  unmappedColumns: string[];
  parsedRows: number | null;
  rowsWithCode: number | null;
  sampleRows: Array<Record<string, string>>;
}

// ── Mock state (dev only) ──────────────────────────────────────────────────
const _mockSources: Record<string, CatalogSource | null> = {};

function basePath(supplierId: string): string {
  return `${API_BASE_URL}/api/suppliers/${supplierId}/catalog/source`;
}

export async function getCatalogSource(supplierId: string): Promise<CatalogSource | null> {
  if (USE_MOCK) {
    await delay(120);
    return _mockSources[supplierId] ?? null;
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(basePath(supplierId), { headers });
  if (!res.ok) throw new Error(`catalog/source: ${res.status}`);
  const body = (await res.json()) as { source: CatalogSource | null };
  return body.source ?? null;
}

export async function upsertCatalogSource(
  supplierId: string,
  payload: UpsertCatalogSourcePayload,
): Promise<UpsertCatalogSourceResult> {
  if (USE_MOCK) {
    await delay(250);
    const prev = _mockSources[supplierId] ?? null;
    const isHttp = payload.protocol === "http" || payload.protocol === "https";
    const hasPassword =
      payload.password === null ? (prev?.hasPassword ?? false) : payload.password !== "";
    const authMethod = (payload.authMethod ?? "none") as CatalogHttpAuthMethod;
    // Mirror the backend's authConfig keep/clear/set + 'none' clears.
    const hasAuthConfig = !isHttp
      ? false
      : authMethod === "none"
        ? false
        : payload.authConfig == null
          ? (prev?.hasAuthConfig ?? false)
          : true;
    const wasEnabled = prev?.isEnabled ?? false;
    const source: CatalogSource = {
      protocol: payload.protocol,
      host: isHttp ? "" : payload.host,
      port: isHttp ? 0 : payload.port,
      remotePath: isHttp ? "" : payload.remotePath,
      username: isHttp ? null : payload.username,
      hasPassword: isHttp ? false : hasPassword,
      fileFormat: payload.fileFormat || "auto",
      syncIntervalHours: payload.syncIntervalHours,
      isEnabled: payload.isEnabled,
      lastSyncAt: prev?.lastSyncAt ?? null,
      lastSyncStatus: prev?.lastSyncStatus ?? null,
      lastSyncError: prev?.lastSyncError ?? null,
      url: isHttp ? (payload.url ?? null) : null,
      authMethod: isHttp ? authMethod : null,
      hasAuthConfig,
      httpMethod: isHttp ? "GET" : null,
    };
    _mockSources[supplierId] = source;
    return { source, syncEnqueued: payload.isEnabled && !wasEnabled };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    basePath(supplierId),
    {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    30000,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `catalog/source: ${res.status}`);
  }
  return res.json();
}

export async function deleteCatalogSource(supplierId: string): Promise<{ deleted: boolean }> {
  if (USE_MOCK) {
    await delay(120);
    const existed = !!_mockSources[supplierId];
    _mockSources[supplierId] = null;
    return { deleted: existed };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(basePath(supplierId), { method: "DELETE", headers }, 30000);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `catalog/source: ${res.status}`);
  }
  return res.json();
}

export async function testFetchCatalogSource(
  supplierId: string,
): Promise<CatalogSourceTestResult> {
  if (USE_MOCK) {
    await delay(600);
    const src = _mockSources[supplierId];
    if (!src) {
      return {
        ok: false,
        error: "Save a connection first, then test it.",
        fileName: null,
        bytes: null,
        detectedFormat: null,
        headerColumns: [],
        mappedFields: [],
        unmappedColumns: [],
        parsedRows: null,
        rowsWithCode: null,
        sampleRows: [],
      };
    }
    return {
      ok: true,
      error: null,
      fileName: "catalog.csv",
      bytes: 4096,
      detectedFormat: "csv",
      headerColumns: ["sku", "description", "uom", "price", "notes"],
      mappedFields: [
        { field: "code", column: "sku" },
        { field: "name", column: "description" },
        { field: "unit", column: "uom" },
        { field: "price", column: "price" },
      ],
      unmappedColumns: ["notes"],
      parsedRows: 3,
      rowsWithCode: 3,
      sampleRows: [
        { sku: "ABC-100", description: "Widget A", uom: "EA", price: "12.50", notes: "n/a" },
        { sku: "ABC-200", description: "Widget B", uom: "EA", price: "9.00", notes: "n/a" },
        { sku: "ABC-300", description: "Widget C", uom: "BOX", price: "44.20", notes: "n/a" },
      ],
    };
  }
  const headers = await authHeader();
  const res = await fetchWithTimeout(
    `${basePath(supplierId)}/test-fetch`,
    { method: "POST", headers },
    60000,
  );
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `catalog/source/test-fetch: ${res.status}`);
  }
  return res.json();
}
