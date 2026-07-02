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
  /** Hovered id + its wire-linked counterparts → cross-column highlight. */
  activeIds?: Set<string>;
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
  /**
   * The supplier/connection display name — drives the B2 plain-language sub-header
   * ("These are the fields in the {supplier}'s order…"). Falls back to "supplier"
   * when absent, so the copy always reads sensibly.
   */
  supplierName?: string;
}

const FILTERS: { id: FieldFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unmapped", label: "Unmapped" },
  { id: "mapped", label: "Mapped" },
  { id: "ai", label: "Has AI suggestion" },
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
  activeIds,
  onHover,
  onSelect,
  dragging,
  readOnly,
  sourceType,
  supplierName,
}: IncomingPaneProps) {
  // B2 sub-header: plain-language framing that incoming fields are read-only source data.
  const supplierLabel = supplierName?.trim() || "supplier";
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
      {/* B2 sub-header — clarifies that these incoming fields are read-only source data
          you map FROM (you don't edit them here). Plain-language, calm, muted. */}
      <div style={{ flexShrink: 0, padding: "10px 18px 0", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>
        These are the fields in the {supplierLabel}&rsquo;s order. You don&rsquo;t edit them here — you map them to the output on the right.
      </div>
      {/* Search — finds any field/value across groups (collapsed groups auto-reveal). */}
      <div style={{ flexShrink: 0, padding: "12px 18px 10px" }}>
        <input
          ref={searchRef}
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder="Search incoming fields…"
          aria-label="Search incoming fields"
          style={{
            width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 8,
            border: "1px solid var(--line, #DCE0E8)", fontSize: 11.5, color: "var(--ink, #0B1A2F)", background: "#F1F3F7",
          }}
        />
      </div>

      {/* Filter chips. */}
      <div role="group" aria-label="Filter incoming fields" style={{ flexShrink: 0, display: "flex", flexWrap: "wrap", gap: 6, padding: "12px 18px 10px" }}>
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
                padding: "4px 9px", borderRadius: 999, cursor: "pointer",
                fontSize: 11, fontWeight: 600, letterSpacing: "0.02em",
                border: `1px solid ${active ? "#1E66C9" : "var(--line, #DCE0E8)"}`,
                background: active ? "#EAF0F8" : "#FFFFFF",
                color: active ? "#0F4FA8" : "#5E6779",
                transition: "border-color 120ms, background 120ms, color 120ms",
              }}
            >
              {f.label}
              <span style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace", fontWeight: 400, opacity: 0.7 }}>{counts[f.id]}</span>
            </button>
          );
        })}
      </div>

      {/* This column scrolls INDEPENDENTLY (app.jsx parity). The wire overlay re-measures on a
          capturing scroll listener, so wires track this column's scroll. */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: 12 }}>
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
              activeIds={activeIds}
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
  // app.jsx ColHead: plain white column, faint buyer tint on the 52px header only (NOT a blue
  // pane wash), title-case display title + 9px dot.
  return (
    <div style={{ border: "1px solid var(--line, #E5E8EE)", background: "var(--surface, #FFFFFF)", overflow: "hidden", height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", height: 52, gap: 10, padding: "0 18px", borderBottom: "1px solid #E5E8EE", background: "#EAF0F844" }}>
        <span aria-hidden style={{ flexShrink: 0, width: 9, height: 9, borderRadius: "50%", background: "#1E66C9", boxShadow: "0 0 0 3px #EAF0F8" }} />
        <span style={{ fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)", fontSize: 13.5, fontWeight: 700, letterSpacing: "-0.01em", color: "#0B1A2F" }}>{title}</span>
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
  group, fields, open, onToggle, forceOpen, portProps, anchorRef, hoveredId, activeIds, onHover, onSelect, dragging, readOnly,
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
  /** Hovered id + its wire-linked counterparts → cross-column highlight. */
  activeIds?: Set<string>;
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
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)" }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {fields.map((f) => (
            <IncomingRow
              key={f.id}
              field={f}
              port={portProps(f.id)}
              anchorRef={anchorRef}
              hovered={activeIds ? activeIds.has(f.id) : hoveredId === f.id}
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
        display: "flex", alignItems: "center", gap: 10, minWidth: 0,
        padding: "9px 11px", borderRadius: 9,
        border: `1px solid ${connecting ? "#1E66C9" : hovered ? "#1E66C9" : wired ? "#BFD6F4" : "var(--line, #E5E8EE)"}`,
        background: connecting ? "#EAF0F8" : hovered ? "#EAF0F899" : "#FFFFFF",
        userSelect: "none",
        transition: "border-color 120ms, background 120ms, box-shadow 120ms",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.04em", color: "var(--ink, #0B1A2F)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {field.label}
          </span>
          {suggested && !wired && (
            <span aria-label="AI suggested" title={`AI suggests → ${field.suggestedFor}`} style={{ fontSize: 8.5, fontWeight: 800, color: "#6F4FCE", flexShrink: 0, letterSpacing: "0.04em" }}>
              ✦ AI
            </span>
          )}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: "tabular-nums", fontSize: 11.5, color: "var(--ink, #0B1A2F)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {field.value || <span style={{ color: "#CBD0DA" }}>(empty)</span>}
          </span>
          {!wired && (
            <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, color: "#B36D14", background: "#FAF1DD", borderRadius: 4, padding: "2px 6px" }}>
              unmapped
            </span>
          )}
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
          title={`Drag onto an output field to map ${field.label}${suggested ? ` (AI suggests → ${field.suggestedFor})` : ""}`}
          style={{
            display: "inline-flex", alignItems: "center", gap: 7, flexShrink: 0,
            cursor: connecting ? "grabbing" : "grab", touchAction: "none",
          }}
        >
          {/* Drag-grip (dots) — a calm grey handle; app.jsx places the square NEXT TO the port. */}
          <span aria-hidden className="mapper-grip" style={{
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: 22, height: 22, borderRadius: 6, background: "#F1F3F7", border: "1px solid #DCE0E8",
            color: "#9AA8C0", fontSize: 11, lineHeight: 1,
          }}>{dragging ? "→" : "⠿"}</span>
          {/* BLUE CIRCLE port — the wire anchor (app.jsx: 2px blue ring, fills on grab), mirroring
              the green output circle it connects to. `mapper-port` marks the exact element the
              wire engine measures (portRef → sourceEls), distinct from the row (`mapper-row`)
              and the grey grip handle (`mapper-grip`). */}
          <span ref={(el) => portRef(el)} className="mapper-port" aria-hidden style={{
            flexShrink: 0, display: "inline-block", boxSizing: "border-box",
            width: 14, height: 14, borderRadius: "50%",
            // app.jsx: the port fills SOLID on hover/grab (a wire connecting two filled circles).
            background: (connecting || hovered) ? "#1E66C9" : "#FFFFFF", border: "2px solid #1E66C9",
            boxShadow: connecting ? "0 0 0 3px rgba(30,102,201,0.18)" : (hovered ? "0 0 0 2px rgba(30,102,201,0.12)" : "0 1px 3px rgba(11,26,47,0.2)"),
            transition: "border-color 120ms, background 120ms, box-shadow 120ms",
          }}/>
        </span>
      ) : wired ? (
        <span aria-hidden style={{ fontSize: 9, fontWeight: 700, color: "#0F4FA8", flexShrink: 0 }}>wired →</span>
      ) : null}
    </div>
  );
}
