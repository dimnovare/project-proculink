// StatusJourney — 5-node mini-track showing the order pipeline.
// Stage 0 = In, 1 = Read, 2 = Check, 3 = Transform, 4 = Send
// compact    = 11px nodes (tokens.css .journey.compact .jn)
// full       = 18px nodes + labels (tokens.css .journey.full .jn)
// crossingRef (optional) — adds "Stage N of 5 · {ref}" sub-label above full variant

export type FailedStage = 0 | 1 | 2 | 3 | 4;
// A failure carries the node it failed AT (`{ failed: 3 }` = failed at Transform).
// The old bare `"failed"` variant carried no stage, so every renderer hardcoded the
// red X to node 2 (Validate) — a delivery failure drew as a validation failure.
export type OrderStage = FailedStage | { failed: FailedStage };

export const STAGES = ["In", "Read", "Check", "Transform", "Send"] as const;

// Which pipeline node each failure status points at — the backend producers, not a
// FE guess: bare `failed` is the PARSE-terminal status (the parse job, deleted in plan 13b,
// refused it as "Parse failed: … terminal status"; the stuck-order sweep wrote it only for
// a `parsing` strand, while a `transforming` strand recovered to `ready`, never `failed`).
// Keys mirror the backend's
// OrderStatusConstants.FailureBucket — statusJourneyFailedStage.test.tsx pins this
// map against the manifest's failure bucket (FAILURE_STATUSES in orderStatusManifest.ts)
// so the two cannot drift.
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

// Collapsed display status used by the order archive (src/lib/orderArchiveStatus.ts).
// `unknown` covers a status string this build has never heard of — not a backend status
// but the absence of one. Every other member would be a claim we cannot support, so it
// carries no stage.
export type CrossingStatus = "new" | "extracting" | "unrouted" | "review" | "ready" | "transforming" | "sent" | "delivering" | "sending" | "failed" | "held" | "unconfirmed" | "unknown";
