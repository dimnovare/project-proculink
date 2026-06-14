"use client";

// CanonicalLane — the CENTER spine of the unified three-pane mapper.
//
// Renders the canonical spine: the fixed system fields (PoNumber … UnitPrice) PLUS any
// Tier-2 user-defined CanonicalFieldDefs, on the same blue→green gradient spine + node-dot
// language as SpineReview's SpineNodeCard (no new vocabulary). Adds:
//   • an inline "+ Add field" form (name / type / optional standards ref) → addCanonicalField.
//   • a "⋯" overflow on every CUSTOM node with "Remove" → removeCanonicalField (soft-delete).
//     System nodes have no remove (built-in spine is immutable).
//   • a per-node "i" standards popover (StandardsFieldPopover) surfaced on demand.
//
// The CRUD calls hit the Phase-2 `CanonicalFieldDef` endpoints via the typed client, which
// degrades gracefully (mock store / 404 → optimistic no-op) so the lane is fully usable
// before Phase-2 lands. Mutations run through react-query + invalidate the field list.
//
// Each node registers its circle-dot element via `dotRef(id, el)` so the wire engine
// (Task 6) can snap canonical→target / source→canonical wires to the dot centre. The lane
// itself draws no SVG — the engine owns wires. Presentational + self-contained CRUD.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import {
  getCanonicalFields,
  addCanonicalField,
  removeCanonicalField,
} from "@/lib/api/canonical-fields";
import type { CanonicalFieldDef, CanonicalFieldScope } from "@/lib/api/types";
import { StandardsFieldPopover } from "../StandardsFieldPopover";
import type { CanonicalNode } from "./types";
import {
  systemCanonicalNodes,
  mergeCanonicalNodes,
  validateNewFieldName,
} from "./canonicalFieldsModel";

interface CanonicalLaneProps {
  /** orderId (inbox) or connectionId (connection editor) — the CRUD scope. */
  scopeId: string;
  /**
   * Optional pre-loaded custom defs (the shell may inject them). When omitted the lane
   * fetches its own via react-query. Either way the system spine is always merged in.
   */
  customFields?: CanonicalFieldDef[];
  /** Canonical field key → its currently-wired source-token id (drives the "wired" dot). */
  sourceConnections?: Partial<Record<string, string>>;
  /** Register a node's circle-dot element for the wire engine to snap to. */
  dotRef?: (id: string, el: HTMLDivElement | null) => void;
  /** Hover a node (transient wire emphasis only). */
  onHover?: (id: string | null) => void;
  /** Explicitly SELECT a node (click) — the host reflects this into the ?field= URL. */
  onSelect?: (id: string) => void;
  hoveredId?: string | null;
  /** Read-only (published connection revision) — hides add/remove affordances. */
  readOnly?: boolean;
  /**
   * Whether Tier-2 custom canonical fields can be authored from this lane. ONLY connection
   * mode (variant="connection") may — custom canonical fields are authored at the CONNECTION
   * and target `/api/connections/{connectionId}/canonical-fields`. In ORDER mode the scopeId
   * is an orderId, which is NOT a valid connection-scoped route, so the add/remove affordances
   * are hidden AND the self-fetch is suppressed (per-order custom fields are a different
   * concept — OrderMappingOverride.CustomFields — authored elsewhere). Defaults to false so a
   * caller that forgets to set it can never accidentally route an orderId into the connection
   * canonical-fields endpoint.
   */
  allowCustomFields?: boolean;
  /**
   * Bumped by the command palette "Add a custom field" command — opens + focuses the inline
   * "+ Add field" form. A counter so each invocation re-triggers. Ignored unless
   * allowCustomFields is true.
   */
  openAddFieldSignal?: number;
}

const SCOPES: { id: CanonicalFieldScope; label: string }[] = [
  { id: "header", label: "Header" },
  { id: "line", label: "Line" },
];
const TYPES: CanonicalFieldDef["type"][] = ["string", "number", "date", "bool"];

export function CanonicalLane({
  scopeId,
  customFields,
  sourceConnections,
  dotRef,
  onHover,
  onSelect,
  hoveredId,
  readOnly,
  allowCustomFields = false,
  openAddFieldSignal,
}: CanonicalLaneProps) {
  const qc = useQueryClient();
  const queriesEnabled = useQueriesEnabled();

  // Fetch custom defs only when the shell didn't inject them AND this lane is allowed to use
  // custom canonical fields (connection mode). In order mode the scopeId is an orderId, which
  // is NOT a connection-scoped route, so we must never self-fetch from it — gate the query.
  const selfFetch = customFields === undefined && allowCustomFields;
  const fieldsQuery = useQuery({
    queryKey: ["canonical-fields", scopeId],
    queryFn: () => getCanonicalFields(scopeId),
    enabled: selfFetch && queriesEnabled,
  });
  const custom = useMemo(
    () => customFields ?? fieldsQuery.data ?? [],
    [customFields, fieldsQuery.data],
  );

  const system = useMemo(() => systemCanonicalNodes(), []);
  const nodes = useMemo(() => mergeCanonicalNodes(system, custom), [system, custom]);

  const addMut = useMutation({
    mutationFn: (def: Omit<CanonicalFieldDef, "system">) => addCanonicalField(scopeId, def),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canonical-fields", scopeId] }),
  });
  const removeMut = useMutation({
    mutationFn: (key: string) => removeCanonicalField(scopeId, key),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["canonical-fields", scopeId] }),
  });

  const existingKeys = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  return (
    <div style={{ position: "relative", paddingLeft: 4 }}>
      {/* Spine line — same blue→green gradient as SpineReview's center column. */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: 8,
          bottom: readOnly ? 0 : 54,
          left: 22,
          width: 3,
          background: "linear-gradient(180deg,#1E66C9,#2E8E3A)",
          borderRadius: 2,
        }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {nodes.map((node) => (
          <CanonicalNodeCard
            key={node.id}
            node={node}
            wired={Boolean(sourceConnections?.[node.id])}
            hovered={hoveredId === node.id}
            dotRef={dotRef}
            onHover={onHover}
            onSelect={onSelect}
            onRemove={
              allowCustomFields && !readOnly && !node.system
                ? () => removeMut.mutate(node.id)
                : undefined
            }
            removing={removeMut.isPending && removeMut.variables === node.id}
          />
        ))}
      </div>

      {allowCustomFields && !readOnly && (
        <AddFieldForm
          existingKeys={existingKeys}
          busy={addMut.isPending}
          error={addMut.isError ? "Couldn’t add the field. Try again." : null}
          onAdd={(def) => addMut.mutate(def)}
          openSignal={openAddFieldSignal}
        />
      )}
    </div>
  );
}

// ── A single spine node card ─────────────────────────────────────────────────
function CanonicalNodeCard({
  node,
  wired,
  hovered,
  dotRef,
  onHover,
  onSelect,
  onRemove,
  removing,
}: {
  node: CanonicalNode;
  wired: boolean;
  hovered: boolean;
  dotRef?: (id: string, el: HTMLDivElement | null) => void;
  onHover?: (id: string | null) => void;
  onSelect?: (id: string) => void;
  onRemove?: () => void;
  removing?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  // Lineage accent: blue for header scope, green for line scope (mirrors SpineNodeCard).
  const accent = node.scope === "line" ? "#2E8E3A" : "#1E66C9";

  return (
    <div
      className="relative mb-1.5 pl-9"
      onMouseEnter={() => onHover?.(node.id)}
      onMouseLeave={() => onHover?.(null)}
      onClick={() => onSelect?.(node.id)}
    >
      {/* Node dot — the wire snap target. */}
      <div
        ref={(el) => dotRef?.(node.id, el)}
        className="absolute rounded-full bg-white z-10"
        style={{
          left: 17,
          top: 13,
          width: 13,
          height: 13,
          border: `2.5px solid ${wired ? "#6F4FCE" : accent}`,
          boxShadow: hovered ? "0 0 0 3px rgba(111,79,206,0.16)" : undefined,
          transition: "box-shadow 120ms, border-color 120ms",
        }}
      />

      <div
        className="rounded-[6px] px-2.5 py-1.5"
        style={{
          background: hovered ? "rgba(111,79,206,0.05)" : "#FFFFFF",
          border: `1px solid ${hovered ? "#C4ABE8" : "#E2E6EE"}`,
          borderLeft: `3px solid ${wired ? "#6F4FCE" : accent}`,
          transition: "background 120ms, border-color 120ms",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--ink-faint)",
              flex: 1,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              minWidth: 0,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {node.label}
            </span>
            {/* System fields surface the full multi-standard popover; custom fields show
                their single optional standardsRef inline (no catalog entry to expand). */}
            {node.system ? (
              <StandardsFieldPopover canonicalField={node.id} label={node.label} />
            ) : node.standardsRef ? (
              <span
                title={`Standards reference: ${node.standardsRef}`}
                style={{
                  fontFamily: "'JetBrains Mono',monospace",
                  fontSize: 9,
                  fontWeight: 600,
                  color: "#5E3DB0",
                  background: "#F4EFFC",
                  border: "1px solid #E2D6F6",
                  borderRadius: 4,
                  padding: "0 4px",
                  whiteSpace: "nowrap",
                }}
              >
                {node.standardsRef}
              </span>
            ) : null}
          </span>

          {!node.system && (
            <span
              style={{
                fontSize: 8.5,
                fontWeight: 800,
                letterSpacing: "0.04em",
                color: "#5E3DB0",
                background: "#F4EFFC",
                border: "1px solid #E2D6F6",
                borderRadius: 999,
                padding: "1px 6px",
                flexShrink: 0,
              }}
            >
              CUSTOM
            </span>
          )}

          {wired && (
            <span aria-hidden style={{ fontSize: 9, fontWeight: 700, color: "#5E3DB0", flexShrink: 0 }}>
              wired →
            </span>
          )}

          {onRemove && (
            <div style={{ position: "relative", flexShrink: 0 }}>
              <button
                type="button"
                aria-label={`Field options for ${node.label}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                disabled={removing}
                onClick={() => setMenuOpen((o) => !o)}
                onBlur={() => setTimeout(() => setMenuOpen(false), 120)}
                style={{
                  border: "none",
                  background: "none",
                  cursor: removing ? "default" : "pointer",
                  color: "var(--ink-faint)",
                  fontSize: 13,
                  lineHeight: 1,
                  padding: "2px 4px",
                  borderRadius: 4,
                }}
              >
                {removing ? "…" : "⋯"}
              </button>
              {menuOpen && (
                <div
                  role="menu"
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: 2,
                    zIndex: 20,
                    minWidth: 120,
                    background: "#FFFFFF",
                    border: "1px solid #E2E6EE",
                    borderRadius: 6,
                    boxShadow: "0 4px 14px rgba(11,26,47,0.12)",
                    padding: 4,
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setMenuOpen(false);
                      onRemove();
                    }}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      border: "none",
                      background: "none",
                      cursor: "pointer",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--danger,#C0392B)",
                      padding: "5px 8px",
                      borderRadius: 4,
                    }}
                  >
                    Remove field
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline "+ Add field" ─────────────────────────────────────────────────────
function AddFieldForm({
  existingKeys,
  busy,
  error,
  onAdd,
  openSignal,
}: {
  existingKeys: Set<string>;
  busy?: boolean;
  error?: string | null;
  onAdd: (def: Omit<CanonicalFieldDef, "system">) => void;
  openSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<CanonicalFieldScope>("header");
  const [type, setType] = useState<CanonicalFieldDef["type"]>("string");
  const [standardsRef, setStandardsRef] = useState("");

  // Command-palette "Add a custom field" → open the form (its name input autoFocuses).
  useEffect(() => {
    if (!openSignal) return;
    setOpen(true);
  }, [openSignal]);

  const validation = useMemo(
    () => validateNewFieldName(name, existingKeys),
    [name, existingKeys],
  );
  const showError = name.trim().length > 0 && !validation.ok;

  function reset() {
    setName("");
    setScope("header");
    setType("string");
    setStandardsRef("");
  }

  function submit() {
    if (!validation.ok) return;
    onAdd({
      key: validation.key,
      label: name.trim(),
      scope,
      type,
      standardsRef: standardsRef.trim() || null,
    });
    reset();
    setOpen(false);
  }

  if (!open) {
    return (
      <div className="pl-9" style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            border: "1px dashed #C4ABE8",
            background: "#FBF9FE",
            color: "#5E3DB0",
            borderRadius: 7,
            padding: "5px 10px",
            fontSize: 11,
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          <span aria-hidden style={{ fontSize: 13, lineHeight: 1 }}>+</span>
          Add field
        </button>
      </div>
    );
  }

  const fieldStyle: React.CSSProperties = {
    boxSizing: "border-box",
    padding: "5px 7px",
    borderRadius: 6,
    border: "1px solid #DCE0E8",
    fontSize: 11,
    color: "#0B1A2F",
    background: "#FFFFFF",
  };

  return (
    <div
      className="pl-9"
      style={{ marginTop: 8 }}
    >
      <div
        style={{
          border: "1px solid #E2D6F6",
          background: "#FBF9FE",
          borderRadius: 8,
          padding: 10,
          display: "flex",
          flexDirection: "column",
          gap: 7,
        }}
      >
        <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "#5E3DB0" }}>
          New custom canonical field
        </div>

        <input
          type="text"
          value={name}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            if (e.key === "Escape") { reset(); setOpen(false); }
          }}
          placeholder="Field name (e.g. Cost centre)"
          aria-label="Custom field name"
          aria-invalid={showError}
          style={{ ...fieldStyle, width: "100%" }}
        />

        <div style={{ display: "flex", gap: 6 }}>
          <label style={{ flex: 1, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)" }}>
            Scope
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as CanonicalFieldScope)}
              aria-label="Field scope"
              style={{ ...fieldStyle, width: "100%", marginTop: 2 }}
            >
              {SCOPES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </label>
          <label style={{ flex: 1, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)" }}>
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value as CanonicalFieldDef["type"])}
              aria-label="Field type"
              style={{ ...fieldStyle, width: "100%", marginTop: 2 }}
            >
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
        </div>

        <input
          type="text"
          value={standardsRef}
          onChange={(e) => setStandardsRef(e.target.value)}
          placeholder="Standards ref (optional, e.g. UBL cbc:CompanyID)"
          aria-label="Standards reference (optional)"
          style={{ ...fieldStyle, width: "100%" }}
        />

        {(showError || error) && (
          <div style={{ fontSize: 10, color: "var(--danger,#C0392B)" }}>
            {error ?? validation.error}
          </div>
        )}

        <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={() => { reset(); setOpen(false); }}
            style={{
              border: "1px solid #DCE0E8",
              background: "#FFFFFF",
              color: "var(--ink-faint)",
              borderRadius: 6,
              padding: "5px 10px",
              fontSize: 11,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!validation.ok || busy}
            style={{
              border: "1px solid #6F4FCE",
              background: !validation.ok || busy ? "#C4ABE8" : "#6F4FCE",
              color: "#FFFFFF",
              borderRadius: 6,
              padding: "5px 12px",
              fontSize: 11,
              fontWeight: 700,
              cursor: !validation.ok || busy ? "default" : "pointer",
            }}
          >
            {busy ? "Adding…" : "Add field"}
          </button>
        </div>
      </div>
    </div>
  );
}
