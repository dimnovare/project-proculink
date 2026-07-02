"use client";

// SendReadinessStrip — the slim full-width bar under the workshop header (v3 redesign).
// It REPLACES the old bulky "Fix these to send" issues card: issue-resolution now lives
// inline in the mapping rows, so this strip only summarises send-readiness.
//   • ready (no blockers)  → green "Ready to send — every required field is filled and validated."
//   • blockers remain      → amber "N fields to fill before sending" + one clickable chip per
//                            blocker; clicking a chip jumps to + flashes that field in the mapper.
// Tokens are lifted verbatim from the design handoff (§4).

import type { ReactNode } from "react";

export interface BlockerChip {
  /** Stable id (the field / line ref) — passed to onJump to focus the mapper. */
  id: string;
  /** Short human label shown on the chip. */
  name: string;
}

function CheckGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M2.5 6.2 5 8.6 9.5 3.6" stroke="#FFFFFF" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function WarnGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path d="M7 1.5 13 12H1L7 1.5Z" stroke="#B43838" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7 5.6v3" stroke="#B43838" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="7" cy="10.4" r="0.7" fill="#B43838" />
    </svg>
  );
}
function SparkleGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M6 1.2l1.1 3.2 3.2 1.1-3.2 1.1L6 9.8 4.9 6.6 1.7 5.5l3.2-1.1z" fill="#FFFFFF" />
    </svg>
  );
}

export function SendReadinessStrip({
  blockers,
  notes = 0,
  ready,
  onJump,
  onReviewIssues,
  onResolveAll,
  resolveAllCount = 0,
  resolving = false,
  pipeline,
}: {
  blockers: BlockerChip[];
  notes?: number;
  ready: boolean;
  onJump: (id: string) => void;
  /** Open the Issues tab of the preview column (the "Review issues" affordance). */
  onReviewIssues?: () => void;
  /** Bulk-accept every AI suggestion (the "Resolve all suggested" affordance). */
  onResolveAll?: () => void;
  /** How many issues the bulk "Resolve all suggested" would resolve → its badge; hidden when 0. */
  resolveAllCount?: number;
  /** True while a bulk resolve is in flight → disables the button. */
  resolving?: boolean;
  /** The InlinePipeline stepper — rendered at the banner's right end (app.jsx structure). */
  pipeline?: ReactNode;
}) {
  if (ready) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex-shrink-0"
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 22px", background: "#E9F1EA", borderBottom: "1px solid #E5E8EE" }}
      >
        <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#2E8E3A", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <CheckGlyph />
        </span>
        <span style={{ fontSize: 13, fontWeight: 650, color: "#1E6D29" }}>Ready to send</span>
        <span style={{ fontSize: 12, color: "#5E6779" }}>— every required field is filled and validated.</span>
        {pipeline && <span style={{ marginLeft: "auto", flexShrink: 0 }}>{pipeline}</span>}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex-shrink-0"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 24px", background: "#FBEAEA", borderBottom: "1px solid #F0C8C8", flexWrap: "wrap" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#FBE3E3", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <WarnGlyph />
        </span>
        {/* The blocker/warning split (app.jsx ReadyBanner): "N blocker(s) · M warning(s)"
            — blockers are red (they gate Send), warnings are amber and optional — followed
            by the plain "resolve before sending" call. Both counts are the real issue counts. */}
        <span
          title="These required fields are missing or invalid. Tap each chip below to jump to its field in the mapper."
          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "#B43838" }}
        >
          <span>
            {blockers.length} {blockers.length === 1 ? "blocker" : "blockers"}
          </span>
          {notes > 0 && (
            <>
              <span aria-hidden style={{ color: "#CBB9B9", fontWeight: 500 }}>·</span>
              <span style={{ color: "#B36D14" }}>
                {notes} {notes === 1 ? "warning" : "warnings"}
              </span>
            </>
          )}
          {/* Plain-language call. Keeps the "field(s) to fill before sending" wording so the
              copy stays concrete (and a field-level parity test still recognises the strip). */}
          <span style={{ color: "#8A6E6E", fontWeight: 500 }}>
            — {blockers.length} {blockers.length === 1 ? "field" : "fields"} to fill before sending
          </span>
        </span>
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {blockers.map((b) => (
          <button
            key={b.id}
            type="button"
            onClick={() => onJump(b.id)}
            title={`Jump to ${b.name}`}
            style={{
              display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px 2px 7px",
              borderRadius: 999, fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, fontWeight: 600,
              color: "#B43838", background: "#FFFFFF", border: "1px solid #F0C8C8", cursor: "pointer", maxWidth: 220,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#FBEAEA"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFFFF"; }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#B43838", flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
          </button>
        ))}
      </span>
      <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {notes > 0 && (
          <span style={{ fontSize: 11.5, color: "#5E6779", display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#A9B2C2" }} />
            {notes} {notes === 1 ? "note" : "notes"} · optional
          </span>
        )}
        {onReviewIssues && (
          <button
            type="button"
            onClick={onReviewIssues}
            style={{ height: 28, padding: "0 11px", borderRadius: 7, fontSize: 11.5, fontWeight: 600, border: "1px solid #DCE0E8", background: "#FFFFFF", color: "#345470", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Review issues
          </button>
        )}
        {onResolveAll && resolveAllCount > 0 && (
          <button
            type="button"
            onClick={onResolveAll}
            disabled={resolving}
            style={{ height: 28, padding: "0 11px", borderRadius: 7, fontSize: 11.5, fontWeight: 700, border: "1px solid #0B1A2F", background: "#0B1A2F", color: "#FFFFFF", cursor: resolving ? "wait" : "pointer", opacity: resolving ? 0.6 : 1, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}
          >
            <SparkleGlyph />
            {resolving ? "Resolving…" : "Resolve all suggested"}
            <span style={{ marginLeft: 2, background: "rgba(255,255,255,0.28)", borderRadius: 8, padding: "0 6px", fontSize: 10, fontWeight: 700 }}>{resolveAllCount}</span>
          </button>
        )}
        {pipeline}
      </span>
    </div>
  );
}
