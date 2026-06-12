/**
 * catalogSources.ts — supplier catalog PULL-source config (SFTP / FTP / FTPS).
 *
 * Backend: SuppliersController GET/PUT/DELETE /api/suppliers/{id}/catalog/source
 * + POST .../catalog/source/test-fetch (read-only honesty probe).
 *
 * Conventions mirror settings.ts / delivery.ts: shared core primitives
 * (API_BASE_URL, USE_MOCK, authHeader, fetchWithTimeout), masked write-only
 * password (null = keep, "" = clear, value = set), and a USE_MOCK branch so
 * the supplier Catalog tab renders in dev mock mode without a backend.
 *
 * Re-exported from @/lib/api-client so existing import sites stay unchanged.
 */

import { API_BASE_URL, USE_MOCK, authHeader, fetchWithTimeout, delay } from "./core";

export type CatalogSourceProtocol = "sftp" | "ftp" | "ftps";
export type CatalogSyncStatus = "running" | "ok" | "unchanged" | "failed";

/** Masked pull-source config as returned by GET (never carries the secret). */
export interface CatalogSource {
  protocol: CatalogSourceProtocol;
  host: string;
  port: number;
  path: string;
  username: string | null;
  hasPassword: boolean;
  schedule: number; // SyncIntervalHours
  isEnabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: CatalogSyncStatus | null;
  lastSyncError: string | null;
}

/**
 * Upsert payload. Password is write-only:
 *   null  → keep the stored secret
 *   ""    → clear the stored secret
 *   value → set a new secret
 */
export interface UpsertCatalogSourcePayload {
  protocol: CatalogSourceProtocol;
  host: string;
  port: number;
  path: string;
  username: string | null;
  password: string | null;
  schedule: number;
  isEnabled: boolean;
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
    const hasPassword =
      payload.password === null ? (prev?.hasPassword ?? false) : payload.password !== "";
    const wasEnabled = prev?.isEnabled ?? false;
    const source: CatalogSource = {
      protocol: payload.protocol,
      host: payload.host,
      port: payload.port,
      path: payload.path,
      username: payload.username,
      hasPassword,
      schedule: payload.schedule,
      isEnabled: payload.isEnabled,
      lastSyncAt: prev?.lastSyncAt ?? null,
      lastSyncStatus: prev?.lastSyncStatus ?? null,
      lastSyncError: prev?.lastSyncError ?? null,
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
