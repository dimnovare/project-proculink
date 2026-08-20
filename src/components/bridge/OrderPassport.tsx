"use client";

// PO Passport — the provenance + delivery record for a single order.
// Renders a Uploaded → Parsed → Validated → Mapped → Transformed → Delivered →
// (Awaiting response / Supplier rejected / Failed / Needs review) timeline derived
// from the live passport, plus the evidence behind each stage. "Download acceptance
// proof" exports the raw passport JSON returned by the API; PDF export is a marked TODO.
//
// There is no "Accepted" outcome, and adding one back needs a supplier to have said so.
// ProcuLink parses no functional acknowledgement on any channel (997, CONTRL,
// ApplicationResponse, MDN, cXML <Response>), and SFTP/FTPS/SMTP have no back-channel
// that could carry one. Until that changes, a successful delivery is a successful
// HANDOVER: the only supplier verdict this screen can show is a rejection.

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/bridge/layout/Card";
import { confidenceTone } from "@/components/bridge/ConfidenceChip";
import { ApiHttpError, apiClient } from "@/lib/api-client";
import { PracticeChip } from "@/components/bridge/PracticeChip";
import {
  attemptOutcomeIsUnknown,
  attemptSendWasObserved,
  deliveryAttemptOutcome,
} from "@/lib/deliveryAttemptManifest";
import type { DeliveryAttemptOutcome } from "@/lib/deliveryAttemptManifest";
import { statusFact } from "@/lib/orderStatusManifest";
import {
  outcomeIsOpenIssue,
  outcomeIsPass,
  outcomeWasNotEvaluated,
  validationOutcome,
} from "@/lib/validationOutcomeManifest";
import type { ValidationOutcome } from "@/lib/validationOutcomeManifest";
import { supplierReasonText } from "@/components/bridge/problem/supplierReasonText";
import type {
  PassportDto,
  PassportEvent,
  PassportMappingDecision,
  PassportValidationResult,
  PassportDeliveryAttempt,
  PassportOutputArtifact,
} from "@/types/procurement";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const lc = (s: string | null | undefined) => (s ?? "").toLowerCase();

/**
 * What did this check actually say? `status` is the only field that answers that —
 * severity says how loud the rule is when it fails, and the producer stamps passing rows
 * with it too.
 *
 * THIS USED TO RETURN A BOOLEAN, `status === "fail"`, which meant every value that was
 * not literally "fail" was counted into the "N checks passed" claim below. When the
 * backend gained a third outcome for rules that COULD NOT RUN, that arithmetic turned
 * "we could not check this" into a green tick — the same defect the third outcome was
 * added to remove. An outcome this build has never heard of lands on `unrecognised` and
 * is likewise never counted as a check that cleared.
 *
 * The severity fallback is for responses from an API older than WP-39, which sent no
 * `status` at all. It is the pre-fix behaviour and it over-reports failures; that is the
 * correct direction to be wrong in while the two deploys are out of step, because the
 * opposite — reading a missing field as "everything passed" — hides a real failure.
 */
function validationRowOutcome(v: PassportValidationResult): ValidationOutcome {
  const status = lc(v.status).trim();
  if (status) return validationOutcome(status);
  return lc(v.severity).trim() === "error" ? "fail" : "pass";
}

function fmtDateTime(at: string | null | undefined): string {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" });
}

function timelineAt(timeline: PassportEvent[], ...keywords: string[]): string | null {
  for (const e of timeline) {
    const a = lc(e.action);
    if (keywords.some((k) => a.includes(k))) return e.at;
  }
  return null;
}

function hasTimeline(timeline: PassportEvent[], ...keywords: string[]): boolean {
  return timeline.some((e) => keywords.some((k) => lc(e.action).includes(k)));
}

// ─── Stage derivation ───────────────────────────────────────────────────────

// `blocked` is the fourth state, added with the manifest read below. The three that
// existed could not express a PARKED order: it has not finished (not `done`), nothing
// broke (not `failed`), and nothing is moving (not `current` — which literally prints
// "in progress" beside the node). Drawing a parked order in any of the three was the
// defect, so the state it needed exists now.
type StageState = "done" | "current" | "pending" | "failed" | "blocked";
interface Stage {
  key: string;
  label: string;
  state: StageState;
  at: string | null;
  detail?: string;
}

/** Map the order/final status to the index of the last *completed* pipeline stage. */
const STATUS_RANK: Record<string, number> = {
  parsing: 0,          // uploaded done; parse in progress
  pending_review: 2,   // parsed done; mapping needs attention. NOT evidence that validation
                       // ran — the Validated node is gated on its own rows (see VALIDATED_STAGE)
  ready: 3,            // mapped done; ready to transform
  transforming: 3,     // mapped done; transform in progress
  ready_to_deliver: 4, // transformed done; ready to deliver
  delivered: 5,        // delivered done
};

const PIPELINE = ["Uploaded", "Parsed", "Validated", "Mapped", "Transformed", "Delivered"];

/**
 * The one node with no evidence of its own in `reached`.
 *
 * `reached` is a high-water mark: any evidence for a LATER stage drags every earlier node
 * to "done" with it. That is fine for stages whose predecessors really are implied — you
 * cannot hold a transform artifact without having parsed — but nothing that raises `reached`
 * is a VALIDATION. Two paths reached this node without one: an order merely holding an
 * output artifact set `reached >= 4`, and `pending_review` sets rank 2. Either drew a green
 * ✓ beside the word "Validated" on an order where no check had been recorded, and because
 * `detail(2)` returns undefined for an empty `validationResults` what rendered was a bare
 * green "Validated" with nothing under it — which the detail block below already says is
 * not the evidence.
 *
 * So this node is decided by its own rows and nothing else. No rows → not "done".
 */
const VALIDATED_STAGE = PIPELINE.indexOf("Validated");

/**
 * Which pipeline node a FAILURE-bucket status broke at.
 *
 * Keyed by `FAILURE_STATUSES` from the order-status manifest, which is the whole point:
 * this file used to decide the same question with hand-written substring tests —
 * `includes("delivered")`, `includes("dead_letter")`, `includes("review")` — and three
 * real statuses fell through every one of them. `rejected_by_supplier` had NO ARM AT
 * ALL, so an order the supplier had read and refused fell forward onto `deliveredOk`
 * on the strength of its own successful transport and rendered six green ticks, a final
 * node reading "Delivered — no supplier confirmation yet", and a "Download what we
 * sent" button.
 *
 * `OrderPassport.statusBucket.test.tsx` walks FAILURE_STATUSES and fails if a member
 * has no entry here, so a status added to the manifest cannot silently lose its node.
 */
export const FAILURE_STAGE: Readonly<Record<string, number>> = {
  failed: 1,                    // the source file could not be read — DeclaredTerminal
  transform_failed: 4,          // the output could not be built; holds no artifact
  delivery_failed: 5,
  delivery_dead_letter: 5,
  rejected_by_supplier: 5,      // transport succeeded; the SUPPLIER refused it
};

/**
 * The final node's face for a PARKED status — stopped, but nothing broke.
 *
 * The manifest's own doc for the bucket is the rule these three obey: an operator
 * "cannot tell 'stuck because it broke' from 'stuck because it is waiting for me' by
 * how badly it is going, only by what they must do". So each names the wait and the
 * next step, and none of them says "failed".
 *
 * The labels match `UnifiedStatusBadge`'s for the same statuses ("Delivery paused",
 * "Delivery unknown"), because that badge renders on the workshop bar beside this
 * timeline and the two panes were contradicting each other.
 *
 * `delivery_unconfirmed`'s sentence is `auditActionRemedy.ts`'s remedy, kept because
 * this screen was actively fighting it: the remedy tells the operator to ASK THE
 * SUPPLIER before resending, and the timeline was telling them it had been delivered.
 *
 * Walked by the same test as FAILURE_STAGE, against PARKED_STATUSES.
 */
export const PARKED_FINAL: Readonly<Record<string, { label: string; detail: string }>> = {
  unrouted: {
    label: "Needs a supplier",
    detail: "No supplier has been resolved for this order, so there is nowhere to send it yet.",
  },
  delivery_held: {
    label: "Delivery paused",
    detail: "Sending is paused because the account can't process orders right now. It releases automatically.",
  },
  delivery_unconfirmed: {
    label: "Delivery unknown",
    detail:
      "A send was attempted and its outcome was lost. Ask the supplier whether this order arrived " +
      "before sending it again — a second copy would reach them as a duplicate.",
  },
};

/** The face for a parked status the manifest has but this table has not. Never green. */
const PARKED_FALLBACK = {
  label: "Stopped",
  detail: "This order stopped and needs a person to move it on.",
};

interface DerivedTimeline {
  stages: Stage[];
  final: { label: string; state: StageState; detail?: string; at: string | null };
}

/**
 * Exported for `src/test/OrderPassport.deliveryStatus.test.tsx`, which asserts on the
 * stage states directly. "Did an attempt status advance the pipeline to Delivered?" is
 * the half of the delivery-status defect that has no rendered colour of its own — it
 * shows up as six green checkmarks and a "Download what we sent" button — so it is
 * checked against the derivation rather than inferred from the DOM.
 */
export function deriveTimeline(p: PassportDto): DerivedTimeline {
  const fs = lc(p.finalStatus ?? p.order.status);
  const lineCount = p.canonical?.lineCount ?? 0;
  const hasOutput = !!p.outputArtifact;
  const attempts = p.deliveryAttempts ?? [];
  const resp = p.supplierResponse;
  const respOutcome = lc(resp?.outcome);

  // The ORDER status goes through the order-status manifest's allow-list, exactly as the
  // ATTEMPT status below goes through the delivery-attempt manifest's. Both used to be
  // hand-written substring tests here; the attempt half was fixed first, and this half
  // still had three real statuses with no arm — `delivery_held` and
  // `delivery_unconfirmed` (PARKED) drew the Delivered node as in-progress, and
  // `rejected_by_supplier` had no arm at all and fell through to `deliveredOk`.
  const fact = statusFact(fs);
  const statusFailed = fact?.bucket === "failure";
  const statusParked = fact?.bucket === "parked";
  // A status this build has never heard of. Frontend and backend deploy separately, so
  // this is routine — and it is a first-class answer, never a shade of "fine". It gates
  // every DECIDED face below: we cannot say an order arrived, is moving, or broke when
  // we cannot read what it is.
  const statusUnknown = fact === null;

  // Attempt statuses go through the manifest allow-list, never a substring test — see
  // src/lib/deliveryAttemptManifest.ts. `deliveredOk` forces `reached = 5`, which draws
  // all six pipeline nodes green with a checkmark and offers "Download what we sent", so
  // the ONE status the channel confirmed is the only thing allowed to set it — and only
  // when the order's own status does not contradict it. A rejected order's transport DID
  // succeed; that is precisely why the attempt evidence alone could not be trusted here.
  const deliveredOk =
    !statusFailed && !statusParked && !statusUnknown &&
    (fs === "delivered" ||
      respOutcome === "delivered" ||
      attempts.some((a) => attemptSendWasObserved(a.status)));

  // Where the pipeline broke, read off the manifest bucket. A failure status the manifest
  // names but FAILURE_STAGE does not is pinned to the last node rather than dropped —
  // wrong-but-loud beats silently green, and the coverage test stops it arising.
  const failureStage = statusFailed ? FAILURE_STAGE[fs] ?? 5 : null;
  const parseFailed = failureStage === 1;
  const transformFailed = failureStage === 4;
  const deliveryFailed =
    failureStage === 5 ||
    respOutcome === "rejected" ||
    // Attempt-level evidence, still honoured for a status that is not itself a failure —
    // but never over a parked one, whose whole claim is that the outcome is unknown.
    (attempts.length > 0 && !deliveredOk && !statusParked &&
      attempts.every((a) => deliveryAttemptOutcome(a.status) === "failed"));
  const needsReview = fs === "pending_review";

  // Last completed stage index, taking the higher of status rank and evidence.
  let reached = STATUS_RANK[fs] ?? 0;
  if (lineCount > 0) reached = Math.max(reached, 1);
  if (hasOutput) reached = Math.max(reached, 4);
  if (deliveredOk) reached = Math.max(reached, 5);

  // Where (if anywhere) the pipeline failed.
  let failedAt: number | null = null;
  if (parseFailed) failedAt = 1;
  else if (transformFailed) failedAt = 4;
  else if (deliveryFailed) failedAt = 5;

  // Where (if anywhere) it PARKED. Both parked delivery statuses are about the Delivered
  // node specifically; `unrouted` is a routing hold that precedes every node here and so
  // claims none of them.
  const parkedAt: number | null =
    failedAt == null && (fs === "delivery_held" || fs === "delivery_unconfirmed")
      ? PIPELINE.indexOf("Delivered")
      : null;

  // "In progress" is a claim that the order is MOVING. A parked order is not moving, and
  // an order whose status we cannot read is not something we can claim either way.
  const inProgress =
    failedAt == null && !deliveredOk && !needsReview && !statusParked && !statusUnknown;

  const at = (i: number): string | null => {
    switch (i) {
      case 0: return timelineAt(p.timeline, "upload", "creat") ?? p.order.createdAt;
      case 1: return timelineAt(p.timeline, "pars");
      case 2: return timelineAt(p.timeline, "valid");
      case 3: return timelineAt(p.timeline, "map", "resolv");
      case 4: return timelineAt(p.timeline, "transform") ?? p.outputArtifact?.createdAt ?? null;
      case 5: {
        const sentAt = attempts.find((a) => a.transportAcceptedAt)?.transportAcceptedAt;
        return timelineAt(p.timeline, "deliver") ?? sentAt ?? attempts[attempts.length - 1]?.attemptedAt ?? null;
      }
      default: return null;
    }
  };

  const detail = (i: number): string | undefined => {
    switch (i) {
      case 0: return p.sourceArtifact?.detectedFormat ? `${p.sourceArtifact.detectedFormat.toUpperCase()} source` : undefined;
      case 1: return lineCount > 0 ? `${lineCount} line${lineCount !== 1 ? "s" : ""} extracted` : undefined;
      case 2: {
        // Three counts, not two. A row is only counted into the claim its own outcome
        // supports: `rows.length` used to stand in for "checks passed", which silently
        // enrolled every row that was not a failure — including the ones the backend
        // said it could not evaluate, and any status this build cannot read.
        const outcomes = p.validationResults.map(validationRowOutcome);
        const errs = outcomes.filter(outcomeIsOpenIssue).length;
        const notRun = outcomes.filter(outcomeWasNotEvaluated).length;
        const passed = outcomes.filter(outcomeIsPass).length;

        // "not checked" rather than "skipped" or "n/a": the rule did not run because the
        // document did not carry the value it judges. Each row's `message` says which
        // value, in the backend's own words (AcceptanceMessages.ForNotEvaluated).
        const notRunSuffix = notRun > 0 ? ` · ${notRun} not checked` : "";

        if (errs > 0) return `${errs} validation issue${errs !== 1 ? "s" : ""}${notRunSuffix}`;
        // Say how many checks ran rather than nothing at all. The producer emits a row
        // per check PERFORMED — that is the whole point of the invariants — so "4 checks
        // passed" is the evidence the node is claiming, and a bare "Validated" is not.
        if (passed > 0) return `${passed} check${passed !== 1 ? "s" : ""} passed${notRunSuffix}`;
        // Nothing cleared and nothing failed: every rule that ran could not look at
        // anything. Saying "0 checks passed" would invite reading it as a failure, and
        // saying nothing at all would leave the node claiming a validation it cannot
        // evidence — so it says what happened.
        if (notRun > 0) return `${notRun} check${notRun !== 1 ? "s" : ""} not run`;
        return undefined;
      }
      case 3: {
        const unresolved = p.mappingDecisions.filter((d) => lc(d.source) === "unresolved").length;
        return unresolved > 0 ? `${unresolved} unresolved` : p.mappingDecisions.length ? `${p.mappingDecisions.length} lines mapped` : undefined;
      }
      case 4: return p.outputArtifact?.format ? p.outputArtifact.format.toUpperCase() : undefined;
      case 5: {
        const a = attempts[attempts.length - 1];
        return a?.channel ? a.channel.toUpperCase() : undefined;
      }
      default: return undefined;
    }
  };

  // Did a validation actually run? The producer emits one row per check PERFORMED, so the
  // rows are the only evidence this screen ever receives that the stage happened at all.
  const validationRan = p.validationResults.length > 0;

  const stages: Stage[] = PIPELINE.map((label, i) => {
    // "Done" needs evidence for THIS stage, not just a later one. See VALIDATED_STAGE.
    const evidenced = i !== VALIDATED_STAGE || validationRan;
    let state: StageState;
    if (failedAt === i) state = "failed";
    else if (parkedAt === i) state = "blocked";
    else if (i <= reached && evidenced) state = "done";
    else if (i === reached + 1 && inProgress) state = "current";
    else state = "pending";
    return { key: label.toLowerCase(), label, state, at: at(i), detail: detail(i) };
  });

  // Final node.
  //
  // There is deliberately NO "Accepted" arm. One used to sit at the top of this chain, gated on
  // `respOutcome === "acknowledged"` — a value the API produced for every successful delivery, off
  // our own dispatch clock — and it rendered "Accepted" with the detail "Acknowledged by supplier".
  // It shadowed the honest `deliveredOk` arm below, which was therefore unreachable. Nothing in the
  // product parses a supplier acknowledgement on any channel, so until something does, the only
  // supplier VERDICT that can appear here is a rejection.
  //
  // `rejected_by_supplier` is named here as well as on `respOutcome`. The status alone
  // is enough: `PassportSupplierResponse` is nullable (types/procurement.ts), and
  // `POST /api/orders/{id}/mark-rejected` sets the status without necessarily leaving one
  // behind — so a null response used to drop the whole rejection and hand the operator
  // "Delivered — no supplier confirmation yet".
  let final: DerivedTimeline["final"];
  if (respOutcome === "rejected" || fs === "rejected_by_supplier") {
    final = { label: "Supplier rejected", state: "failed", at: resp?.transportAcceptedAt ?? at(5), detail: resp?.rejectionReason ?? "The supplier read this order and refused it." };
  } else if (parseFailed || transformFailed || deliveryFailed) {
    const lastErr = attempts.map((a) => a.errorMessage || a.rejectionReason).filter(Boolean).pop();
    final = { label: "Failed", state: "failed", at: at(failedAt ?? 5), detail: lastErr ?? (p.finalStatus ?? p.order.status) };
  } else if (statusParked) {
    // Above `deliveredOk` on purpose: a parked delivery may well have a transport-accepted
    // attempt behind it, and that attempt is exactly what must not be read as arrival.
    const parked = PARKED_FINAL[fs] ?? PARKED_FALLBACK;
    final = { label: parked.label, state: "blocked", at: at(5), detail: parked.detail };
  } else if (needsReview) {
    final = { label: "Needs review", state: "current", at: null, detail: "Resolve exceptions to continue" };
  } else if (deliveredOk) {
    final = { label: "Awaiting response", state: "current", at: at(5), detail: "Delivered — no supplier confirmation yet" };
  } else if (statusUnknown) {
    // NOT "In progress". That is a decided answer — it says the order is moving — and
    // this build cannot read the status well enough to say so. The raw value is quoted
    // because it is the one thing the operator can act on.
    final = {
      label: "Status not recognised",
      state: "blocked",
      at: null,
      detail:
        `This order's status is "${p.finalStatus ?? p.order.status ?? "missing"}", which this ` +
        `version of ProcuLink can't read. Check the order itself before acting on this history.`,
    };
  } else {
    final = { label: "In progress", state: "pending", at: null };
  }

  return { stages, final };
}

/**
 * The supplier endpoint's raw response body, shown as THEIRS.
 *
 * Until 2026-08-14 the API sent this field and nothing rendered it — while two other files
 * justified sanitising their own copy on the grounds that "the full body stays in the order
 * passport, which is where an integrator goes to read exactly what came back". It did not.
 *
 * Three rules hold here, and each is why this is a component rather than an inline block:
 *
 *  1. It is ATTRIBUTED. The heading says whose words these are. ProcuLink draws no conclusion
 *     from the body — it does not parse it — so it must never appear as our sentence.
 *  2. It is QUOTED, not narrated: monospace, pre-wrapped, in its own bordered block, so an HTML
 *     error page or a JSON blob reads as a payload rather than as prose we wrote.
 *  3. It is BOUNDED by the API (DeliveryAttempt.MaxResponseBodyLength) and again here, so a
 *     hostile or enormous body cannot run away with the panel.
 *
 * Deliberately NOT passed through `supplierReasonText`: that helper exists to lift a sentence out
 * of a payload for use in OUR copy, and returns null when it cannot. This block is the opposite
 * job — showing the payload itself, verbatim, for an integrator diagnosing a 2xx that carried a
 * refusal. React escapes it; it is never dangerouslySetInnerHTML.
 */
function SupplierResponseBody({ body }: { body: string | null }) {
  const trimmed = body?.trim();
  if (!trimmed) return null;

  const MAX = 2000;
  const shown = trimmed.length > MAX ? trimmed.slice(0, MAX) : trimmed;
  const truncated = trimmed.length > MAX;

  return (
    <div className="flex flex-col gap-1">
      <div style={{ color: "var(--ink-faint)" }}>What the supplier&apos;s endpoint returned</div>
      <pre
        className="font-mono text-[11.5px] overflow-x-auto"
        style={{
          margin: 0,
          padding: "8px 10px",
          border: "1px solid var(--border)",
          borderRadius: "6px",
          background: "var(--surface-2)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          maxHeight: "220px",
          overflowY: "auto",
        }}
      >
        {shown}
      </pre>
      {truncated && (
        <div style={{ color: "var(--ink-faint)" }}>
          Truncated for display. The full recorded response is in the downloaded acceptance proof.
        </div>
      )}
    </div>
  );
}

// ─── Visual atoms ───────────────────────────────────────────────────────────

const STATE_STYLE: Record<StageState, { ring: string; fill: string; text: string; glyph: string }> = {
  // `fill` carries the white ✓ glyph, so it is a TEXT background even though the
  // glyph is aria-hidden: #FFFFFF on #2E8E3A is 4.1613:1. --brand-green-btn is
  // the token this repo already uses for a solid green under white text (5.0244:1
  // — same move as the webhooks and settings primary buttons). `ring` stays
  // --brand-green: it is a 2px border, non-text, and clears the 3:1 floor.
  // failed's #B43838 already carries white at 5.8932:1 and is left alone.
  done:    { ring: "#2E8E3A", fill: "#297F34", text: "#1E6D29", glyph: "✓" },
  current: { ring: "#1E66C9", fill: "#FFFFFF", text: "#0F4FA8", glyph: "●" },
  pending: { ring: "#CBD0DA", fill: "#FFFFFF", text: "var(--ink-faint)", glyph: "" },
  failed:  { ring: "#B43838", fill: "#B43838", text: "#B43838", glyph: "✕" },
  // Parked / unreadable — stopped, but nothing broke, so it is neither the green nor the
  // red. TOKENS, not the neighbouring raw hex, deliberately: this row is new debt and the
  // design-token gate counts every literal (comments included), so there is no reason to
  // add four.
  //
  // All three slots are `--amber-text`, and `ring` is NOT the lighter `--amber` even
  // though a 2px border would clear the 3:1 non-text floor with it. The node's glyph
  // colour is `n.state === "current" ? s.ring : white`, so `ring` reaches a TEXT slot by
  // indirection — src/test/textColorScan.test.ts catches exactly that spelling, and
  // `--amber` fails the 4.5:1 text floor on every light surface this app has. Same
  // one-colour shape as the `failed` row above, for the same reason. `--amber-text`
  // carries the white glyph at 6.3161:1 and sits on the Section's white at the same
  // 6.3161:1 — over AA in both slots.
  blocked: { ring: "var(--amber-text)", fill: "var(--amber-text)", text: "var(--amber-text)", glyph: "!" },
};

/**
 * A model score on a mapping row.
 *
 * Two things were wrong with this before, and the second one is why the first mattered.
 *
 * It restated the tier ladder inline (`>=90 / >=75` with its own hex triples) instead of importing
 * the one in ds-tokens — a sixth copy of thresholds this codebase has already had to converge once.
 * It now takes its colours from `confidenceTone`, so there is nothing here to drift.
 *
 * More seriously, what it was colouring was not a confidence. The API sent
 * `PurchaseOrderLineEntity.Confidence`, and that column held a three-valued STATE FLAG —
 * `resolved ? (parserFlagged ? 0.5 : 1.0) : 0.0` — so a line resolved from the supplier's saved
 * mappings printed a green **100%**, a parser-flagged line a red **50%**, and an unresolved line a
 * red **0%**. No model produced any of those numbers. The backend now sends null for every line
 * nothing scored, and the row's `source` badge beside this carries the resolution state, which is
 * what it always described.
 *
 * ── On "a number here can only be a model confidence" ───────────────────────────────────────────
 *
 * This comment used to end by asserting exactly that, as settled fact, and it was NOT true when it
 * was written. `line.Confidence` is only ever written from `AiSuggestionConfidence`
 * (OrderResolutionService, on accept), and ingestion was still stamping a literal `0.95f` onto that
 * field for two DETERMINISTIC producers — an exact supplier-catalog hit on a manufacturer part
 * number, and an echo of a part number the source document prints. Accepting such a line promoted
 * the 0.95 straight into this column, so the passport printed a green "95%" over a lookup, under an
 * accessible name that called it AI. The comment was load-bearing and wrong: it is the stated reason
 * the aria-label is allowed to say "AI confidence".
 *
 * It is true now, and here is the whole of what makes it true — it is not a property of this file:
 * both deterministic producers send no confidence at all, so `AiSuggestionConfidence` is non-null
 * only when a scorer produced a number, and this column inherits that. **If that invariant is ever
 * relaxed upstream, this accessible name becomes a lie again.** It is pinned on the backend by
 * `DeterministicSuggestionsCarryNoConfidenceTests`, and on this side by
 * `OrderPassport.confidence.test.tsx`.
 */
function Pct({ value }: { value: number | null | undefined }) {
  // No number, no chip — never a 0%. The caller already guards, but a second reader of this
  // component should not have to know that, and 0% on the ramp is a red "certainly wrong".
  if (value == null || Number.isNaN(value)) return null;
  const pct = Math.round(value);
  const tone = confidenceTone(pct);
  return (
    <span
      aria-label={`AI confidence ${pct}%`}
      style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", background: tone.bg, color: tone.fg, borderRadius: 3, padding: "2px 5px" }}
    >
      {pct}%
    </span>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <Card as="section" flush radius={8}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid #E5E8EE", display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: "#5E6779", margin: 0 }}>{title}</h3>
        {count != null && (
          <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: "var(--ink-faint)" }}>{count}</span>
        )}
      </div>
      <div style={{ padding: 14 }}>{children}</div>
    </Card>
  );
}

function Ref({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)" }}>{label}</span>
      <span style={{ fontSize: 11.5, fontFamily: "'JetBrains Mono',monospace", color: "#0B1A2F", wordBreak: "break-all" }}>{value || "—"}</span>
    </div>
  );
}

const SOURCE_BADGE: Record<string, { bg: string; color: string }> = {
  deterministic: { bg: "#E9F1EA", color: "#1E6D29" },
  ai:            { bg: "#F0EAFB", color: "#5E3DB0" },
  unresolved:    { bg: "#FBE3E3", color: "#B43838" },
};

function MappingRow({ d }: { d: PassportMappingDecision }) {
  const badge = SOURCE_BADGE[lc(d.source)] ?? { bg: "#F1F3F7", color: "#5E6779" };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderTop: "1px solid #F0F2F6", fontSize: 11.5 }}>
      <span style={{ width: 22, flexShrink: 0, color: "var(--ink-faint)", fontFamily: "'JetBrains Mono',monospace" }}>{d.lineNumber}</span>
      <span data-testid="mapping-buyer-code" style={{ fontFamily: "'JetBrains Mono',monospace", color: "#1E66C9", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{d.buyerItemCode || "—"}</span>
      <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>→</span>
      {/* Resolved code is #1E6D29, not #2E8E3A: 11.5px mono copy on the Section's
          #FFFFFF, where #2E8E3A is 4.1613:1 — under AA. #1E6D29 is 6.4128:1, and
          matches the #1E66C9 buyer code beside it (5.5275:1). */}
      <span data-testid="mapping-supplier-code" style={{ fontFamily: "'JetBrains Mono',monospace", color: d.supplierItemCode ? "#1E6D29" : "#B43838", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{d.supplierItemCode || "unresolved"}</span>
      <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", background: badge.bg, color: badge.color, borderRadius: 3, padding: "2px 6px" }}>{d.source}</span>
      {d.confidence != null && <Pct value={d.confidence <= 1 ? d.confidence * 100 : d.confidence} />}
    </div>
  );
}

/** What colour the attempt's own status word is printed in. */
const OUTCOME_COLOR: Record<DeliveryAttemptOutcome, string> = {
  sent: "#1E6D29",
  failed: "#B43838",
  // A state nobody can call, and a status we do not recognise, read the same way to an
  // operator: we cannot tell you. Amber, never green — an unrecognised status used to
  // satisfy `includes("deliver")` and print in the success colour.
  unknown: "#B36D14",
  unrecognised: "#B36D14",
};

/**
 * One honest sentence per failure. This used to be a single line telling the retention story
 * ("the link may have expired, or the file may have been removed…") for EVERY failure — shown
 * verbatim for 404 and 429, where it is simply untrue. The endpoint distinguishes them
 * (404 no such artifact for this order · 410 Gone blob purged per retention · 429 signed-URL
 * rate limit), so the copy does too.
 */
function downloadFailureMessage(err: unknown): string {
  const status = err instanceof ApiHttpError ? err.status : 0;
  if (status === 410) return "That copy is gone — it was removed under your data-retention setting.";
  if (status === 404) return "We have no stored copy of that file for this order.";
  if (status === 429) return "Too many download requests just now. Wait a moment, then try again.";
  if (status === 401 || status === 403) return "You do not have access to that file.";
  return "Couldn't get that file just now. Please try again.";
}

/**
 * One delivery attempt, with the two things a disputed delivery actually needs: the exact
 * file that went out, and the fingerprint recorded when it went out.
 *
 * The pairing is per attempt, never per order — an order can hold several artifacts and
 * several attempts, and a retry after a re-transform sends DIFFERENT bytes. `a.artifactId`
 * is the artifact this attempt dispatched; when the backend can't prove which one it was it
 * sends null, and we offer no download rather than handing the operator bytes we can't vouch
 * for. The generated-file comparison likewise only runs when this attempt sent the artifact
 * we're holding the hash for.
 *
 * The second axis is WHETHER anything went out at all. Only a status the channel confirmed
 * earns the words "what we sent"; every other state — a failure, a crashed in-flight row, a
 * parked unknown outcome — gets "what we tried to send", which is true in all of them.
 */
function DeliveryRow({
  a,
  orderId,
  generated,
}: {
  a: PassportDeliveryAttempt;
  orderId: string;
  generated: PassportOutputArtifact | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ok = attemptSendWasObserved(a.status);
  const unknownOutcome = attemptOutcomeIsUnknown(a.status);
  const color = OUTCOME_COLOR[deliveryAttemptOutcome(a.status)];

  // Only comparable when this attempt sent the very artifact whose hash we hold.
  const comparable =
    !!generated && !!a.artifactId && !!a.artifactSha256 && !!generated.artifactSha256 &&
    generated.artifactId === a.artifactId;
  const matches = comparable && generated!.artifactSha256 === a.artifactSha256;

  async function handleDownload() {
    if (!a.artifactId) return;
    setError(null);

    // Open the tab INSIDE the click, while the browser still counts this as a user gesture.
    // Doing it after the await — as this used to — puts window.open outside the transient
    // activation: Safari refuses it outright, Chrome and Firefox drop it once the activation
    // window lapses, which a cold-start API round trip can outlive. The old code also never
    // checked the return value and caught only the fetch, so a blocked pop-up produced no
    // file, no error and no message at all.
    //
    // `noopener` is deliberately NOT passed: with it window.open returns null even when
    // nothing was blocked, which would make "blocked" indistinguishable from "fine". The
    // back-reference is severed by hand instead, before the tab is pointed anywhere.
    const tab = window.open("", "_blank");
    if (!tab) {
      setError("Your browser blocked the download window. Allow pop-ups for this site, then try again.");
      return;
    }
    try { tab.opener = null; } catch { /* hardened window — nothing to sever */ }

    setBusy(true);
    try {
      const { url } = await apiClient.getDownloadUrl(orderId, a.artifactId);
      tab.location.href = url;
    } catch (err) {
      try { tab.close(); } catch { /* already gone */ }
      setError(downloadFailureMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="delivery-attempt" style={{ padding: "8px 0", borderTop: "1px solid #F0F2F6", display: "flex", flexDirection: "column", gap: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: "#5E6779", fontFamily: "'JetBrains Mono',monospace" }}>#{a.attemptNumber}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "capitalize" }}>{a.status || "—"}</span>
        {a.channel && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>· {a.channel}</span>}
        {a.responseCode != null && <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: "var(--ink-faint)" }}>· {a.responseCode}</span>}
        <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--ink-faint)" }}>{fmtDateTime(a.attemptedAt)}</span>
      </div>
      {a.destination && <div style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: "#5E6779", wordBreak: "break-all" }}>{a.destination}</div>}
      {(a.errorMessage || a.rejectionReason) && (
        <div style={{ fontSize: 11, color: "#B43838" }}>{a.errorMessage || a.rejectionReason}</div>
      )}

      {/* Proof of what went out */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
        {a.artifactId ? (
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            style={{
              height: 24, padding: "0 9px", borderRadius: 5, border: "1px solid #CBD8EC",
              background: "#F4F8FF", color: "#0F4FA8", fontSize: 10.5, fontWeight: 700,
              cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "Preparing…" : ok ? "↓ Download what we sent" : "↓ Download the file we tried to send"}
          </button>
        ) : (
          <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>
            No stored copy of what this attempt sent.
          </span>
        )}
        {unknownOutcome && (
          <span style={{ fontSize: 10.5, color: "#8A5310" }}>
            We do not know whether this file reached the supplier.
          </span>
        )}
        {comparable && (
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", borderRadius: 3, padding: "2px 6px", background: matches ? "#E9F1EA" : "#FBE3E3", color: matches ? "#1E6D29" : "#B43838" }}>
            {matches ? "Matches the file we generated" : "Does not match the file we generated"}
          </span>
        )}
      </div>

      {a.artifactSha256 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)" }}>
            {ok ? "Fingerprint of the file we sent (SHA-256)" : "Fingerprint of the file we tried to send (SHA-256)"}
          </span>
          <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: "#5E6779", wordBreak: "break-all" }}>
            {a.artifactSha256}
          </span>
        </div>
      )}

      {error && <div style={{ fontSize: 11, color: "#B43838" }}>{error}</div>}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export function OrderPassport({ orderId }: { orderId: string }) {
  const [exported, setExported] = useState(false);

  const { data: passport, isLoading, isError, refetch } = useQuery({
    queryKey: ["order-passport", orderId],
    queryFn: () => apiClient.getOrderPassport(orderId),
    retry: 1,
    staleTime: 30_000,
  });

  function handleDownloadJson() {
    if (!passport) return;
    const blob = new Blob([JSON.stringify(passport, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const suffix = passport.order.isSample ? "-practice" : "";
    a.download = `passport-${passport.order.poNumber || passport.order.id}${suffix}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setExported(true);
    setTimeout(() => setExported(false), 2500);
  }

  if (isLoading) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ height: 18, width: 220, background: "#E5E8EE", borderRadius: 4, marginBottom: 16 }} />
        <div style={{ display: "grid", gap: 10 }}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ height: 40, background: "#F1F3F7", borderRadius: 8 }} />
          ))}
        </div>
      </div>
    );
  }

  if (isError || !passport) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 px-6 text-center">
        <div style={{ fontSize: 26, color: "#CBD0DA" }}>⊘</div>
        <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>Couldn&apos;t load the order history</p>
        <p className="text-[13px]" style={{ color: "#5E6779" }}>The history for this order is temporarily unavailable.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-[6px] px-4 text-[12.5px] font-semibold"
          style={{ height: 32, border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#0B1A2F" }}
        >
          ↻ Retry
        </button>
      </div>
    );
  }

  const { stages, final } = deriveTimeline(passport);
  const allNodes: Stage[] = [...stages, { key: "final", label: final.label, state: final.state, at: final.at, detail: final.detail }];

  return (
    <div className="mx-auto w-full max-w-[1080px] px-4 py-5 sm:px-6">
      {/* Header + proof actions */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F" }}>
              Order history
            </h2>
            {passport.order.isSample ? <PracticeChip size="sm" /> : null}
          </div>
          <p className="text-[12.5px] mt-1" style={{ color: "#5E6779" }}>
            Full history for <span className="font-mono" style={{ color: "#0F4FA8" }}>{passport.order.poNumber}</span> — every stage, decision, and delivery attempt, with the supplier&apos;s response.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadJson}
            className="rounded-[6px] px-3 text-[12.5px] font-semibold"
            style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: "none", cursor: "pointer" }}
          >
            {exported ? "✓ Downloaded" : "↓ Download order record"}
          </button>
        </div>
      </div>

      {/* Two columns on desktop: timeline + evidence */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,300px)_minmax(0,1fr)]">
        {/* Timeline */}
        <Section title="Timeline">
          <div style={{ position: "relative" }}>
            <div style={{ position: "absolute", top: 8, bottom: 8, left: 8, width: 2, background: "linear-gradient(180deg,#1E66C9,#2E8E3A)", borderRadius: 2 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {allNodes.map((n) => {
                const s = STATE_STYLE[n.state];
                return (
                  <div key={n.key} data-testid={`timeline-node-${n.key}`} style={{ position: "relative", paddingLeft: 28, paddingTop: 6, paddingBottom: 6 }}>
                    <div
                      aria-hidden
                      style={{
                        position: "absolute", left: 1, top: 8, width: 16, height: 16, borderRadius: "50%",
                        background: s.fill, border: `2px solid ${s.ring}`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 9, fontWeight: 800, color: n.state === "current" ? s.ring : "#FFFFFF",
                        boxShadow: n.state === "current" ? `0 0 0 3px ${s.ring}22` : "none",
                      }}
                    >
                      {s.glyph}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, color: n.state === "pending" ? "var(--ink-faint)" : "#0B1A2F" }}>{n.label}</span>
                      {n.state === "current" && <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: s.text }}>in progress</span>}
                      {/* Never "in progress" — that is the word a parked node must not
                          wear, and wearing it is what this state was added to stop. */}
                      {n.state === "blocked" && <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: s.text }}>waiting on you</span>}
                    </div>
                    {n.detail && <div style={{ fontSize: 11, color: n.state === "failed" ? "#B43838" : n.state === "blocked" ? "var(--amber-text)" : "#5E6779", marginTop: 1 }}>{n.detail}</div>}
                    {n.at && <div style={{ fontSize: 10.5, color: "var(--ink-faint)", marginTop: 1 }}>{fmtDateTime(n.at)}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </Section>

        {/* Evidence */}
        <div className="flex flex-col gap-5">
          {/* Artifacts */}
          <Section title="Source & output">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-3">
                <Ref label="Source file" value={passport.sourceArtifact?.storageKey} />
                <Ref label="Detected format" value={passport.sourceArtifact?.detectedFormat?.toUpperCase()} />
              </div>
              <div className="flex flex-col gap-3">
                <Ref label="Output file" value={passport.outputArtifact?.fileKey} />
                <Ref label="Output format" value={passport.outputArtifact?.format?.toUpperCase()} />
                {/* The fingerprint recorded when the file was generated — what a downloaded
                    copy is checked against. Shown here rather than only per attempt because
                    it belongs to the file, not to any one send. */}
                <Ref label="Fingerprint of the file we generated (SHA-256)" value={passport.outputArtifact?.artifactSha256} />
              </div>
            </div>
            {passport.supplierProfile && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px dashed #E5E8EE", display: "flex", flexWrap: "wrap", gap: 16, fontSize: 11.5, color: "#5E6779" }}>
                <span>Protocol: <strong style={{ color: "#0B1A2F" }}>{passport.supplierProfile.protocol || "—"}</strong></span>
                <span>Profile output: <strong style={{ color: "#0B1A2F" }}>{passport.supplierProfile.outputFormat || "—"}</strong></span>
                {passport.supplierProfile.acceptedFormats?.length ? (
                  <span>Accepts: <strong style={{ color: "#0B1A2F" }}>{passport.supplierProfile.acceptedFormats.join(", ")}</strong></span>
                ) : null}
                {passport.supplierProfile.version && <span>v{passport.supplierProfile.version}</span>}
              </div>
            )}
          </Section>

          {/* Canonical summary */}
          {passport.canonical && (
            <Section title="Order summary">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Ref label="Lines" value={String(passport.canonical.lineCount)} />
                <Ref label="Total quantity" value={passport.canonical.totalQuantity != null ? String(passport.canonical.totalQuantity) : "—"} />
                <Ref label="Total value" value={passport.canonical.totalValue != null ? passport.canonical.totalValue.toLocaleString("en-IE", { minimumFractionDigits: 2 }) : "—"} />
                <Ref label="Currency" value={passport.canonical.currency} />
              </div>
            </Section>
          )}

          {/* Mapping decisions */}
          {passport.mappingDecisions.length > 0 && (
            <Section title="Mapping decisions" count={passport.mappingDecisions.length}>
              <div>{passport.mappingDecisions.map((d) => <MappingRow key={d.lineNumber} d={d} />)}</div>
            </Section>
          )}

          {/* Delivery attempts */}
          <Section title="Delivery attempts" count={passport.deliveryAttempts.length}>
            {passport.deliveryAttempts.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: "var(--ink-faint)", margin: 0 }}>No delivery attempts yet.</p>
            ) : (
              <div>
                {passport.deliveryAttempts.map((a) => (
                  <DeliveryRow key={a.attemptNumber} a={a} orderId={orderId} generated={passport.outputArtifact} />
                ))}
              </div>
            )}
          </Section>

          {/* Supplier response */}
          <Section title="Supplier response">
            {passport.supplierResponse ? (
              <div className="flex flex-col gap-2 text-[12.5px]" style={{ color: "#5E6779" }}>
                <div>
                  Outcome: <strong style={{ color: lc(passport.supplierResponse.outcome) === "delivered" ? "#1E6D29" : lc(passport.supplierResponse.outcome) === "rejected" ? "#B43838" : "#0B1A2F", textTransform: "capitalize" }}>{passport.supplierResponse.outcome}</strong>
                  {passport.supplierResponse.responseCode != null && <span className="font-mono"> · {passport.supplierResponse.responseCode}</span>}
                </div>
                {/* Our dispatch clock, labelled as ours. This read "Acknowledged: {t}" off a field
                    named acknowledgedAt, which no supplier had anything to do with. */}
                {passport.supplierResponse.transportAcceptedAt && <div>Sent: {fmtDateTime(passport.supplierResponse.transportAcceptedAt)}</div>}
                {lc(passport.supplierResponse.outcome) === "delivered" && (
                  <div>The supplier has not confirmed this order. ProcuLink does not receive acknowledgements on any delivery channel.</div>
                )}
                {passport.supplierResponse.rejectionReason && <div style={{ color: "#B43838" }}>{supplierReasonText(passport.supplierResponse.rejectionReason) ?? "The supplier refused this order without giving a readable reason."}</div>}
                <SupplierResponseBody body={passport.supplierResponse.responseBody} />
              </div>
            ) : (
              <p className="text-[12.5px]" style={{ color: "var(--ink-faint)", margin: 0 }}>No supplier response recorded yet.</p>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
