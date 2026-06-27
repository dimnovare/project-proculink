"use client";

// SendReadinessStrip — the slim full-width bar under the workshop header (v3 redesign).
// It REPLACES the old bulky "Fix these to send" issues card: issue-resolution now lives
// inline in the mapping rows, so this strip only summarises send-readiness.
//   • ready (no blockers)  → green "Ready to send — every required field is filled and validated."
//   • blockers remain      → amber "N fields to fill before sending" + one clickable chip per
//                            blocker; clicking a chip jumps to + flashes that field in the mapper.
// Tokens are lifted verbatim from the design handoff (§4).

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
      <path d="M7 1.5 13 12H1L7 1.5Z" stroke="#C97A14" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M7 5.6v3" stroke="#C97A14" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="7" cy="10.4" r="0.7" fill="#C97A14" />
    </svg>
  );
}

export function SendReadinessStrip({
  blockers,
  notes = 0,
  ready,
  onJump,
}: {
  blockers: BlockerChip[];
  notes?: number;
  ready: boolean;
  onJump: (id: string) => void;
}) {
  if (ready) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex-shrink-0"
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 22px", background: "#E2F1E2", borderBottom: "1px solid #E2E6EE" }}
      >
        <span style={{ width: 16, height: 16, borderRadius: "50%", background: "#2E8E3A", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <CheckGlyph />
        </span>
        <span style={{ fontSize: 13, fontWeight: 650, color: "#1E6D29" }}>Ready to send</span>
        <span style={{ fontSize: 12, color: "#56627A" }}>— every required field is filled and validated.</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex-shrink-0"
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 24px", background: "#FCFAF4", borderBottom: "1px solid #EFE6CE", flexWrap: "wrap" }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        <span style={{ width: 18, height: 18, borderRadius: "50%", background: "#FBEFD0", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <WarnGlyph />
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#8A5A0E" }}>
          {blockers.length} {blockers.length === 1 ? "field" : "fields"} to fill before sending
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
              color: "#8A5A0E", background: "#FFFFFF", border: "1px solid #EAD9AE", cursor: "pointer", maxWidth: 220,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#FBF4E3"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFFFF"; }}
          >
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#C97A14", flexShrink: 0 }} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.name}</span>
          </button>
        ))}
      </span>
      {notes > 0 && (
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#56627A", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#A9B2C2" }} />
          {notes} {notes === 1 ? "note" : "notes"} · optional
        </span>
      )}
    </div>
  );
}
