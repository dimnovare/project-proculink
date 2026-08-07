// The backend sentences that already break the copy vocabulary, pinned as a PASSING baseline.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY A BASELINE RATHER THAN A RED BUILD
//
// These 19 violations are real and pre-existing: they are on operators' screens today, in
// this repo's own product, and none of them can be fixed from the frontend — the sentences
// live in the backend repo. Leaving main red until someone lands a backend packet would
// train everybody to stop reading CI, and a CI nobody reads masks the NEXT real failure.
// FE #110 already made this trade for the unreachable-endpoint list, for the same reason.
//
// So the list is tracked, and the guard fails in BOTH directions:
//
//   • a violation NOT in this list appears  → red. The new one is the thing to fix.
//   • a violation IN this list disappears   → red. A stale allow-list is how a fixed thing
//                                             stays "known broken" forever, and this repo
//                                             has been bitten by exactly that shape before.
//
// Deleting the entry IS the second half of the backend fix. That is the point.
//
// ─────────────────────────────────────────────────────────────────────────────
// IDENTITY IS `file + tier + term + text`, NOT THE LINE NUMBER
//
// Deliberate, and the reason matters. This file lives in the FRONTEND repo and is checked
// against a backend checkout that CI makes itself (the `backend-mirror` job checks out
// backend `main`). Keying on line numbers would turn frontend main red every time an
// unrelated backend edit shifted a line — a guard that cries wolf on other people's
// refactors gets muted, which is the failure this baseline exists to avoid.
//
// `lines` is therefore DOCUMENTATION: accurate at the SHA below, reported in failures to
// save the reader a search, and never compared.
//
// A REWORD THAT KEEPS THE BANNED WORD ALSO GOES RED, because the text is part of the
// identity. That is intended rather than tolerated: a reword is somebody already editing
// that sentence, which is the cheapest possible moment to notice the word should go too.
//
// ─────────────────────────────────────────────────────────────────────────────
// SCOPE — the BLOCK tiers only
//
// `metaphor` and `jargon` fail a build; `gloss` never does, on either side of the wire
// (scripts/lib/vocabularyTerms.mjs owns that decision for both consumers). The corpus
// currently carries 107 gloss spans, dominated by protocol names — `ftps`, `sftp`,
// `endpoint`, `cxml`, `ubl` — which are FACTS a supplier's IT team asked for. Renaming them
// would make the copy wrong, so they stay warn-only forever and are not listed here.
//
// Worth stating plainly, because the finding that prompted this work named it: `transform`
// is a GLOSS word, not a blocked one. `TransformValidationException.cs:26/65/67`
// ("Cannot transform: lines … still need review.") therefore appears in the WARN tier, not
// in this list. It is on an operator's screen and it is engine vocabulary — but the rule
// this guard enforces is the repo's own rule, and the repo's rule says gloss-and-keep. The
// guard is the mechanism; moving a word between tiers is a copy decision for
// scripts/lib/vocabularyTerms.mjs, made once, for both languages at the same time.
//
// PROVENANCE: generated against ProcuLink @ origin/main 4c8ba4a, 2026-08-07.

/** One pinned violation. See the header for why `lines` is not part of the identity. */
export interface BaselineViolation {
  readonly file: string;
  /** Where it sat at the provenance SHA. Reported, never compared. */
  readonly lines: readonly number[];
  readonly tier: string;
  readonly term: string;
  readonly text: string;
}

export const KNOWN_BACKEND_COPY_VIOLATIONS: readonly BaselineViolation[] = [
  // ── ProcuLink.Api/Controllers/OrdersController.cs ──────────────────────────
  // 4xx `error` bodies → ApiHttpError.message → OrderProblemPanel.tsx:233 → :344.
  {
    file: "ProcuLink.Api/Controllers/OrdersController.cs",
    lines: [2140],
    tier: "jargon",
    term: "artifact",
    text: "No outbound artifact found. Transform the order before redelivering.",
  },
  {
    file: "ProcuLink.Api/Controllers/OrdersController.cs",
    lines: [2346],
    tier: "jargon",
    term: "dead-letter",
    text: "Order is in dead-letter state — delivery retries are exhausted.",
  },
  {
    file: "ProcuLink.Api/Controllers/OrdersController.cs",
    lines: [2368],
    tier: "jargon",
    term: "artifact",
    text: "No outbound artifact found. Transform the order before retrying delivery.",
  },
  {
    file: "ProcuLink.Api/Controllers/OrdersController.cs",
    lines: [2593],
    tier: "jargon",
    term: "conformance",
    text: "This order is pinned to a connection revision that delivers '{}', which has no named standards profile. Conformance reports cover cxml, ubl, x12.",
  },
  {
    file: "ProcuLink.Api/Controllers/OrdersController.cs",
    lines: [2593],
    tier: "jargon",
    term: "revision",
    text: "This order is pinned to a connection revision that delivers '{}', which has no named standards profile. Conformance reports cover cxml, ubl, x12.",
  },
  {
    file: "ProcuLink.Api/Controllers/OrdersController.cs",
    lines: [2595],
    tier: "jargon",
    term: "conformance",
    text: "Conformance reports are available for the named standards formats: cxml, ubl, x12. Generic csv/json/xml templates have no named profile.",
  },
  {
    file: "ProcuLink.Api/Controllers/OrdersController.cs",
    lines: [2621],
    tier: "jargon",
    term: "conformance",
    text: "The order cannot be transformed to a complete document yet, so it cannot be checked for conformance. Resolve the flagged lines first.",
  },
  {
    file: "ProcuLink.Api/Controllers/OrdersController.cs",
    lines: [2634],
    tier: "jargon",
    term: "conformance",
    text: "The order's output template does not render, so there is no document to check for conformance. Fix the template first.",
  },

  // ── ProcuLink.Core/Services/RetentionConstants.cs ──────────────────────────
  // Used verbatim as the delivery failure at DeliveryService.cs:161 and :1332.
  {
    file: "ProcuLink.Core/Services/RetentionConstants.cs",
    lines: [18],
    tier: "jargon",
    term: "provenance",
    text: "This file has been purged per the organisation's data retention policy. The order record, content hashes, provenance and audit trail are retained.",
  },

  // ── ProcuLink.Infrastructure/Services/DeliveryService.cs ───────────────────
  // DeliveryResult / attempt ErrorMessage → OrdersController.cs:567 → OrderDto.ErrorMessage.
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    lines: [150],
    tier: "jargon",
    term: "artifact",
    text: "Order artifact not found.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    lines: [349],
    tier: "jargon",
    term: "artifact",
    text: "Artifact download failed: {}",
  },
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    lines: [518],
    tier: "jargon",
    term: "artifact",
    text: "Crash-recovery re-drive on a channel that cannot de-duplicate a re-send. The artifact may have been sent, but the outcome was never observed; re-sending could duplicate the PO, so the order is parked for an operator decision.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    lines: [528],
    tier: "jargon",
    term: "artifact",
    text: "Crash-recovery re-drive on a file-drop connection with \"replace existing files\" turned off. The artifact may have been written to the supplier's server, in full or in part, but the outcome was never observed; a re-send would refuse rather than replace it, so the order is parked for an operator decision instead of being retried into dead-letter.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    lines: [528],
    tier: "jargon",
    term: "dead-letter",
    text: "Crash-recovery re-drive on a file-drop connection with \"replace existing files\" turned off. The artifact may have been written to the supplier's server, in full or in part, but the outcome was never observed; a re-send would refuse rather than replace it, so the order is parked for an operator decision instead of being retried into dead-letter.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    lines: [1274],
    tier: "jargon",
    term: "dead-letter",
    text: "Order is in dead-letter state — retries are exhausted.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    lines: [1324],
    tier: "jargon",
    term: "artifact",
    text: "No outbound artifact found. Transform the order before retrying delivery.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    lines: [1465],
    tier: "jargon",
    term: "dead-letter",
    text: "Maximum delivery attempts reached — order moved to dead-letter.",
  },
  {
    file: "ProcuLink.Infrastructure/Services/DeliveryService.cs",
    lines: [1552],
    tier: "jargon",
    term: "artifact",
    text: "Org cannot process orders (billing) at delivery time — delivery paused, artifact intact; auto-released when the org returns to good standing.",
  },

  // ── ProcuLink.Infrastructure/Services/OrderExceptionService.cs ─────────────
  // OrderException.Message → ExceptionDetail.tsx:160, rendered RAW.
  {
    file: "ProcuLink.Infrastructure/Services/OrderExceptionService.cs",
    lines: [59],
    tier: "jargon",
    term: "dead-letter",
    text: "Delivery retries are exhausted (dead-letter).",
  },
];

/** The stable identity of one violation — see the header for why the line is excluded. */
export function baselineKey(v: { file: string; tier: string; term: string; text: string }): string {
  return `${v.file} ${v.tier} ${v.term} ${v.text}`;
}
