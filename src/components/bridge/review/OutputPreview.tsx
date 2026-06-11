"use client";

// OutputPreview — the supplier-output preview panel. Moved VERBATIM from
// SpineReview.tsx (batch 9 Phase C) so the classic triptych, tablet, mobile
// accordion AND the Triage Context Stage all render the same panel. The only
// addition is the `fragment` prop: when set, the panel renders ONLY the
// selected line's (or header field's) output fragment — reusing the exact
// per-row renderers, so the format-honesty rules hold everywhere:
//   • the cXML scaffold renders ONLY when the configured output IS cXML;
//   • any other format gets the neutral canonical mapping rows;
//   • an unresolved line always shows the highlighted ⚠ UNRESOLVED token;
//   • confidence percentages only ever come from the backend suggestion.

import { useState, useEffect } from "react";
import { apiClient } from "@/lib/api-client";
import type { Order, OrderLine } from "@/types/procurement";
import { OutputMappingEditor } from "../OutputMappingEditor";
import {
  formatMoney,
  resolvedGrandTotal,
  outputArtifactLabel,
  outputArtifactType,
  deliveryChannelLabel,
} from "./orderDisplay";

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

/** A header-fragment target in the output document. */
export type OutputHeaderFragmentId = "po" | "date" | "buyer" | "supplier" | "currency" | "totals";

export interface OutputFragmentRef {
  /** Render only this line's output row. */
  lineId?: string;
  /** Render only this header field's output row(s). */
  headerId?: OutputHeaderFragmentId | null;
}

// ── Shared per-line row renderers ─────────────────────────────────────────────
// Used by BOTH the full preview and the fragment mode, so the honesty rules
// (server-truth resolution state, AI-confidence provenance, unresolved token)
// are one implementation. JSX is byte-identical to the pre-extraction inline rows.

function CxmlLineRow({ line, refCb }: { line: OrderLine; refCb?: (el: HTMLElement | null) => void }) {
  // SERVER TRUTH ONLY: a line shows resolved (green) when the refetched
  // order carries its supplierItemCode — no local accepted/rejected sets.
  const sku = line.supplierItemCode ?? line.aiSuggestion?.supplierItemCode ?? line.buyerItemCode;
  const isAi  = !line.supplierItemCode && !!line.aiSuggestion;
  const isErr = line.needsReview && !line.supplierItemCode && !line.aiSuggestion;
  return (
    <div ref={refCb} style={{ paddingLeft: 32, paddingTop: 2, paddingBottom: 2, background: isErr ? "rgba(197,58,58,0.08)" : isAi ? "rgba(111,79,206,0.07)" : "transparent", borderLeft: isErr ? "2px solid #C53A3A" : isAi ? "2px solid #6F4FCE" : "none", transition: "all 200ms" }}>
      <span style={{ color: C.tag }}>{"<ItemOut "}</span>
      <span style={{ color: C.attr }}>quantity</span>{"="}
      <span style={{ color: isErr ? C.err : C.str }}>&quot;{line.quantity}&quot;</span>
      <span style={{ color: C.tag }}>{">"}</span>
      <span style={{ color: C.tag }}>{"<SupplierPartID>"}</span>
      {isErr
        ? <span style={{ color: C.err }}>⚠ UNRESOLVED</span>
        : <span style={{ color: !isAi ? C.ok : "#7A5BC9" }}>{sku}</span>}
      <span style={{ color: C.tag }}>{"</SupplierPartID>"}</span>
      {isAi && line.aiSuggestion && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#6F4FCE" }}>← AI mapped {Math.round(line.aiSuggestion.confidence * 100)}%</span>}
      {isErr && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: C.err }}>← needs review</span>}
    </div>
  );
}

function NeutralLineRow({ line }: { line: OrderLine }) {
  // SERVER TRUTH ONLY — see CxmlLineRow above.
  const sku = line.supplierItemCode ?? line.aiSuggestion?.supplierItemCode ?? line.buyerItemCode;
  const isAi  = !line.supplierItemCode && !!line.aiSuggestion;
  const isErr = line.needsReview && !line.supplierItemCode && !line.aiSuggestion;
  return (
    <div style={{ display: "flex", gap: 8, paddingTop: 2, paddingBottom: 2, background: isErr ? "rgba(197,58,58,0.08)" : isAi ? "rgba(111,79,206,0.07)" : "transparent", borderLeft: isErr ? "2px solid #C53A3A" : isAi ? "2px solid #6F4FCE" : "none", paddingLeft: 6, transition: "all 200ms" }}>
      <span style={{ color: C.cmt, minWidth: 24, flexShrink: 0, textAlign: "right" }}>{line.lineNumber}</span>
      <span style={{ color: isErr ? C.err : (!isAi ? C.ok : "#7A5BC9"), flexShrink: 0 }}>
        {isErr ? "⚠ UNRESOLVED" : sku}
      </span>
      <span style={{ color: C.cmt }}>×{line.quantity}</span>
      {isAi && line.aiSuggestion && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: "#6F4FCE" }}>← AI mapped {Math.round(line.aiSuggestion.confidence * 100)}%</span>}
      {isErr && <span style={{ marginLeft: "auto", fontSize: 9, fontWeight: 700, color: C.err }}>← needs review</span>}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function OutputPreview({ order, crossed, fieldValues, onOutputAction, orderId, artifacts, deliveryProtocol, onLine, onMappingEditorOpenChange, fragment }: {
  order: Order;
  crossed: boolean;
  fieldValues: Record<string, string>;
  onOutputAction: (message: string) => void;
  orderId: string;
  artifacts: Order["artifacts"];
  /** The supplier's REAL configured delivery protocol (from delivery config).
   *  undefined = unknown (loading/error) · null = no config saved · string = protocol id. */
  deliveryProtocol?: string | null;
  onLine?: (id: string, el: HTMLElement | null) => void;
  /** Relays the "Edit mapping" slideover open-state up so the desktop triptych can
   *  hide the interactive wires while it's open (they bleed through the editor). */
  onMappingEditorOpenChange?: (open: boolean) => void;
  /** Phase C: render ONLY one line's / one header field's output fragment
   *  (compact Context Stage panel). undefined = the full preview, unchanged. */
  fragment?: OutputFragmentRef;
}) {
  const [downloadLoading, setDownloadLoading] = useState(false);
  const [copyLoading, setCopyLoading] = useState(false);
  // Power-user "map & manipulate" editor (heart-piece-flex Phase 3).
  const [mapOpen, setMapOpen] = useState(false);
  // Relay open-state changes up (desktop triptych hides the wires while open).
  // Only the desktop callsite passes the callback; mobile/tablet ignore it.
  useEffect(() => {
    onMappingEditorOpenChange?.(mapOpen);
  }, [mapOpen, onMappingEditorOpenChange]);

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

  const outFmt = outputArtifactType(artifacts);
  const endpointHint = outputArtifactLabel(artifacts, order.supplierName);
  // Only render the cXML scaffold when the supplier's configured output IS cXML.
  // For any other format (CSV/UBL/EDIFACT/X12…) emitting cXML tags would lie
  // about what gets delivered, so we show a neutral canonical mapping view and
  // label the panel honestly. The actual delivered artifact is downloadable.
  const isCxmlOutput = outFmt.toLowerCase() === "cxml";

  // ── FRAGMENT MODE (Context Stage) — compact, single row, same honesty rules ──
  if (fragment) {
    const fragmentLine = fragment.lineId ? order.lines.find(l => l.id === fragment.lineId) ?? null : null;
    const headerId = fragment.headerId ?? null;
    return (
      <div style={{ borderRadius: 8, background: "#FFFFFF", border: "1px solid #E2E6EE", overflow: "hidden" }} data-testid="output-fragment">
        <div style={{ display: "flex", gap: 8, padding: "6px 10px", alignItems: "center", borderBottom: "1px solid #EEF0F4" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 700, color: "#0B1A2F" }}>
            <span style={{ color: "var(--ink-faint)", fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5 }}>{"<>"}</span>
            Output fragment
          </span>
          <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 7px", background: "#EEE7FB", color: "#5E3DB0", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.03em" }} title="The supplier's configured output format. The delivered file matches this format.">{outFmt}</span>
          <span style={{ marginLeft: "auto", fontSize: 9.5, fontWeight: 700, background: crossed ? "#E2F1E2" : "#EEF3F8", color: crossed ? "#1E6D29" : "#56627A", borderRadius: 4, padding: "2px 7px" }}>
            {crossed ? "✓ Sent" : "Will be sent"}
          </span>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, lineHeight: 1.65, background: "#FCFCFD", color: C.base, padding: "10px 12px" }}>
          {fragmentLine ? (
            isCxmlOutput ? (
              <>
                <div style={{ color: C.cmt }}>{`<!-- ItemOut · line ${fragmentLine.lineNumber} -->`}</div>
                <CxmlLineRow line={fragmentLine} />
              </>
            ) : (
              <>
                <div style={{ color: C.cmt, marginBottom: 4 }}>{`// canonical → ${outFmt} on transform · line ${fragmentLine.lineNumber}`}</div>
                <NeutralLineRow line={fragmentLine} />
              </>
            )
          ) : headerId ? (
            isCxmlOutput ? (
              <>
                {headerId === "po" && (
                  <div>
                    <span style={{ color: C.tag }}>{"<OrderRequestHeader "}</span>
                    <span style={{ color: C.attr }}>orderID</span>{"="}
                    <span style={{ color: C.str }}>&quot;{outPo}&quot;</span>
                  </div>
                )}
                {headerId === "date" && (
                  <div>
                    <span style={{ color: C.attr }}>orderDate</span>{"="}
                    <span style={{ color: C.str }}>&quot;{outDate}&quot;</span>
                    <span style={{ color: C.tag }}>{">"}</span>
                  </div>
                )}
                {(headerId === "currency" || headerId === "totals") && (
                  <div>
                    <span style={{ color: C.tag }}>{"<Total "}</span><span style={{ color: C.attr }}>currency</span>{"="}<span style={{ color: C.str }}>&quot;{outCurrency}&quot;</span><span style={{ color: C.tag }}>{">"}</span>{outTotal}<span style={{ color: C.tag }}>{"</Total>"}</span>
                  </div>
                )}
                {headerId === "supplier" && (
                  <div><span style={{ color: C.tag }}>{"<ShipFrom>"}</span>{order.supplierName}<span style={{ color: C.tag }}>{"</ShipFrom>"}</span></div>
                )}
                {headerId === "buyer" && (
                  <div><span style={{ color: C.tag }}>{"<BillTo>"}</span><span style={{ color: C.base, padding: "0 2px" }}>{outBuyer}</span><span style={{ color: C.tag }}>{"</BillTo>"}</span></div>
                )}
              </>
            ) : (
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ color: C.attr, minWidth: 96, flexShrink: 0 }}>
                  {headerId === "po" ? "po_number" : headerId === "date" ? "order_date" : headerId === "totals" ? "grand_total" : headerId}
                </span>
                <span style={{ color: C.cmt }}>:</span>
                <span style={{ color: C.str }}>
                  {headerId === "po" ? outPo : headerId === "date" ? outDate : headerId === "buyer" ? outBuyer : headerId === "supplier" ? order.supplierName : headerId === "currency" ? outCurrency : outTotal}
                </span>
              </div>
            )
          ) : (
            <div style={{ color: C.cmt }}>{`// no output fragment for this issue — see the full preview in Full document`}</div>
          )}
        </div>
      </div>
    );
  }

  // ── FULL MODE — unchanged from the pre-extraction SpineReview render ─────────
  return (
    <div style={{ borderRadius: 10, background: "#FFFFFF", border: "1px solid #E2E6EE", overflow: "hidden" }}>
      <OutputMappingEditor orderId={orderId} open={mapOpen} onClose={() => setMapOpen(false)} />
      {/* Toolbar — title + format badge + actions */}
      <div style={{ display: "flex", gap: 8, padding: "8px 10px", alignItems: "center", borderBottom: "1px solid #EEF0F4", flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 700, color: "#0B1A2F" }}>
          <span style={{ color: "var(--ink-faint)", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>{"<>"}</span>
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
            {previewLines.map((line) => (
              <CxmlLineRow key={line.id} line={line} />
            ))}
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
            <div ref={(el) => onLine?.("lines", el)} style={{ marginTop: 8, color: C.cmt }}>{`// ${previewLines.length} line item(s)`}</div>
            {previewLines.map((line) => (
              <NeutralLineRow key={line.id} line={line} />
            ))}
          </>
        )}
      </div>

      {/* Footer — delivery channel. Shows the supplier's REAL configured protocol
          (from delivery config), never a hardcoded claim (offer⇔works). */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", borderTop: "1px solid #EEF0F4", background: "#F6F7FA" }}>
        <span style={{ fontSize: 11, color: "#56627A" }}>
          {deliveryProtocol ? (
            <>Delivers via <strong style={{ color: "#0B1A2F", fontWeight: 600 }}>{deliveryChannelLabel(deliveryProtocol)}</strong></>
          ) : deliveryProtocol === null ? (
            <>Delivery channel: not configured</>
          ) : (
            /* unknown (config still loading / unavailable) — claim nothing */
            <>Delivery channel: —</>
          )}
        </span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "#A8B0BF", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "55%" }}>{endpointHint}</span>
      </div>
    </div>
  );
}
