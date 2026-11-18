/**
 * mockEngine.ts — fixtures for the document engine in mock mode (`documents.ts` `apiFetch` seam).
 *
 * GETs serve fixed generic data. A write resolves with an echo and persists nothing, except for two
 * stateful parts, remembered for the life of the page: an upload, which is stored and read like the
 * server would (`upload` below), a document's edits and sends (`remembered` below), and lookups, whose
 * routes refuse what the server refuses (LookupsController / LookupRules). An unknown
 * path or method throws, so a screen calling an endpoint with no fixture shows its error state
 * instead of an empty success. Only reachable when `isApiMockMode` (never true in production).
 */
import { STATUS, documentStatus } from "../documentStatusManifest";
import { acceptFor, fileRefusal } from "../fileKinds";
import { LOOKUP_LIMITS } from "../lookupLimits";
import { ApiHttpError } from "./core";
import { REVIEW_CONFIDENCE } from "../reviewMarks";
import { mockSourceBytesForKey } from "./mockSourceDocument";
import type {
  Destination, DocumentCheck, DocumentDelivery, DocumentDetail, DocumentRow, DocumentSummary, EditValuesRequest, Flow, FlowField, FlowIntake, FlowOutput, FlowSummary,
  FlowVersion, Lookup, LookupCandidate, LookupEntry, LookupSummary, NotificationSettings, OutputPreview, ReadCell, ReadResult, SetUpResult,
} from "./documents";
import type { OutputNode } from "./types";
import { mockAuditPage } from "./mockAudit";
import { MOCK_SAMPLE_FILE, MOCK_STATE_KEY, mockWorkspaceOn, workspaceFetch } from "./mockWorkspace";

export const MOCK_ENGINE_IDS = { flow: "flow-1", setupFlow: "flow-2", document: "doc-1", lookup: "lookup-1", output: "out-1", inbox: "flow-inbox" } as const;
/** The document number every fixture read carries — specs assert against this, never a literal. */
export const MOCK_DOCUMENT_NUMBER = "INV-1001";

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
  // A draft waiting to be published, and a run of documents sent without a correction (the flow page shows both).
  publishedVersion: 1, hasChanges: true, noCorrectionStreak: 8, scansOn: true, formatsOn: true,
};
const flow2: Flow = {
  id: MOCK_ENGINE_IDS.setupFlow, name: "Delivery notes", fieldsConfirmed: false, documentCount: 1, createdAt: T,
  automation: "auto", fields: { fields: [], tables: [] }, publishedVersion: null, hasChanges: false, noCorrectionStreak: null,
  scansOn: true, formatsOn: true,
};
// Two more published flows: list screens need enough rows at phone width to clear
// the visual suite's "too little text to be a baseline" floor (tests/e2e/visual.spec.ts).
const quietFlow = (id: string, name: string, automation: Flow["automation"], documentCount: number): Flow =>
  ({ ...flow1, id, name, automation, documentCount, hasChanges: false, noCorrectionStreak: null });
const flow3 = quietFlow("flow-3", "Purchase orders", "review", 2);
const flow4 = quietFlow("flow-4", "Remittance advices", "auto", 1);
const FLOWS = [flow1, flow2, flow3, flow4];
/** The workspace's inbox. Never in FLOWS, so `GET /flows`, the flow limit and `pick(FLOWS, …)` never see it. */
const INBOX: Flow = { ...flow2, id: MOCK_ENGINE_IDS.inbox, name: "New documents", documentCount: 0, automation: "review" };
/** The kind each default flow's documents were read as. */
const KINDS: Record<string, string> = { [flow1.id]: "Invoice", [flow2.id]: "Delivery note", [flow3.id]: "Purchase order", [flow4.id]: "Remittance advice" };
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
/** The server takes kind and sender from the read: a row not read yet has neither. */
const UNREAD: readonly string[] = [STATUS.received, STATUS.reading, STATUS.read_failed];
const doc = (n: number, f: Flow, status: string, facts: Partial<DocumentRow> = {}): DocumentRow => ({
  id: `doc-${n}`, flowId: f.id, flowName: f.name, fileName: `invoice-${1000 + n}.csv`, status, statusReason: null, pageCount: null,
  billingUnits: 1, failedChecks: 0, createdAt: `2026-05-2${n}T09:00:00Z`, source: "upload", sourceRef: null,
  flowVersion: f.publishedVersion ?? null,
  number: null, sender: f === INBOX || UNREAD.includes(status) ? null : "Example Supplier Ltd", checks: [], sentAt: null, failedAt: null, stop: null, isSample: false,
  kind: UNREAD.includes(status) ? null : KINDS[f.id] ?? null, inInbox: f === INBOX,
  ...facts,
});
/** An inbox document no flow holds the kind of: it waits for a person. */
const NEW_KIND: Partial<DocumentRow> = { status: STATUS.needs_review, statusReason: "new_kind", checks: ["fields_unconfirmed"], failedChecks: 1 };
/** Sessions that set sessionStorage "proculink.mock.inbox" to "on" also get the inbox states below (read once per page load). */
const INBOX_ON = (() => { try { return sessionStorage.getItem("proculink.mock.inbox") === "on"; } catch { return false; } })();
const seed = (n: number, f: Flow, fileName: string, status: string, kind: string | null, sender: string | null, facts: Partial<DocumentRow> = {}) =>
  doc(0, f, status, { id: `doc-in-${n}`, fileName, kind, sender, createdAt: `2026-06-01T08:0${9 - n}:00Z`, ...facts });
/** Newest is `doc-7`. Three wait for review or sending (`doc-1`, `doc-2`, `doc-5`); two failed (`doc-4`, `doc-6`). */
const ROWS: DocumentRow[] = [
  doc(1, flow1, STATUS.needs_review, { failedChecks: 2, checks: ["low_confidence", "required_missing"], number: MOCK_DOCUMENT_NUMBER, sender: "Example Supplier Ltd" }),
  doc(2, flow1, STATUS.ready, { fileName: "invoice-1002.pdf", sender: "Example Supplier Ltd" }), // the one PDF: pdf.js e2e (document-pdf.spec.ts)
  doc(3, flow1, STATUS.sent, { sentAt: DOC_3_SENT_AT }),
  doc(4, flow2, STATUS.send_failed, {
    failedAt: "2026-05-24T09:10:00Z", stop: { destinationId: "dest-1", destination: "Accounting inbox", error: REFUSED },
  }),
  doc(5, flow3, STATUS.needs_review, { failedChecks: 1, checks: ["duplicate"] }),
  doc(6, flow4, STATUS.read_failed, { statusReason: "unreadable_file", failedAt: "2026-05-26T09:02:00Z" }),
  doc(7, flow3, STATUS.sent, { isSample: true, sentAt: DOC_7_SENT_AT }),
];
if (INBOX_ON) ROWS.push(
  seed(1, INBOX, "statement-0412.pdf", STATUS.needs_review, "Statement", "Example Bank Ltd", NEW_KIND),
  seed(2, INBOX, "invoice-7781.pdf", STATUS.needs_review, "Invoice", "Sample Traders Ltd", { ...NEW_KIND, statusReason: "choose_flow" }),
  seed(3, flow2, "delivery-note-5521.pdf", STATUS.needs_review, "Delivery note", "Example Freight Ltd", { statusReason: "check_sort" }),
  seed(4, INBOX, "price-list.xlsx", STATUS.sent, "Price list", "Example Supplier Ltd", { statusReason: "downloaded" }),
  seed(5, INBOX, "scan-0003.jpg", STATUS.read_failed, null, null, { statusReason: "unreadable_file", failedAt: "2026-06-01T08:04:00Z" }),
  seed(6, INBOX, "invoice-1002.pdf", STATUS.needs_review, null, null, { statusReason: "duplicate_file", checks: ["in_workspace"], failedChecks: 1 }),
  // flow-4 also holds an invoice (so doc-in-2 has two flows to choose from), with doc-in-2's file: moving it there holds it.
  seed(7, flow4, "invoice-7781.pdf", STATUS.sent, "Invoice", "Sample Traders Ltd", { sentAt: "2026-06-01T08:03:00Z" }),
);
/** What the bare list and every other summary carry: a row without the facts only pages send. */
const summaryOf = ({ number, sender, checks, sentAt, failedAt, stop, isSample, kind, inInbox, ...s }: DocumentRow): DocumentSummary => s;
const DOCS = ROWS.map(summaryOf);
const hardToRead = (key: string, label: string): DocumentCheck =>
  ({ code: "low_confidence", passed: false, fieldKey: key, message: `${label} was hard to read. Please check it.` });
const notFound = (key: string, label: string): DocumentCheck =>
  ({ code: "required_missing", passed: false, fieldKey: key, message: `${label} is required but was not found.` });
const FAILED_CHECKS: Record<string, DocumentCheck> = {
  low_confidence: hardToRead("date", "Date"),
  required_missing: notFound("supplier", "Supplier"),
  duplicate: { code: "duplicate", passed: false, fieldKey: null, message: "A document with this number was already received." },
  // The server's sentences (DocumentChecks, DocumentIntakeService.HoldAsDuplicateFile).
  fields_unconfirmed: { code: "fields_unconfirmed", passed: false, fieldKey: null, message: "The fields to read have not been confirmed yet." },
  in_workspace: { code: "duplicate", passed: false, fieldKey: null, message: "This file is already in your workspace." },
  duplicate_file: { code: "duplicate", passed: false, fieldKey: null, message: "This file was already uploaded to this flow." },
};
const detail = (id: string): DocumentDetail => {
  const row = live(pick(ROWS, id, "document"));
  const s = summaryOf(row);
  const st = now(id);
  return {
    summary: s, contentType: s.fileName.endsWith(".pdf") ? "application/pdf" : "text/csv", read: { ...st.read, kindLabel: row.kind ?? null }, senderLabel: row.sender ?? null,
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
  sortedBefore.clear();
  for (const [k, v] of SORTED_BEFORE) sortedBefore.set(k, v);
  try { sessionStorage.removeItem(MOCK_STATE_KEY); } catch { /* no store: nothing kept */ }
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
  const flow = row.flowId === INBOX.id ? INBOX : pick(FLOWS, row.flowId, "flow");
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
    return v.confidence < REVIEW_CONFIDENCE ? [hardToRead(f.key, f.label)] : [];
  }).concat(was.failed.filter((c) => c.code === "duplicate"), flow === INBOX ? [FAILED_CHECKS.fields_unconfirmed] : []);
  // A sort we were not sure of waits for the person while its reason stands, as the server does.
  const status = was.status === STATUS.send_failed ? was.status : failed.length || row.statusReason === "check_sort" ? STATUS.needs_review : STATUS.ready;
  remembered.set(id, { ...was, status, read: copy, failed });
  return detail(id);
}

/** Like DocumentSender.SendAsync, except that it lands straight on sent: each file delivered, or stored when it has no
 *  destination (R23). */
function send(id: string): DocumentDelivery[] {
  const row = pick(ROWS, id, "document");
  const was = now(id);
  if (!documentStatus(was.status, row.statusReason).editable) refuse(409, "not_ready");
  // A document whose delivery failed was sent once, so its flow had an output then: only one never sent can lack it.
  if (was.status !== STATUS.send_failed && !outputs.some((o) => o.flowId === row.flowId)) refuse(409, "no_outputs");
  // A person's Send confirms the sort: the reason goes and the choice is remembered, with no second sort row.
  if (row.statusReason === "check_sort") {
    setRow(id, { statusReason: null }, true);
    remember(row);
  }
  const sentAt = new Date().toISOString();
  // One row per file, as the server answers: a file with no destination is stored (it waits to be downloaded).
  const own = outputs.filter((o) => o.flowId === row.flowId);
  const deliveries = own.length ? own.map((o): DocumentDelivery => {
    const dest = destinations.find((d) => d.id === o.destinationId);
    return { ...delivery(dest ? "delivered" : "stored", dest ? 1 : 0, null, sentAt), outputName: o.name, protocol: dest?.protocol ?? "" };
  }) : [delivery("delivered", 1, null, sentAt)];
  remembered.set(id, { ...was, status: STATUS.sent, sentAt, deliveries });
  resent.add(id);
  return deliveries;
}

/** In name order, as the server lists them. */
const destinations: Destination[] = [
  {
    id: "dest-2", name: "Accounting API", protocol: "http", config: { method: "POST", url: "https://api.example.test/invoices" }, hasCredentials: true,
    createdAt: T, usedBy: [], lastSend: { kind: "test", at: "2026-06-01T08:02:00Z", ok: true },
  },
  {
    id: "dest-1", name: "Accounting inbox", protocol: "email", config: { toAddresses: "accounting@example.test" }, hasCredentials: false, createdAt: T,
    usedBy: [{ flowId: flow1.id, flowName: flow1.name, outputId: MOCK_ENGINE_IDS.output, outputName: "Invoice CSV" }],
    lastSend: { kind: "document", at: "2026-05-24T09:10:00Z", ok: false },
  },
  {
    id: "dest-3", name: "Accounting server", protocol: "sftp", hasCredentials: true, createdAt: T, usedBy: [], lastSend: null,
    config: { host: "sftp.example.test", port: 22, remotePath: "/in/invoices", makeDirectories: true, overwriteExisting: true, timeoutSeconds: 30 },
  },
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
        { name: "Item", nodeType: "field", rule: { outputPath: "Item", sourceToken: "item_code", fieldManipulators: [{ type: "Lookup", params: [MOCK_ENGINE_IDS.lookup, "keep"] }] } },
      ],
    },
  },
}];
// Download-only: no destination, so the flow list says "You download …".
outputs.push({
  ...outputs[0], id: "out-2", flowId: flow4.id, name: "Remittance sheet", format: "xlsx", destinationId: null,
  // Its own columns, with no lookup step: what uses a lookup stays the one flow whose output swaps a value.
  template: { format: "csv", root: { name: "row", nodeType: "object", children: [outputs[0].template.root.children![0]] } },
});
if (INBOX_ON) outputs.push({ ...outputs[1], id: "out-3", flowId: flow2.id, name: "CSV file", format: "csv", destinationId: null });
// The inbox has no flow routes on the server: they answer 404 flow_not_found. Other unknown ids keep these answers.
const intakesOf = (flowId: string) => (flowId === INBOX.id ? missing("flow", flowId) : flowId === flow1.id ? intakes : []);
const outputsOf = (flowId: string) => (flowId === INBOX.id ? missing("flow", flowId) : outputs.filter((o) => o.flowId === flowId));
/** The live setup's copy: out-1 has one column fewer and another title, so We send counts "2 changes not in use yet". */
const liveCopy = (o: FlowOutput): FlowOutput => o.id !== MOCK_ENGINE_IDS.output ? o
  : { ...o, layout: { title: "Invoices" }, template: { ...o.template, root: { ...o.template.root, children: o.template.root.children!.slice(0, -1) } } };
/** What the list carries per flow, derived from the fixtures above, never typed. */
const flowSummaryOf = (f: Flow): FlowSummary => {
  const rows = ROWS.filter((d) => d.flowId === f.id);
  const count = (statuses: readonly string[]) => rows.filter((d) => statuses.includes(d.status)).length;
  return {
    // The pair the server counts (FlowSummaries), named from the status constants, not from the screen's tabs.
    needsYou: count([STATUS.needs_review, STATUS.ready]), couldNotSend: count([STATUS.send_failed]), couldNotRead: count([STATUS.read_failed]),
    lastDocumentAt: rows.map((d) => d.createdAt).sort().at(-1) ?? null,
    waysIn: intakesOf(f.id).filter((i) => i.isEnabled).map((i) => i.kind),
    outputs: outputsOf(f.id).map((o) => ({
      name: o.name, format: o.format, standard: o.standard ?? null,
      destination: destinations.find((d) => d.id === o.destinationId)?.name ?? null,
    })),
  };
};
const preview: OutputPreview = {
  contentType: "text/csv", fileName: "invoice.csv", lookupMisses: [],
  content: `Invoice,Item\n${MOCK_DOCUMENT_NUMBER},A-100\n${MOCK_DOCUMENT_NUMBER},B-200\n${MOCK_DOCUMENT_NUMBER},C-300\n`,
};

// suggestionsOn is one workspace switch on the server, so every lookup carries the same value.
const lookup = (id: string, name: string, pairs: string[][]): Lookup => ({
  id, name, updatedAt: T, candidates: [], suggestionsOn: true, entries: pairs.map(([from, to]) => ({ from, to })),
});
const LOOKUPS: Lookup[] = [
  lookup("lookup-3", "Country codes", [["Estonia", "EE"], ["Finland", "FI"], ["Latvia", "LV"], ["Lithuania", "LT"]]),
  lookup(MOCK_ENGINE_IDS.lookup, "Item codes", [
    ["A-100", "SKU-1"], ["B-200", "SKU-2"], ["C-300", "SKU-3"],
    ...Array.from({ length: 117 }, (_, i) => [`ITEM-${1004 + i}`, `SKU-${4 + i}`]),
  ]),
  lookup("lookup-4", "Pallet types", []),
  lookup("lookup-2", "Units of measure", [["PCS", "EA"], ["KGM", "KG"]]),
];
let lookupsMade = 0;
const byName = <X extends { name: string }>(a: X, b: X) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const lookupSteps = (n: OutputNode | null | undefined): string[] =>
  n ? [...(n.rule?.fieldManipulators ?? []).filter((s) => s.type === "Lookup").map((s) => s.params[0]), ...(n.children ?? []).flatMap(lookupSteps)] : [];
/** As DocumentLookups.UsesAsync: each flow whose outputs have a Lookup step naming it, once, by flow name. */
const usedBy = (id: string) => FLOWS
  .filter((f) => outputs.some((o) => o.flowId === f.id && lookupSteps(o.template?.root).includes(id)))
  .sort(byName).map((f) => ({ flowId: f.id, flowName: f.name }));
const summary = (l: Lookup): LookupSummary => ({
  id: l.id, name: l.name, count: l.entries.length, updatedAt: l.updatedAt, hasCandidates: l.candidates.length > 0,
  suggestionsOn: l.suggestionsOn, usedBy: usedBy(l.id),
});
const invalid = (detail: string): never => {
  throw new ApiHttpError(`mock engine: ${detail}`, 422, { error: "lookup_invalid", detail });
};
/** As LookupRules.Problem / CandidateProblem: the first refusal of a list of values, or none. */
function checkValues(values: { value?: string | null; other?: string | null }[], tooMany: string, blank: string, suffix: string, otherMax: number, otherSentence: string) {
  const { rows, valueLength } = LOOKUP_LIMITS;
  if (values.length > rows) invalid(tooMany);
  const seen = new Set<string>();
  for (const { value, other } of values) {
    if (!value?.trim()) invalid(blank);   // a null value too, as the server answers 422
    if (value.length > valueLength) invalid(`Values can be at most ${valueLength} characters.`);
    if ((other?.length ?? 0) > otherMax) invalid(otherSentence);
    const k = value.trim().toLowerCase();
    if (seen.has(k)) invalid(`'${value.trim()}' appears more than once${suffix}.`);
    seen.add(k);
  }
}
/** As LookupsController.Apply: refuses a malformed body, otherwise the stored lookup. */
function applyLookup(l: Lookup, b: Body): Lookup {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > LOOKUP_LIMITS.nameLength) invalid(`The name must be 1 to ${LOOKUP_LIMITS.nameLength} characters.`);
  const entries = (b.entries ?? []) as Partial<LookupEntry>[];
  const V = LOOKUP_LIMITS.valueLength;
  checkValues(entries.map((e) => ({ value: e?.from, other: e?.to })), `A lookup holds at most ${LOOKUP_LIMITS.rows} entries.`,
    "Every entry needs a value to look for.", "", V, `Values can be at most ${V} characters.`);
  const candidates = b.candidates as Partial<LookupCandidate>[] | undefined;
  if (candidates) checkValues(candidates.map((c) => ({ value: c?.value, other: c?.description })), `A lookup can list at most ${LOOKUP_LIMITS.rows} values to choose from.`,
    "Each row in the list to choose from needs a value.", " in the list to choose from",
    LOOKUP_LIMITS.descriptionLength, `Descriptions can be at most ${LOOKUP_LIMITS.descriptionLength} characters.`);
  return {
    ...l, name, updatedAt: new Date().toISOString(),
    entries: entries.map((e) => ({ from: e.from!.trim(), to: e.to ?? "" })),
    candidates: candidates ? candidates.map((c) => ({ value: c.value!.trim(), description: c.description?.trim() || null })) : l.candidates,
  };
}
// Every /lookups route on the server takes no query; a screen sending one has a bug the mock must not hide.
const noQuery = (run: Handler): Handler => (m, q, b) => {
  if ([...q.keys()].length) throw new Error("mock engine: /lookups takes no parameters");
  return run(m, q, b);
};
/** Stores `l` in place of the lookup with its id, or as a new one; answers a copy, as JSON off the wire would be. */
const storeLookup = (l: Lookup) => {
  const i = LOOKUPS.findIndex((x) => x.id === l.id);
  if (i < 0) LOOKUPS.push(l);
  else LOOKUPS[i] = l;
  return structuredClone(l);
};
const notifications: NotificationSettings = { email: "sam@example.test", onReview: true, onFailure: true };
const TEST_OK = { success: true, message: null, responseCode: 200 };
const DESTINATION_TESTS: Record<string, typeof TEST_OK | { success: false; message: string; responseCode: null }> = {
  "dest-1": TEST_OK, "dest-2": TEST_OK, "dest-3": { success: false, message: "The server refused the login.", responseCode: null },
};
/** What a write answers: the server's shape, never a `credentials` key back. */
let created = 0;
const destinationOf = (base: Destination, b: Body): Destination => ({
  ...base, name: b.name as string, protocol: b.protocol as string, config: b.config as Record<string, unknown>,
  hasCredentials: base.hasCredentials || !!b.credentials,
});

type Body = Record<string, unknown>;
type Handler = (m: string[], q: URLSearchParams, body: Body) => unknown;
// Same shape as the real backend's 404, so a screen takes its not-found path, not its network-failure one.
const missing = (what: string, id: string): never => {
  throw new ApiHttpError(`mock engine: no ${what} ${id}`, 404, { error: `${what}_not_found` });
};
const pick = <X extends { id: string }>(list: X[], id: string, what: string): X => list.find((x) => x.id === id) ?? missing(what, id);
const echo = <X extends object>(base: X, body: Body): X => ({ ...base, ...body });
export const DOCUMENT_LIST_KEYS = ["flowId", "status", "take", "page", "pageSize", "sentFrom", "sentTo", "waitingOnDestination", "q"];
/** DocumentSearch.MaxTermLength: a longer term is cut (src/test/backendMirror.test.ts). */
export const SEARCH_TERM_MAX = 200;
/** Like DocumentSearch.Matches (DocumentSearch.cs): trimmed, cut, blank is no filter; the file name contains the term in any
 *  case, or the number does with whitespace removed and upper-cased (DocumentChecks.NormalizeNumber). Never the sender. */
const searchMatch = (raw: string | null): ((d: DocumentRow) => boolean) => {
  const term = raw?.trim().slice(0, SEARCH_TERM_MAX);
  if (!term) return () => true;
  const norm = (s: string) => s.replace(/\s/g, "").toUpperCase();
  return (d) => d.fileName.toLowerCase().includes(term.toLowerCase()) || (d.number !== null && norm(d.number).includes(norm(term)));
};
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
/** Documents sent again in this page load: they no longer wait on their destination. */
const resent = new Set<string>();

/** Sender and kind to the flow a person chose for them (Move it, Set it up, a Send that confirms): the next one is sorted there,
 *  certain. Seeded with what the fixture's sent invoices say: Example Supplier Ltd's invoices go to Supplier invoices. */
const SORTED_BEFORE: [string, string][] = [["Example Supplier Ltd|Invoice", flow1.id]];
const sortedBefore = new Map(SORTED_BEFORE);
const remember = (r: DocumentRow) => r.kind && sortedBefore.set(`${r.sender}|${r.kind}`, r.flowId);
/** The flows holding a document of this kind (as InboxController.SortFlows); none for an unknown kind. */
const flowsHolding = (kind: string | null | undefined) =>
  kind ? FLOWS.filter((f) => ROWS.some((d) => d.flowId === f.id && d.kind === kind && !d.isSample)) : [];

/** This page load's uploads: a second copy (same flow, name and size; for the inbox, any flow) is held; a first one reads 1.5 s later. */
const uploaded = new Set<string>();
/** What a read finds is worked out when it settles, as the server sorts at the end of the read (a set-up made meanwhile counts). */
const reads = new Map<string, { at: number; facts: () => Partial<DocumentRow> }>();
let uploads = 0;
/** Like `DocumentIntakeService.AcceptAsync`: the server's refusals in its order, then a stored row. */
const upload = (flow: Flow, body: Body): DocumentSummary => {
  const file = body.file;
  if (!(file instanceof File)) throw new Error("mock engine: an upload without a file is not implemented");
  const accept = acceptFor(flow);
  const refusal = fileRefusal(file, accept);
  if (refusal?.status === 415) throw new ApiHttpError(refusal.message, 415, { error: "unsupported_format", accepted: accept.replaceAll(".", "").split(",") });
  if (refusal) throw refusal;
  if (file.size === 0) throw new ApiHttpError("mock engine: empty file", 422, { error: "unreadable_file" });
  const key = `${flow.id}/${file.name}/${file.size}`;
  // A file added straight into a flow is held only when that flow has it; one added with no flow, when the workspace does (an
  // earlier upload of the same name and size, or a stored document of the same name in any flow). The sentence says which.
  const kept = (d: DocumentRow) => d.fileName === file.name && !d.isSample;
  const inFlow = flow !== INBOX && (uploaded.has(key) || ROWS.some((d) => kept(d) && d.flowId === flow.id));
  const held = flow !== INBOX ? inFlow : [...uploaded].some((k) => k.endsWith(`/${file.name}/${file.size}`)) || ROWS.some(kept);
  uploaded.add(key);
  const row = doc(0, flow, held ? STATUS.needs_review : STATUS.reading, {
    id: `doc-up-${++uploads}`, fileName: file.name, createdAt: new Date().toISOString(),
    ...(held && { statusReason: "duplicate_file", checks: [inFlow ? "duplicate_file" : "in_workspace"], failedChecks: 1, kind: null, sender: null }),
  });
  if (!held) reads.set(row.id, { at: Date.now() + 1500, facts: () => flow === INBOX ? sortFacts(file.name) : { kind: KINDS[flow.id] ?? null, sender: "Example Supplier Ltd", ...readFacts(file.name) } });
  ROWS.push(row);
  DOCS.push(summaryOf(row));
  return { ...summaryOf(row), status: held ? row.status : STATUS.received };
};
const readFacts = (name: string): Partial<DocumentRow> =>
  name.toLowerCase().endsWith(".csv") ? { status: STATUS.ready } : { status: STATUS.needs_review, failedChecks: 1, checks: ["low_confidence"] };
/** What the read finds, by file name, then where the server's sort puts it: certain where a person chose for this sender and kind;
 *  else to the one flow holding the kind (not certain), or it waits in the inbox (no flow: new kind; several: choose a flow). */
const sortFacts = (name: string): Partial<DocumentRow> => {
  const n = name.toLowerCase();
  const [kind, sender]: [string | null, string | null] = n.includes("invoice") ? ["Invoice", "Example Supplier Ltd"]
    : n.includes("delivery") || n.includes("cmr") ? ["Delivery note", "Example Freight Ltd"]
    : n.includes("statement") ? ["Statement", "Example Bank Ltd"] : [null, null];
  const to = (f: Flow, facts: Partial<DocumentRow>) => ({ flowId: f.id, flowName: f.name, kind, sender, inInbox: false, ...facts });
  const chosen = kind ? FLOWS.find((f) => f.id === sortedBefore.get(`${sender}|${kind}`)) : undefined;
  if (chosen) return to(chosen, readFacts(n));
  const fit = flowsHolding(kind);
  if (fit.length === 1) return to(fit[0], { status: STATUS.needs_review, statusReason: "check_sort" });
  return { kind, sender, ...NEW_KIND, ...(fit.length > 1 && { statusReason: "choose_flow" }) };
};
/** A row's new facts, in ROWS and DOCS both. A person's edits are kept under the new status with `keep`, otherwise dropped. */
const setRow = (id: string, facts: Partial<DocumentRow>, keep = false): DocumentRow => {
  const row = Object.assign(pick(ROWS, id, "document"), facts);
  Object.assign(pick(DOCS, id, "document"), summaryOf(row));
  const was = remembered.get(id);
  if (was && keep) remembered.set(id, { ...was, status: facts.status ?? was.status });
  else remembered.delete(id);
  return row;
};
/** A row whose read time has come takes its read facts. Until then it answers as `reading` (or `received`, after a move). */
const settleReads = () => {
  for (const [id, { at, facts: read }] of reads) {
    if (Date.now() < at) continue;
    const from = pick(ROWS, id, "document").flowId;
    const facts = read();
    const row = setRow(id, facts);
    if (facts.flowId) log(id, "document.sorted", { fromFlowId: from, flowId: row.flowId, flow: row.flowName, certain: row.statusReason !== "check_sort", duplicateFile: false, newFlow: false }, null);
    reads.delete(id);
  }
};

/** Each document's history written in this page load, after the fixture's two rows. */
const logged = new Map<string, { action: string; at: string; userId: string | null; payload: Body }[]>();
const log = (id: string, action: string, payload: Body, userId: string | null = "user_member_a") =>
  logged.set(id, [...(logged.get(id) ?? []), { action, at: new Date().toISOString(), userId, payload }]);
/** Like InboxController.Move's guard: only a document that needs review or is ready, and is editable, moves. */
const movable = (row: DocumentRow) => {
  const status = now(row.id).status;
  return (status === STATUS.needs_review || status === STATUS.ready) && documentStatus(status, row.statusReason).editable;
};
/** Puts the document in `to`: held as a duplicate when that flow already has the same file, otherwise read there 1.5 s later. */
const place = (row: DocumentRow, to: Flow, newFlow: boolean) => {
  const duplicateFile = ROWS.some((d) => d.id !== row.id && d.flowId === to.id && d.fileName === row.fileName && !d.isSample);
  log(row.id, "document.moved", { fromFlowId: row.flowId, flowId: to.id, flow: to.name, certain: true, duplicateFile, newFlow });
  const hold = duplicateFile ? { status: STATUS.needs_review, statusReason: "duplicate_file", checks: ["duplicate_file"], failedChecks: 1 } : null;
  setRow(row.id, { flowId: to.id, flowName: to.name, inInbox: false, ...(hold ?? { status: STATUS.received, statusReason: null, checks: [], failedChecks: 0 }) });
  if (!hold) reads.set(row.id, { at: Date.now() + 1500, facts: () => readFacts(row.fileName) });
  remember(row);
  follow(row, to);
  return summaryOf(live(row));
};
/** As the server's re-sort after a person's choice: the other inbox documents of this kind still waiting go to `to`, not certain. */
const follow = (row: DocumentRow, to: Flow) => {
  for (const d of ROWS.filter((x) => x.id !== row.id && x.flowId === INBOX.id && !!row.kind && x.kind === row.kind && (x.statusReason === "new_kind" || x.statusReason === "choose_flow"))) {
    log(d.id, "document.sorted", { fromFlowId: INBOX.id, flowId: to.id, flow: to.name, certain: false, duplicateFile: false, newFlow: false }, null);
    setRow(d.id, { flowId: to.id, flowName: to.name, inInbox: false, statusReason: "check_sort", checks: [], failedChecks: 0 }, true); // a person's edits go with it
  }
};
/** Like InboxController.Move: refusals in its order; the flow it is already in confirms the sort. */
function moveTo(id: string, b: Body): DocumentSummary {
  settleReads();
  const row = pick(ROWS, id, "document");
  const to = FLOWS.find((f) => f.id === b.flowId) ?? missing("flow", String(b.flowId));
  if (!movable(row)) refuse(409, "not_movable");
  if (to.id !== row.flowId) return place(row, to, false);
  remember(row);
  return summaryOf(live(setRow(id, { statusReason: row.statusReason === "check_sort" ? null : row.statusReason }, true)));
}
let setUps = 0;
/** Like InboxController.SetUp: a new flow, with its "CSV file" output, named as asked or after the kind; a taken name gets " 2". */
function setUp(id: string, b: Body): SetUpResult {
  settleReads();
  const row = pick(ROWS, id, "document");
  if (row.flowId !== INBOX.id) refuse(409, "not_in_inbox");
  if (!movable(row)) refuse(409, "not_movable");
  if (typeof b.name === "string" && !b.name.trim()) refuse(400, "invalid_name");
  const asked = typeof b.name === "string" ? b.name.trim() : !row.kind ? "Documents" : row.kind.endsWith("s") ? row.kind : `${row.kind}s`;
  const taken = new Set([...FLOWS, INBOX].map((f) => f.name.toLowerCase()));
  let name = asked;
  for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${asked} ${n}`;
  const flow: Flow = { ...flow1, id: `flow-set-up-${++setUps}`, name, documentCount: 1, createdAt: new Date().toISOString(), publishedVersion: null, hasChanges: false, noCorrectionStreak: null };
  FLOWS.push(flow);
  outputs.push({ ...outputs[1], id: `out-${flow.id}`, flowId: flow.id, name: "CSV file", format: "csv", destinationId: null });
  return { flowId: flow.id, flowName: name, document: place(row, flow, true) };
}
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** Like InboxController.Download: refusals in its order; the first download marks it downloaded, a second one writes nothing. */
function download(id: string, b: Body): Blob {
  settleReads();
  const row = pick(ROWS, id, "document");
  if (row.flowId !== INBOX.id) refuse(409, "not_in_inbox");
  const status = now(id).status;
  const downloaded = status === STATUS.sent && row.statusReason === "downloaded";
  if (row.statusReason === "duplicate_file" || !(downloaded || status === STATUS.needs_review || status === STATUS.ready)) refuse(409, "not_read");
  if (b.format !== "xlsx" && b.format !== "csv") refuse(400, "invalid_format");
  if (!downloaded) {
    log(id, "document.downloaded", { format: b.format });
    setRow(id, { status: STATUS.sent, statusReason: "downloaded" }, true);
  }
  return new Blob([CSV], { type: b.format === "csv" ? "text/csv" : XLSX });
}
let inboxAddresses = 0;
const inboxAnswer = () => ({
  flowId: INBOX.id, address: `documents-${(0x7f3a + inboxAddresses).toString(16)}@inbound.example.test`, intakeId: "intake-inbox", scansOn: true, formatsOn: true,
});

/** The mock has no deliveries, so never put in use is the whole rule (FlowDeletion also refuses a flow that sent). */
const deletable = (f: Flow) => f.publishedVersion == null;

const ROUTES: [method: string, pattern: RegExp, run: Handler][] = [
  // Like the server's list: a summary per flow, and none of the single response's draft facts.
  ["GET", re`/flows`, () => FLOWS.map((f) => ({ ...f, hasChanges: false, noCorrectionStreak: null, summary: flowSummaryOf(f) }))],
  ["POST", re`/flows`, (_m, _q, b) => echo({ ...flow2, id: "flow-new" }, b)],
  ["GET", re`/flows/${S}`, (m) => { const f = pick(FLOWS, m[1], "flow"); return { ...f, summary: null, canDelete: deletable(f) }; }],
  ["DELETE", re`/flows/${S}`, (m) => {
    const f = pick(FLOWS, m[1], "flow");
    if (!deletable(f)) refuse(409, "flow_in_use");   // as FlowDeletion
    FLOWS.splice(FLOWS.indexOf(f), 1);
    for (let i = ROWS.length - 1; i >= 0; i--) if (ROWS[i].flowId === f.id) ROWS.splice(i, 1);   // its documents go too
  }],
  ["PATCH", re`/flows/${S}`, (m, _q, b) => echo(pick(FLOWS, m[1], "flow"), b)],
  ["POST", re`/flows/${S}/publish`, (m) => {
    const flow = pick(FLOWS, m[1], "flow");
    if (flow.publishedVersion != null && !flow.hasChanges) refuse(409, "nothing_to_publish");   // as FlowVersions.PublishAsync
    return { ...flow, publishedVersion: (flow.publishedVersion ?? 0) + 1, hasChanges: false };
  }],
  ["GET", re`/flows/${S}/versions`, (m) => (pick(FLOWS, m[1], "flow").publishedVersion ? versions : [])],
  ["POST", re`/flows/${S}/versions/(\d+)/restore`, (m) => {
    const flow = pick(FLOWS, m[1], "flow");
    return { ...flow, hasChanges: Number(m[2]) !== flow.publishedVersion };
  }],
  ["PUT", re`/flows/${S}/fields`, (m, _q, b) => echo(pick(FLOWS, m[1], "flow"), { fields: b })],
  ["POST", re`/flows/${S}/documents`, (m, _q, b) => upload(pick(FLOWS, m[1], "flow"), b)],
  ["POST", re`/flows/${S}/documents/sample`, (m) => {
    const flow = pick(FLOWS, m[1], "flow");
    // One per flow, as the server: made once, then listed as a sample and counted on its flow.
    if (!samples[flow.id]) {
      const row = doc(0, flow, STATUS.needs_review, { id: `doc-sample-${flow.id}`, fileName: MOCK_SAMPLE_FILE, isSample: true });
      ROWS.push(row);
      DOCS.push(summaryOf(row));
      flow.documentCount++;
      samples[flow.id] = summaryOf(row);
    }
    return samples[flow.id];
  }],
  ["GET", re`/documents`, (_m, q) => {
    settleReads();
    // Like DocumentsController.List: newest first; a missing or empty status list is no filter; sent rows
    // landed in [sentFrom, sentTo). A key it does not implement fails loudly rather than being ignored.
    // `waitingOnDestination`: stopped at that destination; the mock's deliveries carry no destination, so the
    // row's stop stands for its dead letter. A document sent again in this page load no longer waits.
    const unknown = [...q.keys()].find((k) => !DOCUMENT_LIST_KEYS.includes(k));
    if (unknown) throw new Error(`mock engine: GET /documents does not implement "${unknown}" yet`);
    const statuses = q.get("status")?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const [from, to] = [q.get("sentFrom"), q.get("sentTo")].map((t) => (t === null ? null : Date.parse(t)));
    const landed = (at: string | null) => (from === null && to === null)
      || (at !== null && (from === null || Date.parse(at) >= from) && (to === null || Date.parse(at) < to));
    const dest = q.get("waitingOnDestination");
    const waiting = (d: DocumentRow) => dest === null
      || (d.status === STATUS.send_failed && d.stop?.destinationId === dest && !resent.has(d.id));
    const found = searchMatch(q.get("q"));
    const rows = ROWS.map(live).filter((d) => (!q.get("flowId") || d.flowId === q.get("flowId"))
      && (!statuses.length || statuses.includes(d.status)) && landed(d.sentAt) && waiting(d) && found(d))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    const clamp = (key: string) => Math.min(Math.max(intParam(q, key) ?? 50, 1), 200);
    const page = intParam(q, "page");
    if (page === null) return rows.slice(0, clamp("take")).map(summaryOf);
    if (page < 1) throw new ApiHttpError(`mock engine: page ${page}`, 400, null);
    const pageSize = clamp("pageSize");
    return { items: rows.slice((page - 1) * pageSize, page * pageSize), totalCount: rows.length, page, pageSize, sampleCount: 0 };
  }],
  ["GET", re`/documents/${S}`, (m) => (settleReads(), detail(m[1]))],
  ["PATCH", re`/documents/${S}/values`, (m, _q, b) => editValues(m[1], b)],
  ["POST", re`/documents/${S}/teach`, (m) => (pick(ROWS, m[1], "document").flowId === INBOX.id ? refuse(409, "not_in_flow") : detail(m[1]))],
  ["GET", re`/documents/${S}/history`, (m) => {
    pick(DOCS, m[1], "document");
    return [{ action: "received", at: "2026-05-20T09:00:00Z", userId: null, payload: null }, { action: "read", at: "2026-05-20T09:01:00Z", userId: null, payload: null },
      ...(logged.get(m[1]) ?? [])];
  }],
  ["GET", re`/inbox`, inboxAnswer],
  ["POST", re`/inbox/new-address`, () => (inboxAddresses++, inboxAnswer())],
  ["POST", re`/documents`, (_m, _q, b) => upload(INBOX, b)],
  // As InboxController.SortFlows: the flows already holding a document of this one's kind, by name.
  ["GET", re`/documents/${S}/sort-flows`, (m) => {
    return flowsHolding(pick(ROWS, m[1], "document").kind).sort(byName).map(({ id, name }) => ({ id, name }));
  }],
  ["POST", re`/documents/${S}/move`, (m, _q, b) => moveTo(m[1], b)],
  ["POST", re`/documents/${S}/set-up`, (m, _q, b) => setUp(m[1], b)],
  ["POST", re`/documents/${S}/retry-read`, (m) => summaryOf(live(pick(ROWS, m[1], "document")))],
  ["POST", re`/documents/${S}/send`, (m) => send(m[1])],
  ["GET", re`/documents/${S}/deliveries`, (m) => now(m[1]).deliveries ?? []],
  ["POST", re`/documents/${S}/outputs/test`, () => TEST_OK],
  ["POST", re`/documents/${S}/outputs/${S}/preview`, (m, q) => {
    pick(DOCS, m[1], "document"); pick(outputs, m[2], "output");
    return q.get("suggest") ? { suggestions: [] } : preview;
  }],
  // A fresh array each time, as from the server: a write since shows on the next fetch.
  ["GET", re`/destinations`, () => destinations.map((d) => ({ ...d }))],
  // A created one is listed (in name order) and can be tested; a deleted one leaves the list, as on the server.
  ["POST", re`/destinations`, (_m, _q, b) => {
    const made = destinationOf({ id: `dest-new-${++created}`, name: "", protocol: "", config: {}, hasCredentials: false, createdAt: T, usedBy: [], lastSend: null }, b);
    destinations.push(made);
    destinations.sort((x, y) => x.name.localeCompare(y.name));
    DESTINATION_TESTS[made.id] = TEST_OK;
    return made;
  }],
  // A save is kept (a rename shows in the row on the next fetch, still in name order), as on the server.
  ["PUT", re`/destinations/${S}`, (m, _q, b) => {
    const i = destinations.indexOf(pick(destinations, m[1], "destination"));
    destinations[i] = destinationOf(destinations[i], b);
    const saved = destinations[i];
    destinations.sort((x, y) => x.name.localeCompare(y.name));
    return saved;
  }],
  ["DELETE", re`/destinations/${S}`, (m) => {
    const d = pick(destinations, m[1], "destination");
    if (d.usedBy.length) throw new ApiHttpError("mock engine: destination in use", 409, { error: "destination_in_use" });
    destinations.splice(destinations.indexOf(d), 1);
    return undefined;
  }],
  // A test moves the destination's "Last send", as the server records it.
  ["POST", re`/destinations/${S}/test`, (m) => {
    const d = pick(destinations, m[1], "destination");
    const result = DESTINATION_TESTS[d.id];
    d.lastSend = { kind: "test", at: new Date().toISOString(), ok: result.success };
    return result;
  }],
  ["GET", re`/notification-settings`, () => notifications],
  ["PUT", re`/notification-settings`, (_m, _q, b) => echo(notifications, b)],
  ["POST", re`/push-devices`, () => undefined],
  ["DELETE", re`/push-devices`, () => undefined],
  ["POST", re`/push-devices/check`, () => ({ saved: true })],
  ["POST", re`/push-devices/test`, () => undefined],
  ["GET", re`/flows/${S}/intakes`, (m) => intakesOf(m[1])],
  ["POST", re`/flows/${S}/intakes`, (_m, _q, b) => echo(intakes[0], b)],
  ["PUT", re`/flows/${S}/intakes/${S}`, (_m, _q, b) => echo(intakes[0], b)],
  ["DELETE", re`/flows/${S}/intakes/${S}`, () => undefined],
  ["POST", re`/flows/${S}/intakes/${S}/new-address`, () => intakes[0]],
  ["POST", re`/flows/${S}/intakes/${S}/test`, () => TEST_OK],
  ["GET", re`/flows/${S}/outputs`, (m, q) => (q.get("published") === "true" ? outputsOf(m[1]).map(liveCopy) : outputsOf(m[1]))],
  // A set-up flow keeps what is saved to it, so its first run can finish; other flows get the echo.
  ["POST", re`/flows/${S}/outputs`, (m, _q, b) => {
    if (!m[1].startsWith("flow-set-up-")) return echo(outputs[0], b);
    const made = { ...echo(outputs[0], b), id: `out-${m[1]}-${outputs.length}`, flowId: m[1] };
    outputs.push(made);
    return made;
  }],
  ["PUT", re`/flows/${S}/outputs/${S}`, (m, _q, b) => echo(pick(outputs, m[2], "output"), b)],
  ["DELETE", re`/flows/${S}/outputs/${S}`, () => undefined],
  ["PUT", re`/flows/${S}/outputs/${S}/logo`, () => undefined],
  ["DELETE", re`/flows/${S}/outputs/${S}/logo`, () => undefined],
  ["GET", re`/lookups`, noQuery(() => [...LOOKUPS].sort(byName).map(summary))],
  ["POST", re`/lookups`, noQuery((_m, _q, b) => {
    const made = applyLookup(lookup(`lookup-new-${lookupsMade + 1}`, "", []), b);
    lookupsMade++;
    return storeLookup(made);
  })],
  ["GET", re`/lookups/${S}`, noQuery((m) => structuredClone(pick(LOOKUPS, m[1], "lookup")))],
  // As the server: the save answers its time with 7 fraction digits, a later GET the same moment with fewer.
  ["PUT", re`/lookups/${S}`, noQuery((m, _q, b) => { const l = storeLookup(applyLookup(pick(LOOKUPS, m[1], "lookup"), b)); return { ...l, updatedAt: l.updatedAt.replace("Z", "0000Z") }; })],
  ["DELETE", re`/lookups/${S}`, noQuery((m) => {
    const l = pick(LOOKUPS, m[1], "lookup");
    if (usedBy(l.id).length) throw new ApiHttpError(`mock engine: lookup ${l.id} is in use`, 409, { error: "lookup_in_use" });
    LOOKUPS.splice(LOOKUPS.indexOf(l), 1);
    return undefined;
  })],
  ["GET", re`/audit`, (_m, q) => mockAuditPage(q, { docs: DOCS, numbers: { [MOCK_ENGINE_IDS.document]: MOCK_DOCUMENT_NUMBER } })],
];

// The original is served by file name, like the real download: a `.pdf` document gets real PDF bytes,
// so pdf.js renders it in the browser; everything else is the fixture CSV.
const BLOBS: [method: string, pattern: RegExp, run: (m: string[], body: Body) => Blob][] = [
  ["GET", re`/documents/${S}/source`, (m) => {
    const name = pick(DOCS, m[1], "document").fileName;
    return name.endsWith(".pdf") ? mockSourceBytesForKey(name)!.blob : new Blob([CSV], { type: "text/csv" });
  }],
  ["GET", re`/documents/${S}/deliveries/${S}/file`, () => new Blob([preview.content], { type: "text/csv" })],
  ["POST", re`/documents/${S}/download`, (m, b) => download(m[1], b)],
];

function bodyOf(init?: RequestInit): Body {
  if (init?.body instanceof FormData) return Object.fromEntries(init.body.entries());
  if (typeof init?.body !== "string") return {};
  try { return JSON.parse(init.body) as Body; } catch { return {}; }
}

/** Mock-only: masks a self-healing hydration race on /upload that plan 13b removes with the legacy branch. */
const MOCK_LATENCY_MS = 120;

export async function mockEngineFetch<T>(path: string, init?: RequestInit, as: "json" | "blob" = "json"): Promise<T> {
  // Same latency as the legacy mock client: an instant answer lands before a lazily hydrated screen
  // mounts, so the engine flag reads "on" on the client while the server rendered "unknown".
  await new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));
  // The mock runs in the browser, so offline it would still "work"; it fails as the network would.
  if (typeof navigator !== "undefined" && navigator.onLine === false) throw new TypeError("Failed to fetch");
  const method = (init?.method ?? "GET").toUpperCase();
  const [pathname, query = ""] = path.split("?");
  // Browser specs only (set by an init script): every call is logged, and an answer for "METHOD /path" replaces the fixture.
  const spy = typeof window === "undefined" ? undefined : (window as { __mockEngine?: { calls: string[]; answer?: Record<string, { refuse?: [number, string] } | object> } }).__mockEngine;
  spy?.calls.push(`${method} ${pathname}${typeof init?.body === "string" ? ` ${init.body}` : ""}`);
  const given = spy?.answer?.[`${method} ${pathname}`] as { refuse?: [number, string] } | undefined;
  if (given?.refuse) refuse(...given.refuse);
  if (given) return structuredClone(given) as T;
  if (mockWorkspaceOn()) {
    const owned = workspaceFetch(method, pathname, new URLSearchParams(query), bodyOf(init));
    if (owned) return owned.answer as T;
  }
  if (as === "blob") {
    for (const [verb, pattern, run] of BLOBS) {
      const m = verb === method ? pattern.exec(pathname) : null;
      if (m) return run(m, bodyOf(init)) as T;
    }
    throw new Error(`mock engine: no file fixture for ${pathname}`);
  }
  for (const [verb, pattern, run] of ROUTES) {
    const m = verb === method ? pattern.exec(pathname) : null;
    if (m) return structuredClone(run(m, new URLSearchParams(query), bodyOf(init))) as T; // a fresh copy per answer, as off the wire
  }
  throw new Error(`mock engine: no fixture for ${method} ${pathname}`);
}
