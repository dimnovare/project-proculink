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

export type CatalogSourceProtocol = "sftp" | "ftp" | "ftps" | "http" | "https" | "logicom";
export type CatalogSyncStatus = "running" | "ok" | "unchanged" | "failed";

/** Canonical catalog fields a per-source column mapping may target (matches the backend). */
export const CATALOG_CANONICAL_FIELDS = [
  "code",
  "name",
  "unit",
  "price",
  "currency",
  "barcode",
  "external_id",
] as const;
export type CatalogCanonicalField = (typeof CATALOG_CANONICAL_FIELDS)[number];

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
  // http/https/logicom only — null for sftp/ftp. Secrets NEVER returned; only presence.
  url: string | null;
  authMethod: CatalogHttpAuthMethod | null;
  hasAuthConfig: boolean;
  httpMethod: string | null; // "GET" for v2 http sources
  // Per-source column mapping — NOT a secret; echoed back. {sourceColumn: canonicalField}
  // plus the "__noheader__"/"__encoding__" directives. null when none configured.
  columnMapping: Record<string, string> | null;
}

/**
 * Write-only Logicom QuickConnect vendor credentials (protocol "logicom"). Logicom's 2FA AES
 * auth bypasses the generic http auth path via the backend vendor-fetcher seam. Same keep/set
 * semantics as authConfig: the whole object null = keep stored, present = re-encrypt.
 */
export interface CatalogVendorConfig {
  customerId?: string;
  consumerKey?: string;
  consumerSecret?: string;
  accessTokenKey?: string;
  currency?: string;
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
  // http/https/logicom only (null/ignored for sftp/ftp):
  url?: string | null;
  authMethod?: CatalogHttpAuthMethod | null;
  authConfig?: CatalogHttpAuthConfig | null;
  httpMethod?: string | null;
  // Per-source column mapping — null = keep stored, {} = clear, value = set. Not a secret.
  columnMapping?: Record<string, string> | null;
  // Logicom vendor credentials — write-only, same keep/set semantics as authConfig.
  vendorConfig?: CatalogVendorConfig | null;
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

/**
 * One parsed catalog sample row (the backend CatalogSampleRow shape). The test-fetch response
 * serializes MappedFields as a dictionary {theirColumn: canonicalField} and SampleRows as these
 * canonical objects — NOT arbitrary column dictionaries, so the preview table renders the fixed
 * canonical columns (fixes the pre-existing blank-cells bug, plan 2026-07-02 7.4).
 */
export interface CatalogSampleRow {
  code: string;
  name: string | null;
  unit: string | null;
  price: number | null;
  currency: string | null;
  barcode: string | null;
  externalId: string | null;
}

/** Read-only honesty probe result. */
export interface CatalogSourceTestResult {
  ok: boolean;
  error: string | null;
  fileName: string | null;
  bytes: number | null;
  detectedFormat: string | null;
  headerColumns: string[];
  // Backend serializes MappedFields as a dictionary {theirColumn: canonicalField}.
  mappedFields: Record<string, string>;
  unmappedColumns: string[];
  parsedRows: number | null;
  rowsWithCode: number | null;
  sampleRows: CatalogSampleRow[];
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
    const isVendor = payload.protocol === "logicom";
    const isUrlBased = isHttp || isVendor;
    const hasPassword =
      payload.password === null ? (prev?.hasPassword ?? false) : payload.password !== "";
    const authMethod = (payload.authMethod ?? "none") as CatalogHttpAuthMethod;
    // Mirror the backend's authConfig/vendorConfig keep/clear/set + 'none' clears.
    const hasAuthConfig = isVendor
      ? payload.vendorConfig == null
        ? (prev?.hasAuthConfig ?? false)
        : Boolean(payload.vendorConfig.customerId && payload.vendorConfig.accessTokenKey)
      : !isHttp
        ? false
        : authMethod === "none"
          ? false
          : payload.authConfig == null
            ? (prev?.hasAuthConfig ?? false)
            : true;
    // columnMapping: null = keep, present = set.
    const columnMapping = payload.columnMapping === undefined || payload.columnMapping === null
      ? (prev?.columnMapping ?? null)
      : Object.keys(payload.columnMapping).length === 0
        ? null
        : payload.columnMapping;
    const wasEnabled = prev?.isEnabled ?? false;
    const source: CatalogSource = {
      protocol: payload.protocol,
      host: isUrlBased ? "" : payload.host,
      port: isUrlBased ? 0 : payload.port,
      remotePath: isUrlBased ? "" : payload.remotePath,
      username: isUrlBased ? null : payload.username,
      hasPassword: isUrlBased ? false : hasPassword,
      fileFormat: payload.fileFormat || "auto",
      syncIntervalHours: payload.syncIntervalHours,
      isEnabled: payload.isEnabled,
      lastSyncAt: prev?.lastSyncAt ?? null,
      lastSyncStatus: prev?.lastSyncStatus ?? null,
      lastSyncError: prev?.lastSyncError ?? null,
      url: isUrlBased ? (payload.url ?? null) : null,
      authMethod: isHttp ? authMethod : null,
      hasAuthConfig,
      httpMethod: isUrlBased ? "GET" : null,
      columnMapping,
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
        mappedFields: {},
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
      mappedFields: { sku: "code", description: "name", uom: "unit", price: "price" },
      unmappedColumns: ["notes"],
      parsedRows: 3,
      rowsWithCode: 3,
      sampleRows: [
        { code: "ABC-100", name: "Widget A", unit: "EA", price: 12.5, currency: "EUR", barcode: null, externalId: null },
        { code: "ABC-200", name: "Widget B", unit: "EA", price: 9.0, currency: "EUR", barcode: null, externalId: null },
        { code: "ABC-300", name: "Widget C", unit: "BOX", price: 44.2, currency: "EUR", barcode: null, externalId: null },
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
