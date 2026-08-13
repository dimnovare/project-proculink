// auditActionManifest — the ONE place the frontend writes down what the backend's
// audit vocabulary is, and the only list any coverage test is allowed to walk.
//
// WHY THIS FILE EXISTS
//
// `/operations/log` renders `GET /api/audit`, and that endpoint returns the audit
// action VERBATIM (`AuditController.cs:186`, `action = action`). The delivery log
// used to translate it with a fourteen-entry hand-typed object literal whose keys
// were all snake_case:
//
//     const ACTION_TO_EVENT = { created: "uploaded", ..., delivery_failed: "failed" };
//     const event = ACTION_TO_EVENT[e.action.toLowerCase()] ?? "crossed";
//     //                                                      ^^^^^^^^^^ → "delivered"
//
// The backend's action vocabulary is overwhelmingly PascalCase. Of the thirty
// actions a production writer can actually emit, that map matched THREE
// (`Created`, `Parsed`, `Resolved` — and only because the lookup lowercased first).
// Every other one — every `ParseFailed`, `TransformFailed`, `DeliveryDeadLettered`,
// `AcceptanceBlocked`, `DeliverySlaBreached`, `StuckTimeout` — missed the map and
// took the `?? "crossed"` fallback, which resolves to the canonical event
// `delivered`. So the screen whose job is to show what went wrong rendered a wall
// of green "Delivered" rows, the "Failed" filter chip matched nothing that could
// ever exist, and the "Open to resend" button — gated on the failed event — was
// unreachable for exactly the rows that needed it.
//
// A hand-maintained map produced that. A hand-maintained *corrected* map would
// drift again the next time the backend adds an action, and it would drift the
// same silent way, because the fallback made "I do not recognise this" and "this
// succeeded" the same rendering.
//
// So this file follows `src/lib/orderStatusManifest.ts` exactly: one table, every
// row carrying the C# site it mirrors, derived sets rather than second copies, and
// a cross-repo diff (`src/test/auditActionMirror.test.ts`) that parses the real C#
// whenever a backend checkout is reachable. Unknown actions resolve to `unknown`,
// which is a rendering of its own and is never a success.
//
// PROVENANCE — backend repo ProcuLink @ main 5db0b05, read 2026-08-06.
//
// The vocabulary has no central constants class; it is scattered literals. The
// enumeration below is every `AuditEvents.Add` site in production code (there are
// no `AddRange` sites), which is these fifteen files:
//
//   ProcuLink.Api/Controllers/AdminController.cs            admin.* via WriteAdminAuditAsync
//   ProcuLink.Api/Controllers/OpsController.cs
//   ProcuLink.Api/Controllers/OrdersController.cs
//   ProcuLink.Api/Services/AcceptanceGate.cs                AcceptanceGateAudit.* consts
//   ProcuLink.Api/Services/Orders/OrderIngestionService.cs
//   ProcuLink.Api/Services/Orders/OrderResolutionService.cs
//   ProcuLink.Api/Services/Orders/OrderTransformService.cs
//   ProcuLink.Api/Services/ReplayService.cs
//   ProcuLink.Infrastructure/Services/DeliveryService.cs
//   ProcuLink.Infrastructure/Services/DeliverySlaService.cs
//   ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs   inbound_email.* via WriteAuditAsync
//   ProcuLink.Infrastructure/Services/StrandedFailedDeliveryDetectionService.cs
//   ProcuLink.Infrastructure/Services/StrandedReadyOrderDetectionService.cs
//   ProcuLink.Infrastructure/Services/StuckDeliveryDetectionService.cs
//   ProcuLink.Infrastructure/Services/StuckOrderDetectionService.cs
//
// Two further sources are folded in:
//   ProcuLink.Api/Controllers/AuditController.cs:234  BuildMessage's switch, which is
//       the backend's own presentation layer and names four actions no writer emits
//   ProcuLink.Api/Controllers/OrdersController.cs:498 the error-message query, which
//       reads `DeliveryFailed` — an action no writer emits either
//
// `GET /api/audit` applies NO EntityType filter (`AuditController.cs:60-67`, only
// `e.OrgId == orgId`), so the org-scoped admin and inbound-email events land in this
// same log alongside order events. They are in the table for that reason.

// The repo's single door between a server-authored string and operator-facing prose.
// See `auditEventReason` at the foot of this file for why an audit payload has to go
// through it — these strings can be a raw exception, or a supplier's HTML error page.
import { serverReasonOrNull } from "@/lib/serverText";

/**
 * How a row is rendered, and which filter chip claims it.
 *
 * This is a PRESENTATION slot, not a second copy of the backend's semantics — the
 * backend has no such classification, which is precisely why the frontend has to
 * write one down somewhere checkable.
 *
 *  created    the order/record came into existence
 *  parsed     the source document was read
 *  validated  a pipeline stage completed cleanly
 *  edited     data on the order changed (by a person, or by the mapping engine)
 *  delivered  the supplier has it. GREEN, and reserved — see isSuccessKind
 *  failed     something broke and someone has to act
 *  held       nothing broke, but the order stopped and only a person or a billing
 *             settlement restarts it. The same distinction OrderStatusFact draws
 *             between its `failure` and `parked` buckets, for the same reason
 *  recovered  a detection service or an operator un-stuck something
 *  unknown    THE BACKEND SENT AN ACTION THIS FILE DOES NOT KNOW. Never stored in
 *             the table below; only ever produced by auditActionFact missing. It
 *             renders as its own neutral row and is never a success — the previous
 *             behaviour, silently rendering it as `delivered`, is the whole defect
 */
export type AuditEventKind =
  | "created"
  | "parsed"
  | "validated"
  | "edited"
  | "delivered"
  | "failed"
  | "held"
  | "recovered"
  | "unknown";

export interface AuditActionFact {
  /** The exact string the API sends in `action`. Matched case-insensitively. */
  action: string;
  /** Never "unknown" — that kind exists only for actions absent from this table. */
  kind: Exclude<AuditEventKind, "unknown">;
  /**
   * What the row calls this event.
   *
   * The backend's `BuildMessage` only has sentences for the seven snake_case names,
   * and falls through to `$"{action}{po}"` for everything else — which is why a
   * dead-lettered delivery used to describe itself to an operator as
   * "DeliveryDeadLettered · PO-4711". The label is the fix for that half.
   */
  label: string;
  /**
   * False when no production writer can emit this action.
   *
   * Recorded rather than deleted, exactly as `OrderStatusFact.reachable` is: the
   * name is still live somewhere in the backend (a `BuildMessage` arm, or a query
   * that reads it), so a future writer would make it reachable without telling
   * anyone, and the frontend is already correct for it when that happens.
   */
  reachable: boolean;
  /** file:line of a writer (or, for unreachable rows, of whatever still names it). */
  backendSite: string;
  /**
   * The TOP-LEVEL payload keys that carry this action's reason, best first.
   *
   * The audit DTO has always carried `payload` (`AuditController.cs:191`, a real
   * nested JSON object, camelCase keys — the backend applies no naming policy when
   * it serialises, so the key is whatever the C# anonymous member is called). The
   * delivery log discarded it wholesale, so the screen could say an order failed but
   * never why, which is precisely what an operator needs at the moment a first
   * supplier config does not work.
   *
   * WHY PER-ACTION AND NOT A GENERIC SNIFF. There is no single key. `ParseFailed` and
   * `TransformFailed` use `error`; `DeliveryDeadLettered` uses `lastError`;
   * `DeliveryUnconfirmed` and the sweepers use `detail`; `AcceptanceBlocked` puts the
   * text inside `blockers[]`. And the obvious-looking keys are traps in both
   * directions:
   *
   *   • `reason` is a MACHINE CODE in nine payloads (`DeliverySlaBreached` writes
   *     `reason = "DeliverySlaBreached"`, its own action name) and human free text in
   *     three. A reader that took `reason` on sight would print an engine identifier
   *     to an operator as the explanation.
   *   • `AcceptanceBlocked` writes `error = "acceptance_gate_unavailable"` on the one
   *     arm where the gate could not answer — a slug, deliberately distinct from a
   *     refusal. That arm has NO reason fit to show, so `error` is not listed for it.
   *   • Several SUCCESSES carry error-shaped keys: `AcceptanceOverrideUsed` ships a
   *     `blocked` list of blocking-rule sentences even though the transform went
   *     through. "Has an error-ish property" is not "is a failure".
   *
   * So the key is a property of the action, and it lives in the table with the rest of
   * the per-action truth. EMPTY MEANS SAY NOTHING: an action with no listed key
   * renders no reason at all rather than a guess. `src/test/auditActionMirror.test.ts`
   * parses the real C# payload literals and fails when a key named here is not one
   * the backend writes for that action.
   *
   * ONLY `failed` AND `held` ROWS DECLARE A KEY. That is a scope decision, not an
   * oversight: several successes and recoveries do carry prose — `DeliveryConfirmedManually`
   * and `DeliveryHoldReleased` both write a `detail` sentence — and none of it is
   * listed, because "why?" is the question a stopped order raises and a completed one
   * does not. It also makes "a success never gains a reason" structural rather than
   * incidental, which is what the guard asserts. A later packet that wants the
   * recovery narrative adds the key and the test that reads it, together.
   *
   * A key's value may be a string, or an array of objects carrying `message`
   * (`blockers[]`) — both shapes are real, and `auditEventReason` reads both.
   */
  reasonKeys: readonly string[];
  /** Why this row reads the way it does. */
  note: string;
}

/**
 * Every audit action the backend can put on the wire.
 *
 * Grouped by writer. Case is the backend's own — `auditActionFact` matches
 * case-insensitively because `AuditController.BuildMessage` does
 * (`StringComparison.OrdinalIgnoreCase`), so `Created` and `created` are ONE row.
 *
 * Case folding is NOT underscore folding: `delivery_failed` and `DeliveryFailed`
 * lower-case to different keys, so they are two rows on purpose. The old map held
 * only the underscored one, which is the direct reason it matched nothing a writer
 * emits.
 */
export const AUDIT_ACTION_FACTS: readonly AuditActionFact[] = [
  // ── Ingestion ───────────────────────────────────────────────────────────────
  {
    action: "Created",
    kind: "created",
    label: "Order created",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderIngestionService.cs:242",
    reasonKeys: [],
    note: "Also written at :374 and :644 for the split/derived order paths.",
  },
  {
    action: "ClassifiedAsInvoice",
    kind: "parsed",
    label: "Classified as an invoice",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderIngestionService.cs:656",
    reasonKeys: [],
    note: "The document was read and turned out not to be a purchase order. A routing outcome, not a break.",
  },
  {
    action: "SupplierSuggested",
    kind: "edited",
    label: "Supplier suggested",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderIngestionService.cs:768",
    reasonKeys: [],
    note: "Detection proposed a supplier; nothing is committed until it is accepted.",
  },
  {
    action: "ParseFailed",
    kind: "failed",
    label: "Couldn't read file",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderIngestionService.cs:913",
    reasonKeys: ["error"],
    note:
      "Also :982 and :1002. Its payload carries `error`, which OrdersController.cs:498 surfaces on the order. " +
      "`error` is ParseFailureExplain's operator-facing sentence; the sibling `detail` is `ex.Message` verbatim " +
      "and is deliberately NOT listed — `error` is written at all three sites, so `detail` would never be " +
      "reached, and a parser stack trace is not an explanation.",
  },
  {
    action: "Parsed",
    kind: "parsed",
    label: "Parsed",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderIngestionService.cs:1274",
    reasonKeys: [],
    note: "Also :1517.",
  },

  // ── Resolution ──────────────────────────────────────────────────────────────
  {
    action: "Resolved",
    kind: "edited",
    label: "Lines resolved",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderResolutionService.cs:245",
    reasonKeys: [],
    note: "Supplier item codes were settled for the order's lines.",
  },
  {
    action: "MarkedRejected",
    kind: "failed",
    label: "Supplier rejected",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderResolutionService.cs:324",
    reasonKeys: ["reason"],
    note:
      "The supplier read it and refused it — a failure the operator must act on, not a delivery. One of only " +
      "three payloads where `reason` is human free text (an operator typed it) rather than a machine code; the " +
      "nine sweeper/SLA payloads write their own action name into `reason`, which is why this is a per-action " +
      "list and not a `reason`-first lookup.",
  },
  {
    action: "AiSuggestionsBulkAccepted",
    kind: "edited",
    label: "AI suggestions accepted",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderResolutionService.cs:398",
    reasonKeys: [],
    note: "A person accepted a batch of mapping suggestions.",
  },

  // ── Transform + acceptance gate ─────────────────────────────────────────────
  {
    action: "Transformed",
    kind: "validated",
    label: "Supplier file built",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderTransformService.cs:740",
    reasonKeys: [],
    note: "The output exists. NOT a delivery — nothing has been sent to the supplier yet.",
  },
  {
    action: "TransformFailed",
    kind: "failed",
    label: "Couldn't build output",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/Orders/OrderTransformService.cs:790",
    reasonKeys: ["error"],
    note:
      "Payload carries `error`. Usually curated prose, but the template/validation arm passes `ex.Message` " +
      "straight through, so this one can be a raw Scriban exception of any length — which is why it goes " +
      "through the sanitiser and why the row wraps rather than assuming a short sentence.",
  },
  {
    action: "AcceptanceBlocked",
    kind: "failed",
    label: "Blocked by the supplier's rules",
    reachable: true,
    backendSite: "ProcuLink.Core/Services/IAcceptanceGate.cs:151 (AcceptanceGateAudit.BlockedAction)",
    reasonKeys: ["blockers"],
    note:
      "Written at OrderTransformService.cs:475 and :495, OrdersController.cs:177, OpsController.cs:183. The gate " +
      "refused a transform; the payload lists the blockers. The reason is the ARRAY, not `error`: one of the four " +
      "sites writes `error = \"acceptance_gate_unavailable\"` — a machine slug marking the arm where the gate " +
      "could not answer at all — and it ships `blockers = []` alongside. Listing `error` would print that slug to " +
      "an operator as the supplier's reason for refusing, which is the fabrication this field exists to avoid. " +
      "On that arm nothing legible is found and the row correctly shows no reason.",
  },
  {
    action: "AcceptanceOverridden",
    kind: "edited",
    label: "Acceptance overridden",
    reachable: true,
    backendSite: "ProcuLink.Core/Services/IAcceptanceGate.cs:148 (AcceptanceGateAudit.OverriddenAction)",
    reasonKeys: [],
    note: "Written at AcceptanceGate.cs:103. An operator authorised sending an order the rules refuse.",
  },
  {
    action: "AcceptanceOverrideUsed",
    kind: "validated",
    label: "Sent under an override",
    reachable: true,
    backendSite: "ProcuLink.Core/Services/IAcceptanceGate.cs:154 (AcceptanceGateAudit.OverrideUsedAction)",
    reasonKeys: [],
    note: "Written at AcceptanceGate.cs:128. The transform proceeded only because a recorded override covered every blocker.",
  },

  // ── Supplier assignment + replay ────────────────────────────────────────────
  {
    action: "SupplierSuggestionAccepted",
    kind: "edited",
    label: "Supplier suggestion accepted",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/OrdersController.cs:2908",
    reasonKeys: [],
    note: "The ternary at that site emits this or SupplierAssignedManually.",
  },
  {
    action: "SupplierAssignedManually",
    kind: "edited",
    label: "Supplier assigned",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/OrdersController.cs:2908",
    reasonKeys: [],
    note: "The other arm of the same ternary — a person picked the supplier.",
  },
  {
    action: "Reprocessed",
    kind: "edited",
    label: "Reprocessed under a new version",
    reachable: true,
    backendSite: "ProcuLink.Api/Services/ReplayService.cs:354",
    reasonKeys: [],
    note: "An operator re-ran one order against a newer mapping/template revision.",
  },

  // ── Delivery ────────────────────────────────────────────────────────────────
  {
    action: "DeliveryConfirmedManually",
    kind: "delivered",
    label: "Marked delivered by an operator",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/OrdersController.cs:2241",
    reasonKeys: [],
    note: "The ONLY reachable action in the `delivered` kind. Nothing in the backend writes an automatic delivery-success audit row — see the `delivered` entry below.",
  },
  {
    action: "DeliveryRequeuedByOperator",
    kind: "recovered",
    label: "Requeued by an operator",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/OpsController.cs:264",
    reasonKeys: [],
    note: "A person put a delivery that was out of retries, or had failed, back on the queue.",
  },
  {
    action: "DeliveryUnconfirmed",
    kind: "held",
    label: "Delivery unknown",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/DeliveryService.cs:580",
    reasonKeys: ["detail"],
    note:
      "A send was attempted on a channel that cannot de-duplicate and the outcome was lost. Not a failure, not a " +
      "success — only a person may resolve it. `detail` is the park reason. DELIBERATE DIFFERENCE FROM /inbox: " +
      "the order screen shows BuildUnconfirmedMessage(protocol, parkReason), which wraps this same string in a " +
      "fuller sentence. The log shows the bare park reason — less context, never contradicting substance — " +
      "because the alternative is the log staying silent about the one event a person has to resolve by hand.",
  },
  {
    action: "DeliveryHeldForBilling",
    kind: "held",
    label: "Delivery paused",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/DeliveryService.cs:1542",
    reasonKeys: ["detail"],
    note: "Nothing broke; the send is paused until the org is back in good standing. `detail` says what standing.",
  },
  {
    action: "DeliveryHoldReleased",
    kind: "recovered",
    label: "Billing hold released",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/DeliveryService.cs:1756",
    reasonKeys: [],
    note: "The billing hold cleared automatically and the order can move again.",
  },
  {
    action: "DeliveryDeadLettered",
    kind: "failed",
    label: "Out of retries",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/DeliveryService.cs:1789",
    reasonKeys: ["lastError"],
    note:
      "The automatic attempts are spent. Payload carries `lastError` (not `error`) — the reason a delivery gave " +
      "up, and the closest thing this log has to a delivery-failure explanation, since no writer emits a " +
      "`DeliveryFailed` action at all. It is `string?`, so JSON null is reachable and renders as no reason. It " +
      "is also the dispatcher's sentence with the supplier's own response body appended, which is how a " +
      "production screen once showed an operator `<!DOCTYPE html>`; hence the sanitiser.",
  },
  {
    action: "DeliverySlaBreached",
    kind: "failed",
    label: "Delivery SLA breached",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/DeliverySlaService.cs:174",
    reasonKeys: [],
    note:
      "The order did not reach the supplier inside its promised window. NO reason key on purpose: its payload's " +
      "`reason` is the literal string \"DeliverySlaBreached\" — the action's own name — so listing it would " +
      "answer \"why did this fail?\" with \"because it failed\". The numbers that do explain it (dueAt, " +
      "overdueMinutes) are not prose and are not invented into a sentence here.",
  },

  // ── Detection / recovery services ───────────────────────────────────────────
  {
    action: "StrandedFailedDeliveryRecovered",
    kind: "recovered",
    label: "Stranded failed delivery recovered",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/StrandedFailedDeliveryDetectionService.cs:131",
    reasonKeys: [],
    note: "A failed delivery with no live retry was put back on the queue by the sweeper.",
  },
  {
    action: "StrandedReadyDeliveryRecovered",
    kind: "recovered",
    label: "Stranded delivery recovered",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/StrandedReadyOrderDetectionService.cs:187",
    reasonKeys: [],
    note: "A ready-to-deliver order that nothing had claimed was re-enqueued.",
  },
  {
    action: "StuckDeliveryRequeued",
    kind: "recovered",
    label: "Stalled delivery requeued",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/StuckDeliveryDetectionService.cs:121",
    reasonKeys: [],
    note: "A delivery claim outlived its lease and was handed back.",
  },
  {
    action: "StuckDeliveryDeadLettered",
    kind: "failed",
    label: "Out of retries after a stall",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/StuckDeliveryDetectionService.cs:160",
    reasonKeys: ["detail"],
    note:
      "The sweeper exhausted a stuck delivery's attempts rather than requeueing it again. `detail` is the " +
      "sweeper's own sentence; its sibling `reason` is the action name again, so `detail` is the only prose here.",
  },
  {
    action: "StuckRequeued",
    kind: "recovered",
    label: "Stuck order requeued",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/StuckOrderDetectionService.cs:134",
    reasonKeys: [],
    note: "A parse/transform claim outlived its lease and was handed back.",
  },
  {
    action: "StuckTransformRecovered",
    kind: "recovered",
    label: "Stuck transform recovered",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/StuckOrderDetectionService.cs:181",
    reasonKeys: [],
    note: "A transform that had already produced its artifact was released from the stuck state.",
  },
  {
    action: "StuckTimeout",
    kind: "failed",
    label: "Timed out",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/StuckOrderDetectionService.cs:218",
    reasonKeys: ["detail"],
    note:
      "The order sat in an in-flight status past its ceiling and was failed rather than retried again. `detail` " +
      "names how many times it was re-enqueued first; `reason` is the action name.",
  },

  // ── Inbound email (org-scoped; reaches this log because /api/audit has no
  //    EntityType filter) ──────────────────────────────────────────────────────
  //
  // Every row below is a refusal, and NOT ONE declares a reasonKey. Their payloads
  // carry routing facts — the recipient address, attachment names, sizes — and no
  // prose field. The label already states the refusal ("Email had no attachments"),
  // so there is nothing further the backend sent that this screen is withholding.
  // The plaintext `to` address is deliberately not surfaced either: it is a fact,
  // not an explanation, and it is a counterparty identity.
  {
    action: "inbound_email.processed",
    kind: "created",
    label: "Email ingested",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs:418",
    reasonKeys: [],
    note: "The only inbound_email.* action that is not a refusal.",
  },
  {
    action: "inbound_email.rejected_read_only",
    kind: "failed",
    label: "Email rejected — plan is read-only",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs:187",
    reasonKeys: [],
    note: "Nothing was queued for later; the order simply never arrived. §11.5's cancellation rule, seen from the log.",
  },
  {
    action: "inbound_email.unrouted_no_supplier",
    kind: "failed",
    label: "Email not routed — no matching supplier",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs:218",
    reasonKeys: [],
    note: "No order was created, so this is an ingestion failure rather than the `unrouted` order status.",
  },
  {
    action: "inbound_email.no_attachments",
    kind: "failed",
    label: "Email had no attachments",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs:229",
    reasonKeys: [],
    note: "Nothing to ingest.",
  },
  {
    action: "inbound_email.attachment_skipped_unsupported",
    kind: "failed",
    label: "Attachment skipped — unsupported type",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs:242",
    reasonKeys: [],
    note: "One attachment was dropped; the rest of the email may still have been processed.",
  },
  // The next two used to be ONE branch that wrote a log line and no audit row, so a
  // purchase order that arrived as an attachment nobody could decode left no trace an
  // operator could see: the webhook answered 200, the provider never re-delivered, and
  // no order was created. Backend PR 199 split the branch by cause and gave each a row.
  // (The PR number is written bare on purpose — a hash in front of three hex digits is a
  // colour literal to the design-token gate, and this file is not exempt from it.)
  {
    action: "inbound_email.attachment_skipped_undecodable",
    kind: "failed",
    label: "Attachment skipped — could not be read",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs:310",
    reasonKeys: [],
    note:
      "The sender attached something the decoder could not turn into bytes. Deliberately not a rejection: a " +
      "re-delivery replays the same bytes and fails the same way, so only this row makes the loss visible.",
  },
  {
    action: "inbound_email.attachment_skipped_empty",
    kind: "failed",
    label: "Attachment skipped — empty file",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs:324",
    reasonKeys: [],
    note:
      "Decoded cleanly to nothing — the sender really did attach an empty file. Distinct from " +
      "attachment_skipped_undecodable, which is a file we could not read rather than a file with nothing in it.",
  },
  {
    action: "inbound_email.attachment_skipped_too_large",
    kind: "failed",
    label: "Attachment skipped — too large",
    reachable: true,
    backendSite: "ProcuLink.Infrastructure/Services/Email/InboundEmailRouter.cs:264",
    reasonKeys: [],
    note: "Over IngressLimits.MaxFileBytes.",
  },

  // ── Admin (org-scoped, EntityType "Organisation" or "Order") ────────────────
  {
    action: "admin.invoice.created",
    kind: "created",
    label: "Invoice created (admin)",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/AdminController.cs:328",
    reasonKeys: [],
    note: "Written through WriteAdminAuditAsync (AdminController.cs:735).",
  },
  {
    action: "admin.org.limits_changed",
    kind: "edited",
    label: "Plan limits changed (admin)",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/AdminController.cs:429",
    reasonKeys: [],
    note: "",
  },
  {
    action: "admin.org.account_status_changed",
    kind: "edited",
    label: "Account status changed (admin)",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/AdminController.cs:574",
    reasonKeys: [],
    note: "",
  },
  {
    action: "admin.org.retention_changed",
    kind: "edited",
    label: "Retention policy changed (admin)",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/AdminController.cs:638",
    reasonKeys: [],
    note: "",
  },
  {
    action: "admin.order.erased",
    kind: "edited",
    label: "Order erased (admin)",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/AdminController.cs:664",
    reasonKeys: [],
    note: "GDPR erasure. Deliberate, so not a failure — but destructive, so never a success tint either.",
  },
  {
    action: "admin.orders.bulk_erased",
    kind: "edited",
    label: "Orders bulk-erased (admin)",
    reachable: true,
    backendSite: "ProcuLink.Api/Controllers/AdminController.cs:709",
    reasonKeys: [],
    note: "",
  },

  // ── Declared but unwritten ──────────────────────────────────────────────────
  // Four names live in the backend with no producer. They are here, marked
  // unreachable, for the same reason `pending_parse` is in orderStatusManifest: the
  // name is real, something still reads it, and a future writer must not be the
  // event that discovers the frontend has no row for it.
  {
    action: "DeliveryFailed",
    kind: "failed",
    label: "Couldn't send",
    reachable: false,
    backendSite: "ProcuLink.Api/Controllers/OrdersController.cs:498 (read), AuditController.cs:245 (BuildMessage arm, as `delivery_failed`)",
    reasonKeys: [],
    note:
      "NO WRITER EMITS THIS. OrdersController's error-message query asks for it alongside " +
      "ParseFailed/TransformFailed/DeliveryDeadLettered, and BuildMessage has a sentence for its " +
      "snake_case spelling, but every `AuditEvents.Add` site in production was enumerated and none " +
      "produces it — delivery failure is recorded on DeliveryAttempt and the order status instead. " +
      "Kept as `failed` so the day a writer appears, this log is already right.",
  },
  {
    action: "delivery_failed",
    kind: "failed",
    label: "Couldn't send",
    reachable: false,
    backendSite: "ProcuLink.Api/Controllers/AuditController.cs:245 (BuildMessage arm)",
    reasonKeys: [],
    note:
      "The snake_case spelling, and a SEPARATE ROW from `DeliveryFailed` on purpose: the lookup " +
      "folds case, not underscores, so `delivery_failed` and `deliveryfailed` are different keys. " +
      "Two spellings of one concept, both of which have to resolve — the old map held only this " +
      "one, which is why it matched nothing a writer emits.",
  },
  {
    action: "delivered",
    kind: "delivered",
    label: "Delivered",
    reachable: false,
    backendSite: "ProcuLink.Api/Controllers/AuditController.cs:244 (BuildMessage arm)",
    reasonKeys: [],
    note:
      "NO WRITER EMITS THIS EITHER. The only reachable `delivered`-kind action is " +
      "DeliveryConfirmedManually. Worth knowing before reading this screen: an automatic " +
      "successful send currently leaves no audit row of its own.",
  },
  {
    action: "status_changed",
    kind: "edited",
    label: "Status updated",
    reachable: false,
    backendSite: "ProcuLink.Api/Controllers/AuditController.cs:242 (BuildMessage arm)",
    reasonKeys: [],
    note: "No writer. Kept because BuildMessage still has a sentence for it.",
  },
  {
    action: "transform_queued",
    kind: "edited",
    label: "Transform queued",
    reachable: false,
    backendSite: "ProcuLink.Api/Controllers/AuditController.cs:243 (BuildMessage arm)",
    reasonKeys: [],
    note: "No writer. Kept because BuildMessage still has a sentence for it.",
  },
] as const;

/** Every action this file knows, reachable or not. */
export const AUDIT_ACTIONS: readonly string[] = AUDIT_ACTION_FACTS.map((f) => f.action);

/** The actions a production writer can actually emit. */
export const REACHABLE_AUDIT_ACTIONS: readonly string[] = AUDIT_ACTION_FACTS.filter((f) => f.reachable).map(
  (f) => f.action,
);

/**
 * The actions the "Failed" chip claims.
 *
 * Derived from the `kind` column rather than retyped, so the chip and the row
 * rendering cannot disagree — which is the state the old two-map indirection was in.
 */
export const FAILURE_AUDIT_ACTIONS: readonly string[] = AUDIT_ACTION_FACTS.filter((f) => f.kind === "failed").map(
  (f) => f.action,
);

const FACT_BY_ACTION = new Map(AUDIT_ACTION_FACTS.map((f) => [f.action.toLowerCase(), f] as const));

/**
 * The manifest row for a raw action, or null when the backend has sent something
 * this file has never heard of.
 *
 * Case-insensitive because `AuditController.BuildMessage` compares with
 * `StringComparison.OrdinalIgnoreCase`, so the same action reaches the client in
 * whichever case its writer happened to use.
 */
export function auditActionFact(action: string | null | undefined): AuditActionFact | null {
  if (!action) return null;
  return FACT_BY_ACTION.get(action.trim().toLowerCase()) ?? null;
}

/**
 * How to render a raw action.
 *
 * UNKNOWN ACTIONS ANSWER "unknown", NOT A SUCCESS. That is the entire point of this
 * module: the previous `?? "crossed"` fallback made an unrecognised action
 * indistinguishable from a completed delivery, so a backend that added one failure
 * action would silently paint it green on the one screen an operator opens to find
 * out what broke.
 */
export function auditEventKind(action: string | null | undefined): AuditEventKind {
  return auditActionFact(action)?.kind ?? "unknown";
}

/**
 * What to call the event in the row.
 *
 * Falls back to the raw action rather than inventing a sentence — an operator
 * seeing a literal `SomethingNewHappened` has something to search for and report,
 * which a friendly-but-wrong label would take away.
 */
export function auditActionLabel(action: string | null | undefined): string {
  const fact = auditActionFact(action);
  if (fact) return fact.label;
  const raw = (action ?? "").trim();
  return raw.length > 0 ? raw : "Unrecognised event";
}

/**
 * True only for kinds that may render as a completed success (green).
 *
 * Deliberately a tiny allow-list rather than `kind !== "failed"`: a deny-list is how
 * `unknown` came to read as a delivery in the first place.
 */
export function isSuccessKind(kind: AuditEventKind): boolean {
  return kind === "delivered" || kind === "validated";
}

/** The actions that declare a reason key — the ones a reader can explain at all. */
export const EXPLAINED_AUDIT_ACTIONS: readonly string[] = AUDIT_ACTION_FACTS.filter(
  (f) => f.reasonKeys.length > 0,
).map((f) => f.action);

/**
 * The prose inside one payload value, or null.
 *
 * Two shapes, both real: a string (`error`, `lastError`, `detail`), and an array of
 * objects carrying `message` (`AcceptanceBlocked`'s `blockers[]`, whose entries are
 * `{ code, line, message }`). Anything else — a number, an object, an empty array —
 * is not a sentence and answers null rather than being coerced into one.
 */
function proseFromValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const messages = value
      .map((item) =>
        item && typeof item === "object" && typeof (item as { message?: unknown }).message === "string"
          ? ((item as { message: string }).message.trim() || null)
          : null,
      )
      .filter((m): m is string => m !== null);
    return messages.length > 0 ? messages.join("; ") : null;
  }
  return null;
}

/**
 * Why this audit event happened, in words fit to show an operator — or null.
 *
 * NULL IS A REAL ANSWER, and the common one. An action with no declared reason key,
 * a payload that is absent (legacy rows predate their writer, and the DTO emits
 * `null` for them), a key the backend wrote as null (`DeliveryDeadLettered.lastError`
 * is `string?`), a body that survives sanitising as nothing legible — every one of
 * those renders no reason rather than a fabricated one. This repo has six recorded
 * cases of an unknown value rendering as a confident answer; a made-up failure cause
 * on the one screen an operator opens to find out what broke would be the seventh.
 *
 * EVERY CANDIDATE GOES THROUGH THE SANITISER, and through the SAME one the Order
 * Problem panel uses (`supplierReasonText`, re-exported by `@/lib/serverText` as
 * `serverReasonOrNull`). These strings are not ProcuLink's prose: `TransformFailed`
 * can carry a raw Scriban/template exception message, `ParseFailed` interpolates
 * `ex.Message` into two of its branches, and `DeliveryDeadLettered.lastError` is the
 * dispatcher's sentence with the supplier's own response body concatenated onto it —
 * which on 2026-08-06 meant a production screen showing an operator `<!DOCTYPE html>`
 * as the reason their order failed. `serverReasonOrNull` strips markup, lifts the
 * message out of a JSON body, clamps at SUPPLIER_REASON_MAX, and returns null when
 * nothing legible survives. Two sanitisers that disagree is worse than one, so this
 * reuses it rather than adding a second.
 *
 * The evidence is never destroyed: the untouched body stays on the order passport.
 */
export function auditEventReason(action: string | null | undefined, payload: unknown): string | null {
  const fact = auditActionFact(action);
  if (!fact || fact.reasonKeys.length === 0) return null;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;

  const bag = payload as Record<string, unknown>;
  for (const key of fact.reasonKeys) {
    const cleaned = serverReasonOrNull(proseFromValue(bag[key]));
    if (cleaned) return cleaned;
  }
  return null;
}
