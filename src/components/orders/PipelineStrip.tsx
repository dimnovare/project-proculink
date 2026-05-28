"use client";

// ─── Design tokens (mirrors OrderDetailPage palette) ─────────────────────────
const T = {
  surface:     "#FFFFFF",
  border:      "#E2E6EE",
  borderFaint: "#EEF0F4",
  borderStrong:"#C6CDDA",
  ink:         "#0B1A2F",
  inkMuted:    "#56627A",
  inkFaint:    "#8A93A5",
  success:     "#2E8E3A",
  brandBlue:   "#1E66C9",
  amber:       "#C97A14",
  ai:          "#6F4FCE",
  mono:        '"JetBrains Mono", ui-monospace, monospace',
  ui:          '"Inter", system-ui, sans-serif',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type StageActivityState = "ok" | "ai" | "warn";

export interface StageActivity {
  state: StageActivityState;
  primary: string;
  when: string;
}

export interface PipelineStripProps {
  currentStage: 0 | 1 | 2 | 3 | 4;
  activityByStage: Partial<Record<0 | 1 | 2 | 3 | 4, StageActivity>>;
}

// ─── Stage definitions ────────────────────────────────────────────────────────

const STAGES = [
  { number: "01", label: "Parse" },
  { number: "02", label: "Map" },
  { number: "03", label: "Validate" },
  { number: "04", label: "Transform" },
  { number: "05", label: "Deliver" },
] as const;

// ─── Node state helpers ───────────────────────────────────────────────────────

type NodeState = "done" | "active-ok" | "active-ai" | "active-warn" | "pending";

function getNodeState(
  idx: number,
  currentStage: number,
  activityState: StageActivityState | undefined,
): NodeState {
  if (idx < currentStage) return "done";
  if (idx === currentStage) {
    const s = activityState ?? "ok";
    if (s === "ai")   return "active-ai";
    if (s === "warn") return "active-warn";
    return "active-ok";
  }
  return "pending";
}

function nodeRingColor(state: NodeState): string {
  switch (state) {
    case "active-ok":   return T.brandBlue;
    case "active-ai":   return T.ai;
    case "active-warn": return T.amber;
    case "pending":     return T.borderStrong;
    default:            return "transparent";
  }
}

function nodeDotColor(state: NodeState): string {
  switch (state) {
    case "active-ok":   return T.brandBlue;
    case "active-ai":   return T.ai;
    case "active-warn": return T.amber;
    default:            return "transparent";
  }
}

function activityTextColor(state: StageActivityState): string {
  switch (state) {
    case "ai":   return T.ai;
    case "warn": return T.amber;
    default:     return T.inkMuted;
  }
}

// ─── Check SVG (done node) ────────────────────────────────────────────────────

function CheckIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 5.5L4 7.5L8 3"
        stroke="#FFFFFF"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PipelineStrip({ currentStage, activityByStage }: PipelineStripProps) {
  return (
    <ol
      role="list"
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(5, 1fr)",
        margin: "0 0 12px",
        padding: "14px 4px 12px",
        listStyle: "none",
        borderTop:    `1px solid ${T.borderFaint}`,
        borderBottom: `1px solid ${T.borderFaint}`,
        fontFamily: T.ui,
      }}
    >
      {STAGES.map((stage, idx) => {
        const activity    = activityByStage[idx as 0 | 1 | 2 | 3 | 4];
        const nodeState   = getNodeState(idx, currentStage, activity?.state);
        const isDone      = nodeState === "done";
        const isActive    = nodeState.startsWith("active");
        const isPending   = nodeState === "pending";

        const ringColor   = nodeRingColor(nodeState);
        const dotColor    = nodeDotColor(nodeState);

        // Connector colors
        const leftConnectorColor  = idx > 0 && (idx - 1) < currentStage ? T.success : T.border;
        const rightConnectorColor = idx < currentStage ? T.success : T.border;

        // Label weight + color
        const labelWeight = idx === currentStage ? 600 : 500;
        const labelColor  = isDone ? T.inkMuted : isPending ? T.inkFaint : T.ink;

        // Activity text for aria label
        const ariaActivity = activity
          ? `${activity.state === "warn" ? "warning" : activity.state === "ai" ? "AI assisted" : "ok"}: ${activity.primary}, ${activity.when}`
          : "pending";

        return (
          <li
            key={idx}
            aria-label={`${stage.number} ${stage.label} — ${ariaActivity}`}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              position: "relative",
              padding: "0 6px",
            }}
          >
            {/* ── Connector lines ───────────────────────────────────────── */}
            {/* Left half-span (all columns except first) */}
            {idx > 0 && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 9,
                  left: 0,
                  width: "50%",
                  height: 1,
                  background: leftConnectorColor,
                }}
              />
            )}
            {/* Right half-span (all columns except last) */}
            {idx < STAGES.length - 1 && (
              <div
                aria-hidden="true"
                style={{
                  position: "absolute",
                  top: 9,
                  right: 0,
                  width: "50%",
                  height: 1,
                  background: rightConnectorColor,
                }}
              />
            )}

            {/* ── Node ──────────────────────────────────────────────────── */}
            <div
              aria-hidden="true"
              style={{
                position: "relative",
                zIndex: 1,
                width: 18,
                height: 18,
                borderRadius: "50%",
                flexShrink: 0,
                background:  isDone  ? T.success : T.surface,
                border:      isDone  ? "none" : `1.5px solid ${ringColor}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {isDone && <CheckIcon />}
              {isActive && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: dotColor,
                    display: "block",
                  }}
                />
              )}
            </div>

            {/* ── Stage label ───────────────────────────────────────────── */}
            <div
              style={{
                marginTop: 7,
                display: "flex",
                alignItems: "baseline",
                gap: 5,
                whiteSpace: "nowrap",
              }}
            >
              <span
                style={{
                  fontFamily: T.mono,
                  fontSize: 10,
                  fontWeight: 500,
                  color: T.inkFaint,
                  letterSpacing: "0.04em",
                }}
              >
                {stage.number}
              </span>
              <span
                style={{
                  fontFamily: T.ui,
                  fontSize: 11.5,
                  fontWeight: labelWeight,
                  color: labelColor,
                }}
              >
                {stage.label}
              </span>
            </div>

            {/* ── Activity row ──────────────────────────────────────────── */}
            <div
              style={{
                marginTop: 3,
                fontSize: 10.5,
                fontWeight: activity && idx === currentStage ? 500 : 400,
                lineHeight: 1.35,
                textAlign: "center",
                maxWidth: "100%",
                overflow: "hidden",
                whiteSpace: "nowrap",
                textOverflow: "ellipsis",
              }}
            >
              {activity ? (
                <>
                  <span
                    style={{
                      color: activityTextColor(activity.state),
                    }}
                  >
                    {activity.primary}
                  </span>
                  <span style={{ color: T.inkFaint }}>
                    {" · "}
                    {activity.when}
                  </span>
                </>
              ) : (
                <span style={{ color: T.inkFaint }}>—</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
