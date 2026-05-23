// StatusJourney — 5-node mini-track showing the order pipeline.
// Stage 0 = Parse, 1 = Normalize, 2 = Validate, 3 = Transform, 4 = Deliver
// compact = small dots only (inbox row); full = dots + labels

export type OrderStage = 0 | 1 | 2 | 3 | 4 | "failed";

const STAGES = ["Parse", "Normalize", "Validate", "Transform", "Deliver"] as const;

interface StatusJourneyProps {
  stage: OrderStage;
  compact?: boolean;
}

export function StatusJourney({ stage, compact = false }: StatusJourneyProps) {
  const failed = stage === "failed";

  if (compact) {
    // Inbox row — 5 small dots
    return (
      <div className="flex items-center gap-[3px]">
        {STAGES.map((_, i) => {
          const done   = !failed && (stage as number) > i;
          const active = !failed && (stage as number) === i;
          const errDot = failed && i === 2; // show error at validate stage
          return (
            <div
              key={i}
              className="rounded-full"
              style={{
                width: 6,
                height: 6,
                background: errDot
                  ? "#C53A3A"
                  : done
                  ? "#2E8E3A"
                  : active
                  ? "#1E66C9"
                  : "#E2E6EE",
                boxShadow: active ? "0 0 0 2px rgba(30,102,201,0.25)" : undefined,
              }}
            />
          );
        })}
      </div>
    );
  }

  // Full — dots + labels (page header bridge graphic)
  return (
    <div className="flex items-center gap-0 relative">
      {/* Connecting line behind dots */}
      <div
        className="absolute top-[9px] left-[9px] right-[9px] h-[2px] rounded spine-animate"
        style={{
          background:
            "linear-gradient(90deg, #1E66C9 0%, #1E66C9 35%, #2E8E3A 65%, #2E8E3A 100%)",
          opacity: 0.35,
        }}
      />
      {STAGES.map((label, i) => {
        const done   = !failed && (stage as number) > i;
        const active = !failed && (stage as number) === i;
        const err    = failed && i === 2;
        return (
          <div key={i} className="flex flex-col items-center flex-1 relative z-10">
            <div
              className={`rounded-full flex items-center justify-center${active ? " spine-reveal" : ""}`}
              style={{
                width: 18,
                height: 18,
                background: err
                  ? "#C53A3A"
                  : done
                  ? "#2E8E3A"
                  : active
                  ? "#1E66C9"
                  : "#FFFFFF",
                border: `2px solid ${
                  err
                    ? "#C53A3A"
                    : done
                    ? "#2E8E3A"
                    : active
                    ? "#1E66C9"
                    : "#C6CDDA"
                }`,
                boxShadow: active ? "0 0 0 3px rgba(30,102,201,0.2)" : undefined,
                position: "relative",
              }}
            >
              {active && (
                <span
                  style={{
                    position: "absolute",
                    inset: -3,
                    borderRadius: "50%",
                    border: "2px solid #1E66C9",
                    animation: "node-pulse 2s ease-out infinite",
                    pointerEvents: "none",
                  }}
                />
              )}
              {done && (
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path
                    d="M1.5 4L3.5 6L6.5 2"
                    stroke="white"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </div>
            <span
              className="mt-1 text-[10px] font-medium text-center leading-tight"
              style={{
                color: active ? "#0B1A2F" : done ? "#2E8E3A" : "#8A93A5",
                fontWeight: active ? 600 : 400,
              }}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Status pill — semantic colors, used sparingly (prefer StatusJourney)
export type CrossingStatus = "new" | "extracting" | "review" | "ready" | "sent" | "failed";

const STATUS_PILL: Record<CrossingStatus, { bg: string; color: string; dot: string; label: string }> = {
  new:        { bg: "#E3EDFB", color: "#0F4FA8", dot: "#1E66C9",  label: "New" },
  extracting: { bg: "#EEE7FB", color: "#6F4FCE", dot: "#6F4FCE",  label: "Extracting" },
  review:     { bg: "#FAEFD6", color: "#C97A14", dot: "#C97A14",  label: "Needs review" },
  ready:      { bg: "#E2F1E2", color: "#1E6D29", dot: "#2E8E3A",  label: "Ready" },
  sent:       { bg: "#EFF2F7", color: "#56627A", dot: "#8A93A5",  label: "Delivered" },
  failed:     { bg: "#FBE3E3", color: "#C53A3A", dot: "#C53A3A",  label: "Failed" },
};

const STATUS_STAGE: Record<CrossingStatus, OrderStage> = {
  new:        0,
  extracting: 1,
  review:     2,
  ready:      3,
  sent:       4,
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
        className="inline-flex items-center gap-1.5 rounded px-[6px] py-[2px] text-[11px] font-medium"
        style={{ background: pill.bg, color: pill.color }}
      >
        <span
          className="rounded-full"
          style={{ width: 5, height: 5, background: pill.dot, flexShrink: 0 }}
        />
        {pill.label}
      </span>
      <StatusJourney stage={stage} compact />
    </div>
  );
}
