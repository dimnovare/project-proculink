// invoiceStatusManifest — the ONE place the frontend writes down what the backend can
// put in an invoice's `status`, and the only list /inbound/invoices is allowed to read.
//
// WHY THIS FILE EXISTS
//
// `src/app/(app)/inbound/invoices/page.tsx` gated on the literal `"pending"`:
//
//     if (status === "pending") return TV2.dot.warning;                    // the row dot
//     {inv.status === "pending" && ( <Button>Approve</Button> )}           // the ONLY action
//     { label: "Pending review", count: invoices.filter(x => x.status === "pending").length }
//
// No backend writer has ever produced `"pending"`. The value written after a successful
// parse is `"pending_review"` (InvoiceService.cs:68), so all three read false on every
// real row: the summary tile reported 0 beside N invoices, the leading dot fell through
// to neutral, and the Approve button — the entire point of the screen — never rendered.
// The one control left visible was `↓ CSV`, which calls ForwardAsync, which refuses
// anything that is not `"approved"` (InvoiceService.cs:175). A screen where the counter
// is always zero and the only button always 400s.
//
// Three hand-typed copies of a status vocabulary, in one file, all wrong the same way,
// is the defect `src/lib/orderStatusManifest.ts` was written to end for orders. Invoices
// simply never got a manifest. This is it.
//
// `"rejected"` was in that page too — a dot colour, a badge and a summary tile. Nothing
// in the backend writes it. It is not in this table: a status no writer can produce is a
// tile that can only ever read 0, which is indistinguishable from the bug above.
//
// PROVENANCE — backend repo ProcuLink @ main c2f8564, read 2026-08-07.
//
// THE BACKEND NAMES NO SET, exactly as for catalog sync statuses. There is no constants
// class, no enum, no `IReadOnlySet` — five bare string literals at five assignment sites
// in one service, plus a doc-comment on the entity that lists them in prose:
//
//   ProcuLink.Core/Entities/InvoiceEntity.cs:26
//     /// <summary>parsing | pending_review | approved | forwarded | failed</summary>
//   ProcuLink.Infrastructure/Services/InvoiceService.cs:38   = "parsing"
//   ProcuLink.Infrastructure/Services/InvoiceService.cs:68   = "pending_review"
//   ProcuLink.Infrastructure/Services/InvoiceService.cs:138  = "approved"
//   ProcuLink.Infrastructure/Services/InvoiceService.cs:162  = "failed"
//   ProcuLink.Infrastructure/Services/InvoiceService.cs:191  = "forwarded"
//
// So the mirror check for this table (in src/test/backendMirror.test.ts) reads the
// assignments out of that service and the vocabulary out of that doc-comment, rather
// than resolving a symbol. Same honesty rules as the other mirrors in that file: the
// parser is exercised against an inline fixture on every run, and the diff is skipped by
// a declared condition when no backend checkout is reachable, never silently passed.
//
// NOT to be confused with `pending_review` in src/lib/orderStatusManifest.ts. Orders and
// invoices are separate entities with separate tables and separate machines that happen
// to share one spelling. OrderIngestionService.cs:567 also writes `"pending_review"` for
// an ORDER carrying an invoice document (`isInvoice`); that row lands in /inbox, not
// here. The two manifests are deliberately not merged — ORDER_STATUS_FACTS is diffed
// against OrderStatusMachine.Transitions, which knows nothing about `forwarded`.

/**
 * What a status entitles the screen to say, and what it owes the operator.
 *
 *  in_progress  the system is working on it; nothing is owed but a label.
 *  needs_action a person must do something before the invoice moves.
 *  done         the invoice has arrived somewhere it was meant to arrive.
 *  failed       it stopped and will not restart on its own.
 *
 * There is deliberately NO member for "unknown". An unrecognised status is the absence
 * of a fact, not a fifth kind — see {@link invoiceStatusFact}.
 */
export type InvoiceStatusKind = "in_progress" | "needs_action" | "done" | "failed";

export interface InvoiceStatusFact {
  /** The raw string the API sends in `status`. */
  status: string;
  kind: InvoiceStatusKind;
  /** What an operator reads. Never the raw wire value. */
  label: string;
  /**
   * True when POST /api/invoices/{id}/approve is the operator's next step.
   *
   * This is a PRODUCT rule, and narrower than the endpoint. `ApproveAsync`
   * (InvoiceService.cs:132-142) has no status guard at all — it would happily flip a
   * half-parsed `parsing` row, or an already-`forwarded` one, straight to `approved`.
   * Offering that is how a `parsing` invoice gets approved before its lines exist. The
   * offer is therefore restricted to the one status that means "parsed, waiting on a
   * human", which is what the endpoint is FOR.
   */
  approvable: boolean;
  /**
   * True when GET /api/invoices/{id}/download answers 2xx.
   *
   * This one is not a product choice — it is the backend's guard, verbatim:
   * `if (inv.Status != "approved") throw` (InvoiceService.cs:175), surfaced by the
   * controller as a 400. So `approved` alone, and NOT `forwarded`: a forwarded invoice
   * has already advanced past the only status that endpoint admits, and asking twice
   * gets "Invoice must be approved before forwarding."
   */
  downloadable: boolean;
  /** file:line of the C# that writes this value, as read at the date in this file's header. */
  backendSite: string;
  /** Why this row reads the way it does. */
  note: string;
}

/** Every value a production writer can put in an invoice's `status`. Five. */
export const INVOICE_STATUS_FACTS: readonly InvoiceStatusFact[] = [
  {
    status: "parsing",
    kind: "in_progress",
    label: "Parsing",
    approvable: false,
    downloadable: false,
    backendSite: "ProcuLink.Infrastructure/Services/InvoiceService.cs:38",
    note:
      "The stub written at upload, before the parse job runs. Its InvoiceNumber is the placeholder " +
      "'PENDING' and it has no lines yet, so there is nothing an operator could usefully approve.",
  },
  {
    status: "pending_review",
    kind: "needs_action",
    label: "Pending review",
    approvable: true,
    downloadable: false,
    backendSite: "ProcuLink.Infrastructure/Services/InvoiceService.cs:68",
    note:
      "Parsed successfully and waiting on a person. THE status this screen exists to act on, and " +
      "the one the page used to spell 'pending' — so the Approve button never rendered once.",
  },
  {
    status: "approved",
    kind: "done",
    label: "Approved",
    approvable: false,
    downloadable: true,
    backendSite: "ProcuLink.Infrastructure/Services/InvoiceService.cs:138",
    note:
      "A person accepted it. The only status ForwardAsync admits, so it is also the only status " +
      "the download button can be offered on.",
  },
  {
    status: "forwarded",
    kind: "done",
    label: "Forwarded",
    approvable: false,
    downloadable: false,
    backendSite: "ProcuLink.Infrastructure/Services/InvoiceService.cs:191",
    note:
      "ForwardAsync built the output and advanced the row in the same call. Downloading again is " +
      "refused by the guard it just moved past — the file was delivered to the browser once.",
  },
  {
    status: "failed",
    kind: "failed",
    // The product's plain-procurement label for "the source file could not be read",
    // shared verbatim with the order machine's `failed` (UnifiedStatusBadge STATUS_LABELS).
    // The engine-stage name "Parse failed" is retired copy — src/test/statusVocabulary.ts
    // bans it, and it caught this line.
    label: "Couldn't read file",
    approvable: false,
    downloadable: false,
    backendSite: "ProcuLink.Infrastructure/Services/InvoiceService.cs:162",
    note:
      "The parse threw and SetFailedAsync cleared the poisoned change-tracker before writing this. " +
      "No lines were committed, so there is nothing to approve or export.",
  },
] as const;

/** Every status this build knows, in the backend's own vocabulary. */
export const INVOICE_STATUSES: readonly string[] = INVOICE_STATUS_FACTS.map((f) => f.status);

/** The statuses on which Approve is a real, non-400 offer. Derived, never retyped. */
export const APPROVABLE_INVOICE_STATUSES: readonly string[] = INVOICE_STATUS_FACTS.filter(
  (f) => f.approvable,
).map((f) => f.status);

/** The statuses the download endpoint admits. Derived, never retyped. */
export const DOWNLOADABLE_INVOICE_STATUSES: readonly string[] = INVOICE_STATUS_FACTS.filter(
  (f) => f.downloadable,
).map((f) => f.status);

/** What the summary row calls rows whose status this build cannot place. */
export const UNRECOGNISED_INVOICE_LABEL = "Unrecognised";

const FACT_BY_STATUS = new Map(INVOICE_STATUS_FACTS.map((f) => [f.status, f] as const));

/**
 * The manifest row for a raw status, or null when this build has never heard of it.
 *
 * NULL IS THE WHOLE POINT, and it is the direction the original bug ran in: the page's
 * `invoiceDotColor` fell through to a neutral dot and its `StatusBadge` fell through to a
 * grey pill for every unmatched value, so `pending_review` — the status of literally
 * every reviewable invoice — rendered as an unremarkable row rather than as work.
 *
 * Callers must render "I do not recognise this" for a null and must offer no action on
 * it. Whitespace is trimmed and an empty string answers null; a blank status is not a
 * member of the vocabulary either.
 */
export function invoiceStatusFact(raw: string | null | undefined): InvoiceStatusFact | null {
  if (!raw) return null;
  return FACT_BY_STATUS.get(raw.trim()) ?? null;
}

/** What an operator should read for a raw status. Unknown values show themselves, unstyled. */
export function invoiceStatusLabel(raw: string | null | undefined): string {
  const fact = invoiceStatusFact(raw);
  if (fact) return fact.label;
  const trimmed = (raw ?? "").trim();
  return trimmed.length > 0 ? trimmed : UNRECOGNISED_INVOICE_LABEL;
}

/**
 * True only when POST /approve is this invoice's real next step.
 *
 * UNKNOWN STATUSES ANSWER FALSE. Offering an action on a row the frontend cannot place
 * is the `/operations/health` requeue-button defect verbatim — a control put in front of
 * the operator precisely when the UI understands the row least.
 */
export function canApproveInvoice(raw: string | null | undefined): boolean {
  return invoiceStatusFact(raw)?.approvable === true;
}

/** True only when GET /download answers 2xx for this status. Unknown answers false. */
export function canDownloadInvoice(raw: string | null | undefined): boolean {
  return invoiceStatusFact(raw)?.downloadable === true;
}

export interface InvoiceStatusTally {
  /** The raw status, or null for the unrecognised bucket. */
  status: string | null;
  label: string;
  kind: InvoiceStatusKind | null;
  count: number;
}

/**
 * The summary row, derived from the manifest instead of hand-listed.
 *
 * TWO PROPERTIES THIS FUNCTION EXISTS TO HOLD, both of which the hand-written version
 * broke:
 *
 *   1. Every status the backend writes gets a tile. The old row listed three labels, two
 *      of which (`pending`, `rejected`) no writer produces, and omitted three that do
 *      (`parsing`, `forwarded`, `failed`).
 *   2. THE COUNTS SUM TO THE ROW COUNT. Anything this build cannot place lands in a
 *      trailing unrecognised tile rather than vanishing, so "the counters add up to the
 *      number of rows on screen" is a property a test can assert — which makes the
 *      original symptom, a 0 beside N visible invoices, structurally impossible to
 *      reintroduce without failing that assertion.
 *
 * Tiles for known statuses are always present even at zero, so the row does not reflow as
 * invoices move. The unrecognised tile appears only when it would be non-zero: a
 * permanent "Unrecognised 0" is noise, and a non-zero one is a real signal that this
 * table has drifted from the backend.
 */
export function summariseInvoiceStatuses(statuses: readonly string[]): InvoiceStatusTally[] {
  const tallies: InvoiceStatusTally[] = INVOICE_STATUS_FACTS.map((fact) => ({
    status: fact.status,
    label: fact.label,
    kind: fact.kind,
    count: statuses.filter((s) => invoiceStatusFact(s)?.status === fact.status).length,
  }));

  const unrecognised = statuses.filter((s) => invoiceStatusFact(s) === null).length;
  if (unrecognised > 0) {
    tallies.push({ status: null, label: UNRECOGNISED_INVOICE_LABEL, kind: null, count: unrecognised });
  }
  return tallies;
}
