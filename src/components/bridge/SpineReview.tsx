"use client";

// Canonical Spine Review — fully interactive ETL review screen.
// AC2: AI accept/reject, inline field editing, confirm dialog, keyboard nav.

import type React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, useRef, useEffect, useCallback, useMemo, type KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import type { Order } from "@/types/procurement";
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
  editable?: boolean;
  subnodes?: SubNode[];
}

// ─── Money helpers ───────────────────────────────────────────────────────────

/** Sum of unitPrice × quantity across all order lines. */
function orderTotal(order: Order): number {
  return order.lines.reduce((sum, l) => sum + Number(l.unitPrice) * Number(l.quantity), 0);
}

/** Format an amount with a currency symbol/code, e.g. "€ 4,436.73" or "USD 120.00". */
function formatMoney(currency: string, amount: number): string {
  const prefix = currency === "EUR" ? "€" : currency === "USD" ? "$" : currency === "GBP" ? "£" : currency;
  return `${prefix} ${amount.toLocaleString("en-IE", { minimumFractionDigits: 2 })}`;
}

// ─── Map live order → SpineNodeData ──────────────────────────────────────────

function buildNodesFromOrder(order: Order): SpineNodeData[] {
  const lineCount = order.lines.length;
  const formatted = formatMoney(order.currency, orderTotal(order));

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
    };
  });

  return [
    { id: "po",       label: "PO number",   value: order.poNumber,            pct: 99, mono: true,  editable: false, srcRef: "header",  outRef: "Order/@orderID"    },
    { id: "date",     label: "Order date",  value: order.orderDate,            pct: 95, mono: true,  editable: true,  srcRef: "header",  outRef: "Order/orderDate"   },
    { id: "buyer",    label: "Buyer",       value: order.buyerName ?? "(parsing…)", pct: order.buyerName ? 98 : 50, tone: "buyer",    editable: true,  srcRef: "parties", outRef: "BillTo/Contact"    },
    { id: "supplier", label: "Supplier",    value: order.supplierName,         pct: 97, tone: "supplier", editable: false, srcRef: "parties", outRef: "ShipFrom/Contact"  },
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
    case "delivery_dead_letter": return "failed";
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
    pct >= 90 ? { bg: "#DCFCE7", color: "#1DAF50" } :
    pct >= 75 ? { bg: "#FAEFD6", color: "#C97A14" } :
                { bg: "#FBE3E3", color: "#C53A3A" };
  return (
    <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", background: bg, color, borderRadius: 3, padding: "2px 5px" }}>
      {pct}%
    </span>
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
  onHover?: (id: string | null) => void;
}

function SpineNodeCard({
  node, idx,
  editingId, fieldValues,
  acceptedSubnodes, rejectedSubnodes,
  onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onRejectSubnode,
  onKeyDown, inputRef, cardRef, onHover,
}: SpineNodeCardProps) {
  const isEditing = editingId === node.id;
  const displayVal = fieldValues[node.id] ?? node.value;
  const issue = node.pct < 90;
  const err   = node.pct < 75;
  const fieldBg = err ? "#FBE3E3" : issue ? "#FAEFD6" : "#FFFFFF";

  return (
    <div
      className="relative mb-2.5 pl-9"
      ref={cardRef}
      onMouseEnter={() => onHover?.(node.id)}
      onMouseLeave={() => onHover?.(null)}
    >
      {/* Canonical-order node dot */}
      <div
        className="absolute rounded-full bg-white z-10"
        style={{ left: 17, top: 14, width: 13, height: 13, border: "2.5px solid #28C55E" }}
      />

      <div
        className="rounded-[6px] px-2.5 py-2"
        style={{ background: fieldBg, border: `1px solid ${err ? "#F0D2D2" : issue ? "#F0E0BD" : "#E2E6EE"}` }}
      >
        {/* Label row */}
        <div className="flex items-center gap-1.5 mb-1">
          {node.tone === "buyer"    && <div style={{ width: 5, height: 5, borderRadius: 1, background: "#28C55E", flexShrink: 0 }} />}
          {node.tone === "supplier" && <div style={{ width: 5, height: 5, borderRadius: 1, background: "#28C55E", flexShrink: 0 }} />}
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
        ) : (
          <div
            onClick={() => node.editable && onStartEdit(node.id)}
            style={{
              fontSize: node.big ? 16 : 13,
              fontWeight: node.big ? 600 : 500,
              letterSpacing: node.big ? "-0.01em" : undefined,
              fontFamily: node.mono ? "'JetBrains Mono',monospace" : "inherit",
              color: "#0B1A2F",
              cursor: node.editable ? "text" : "default",
              borderRadius: 4,
              padding: "2px 4px",
              marginLeft: -4,
              transition: "background 100ms",
            }}
            onMouseEnter={(e) => { if (node.editable) (e.currentTarget as HTMLElement).style.background = "#F0F2F7"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
          >
            {displayVal}
            {node.editable && (
              <span style={{ marginLeft: 4, fontSize: 9, color: "#C6CDDA", userSelect: "none" }}>✎</span>
            )}
          </div>
        )}

        {/* Hint */}
        {node.hint && !isEditing && (
          <div style={{ fontSize: 10.5, marginTop: 3, color: "#C97A14" }}>⚠ {node.hint}</div>
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
                  {/* Line row: N  Description  CODE · ×qty */}
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
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {sn.desc ?? rowCode}
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, fontFamily: "'JetBrains Mono',monospace", fontSize: 10 }}>
                      <span style={{ color: accepted ? "#1DAF50" : sn.err ? "#C53A3A" : "#8A93A5", fontWeight: accepted || sn.err ? 700 : 500, textDecoration: rejected ? "line-through" : "none" }}>
                        {rowCode}
                      </span>
                      <span style={{ color: "#C6CDDA" }}>·</span>
                      <span style={{ color: sn.err ? "#C53A3A" : "#8A93A5", fontWeight: sn.err ? 700 : 400 }}>×{sn.qty}</span>
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
                        borderRadius: 7,
                        padding: "8px 9px",
                        background: "#EEE7FB",
                        borderLeft: "3px solid #6F4FCE",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.04em", color: "#5E3DB0" }}>AI</span>
                        <span style={{ color: "#C4ABE8" }}>·</span>
                        <span style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: "#6F4FCE" }}>{sn.pct ?? 0}%</span>
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
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 700, padding: "5px 12px", borderRadius: 6, border: "none", background: "#6F4FCE", color: "#FFFFFF", cursor: "pointer" }}
                        >
                          ✓ Accept
                        </button>
                        <button
                          type="button"
                          aria-label={`Edit suggestion for line ${sn.lineNo ?? sn.sku}`}
                          onClick={() => onAcceptSubnode(sn.id)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, fontWeight: 600, padding: "5px 11px", borderRadius: 6, border: "1px solid #D6CBF0", background: "#FFFFFF", color: "#3A2A66", cursor: "pointer" }}
                        >
                          ✎ Edit
                        </button>
                        <button
                          type="button"
                          aria-label={`Reject AI suggestion for line ${sn.lineNo ?? sn.sku}`}
                          onClick={() => onRejectSubnode(sn.id)}
                          style={{ fontSize: 11, fontWeight: 600, padding: "5px 10px", borderRadius: 6, border: "none", background: "transparent", color: "#8A93A5", cursor: "pointer" }}
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

        {/* Source → output refs */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 6, borderTop: "1px dashed #E2E6EE", fontSize: 9.5, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>
          <span style={{ color: "#1DAF50", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45%" }}>← {node.srcRef}</span>
          <span style={{ color: "#8A93A5", flexShrink: 0 }}>→</span>
          <span style={{ color: "#1DAF50", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "right" }}>{node.outRef}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Document Anatomy ─────────────────────────────────────────────────────────
// Renders a document-styled view reconstructed from the order's parsed fields.
// Driven entirely by live order data — no staged company/PO content.

function DocumentAnatomy({ order, onSection }: { order: Order; onSection?: (id: string, el: HTMLElement | null) => void }) {
  const lineCount = order.lines.length;
  const avgConf = lineCount > 0
    ? Math.round((order.lines.reduce((s, l) => s + l.confidence, 0) / lineCount) * 100)
    : null;
  const dateLabel = order.orderDate || "—";
  const previewLines = order.lines.slice(0, 12);

  return (
    <div style={{ borderRadius: 8, padding: 10, background: "#F6F7FA", border: "1px solid #E2E6EE", overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 9.5, color: "#8A93A5" }}>Reconstructed from parsed fields</span>
        {avgConf !== null && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 9, fontWeight: 700, color: "#56627A" }}>
            Avg field confidence <ConfChip pct={avgConf} />
          </span>
        )}
      </div>
      <div style={{ borderRadius: 6, background: "#FFFFFF", padding: "14px 16px", fontFamily: "'Times New Roman',serif", fontSize: 9.5, color: "#1a1a1a", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", minHeight: 360 }}>
        {/* Letterhead — real buyer + PO */}
        <div ref={(el) => onSection?.("header", el)} style={{ display: "flex", justifyContent: "space-between", gap: 12, paddingBottom: 6, borderBottom: "2px solid #333" }}>
          <div style={{ fontFamily: "Inter,sans-serif", fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "60%" }}>
            {order.buyerName ?? "Buyer (parsing…)"}
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>Purchase Order</div>
            <div style={{ fontSize: 9, fontFamily: "'JetBrains Mono',monospace" }}>{order.poNumber} · {dateLabel}</div>
          </div>
        </div>
        <div ref={(el) => onSection?.("parties", el)} style={{ marginTop: 10, fontSize: 9 }}>
          Buyer: {order.buyerName ?? "—"}<br/>Supplier: {order.supplierName}
        </div>
        <div ref={(el) => onSection?.("terms", el)} style={{ marginTop: 8, fontSize: 9 }}>Currency: {order.currency} · {lineCount} line{lineCount !== 1 ? "s" : ""}</div>
        {lineCount > 0 ? (
          <table ref={(el) => onSection?.("lines", el)} style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 8.5 }}>
            <thead><tr style={{ background: "#EEE" }}><th style={{ textAlign: "left", padding: "3px 4px" }}>#</th><th style={{ textAlign: "left" }}>Item</th><th style={{ textAlign: "left" }}>Desc.</th><th style={{ textAlign: "right" }}>Qty</th></tr></thead>
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
          <div ref={(el) => onSection?.("lines", el)} style={{ marginTop: 12, fontSize: 9, color: "#888", fontStyle: "italic" }}>No line items parsed yet.</div>
        )}
        {lineCount > previewLines.length && (
          <div style={{ marginTop: 4, fontSize: 8.5, color: "#888" }}>+ {lineCount - previewLines.length} more line{lineCount - previewLines.length !== 1 ? "s" : ""}</div>
        )}
        <div ref={(el) => onSection?.("totals", el)} style={{ marginTop: 10, textAlign: "right", fontSize: 9, fontWeight: 700 }}>Grand total: {formatMoney(order.currency, orderTotal(order))}</div>
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

  return (
    <div style={{ borderRadius: 8, padding: 10, background: "#F6F7FA", border: "1px solid #E2E6EE" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", background: "#EEE7FB", color: "#5E3DB0", borderRadius: 4 }}>cXML</span>
        <span style={{ fontSize: 10.5, color: "#8A93A5", padding: "3px 8px", border: "1px solid #E2E6EE", borderRadius: 4 }}>CSV</span>
        <span style={{ fontSize: 10.5, color: "#8A93A5", padding: "3px 8px", border: "1px solid #E2E6EE", borderRadius: 4 }}>JSON</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={handleCopy}
          disabled={copyLoading}
          style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid #E2E6EE", borderRadius: 4, background: "#FFFFFF", cursor: copyLoading ? "default" : "pointer", color: "#56627A", opacity: copyLoading ? 0.6 : 1 }}
        >
          {copyLoading ? "Copying..." : "Copy"}
        </button>
        <button
          onClick={handleDownload}
          disabled={downloadLoading}
          style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid #E2E6EE", borderRadius: 4, background: "#FFFFFF", cursor: downloadLoading ? "default" : "pointer", color: "#56627A", opacity: downloadLoading ? 0.6 : 1 }}
        >
          {downloadLoading ? "↓ Downloading..." : "↓ Download"}
        </button>
      </div>

      <div style={{ position: "relative", borderRadius: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, lineHeight: 1.6, background: "#0B1A2F", color: "#C5D2E4", padding: "14px 16px", minHeight: 400 }}>
        {/* Status badge */}
        <div style={{ position: "absolute", top: 10, right: 12, fontSize: 9.5, fontWeight: 700, background: "#DCFCE7", color: "#1DAF50", borderRadius: 4, padding: "2px 7px", fontFamily: "Inter,sans-serif" }}>
          {crossed ? "✓ SENT" : "WILL BE SENT"}
        </div>

        {crossed && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: "rgba(40,197,94,0.08)", border: "2px solid #28C55E", pointerEvents: "none", transition: "all 300ms" }} />
        )}

        <div style={{ color: "#7C8DA6" }}>{'<?xml version="1.0" ?>'}</div>
        <div><span style={{ color: "#5FD98A" }}>{"<cXML>"}</span></div>
        <div style={{ paddingLeft: 12 }}><span style={{ color: "#5FD98A" }}>{"<Request>"}</span></div>
        <div ref={(el) => onLine?.("po", el)} style={{ paddingLeft: 24 }}>
          <span style={{ color: "#5FD98A" }}>{"<OrderRequest "}</span>
          <span style={{ color: "#8ABAEF" }}>orderID</span>{"="}
          <span style={{ color: "#E0A23A" }}>&quot;{outPo}&quot;</span>
          {fieldValues["po"] && fieldValues["po"] !== order.poNumber && <span style={{ marginLeft: 8, fontSize: 9, color: "#E0A23A" }}>← edited</span>}
        </div>
        <div ref={(el) => onLine?.("date", el)} style={{ paddingLeft: 60 }}>
          <span style={{ color: "#8ABAEF" }}>orderDate</span>{"="}
          <span style={{ color: "#E0A23A" }}>&quot;{outDate}&quot;</span>
          <span style={{ color: "#5FD98A" }}>{">"}</span>
        </div>
        <div ref={(el) => { onLine?.("currency", el); onLine?.("totals", el); }} style={{ paddingLeft: 32, marginTop: 4, background: "rgba(40,197,94,0.12)", borderLeft: "2px solid #28C55E", paddingTop: 2, paddingBottom: 2 }}>
          <span style={{ color: "#5FD98A" }}>{`<Total currency="${outCurrency}">`}{outTotal}{"</Total>"}</span>
        </div>
        <div ref={(el) => onLine?.("supplier", el)} style={{ paddingLeft: 32, marginTop: 4 }}>
          <span style={{ color: "#5FD98A" }}>{"<ShipFrom>"}</span>{order.supplierName}<span style={{ color: "#5FD98A" }}>{"</ShipFrom>"}</span>
        </div>
        <div ref={(el) => onLine?.("buyer", el)} style={{ paddingLeft: 32 }}>
          <span style={{ color: "#5FD98A" }}>{"<BillTo>"}</span>
          <span style={{ background: fieldValues["buyer"] ? "rgba(232,175,35,0.15)" : "transparent", color: fieldValues["buyer"] ? "#E0A23A" : "#C5D2E4", padding: "0 2px" }}>{outBuyer}</span>
          <span style={{ color: "#5FD98A" }}>{"</BillTo>"}</span>
        </div>
        <div ref={(el) => onLine?.("lines", el)} style={{ paddingLeft: 32, marginTop: 6, color: "#7C8DA6" }}>{"<!-- ItemOut entries -->"}</div>
        {previewLines.map((line) => {
          const accepted = acceptedSubnodes.has(line.id);
          const rejected = rejectedSubnodes.has(line.id);
          if (rejected) return null;
          const sku = line.supplierItemCode ?? line.aiSuggestion?.supplierItemCode ?? line.buyerItemCode;
          const isAi  = !line.supplierItemCode && !!line.aiSuggestion && !accepted;
          const isErr = line.needsReview && !line.supplierItemCode && !line.aiSuggestion;
          return (
            <div key={line.id} style={{ paddingLeft: 32, paddingTop: 2, paddingBottom: 2, background: isErr ? "rgba(197,58,58,0.15)" : accepted ? "rgba(40,197,94,0.14)" : isAi ? "rgba(111,79,206,0.10)" : "transparent", borderLeft: isErr ? "2px solid #C53A3A" : accepted ? "2px solid #28C55E" : isAi ? "2px solid #6F4FCE" : "none", transition: "all 200ms" }}>
              <span style={{ color: "#5FD98A" }}>{"<ItemOut "}</span>
              <span style={{ color: "#8ABAEF" }}>sku</span>{"="}
              <span style={{ color: isErr ? "#F0A0A0" : accepted ? "#5FD98A" : isAi ? "#C4ABF0" : "#E0A23A" }}>&quot;{sku}&quot;</span>
              <span style={{ color: "#8ABAEF" }}> qty</span>{"="}
              <span style={{ color: isErr ? "#F0A0A0" : "#E0A23A" }}>&quot;{line.quantity}&quot;</span>
              <span style={{ color: "#5FD98A" }}>{"/>"}</span>
              {isAi && line.aiSuggestion && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#C4ABF0" }}>← AI mapped {Math.round(line.aiSuggestion.confidence * 100)}%</span>}
              {accepted && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#5FD98A" }}>← accepted ✓</span>}
              {isErr && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#F0A0A0" }}>← needs review</span>}
            </div>
          );
        })}
        {order.lines.length > previewLines.length && (
          <div style={{ paddingLeft: 32, color: "#7C8DA6" }}>{`<!-- + ${order.lines.length - previewLines.length} more -->`}</div>
        )}
        <div style={{ paddingLeft: 24, marginTop: 4 }}><span style={{ color: "#5FD98A" }}>{"</OrderRequest>"}</span></div>
        <div style={{ paddingLeft: 12 }}><span style={{ color: "#5FD98A" }}>{"</Request>"}</span></div>
        <div><span style={{ color: "#5FD98A" }}>{"</cXML>"}</span></div>
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

function AccordionPanel({ label, accent, defaultOpen, children }: {
  label: string;
  accent: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div className="rounded-[10px] overflow-hidden" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF" }}>
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
        style={{ borderBottom: open ? "1px solid #E2E6EE" : "none", background: open ? "rgba(40,197,94,0.04)" : "#FFFFFF" }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ width: 3, height: 22, borderRadius: 2, background: accent, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "#56627A", flex: 1 }}>{label}</span>
        <span style={{ fontSize: 14, color: "#8A93A5", transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms" }}>›</span>
      </button>
      {open && <div className="p-3">{children}</div>}
    </div>
  );
}

function MobileSpineAccordion({
  order, nodes, editingId, fieldValues, acceptedSubnodes, rejectedSubnodes,
  crossed, onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onRejectSubnode, onKeyDown, inputRef, onOutputAction,
  orderId, artifacts,
}: MobileSpineAccordionProps) {
  return (
    <div className="md:hidden flex flex-col gap-3 px-4 py-4 pb-[80px]">
      <AccordionPanel label="Source document" accent="#28C55E">
        <DocumentAnatomy order={order} />
      </AccordionPanel>

      <AccordionPanel label="Canonical model" accent="linear-gradient(180deg,#1DAF50,#28C55E)" defaultOpen>
        <div style={{ position: "relative" }}>
          <div style={{ position: "absolute", top: 4, bottom: 0, left: 22, width: 3, background: "linear-gradient(180deg,#1DAF50,#28C55E)", borderRadius: 2 }} />
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
          </div>
        </div>
      </AccordionPanel>

      <AccordionPanel label="Supplier output" accent="#28C55E">
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

export function SpineReview({ orderId }: { orderId: string }) {
  const router = useRouter();

  // ── Live order data ────────────────────────────────────────────────────────
  const { data: order, isLoading, isError } = useQuery({
    queryKey: ["order", orderId],
    queryFn: () => apiClient.getOrderById(orderId),
    retry: 1,
    staleTime: 30_000,
  });

  const { data: auditEvents = [] } = useQuery({
    queryKey: ["order-audit", orderId],
    queryFn: () => apiClient.getOrderAudit(orderId),
    enabled: order?.status === "failed",
    retry: 1,
    staleTime: 60_000,
  });

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
  const [tab, setTab]                             = useState<"review" | "passport" | "response">("review");

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const gridRef = useRef<HTMLDivElement>(null);
  const sourceColRef = useRef<HTMLDivElement>(null);
  const outputColRef = useRef<HTMLDivElement>(null);
  const nodeEls = useRef<Record<string, HTMLDivElement | null>>({});
  const srcSectionEls = useRef<Record<string, HTMLElement | null>>({});
  const outLineEls = useRef<Record<string, HTMLElement | null>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);

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

  // ── Cross the bridge ───────────────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    setShowConfirm(false);
    setCrossed(true);
    setShowToast(true);
    setFlowNotice("Marked as sent in this view. Delivery confirmation and retries appear in the Delivery Log once the order is dispatched.");
  }, []);

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
  if (isLoading) return <SpineReviewSkeleton />;
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
        {/* Top row: back + FROM/TO endpoints + actions */}
        <div className="flex flex-wrap items-start gap-3 px-4 pt-3 pb-2 sm:items-center sm:px-5">
          <button onClick={() => router.push("/inbox")} style={{ width: 28, height: 28, border: "1px solid #E2E6EE", borderRadius: 6, background: "#FFFFFF", color: "#56627A", cursor: "pointer", fontSize: 13, flexShrink: 0 }}>←</button>

          {/* Buyer */}
          <div className="min-w-[220px] flex-1" style={{ flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#1DAF50" }}>From</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", marginTop: 1, whiteSpace: "nowrap" }}>{order.buyerName ?? "(parsing…)"}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
              <FileChip type={sourceFileType(order.sourceFileKey)} />
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#56627A" }}>{sourceFileLabel(order.sourceFileKey)}</span>
            </div>
          </div>

          <div className="hidden sm:block" style={{ flex: 1 }} />

          {/* Supplier */}
          <div className="min-w-[220px] flex-1 text-left sm:text-right" style={{ flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#1DAF50" }}>To</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#0B1A2F", marginTop: 1, whiteSpace: "nowrap" }}>{order.supplierName}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2, justifyContent: "flex-end" }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, color: "#56627A" }}>{outputArtifactLabel(order.artifacts, order.supplierName)}</span>
              <FileChip type={outputArtifactType(order.artifacts)} />
            </div>
          </div>

          <div className="hidden sm:block" style={{ width: 1, height: 36, background: "#E2E6EE", flexShrink: 0 }} />

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, flexShrink: 0, flexWrap: "wrap" }}>
            {order.status === "delivery_dead_letter" && (
              <span
                style={{ height: 32, display: "inline-flex", alignItems: "center", padding: "0 12px", borderRadius: 6, fontSize: 12, fontWeight: 600, background: "#FBE3E3", color: "#C53A3A", border: "1px solid #F0D2D2" }}
              >
                ⚠ Dead-lettered · retries exhausted
              </span>
            )}
            <button
              onClick={handleSaveDraft}
              style={{ height: 32, padding: "0 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 500, background: "#FFFFFF", border: "1px solid #E2E6EE", color: "#0B1A2F", cursor: "pointer" }}
            >
              Save draft
            </button>
            <button
              onClick={() => !crossed && setShowConfirm(true)}
              style={{ height: 32, padding: "0 16px", borderRadius: 6, fontSize: 12.5, fontWeight: 600, background: crossed ? "#28C55E" : "#0B1A2F", color: "#FFFFFF", border: "none", cursor: crossed ? "default" : "pointer", display: "flex", alignItems: "center", gap: 8, transition: "background 200ms" }}
            >
              {crossed ? "✓ Sent" : "Send to supplier"}
              {!crossed && <span style={{ width: 10, height: 10, borderRadius: 2, background: "linear-gradient(90deg,#1DAF50,#28C55E)", display: "inline-block" }} />}
            </button>
          </div>
        </div>

        {/* Stage track — full width, visually separate */}
        <div style={{ padding: "8px 16px 14px", borderTop: "1px solid #F0F2F7" }}>
          <StatusJourney
            stage={crossed || order.status === "delivered" ? 4 : orderStatusToStage(order.status)}
            crossingRef={crossed || order.status === "delivered" ? `Delivered · ${order.poNumber}` : `Validating · ${order.poNumber}`}
          />
        </div>

        {flowNotice && (
          <div className="px-4 pb-3 sm:px-5">
            <div className="rounded-[7px] px-3 py-2 text-[12px] leading-relaxed" style={{ border: "1px solid #A6E9BE", background: "#ECFDF3", color: "#1DAF50" }}>
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
        <EdgeRails className="min-w-[1120px]">
          <div className="h-full overflow-y-auto">
            {/* Desktop 3-column grid */}
            <div
              ref={gridRef}
              className="hidden md:grid gap-[40px] px-6 py-[18px]"
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
                signature={`${nodes.length}|${editingId ?? ""}|${[...acceptedSubnodes].sort().join(",")}|${[...rejectedSubnodes].sort().join(",")}|${hoveredId ?? ""}|${crossed ? 1 : 0}|${Object.entries(fieldValues).map(([k, v]) => k + v).join(",")}`}
              />

              {/* Left — Document Anatomy */}
              <div ref={sourceColRef}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8A93A5" }}>Source document</span>
                  <span style={{ fontSize: 9, fontWeight: 700, color: "#8A93A5", border: "1px solid #E2E6EE", borderRadius: 3, padding: "1px 5px", textTransform: "uppercase" }}>{sourceFileType(order.sourceFileKey)}</span>
                </div>
                <DocumentAnatomy order={order} onSection={(id, el) => { srcSectionEls.current[id] = el; }} />
              </div>

              {/* Center — Canonical model */}
              <div style={{ position: "relative" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#0B1A2F", marginBottom: 10, textAlign: "center" }}>Canonical model</div>
                {/* Spine line */}
                <div style={{ position: "absolute", top: 36, bottom: 0, left: 22, width: 3, background: "linear-gradient(180deg,#1DAF50,#28C55E)", borderRadius: 2 }} />
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
                      onHover={setHoveredId}
                    />
                  ))}
                </div>
              </div>

              {/* Right — Output Preview */}
              <div ref={outputColRef}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#8A93A5", marginBottom: 10, textAlign: "right" }}>Supplier output</div>
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

            {/* Mobile accordion */}
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
        </EdgeRails>
      </div>

      {/* Sticky info bar — desktop only (mobile has its own sticky CTA) */}
      <div className="hidden md:flex flex-shrink-0 bg-white px-6 py-3 items-center gap-5" style={{ borderTop: "1px solid #E2E6EE" }}>
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

      {/* Mobile sticky CTA */}
      <div
        className="md:hidden flex-shrink-0 flex gap-2 px-4 py-3"
        style={{ background: "#FFFFFF", borderTop: "1px solid #E2E6EE", boxShadow: "0 -4px 12px rgba(11,26,47,0.08)" }}
      >
        <button
          onClick={handleSaveDraft}
          style={{ flex: 1, height: 44, borderRadius: 8, fontSize: 13.5, fontWeight: 500, background: "#FFFFFF", border: "1px solid #E2E6EE", color: "#0B1A2F", cursor: "pointer" }}
        >
          Save draft
        </button>
        <button
          onClick={() => !crossed && setShowConfirm(true)}
          style={{ flex: 1.5, height: 44, borderRadius: 8, fontSize: 13.5, fontWeight: 600, background: crossed ? "#28C55E" : "#0B1A2F", color: "#FFFFFF", border: "none", cursor: crossed ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8, transition: "background 200ms" }}
        >
          {crossed ? "✓ Sent" : "Send to supplier"}
          {!crossed && <span style={{ width: 10, height: 10, borderRadius: 2, background: "linear-gradient(90deg,#1DAF50,#28C55E)", display: "inline-block" }} />}
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
