// StatusJourney — 5-node mini-track showing the order pipeline.
// Stage 0 = Parse, 1 = Normalize, 2 = Validate, 3 = Transform, 4 = Deliver
// compact    = 11px nodes (tokens.css .journey.compact .jn)
// full       = 18px nodes + labels (tokens.css .journey.full .jn)
// crossingRef (optional) — adds "Stage N of 5 · {ref}" sub-label above full variant

export type FailedStage = 0 | 1 | 2 | 3 | 4;
// A failure carries the node it failed AT (`{ failed: 3 }` = failed at Transform).
// The old bare `"failed"` variant carried no stage, so every renderer hardcoded the
// red X to node 2 (Validate) — a delivery failure drew as a validation failure.
export type OrderStage = FailedStage | { failed: FailedStage };

const STAGES = ["Parse", "Normalize", "Validate", "Transform", "Deliver"] as const;

// Which pipeline node each failure status points at — the backend producers, not a
// FE guess: bare `failed` is the PARSE-terminal status (ParseOrderJob.cs:67-73 refuses
// it as "Parse failed: … terminal status"; StuckOrderDetectionService.cs:193-195 writes
// it only for a `parsing` strand, while a `transforming` strand recovers to `ready`,
// never `failed`, :143-156; the transition table's own words are "Failed parse:
// re-parse", OrderStatusTransitionObserver.cs:159). Keys mirror the backend's
// OrderStatusConstants.FailureBucket — statusJourneyFailedStage.test.tsx pins this
// map against InboxView's FAILED_BUCKET so the two cannot drift.
export const FAILURE_JOURNEY_STAGE = {
  failed: 0,
  transform_failed: 3,
  delivery_failed: 4,
  delivery_dead_letter: 4,
  rejected_by_supplier: 4,
} as const satisfies Record<string, FailedStage>;

export type FailureStatus = keyof typeof FAILURE_JOURNEY_STAGE;

export function isFailureStatus(status: string): status is FailureStatus {
  return status in FAILURE_JOURNEY_STAGE;
}

export function failedStageFor(status: FailureStatus): OrderStage {
  return { failed: FAILURE_JOURNEY_STAGE[status] };
}

interface StatusJourneyProps {
  stage: OrderStage;
  compact?: boolean;
  /** Optional crossing reference — shows "Stage N of 5 · {crossingRef}" above the full stepper */
  crossingRef?: string;
}

export function StatusJourney({ stage, compact = false, crossingRef }: StatusJourneyProps) {
  // failedAt: the node the failure sits on (null when the order is progressing).
  // numericStage: -1 on a failed journey so no node reads done/active.
  const failedAt = typeof stage === "object" ? stage.failed : null;
  const numericStage = typeof stage === "number" ? stage : -1;

  if (compact) {
    // tokens.css .journey.compact .jn { width:11px; height:11px }
    return (
      <div className="flex items-center">
        {STAGES.map((_, i) => {
          const done   = numericStage > i;
          const active = numericStage === i;
          const errDot = failedAt === i;
          return (
            <div key={i} className="flex items-center">
              {i > 0 && (
                <div
                  style={{
                    height: 1.5,
                    minWidth: 12,
                    flex: 1,
                    background: i <= numericStage ? "#2E8E3A" : "#CBD0DA",
                  }}
                />
              )}
              <div
                className="rounded-full flex-shrink-0"
                style={{
                  width: 11,
                  height: 11,
                  background: errDot
                    ? "#B43838"
                    : done
                    ? "#2E8E3A"
                    : active
                    ? "#1E66C9"
                    : "#FFFFFF",
                  border: `1.5px solid ${
                    errDot ? "#B43838" : done ? "#2E8E3A" : active ? "#1E66C9" : "#CBD0DA"
                  }`,
                }}
              />
            </div>
          );
        })}
      </div>
    );
  }

  // Full — tokens.css .journey.full .jn { width:18px; height:18px }
  const stageNum = (failedAt ?? numericStage) + 1; // 1-indexed for display
  return (
    <div className="w-full max-w-[720px] mx-auto">
      {/* Optional sub-label */}
      {crossingRef && (
        <p className="text-center text-[11px] font-medium text-[#5E6779] mb-3 tracking-wide">
          Stage {stageNum} of 5
          <span className="mx-1.5 text-[#CBD0DA]">·</span>
          {crossingRef}
        </p>
      )}
      <div className="flex items-center">
        {STAGES.map((label, i) => {
          const done   = numericStage > i;
          const active = numericStage === i;
          const err    = failedAt === i;
          return (
            <div key={i} className="flex items-center flex-1 last:flex-none">
              {i > 0 && (
                <div
                  style={{
                    flex: 1,
                    height: 1.5,
                    minWidth: 26,
                    background: i <= numericStage ? "#2E8E3A" : "#CBD0DA",
                  }}
                />
              )}
              <div className="flex flex-col items-center relative z-10">
                <div
                  className="rounded-full flex items-center justify-center flex-shrink-0"
                  style={{
                    width: 18,
                    height: 18,
                    background: err
                      ? "#B43838"
                      : done
                      ? "#2E8E3A"
                      : active
                      ? "#1E66C9"
                      : "#FFFFFF",
                    border: `1.5px solid ${
                      err ? "#B43838" : done ? "#2E8E3A" : active ? "#1E66C9" : "#CBD0DA"
                    }`,
                  }}
                  data-pulse={active ? "true" : "false"}
                >
                  {done && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5L4 7.5L8.5 2.5" stroke="white" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  {err && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 2L8 8M8 2L2 8" stroke="white" strokeWidth={1.8} strokeLinecap="round" />
                    </svg>
                  )}
                </div>
                <span
                  className="mt-1.5 text-[10px] text-center leading-tight"
                  style={{
                    // `done` is #1E6D29, not #2E8E3A: this is 10px/400 copy, so the
                    // 4.5:1 AA floor applies, and #2E8E3A is 4.1613:1 on #FFFFFF /
                    // 3.8846:1 on the #F6F7FA work area. #1E6D29 is 6.4128 / 5.9863.
                    // The dot and rail above stay #2E8E3A — non-text, 3:1 floor.
                    color: active ? "#0B1A2F" : done ? "#1E6D29" : "var(--ink-faint)",
                    fontWeight: active ? 700 : 400,
                  }}
                >
                  {label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Status pill — semantic colors matching tokens.css .pill-* exactly.
// NB: StatusCell below currently has NO production call sites (the inbox renders via
// InboxView's StatusDotPill on mobile and UnifiedStatusBadge on desktop). STATUS_PILL is
// therefore not the live pill source; keep it in step with InboxView's
// STATUS_PRESENTATION and UnifiedStatusBadge's STATUS_META, which are.
// `held` covers the backend `delivery_held` billing hold. It needs its own member
// because none of the others is honest for it: `review` says "Needs review" (the
// order is clean), `delivering` pulses blue "Ready to send" (it is blocked), and
// `failed` is red (nothing failed — the supplier file is intact and the backend
// releases the order automatically once billing is in good standing).
// `sending` covers the backend `delivering` status — an order the Worker has claimed
// and is dispatching right now. It needs its own member because the `delivering`
// member is already spoken for: it is the display bucket for `ready_to_deliver`
// ("Ready to send"). `sent` would claim the supplier already has the file, and
// `extracting` is three stages too early.
// `unrouted` covers the backend `unrouted` routing hold — extracted, but no supplier was
// resolved, so it waits for one. It needs its own member because `new` denies the parse
// ran (it did — that is why there are lines to look at), `review` says "Needs review"
// (there is no supplier to resolve lines against yet), and `failed` is red (nothing
// failed; assigning a supplier re-enters the parse flow).
// `unconfirmed` covers `delivery_unconfirmed`: a crash lost the outcome after we sent,
// on a channel that cannot tell us whether the file arrived, so it waits on a person to
// choose "Send again" or "Mark as delivered". It needs its own member because every
// neighbour states something we did not observe: `failed` is red and claims a failure we
// cannot confirm, `sent` claims the supplier has the file, `sending` claims it is still
// in flight (nothing is — the attempt is over, only its outcome is missing), and
// `held`/`review` misstate the cause.
// `transforming` covers the backend `transforming` status — the output file is being
// built right now. It needs its own member because it used to be folded into
// `extracting`, three nodes early: the desktop badge (keyed on the raw status) said
// "Preparing output" while the mobile card (keyed on this collapsed union) said
// "Extracting", and BOTH lit the Normalize node for an order that is at Transform.
// The dashboard's own map has always put it at 3 (journeyStageFor, pinned by
// statusJourneyFailedStage.test.tsx) — the inbox was the side that disagreed.
// `unknown` covers a status STRING THIS BUILD HAS NEVER HEARD OF — not a backend status
// but the absence of one. Frontend and backend deploy separately, so an order arriving in
// a status the manifest (src/lib/orderStatusManifest.ts) does not name is routine, and
// every other member here would be a claim we cannot support: `new` says the pipeline
// never started (the defect this member replaced — an order mid-anything rendered as
// brand-new and untouched at stage 0), `failed` is red for something that may be going
// perfectly, and the rest each name a node. It has no stage on purpose; see STATUS_STAGE.
export type CrossingStatus = "new" | "extracting" | "unrouted" | "review" | "ready" | "transforming" | "sent" | "delivering" | "sending" | "failed" | "held" | "unconfirmed" | "unknown";

const STATUS_PILL: Record<CrossingStatus, { bg: string; color: string; dot: string; pulse?: boolean; label: string }> = {
  // tokens.css .pill-new → surface-2 (#F1F3F7) / ink-muted (#5E6779) / ink-faint (#5B6980)
  new:        { bg: "#F1F3F7", color: "#5E6779", dot: "var(--ink-faint)",  label: "New" },
  // tokens.css .pill-extracting → brand-blue-soft / brand-blue-deep / brand-blue (NOT violet)
  extracting: { bg: "#EAF0F8", color: "#0F4FA8", dot: "#1E66C9",  label: "Extracting" },
  // tokens.css .pill-unrouted → amber-soft / amber-text / amber, matching `review`: both
  // are user-action backlogs. No pulse — it waits on a person, not on us. The label is
  // the backend's own words for the unrouted_order exception ("Order needs a supplier").
  unrouted:   { bg: "#FAF1DD", color: "#8A5310", dot: "#B36D14",  label: "Needs supplier" },
  review:     { bg: "#FAF1DD", color: "#8A5310", dot: "#B36D14",  label: "Needs review" },
  ready:      { bg: "#E9F1EA", color: "#1E6D29", dot: "#2E8E3A",  label: "Ready" },
  // Same blue as `extracting` and a pulse: the output really is being built right now.
  // The word matches UnifiedStatusBadge STATUS_META.transforming, so the collapsed
  // pill and the raw-status badge cannot say different things about one order.
  transforming: { bg: "#EAF0F8", color: "#0F4FA8", dot: "#1E66C9", pulse: true, label: "Preparing output" },
  // tokens.css .pill-sent → brand-green-soft / brand-green-deep / brand-green
  sent:       { bg: "#E9F1EA", color: "#1E6D29", dot: "#2E8E3A",  label: "Delivered" },
  // tokens.css .pill-delivering → brand-blue-soft / brand-blue-deep / brand-blue + pulse-dot
  delivering: { bg: "#EAF0F8", color: "#0F4FA8", dot: "#1E66C9", pulse: true, label: "Delivering" },
  // tokens.css .pill-sending → same blue as `delivering`, and it pulses because this
  // one really IS in flight. "Sending" matches UnifiedStatusBadge STATUS_META.delivering.
  sending:    { bg: "#EAF0F8", color: "#0F4FA8", dot: "#1E66C9", pulse: true, label: "Sending" },
  failed:     { bg: "#FBE3E3", color: "#B43838", dot: "#B43838",  label: "Failed" },
  // tokens.css .pill-held → amber-soft / amber-text / amber, matching `review`.
  // Deliberately no pulse: a paused delivery is not in flight.
  held:       { bg: "#FAF1DD", color: "#8A5310", dot: "#B36D14",  label: "Delivery paused" },
  // tokens.css .pill-unconfirmed → amber-soft / amber-text / amber, matching `held`:
  // needs a human, is not a red failure. No pulse: nothing is in flight, it's
  // waiting on an operator decision, not on the system.
  unconfirmed: { bg: "#FAF1DD", color: "#8A5310", dot: "#B36D14",  label: "Delivery unknown" },
  // Neutral, and deliberately the quietest thing on the row: we are not saying the order
  // is fine, broken, or anywhere in particular — only that this build cannot read its
  // status. No pulse (nothing is known to be in flight). Written as tokens rather than
  // literals because it is new; the hex above is pre-existing debt.
  unknown:    { bg: "var(--surface-2)", color: "var(--ink-muted)", dot: "var(--ink-faint)", label: "Status unknown" },
};

// `failed` is deliberately absent: the collapsed CrossingStatus cannot know WHICH
// node failed — that lives on the raw backend status (FAILURE_JOURNEY_STAGE), so
// StatusCell demands `rawStatus` for failed rows instead of guessing a node.
// `unknown` is absent for the stronger reason: there is no node to give it. A status
// this build cannot read tells us nothing about where the order got to, and any entry
// here — 0 most of all — would be a stage claim invented out of ignorance.
const STATUS_STAGE: Record<Exclude<CrossingStatus, "failed" | "unknown">, OrderStage> = {
  new:        0,
  // Stage 0: an order being read IS at Parse. It sat at 1 (Normalize) and therefore
  // drew Parse as already done — for the one status that means Parse is still running.
  // `new` shares the node, which is the truth: a queued order and a parsing order are
  // both at Parse, told apart by the badge word and its pulse, not by the track.
  extracting: 0,
  // Stage 1: extraction finished, but normalisation cannot start without a supplier to
  // resolve item codes against — so it is parked AT Normalize, not before Parse. This
  // reading only became unambiguous once `extracting` moved off the same node.
  unrouted:   1,
  review:     2,
  ready:      3,
  // Stage 3: the output file is being built — that IS the Transform node.
  transforming: 3,
  sent:       4,
  delivering: 4,
  sending:    4,
  // Stage 4: a held order reached Deliver and stopped there — showing it earlier
  // would understate how far it got (and how little is left to do).
  held:       4,
  // Stage 4, same reasoning: an unconfirmed order also reached Deliver — it was
  // (probably) sent — before the crash lost the outcome.
  unconfirmed: 4,
};

// A failed row must say which raw failure status it carries — the collapsed pill
// alone cannot place the X (see STATUS_STAGE above). An `unknown` row carries no
// stage at all and renders the pill on its own.
type StatusCellProps =
  | { status: Exclude<CrossingStatus, "failed" | "unknown">; rawStatus?: never }
  | { status: "failed"; rawStatus: FailureStatus }
  | { status: "unknown"; rawStatus?: string };

export function StatusCell(props: StatusCellProps) {
  const pill  = STATUS_PILL[props.status];
  const stage: OrderStage | null =
    props.status === "unknown" ? null
    : props.status === "failed" ? failedStageFor(props.rawStatus)
    : STATUS_STAGE[props.status];
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-[9px] py-[2px] text-[11px] font-semibold"
        style={{ background: pill.bg, color: pill.color }}
      >
        <span
          className={["rounded-full flex-shrink-0", pill.pulse ? "animate-[pulse-dot_1.4s_ease-in-out_infinite]" : ""].join(" ").trim()}
          style={{ width: 6, height: 6, background: pill.dot }}
        />
        {pill.label}
      </span>
      {/* No track for an unknown status: five dots with none lit would still be read as
          "at Parse", which is the claim this member exists to stop making. */}
      {stage !== null && <StatusJourney stage={stage} compact />}
    </div>
  );
}
