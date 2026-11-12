import { ApiHttpError } from "@/lib/api-client";
import type { CrossingStatus, OrderStage } from "@/components/bridge/StatusJourney";

// ─── Pipeline stage mapping ─────────────────────────────────────────────────────
// STATUS column → soft pill via the ported .pill / .pill-* classes (leading dot +
// full semantic label). PIPELINE column → standalone 5-node .journey.compact track.
// `key` maps each CrossingStatus onto its globals.css .pill-* / status class.
// NOTE: this is the single source of truth for order-status DISPLAY LABELS in the
// inbox. It should later consolidate into the canonical map in
// src/components/bridge/UnifiedStatusBadge.tsx (STATUS_META), which keys on raw
// backend OrderStatus rather than the collapsed CrossingStatus used here — keep
// the label vocabulary in sync until then.
//   - `ready`      → "Ready to send": every check passed, nothing queued yet
//                    (Parse→Normalize→Validate→[Transform]→Deliver, stage 3). It is
//                    the HUMAN's turn. (WP-25 / DESIGN-DB-1 §6.4 row 57.)
//   - `delivering` → carries the post-transform backend `ready_to_deliver` status
//                    (see mapStatus): the output file is built and the send is
//                    pending — OUR turn. Labelled "Queued to send", the same words
//                    as the chip that filters `ready_to_deliver`, so badge and chip
//                    can never disagree (the regression this comment guards).
//   - `sending`    → carries the backend `delivering` status: claimed by the Worker
//                    and in flight right now. Labelled "Sending" to match
//                    STATUS_META.delivering, and NOT "Queued to send" (it is past
//                    that) nor "Delivered" (the supplier does not have it yet).
// `stage: null` = "no single stage": the collapsed `failed` slot folds five raw
// failure statuses that failed at DIFFERENT nodes, so its journey stage must be
// derived per-row from rawStatus (journeyStage below) — a constant here could only
// hardcode one node for all five, which is the bug this replaced.
export const STATUS_PRESENTATION: Record<
  CrossingStatus,
  { key: string; label: string; stage: OrderStage | null }
> = {
  new:        { key: "new",        label: "New",            stage: 0 },
  // Stage 0, not 1. An order being read is AT Parse; stage 1 drew Parse as done for the
  // one status that means Parse is still running — and it contradicted the dashboard,
  // whose journeyStageFor("parsing") has been pinned to 0 all along
  // (statusJourneyFailedStage.test.tsx:100). `new` shares the node on purpose: queued
  // and parsing are both at Parse, told apart by the badge word, not by the track.
  extracting: { key: "extracting", label: "Extracting",     stage: 0 },
  unrouted:   { key: "unrouted",   label: "Needs supplier", stage: 1 },
  review:     { key: "review",     label: "Needs review",   stage: 2 },
  ready:      { key: "ready",      label: "Ready to send",  stage: 3 },
  // The output file is being built — the Transform node, three past where this used to
  // draw it. Its own slot (rather than folding into `extracting`) is what stops the
  // mobile card saying "Extracting" while the desktop badge says "Preparing output".
  transforming: { key: "transforming", label: "Preparing output", stage: 3 },
  sent:       { key: "sent",       label: "Delivered",      stage: 4 },
  delivering: { key: "delivering", label: "Queued to send", stage: 4 },
  sending:    { key: "sending",    label: "Sending",        stage: 4 },
  held:       { key: "held",       label: "Delivery paused", stage: 4 },
  unconfirmed: { key: "unconfirmed", label: "Delivery unknown", stage: 4 },
  // The collapsed failure slot folds five raw statuses that failed at different
  // stages, so it cannot name any one of them ("Couldn't read file" would be a
  // lie on a rejected order). It stays "Failed" — plain English, and the SAME
  // word as the chip that filters it, so chip and row can never disagree.
  failed:     { key: "failed",     label: "Failed",         stage: null },
  // A status string this build has never heard of. `stage: null` here means the same
  // thing it means for `failed` — "no single stage" — but for the opposite reason:
  // `failed` has five candidate nodes and picks one from the raw status, while this has
  // none at all, so journeyStage answers null and the row prints no stage claim.
  unknown:    { key: "unknown",    label: "Status unknown", stage: null },
};

// ─── API status mapping ───────────────────────────────────────────────────────

// Backend `ready` and `ready_to_deliver` are DIFFERENT pipeline stages and must
// NOT collapse to one display status, or the row badge contradicts the chips:
//   - `ready`            = every check passed, NO output built yet (pre-Transform).
//                          Rendered "Ready to send" — the HUMAN's turn, and since WP-29
//                          the chip that filters `ready` carries the same three words
//                          and the row carries the button that acts on them.
//   - `ready_to_deliver` = post-transform, output file built, send pending — OUR turn.
//                          Rendered "Queued to send", the SAME vocabulary as the chip
//                          that filters `ready_to_deliver`.
// We reuse the `delivering` CrossingStatus slot (stage 4, distinct blue pill) for
// `ready_to_deliver`. That slot's NAME is a historical accident, not a claim about the
// backend: a persisted `delivering` status DOES exist upstream (OrderStatusConstants),
// and it maps to the separate `sending` slot below.
export function mapStatus(s: string): CrossingStatus {
  if (s === "pending_review") return "review";
  if (s === "parsing") return "extracting";
  // Its OWN slot, not folded into `extracting`. Folding it lit Normalize for an order
  // at Transform, and made the mobile card (which reads this collapsed value) print
  // "Extracting" while the desktop badge (which reads the raw status) printed
  // "Preparing output" — one order, two words, two screen sizes.
  if (s === "transforming") return "transforming";
  // Extracted, but no supplier resolved — parked awaiting one, which is the operator's
  // job (POST /orders/{id}/assign-supplier). Reachable on the LIVE parse path today
  // (OrderIngestionService: `if (entity.SupplierId is null) newStatus = Unrouted`) and via
  // SFTP/S3/IMAP ingress when an org's default supplier is unset or soft-deleted. Without
  // this it fell through to "new" (stage 0), so the one order that REQUIRED the operator
  // to act was the one rendered as needing nothing.
  if (s === "unrouted") return "unrouted";
  if (s === "ready_to_deliver") return "delivering";
  if (s === "ready") return "ready";
  // The Worker's atomic claim persists `delivering` while it dispatches, and settles it
  // to delivered/delivery_failed seconds later; a claim whose process dies holds the row
  // until the 2-minute reclaim window. Without this it fell through to "new" (stage 0) —
  // an order mid-dispatch rendered as if nothing had started, the opposite of the truth.
  if (s === "delivering") return "sending";
  if (s === "delivered") return "sent";
  // delivery_held reached Deliver and paused for billing. Without this it fell
  // through to "new" (stage 0) — the opposite of the truth.
  if (s === "delivery_held") return "held";
  // delivery_unconfirmed also reached Deliver — it was (probably) sent — before a crash
  // lost the outcome on a channel that cannot tell us whether it arrived. Same
  // fall-through bug as delivery_held would apply here.
  //
  // It gets its own bucket, NOT the red `failed` arm below, and it is deliberately
  // absent from FAILED_BUCKET: we do not know it failed, and re-sending risks a
  // duplicate purchase order, so a human decides ("Send again" / "Mark as delivered").
  // Do not "tidy" it into either list — that would claim a failure we cannot support
  // AND pull it into the Failed chip's count (failureBucketPills.test.ts iterates that
  // bucket, so adding it there would silently make this arm unreachable).
  if (s === "delivery_unconfirmed") return "unconfirmed";
  // Every status in FAILED_BUCKET must land here — that list is what the "Failed" chip
  // counts, and the backend's OrderStatusConstants.FailureBucket states the contract:
  // "Every status the UI renders as the single red 'Failed' pill." This arm honoured
  // only three of the five: `rejected_by_supplier` and `delivery_dead_letter` fell
  // through to "new" (stage 0), so the chip counted an order as Failed while its own
  // row rendered it as untouched. See failureBucketPills.test.ts, which asserts the
  // whole bucket rather than these five names, so the next status added to it cannot
  // regress here silently.
  if (
    s === "delivery_failed" ||
    s === "failed" ||
    s === "transform_failed" ||
    s === "delivery_dead_letter" ||
    s === "rejected_by_supplier"
  ) return "failed";
  // `pending_parse` — queued, nothing run on it yet, which is what "New" (stage 0)
  // genuinely means. It is now an ARM rather than the default, because the two are not
  // the same statement: this one says "we know this order has not started", and a
  // default says "we did not recognise this string". They were the same line for months,
  // and the line said the first thing about both.
  //
  // Before adding a status to this arm, GREP THE PRODUCERS — do not trust a
  // doc-comment. Every bug this function has had came from believing one. The
  // `delivering` arm exists because a comment here swore no such status was persisted
  // (DeliveryService writes it). The `unrouted` arm exists because the SECOND version of
  // that same mistake was made in this very comment: it deferred unrouted as
  // "unreachable until the content-routing ingest paths ship", echoing
  // OrderStatusConstants' doc-comment, which is stale — Phase 1/1b shipped, the ingress
  // code says so in its own comments, and OrderIngestionService parks live orders there.
  if (s === "pending_parse") return "new";
  // Anything still here is a status THIS BUILD CANNOT PLACE, and there is no honest
  // display bucket for it except one that says so. Two ways to arrive:
  //
  //   • the order-status manifest (src/lib/orderStatusManifest.ts) does not name it —
  //     the API is ahead of this build. Frontend and backend deploy separately, so this
  //     is routine, not exceptional.
  //   • the manifest names it and this function grew no arm for it — a bug in THIS file.
  //
  // The operator is owed the same answer either way: we do not know. Falling through to
  // "new" answered the first question ("has it started?") with a confident no, and
  // STATUS_PRESENTATION.new renders that as "New" at stage 0 — the pipeline never
  // started — on exactly the rows we understood least. The arms above name every entry
  // in ORDER_STATUS_FACTS, and unknownStatus.test.tsx walks that manifest through here
  // to keep it that way, so the second case cannot arrive silently.
  return "unknown";
}

/**
 * One honest sentence per failure. This used to be a single line telling the retention story
 * ("the link may have expired, or the file may have been removed…") for EVERY failure — shown
 * verbatim for 404 and 429, where it is simply untrue. The endpoint distinguishes them
 * (404 no such artifact for this order · 410 Gone blob purged per retention · 429 signed-URL
 * rate limit), so the copy does too.
 */
export function downloadFailureMessage(err: unknown): string {
  const status = err instanceof ApiHttpError ? err.status : 0;
  if (status === 410) return "That copy is gone — it was removed under your data-retention setting.";
  if (status === 404) return "We have no stored copy of that file for this order.";
  if (status === 429) return "Too many download requests just now. Wait a moment, then try again.";
  if (status === 401 || status === 403) return "You do not have access to that file.";
  return "Couldn't get that file just now. Please try again.";
}
