"use client";

// TransformPopover — the manipulator-chain editor opened from an OUTPUT row's "ƒx" control
// (founder bug 7: the in-flow absolute popover overlapped/clipped adjacent rows — the OutgoingPane
// column has overflow:hidden and dense, gap:6 rows, so a 300px panel anchored top:100% was both
// clipped by the column and drawn OVER the next rows). It now renders via createPortal to
// document.body with position:fixed, measured from the trigger button's viewport rect and FLIPPED
// above the trigger when it would overflow the viewport bottom. So it always floats cleanly above
// everything, never clipped, never overlapping a sibling row.
//
// It reuses the EXACT manipulator semantics shipped in OutputMappingEditor / FieldBadges: the
// canonical MANIPULATOR_TYPES list, per-type param inputs, add via a dropdown, remove via the pill
// ✕. The chain is the field's `fieldManipulators` — the transforms applied to the resolved value
// before the delivered document is rendered (Trim, Replace, DateFormat, Multiply, …). Edits flow
// straight to model.onFieldManipulatorsChange → buildOverrideDraft, so the same persistence path +
// data-loss guard as everywhere else; the live preview re-renders.
//
// Dismissed on outside-click / Escape. A "live" editor — every change persists immediately (no Save
// button) so the docked preview updates as you tune the chain. ManipRow is MODULE scope (stable
// identity → param inputs keep focus, the documented remount-on-keystroke bug).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ManipulatorEntry } from "@/lib/api/types";
import { MANIPULATOR_TYPES } from "@/lib/api/types";

export interface TransformPopoverProps {
  outputPath: string;
  /** The field's current transform chain. */
  manipulators: ManipulatorEntry[];
  /** Replace the chain (persists via the model). */
  onChange: (next: ManipulatorEntry[]) => void;
  onClose: () => void;
  /**
   * The trigger element the popover anchors to (the row's ƒx button). When supplied the popover
   * renders in a body portal at fixed coordinates derived from this rect — clip-proof. When absent
   * (legacy/test) it falls back to an in-flow absolute panel so existing callers don't break.
   */
  anchorEl?: HTMLElement | null;
}

const POPOVER_W = 300;

// ── Module-scope row so its <input>s keep focus across re-renders ───────────────
function ManipRow({ entry, onUpdate, onRemove }: {
  entry: ManipulatorEntry; onUpdate: (e: ManipulatorEntry) => void; onRemove: () => void;
}) {
  const spec = MANIPULATOR_TYPES.find((t) => t.type === entry.type);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", background: "#FBF9FE", border: "1px solid #E2D6F6", borderRadius: 7, padding: "6px 7px" }}>
      <span title={spec?.hint} style={{ fontSize: 11, fontWeight: 800, color: "#5E3DB0", minWidth: 64 }}>{entry.type}</span>
      {(spec?.params ?? []).length === 0 && (
        <span style={{ fontSize: 10, color: "var(--ink-faint)" }}>no parameters</span>
      )}
      {(spec?.params ?? []).map((p, i) => (
        <input
          key={i}
          value={entry.params[i] ?? ""}
          onChange={(e) => { const params = [...entry.params]; params[i] = e.target.value; onUpdate({ ...entry, params }); }}
          placeholder={p}
          aria-label={`${entry.type} ${p}`}
          style={{ width: 70, minHeight: 24, border: "1px solid #C4ABE8", borderRadius: 5, padding: "2px 5px", fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace" }}
        />
      ))}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${entry.type}`}
        style={{ marginLeft: "auto", border: "none", background: "transparent", color: "#8E7CB8", cursor: "pointer", fontSize: 13, lineHeight: 1 }}
      >
        ✕
      </button>
    </div>
  );
}

export function TransformPopover({ outputPath, manipulators, onChange, onClose, anchorEl }: TransformPopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  // Fixed-position coordinates measured from the trigger rect (portal mode). Null until measured.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Measure the trigger and place the panel: right-aligned to the trigger, flipped above it when it
  // would overflow the viewport bottom. Re-measured on scroll/resize so it tracks the trigger.
  useLayoutEffect(() => {
    if (!anchorEl) return;
    function place() {
      const r = anchorEl!.getBoundingClientRect();
      const margin = 8;
      const estHeight = ref.current?.offsetHeight ?? 280;
      // Right edge of the panel aligns with the trigger's right edge; clamp to the viewport.
      let left = r.right - POPOVER_W;
      left = Math.max(margin, Math.min(left, window.innerWidth - POPOVER_W - margin));
      // Default below the trigger; flip above when there isn't room below.
      const below = r.bottom + 6;
      const wouldOverflow = below + estHeight > window.innerHeight - margin;
      const top = wouldOverflow ? Math.max(margin, r.top - estHeight - 6) : below;
      setPos({ top, left });
    }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [anchorEl, manipulators.length]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && ref.current.contains(e.target as Node)) return;
      if (anchorEl && anchorEl.contains(e.target as Node)) return; // a click on the trigger toggles via the host
      onClose();
    }
    function onKey(e: KeyboardEvent) { if (e.key === "Escape") onClose(); }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [onClose, anchorEl]);

  // Portal mode is fixed-position (clip-proof); legacy mode keeps the in-flow absolute anchor so
  // callers that don't pass anchorEl (and the unit tests) keep working unchanged.
  const portaled = anchorEl != null;
  const panelStyle: React.CSSProperties = portaled
    ? {
        position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999, zIndex: 1000, width: POPOVER_W,
        background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 10,
        boxShadow: "0 10px 28px rgba(11,26,47,0.18)", padding: 12,
        display: "flex", flexDirection: "column", gap: 8,
        // Hidden until measured so it never flashes at the wrong place.
        visibility: pos ? "visible" : "hidden",
      }
    : {
        position: "absolute", left: 0, top: "100%", marginTop: 6, zIndex: 40, width: POPOVER_W,
        background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 10,
        boxShadow: "0 10px 28px rgba(11,26,47,0.18)", padding: 12,
        display: "flex", flexDirection: "column", gap: 8,
      };

  const panel = (
    <div
      ref={ref}
      role="dialog"
      aria-label={`Transforms for ${outputPath}`}
      style={panelStyle}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "#5E3DB0" }}>
          Transforms
        </span>
        <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "var(--ink-faint)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 150 }}>
          {outputPath}
        </span>
      </div>
      <div style={{ fontSize: 10.5, color: "var(--ink-faint)", lineHeight: 1.4 }}>
        Applied in order to the resolved value before delivery. Changes save + preview live.
      </div>

      {manipulators.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--ink-faint)", padding: "4px 0" }}>No transforms yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {manipulators.map((m, mi) => (
            <ManipRow
              key={mi}
              entry={m}
              onUpdate={(next) => onChange(manipulators.map((x, i) => (i === mi ? next : x)))}
              onRemove={() => onChange(manipulators.filter((_, i) => i !== mi))}
            />
          ))}
        </div>
      )}

      <select
        value=""
        aria-label="Add a transform"
        onChange={(e) => {
          const t = MANIPULATOR_TYPES.find((x) => x.type === e.target.value);
          if (!t) return;
          onChange([...manipulators, { type: t.type, params: t.params.map(() => "") }]);
        }}
        style={{ minHeight: 30, border: "1px dashed #C6CDDA", borderRadius: 7, padding: "3px 7px", fontSize: 11.5, color: "#56627A", background: "#F6F7FA" }}
      >
        <option value="">+ Add transform…</option>
        {MANIPULATOR_TYPES.map((t) => (
          <option key={t.type} value={t.type} title={t.hint}>{t.type} — {t.hint}</option>
        ))}
      </select>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={onClose}
          style={{ border: "1px solid #DCE0E8", background: "#FFFFFF", color: "var(--ink-faint)", borderRadius: 6, padding: "5px 12px", fontSize: 10.5, fontWeight: 700, cursor: "pointer" }}
        >
          Done
        </button>
      </div>
    </div>
  );

  if (portaled && typeof document !== "undefined") {
    return createPortal(panel, document.body);
  }
  return panel;
}
