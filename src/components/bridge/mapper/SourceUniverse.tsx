"use client";

// SourceUniverse — the anti-overwhelm field-discovery LEFT lane of the unified mapper.
//
// Extends SourceTokenPanel (search + header/line split + collapse + value preview + wired
// state) with the Phase-3 discovery pattern:
//   • four groups — Header / Parties / Line fields / Raw (the Phase-1 lossless SourceCapture
//     bag) — each independently collapsible; Raw + Line collapsed by default (GROUP_META).
//   • five filter chips — All / Unmapped / Mapped / AI / Has value.
//   • 150ms-debounced search over labels AND values (a query auto-reveals collapsed groups).
//   • AI-suggested fields pinned to the top of their group with a faint ghost indicator.
//   • inline value previews on every chip.
//   • virtualization (windowed render) for any group exceeding ~50 rows — a 50-line CSV
//     tokenizes to hundreds of cell chips; mounting them all balloons the column + jank.
//
// Presentational: it takes `fields`, controlled `query`/`filter`, and `chipProps(id)` (the
// drag-handle props from the wire layer). No data fetching here — the model hook supplies
// the fields. Visuals reuse the locked SourceTokenPanel chip language (no new vocabulary).

import { useEffect, useMemo, useRef, useState } from "react";
import type { SourceWireDragChipProps } from "../SourceWireDragLayer";
import type { SourceField, FieldFilter } from "./types";
import {
  groupSourceFields,
  filterSourceFields,
  filterCounts,
  GROUP_META,
  type SourceGroup,
} from "./sourceUniverseModel";

/** Above this row count a group renders a windowed slice instead of every chip. */
const VIRTUALIZE_THRESHOLD = 50;
/** Rows mounted at once inside a virtualized group (plus a small overscan). */
const WINDOW_ROWS = 60;
const SEARCH_DEBOUNCE_MS = 150;

interface SourceUniverseProps {
  fields: SourceField[];
  /** Controlled search query (the host debounces or passes raw — internal debounce below). */
  query: string;
  onQuery: (q: string) => void;
  filter: FieldFilter;
  onFilter: (f: FieldFilter) => void;
  /** Per-token drag/keyboard props from the wire layer. */
  chipProps: (id: string) => SourceWireDragChipProps;
  loading?: boolean;
  /** Phrases the honest no-tokens empty state (API-ingress orders have no source doc). */
  sourceFileKey?: string | null;
  /**
   * Bumped by the command palette "Jump to field" command — focuses + selects the search
   * input so the user can immediately type a field name. A counter, not a boolean, so each
   * invocation re-triggers even without an intervening change.
   */
  focusSearchSignal?: number;
  /** True when extraction fell back to the deterministic parser — softens the empty copy. */
  extractionFailed?: boolean;
}

// ── Chip ─────────────────────────────────────────────────────────────────────
// Lifted from SourceTokenPanel.TokenChip; adds the AI-ghost indicator. Module-level
// (not nested) so React keeps its identity across re-renders (focus/drag stability).
function SourceFieldChip({ field, props }: { field: SourceField; props: SourceWireDragChipProps }) {
  const wired = props["data-wired"] || field.mapped;
  const connecting = props["data-connecting"];
  const suggested = field.suggestedFor != null;
  const [focused, setFocused] = useState(false);
  return (
    <div
      {...props}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      title={`${field.label}: ${field.value}${suggested ? `\nAI suggests → ${field.suggestedFor}` : ""}\nDrag onto a canonical field to wire it.`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 1,
        padding: "5px 8px",
        borderRadius: 7,
        border: `1px solid ${connecting ? "#6F4FCE" : wired ? "#C4ABE8" : suggested ? "#D9CEF2" : "#DCE0E8"}`,
        background: connecting ? "#EEE7FB" : wired ? "#F4EFFC" : suggested ? "#FAF7FE" : "#FFFFFF",
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
          {field.label}
        </span>
        {suggested && !wired && (
          <span
            aria-label="AI suggested"
            title={`AI suggests → ${field.suggestedFor}`}
            style={{ marginLeft: "auto", fontSize: 8.5, fontWeight: 800, color: "#6F4FCE", flexShrink: 0, letterSpacing: "0.04em" }}
          >
            ✦ AI
          </span>
        )}
        {wired && <span aria-hidden style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: "#5E3DB0", flexShrink: 0 }}>wired →</span>}
      </span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {field.value || <span style={{ color: "#C6CDDA" }}>(empty)</span>}
      </span>
    </div>
  );
}

// ── Group (collapsible + virtualized) ────────────────────────────────────────
function FieldGroup({
  group,
  fields,
  open,
  onToggle,
  chipProps,
  forceOpen,
}: {
  group: SourceGroup;
  fields: SourceField[];
  open: boolean;
  onToggle: () => void;
  chipProps: (id: string) => SourceWireDragChipProps;
  /** While searching, every matching group is force-expanded regardless of collapse state. */
  forceOpen: boolean;
}) {
  const expanded = open || forceOpen;
  const virtualize = fields.length > VIRTUALIZE_THRESHOLD;

  // Simple windowed render: track a scroll offset and only mount a slice. No new dep —
  // we reuse a maxHeight + overflowY window like the existing panel (each row ~32px).
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [winStart, setWinStart] = useState(0);
  const ROW_H = 34; // chip height incl. gap, two-per-row grid → step by 2

  const visible = useMemo(() => {
    if (!virtualize) return fields;
    return fields.slice(winStart, winStart + WINDOW_ROWS);
  }, [fields, virtualize, winStart]);

  const meta = GROUP_META[group];
  const label = meta.label;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          background: "none",
          border: "none",
          cursor: forceOpen ? "default" : "pointer",
          padding: "0 0 5px",
          margin: 0,
        }}
        disabled={forceOpen}
      >
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)" }}>
          {label} · {fields.length}
        </span>
        {!forceOpen && (
          <span aria-hidden style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", transition: "transform 120ms", transform: expanded ? "rotate(0deg)" : "rotate(-90deg)" }}>
            ▾
          </span>
        )}
      </button>

      {expanded && (
        <div
          ref={scrollRef}
          onScroll={
            virtualize
              ? (e) => {
                  const top = (e.target as HTMLDivElement).scrollTop;
                  // two chips per row → step the window by whole rows
                  setWinStart(Math.max(0, Math.floor(top / ROW_H) * 2 - 4));
                }
              : undefined
          }
          style={
            virtualize
              ? { maxHeight: 220, overflowY: "auto", position: "relative" }
              : undefined
          }
        >
          {virtualize ? (
            // Spacer keeps the scrollbar honest; the mounted slice is offset by winStart.
            <div style={{ height: Math.ceil(fields.length / 2) * ROW_H, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  top: Math.floor(winStart / 2) * ROW_H,
                  left: 0,
                  right: 0,
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 6,
                }}
              >
                {visible.map((f) => (
                  <SourceFieldChip key={f.id} field={f} props={chipProps(f.id)} />
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {fields.map((f) => (
                <SourceFieldChip key={f.id} field={f} props={chipProps(f.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Filter chips ─────────────────────────────────────────────────────────────
const FILTERS: { id: FieldFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unmapped", label: "Unmapped" },
  { id: "mapped", label: "Mapped" },
  { id: "ai", label: "AI" },
  { id: "hasValue", label: "Has value" },
];

export function SourceUniverse({
  fields,
  query,
  onQuery,
  filter,
  onFilter,
  chipProps,
  loading,
  sourceFileKey,
  focusSearchSignal,
  extractionFailed,
}: SourceUniverseProps) {
  // 150ms debounce so the controlled query upstream doesn't thrash on every keystroke.
  const [local, setLocal] = useState(query);
  useEffect(() => setLocal(query), [query]);
  useEffect(() => {
    if (local === query) return;
    const t = setTimeout(() => onQuery(local), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [local, query, onQuery]);

  // "Jump to field" (command palette) → focus + select the search box. Skip the very first
  // mount (signal undefined/0) so we don't steal focus on load.
  const searchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!focusSearchSignal) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusSearchSignal]);

  // Per-group collapse state, seeded from GROUP_META (Raw + Line collapsed).
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const isOpen = (g: SourceGroup) => {
    const explicit = collapsed[g];
    return explicit === undefined ? !GROUP_META[g].defaultCollapsed : !explicit;
  };
  const toggle = (g: SourceGroup) => setCollapsed((c) => ({ ...c, [g]: !(c[g] === undefined ? GROUP_META[g].defaultCollapsed : c[g]) }));

  const q = query.trim();
  const counts = useMemo(() => filterCounts(fields), [fields]);
  const filtered = useMemo(() => filterSourceFields(fields, query, filter), [fields, query, filter]);
  const groups = useMemo(() => groupSourceFields(filtered), [filtered]);

  if (loading) {
    return (
      <div style={{ marginTop: 10, padding: "8px 10px", borderRadius: 8, border: "1px solid #E2E6EE", background: "#FBFBFD", fontSize: 10.5, color: "var(--ink-faint)" }}>
        Loading source fields…
      </div>
    );
  }

  if (fields.length === 0) {
    // HONEST empty state (mirrors SourceTokenPanel) — API-ingress orders have no source doc.
    // Extraction-failed: the deterministic parser ran instead of AI, so wire/fix manually.
    const message = extractionFailed
      ? "We couldn't auto-extract source fields from this document, so it fell back to the deterministic parser. Map the canonical and output fields manually below — everything still works."
      : !sourceFileKey
      ? "This order arrived via the API — there's no source document to wire from."
      : "No draggable source fields for this document type — the parsed values are the source of truth.";
    return (
      <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, border: "1px dashed #D5DAE3", background: "#F6F7FA" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#56627A", marginBottom: 3 }}>Source fields</div>
        <div style={{ fontSize: 10.5, color: "var(--ink-faint)", lineHeight: 1.45 }}>{message}</div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 10, borderRadius: 8, border: "1px solid #E2E6EE", background: "#FBFBFD", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", borderBottom: "1px solid #EEF0F4" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#5E3DB0" }}>Source fields</span>
        <span style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>drag onto a canonical field →</span>
      </div>

      {/* Search — finds any field/value across groups (collapsed groups auto-reveal). */}
      <div style={{ padding: "7px 10px 0" }}>
        <input
          ref={searchRef}
          type="text"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          placeholder="Search source fields…"
          aria-label="Search source fields"
          style={{
            width: "100%", boxSizing: "border-box", padding: "5px 8px", borderRadius: 6,
            border: "1px solid #DCE0E8", fontSize: 11, color: "#0B1A2F", background: "#FFFFFF",
          }}
        />
      </div>

      {/* Filter chips. */}
      <div role="group" aria-label="Filter source fields" style={{ display: "flex", flexWrap: "wrap", gap: 5, padding: "7px 10px 0" }}>
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const n = counts[f.id];
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => onFilter(f.id)}
              aria-pressed={active}
              style={{
                display: "inline-flex", alignItems: "center", gap: 4,
                padding: "3px 8px", borderRadius: 999, cursor: "pointer",
                fontSize: 10, fontWeight: 700, letterSpacing: "0.02em",
                border: `1px solid ${active ? "#6F4FCE" : "#DCE0E8"}`,
                background: active ? "#EEE7FB" : "#FFFFFF",
                color: active ? "#5E3DB0" : "var(--ink-faint)",
                transition: "border-color 120ms, background 120ms, color 120ms",
              }}
            >
              {f.label}
              <span style={{ fontSize: 9, fontWeight: 800, opacity: 0.7 }}>{n}</span>
            </button>
          );
        })}
      </div>

      <div style={{ maxHeight: 320, overflowY: "auto", padding: "9px 10px", display: "flex", flexDirection: "column", gap: 11 }}>
        {groups.length === 0 ? (
          <div style={{ fontSize: 10.5, color: "var(--ink-faint)" }}>
            {q ? `No source field matches “${query}”.` : "No source fields match this filter."}
          </div>
        ) : (
          groups.map((g) => (
            <FieldGroup
              key={g.group}
              group={g.group}
              fields={g.fields}
              open={isOpen(g.group)}
              onToggle={() => toggle(g.group)}
              chipProps={chipProps}
              forceOpen={q.length > 0}
            />
          ))
        )}
      </div>
    </div>
  );
}
