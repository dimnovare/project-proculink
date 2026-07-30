"use client";

// OutputSourcePicker — F-1 "bind ANY incoming source field" for the OUTPUT side.
//
// Replaces the hard-coded 13-canonical-name <select> in OutputMappingEditor and
// OutputStructureDesigner with a grouped, typeahead picker fed by getSourceTokens(orderId).
// It lets an output node bind to:
//   • a canonical field   → writes rule.canonicalField, clears rule.sourceToken
//   • ANY source token     → writes rule.sourceToken (the BARE token id), clears rule.canonicalField
//   • a fixed value        → host handles via onPickFixed
//
// PROGRESSIVE DISCLOSURE (design §6): a wide XML/UBL file yields hundreds of tokens, so the
// canonical fields show FIRST. The raw source tokens are hidden behind a "More source fields…"
// disclosure (also auto-revealed when the user types a query, so search reaches them). This reuses
// the grouping + typeahead-on-label-AND-value pattern from mapper/SourcePickerChip.tsx.
//
// Pure presentation: it never mutates the override; it calls back to the host which patches the
// OutputFieldRule. Keyboard-accessible: trigger is a button, the panel is a listbox, Escape closes,
// ArrowUp/Down move, Enter selects.

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CANONICAL_FIELD_GROUPS, canonicalFieldScope,
  canonicalFieldReachesOutput, isStructuredOutputFormat,
  type SourceToken,
} from "@/lib/api/types";

const PANEL_W = 300;

/** What the picker currently shows on its trigger chip. */
export interface OutputBinding {
  /** A canonical field name, or null. */
  canonicalField?: string | null;
  /** A bare SourceToken id, or null. */
  sourceToken?: string | null;
  /** A fixed literal value, or null. */
  fixedValue?: string | null;
}

export interface OutputSourcePickerProps {
  /** Stable id for aria wiring (the output field name is fine). */
  outputPath: string;
  /** The current binding shown on the chip. */
  binding: OutputBinding;
  /** Canonical field names offered first (header or line scope, + custom keys). */
  canonicalFields: ReadonlyArray<string>;
  /**
   * The output format the connection actually delivers, when known. For a structured format
   * (cXML / UBL / X12 / XML) most canonical names cannot reach the document — the shape is fixed
   * by the standard — so they are shown DISABLED with a reason instead of being offered as if they
   * worked. Omit (or pass null) for the flat formats, where every name lands.
   */
  outputFormat?: string | null;
  /** Every source field for this order (CSV cells / XML leaves+attrs / EDI / JSON / raw). */
  sourceTokens: ReadonlyArray<SourceToken>;
  /** Pick a canonical field: host sets canonicalField, clears sourceToken + fixedValue. */
  onPickCanonical: (canonicalField: string) => void;
  /** Pick a source token (bare id): host sets sourceToken, clears canonicalField + fixedValue. */
  onPickSourceToken: (tokenId: string) => void;
  /** Switch the row to a fixed value (host shows/uses its own fixed-value input). */
  onPickFixed: () => void;
  /** Clear the binding back to "— pick a source —". */
  onClear?: () => void;
  /** Compact (designer pill) vs default (editor select-width) trigger. */
  compact?: boolean;
}

/** True for a line-group token that carries a RELATIVE address (F-1 Phase 4). */
function isPerLineToken(t: SourceToken): boolean {
  return t.group === "line" && !!t.relativeId;
}

/**
 * The label + sample value to show for the current binding (so the chosen binding is legible).
 * Recognises BOTH a RELATIVE id (a "per line" binding — matched against any token's relativeId) and
 * an ABSOLUTE id (a specific cell — matched against the token id). The relative match wins first so a
 * "per line" binding reads as the column name, not row 2's cell label.
 */
function describeBinding(
  binding: OutputBinding,
  sourceTokens: ReadonlyArray<SourceToken>,
): { label: string; sample: string | null; unset: boolean } {
  if (binding.fixedValue != null && !binding.canonicalField && !binding.sourceToken) {
    return { label: `"${binding.fixedValue}"`, sample: null, unset: false };
  }
  if (binding.sourceToken) {
    // Per-line (relative) binding: find the FIRST line token whose relativeId matches; render the
    // column name + "· per line" so the user sees this fills every line, and show its sample value.
    const rel = sourceTokens.find((x) => x.relativeId && x.relativeId === binding.sourceToken);
    if (rel) {
      return { label: `${columnName(rel)} · per line`, sample: rel.value || null, unset: false };
    }
    // Absolute (specific cell) binding.
    const t = sourceTokens.find((x) => x.id === binding.sourceToken);
    return { label: t?.label ?? binding.sourceToken, sample: t?.value ?? null, unset: false };
  }
  if (binding.canonicalField) {
    return { label: binding.canonicalField, sample: null, unset: false };
  }
  return { label: "pick a source", sample: null, unset: true };
}

/** The column name for a per-line token — its label with the trailing "· row {n}" stripped. */
function columnName(t: SourceToken): string {
  return t.label.replace(/\s*[·•]\s*row\s*\d+\s*$/i, "").trim() || t.label;
}

type Option =
  // `unavailable`: the name exists in the backend row bag but the CHOSEN OUTPUT FORMAT cannot
  // carry it (a structured format's shape is fixed by its standard). Rendered greyed with a
  // reason and not selectable — the alternative, offering it and silently dropping the rule, is
  // what made this a defect.
  | { kind: "canonical"; id: string; label: string; value: string | null; unavailable?: boolean }
  // A "per line" binding: one option per repeating column, writes the token's RELATIVE id so ONE
  // rule emits each line's own value. `cells` are the absolute per-row tokens behind "exact cell".
  | { kind: "perline"; id: string; relativeId: string; label: string; value: string; cells: SourceToken[] }
  | { kind: "token"; id: string; label: string; value: string; group: SourceToken["group"] };

const GROUP_LABEL: Record<string, string> = {
  header: "Header fields", line: "Line items", parties: "Parties", raw: "Other fields",
};
const GROUP_ORDER = ["header", "line", "parties", "raw"];

export function OutputSourcePicker({
  outputPath, binding, canonicalFields, sourceTokens, outputFormat,
  onPickCanonical, onPickSourceToken, onPickFixed, onClear, compact,
}: OutputSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Progressive disclosure: the raw source tokens are collapsed until the user expands them
  // (or types a query, which auto-reveals so search can reach them).
  const [showMore, setShowMore] = useState(false);
  // Which per-line columns have their "exact cell" advanced list expanded (keyed by relativeId).
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const q = query.trim().toLowerCase();
  const tokensExpanded = showMore || q.length > 0;

  // WP-14: the canonical list grew from 13 names to 53, so it is grouped BY SCOPE — an operator
  // looking for a delivery address scans one section instead of a wall. Group order follows first
  // appearance in `canonicalFields`, so a line-scope row still leads with line fields (the host
  // passes line names first for a line rule, header names first for a header rule) and the
  // author's own custom keys land in their own trailing group.
  const structured = isStructuredOutputFormat(outputFormat);

  const canonicalGroups = useMemo<Array<{ label: string; options: Option[] }>>(() => {
    const byLabel = new Map<string, Option[]>();
    for (const f of canonicalFields) {
      if (q && !f.toLowerCase().includes(q)) continue;
      const scope = canonicalFieldScope(f);
      const label = scope === null
        ? "Custom fields"
        : (CANONICAL_FIELD_GROUPS.find((g) => g.scope === scope)?.label ?? "Standard fields");
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label)!.push({
        kind: "canonical" as const,
        id: f,
        label: f,
        value: null,
        // Offer ⇔ works: a name a structured format cannot carry is shown, and shown as
        // unavailable, rather than offered as if binding it did something.
        unavailable: !canonicalFieldReachesOutput(f, outputFormat),
      });
    }
    return [...byLabel].map(([label, options]) => ({ label, options }));
  }, [canonicalFields, q, outputFormat]);

  // Flattened in the SAME order the groups render, so keyboard nav walks what the eye sees —
  // MINUS the unavailable ones, which must not be reachable by arrow keys or Enter either.
  const canonicalOptions = useMemo<Option[]>(
    () => canonicalGroups.flatMap((g) => g.options).filter((o) => !(o.kind === "canonical" && o.unavailable)),
    [canonicalGroups],
  );

  // F-1 Phase 4: a repeating LINE column collapses to ONE "per line" option (deduped by relativeId).
  // Binding it writes the relativeId so one rule emits each line's own value. The absolute per-row
  // tokens are kept on `cells` for the secondary "exact cell" disclosure. A line token with NO
  // relativeId (defensive — shouldn't happen) falls through to the absolute `token` list below.
  const perLineOptions = useMemo<Option[]>(() => {
    const byRel = new Map<string, SourceToken[]>();
    for (const t of sourceTokens) {
      if (!isPerLineToken(t)) continue;
      const rel = t.relativeId!;
      if (!byRel.has(rel)) byRel.set(rel, []);
      byRel.get(rel)!.push(t);
    }
    const opts: Option[] = [];
    for (const [rel, cells] of byRel) {
      const first = cells[0];
      const col = columnName(first);
      // Search matches the column name OR any cell's value (so a query for a line value still finds it).
      if (q && !col.toLowerCase().includes(q) && !cells.some((c) => c.value.toLowerCase().includes(q))) continue;
      opts.push({ kind: "perline", id: `perline:${rel}`, relativeId: rel, label: col, value: first.value, cells });
    }
    return opts;
  }, [sourceTokens, q]);

  // The absolute source tokens MINUS the per-line line tokens already collapsed above (kept whole:
  // header/parties/raw, plus any line token without a relativeId).
  const tokenOptions = useMemo<Option[]>(
    () => sourceTokens
      .filter((t) => !isPerLineToken(t))
      .filter((t) => !q || t.label.toLowerCase().includes(q) || t.value.toLowerCase().includes(q))
      .map((t) => ({ kind: "token" as const, id: t.id, label: t.label, value: t.value, group: t.group })),
    [sourceTokens, q],
  );

  // Flat list that keyboard nav walks, mirroring the visual order: canonical first, then (when
  // expanded) the per-line options — each followed by its absolute cells when that column's "exact
  // cell" list is open — then the remaining grouped tokens.
  const flat = useMemo<Option[]>(() => {
    if (!tokensExpanded) return canonicalOptions;
    const out: Option[] = [...canonicalOptions];
    for (const p of perLineOptions) {
      out.push(p);
      if (p.kind === "perline" && expandedCells.has(p.relativeId)) {
        for (const c of p.cells) {
          out.push({ kind: "token", id: c.id, label: c.label, value: c.value, group: c.group });
        }
      }
    }
    out.push(...tokenOptions);
    return out;
  }, [canonicalOptions, perLineOptions, tokenOptions, tokensExpanded, expandedCells]);

  const desc = describeBinding(binding, sourceTokens);
  const canClear = !!onClear && (!!binding.canonicalField || !!binding.sourceToken || binding.fixedValue != null);

  // Position the portaled panel under the trigger, flipped above when it would overflow.
  useEffect(() => {
    if (!open) return;
    function place() {
      const r = triggerRef.current?.getBoundingClientRect();
      if (!r) return;
      const margin = 8;
      const estH = panelRef.current?.offsetHeight ?? 320;
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
  }, [open, flat.length, tokensExpanded, expandedCells]);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);
  useEffect(() => { setActive(0); }, [query, open, tokensExpanded, expandedCells]);

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

  function close() { setOpen(false); setQuery(""); setShowMore(false); setExpandedCells(new Set()); }
  function pick(opt: Option) {
    if (opt.kind === "canonical") onPickCanonical(opt.id);
    // "Per line" writes the RELATIVE id → one rule emits each line's own value.
    else if (opt.kind === "perline") onPickSourceToken(opt.relativeId);
    // A specific cell (or a non-line token) writes its ABSOLUTE id.
    else onPickSourceToken(opt.id);
    close();
  }
  function toggleCells(relativeId: string) {
    setExpandedCells((prev) => {
      const next = new Set(prev);
      if (next.has(relativeId)) next.delete(relativeId);
      else next.add(relativeId);
      return next;
    });
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, flat.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = flat[active];
      if (opt) pick(opt);
    }
  }

  // Group the (filtered) token options for display, preserving GROUP_ORDER.
  const tokenGroups = useMemo(() => {
    const buckets = new Map<string, Option[]>();
    for (const o of tokenOptions) {
      const g = (o.kind === "token" ? o.group : null) ?? "raw";
      if (!buckets.has(g)) buckets.set(g, []);
      buckets.get(g)!.push(o);
    }
    return GROUP_ORDER
      .filter((g) => buckets.has(g))
      .map((g) => ({ group: g, items: buckets.get(g)! }));
  }, [tokenOptions]);

  const triggerStyle: React.CSSProperties = compact
    ? {
        display: "inline-flex", alignItems: "center", gap: 5, maxWidth: 220, height: 22,
        padding: "0 9px", borderRadius: 999,
        border: `1px ${desc.unset ? "dashed" : "solid"} ${desc.unset ? "#C9D0DC" : "#CDE7D1"}`,
        background: desc.unset ? "#FFFFFF" : "#F1F8F2",
        color: desc.unset ? "#5E6779" : "#1E6D29",
        fontFamily: "'JetBrains Mono', ui-monospace, Menlo, monospace",
        fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      }
    : {
        display: "inline-flex", alignItems: "center", gap: 6, flex: "1 1 150px", minWidth: 140,
        minHeight: 36, padding: "5px 10px", borderRadius: 6, justifyContent: "space-between",
        border: "1px solid #CBD0DA", background: "#FFFFFF",
        color: desc.unset ? "#5E6779" : "#0B1A2F",
        fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap",
      };

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
      {compact && <span aria-hidden style={{ fontSize: 9, fontWeight: 800, color: "#9AA3B2" }}>←</span>}
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Source for ${outputPath}${desc.unset ? "" : ` — ${desc.label}`}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        title={desc.unset ? "Pick the field that fills this output" : `Source: ${desc.label}${desc.sample ? ` — ${desc.sample}` : ""}`}
        style={triggerStyle}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: compact ? 180 : "100%" }}>
          {desc.unset ? "— pick a source —" : desc.label}
        </span>
        <span aria-hidden style={{ fontSize: 8, opacity: 0.7 }}>▾</span>
      </button>

      {canClear && (
        <button
          type="button"
          aria-label={`Clear the source for ${outputPath}`}
          onClick={(e) => { e.stopPropagation(); onClear?.(); }}
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
              placeholder="Search fields…"
              aria-label="Search source fields"
              style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 7, border: "1px solid #DCE0E8", fontSize: 11.5, color: "#0B1A2F" }}
            />
          </div>

          <div style={{ maxHeight: 260, overflowY: "auto", padding: 6 }}>
            {/* Canonical fields — shown first (progressive disclosure: the common case up top). */}
            {canonicalGroups.map((group) => (
              <div key={group.label} style={{ marginBottom: 4 }}>
                <div style={groupHeadStyle}>{group.label}</div>
                {group.options.map((o) => (
                  <OptionRow key={`c:${o.id}`} option={o}
                    active={flat.indexOf(o) === active}
                    unavailableNote={o.kind === "canonical" && o.unavailable
                      ? `${(outputFormat ?? "").toUpperCase()} has no place for this field`
                      : undefined}
                    onHover={() => setActive(flat.indexOf(o))} onPick={() => pick(o)} />
                ))}
              </div>
            ))}

            {/* Say it once, plainly, instead of leaving the operator to wonder why rows are grey. */}
            {structured && (
              <div style={{ padding: "6px 6px 8px", fontSize: 10, color: "var(--ink-faint)", lineHeight: 1.45 }}>
                This connection delivers <strong>{(outputFormat ?? "").toUpperCase()}</strong>, whose document
                structure is set by the standard. Only the fields above that are not greyed out can be
                changed here; the rest have no slot in that format.
              </div>
            )}

            {/* "More source fields…" disclosure — reveals the raw source-token universe. */}
            {sourceTokens.length > 0 && (
              tokensExpanded ? (
                perLineOptions.length === 0 && tokenGroups.length === 0 ? (
                  q.length > 0 && (
                    <div style={{ padding: "8px 6px", fontSize: 10.5, color: "var(--ink-faint)" }}>
                      No source field matches “{query}”.
                    </div>
                  )
                ) : (
                  <>
                    {/* Line items — each REPEATING column binds "per line" (the relative id → ONE rule
                        fills every line). "Exact cell" discloses the absolute per-row cells. */}
                    {perLineOptions.length > 0 && (
                      <div style={{ marginBottom: 4 }}>
                        <div style={groupHeadStyle}>{GROUP_LABEL.line}</div>
                        {perLineOptions.map((o) => (
                          o.kind === "perline" ? (
                            <div key={`p:${o.relativeId}`}>
                              <OptionRow option={o} perLine
                                active={flat.indexOf(o) === active}
                                onHover={() => setActive(flat.indexOf(o))} onPick={() => pick(o)} />
                              <button
                                type="button"
                                onClick={() => toggleCells(o.relativeId)}
                                aria-expanded={expandedCells.has(o.relativeId)}
                                style={{
                                  display: "block", marginLeft: 6, marginBottom: 2, border: "none",
                                  background: "none", color: "var(--ink-faint)", fontSize: 9.5,
                                  fontWeight: 600, cursor: "pointer", padding: "1px 4px",
                                }}
                              >
                                {expandedCells.has(o.relativeId) ? "▾" : "▸"} exact cell
                                <span style={{ fontWeight: 500 }}> ({o.cells.length})</span>
                              </button>
                              {expandedCells.has(o.relativeId) && (
                                <div style={{ marginLeft: 10, borderLeft: "1px solid #EEF0F4", paddingLeft: 4 }}>
                                  {o.cells.map((c) => {
                                    const cellOpt: Option = { kind: "token", id: c.id, label: c.label, value: c.value, group: c.group };
                                    return (
                                      <OptionRow key={`cell:${c.id}`} option={cellOpt}
                                        active={flat.findIndex((f) => f.kind === "token" && f.id === c.id) === active}
                                        onHover={() => setActive(flat.findIndex((f) => f.kind === "token" && f.id === c.id))}
                                        onPick={() => pick(cellOpt)} />
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          ) : null
                        ))}
                      </div>
                    )}

                    {tokenGroups.map((g) => (
                      <div key={g.group} style={{ marginBottom: 4 }}>
                        <div style={groupHeadStyle}>{GROUP_LABEL[g.group] ?? g.group}</div>
                        {g.items.map((o) => (
                          <OptionRow key={`t:${o.id}`} option={o}
                            active={flat.indexOf(o) === active}
                            onHover={() => setActive(flat.indexOf(o))} onPick={() => pick(o)} />
                        ))}
                      </div>
                    ))}
                  </>
                )
              ) : (
                <button
                  type="button"
                  onClick={() => setShowMore(true)}
                  style={{
                    width: "100%", textAlign: "left", border: "1px dashed #D8DEE9", background: "#F7F9FC",
                    color: "#1E66C9", borderRadius: 7, padding: "8px 9px", marginTop: 2,
                    fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                  }}
                >
                  More source fields… <span style={{ color: "var(--ink-faint)", fontWeight: 500 }}>({sourceTokens.length})</span>
                </button>
              )
            )}

            {canonicalOptions.length === 0 && !tokensExpanded && sourceTokens.length === 0 && (
              <div style={{ padding: "8px 6px", fontSize: 10.5, color: "var(--ink-faint)" }}>
                No source fields available for this order.
              </div>
            )}
            {canonicalOptions.length === 0 && q.length > 0 && tokenOptions.length === 0 && perLineOptions.length === 0 && sourceTokens.length > 0 && (
              <div style={{ padding: "8px 6px", fontSize: 10.5, color: "var(--ink-faint)" }}>
                No field matches “{query}”.
              </div>
            )}
          </div>

          {/* Footer actions: a fixed value + (when bound) clear. */}
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
                onClick={() => { onClear?.(); close(); }}
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

const groupHeadStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em",
  color: "var(--ink-faint)", padding: "4px 6px 3px",
};

function OptionRow({ option, active, onHover, onPick, perLine, unavailableNote }: {
  option: Option; active: boolean; onHover: () => void; onPick: () => void;
  /** A "per line" (relative) binding — append a hint so the user knows it fills EVERY line. */
  perLine?: boolean;
  /** Set when the CHOSEN OUTPUT FORMAT cannot carry this field: the row is disabled + explained. */
  unavailableNote?: string;
}) {
  const disabled = !!unavailableNote;
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      title={unavailableNote}
      onMouseEnter={disabled ? undefined : onHover}
      onClick={disabled ? undefined : onPick}
      style={{
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
        width: "100%", textAlign: "left", border: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        padding: "5px 6px", borderRadius: 6,
        opacity: disabled ? 0.55 : 1,
        background: active && !disabled ? "#F1F8F2" : "none",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {option.label}
          {perLine && (
            <span style={{ marginLeft: 5, fontSize: 9, fontWeight: 700, color: "#1E6D29", background: "#E7F5E9", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap" }}>
              · per line
            </span>
          )}
        </span>
        {unavailableNote && (
          <span style={{ fontSize: 9.5, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {unavailableNote}
          </span>
        )}
        {!unavailableNote && option.value != null && (
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: "tabular-nums", fontSize: 9.5, color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {option.value || "(empty)"}
          </span>
        )}
      </span>
    </button>
  );
}
