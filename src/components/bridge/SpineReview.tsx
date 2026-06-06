"use client";

// Canonical Spine Review — fully interactive ETL review screen.
// AC2: AI accept/reject, inline field editing, confirm dialog, keyboard nav.

import type React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from "react";
import { useAuth } from "@clerk/nextjs";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, getOrderExceptions, validateOrder, isApiMockMode } from "@/lib/api-client";
import type { Order, OrderException, OrderValidationResult } from "@/types/procurement";
import { EdgeRails } from "./EdgeRails";
import { FileChip } from "./FileChip";
import { FailedPanel, ParseFailedPanel } from "./FailedPanels";
import { StatusJourney, type OrderStage } from "./StatusJourney";
import { SpineReviewSkeleton } from "./Skeletons";
import { StandardsFieldPopover } from "./StandardsFieldPopover";
import { SpineConnectors } from "./SpineConnectors";
import { OrderPassport } from "./OrderPassport";
import { SupplierResponsePanel } from "./SupplierResponsePanel";

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
  pct: number;
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

// ─── Money helpers ───────────────────────────────────────────────────────────

/** Sum of unitPrice × quantity across all order lines. */
function orderTotal(order: Order): number {
  return order.lines.reduce((sum, l) => sum + Number(l.unitPrice) * Number(l.quantity), 0);
}

/**
 * The grand total to display: prefer the backend-extracted `grandTotal`
 * (Phase 4 enrichment) when present, else fall back to the client-computed
 * sum so behaviour is unchanged when the field is absent (e.g. CSV orders).
 */
function resolvedGrandTotal(order: Order): number {
  return order.grandTotal ?? orderTotal(order);
}

/** Format an amount with a currency symbol/code, e.g. "€ 4,436.73" or "USD 120.00". */
function formatMoney(currency: string, amount: number): string {
  const prefix = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : currency;
  return `${prefix} ${amount.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`;
}

// ─── Map live order → SpineNodeData ──────────────────────────────────────────

function buildNodesFromOrder(order: Order): SpineNodeData[] {
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

  const subnodes: SpineNodeData["subnodes"] = order.lines.slice(0, 10).map((l) => {
    const isAi = !!l.aiSuggestion && !l.supplierItemCode;
    return {
      id: l.id,
      sku: l.supplierItemCode ?? l.buyerItemCode,
      qty: l.quantity,
      ai: isAi,
      pct: isAi ? Math.round(l.aiSuggestion!.confidence * 100) : Math.round(l.confidence * 100),
      err: l.needsReview && !l.supplierItemCode && !l.aiSuggestion,
      lineNo: l.lineNumber,
      desc: l.description ?? l.buyerItemCode,
      buyerCode: l.buyerItemCode,
      aiSuggestedCode: l.aiSuggestion?.supplierItemCode,
      aiReason: l.aiSuggestion?.reason,
      hint: l.needsReview && !l.supplierItemCode && !l.aiSuggestion ? "Needs a supplier code" : undefined,
      // Phase 4 enrichment — passed through only; rendered when non-null.
      currency: order.currency,
      lineAmount: l.lineAmount ?? null,
      taxRate: l.taxRate ?? null,
      deliveryDate: l.deliveryDate ?? null,
    };
  });

  return [
    { id: "po",       label: "PO number",   value: order.poNumber,            pct: 99, mono: true,  editable: false, srcRef: "header",  outRef: "Order/@orderID"    },
    { id: "date",     label: "Order date",  value: order.orderDate,            pct: 95, mono: true,  editable: true,  srcRef: "header",  outRef: "Order/orderDate"   },
    { id: "buyer",    label: "Buyer",       value: order.buyerName ?? "(parsing…)", pct: order.buyerName ? 98 : 50, tone: "buyer",    editable: true,  srcRef: "parties", outRef: "BillTo/Contact"    },
    { id: "supplier", label: "Supplier",    value: order.supplierName,         pct: 97, tone: "supplier", editable: false, srcRef: "parties", outRef: "ShipFrom/Contact", hint: supplierHint, hintTone: "muted" },
    { id: "currency", label: "Currency",    value: order.currency,             pct: 99, mono: true,  editable: true,  srcRef: "terms",   outRef: "Total/@currency"   },
    {
      id: "lines", label: "Line items", value: `${lineCount} line${lineCount !== 1 ? "s" : ""} · ${formatted}`,
      pct: lineConf, big: true, editable: false, srcRef: "lines", outRef: "ItemOut[]",
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

/** Generate a display label for the supplier output file. */
function outputArtifactLabel(artifacts: Order["artifacts"], supplierName: string): string {
  const fmt = artifacts[0]?.format;
  const slug = supplierName.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  return fmt ? `${slug}.${fmt}` : `${slug}.xml`;
}

/** Derive FileChip format from the latest outbound artifact. */
function outputArtifactType(artifacts: Order["artifacts"]): string {
  const fmt = artifacts[0]?.format?.toLowerCase();
  if (!fmt)           return "XML";
  if (fmt === "cxml") return "cXML";
  if (fmt === "csv")  return "CSV";
  return fmt.toUpperCase();
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function finalDeliveryMessage(status: Order["status"], errorMessage?: string | null): string {
  if (status === "delivered") {
    return "Delivered to supplier. The audit trail has been updated.";
  }
  if (status === "delivery_failed") {
    return errorMessage && errorMessage.trim().length > 0
      ? `Delivery failed: ${errorMessage}`
      : "Output generated, but delivery failed. Check the supplier Delivery tab and retry when the endpoint is ready.";
  }
  if (status === "rejected_by_supplier") {
    return errorMessage && errorMessage.trim().length > 0
      ? `Supplier rejected the order: ${errorMessage}`
      : "The supplier rejected the order. Open the Supplier response tab for the rejection details.";
  }
  if (status === "delivery_dead_letter") {
    return "Delivery retries are exhausted. The order is in the dead-letter queue for operator review.";
  }
  return "Delivery is still processing. Refresh the order or check the Delivery Log for the latest attempt.";
}

// ─── Node → canonical field mapping (used for StandardsFieldPopover) ─────────

const NODE_TO_FIELD: Record<string, string> = {
  po:       "PoNumber",
  date:     "OrderDate",
  buyer:    "BuyerName",
  currency: "Currency",
  lines:    "Lines",
};

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

// ─── Header bits ──────────────────────────────────────────────────────────────

/** Paper-plane glyph used on the primary send action. */
function PaperPlaneIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <path d="M14.5 1.5 7.3 8.7M14.5 1.5l-4.6 13-2.6-5.8L1.5 5.9l13-4.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Small status pill next to the PO title — mirrors the canonical pill palette. */
function HeaderStatusBadge({ status, crossed, exceptionCount }: { status: string; crossed: boolean; exceptionCount: number }) {
  const spec =
    crossed || status === "delivered"
      ? { bg: "#E2F1E2", color: "#1E6D29", dot: "#2E8E3A", label: "Delivered" }
      : status === "rejected_by_supplier"
      ? { bg: "#FBE3E3", color: "#C53A3A", dot: "#C53A3A", label: "Rejected" }
      : status === "delivery_dead_letter" || status === "delivery_failed" || status === "transform_failed" || status === "failed"
      ? { bg: "#FBE3E3", color: "#C53A3A", dot: "#C53A3A", label: "Failed" }
      : status === "ready_to_deliver" || status === "transforming"
      ? { bg: "#E3EDFB", color: "#0F4FA8", dot: "#1E66C9", label: "Ready" }
      : exceptionCount > 0
      ? { bg: "#FAEFD6", color: "#C97A14", dot: "#C97A14", label: "Needs review" }
      : { bg: "#E2F1E2", color: "#1E6D29", dot: "#2E8E3A", label: "Ready" };
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full"
      style={{ fontSize: 12, fontWeight: 600, padding: "3px 11px", background: spec.bg, color: spec.color, whiteSpace: "nowrap" }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: spec.dot, flexShrink: 0 }} />
      {spec.label}
    </span>
  );
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
      <div style={{ padding: "8px 12px", borderBottom: "1px solid #EEF0F4", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8A93A5" }}>
        Document totals
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

interface SpineNodeCardProps {
  node: SpineNodeData;
  idx: number;
  editingId: string | null;
  fieldValues: Record<string, string>;
  acceptedSubnodes: Set<string>;
  rejectedSubnodes: Set<string>;
  onStartEdit: (id: string) => void;
  onChangeValue: (id: string, val: string) => void;
  onCommitEdit: (id: string) => void;
  onAcceptSubnode: (id: string) => void;
  onRejectSubnode: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>, id: string) => void;
  inputRef: (el: HTMLInputElement | null, id: string) => void;
  cardRef?: (el: HTMLDivElement | null) => void;
  /** Called when this node is hovered, passing the node id (for wire emphasis). */
  onHover?: (id: string | null) => void;
  /** Called with the srcRef zone when this node is hovered (for doc anatomy highlight). */
  onZoneHover?: (zone: string | null) => void;
  /** The currently-active zone from the document anatomy or canonical hover. */
  activeZone?: string | null;
}

function SpineNodeCard({
  node, idx,
  editingId, fieldValues,
  acceptedSubnodes, rejectedSubnodes,
  onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onRejectSubnode,
  onKeyDown, inputRef, cardRef, onHover, onZoneHover, activeZone,
}: SpineNodeCardProps) {
  const isEditing = editingId === node.id;
  const displayVal = fieldValues[node.id] ?? node.value;
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
    node.tone === "supplier" ? "#28C55E"
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
      onMouseEnter={() => { onHover?.(node.id); onZoneHover?.(node.srcRef); }}
      onMouseLeave={() => { onHover?.(null); onZoneHover?.(null); }}
    >
      {/* Canonical-order node dot */}
      <div
        className="absolute rounded-full bg-white z-10"
        style={{ left: 17, top: 14, width: 13, height: 13, border: `2.5px solid ${accent ?? "#28C55E"}` }}
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
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8A93A5", flex: 1, display: "inline-flex", alignItems: "center", gap: 4 }}>
            {node.label}
            {NODE_TO_FIELD[node.id] && (
              <StandardsFieldPopover canonicalField={NODE_TO_FIELD[node.id]} label={node.label} />
            )}
          </span>
          <ConfChip pct={node.pct} />
        </div>

        {/* Value — editable inline */}
        {isEditing ? (
          <input
            ref={(el) => inputRef(el, node.id)}
            value={displayVal}
            onChange={(e) => onChangeValue(node.id, e.target.value)}
            onBlur={() => onCommitEdit(node.id)}
            onKeyDown={(e) => onKeyDown(e, node.id)}
            style={{
              width: "100%",
              border: "1px solid #28C55E",
              borderRadius: 4,
              padding: "3px 6px",
              fontSize: node.big ? 16 : 12.5,
              fontWeight: node.big ? 600 : 500,
              fontFamily: node.mono ? "'JetBrains Mono',monospace" : "inherit",
              outline: "none",
              background: "#F0FDF4",
              color: "#0B1A2F",
            }}
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
            <div style={{ fontSize: 10.5, marginTop: 3, color: "#8A93A5" }}>{node.hint}</div>
          ) : (
            <div style={{ fontSize: 10.5, marginTop: 3, color: "#C97A14" }}>⚠ {node.hint}</div>
          )
        )}

        {/* Subnodes — numbered line rows + prominent AI suggestion cards */}
        {node.subnodes && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px dashed #E2E6EE", display: "flex", flexDirection: "column" }}>
            {node.subnodes.map((sn, si) => {
              const accepted = acceptedSubnodes.has(sn.id);
              const rejected = rejectedSubnodes.has(sn.id);
              const done = accepted || rejected;
              // The supplier code shown in the line row: accepted → AI code; else resolved/buyer code.
              const rowCode = accepted && sn.aiSuggestedCode ? sn.aiSuggestedCode : sn.sku;
              const showAiCard = sn.ai && !done;

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
                        color: rejected ? "#A8B0BF" : "#0B1A2F",
                        textDecoration: rejected ? "line-through" : "none",
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
                      <span style={{ textDecoration: rejected ? "line-through" : "none" }}>{sn.buyerCode ?? sn.sku}</span>
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
                      {sn.err && !accepted ? (
                        <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "Inter,sans-serif", background: "#FBE3E3", color: "#C53A3A", borderRadius: 4, padding: "1px 6px" }}>missing</span>
                      ) : (
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, fontWeight: 700, color: rejected ? "#A8B0BF" : "#1E6D29", textDecoration: rejected ? "line-through" : "none" }}>{rowCode}</span>
                      )}
                    </span>
                    {accepted   && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#1DAF50", flexShrink: 0 }}>✓</span>}
                    {rejected   && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#C53A3A", flexShrink: 0 }}>✗</span>}
                  </div>

                  {/* Error line with no AI suggestion */}
                  {sn.err && !showAiCard && !done && (
                    <div style={{ marginLeft: 21, fontSize: 10, fontWeight: 600, color: "#C53A3A", display: "inline-flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 4, height: 4, borderRadius: 1, background: "#C53A3A", display: "inline-block" }} />
                      {sn.hint ?? "Needs a supplier code"} — will be held back
                    </div>
                  )}

                  {/* AI suggestion card */}
                  {showAiCard && (
                    <div
                      style={{
                        marginLeft: 21,
                        borderRadius: 8,
                        padding: "9px 11px",
                        background: "#EEE7FB",
                        border: "1px solid #DACEF3",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", color: "#5E3DB0" }}>AI</span>
                        <span style={{ color: "#C4ABE8" }}>·</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#6F4FCE" }}>{sn.pct ?? 0}%</span>
                        <span style={{ marginLeft: "auto", fontSize: 9.5, color: "#8E7CB8" }}>
                          {(sn.pct ?? 0) >= 85 ? "high confidence" : (sn.pct ?? 0) >= 70 ? "good match" : "low confidence"}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#3A2A66", marginBottom: 7, lineHeight: 1.35 }}>
                        Suggested supplier code{" "}
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: "#5E3DB0" }}>{sn.aiSuggestedCode ?? sn.sku}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          aria-label={`Accept AI suggestion for line ${sn.lineNo ?? sn.sku}`}
                          onClick={() => onAcceptSubnode(sn.id)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6, border: "none", background: "#6F4FCE", color: "#FFFFFF", cursor: "pointer" }}
                        >
                          ✓ Accept
                        </button>
                        <button
                          type="button"
                          aria-label={`Edit suggestion for line ${sn.lineNo ?? sn.sku}`}
                          onClick={() => onAcceptSubnode(sn.id)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "7px 12px", borderRadius: 6, border: "1px solid #D6CBF0", background: "#FFFFFF", color: "#3A2A66", cursor: "pointer" }}
                        >
                          ✎ Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Reject AI suggestion for line ${sn.lineNo ?? sn.sku}`}
                          onClick={() => onRejectSubnode(sn.id)}
                          style={{ fontSize: 11, fontWeight: 600, padding: "7px 11px", borderRadius: 6, border: "none", background: "transparent", color: "#8A93A5", cursor: "pointer" }}
                        >
                          Reject
                        </button>
                      </div>
                    </div>
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

const ZONE_CONF: Record<string, number> = {
  header: 99, parties: 95, lines: 80, terms: 75, totals: 99,
};

// ─── Document Anatomy ─────────────────────────────────────────────────────────
// Renders a document-styled view reconstructed from the order's parsed fields.
// Driven entirely by live order data — no staged company/PO content.
//
// activeZone: the currently-hovered srcRef zone id (bidirectional with canonical spine).
// onZoneHover: called by zone elements to propagate hover state upstream.

/** One confidence-zone marker in the source-document rail gutter. */
function ZoneMarker({ pct, active, onClick, onEnter, onLeave }: {
  pct: number;
  active: boolean;
  onClick?: () => void;
  onEnter?: () => void;
  onLeave?: () => void;
}) {
  // colour derivations (matching .conf-hi/.conf-mid/.conf-lo from tokens.css)
  const solid  = pct >= 90 ? "#2E8E3A" : pct >= 75 ? "#C97A14" : "#C53A3A";
  const soft   = pct >= 90 ? "rgba(46,142,58,0.22)" : pct >= 75 ? "rgba(201,122,20,0.22)" : "rgba(197,58,58,0.22)";
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
      {pct}
    </div>
  );
}

function DocumentAnatomy({
  order,
  onSection,
  activeZone,
  onZoneHover,
}: {
  order: Order;
  onSection?: (id: string, el: HTMLElement | null) => void;
  /** The zone currently being highlighted (e.g. "header", "lines"). */
  activeZone?: string | null;
  /** Called when the user hovers into/out of a document zone. */
  onZoneHover?: (zone: string | null) => void;
}) {
  const lineCount = order.lines.length;
  const avgConf = lineCount > 0
    ? Math.round((order.lines.reduce((s, l) => s + l.confidence, 0) / lineCount) * 100)
    : null;
  const dateLabel = order.orderDate || "—";
  const previewLines = order.lines.slice(0, 12);

  // Per-section confidence used by the zone rail. Derived from live data so it
  // tracks the real order (header/parties high; lines = avg; terms lower when
  // currency/terms are softer signals).
  const headerConf  = order.buyerName ? 99 : 60;
  const partiesConf = order.buyerName ? 95 : 70;
  const linesConf   = avgConf ?? 80;
  const termsConf   = Math.max(60, Math.min(88, (avgConf ?? 80) - 10));

  // Tint overlay colour for an active section inside the document body.
  function sectionStyle(zone: string): React.CSSProperties {
    const isActive = activeZone === zone;
    if (!isActive) return {};
    const pct = ZONE_CONF[zone] ?? 80;
    const col = pct >= 90 ? "#2E8E3A" : pct >= 75 ? "#C97A14" : "#C53A3A";
    return {
      outline: `1.5px solid ${col}`,
      outlineOffset: 2,
      background: pct >= 90 ? "rgba(46,142,58,0.06)" : pct >= 75 ? "rgba(201,122,20,0.07)" : "rgba(197,58,58,0.07)",
      borderRadius: 4,
      transition: "all 150ms",
    };
  }

  return (
    <div style={{ borderRadius: 8, padding: 10, background: "#F6F7FA", border: "1px solid #E2E6EE", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9.5, color: "#8A93A5" }}>Reconstructed from parsed fields · hover a zone</span>
        {avgConf !== null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700, color: "#56627A" }}>
            avg conf <ConfChip pct={avgConf} />
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
        {/* Confidence zone rail — clickable/hoverable markers */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5, width: 28, flexShrink: 0 }}>
          {(["header", "parties", "lines", "terms"] as const).map((zone, idx) => {
            const pct = [headerConf, partiesConf, linesConf, termsConf][idx];
            return (
              <ZoneMarker
                key={zone}
                pct={pct}
                active={activeZone === zone}
                onEnter={() => onZoneHover?.(zone)}
                onLeave={() => onZoneHover?.(null)}
                onClick={() => onZoneHover?.(activeZone === zone ? null : zone)}
              />
            );
          })}
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
              <div style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace" }}>{order.poNumber} · {dateLabel}</div>
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
              style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 8.5, cursor: "pointer", transition: "all 150ms" }}
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
                    <td style={{ textAlign: "right" }}>{l.quantity < 0 ? <span style={{ background: "#FBDADA", padding: "0 2px" }}>{l.quantity}</span> : l.quantity}</td>
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
          {lineCount > previewLines.length && (
            <div style={{ marginTop: 4, fontSize: 8.5, color: "#888" }}>+ {lineCount - previewLines.length} more line{lineCount - previewLines.length !== 1 ? "s" : ""}</div>
          )}

          {/* Totals zone */}
          <div
            ref={(el) => onSection?.("totals", el)}
            style={{ marginTop: 10, textAlign: "right", fontSize: 9, fontWeight: 700, padding: "4px 6px", borderRadius: 4, cursor: "pointer", transition: "all 150ms", ...sectionStyle("totals") }}
            onMouseEnter={() => onZoneHover?.("totals")}
            onMouseLeave={() => onZoneHover?.(null)}
          >
            Grand total: {formatMoney(order.currency, orderTotal(order))}
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
    </div>
  );
}

// ─── Output Preview ───────────────────────────────────────────────────────────

function OutputPreview({ order, acceptedSubnodes, rejectedSubnodes, crossed, fieldValues, onOutputAction, orderId, artifacts, onLine }: {
  order: Order;
  acceptedSubnodes: Set<string>;
  rejectedSubnodes: Set<string>;
  crossed: boolean;
  fieldValues: Record<string, string>;
  onOutputAction: (message: string) => void;
  orderId: string;
  artifacts: Order["artifacts"];
  onLine?: (id: string, el: HTMLElement | null) => void;
}) {
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);

  // Output reflects the live order, with any inline edits applied.
  const outPo       = fieldValues["po"]       ?? order.poNumber;
  const outDate     = fieldValues["date"]     ?? order.orderDate;
  const outCurrency = fieldValues["currency"] ?? order.currency;
  const outBuyer    = fieldValues["buyer"]    ?? order.buyerName ?? "—";
  const outTotal    = formatMoney(outCurrency, orderTotal(order));
  const previewLines = order.lines.slice(0, 12);

  async function handleDownload() {
    const artifact = artifacts?.[0];
    if (!artifact) {
      onOutputAction("No artifact available yet — transform the order first.");
      return;
    }
    onOutputAction("Downloading artifact...");
    setDownloadLoading(true);
    try {
      const data = await apiClient.getDownloadUrl(orderId, artifact.id);
      window.open(data.url, "_blank");
    } catch {
      onOutputAction("Download failed — check your connection and try again.");
    } finally {
      setDownloadLoading(false);
    }
  }

  async function handleCopy() {
    const artifact = artifacts?.[0];
    if (!artifact) {
      onOutputAction("No artifact available yet.");
      return;
    }
    setCopyLoading(true);
    try {
      const data = await apiClient.getDownloadUrl(orderId, artifact.id);
      await navigator.clipboard.writeText(data.url);
      onOutputAction("Output URL copied to clipboard.");
    } catch {
      onOutputAction("Copy failed.");
    } finally {
      setCopyLoading(false);
    }
  }

  // Light-theme cXML syntax palette (sampled from the design render).
  const C = {
    tag:    "#5E3DB0", // element tags  <cXML> etc.
    attr:   "#7A5BC9", // attribute names
    str:    "#345470", // attribute / text values
    ok:     "#1E6D29", // resolved supplier code
    err:    "#C53A3A", // UNRESOLVED
    cmt:    "#9AA3B2", // comments / xml decl
    base:   "#3A4658", // structural text
  };
  const outFmt = outputArtifactType(artifacts);
  const endpointHint = outputArtifactLabel(artifacts, order.supplierName);

  return (
    <div style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", overflow: "hidden" }}>
      {/* Toolbar — title + format badge + format toggle + actions */}
      <div style={{ display: "flex", gap: 8, padding: "8px 10px", alignItems: "center", borderBottom: "1px solid #EEF0F4", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#0B1A2F" }}>
          <span style={{ color: "#8A93A5", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{"<>"}</span>
          Supplier output
        </span>
        <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", background: "#EEE7FB", color: "#5E3DB0", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.03em" }}>{outFmt}</span>
        <div style={{ flex: 1 }} />
        {/* Format toggle */}
        <div style={{ display: "inline-flex", border: "1px solid #E2E6EE", borderRadius: 6, overflow: "hidden" }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 9px", background: "#0B1A2F", color: "#FFFFFF" }}>{outFmt}</span>
          <span style={{ fontSize: 10.5, fontWeight: 500, padding: "3px 9px", background: "#FFFFFF", color: "#8A93A5" }}>JSON</span>
        </div>
        <button
          onClick={handleCopy}
          disabled={copyLoading}
          style={{ fontSize: 10.5, padding: "3px 9px", border: "1px solid #E2E6EE", borderRadius: 6, background: "#FFFFFF", cursor: copyLoading ? "default" : "pointer", color: "#56627A", opacity: copyLoading ? 0.6 : 1 }}
        >
          {copyLoading ? "Copying..." : "Copy"}
        </button>
        <button
          onClick={handleDownload}
          disabled={downloadLoading}
          style={{ fontSize: 10.5, padding: "3px 9px", border: "1px solid #E2E6EE", borderRadius: 6, background: "#FFFFFF", cursor: downloadLoading ? "default" : "pointer", color: "#56627A", opacity: downloadLoading ? 0.6 : 1 }}
        >
          {downloadLoading ? "↓ Downloading..." : "↓ Download"}
        </button>
      </div>

      {/* Code body — light theme */}
      <div style={{ position: "relative", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, lineHeight: 1.65, background: "#FCFCFD", color: C.base, padding: "14px 16px", minHeight: 380 }}>
        {/* Status badge */}
        <div style={{ position: "absolute", top: 10, right: 12, fontSize: 9.5, fontWeight: 700, background: crossed ? "#E2F1E2" : "#EEF3F8", color: crossed ? "#1E6D29" : "#56627A", borderRadius: 4, padding: "2px 7px", fontFamily: "Inter,sans-serif" }}>
          {crossed ? "✓ Sent" : "Will be sent"}
        </div>

        {crossed && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(40,197,94,0.05)", border: "2px solid #28C55E", pointerEvents: "none", transition: "all 300ms" }} />
        )}

        <div style={{ color: C.cmt }}>{'<?xml version="1.0" encoding="UTF-8"?>'}</div>
        <div><span style={{ color: C.tag }}>{"<cXML>"}</span></div>
        <div style={{ paddingLeft: 12 }}><span style={{ color: C.tag }}>{"<Request>"}</span></div>
        <div ref={(el) => onLine?.("po", el)} style={{ paddingLeft: 24 }}>
          <span style={{ color: C.tag }}>{"<OrderRequestHeader "}</span>
          <span style={{ color: C.attr }}>orderID</span>{"="}
          <span style={{ color: C.str }}>&quot;{outPo}&quot;</span>
          {fieldValues["po"] && fieldValues["po"] !== order.poNumber && <span style={{ marginLeft: 8, fontSize: 9, color: "#C97A14" }}>← edited</span>}
        </div>
        <div ref={(el) => onLine?.("date", el)} style={{ paddingLeft: 60 }}>
          <span style={{ color: C.attr }}>orderDate</span>{"="}
          <span style={{ color: C.str }}>&quot;{outDate}&quot;</span>
          <span style={{ color: C.tag }}>{">"}</span>
        </div>
        <div ref={(el) => { onLine?.("currency", el); onLine?.("totals", el); }} style={{ paddingLeft: 32, marginTop: 4, background: "rgba(40,197,94,0.10)", borderLeft: "2px solid #28C55E", paddingTop: 2, paddingBottom: 2 }}>
          <span style={{ color: C.tag }}>{"<Total "}</span><span style={{ color: C.attr }}>currency</span>{"="}<span style={{ color: C.str }}>&quot;{outCurrency}&quot;</span><span style={{ color: C.tag }}>{">"}</span>{outTotal}<span style={{ color: C.tag }}>{"</Total>"}</span>
        </div>
        <div ref={(el) => onLine?.("supplier", el)} style={{ paddingLeft: 32, marginTop: 4 }}>
          <span style={{ color: C.tag }}>{"<ShipFrom>"}</span>{order.supplierName}<span style={{ color: C.tag }}>{"</ShipFrom>"}</span>
        </div>
        <div ref={(el) => onLine?.("buyer", el)} style={{ paddingLeft: 32 }}>
          <span style={{ color: C.tag }}>{"<BillTo>"}</span>
          <span style={{ background: fieldValues["buyer"] ? "rgba(201,122,20,0.14)" : "transparent", color: fieldValues["buyer"] ? "#C97A14" : C.base, padding: "0 2px" }}>{outBuyer}</span>
          <span style={{ color: C.tag }}>{"</BillTo>"}</span>
        </div>
        <div ref={(el) => onLine?.("lines", el)} style={{ paddingLeft: 32, marginTop: 6, color: C.cmt }}>{"<!-- ItemOut entries -->"}</div>
        {previewLines.map((line) => {
          const accepted = acceptedSubnodes.has(line.id);
          const rejected = rejectedSubnodes.has(line.id);
          if (rejected) return null;
          const sku = line.supplierItemCode ?? line.aiSuggestion?.supplierItemCode ?? line.buyerItemCode;
          const isAi  = !line.supplierItemCode && !!line.aiSuggestion && !accepted;
          const isErr = line.needsReview && !line.supplierItemCode && !line.aiSuggestion;
          return (
            <div key={line.id} style={{ paddingLeft: 32, paddingTop: 2, paddingBottom: 2, background: isErr ? "rgba(197,58,58,0.08)" : accepted ? "rgba(40,197,94,0.10)" : isAi ? "rgba(111,79,206,0.07)" : "transparent", borderLeft: isErr ? "2px solid #C53A3A" : accepted ? "2px solid #28C55E" : isAi ? "2px solid #6F4FCE" : "none", transition: "all 200ms" }}>
              <span style={{ color: C.tag }}>{"<ItemOut "}</span>
              <span style={{ color: C.attr }}>quantity</span>{"="}
              <span style={{ color: isErr ? C.err : C.str }}>&quot;{line.quantity}&quot;</span>
              <span style={{ color: C.tag }}>{">"}</span>
              <span style={{ color: C.tag }}>{"<SupplierPartID>"}</span>
              {isErr
                ? <span style={{ color: C.err }}>⚠ UNRESOLVED</span>
                : <span style={{ color: accepted || !isAi ? C.ok : "#7A5BC9" }}>{sku}</span>}
              <span style={{ color: C.tag }}>{"</SupplierPartID>"}</span>
              {isAi && line.aiSuggestion && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#6F4FCE" }}>← AI mapped {Math.round(line.aiSuggestion.confidence * 100)}%</span>}
              {accepted && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: C.ok }}>← accepted ✓</span>}
              {isErr && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: C.err }}>← needs review</span>}
            </div>
          );
        })}
        {order.lines.length > previewLines.length && (
          <div style={{ paddingLeft: 32, color: C.cmt }}>{`<!-- + ${order.lines.length - previewLines.length} more -->`}</div>
        )}
        <div style={{ paddingLeft: 24, marginTop: 4 }}><span style={{ color: C.tag }}>{"</OrderRequestHeader>"}</span></div>
        <div style={{ paddingLeft: 12 }}><span style={{ color: C.tag }}>{"</Request>"}</span></div>
        <div><span style={{ color: C.tag }}>{"</cXML>"}</span></div>
      </div>

      {/* Footer — delivery channel */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", borderTop: "1px solid #EEF0F4", background: "#F6F7FA" }}>
        <span style={{ fontSize: 11, color: "#56627A" }}>
          Delivers via <strong style={{ color: "#0B1A2F", fontWeight: 600 }}>HTTP / webhook</strong>
        </span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{endpointHint}</span>
      </div>
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ exceptionCount, onConfirm, onCancel, supplierName, outputFormat, grandTotal, lineCount }: {
  exceptionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  supplierName: string;
  outputFormat: string;
  grandTotal: string;
  lineCount: number;
}) {
  const [checked, setChecked] = useState(false);
  const checkRef = useRef<HTMLInputElement>(null);

  useEffect(() => { checkRef.current?.focus(); }, []);

  function handleKeyDown(e: globalThis.KeyboardEvent) {
    if (e.key === "Escape") onCancel();
    if (e.key === "Enter" && checked) onConfirm();
  }
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(11,26,47,0.6)", backdropFilter: "blur(4px)", zIndex: 9990 }} onClick={onCancel} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 440, background: "#FFFFFF", borderRadius: 12, boxShadow: "0 24px 64px rgba(11,26,47,0.22)", border: "1px solid #E2E6EE", zIndex: 9991, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 0" }}>
          <div style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 18, fontWeight: 700, color: "#0B1A2F", marginBottom: 6 }}>Send order to supplier?</div>
          <p style={{ fontSize: 13, color: "#56627A", lineHeight: 1.55, margin: 0 }}>
            This will deliver the transformed {outputFormat.toUpperCase()} order to <strong style={{ color: "#0B1A2F" }}>{supplierName}</strong>
          </p>
        </div>

        {/* Summary */}
        <div style={{ margin: "16px 24px", padding: "12px 14px", background: "#F6F7FA", borderRadius: 8, border: "1px solid #E2E6EE" }}>
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "Grand total",    value: grandTotal },
              { label: "Lines",          value: `${lineCount} item${lineCount !== 1 ? "s" : ""}` },
              { label: "Exceptions",     value: `${exceptionCount}`, color: exceptionCount > 0 ? "#C97A14" : "#1DAF50" },
              { label: "Format",         value: outputFormat.toUpperCase() },
            ].map(({ label, value, color }) => (
              <div key={label} style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8A93A5", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: color ?? "#0B1A2F", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Confirmation checkbox */}
        <div style={{ margin: "0 24px 20px", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <input
            ref={checkRef}
            type="checkbox"
            id="confirm-check"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            style={{ marginTop: 2, width: 15, height: 15, accentColor: "#28C55E", cursor: "pointer", flexShrink: 0 }}
          />
          <label htmlFor="confirm-check" style={{ fontSize: 13, color: "#0B1A2F", lineHeight: 1.5, cursor: "pointer" }}>
            I've reviewed the {exceptionCount} exception{exceptionCount !== 1 ? "s" : ""}. Send to {supplierName}.
          </label>
        </div>

        {/* Retry note */}
        <div style={{ margin: "0 24px 20px", padding: "8px 12px", background: "#ECFDF3", borderRadius: 6, fontSize: 11.5, color: "#1DAF50" }}>
          On delivery failure: 3 automatic retries · 30-min intervals · alert to MK
        </div>

        {/* Actions */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E6EE", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "9px 18px", borderRadius: 7, fontSize: 13, fontWeight: 500, background: "#FFFFFF", color: "#56627A", border: "1px solid #E2E6EE", cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={() => checked && onConfirm()}
            disabled={!checked}
            style={{ padding: "9px 24px", borderRadius: 7, fontSize: 13, fontWeight: 600, background: checked ? "#0B1A2F" : "#C6CDDA", color: "#FFFFFF", border: "none", cursor: checked ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: 8, transition: "background 150ms" }}
          >
            Send to supplier →
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "linear-gradient(90deg,#1DAF50,#28C55E)", display: "inline-block" }} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Success toast ────────────────────────────────────────────────────────────

function CrossedToast({ onDismiss, supplierName, poNumber, lineCount }: {
  onDismiss: () => void;
  supplierName: string;
  poNumber: string;
  lineCount: number;
}) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: "#0B1A2F", borderRadius: 10, boxShadow: "0 8px 24px rgba(11,26,47,0.25)", zIndex: 9992, animation: "fade-up 0.3s ease-out both" }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: "#DCFCE7", color: "#1DAF50", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✓</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>Sent to {supplierName} · accepted</div>
        <div style={{ fontSize: 11.5, color: "#7C8DA6", marginTop: 2 }}>{poNumber} · {lineCount} line{lineCount !== 1 ? "s" : ""}</div>
      </div>
      <button onClick={onDismiss} style={{ marginLeft: 8, background: "none", border: "none", color: "#7C8DA6", fontSize: 16, cursor: "pointer", padding: "0 2px" }}>✕</button>
    </div>
  );
}

// ─── Mobile accordion ─────────────────────────────────────────────────────────

interface MobileSpineAccordionProps {
  order: Order;
  nodes: SpineNodeData[];
  editingId: string | null;
  fieldValues: Record<string, string>;
  acceptedSubnodes: Set<string>;
  rejectedSubnodes: Set<string>;
  crossed: boolean;
  onStartEdit: (id: string) => void;
  onChangeValue: (id: string, val: string) => void;
  onCommitEdit: (id: string) => void;
  onAcceptSubnode: (id: string) => void;
  onRejectSubnode: (id: string) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>, id: string) => void;
  inputRef: (el: HTMLInputElement | null, id: string) => void;
  onOutputAction: (msg: string) => void;
  orderId: string;
  artifacts: Order["artifacts"];
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
        style={{ minHeight: 52, borderBottom: open ? "1px solid #E2E6EE" : "none", background: open ? "rgba(40,197,94,0.04)" : "#FFFFFF" }}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span style={{ width: 4, height: 30, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#F0F2F7", color: "#56627A", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{step}</span>
        <span className="min-w-0 flex-1">
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 700, color: "#0B1A2F", lineHeight: 1.2 }}>{label}</span>
          {sub && <span style={{ display: "block", fontSize: 11, color: "#8A93A5", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</span>}
        </span>
        <span style={{ fontSize: 16, color: "#8A93A5", transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms", flexShrink: 0 }}>›</span>
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}

/** Small vertical connector between the stacked mobile sections (keeps the routing concept). */
function MobileFlowConnector() {
  return (
    <div className="flex justify-center" style={{ height: 18 }} aria-hidden>
      <div style={{ width: 2, background: "linear-gradient(180deg,#1DAF50,#28C55E)", borderRadius: 2 }} />
    </div>
  );
}

function MobileSpineAccordion({
  order, nodes, editingId, fieldValues, acceptedSubnodes, rejectedSubnodes,
  crossed, onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onRejectSubnode, onKeyDown, inputRef, onOutputAction,
  orderId, artifacts,
}: MobileSpineAccordionProps) {
  const lineCount = order.lines.length;
  return (
    <div className="xl:hidden flex flex-col px-4 py-4 pb-[88px]">
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
                acceptedSubnodes={acceptedSubnodes}
                rejectedSubnodes={rejectedSubnodes}
                onStartEdit={onStartEdit}
                onChangeValue={onChangeValue}
                onCommitEdit={onCommitEdit}
                onAcceptSubnode={onAcceptSubnode}
                onRejectSubnode={onRejectSubnode}
                onKeyDown={onKeyDown}
                inputRef={inputRef}
              />
            ))}
            {/* Phase 4 — document totals (renders only when enriched) */}
            <TotalsSummary order={order} />
          </div>
        </div>
      </AccordionPanel>

      <MobileFlowConnector />

      <AccordionPanel step={3} label="Supplier output" sub={order.supplierName} accent="#28C55E">
        <OutputPreview
          order={order}
          acceptedSubnodes={acceptedSubnodes}
          rejectedSubnodes={rejectedSubnodes}
          crossed={crossed}
          fieldValues={fieldValues}
          onOutputAction={onOutputAction}
          orderId={orderId}
          artifacts={artifacts}
        />
      </AccordionPanel>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

// ── Stuck-order threshold (mirrors the StuckOrderDetectionJob: 30 min for production,
// but we surface a UI warning much earlier — at 2 min — so operators can investigate
// before the backend job fires.)
const STUCK_WARN_MS = 2 * 60 * 1000; // 2 minutes

export function SpineReview({ orderId }: { orderId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { isLoaded: clerkLoaded, isSignedIn } = useAuth();
  const clerkReady = clerkLoaded && !!isSignedIn;
  // Mock mode has no Clerk session, so gate queries on (mock OR clerkReady) —
  // otherwise mock-mode pages (and the e2e suite) starve on a disabled query.
  const queryEnabled = isApiMockMode || clerkReady;

  // ── Live order data ────────────────────────────────────────────────────────
  const { data: order, isLoading, isError, refetch: refetchOrder } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiClient.getOrderById(orderId),
    enabled: queryEnabled,
    retry: 2,
    retryDelay: 600,
    staleTime: 30_000,
  });

  const { data: auditEvents = [] } = useQuery({
    queryKey: ["order-audit", orderId],
    queryFn: () => apiClient.getOrderAudit(orderId),
    enabled: order?.status === "failed",
    retry: 1,
    staleTime: 60_000,
  });

  // ── Order exceptions (Task 1.G.2) ─────────────────────────────────────────
  const { data: orderExceptions = [] } = useQuery<OrderException[]>({
    queryKey: ["order-exceptions", orderId],
    queryFn: () => getOrderExceptions(orderId),
    enabled: queryEnabled && !!orderId,
    staleTime: 30_000,
    retry: 1,
  });

  // ── Validation mutation (Task 1.F.4) ──────────────────────────────────────
  const [validationResult, setValidationResult] = useState<OrderValidationResult | null>(null);
  const validateMutation = useMutation({
    mutationFn: () => validateOrder(orderId),
    onSuccess: (result) => {
      setValidationResult(result);
      void qc.invalidateQueries({ queryKey: ["order", orderId] });
    },
  });

  // ── Stuck-order detection (Task 0.B.2) ────────────────────────────────────
  const isStuck = useMemo(() => {
    if (!order || order.status !== "parsing") return false;
    const updatedMs = new Date(order.updatedAt).getTime();
    return Number.isFinite(updatedMs) && (Date.now() - updatedMs) > STUCK_WARN_MS;
  }, [order]);

  // Derive nodes from the live order. Empty until the order resolves (the
  // loading/error gates below render before this is used). No demo fallback —
  // real users must never see staged PO-DEMO-001 content.
  const nodes = useMemo(() => (order ? buildNodesFromOrder(order) : []), [order]);
  const connectorNodes = useMemo(() => nodes.map((n) => ({ id: n.id, pct: n.pct, srcRef: n.srcRef })), [nodes]);

  // Sample order banner: query param OR order.isSample
  const searchParams = useSearchParams();
  const isSample = searchParams.get("sample") === "1" || order?.isSample === true;

  // ── State ──────────────────────────────────────────────────────────────────
  const [fieldValues, setFieldValues]             = useState<Record<string, string>>({});
  const [editingId, setEditingId]                 = useState<string | null>(null);
  const [acceptedSubnodes, setAcceptedSubnodes]   = useState<Set<string>>(new Set());
  const [rejectedSubnodes, setRejectedSubnodes]   = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm]             = useState(false);
  const [crossed, setCrossed]                     = useState(false);
  const [showToast, setShowToast]                 = useState(false);
  const [flowNotice, setFlowNotice]               = useState<string | null>(null);
  const [sendState, setSendState]                 = useState<"idle" | "transforming" | "delivering">("idle");
  const [tab, setTab]                             = useState<"review" | "passport" | "response">("review");

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const sourceColRef = useRef<HTMLDivElement>(null);
  const outputColRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({});
  const srcSectionEls = useRef<Record<string, HTMLElement | null>>({});
  const outLineEls = useRef<Record<string, HTMLElement | null>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // activeZone: the document-anatomy zone id (e.g. "header", "lines") currently
  // highlighted. Set bidirectionally — from DocumentAnatomy zone hover OR from
  // canonical SpineNodeCard hover (using node.srcRef).
  const [activeZone, setActiveZone] = useState<string | null>(null);

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

  // Count remaining unresolved exceptions (from live order lines)
  const exceptionCount = (() => {
    if (order) {
      return order.lines.filter(l => l.needsReview && !fieldValues[l.id]).length;
    }
    // fallback for mock
    let n = 0;
    if (!fieldValues["incoterm"] || fieldValues["incoterm"] === "DDP") n++;
    if (!fieldValues["billTo"]) n++;
    n++;
    return Math.max(0, n - acceptedSubnodes.size);
  })();

  // ── Dialog / toast context derived from live order ────────────────────────
  const dialogSupplierName = order?.supplierName ?? "supplier";
  const dialogOutputFormat = order ? outputArtifactType(order.artifacts) : "XML";
  const dialogGrandTotal   = order
    ? (() => {
        const total = order.lines.reduce((s, l) => s + Number(l.unitPrice) * Number(l.quantity), 0);
        return `${order.currency === "EUR" ? "€" : order.currency} ${total.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`;
      })()
    : "—";
  const dialogLineCount    = order?.lines.length ?? 0;

  // ── Edit handlers ──────────────────────────────────────────────────────────
  const handleStartEdit = useCallback((id: string) => {
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    setFieldValues(prev => ({ ...prev, [id]: prev[id] ?? node.value }));
    setEditingId(id);
    setTimeout(() => inputRefs.current[id]?.focus(), 0);
  }, [nodes]);

  const handleChangeValue = useCallback((id: string, val: string) => {
    setFieldValues(prev => ({ ...prev, [id]: val }));
  }, []);

  const handleCommitEdit = useCallback((id: string) => {
    setEditingId(null);
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      handleCommitEdit(id);
      // Tab to next editable field
      if (e.key === "Tab") {
        const editables = nodes.filter(n => n.editable);
        const idx = editables.findIndex(n => n.id === id);
        const next = editables[idx + 1];
        if (next) setTimeout(() => handleStartEdit(next.id), 0);
      }
    }
    if (e.key === "Escape") {
      setEditingId(null);
      // Restore original value
      const node = nodes.find(n => n.id === id);
      if (node) setFieldValues(prev => ({ ...prev, [id]: node.value }));
    }
  }, [handleCommitEdit, handleStartEdit, nodes]);

  const inputRefCallback = useCallback((el: HTMLInputElement | null, id: string) => {
    inputRefs.current[id] = el;
  }, []);

  // ── Subnode accept/reject ──────────────────────────────────────────────────
  const handleAcceptSubnode = useCallback((id: string) => {
    setAcceptedSubnodes(prev => new Set([...prev, id]));
    setRejectedSubnodes(prev => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  const handleRejectSubnode = useCallback((id: string) => {
    setRejectedSubnodes(prev => new Set([...prev, id]));
    setAcceptedSubnodes(prev => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  const pollOrderUntil = useCallback(async (
    predicate: (next: Order) => boolean,
    timeoutMs: number,
  ): Promise<Order> => {
    const started = Date.now();
    let latest: Order | null = null;

    while (Date.now() - started < timeoutMs) {
      latest = await apiClient.getOrderById(orderId);
      if (latest && predicate(latest)) {
        return latest;
      }
      await sleep(900);
    }

    if (latest) return latest;
    throw new Error("Order did not refresh. Check your connection and try again.");
  }, [orderId]);

  // ── Cross the bridge ───────────────────────────────────────────────────────
  const handleConfirm = useCallback(async () => {
    setShowConfirm(false);
    if (!order || sendState !== "idle") return;

    if (order.lines.some(l => l.needsReview)) {
      setFlowNotice("Resolve every missing supplier code before sending this order.");
      return;
    }

    try {
      let current = order;

      if (current.status === "delivered") {
        setCrossed(true);
        setShowToast(true);
        setFlowNotice(finalDeliveryMessage("delivered"));
        return;
      }

      if (current.artifacts.length === 0 && current.status !== "ready_to_deliver") {
        setSendState("transforming");
        setFlowNotice("Generating the supplier-ready output...");
        // No explicit format → backend transforms into the supplier's configured output format.
        await apiClient.transformOrder(orderId);
        current = await pollOrderUntil(
          next =>
            next.status === "ready_to_deliver" ||
            next.status === "delivered" ||
            next.status === "delivery_failed" ||
            next.status === "transform_failed",
          45_000,
        );
      }

      if (current.status === "transform_failed") {
        setFlowNotice(current.errorMessage ?? "Transform failed. Check the output template and try again.");
        return;
      }

      if (current.status === "delivered") {
        setCrossed(true);
        setShowToast(true);
        setFlowNotice(finalDeliveryMessage("delivered"));
        await refetchOrder();
        return;
      }

      if (current.status === "delivery_failed") {
        setFlowNotice(finalDeliveryMessage(current.status, current.errorMessage));
        await refetchOrder();
        return;
      }

      if (current.artifacts.length === 0) {
        setFlowNotice("Output generation has not finished yet. Refresh the order and try again.");
        await refetchOrder();
        return;
      }

      setSendState("delivering");
      setFlowNotice("Sending the generated output to the supplier...");
      await apiClient.redeliverOrder(orderId);
      current = await pollOrderUntil(
        next =>
          next.status === "delivered" ||
          next.status === "delivery_failed" ||
          next.status === "rejected_by_supplier" ||
          next.status === "delivery_dead_letter",
        45_000,
      );

      if (current.status === "delivered") {
        setCrossed(true);
        setShowToast(true);
      }
      setFlowNotice(finalDeliveryMessage(current.status, current.errorMessage));
      await refetchOrder();
    } catch (err) {
      setFlowNotice(err instanceof Error ? err.message : "Send failed. Check the Delivery Log and try again.");
      await refetchOrder();
    } finally {
      setSendState("idle");
    }
  }, [order, orderId, pollOrderUntil, refetchOrder, sendState]);

  const handleSaveDraft = useCallback(() => {
    setFlowNotice("Your review changes stay on this screen. Saved drafts aren't kept after you leave yet — use “Send to supplier” when the order is ready.");
  }, []);

  // ── Keyboard shortcuts (Bridge Layer reference) ────────────────────────────
  // A = accept the next unresolved AI line suggestion · C = open the send/confirm
  // when there are no blocking exceptions. Ignored while typing in a field.
  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || e.metaKey || e.ctrlKey || editingId) return;
      const k = e.key.toLowerCase();
      if (k === "a") {
        for (const n of nodes) {
          const sn = n.subnodes?.find(s => s.ai && !acceptedSubnodes.has(s.id) && !rejectedSubnodes.has(s.id));
          if (sn) { e.preventDefault(); handleAcceptSubnode(sn.id); return; }
        }
      } else if (k === "c") {
        if (!crossed && exceptionCount === 0) { e.preventDefault(); setShowConfirm(true); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [nodes, acceptedSubnodes, rejectedSubnodes, handleAcceptSubnode, crossed, exceptionCount, editingId]);

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
                <HeaderStatusBadge status={order.status} crossed={crossed} exceptionCount={exceptionCount} />
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
              <button
                onClick={handleSaveDraft}
                className="flex-1 justify-center sm:flex-none"
                style={{ height: 34, padding: "0 14px", borderRadius: 7, fontSize: 12.5, fontWeight: 500, background: "#FFFFFF", border: "1px solid #E2E6EE", color: "#0B1A2F", cursor: "pointer" }}
              >
                Save draft
              </button>
              <button
                onClick={() => !crossed && exceptionCount === 0 && sendState === "idle" && setShowConfirm(true)}
                disabled={sendState !== "idle" || (!crossed && exceptionCount > 0)}
                aria-label="Send to supplier"
                className="flex-1 justify-center sm:flex-none"
                style={{
                  height: 34, padding: "0 16px", borderRadius: 7, fontSize: 13, fontWeight: 700,
                  background: crossed ? "#28C55E" : sendState !== "idle" || exceptionCount > 0 ? "#96C69C" : "#28C55E",
                  color: "#FFFFFF", border: "none",
                  cursor: crossed || sendState !== "idle" || exceptionCount > 0 ? "default" : "pointer",
                  display: "flex", alignItems: "center", gap: 8, transition: "background 200ms",
                }}
              >
                <PaperPlaneIcon />
                {crossed ? "Sent" : sendState === "transforming" ? "Generating..." : sendState === "delivering" ? "Sending..." : "Send to supplier"}
              </button>
            </div>
            {!crossed && exceptionCount > 0 && (
              <span className="text-right" style={{ fontSize: 11.5, color: "#8A93A5", paddingRight: 2 }}>
                {exceptionCount} issue{exceptionCount !== 1 ? "s" : ""} to resolve first
              </span>
            )}
          </div>
        </div>

        {flowNotice && (
          <div className="px-4 pb-3 lg:px-6">
            <div
              className="rounded-[7px] px-3 py-2 text-[12px] leading-relaxed"
              style={{
                border: order.status === "rejected_by_supplier"
                  ? "1px solid #F0D2D2"
                  : "1px solid #A6E9BE",
                background: order.status === "rejected_by_supplier"
                  ? "#FFF7F7"
                  : "#ECFDF3",
                color: order.status === "rejected_by_supplier"
                  ? "#C53A3A"
                  : "#1DAF50",
              }}
            >
              {flowNotice}
            </div>
          </div>
        )}
      </div>

      {/* Tabs: Review · Passport · Supplier response */}
      <div className="flex-shrink-0 flex items-center gap-1 px-4 sm:px-5" style={{ background: "#FFFFFF", borderBottom: "1px solid #E2E6EE" }}>
        {([
          { id: "review",   label: "Review" },
          { id: "passport", label: "Passport" },
          { id: "response", label: "Supplier response" },
        ] as const).map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              style={{
                position: "relative", height: 38, padding: "0 12px", background: "none", border: "none",
                fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? "#0B1A2F" : "#56627A", cursor: "pointer",
              }}
            >
              {t.label}
              {active && <span style={{ position: "absolute", left: 8, right: 8, bottom: 0, height: 2, borderRadius: 2, background: "linear-gradient(90deg,#1DAF50,#28C55E)" }} />}
            </button>
          );
        })}
      </div>

      {tab === "review" && (
      <>
      {/* Body */}
      <div style={{ flex: 1, position: "relative", overflow: "auto" }}>
          {isSample && (
            <div
              role="note"
              aria-label="Sample order"
              style={{
                background: "#FFF8E1",
                border: "1px solid #F6D88E",
                color: "#7A5A0A",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                margin: "16px 16px 0",
              }}
            >
              This is a sample order. It uses an example CSV and doesn&apos;t count toward your monthly quota.
            </div>
          )}

          {/* Stuck-order banner (Task 0.B.2) — shown when an order has been in
              "parsing" for more than 2 minutes without progressing. The backend
              StuckOrderDetectionJob fires at 30 min; this banner is an early warning. */}
          {isStuck && (
            <div
              role="alert"
              style={{
                background: "#FAEFD6",
                border: "1px solid #F0D39A",
                color: "#7A4D0A",
                padding: "10px 14px",
                borderRadius: 8,
                fontSize: 13,
                margin: "16px 16px 0",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <span style={{ fontSize: 14 }}>⏳</span>
              <span>
                Still processing — this is taking longer than expected. If it persists, try re-uploading or contact support.
              </span>
            </div>
          )}

          {/* Open exceptions panel (Task 1.G.2) — shows unresolved exceptions inline */}
          {orderExceptions.filter(e => !e.resolvedAt).length > 0 && (
            <div
              style={{
                margin: "16px 16px 0",
                background: "#FFFFFF",
                border: "1px solid #E2E6EE",
                borderRadius: 8,
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "9px 14px", borderBottom: "1px solid #EEF0F4", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#56627A" }}>
                Open exceptions
              </div>
              <div>
                {orderExceptions
                  .filter(e => !e.resolvedAt)
                  .map(ex => {
                    const dotColor = ex.severity === "error" ? "#C53A3A" : ex.severity === "warning" ? "#C97A14" : "#1E66C9";
                    return (
                      <div key={ex.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 14px", borderBottom: "1px solid #F5F6F9" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0, marginTop: 5 }} />
                        <span style={{ fontSize: 12.5, color: "#0B1A2F", flex: 1, lineHeight: 1.45 }}>{ex.message}</span>
                        <span style={{ fontSize: 10.5, color: "#8A93A5", flexShrink: 0, whiteSpace: "nowrap" }}>
                          {new Date(ex.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}

          {/* Validation panel (Task 1.F.4) */}
          <div
            style={{
              margin: "16px 16px 0",
              background: "#FFFFFF",
              border: "1px solid #E2E6EE",
              borderRadius: 8,
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, padding: "9px 14px", borderBottom: "1px solid #EEF0F4" }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#56627A" }}>
                Supplier acceptance
              </span>
              <button
                type="button"
                onClick={() => validateMutation.mutate()}
                disabled={validateMutation.isPending}
                style={{
                  minHeight: 28,
                  padding: "5px 12px",
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  lineHeight: 1.2,
                  background: "#0B1A2F",
                  color: "#FFFFFF",
                  border: "none",
                  cursor: validateMutation.isPending ? "default" : "pointer",
                  opacity: validateMutation.isPending ? 0.7 : 1,
                }}
              >
                {validateMutation.isPending ? "Validating…" : "Validate against profile"}
              </button>
            </div>
            {validateMutation.isError && (
              <div style={{ padding: "8px 14px", fontSize: 12.5, color: "#C53A3A" }}>
                {validateMutation.error instanceof Error
                  ? validateMutation.error.message.includes("404") || validateMutation.error.message.includes("no acceptance")
                    ? "No acceptance profile configured for this supplier."
                    : `Validation failed: ${validateMutation.error.message}`
                  : "Validation failed."}
              </div>
            )}
            {!validationResult && !validateMutation.isError && !validateMutation.isPending && (
              <div style={{ padding: "10px 14px", fontSize: 12.5, color: "#8A93A5" }}>
                Run validation to check this order against the supplier&apos;s acceptance rules.
              </div>
            )}
            {validationResult && (
              <div>
                {/* Overall result */}
                <div style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "8px 14px",
                  borderBottom: "1px solid #EEF0F4",
                  background: validationResult.passed ? "#F0FDF4" : "#FFF7F7",
                }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: validationResult.passed ? "#28C55E" : "#C53A3A", flexShrink: 0 }} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: validationResult.passed ? "#1E6D29" : "#C53A3A" }}>
                    {validationResult.passed ? "Passed — order meets all acceptance rules" : "Failed — acceptance issues found"}
                  </span>
                </div>
                {/* Per-result rows */}
                {validationResult.results.length === 0 ? (
                  <div style={{ padding: "8px 14px", fontSize: 12.5, color: "#8A93A5" }}>No acceptance rules are configured for this supplier yet — nothing to check.</div>
                ) : (
                  validationResult.results.map((r, i) => {
                    const dotColor = r.severity === "error" ? "#C53A3A" : "#C97A14";
                    return (
                      <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 14px", borderBottom: "1px solid #F5F6F9" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: r.passed ? "#28C55E" : dotColor, flexShrink: 0, marginTop: 5 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span style={{ fontSize: 12, color: "#0B1A2F", fontFamily: "'JetBrains Mono',monospace" }}>{r.rule.fieldPath}</span>
                          {r.message && <span style={{ fontSize: 11.5, color: "#56627A", marginLeft: 6 }}>{r.message}</span>}
                          {r.lineNumber != null && <span style={{ fontSize: 10.5, color: "#8A93A5", marginLeft: 4 }}>· line {r.lineNumber}</span>}
                        </div>
                        <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "capitalize", color: r.passed ? "#1E6D29" : dotColor, flexShrink: 0 }}>
                          {r.severity}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        {/* Desktop 3-column triptych (with edge rails). The grid needs ~1120px, so
            it only turns on at xl (1280px); below xl the stacked accordion renders
            instead. This keeps tablets (768–1279px) from getting a clipped/scrolling
            three-column review. */}
        <div className="hidden xl:block min-w-[1120px]">
          <EdgeRails>
          <div className="h-full overflow-y-auto">
            {/* Desktop 3-column grid */}
            <div
              ref={gridRef}
              className="grid gap-[40px] px-6 py-[18px]"
              style={{ gridTemplateColumns: "1fr 1.05fr 1.15fr", alignItems: "start", position: "relative" }}
            >
              {/* Bridge connectors — Source → Spine → Output, drawn as live wires */}
              <SpineConnectors
                gridRef={gridRef}
                sourceColRef={sourceColRef}
                outputColRef={outputColRef}
                nodeEls={nodeEls}
                srcSectionEls={srcSectionEls}
                outLineEls={outLineEls}
                nodes={connectorNodes}
                hoveredId={hoveredId}
                crossed={crossed}
                signature={`${nodes.length}|${editingId ?? ""}|${[...acceptedSubnodes].sort().join(",")}|${[...rejectedSubnodes].sort().join(",")}|${hoveredId ?? ""}|${activeZone ?? ""}|${crossed ? 1 : 0}|${Object.entries(fieldValues).map(([k, v]) => k + v).join(",")}`}
              />

              {/* Left — SOURCE DOCUMENT */}
              <div ref={sourceColRef}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, height: 18, minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#1E66C9", flexShrink: 0 }}>Source document</span>
                  <FileChip type={sourceFileType(order.sourceFileKey)} />
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{sourceFileLabel(order.sourceFileKey)}</span>
                  <span style={{ marginLeft: "auto", fontSize: 9.5, color: "#B4BBC8", flexShrink: 0 }}>hover a zone</span>
                </div>
                <DocumentAnatomy
                  order={order}
                  onSection={(id, el) => { srcSectionEls.current[id] = el; }}
                  activeZone={activeZone}
                  onZoneHover={handleZoneHover}
                />
              </div>

              {/* Center — CANONICAL ORDER (ProcuLink model) */}
              <div style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, height: 18 }}>
                  <span style={{ fontSize: 9.5, color: "#B4BBC8" }}>hover a field</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#0B1A2F" }}>Canonical order</span>
                  <span style={{ fontSize: 9.5, color: "#B4BBC8" }}>ProcuLink model</span>
                </div>
                {/* Canonical spine line */}
                <div style={{ position: "absolute", top: 36, bottom: 0, left: 22, width: 3, background: "linear-gradient(180deg,#1E66C9,#2E8E3A)", borderRadius: 2 }} />
                <div style={{ position: "relative", paddingTop: 4 }}>
                  {nodes.map((node, i) => (
                    <SpineNodeCard
                      key={node.id}
                      node={node}
                      idx={i}
                      editingId={editingId}
                      fieldValues={fieldValues}
                      acceptedSubnodes={acceptedSubnodes}
                      rejectedSubnodes={rejectedSubnodes}
                      onStartEdit={handleStartEdit}
                      onChangeValue={handleChangeValue}
                      onCommitEdit={handleCommitEdit}
                      onAcceptSubnode={handleAcceptSubnode}
                      onRejectSubnode={handleRejectSubnode}
                      onKeyDown={handleKeyDown}
                      inputRef={inputRefCallback}
                      cardRef={(el) => { nodeEls.current[node.id] = el; }}
                      onHover={handleNodeHover}
                      onZoneHover={handleZoneHover}
                      activeZone={activeZone}
                    />
                  ))}
                  {/* Phase 4 — document totals (renders only when enriched) */}
                  <TotalsSummary order={order} />
                </div>
              </div>

              {/* Right — SUPPLIER OUTPUT */}
              <div ref={outputColRef}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, height: 18 }}>
                  <span style={{ fontSize: 9.5, color: "#B4BBC8" }}>canonical → supplier</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#1E6D29" }}>Supplier output</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF", whiteSpace: "nowrap" }}>{outputArtifactType(order.artifacts)}</span>
                </div>
                <OutputPreview
                  order={order}
                  acceptedSubnodes={acceptedSubnodes}
                  rejectedSubnodes={rejectedSubnodes}
                  crossed={crossed}
                  fieldValues={fieldValues}
                  onOutputAction={setFlowNotice}
                  orderId={orderId}
                  artifacts={order.artifacts}
                  onLine={(id, el) => { outLineEls.current[id] = el; }}
                />
              </div>
            </div>
          </div>
          </EdgeRails>
        </div>

        {/* Mobile accordion — sibling of the desktop block, no min-width */}
        <MobileSpineAccordion
          order={order}
          nodes={nodes}
          editingId={editingId}
          fieldValues={fieldValues}
          acceptedSubnodes={acceptedSubnodes}
          rejectedSubnodes={rejectedSubnodes}
          crossed={crossed}
          onStartEdit={handleStartEdit}
          onChangeValue={handleChangeValue}
          onCommitEdit={handleCommitEdit}
          onAcceptSubnode={handleAcceptSubnode}
          onRejectSubnode={handleRejectSubnode}
          onKeyDown={handleKeyDown}
          inputRef={inputRefCallback}
          onOutputAction={setFlowNotice}
          orderId={orderId}
          artifacts={order.artifacts}
        />
      </div>

      {/* Sticky info bar — desktop triptych only (the stacked layout below xl has its own sticky CTA) */}
      <div className="hidden xl:flex flex-shrink-0 bg-white px-6 py-3 items-center gap-5" style={{ borderTop: "1px solid #E2E6EE" }}>
        <div className="min-w-0">
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8A93A5", marginBottom: 2 }}>Grand total</div>
          <div style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 22, fontWeight: 600, color: "#0B1A2F", letterSpacing: "-0.02em", whiteSpace: "nowrap" }}>{dialogGrandTotal}</div>
        </div>
        <div style={{ width: 1, height: 36, background: "#E2E6EE", flexShrink: 0 }} />
        <div className="min-w-0">
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8A93A5", marginBottom: 2 }}>Output</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#0B1A2F", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{order.supplierName} · {dialogOutputFormat}</div>
        </div>
        <div className="ml-auto">
          {!crossed && exceptionCount > 0 && (
            <span className="inline-flex rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold" style={{ background: "#FFF8EA", border: "1px solid #F0D39A", color: "#9A5F0A" }}>
              ⚠ {exceptionCount} exception{exceptionCount !== 1 ? "s" : ""} need review
            </span>
          )}
          {crossed && (
            <span className="inline-flex rounded-[6px] px-2.5 py-1.5 text-[12px] font-semibold" style={{ background: "#ECFDF3", border: "1px solid #A6E9BE", color: "#1DAF50" }}>
              ✓ Sent to supplier
            </span>
          )}
        </div>
      </div>

      {/* Stacked-layout sticky CTA — shown below xl, alongside the accordion */}
      <div
        className="xl:hidden flex-shrink-0 flex gap-2 px-4 py-3"
        style={{ background: "#FFFFFF", borderTop: "1px solid #E2E6EE", boxShadow: "0 -4px 12px rgba(11,26,47,0.08)" }}
      >
        <button
          onClick={handleSaveDraft}
          style={{ flex: 1, height: 44, borderRadius: 8, fontSize: 13.5, fontWeight: 500, background: "#FFFFFF", border: "1px solid #E2E6EE", color: "#0B1A2F", cursor: "pointer" }}
        >
          Save draft
        </button>
        <button
          onClick={() => !crossed && exceptionCount === 0 && sendState === "idle" && setShowConfirm(true)}
          disabled={sendState !== "idle" || (!crossed && exceptionCount > 0)}
          style={{ flex: 1.5, height: 44, borderRadius: 8, fontSize: 13.5, fontWeight: 700, background: crossed ? "#28C55E" : sendState !== "idle" || exceptionCount > 0 ? "#96C69C" : "#28C55E", color: "#FFFFFF", border: "none", cursor: crossed || sendState !== "idle" || exceptionCount > 0 ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "background 200ms" }}
        >
          <PaperPlaneIcon />
          {crossed ? "Sent" : sendState === "transforming" ? "Generating..." : sendState === "delivering" ? "Sending..." : exceptionCount > 0 ? `Resolve ${exceptionCount} to send` : "Send to supplier"}
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

      {/* Supplier response tab */}
      {tab === "response" && (
        <div className="flex-1 overflow-auto px-4 py-5 sm:px-6" style={{ background: "#F6F7FA" }}>
          <div className="mx-auto w-full max-w-[900px]">
            <h2 style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em", color: "#0B1A2F", marginBottom: 4 }}>
              Supplier response
            </h2>
            <p className="text-[12.5px]" style={{ color: "#56627A", marginBottom: 16 }}>
              What {order.supplierName} confirmed back for <span className="font-mono" style={{ color: "#1DAF50" }}>{order.poNumber}</span>.
            </p>
            {order.status === "rejected_by_supplier" && (
              <div className="mb-4 rounded-[8px] px-4 py-3" style={{ border: "1px solid #F0D2D2", borderLeft: "3px solid #C53A3A", background: "#FFF7F7" }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0B1A2F", marginBottom: 4 }}>
                  Supplier rejected this order
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
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
          supplierName={dialogSupplierName}
          outputFormat={dialogOutputFormat}
          grandTotal={dialogGrandTotal}
          lineCount={dialogLineCount}
        />
      )}
      {showToast && (
        <CrossedToast
          onDismiss={() => setShowToast(false)}
          supplierName={dialogSupplierName}
          poNumber={order?.poNumber ?? orderId}
          lineCount={dialogLineCount}
        />
      )}
    </div>
  );
}
