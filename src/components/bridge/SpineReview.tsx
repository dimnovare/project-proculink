"use client";

// Canonical Spine Review — fully interactive ETL review screen.
// AC2: AI accept/reject, inline field editing, confirm dialog, keyboard nav.

import type React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, getOrderExceptions, validateOrder, getSupplierCatalog, getMappingOverride, upsertMappingOverride } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import type { Order, OrderException, OrderValidationResult } from "@/types/procurement";
import type { OrderMappingOverride } from "@/lib/api/types";
import { EdgeRails } from "./EdgeRails";
import { FileChip } from "./FileChip";
import { FailedPanel, ParseFailedPanel } from "./FailedPanels";
import { StatusJourney, type OrderStage } from "./StatusJourney";
import { SpineReviewSkeleton } from "./Skeletons";
import { StandardsFieldPopover } from "./StandardsFieldPopover";
import { SpineConnectors } from "./SpineConnectors";
import { WireDragLayer } from "./WireDragLayer";
import { OutputMappingEditor } from "./OutputMappingEditor";
import { OrderPassport } from "./OrderPassport";
import { SupplierResponsePanel } from "./SupplierResponsePanel";
import { useOrderDirection, type PartyLabels } from "@/hooks/useOrderDirection";

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
    // Header editing (Item 2): date / buyer / currency are editable — the backend
    // /api/orders/{id}/resolve endpoint now accepts optional header corrections
    // ({ orderDate, buyerName, currency }) alongside line resolutions, persisted
    // before transform/deliver. PO number stays read-only (it is the document's
    // identity / dedupe key) and supplier stays read-only (changing it would
    // re-route delivery and remap codes — handled via the supplier picker, not
    // an inline header edit).
    { id: "po",       label: "PO number",   value: order.poNumber,            pct: 99, mono: true,  editable: false, srcRef: "header",  outRef: "Order/@orderID"    },
    { id: "date",     label: "Order date",  value: order.orderDate,            pct: 95, mono: true,  editable: true,  srcRef: "header",  outRef: "Order/orderDate"   },
    { id: "buyer",    label: "Buyer",       value: order.buyerName ?? "(parsing…)", pct: order.buyerName ? 98 : 50, tone: "buyer",    editable: true,  srcRef: "parties", outRef: "BillTo/Contact"    },
    { id: "supplier", label: labels.counterpartyNoun, value: order.supplierName, pct: 97, tone: "supplier", editable: false, srcRef: "parties", outRef: "ShipFrom/Contact", hint: supplierHint, hintTone: "muted" },
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

function finalDeliveryMessage(status: Order["status"], errorMessage: string | null | undefined, labels: PartyLabels): string {
  if (status === "delivered") {
    // Inbound: "Order confirmed." Outbound: "Delivered to supplier." (mechanism identical).
    return `${labels.deliveredLabel}. The audit trail has been updated.`;
  }
  if (status === "delivery_failed") {
    return errorMessage && errorMessage.trim().length > 0
      ? `Delivery failed: ${errorMessage}`
      : "Output generated, but delivery failed. Check the supplier Delivery tab and retry when the endpoint is ready.";
  }
  if (status === "rejected_by_supplier") {
    const noun = labels.counterpartyNoun;
    return errorMessage && errorMessage.trim().length > 0
      ? `${noun} rejected the order: ${errorMessage}`
      : `The ${noun.toLowerCase()} rejected the order. Open the ${noun} response tab for the rejection details.`;
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

/** Visible keyboard-shortcut hint chip (e.g. the "A" next to Accept). */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      aria-hidden
      style={{
        fontFamily: "'JetBrains Mono',monospace",
        fontSize: 9,
        fontWeight: 700,
        lineHeight: 1,
        padding: "2px 5px",
        borderRadius: 4,
        background: "rgba(255,255,255,0.22)",
        border: "1px solid rgba(255,255,255,0.35)",
        color: "inherit",
        textTransform: "uppercase",
      }}
    >
      {children}
    </kbd>
  );
}

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

// Manual supplier-code entry API, threaded into SpineNodeCard so the control
// renders identically on mobile / tablet / desktop (it lives in the shared card,
// not a per-breakpoint block). Persistence goes through the SAME /resolve path as
// Accept (commitMappings + refetch) so the server needsReview send-guard clears.
interface LineEditApi {
  /** Datalist typeahead codes (supplier catalog ∪ saved mappings). */
  knownCodes: string[];
  /** The supplier's CATALOG codes — the ground truth of valid codes. Empty if no catalog uploaded. */
  catalogCodes: string[];
  /** Supplier display name, for the "not in {supplier}'s catalog" warning. */
  supplierName: string;
  /** Line id currently in manual-entry mode (only one at a time), or null. */
  editId: string | null;
  /** Current draft text in the manual-entry input. */
  draft: string;
  onStart: (lineId: string, initial: string) => void;
  onChange: (value: string) => void;
  onCommit: (lineId: string) => void;
  onCancel: () => void;
}

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
  /** Line id whose Accept is currently committing to the server (disables its buttons). */
  acceptingLineId?: string | null;
  /** Manual supplier-code entry API (renders the "Set supplier code" control). */
  lineEdit?: LineEditApi;
}

// Manual supplier-code entry row for an unresolved line. Free text + a native
// <datalist> typeahead of the supplier's known codes (zero deps, accessible).
// Enter commits, Escape cancels. Persistence is the caller's job (commitMappings).
function ManualCodeRow({ sn, lineEdit, saving }: { sn: SubNode; lineEdit: LineEditApi; saving: boolean }) {
  const listId = `known-codes-${sn.id}`;
  const draft = lineEdit.draft.trim();
  const hasCatalog = lineEdit.catalogCodes.length > 0;
  // Strong, ground-truth signal: the supplier has a catalog and this isn't one of its codes.
  const notInCatalog = hasCatalog && draft.length > 0 && !lineEdit.catalogCodes.includes(draft);
  // Soft signal (only when there's no catalog to check against): unseen in saved mappings.
  const novel = !hasCatalog && draft.length > 0 && lineEdit.knownCodes.length > 0 && !lineEdit.knownCodes.includes(draft);
  return (
    <div style={{ marginLeft: 21, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input
        autoFocus
        list={lineEdit.knownCodes.length ? listId : undefined}
        value={lineEdit.draft}
        onChange={(e) => lineEdit.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); lineEdit.onCommit(sn.id); }
          if (e.key === "Escape") { e.preventDefault(); lineEdit.onCancel(); }
        }}
        placeholder="Supplier code"
        aria-label={`Supplier code for line ${sn.lineNo ?? sn.sku}`}
        disabled={saving}
        style={{ flex: "1 1 140px", minWidth: 120, minHeight: 32, border: "1px solid #2E8E3A", borderRadius: 6, padding: "5px 8px", fontSize: 12, fontFamily: "'JetBrains Mono',monospace", background: "#F0FDF4", color: "#0B1A2F", outline: "none" }}
      />
      {lineEdit.knownCodes.length > 0 && (
        <datalist id={listId}>
          {lineEdit.knownCodes.map((c) => <option key={c} value={c} />)}
        </datalist>
      )}
      <button
        type="button"
        onClick={() => lineEdit.onCommit(sn.id)}
        disabled={saving || draft.length === 0}
        style={{ fontSize: 11, fontWeight: 700, padding: "6px 12px", borderRadius: 6, border: "none", background: "#2E8E3A", color: "#FFFFFF", cursor: saving || draft.length === 0 ? "default" : "pointer", opacity: saving || draft.length === 0 ? 0.55 : 1, minHeight: 32 }}
      >
        {saving ? "Saving…" : "Save"}
      </button>
      <button
        type="button"
        onClick={lineEdit.onCancel}
        disabled={saving}
        style={{ fontSize: 11, fontWeight: 600, padding: "6px 10px", borderRadius: 6, border: "none", background: "transparent", color: "#8A93A5", cursor: saving ? "default" : "pointer", minHeight: 32 }}
      >
        Cancel
      </button>
      {notInCatalog && (
        <span style={{ flexBasis: "100%", fontSize: 9.5, color: "#C53A3A" }}>
          ⚠ Not in {lineEdit.supplierName || "the supplier"}&apos;s catalog — double-check this is a real supplier code.
        </span>
      )}
      {novel && (
        <span style={{ flexBasis: "100%", fontSize: 9.5, color: "#C97A14" }}>
          Not in saved mappings — it&apos;ll be remembered for next time.
        </span>
      )}
    </div>
  );
}

function SpineNodeCard({
  node, idx,
  editingId, fieldValues,
  acceptedSubnodes, rejectedSubnodes,
  onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onRejectSubnode,
  onKeyDown, inputRef, cardRef, onHover, onZoneHover, activeZone,
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
      onMouseEnter={() => { onHover?.(node.id); onZoneHover?.(node.srcRef); }}
      onMouseLeave={() => { onHover?.(null); onZoneHover?.(null); }}
    >
      {/* Canonical-order node dot */}
      <div
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
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8A93A5", flex: 1, display: "inline-flex", alignItems: "center", gap: 4 }}>
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
              border: "1px solid #2E8E3A",
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
                    {accepted   && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#1E6D29", flexShrink: 0 }}>✓</span>}
                    {rejected   && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#C53A3A", flexShrink: 0 }}>✗</span>}
                  </div>

                  {/* Error line with no AI suggestion — manual supplier-code entry.
                      Lives in the shared card, so it works on mobile/tablet/desktop.
                      This closes the dead-end where an unresolved line had no way to
                      be fixed (the #1 review gap). */}
                  {sn.err && !showAiCard && !done && lineEdit && lineEdit.editId === sn.id && (
                    <ManualCodeRow sn={sn} lineEdit={lineEdit} saving={acceptingLineId === sn.id} />
                  )}
                  {sn.err && !showAiCard && !done && lineEdit && lineEdit.editId !== sn.id && (
                    <div style={{ marginLeft: 21, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 10, fontWeight: 600, color: "#C53A3A", display: "inline-flex", alignItems: "center", gap: 5 }}>
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
                  {sn.err && !showAiCard && !done && !lineEdit && (
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
                        {(() => {
                          const accepting = acceptingLineId === sn.id;
                          return (
                            <>
                              <button
                                type="button"
                                aria-label={`Accept AI suggestion for line ${sn.lineNo ?? sn.sku}`}
                                onClick={() => onAcceptSubnode(sn.id)}
                                disabled={accepting}
                                style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "7px 14px", borderRadius: 6, border: "none", background: "#6F4FCE", color: "#FFFFFF", cursor: accepting ? "default" : "pointer", opacity: accepting ? 0.6 : 1 }}
                                title="Accept the AI-suggested code (shortcut: A)"
                              >
                                {accepting ? "Saving…" : "✓ Accept"}
                                {!accepting && si === 0 && <Kbd>A</Kbd>}
                              </button>
                              <button
                                type="button"
                                aria-label={`Reject AI suggestion for line ${sn.lineNo ?? sn.sku}`}
                                onClick={() => onRejectSubnode(sn.id)}
                                disabled={accepting}
                                style={{ fontSize: 11, fontWeight: 600, padding: "7px 11px", borderRadius: 6, border: "none", background: "transparent", color: "#8A93A5", cursor: accepting ? "default" : "pointer", opacity: accepting ? 0.6 : 1 }}
                              >
                                Reject
                              </button>
                              {lineEdit && lineEdit.editId !== sn.id && (
                                <button
                                  type="button"
                                  aria-label={`Enter a supplier code manually for line ${sn.lineNo ?? sn.sku}`}
                                  onClick={() => lineEdit.onStart(sn.id, sn.aiSuggestedCode ?? "")}
                                  disabled={accepting}
                                  style={{ fontSize: 11, fontWeight: 600, padding: "7px 11px", borderRadius: 6, border: "none", background: "transparent", color: "#6F4FCE", cursor: accepting ? "default" : "pointer", opacity: accepting ? 0.6 : 1 }}
                                >
                                  Enter manually
                                </button>
                              )}
                            </>
                          );
                        })()}
                      </div>
                      {lineEdit && lineEdit.editId === sn.id && (
                        <div style={{ marginTop: 8, marginLeft: -21 }}>
                          <ManualCodeRow sn={sn} lineEdit={lineEdit} saving={acceptingLineId === sn.id} />
                        </div>
                      )}
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
//
// NOTE: there is no static per-zone confidence map. Zone tints are driven by the
// real per-zone confidences derived from live order data inside DocumentAnatomy.

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
  // Show every parsed line — no cap. A hidden line beyond a slice cap could still
  // be the one tripping the send guard; the reviewer must be able to see it.
  const previewLines = order.lines;

  // Per-section confidence used by the zone rail. Derived from live data so it
  // tracks the real order (header/parties high; lines = avg; terms lower when
  // currency/terms are softer signals).
  const headerConf  = order.buyerName ? 99 : 60;
  const partiesConf = order.buyerName ? 95 : 70;
  const linesConf   = avgConf ?? 80;
  const termsConf   = Math.max(60, Math.min(88, (avgConf ?? 80) - 10));

  // Real per-zone confidences, keyed by zone id. Only zones backed by live data
  // appear here; zones without a real confidence (e.g. totals) fall through to a
  // neutral tint rather than asserting an invented green/amber/red.
  const zoneConf: Record<string, number> = {
    header: headerConf,
    parties: partiesConf,
    lines: linesConf,
    terms: termsConf,
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

  return (
    <div style={{ borderRadius: 8, padding: 10, background: "#F6F7FA", border: "1px solid #E2E6EE", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9.5, color: "#8A93A5" }}>Reconstructed from parsed fields</span>
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
  // Power-user "map & manipulate" editor (heart-piece-flex Phase 3).
  const [mapOpen, setMapOpen] = useState(false);

  // Output reflects the live order, with any inline edits applied.
  const outPo       = fieldValues["po"]       ?? order.poNumber;
  const outDate     = fieldValues["date"]     ?? order.orderDate;
  const outCurrency = fieldValues["currency"] ?? order.currency;
  const outBuyer    = fieldValues["buyer"]    ?? order.buyerName ?? "—";
  const outTotal    = formatMoney(outCurrency, resolvedGrandTotal(order));
  // Show every line in the mapping preview — no cap, matching the canonical spine.
  const previewLines = order.lines;

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
  // Only render the cXML scaffold when the supplier's configured output IS cXML.
  // For any other format (CSV/UBL/EDIFACT/X12…) emitting cXML tags would lie
  // about what gets delivered, so we show a neutral canonical mapping view and
  // label the panel honestly. The actual delivered artifact is downloadable.
  const isCxmlOutput = outFmt.toLowerCase() === "cxml";

  return (
    <div style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", overflow: "hidden" }}>
      <OutputMappingEditor orderId={orderId} open={mapOpen} onClose={() => setMapOpen(false)} />
      {/* Toolbar — title + format badge + actions */}
      <div style={{ display: "flex", gap: 8, padding: "8px 10px", alignItems: "center", borderBottom: "1px solid #EEF0F4", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#0B1A2F" }}>
          <span style={{ color: "#8A93A5", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{"<>"}</span>
          Canonical mapping preview
        </span>
        <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", background: "#EEE7FB", color: "#5E3DB0", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.03em" }} title="The supplier's configured output format. The delivered file matches this format.">{outFmt}</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setMapOpen(true)}
          title="Map &amp; manipulate each output field, per order (power user)"
          style={{ fontSize: 10.5, padding: "3px 9px", border: "1px solid #1E66C9", borderRadius: 6, background: "#FFFFFF", cursor: "pointer", color: "#1E66C9", fontWeight: 600 }}
        >
          Edit mapping
        </button>
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
          <div style={{ position: "absolute", inset: 0, background: "rgba(46,142,58,0.05)", border: "2px solid #2E8E3A", pointerEvents: "none", transition: "all 300ms" }} />
        )}

        {isCxmlOutput ? (
          /* The supplier's configured output IS cXML — show the cXML scaffold. */
          <>
            <div style={{ color: C.cmt }}>{'<?xml version="1.0" encoding="UTF-8"?>'}</div>
            <div><span style={{ color: C.tag }}>{"<cXML>"}</span></div>
            <div style={{ paddingLeft: 12 }}><span style={{ color: C.tag }}>{"<Request>"}</span></div>
            <div ref={(el) => onLine?.("po", el)} style={{ paddingLeft: 24 }}>
              <span style={{ color: C.tag }}>{"<OrderRequestHeader "}</span>
              <span style={{ color: C.attr }}>orderID</span>{"="}
              <span style={{ color: C.str }}>&quot;{outPo}&quot;</span>
            </div>
            <div ref={(el) => onLine?.("date", el)} style={{ paddingLeft: 60 }}>
              <span style={{ color: C.attr }}>orderDate</span>{"="}
              <span style={{ color: C.str }}>&quot;{outDate}&quot;</span>
              <span style={{ color: C.tag }}>{">"}</span>
            </div>
            <div ref={(el) => { onLine?.("currency", el); onLine?.("totals", el); }} style={{ paddingLeft: 32, marginTop: 4, background: "rgba(46,142,58,0.10)", borderLeft: "2px solid #2E8E3A", paddingTop: 2, paddingBottom: 2 }}>
              <span style={{ color: C.tag }}>{"<Total "}</span><span style={{ color: C.attr }}>currency</span>{"="}<span style={{ color: C.str }}>&quot;{outCurrency}&quot;</span><span style={{ color: C.tag }}>{">"}</span>{outTotal}<span style={{ color: C.tag }}>{"</Total>"}</span>
            </div>
            <div ref={(el) => onLine?.("supplier", el)} style={{ paddingLeft: 32, marginTop: 4 }}>
              <span style={{ color: C.tag }}>{"<ShipFrom>"}</span>{order.supplierName}<span style={{ color: C.tag }}>{"</ShipFrom>"}</span>
            </div>
            <div ref={(el) => onLine?.("buyer", el)} style={{ paddingLeft: 32 }}>
              <span style={{ color: C.tag }}>{"<BillTo>"}</span>
              <span style={{ color: C.base, padding: "0 2px" }}>{outBuyer}</span>
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
                <div key={line.id} style={{ paddingLeft: 32, paddingTop: 2, paddingBottom: 2, background: isErr ? "rgba(197,58,58,0.08)" : accepted ? "rgba(46,142,58,0.10)" : isAi ? "rgba(111,79,206,0.07)" : "transparent", borderLeft: isErr ? "2px solid #C53A3A" : accepted ? "2px solid #2E8E3A" : isAi ? "2px solid #6F4FCE" : "none", transition: "all 200ms" }}>
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
            <div style={{ paddingLeft: 24, marginTop: 4 }}><span style={{ color: C.tag }}>{"</OrderRequestHeader>"}</span></div>
            <div style={{ paddingLeft: 12 }}><span style={{ color: C.tag }}>{"</Request>"}</span></div>
            <div><span style={{ color: C.tag }}>{"</cXML>"}</span></div>
          </>
        ) : (
          /* Neutral canonical mapping view — no format-specific tags. Shows the
             field → value mapping that gets serialized into the supplier's actual
             format ({outFmt}) on transform. Honest: doesn't pretend to be cXML. */
          <>
            <div style={{ color: C.cmt, marginBottom: 6 }}>{`// canonical → ${outFmt} on transform`}</div>
            {([
              { id: "po",       label: "po_number",  value: outPo },
              { id: "date",     label: "order_date", value: outDate },
              { id: "supplier", label: "supplier",   value: order.supplierName },
              { id: "buyer",    label: "buyer",       value: outBuyer },
              { id: "currency", label: "currency",    value: outCurrency },
              { id: "totals",   label: "grand_total", value: outTotal },
            ] as const).map((row) => (
              <div
                key={row.id}
                ref={(el) => onLine?.(row.id, el)}
                style={{ display: "flex", gap: 8, paddingTop: 2, paddingBottom: 2, ...(row.id === "totals" ? { background: "rgba(46,142,58,0.10)", borderLeft: "2px solid #2E8E3A", paddingLeft: 6 } : {}) }}
              >
                <span style={{ color: C.attr, minWidth: 96, flexShrink: 0 }}>{row.label}</span>
                <span style={{ color: C.cmt }}>:</span>
                <span style={{ color: C.str }}>{row.value}</span>
              </div>
            ))}
            <div ref={(el) => onLine?.("lines", el)} style={{ marginTop: 8, color: C.cmt }}>{`// ${previewLines.filter(l => !rejectedSubnodes.has(l.id)).length} line item(s)`}</div>
            {previewLines.map((line) => {
              const accepted = acceptedSubnodes.has(line.id);
              const rejected = rejectedSubnodes.has(line.id);
              if (rejected) return null;
              const sku = line.supplierItemCode ?? line.aiSuggestion?.supplierItemCode ?? line.buyerItemCode;
              const isAi  = !line.supplierItemCode && !!line.aiSuggestion && !accepted;
              const isErr = line.needsReview && !line.supplierItemCode && !line.aiSuggestion;
              return (
                <div key={line.id} style={{ display: "flex", gap: 8, paddingTop: 2, paddingBottom: 2, background: isErr ? "rgba(197,58,58,0.08)" : accepted ? "rgba(46,142,58,0.10)" : isAi ? "rgba(111,79,206,0.07)" : "transparent", borderLeft: isErr ? "2px solid #C53A3A" : accepted ? "2px solid #2E8E3A" : isAi ? "2px solid #6F4FCE" : "none", paddingLeft: 6, transition: "all 200ms" }}>
                  <span style={{ color: C.cmt, minWidth: 24, flexShrink: 0, textAlign: "right" }}>{line.lineNumber}</span>
                  <span style={{ color: isErr ? C.err : (accepted || !isAi ? C.ok : "#7A5BC9"), flexShrink: 0 }}>
                    {isErr ? "⚠ UNRESOLVED" : sku}
                  </span>
                  <span style={{ color: C.cmt }}>×{line.quantity}</span>
                  {isAi && line.aiSuggestion && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: "#6F4FCE" }}>← AI mapped {Math.round(line.aiSuggestion.confidence * 100)}%</span>}
                  {accepted && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: C.ok }}>← accepted ✓</span>}
                  {isErr && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: C.err }}>← needs review</span>}
                </div>
              );
            })}
          </>
        )}
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

function ConfirmDialog({ exceptionCount, onConfirm, onCancel, supplierName, outputFormat, grandTotal, lineCount, labels, failingRuleCount }: {
  exceptionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
  supplierName: string;
  outputFormat: string;
  grandTotal: string;
  lineCount: number;
  labels: PartyLabels;
  /** Number of acceptance-profile rules that FAILED the last validation; 0 if it passed or wasn't run. Requires an explicit ack before send. */
  failingRuleCount: number;
}) {
  const inbound = labels.counterpartyNoun === "Customer";
  const [checked, setChecked] = useState(false);
  // Second acknowledgement, required only when validation flagged failing rules.
  const [ackValidation, setAckValidation] = useState(false);
  const canConfirm = checked && (failingRuleCount === 0 || ackValidation);
  const checkRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = "spine-confirm-title";

  // Move focus into the dialog on open and restore it to the previously-focused
  // element (the Send button) when the dialog closes.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    checkRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  function handleKeyDown(e: globalThis.KeyboardEvent) {
    if (e.key === "Escape") { onCancel(); return; }
    if (e.key === "Enter" && canConfirm) { onConfirm(); return; }
    // Focus trap — keep Tab within the dialog's focusable elements.
    if (e.key === "Tab" && dialogRef.current) {
      const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    }
  }
  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <>
      <div style={{ position: "fixed", inset: 0, background: "rgba(11,26,47,0.6)", backdropFilter: "blur(4px)", zIndex: 9990 }} onClick={onCancel} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 440, background: "#FFFFFF", borderRadius: 12, boxShadow: "0 24px 64px rgba(11,26,47,0.22)", border: "1px solid #E2E6EE", zIndex: 9991, overflow: "hidden" }}
      >
        {/* Header */}
        <div style={{ padding: "20px 24px 0" }}>
          <div id={titleId} style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 18, fontWeight: 700, color: "#0B1A2F", marginBottom: 6 }}>{inbound ? "Confirm this order?" : "Send order to supplier?"}</div>
          <p style={{ fontSize: 13, color: "#56627A", lineHeight: 1.55, margin: 0 }}>
            This will {inbound ? "confirm" : "deliver"} the transformed {outputFormat.toUpperCase()} order {inbound ? "for" : "to"} <strong style={{ color: "#0B1A2F" }}>{supplierName}</strong>
          </p>
        </div>

        {/* Summary */}
        <div style={{ margin: "16px 24px", padding: "12px 14px", background: "#F6F7FA", borderRadius: 8, border: "1px solid #E2E6EE" }}>
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "Grand total",    value: grandTotal },
              { label: "Lines",          value: `${lineCount} item${lineCount !== 1 ? "s" : ""}` },
              { label: "Exceptions",     value: `${exceptionCount}`, color: exceptionCount > 0 ? "#C97A14" : "#1E6D29" },
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
            style={{ marginTop: 2, width: 15, height: 15, accentColor: "#2E8E3A", cursor: "pointer", flexShrink: 0 }}
          />
          <label htmlFor="confirm-check" style={{ fontSize: 13, color: "#0B1A2F", lineHeight: 1.5, cursor: "pointer" }}>
            I've reviewed the {exceptionCount} exception{exceptionCount !== 1 ? "s" : ""}. {inbound ? `Confirm for ${supplierName}` : `Send to ${supplierName}`}.
          </label>
        </div>

        {/* Validation-failure acknowledgement — only when the last "Validate
            against profile" run found failing acceptance rules. Doesn't hard-block
            (the supplier may still accept), but requires an explicit ack. */}
        {failingRuleCount > 0 && (
          <div style={{ margin: "0 24px 20px", padding: "10px 12px", background: "#FFF7F7", border: "1px solid #F0D2D2", borderRadius: 6 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "#C53A3A", marginBottom: 6 }}>
              ⚠ {failingRuleCount} acceptance rule{failingRuleCount !== 1 ? "s" : ""} failed validation
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <input
                type="checkbox"
                id="confirm-ack-validation"
                checked={ackValidation}
                onChange={(e) => setAckValidation(e.target.checked)}
                style={{ marginTop: 2, width: 15, height: 15, accentColor: "#C53A3A", cursor: "pointer", flexShrink: 0 }}
              />
              <label htmlFor="confirm-ack-validation" style={{ fontSize: 12.5, color: "#0B1A2F", lineHeight: 1.5, cursor: "pointer" }}>
                Send anyway — I understand this order doesn&apos;t meet {supplierName}&apos;s acceptance rules and may be rejected.
              </label>
            </div>
          </div>
        )}

        {/* Retry note */}
        <div style={{ margin: "0 24px 20px", padding: "8px 12px", background: "#ECFDF3", borderRadius: 6, fontSize: 11.5, color: "#1E6D29" }}>
          On delivery failure: 3 automatic retries · 30-min intervals · we&apos;ll email you
        </div>

        {/* Actions */}
        <div style={{ padding: "14px 24px", borderTop: "1px solid #E2E6EE", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "9px 18px", borderRadius: 7, fontSize: 13, fontWeight: 500, background: "#FFFFFF", color: "#56627A", border: "1px solid #E2E6EE", cursor: "pointer" }}>
            Cancel
          </button>
          <button
            onClick={() => canConfirm && onConfirm()}
            disabled={!canConfirm}
            style={{ padding: "9px 24px", borderRadius: 7, fontSize: 13, fontWeight: 600, background: canConfirm ? "#0B1A2F" : "#C6CDDA", color: "#FFFFFF", border: "none", cursor: canConfirm ? "pointer" : "not-allowed", display: "flex", alignItems: "center", gap: 8, transition: "background 150ms" }}
          >
            {labels.primaryCta} →
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "linear-gradient(90deg,#1E6D29,#2E8E3A)", display: "inline-block" }} />
          </button>
        </div>
      </div>
    </>
  );
}

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
      <div style={{ width: 2, background: "linear-gradient(180deg,#1E6D29,#2E8E3A)", borderRadius: 2 }} />
    </div>
  );
}

function MobileSpineAccordion({
  order, nodes, editingId, fieldValues, acceptedSubnodes, rejectedSubnodes,
  crossed, onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onRejectSubnode, onKeyDown, inputRef, onOutputAction,
  orderId, artifacts, acceptingLineId, lineEdit,
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
                acceptedSubnodes={acceptedSubnodes}
                rejectedSubnodes={rejectedSubnodes}
                onStartEdit={onStartEdit}
                onChangeValue={onChangeValue}
                onCommitEdit={onCommitEdit}
                onAcceptSubnode={onAcceptSubnode}
                onRejectSubnode={onRejectSubnode}
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
  order, nodes, editingId, fieldValues, acceptedSubnodes, rejectedSubnodes,
  crossed, onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onRejectSubnode, onKeyDown, inputRef, onOutputAction,
  orderId, artifacts, acceptingLineId, lineEdit,
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
                acceptedSubnodes={acceptedSubnodes}
                rejectedSubnodes={rejectedSubnodes}
                onStartEdit={onStartEdit}
                onChangeValue={onChangeValue}
                onCommitEdit={onCommitEdit}
                onAcceptSubnode={onAcceptSubnode}
                onRejectSubnode={onRejectSubnode}
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
              acceptedSubnodes={acceptedSubnodes}
              rejectedSubnodes={rejectedSubnodes}
              crossed={crossed}
              fieldValues={fieldValues}
              onOutputAction={onOutputAction}
              orderId={orderId}
              artifacts={order.artifacts}
            />
          </div>
        </div>
      </div>
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
  // Direction-aware labels: inbound relabels the green primary action to
  // "Confirm order" and its progress/done states (mechanism UNCHANGED — still
  // transform + deliver). Output-artifact labels (cXML/"Output") stay neutral.
  const { labels } = useOrderDirection();
  // Mock mode AND live QA-bypass e2e have no Clerk session, so gate queries via
  // useQueriesEnabled (mock OR qa-bypass OR signed-in) — otherwise those pages
  // (and the e2e suite) starve on a disabled query.
  const queryEnabled = useQueriesEnabled();

  // ── Live order data ────────────────────────────────────────────────────────
  const { data: order, isLoading, isError, refetch: refetchOrder } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiClient.getOrderById(orderId),
    enabled: queryEnabled,
    retry: 2,
    retryDelay: 600,
    staleTime: 30_000,
    // Auto-refresh while the pipeline is mid-flight so the screen updates on its
    // own (parse → transform → deliver) instead of looking stuck until the 2-min
    // banner fires. Stops polling once the order reaches a terminal state.
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === "parsing" || s === "transforming" || s === "ready_to_deliver" ? 3_000 : false;
    },
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

  // Bumped after each successful wire upsert — added to the SpineConnectors
  // signature so it schedules a re-measure.
  const [wireSig, setWireSig] = useState(0);

  // Debounced upsert ref — we cancel any pending save when a new drop comes in
  // so rapid reconnects don't send stale payloads.
  const wireDebRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const nodes = useMemo(() => (order ? buildNodesFromOrder(order, labels) : []), [order, labels]);
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
  // Severity drives the flow-notice colour (info/success/error) so failure
  // messages don't render green just because order.status isn't "rejected".
  // setFlow sets both; when severity is omitted it is INFERRED from failure
  // keywords in the message, so the OutputPreview/mobile callsites that pass
  // a bare message string still colour errors correctly.
  const [flowSeverity, setFlowSeverity]           = useState<"info" | "success" | "error">("info");
  const setFlow = useCallback((message: string | null, severity?: "info" | "success" | "error") => {
    setFlowNotice(message);
    if (severity) { setFlowSeverity(severity); return; }
    const m = (message ?? "").toLowerCase();
    setFlowSeverity(/fail|failed|reject|error|couldn't|could not|exhausted|unresolved|resolve every/.test(m) ? "error" : "info");
  }, []);

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

  const [sendState, setSendState]                 = useState<"idle" | "transforming" | "delivering">("idle");
  const [tab, setTab]                             = useState<"review" | "passport" | "response">("review");
  // The line id currently being resolved against the backend (Accept in-flight).
  const [acceptingLineId, setAcceptingLineId]     = useState<string | null>(null);
  // The header field id (date/buyer/currency) whose correction is being persisted.
  const [savingHeaderId, setSavingHeaderId]       = useState<string | null>(null);
  // Manual supplier-code entry: which line (id) is in edit mode + its draft text.
  const [lineEditId, setLineEditId]               = useState<string | null>(null);
  const [lineDraft, setLineDraft]                 = useState<string>("");

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

  // Count remaining unresolved exceptions from SERVER truth. Accepting an AI
  // suggestion now persists via /resolve + refetch, so needsReview flips to false
  // on the server — no local-state subtraction is needed (or correct) here.
  const exceptionCount = (() => {
    if (order) {
      return order.lines.filter(l => l.needsReview).length;
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
  // Grand total shown in the header, sticky bar AND confirm dialog. Must use the
  // backend-extracted grandTotal (via resolvedGrandTotal) so it matches the
  // TotalsSummary block — a raw Σ(price×qty) ignores backend tax/discount and
  // contradicts the document on real POs.
  const dialogGrandTotal   = order
    ? formatMoney(order.currency, resolvedGrandTotal(order))
    : "—";
  const dialogLineCount    = order?.lines.length ?? 0;
  // Count failing acceptance-profile rules from the last "Validate against
  // profile" run. A failed validation doesn't hard-block send (the supplier may
  // still accept), but the user must explicitly acknowledge it in the confirm
  // dialog before sending — surfaced as a required second checkbox.
  const failingRuleCount = validationResult && !validationResult.passed
    ? validationResult.results.filter(r => !r.passed).length
    : 0;

  // ── Edit handlers ──────────────────────────────────────────────────────────
  const handleStartEdit = useCallback((id: string) => {
    // Don't re-open a field whose previous edit is still persisting.
    if (savingHeaderId) return;
    const node = nodes.find(n => n.id === id);
    if (!node) return;
    setFieldValues(prev => ({ ...prev, [id]: prev[id] ?? node.value }));
    setEditingId(id);
    setTimeout(() => inputRefs.current[id]?.focus(), 0);
  }, [nodes, savingHeaderId]);

  const handleChangeValue = useCallback((id: string, val: string) => {
    setFieldValues(prev => ({ ...prev, [id]: val }));
  }, []);

  // Header fields that map to a backend resolve correction. PO# + supplier are
  // intentionally absent (read-only). Each maps the node id to the resolve
  // payload key and the order's current persisted value (for change detection).
  const headerFieldMap: Record<string, { key: "orderDate" | "buyerName" | "currency"; current: string }> = useMemo(() => ({
    date:     { key: "orderDate", current: order?.orderDate ?? "" },
    buyer:    { key: "buyerName", current: order?.buyerName ?? "" },
    currency: { key: "currency",  current: order?.currency ?? "" },
  }), [order]);

  const handleCommitEdit = useCallback((id: string) => {
    setEditingId(null);

    const header = headerFieldMap[id];
    if (!header || !order) return;
    if (savingHeaderId === id) return;       // a save for this field is already in flight

    const raw = fieldValues[id];
    if (raw === undefined) return;           // never edited
    const next = raw.trim();
    if (next === "" || next === header.current) return; // blank or unchanged → no-op

    // Persist the single edited header field via the resolve endpoint (empty
    // line resolutions — the backend treats absent line work + present header
    // field as a header-only correction). Refetch on success so the persisted
    // value renders from server truth.
    setSavingHeaderId(id);
    setFlow("Saving change…", "info");
    void (async () => {
      try {
        await apiClient.commitMappings(orderId, [], { [header.key]: next });
        await qc.invalidateQueries({ queryKey: ["order", orderId] });
        await refetchOrder();
        // Drop the local override so the refetched server value is the source of
        // truth (avoids a stale fieldValues entry masking the persisted value).
        setFieldValues(prev => { const n = { ...prev }; delete n[id]; return n; });
        setFlow("Change saved.", "success");
      } catch (err) {
        setFlow(err instanceof Error ? err.message : "Couldn't save that change. Try again.", "error");
      } finally {
        setSavingHeaderId(null);
      }
    })();
  }, [headerFieldMap, order, fieldValues, orderId, qc, refetchOrder, setFlow, savingHeaderId]);

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
  // Accept must REALLY resolve the line on the server, not just flip local state:
  // the Send guard reads `order.lines.some(l => l.needsReview)` from server truth,
  // so a purely-local accept would never unblock Send. We commit the AI-suggested
  // supplier code via POST /api/orders/{id}/resolve, then refetch so every guard
  // (exceptionCount, the send button, the keyboard 'a' shortcut) recomputes from
  // the fresh server state.
  const handleAcceptSubnode = useCallback((id: string) => {
    if (!order) return;
    const line = order.lines.find(l => l.id === id);
    const code = line?.supplierItemCode ?? line?.aiSuggestion?.supplierItemCode;
    // No line / no code to commit → nothing the backend can persist. Reflect the
    // local highlight only (used by mock paths that lack a server resolve).
    if (!line || !code) {
      setAcceptedSubnodes(prev => new Set([...prev, id]));
      setRejectedSubnodes(prev => { const n = new Set(prev); n.delete(id); return n; });
      return;
    }
    setAcceptingLineId(id);
    // Optimistic highlight while the resolve is in flight.
    setAcceptedSubnodes(prev => new Set([...prev, id]));
    setRejectedSubnodes(prev => { const n = new Set(prev); n.delete(id); return n; });
    void (async () => {
      try {
        await apiClient.commitMappings(orderId, [{ lineNumber: line.lineNumber, supplierItemCode: code }]);
        // Pull server truth so the needsReview-based guards recompute.
        await qc.invalidateQueries({ queryKey: ["order", orderId] });
        await refetchOrder();
      } catch (err) {
        // Roll back the optimistic highlight and surface the failure.
        setAcceptedSubnodes(prev => { const n = new Set(prev); n.delete(id); return n; });
        setFlow(err instanceof Error ? err.message : `Couldn't save that ${labels.counterpartyNoun.toLowerCase()} code. Try again.`, "error");
      } finally {
        setAcceptingLineId(null);
      }
    })();
  }, [order, orderId, qc, refetchOrder, labels, setFlow]);

  const handleRejectSubnode = useCallback((id: string) => {
    setRejectedSubnodes(prev => new Set([...prev, id]));
    setAcceptedSubnodes(prev => { const n = new Set(prev); n.delete(id); return n; });
  }, []);

  // ── Manual supplier-code entry (the #1 review action) ──────────────────────
  const handleStartLineEdit = useCallback((id: string, initial: string) => {
    setLineEditId(id);
    setLineDraft(initial ?? "");
  }, []);
  const handleCancelLineEdit = useCallback(() => {
    setLineEditId(null);
    setLineDraft("");
  }, []);
  // Persist a hand-typed supplier code via the SAME server path as Accept
  // (commitMappings → refetch) so the needsReview send-guard recomputes from
  // server truth — never local-only, or the line would look fixed but still
  // block Send. saveMappings (default true) also remembers it for next time.
  const handleCommitLineCode = useCallback((id: string) => {
    if (!order) return;
    const line = order.lines.find(l => l.id === id);
    const code = lineDraft.trim();
    if (!line || code.length === 0) return;
    setAcceptingLineId(id);
    void (async () => {
      try {
        await apiClient.commitMappings(orderId, [{ lineNumber: line.lineNumber, supplierItemCode: code }]);
        await qc.invalidateQueries({ queryKey: ["order", orderId] });
        await refetchOrder();
        setLineEditId(null);
        setLineDraft("");
      } catch (err) {
        setFlow(err instanceof Error ? err.message : `Couldn't save that ${labels.counterpartyNoun.toLowerCase()} code. Try again.`, "error");
      } finally {
        setAcceptingLineId(null);
      }
    })();
  }, [order, orderId, lineDraft, qc, refetchOrder, labels, setFlow]);

  const lineEditApi = useMemo(() => ({
    knownCodes: knownSupplierCodes,
    catalogCodes,
    supplierName: order?.supplierName ?? "",
    editId: lineEditId,
    draft: lineDraft,
    onStart: handleStartLineEdit,
    onChange: setLineDraft,
    onCommit: handleCommitLineCode,
    onCancel: handleCancelLineEdit,
  }), [knownSupplierCodes, catalogCodes, order?.supplierName, lineEditId, lineDraft, handleStartLineEdit, handleCommitLineCode, handleCancelLineEdit]);

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
      setFlow("Resolve every missing supplier code before completing this order.", "error");
      return;
    }

    try {
      let current = order;

      if (current.status === "delivered") {
        setCrossed(true);
        setShowToast(true);
        setFlow(finalDeliveryMessage("delivered", null, labels), "success");
        return;
      }

      if (current.artifacts.length === 0 && current.status !== "ready_to_deliver") {
        setSendState("transforming");
        setFlow("Generating the output...", "info");
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
        setFlow(current.errorMessage ?? "Transform failed. Check the output template and try again.", "error");
        return;
      }

      if (current.status === "delivered") {
        setCrossed(true);
        setShowToast(true);
        setFlow(finalDeliveryMessage("delivered", null, labels), "success");
        await refetchOrder();
        return;
      }

      if (current.status === "delivery_failed") {
        setFlow(finalDeliveryMessage(current.status, current.errorMessage, labels), "error");
        await refetchOrder();
        return;
      }

      if (current.artifacts.length === 0) {
        setFlow("Output generation has not finished yet. Refresh the order and try again.", "error");
        await refetchOrder();
        return;
      }

      setSendState("delivering");
      setFlow(
        labels.counterpartyNoun === "Customer"
          ? "Confirming the order..."
          : "Sending the generated output to the supplier...",
        "info",
      );
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
        setFlow(finalDeliveryMessage(current.status, current.errorMessage, labels), "success");
      } else {
        setFlow(finalDeliveryMessage(current.status, current.errorMessage, labels), "error");
      }
      await refetchOrder();
    } catch (err) {
      setFlow(err instanceof Error ? err.message : "Send failed. Check the Delivery Log and try again.", "error");
      await refetchOrder();
    } finally {
      setSendState("idle");
    }
  }, [order, orderId, pollOrderUntil, refetchOrder, sendState, labels, setFlow]);

  // ── Keyboard shortcuts (Bridge Layer reference) ────────────────────────────
  // A = accept the next unresolved AI line suggestion · C = open the send/confirm
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
        for (const n of nodes) {
          const sn = n.subnodes?.find(s => s.ai && !acceptedSubnodes.has(s.id) && !rejectedSubnodes.has(s.id));
          if (sn) { e.preventDefault(); handleAcceptSubnode(sn.id); return; }
        }
      } else if (k === "c") {
        if (!crossed && exceptionCount === 0 && sendState === "idle") { e.preventDefault(); setShowConfirm(true); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tab, nodes, acceptedSubnodes, rejectedSubnodes, handleAcceptSubnode, crossed, exceptionCount, editingId, showConfirm, sendState]);

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
              <span className="text-right" style={{ fontSize: 11.5, color: "#8A93A5", paddingRight: 2 }}>
                {exceptionCount} issue{exceptionCount !== 1 ? "s" : ""} to resolve first
              </span>
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
          { id: "review",   label: "Review" },
          { id: "passport", label: "Passport" },
          { id: "response", label: `${labels.counterpartyNoun} response` },
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
              {active && <span style={{ position: "absolute", left: 8, right: 8, bottom: 0, height: 2, borderRadius: 2, background: "linear-gradient(90deg,#1E6D29,#2E8E3A)" }} />}
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
                    ? `No acceptance profile configured for this ${labels.counterpartyNoun.toLowerCase()}.`
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
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: validationResult.passed ? "#2E8E3A" : "#C53A3A", flexShrink: 0 }} />
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
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: r.passed ? "#2E8E3A" : dotColor, flexShrink: 0, marginTop: 5 }} />
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
                signature={`${nodes.length}|${editingId ?? ""}|${[...acceptedSubnodes].sort().join(",")}|${[...rejectedSubnodes].sort().join(",")}|${hoveredId ?? ""}|${activeZone ?? ""}|${crossed ? 1 : 0}|${Object.entries(fieldValues).map(([k, v]) => k + v).join(",")}|${wireSig}`}
              />

              {/* Interactive drag-to-wire layer — canonical → output only, xl desktop.
                  Sits above the decorative SpineConnectors (z-index:3 vs 2).
                  Uses native pointer events; decorative SVG pointerEvents:none is unchanged. */}
              <WireDragLayer
                gridRef={gridRef}
                nodeEls={nodeEls}
                outLineEls={outLineEls}
                nodes={connectorNodes}
                onConnect={handleWireConnect}
                existingConnections={existingWireConnections}
                signature={`${nodes.length}|${wireSig}`}
              />

              {/* Left — SOURCE DOCUMENT */}
              <div ref={sourceColRef}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10, height: 18, minWidth: 0 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#1E66C9", flexShrink: 0 }}>Source document</span>
                  <FileChip type={sourceFileType(order.sourceFileKey)} />
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{sourceFileLabel(order.sourceFileKey)}</span>
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
                      acceptingLineId={acceptingLineId}
                      lineEdit={lineEditApi}
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
                  onOutputAction={setFlow}
                  orderId={orderId}
                  artifacts={order.artifacts}
                  onLine={(id, el) => { outLineEls.current[id] = el; }}
                />
              </div>
            </div>
          </div>
          </EdgeRails>
        </div>

        {/* Tablet (md–xl, 768–1279px) — two-column layout: canonical spine | source+output.
            Richer than the phone accordion, no connector overlay. Sibling of the
            desktop block; gated hidden md:block xl:hidden internally. */}
        <TabletSpineLayout
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
          onOutputAction={setFlow}
          orderId={orderId}
          artifacts={order.artifacts}
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
          onOutputAction={setFlow}
          orderId={orderId}
          artifacts={order.artifacts}
          acceptingLineId={acceptingLineId}
          lineEdit={lineEditApi}
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
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
          supplierName={dialogSupplierName}
          outputFormat={dialogOutputFormat}
          grandTotal={dialogGrandTotal}
          lineCount={dialogLineCount}
          labels={labels}
          failingRuleCount={failingRuleCount}
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
