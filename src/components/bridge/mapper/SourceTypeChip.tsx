"use client";

// SourceTypeChip — the document type the order arrived as (PDF / CSV / XLSX / XML /
// cXML / UBL / X12 / JSON / EMAIL). Shown in the "What we received" pane header.
// A quiet neutral tag; PDF gets a faint warm tint to read as "scanned/extracted".
// Tokens per the design handoff §6.

const WARM = new Set(["PDF", "IMAGE", "SCAN"]);

export function SourceTypeChip({ kind }: { kind: string }) {
  const label = (kind || "FILE").toUpperCase();
  const warm = WARM.has(label);
  return (
    <span
      title={`Received as ${label}`}
      style={{
        display: "inline-flex", alignItems: "center", fontFamily: "'JetBrains Mono',monospace",
        fontSize: 9, fontWeight: 700, letterSpacing: "0.03em",
        padding: "2px 7px", borderRadius: 4, flexShrink: 0,
        // --amber-text (#8A5310, 5.6206:1 on this fill), not the one-off #8A5A0E
        // this chip used to carry. RECORD CORRECTION: WP-30 reported that pair
        // as 5.42:1; it is 5.2659:1. 5.4175:1 is #56627A on #EEF1F6 — the row
        // two below it in the same table. A transcription slip, not a maths
        // error: it passed either way, so no decision changed.
        color: warm ? "#8A5310" : "#5E6779",
        background: warm ? "#FAF1DD" : "#F1F3F7",
        border: `1px solid ${warm ? "#EAD9AE" : "#E5E8EE"}`,
      }}
    >
      {label}
    </span>
  );
}
