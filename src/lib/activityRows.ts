/**
 * The words of the Activity page: who did each event, what it says, its tag and its facts, the address
 * of a tab and page, and the CSV. One row per server event. A payload key that is absent or null is
 * unknown, so its fact is left out — never drawn as 0, "none" or success.
 */
import type { ActivityEvent } from "@/lib/api/documents";
import { AUDIT_ACTION_FACTS, auditActionLabel, auditEventKind, auditEventReason } from "@/lib/auditActionManifest";
import { readFailureMessage } from "@/lib/documentRefusals";
import { serverReasonOrNull } from "@/lib/serverText";
import { csvCell } from "@/lib/csvCell";
import { CHANNELS } from "@/lib/channels";
import { destinationsAddress } from "@/lib/destinations";

export type ActivityTabKey = "all" | "sent" | "failed" | "changes";
export const ACTIVITY_TABS: readonly { key: ActivityTabKey; label: string; actions: readonly string[] | undefined; emptyTitle: string; emptySub: string }[] = [
  { key: "all", label: "All", actions: undefined, emptyTitle: "Nothing has happened yet.", emptySub: "Everything that happens to your documents shows here, newest first." },
  { key: "sent", label: "Sent", actions: ["document.delivered"], emptyTitle: "Nothing has been sent yet.", emptySub: "Documents show here once they have been sent." },
  { key: "failed", label: "Couldn't send", actions: ["document.delivery_failed"], emptyTitle: "Nothing has failed to send.", emptySub: "Documents we couldn't send show here, with the reason." },
  {
    key: "changes", label: "Changes",
    // A destination test and the platform's own admin rows are not changes a person made here; they stay under All.
    actions: AUDIT_ACTION_FACTS.filter((f) => f.reachable && f.kind === "edited" && f.action !== "destination.tested" && !f.action.startsWith("admin."))
      .map((f) => f.action),
    emptyTitle: "No changes yet.", emptySub: "Edited values, published versions and settings changes show here.",
  },
];
export const ACTIVITY_PAGE_SIZE = 50;

/** Exactly one value of a key counts; anything else reads as the default. */
export function readActivityAddress(params: { getAll(name: string): string[] }): { tab: ActivityTabKey; page: number } {
  const one = (k: string) => { const v = params.getAll(k); return v.length === 1 ? v[0] : null; };
  const show = one("show");
  const page = one("page");
  return {
    tab: ACTIVITY_TABS.find((t) => t.key !== "all" && t.key === show)?.key ?? "all",
    page: page !== null && /^[1-9]\d{0,8}$/.test(page) ? Number(page) : 1,
  };
}

export function activityAddress(tab: ActivityTabKey, page = 1): string {
  const q = new URLSearchParams();
  if (tab !== "all") q.set("show", tab);
  if (page > 1) q.set("page", String(page));
  const s = q.toString();
  return s ? `/operations/log?${s}` : "/operations/log";
}

export type Members = ReadonlyMap<string, string>;
export function memberNames(
  memberships: readonly { publicUserData?: { userId?: string | null; firstName?: string | null; lastName?: string | null; identifier?: string | null } }[] | undefined,
): Members {
  const out = new Map<string, string>();
  for (const { publicUserData: u } of memberships ?? []) {
    const name = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim() || u?.identifier;
    if (u?.userId && name) out.set(u.userId, name);
  }
  return out;
}

const UPLOAD_CREDITED = new Set(["document.received", "document.read", "document.read_failed"]);
export function activityWho(e: ActivityEvent, members: Members): string {
  if (e.actorId) return members.get(e.actorId) ?? "A workspace member";
  if (!e.action.startsWith("document.")) return "System";
  if (!e.documentId) return "Not recorded";
  if ((e.action === "document.delivered" || e.action === "document.delivery_failed") && !e.startedAt) return "Not recorded";
  return UPLOAD_CREDITED.has(e.action) && e.source === "upload" ? "A workspace member" : "Automatic";
}

export interface ActivitySentence { before: string; strong: string | null; after: string }
export const plainSentence = (s: ActivitySentence): string => `${s.before}${s.strong ?? ""}${s.after}`;

export type ActivityTone = "blue" | "green" | "amber" | "danger" | "neutral";
export interface ActivityFact { term: string; value: string; mono?: boolean; stopped?: 1 | 4 }
export interface ActivityView { sentence: ActivitySentence; why: string | null; tag: { label: string; tone: ActivityTone }; facts: ActivityFact[]; canFix: boolean; fixHref: string | null; canSendAgain: boolean }

/** A payload value, or undefined when it is absent or null. */
function field(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return undefined;
  const v = (payload as Record<string, unknown>)[key];
  if (v === undefined || v === null) return undefined;
  return Array.isArray(v) ? v.join(", ") : String(v);
}

/** A server field key in words: `invoice_number` → "invoice number". */
const words = (s: string) => s.replaceAll("_", " ");
/** The server's edit target in words: `field:invoice_number` → "invoice number", `cell:lines[2].unit_price` → "unit price, line 3"; anything else is left out. */
function targetLabel(target: string): string | undefined {
  const f = /^field:(.+)$/.exec(target);
  if (f) return words(f[1]);
  const c = /^cell:[^[\]]+\[(\d+)\]\.(.+)$/.exec(target);
  return c ? `${words(c[2])}, line ${Number(c[1]) + 1}` : undefined;
}

const RECEIVED = new Map([
  ["upload", " was uploaded"], ["email", " arrived by email"], ["imap", " arrived from a mailbox"], ["api", " arrived through the API"],
  ["sftp", " was picked up from SFTP"], ["ftp", " was picked up from FTP"], ["ftps", " was picked up from FTPS"], ["s3", " was picked up from S3"],
]);
const KIND_TAGS: Partial<Record<string, { label: string; tone: ActivityTone }>> = {
  failed: { label: "Problem", tone: "danger" }, held: { label: "Held", tone: "amber" }, edited: { label: "Change", tone: "neutral" },
};

export function activityView(e: ActivityEvent, ctx: { who: string; destinationName: (id: string) => string | null }): ActivityView {
  const p = (k: string) => field(e.payload, k);
  const fileSentence = (before: string, after: string): ActivitySentence =>
    e.documentName ? { before, strong: e.documentName, after } : { before: `${before}${before ? "a" : "A"} deleted document`, strong: null, after };
  const destId = p("destinationId");
  const destName = p("destination") ?? (destId ? ctx.destinationName(destId) ?? undefined : undefined);
  const protocol = p("protocol");
  const channel = protocol === undefined ? undefined : CHANNELS.get(protocol) ?? protocol;
  const output = p("output");
  const version = p("version");
  const attempts = p("attempts");
  const failedSend = e.action === "document.delivery_failed";
  const facts: (ActivityFact & { value: string | undefined })[] = [];
  const fact = (term: string, value: string | undefined, extra: Omit<ActivityFact, "term" | "value"> = {}) => facts.push({ term, value, ...extra });
  let sentence: ActivitySentence;
  let tag: ActivityView["tag"];
  let why: string | null = null;

  switch (e.action) {
    case "document.received":
      sentence = fileSentence("", RECEIVED.get(p("source") ?? e.source ?? "") ?? " arrived");
      tag = { label: "Received", tone: "blue" };
      fact("From", p("sourceRef"), { mono: true });
      break;
    case "document.read": {
      const status = p("status");
      sentence = fileSentence("", status === "needs_review" ? " was read and needed a check" : status === "ready" ? " was read and was ready to send" : " was read");
      tag = status === "needs_review" ? { label: "Needed a check", tone: "amber" } : { label: "Read", tone: "blue" };
      fact("Flow version", version);
      break;
    }
    case "document.read_failed":
      sentence = fileSentence("", " couldn't be read");
      tag = { label: "Couldn't read", tone: "danger" };
      why = readFailureMessage(p("reason") ?? null);
      fact("Where it stopped", "At Read, stage 2 of 5", { stopped: 1 });
      break;
    case "document.retry_read":
      sentence = fileSentence("Started reading ", " again");
      tag = { label: "Read again", tone: "blue" };
      break;
    case "document.value_edited": {
      const target = p("target") ?? "";
      const line = target.startsWith("row:") ? (p("new") === "row" ? " was added" : p("old") === "row" ? " was removed" : null) : null;
      sentence = fileSentence(line ? "A line on " : "A value on ", line ?? " was changed");
      tag = { label: "Change", tone: "neutral" };
      const value = targetLabel(target);
      if (value) {
        fact("Value", value);
        fact("Was", p("old"));
        fact("Now", p("new"));
      }
      break;
    }
    case "document.value_taught": {
      sentence = fileSentence("A value on ", " was taught");
      tag = { label: "Change", tone: "neutral" };
      const key = p("key");
      fact("Value", key && words(key));
      break;
    }
    case "document.sent":
      sentence = fileSentence("Started sending ", "");
      tag = { label: "Sending", tone: "neutral" };
      fact("Files", p("outputs"));
      fact("Flow version", version);
      break;
    case "document.delivered":
    case "document.delivery_failed": {
      const verb = failedSend ? " couldn't be sent" : " was sent";
      sentence = fileSentence("", destName ? `${verb} to ${destName}` : verb);
      tag = failedSend ? { label: "Couldn't send", tone: "danger" } : { label: "Sent", tone: "green" };
      if (failedSend) {
        why = [serverReasonOrNull(p("error")), destId && "Fix the destination, then send it again."].filter(Boolean).join(" ") || null;
        fact("Where it stopped", "At Send, stage 5 of 5", { stopped: 4 });
      }
      fact("Destination", destName && (channel ? `${destName}, ${channel}` : destName));
      fact("Attempts", attempts && `${attempts}, the last at ${activityTime(e.ts)}.${failedSend ? " We stopped there." : ""}`);
      fact("The server's reply", p("responseCode"), { mono: true });
      fact("File", p("file"), { mono: true });
      fact("File", output && (version ? `${output}, flow version ${version}` : output));
      fact("Started by", e.startedAt ? (e.actorId ? `${ctx.who} pressed Send at ${activityTime(e.startedAt)}` : `Started automatically at ${activityTime(e.startedAt)}`) : undefined);
      break;
    }
    case "flow.published":
      sentence = { before: version ? `Version ${version} of ` : "A new version of ", strong: e.flowName, after: e.flowName ? " was published" : "a flow was published" };
      tag = { label: "Change", tone: "neutral" };
      break;
    default:
      sentence = { before: `${auditActionLabel(e.action)}${e.poNumber ? ` (${e.poNumber})` : ""}`, strong: null, after: "" };
      tag = KIND_TAGS[auditEventKind(e.action)] ?? { label: "Other", tone: "neutral" };
      why = auditEventReason(e.action, e.payload);
  }

  return {
    sentence, why, tag,
    facts: facts.filter((f): f is ActivityFact => !!f.value),
    canFix: failedSend && !!destId && !!e.flowId,
    fixHref: failedSend && destId ? fixDestinationHref(destId) : null,
    canSendAgain: failedSend && !!e.documentId,
  };
}

/** A timestamp without a zone is read as UTC. */
const at = (iso: string) => new Date(/(Z|[+-]\d\d:?\d\d)$/i.test(iso) ? iso : `${iso}Z`);

export const activityTime = (iso: string): string =>
  at(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function activityDay(iso: string, now: Date): string {
  const d = at(iso);
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(d)) / 86_400_000);
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "long", ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) });
  const lead = days === 0 ? "Today" : days === 1 ? "Yesterday" : d.toLocaleDateString("en-GB", { weekday: "long" });
  return `${lead}, ${date}`;
}

/** Where a person goes to fix a stopped delivery: Settings › Destinations with that destination open. */
export const fixDestinationHref = (destinationId: string): string => destinationsAddress(destinationId);

export function activityCsv(events: readonly ActivityEvent[], members: Members, destinationName: (id: string) => string | null): string {
  const header = ["Date", "Time", "What happened", "Flow", "Who", "Result", "Details"];
  const rows = events.map((e) => {
    const who = activityWho(e, members);
    const v = activityView(e, { who, destinationName });
    const details = [v.why, ...v.facts.map((f) => `${f.term}: ${f.value}`)].filter(Boolean).join("; ");
    return [at(e.ts).toLocaleDateString("en-CA"), activityTime(e.ts), plainSentence(v.sentence), e.flowName ?? "", who, v.tag.label, details];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");
}
