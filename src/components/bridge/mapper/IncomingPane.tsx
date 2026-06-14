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
import type { SourceWireDragChipProps } from "../SourceWireDragLayer";
import type { SourceField, FieldFilter } from "./types";
import {
  buildIncomingGroups,
  incomingFilterCounts,
  hasIncomingData,
  INCOMING_GROUP_META,
  type SourceGroup,
} from "./incomingPaneModel";

const SEARCH_DEBOUNCE_MS = 150;
/** Above this row count a group renders a windowed slice (a 50-line CSV → hundreds of cells). */
const VIRTUALIZE_THRESHOLD = 60;
const WINDOW_ROWS = 70;
const ROW_H = 46;

export interface IncomingPaneProps {
  fields: SourceField[];
  query: string;
  onQuery: (q: string) => void;
  filter: FieldFilter;
  onFilter: (f: FieldFilter) => void;
  /** Per-row drag/keyboard props from the wire layer (interaction agent supplies the real impl). */
  chipProps: (id: string) => SourceWireDragChipProps;
  loading?: boolean;
  /** Honest empty-state framing — API orders with no parsed data are rare but possible. */
  sourceFileKey?: string | null;
  /** True when extraction fell back to the deterministic parser — softens the empty copy. */
  extractionFailed?: boolean;
  /** Command-palette "Jump to field" → focus + select the search box (counter, not boolean). */
  focusSearchSignal?: number;
  /**
   * SEAM (interaction agent): register a row's anchor element so wires can attach to the
   * incoming side. Keyed by the SourceToken id. Optional so the structural pane renders alone.
   */
  anchorRef?: (id: string, el: HTMLElement | null) => void;
  /**
   * SEAM (interaction agent): the advanced "Change source" affordance per row. When wired, a
   * subtle control renders; clicking it calls this with the row id so the agent can open its
   * popover (re-derive the canonical value from a different raw token). Absent → no control.
   */
  onChangeSource?: (id: string) => void;
  /** Selection/hover plumbing (kept parallel to the old lanes for the wire engine). */
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  readOnly?: boolean;
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
  chipProps,
  loading,
  sourceFileKey,
  extractionFailed,
  focusSearchSignal,
  anchorRef,
  onChangeSource,
  hoveredId,
  onHover,
  onSelect,
  readOnly,
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
      <PaneFrame title="Incoming order">
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
      <PaneFrame title="Incoming order">
        <div style={{ padding: "12px", fontSize: 11.5, color: "var(--ink-faint)", lineHeight: 1.5 }}>{message}</div>
      </PaneFrame>
    );
  }

  return (
    <PaneFrame title="Incoming order" subtitle={`${counts.all} field${counts.all === 1 ? "" : "s"}`}>
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

      <div style={{ maxHeight: 420, overflowY: "auto", padding: "10px", display: "flex", flexDirection: "column", gap: 12 }}>
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
              chipProps={chipProps}
              anchorRef={anchorRef}
              onChangeSource={onChangeSource}
              hoveredId={hoveredId}
              onHover={onHover}
              onSelect={onSelect}
              readOnly={readOnly}
            />
          ))
        )}
      </div>
    </PaneFrame>
  );
}

// ── Pane frame (shared chrome) ────────────────────────────────────────────────
function PaneFrame({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderRadius: 12, border: "1px solid var(--line, #E2E6EE)", background: "#FBFBFD", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "9px 12px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#5E3DB0" }}>{title}</span>
        {subtitle && <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

// ── A collapsible group of incoming rows ──────────────────────────────────────
function IncomingGroup({
  group, fields, open, onToggle, forceOpen, chipProps, anchorRef, onChangeSource, hoveredId, onHover, onSelect, readOnly,
}: {
  group: SourceGroup;
  fields: SourceField[];
  open: boolean;
  onToggle: () => void;
  forceOpen: boolean;
  chipProps: (id: string) => SourceWireDragChipProps;
  anchorRef?: (id: string, el: HTMLElement | null) => void;
  onChangeSource?: (id: string) => void;
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  readOnly?: boolean;
}) {
  const expanded = open || forceOpen;
  const meta = INCOMING_GROUP_META[group];
  const virtualize = fields.length > VIRTUALIZE_THRESHOLD;
  const [winStart, setWinStart] = useState(0);

  const visible = useMemo(
    () => (virtualize ? fields.slice(winStart, winStart + WINDOW_ROWS) : fields),
    [fields, virtualize, winStart],
  );

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

      {expanded &&
        (virtualize ? (
          <div
            onScroll={(e) => {
              const top = (e.target as HTMLDivElement).scrollTop;
              setWinStart(Math.max(0, Math.floor(top / ROW_H) - 4));
            }}
            style={{ maxHeight: 280, overflowY: "auto", position: "relative" }}
          >
            <div style={{ height: fields.length * ROW_H, position: "relative" }}>
              <div style={{ position: "absolute", top: Math.max(0, winStart) * ROW_H, left: 0, right: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                {visible.map((f) => (
                  <IncomingRow key={f.id} field={f} props={chipProps(f.id)} anchorRef={anchorRef} onChangeSource={onChangeSource} hovered={hoveredId === f.id} onHover={onHover} onSelect={onSelect} readOnly={readOnly} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {fields.map((f) => (
              <IncomingRow key={f.id} field={f} props={chipProps(f.id)} anchorRef={anchorRef} onChangeSource={onChangeSource} hovered={hoveredId === f.id} onHover={onHover} onSelect={onSelect} readOnly={readOnly} />
            ))}
          </div>
        ))}
    </div>
  );
}

// ── A single incoming-data row: grip · label · value (mono) ───────────────────
// Module-level (not nested) so React keeps its identity across re-renders (focus/drag
// stability — same discipline as the old SourceFieldChip).
function IncomingRow({
  field, props, anchorRef, onChangeSource, hovered, onHover, onSelect, readOnly,
}: {
  field: SourceField;
  props: SourceWireDragChipProps;
  anchorRef?: (id: string, el: HTMLElement | null) => void;
  onChangeSource?: (id: string) => void;
  hovered?: boolean;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  readOnly?: boolean;
}) {
  const wired = props["data-wired"] || field.mapped;
  const connecting = props["data-connecting"];
  const suggested = field.suggestedFor != null;

  // Compose the wire-layer ref (from chipProps) with our anchor ref so BOTH get the node.
  // The interaction agent's drag layer relies on props.ref; the redesign's wire engine
  // measures via anchorRef — neither may clobber the other.
  const { ref: chipRef, ...restProps } = props;
  const setRef = (el: HTMLElement | null) => {
    chipRef?.(el);
    anchorRef?.(field.id, el);
  };

  return (
    <div
      {...restProps}
      // The interaction agent measures this element to anchor a wire on the incoming side.
      ref={setRef}
      onMouseEnter={() => onHover?.(field.id)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onSelect?.(field.id)}
      title={`${field.label}: ${field.value}${suggested ? `\nAI suggests → ${field.suggestedFor}` : ""}`}
      style={{
        display: "flex", alignItems: "center", gap: 8, minWidth: 0,
        padding: "7px 9px", borderRadius: 8,
        border: `1px solid ${connecting ? "#6F4FCE" : hovered ? "#C4ABE8" : wired ? "#D9CEF2" : "var(--line, #E2E6EE)"}`,
        borderLeft: `3px solid ${wired ? "#6F4FCE" : suggested ? "#C4ABE8" : "transparent"}`,
        background: connecting ? "#EEE7FB" : hovered ? "#F7F4FD" : "#FFFFFF",
        cursor: readOnly ? "default" : "grab",
        touchAction: "pan-y",
        userSelect: "none",
        boxShadow: connecting ? "0 0 0 2px rgba(111,79,206,0.18)" : undefined,
        transition: "border-color 120ms, background 120ms, box-shadow 120ms",
      }}
    >
      {!readOnly && (
        <span aria-hidden style={{ color: wired ? "#6F4FCE" : "#A8B0BF", fontSize: 11, flexShrink: 0, cursor: "grab" }}>⠿</span>
      )}
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
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11.5, color: "var(--ink, #0B1A2F)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {field.value || <span style={{ color: "#C6CDDA" }}>(empty)</span>}
        </span>
      </span>

      {wired && <span aria-hidden style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", flexShrink: 0 }}>wired →</span>}

      {/* Advanced "Change source" affordance — only when the host wires it (interaction agent
          opens the re-derive popover). Subtle, never a permanent extra column. */}
      {!readOnly && onChangeSource && (
        <button
          type="button"
          aria-label={`Change source for ${field.label}`}
          title="Change which raw value feeds this field"
          onClick={(e) => { e.stopPropagation(); onChangeSource(field.id); }}
          style={{ flexShrink: 0, border: "none", background: "none", cursor: "pointer", color: "var(--ink-faint)", fontSize: 11, lineHeight: 1, padding: "0 2px", opacity: 0.65 }}
        >
          ⋯
        </button>
      )}
    </div>
  );
}
