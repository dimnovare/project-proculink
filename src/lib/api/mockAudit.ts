/**
 * mockAudit.ts — `GET /audit` for the mock engine, answered the way `AuditController.GetAuditLog` answers it:
 * the same parameters, filters, order, paging, actor and payload projection. Invented fixtures only.
 */
import { ApiHttpError } from "./core";
import type { ActivityEvent, ActivityResult } from "./documents";

type Payload = Record<string, unknown> | null;
interface Row { id: string; ts: string; entityType: string; entityId: string; action: string; payload: Payload; poNumber?: string }
interface Ctx { docs: readonly { id: string; fileName: string; flowId: string; flowName: string; source: string }[]; numbers: Record<string, string> }

const A = "user_member_a";
const B = "user_member_b";
const spec: Omit<Row, "id">[] = [];
const add = (ts: string, entityType: string, entityId: string, action: string, payload: Payload = null, poNumber?: string) =>
  spec.push({ ts, entityType, entityId, action, payload, poNumber });
const doc = (id: string, ts: string, action: string, payload: Payload = null) => add(ts, "FlowDocument", id, `document.${action}`, payload);

// 1 June (before the browser suites' frozen clock, 09:30Z)
doc("doc-4", "2026-06-01T08:00:00Z", "received", { source: "upload" });
doc("doc-4", "2026-06-01T08:01:00Z", "read", { status: "ready" });
doc("doc-4", "2026-06-01T08:05:00Z", "sent", { by: A, mode: "person", outputs: ["Invoice CSV"] });
doc("doc-4", "2026-06-01T08:06:00Z", "delivery_failed", {
  destination: "Accounting inbox", destinationId: "dest-1", protocol: "email", error: "The mailbox refused the message.",
  responseCode: 550, attempts: 3, output: "Invoice CSV", file: "invoice-1004.csv",
});
doc("doc-1", "2026-06-01T07:00:00Z", "received", { by: B, source: "upload" });
doc("doc-1", "2026-06-01T07:01:00Z", "read", { status: "needs_review" });
doc("doc-1", "2026-06-01T07:30:00Z", "value_edited", { by: B, target: "field:vat", old: "20", new: "21" });
add("2026-06-01T06:00:00Z", "LinkedAccount", "account-1", "linked_account.connected", { provider: "google", by: A });
// 31 May
add("2026-05-31T10:00:00Z", "Flow", "flow-1", "flow.published", { version: 1, flow: "Supplier invoices" });
doc("doc-3", "2026-05-31T11:00:00Z", "received", { source: "upload" });
doc("doc-3", "2026-05-31T11:01:00Z", "read", { status: "ready" });
doc("doc-3", "2026-05-31T11:02:00Z", "sent", { mode: "automatic", outputs: ["Invoice CSV"] });
doc("doc-3", "2026-05-31T11:03:00Z", "delivered", {
  destination: "Accounting API", destinationId: "dest-2", protocol: "http", attempts: 1, output: "Invoice CSV", file: "invoice-1003.csv", version: 1,
});
add("2026-05-31T12:00:00Z", "Organisation", "org-1", "admin.org.limits_changed", { actor: "platform_admin_1", by: "platform_admin_1", field: "orderLimit" });
// 28 May
doc("doc-2", "2026-05-28T09:00:00Z", "received", { source: "upload" });
doc("doc-2", "2026-05-28T09:01:00Z", "read_failed", { reason: "ai_error" });
doc("doc-2", "2026-05-28T09:10:00Z", "retry_read", { by: B });
doc("doc-2", "2026-05-28T09:11:00Z", "read", { status: "ready" });
// 20 May: rows from before today's payload fields existed
doc("doc-3", "2026-05-20T09:05:00Z", "delivered", { protocol: "email", output: "Invoice CSV" });
add("2026-05-20T08:00:00Z", "Order", "order-1", "Created", null, "PO-1001");
add("2026-05-20T10:00:00Z", "Organisation", "org-1", "InvoiceDestinationChanged", { by: A, from: null, to: "dest-1" });
// 10 May: enough rows for a second page, with every edit shape the server writes (a cell, a line added, a field)
const filler = (i: number): Payload =>
  i === 0 ? { by: A, target: "cell:lines[0].unit_price", old: "4.50", new: "4.75" }
    : i === 1 ? { by: A, target: "row:lines[2]", old: null, new: "row" }
      : { by: A, target: "field:total", old: "100.00", new: "110.00" };
for (let i = 0; i < 40; i++) doc("doc-1", `2026-05-10T09:${String(i).padStart(2, "0")}:00Z`, "value_edited", filler(i));

const ROWS: Row[] = spec.map((r, i) => ({ ...r, id: `evt-${String(i + 1).padStart(3, "0")}` }));

const ALLOWED = new Set(["page", "pageSize", "flowId", "actions", "from", "to", "q"]);
const INT_MAX = 2_147_483_647;
const invalid = (key: string, value: string): never => {
  throw new ApiHttpError(`mock engine: GET /audit ${key}=${value} is not valid`, 400, {
    title: "One or more validation errors occurred.", status: 400, errors: { [key]: [`The value '${value}' is not valid.`] },
  });
};
const int = (q: URLSearchParams, key: string, fallback: number) => {
  const v = q.get(key);
  if (v === null) return fallback;
  return /^-?\d+$/.test(v) && Math.abs(Number(v)) <= INT_MAX ? Number(v) : invalid(key, v);
};
const date = (q: URLSearchParams, key: string) => {
  const v = q.get(key);
  if (!v) return null;
  return Number.isNaN(Date.parse(v)) ? invalid(key, v) : Date.parse(v);
};
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi);
const by = (p: Payload) => (typeof p?.by === "string" ? p.by : null);
const isAdmin = (action: string) => action.toLowerCase().startsWith("admin.");
const normalize = (s: string) => s.replace(/\s/g, "").toUpperCase();

function project(e: Row, ctx: Ctx): ActivityEvent {
  const d = e.entityType === "FlowDocument" ? ctx.docs.find((x) => x.id === e.entityId) : undefined;
  const handoffs = d ? ROWS.filter((h) => h.entityType === "FlowDocument" && h.entityId === d.id) : [];
  const send = d && (e.action === "document.delivered" || e.action === "document.delivery_failed")
    ? handoffs.filter((h) => h.action === "document.sent" && h.ts <= e.ts).sort((a, b) => b.ts.localeCompare(a.ts))[0]
    : undefined;
  let actorId: string | null = null;
  if (e.entityType === "FlowDocument") {
    if (d) actorId = by(e.payload) ?? (send ? by(send.payload)
      : e.action === "document.read" || e.action === "document.read_failed"
        ? by(handoffs.find((h) => h.action === "document.received")?.payload ?? null) : null);
  } else if (!isAdmin(e.action)) actorId = by(e.payload);
  const isFlow = !d && e.entityType === "Flow";
  const payload = e.payload && isAdmin(e.action)
    ? Object.fromEntries(Object.entries(e.payload).filter(([k]) => !["actor", "by"].includes(k.toLowerCase())))
    : e.payload;
  return {
    id: e.id, ts: e.ts, action: e.action,
    documentId: d?.id ?? null, flowId: d?.flowId ?? (isFlow ? e.entityId : null),
    documentName: d?.fileName ?? null,
    flowName: d?.flowName ?? (isFlow && typeof e.payload?.flow === "string" ? e.payload.flow : null),
    source: d?.source ?? null, actorId, startedAt: send?.ts ?? null,
    poNumber: e.entityType.toLowerCase() === "order" ? e.poNumber ?? null : null,
    payload,
  };
}

/** Throws on a parameter the server does not read, and answers 400 where its model binding would. */
export function mockAuditPage(q: URLSearchParams, ctx: Ctx): ActivityResult {
  for (const k of q.keys()) if (!ALLOWED.has(k)) throw new Error(`mock engine: GET /audit does not implement "${k}"`);
  const pageSize = clamp(int(q, "pageSize", 50), 1, 200);
  const page = clamp(int(q, "page", 1), 1, Math.floor(INT_MAX / pageSize));
  const actions = q.getAll("actions");
  const from = date(q, "from");
  const to = date(q, "to");
  const flowId = q.get("flowId") || null;
  const term = (q.get("q") ?? "").trim().slice(0, 200);
  const docMatches = (id: string) => {
    const d = ctx.docs.find((x) => x.id === id);
    if (!d || (flowId && d.flowId !== flowId)) return false;
    if (!term) return true;
    const number = ctx.numbers[id];
    return d.fileName.toLowerCase().includes(term.toLowerCase()) || (!!number && normalize(number).includes(normalize(term)));
  };
  const events = ROWS
    .filter((e) => (!actions.length || actions.includes(e.action))
      && (from === null || Date.parse(e.ts) >= from) && (to === null || Date.parse(e.ts) < to)
      && (!flowId && !term || (e.entityType === "FlowDocument" && docMatches(e.entityId))))
    .sort((a, b) => b.ts.localeCompare(a.ts) || (a.id < b.id ? -1 : 1));
  return { events: events.slice((page - 1) * pageSize, page * pageSize).map((e) => project(e, ctx)), total: events.length, page, pageSize };
}
