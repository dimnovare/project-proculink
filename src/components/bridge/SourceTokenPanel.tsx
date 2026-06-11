"use client";

// SourceTokenPanel — the draggable "source field" set on the order-review screen.
// Renders the order's source tokens (the addressable values the tokenizer found in the
// uploaded file) as DISCRETE DRAGGABLE chips. Each chip is a drag handle (and keyboard
// connector) via the props returned by useSourceWireDrag; dragging a chip onto a canonical
// node re-points which raw field feeds that canonical value.
//
// DECLUTTER (2026-06-08): a 50-line CSV tokenizes to ~255 cell-chips, which buried the
// handful of header fields you actually wire and made the source column taller than the
// viewport. We now show the HEADER fields by default (the ones that map to the 7 canonical
// nodes), keep the per-line cell chips behind a "Show N line fields" expander, and add a
// search box. No semantic change — each chip still drives its own token id.

import { useMemo, useState } from "react";
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
  // Keyboard-focus halo (focus-visible restore) — mirrors the connecting halo so
  // Tab focus is visibly indicated on the drag handles. Render-only.
  const [focused, setFocused] = useState(false);
  return (
    <div
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
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
        // pan-y: vertical touch still scrolls the panel; the (mostly horizontal)
        // pointer-drag to the canonical column still owns the wire gesture.
        touchAction: "pan-y",
        userSelect: "none",
        boxShadow: connecting
          ? "0 0 0 2px rgba(111,79,206,0.18)"
          : focused
          ? "0 0 0 2px rgba(111,79,206,0.30)"
          : undefined,
        transition: "border-color 120ms, background 120ms, box-shadow 120ms",
        minWidth: 0,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
        <span aria-hidden style={{ color: wired ? "#6F4FCE" : "#A8B0BF", fontSize: 10, flexShrink: 0 }}>⠿</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: wired ? "#5E3DB0" : "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
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

function ChipGrid({ tokens, chipProps }: { tokens: SourceToken[]; chipProps: (id: string) => SourceWireDragChipProps }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
      {tokens.map((t) => <TokenChip key={t.id} token={t} props={chipProps(t.id)} />)}
    </div>
  );
}

export function SourceTokenPanel({ tokens, chipProps, loading }: SourceTokenPanelProps) {
  const [query, setQuery] = useState("");
  const [showLines, setShowLines] = useState(false);

  const q = query.trim().toLowerCase();

  const header = useMemo(() => tokens.filter((t) => t.group === "header" || t.group == null), [tokens]);
  const line = useMemo(() => tokens.filter((t) => t.group === "line"), [tokens]);

  const headerShown = useMemo(
    () => (!q ? header : header.filter((t) => (t.label || "").toLowerCase().includes(q) || (t.value || "").toLowerCase().includes(q))),
    [header, q],
  );
  const lineShown = useMemo(
    () => (!q ? line : line.filter((t) => (t.label || "").toLowerCase().includes(q) || (t.value || "").toLowerCase().includes(q))),
    [line, q],
  );

  if (loading) {
    return (
      <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid #E2E6EE", background: "#FBFBFD", fontSize: 10.5, color: "var(--ink-faint)" }}>
        Loading source fields…
      </div>
    );
  }
  if (tokens.length === 0) return null;

  // While searching, line matches auto-reveal so a query finds any cell.
  const linesVisible = showLines || q.length > 0;

  return (
    <div style={{ marginTop: 10, borderRadius: 8, border: "1px solid #E2E6EE", background: "#FBFBFD", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5E3DB0" }}>Source fields</span>
        <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>drag onto a canonical field →</span>
      </div>

      {/* Search — find any field/value without scrolling a long cell list. */}
      <div style={{ padding: "7px 10px 0" }}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search source fields…"
          aria-label="Search source fields"
          style={{
            width: "100%", boxSizing: "border-box", padding: "5px 8px", borderRadius: 6,
            border: "1px solid #DCE0E8", fontSize: 11, color: "#0B1A2F",
            background: "#FFFFFF",
          }}
        />
      </div>

      <div style={{ maxHeight: 280, overflowY: "auto", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        {headerShown.length > 0 && (
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)", marginBottom: 5 }}>Header</div>
            <ChipGrid tokens={headerShown} chipProps={chipProps} />
          </div>
        )}

        {line.length > 0 && (
          <div>
            {/* Collapsed by default — the per-line cells are rarely the wiring target
                and would otherwise bury the header fields + balloon the column height. */}
            {linesVisible ? (
              <>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)" }}>
                    Line fields{q ? ` · ${lineShown.length} match${lineShown.length === 1 ? "" : "es"}` : ` · ${line.length}`}
                  </span>
                  {!q && (
                    <button type="button" onClick={() => setShowLines(false)}
                      style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                      Hide
                    </button>
                  )}
                </div>
                {lineShown.length > 0
                  ? <ChipGrid tokens={lineShown} chipProps={chipProps} />
                  : <div style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>No line fields match “{query}”.</div>}
              </>
            ) : (
              <button type="button" onClick={() => setShowLines(true)}
                style={{
                  width: "100%", padding: "7px 8px", borderRadius: 7, border: "1px dashed #C9CFDB",
                  background: "#FFFFFF", cursor: "pointer", fontSize: 10.5, fontWeight: 600, color: "#5E3DB0",
                }}>
                Show {line.length} line field{line.length === 1 ? "" : "s"} ↓
              </button>
            )}
          </div>
        )}

        {headerShown.length === 0 && lineShown.length === 0 && q && (
          <div style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>No source field matches “{query}”.</div>
        )}
      </div>
    </div>
  );
}
