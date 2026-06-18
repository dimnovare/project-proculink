"use client";

// Canonical Spine Review — fully interactive ETL review screen.
// AC2: AI accept/reject, inline field editing, confirm dialog, keyboard nav.

import type React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, getSupplierCatalog, getMappingOverride, upsertMappingOverride, getSourceTokens, promoteMapping, type ConformanceFormat } from "@/lib/api-client";
import { getDeliveryConfig } from "@/lib/api/delivery";
import { setSidebarAutoCollapse } from "@/lib/sidebar-auto-collapse";
import type { Order } from "@/types/procurement";
import type { DeliveryConfig, OrderMappingOverride, SourceToken } from "@/lib/api/types";
import { EdgeRails } from "./EdgeRails";
import { FileChip } from "./FileChip";
import { FailedPanel, ParseFailedPanel } from "./FailedPanels";
import { StatusJourney, type OrderStage } from "./StatusJourney";
import { SpineReviewSkeleton } from "./Skeletons";
import { StandardsFieldPopover } from "./StandardsFieldPopover";
// Phase 3 — the unified three-pane mapper replaces the hand-wired xl triptych as the
// "Full document" review surface. variant="order"; it owns its own wiring/preview and
// persists through buildOverrideDraft (carries sourceMap). The tablet/mobile fallbacks
// below stay; the old SpineConnectors/WireDragLayer/SourceTokenPanel triptych is removed
// from this host (kept in-tree for now via the Task-2 back-compat wrappers).
import { MapperWorkbench } from "./mapper/MapperWorkbench";
import { OrderPassport } from "./OrderPassport";
import { SupplierResponsePanel } from "./SupplierResponsePanel";
import { ConformancePanel } from "./ConformancePanel";
import { UnifiedStatusBadge } from "./UnifiedStatusBadge";
import { useOrderDirection, type PartyLabels } from "@/hooks/useOrderDirection";
// Batch 9 Phase A — extracted review primitives + hooks (spec:
// docs/strategy/2026-06-11-SPINE-REDESIGN-SPEC.md). Pure moves of existing
// logic; both the classic triptych and the Triage sub-view consume these.
import { Kbd } from "./review/Kbd";
import { ManualCodeRow, type LineEditApi } from "./review/ManualCodeRow";
import { AiSuggestionContent } from "./review/AiSuggestionContent";
import { confidenceDisplay } from "./review/calibrationDisplay";
import { HeaderInlineEditField } from "./review/HeaderInlineEditField";
import { ConfirmDialog } from "./review/ConfirmDialog";
import { FixQueueTriage } from "./review/FixQueueTriage";
import { CatalogHintCard } from "./review/CatalogHintCard";
// Phase C extractions: OutputPreview (now also serves the Triage context
// stage's fragment mode), the shared display helpers and NODE_TO_FIELD.
// Pure moves — the classic render is unchanged.
import { OutputPreview } from "./review/OutputPreview";
import { formatMoney, resolvedGrandTotal, outputArtifactType } from "./review/orderDisplay";
import { NODE_TO_FIELD } from "./review/stageModel";
import { useOrderReview } from "./review/hooks/useOrderReview";
import { useResolveActions } from "./review/hooks/useResolveActions";
import { useAcceptanceValidation } from "./review/hooks/useAcceptanceValidation";
import { useSendFlow } from "./review/hooks/useSendFlow";
// Order Workshop V2 (flag-gated) — when on, the whole review screen is replaced by
// the unified OrderWorkshop (IssuesPanel + the enhanced MapperWorkbench). Flag off =
// the existing two-mode screen below, completely unchanged.
import { OrderWorkshop } from "./workshop/OrderWorkshop";
import { isOrderWorkshopEnabled } from "@/lib/flags";

// ─── Types ────────────────────────────────────────────────────────────────────

type SubNode = {
  id: string;
  sku: string;
  qty: number;
  ai?: boolean;
  pct?: number;
  err?: boolean;
  hint?: string;
  /** 1-based line number shown at the start of the row. */
  lineNo?: number;
  /** Human-readable line description. */
  desc?: string;
  /** Original buyer item code (always shown muted, even when mapped). */
  buyerCode?: string;
  /** AI-suggested supplier code (shown in the suggestion card). */
  aiSuggestedCode?: string;
  /** Short AI reason / provenance line. */
  aiReason?: string;
  // ── V9 confidence calibration (display-only; from the backend overlay) ──────
  /** True only when the backend calibrated this suggestion (drives the chip + `pct`). */
  aiCalibrated?: boolean;
  /** Raw model confidence 0–100, for the "raw → calibrated" detail in the card. */
  aiRawPct?: number;
  /** Backend's honest basis string, shown verbatim. */
  aiCalibrationBasis?: string | null;
  // ── Phase 4 enrichment (per line) — each shown only when non-null ──────────
  /** Currency for formatting the line amount. */
  currency?: string;
  /** Stated line amount as extracted from the source document. */
  lineAmount?: number | null;
  /** Per-line tax/VAT rate as a percentage. */
  taxRate?: number | null;
  /** Per-line delivery date, ISO "yyyy-MM-dd". */
  deliveryDate?: string | null;
};

interface SpineNodeData {
  id: string;
  label: string;
  value: string;
  /**
   * Confidence percentage. INTERNAL plumbing for SpineConnectors' wire
   * colouring/dash logic — only rendered as a ConfChip when `realConf` is true
   * (i.e. the number derives from real backend per-line confidences). Header
   * fields carry heuristic constants here purely so the wires keep their
   * established colours; those constants must never be SHOWN as confidence.
   */
  pct: number;
  /** True only when pct derives from real backend confidence values. */
  realConf?: boolean;
  mono?: boolean;
  big?: boolean;
  tone?: "buyer" | "supplier";
  srcRef: string;
  outRef: string;
  hint?: string;
  /** "warn" → amber ⚠ hint (default); "muted" → quiet grey provenance hint. */
  hintTone?: "warn" | "muted";
  editable?: boolean;
  subnodes?: SubNode[];
}

// ─── Money helpers — moved to ./review/orderDisplay (Phase C) ────────────────

// ─── Map live order → SpineNodeData ──────────────────────────────────────────

function buildNodesFromOrder(order: Order, labels: PartyLabels): SpineNodeData[] {
  const lineCount = order.lines.length;
  const formatted = formatMoney(order.currency, resolvedGrandTotal(order));

  // Phase 4 — supplier name as printed on the document, shown muted under the
  // resolved supplier when it was captured AND differs from the resolved name.
  const docSupplier = order.documentSupplierName?.trim();
  const supplierHint =
    docSupplier && docSupplier !== order.supplierName
      ? `As printed on document: ${docSupplier}`
      : undefined;

  // Avg line confidence (0-1 → 0-100)
  const lineConf = lineCount > 0
    ? Math.round(order.lines.reduce((s, l) => s + l.confidence, 0) / lineCount * 100)
    : 90;

  // Render EVERY line — never slice. A line beyond an arbitrary cap would be
  // invisible yet still trip the server `needsReview` send guard, leaving the
  // user stuck with no visible cause. Needs-review lines float to the top so the
  // work to do is always the first thing seen.
  const orderedLines = [...order.lines].sort((a, b) => {
    const aReview = a.needsReview ? 0 : 1;
    const bReview = b.needsReview ? 0 : 1;
    if (aReview !== bReview) return aReview - bReview;
    return a.lineNumber - b.lineNumber;
  });
  const subnodes: SpineNodeData["subnodes"] = orderedLines.map((l) => {
    const isAi = !!l.aiSuggestion && !l.supplierItemCode;
    // V9: for an AI line the DISPLAYED confidence is the EFFECTIVE one
    // (calibrated when the backend calibrated it, raw otherwise). The chip,
    // the wire colour and the bulk threshold all read the same number.
    const cd = isAi ? confidenceDisplay(l.aiSuggestion!) : null;
    return {
      id: l.id,
      sku: l.supplierItemCode ?? l.buyerItemCode,
      qty: l.quantity,
      ai: isAi,
      pct: cd ? Math.round(cd.effective * 100) : Math.round(l.confidence * 100),
      err: l.needsReview && !l.supplierItemCode && !l.aiSuggestion,
      lineNo: l.lineNumber,
      desc: l.description ?? l.buyerItemCode,
      buyerCode: l.buyerItemCode,
      aiSuggestedCode: l.aiSuggestion?.supplierItemCode,
      aiReason: l.aiSuggestion?.reason,
      aiCalibrated: cd?.calibrated ?? false,
      aiRawPct: cd ? Math.round(cd.raw * 100) : undefined,
      aiCalibrationBasis: cd?.basis ?? null,
      hint: l.needsReview && !l.supplierItemCode && !l.aiSuggestion ? "Needs a supplier code" : undefined,
      // Phase 4 enrichment — passed through only; rendered when non-null.
      currency: order.currency,
      lineAmount: l.lineAmount ?? null,
      taxRate: l.taxRate ?? null,
      deliveryDate: l.deliveryDate ?? null,
    };
  });

  return [
    // Header editing (Item 2): date / buyer / currency / PO number / supplier
    // name are editable — the backend /api/orders/{id}/resolve endpoint accepts
    // optional header corrections ({ orderDate, buyerName, currency, poNumber,
    // supplierName }) alongside line resolutions, persisted before transform/
    // deliver. poNumber corrects the document identity shown across the UI;
    // supplierName edits the PRINTED/display name only — it does NOT re-route
    // delivery or remap codes (the routed supplier is still chosen via the
    // supplier picker, not this inline edit).
    // NOTE on pct: header/totals values below are HEURISTIC CONSTANTS kept only
    // so SpineConnectors' wire colouring stays byte-identical. They are NOT real
    // confidences and are never rendered (realConf is unset → neutral "parsed"
    // chip). Only the lines node, whose pct averages real backend per-line
    // confidences, renders a percentage.
    { id: "po",       label: "PO number",   value: order.poNumber,            pct: 99, mono: true,  editable: true,  srcRef: "header-meta",  outRef: "Order/@orderID"    },
    { id: "date",     label: "Order date",  value: order.orderDate,            pct: 95, mono: true,  editable: true,  srcRef: "header-meta",  outRef: "Order/orderDate"   },
    { id: "buyer",    label: "Buyer",       value: order.buyerName ?? "(parsing…)", pct: order.buyerName ? 98 : 50, tone: "buyer",    editable: true,  srcRef: "parties", outRef: "BillTo/Contact"    },
    { id: "supplier", label: labels.counterpartyNoun, value: order.supplierName, pct: 97, tone: "supplier", editable: true,  srcRef: "parties", outRef: "ShipFrom/Contact", hint: supplierHint, hintTone: "muted" },
    { id: "currency", label: "Currency",    value: order.currency,             pct: 99, mono: true,  editable: true,  srcRef: "terms",   outRef: "Total/@currency"   },
    {
      id: "lines", label: "Line items", value: `${lineCount} line${lineCount !== 1 ? "s" : ""} · ${formatted}`,
      pct: lineConf, realConf: lineCount > 0, big: true, editable: false, srcRef: "lines", outRef: "ItemOut[]",
      subnodes,
    },
    { id: "totals", label: "Grand total", value: formatted, pct: 100, mono: true, big: true, editable: false, srcRef: "totals", outRef: "Total/@amount" },
  ];
}

// ─── Header helpers ──────────────────────────────────────────────────────────

/** Map backend OrderStatus → StatusJourney stage index. */
function orderStatusToStage(status: string): OrderStage {
  switch (status) {
    case "parsing":           return 0;
    case "pending_review":    return 2;
    case "ready":             return 2;
    case "transforming":      return 3;
    case "ready_to_deliver":  return 3;
    case "delivered":         return 4;
    case "failed":
    case "transform_failed":
    case "delivery_failed":
    case "delivery_dead_letter":
    case "rejected_by_supplier": return "failed";
    default:                  return 1;
  }
}

/** Extract a human-readable filename from a storage key (last path segment). */
function sourceFileLabel(fileKey: string | null | undefined): string {
  if (!fileKey) return "uploaded file";
  const parts = fileKey.split("/");
  return parts[parts.length - 1] ?? "uploaded file";
}

/** Derive FileChip format from source file key extension. */
function sourceFileType(fileKey: string | null | undefined): string {
  if (!fileKey) return "PDF";
  const ext = fileKey.split(".").pop()?.toLowerCase();
  if (ext === "xlsx") return "XLSX";
  if (ext === "csv")  return "CSV";
  return "PDF";
}

// outputArtifactLabel / outputArtifactType / PROTOCOL_LABEL / deliveryChannelLabel
// moved to ./review/orderDisplay (Phase C).

/** Map the supplier's configured output format onto a conformance profile id;
 *  undefined when no named profile exists for it (panel falls back to cXML). */
function conformanceDefaultFormat(outputFormat: string | null | undefined): ConformanceFormat | undefined {
  const f = outputFormat?.toLowerCase();
  return f === "cxml" || f === "ubl" || f === "x12" ? f : undefined;
}

// sleep + finalDeliveryMessage moved to ./review/hooks (useSendFlow/useOrderReview).

// ─── Node → canonical field mapping (used for StandardsFieldPopover) ─────────
// NODE_TO_FIELD moved to ./review/stageModel (Phase C) — shared with the
// Triage context stage so the standards join key can't drift.

// ─── ConfChip ────────────────────────────────────────────────────────────────

function ConfChip({ pct }: { pct: number }) {
  const { bg, color } =
    pct >= 90 ? { bg: "#E2F1E2", color: "#1E6D29" } :
    pct >= 75 ? { bg: "#FAEFD6", color: "#C97A14" } :
                { bg: "#FBE3E3", color: "#C53A3A" };
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", background: bg, color, borderRadius: 5, padding: "2px 7px" }}>
      {pct}%
    </span>
  );
}

/**
 * Neutral provenance chip for fields parsed from the document WITHOUT a real
 * model confidence. Replaces the fabricated header percentages (PO 99% / buyer
 * 98% / supplier 97% / total 100% …) that rendered in the same UI as real
 * per-line AI confidence. The internal pct stays for wire colouring only.
 */
function ParsedChip() {
  return (
    <span
      title="Parsed from the document — no model confidence is computed for this field."
      style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", background: "#EFF2F7", color: "#56627A", borderRadius: 5, padding: "2px 7px" }}
    >
      parsed
    </span>
  );
}

// ─── Header bits ──────────────────────────────────────────────────────────────
// Kbd moved to ./review/Kbd (shared with the Triage rail).

/** Paper-plane glyph used on the primary send action. */
function PaperPlaneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M14.5 1.5 7.3 8.7M14.5 1.5l-4.6 13-2.6-5.8L1.5 5.9l13-4.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Resolve the status KEY for the header badge next to the PO title. The badge
 * itself renders via UnifiedStatusBadge so the vocabulary matches the Inbox
 * exactly (kills the old "Ready" vs "Normalized" contradiction — this local
 * pill said "Ready" both for `ready` and `ready_to_deliver`). The crossed /
 * exceptionCount overrides are kept, but as status-key selection only.
 */
function headerBadgeStatus(status: string, crossed: boolean, exceptionCount: number): string {
  if (crossed) return "delivered";
  // Server truth (unresolved lines) outranks a stale ready/pending status value.
  if ((status === "ready" || status === "pending_review") && exceptionCount > 0) return "pending_review";
  return status;
}

/**
 * Phase 4 — amber pill shown when the document classifier detected an invoice
 * (these orders are force-held to pending_review). Reuses the "Needs review"
 * amber palette. Renders nothing for non-invoice documents.
 */
function InvoiceBadge({ documentType }: { documentType?: string | null }) {
  if (documentType !== "invoice") return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full"
      title="Detected as an invoice and held for review."
      style={{ fontSize: 12, fontWeight: 600, padding: "3px 11px", background: "#FAEFD6", color: "#C97A14", whiteSpace: "nowrap" }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#C97A14", flexShrink: 0 }} />
      Looks like an invoice
    </span>
  );
}

/**
 * Phase 4 — compact read-only totals block. Each row renders only when its
 * value is non-null, so a CSV order (all fields null) shows nothing. Grand
 * total prefers the backend-extracted value via resolvedGrandTotal().
 */
function TotalsSummary({ order }: { order: Order }) {
  const rows: Array<{ label: string; value: string }> = [];
  if (order.subTotal != null)   rows.push({ label: "Subtotal",      value: formatMoney(order.currency, order.subTotal) });
  if (order.taxTotal != null)   rows.push({ label: "Tax",           value: formatMoney(order.currency, order.taxTotal) });
  if (order.grandTotal != null) rows.push({ label: "Grand total",   value: formatMoney(order.currency, order.grandTotal) });
  if (order.paymentTerms && order.paymentTerms.trim().length > 0)
    rows.push({ label: "Payment terms", value: order.paymentTerms.trim() });

  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 12, borderRadius: 8, border: "1px solid #E2E6EE", background: "#FFFFFF", overflow: "hidden" }}>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #EEF0F4", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
        Order totals
      </div>
      <div style={{ padding: "4px 0" }}>
        {rows.map((r, i) => (
          <div
            key={r.label}
            style={{
              display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12,
              padding: "5px 12px",
              borderTop: i === 0 ? "none" : "1px solid #F5F6F9",
            }}
          >
            <span style={{ fontSize: 11, fontWeight: 600, color: "#56627A" }}>{r.label}</span>
            <span
              style={{
                fontFamily: r.label === "Payment terms" ? "inherit" : "'JetBrains Mono',monospace",
                fontSize: r.label === "Grand total" ? 14 : 12,
                fontWeight: r.label === "Grand total" ? 700 : 500,
                color: "#0B1A2F",
                textAlign: "right",
              }}
            >
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SpineNodeCard ────────────────────────────────────────────────────────────

// LineEditApi + ManualCodeRow moved to ./review/ManualCodeRow (shared with the
// Triage rail). Persistence still goes through the SAME /resolve path as Accept
// (commitMappings + refetch) so the server needsReview send-guard clears.

interface SpineNodeCardProps {
  node: SpineNodeData;
  idx: number;
  editingId: string | null;
  fieldValues: Record<string, string>;
  onStartEdit: (id: string) => void;
  onChangeValue: (id: string, val: string) => void;
  onCommitEdit: (id: string) => void;
  onAcceptSubnode: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>, id: string) => void;
  inputRef: (el: HTMLInputElement | null, id: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
  /** Called with the node's circle-dot element so wires can snap to the circle. */
  dotRef?: (el: HTMLDivElement | null) => void;
  /**
   * Called when this node is hovered, passing the node id (for wire emphasis).
   * The parent's handler also derives + sets the active doc-anatomy zone from the
   * node's srcRef, so the card no longer dispatches onZoneHover itself (doing so
   * routed the highlight through a lossy zone→first-node lookup and lit the wrong
   * wire when two nodes share a srcRef, e.g. PO + Order date on "header-meta").
   */
  onHover?: (id: string | null) => void;
  /**
   * Reverse direction only: a document-anatomy zone hover highlights its
   * representative canonical node. Consumed by DocumentAnatomy's zone rail — NOT by
   * SpineNodeCard (kept in the props for the shared call sites; the card ignores it).
   */
  onZoneHover?: (zone: string | null) => void;
  /** The currently-active zone from the document anatomy or canonical hover. */
  activeZone?: string | null;
  /** Line id whose Accept is currently committing to the server (disables its buttons). */
  acceptingLineId?: string | null;
  /** Manual supplier-code entry API (renders the "Set supplier code" control). */
  lineEdit?: LineEditApi;
}

function SpineNodeCard({
  node, idx,
  editingId, fieldValues,
  onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode,
  onKeyDown, inputRef, cardRef, dotRef, onHover, activeZone,
  acceptingLineId, lineEdit,
}: SpineNodeCardProps) {
  const isEditing = editingId === node.id;
  const displayVal = fieldValues[node.id] ?? node.value;
  // "edited" badge: the user changed this field's value from the parsed original
  // (and it isn't blank). Shown for header fields once committed locally.
  const isEdited =
    fieldValues[node.id] !== undefined &&
    fieldValues[node.id] !== node.value &&
    fieldValues[node.id].trim() !== "";
  const issue = node.pct < 90;
  const err   = node.pct < 75;
  const isActiveZone = activeZone === node.srcRef;

  // Background: dim errors/warnings; highlight when the linked doc zone is active.
  const fieldBg =
    isActiveZone ? "rgba(46,142,58,0.06)" :
    err   ? "#FBE3E3" :
    issue ? "#FAEFD6" :
    "#FFFFFF";

  // Lineage accent: blue for buyer-side / document-header fields, green for the
  // supplier-side field. Encodes the buyer→supplier routing on every card.
  const accent =
    node.tone === "supplier" ? "#2E8E3A"
    : node.tone === "buyer" || node.srcRef === "header" ? "#1E66C9"
    : null;

  // Border emphasis when the linked zone is active
  const borderColor =
    isActiveZone ? "#2E8E3A" :
    err   ? "#F0D2D2" :
    issue ? "#F0E0BD" :
    "#E2E6EE";

  return (
    <div
      className="relative mb-2.5 pl-9"
      ref={cardRef}
      // Hovering a canonical CARD highlights THIS node's wire by its unique node id.
      // Only call onHover(node.id): the parent's node-hover handler already sets BOTH
      // the precise hoveredId AND the activeZone (= node.srcRef). The previous code also
      // fired onZoneHover(node.srcRef), which routed through the zone→node lookup and
      // overwrote hoveredId with the FIRST node sharing that srcRef — so hovering ORDER
      // DATE (srcRef "header-meta", shared with PO) lit PO's wire and left DATE's dim.
      // The zone-rail in DocumentAnatomy still calls onZoneHover directly for the
      // reverse (zone → representative node) direction.
      onMouseEnter={() => { onHover?.(node.id); }}
      onMouseLeave={() => { onHover?.(null); }}
    >
      {/* Canonical-order node dot — wires snap to this circle's centre (dotRef). */}
      <div
        ref={dotRef}
        className="absolute rounded-full bg-white z-10"
        style={{ left: 17, top: 14, width: 13, height: 13, border: `2.5px solid ${accent ?? "#2E8E3A"}` }}
      />

      <div
        className="rounded-[6px] px-2.5 py-2"
        style={{
          background: fieldBg,
          border: `1px solid ${borderColor}`,
          borderLeft: accent ? `3px solid ${isActiveZone ? "#2E8E3A" : accent}` : `1px solid ${borderColor}`,
          transition: "background 150ms, border-color 150ms",
          boxShadow: isActiveZone ? "0 0 0 2px rgba(46,142,58,0.14)" : undefined,
        }}
      >
        {/* Label row */}
        <div className="flex items-center gap-1.5 mb-1">
          {accent && <div style={{ width: 5, height: 5, borderRadius: "50%", background: accent, flexShrink: 0 }} />}
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--ink-faint)", flex: 1, display: "inline-flex", alignItems: "center", gap: 4 }}>
            {node.label}
            {NODE_TO_FIELD[node.id] && (
              <StandardsFieldPopover canonicalField={NODE_TO_FIELD[node.id]} label={node.label} />
            )}
            {isEdited && !isEditing && (
              <span
                title="You edited this field. It will be saved when you send the order."
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                  color: "#1E6D29",
                  background: "#E6F7EC",
                  border: "1px solid #BfE6CB",
                  borderRadius: 4,
                  padding: "1px 4px",
                }}
              >
                edited
              </span>
            )}
          </span>
          {/* Honest confidence: a percentage ONLY when the backend computed one
              (per-line confidences). Header fields show a neutral "parsed" chip —
              the old hardcoded 95–100% values were fabricated. */}
          {node.realConf ? <ConfChip pct={node.pct} /> : <ParsedChip />}
        </div>

        {/* Value — editable inline (extracted HeaderInlineEditField; Tab-chain
            lives in useResolveActions.handleEditKeyDown) */}
        {isEditing ? (
          <HeaderInlineEditField
            id={node.id}
            value={displayVal}
            mono={node.mono}
            big={node.big}
            inputRef={inputRef}
            onChange={onChangeValue}
            onCommit={onCommitEdit}
            onKeyDown={onKeyDown}
          />
        ) : node.editable ? (
          // Editable value — a real button so it is keyboard-focusable and
          // activates on Enter/Space (native <button> behaviour fires onClick).
          <button
            type="button"
            aria-label={`Edit ${node.label}`}
            onClick={() => onStartEdit(node.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              background: "transparent",
              border: "none",
              fontSize: node.big ? 16 : 13,
              fontWeight: node.big ? 600 : 500,
              letterSpacing: node.big ? "-0.01em" : undefined,
              fontFamily: node.mono ? "'JetBrains Mono',monospace" : "inherit",
              color: "#0B1A2F",
              cursor: "text",
              borderRadius: 4,
              padding: "2px 4px",
              marginLeft: -4,
              transition: "background 100ms",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F0F2F7"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            {displayVal}
            <span style={{ marginLeft: 4, fontSize: 9, color: "#C6CDDA", userSelect: "none" }}>✎</span>
          </button>
        ) : (
          <div
            style={{
              fontSize: node.big ? 16 : 13,
              fontWeight: node.big ? 600 : 500,
              letterSpacing: node.big ? "-0.01em" : undefined,
              fontFamily: node.mono ? "'JetBrains Mono',monospace" : "inherit",
              color: "#0B1A2F",
              cursor: "default",
              borderRadius: 4,
              padding: "2px 4px",
              marginLeft: -4,
            }}
          >
            {displayVal}
          </div>
        )}

        {/* Hint — amber warning by default, quiet grey for muted provenance hints */}
        {node.hint && !isEditing && (
          node.hintTone === "muted" ? (
            <div style={{ fontSize: 10.5, marginTop: 3, color: "var(--ink-faint)" }}>{node.hint}</div>
          ) : (
            <div style={{ fontSize: 10.5, marginTop: 3, color: "#C97A14" }}>⚠ {node.hint}</div>
          )
        )}

        {/* Subnodes — numbered line rows + prominent AI suggestion cards */}
        {node.subnodes && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px dashed #E2E6EE", display: "flex", flexDirection: "column" }}>
            {node.subnodes.map((sn, si) => {
              // SERVER TRUTH ONLY (gates G1/G2): a line renders resolved when the
              // refetched order says so — there is no local accepted/rejected
              // state. The old local "Reject" strike-through was a P0 dead-end
              // (never persisted, recoverable only by reload) and is deleted;
              // "Enter manually" is the honest alternative.
              const rowCode = sn.sku;
              const showAiCard = !!sn.ai;

              return (
                <div key={sn.id} style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 5, paddingBottom: 5, borderTop: si === 0 ? "none" : "1px solid #EEF0F4" }}>
                  {/* Line row: N  Description  buyerCode · ×qty   →  supplierCode | missing */}
                  <div style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                    {sn.lineNo != null && (
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF", flexShrink: 0, width: 14, textAlign: "right" }}>
                        {sn.lineNo}
                      </span>
                    )}
                    <span
                      title={sn.desc}
                      style={{
                        fontSize: 11.5,
                        fontWeight: 600,
                        color: "#0B1A2F",
                        textDecoration: "none",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flexShrink: 1,
                        minWidth: 0,
                      }}
                    >
                      {sn.desc ?? rowCode}
                    </span>
                    {/* Buyer code + qty (muted source side) + Phase 4 enrichment */}
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF" }}>
                      <span>{sn.buyerCode ?? sn.sku}</span>
                      <span style={{ color: "#C6CDDA" }}>·</span>
                      <span>×{sn.qty}</span>
                      {sn.lineAmount != null && (
                        <>
                          <span style={{ color: "#C6CDDA" }}>·</span>
                          <span title="Line amount">{formatMoney(sn.currency ?? "EUR", sn.lineAmount)}</span>
                        </>
                      )}
                      {sn.taxRate != null && (
                        <>
                          <span style={{ color: "#C6CDDA" }}>·</span>
                          <span title="Tax rate">{sn.taxRate}%</span>
                        </>
                      )}
                      {sn.deliveryDate && (
                        <>
                          <span style={{ color: "#C6CDDA" }}>·</span>
                          <span title="Delivery date">{sn.deliveryDate}</span>
                        </>
                      )}
                    </span>
                    {/* Resolved supplier code (green) or a 'missing' pill */}
                    <span style={{ marginLeft: "auto", flexShrink: 0, display: "inline-flex", alignItems: "center" }}>
                      {sn.err ? (
                        <span style={{ fontSize: 10.5, fontWeight: 700, fontFamily: "Inter,sans-serif", background: "#FBE3E3", color: "#C53A3A", borderRadius: 4, padding: "1px 6px" }}>missing</span>
                      ) : (
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, color: "#1E6D29", textDecoration: "none" }}>{rowCode}</span>
                      )}
                    </span>
                  </div>

                  {/* Error line with no AI suggestion — manual supplier-code entry.
                      Lives in the shared card, so it works on mobile/tablet/desktop.
                      This closes the dead-end where an unresolved line had no way to
                      be fixed (the #1 review gap). */}
                  {sn.err && !showAiCard && lineEdit && lineEdit.editId === sn.id && (
                    <ManualCodeRow sn={sn} lineEdit={lineEdit} saving={acceptingLineId === sn.id} />
                  )}
                  {sn.err && !showAiCard && lineEdit && lineEdit.editId !== sn.id && (
                    <div style={{ marginLeft: 21, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10.5, fontWeight: 600, color: "#C53A3A", display: "inline-flex", alignItems: "center", gap: 5 }}>
                        <span style={{ width: 4, height: 4, borderRadius: 1, background: "#C53A3A", display: "inline-block" }} />
                        {sn.hint ?? "Needs a supplier code"}
                      </span>
                      <button
                        type="button"
                        onClick={() => lineEdit.onStart(sn.id, "")}
                        aria-label={`Set supplier code for line ${sn.lineNo ?? sn.sku}`}
                        style={{ fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 6, border: "1px solid #1E66C9", background: "#FFFFFF", color: "#1E66C9", cursor: "pointer", minHeight: 32 }}
                      >
                        Set supplier code
                      </button>
                    </div>
                  )}
                  {/* Read-only fallback (no edit API wired) — keep the honest hint. */}
                  {sn.err && !showAiCard && !lineEdit && (
                    <div style={{ marginLeft: 21, fontSize: 10.5, fontWeight: 600, color: "#C53A3A", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 4, height: 4, borderRadius: 1, background: "#C53A3A", display: "inline-block" }} />
                      {sn.hint ?? "Needs a supplier code"} — will be held back
                    </div>
                  )}

                  {/* AI suggestion card (extracted; Reject — the local-only dead-end —
                      is gone, replaced by "Enter manually" through the server path). */}
                  {showAiCard && (
                    <AiSuggestionContent
                      sn={{
                        ...sn,
                        // Map SubNode's ai* calibration fields onto the card's contract.
                        calibrated: sn.aiCalibrated,
                        rawPct: sn.aiRawPct,
                        calibrationBasis: sn.aiCalibrationBasis,
                      }}
                      showAcceptKbd={si === 0}
                      accepting={acceptingLineId === sn.id}
                      onAccept={onAcceptSubnode}
                      lineEdit={lineEdit}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Source → output provenance refs — blue for source, green for output (design spec) */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 6, borderTop: "1px dashed #E2E6EE", fontSize: 9.5, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>
          <span title={`Source: ${node.srcRef}`} style={{ color: "#1E66C9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45%" }}>← {node.srcRef}</span>
          <span style={{ color: "#C6CDDA", flexShrink: 0 }}>·</span>
          <span title={`Output: ${node.outRef}`} style={{ color: "#1E6D29", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "right" }}>→ {node.outRef}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Zone definitions ──────────────────────────────────────────────────────────
// Maps canonical node srcRef → zone appearance when active.
// Used bidirectionally: hovering a node highlights the zone, hovering the zone
// highlights the canonical node.
//
// NOTE: there is no static per-zone confidence map. Zone tints are driven by the
// real per-zone confidences derived from live order data inside DocumentAnatomy.

// ─── Document Anatomy ─────────────────────────────────────────────────────────
// Renders a document-styled view reconstructed from the order's parsed fields.
// Driven entirely by live order data — no staged company/PO content.
//
// activeZone: the currently-hovered srcRef zone id (bidirectional with canonical spine).
// onZoneHover: called by zone elements to propagate hover state upstream.

/** One confidence-zone marker in the source-document rail gutter.
 *  `pct` is optional: zones WITHOUT a real backend confidence (header/parties/
 *  terms — the old 99/95/60/70 numbers were heuristics presented as measured)
 *  render a neutral numberless marker instead of asserting a fabricated value. */
function ZoneMarker({ pct, active, onClick, onEnter, onLeave }: {
  pct?: number;
  active: boolean;
  onClick?: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  // colour derivations (matching .conf-hi/.conf-mid/.conf-lo from tokens.css);
  // neutral grey when no real confidence exists for the zone.
  const solid  = pct == null ? "#56627A" : pct >= 90 ? "#2E8E3A" : pct >= 75 ? "#C97A14" : "#C53A3A";
  const soft   = pct == null ? "rgba(86,98,122,0.14)" : pct >= 90 ? "rgba(46,142,58,0.22)" : pct >= 75 ? "rgba(201,122,20,0.22)" : "rgba(197,58,58,0.22)";
  return (
    <div
      aria-hidden
      style={{
        flex: 1, minHeight: 38, borderRadius: 5,
        background: active ? solid : soft,
        border: `1px solid ${active ? solid : "transparent"}`,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'JetBrains Mono',monospace", fontSize: 9, fontWeight: 700,
        color: active ? "#fff" : solid,
        cursor: "pointer", transition: "all 150ms",
      }}
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {pct ?? "·"}
    </div>
  );
}

function DocumentAnatomy({
  order,
  onSection,
  activeZone,
  onZoneHover,
  collapsed,
  onToggleCollapse,
}: {
  order: Order;
  onSection?: (id: string, el: HTMLElement | null) => void;
  /** The zone currently being highlighted (e.g. "header", "lines"). */
  activeZone?: string | null;
  /** Called when the user hovers into/out of a document zone. */
  onZoneHover?: (zone: string | null) => void;
  /** Controlled collapse of the reconstructed-document body (state lives in SpineReview
   *  so SpineConnectors can stop drawing the source wires when their anchors are hidden).
   *  Optional — only the desktop triptych passes them; mobile/tablet render uncollapsible. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const lineCount = order.lines.length;
  const avgConf = lineCount > 0
    ? Math.round((order.lines.reduce((s, l) => s + l.confidence, 0) / lineCount) * 100)
    : null;
  const dateLabel = order.orderDate || "—";
  // Show every parsed line — no cap. A hidden line beyond a slice cap could still
  // be the one tripping the send guard; the reviewer must be able to see it.
  const previewLines = order.lines;

  // REAL per-zone confidences only, keyed by zone id. The only zone backed by
  // real backend data is "lines" (average of per-line confidences). The previous
  // header/parties/terms numbers (99/95 when buyerName present, 60/70 otherwise,
  // and a derived terms formula) were heuristics rendered as if measured —
  // fabricated confidence. Zones without a real value fall through to the
  // neutral tint in sectionStyle() and a neutral numberless rail marker.
  const zoneConf: Record<string, number | undefined> = {
    ...(avgConf !== null ? { lines: avgConf } : {}),
  };

  // Tint overlay colour for an active section inside the document body.
  function sectionStyle(zone: string): React.CSSProperties {
    const isActive = activeZone === zone;
    if (!isActive) return {};
    const pct = zoneConf[zone];
    // No real confidence for this zone → neutral highlight (no conf claim).
    if (pct == null) {
      return {
        outline: "1.5px solid #C6CDDA",
        outlineOffset: 2,
        background: "rgba(86,98,122,0.06)",
        borderRadius: 4,
        transition: "all 150ms",
      };
    }
    const col = pct >= 90 ? "#2E8E3A" : pct >= 75 ? "#C97A14" : "#C53A3A";
    return {
      outline: `1.5px solid ${col}`,
      outlineOffset: 2,
      background: pct >= 90 ? "rgba(46,142,58,0.06)" : pct >= 75 ? "rgba(201,122,20,0.07)" : "rgba(197,58,58,0.07)",
      borderRadius: 4,
      transition: "all 150ms",
    };
  }

  // Only the desktop triptych passes onToggleCollapse → only it renders a clickable
  // collapse toggle. Mobile/tablet keep the original static header (no dead button).
  const collapsible = typeof onToggleCollapse === "function";
  const confBadge = avgConf !== null && (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700, color: "#56627A" }}>
      avg conf <ConfChip pct={avgConf} />
    </span>
  );

  return (
    <div style={{ borderRadius: 8, padding: 10, background: "#F6F7FA", border: "1px solid #E2E6EE", overflow: "hidden" }}>
      {collapsible ? (
        <button type="button" onClick={onToggleCollapse}
          aria-expanded={!collapsed}
          title={collapsed ? "Show the reconstructed document" : "Hide it to make source fields easier to reach"}
          style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: collapsed ? 0 : 8, border: "none", background: "transparent", padding: 0, cursor: "pointer" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 9.5, color: "var(--ink-faint)" }}>
            <span style={{ display: "inline-block", transition: "transform 150ms", transform: collapsed ? "rotate(-90deg)" : "none", fontSize: 8 }}>▾</span>
            Built from your file
          </span>
          {confBadge}
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 9.5, color: "var(--ink-faint)" }}>Built from your file</span>
          {confBadge}
        </div>
      )}
      {/* COLLAPSED summary card — a REAL VISIBLE element set (not display:none) that
          carries the SAME onSection zone anchors as the expanded body. The source→
          canonical wires read srcSectionEls[zone] for their SOURCE endpoint; if the
          only anchors lived in the expanded body (display:none → zero rect), every
          source wire's endpoint collapsed to (≈0,0) i.e. the top-left of the page —
          the "wires fly up to the top" bug. We render EITHER this summary OR the full
          body (never both), so React attaches each zone ref to whichever branch is
          mounted/visible — srcSectionEls[zone] always resolves to a real laid-out
          element in BOTH states. Shows the buyer line, the PURCHASE ORDER po#·date
          line (header-meta), and a compact line table — matching the founder's video. */}
      {collapsed ? (
        <div
          style={{
            borderRadius: 6, background: "#FFFFFF", padding: "10px 12px",
            fontFamily: "'Times New Roman',serif", fontSize: 9.5, color: "#1a1a1a",
            boxShadow: "0 1px 4px rgba(0,0,0,0.06)", border: "1px solid #ECEFF4",
          }}
        >
          {/* Header line — buyer + "PURCHASE ORDER po#·date". po#/date carry the
              "header-meta" anchor (po + date canonical wires terminate here); the buyer
              name carries "header". */}
          <div
            ref={(el) => onSection?.("header", el)}
            style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, ...sectionStyle("header") }}
            onMouseEnter={() => onZoneHover?.("header")}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            <span style={{ fontFamily: "Inter,sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: "0.03em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>
              {order.buyerName ?? "Buyer (parsing…)"}
            </span>
            <span
              ref={(el) => onSection?.("header-meta", el)}
              style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 9, flexShrink: 0, textAlign: "right" }}
            >
              PURCHASE ORDER {order.poNumber} · {dateLabel}
            </span>
          </div>

          {/* Parties — buyer/supplier. Carries the "parties" anchor (buyer + supplier
              canonical wires terminate here). */}
          <div
            ref={(el) => onSection?.("parties", el)}
            style={{ marginTop: 8, fontSize: 9, padding: "2px 0", ...sectionStyle("parties") }}
            onMouseEnter={() => onZoneHover?.("parties")}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            Buyer: {order.buyerName ?? "—"} · Supplier: {order.supplierName}
          </div>

          {/* Terms — currency + line count. Carries the "terms" anchor (currency wire). */}
          <div
            ref={(el) => onSection?.("terms", el)}
            style={{ marginTop: 6, fontSize: 9, padding: "2px 0", ...sectionStyle("terms") }}
            onMouseEnter={() => onZoneHover?.("terms")}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            Currency: {order.currency} · {lineCount} line{lineCount !== 1 ? "s" : ""}
          </div>

          {/* Compact line table — carries the "lines" anchor (the line-items wire). */}
          {lineCount > 0 ? (
            <table
              ref={(el) => onSection?.("lines", el)}
              style={{ width: "100%", borderCollapse: "collapse", marginTop: 8, fontSize: 10.5, cursor: "pointer" }}
              onMouseEnter={() => onZoneHover?.("lines")}
              onMouseLeave={() => onZoneHover?.(null)}
            >
              <tbody>
                {previewLines.slice(0, 4).map((l) => (
                  <tr key={l.id}>
                    <td style={{ padding: "1px 4px", borderBottom: "1px dotted #E0E0E0", color: "#888" }}>{l.lineNumber}</td>
                    <td style={{ fontFamily: "monospace" }}>{l.buyerItemCode}</td>
                    <td style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 0 }}>{l.description ?? "—"}</td>
                    {/* 0/null quantity = "not parsed" — render an honest dash, not a fake ×0. */}
                    <td style={{ textAlign: "right" }}>{l.quantity ? `×${l.quantity}` : "×—"}</td>
                  </tr>
                ))}
                {previewLines.length > 4 && (
                  <tr><td colSpan={4} style={{ padding: "1px 4px", fontSize: 10.5, color: "var(--ink-faint)", fontStyle: "italic" }}>+{previewLines.length - 4} more</td></tr>
                )}
              </tbody>
            </table>
          ) : (
            <div
              ref={(el) => onSection?.("lines", el)}
              style={{ marginTop: 8, fontSize: 9, color: "#888", fontStyle: "italic" }}
              onMouseEnter={() => onZoneHover?.("lines")}
              onMouseLeave={() => onZoneHover?.(null)}
            >
              No line items parsed yet.
            </div>
          )}

          {/* Totals — grand total. Carries the "totals" anchor. */}
          <div
            ref={(el) => onSection?.("totals", el)}
            style={{ marginTop: 8, textAlign: "right", fontSize: 9, fontWeight: 700, ...sectionStyle("totals") }}
            onMouseEnter={() => onZoneHover?.("totals")}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            Grand total: {formatMoney(order.currency, resolvedGrandTotal(order))}
          </div>
        </div>
      ) : (
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        {/* Confidence zone rail — clickable/hoverable markers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, width: 28, flexShrink: 0 }}>
          {(["header", "parties", "lines", "terms"] as const).map((zone) => (
            <ZoneMarker
              key={zone}
              pct={zoneConf[zone]}
              active={activeZone === zone}
              onEnter={() => onZoneHover?.(zone)}
              onLeave={() => onZoneHover?.(null)}
              onClick={() => onZoneHover?.(activeZone === zone ? null : zone)}
            />
          ))}
        </div>

        {/* Document body */}
        <div style={{
          position: "relative", flex: 1, minWidth: 0, borderRadius: 6, background: "#FFFFFF",
          padding: "14px 16px", fontFamily: "'Times New Roman',serif", fontSize: 9.5,
          color: "#1a1a1a", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", minHeight: 360,
        }}>
          {/* Header zone */}
          <div
            ref={(el) => onSection?.("header", el)}
            style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 8px 8px", marginBottom: 4, borderRadius: 6, cursor: "pointer", transition: "all 150ms", ...sectionStyle("header") }}
            onMouseEnter={() => onZoneHover?.("header")}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            <div style={{ fontFamily: "Inter,sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
              {order.buyerName ?? "Buyer (parsing…)"}
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>Purchase Order</div>
              {/* PO number + order date live on THIS line — anchor it distinctly so the
                  "po"/"date" canonical wires terminate here, not at the header's vertical
                  centre (which sits on the buyer name above). */}
              <div ref={(el) => onSection?.("header-meta", el)} style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace" }}>{order.poNumber} · {dateLabel}</div>
            </div>
          </div>

          {/* Parties zone */}
          <div
            ref={(el) => onSection?.("parties", el)}
            style={{ marginTop: 10, fontSize: 9, padding: "4px 6px", borderRadius: 4, cursor: "pointer", transition: "all 150ms", ...sectionStyle("parties") }}
            onMouseEnter={() => onZoneHover?.("parties")}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            Buyer: {order.buyerName ?? "—"}<br/>Supplier: {order.supplierName}
          </div>

          {/* Terms zone */}
          <div
            ref={(el) => onSection?.("terms", el)}
            style={{ marginTop: 8, fontSize: 9, padding: "4px 6px", borderRadius: 4, cursor: "pointer", transition: "all 150ms", ...sectionStyle("terms") }}
            onMouseEnter={() => onZoneHover?.("terms")}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            Currency: {order.currency} · {lineCount} line{lineCount !== 1 ? "s" : ""}
          </div>

          {/* Lines zone */}
          {lineCount > 0 ? (
            <table
              ref={(el) => onSection?.("lines", el)}
              style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 10.5, cursor: "pointer", transition: "all 150ms" }}
              onMouseEnter={() => onZoneHover?.("lines")}
              onMouseLeave={() => onZoneHover?.(null)}
            >
              <thead>
                <tr style={{ background: activeZone === "lines" ? "rgba(46,142,58,0.08)" : "#EEE" }}>
                  <th style={{ textAlign: "left", padding: "3px 4px" }}>#</th>
                  <th style={{ textAlign: "left" }}>Item</th>
                  <th style={{ textAlign: "left" }}>Desc.</th>
                  <th style={{ textAlign: "right" }}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {previewLines.map((l) => (
                  <tr key={l.id}>
                    <td style={{ padding: "2px 4px", borderBottom: "1px dotted #BBB" }}>{l.lineNumber}</td>
                    <td style={{ fontFamily: "monospace" }}>{l.buyerItemCode}</td>
                    <td>{l.description ?? "—"}</td>
                    {/* Negative = highlighted anomaly · 0/null = honest dash (not a fake 0). */}
                    <td style={{ textAlign: "right" }}>{l.quantity < 0 ? <span style={{ background: "#FBDADA", padding: "0 2px" }}>{l.quantity}</span> : l.quantity ? l.quantity : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div
              ref={(el) => onSection?.("lines", el)}
              style={{ marginTop: 12, fontSize: 9, color: "#888", fontStyle: "italic", cursor: "pointer" }}
              onMouseEnter={() => onZoneHover?.("lines")}
              onMouseLeave={() => onZoneHover?.(null)}
            >
              No line items parsed yet.
            </div>
          )}

          {/* Totals zone */}
          <div
            ref={(el) => onSection?.("totals", el)}
            style={{ marginTop: 10, textAlign: "right", fontSize: 9, fontWeight: 700, padding: "4px 6px", borderRadius: 4, cursor: "pointer", transition: "all 150ms", ...sectionStyle("totals") }}
            onMouseEnter={() => onZoneHover?.("totals")}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            Grand total: {formatMoney(order.currency, resolvedGrandTotal(order))}
          </div>

          {/* Active zone tint overlay (screen-level, not per-section) */}
          {activeZone && (
            <div
              style={{ position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 6 }}
              aria-hidden
            />
          )}
        </div>
      </div>
      )}
    </div>
  );
}

// ─── Output Preview — moved to ./review/OutputPreview (Phase C; now also
// renders the Triage context stage's single-line fragment mode). ─────────────

// ConfirmDialog moved to ./review/ConfirmDialog (shared by both sub-views).

// ─── Success toast ────────────────────────────────────────────────────────────

function CrossedToast({ onDismiss, supplierName, poNumber, lineCount, labels }: {
  onDismiss: () => void;
  supplierName: string;
  poNumber: string;
  lineCount: number;
  labels: PartyLabels;
}) {
  const inbound = labels.counterpartyNoun === "Customer";
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div role="status" aria-live="polite" style={{ position: "fixed", bottom: 24, right: 24, display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: "#0B1A2F", borderRadius: 10, boxShadow: "0 8px 24px rgba(11,26,47,0.25)", zIndex: 9992, animation: "fade-up 0.3s ease-out both" }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: "#E2F1E2", color: "#1E6D29", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✓</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>{inbound ? `Order confirmed for ${supplierName}` : `Sent to ${supplierName} · accepted`}</div>
        <div style={{ fontSize: 11.5, color: "#7C8DA6", marginTop: 2 }}>{poNumber} · {lineCount} line{lineCount !== 1 ? "s" : ""}</div>
      </div>
      <button onClick={onDismiss} aria-label="Dismiss notification" style={{ marginLeft: 8, background: "none", border: "none", color: "#7C8DA6", fontSize: 16, cursor: "pointer", padding: "0 2px" }}>✕</button>
    </div>
  );
}

// ─── Mobile accordion ─────────────────────────────────────────────────────────

interface MobileSpineAccordionProps {
  order: Order;
  nodes: SpineNodeData[];
  editingId: string | null;
  fieldValues: Record<string, string>;
  crossed: boolean;
  onStartEdit: (id: string) => void;
  onChangeValue: (id: string, val: string) => void;
  onCommitEdit: (id: string) => void;
  onAcceptSubnode: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>, id: string) => void;
  inputRef: (el: HTMLInputElement | null, id: string) => void;
  onOutputAction: (msg: string) => void;
  orderId: string;
  artifacts: Order["artifacts"];
  /** Supplier's configured delivery protocol — see OutputPreview. */
  deliveryProtocol?: string | null;
  acceptingLineId?: string | null;
  lineEdit?: LineEditApi;
}

function AccordionPanel({ step, label, sub, accent, defaultOpen, children }: {
  step: number;
  label: string;
  sub?: string;
  accent: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-[10px] overflow-hidden" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}>
      <button
        type="button"
        className="w-full flex items-center gap-3 px-3.5 text-left"
        style={{ minHeight: 52, borderBottom: open ? "1px solid #E2E6EE" : "none", background: open ? "rgba(46,142,58,0.04)" : "#FFFFFF" }}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span style={{ width: 4, height: 30, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#F0F2F7", color: "#56627A", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{step}</span>
        <span className="min-w-0 flex-1">
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#0B1A2F", lineHeight: 1.2 }}>{label}</span>
          {sub && <span style={{ display: "block", fontSize: 11, color: "var(--ink-faint)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>}
        </span>
        <span style={{ fontSize: 16, color: "var(--ink-faint)", transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms", flexShrink: 0 }}>›</span>
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}

/** Small vertical connector between the stacked mobile sections (keeps the routing concept). */
function MobileFlowConnector() {
  return (
    <div className="flex justify-center" style={{ height: 18 }} aria-hidden>
      <div style={{ width: 2, background: "linear-gradient(180deg,#1E6D29,#2E8E3A)", borderRadius: 2 }} />
    </div>
  );
}

function MobileSpineAccordion({
  order, nodes, editingId, fieldValues,
  crossed, onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onKeyDown, inputRef, onOutputAction,
  orderId, artifacts, deliveryProtocol, acceptingLineId, lineEdit,
}: MobileSpineAccordionProps) {
  const lineCount = order.lines.length;
  return (
    <div className="md:hidden flex flex-col px-4 py-4 pb-[88px]">
      <AccordionPanel step={1} label="Source document" sub={order.buyerName ?? "Buyer"} accent="#1E66C9">
        {/* Mobile: no active-zone wiring — simplified */}
        <DocumentAnatomy order={order} />
      </AccordionPanel>

      <MobileFlowConnector />

      <AccordionPanel step={2} label="Canonical order" sub={`${lineCount} field${lineCount !== 1 ? "s" : ""} mapped`} accent="linear-gradient(180deg,#1E66C9,#2E8E3A)" defaultOpen>
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", top: 4, bottom: 0, left: 22, width: 3, background: "linear-gradient(180deg,#1E66C9,#2E8E3A)", borderRadius: 2 }} />
          <div style={{ position: "relative", paddingTop: 4 }}>
            {nodes.map((node, i) => (
              <SpineNodeCard
                key={node.id}
                node={node}
                idx={i}
                editingId={editingId}
                fieldValues={fieldValues}
                onStartEdit={onStartEdit}
                onChangeValue={onChangeValue}
                onCommitEdit={onCommitEdit}
                onAcceptSubnode={onAcceptSubnode}
                onKeyDown={onKeyDown}
                inputRef={inputRef}
                acceptingLineId={acceptingLineId}
                lineEdit={lineEdit}
              />
            ))}
            {/* Phase 4 — document totals (renders only when enriched) */}
            <TotalsSummary order={order} />
          </div>
        </div>
      </AccordionPanel>

      <MobileFlowConnector />

      <AccordionPanel step={3} label="Supplier output" sub={order.supplierName} accent="#2E8E3A">
        <OutputPreview
          order={order}
          crossed={crossed}
          fieldValues={fieldValues}
          onOutputAction={onOutputAction}
          orderId={orderId}
          artifacts={artifacts}
          deliveryProtocol={deliveryProtocol}
        />
      </AccordionPanel>
    </div>
  );
}

// ─── Tablet (md–xl) two-column layout ──────────────────────────────────────────
// Intermediate composition for the 768–1279px band. Tablets are too narrow for
// the full three-column triptych (which needs ~1120px and the SpineConnectors
// overlay) but deserve more than the phone accordion. We lay out TWO columns:
//   • Left  — the canonical order spine (every field + line, fully interactive).
//   • Right — the source DocumentAnatomy stacked above the supplier OutputPreview.
// This preserves ProcuLink's source → canonical → output lineage story on tablets
// without the connector wires. Every sub-component and handler is reused verbatim
// from the triptych, so behaviour (inline edit, AI accept/reject, zone↔field
// highlight) is identical — only the responsive composition differs.

interface TabletSpineLayoutProps extends MobileSpineAccordionProps {
  /** Highlights the matching document zone when a canonical node is hovered. */
  onNodeHover: (id: string | null) => void;
  /** Highlights the matching canonical node when a document zone is hovered. */
  onZoneHover: (zone: string | null) => void;
  /** The zone currently highlighted (drives the DocumentAnatomy + card tint). */
  activeZone: string | null;
}

function TabletSpineLayout({
  order, nodes, editingId, fieldValues,
  crossed, onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onKeyDown, inputRef, onOutputAction,
  orderId, artifacts, deliveryProtocol, acceptingLineId, lineEdit,
  onNodeHover, onZoneHover, activeZone,
}: TabletSpineLayoutProps) {
  return (
    <div className="hidden md:block xl:hidden px-6 py-[18px] pb-[88px]">
      <div className="grid gap-x-7 gap-y-4" style={{ gridTemplateColumns: "1.1fr 1fr", alignItems: "start" }}>
        {/* Left — CANONICAL ORDER spine (interactive) */}
        <div style={{ position: "relative", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, height: 18 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#0B1A2F" }}>Canonical order</span>
            <span style={{ fontSize: 9.5, color: "#B4BBC8" }}>ProcuLink model</span>
          </div>
          {/* Canonical spine line (same as triptych centre column) */}
          <div style={{ position: "absolute", top: 36, bottom: 0, left: 22, width: 3, background: "linear-gradient(180deg,#1E66C9,#2E8E3A)", borderRadius: 2 }} />
          <div style={{ position: "relative", paddingTop: 4 }}>
            {nodes.map((node, i) => (
              <SpineNodeCard
                key={node.id}
                node={node}
                idx={i}
                editingId={editingId}
                fieldValues={fieldValues}
                onStartEdit={onStartEdit}
                onChangeValue={onChangeValue}
                onCommitEdit={onCommitEdit}
                onAcceptSubnode={onAcceptSubnode}
                onKeyDown={onKeyDown}
                inputRef={inputRef}
                onHover={onNodeHover}
                onZoneHover={onZoneHover}
                activeZone={activeZone}
                acceptingLineId={acceptingLineId}
                lineEdit={lineEdit}
              />
            ))}
            {/* Phase 4 — document totals (renders only when enriched) */}
            <TotalsSummary order={order} />
          </div>
        </div>

        {/* Right — SOURCE document above SUPPLIER output (stacked, no connectors) */}
        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 18 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, height: 18, minWidth: 0 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#1E66C9", flexShrink: 0 }}>Source document</span>
              <FileChip type={sourceFileType(order.sourceFileKey)} />
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{sourceFileLabel(order.sourceFileKey)}</span>
            </div>
            <DocumentAnatomy
              order={order}
              activeZone={activeZone}
              onZoneHover={onZoneHover}
            />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, height: 18 }}>
              <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#1E6D29" }}>Supplier output</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF", whiteSpace: "nowrap" }}>{outputArtifactType(order.artifacts)}</span>
            </div>
            <OutputPreview
              order={order}
              crossed={crossed}
              fieldValues={fieldValues}
              onOutputAction={onOutputAction}
              orderId={orderId}
              artifacts={order.artifacts}
              deliveryProtocol={deliveryProtocol}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────
// Stuck-order detection moved to ./review/hooks/useOrderReview.

// STABLE empty array for the source-tokens query default. A `= []` destructuring
// default allocates a NEW array every render while the query is loading/disabled,
// which makes the memoised sourceTokenList — and thus useSourceWireDrag's `measure`
// callback — change identity each render, firing its useLayoutEffect in an infinite
// setState loop (React #185 "Maximum update depth exceeded"). A shared const fixes it.
const EMPTY_SOURCE_TOKENS: SourceToken[] = [];

export function SpineReview({ orderId }: { orderId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  // Direction-aware labels: inbound relabels the green primary action to
  // "Confirm order" and its progress/done states (mechanism UNCHANGED — still
  // transform + deliver). Output-artifact labels (cXML/"Output") stay neutral.
  const { labels } = useOrderDirection();

  // ── Live order data (extracted hook — query + stuck detection + SERVER-truth
  //    exceptionCount; gates queries via useQueriesEnabled internally) ─────────
  const { order, isLoading, isError, refetchOrder, isStuck, exceptionCount, queryEnabled } = useOrderReview(orderId);

  const { data: auditEvents = [] } = useQuery({
    queryKey: ["order-audit", orderId],
    queryFn: () => apiClient.getOrderAudit(orderId),
    enabled: order?.status === "failed",
    retry: 1,
    staleTime: 60_000,
  });

  // ── Next needs-review order (continuation flow, batch 9 Phase B) ───────────
  // After the operator confirms a send the dialog closes immediately and
  // delivery continues in the background (header pill; useSendFlow keeps
  // polling). "Next order →" jumps to the next order waiting for review —
  // server-filtered to pending_review, hidden when there is none.
  const { data: nextReviewPage } = useQuery({
    queryKey: ["orders", "next-review", orderId],
    queryFn: () => apiClient.getOrders({ status: "pending_review", pageSize: 10 }),
    enabled: queryEnabled,
    staleTime: 30_000,
    retry: 1,
  });
  const nextReviewOrderId = useMemo(
    () => nextReviewPage?.items.find((o) => o.id !== orderId)?.id ?? null,
    [nextReviewPage, orderId],
  );

  // ── Known supplier codes (datalist typeahead for manual line resolution) ───
  // Best-effort: a failure just means no suggestions — free-text entry still
  // works. Sourced from the supplier's saved mappings.
  const { data: supplierMappings } = useQuery({
    queryKey: ["supplier-mappings", order?.supplierId],
    queryFn: () => apiClient.getSupplierMappings(order!.supplierId),
    enabled: queryEnabled && !!order?.supplierId,
    staleTime: 60_000,
    retry: 1,
  });
  const mappingCodes = useMemo(
    () => Array.from(new Set(
      (supplierMappings ?? [])
        .map((m) => m.supplierItemCode)
        .filter((c): c is string => !!c && c.trim().length > 0),
    )),
    [supplierMappings],
  );

  // ── Supplier CATALOG (ground truth of valid supplier codes) ────────────────
  // This is how an operator (and the AI) knows which codes are even POSSIBLE:
  // the supplier's own product list. Best-effort — no catalog just means no
  // catalog-grounded warning; saved mappings + free text still work.
  const { data: catalogPage } = useQuery({
    queryKey: ["supplier-catalog-codes", order?.supplierId],
    queryFn: () => getSupplierCatalog(order!.supplierId, undefined, 1000),
    enabled: queryEnabled && !!order?.supplierId,
    staleTime: 60_000,
    retry: 1,
  });
  const catalogCodes = useMemo(
    () => Array.from(new Set(
      (catalogPage?.items ?? [])
        .map((p) => p.code)
        .filter((c): c is string => !!c && c.trim().length > 0),
    )).sort((a, b) => a.localeCompare(b)),
    [catalogPage],
  );

  // Datalist typeahead = catalog codes (the real "what's possible") ∪ saved mappings.
  const knownSupplierCodes = useMemo(
    () => Array.from(new Set([...catalogCodes, ...mappingCodes])).sort((a, b) => a.localeCompare(b)),
    [catalogCodes, mappingCodes],
  );

  // ── Supplier delivery config (real configured channel + output format) ─────
  // Drives the OutputPreview footer ("Delivers via …") and the Conformance tab's
  // default format — instead of a hardcoded "HTTP / webhook" claim (offer⇔works).
  // Shares the ["supplier-delivery-config", id] cache key with the supplier list.
  // Backend returns 204 → null when no config exists. Best-effort: on error the
  // footer just shows the neutral unknown state.
  const { data: deliveryConfig, isSuccess: deliveryConfigLoaded } = useQuery<DeliveryConfig | null>({
    queryKey: ["supplier-delivery-config", order?.supplierId],
    queryFn: () => getDeliveryConfig(order!.supplierId),
    enabled: queryEnabled && !!order?.supplierId,
    staleTime: 5 * 60_000,
    retry: 1,
    retryDelay: 800,
  });
  // undefined = unknown (loading/error) · null = known none · string = configured.
  const deliveryProtocol: string | null | undefined = deliveryConfigLoaded
    ? (deliveryConfig?.protocol ?? null)
    : undefined;

  // ── Per-order mapping override (for WireDragLayer existing-connections + upsert) ──
  // Fetched on mount so the drag handles know which canonical→output wires are
  // already set (and can show them highlighted). The OutputMappingEditor has its
  // own copy; we share the same query-key ["mapping-override", orderId] so they
  // stay in sync.
  const { data: mappingOverride, refetch: refetchOverride } = useQuery({
    queryKey: ["mapping-override", orderId],
    queryFn: () => getMappingOverride(orderId),
    enabled: queryEnabled,
    staleTime: 10_000,
  });

  // Map outputLineId → canonicalField from the existing override.
  // Used by WireDragLayer to highlight already-connected pairs.
  const existingWireConnections = useMemo<Partial<Record<string, string>>>(() => {
    const result: Record<string, string> = {};
    const override = mappingOverride?.output?.header ?? {};
    Object.values(override).forEach((rule) => {
      if (rule.outputPath && rule.canonicalField) {
        result[rule.outputPath] = rule.canonicalField;
      }
    });
    return result;
  }, [mappingOverride]);

  // ── Source tokens (the draggable "source field" set for source→canonical wiring) ──
  // Best-effort: a failure / unsupported format just means no chips — the rest of the
  // review screen is unaffected. Loaded once per order on mount.
  const { data: sourceTokensData, isLoading: sourceTokensLoading } = useQuery<SourceToken[]>({
    queryKey: ["source-tokens", orderId],
    queryFn: () => getSourceTokens(orderId),
    enabled: queryEnabled,
    staleTime: 60_000,
    retry: 1,
  });
  // Stable reference when empty (see EMPTY_SOURCE_TOKENS) — never `?? []` inline here.
  const sourceTokens = sourceTokensData ?? EMPTY_SOURCE_TOKENS;

  // Bumped after each successful wire upsert — added to the SpineConnectors
  // signature so it schedules a re-measure.
  const [wireSig, setWireSig] = useState(0);

  // Debounced upsert ref — we cancel any pending save when a new drop comes in
  // so rapid reconnects don't send stale payloads.
  const wireDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Separate debounce for the source→canonical (SourceMap) wires so a left-side and
  // a right-side drag in quick succession don't cancel each other's save.
  const srcWireDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derive nodes from the live order. Empty until the order resolves (the
  // loading/error gates below render before this is used). No demo fallback —
  // real users must never see staged PO-DEMO-001 content.
  const nodes = useMemo(() => (order ? buildNodesFromOrder(order, labels) : []), [order, labels]);
  const connectorNodes = useMemo(() => nodes.map((n) => ({ id: n.id, pct: n.pct, srcRef: n.srcRef })), [nodes]);

  // Sample order banner: query param OR order.isSample
  const searchParams = useSearchParams();
  const isSample = searchParams.get("sample") === "1" || order?.isSample === true;

  // ── Send flow + flow notices (extracted hook) ───────────────────────────────
  const {
    flowNotice, flowSeverity, setFlow,
    sendState, crossed, showToast, setShowToast,
    showConfirm, setShowConfirm, confirmSend,
  } = useSendFlow({ orderId, order, labels, refetchOrder });

  // ── Line/header resolution actions (extracted hook — single server path) ───
  const resolve = useResolveActions({ orderId, order, nodes, labels, setFlow, refetchOrder });
  const {
    fieldValues, editingId, acceptingLineId,
  } = resolve;

  // ── Acceptance validation (extracted hook + debounced auto-revalidate) ─────
  const validation = useAcceptanceValidation(orderId, { commitVersion: resolve.commitVersion });
  const { validationResult, failingRuleCount } = validation;

  // ── Wire drag connect handler (WireDragLayer callback) ────────────────────
  // Placed AFTER setFlow so it can call it.
  // nodeId  = canonical node id (e.g. "po", "date", "buyer" …)
  // lineId  = output line id (e.g. "po", "date", "supplier" …)
  //
  // NODE_TO_CANONICAL_FIELD matches WireDragLayer's internal map — kept here so
  // SpineReview can build OutputFieldRule without depending on WireDragLayer internals.
  const NODE_TO_CANONICAL_FIELD: Record<string, string> = {
    po:       "PoNumber",
    date:     "OrderDate",
    buyer:    "BuyerName",
    supplier: "SupplierName",
    currency: "Currency",
    lines:    "LineNumber",
    totals:   "LineTotal",
  };

  const handleWireConnect = useCallback((nodeId: string, outputLineId: string) => {
    if (wireDebRef.current) clearTimeout(wireDebRef.current);
    wireDebRef.current = setTimeout(async () => {
      const canonicalField = NODE_TO_CANONICAL_FIELD[nodeId];
      if (!canonicalField) return;

      // Merge with the existing override — don't clobber other rules.
      const base: OrderMappingOverride = mappingOverride ?? { customFields: [], output: { header: {}, lines: {} } };
      const headerRules = { ...(base.output?.header ?? {}) };
      // Set (or replace) the rule for this output line path.
      headerRules[outputLineId] = {
        outputPath: outputLineId,
        canonicalField,
        fixedValue: null,
        fieldManipulators: [],
      };

      const next: OrderMappingOverride = {
        ...base,
        output: { ...(base.output ?? {}), header: headerRules, lines: base.output?.lines ?? {} },
      };

      try {
        await upsertMappingOverride(orderId, next);
        await qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
        await refetchOverride();
        // Bump wireSig → gets included in the SpineConnectors signature →
        // SpineConnectors schedules a re-measure via its useLayoutEffect.
        setWireSig(s => s + 1);
        setFlow(`Wire set: ${nodeId} → ${outputLineId}`, "success");
      } catch (err) {
        setFlow(err instanceof Error ? err.message : "Couldn't save wire connection.", "error");
      }
    }, 120); // short debounce — rapid drags shouldn't stack
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mappingOverride, orderId, qc, refetchOverride, setFlow]);

  // Remove a canonical→output override — drops output.header[lineId] (line reverts to its default source).
  const handleWireDisconnect = useCallback((outputLineId: string) => {
    if (wireDebRef.current) clearTimeout(wireDebRef.current);
    wireDebRef.current = setTimeout(async () => {
      if (!mappingOverride?.output?.header?.[outputLineId]) return;
      const header = { ...mappingOverride.output.header };
      delete header[outputLineId];
      const next: OrderMappingOverride = {
        ...mappingOverride,
        output: { ...mappingOverride.output, header, lines: mappingOverride.output?.lines ?? {} },
      };
      // Optimistic: drop the wire from the cache + bump the signature NOW so the
      // overlay (which derives purely from the override) clears on the same frame,
      // instead of lingering until the server round-trip completes.
      qc.setQueryData(["mapping-override", orderId], next);
      setWireSig(s => s + 1);
      try {
        await upsertMappingOverride(orderId, next);
        await qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
        await refetchOverride();
        setWireSig(s => s + 1);
        setFlow(`Reset ${outputLineId} to its default source`, "info");
      } catch (err) {
        setFlow(err instanceof Error ? err.message : "Couldn't remove the wire.", "error");
      }
    }, 60);
  }, [mappingOverride, orderId, qc, refetchOverride, setFlow]);

  // ── Source→canonical wire connect handler (SourceWireDragLayer callback) ──────
  // tokenId        = the source-token id being dragged FROM (e.g. "cell:r1c3")
  // canonicalField = the canonical field name the node maps to (e.g. "PoNumber")
  //
  // Sets OrderMappingOverride.sourceMap[<canonicalField>] = { sourceToken, manipulators: [] }
  // and persists via upsertMappingOverride (which round-trips canonical_json, the same
  // store the promote endpoint later reads). Merges with the existing override so the
  // output-side rules + other source mappings are preserved. Bumps wireSig → re-measure,
  // so the persistent violet wire visibly re-routes from the new token on drop.
  const handleSourceWireConnect = useCallback((tokenId: string, canonicalField: string) => {
    if (srcWireDebRef.current) clearTimeout(srcWireDebRef.current);
    srcWireDebRef.current = setTimeout(async () => {
      const base: OrderMappingOverride = mappingOverride ?? { customFields: [], output: { header: {}, lines: {} } };
      const sourceMap = { ...(base.sourceMap ?? {}) };
      // Preserve any manipulator chain already configured for this field (e.g. via a
      // future power editor); only the source token is being re-pointed here.
      const existing = sourceMap[canonicalField];
      sourceMap[canonicalField] = {
        sourceToken: tokenId,
        fixedValue: null,
        manipulators: existing?.manipulators ?? [],
      };

      const next: OrderMappingOverride = { ...base, sourceMap };

      try {
        await upsertMappingOverride(orderId, next);
        await qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
        await refetchOverride();
        setWireSig(s => s + 1);
        setFlow(`Source field wired → ${canonicalField}`, "success");
      } catch (err) {
        setFlow(err instanceof Error ? err.message : "Couldn't save the source wire.", "error");
      }
    }, 120);
  }, [mappingOverride, orderId, qc, refetchOverride, setFlow]);

  // Remove a source→canonical wire — clears sourceMap[canonicalField] and persists.
  const handleSourceWireDisconnect = useCallback((canonicalField: string) => {
    if (srcWireDebRef.current) clearTimeout(srcWireDebRef.current);
    srcWireDebRef.current = setTimeout(async () => {
      if (!mappingOverride?.sourceMap?.[canonicalField]) return;
      const sourceMap = { ...mappingOverride.sourceMap };
      delete sourceMap[canonicalField];
      const next: OrderMappingOverride = { ...mappingOverride, sourceMap };
      // Optimistic clear (see handleWireDisconnect) — the violet overlay derives
      // purely from sourceMap, so updating the cache removes the wire instantly.
      qc.setQueryData(["mapping-override", orderId], next);
      setWireSig(s => s + 1);
      try {
        await upsertMappingOverride(orderId, next);
        await qc.invalidateQueries({ queryKey: ["mapping-override", orderId] });
        await refetchOverride();
        setWireSig(s => s + 1);
        setFlow(`Removed the source wire for ${canonicalField}`, "info");
      } catch (err) {
        setFlow(err instanceof Error ? err.message : "Couldn't remove the source wire.", "error");
      }
    }, 60);
  }, [mappingOverride, orderId, qc, refetchOverride, setFlow]);

  // ── Promote the per-order re-wiring to the supplier's reusable mapping ────────
  // Persist any pending SourceMap edit first is unnecessary — each drop already
  // upserts immediately — so promote just reads canonical_json server-side.
  const promoteMutation = useMutation({
    mutationFn: () => promoteMapping(orderId),
    onSuccess: (r) => {
      // Count BOTH the inbound source side and the output side (the old code only
      // counted source fields, so an output-only mapping looked like "nothing saved").
      const total = r.totalFieldsPromoted
        ?? (r.headerFieldsPromoted + r.lineFieldsPromoted
            + (r.outputHeaderFieldsPromoted ?? 0) + (r.outputLineFieldsPromoted ?? 0));
      const nothing = r.nothingToPromote ?? total === 0;
      // Promoted mappings ARE consumed on the supplier's future orders since
      // backend batch 4A (precedence: per-order override > promoted > fixed),
      // so the success copy can honestly promise auto-apply now.
      const msg = nothing
        ? (r.message ?? "Nothing to save yet — wire a source field or add an output mapping first.")
        : `Saved ${total} field mapping${total !== 1 ? "s" : ""} for ${order?.supplierName ?? "this supplier"} — applies to their next order automatically.`;
      setFlow(msg, nothing ? "info" : "success");
    },
    onError: (err) => setFlow(err instanceof Error ? err.message : "Couldn't save the supplier mapping.", "error"),
  });

  // Initial tab honours a `?tab=` deep-link (e.g. an exception linking to the
  // Conformance panel). Falls back to "review".
  const initialTab = ((): "review" | "passport" | "conformance" | "response" => {
    const t = searchParams.get("tab");
    return t === "passport" || t === "conformance" || t === "response" ? t : "review";
  })();
  const [tab, setTab]                             = useState<"review" | "passport" | "conformance" | "response">(initialTab);

  // ── Review sub-view: Triage (Fix Queue) | Full document (classic triptych) ──
  // One-experience rule: NO localStorage flag. The default is DETERMINISTIC and
  // latched once per order load: Triage iff there is work to do (server
  // exceptionCount > 0 or failing acceptance rules), else Full document.
  // ?view=classic|triage overrides (and doubles as the rollback story).
  const viewParam = searchParams.get("view");
  const [viewOverride, setViewOverride] = useState<"triage" | "classic" | null>(
    viewParam === "classic" ? "classic" : viewParam === "triage" ? "triage" : null,
  );
  const defaultViewRef = useRef<"triage" | "classic" | null>(null);
  if (order && defaultViewRef.current === null) {
    defaultViewRef.current = exceptionCount > 0 || failingRuleCount > 0 ? "triage" : "classic";
  }
  const subView: "triage" | "classic" = viewOverride ?? defaultViewRef.current ?? "classic";
  const switchSubView = useCallback((v: "triage" | "classic") => {
    setViewOverride(v);
    const params = new URLSearchParams(searchParams.toString());
    params.set("view", v);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // ── Auto-route Triage → Full document once every exception clears (T6) ───────
  // A PDF / needs-review order lands in Triage (work to do), so the Full-document
  // drag-to-connect mapper never mounts. When the operator clears the LAST
  // exception/rule AND hasn't explicitly picked a view, flow them on to the
  // mapper — the natural next surface — exactly once. One-directional + sticky:
  // it never yanks back to Triage if a new flag later appears, and an explicit
  // toggle choice (viewOverride) always wins.
  const autoRoutedToClassicRef = useRef(false);
  useEffect(() => {
    if (autoRoutedToClassicRef.current) return;
    if (viewOverride !== null) return;
    if (!order) return;
    if (defaultViewRef.current === "triage" && exceptionCount === 0 && failingRuleCount === 0) {
      autoRoutedToClassicRef.current = true;
      switchSubView("classic");
    }
  }, [order, viewOverride, exceptionCount, failingRuleCount, switchSubView]);

  // g-d / g-b destination (Phase C, stolen from Queue & Bench): jump to the
  // Review tab AND the named sub-view in one keystroke pair, syncing BOTH URL
  // params in a single replace (two replaces in one tick would race and drop
  // whichever param the stale searchParams snapshot lacked).
  const jumpToReviewSubView = useCallback((v: "triage" | "classic") => {
    setTab("review");
    setViewOverride(v);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "review");
    params.set("view", v);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  // Compact dismissible strips (sample/stuck) — dismissal is per-visit UI state,
  // never a line-resolution state.
  const [sampleDismissed, setSampleDismissed] = useState(false);
  const [stuckDismissed, setStuckDismissed]   = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);
  const sourceColRef = useRef<HTMLDivElement>(null);
  const outputColRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({});
  // Canonical node circle-dot elements (keyed by node id) — wire overlays snap
  // their canonical endpoint to the dot's centre instead of the card edge.
  const dotEls = useRef<Record<string, HTMLDivElement | null>>({});
  const srcSectionEls = useRef<Record<string, HTMLElement | null>>({});
  const outLineEls = useRef<Record<string, HTMLElement | null>>({});
  // Source-token chip elements, keyed by token id — drag handles for source→canonical wires.
  const tokenEls = useRef<Record<string, HTMLElement | null>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // activeZone: the document-anatomy zone id (e.g. "header", "lines") currently
  // highlighted. Set bidirectionally — from DocumentAnatomy zone hover OR from
  // canonical SpineNodeCard hover (using node.srcRef).
  const [activeZone, setActiveZone] = useState<string | null>(null);
  // Collapse the reconstructed-document body so the draggable source-field chips sit
  // higher and are easier to reach. Lifted here (not inside DocumentAnatomy) so the
  // decorative source→canonical wires (SpineConnectors) can stop drawing when their
  // section anchors are hidden — otherwise they'd point at zero-rect elements.
  // Default COLLAPSED on desktop: the reconstructed-document table (up to N rows)
  // otherwise dominates the source column, pushing the draggable source-field chips
  // (the actual wiring targets) below the fold when the column is sticky-pinned. The
  // same parsed data is already shown as canonical nodes; one click re-expands it.
  const [parsedDocCollapsed, setParsedDocCollapsed] = useState(true);
  // Whether the OutputPreview's "Edit output mapping" slideover is open. Relayed up
  // from OutputPreview (onMappingEditorOpenChange) so the desktop triptych can FULLY
  // hide the interactive wire overlays + the decorative source connectors while the
  // editor is open — otherwise the wires bleed through the slideover. Affects render/
  // opacity only (never the wire measure deps), so it can't destabilise the #185 guards.
  const [mapEditorOpen, setMapEditorOpen] = useState(false);

  // Resolve which canonical node id corresponds to a given srcRef zone.
  const nodeIdForZone = useCallback((zone: string | null): string | null => {
    if (!zone) return null;
    return nodes.find(n => n.srcRef === zone)?.id ?? null;
  }, [nodes]);

  // When hovering a document zone: also highlight the matching canonical wire.
  const handleZoneHover = useCallback((zone: string | null) => {
    setActiveZone(zone);
    setHoveredId(nodeIdForZone(zone));
  }, [nodeIdForZone]);

  // When hovering a canonical node: also highlight its document zone.
  const handleNodeHover = useCallback((id: string | null) => {
    setHoveredId(id);
    if (!id) {
      setActiveZone(null);
    } else {
      const node = nodes.find(n => n.id === id);
      setActiveZone(node?.srcRef ?? null);
    }
  }, [nodes]);

  // exceptionCount comes from useOrderReview — SERVER truth only (gate G1).

  // Per-line server state, included in the SpineConnectors signature so a line
  // resolving (needsReview flip / code set after refetch) schedules a wire
  // re-measure — this replaces the old local accepted/rejected set terms.
  const lineStateSig = useMemo(
    () => (order ? order.lines.map(l => `${l.id}:${l.needsReview ? 1 : 0}:${l.supplierItemCode ?? ""}`).join(",") : ""),
    [order],
  );

  // ── Dialog / toast context derived from live order ────────────────────────
  const dialogSupplierName = order?.supplierName ?? "supplier";
  const dialogOutputFormat = order ? outputArtifactType(order.artifacts) : "XML";
  // Grand total shown in the header, sticky bar AND confirm dialog. Must use the
  // backend-extracted grandTotal (via resolvedGrandTotal) so it matches the
  // TotalsSummary block — a raw Σ(price×qty) ignores backend tax/discount and
  // contradicts the document on real POs.
  const dialogGrandTotal   = order
    ? formatMoney(order.currency, resolvedGrandTotal(order))
    : "—";
  const dialogLineCount    = order?.lines.length ?? 0;
  // failingRuleCount comes from useAcceptanceValidation. A failed validation
  // doesn't hard-block send (the supplier may still accept), but the user must
  // explicitly acknowledge it in the confirm dialog — required second checkbox.

  // ── Edit / resolve handlers — extracted to useResolveActions; the shared
  // LineEditApi below threads them into the line cards (classic + triage).
  // First-resolution micro-helper (task 7): no line on this order carries a
  // supplier code yet → the manual-entry row shows a one-line muted teaching
  // hint. Server truth only; self-resolves after the first commit + refetch.
  const noLineResolvedYet = useMemo(
    () => !!order && !order.lines.some((l) => !!l.supplierItemCode),
    [order],
  );

  const lineEditApi = useMemo<LineEditApi>(() => ({
    knownCodes: knownSupplierCodes,
    catalogCodes,
    supplierName: order?.supplierName ?? "",
    editId: resolve.lineEditId,
    draft: resolve.lineDraft,
    onStart: resolve.startLineEdit,
    onChange: resolve.setLineDraft,
    onCommit: resolve.commitLineCode,
    onCancel: resolve.cancelLineEdit,
    firstResolveHint: noLineResolvedYet,
  }), [knownSupplierCodes, catalogCodes, order?.supplierName, resolve.lineEditId, resolve.lineDraft, resolve.startLineEdit, resolve.setLineDraft, resolve.commitLineCode, resolve.cancelLineEdit, noLineResolvedYet]);

  // ── Keyboard shortcuts (Bridge Layer reference) ────────────────────────────
  // A = accept the next unresolved AI line suggestion (CLASSIC sub-view only —
  // the Triage rail owns A/E for its selected card) · C = open the send/confirm
  // when there are no blocking exceptions. SCOPED: only fires on the Review tab,
  // not while typing in a field/select, not while a modal dialog is open, and
  // not with a modifier held. Discoverable via the visible kbd hints on the
  // Accept and Send buttons.
  useEffect(() => {
    if (tab !== "review") return;
    const handler = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if (typing || e.metaKey || e.ctrlKey || e.altKey || editingId || showConfirm) return;
      const k = e.key.toLowerCase();
      if (k === "a") {
        if (subView !== "classic") return; // FixQueueTriage handles A in triage
        for (const n of nodes) {
          // sn.ai derives from SERVER truth (unresolved + suggestion present).
          const sn = n.subnodes?.find(s => s.ai);
          if (sn) { e.preventDefault(); resolve.acceptSuggestion(sn.id); return; }
        }
      } else if (k === "c") {
        if (!crossed && exceptionCount === 0 && sendState === "idle") { e.preventDefault(); setShowConfirm(true); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tab, subView, nodes, resolve, crossed, exceptionCount, editingId, showConfirm, sendState, setShowConfirm]);

  // ── g-d / g-b two-key sequences (Phase C) ──────────────────────────────────
  // g then d → Review tab, Full document sub-view ("document").
  // g then b → Review tab, Triage sub-view (the "bench"/fix-queue work surface).
  // Works from ANY tab on this screen (it navigates to Review); same typing /
  // modifier / modal guards as the other shortcuts. The 1s arm window means a
  // lone "g" does nothing visible.
  const gArmedAtRef = useRef(0);
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;
      if (typing || e.metaKey || e.ctrlKey || e.altKey || editingId || showConfirm) return;
      const k = e.key.toLowerCase();
      if (k === "g") { gArmedAtRef.current = Date.now(); return; }
      const armed = Date.now() - gArmedAtRef.current < 1000;
      if (!armed) return;
      gArmedAtRef.current = 0;
      if (k === "d") { e.preventDefault(); jumpToReviewSubView("classic"); }
      else if (k === "b") { e.preventDefault(); jumpToReviewSubView("triage"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingId, showConfirm, jumpToReviewSubView]);

  // ── Full-document sidebar auto-collapse (Phase C) ──────────────────────────
  // The triptych needs ~1120px; below 1440px the expanded 220px sidebar forces
  // horizontal scrolling. Entering Full-document mode at <1440px asks the
  // desktop sidebar to collapse to its 66px rail (WITHOUT touching the user's
  // persisted preference); leaving the mode — or this screen — restores it.
  useEffect(() => {
    if (tab !== "review" || subView !== "classic") return;
    const mql = window.matchMedia("(max-width: 1439px)");
    const apply = () => setSidebarAutoCollapse(mql.matches);
    apply();
    mql.addEventListener("change", apply);
    return () => {
      mql.removeEventListener("change", apply);
      setSidebarAutoCollapse(false); // restore on exit
    };
  }, [tab, subView]);

  // ── Loading / error gates (must be after all hooks) ────────────────────────
  // While Clerk is still resolving the session the order query is disabled
  // (enabled: queryEnabled). In TanStack Query v5 a disabled query reports
  // isLoading=false with data=undefined, so without the !queryEnabled guard the
  // page would flash the error gate before the session is ready.
  if (!queryEnabled || isLoading || order === undefined) return <SpineReviewSkeleton />;
  if (isError || order === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ background: "#F6F7FA" }}>
        <div style={{ fontSize: 28, color: "#C6CDDA" }}>⊘</div>
        <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>
          {order === null ? "Order not found" : "Failed to load order"}
        </p>
        <p className="text-[13px]" style={{ color: "#56627A" }}>
          {order === null ? `No order found with ID ${orderId}.` : "Check your connection and try again."}
        </p>
        <button
          type="button"
          onClick={() => router.push("/inbox")}
          className="rounded-[6px] px-4 text-[12.5px] font-semibold"
          style={{ height: 34, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
        >
          ← Back to inbox
        </button>
      </div>
    );
  }

  // ── Failure gates — render before the full page so we don't need all fields ──
  if (order.status === "failed") {
    return <ParseFailedPanel order={order} auditEvents={auditEvents} />;
  }
  if (order.status === "transform_failed") {
    return <FailedPanel order={order} stage="transform" />;
  }
  if (order.status === "delivery_failed") {
    return <FailedPanel order={order} stage="delivery" />;
  }

  // ── Order Workshop V2 (flag-gated) ──────────────────────────────────────────
  // When NEXT_PUBLIC_ORDER_WORKSHOP_V2 is "true" OR the URL carries ?workshop=1,
  // the unified OrderWorkshop replaces the two-mode screen below. Flag OFF → the
  // existing screen renders unchanged (the branch below is never touched). All of
  // this component's hooks have already run above, so the early return is safe.
  if (isOrderWorkshopEnabled(searchParams)) {
    return <OrderWorkshop orderId={orderId} />;
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>

      {/* Order header */}
      <div className="flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E2E6EE" }}>
        {/* Top row: back + PO title + status badge + buyer→supplier · total | stage track | actions */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-3 px-4 pt-3.5 pb-3.5 lg:flex-nowrap lg:items-center lg:px-6">
          {/* Title block — full width on mobile so the action bar wraps to its own
              row below instead of overlapping the PO title. */}
          <div className="flex w-full min-w-0 items-start gap-3 lg:w-auto lg:flex-1">
            <button
              onClick={() => router.push("/inbox")}
              aria-label="Back to inbox"
              style={{ width: 30, height: 30, border: "1px solid #E2E6EE", borderRadius: 7, background: "#FFFFFF", color: "#56627A", cursor: "pointer", fontSize: 14, flexShrink: 0, marginTop: 1 }}
            >
              ←
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1
                  style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F", lineHeight: 1.1, whiteSpace: "nowrap" }}
                >
                  {order.poNumber}
                </h1>
                <UnifiedStatusBadge size="md" status={headerBadgeStatus(order.status, crossed, exceptionCount)} />
                <InvoiceBadge documentType={order.documentType} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5" style={{ fontSize: 13 }}>
                <span style={{ fontWeight: 600, color: "#0F4FAB", whiteSpace: "nowrap" }}>{order.buyerName ?? "(parsing…)"}</span>
                <span style={{ color: "#C6CDDA" }}>→</span>
                <span style={{ fontWeight: 600, color: "#1E6D29", whiteSpace: "nowrap" }}>{order.supplierName}</span>
                <span style={{ color: "#C6CDDA" }}>·</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#566982", whiteSpace: "nowrap" }}>{dialogGrandTotal}</span>
              </div>
            </div>
          </div>

          {/* Stage track — inline, compact (no Stage N of 5 sub-label) */}
          <div className="order-3 w-full lg:order-none lg:w-auto lg:flex-shrink-0">
            <div className="mx-auto w-full max-w-[420px] lg:mx-0 lg:w-[380px]">
              <StatusJourney
                stage={crossed || order.status === "delivered" ? 4 : orderStatusToStage(order.status)}
              />
            </div>
          </div>

          {/* Actions — full-width action bar stacked below the title on mobile;
              right-aligned inline cluster on desktop. */}
          <div className="flex w-full flex-col items-stretch gap-1.5 lg:w-auto lg:flex-shrink-0 sm:items-end">
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {order.status === "delivery_dead_letter" && (
                <span
                  style={{ height: 34, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 7, fontSize: 12, fontWeight: 600, background: "#FBE3E3", color: "#C53A3A", border: "1px solid #F0D2D2" }}
                >
                  ⚠ Dead-lettered · retries exhausted
                </span>
              )}
              {/* Promote the per-order source→canonical re-wiring to the supplier's
                  reusable mapping, so the same source layout auto-applies next time.
                  Desktop xl only — the drag UI that produces a SourceMap is xl-only. */}
              <button
                type="button"
                onClick={() => promoteMutation.mutate()}
                disabled={promoteMutation.isPending}
                title={`Save mappings for ${order.supplierName} — applies to their next order automatically.`}
                aria-label={`Save these field mappings for ${order.supplierName}`}
                className="hidden xl:inline-flex"
                style={{
                  height: 34, padding: "0 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 600,
                  background: "#FFFFFF", color: "#5E3DB0", border: "1px solid #C4ABE8",
                  cursor: promoteMutation.isPending ? "default" : "pointer", opacity: promoteMutation.isPending ? 0.6 : 1,
                  alignItems: "center", gap: 6, whiteSpace: "nowrap",
                }}
              >
                {promoteMutation.isPending ? "Saving…" : `Save mappings for ${order.supplierName}`}
              </button>
              <button
                onClick={() => !crossed && exceptionCount === 0 && sendState === "idle" && setShowConfirm(true)}
                disabled={sendState !== "idle" || (!crossed && exceptionCount > 0)}
                aria-label={labels.primaryCta}
                className="flex-1 justify-center sm:flex-none"
                style={{
                  height: 34, padding: "0 16px", borderRadius: 7, fontSize: 13, fontWeight: 700,
                  background: crossed ? "#2E8E3A" : sendState !== "idle" || exceptionCount > 0 ? "#96C69C" : "#2E8E3A",
                  color: "#FFFFFF", border: "none",
                  cursor: crossed || sendState !== "idle" || exceptionCount > 0 ? "default" : "pointer",
                  display: "flex", alignItems: "center", gap: 8, transition: "background 200ms",
                }}
              >
                <PaperPlaneIcon />
                {crossed ? labels.doneLabel : sendState === "transforming" ? "Generating..." : sendState === "delivering" ? labels.primaryCtaProgress : labels.primaryCta}
                {!crossed && sendState === "idle" && exceptionCount === 0 && <Kbd>C</Kbd>}
              </button>
            </div>
            {!crossed && exceptionCount > 0 && (
              <span className="text-right" style={{ fontSize: 11.5, color: "var(--ink-faint)", paddingRight: 2 }}>
                {exceptionCount} issue{exceptionCount !== 1 ? "s" : ""} to resolve first
              </span>
            )}
            {/* Continuation row (Phase B): a non-blocking delivery pill while the
                send pipeline runs in the background, plus "Next order →" to move
                on to the next needs-review order without waiting. */}
            {(sendState !== "idle" || ((crossed || order.status === "delivered") && nextReviewOrderId)) && (
              <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
                {sendState !== "idle" && (
                  <span
                    role="status"
                    aria-live="polite"
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, height: 26,
                      padding: "0 10px", borderRadius: 13, fontSize: 11.5, fontWeight: 600,
                      background: "#EFF5FE", border: "1px solid #BFD7F5", color: "#0F4FAB",
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span aria-hidden style={{ fontSize: 12, lineHeight: 1 }}>⟳</span>
                    {sendState === "transforming" ? "Generating in background…" : "Delivering in background…"}
                  </span>
                )}
                {nextReviewOrderId && (
                  <button
                    type="button"
                    onClick={() => router.push(`/inbox/${nextReviewOrderId}`)}
                    aria-label="Open the next order that needs review"
                    style={{
                      height: 26, padding: "0 11px", borderRadius: 13, fontSize: 11.5, fontWeight: 700,
                      background: "#FFFFFF", color: "#1E66C9", border: "1px solid #BFD7F5",
                      cursor: "pointer", whiteSpace: "nowrap",
                    }}
                  >
                    Next order →
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {flowNotice && (() => {
          // Colour by tracked severity, not order.status, so "Delivery failed…"
          // / "Transform failed…" never render green. rejected_by_supplier is
          // always an error regardless of the message.
          const sev = order.status === "rejected_by_supplier" ? "error" : flowSeverity;
          const spec =
            sev === "error"
              ? { border: "1px solid #F0D2D2", background: "#FFF7F7", color: "#C53A3A" }
              : sev === "success"
              ? { border: "1px solid #A6E9BE", background: "#ECFDF3", color: "#1E6D29" }
              : { border: "1px solid #BFD7F5", background: "#EFF5FE", color: "#0F4FAB" };
          return (
            <div className="px-4 pb-3 lg:px-6">
              <div
                role="status"
                aria-live={sev === "error" ? "assertive" : "polite"}
                className="rounded-[7px] px-3 py-2 text-[12px] leading-relaxed"
                style={spec}
              >
                {flowNotice}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Tabs: Review · Passport · {counterparty} response */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 sm:px-5" style={{ background: "#FFFFFF", borderBottom: "1px solid #E2E6EE" }}>
        {([
          { id: "review",      label: "Review" },
          { id: "passport",    label: "Passport" },
          { id: "conformance", label: "Conformance" },
          { id: "response",    label: `${labels.counterpartyNoun} response` },
        ] as const).map((t) => {
          const active = tab === t.id;
          // The deep-link reader (initialTab) already honours ?tab=; mirror tab
          // changes back into the URL so refresh/share/back keep the active tab.
          const rejected = t.id === "response" && order.status === "rejected_by_supplier";
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                // Preserve other params (e.g. ?sample=1) — only swap the tab.
                const params = new URLSearchParams(searchParams.toString());
                params.set("tab", t.id);
                router.replace(`?${params.toString()}`, { scroll: false });
              }}
              title={rejected ? `${labels.counterpartyNoun} rejected this order — open for details` : undefined}
              style={{
                position: "relative", height: 38, padding: "0 12px", background: "none", border: "none",
                fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? "#0B1A2F" : "#56627A", cursor: "pointer",
              }}
            >
              {t.label}
              {/* Rejection indicator — the answer the user is looking for lives here */}
              {rejected && (
                <span
                  aria-hidden
                  style={{ display: "inline-block", marginLeft: 5, width: 6, height: 6, borderRadius: "50%", background: "#C53A3A", verticalAlign: "middle" }}
                />
              )}
              {active && <span style={{ position: "absolute", left: 8, right: 8, bottom: 0, height: 2, borderRadius: 2, background: "linear-gradient(90deg,#1E6D29,#2E8E3A)" }} />}
            </button>
          );
        })}
      </div>

      {tab === "review" && (
      <>
      {/* Sub-view toggle — [Fix issues (N) | Map fields]. Plain labels that name
          what each view DOES (was "Triage | Full document" — jargon, and the second
          view had a different name from its own CTA, reading as three views for two).
          One-experience rule: the default is deterministic (work to do → Fix issues),
          latched per order load; ?view=classic|triage overrides. No localStorage. */}
      <div className="flex-shrink-0 flex flex-wrap items-center gap-2 px-4 lg:px-6" style={{ background: "#FFFFFF", borderBottom: "1px solid #EEF0F4", paddingTop: 6, paddingBottom: 6 }}>
        <div role="group" aria-label="Review view" style={{ display: "inline-flex", borderRadius: 7, border: "1px solid #E2E6EE", overflow: "hidden" }}>
          {([
            { id: "triage" as const,  label: `Fix issues${exceptionCount + failingRuleCount > 0 ? ` (${exceptionCount + failingRuleCount})` : ""}` },
            { id: "classic" as const, label: "Map fields" },
          ]).map((v) => {
            const active = subView === v.id;
            return (
              <button
                key={v.id}
                type="button"
                onClick={() => switchSubView(v.id)}
                aria-pressed={active}
                style={{
                  fontSize: 11.5, fontWeight: active ? 700 : 500, padding: "5px 12px",
                  background: active ? "#0B1A2F" : "#FFFFFF", color: active ? "#FFFFFF" : "#56627A",
                  border: "none", cursor: "pointer",
                }}
              >
                {v.label}
              </button>
            );
          })}
        </div>
        {/* Obvious one-click jump to the drag-to-connect mapper. PDF/needs-review
            orders default to Fix issues (no drag surface); without an explicit
            affordance the visual mapper behind "Map fields" is easy to miss. The
            label MATCHES the pill word so it's plainly the same destination. xl-only
            because the drag canvas itself only mounts at xl. The responsive class owns
            display — no inline `display` (it would defeat `hidden xl:inline-flex`). */}
        {subView === "triage" && (
          <button
            type="button"
            onClick={() => switchSubView("classic")}
            title="Switch to Map fields — drag the supplier's incoming fields onto their output"
            className="hidden xl:inline-flex"
            style={{
              alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 700,
              padding: "5px 12px", borderRadius: 7, cursor: "pointer",
              background: "#F4EFFC", color: "#5E3DB0", border: "1px solid #D6C7F0",
            }}
          >
            <span aria-hidden>↔</span> Map fields
          </button>
        )}
        {validation.isStale && (
          <span aria-live="polite" style={{ fontSize: 11, color: "#C97A14" }}>Re-checking acceptance…</span>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, position: "relative", overflow: "auto" }}>
          {/* Compact dismissible strips (28px) — the old full banners stacked
              ~200px above the fold; the message is kept, the height is not. */}
          {isSample && !sampleDismissed && (
            <div
              role="note"
              aria-label="Sample order"
              style={{
                height: 28, display: "flex", alignItems: "center", gap: 8,
                background: "#FFF8E1", border: "1px solid #F6D88E", color: "#7A5A0A",
                padding: "0 10px", borderRadius: 6, fontSize: 12, margin: "10px 16px 0",
              }}
            >
              {/* Pre-framing (design §Sample strategy 3): the sample's honest
                  ending IS the delivery lesson — say so BEFORE the user sends,
                  so the config-missing stop reads as expected, not broken. */}
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Practice order — free, doesn&apos;t count against your plan. Sending will stop at &ldquo;delivery not set up&rdquo; — that&apos;s expected for the practice {labels.counterpartyNoun.toLowerCase()}.
              </span>
              <button type="button" aria-label="Dismiss sample-order note" onClick={() => setSampleDismissed(true)} style={{ background: "none", border: "none", color: "#7A5A0A", fontSize: 13, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}>✕</button>
            </div>
          )}

          {/* Stuck-order strip (Task 0.B.2) — early warning ahead of the backend
              StuckOrderDetectionJob (30 min); dismissible, 28px. */}
          {isStuck && !stuckDismissed && (
            <div
              role="alert"
              style={{
                height: 28, display: "flex", alignItems: "center", gap: 8,
                background: "#FAEFD6", border: "1px solid #F0D39A", color: "#7A4D0A",
                padding: "0 10px", borderRadius: 6, fontSize: 12, margin: "10px 16px 0",
              }}
            >
              <span aria-hidden style={{ fontSize: 13, flexShrink: 0 }}>⏳</span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Still processing — taking longer than expected. If it persists, try re-uploading or contact support.
              </span>
              <button type="button" aria-label="Dismiss processing warning" onClick={() => setStuckDismissed(true)} style={{ background: "none", border: "none", color: "#7A4D0A", fontSize: 13, cursor: "pointer", padding: "0 2px", flexShrink: 0 }}>✕</button>
            </div>
          )}

          {/* Catalog cliff hint (task 7) — per-supplier probe, additive only.
              Renders nothing while loading/error; self-resolves when a catalog
              exists or any line resolves. Sits above both sub-views, next to
              the Fix Queue / triage work surface. */}
          {order.supplierId && (
            <CatalogHintCard
              supplierId={order.supplierId}
              supplierName={order.supplierName}
              hasUnresolvedLines={exceptionCount > 0}
              anyLineResolved={order.lines.some((l) => !!l.supplierItemCode)}
            />
          )}

          {/* DELETED (batch 9 Phase A, per spec): the actionless open-exceptions
              panel and the standalone always-on acceptance panel. Acceptance
              state lives in useAcceptanceValidation, surfaced in the Triage rail
              (and the confirm dialog's failing-rules ack). */}

        {/* TRIAGE sub-view — Fix Queue rail + Context Stage + Send readiness. */}
        {subView === "triage" && (
          <FixQueueTriage
            order={order}
            orderId={orderId}
            labels={labels}
            lineEdit={lineEditApi}
            resolve={resolve}
            validation={validation}
            keysEnabled={!showConfirm && !editingId}
            crossed={crossed}
            onOutputAction={setFlow}
            deliveryProtocol={deliveryProtocol}
            conformanceFormat={
              conformanceDefaultFormat(deliveryConfig?.outputFormat)
                ?? conformanceDefaultFormat(order.artifacts[0]?.format)
            }
            configuredFormatLabel={outputArtifactType(order.artifacts)}
          />
        )}

        {/* FULL DOCUMENT sub-view — the unified three-pane mapper (xl) + the
            tablet/mobile fallbacks below. */}
        {subView === "classic" && (
        <>
        {/* Desktop "Full document" review — the unified three-pane mapper (Phase 3,
            Task 11). It REPLACES the hand-wired triptych (SpineConnectors + WireDragLayer +
            SourceTokenPanel) that previously lived here. Like the old triptych it needs
            ~1120px, so it only turns on at xl (1280px); below xl the TabletSpineLayout +
            MobileSpineAccordion fallbacks below render instead. The mapper owns its own
            three lanes (SourceUniverse │ CanonicalLane │ TargetLane), the prop-driven wire
            engine (both source→canonical and canonical→output), and the live preview pane;
            it persists through buildOverrideDraft (carries sourceMap — the documented
            data-loss guard). Send/deliver stays owned by the SpineReview chrome (header CTA
            + the sticky bars below), so the mapper is mounted WITHOUT its own deliver button
            to keep ONE send path. The ManualCodeRow per-line code entry remains reachable
            via the Triage sub-view and the mapper's canonical line nodes. */}
        <div className="hidden xl:block min-w-[1120px] px-6 py-[18px]">
          <MapperWorkbench
            variant="order"
            orderId={orderId}
            supplierId={order.supplierId}
            supplierName={order.supplierName}
            initialOverride={mappingOverride}
            /* Feed the parsed Order DIRECTLY so the incoming column shows real values for
               EVERY order type — including PDF/XLSX that never tokenize (the empty-pane bug). */
            order={order}
            onSaveMappings={() => promoteMutation.mutate()}
            saveMappingsLabel="Save mappings"
            savingMappings={promoteMutation.isPending}
            onValidate={() => setTab("conformance")}
          />
        </div>

        {/* Tablet (md–xl, 768–1279px) — two-column layout: canonical spine | source+output.
            Richer than the phone accordion, no connector overlay. Sibling of the
            desktop block; gated hidden md:block xl:hidden internally. */}
        <TabletSpineLayout
          order={order}
          nodes={nodes}
          editingId={editingId}
          fieldValues={fieldValues}
          crossed={crossed}
          onStartEdit={resolve.startEdit}
          onChangeValue={resolve.changeValue}
          onCommitEdit={resolve.commitEdit}
          onAcceptSubnode={resolve.acceptSuggestion}
          onKeyDown={resolve.handleEditKeyDown}
          inputRef={resolve.inputRefCallback}
          onOutputAction={setFlow}
          orderId={orderId}
          artifacts={order.artifacts}
          deliveryProtocol={deliveryProtocol}
          acceptingLineId={acceptingLineId}
          lineEdit={lineEditApi}
          onNodeHover={handleNodeHover}
          onZoneHover={handleZoneHover}
          activeZone={activeZone}
        />

        {/* Mobile accordion — below md only; sibling of the desktop block, no min-width */}
        <MobileSpineAccordion
          order={order}
          nodes={nodes}
          editingId={editingId}
          fieldValues={fieldValues}
          crossed={crossed}
          onStartEdit={resolve.startEdit}
          onChangeValue={resolve.changeValue}
          onCommitEdit={resolve.commitEdit}
          onAcceptSubnode={resolve.acceptSuggestion}
          onKeyDown={resolve.handleEditKeyDown}
          inputRef={resolve.inputRefCallback}
          onOutputAction={setFlow}
          orderId={orderId}
          artifacts={order.artifacts}
          deliveryProtocol={deliveryProtocol}
          acceptingLineId={acceptingLineId}
          lineEdit={lineEditApi}
        />
        </>
        )}
      </div>

      {/* Sticky info bar — desktop triptych only (the stacked layout below xl has its own sticky CTA) */}
      <div className="hidden xl:flex flex-shrink-0 bg-white px-6 py-3 items-center gap-5" style={{ borderTop: "1px solid #E2E6EE" }}>
        <div className="min-w-0">
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)", marginBottom: 2 }}>Grand total</div>
          <div style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 22, fontWeight: 600, color: "#0B1A2F", letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{dialogGrandTotal}</div>
        </div>
        <div style={{ width: 1, height: 36, background: "#E2E6EE", flexShrink: 0 }} />
        <div className="min-w-0">
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)", marginBottom: 2 }}>Output</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.supplierName} · {dialogOutputFormat}</div>
        </div>
        <div className="ml-auto">
          {!crossed && exceptionCount > 0 && (
            <span className="inline-flex rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold" style={{ background: "#FFF8EA", border: "1px solid #F0D39A", color: "#9A5F0A" }}>
              ⚠ {exceptionCount} exception{exceptionCount !== 1 ? "s" : ""} need review
            </span>
          )}
          {crossed && (
            <span className="inline-flex rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold" style={{ background: "#ECFDF3", border: "1px solid #A6E9BE", color: "#1E6D29" }}>
              ✓ {labels.doneLabel}
            </span>
          )}
        </div>
      </div>

      {/* Stacked-layout sticky CTA — shown below xl, alongside the accordion */}
      <div
        className="xl:hidden flex-shrink-0 flex gap-2 px-4 py-3"
        style={{ background: "#FFFFFF", borderTop: "1px solid #E2E6EE", boxShadow: "0 -4px 12px rgba(11,26,47,0.08)" }}
      >
        {/* Save-mappings promote — also reachable below xl (was xl-only before).
            The promote saves whatever mapping state already exists; it does not
            require the xl-only drag canvas to be visible. */}
        <button
          type="button"
          onClick={() => promoteMutation.mutate()}
          disabled={promoteMutation.isPending}
          title={`Save mappings for ${order.supplierName} — applies to their next order automatically.`}
          aria-label={`Save these field mappings for ${order.supplierName}`}
          style={{ height: 44, padding: "0 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, background: "#FFFFFF", color: "#5E3DB0", border: "1px solid #C4ABE8", cursor: promoteMutation.isPending ? "default" : "pointer", opacity: promoteMutation.isPending ? 0.6 : 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {promoteMutation.isPending ? "Saving…" : "Save mappings"}
        </button>
        <button
          onClick={() => !crossed && exceptionCount === 0 && sendState === "idle" && setShowConfirm(true)}
          disabled={sendState !== "idle" || (!crossed && exceptionCount > 0)}
          style={{ flex: 1, height: 44, borderRadius: 8, fontSize: 13.5, fontWeight: 700, background: crossed ? "#2E8E3A" : sendState !== "idle" || exceptionCount > 0 ? "#96C69C" : "#2E8E3A", color: "#FFFFFF", border: "none", cursor: crossed || sendState !== "idle" || exceptionCount > 0 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "background 200ms" }}
        >
          <PaperPlaneIcon />
          {crossed ? labels.doneLabel : sendState === "transforming" ? "Generating..." : sendState === "delivering" ? labels.primaryCtaProgress : exceptionCount > 0 ? `Resolve ${exceptionCount} to send` : labels.primaryCta}
        </button>
      </div>

      </>
      )}

      {/* Passport tab */}
      {tab === "passport" && (
        <div className="flex-1 overflow-auto" style={{ background: "#F6F7FA" }}>
          <OrderPassport orderId={orderId} />
        </div>
      )}

      {/* Conformance tab (Group V8) */}
      {tab === "conformance" && (
        <div className="flex-1 overflow-auto px-4 py-5 sm:px-6" style={{ background: "#F6F7FA" }}>
          <div className="mx-auto w-full max-w-[900px]">
            <h2 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F", marginBottom: 4 }}>
              Standards conformance
            </h2>
            <p className="text-[12.5px]" style={{ color: "#56627A", marginBottom: 16 }}>
              Validate the outbound document for <span className="font-mono" style={{ color: "#1E6D29" }}>{order.poNumber}</span> against a named standards profile.
            </p>
            <ConformancePanel
              orderId={orderId}
              supplierName={order.supplierName}
              /* Default the selector to the supplier's configured output format
                 (delivery config first, generated artifact as evidence fallback);
                 cXML only when neither maps to a named profile. */
              defaultFormat={
                conformanceDefaultFormat(deliveryConfig?.outputFormat)
                  ?? conformanceDefaultFormat(order.artifacts[0]?.format)
              }
            />
          </div>
        </div>
      )}

      {/* Supplier response tab */}
      {tab === "response" && (
        <div className="flex-1 overflow-auto px-4 py-5 sm:px-6" style={{ background: "#F6F7FA" }}>
          <div className="mx-auto w-full max-w-[900px]">
            <h2 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F", marginBottom: 4 }}>
              {labels.counterpartyNoun} response
            </h2>
            <p className="text-[12.5px]" style={{ color: "#56627A", marginBottom: 16 }}>
              What {order.supplierName} confirmed back for <span className="font-mono" style={{ color: "#1E6D29" }}>{order.poNumber}</span>.
            </p>
            {order.status === "rejected_by_supplier" && (
              <div className="mb-4 rounded-[8px] px-4 py-3" style={{ border: "1px solid #F0D2D2", borderLeft: "3px solid #C53A3A", background: "#FFF7F7" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0B1A2F", marginBottom: 4 }}>
                  {labels.counterpartyNoun} rejected this order
                </div>
                <p style={{ margin: 0, fontSize: 12.5, color: "#56627A", lineHeight: 1.5 }}>
                  {order.errorMessage && order.errorMessage.trim().length > 0
                    ? order.errorMessage
                    : "The last delivery attempt came back as a supplier rejection. Fix the order or delivery format, then resend."}
                </p>
              </div>
            )}
            <SupplierResponsePanel orderId={orderId} currency={order.currency} />
          </div>
        </div>
      )}

      {/* Modals */}
      {showConfirm && (
        <ConfirmDialog
          exceptionCount={exceptionCount}
          onConfirm={confirmSend}
          onCancel={() => setShowConfirm(false)}
          supplierName={dialogSupplierName}
          outputFormat={dialogOutputFormat}
          grandTotal={dialogGrandTotal}
          lineCount={dialogLineCount}
          labels={labels}
          failingRuleCount={failingRuleCount}
          validationStale={validation.isStale}
        />
      )}
      {showToast && (
        <CrossedToast
          onDismiss={() => setShowToast(false)}
          supplierName={dialogSupplierName}
          poNumber={order?.poNumber ?? orderId}
          lineCount={dialogLineCount}
          labels={labels}
        />
      )}
    </div>
  );
}
