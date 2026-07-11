// listTableV2 — the shared "Claude Design v2" full-bleed unified-table treatment.
//
// One aligned table system, applied to every list screen (Inbox / Suppliers /
// Buyers) so rows never "swim": a fixed column grid spanning the full content
// width, tinted column headers, 44px desktop rows, tabular figures, and a
// row-level leading status dot (dot + word — the word still lives in the
// canonical UnifiedStatusBadge / .pill, this only colours the leading dot).
//
// Design law: DESIGN_SYSTEM.md §5 (Table/List) + FABLE5_BRIEF.md; reference
// impl workbench3/pages.jsx (OrderTable / Suppliers). Values are the tokens in
// globals.css — kept as literals here only where an inline <table> style needs a
// hex (React inline styles can't read a `--var` fallback as cleanly as a class).
//
// This is a plain constants module (no JSX) so it's shared by the .tsx lists and
// stays server-safe.

import { statusTone, type StatusTone } from "@/components/bridge/UnifiedStatusBadge";

// ── Tokens (mirror globals.css) ─────────────────────────────────────────────
export const TV2 = {
  surface: "#FFFFFF",
  surface2: "#F1F3F7", // --surface-2 — the tinted header band
  border: "#E5E8EE", // --border — card border + header divider
  borderFaint: "#EEF0F4", // --border-faint — row dividers
  ink: "#0B1A2F", // --ink
  inkMuted: "#5E6779", // --ink-muted — header label ink
  inkFaint: "#667085", // --ink-faint
  // Row-tint hover fill (the reference's surface-2 @ ~53% over white).
  rowHover: "#F6F7FA", // --bg — calm hover band on white rows
  shadow: "0 1px 3px rgba(11,26,47,0.05), 0 1px 2px rgba(11,26,47,0.04)",
  // Semantic dot colours (leading row dot) — mirror the .pill .dot / badge tones.
  dot: {
    success: "#2E8E3A", // --brand-green
    warning: "#B36D14", // --amber
    danger: "#B43838", // --danger
    info: "#1E66C9", // --brand-blue
    neutral: "#98A0AE", // --ink-faint
  } as Record<StatusTone, string>,
} as const;

// Desktop row height — the v2 spec's 44px operations row (was 56).
export const TV2_ROW_H = 44;

// ── Card wrapper (full-bleed table card) ────────────────────────────────────
// The white card the table floats in: 1px border, rounded-2xl, resting shadow,
// clipped corners. Spread onto the wrapping <div>'s style.
export const tv2CardStyle: React.CSSProperties = {
  background: TV2.surface,
  border: `1px solid ${TV2.border}`,
  borderRadius: 12,
  boxShadow: TV2.shadow,
  overflow: "hidden",
};

// ── Tinted column header ────────────────────────────────────────────────────
// A <th> style: the tinted band (surface-2) with uppercase muted-ink labels.
// `align` right-aligns numeric columns; `first` adds the 18px left gutter that
// lines the header label up with the row's leading status dot + content.
export function tv2HeaderCell(
  align: "left" | "right" = "left",
  first = false,
): React.CSSProperties {
  return {
    textAlign: align,
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: TV2.inkMuted,
    background: TV2.surface2,
    padding: "10px 12px",
    paddingLeft: first ? 18 : 12,
    borderBottom: `1px solid ${TV2.border}`,
    whiteSpace: "nowrap",
    userSelect: "none",
  };
}

// ── Body cell ───────────────────────────────────────────────────────────────
// A <td> style: 44px row via vertical padding, faint divider, ellipsis clip.
// `first` adds the 18px gutter; `align` right-aligns numeric columns.
export function tv2BodyCell(
  align: "left" | "right" = "left",
  first = false,
): React.CSSProperties {
  return {
    padding: "0 12px",
    paddingLeft: first ? 18 : 12,
    height: TV2_ROW_H,
    verticalAlign: "middle",
    textAlign: align,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
}

// Row divider (border-faint) — apply as the row's borderTop for all but the first.
export const tv2RowDivider = `1px solid ${TV2.borderFaint}`;

// tabular-nums helper for any figure/ID cell.
export const tv2Num: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

// Leading status-dot colour for a raw backend status (reuses the canonical
// status→tone map so the dot always agrees with the row's status word).
export function tv2DotColor(rawStatus: string): string {
  return TV2.dot[statusTone(rawStatus)];
}

// Leading status-dot colour for a known tone (entity lists that don't carry an
// order status — e.g. Suppliers=green entity, Buyers=blue entity).
export function tv2DotForTone(tone: StatusTone): string {
  return TV2.dot[tone];
}
