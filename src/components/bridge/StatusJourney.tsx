// StatusJourney — 5-node mini-track showing the order pipeline.
// Stage 0 = Parse, 1 = Normalize, 2 = Validate, 3 = Transform, 4 = Deliver
// compact    = 11px nodes (tokens.css .journey.compact .jn)
// full       = 18px nodes + labels (tokens.css .journey.full .jn)
// crossingRef (optional) — adds "Stage N of 5 · {ref}" sub-label above full variant

export type OrderStage = 0 | 1 | 2 | 3 | 4 | "failed";

const STAGES = ["Parse", "Normalize", "Validate", "Transform", "Deliver"] as const;

interface StatusJourneyProps {
  stage: OrderStage;
  compact?: boolean;
  /** Optional crossing reference — shows "Stage N of 5 · {crossingRef}" above the full stepper */
  crossingRef?: string;
}

export function StatusJourney({ stage, compact = false, crossingRef }: StatusJourneyProps) {
  const failed = stage === "failed";

  if (compact) {
    // tokens.css .journey.compact .jn { width:11px; height:11px }
    return (
      <div className="flex items-center">
        {STAGES.map((_, i) => {
          const done   = !failed && (stage as number) > i;
          const active = !failed && (stage as number) === i;
          const errDot = failed && i === 2;
          return (
            <div key={i} className="flex items-center">
              {i > 0 && (
                <div
                  style={{
                    height: 1.5,
                    minWidth: 12,
                    flex: 1,
                    background: i <= (stage as number) && !failed ? "#2E8E3A" : "#CBD0DA",
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
  const stageNum = failed ? 2 : (stage as number) + 1; // 1-indexed for display
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
          const done   = !failed && (stage as number) > i;
          const active = !failed && (stage as number) === i;
          const err    = failed && i === 2;
          return (
            <div key={i} className="flex items-center flex-1 last:flex-none">
              {i > 0 && (
                <div
                  style={{
                    flex: 1,
                    height: 1.5,
                    minWidth: 26,
                    background: i <= (stage as number) && !failed ? "#2E8E3A" : "#CBD0DA",
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
                    color: active ? "#0B1A2F" : done ? "#2E8E3A" : "var(--ink-faint)",
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
// Used sparingly (prefer StatusJourney for progress display).
export type CrossingStatus = "new" | "extracting" | "review" | "ready" | "sent" | "delivering" | "failed";

const STATUS_PILL: Record<CrossingStatus, { bg: string; color: string; dot: string; pulse?: boolean; label: string }> = {
  // tokens.css .pill-new → surface-2 (#F1F3F7) / ink-muted (#5E6779) / ink-faint (#5B6980)
  new:        { bg: "#F1F3F7", color: "#5E6779", dot: "var(--ink-faint)",  label: "New" },
  // tokens.css .pill-extracting → brand-blue-soft / brand-blue-deep / brand-blue (NOT violet)
  extracting: { bg: "#EAF0F8", color: "#0F4FA8", dot: "#1E66C9",  label: "Extracting" },
  review:     { bg: "#FAF1DD", color: "#8A5310", dot: "#B36D14",  label: "Needs review" },
  ready:      { bg: "#E9F1EA", color: "#1E6D29", dot: "#2E8E3A",  label: "Ready" },
  // tokens.css .pill-sent → brand-green-soft / brand-green-deep / brand-green
  sent:       { bg: "#E9F1EA", color: "#1E6D29", dot: "#2E8E3A",  label: "Delivered" },
  // tokens.css .pill-delivering → brand-blue-soft / brand-blue-deep / brand-blue + pulse-dot
  delivering: { bg: "#EAF0F8", color: "#0F4FA8", dot: "#1E66C9", pulse: true, label: "Delivering" },
  failed:     { bg: "#FBE3E3", color: "#B43838", dot: "#B43838",  label: "Failed" },
};

const STATUS_STAGE: Record<CrossingStatus, OrderStage> = {
  new:        0,
  extracting: 1,
  review:     2,
  ready:      3,
  sent:       4,
  delivering: 4,
  failed:     "failed",
};

interface StatusCellProps {
  status: CrossingStatus;
}

export function StatusCell({ status }: StatusCellProps) {
  const pill  = STATUS_PILL[status];
  const stage = STATUS_STAGE[status];
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
      <StatusJourney stage={stage} compact />
    </div>
  );
}
