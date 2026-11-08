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
import type { OutputNodeTemplate } from "./types";

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
  automation: "review" | "auto";
}

export interface DocumentSummary {
  id: string; flowId: string; flowName: string; fileName: string; status: string; statusReason: string | null;
  pageCount: number | null; billingUnits: number; failedChecks: number; createdAt: string;
  source: string; sourceRef: string | null;
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

export interface Destination {
  id: string; name: string; protocol: string; config: Record<string, unknown>; hasCredentials: boolean; createdAt: string;
}
export interface DestinationRequest {
  name: string; protocol: string; config: Record<string, unknown>; credentials?: Record<string, unknown> | null;
}
export interface DestinationTestResult { success: boolean; message: string | null; responseCode: number | null }
export interface FlowIntake {
  id: string; kind: string; config: Record<string, unknown>; hasCredentials: boolean; isEnabled: boolean;
  address: string | null; lastRunAt: string | null; lastStatus: string | null; lastMessage: string | null;
}
export interface IntakeRequest {
  kind: string; config: Record<string, unknown>; credentials: Record<string, string> | null; enabled?: boolean;
}
export interface FlowOutput {
  id: string; flowId: string; name: string; format: string; tableKey: string | null; destinationId: string | null;
  template: OutputNodeTemplate; createdAt: string; sendWhen: SendWhen | null;
}
export type SendWhenOp = "is" | "is_not" | "contains";
export type SendWhen = { field: string; op: SendWhenOp; value: string };
export type LookupEntry = { from: string; to: string };
export type LookupMiss = { lookupId: string; value: string };
export type LookupCandidate = { value: string; description: string | null };
export type LookupSuggestion = { lookupId: string; value: string; to: string; confidence: number | null; description: string | null };
export type LookupSummary = {
  id: string; name: string; count: number; updatedAt: string; hasCandidates: boolean; suggestionsOn: boolean;
};
export type Lookup = {
  id: string; name: string; entries: LookupEntry[]; updatedAt: string; candidates: LookupCandidate[]; suggestionsOn: boolean;
};
export interface OutputRequest {
  name: string; format: string; tableKey?: string | null; destinationId?: string | null; template?: OutputNodeTemplate | null;
  sendWhen?: SendWhen | null;
}
export interface OutputPreview { contentType: string; fileName: string; content: string; lookupMisses: LookupMiss[] }
export interface DocumentDelivery {
  id: string; outputName: string; protocol: string; status: string; attempts: number;
  lastError: string | null; fileName: string | null; deliveredAt: string | null;
}

const UPLOAD_TIMEOUT_MS = 60_000;

/** One request path for JSON, multipart and binary: a FormData body must not get a JSON content type. */
async function apiFetch<T>(path: string, init?: RequestInit, timeoutMs?: number, as: "json" | "blob" = "json"): Promise<T> {
  if (isApiMockMode) throw new Error("Flows are not available in mock mode yet.");
  const auth = await authHeader();
  const type = init?.body instanceof FormData ? {} : { "Content-Type": "application/json" };
  const res = await fetchWithTimeout(
    `${API_BASE_URL}/api${path}`,
    { ...init, headers: { ...type, ...auth, ...init?.headers } },
    timeoutMs,
  );
  if (!res.ok) throw await readRefusal(res, `documents: ${res.status}`);
  if (res.status === 204) return undefined as T;
  return (as === "blob" ? res.blob() : res.json()) as Promise<T>;
}

/** A path segment from outside (the URL, a row): never `..`, never a slash. */
const seg = (id: string) => {
  if (!id || id === "." || id === "..") throw new Error("Invalid id");
  return encodeURIComponent(id);
};

const json = (data: unknown) => JSON.stringify(data);

export const listFlows = () => apiFetch<Flow[]>(`/flows`);
export const createFlow = (name: string) => apiFetch<Flow>(`/flows`, { method: "POST", body: json({ name }) });
export const getFlow = (id: string) => apiFetch<Flow>(`/flows/${seg(id)}`);
export const renameFlow = (id: string, name: string) =>
  apiFetch<Flow>(`/flows/${seg(id)}`, { method: "PATCH", body: json({ name }) });
export const updateFlow = (id: string, patch: { name?: string; automation?: "review" | "auto" }) =>
  apiFetch<Flow>(`/flows/${seg(id)}`, { method: "PATCH", body: json(patch) });
export const saveFlowFields = (id: string, fields: FlowFieldList) =>
  apiFetch<Flow>(`/flows/${seg(id)}/fields`, { method: "PUT", body: json(fields) });

export function uploadDocument(flowId: string, file: File): Promise<DocumentSummary> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<DocumentSummary>(`/flows/${seg(flowId)}/documents`, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS);
}

export function listDocuments(params: { flowId?: string; status?: string; take?: number } = {}): Promise<DocumentSummary[]> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined) query.set(key, String(value));
  return apiFetch<DocumentSummary[]>(`/documents?${query}`);
}

export const getDocument = (id: string) => apiFetch<DocumentDetail>(`/documents/${seg(id)}`);
export const editDocumentValues = (id: string, edits: EditValuesRequest) =>
  apiFetch<DocumentDetail>(`/documents/${seg(id)}/values`, { method: "PATCH", body: json(edits) });
export const getDocumentHistory = (id: string) => apiFetch<HistoryEntry[]>(`/documents/${seg(id)}/history`);
export const retryDocumentRead = (id: string) =>
  apiFetch<DocumentSummary>(`/documents/${seg(id)}/retry-read`, { method: "POST" });

export const fetchDocumentSource = (id: string) =>
  apiFetch<Blob>(`/documents/${seg(id)}/source`, undefined, UPLOAD_TIMEOUT_MS, "blob");

export const listDestinations = () => apiFetch<Destination[]>(`/destinations`);
export const createDestination = (body: DestinationRequest) =>
  apiFetch<Destination>(`/destinations`, { method: "POST", body: json(body) });
export const updateDestination = (id: string, body: DestinationRequest) =>
  apiFetch<Destination>(`/destinations/${seg(id)}`, { method: "PUT", body: json(body) });
export const deleteDestination = (id: string) =>
  apiFetch<void>(`/destinations/${seg(id)}`, { method: "DELETE" });
export const testDestination = (id: string) =>
  apiFetch<DestinationTestResult>(`/destinations/${seg(id)}/test`, { method: "POST" });

export const listIntakes = (flowId: string) => apiFetch<FlowIntake[]>(`/flows/${seg(flowId)}/intakes`);
export const createIntake = (flowId: string, req: IntakeRequest) =>
  apiFetch<FlowIntake>(`/flows/${seg(flowId)}/intakes`, { method: "POST", body: json(req) });
export const updateIntake = (flowId: string, id: string, req: IntakeRequest) =>
  apiFetch<FlowIntake>(`/flows/${seg(flowId)}/intakes/${seg(id)}`, { method: "PUT", body: json(req) });
export const deleteIntake = (flowId: string, id: string) =>
  apiFetch<void>(`/flows/${seg(flowId)}/intakes/${seg(id)}`, { method: "DELETE" });
export const newIntakeAddress = (flowId: string, id: string) =>
  apiFetch<FlowIntake>(`/flows/${seg(flowId)}/intakes/${seg(id)}/new-address`, { method: "POST" });
export const testIntake = (flowId: string, id: string) =>
  apiFetch<DestinationTestResult>(`/flows/${seg(flowId)}/intakes/${seg(id)}/test`, { method: "POST" });
/** The machine-facing file API's URL for a flow (shown to the customer, never called from here). */
export const flowApiEndpoint = (flowId: string) => `${API_BASE_URL}/api/v1/flows/${seg(flowId)}/documents`;

export const listOutputs = (flowId: string) => apiFetch<FlowOutput[]>(`/flows/${seg(flowId)}/outputs`);
export const createOutput = (flowId: string, body: OutputRequest) =>
  apiFetch<FlowOutput>(`/flows/${seg(flowId)}/outputs`, { method: "POST", body: json(body) });
export const updateOutput = (flowId: string, id: string, body: OutputRequest) =>
  apiFetch<FlowOutput>(`/flows/${seg(flowId)}/outputs/${seg(id)}`, { method: "PUT", body: json(body) });
export const deleteOutput = (flowId: string, id: string) =>
  apiFetch<void>(`/flows/${seg(flowId)}/outputs/${seg(id)}`, { method: "DELETE" });
export const previewOutput = (documentId: string, outputId: string, template?: OutputNodeTemplate) =>
  apiFetch<OutputPreview>(`/documents/${seg(documentId)}/outputs/${seg(outputId)}/preview`, {
    method: "POST",
    ...(template ? { body: json({ template }) } : {}),
  });

export const listLookups = () => apiFetch<LookupSummary[]>(`/lookups`);
export const getLookup = (id: string) => apiFetch<Lookup>(`/lookups/${seg(id)}`);
export const createLookup = (name: string) => apiFetch<Lookup>(`/lookups`, { method: "POST", body: json({ name }) });
export const updateLookup = (id: string, body: { name: string; entries: LookupEntry[]; candidates?: LookupCandidate[] }) =>
  apiFetch<Lookup>(`/lookups/${seg(id)}`, { method: "PUT", body: json(body) });
/** Sends no `candidates`, so the stored list is kept. */
export const addLookupEntry = async (id: string, entry: LookupEntry) => {
  const l = await getLookup(id);
  return updateLookup(id, { name: l.name, entries: [...l.entries, entry] });
};
export const suggestLookupMatches = (documentId: string, outputId: string) =>
  apiFetch<{ suggestions: LookupSuggestion[] }>(`/documents/${seg(documentId)}/outputs/${seg(outputId)}/preview?suggest=true`, {
    method: "POST",
  }, UPLOAD_TIMEOUT_MS).then((r) => r.suggestions);
export const deleteLookup = (id: string) => apiFetch<void>(`/lookups/${seg(id)}`, { method: "DELETE" });

export const sendDocument = (id: string) => apiFetch<DocumentDelivery[]>(`/documents/${seg(id)}/send`, { method: "POST" });
export const listDeliveries = (id: string) => apiFetch<DocumentDelivery[]>(`/documents/${seg(id)}/deliveries`);
export const downloadDeliveryFile = (id: string, deliveryId: string) =>
  apiFetch<Blob>(`/documents/${seg(id)}/deliveries/${seg(deliveryId)}/file`, undefined, UPLOAD_TIMEOUT_MS, "blob");
