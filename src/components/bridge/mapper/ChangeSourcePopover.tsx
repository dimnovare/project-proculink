"use client";

// ChangeSourcePopover — the "Change source" affordance for an INCOMING row (Fix 5). It opens
// from a source row's "⋯" control and lets the user re-derive a canonical field's value:
//   • RE-POINT      — feed a canonical field from THIS raw token (writes sourceMap via
//     onSourceConnect(tokenId, canonicalField)). The default selection is the canonical field
//     the token already feeds (if any), so re-opening shows the current wiring.
//   • FIXED VALUE   — pin a constant onto the canonical field's matching OUTPUT path instead
//     of a raw token (writes a fixed value via onSetFixedValue). For the canonical→output 1:1
//     default the output path === the canonical key, so a fixed value on that path overrides it.
//   • UNWIRE        — drop the token→canonical wire (back to the parsed-as-is default).
//
// It is a small popover anchored to the row, dismissed on outside-click / Escape. Pure UI over
// the model mutators already proven by mapperModel — no new persistence path.

import { useEffect, useMemo, useRef, useState } from "react";
import type { CanonicalNode, SourceField } from "./types";

export interface ChangeSourcePopoverProps {
  /** The token (incoming row) this popover acts on. */
  token: SourceField;
  /** The canonical spine the token can be pointed at. */
  canonicalNodes: CanonicalNode[];
  /** canonicalField → tokenId currently feeding it (to preselect + label). */
  sourceConnections: Record<string, string>;
  /** Wire this token to feed the chosen canonical field. */
  onConnect: (tokenId: string, canonicalField: string) => void;
  /** Drop the token→canonical wire. */
  onDisconnect: (canonicalField: string) => void;
  /** Pin a fixed literal onto the canonical field's output path. */
  onSetFixedValue: (outputPath: string, value: string | null, scope: "header" | "line") => void;
  onClose: () => void;
}

export function ChangeSourcePopover({
  token,
  canonicalNodes,
  sourceConnections,
  onConnect,
  onDisconnect,
  onSetFixedValue,
  onClose,
}: ChangeSourcePopoverProps) {
  // The canonical field this token currently feeds (if any) seeds the selection.
  const currentField = useMemo(
    () => Object.keys(sourceConnections).find((k) => sourceConnections[k] === token.id) ?? "",
    [sourceConnections, token.id],
  );
  const [field, setField] = useState<string>(currentField || canonicalNodes[0]?.id || "");
  const [mode, setMode] = useState<"token" | "fixed">("token");
  const [fixed, setFixed] = useState("");

  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [onClose]);

  const scopeOf = (key: string): "header" | "line" =>
    canonicalNodes.find((n) => n.id === key)?.scope === "line" ? "line" : "header";

  function apply() {
    if (!field) return;
    if (mode === "fixed") {
      onSetFixedValue(field, fixed || null, scopeOf(field));
    } else {
      onConnect(token.id, field);
    }
    onClose();
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Change source for ${token.label}`}
      style={{
        position: "absolute", right: 0, top: "100%", marginTop: 6, zIndex: 40, width: 264,
        background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 10,
        boxShadow: "0 10px 28px rgba(11,26,47,0.18)", padding: 12,
        display: "flex", flexDirection: "column", gap: 9,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "#5E3DB0" }}>
        Change source
      </div>
      <div style={{ fontSize: 11, color: "var(--ink-faint)", lineHeight: 1.4 }}>
        Re-derive a canonical field from <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#0B1A2F" }}>{token.label}</span>{" "}
        <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#56627A" }}>({token.value || "empty"})</span>.
      </div>

      <label style={{ fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--ink-faint)" }}>
        Canonical field
        <select
          value={field}
          onChange={(e) => setField(e.target.value)}
          aria-label="Canonical field to feed"
          style={{ width: "100%", marginTop: 3, boxSizing: "border-box", padding: "5px 7px", borderRadius: 6, border: "1px solid #DCE0E8", fontSize: 11.5, color: "#0B1A2F", background: "#FFFFFF" }}
        >
          {canonicalNodes.map((n) => (
            <option key={n.id} value={n.id}>{n.label}{sourceConnections[n.id] && sourceConnections[n.id] !== token.id ? " (currently re-pointed)" : ""}</option>
          ))}
        </select>
      </label>

      {/* token vs fixed toggle */}
      <div role="group" aria-label="Source kind" style={{ display: "flex", gap: 5 }}>
        {([["token", "From this value"], ["fixed", "Fixed value"]] as const).map(([id, label]) => {
          const active = mode === id;
          return (
            <button
              key={id}
              type="button"
              aria-pressed={active}
              onClick={() => setMode(id)}
              style={{
                flex: 1, padding: "5px 8px", borderRadius: 6, cursor: "pointer", fontSize: 10.5, fontWeight: 700,
                border: `1px solid ${active ? "#6F4FCE" : "#DCE0E8"}`,
                background: active ? "#EEE7FB" : "#FFFFFF",
                color: active ? "#5E3DB0" : "var(--ink-faint)",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {mode === "fixed" && (
        <input
          type="text"
          value={fixed}
          autoFocus
          onChange={(e) => setFixed(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") apply(); }}
          placeholder="Fixed value for this field"
          aria-label="Fixed value"
          style={{ boxSizing: "border-box", padding: "6px 8px", borderRadius: 6, border: "1px solid #DCE0E8", fontSize: 11.5, color: "#0B1A2F" }}
        />
      )}

      <div style={{ display: "flex", gap: 6, justifyContent: "space-between", alignItems: "center" }}>
        {currentField ? (
          <button
            type="button"
            onClick={() => { onDisconnect(currentField); onClose(); }}
            style={{ border: "none", background: "none", color: "#C0392B", fontSize: 10.5, fontWeight: 700, cursor: "pointer", padding: 0 }}
          >
            Unwire
          </button>
        ) : <span />}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={onClose}
            style={{ border: "1px solid #DCE0E8", background: "#FFFFFF", color: "var(--ink-faint)", borderRadius: 6, padding: "5px 10px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={!field || (mode === "fixed" && !fixed)}
            style={{
              border: "1px solid #6F4FCE",
              background: !field || (mode === "fixed" && !fixed) ? "#C4ABE8" : "#6F4FCE",
              color: "#FFFFFF", borderRadius: 6, padding: "5px 12px", fontSize: 10.5, fontWeight: 700,
              cursor: !field || (mode === "fixed" && !fixed) ? "default" : "pointer",
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}
