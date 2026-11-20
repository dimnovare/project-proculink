/**
 * documents.ts — typed client for flows and the documents read into them.
 *
 * Mirrors `ProcuLink.Api/Contracts/DocumentContracts.cs` and `ProcuLink.Core/Documents/*`
 * (camelCase JSON). Status and type values stay plain strings so a value from a newer backend is
 * never coerced. In mock mode every call is served by `mockEngine.ts`.
 *
 * Paths are backticked on purpose so `src/test/endpoint-reachability.test.ts` can see them.
 */

import { API_BASE_URL, authHeader, fetchWithTimeout, isApiMockMode } from "./core";
import { mockEngineFetch } from "./mockEngine";
import { excelSeparator } from "@/lib/flowOutputModel";
import { readRefusal } from "./refusal";
import type { OutputNodeTemplate } from "./types";
import type { CheckMode } from "../deliveryMode";

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
  automation: CheckMode;
  /** No output in use has a live destination, so a person downloads the file. Absent on an older backend: the destination words. */
  downloadOnly?: boolean;
  /** Scanned PDFs and photos are readable. Absent on an older backend, which means off. */
  scansOn?: boolean;
  /** Word, text, XML, JSON and EDI files are readable. Absent on an older backend, which means off. */
  formatsOn?: boolean;
  /** Outputs can be proposed from the receiving system's documentation. Absent means off. */
  docsOutputsOn?: boolean;
  /** E-invoice outputs that need the validator sidecar (Peppol BIS, EN 16931 CII and XRechnung) are offered. Absent means off. */
  peppolOn?: boolean;
  /** The live version number; null means never published. Only the single-flow response carries these three. */
  publishedVersion?: number | null;
  hasChanges?: boolean;
  noCorrectionStreak?: number | null;
  /** Never put in use and nothing of it ever sent, so it can be deleted with its documents. Only the single-flow response carries it. */
  canDelete?: boolean;
  /** Only the list response carries it; single responses answer null. Absent on an older backend. */
  summary?: FlowSummary | null;
}
export interface FlowSummaryOutput { name: string; format: string; standard: string | null; destination: string | null }
export interface FlowSummary {
  needsYou: number; couldNotSend: number; couldNotRead: number; lastDocumentAt: string | null;
  waysIn: string[]; outputs: FlowSummaryOutput[];
}
export interface FlowVersion { versionNo: number; publishedAt: string; publishedBy: string | null; live: boolean }

export interface DocumentSummary {
  id: string; flowId: string; flowName: string; fileName: string; status: string; statusReason: string | null;
  pageCount: number | null; billingUnits: number; failedChecks: number; createdAt: string;
  source: string; sourceRef: string | null;
  /** The flow version this document was read with; null until read on a published flow. Absent on an older backend. */
  flowVersion?: number | null;
}
/** Read inside the plan's current usage window (since the trial start on a Pilot, else this UTC month), not a sample,
 *  and billed: removing it still counts. Only on a list row and a document detail. */
type CountsThisMonth = { countsThisMonth?: boolean };
/** A made file of a sent document. `destination` is null when it was stored, or its destination is gone. */
export interface DocumentFile { deliveryId: string; fileName: string; delivered: boolean; destination: string | null }
/** Where sending stopped. `destination` is null when it has no name left to give. */
export interface DocumentStop { destinationId: string | null; destination: string | null; error: string | null }
/** A row of the paged documents list: the summary plus what only the app shows. Only pages carry these. */
export interface DocumentRow extends DocumentSummary, CountsThisMonth {
  number: string | null; sender: string | null; checks: string[];
  /** Set only when sent: when its last output landed. */
  sentAt: string | null;
  /** Set only on `read_failed` and `send_failed`. */
  failedAt: string | null;
  /** Can be null on `send_failed` too. */
  stop: DocumentStop | null;
  isSample: boolean;
  /** The kind as read, in words ("Invoice"); null when unknown. Absent on an older backend. */
  kind?: string | null;
  /** Still in the workspace's inbox ("New documents"): not yet with a flow. Absent on an older backend. */
  inInbox?: boolean;
  /** Only on `sent`: its made files. */
  files?: DocumentFile[];
  /** Only on a `duplicate_file`: when the earlier copy was added. */
  duplicateOfAt?: string | null;
  /** The flow's current download-only answer. */
  downloadOnly?: boolean;
  /** The caller may remove this document. */
  canRemove?: boolean;
}
/** The workspace's inbox: where a document added without a flow lands, and the one email address that leads there. */
export interface Inbox { flowId: string; address: string | null; intakeId: string | null; scansOn?: boolean; formatsOn?: boolean }
export interface SetUpResult { flowId: string; flowName: string; document: DocumentSummary }
/** A flow that already holds documents of a document's kind. */
export interface SortFlow { id: string; name: string }
/** `sampleCount` is in the server's page envelope and is always 0 for documents. */
export interface DocumentPage { items: DocumentRow[]; totalCount: number; page: number; pageSize: number; sampleCount: number }
export interface DocumentCheck { code: string; passed: boolean; fieldKey: string | null; message: string }
export interface DocumentDetail extends CountsThisMonth {
  summary: DocumentSummary; contentType: string; read: ReadResult; checks: DocumentCheck[];
  /** Who this document is from, as read off it (VAT number, then name, then email domain), or null. */
  senderLabel?: string | null;
  /** The caller may remove this document. */
  canRemove?: boolean;
}
/** Where a value sits on the original: a box on a page, or a sheet cell / text line with the value read there. */
export interface TeachRequest { key?: string; newLabel?: string; page?: number; box?: Box; address?: string; value?: string }
export interface HistoryEntry { action: string; at: string; userId: string | null; payload: unknown }
export interface EditValuesRequest {
  fields?: { key: string; value: string | null }[];
  /** `row` is a 0-based index. */
  cells?: { table: string; row: number; column: string; value: string | null }[];
  addRowToTables?: string[];
  removeRows?: { table: string; row: number }[];
}

export interface DestinationUse { flowId: string; flowName: string; outputId: string; outputName: string }
/** `kind` is "test" or "document"; kept a string so a newer value is never coerced. */
export interface DestinationLastSend { kind: string; at: string; ok: boolean }
export interface Destination {
  id: string; name: string; protocol: string; config: Record<string, unknown>; hasCredentials: boolean; createdAt: string;
  /** One row per output that sends here, editable or live. */
  usedBy: DestinationUse[];
  /** Null when nothing was ever sent or tested here. */
  lastSend: DestinationLastSend | null;
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
  layout?: OutputLayout | null; hasLogo?: boolean;
  /** The standard this output follows (a catalog id), and the meanings it needs; null for a template output. */
  standard?: string | null; needs?: string[] | null;
}
export type OutputLayout = { title?: string | null; header?: string | null; footer?: string | null };
export type SendWhenOp = "is" | "is_not" | "contains";
export type SendWhen = { field: string; op: SendWhenOp; value: string };
export type LookupEntry = { from: string; to: string };
export type LookupMiss = { lookupId: string; value: string };
export type LookupCandidate = { value: string; description: string | null };
export type LookupSuggestion = { lookupId: string; value: string; to: string; confidence: number | null; description: string | null };
/** `usedBy` is absent from an older server: not known, so nothing about use is printed. */
export type LookupSummary = {
  id: string; name: string; count: number; updatedAt: string; hasCandidates: boolean; suggestionsOn: boolean;
  usedBy?: { flowId: string; flowName: string }[];
};
export type Lookup = {
  id: string; name: string; entries: LookupEntry[]; updatedAt: string; candidates: LookupCandidate[]; suggestionsOn: boolean;
};
export interface OutputRequest {
  name: string; format: string; tableKey?: string | null; destinationId?: string | null; template?: OutputNodeTemplate | null;
  sendWhen?: SendWhen | null; layout?: OutputLayout | null;
  /** Create, or an update that sends `replace`; ignored on any other update. */
  standard?: string | null;
  /** Update only: the output becomes `standard` (null: a template output) instead of keeping its kind. */
  replace?: boolean;
  /** With no template (create or update): "," or ";" makes the CSV for the user's Excel (separator and byte-order mark). */
  csvSeparator?: "," | ";";
}
/** A file a flow could make instead, not saved: a type (`format`; a template, or null for every value) or a `standard`. */
export interface FileChoice { format: string; standard: string | null; tableKey: string | null; template: OutputNodeTemplate | null; csvSeparator?: "," | ";" }
export type DraftCite = { where: string; quote: string };
export type DraftLeaf = {
  path: string; fieldKey: string | null; by: "name" | "ai" | "meaning" | "docs" | null; confidence: number | null; required?: boolean; cite?: DraftCite | null;
};
export type OutputDraft = {
  name: string; format: string; tableKey: string | null; template: OutputNodeTemplate; leaves: DraftLeaf[]; notes: string[];
  formatCite?: DraftCite | null; destination?: { url: string; method: string; authType: string; cite?: DraftCite | null } | null; truncated?: boolean;
};
export interface OutputPreview { contentType: string; fileName: string; content: string; base64?: string; lookupMisses: LookupMiss[];
  /** The file starts with a UTF-8 byte-order mark, which `content` leaves out. */
  byteOrderMark?: boolean;
}
export interface DocumentDelivery {
  id: string; outputName: string; protocol: string; status: string; attempts: number;
  lastError: string | null; fileName: string | null; deliveredAt: string | null;
  /** The destination's name when delivered; null when stored or gone. */
  destination?: string | null;
}

const UPLOAD_TIMEOUT_MS = 60_000;

/** One request path for JSON, multipart and binary: a FormData body must not get a JSON content type. */
async function apiFetch<T>(path: string, init?: RequestInit, timeoutMs?: number, as: "json" | "blob" = "json"): Promise<T> {
  if (isApiMockMode) return mockEngineFetch<T>(path, init, as);
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
export const publishFlow = (id: string) => apiFetch<Flow>(`/flows/${seg(id)}/publish`, { method: "POST" });
export const listFlowVersions = (id: string) => apiFetch<FlowVersion[]>(`/flows/${seg(id)}/versions`);
export const restoreFlowVersion = (id: string, versionNo: number) =>
  apiFetch<Flow>(`/flows/${seg(id)}/versions/${versionNo}/restore`, { method: "POST" });
export const renameFlow = (id: string, name: string) =>
  apiFetch<Flow>(`/flows/${seg(id)}`, { method: "PATCH", body: json({ name }) });
export const updateFlow = (id: string, patch: { name?: string; automation?: CheckMode }) =>
  apiFetch<Flow>(`/flows/${seg(id)}`, { method: "PATCH", body: json(patch) });
export const saveFlowFields = (id: string, fields: FlowFieldList) =>
  apiFetch<Flow>(`/flows/${seg(id)}/fields`, { method: "PUT", body: json(fields) });

export function uploadDocument(flowId: string, file: File): Promise<DocumentSummary> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<DocumentSummary>(`/flows/${seg(flowId)}/documents`, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS);
}

/** The built-in sample invoice as a document of this flow. Read like an upload, never counted. One per flow: asking again returns the same document. */
export const createSampleDocument = (flowId: string) =>
  apiFetch<DocumentSummary>(`/flows/${seg(flowId)}/documents/sample`, { method: "POST" }, UPLOAD_TIMEOUT_MS);

export const getInbox = () => apiFetch<Inbox>(`/inbox`);
/** Admin only: the old address stops working. */
export const newInboxAddress = () => apiFetch<Inbox>(`/inbox/new-address`, { method: "POST" });

/** A document with no flow chosen: it lands in the workspace's inbox and is sorted after it is read. */
export async function addDocument(file: File): Promise<DocumentSummary> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<DocumentSummary>(`/documents`, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS);
}

/** Put a document with a flow; moving it to the flow it is already in confirms that it belongs there. */
export const moveDocument = (id: string, flowId: string) =>
  apiFetch<DocumentSummary>(`/documents/${seg(id)}/move`, { method: "POST", body: json({ flowId }) });
/** "Do the same every time": a flow made from this inbox document's read. */
export const setUpDocument = (id: string, name?: string, csvSeparator = excelSeparator()) =>
  apiFetch<SetUpResult>(`/documents/${seg(id)}/set-up`, { method: "POST", body: json({ ...(name ? { name } : {}), csvSeparator }) });
/** "Just this one": what was read from an inbox document, as a file. */
export const downloadDocument = (id: string, format: "xlsx" | "csv", csvSeparator = excelSeparator()) =>
  apiFetch<Blob>(`/documents/${seg(id)}/download`, { method: "POST", body: json({ format, csvSeparator }) }, UPLOAD_TIMEOUT_MS, "blob");
/** The flows that hold documents of this document's kind (empty when none do). */
export const getSortFlows = (id: string) => apiFetch<SortFlow[]>(`/documents/${seg(id)}/sort-flows`);

/** An undefined parameter or an empty array is not sent; an array is sent comma-joined. */
function toQuery(params: object): URLSearchParams {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && !(Array.isArray(value) && value.length === 0)) query.set(key, String(value));
  }
  return query;
}

export function listDocuments(params: { flowId?: string; status?: string; take?: number } = {}): Promise<DocumentSummary[]> {
  const query = toQuery(params);
  return apiFetch<DocumentSummary[]>(`/documents?${query}`);
}

/** One page, newest first. `status` is sent comma-joined. `page` is always sent: the server ignores `pageSize` without it.
 *  `sentFrom` is a UTC instant ending in `Z`, kept at or after. The server clamps `pageSize` to 200.
 *  `q` finds by file name or document number; the server trims it and a blank one is no filter, so leave it out. */
export function listDocumentPage(params: {
  status?: readonly string[]; flowId?: string; sentFrom?: string; waitingOnDestination?: string; q?: string; page: number; pageSize: number;
}): Promise<DocumentPage> {
  const query = toQuery(params);
  return apiFetch<DocumentPage>(`/documents?${query}`);
}

export const getDocument = (id: string) => apiFetch<DocumentDetail>(`/documents/${seg(id)}`);
export const editDocumentValues = (id: string, edits: EditValuesRequest) =>
  apiFetch<DocumentDetail>(`/documents/${seg(id)}/values`, { method: "PATCH", body: json(edits) });
export const teachDocument = (id: string, req: TeachRequest) =>
  apiFetch<DocumentDetail>(`/documents/${seg(id)}/teach`, { method: "POST", body: json(req) });
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

export interface NotificationSettings { email: string | null; onReview: boolean; onFailure: boolean }
export const getNotificationSettings = () => apiFetch<NotificationSettings>(`/notification-settings`);
export const saveNotificationSettings = (s: { onReview: boolean; onFailure: boolean }) =>
  apiFetch<NotificationSettings>(`/notification-settings`, { method: "PUT", body: json(s) });

export interface PushDeviceKeys { endpoint: string; p256dh: string; auth: string }
export const savePushDevice = (d: PushDeviceKeys) =>
  apiFetch<void>(`/push-devices`, { method: "POST", body: json(d) });
export const removePushDevice = (endpoint: string) =>
  apiFetch<void>(`/push-devices`, { method: "DELETE", body: json({ endpoint }) });
export interface PushDeviceCheck { saved: boolean }
export const checkPushDevice = (endpoint: string) =>
  apiFetch<PushDeviceCheck>(`/push-devices/check`, { method: "POST", body: json({ endpoint }) });
export const testPushDevice = (endpoint: string) =>
  apiFetch<void>(`/push-devices/test`, { method: "POST", body: json({ endpoint }) });

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

/** `published` reads the live version's outputs, which is what new documents use. */
export const listOutputs = (flowId: string, opts?: { published?: boolean }) =>
  apiFetch<FlowOutput[]>(`/flows/${seg(flowId)}/outputs${opts?.published ? "?published=true" : ""}`);
export const createOutput = (flowId: string, body: OutputRequest) =>
  apiFetch<FlowOutput>(`/flows/${seg(flowId)}/outputs`, { method: "POST", body: json(body) });
export const updateOutput = (flowId: string, id: string, body: OutputRequest) =>
  apiFetch<FlowOutput>(`/flows/${seg(flowId)}/outputs/${seg(id)}`, { method: "PUT", body: json(body) });
export const deleteOutput = (flowId: string, id: string) =>
  apiFetch<void>(`/flows/${seg(flowId)}/outputs/${seg(id)}`, { method: "DELETE" });
/** Upload timeout: it erases each document's stored files first, and a cut-off wait is not a refusal. */
export const deleteDocument = (id: string) =>
  apiFetch<void>(`/documents/${seg(id)}`, { method: "DELETE" }, UPLOAD_TIMEOUT_MS);
export const deleteFlow = (id: string) => apiFetch<void>(`/flows/${seg(id)}`, { method: "DELETE" }, UPLOAD_TIMEOUT_MS);
/** `as` previews the file as another type or standard; nothing is saved. */
export const previewOutput = (documentId: string, outputId: string, opts?: { published?: boolean; template?: OutputNodeTemplate; as?: FileChoice }) =>
  apiFetch<OutputPreview>(`/documents/${seg(documentId)}/outputs/${seg(outputId)}/preview${opts?.published ? "?published=true" : ""}`, {
    method: "POST",
    ...(opts?.as ? { body: json(opts.as) } : opts?.template ? { body: json({ template: opts.template }) } : {}),
  });

export interface OutputCheck { status: "passed" | "failed" | "unavailable"; issues: { ruleId: string; severity: "error" | "warning" | "info"; message: string }[] }
export const checkOutput = (flowId: string, outputId: string, documentId: string) =>
  apiFetch<OutputCheck>(`/flows/${seg(flowId)}/outputs/${seg(outputId)}/check?documentId=${seg(documentId)}`, { method: "POST" });

export function uploadOutputLogo(flowId: string, outputId: string, file: File): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<void>(`/flows/${seg(flowId)}/outputs/${seg(outputId)}/logo`, { method: "PUT", body: form });
}
export function outputFromSample(flowId: string, file: File): Promise<OutputDraft> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<OutputDraft>(`/flows/${seg(flowId)}/outputs/from-sample`, { method: "POST", body: form }, UPLOAD_TIMEOUT_MS);
}
export function outputFromDocumentation(flowId: string, file: File): Promise<OutputDraft> {
  const form = new FormData();
  form.append("file", file);
  return apiFetch<OutputDraft>(`/flows/${seg(flowId)}/outputs/from-documentation`, { method: "POST", body: form }, 180_000);
}
export const testOutput = (documentId: string, body: { format: string; tableKey: string | null; destinationId: string; template: OutputNodeTemplate; standard?: string | null }) =>
  apiFetch<DestinationTestResult>(`/documents/${seg(documentId)}/outputs/test`, { method: "POST", body: json(body) });
export const deleteOutputLogo = (flowId: string, outputId: string) =>
  apiFetch<void>(`/flows/${seg(flowId)}/outputs/${seg(outputId)}/logo`, { method: "DELETE" });

export const listLookups = () => apiFetch<LookupSummary[]>(`/lookups`);
export const getLookup = (id: string) => apiFetch<Lookup>(`/lookups/${seg(id)}`);
export const createLookup = (name: string, entries: LookupEntry[] = []) =>
  apiFetch<Lookup>(`/lookups`, { method: "POST", body: json({ name, entries }) });
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

/** One row of `GET /api/audit` (`AuditController.GetAuditLog`); only the fields the Activity page reads. */
export interface ActivityEvent {
  id: string; ts: string; action: string;
  documentId: string | null; flowId: string | null;
  documentName: string | null; flowName: string | null;
  source: string | null; actorId: string | null;
  /** When the send behind a delivery row started; null on every other row. */
  startedAt: string | null; poNumber: string | null;
  payload: unknown;
}
export interface ActivityResult { events: ActivityEvent[]; total: number; page: number; pageSize: number }
export interface ActivityQuery { page: number; pageSize: number; actions?: readonly string[]; q?: string; flowId?: string; from?: string; to?: string }

/** Each action is its own `actions` key; an empty text, flow or date is not sent. */
export function listActivity({ page, pageSize, actions = [], q, flowId, from, to }: ActivityQuery): Promise<ActivityResult> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  for (const a of actions) query.append("actions", a);
  for (const [k, v] of [["q", q], ["flowId", flowId], ["from", from], ["to", to]] as const) if (v) query.append(k, v);
  return apiFetch<ActivityResult>(`/audit?${query}`);
}
