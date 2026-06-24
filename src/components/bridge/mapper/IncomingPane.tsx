"use client";

// IncomingPane — the LEFT column of the redesigned 2-column mapper. It replaces SourceUniverse
// as the left lane, and shows the order's ACTUAL INCOMING DATA WITH REAL VALUES, grouped:
//   Header / Parties / Line items / Raw extras (the Phase-1 SourceCapture bag, collapsed).
//
// Why this fixes the "dead pane": the old SourceUniverse was empty for API-ingress orders
// ("no source document to wire from"). But every parsed order HAS canonical values, and the
// backend's SourceToken set already exposes them (header/parties/line/raw, each with a value).
// So this pane is fed by the SAME `model.sourceFields` and is NEVER empty when the order has
// data — even for clean structured/API orders.
//
// Each row = grip-handle · label (sans) · value (mono, truncated, REAL data). Rows keep their
// stable `id` (SourceToken id) and register an anchor ref so the interaction agent can attach
// the drag-to-wire gesture + draw wires from here. This structural pass renders the rows,
// groups, search, filter chips, and the subtle per-row "Change source" advanced affordance;
// it does NOT own the drag handlers (that is the interaction agent's seam — see anchorRef +
// the chipProps passthrough).
//
// Presentational + prop-driven. No data fetch here.

import { useEffect, useMemo, useRef, useState } from "react";
import type { MapperSourcePortProps } from "./MapperWireLayer";
import type { SourceField, FieldFilter } from "./types";
import { ConfidenceChip } from "./ConfidenceChip";
import { SourceTypeChip } from "./SourceTypeChip";
import {
  buildIncomingGroups,
  incomingFilterCounts,
  hasIncomingData,
  INCOMING_GROUP_META,
  type SourceGroup,
} from "./incomingPaneModel";

const SEARCH_DEBOUNCE_MS = 150;

export interface IncomingPaneProps {
  fields: SourceField[];
  query: string;
  onQuery: (q: string) => void;
  filter: FieldFilter;
  onFilter: (f: FieldFilter) => void;
  /** Per-row RIGHT-edge PORT props from the wire layer (drag handle + keyboard connect). */
  portProps: (id: string) => MapperSourcePortProps;
  loading?: boolean;
  /** Honest empty-state framing — API orders with no parsed data are rare but possible. */
  sourceFileKey?: string | null;
  /** True when extraction fell back to the deterministic parser — softens the empty copy. */
  extractionFailed?: boolean;
  /** Command-palette "Jump to field" → focus + select the search box (counter, not boolean). */
  focusSearchSignal?: number;
  /**
   * Register a row's anchor element (for command-palette scroll-to). The wire engine measures
   * the PORT element via portProps(id).ref, not this — this is just a row handle. Optional.
   */
  anchorRef?: (id: string, el: HTMLElement | null) => void;
  /** Selection/hover plumbing for wire emphasis. */
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  /** True while a wire drag is in flight — softens the "drag to map" hint into "drop on a field". */
  dragging?: boolean;
  readOnly?: boolean;
  /**
   * The source document type the order arrived as (PDF / CSV / XLSX / XML / cXML / UBL / X12 /
   * JSON / EMAIL). Renders a SourceTypeChip in the pane header — only when provided. Optional so
   * existing call sites keep compiling; default-undefined → no chip. Thread it from
   * MapperWorkbench (e.g. the order's detected source format) when available.
   */
  sourceType?: string;
}

const FILTERS: { id: FieldFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unmapped", label: "Unmapped" },
  { id: "mapped", label: "Mapped" },
  { id: "ai", label: "AI" },
  { id: "hasValue", label: "Has value" },
];

export function IncomingPane({
  fields,
  query,
  onQuery,
  filter,
  onFilter,
  portProps,
  loading,
  sourceFileKey,
  extractionFailed,
  focusSearchSignal,
  anchorRef,
  hoveredId,
  onHover,
  onSelect,
  dragging,
  readOnly,
  sourceType,
}: IncomingPaneProps) {
  // 150ms debounce so the controlled query upstream doesn't thrash on every keystroke.
  const [local, setLocal] = useState(query);
  useEffect(() => setLocal(query), [query]);
  useEffect(() => {
    if (local === query) return;
    const t = setTimeout(() => onQuery(local), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [local, query, onQuery]);

  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!focusSearchSignal) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusSearchSignal]);

  // Per-group collapse, seeded from INCOMING_GROUP_META (Raw extras collapsed).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isOpen = (g: SourceGroup) => {
    const explicit = collapsed[g];
    return explicit === undefined ? !INCOMING_GROUP_META[g].defaultCollapsed : !explicit;
  };
  const toggle = (g: SourceGroup) =>
    setCollapsed((c) => ({ ...c, [g]: !(c[g] === undefined ? INCOMING_GROUP_META[g].defaultCollapsed : c[g]) }));

  const q = query.trim();
  const counts = useMemo(() => incomingFilterCounts(fields), [fields]);
  const groups = useMemo(() => buildIncomingGroups(fields, query, filter), [fields, query, filter]);

  if (loading) {
    return (
      <PaneFrame title="What we received" sourceType={sourceType}>
        <div style={{ padding: "10px 12px", fontSize: 11, color: "var(--ink-faint)" }}>Loading incoming data…</div>
      </PaneFrame>
    );
  }

  if (!hasIncomingData(fields)) {
    const message = extractionFailed
      ? "We couldn't auto-extract fields from this document, so it fell back to the deterministic parser. The parsed values still flow through to the output — map any output fields manually."
      : !sourceFileKey
      ? "This order arrived already-structured — there are no extra raw fields to remap. The canonical values flow straight to the output."
      : "No extra incoming fields for this document type — the parsed values are the source of truth.";
    return (
      <PaneFrame title="What we received" sourceType={sourceType}>
        <div style={{ padding: "12px", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>{message}</div>
      </PaneFrame>
    );
  }

  return (
    <PaneFrame title="What we received" subtitle={`${counts.all} field${counts.all === 1 ? "" : "s"}`} sourceType={sourceType}>
      {/* Search — finds any field/value across groups (collapsed groups auto-reveal). */}
      <div style={{ padding: "8px 10px 0" }}>
        <input
          ref={searchRef}
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder="Search incoming fields…"
          aria-label="Search incoming fields"
          style={{
            width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 7,
            border: "1px solid var(--line, #DCE0E8)", fontSize: 11.5, color: "var(--ink, #0B1A2F)", background: "#FFFFFF",
          }}
        />
      </div>

      {/* Filter chips. */}
      <div role="group" aria-label="Filter incoming fields" style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "8px 10px 0" }}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilter(f.id)}
              aria-pressed={active}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 9px", borderRadius: 999, cursor: "pointer",
                fontSize: 10, fontWeight: 700, letterSpacing: "0.02em",
                border: `1px solid ${active ? "#6F4FCE" : "var(--line, #DCE0E8)"}`,
                background: active ? "#EEE7FB" : "#FFFFFF",
                color: active ? "#5E3DB0" : "var(--ink-faint)",
                transition: "border-color 120ms, background 120ms, color 120ms",
              }}
            >
              {f.label}
              <span style={{ fontSize: 9, fontWeight: 800, opacity: 0.7 }}>{counts[f.id]}</span>
            </button>
          );
        })}
      </div>

      {/* NOTE: no inner-scroll container. The whole mapper CANVAS scrolls as one unit so the
          wire overlay stays glued with zero JS — an independently-scrolling column would
          decouple the rows from the canvas-relative SVG. Rows grow the column; the page scrolls. */}
      <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: 12 }}>
        {groups.length === 0 ? (
          <div style={{ fontSize: 11, color: "var(--ink-faint)" }}>
            {q ? `No incoming field matches “${query}”.` : "No incoming fields match this filter."}
          </div>
        ) : (
          groups.map((g) => (
            <IncomingGroup
              key={g.group}
              group={g.group}
              fields={g.fields}
              open={isOpen(g.group)}
              onToggle={() => toggle(g.group)}
              forceOpen={q.length > 0}
              portProps={portProps}
              anchorRef={anchorRef}
              hoveredId={hoveredId}
              onHover={onHover}
              onSelect={onSelect}
              dragging={dragging}
              readOnly={readOnly}
            />
          ))
        )}
      </div>
    </PaneFrame>
  );
}

// ── Pane frame (shared chrome) ────────────────────────────────────────────────
// `sourceType` (optional) renders a SourceTypeChip on the right of the header showing the
// order's source document type (PDF/CSV/XLSX/…). Default-undefined → no chip rendered.
function PaneFrame({
  title, subtitle, sourceType, children,
}: {
  title: string;
  subtitle?: string;
  sourceType?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--line, #E2E6EE)", background: "#FBFBFD", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#5E3DB0" }}>{title}</span>
        {subtitle && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{subtitle}</span>}
        {sourceType && (
          <span style={{ marginLeft: "auto" }}>
            <SourceTypeChip kind={sourceType} />
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

// ── A collapsible group of incoming rows ──────────────────────────────────────
function IncomingGroup({
  group, fields, open, onToggle, forceOpen, portProps, anchorRef, hoveredId, onHover, onSelect, dragging, readOnly,
}: {
  group: SourceGroup;
  fields: SourceField[];
  open: boolean;
  onToggle: () => void;
  forceOpen: boolean;
  portProps: (id: string) => MapperSourcePortProps;
  anchorRef?: (id: string, el: HTMLElement | null) => void;
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  dragging?: boolean;
  readOnly?: boolean;
}) {
  const expanded = open || forceOpen;
  const meta = INCOMING_GROUP_META[group];

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        disabled={forceOpen}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%",
          background: "none", border: "none", cursor: forceOpen ? "default" : "pointer", padding: "0 0 6px", margin: 0,
        }}
      >
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)" }}>
          {meta.label} · {fields.length}
        </span>
        {!forceOpen && (
          <span aria-hidden style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", transition: "transform 120ms", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}>
            ▾
          </span>
        )}
      </button>

      {expanded && (
        // No inner scroll — the canvas scrolls as one unit (keeps wires glued).
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {fields.map((f) => (
            <IncomingRow
              key={f.id}
              field={f}
              port={portProps(f.id)}
              anchorRef={anchorRef}
              hovered={hoveredId === f.id}
              onHover={onHover}
              onSelect={onSelect}
              dragging={dragging}
              readOnly={readOnly}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── A single incoming-data row: label · value (mono) · RIGHT-edge drag PORT ────
// Module-level (not nested) so React keeps its identity across re-renders (focus/drag
// stability). The wire engine measures the PORT element (right edge), so wires emerge from
// the right side and flow into the gutter — never over the row's text.
function IncomingRow({
  field, port, anchorRef, hovered, onHover, onSelect, dragging, readOnly,
}: {
  field: SourceField;
  port: MapperSourcePortProps;
  anchorRef?: (id: string, el: HTMLElement | null) => void;
  hovered?: boolean;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  dragging?: boolean;
  readOnly?: boolean;
}) {
  const wired = port["data-wired"] || field.mapped;
  const connecting = port["data-connecting"];
  const suggested = field.suggestedFor != null;
  const valueMissing = !field.value || field.value.trim().length === 0;
  // §6 field-row left accent (3px): violet if AI-wired/AI-suggested, amber if the value is
  // missing/not-found, else light grey. AI accent wins over the missing-value accent.
  const accentColor =
    wired || suggested ? "#6F4FCE" : valueMissing ? "#C97A14" : "#E2E6EE";
  // Per-field AI confidence — render a small chip only when the datum actually exists.
  const confidence =
    field.suggestionConfidence != null && Number.isFinite(field.suggestionConfidence)
      ? field.suggestionConfidence
      : null;
  const { ref: portRef, ...portHandlers } = port;

  return (
    <div
      className="mapper-row"
      data-mapper-row
      ref={(el) => anchorRef?.(field.id, el)}
      onMouseEnter={() => onHover?.(field.id)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onSelect?.(field.id)}
      title={`${field.label}: ${field.value}`}
      style={{
        display: "flex", alignItems: "center", gap: 8, minWidth: 0,
        padding: "7px 9px 7px 10px", borderRadius: 8,
        border: `1px solid ${connecting ? "#6F4FCE" : hovered ? "#C4ABE8" : wired ? "#D9CEF2" : "var(--line, #E2E6EE)"}`,
        borderLeft: `3px solid ${accentColor}`,
        background: connecting ? "#EEE7FB" : hovered ? "#F7F4FD" : "#FFFFFF",
        userSelect: "none",
        transition: "border-color 120ms, background 120ms, box-shadow 120ms",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: wired ? "#5E3DB0" : "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {field.label}
          </span>
          {suggested && !wired && (
            <span aria-label="AI suggested" title={`AI suggests → ${field.suggestedFor}`} style={{ fontSize: 8.5, fontWeight: 800, color: "#6F4FCE", flexShrink: 0, letterSpacing: "0.04em" }}>
              ✦ AI
            </span>
          )}
        </span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: "tabular-nums", fontSize: 11.5, color: "var(--ink, #0B1A2F)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {field.value || <span style={{ color: "#C6CDDA" }}>(empty)</span>}
        </span>
      </span>

      {/* Per-field AI confidence chip (§6 "Right column") — only when an AI suggestion confidence
          exists for this field. Never fabricated. */}
      {confidence != null && <ConfidenceChip value={confidence} sm />}

      {/* RIGHT-edge drag PORT — the wire emerges from here. Grab it (or focus + Enter, then
          arrows) to wire this field to an output. The whole port is the drag handle. */}
      {!readOnly ? (
        <span
          {...portHandlers}
          ref={(el) => portRef(el)}
          className="mapper-grip"
          title={`Drag onto an output field to map ${field.label}${suggested ? ` (AI suggests → ${field.suggestedFor})` : ""}`}
          style={{
            flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: 999,
            border: `1.5px solid ${connecting ? "#6F4FCE" : wired ? "#6F4FCE" : "#C9D0DC"}`,
            background: connecting ? "#EEE7FB" : wired ? "#F4EFFC" : "#FFFFFF",
            color: wired || hovered ? "#6F4FCE" : "#8A93A5",
            cursor: connecting ? "grabbing" : "grab",
            touchAction: "none",
            boxShadow: connecting ? "0 0 0 3px rgba(111,79,206,0.18)" : (hovered ? "0 0 0 2px rgba(111,79,206,0.12)" : undefined),
            transition: "border-color 120ms, background 120ms, box-shadow 120ms",
          }}
        >
          <span aria-hidden style={{ fontSize: 11, lineHeight: 1 }}>{dragging ? "→" : "⠿"}</span>
        </span>
      ) : wired ? (
        <span aria-hidden style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", flexShrink: 0 }}>wired →</span>
      ) : null}
    </div>
  );
}
