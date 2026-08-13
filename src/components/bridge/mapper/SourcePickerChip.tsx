"use client";

// SourcePickerChip — the inline, searchable SOURCE picker shown on each output row in the mapper's
// "picker" mapping mode (the founder-chosen alternative to drag-wiring). The chip reads as
// `BuyerName  ← [ pick a field ▾ ]`; clicking it opens a typeahead listing the incoming fields
// (grouped, AI suggestion first + pre-filled with its confidence), plus "Fixed value…" and "Clear".
//
// Picking a source calls back to the host, which routes it through the EXISTING wire-connect
// dispatch (onWireConnect → onTargetConnect / onSetFixedValue) — the save contract (buildOverrideDraft)
// is untouched. No dragging. Fully keyboard-accessible: the trigger is a button, the panel is a
// listbox-style menu, Escape closes, ArrowUp/Down move, Enter selects.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SourceField } from "./types";
import type { OutgoingFieldStatus } from "./outgoingStatusModel";
import { buildSourceOptions, currentSourceLabel, isUnsourced, suggestedSourceFor } from "./sourcePickerModel";
import {
  suggestionConfidenceDisplay,
  SAVED_MAPPING_LABEL,
  SAVED_MAPPING_TITLE,
} from "./suggestionBasisModel";

const PANEL_W = 280;
const GROUP_LABEL: Record<SourceField["group"], string> = {
  header: "Header", parties: "Parties", line: "Line items", raw: "Other fields",
};

export interface SourcePickerChipProps {
  outputPath: string;
  status: OutgoingFieldStatus;
  incomingFields: ReadonlyArray<SourceField>;
  /** Pick an incoming field as the source (host routes to onWireConnect). */
  onPickSource: (sourceId: string) => void;
  /** Start editing a fixed value for this row. */
  onPickFixed: () => void;
  /** Clear the row's source (disconnect / clear fixed → back to default). */
  onClear: () => void;
  readOnly?: boolean;
}

export function SourcePickerChip({
  outputPath, status, incomingFields, onPickSource, onPickFixed, onClear, readOnly,
}: SourcePickerChipProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const suggested = useMemo(() => suggestedSourceFor(outputPath, incomingFields), [outputPath, incomingFields]);
  const options = useMemo(
    () => buildSourceOptions(incomingFields, query, suggested?.id ?? null),
    [incomingFields, query, suggested],
  );
  const currentLabel = currentSourceLabel(status);
  const unsourced = isUnsourced(status);
  const canClear = status.kind === "wired" || status.kind === "fixed";

  // Position the portaled panel under the trigger, flipped above when it would overflow.
  useEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const margin = 8;
      const estH = panelRef.current?.offsetHeight ?? 300;
      let left = Math.min(r.left, window.innerWidth - PANEL_W - margin);
      left = Math.max(margin, left);
      const below = r.bottom + 6;
      const flip = below + estH > window.innerHeight - margin;
      const top = flip ? Math.max(margin, r.top - estH - 6) : below;
      setPos({ top, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, options.length]);

  // Focus the search box on open; reset the active index when the option list changes.
  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { setActive(0); }, [query, open]);

  // Outside-click / Escape close.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (panelRef.current?.contains(e.target as Node)) return;
      if (triggerRef.current?.contains(e.target as Node)) return;
      close();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  function close() { setOpen(false); setQuery(""); }
  function pick(id: string) { onPickSource(id); close(); }

  // The flat option list drives keyboard nav (suggestion at index 0 already).
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = options[active];
      if (opt) pick(opt.id);
    }
  }

  if (readOnly) {
    return (
      <span style={{ fontSize: 12, fontWeight: 700, color: unsourced ? "#AEB6C4" : "#1E6D29", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {currentLabel}
      </span>
    );
  }

  // Group the (already sorted) options for the dropdown render.
  const grouped = groupOptions(options);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      <span aria-hidden style={{ fontSize: 11, fontWeight: 800, color: "#9AA3B2" }}>←</span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={unsourced ? "Pick the incoming field that fills this output" : `Source: ${currentLabel} — click to change`}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, maxWidth: 200,
          height: 26, padding: "0 11px", borderRadius: 999,
          border: `1px ${unsourced ? "dashed" : "solid"} ${unsourced ? "#C9D0DC" : "#CDE7D1"}`,
          background: unsourced ? "#FFFFFF" : "#F1F8F2",
          color: unsourced ? "#5E6779" : "#1E6D29",
          fontSize: 12, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {unsourced ? "pick a field" : currentLabel}
        </span>
        <span aria-hidden style={{ fontSize: 10, opacity: 0.7 }}>▾</span>
      </button>

      {canClear && (
        <button
          type="button"
          aria-label={`Clear the source for ${outputPath}`}
          onClick={(e) => { e.stopPropagation(); onClear(); }}
          title="Clear this source"
          style={{ border: "none", background: "none", cursor: "pointer", color: "var(--ink-faint)", fontSize: 11, lineHeight: 1, padding: "0 1px" }}
        >
          ✕
        </button>
      )}

      {open && typeof document !== "undefined" && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-label={`Source for ${outputPath}`}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, zIndex: 1000, width: PANEL_W,
            background: "#FFFFFF", border: "1px solid #E5E8EE", borderRadius: 10,
            boxShadow: "0 12px 30px rgba(11,26,47,0.16)", overflow: "hidden",
            visibility: pos ? "visible" : "hidden",
            display: "flex", flexDirection: "column",
          }}
        >
          <div style={{ padding: 8, borderBottom: "1px solid #EEF0F4" }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search incoming fields…"
              aria-label="Search incoming fields"
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 7, border: "1px solid #DCE0E8", fontSize: 11.5, color: "#0B1A2F" }}
            />
          </div>

          <div style={{ maxHeight: 240, overflowY: "auto", padding: 6 }}>
            {options.length === 0 ? (
              <div style={{ padding: "8px 6px", fontSize: 10.5, color: "var(--ink-faint)" }}>
                No incoming field matches “{query}”.
              </div>
            ) : (
              grouped.map((g) => (
                <div key={g.group} style={{ marginBottom: 4 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)", padding: "4px 6px 3px" }}>
                    {GROUP_LABEL[g.group]}
                  </div>
                  {g.items.map((o) => {
                    const idx = options.indexOf(o);
                    const isActive = idx === active;
                    return (
                      <button
                        key={o.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActive(idx)}
                        onClick={() => pick(o.id)}
                        style={{
                          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                          width: "100%", textAlign: "left", border: "none", cursor: "pointer",
                          padding: "5px 6px", borderRadius: 6,
                          background: isActive ? "#F1F8F2" : "none",
                        }}
                      >
                        <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 600, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {o.label}
                            </span>
                            {/* Suggested-source badge. A saved-mapping option says so plainly
                                and in a neutral tone: no percentage (nothing scored it) and no
                                violet ✦ AI (no model produced it, and violet is reserved for
                                AI-generated content). The endpoint used to send a hard-coded
                                0.95 for these, which printed here as "✦ AI 95%". */}
                            {o.suggested && (suggestionConfidenceDisplay(o.basis, o.confidence) === "saved_mapping" ? (
                              <span title={SAVED_MAPPING_TITLE} style={{ fontSize: 8, fontWeight: 800, color: "var(--ink-faint)", flexShrink: 0, letterSpacing: "0.03em", whiteSpace: "nowrap" }}>
                                {SAVED_MAPPING_LABEL}
                              </span>
                            ) : (
                              <span aria-label="AI suggested" title={o.confidence != null ? `AI suggests · ${Math.round(o.confidence * 100)}%` : "AI suggested"} style={{ fontSize: 8, fontWeight: 800, color: "#6F4FCE", flexShrink: 0, letterSpacing: "0.03em" }}>
                                ✦ AI{o.confidence != null ? ` ${Math.round(o.confidence * 100)}%` : ""}
                              </span>
                            ))}
                          </span>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: "tabular-nums", fontSize: 9.5, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {o.value || "(empty)"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>

          {/* Footer actions: a fixed value + (when sourced) clear. */}
          <div style={{ borderTop: "1px solid #EEF0F4", padding: 6, display: "flex", gap: 6, background: "#FBFBFD" }}>
            <button
              type="button"
              onClick={() => { onPickFixed(); close(); }}
              style={{ flex: 1, border: "1px solid #C4ABE8", background: "#FFFFFF", color: "#5E3DB0", borderRadius: 6, padding: "5px 8px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
            >
              = Fixed value…
            </button>
            {canClear && (
              <button
                type="button"
                onClick={() => { onClear(); close(); }}
                style={{ border: "1px solid #DCE0E8", background: "#FFFFFF", color: "var(--ink-faint)", borderRadius: 6, padding: "5px 10px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
              >
                Clear
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}

/** Re-group the already-sorted flat option list back into its group buckets (display order kept). */
function groupOptions(options: ReturnType<typeof buildSourceOptions>) {
  const order: SourceField["group"][] = ["header", "parties", "line", "raw"];
  return order
    .map((group) => ({ group, items: options.filter((o) => o.group === group) }))
    .filter((g) => g.items.length > 0);
}
