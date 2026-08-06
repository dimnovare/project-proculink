// catalogSyncStatusManifest — the ONE place the frontend writes down what the backend
// can put in a catalog source's `lastSyncStatus`, and the only list the last-sync line
// is allowed to read.
//
// WHY THIS FILE EXISTS
//
// `CatalogSyncStatus` in src/lib/api/catalogSources.ts is a four-member union. It is a
// COMPILE-TIME CLAIM about a raw JSON string off the wire, never a runtime guarantee,
// and `formatLastSync` used to switch on it with the unknown arm folded into the success
// arm:
//
//     case "ok":
//     default:
//       return { tone: "ok", text: rel ? `Last synced ${rel}` : "Synced" };
//
// So any value the backend added or renamed — partial, timeout, rate_limited,
// auth_failed, cancelled, skipped — rendered as a GREEN dot under the sentence
// "Last synced 3m ago", printing `lastSyncAt` as though the run behind it had
// succeeded. Only the literal "failed" was ever read as bad news; everything the
// frontend did not understand got the most reassuring reading available. The helper's
// own header said "Never over-claims".
//
// The fix is not a fifth `case`. It is that "not in this table" is a state of its own,
// and that state is never a success. Same shape as src/lib/orderStatusManifest.ts,
// whose `isProblemBucketStatus` answers false for an unknown status and explains at
// length why the opposite default shipped a button the API answers 400 to.
//
// PROVENANCE — backend repo ProcuLink @ main 1433807, read 2026-08-06.
//
// THE BACKEND NAMES NO SET, AND THAT IS THE SECOND FINDING. There is no C# constants
// class, no enum, and no `IReadOnlySet` for these four values. They are bare string
// literals at four assignment sites plus a doc-comment on the entity that lists them in
// prose:
//
//   ProcuLink.Core/Entities/SupplierCatalogSource.cs:101
//     /// <summary>'running' | 'ok' | 'unchanged' | 'failed' (null = never synced).</summary>
//   ProcuLink.Infrastructure/Jobs/CatalogSyncSourceJob.cs:52         = "running"
//   ProcuLink.Infrastructure/Jobs/CatalogSyncSourceJob.cs:100        = "failed"
//   ProcuLink.Infrastructure/Services/Catalog/CatalogPullService.cs:169  = "unchanged"
//   ProcuLink.Infrastructure/Services/Catalog/CatalogPullService.cs:188  = "ok"
//
// The four-member union is, as of that commit, complete — but nothing holds it that
// way. `src/lib/orderStatusManifest.ts` can cite `OrderStatusMachine.RetryableFrom` and
// have `src/test/backendMirror.test.ts` diff that symbol; there is no symbol here to
// cite. A fifth literal can be introduced by one line in one new file, in either
// service, and no rename or compile error in either repo would mention it. That is
// precisely the condition under which a merged `default:` arm turns into a green dot
// over a sync that did not happen.
//
// So the mirror check for this table (in src/test/backendMirror.test.ts) greps the whole
// backend tree for `LastSyncStatus = "…"` assignments instead of reading one symbol,
// and diffs what it finds against CATALOG_SYNC_STATUS_FACTS. It is skipped by a declared
// condition when no backend checkout is reachable, and its parser is exercised against
// an inline fixture on every run — a parser that silently stopped matching would
// otherwise "confirm" this table by finding nothing.

/**
 * What a sync status entitles the UI to say about the catalog.
 *
 *  current      the run finished and the stored catalog reflects the source file.
 *  in_progress  a run is under way; nothing is yet known about its result.
 *  failed       the run did not finish. `lastSyncError` carries the reason.
 *
 * There is deliberately NO member for "unknown". An unrecognised status is the absence
 * of a fact, not a fourth kind — see {@link catalogSyncStatusFact}.
 */
export type CatalogSyncKind = "current" | "in_progress" | "failed";

export interface CatalogSyncStatusFact {
  /** The raw string the API sends in `lastSyncStatus`. */
  status: string;
  kind: CatalogSyncKind;
  /** file:line of the C# that writes this value, as read at the date in this file's header. */
  backendSite: string;
  /** Why this row reads the way it does. */
  note: string;
}

/** Every value a production writer can put in `lastSyncStatus`. Four. */
export const CATALOG_SYNC_STATUS_FACTS: readonly CatalogSyncStatusFact[] = [
  {
    status: "running",
    kind: "in_progress",
    backendSite: "ProcuLink.Infrastructure/Jobs/CatalogSyncSourceJob.cs:52",
    note:
      "The soft lock the job takes before pulling, so the next dispatcher window sees the source " +
      "as not due. A host shutdown leaves it set, so 'running' can be stale rather than live.",
  },
  {
    status: "ok",
    kind: "current",
    backendSite: "ProcuLink.Infrastructure/Services/Catalog/CatalogPullService.cs:188",
    note: "The file was fetched, parsed and upserted. Counts and the file hash are written with it.",
  },
  {
    status: "unchanged",
    kind: "current",
    backendSite: "ProcuLink.Infrastructure/Services/Catalog/CatalogPullService.cs:169",
    note:
      "The file's SHA-256 matched the last import, so nothing was re-read. The catalog is still " +
      "current — which is why this is a 'current' kind even though nothing was written.",
  },
  {
    status: "failed",
    kind: "failed",
    backendSite: "ProcuLink.Infrastructure/Jobs/CatalogSyncSourceJob.cs:100",
    note:
      "The pull threw. PersistFailureAsync writes this and an enumerated safe message into " +
      "lastSyncError before rethrowing, so the honest state is visible while Hangfire retries.",
  },
] as const;

/** Every status this build knows, in the backend's own vocabulary. */
export const CATALOG_SYNC_STATUSES: readonly string[] = CATALOG_SYNC_STATUS_FACTS.map((f) => f.status);

/**
 * The statuses under which the catalog really does reflect the source file.
 *
 * Derived from the `kind` column rather than retyped, so the two cannot disagree.
 */
export const CURRENT_SYNC_STATUSES: readonly string[] = CATALOG_SYNC_STATUS_FACTS.filter(
  (f) => f.kind === "current",
).map((f) => f.status);

const FACT_BY_STATUS = new Map(CATALOG_SYNC_STATUS_FACTS.map((f) => [f.status, f] as const));

/**
 * The manifest row for a raw status, or null when this build has never heard of it.
 *
 * NULL IS THE WHOLE POINT. Callers must render "I do not know what happened" for a null,
 * never the success reading — a status nobody has classified is the case where the
 * frontend understands the row least, which is the worst possible moment to tell an
 * operator their catalog is current.
 *
 * Whitespace is trimmed and an empty string answers null, because a blank status is not
 * a member of the vocabulary either.
 */
export function catalogSyncStatusFact(raw: string | null | undefined): CatalogSyncStatusFact | null {
  if (!raw) return null;
  return FACT_BY_STATUS.get(raw.trim()) ?? null;
}

/**
 * True only when the stored catalog can honestly be said to reflect the source file.
 *
 * UNKNOWN STATUSES ANSWER FALSE. Every caller must treat that as "say nothing
 * affirmative", never as "carry on".
 */
export function catalogSyncClaimsCurrent(raw: string | null | undefined): boolean {
  return catalogSyncStatusFact(raw)?.kind === "current";
}
