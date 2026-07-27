"use client";

// ConfidenceChip — a small AI-confidence percentage chip (v3 redesign). The colour
// ramps with confidence: high = green, mid = amber, low = red. Used on received-side
// field rows and inside the inline AI-fix strip. Tokens per the design handoff.

/**
 * The one place the confidence thresholds live. Exported because supplier auto-detect
 * scores the same way visually (high = green, mid = amber, low = red) but is a
 * HEURISTIC, not a model output — it reuses the ramp, never the "AI confidence" label.
 */
export function confidenceTone(pct: number): { fg: string; bg: string; bd: string } {
  return pct >= 85 ? { fg: "#1E6D29", bg: "#E9F1EA", bd: "#CDE7D1" }
    : pct >= 65 ? { fg: "#8A5A0E", bg: "#FAF1DD", bd: "#EAD9AE" }
    : { fg: "#B43838", bg: "#FBE3E3", bd: "#F0C9C9" };
}

export function ConfidenceChip({ value, sm = false }: { value: number; sm?: boolean }) {
  const pct = Math.round(value <= 1 ? value * 100 : value);
  const tone = confidenceTone(pct);
  return (
    <span
      aria-label={`AI confidence ${pct}%`}
      title={`AI confidence · ${pct}%`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
        fontSize: sm ? 9 : 9.5, lineHeight: 1,
        padding: sm ? "2px 5px" : "2px 6px", borderRadius: 999,
        color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`,
        flexShrink: 0, fontVariantNumeric: "tabular-nums",
      }}
    >
      {pct}%
    </span>
  );
}
