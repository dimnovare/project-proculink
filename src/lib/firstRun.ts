/**
 * firstRun.ts — what the first run (/flows/new, plan 14.5) reads from its address, who counts as new,
 * and the sentences it prints. Pure functions: no fetching, no state. A hand-typed address never throws.
 */
import type { Flow, ReadResult } from "./api/documents";
import { MAX_UPLOAD_BYTES } from "./fileKinds";

export type FirstRunStep = "add" | "check" | "send" | "ready";
export interface FirstRunAddress { step: FirstRunStep; flow: string | null; doc: string | null }
export const PROVISIONAL_FLOW_NAME = "New flow";

const STEPS: readonly FirstRunStep[] = ["add", "check", "send", "ready"];
/** A parameter given exactly once and not empty, else null. */
const one = (params: URLSearchParams, key: string): string | null => {
  const all = params.getAll(key);
  return all.length === 1 && all[0] ? all[0] : null;
};

/** R2: an unknown, missing or repeated step reads as add. Check and send both show one document of one flow,
 *  so either without a flow or a document reads as the step before it, which for both is add. */
export function readFirstRunAddress(params: URLSearchParams): FirstRunAddress {
  const flow = one(params, "flow");
  const doc = one(params, "doc");
  const asked = one(params, "step") as FirstRunStep | null;
  const step = asked && STEPS.includes(asked) && flow && doc ? asked : "add";
  return { step, flow, doc };
}

/** "/flows/new", or "/flows/new?step=check&flow=f&doc=d" (absent values left out; "add" never written). */
export function firstRunAddress(a: Partial<FirstRunAddress>): string {
  const q = new URLSearchParams();
  if (a.step && a.step !== "add") q.set("step", a.step);
  if (a.flow) q.set("flow", a.flow);
  if (a.doc) q.set("doc", a.doc);
  const s = q.toString();
  return s ? `/flows/new?${s}` : "/flows/new";
}

/** Who is new. `unknown` while the flows have not answered (loading or failed): a caller must not draw Welcome then. */
export type FirstRun = { state: "unknown" } | { state: "new"; flow: Flow | null } | { state: "returning" };

/** R3: new is no flow, or exactly one flow with unsaved fields and no documents (a flow a refused upload left, to reuse). */
export function firstRunOf(flows: readonly Flow[] | undefined): FirstRun {
  if (!flows) return { state: "unknown" };
  if (flows.length === 0) return { state: "new", flow: null };
  const [f] = flows;
  return flows.length === 1 && !f.fieldsConfirmed && f.documentCount === 0 ? { state: "new", flow: f } : { state: "returning" };
}

/** True when no other flow than `flowId` exists (the title, and analytics' `first`). */
export function isFirstFlow(flows: readonly Flow[], flowId: string | null): boolean {
  return flows.every((f) => f.id === flowId);
}

/** The kind as printed ("Invoice", "Arve"), no English plural, like the backend's DocumentKind.FlowNameFor; null for an empty label. */
export function suggestFlowName(kindLabel: string | null | undefined): string | null {
  const label = kindLabel?.trim();
  return label || null;
}

const count = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
/** "1 value", "18 values": a value is a field outside a table; a table's columns are not values. */
export const valuesCount = (n: number) => count(n, "value");

/** "9 values and 1 table", "1 value", "2 tables", "" for nothing. */
export function foundSummary(read: { fields: readonly unknown[]; tables: readonly unknown[] }): string {
  return [read.fields.length && valuesCount(read.fields.length), read.tables.length && count(read.tables.length, "table")]
    .filter(Boolean).join(" and ");
}

/** "3 rows, 5 columns (Code, Item, Qty, Price, Amount)". */
export function tableSummary(table: ReadResult["tables"][number]): string {
  const columns = table.columns.map((c) => c.label).join(", ");
  return `${count(table.rows.length, "row")}, ${count(table.columns.length, "column")}${columns ? ` (${columns})` : ""}`;
}

/** "keeps all 9 values and makes a CSV file" / "keeps 7 of 9 values and the table, and makes a CSV file" / "… and the 2 tables, …". */
export function keepsSummary(kept: number, total: number, tables = 0): string {
  return `keeps ${kept === total ? `all ${count(total, "value")}` : `${kept} of ${count(total, "value")}`}${tables === 0 ? "" : tables === 1 ? " and the table," : ` and the ${tables} tables,`} and makes a CSV file`;
}

const DESTINATION_NOUNS: Record<string, string> = {
  email: "email", sftp: "server", ftps: "server", s3: "bucket", http: "web address", google_drive: "Drive folder", google_sheets: "sheet", microsoft_onedrive: "OneDrive folder",
};
/** "{flow} email" … per protocol; `{flow} destination` for a protocol not listed. */
export function destinationNameFor(protocol: string, flowName: string): string {
  return `${flowName} ${Object.hasOwn(DESTINATION_NOUNS, protocol) ? DESTINATION_NOUNS[protocol] : "destination"}`;
}

/** R6. The kinds a flow reads (FILE_KINDS: base always, photos with scansOn, more with formatsOn), in words. */
export function welcomeKinds(flow: Pick<Flow, "scansOn" | "formatsOn"> | undefined): string {
  // With no flow the switches are unknown (only a flow carries them): photos are assumed on, since scans
  // are on for every tier, and other formats off, so we never promise a file the server may refuse.
  const photos = flow ? !!flow.scansOn : true;
  const more = flow ? !!flow.formatsOn : false;
  return [
    `A PDF, ${more ? "a Word or Excel file" : "an Excel or CSV file"}${photos ? ", or a photo of a paper document" : ""}.`,
    ...(more ? ["CSV, text, XML and JSON work too."] : []),
    `Up to ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB.`,
  ].join(" ");
}
