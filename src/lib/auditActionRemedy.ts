// auditActionRemedy — the fourth thing an operator needs from a failed row.
//
// A failed delivery row owes the reader four things, in this order:
//
//   1. what we tried to send      — the PO and its format, on the row
//   2. where we sent it           — the supplier, on the row
//   3. what came back             — the reason, from `auditEventReason` (FE 144)
//   4. WHAT TO DO NOW             — this file
//
// Items 1–3 already worked. Item 4 did not exist anywhere, and its absence is why
// the four real failure shapes still read the same. Every one of them rendered as
// the same grey card with the same three buttons, so an HTTP refusal carrying a
// supplier's own words, a channel that could not be reached at all, a plan hold,
// and a validation refusal that never left the building were distinguishable only
// by prose the operator had to interpret unaided. The distinguishing fact is not
// the colour or the wording of the failure — it is that each one wants a DIFFERENT
// NEXT ACTION, and none of them said so.
//
// WHY A SEPARATE MODULE AND NOT A FIELD ON AuditActionFact.
//
// `AuditActionFact` is a mirror: every field on it is a claim about the BACKEND
// (`reasonKeys` names keys the C# really writes; `backendSite` is a file:line;
// `reachable` is about production writers), and src/test/auditActionMirror.test.ts
// diffs it against the real C#. A remedy is the opposite kind of fact — it is
// frontend-authored operator copy, true of the product's UI rather than of the
// backend's payloads. Putting it on the mirrored interface would mix a thing the
// mirror can check with a thing it cannot, and the next reader would not be able
// to tell which fields the mirror is vouching for.
//
// COMPLETENESS IS DERIVED, NOT ASSERTED BY HAND. `auditActionRemedy.test.ts` walks
// AUDIT_ACTION_FACTS and requires a remedy for every reachable `failed` or `held`
// action — so an action added to the manifest in either kind fails the build until
// somebody decides what an operator should do about it. That is the same shape as
// the manifest's own `never` exhaustiveness trap, applied across a module boundary.
//
// THE COPY RULE, and it is the one that matters: A REMEDY MAY NOT PROMISE AN
// ACTION THE PRODUCT CANNOT PERFORM. This repo already enforces the same rule on
// the exception detail sentences — src/test/statusVocabulary.test.ts fails if a
// `deliveryNote` offers a resend that is not available — and the failure it guards
// against is specific: telling someone to "send it again" when the same file would
// be refused the same way, or when the only exit is a NEW order. So:
//
//   • a supplier's business rejection does NOT get "try again"; it gets "see their
//     reply, then start a corrected order"
//   • a refusal that never left ProcuLink does NOT get "check the supplier"; the
//     supplier never saw it
//   • an unconfirmed delivery does NOT get "send it again"; a duplicate PO at the
//     supplier is a worse outcome than an unanswered question, so it gets "ask
//     before resending"

import { AUDIT_ACTION_FACTS, auditActionFact } from "./auditActionManifest";

/**
 * How far the order got before it stopped.
 *
 * This is the axis that actually separates the failure shapes, and it is the first
 * thing an operator asks — because it decides who has to fix it. It is a property
 * of the ACTION, so it is knowable without reading any payload, which matters: the
 * audit payloads carry no HTTP status and no endpoint, so a shape distinction that
 * depended on those would be a distinction the data cannot support.
 *
 *  before_send  ProcuLink stopped it. The supplier never saw this order.
 *  at_supplier  It left the building and the supplier's endpoint answered.
 *  unknown_send It left the building and we did not get a usable answer.
 *  paused       Nothing is wrong with the order; something outside it is blocking.
 */
export type FailureReach = "before_send" | "at_supplier" | "unknown_send" | "paused";

/** What the reader is told about how far it got, in plain procurement English. */
export const REACH_SENTENCE: Record<FailureReach, string> = {
  before_send: "This order never reached the supplier — ProcuLink stopped it first.",
  at_supplier: "This order reached the supplier's system, and their system refused it.",
  unknown_send: "We couldn't confirm whether the supplier received this order.",
  paused: "Nothing is wrong with the order itself — sending is on hold.",
};

export interface ActionRemedy {
  reach: FailureReach;
  /** What the operator should do next. One sentence, an action first. */
  next: string;
}

/**
 * Per-action remedies, keyed by the manifest's own action string.
 *
 * Lower-cased at lookup, matching `auditActionFact`, so the map is written in the
 * backend's own casing and a case variant on the wire still resolves.
 */
const REMEDY_BY_ACTION: Record<string, ActionRemedy> = {
  // ── Never left the building ────────────────────────────────────────────────
  ParseFailed: {
    reach: "before_send",
    next: "Upload a corrected file. No order was built from this one, so nothing was sent.",
  },
  TransformFailed: {
    reach: "before_send",
    next:
      "Check the supplier's output settings and item-code mapping, then send again from the order. " +
      "Nothing was sent.",
  },
  AcceptanceBlocked: {
    reach: "before_send",
    next:
      "Open the order and correct the values the rule names. If the rule doesn't apply to this " +
      "order, an administrator can override it.",
  },
  "inbound_email.rejected_read_only": {
    reach: "before_send",
    next: "Upgrade the plan to start accepting orders again, then ask the sender to resend.",
  },
  "inbound_email.unrouted_no_supplier": {
    reach: "before_send",
    next: "Add the sending address to a supplier so future emails from it are routed automatically.",
  },
  "inbound_email.no_attachments": {
    reach: "before_send",
    next: "Ask the sender to attach the order file. Order details in the message body are not read.",
  },
  "inbound_email.attachment_skipped_unsupported": {
    reach: "before_send",
    next: "Ask the sender for the order as CSV, XLSX, PDF or XML, or upload it yourself.",
  },
  "inbound_email.attachment_skipped_too_large": {
    reach: "before_send",
    next: "Ask the sender to split the order, or upload the file directly.",
  },

  // ── Left the building, refused there ──────────────────────────────────────
  MarkedRejected: {
    reach: "at_supplier",
    next:
      "Open the order to read the supplier's reply, then start a corrected order. Sending this same " +
      "file again would be refused the same way.",
  },

  // ── Left the building, no usable answer ───────────────────────────────────
  DeliveryDeadLettered: {
    reach: "unknown_send",
    next:
      "Check the supplier's delivery settings, then start sending again from the order. Every " +
      "automatic attempt has been used up.",
  },
  StuckDeliveryDeadLettered: {
    reach: "unknown_send",
    next:
      "Check the supplier's delivery settings, then start sending again from the order. Every " +
      "automatic attempt has been used up.",
  },
  DeliveryUnconfirmed: {
    reach: "unknown_send",
    next:
      "Ask the supplier whether this order arrived before sending it again — a second copy would " +
      "reach them as a duplicate.",
  },
  StuckTimeout: {
    reach: "unknown_send",
    next: "Open the order to see where it stopped and whether it can be sent again.",
  },
  DeliverySlaBreached: {
    reach: "unknown_send",
    next: "Open the order to see whether it is still being retried or needs a person.",
  },

  // ── Blocked by something outside the order ────────────────────────────────
  DeliveryHeldForBilling: {
    reach: "paused",
    next: "Update the plan or payment method in Settings. Held orders are sent once the hold clears.",
  },

  // ── Recorded but not produced by any current writer ───────────────────────
  // Both are unreachable in this build (see the manifest's `reachable` flag), and
  // both are kept for the same reason the manifest keeps them: the name is still
  // live backend-side, so a future writer would make them reachable without
  // telling anyone, and the frontend is already correct when that happens.
  DeliveryFailed: {
    reach: "unknown_send",
    next: "Open the order to see whether it is still being retried or needs a person.",
  },
  delivery_failed: {
    reach: "unknown_send",
    next: "Open the order to see whether it is still being retried or needs a person.",
  },
};

const REMEDY_BY_LOWER = new Map<string, ActionRemedy>(
  Object.entries(REMEDY_BY_ACTION).map(([k, v]) => [k.toLowerCase(), v] as const),
);

/**
 * What to do about this event, or null when there is nothing honest to say.
 *
 * NULL IS A REAL ANSWER and the default one. A success has no remedy, and neither
 * does an action this build has never heard of — inventing a next step for an
 * event we cannot name would be the same defect this area keeps meeting, pointing
 * the other way: a confident answer where there is no knowledge. The expanded
 * panel renders nothing rather than a guess.
 */
export function auditActionRemedy(action: string | null | undefined): ActionRemedy | null {
  const fact = auditActionFact(action);
  if (!fact) return null;
  // Scoped to the two kinds that stop an order. A recovery or a success can carry
  // prose, but "what do I do now?" is a question a stopped order raises and a
  // completed one does not — the same scope line `reasonKeys` draws.
  if (fact.kind !== "failed" && fact.kind !== "held") return null;
  return REMEDY_BY_LOWER.get(fact.action.toLowerCase()) ?? null;
}

/**
 * Every action that owes a remedy, derived from the manifest.
 *
 * Exported so the test can walk it rather than re-listing the actions, and so the
 * walk grows automatically when the manifest does.
 */
export const ACTIONS_OWED_A_REMEDY: readonly string[] = AUDIT_ACTION_FACTS.filter(
  (f) => f.kind === "failed" || f.kind === "held",
).map((f) => f.action);
