"use client";

// SourceTokenPanel — the draggable "source field" set on the order-review screen.
// Renders the order's source tokens (the addressable values the tokenizer found in the
// uploaded file) as DISCRETE DRAGGABLE chips, grouped header/line, scrollable. Each chip
// is a drag handle (and keyboard connector) via the props returned by useSourceWireDrag;
// dragging a chip onto a canonical node re-points which raw field feeds that canonical
// value. The document preview stays above this — this is a compact addressable strip.

import type { SourceToken } from "@/lib/api/types";
import type { SourceWireDragChipProps } from "./SourceWireDragLayer";

interface SourceTokenPanelProps {
  tokens: SourceToken[];
  /** Per-token drag/keyboard props from useSourceWireDrag.chipProps(token.id). */
  chipProps: (tokenId: string) => SourceWireDragChipProps;
  /** Whether tokens are still loading (best-effort — absence just hides the panel). */
  loading?: boolean;
}

function TokenChip({ token, props }: { token: SourceToken; props: SourceWireDragChipProps }) {
  const wired = props["data-wired"];
  const connecting = props["data-connecting"];
  return (
    <div
      {...props}
      title={`${token.label}: ${token.value}\nDrag onto a canonical field to wire it.`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        padding: "5px 8px",
        borderRadius: 7,
        border: `1px solid ${connecting ? "#6F4FCE" : wired ? "#C4ABE8" : "#DCE0E8"}`,
        background: connecting ? "#EEE7FB" : wired ? "#F4EFFC" : "#FFFFFF",
        cursor: "grab",
        touchAction: "none", // let the pointer-drag own the gesture (no scroll hijack)
        userSelect: "none",
        outline: "none",
        boxShadow: connecting ? "0 0 0 2px rgba(111,79,206,0.18)" : undefined,
        transition: "border-color 120ms, background 120ms, box-shadow 120ms",
        minWidth: 0,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        <span aria-hidden style={{ color: wired ? "#6F4FCE" : "#A8B0BF", fontSize: 10, flexShrink: 0 }}>⠿</span>
        <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: wired ? "#5E3DB0" : "#8A93A5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {token.label}
        </span>
        {wired && <span aria-hidden style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: "#5E3DB0", flexShrink: 0 }}>wired →</span>}
      </span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {token.value || <span style={{ color: "#C6CDDA" }}>(empty)</span>}
      </span>
    </div>
  );
}

export function SourceTokenPanel({ tokens, chipProps, loading }: SourceTokenPanelProps) {
  if (loading) {
    return (
      <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid #E2E6EE", background: "#FBFBFD", fontSize: 10.5, color: "#8A93A5" }}>
        Loading source fields…
      </div>
    );
  }
  if (tokens.length === 0) return null;

  const header = tokens.filter((t) => t.group === "header" || t.group == null);
  const line   = tokens.filter((t) => t.group === "line");

  return (
    <div style={{ marginTop: 10, borderRadius: 8, border: "1px solid #E2E6EE", background: "#FBFBFD", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5E3DB0" }}>Source fields</span>
        <span style={{ fontSize: 9.5, color: "#8A93A5" }}>drag onto a canonical field →</span>
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        {header.length > 0 && (
          <div>
            <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#A8B0BF", marginBottom: 5 }}>Header</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {header.map((t) => <TokenChip key={t.id} token={t} props={chipProps(t.id)} />)}
            </div>
          </div>
        )}
        {line.length > 0 && (
          <div>
            <div style={{ fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#A8B0BF", marginBottom: 5 }}>Line</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {line.map((t) => <TokenChip key={t.id} token={t} props={chipProps(t.id)} />)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
