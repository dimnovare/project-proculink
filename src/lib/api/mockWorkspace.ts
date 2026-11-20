/**
 * mockWorkspace.ts — the empty-workspace mock: a second mock mode, on only when this tab sets
 * sessionStorage "proculink.mock.workspace" to "new" (plan 14.5, R27). It starts with no flow and
 * keeps what the person makes in sessionStorage, so a reload finds it again. It owns /flows,
 * /documents, /destinations and /linked-accounts; billing, lookups and the rest stay on the default
 * fixtures. Each route answers as its controller does; a route or parameter it does not implement
 * throws. Only reachable in mock mode (never in production). Holds invented data only.
 */
import { CHECK_MODES, type CheckMode } from "../deliveryMode";
import { STATUS, documentStatus } from "../documentStatusManifest";
import { filesOf } from "../flowWords";
import { acceptFor, fileRefusal } from "../fileKinds";
import { PLANS } from "../plans";
import { ApiHttpError } from "./core";
import { DOCUMENT_LIST_KEYS } from "./mockEngine";
import { mockSourceBytesForKey } from "./mockSourceDocument";
import type {
  Destination, DocumentDelivery, DocumentDetail, DocumentPage, DocumentRow, DocumentSummary, Flow, FlowField, FlowFieldList, FlowOutput,
  FlowSummary, ReadField, ReadResult,
} from "./documents";
import type { OutputNode, OutputNodeTemplate } from "./types";

/** The sample's file name, as SampleDocument.FileName on the server. */
export const MOCK_SAMPLE_FILE = "invoice-2250.pdf";

const MODE = "proculink.mock.workspace";
export const MOCK_STATE_KEY = "proculink.mock.state";
const REFUSE = "proculink.mock.refuse";
const GOOGLE = "proculink.mock.google";
/** Browser specs only: "on" makes every delivery fail, with the reason the server would give. */
const DELIVERY_FAILS = "proculink.mock.deliveryFails";
export const MOCK_DELIVERY_ERROR = "We couldn't make this file. Try again, or check the flow's files.";
const TRIAL = PLANS.find((p) => p.id === "pilot")!;

const session = (key: string): string | null => {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage.getItem(key); } catch { return null; }
};

/** True when this tab asked for an empty workspace: sessionStorage "proculink.mock.workspace" === "new". */
export function mockWorkspaceOn(): boolean {
  return session(MODE) === "new";
}

type WFlow = Flow & { dirty: boolean; live: FlowOutput[] };
type WDoc = DocumentRow & { gets: number; read: ReadResult | null };
interface State { n: number; flows: WFlow[]; docs: WDoc[]; outputs: FlowOutput[]; destinations: Destination[]; deliveries: Record<string, DocumentDelivery[]> }
const empty = (): State => ({ n: 0, flows: [], docs: [], outputs: [], destinations: [], deliveries: {} });

/** A blocked, missing or corrupt store reads as an empty workspace, never a crash. */
function load(): State {
  try {
    const s = JSON.parse(session(MOCK_STATE_KEY) ?? "null") as State | null;
    return s && ["flows", "docs", "outputs", "destinations"].every((k) => Array.isArray(s[k as keyof State])) ? { ...empty(), ...s } : empty();
  } catch { return empty(); }
}
function save(s: State) {
  try { sessionStorage.setItem(MOCK_STATE_KEY, JSON.stringify(s)); } catch { /* a blocked store: this page forgets */ }
}

const refuse = (status: number, body: Record<string, unknown>): never => {
  throw new ApiHttpError(`mock workspace: ${String(body.error)}`, status, body);
};
const find = <X extends { id: string }>(list: X[], id: string, what: string): X =>
  list.find((x) => x.id === id) ?? refuse(404, { error: `${what}_not_found` });

// The built-in sample (invented): nine values, one table, one value hard to read.
const at = (page: number) => ({ page, box: null, address: null });
const value = (label: string, v: string, type = "text", confidence = 0.97, meaning: string | null = null): ReadField => ({
  key: label.toLowerCase().replaceAll(" ", "_"), label, value: v, type, meaning, confidence, location: at(1), notOnPage: false, listed: true, edited: false,
});
const LINE_COLUMNS = ["Code", "Item", "Qty", "Price", "Amount"];
const LINES = [["KS-100", "Copy paper A4", "20", "24.50", "490.00"], ["KS-220", "Toner cartridge", "4", "168.35", "673.40"], ["KS-310", "Archive boxes", "10", "14.00", "140.00"]];
const readOf = (kindLabel: string): ReadResult => ({
  kindLabel, truncated: false,
  fields: [
    value("Invoice number", "INV-2250"), value("Date", "2026-11-21", "date"), value("Supplier", "Kestrel Supplies"),
    value("Supplier address", "Harbour Road 4, Turku"), value("Bill to", "Nordlys Trading"), value("Currency", "EUR"),
    value("Total", "1303.40", "number", 0.97, "total_net"), value("Payment terms", "30 days"), value("Reference", "2250-NT", "text", 0.62),
  ],
  tables: [{
    key: "lines", label: "Lines", listed: true,
    columns: LINE_COLUMNS.map((c) => ({ key: c.toLowerCase(), label: c, type: "text", meaning: c === "Amount" ? "line_amount" : null })),
    rows: LINES.map((row) => ({ cells: Object.fromEntries(row.map((v, i) => [LINE_COLUMNS[i].toLowerCase(), { value: v, confidence: 0.97, location: at(1), notOnPage: false, edited: false }])) })),
  }],
});
const NOTHING: ReadResult = { kindLabel: null, fields: [], tables: [], truncated: false };

const stem = (name: string) => name.replace(/\.[^.]+$/, "");
const TYPES: Record<string, string> = {
  pdf: "application/pdf", csv: "text/csv", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const typeOf = (name: string) => TYPES[name.split(".").pop()!.toLowerCase()] ?? "application/octet-stream";

/** As FlowSummaries.DownloadOnly: no output in use (the live ones once published) has a destination that exists. */
const downloadOnly = (f: WFlow, s: State) =>
  !(f.publishedVersion == null ? s.outputs.filter((o) => o.flowId === f.id) : f.live)
    .some((o) => s.destinations.some((d) => d.id === o.destinationId));
const flowOut = ({ dirty, live, ...f }: WFlow, s: State): Flow =>
  ({ ...f, hasChanges: dirty, documentCount: s.docs.filter((d) => d.flowId === f.id).length, downloadOnly: downloadOnly({ ...f, dirty, live }, s) });
/** As DocumentListRows: a sent row lists its stored or delivered files. The viewer is an admin, so nothing idle is refused. */
const rowOut = ({ gets, read, ...r }: WDoc, s: State): DocumentRow => ({
  ...r,
  files: r.status !== STATUS.sent ? [] : filesOf(s.deliveries[r.id]),
  duplicateOfAt: null,
  downloadOnly: downloadOnly(find(s.flows, r.flowId, "flow"), s),
  canRemove: true,
});
const summaryOut = ({ gets, read, number, sender, checks, sentAt, failedAt, stop, isSample, kind, inInbox, ...s }: WDoc): DocumentSummary => s;
/** As FlowSummaries: what the list carries per flow. */
const flowSummary = (f: WFlow, s: State): FlowSummary => {
  const rows = s.docs.filter((d) => d.flowId === f.id);
  const count = (...st: string[]) => rows.filter((d) => st.includes(d.status)).length;
  return {
    needsYou: count(STATUS.needs_review, STATUS.ready), couldNotSend: count(STATUS.send_failed), couldNotRead: count(STATUS.read_failed),
    lastDocumentAt: rows.map((d) => d.createdAt).sort().at(-1) ?? null, waysIn: [],
    outputs: s.outputs.filter((o) => o.flowId === f.id).map((o) => ({
      name: o.name, format: o.format, standard: o.standard ?? null, destination: s.destinations.find((d) => d.id === o.destinationId)?.name ?? null,
    })),
  };
};

/** As DocumentIntakeService: the trial limit first, then the kind and the size, then a stored, received row. */
function intake(s: State, flow: WFlow, name: string, file: File | null, isSample: boolean): DocumentSummary {
  const code = session(REFUSE);
  if (code) refuse(429, { error: code, plan: TRIAL.id, limit: TRIAL.orderLimit, upgradeUrl: "/settings" });
  if (file) {
    const accept = acceptFor(flow);
    const refusal = fileRefusal(file, accept);
    if (refusal?.status === 415) refuse(415, { error: "unsupported_format", accepted: accept.replaceAll(".", "").split(",") });
    if (refusal) throw refusal;
    if (file.size === 0) refuse(422, { error: "unreadable_file" });
  }
  const d: WDoc = {
    id: `doc-w${++s.n}`, flowId: flow.id, flowName: flow.name, fileName: name, status: STATUS.received, statusReason: null, pageCount: null,
    billingUnits: 1, failedChecks: 0, createdAt: new Date().toISOString(), source: "upload", sourceRef: null, flowVersion: flow.publishedVersion ?? null,
    number: null, sender: null, checks: [], sentAt: null, failedAt: null, stop: null, isSample, inInbox: false, gets: 0, read: null,
  };
  s.docs.push(d);
  return summaryOut(d);
}

/** received, then reading on the first look, then read: an "unreadable" name fails, a "blank" one reads nothing. */
function look(d: WDoc) {
  if (d.gets++ === 0) { if (d.status === STATUS.received) d.status = STATUS.reading; return; }
  if (d.status !== STATUS.reading) return;
  const name = d.fileName.toLowerCase();
  if (name.includes("unreadable")) Object.assign(d, { status: STATUS.read_failed, statusReason: "unreadable_file", failedAt: new Date().toISOString(), read: NOTHING });
  else Object.assign(d, { status: STATUS.needs_review, pageCount: 1, read: name.includes("blank") ? NOTHING : readOf(d.isSample ? "Invoice" : "Delivery note") });
}

const detail = (d: WDoc): DocumentDetail => ({ summary: summaryOut(d), contentType: typeOf(d.fileName), read: d.read ?? NOTHING, checks: [], senderLabel: null, canRemove: true });

/** As DefaultOutputTemplate.For: every flow field, then one table's columns; csv and xlsx head a column with its label. */
function defaultTemplate(fields: FlowFieldList, format: string, tableKey: string | null): OutputNodeTemplate {
  const byKey = format === "json" || format === "xml";
  const leaf = (f: FlowField): OutputNode => {
    const name = byKey ? f.key : f.label;
    return { name, nodeType: "field", rule: { outputPath: name, canonicalField: f.key, fieldManipulators: [] } };
  };
  const table = fields.tables.find((t) => tableKey === null || t.key === tableKey);
  const children = fields.fields.map(leaf);
  if (table) children.push({ name: table.key, nodeType: "array", collection: table.key, children: [{ name: "row", nodeType: "object", children: table.columns.map(leaf) }] });
  return { format: (format === "xlsx" ? "csv" : format) as OutputNodeTemplate["format"], root: { name: "document", nodeType: "object", children } };
}

/** As FlowOutputsController.Apply, for what this mode makes: a name, confirmed fields, a destination that exists. */
function applyOutput(s: State, flow: WFlow, o: FlowOutput, b: Body): FlowOutput {
  const name = typeof b.name === "string" ? b.name.trim() : "";
  if (name.length < 1 || name.length > 120) refuse(400, { error: "invalid_name" });
  if (!flow.fieldsConfirmed) refuse(409, { error: "fields_unconfirmed" });
  const destinationId = (b.destinationId as string | null | undefined) ?? null;
  if (destinationId && !s.destinations.some((d) => d.id === destinationId)) refuse(422, { error: "output_invalid", detail: "The destination does not exist." });
  const format = String(b.format ?? "csv");
  const tableKey = (b.tableKey as string | null | undefined) ?? null;
  flow.dirty = true;
  return Object.assign(o, {
    name, format, tableKey, destinationId, template: (b.template as OutputNodeTemplate | null) ?? defaultTemplate(flow.fields, format, tableKey),
    sendWhen: (b.sendWhen as FlowOutput["sendWhen"]) ?? null,
  });
}

const csvCell = (v: string | null) => (v && /[",\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v ?? "");
/** The read through an output's columns, as CSV: the values, repeated on one line per row of its table. */
function csvOf(read: ReadResult, template: OutputNodeTemplate | undefined): string {
  const nodes = template?.root.children ?? [];
  const leaves = nodes.filter((n) => n.nodeType === "field");
  const arr = nodes.find((n) => n.nodeType === "array");
  const columns = arr?.children?.[0]?.children ?? [];
  const t = read.tables.find((x) => x.key === arr?.collection);
  const values = leaves.map((n) => read.fields.find((f) => f.key === n.rule?.canonicalField)?.value ?? null);
  const lines = t?.rows.length ? t.rows.map((r) => [...values, ...columns.map((c) => r.cells[c.rule?.canonicalField ?? ""]?.value ?? null)]) : [values];
  return [[...leaves, ...columns].map((n) => n.name), ...lines].map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}

function send(s: State, d: WDoc): DocumentDelivery[] {
  if (!documentStatus(d.status, d.statusReason).editable) refuse(409, { error: "not_ready" });
  const flow = find(s.flows, d.flowId, "flow");
  if (!flow.live.length) refuse(409, { error: "no_outputs" });
  const fails = session(DELIVERY_FAILS) === "on";
  const deliveries = flow.live.map((o): DocumentDelivery => {
    const dest = s.destinations.find((x) => x.id === o.destinationId);
    return {
      id: `dlv-w${++s.n}`, outputName: o.name, protocol: dest?.protocol ?? "",
      status: fails ? "dead_letter" : dest ? "queued" : "stored", attempts: fails ? 1 : 0, lastError: fails ? MOCK_DELIVERY_ERROR : null,
      fileName: `${stem(d.fileName)}.${o.format}`, deliveredAt: dest || fails ? null : new Date().toISOString(), destination: dest?.name ?? null,
    };
  });
  s.deliveries[d.id] = deliveries;
  // As FlowDeliveryStatus.DocumentStatusFor: all stored is sent; one given up on is send_failed; else sending.
  const sent = deliveries.every((x) => x.status === "stored");
  const status = sent ? STATUS.sent : fails ? STATUS.send_failed : STATUS.sending;
  Object.assign(d, { status, sentAt: sent ? new Date().toISOString() : null });
  return deliveries;
}

const destinationOut = (d: Destination, s: State): Destination => ({
  ...d, usedBy: s.outputs.filter((o) => o.destinationId === d.id).map((o) => ({ flowId: o.flowId, flowName: find(s.flows, o.flowId, "flow").name, outputId: o.id, outputName: o.name })),
});
const applyDestination = (d: Destination, b: Body): Destination =>
  Object.assign(d, { name: String(b.name ?? "").trim(), protocol: String(b.protocol ?? ""), config: (b.config as Record<string, unknown>) ?? {}, hasCredentials: d.hasCredentials || !!b.credentials });

function documentList(s: State, q: URLSearchParams): DocumentSummary[] | DocumentPage {
  const unknown = [...q.keys()].find((k) => !DOCUMENT_LIST_KEYS.includes(k));
  if (unknown) throw new Error(`mock workspace: GET /documents does not implement "${unknown}" yet`);
  const statuses = q.get("status")?.split(",").map((x) => x.trim()).filter(Boolean) ?? [];
  const [from, to] = [q.get("sentFrom"), q.get("sentTo")].map((t) => (t === null ? null : Date.parse(t)));
  const dest = q.get("waitingOnDestination");
  const int = (k: string) => { const v = q.get(k); if (v !== null && !/^-?\d+$/.test(v)) refuse(400, { error: `${k}_invalid` }); return v === null ? null : Number(v); };
  const rows = s.docs.filter((d) => (!q.get("flowId") || d.flowId === q.get("flowId")) && (!statuses.length || statuses.includes(d.status))
    && ((from === null && to === null) || (d.sentAt !== null && (from === null || Date.parse(d.sentAt) >= from) && (to === null || Date.parse(d.sentAt) < to)))
    && (dest === null || (d.status === STATUS.send_failed && d.stop?.destinationId === dest)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  const clamp = (k: string) => Math.min(Math.max(int(k) ?? 50, 1), 200);
  const page = int("page");
  if (page === null) return rows.slice(0, clamp("take")).map(summaryOut);
  const size = clamp("pageSize");
  const p = Math.max(page, 1);
  // sampleCount is always 0 for documents on the server (only orders fill it).
  return { items: rows.slice((p - 1) * size, p * size).map((d) => rowOut(d, s)), totalCount: rows.length, page: p, pageSize: size, sampleCount: 0 };
}

type Body = Record<string, unknown>;
type Route = [method: string, pattern: RegExp, run: (m: string[], s: State, q: URLSearchParams, b: Body) => unknown];
const S = "([^/]+)";
const re = (strings: TemplateStringsArray, ...rest: unknown[]) => new RegExp("^" + String.raw(strings, ...rest) + "$");
const flowName = (raw: unknown) => {
  const name = typeof raw === "string" ? raw.trim() : "";
  return name.length >= 1 && name.length <= 120 ? name : refuse(400, { error: "invalid_name" });
};
const TEST_OK = { success: true, message: null, responseCode: 200 };

const ROUTES: Route[] = [
  ["GET", re`/flows`, (_m, s) => [...s.flows].reverse().map((f) => ({ ...flowOut(f, s), hasChanges: false, summary: flowSummary(f, s) }))],
  ["POST", re`/flows`, (_m, s, _q, b) => {
    if (TRIAL.flowLimit !== null && s.flows.length >= TRIAL.flowLimit) refuse(429, { error: "flow_limit_reached", plan: TRIAL.id, limit: TRIAL.flowLimit, upgradeUrl: "/settings" });
    const f: WFlow = {
      id: `flow-w${++s.n}`, name: flowName(b.name), fieldsConfirmed: false, fields: { fields: [], tables: [] }, documentCount: 0, createdAt: new Date().toISOString(),
      // As FlowsController.Create for an admin, which this mock's viewer is.
      automation: "marked", scansOn: true, formatsOn: false, docsOutputsOn: false, peppolOn: false, publishedVersion: null, hasChanges: false,
      noCorrectionStreak: null, summary: null, dirty: false, live: [],
    };
    s.flows.push(f);
    return flowOut(f, s);
  }],
  ["GET", re`/flows/${S}`, (m, s) => flowOut(find(s.flows, m[1], "flow"), s)],
  ["PATCH", re`/flows/${S}`, (m, s, _q, b) => {
    const f = find(s.flows, m[1], "flow");
    if (b.name == null && b.automation == null) refuse(400, { error: "invalid_name" });
    if (b.name != null) f.name = flowName(b.name);
    if (b.automation != null) f.automation = CHECK_MODES.some((x) => x.id === b.automation) ? b.automation as CheckMode : refuse(422, { error: "invalid_automation" });
    return flowOut(f, s);
  }],
  ["PUT", re`/flows/${S}/fields`, (m, s, _q, b) => {
    const f = find(s.flows, m[1], "flow");
    Object.assign(f, { fields: { fields: b.fields ?? [], tables: b.tables ?? [] }, fieldsConfirmed: true, dirty: true });
    return flowOut(f, s);
  }],
  ["POST", re`/flows/${S}/publish`, (m, s) => {
    const f = find(s.flows, m[1], "flow");
    if (f.publishedVersion != null && !f.dirty) refuse(409, { error: "nothing_to_publish" });
    Object.assign(f, { publishedVersion: (f.publishedVersion ?? 0) + 1, dirty: false, live: s.outputs.filter((o) => o.flowId === f.id) });
    return flowOut(f, s);
  }],
  ["GET", re`/flows/${S}/versions`, (m, s) => {
    const v = find(s.flows, m[1], "flow").publishedVersion;
    return v ? Array.from({ length: v }, (_, i) => ({ versionNo: v - i, publishedAt: new Date().toISOString(), publishedBy: null, live: i === 0 })) : [];
  }],
  ["GET", re`/flows/${S}/intakes`, (m, s) => (find(s.flows, m[1], "flow"), [])],
  ["POST", re`/flows/${S}/documents`, (m, s, _q, b) => {
    const f = find(s.flows, m[1], "flow");
    if (!(b.file instanceof File)) throw new Error("mock workspace: an upload without a file is not implemented");
    return intake(s, f, b.file.name, b.file, false);
  }],
  // As DocumentsController.Sample: at most one per flow; asking again answers the same document.
  ["POST", re`/flows/${S}/documents/sample`, (m, s) => {
    const f = find(s.flows, m[1], "flow");
    const had = s.docs.find((d) => d.flowId === f.id && d.isSample);
    return had ? summaryOut(had) : intake(s, f, MOCK_SAMPLE_FILE, null, true);
  }],
  ["GET", re`/flows/${S}/outputs`, (m, s, q) => {
    if ([...q.keys()].some((k) => k !== "published")) throw new Error("mock workspace: GET /flows/{id}/outputs takes only \"published\"");
    const f = find(s.flows, m[1], "flow");
    return q.get("published") === "true" ? f.live : s.outputs.filter((o) => o.flowId === f.id);
  }],
  ["POST", re`/flows/${S}/outputs`, (m, s, _q, b) => {
    const f = find(s.flows, m[1], "flow");
    const o = applyOutput(s, f, { id: `out-w${++s.n}`, flowId: f.id, name: "", format: "csv", tableKey: null, destinationId: null, template: defaultTemplate(f.fields, "csv", null), createdAt: new Date().toISOString(), sendWhen: null }, b);
    s.outputs.push(o);
    return o;
  }],
  ["PUT", re`/flows/${S}/outputs/${S}`, (m, s, _q, b) => {
    const o = s.outputs.find((x) => x.flowId === m[1] && x.id === m[2]) ?? refuse(404, { error: "output_not_found" });
    return applyOutput(s, find(s.flows, m[1], "flow"), o, b);
  }],
  ["GET", re`/documents`, (_m, s, q) => documentList(s, q)],
  ["GET", re`/documents/${S}`, (m, s) => { const d = find(s.docs, m[1], "document"); look(d); return detail(d); }],
  ["PATCH", re`/documents/${S}/values`, (m, s, _q, b) => {
    const d = find(s.docs, m[1], "document");
    if (Object.keys(b).some((k) => k !== "fields" && k !== "cells")) throw new Error("mock workspace: only fields and cells edits are implemented");
    if (d.status === STATUS.sending || d.status === STATUS.sent) refuse(409, { error: "document_sent" });
    if (!documentStatus(d.status, d.statusReason).editable || !d.read) refuse(409, { error: "not_editable" });
    const fields = (b.fields ?? []) as { key: string; value: string | null }[];
    const cells = (b.cells ?? []) as { table: string; row: number; column: string; value: string | null }[];
    if (fields.length + cells.length === 0) refuse(400, { error: "no_changes" });
    const read = d.read!;
    for (const e of fields) Object.assign(read.fields.find((f) => f.key === e.key) ?? refuse(400, { error: "unknown_target" }), { value: e.value, confidence: 1, edited: true, notOnPage: false });
    for (const e of cells) {
      const cell = read.tables.find((t) => t.key === e.table)?.rows[e.row]?.cells[e.column] ?? refuse(400, { error: "unknown_target" });
      Object.assign(cell, { value: e.value, confidence: 1, edited: true, notOnPage: false });
    }
    if (d.status === STATUS.needs_review) d.status = STATUS.ready;
    return detail(d);
  }],
  // As DocumentRemoval: busy while received, read or sent; else the document and its files are gone.
  ["DELETE", re`/documents/${S}`, (m, s) => {
    const d = find(s.docs, m[1], "document");
    if (d.status === STATUS.received || d.status === STATUS.reading || d.status === STATUS.sending) refuse(409, { error: "document_busy" });
    s.docs = s.docs.filter((x) => x.id !== d.id);
    delete s.deliveries[d.id];
  }],
  ["POST", re`/documents/${S}/send`, (m, s) => send(s, find(s.docs, m[1], "document"))],
  ["GET", re`/documents/${S}/deliveries`, (m, s) => (find(s.docs, m[1], "document"), s.deliveries[m[1]] ?? [])],
  ["GET", re`/documents/${S}/source`, (m, s) => {
    const name = find(s.docs, m[1], "document").fileName;
    return mockSourceBytesForKey(name)?.blob ?? new Blob([], { type: typeOf(name) });
  }],
  ["GET", re`/documents/${S}/deliveries/${S}/file`, (m, s) => {
    const d = find(s.docs, m[1], "document");
    const x = (s.deliveries[d.id] ?? []).find((y) => y.id === m[2] && y.status === "stored") ?? refuse(404, { error: "delivery_not_found" });
    const output = find(s.flows, d.flowId, "flow").live.find((o) => o.name === x.outputName);
    return new Blob([csvOf(d.read ?? NOTHING, output?.template)], { type: "text/csv" });
  }],
  ["POST", re`/documents/${S}/outputs/${S}/preview`, (m, s) => {
    const d = find(s.docs, m[1], "document");
    const output = find(s.outputs, m[2], "output");
    return { contentType: "text/csv", fileName: `${stem(d.fileName)}.csv`, content: csvOf(d.read ?? NOTHING, output.template), lookupMisses: [] };
  }],
  ["GET", re`/destinations`, (_m, s) => [...s.destinations].sort((x, y) => x.name.localeCompare(y.name)).map((d) => destinationOut(d, s))],
  ["POST", re`/destinations`, (_m, s, _q, b) => {
    const d = applyDestination({ id: `dest-w${++s.n}`, name: "", protocol: "", config: {}, hasCredentials: false, createdAt: new Date().toISOString(), usedBy: [], lastSend: null }, b);
    s.destinations.push(d);
    return destinationOut(d, s);
  }],
  ["PUT", re`/destinations/${S}`, (m, s, _q, b) => destinationOut(applyDestination(find(s.destinations, m[1], "destination"), b), s)],
  ["POST", re`/destinations/${S}/test`, (m, s) => (find(s.destinations, m[1], "destination"), TEST_OK)],
  ["GET", re`/linked-accounts`, () => ({ available: session(GOOGLE) === "on", accounts: [] })],
];

/** The empty workspace's answer for a path it owns, or undefined for a path it does not own.
 *  It owns every path under /flows, /documents, /destinations and /linked-accounts, and throws
 *  ApiHttpError-shaped refusals exactly as the server does. A path or parameter under those
 *  prefixes that it does not implement throws `mock workspace: no route for ${method} ${path}`. */
export function workspaceFetch(method: string, path: string, query: URLSearchParams, body: unknown): { answer: unknown } | undefined {
  // An empty workspace has an empty inbox; adding to it, and its answers, are not built here.
  if (method === "GET" && path === "/inbox") return { answer: { flowId: "ws-inbox", address: null, intakeId: null, scansOn: true, formatsOn: false } };
  if (/^\/inbox(\/|$)/.test(path) || (method === "POST" && path === "/documents") || /^\/documents\/[^/]+\/(move|set-up|download|sort-flows)$/.test(path))
    throw new Error(`mock workspace: the inbox is not implemented (${method} ${path})`);
  if (!/^\/(flows|documents|destinations|linked-accounts)(\/|$)/.test(path)) return undefined;
  for (const [verb, pattern, run] of ROUTES) {
    const m = verb === method ? pattern.exec(path) : null;
    if (!m) continue;
    const s = load();
    const answer = run(m, s, query, (body ?? {}) as Body);
    save(s); // a GET of a document moves its read along, so every route saves; a refusal threw before this
    return { answer: answer instanceof Blob ? answer : structuredClone(answer) };
  }
  throw new Error(`mock workspace: no route for ${method} ${path}`);
}
