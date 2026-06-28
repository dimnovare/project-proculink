"use client";

// ProvenanceBadge — where an incoming field value came from in the source document
// (e.g. "Page 1 · top-right", or a cell ref like "B2"). A trust signal on the
// received side. Mono 9.5px, buyer-blue on a soft-blue tint, with a pin glyph.
// Tokens per the design handoff §6.

function PinGlyph() {
  return (
    <svg width="8" height="8" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path d="M6 1.2c-2 0-3.4 1.5-3.4 3.4 0 2.4 3.4 6.2 3.4 6.2s3.4-3.8 3.4-6.2C9.4 2.7 8 1.2 6 1.2Z" stroke="#0F4FA8" strokeWidth="1" />
      <circle cx="6" cy="4.6" r="1.1" fill="#0F4FA8" />
    </svg>
  );
}

export function ProvenanceBadge({ location }: { location: string }) {
  return (
    <span
      title={location}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, maxWidth: 140,
        fontFamily: "'JetBrains Mono',monospace", fontSize: 9.5, fontWeight: 600,
        color: "#0F4FA8", background: "#EAF0F8", border: "1px solid #D2E0F6",
        padding: "1px 6px 1px 5px", borderRadius: 4, flexShrink: 0,
      }}
    >
      <PinGlyph />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{location}</span>
    </span>
  );
}
