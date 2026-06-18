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
        color: warm ? "#8A5A0E" : "#56627A",
        background: warm ? "#FAEFD6" : "#EFF2F7",
        border: `1px solid ${warm ? "#EAD9AE" : "#E2E6EE"}`,
      }}
    >
      {label}
    </span>
  );
}
