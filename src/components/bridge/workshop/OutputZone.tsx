"use client";

// OutputZone — the RIGHT zone of the Order Workshop (spec §"Locked decisions"
// #5). Wraps the EXISTING OutputPreview (preview == delivery) + a format switch
// + "+ Edit output structure" (opens the existing OutputStructureDesigner) + the
// green Send button (gated by `canSend`). Collapse rail.
//
// Everything load-bearing is COMPOSED, not reimplemented:
//   • OutputPreview renders the exact supplier-ready bytes (same transform path
//     used for delivery — the parity invariant).
//   • OutputStructureDesigner is the visual node-tree editor (reshape/add/paste
//     a supplier sample → infer).
// Props-in/callbacks-out: Send is gated by `canSend` (the orchestrator computes
// it from issues.length===0 && invariants pass); format changes call back.

import { useState } from "react";
import { Button } from "../DSPrimitives";
import { OutputPreview } from "../review/OutputPreview";
import { OutputStructureDesigner } from "../OutputStructureDesigner";
import type { Order } from "@/types/procurement";
import type { OrderMappingOverride, OutputFormat } from "@/lib/api/types";

/** The formats the workshop can switch the preview to (the generic-emitter set). */
export interface OutputFormatOption {
  id: OutputFormat;
  label: string;
}

export interface OutputZoneProps {
  order: Order;
  orderId: string;
  /** True once the order has been sent/delivered. */
  crossed: boolean;
  /** Inline header-field edits applied to the preview (same map OutputPreview reads). */
  fieldValues: Record<string, string>;
  /** Flow-notice setter for preview actions (copy/download). */
  onOutputAction: (message: string) => void;
  artifacts: Order["artifacts"];
  /** Supplier's REAL configured protocol. undefined=unknown · null=none · string=id. */
  deliveryProtocol?: string | null;

  /** Format switch — current + options + change callback (re-renders the preview). */
  format?: OutputFormat;
  formatOptions?: OutputFormatOption[];
  onFormatChange?: (format: OutputFormat) => void;

  /** Base override the OutputStructureDesigner edits. */
  baseOverride?: OrderMappingOverride | null;
  /** Called when the structure designer saves (orchestrator invalidates queries). */
  onStructureSaved?: () => void;

  /** Send gating — the orchestrator computes (issues.length===0 && invariants pass). */
  canSend: boolean;
  onSend?: () => void;
  sendLabel?: string;
  sending?: boolean;

  /** Collapse rail. */
  collapsed?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
  readOnly?: boolean;
}

export function OutputZone({
  order,
  orderId,
  crossed,
  fieldValues,
  onOutputAction,
  artifacts,
  deliveryProtocol,
  format,
  formatOptions,
  onFormatChange,
  baseOverride,
  onStructureSaved,
  canSend,
  onSend,
  sendLabel,
  sending,
  collapsed,
  onExpand,
  onCollapse,
  readOnly,
}: OutputZoneProps) {
  const [designerOpen, setDesignerOpen] = useState(false);

  // ── Collapsed rail ──
  if (collapsed) {
    return (
      <button
        type="button"
        data-testid="output-zone-rail"
        onClick={onExpand}
        aria-label="Expand output"
        style={{
          height: "100%",
          minHeight: 200,
          width: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: "10px 0",
          borderRadius: 10,
          border: "1px solid #E2E6EE",
          borderRight: "3px solid #2E8E3A",
          background: "#FFFFFF",
          cursor: "pointer",
        }}
      >
        <span aria-hidden style={{ fontSize: 11, color: "#2E8E3A" }}>‹</span>
        <span
          style={{
            writingMode: "vertical-rl",
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#1E6D29",
          }}
        >
          Output
        </span>
      </button>
    );
  }

  return (
    <div
      data-testid="output-zone"
      style={{ display: "flex", flexDirection: "column", gap: 12, borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", borderRight: "3px solid #2E8E3A", overflow: "hidden" }}
    >
      {/* ── Toolbar: title · format switch · edit structure · collapse ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid #EEF0F4", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#0B1A2F" }}>
          Output
        </span>

        {formatOptions && formatOptions.length > 0 && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "#56627A" }}>
            <span>Format</span>
            <select
              aria-label="Output format"
              value={format ?? formatOptions[0].id}
              disabled={readOnly || !onFormatChange}
              onChange={(e) => onFormatChange?.(e.target.value as OutputFormat)}
              style={{ height: 28, borderRadius: 6, border: "1px solid #DCE0E8", background: "#FFFFFF", color: "#0B1A2F", fontSize: 11.5, padding: "0 6px" }}
            >
              {formatOptions.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          data-testid="edit-structure"
          onClick={() => setDesignerOpen(true)}
          disabled={readOnly}
          title="Design the exact output structure (nesting, lists, attributes) — paste a supplier sample to start"
          style={{
            height: 28,
            padding: "0 10px",
            borderRadius: 6,
            fontSize: 11,
            fontWeight: 700,
            border: "1px solid #DCE0E8",
            background: readOnly ? "#F6F7FA" : "#FFFFFF",
            color: readOnly ? "#AEB6C4" : "#345470",
            cursor: readOnly ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
          }}
        >
          + Edit output structure
        </button>

        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Collapse output"
            title="Collapse this zone"
            style={{ marginLeft: "auto", width: 24, height: 24, borderRadius: 6, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A", fontSize: 12, cursor: "pointer" }}
          >
            ›
          </button>
        )}
      </div>

      {/* ── The preview == delivery panel (composed, unchanged) ── */}
      <div style={{ padding: "0 12px" }}>
        <OutputPreview
          order={order}
          orderId={orderId}
          crossed={crossed}
          fieldValues={fieldValues}
          onOutputAction={onOutputAction}
          artifacts={artifacts}
          deliveryProtocol={deliveryProtocol}
        />
      </div>

      {/* ── Green Send — gated by canSend (issues===0 && invariants pass) ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderTop: "1px solid #EEF0F4", background: "#F6F7FA" }}>
        {!canSend && !crossed && (
          <span style={{ fontSize: 11, color: "#C97A14", fontWeight: 600 }}>
            Resolve the issues to send.
          </span>
        )}
        <div style={{ marginLeft: "auto" }}>
          <Button
            variant="primary"
            size="md"
            disabled={!canSend || readOnly || sending}
            loading={sending}
            onClick={onSend}
          >
            {sendLabel ?? "Send to supplier"}
          </Button>
        </div>
      </div>

      {/* ── Output structure designer (overlay, composed) ── */}
      {designerOpen && (
        <OutputStructureDesigner
          orderId={orderId}
          baseOverride={baseOverride ?? null}
          initialTree={baseOverride?.outputTree ?? null}
          onClose={() => setDesignerOpen(false)}
          onSaved={() => {
            setDesignerOpen(false);
            onStructureSaved?.();
          }}
        />
      )}
    </div>
  );
}
