/**
 * documents.ts — typed client for flows and the documents read into them.
 *
 * Mirrors `ProcuLink.Api/Contracts/DocumentContracts.cs` and `ProcuLink.Core/Documents/*`
 * (camelCase JSON). Status and type values stay plain strings so a value from a newer backend is
 * never coerced. No mock fixtures yet: in mock mode every call throws.
 *
 * Paths are backticked on purpose so `src/test/endpoint-reachability.test.ts` can see them.
 */

import { API_BASE_URL, authHeader, fetchWithTimeout, isApiMockMode } from "./core";
import { readRefusal } from "./refusal";

export interface Box { x: number; y: number; width: number; height: number }
export interface SourceLocation { page: number | null; box: Box | null; address: string | null }
export interface ReadField {
  key: string; label: string; value: string | null; type: string; meaning: string | null;
  confidence: number; location: SourceLocation | null; notOnPage: boolean; listed: boolean; edited: boolean;
}
export interface ReadCell {
  value: string | null; confidence: number; location: SourceLocation | null; notOnPage: boolean; edited: boolean;
}
export interface ReadColumn { key: string; label: string; type: string; meaning: string | null }
export interface ReadRow { cells: Record<string, ReadCell> }
export interface ReadTable { key: string; label: string; columns: ReadColumn[]; rows: ReadRow[]; listed: boolean }
export interface ReadResult { kindLabel: string | null; fields: ReadField[]; tables: ReadTable[]; truncated: boolean }

export interface FlowField { key: string; label: string; type: string; meaning: string | null; required: boolean }
export interface FlowTable { key: string; label: string; columns: FlowField[] }
export interface FlowFieldList { fields: FlowField[]; tables: FlowTable[] }
export interface Flow {
  id: string; name: string; fieldsConfirmed: boolean; fields: FlowFieldList; documentCount: number; createdAt: string;
}

export interface DocumentSummary {
  id: string; flowId: string; flowName: string; fileName: string; status: string; statusReason: string | null;
  pageCount: number | null; billingUnits: number; failedChecks: number; createdAt: string;
}
export interface DocumentCheck { code: string; passed: boolean; fieldKey: string | null; message: string }
export interface DocumentDetail {
  summary: DocumentSummary; contentType: string; read: ReadResult; checks: DocumentCheck[];
}
export interface HistoryEntry { action: string; at: string; userId: string | null; payload: unknown }
export interface EditValuesRequest {
  fields?: { key: string; value: string | null }[];
  /** `row` is a 0-based index. */
  cells?: { table: string; row: number; column: string; value: string | null }[];
  addRowToTables?: string[];
  removeRows?: { table: string; row: number }[];
}

const UPLOAD_TIMEOUT_MS = 60_000;

/** One request path for JSON, multipart and binary: a FormData body must not get a JSON content type. */
async function send(path: string, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  if (isApiMockMode) throw new Error("Flows are not available in mock mode yet.");
  const auth = await authHeader();
  const type = init?.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api${path}`,
    { ...init, headers: { ...type, ...auth, ...init?.headers } },
    timeoutMs,
  );
  if (!res.ok) throw await readRefusal(res, `documents: ${res.status}`);
  return res;
}

async function apiFetch<T>(path: string, init?: RequestInit, timeoutMs?: number): Promise<T> {
  return (await (await send(path, init, timeoutMs)).json()) as T;
}

const json = (data: unknown) => JSON.stringify(data);

export const listFlows = () => apiFetch<Flow[]>(`/flows`);
export const createFlow = (name: string) => apiFetch<Flow>(`/flows`, { method: "POST", body: json({ name }) });
export const getFlow = (id: string) => apiFetch<Flow>(`/flows/${id}`);
export const renameFlow = (id: string, name: string) =>
  apiFetch<Flow>(`/flows/${id}`, { method: "PATCH", body: json({ name }) });
export const saveFlowFields = (id: string, fields: FlowFieldList) =>
  apiFetch<Flow>(`/flows/${id}/fields`, { method: "PUT", body: json(fields) });

export function uploadDocument(flowId: string, file: File): Promise<DocumentSummary> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<DocumentSummary>(`/flows/${flowId}/documents`, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS);
}

export function listDocuments(params: { flowId?: string; status?: string; take?: number } = {}): Promise<DocumentSummary[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  const qs = query.toString();
  return apiFetch<DocumentSummary[]>(`/documents${qs ? `?${qs}` : ""}`);
}

export const getDocument = (id: string) => apiFetch<DocumentDetail>(`/documents/${id}`);
export const editDocumentValues = (id: string, edits: EditValuesRequest) =>
  apiFetch<DocumentDetail>(`/documents/${id}/values`, { method: "PATCH", body: json(edits) });
export const getDocumentHistory = (id: string) => apiFetch<HistoryEntry[]>(`/documents/${id}/history`);
export const retryDocumentRead = (id: string) =>
  apiFetch<DocumentSummary>(`/documents/${id}/retry-read`, { method: "POST" });

export async function fetchDocumentSource(id: string): Promise<Blob> {
  return (await send(`/documents/${id}/source`, undefined, UPLOAD_TIMEOUT_MS)).blob();
}
