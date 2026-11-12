/**
 * mockEngine.ts — fixtures for the document engine in mock mode (`documents.ts` `apiFetch` seam).
 *
 * GETs serve fixed generic data. A write resolves with an echo and persists nothing. An unknown
 * path or method throws, so a screen calling an endpoint with no fixture shows its error state
 * instead of an empty success. Only reachable when `isApiMockMode` (never true in production).
 */
import { DOCUMENT_STATUSES } from "../documentStatusManifest";
import type {
  Destination, DocumentDelivery, DocumentDetail, DocumentSummary, Flow, FlowField, FlowIntake, FlowOutput,
  FlowVersion, Lookup, LookupSummary, NotificationSettings, OutputPreview, ReadCell, ReadResult,
} from "./documents";

export const MOCK_ENGINE_IDS = { flow: "flow-1", setupFlow: "flow-2", document: "doc-1", lookup: "lookup-1" } as const;

const STATUS = Object.fromEntries(Object.keys(DOCUMENT_STATUSES).map((k) => [k, k])) as Record<keyof typeof DOCUMENT_STATUSES, string>;
const T = "2026-05-20T09:00:00Z";

const CSV = [
  "Invoice no,Date,Supplier,Currency,Total,VAT",
  "INV-1001,2026-05-20,Example Supplier Ltd,EUR,1240.00,240.00",
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
const FLOWS = [flow1, flow2];
const versions: FlowVersion[] = [{ versionNo: 1, publishedAt: T, publishedBy: null, live: true }];

const cell = (value: string, r: number, c: number): ReadCell => ({
  value, confidence: 0.97, location: { page: null, box: null, address: `cell:r${r}c${c}` }, notOnPage: false, edited: false,
});
const values = ["INV-1001", "2026-05-20", "Example Supplier Ltd", "EUR", "1240.00", "240.00"];
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

const doc = (n: number, f: Flow, status: string, failedChecks = 0): DocumentSummary => ({
  id: `doc-${n}`, flowId: f.id, flowName: f.name, fileName: `invoice-${1000 + n}.csv`, status, statusReason: null, pageCount: null,
  billingUnits: 1, failedChecks, createdAt: `2026-05-2${n}T09:00:00Z`, source: "upload", sourceRef: null,
  flowVersion: f.publishedVersion ?? null,
});
const DOCS = [
  doc(1, flow1, STATUS.needs_review, 1),
  doc(2, flow1, STATUS.ready),
  doc(3, flow1, STATUS.sent),
  doc(4, flow2, STATUS.send_failed),
];
const detail = (s: DocumentSummary): DocumentDetail => ({
  summary: s, contentType: "text/csv", read, senderLabel: "Example Supplier Ltd",
  checks: s.failedChecks
    ? [{ code: "low_confidence", passed: false, fieldKey: "vat", message: "The VAT value was read with low confidence." }]
    : [{ code: "total_present", passed: true, fieldKey: "total", message: "Total found." }],
});

const delivery = (status: string, attempts: number, lastError: string | null, deliveredAt: string | null): DocumentDelivery => ({
  id: "dlv-1", outputName: "Invoice CSV", protocol: "email", status, attempts, lastError, fileName: "invoice.csv", deliveredAt,
});
const DELIVERIES: Record<string, DocumentDelivery[]> = {
  "doc-3": [delivery("delivered", 1, null, "2026-05-23T09:05:00Z")],
  "doc-4": [delivery("dead_letter", 3, "The mailbox refused the message.", null)],
};

const destinations: Destination[] = [
  { id: "dest-1", name: "Accounting inbox", protocol: "email", config: { to: "accounting@example.test" }, hasCredentials: false, createdAt: T },
  { id: "dest-2", name: "Accounting API", protocol: "http", config: { method: "POST", url: "https://api.example.test/invoices" }, hasCredentials: true, createdAt: T },
];
const intakes: FlowIntake[] = [{
  id: "intake-1", kind: "email", config: {}, hasCredentials: false, isEnabled: true, address: "invoices@in.example.test",
  lastRunAt: null, lastStatus: null, lastMessage: null,
}];
const outputs: FlowOutput[] = [{
  id: "out-1", flowId: flow1.id, name: "Invoice CSV", format: "csv", tableKey: "lines", destinationId: "dest-1", createdAt: T, sendWhen: null,
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
  content: "Invoice,Item\nINV-1001,A-100\nINV-1001,B-200\nINV-1001,C-300\n",
};

const lookup: Lookup = {
  id: MOCK_ENGINE_IDS.lookup, name: "Item codes", updatedAt: T, candidates: [], suggestionsOn: false,
  entries: [{ from: "A-100", to: "SKU-1" }, { from: "B-200", to: "SKU-2" }, { from: "C-300", to: "SKU-3" }],
};
const lookupSummary: LookupSummary = { id: lookup.id, name: lookup.name, count: lookup.entries.length, updatedAt: T, hasCandidates: false, suggestionsOn: false };
const notifications: NotificationSettings = { email: null, onReview: true, onFailure: true };
const TEST_OK = { success: true, message: null, responseCode: 200 };

type Body = Record<string, unknown>;
type Handler = (m: string[], q: URLSearchParams, body: Body) => unknown;
const missing = (what: string, id: string): never => { throw new Error(`mock engine: no ${what} ${id}`); };
const pick = <X extends { id: string }>(list: X[], id: string, what: string): X => list.find((x) => x.id === id) ?? missing(what, id);
const echo = <X extends object>(base: X, body: Body): X => ({ ...base, ...body });
const S = "([^/]+)";
const re = (strings: TemplateStringsArray, ...rest: unknown[]) => new RegExp("^" + String.raw({ raw: strings }, ...rest) + "$");

const ROUTES: [method: string, pattern: RegExp, run: Handler][] = [
  ["GET", re`/flows`, () => FLOWS],
  ["POST", re`/flows`, (_m, _q, b) => echo({ ...flow2, id: "flow-new" }, b)],
  ["GET", re`/flows/${S}`, (m) => pick(FLOWS, m[1], "flow")],
  ["PATCH", re`/flows/${S}`, (m, _q, b) => echo(pick(FLOWS, m[1], "flow"), b)],
  ["POST", re`/flows/${S}/publish`, (m) => pick(FLOWS, m[1], "flow")],
  ["GET", re`/flows/${S}/versions`, (m) => (pick(FLOWS, m[1], "flow").publishedVersion ? versions : [])],
  ["POST", re`/flows/${S}/versions/\d+/restore`, (m) => pick(FLOWS, m[1], "flow")],
  ["PUT", re`/flows/${S}/fields`, (m, _q, b) => echo(pick(FLOWS, m[1], "flow"), { fields: b })],
  ["POST", re`/flows/${S}/documents`, (m) => DOCS.find((d) => d.flowId === m[1]) ?? missing("flow", m[1])],
  ["GET", re`/documents`, (_m, q) => {
    const take = Number(q.get("take")) || DOCS.length;
    return DOCS.filter((d) => (!q.get("flowId") || d.flowId === q.get("flowId")) && (!q.get("status") || d.status === q.get("status"))).slice(0, take);
  }],
  ["GET", re`/documents/${S}`, (m) => detail(pick(DOCS, m[1], "document"))],
  ["PATCH", re`/documents/${S}/values`, (m) => detail(pick(DOCS, m[1], "document"))],
  ["POST", re`/documents/${S}/teach`, (m) => detail(pick(DOCS, m[1], "document"))],
  ["GET", re`/documents/${S}/history`, (m) => {
    pick(DOCS, m[1], "document");
    return [{ action: "received", at: "2026-05-20T09:00:00Z", userId: null, payload: null }, { action: "read", at: "2026-05-20T09:01:00Z", userId: null, payload: null }];
  }],
  ["POST", re`/documents/${S}/retry-read`, (m) => pick(DOCS, m[1], "document")],
  ["POST", re`/documents/${S}/send`, (m) => DELIVERIES[pick(DOCS, m[1], "document").id] ?? [delivery("queued", 0, null, null)]],
  ["GET", re`/documents/${S}/deliveries`, (m) => DELIVERIES[pick(DOCS, m[1], "document").id] ?? []],
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
  ["GET", re`/lookups`, () => [lookupSummary]],
  ["POST", re`/lookups`, (_m, _q, b) => echo({ ...lookup, id: "lookup-new", entries: [] }, b)],
  ["GET", re`/lookups/${S}`, (m) => pick([lookup], m[1], "lookup")],
  ["PUT", re`/lookups/${S}`, (m, _q, b) => echo(pick([lookup], m[1], "lookup"), b)],
  ["DELETE", re`/lookups/${S}`, () => undefined],
];

const BLOBS: [RegExp, () => string][] = [
  [re`/documents/${S}/source`, () => CSV],
  [re`/documents/${S}/deliveries/${S}/file`, () => preview.content],
];

function bodyOf(init?: RequestInit): Body {
  if (typeof init?.body !== "string") return {};
  try { return JSON.parse(init.body) as Body; } catch { return {}; }
}

export async function mockEngineFetch<T>(path: string, init?: RequestInit, as: "json" | "blob" = "json"): Promise<T> {
  // Same latency as the legacy mock client: an instant answer lands before a lazily hydrated screen
  // mounts, so the engine flag reads "on" on the client while the server rendered "unknown".
  await new Promise((resolve) => setTimeout(resolve, 120));
  const method = (init?.method ?? "GET").toUpperCase();
  const [pathname, query = ""] = path.split("?");
  if (as === "blob" && method === "GET") {
    for (const [pattern, run] of BLOBS) {
      const m = pattern.exec(pathname);
      if (m) { pick(DOCS, m[1], "document"); return new Blob([run()], { type: "text/csv" }) as T; }
    }
  }
  for (const [verb, pattern, run] of ROUTES) {
    const m = verb === method ? pattern.exec(pathname) : null;
    if (m) return run(m, new URLSearchParams(query), bodyOf(init)) as T;
  }
  throw new Error(`mock engine: no fixture for ${method} ${pathname}`);
}
