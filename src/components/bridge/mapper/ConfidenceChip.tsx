"use client";

// ConfidenceChip — a small AI-confidence percentage chip (v3 redesign). The colour
// ramps with confidence: high = green, mid = amber, low = red. Used on received-side
// field rows and inside the inline AI-fix strip. Tokens per the design handoff.

export function ConfidenceChip({ value, sm = false }: { value: number; sm?: boolean }) {
  const pct = Math.round(value <= 1 ? value * 100 : value);
  const tone =
    pct >= 85 ? { fg: "#1E6D29", bg: "#E2F1E2", bd: "#CDE7D1" }
    : pct >= 65 ? { fg: "#8A5A0E", bg: "#FAEFD6", bd: "#EAD9AE" }
    : { fg: "#C53A3A", bg: "#FBE3E3", bd: "#F0C9C9" };
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
