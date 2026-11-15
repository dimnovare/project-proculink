/**
 * mockEngine.ts — fixtures for the document engine in mock mode (`documents.ts` `apiFetch` seam).
 *
 * GETs serve fixed generic data. A write resolves with an echo and persists nothing, except a document's
 * edits and sends, which are remembered until the page reloads (`remembered` below). An unknown
 * path or method throws, so a screen calling an endpoint with no fixture shows its error state
 * instead of an empty success. Only reachable when `isApiMockMode` (never true in production).
 */
import { DOCUMENT_STATUSES, documentStatus } from "../documentStatusManifest";
import { ApiHttpError } from "./core";
import { mockSourceBytesForKey } from "./mockSourceDocument";
import type {
  Destination, DocumentCheck, DocumentDelivery, DocumentDetail, DocumentRow, DocumentSummary, EditValuesRequest, Flow, FlowField, FlowIntake, FlowOutput,
  FlowVersion, Lookup, LookupSummary, NotificationSettings, OutputPreview, ReadCell, ReadResult,
} from "./documents";

export const MOCK_ENGINE_IDS = { flow: "flow-1", setupFlow: "flow-2", document: "doc-1", lookup: "lookup-1", output: "out-1" } as const;
/** The document number every fixture read carries — specs assert against this, never a literal. */
export const MOCK_DOCUMENT_NUMBER = "INV-1001";

const STATUS = Object.fromEntries(Object.keys(DOCUMENT_STATUSES).map((k) => [k, k])) as Record<keyof typeof DOCUMENT_STATUSES, string>;
const T = "2026-05-20T09:00:00Z";

const CSV = [
  "Invoice no,Date,Supplier,Currency,Total,VAT",
  `${MOCK_DOCUMENT_NUMBER},2026-05-20,Example Supplier Ltd,EUR,1240.00,240.00`,
  "Item code,Quantity,Unit price",
  "A-100,10,50.00",
  "B-200,5,60.00",
  "C-300,2,120.00",
].join("\n");

const field = (key: string, label: string, type = "text", required = true): FlowField => ({ key, label, type, meaning: null, required });
const FIELDS = [
  field("invoice_no", "Invoice number"), field("date", "Date", "date"), field("supplier", "Supplier"),
  field("currency", "Currency"), field("total", "Total", "number"), field("vat", "VAT", "number", false),
];
const COLUMNS = [field("item_code", "Item code"), field("quantity", "Quantity", "number"), field("unit_price", "Unit price", "number")];

const flow1: Flow = {
  id: MOCK_ENGINE_IDS.flow, name: "Supplier invoices", fieldsConfirmed: true, documentCount: 3, createdAt: T,
  automation: "review", fields: { fields: FIELDS, tables: [{ key: "lines", label: "Lines", columns: COLUMNS }] },
  publishedVersion: 1, hasChanges: false, noCorrectionStreak: null,
};
const flow2: Flow = {
  id: MOCK_ENGINE_IDS.setupFlow, name: "Delivery notes", fieldsConfirmed: false, documentCount: 1, createdAt: T,
  automation: "auto", fields: { fields: [], tables: [] }, publishedVersion: null, hasChanges: false, noCorrectionStreak: null,
};
// Two more published flows: list screens need enough rows at phone width to clear
// the visual suite's "too little text to be a baseline" floor (tests/e2e/visual.spec.ts).
const quietFlow = (id: string, name: string, automation: Flow["automation"], documentCount: number): Flow =>
  ({ ...flow1, id, name, automation, documentCount });
const flow3 = quietFlow("flow-3", "Purchase orders", "review", 2);
const flow4 = quietFlow("flow-4", "Remittance advices", "auto", 1);
const FLOWS = [flow1, flow2, flow3, flow4];
const versions: FlowVersion[] = [{ versionNo: 1, publishedAt: T, publishedBy: null, live: true }];

const cell = (value: string, r: number, c: number): ReadCell => ({
  value, confidence: 0.97, location: { page: null, box: null, address: `cell:r${r}c${c}` }, notOnPage: false, edited: false,
});
const values = [MOCK_DOCUMENT_NUMBER, "2026-05-20", "Example Supplier Ltd", "EUR", "1240.00", "240.00"];
const tableRows = [["A-100", "10", "50.00"], ["B-200", "5", "60.00"], ["C-300", "2", "120.00"]];
const read: ReadResult = {
  kindLabel: "Invoice", truncated: false,
  fields: FIELDS.map((f, i) => ({
    key: f.key, label: f.label, value: values[i], type: f.type, meaning: null, confidence: 0.97,
    location: { page: null, box: null, address: `cell:r2c${i + 1}` }, notOnPage: false, listed: true, edited: false,
  })),
  tables: [{
    key: "lines", label: "Lines", listed: true, columns: COLUMNS,
    rows: tableRows.map((row, r) => ({ cells: Object.fromEntries(COLUMNS.map((c, i) => [c.key, cell(row[i], r + 4, i + 1)])) })),
  }],
};
/** doc-1 is the board's document: its date was hard to read and its supplier was not found. */
const DOC_1_READ: ReadResult = {
  ...read,
  fields: read.fields.map((f) => f.key === "date" ? { ...f, confidence: 0.72 }
    : f.key === "supplier" ? { ...f, value: null, confidence: 0, location: null } : f),
};

const REFUSED = "The mailbox refused the message.";
const DOC_3_SENT_AT = "2026-06-01T08:00:00Z"; // this week under the browser tests' frozen clock
const DOC_7_SENT_AT = "2026-05-27T09:05:00Z";
const doc = (n: number, f: Flow, status: string, facts: Partial<DocumentRow> = {}): DocumentRow => ({
  id: `doc-${n}`, flowId: f.id, flowName: f.name, fileName: `invoice-${1000 + n}.csv`, status, statusReason: null, pageCount: null,
  billingUnits: 1, failedChecks: 0, createdAt: `2026-05-2${n}T09:00:00Z`, source: "upload", sourceRef: null,
  flowVersion: f.publishedVersion ?? null,
  number: null, sender: null, checks: [], sentAt: null, failedAt: null, stop: null, isSample: false,
  ...facts,
});
/** Newest is `doc-7`. Three wait for review or sending (`doc-1`, `doc-2`, `doc-5`); two failed (`doc-4`, `doc-6`). */
const ROWS: DocumentRow[] = [
  doc(1, flow1, STATUS.needs_review, { failedChecks: 2, checks: ["low_confidence", "required_missing"], number: MOCK_DOCUMENT_NUMBER }),
  doc(2, flow1, STATUS.ready, { fileName: "invoice-1002.pdf" }), // the one PDF: pdf.js e2e (document-pdf.spec.ts)
  doc(3, flow1, STATUS.sent, { sentAt: DOC_3_SENT_AT }),
  doc(4, flow2, STATUS.send_failed, {
    failedAt: "2026-05-24T09:10:00Z", stop: { destinationId: "dest-1", destination: "Accounting inbox", error: REFUSED },
  }),
  doc(5, flow3, STATUS.needs_review, { failedChecks: 1, checks: ["duplicate"] }),
  doc(6, flow4, STATUS.read_failed, { statusReason: "unreadable_file", failedAt: "2026-05-26T09:02:00Z" }),
  doc(7, flow3, STATUS.sent, { isSample: true, sentAt: DOC_7_SENT_AT }),
];
/** What the bare list and every other summary carry: a row without the facts only pages send. */
const summaryOf = ({ number, sender, checks, sentAt, failedAt, stop, isSample, ...s }: DocumentRow): DocumentSummary => s;
const DOCS = ROWS.map(summaryOf);
const hardToRead = (key: string, label: string): DocumentCheck =>
  ({ code: "low_confidence", passed: false, fieldKey: key, message: `${label} was hard to read. Please check it.` });
const notFound = (key: string, label: string): DocumentCheck =>
  ({ code: "required_missing", passed: false, fieldKey: key, message: `${label} is required but was not found.` });
const FAILED_CHECKS: Record<string, DocumentCheck> = {
  low_confidence: hardToRead("date", "Date"),
  required_missing: notFound("supplier", "Supplier"),
  duplicate: { code: "duplicate", passed: false, fieldKey: null, message: "A document with this number was already received." },
};
const detail = (id: string): DocumentDetail => {
  const s = summaryOf(live(pick(ROWS, id, "document")));
  const st = now(id);
  return {
    summary: s, contentType: s.fileName.endsWith(".pdf") ? "application/pdf" : "text/csv", read: st.read, senderLabel: "Example Supplier Ltd",
    checks: st.failed.length ? st.failed : [{ code: "total_present", passed: true, fieldKey: "total", message: "Total found." }],
  };
};

const delivery = (status: string, attempts: number, lastError: string | null, deliveredAt: string | null): DocumentDelivery => ({
  id: "dlv-1", outputName: "Invoice CSV", protocol: "email", status, attempts, lastError, fileName: "invoice.csv", deliveredAt,
});
const DELIVERIES: Record<string, DocumentDelivery[]> = {
  "doc-3": [delivery("delivered", 1, null, DOC_3_SENT_AT)],
  "doc-4": [delivery("dead_letter", 3, REFUSED, null)],
  "doc-7": [delivery("delivered", 1, null, DOC_7_SENT_AT)],
};

/** A document's edits and sends, kept for the page load and filled on first write from the fixtures. */
interface Remembered { status: string; read: ReadResult; failed: DocumentCheck[]; sentAt: string | null; deliveries: DocumentDelivery[] | null }
const remembered = new Map<string, Remembered>();
const fixtureOf = (r: DocumentRow): Remembered => ({
  status: r.status, read: r.id === MOCK_ENGINE_IDS.document ? DOC_1_READ : read, failed: r.checks.map((c) => FAILED_CHECKS[c]),
  sentAt: r.sentAt, deliveries: DELIVERIES[r.id] ?? null,
});
const now = (id: string): Remembered => remembered.get(id) ?? fixtureOf(pick(ROWS, id, "document"));
/** A row as it stands now: what the person changed or sent shows in every list and count. */
const live = (r: DocumentRow): DocumentRow => {
  const s = now(r.id);
  return { ...r, status: s.status, sentAt: s.sentAt, checks: s.failed.map((c) => c.code), failedChecks: s.failed.length };
};
/** Unit tests only: forget remembered edits and sends. The browser forgets on reload. */
export function resetMockEngine(): void {
  remembered.clear();
}
const refuse = (status: number, error: string): never => {
  throw new ApiHttpError(`mock engine: ${error}`, status, { error });
};
const EDIT_KEYS = ["fields", "cells", "addRowToTables", "removeRows"];

/** Like DocumentsController.EditValues and ApplyEditsAsync: refuse, apply to a copy, re-check the flow's required fields. */
function editValues(id: string, body: Body): DocumentDetail {
  const unknown = Object.keys(body).find((k) => !EDIT_KEYS.includes(k));
  if (unknown) throw new Error(`mock engine: unknown edit key "${unknown}" on PATCH /documents/{id}/values`);
  const row = pick(ROWS, id, "document");
  const was = now(id);
  if (was.status === STATUS.sending || was.status === STATUS.sent) refuse(409, "document_sent");
  if (!documentStatus(was.status, row.statusReason).editable) refuse(409, "not_editable");
  const { fields = [], cells = [], addRowToTables = [], removeRows = [] } = body as EditValuesRequest;
  if (fields.length + cells.length + addRowToTables.length + removeRows.length === 0) refuse(400, "no_changes");
  const flow = pick(FLOWS, row.flowId, "flow");
  const copy: ReadResult = structuredClone(was.read);
  for (const e of fields) {
    let f = copy.fields.find((x) => x.key === e.key);
    if (!f) {
      const ff = flow.fields.fields.find((x) => x.key === e.key) ?? refuse(400, "unknown_target");
      f = { key: ff.key, label: ff.label, value: null, type: ff.type, meaning: ff.meaning, confidence: 0, location: null, notOnPage: false, listed: true, edited: false };
      copy.fields.push(f);
    }
    Object.assign(f, { value: e.value, confidence: 1, edited: true, notOnPage: false });
  }
  const table = (key: string) => copy.tables.find((t) => t.key === key) ?? refuse(400, "unknown_target");
  const inRange = (rows: unknown[], i: number) => (Number.isInteger(i) && i >= 0 && i < rows.length) || refuse(400, "unknown_target");
  for (const e of cells) {
    const t = table(e.table);
    inRange(t.rows, e.row);
    if (!t.columns.some((c) => c.key === e.column)) refuse(400, "unknown_target");
    const old = t.rows[e.row].cells[e.column];
    t.rows[e.row].cells[e.column] = { value: e.value, confidence: 1, location: old?.location ?? null, notOnPage: false, edited: true };
  }
  for (const key of addRowToTables) {
    const t = table(key);
    t.rows.push({ cells: Object.fromEntries(t.columns.map((c) => [c.key, { value: null, confidence: 1, location: null, notOnPage: false, edited: true }])) });
  }
  const removes = [...new Map(removeRows.map((r) => [`${r.table}:${r.row}`, r])).values()].sort((a, b) => b.row - a.row);
  for (const r of removes) {
    const t = table(r.table);
    inRange(t.rows, r.row);
    t.rows.splice(r.row, 1);
  }
  const failed = flow.fields.fields.filter((f) => f.required).flatMap((f) => {
    const v = copy.fields.find((x) => x.key === f.key);
    if (!v?.value?.trim()) return [notFound(f.key, f.label)];
    return v.confidence < 0.75 ? [hardToRead(f.key, f.label)] : [];
  }).concat(was.failed.filter((c) => c.code === "duplicate"));
  const status = was.status === STATUS.send_failed ? was.status : failed.length ? STATUS.needs_review : STATUS.ready;
  remembered.set(id, { ...was, status, read: copy, failed });
  return detail(id);
}

/** Like DocumentSender.SendAsync, except that it lands straight on sent with one delivered delivery (R23). */
function send(id: string): DocumentDelivery[] {
  const row = pick(ROWS, id, "document");
  const was = now(id);
  if (!documentStatus(was.status, row.statusReason).editable) refuse(409, "not_ready");
  if (!outputs.some((o) => o.flowId === row.flowId)) refuse(409, "no_outputs");
  const sentAt = new Date().toISOString();
  const deliveries = [delivery("delivered", 1, null, sentAt)];
  remembered.set(id, { ...was, status: STATUS.sent, sentAt, deliveries });
  return deliveries;
}

const destinations: Destination[] = [
  { id: "dest-1", name: "Accounting inbox", protocol: "email", config: { toAddresses: "accounting@example.test" }, hasCredentials: false, createdAt: T },
  { id: "dest-2", name: "Accounting API", protocol: "http", config: { method: "POST", url: "https://api.example.test/invoices" }, hasCredentials: true, createdAt: T },
];
const intakes: FlowIntake[] = [{
  id: "intake-1", kind: "email", config: {}, hasCredentials: false, isEnabled: true, address: "invoices@in.example.test",
  lastRunAt: null, lastStatus: null, lastMessage: null,
}];
const outputs: FlowOutput[] = [{
  id: MOCK_ENGINE_IDS.output, flowId: flow1.id, name: "Invoice CSV", format: "csv", tableKey: "lines", destinationId: "dest-1", createdAt: T, sendWhen: null,
  template: {
    format: "csv",
    root: {
      name: "row", nodeType: "object",
      children: [
        { name: "Invoice", nodeType: "field", rule: { outputPath: "Invoice", sourceToken: "invoice_no", fieldManipulators: [] } },
        { name: "Item", nodeType: "field", rule: { outputPath: "Item", sourceToken: "item_code", fieldManipulators: [] } },
      ],
    },
  },
}];
const preview: OutputPreview = {
  contentType: "text/csv", fileName: "invoice.csv", lookupMisses: [],
  content: `Invoice,Item\n${MOCK_DOCUMENT_NUMBER},A-100\n${MOCK_DOCUMENT_NUMBER},B-200\n${MOCK_DOCUMENT_NUMBER},C-300\n`,
};

const lookup: Lookup = {
  id: MOCK_ENGINE_IDS.lookup, name: "Item codes", updatedAt: T, candidates: [], suggestionsOn: false,
  entries: [{ from: "A-100", to: "SKU-1" }, { from: "B-200", to: "SKU-2" }, { from: "C-300", to: "SKU-3" }],
};
const LOOKUPS: Lookup[] = [
  lookup,
  { ...lookup, id: "lookup-2", name: "Units of measure", entries: [{ from: "PCS", to: "EA" }, { from: "KGM", to: "KG" }] },
  { ...lookup, id: "lookup-3", name: "Country codes", entries: [{ from: "Estonia", to: "EE" }, { from: "Finland", to: "FI" }] },
];
const summary = (l: Lookup): LookupSummary => ({ id: l.id, name: l.name, count: l.entries.length, updatedAt: T, hasCandidates: false, suggestionsOn: false });
const notifications: NotificationSettings = { email: null, onReview: true, onFailure: true };
const TEST_OK = { success: true, message: null, responseCode: 200 };

type Body = Record<string, unknown>;
type Handler = (m: string[], q: URLSearchParams, body: Body) => unknown;
// Same shape as the real backend's 404, so a screen takes its not-found path, not its network-failure one.
const missing = (what: string, id: string): never => {
  throw new ApiHttpError(`mock engine: no ${what} ${id}`, 404, { error: `${what}_not_found` });
};
const pick = <X extends { id: string }>(list: X[], id: string, what: string): X => list.find((x) => x.id === id) ?? missing(what, id);
const echo = <X extends object>(base: X, body: Body): X => ({ ...base, ...body });
const DOCUMENT_LIST_KEYS = ["flowId", "status", "take", "page", "pageSize", "sentFrom", "sentTo"];
/** An absent integer parameter is null; one the server could not bind is its 400. */
const intParam = (q: URLSearchParams, key: string): number | null => {
  const v = q.get(key);
  if (v === null) return null;
  if (!/^-?\d+$/.test(v)) throw new ApiHttpError(`mock engine: ${key} is not a number`, 400, null);
  return Number(v);
};
const S = "([^/]+)";
const re = (strings: TemplateStringsArray, ...rest: unknown[]) => new RegExp("^" + String.raw(strings, ...rest) + "$");

const samples: Record<string, DocumentSummary> = {};

const ROUTES: [method: string, pattern: RegExp, run: Handler][] = [
  ["GET", re`/flows`, () => FLOWS],
  ["POST", re`/flows`, (_m, _q, b) => echo({ ...flow2, id: "flow-new" }, b)],
  ["GET", re`/flows/${S}`, (m) => pick(FLOWS, m[1], "flow")],
  ["PATCH", re`/flows/${S}`, (m, _q, b) => echo(pick(FLOWS, m[1], "flow"), b)],
  ["POST", re`/flows/${S}/publish`, (m) => pick(FLOWS, m[1], "flow")],
  ["GET", re`/flows/${S}/versions`, (m) => (pick(FLOWS, m[1], "flow").publishedVersion ? versions : [])],
  ["POST", re`/flows/${S}/versions/\d+/restore`, (m) => pick(FLOWS, m[1], "flow")],
  ["PUT", re`/flows/${S}/fields`, (m, _q, b) => echo(pick(FLOWS, m[1], "flow"), { fields: b })],
  ["POST", re`/flows/${S}/documents`, (m) => ({ ...DOCS[0], flowId: pick(FLOWS, m[1], "flow").id, flowName: pick(FLOWS, m[1], "flow").name })],
  ["POST", re`/flows/${S}/documents/sample`, (m) => {
    const flow = pick(FLOWS, m[1], "flow");
    // Kept out of DOCS: the document list and its counts stay what the fixtures say until a screen asks.
    return (samples[flow.id] ??= { ...DOCS[0], id: `doc-sample-${flow.id}`, flowId: flow.id, flowName: flow.name, fileName: "invoice-2250.pdf" });
  }],
  ["GET", re`/documents`, (_m, q) => {
    // Like DocumentsController.List: newest first; a missing or empty status list is no filter; sent rows
    // landed in [sentFrom, sentTo). A key it does not implement fails loudly rather than being ignored.
    const unknown = [...q.keys()].find((k) => !DOCUMENT_LIST_KEYS.includes(k));
    if (unknown) throw new Error(`mock engine: GET /documents does not implement "${unknown}" yet`);
    const statuses = q.get("status")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const [from, to] = [q.get("sentFrom"), q.get("sentTo")].map((t) => (t === null ? null : Date.parse(t)));
    const landed = (at: string | null) => (from === null && to === null)
      || (at !== null && (from === null || Date.parse(at) >= from) && (to === null || Date.parse(at) < to));
    const rows = ROWS.map(live).filter((d) => (!q.get("flowId") || d.flowId === q.get("flowId"))
      && (!statuses.length || statuses.includes(d.status)) && landed(d.sentAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const clamp = (key: string) => Math.min(Math.max(intParam(q, key) ?? 50, 1), 200);
    const page = intParam(q, "page");
    if (page === null) return rows.slice(0, clamp("take")).map(summaryOf);
    if (page < 1) throw new ApiHttpError(`mock engine: page ${page}`, 400, null);
    const pageSize = clamp("pageSize");
    return { items: rows.slice((page - 1) * pageSize, page * pageSize), totalCount: rows.length, page, pageSize, sampleCount: 0 };
  }],
  ["GET", re`/documents/${S}`, (m) => detail(m[1])],
  ["PATCH", re`/documents/${S}/values`, (m, _q, b) => editValues(m[1], b)],
  ["POST", re`/documents/${S}/teach`, (m) => detail(m[1])],
  ["GET", re`/documents/${S}/history`, (m) => {
    pick(DOCS, m[1], "document");
    return [{ action: "received", at: "2026-05-20T09:00:00Z", userId: null, payload: null }, { action: "read", at: "2026-05-20T09:01:00Z", userId: null, payload: null }];
  }],
  ["POST", re`/documents/${S}/retry-read`, (m) => summaryOf(live(pick(ROWS, m[1], "document")))],
  ["POST", re`/documents/${S}/send`, (m) => send(m[1])],
  ["GET", re`/documents/${S}/deliveries`, (m) => now(m[1]).deliveries ?? []],
  ["POST", re`/documents/${S}/outputs/test`, () => TEST_OK],
  ["POST", re`/documents/${S}/outputs/${S}/preview`, (m, q) => {
    pick(DOCS, m[1], "document"); pick(outputs, m[2], "output");
    return q.get("suggest") ? { suggestions: [] } : preview;
  }],
  ["GET", re`/destinations`, () => destinations],
  ["POST", re`/destinations`, (_m, _q, b) => echo(destinations[0], b)],
  ["PUT", re`/destinations/${S}`, (m, _q, b) => echo(pick(destinations, m[1], "destination"), b)],
  ["DELETE", re`/destinations/${S}`, () => undefined],
  ["POST", re`/destinations/${S}/test`, () => TEST_OK],
  ["GET", re`/notification-settings`, () => notifications],
  ["PUT", re`/notification-settings`, (_m, _q, b) => echo(notifications, b)],
  ["GET", re`/flows/${S}/intakes`, (m) => (m[1] === flow1.id ? intakes : [])],
  ["POST", re`/flows/${S}/intakes`, (_m, _q, b) => echo(intakes[0], b)],
  ["PUT", re`/flows/${S}/intakes/${S}`, (_m, _q, b) => echo(intakes[0], b)],
  ["DELETE", re`/flows/${S}/intakes/${S}`, () => undefined],
  ["POST", re`/flows/${S}/intakes/${S}/new-address`, () => intakes[0]],
  ["POST", re`/flows/${S}/intakes/${S}/test`, () => TEST_OK],
  ["GET", re`/flows/${S}/outputs`, (m) => (m[1] === flow1.id ? outputs : [])],
  ["POST", re`/flows/${S}/outputs`, (_m, _q, b) => echo(outputs[0], b)],
  ["PUT", re`/flows/${S}/outputs/${S}`, (m, _q, b) => echo(pick(outputs, m[2], "output"), b)],
  ["DELETE", re`/flows/${S}/outputs/${S}`, () => undefined],
  ["PUT", re`/flows/${S}/outputs/${S}/logo`, () => undefined],
  ["DELETE", re`/flows/${S}/outputs/${S}/logo`, () => undefined],
  ["GET", re`/lookups`, () => LOOKUPS.map(summary)],
  ["POST", re`/lookups`, (_m, _q, b) => echo({ ...lookup, id: "lookup-new", entries: [] }, b)],
  ["GET", re`/lookups/${S}`, (m) => pick(LOOKUPS, m[1], "lookup")],
  ["PUT", re`/lookups/${S}`, (m, _q, b) => echo(pick(LOOKUPS, m[1], "lookup"), b)],
  ["DELETE", re`/lookups/${S}`, () => undefined],
];

// The original is served by file name, like the real download: a `.pdf` document gets real PDF bytes,
// so pdf.js renders it in the browser; everything else is the fixture CSV.
const BLOBS: [RegExp, (m: string[]) => Blob][] = [
  [re`/documents/${S}/source`, (m) => {
    const name = pick(DOCS, m[1], "document").fileName;
    return name.endsWith(".pdf") ? mockSourceBytesForKey(name)!.blob : new Blob([CSV], { type: "text/csv" });
  }],
  [re`/documents/${S}/deliveries/${S}/file`, () => new Blob([preview.content], { type: "text/csv" })],
];

function bodyOf(init?: RequestInit): Body {
  if (typeof init?.body !== "string") return {};
  try { return JSON.parse(init.body) as Body; } catch { return {}; }
}

/** Mock-only: masks a self-healing hydration race on /upload that plan 13b removes with the legacy branch. */
const MOCK_LATENCY_MS = 120;

export async function mockEngineFetch<T>(path: string, init?: RequestInit, as: "json" | "blob" = "json"): Promise<T> {
  // Same latency as the legacy mock client: an instant answer lands before a lazily hydrated screen
  // mounts, so the engine flag reads "on" on the client while the server rendered "unknown".
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
  const method = (init?.method ?? "GET").toUpperCase();
  const [pathname, query = ""] = path.split("?");
  if (as === "blob" && method === "GET") {
    for (const [pattern, run] of BLOBS) {
      const m = pattern.exec(pathname);
      if (m) return run(m) as T;
    }
    throw new Error(`mock engine: no file fixture for ${pathname}`);
  }
  for (const [verb, pattern, run] of ROUTES) {
    const m = verb === method ? pattern.exec(pathname) : null;
    if (m) return run(m, new URLSearchParams(query), bodyOf(init)) as T;
  }
  throw new Error(`mock engine: no fixture for ${method} ${pathname}`);
}
