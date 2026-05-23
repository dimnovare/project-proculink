"use client";

// Canonical Spine Review — fully interactive ETL review screen.
// AC2: AI accept/reject, inline field editing, confirm dialog, keyboard nav.

import { useRouter } from "next/navigation";
import { useState, useRef, useEffect, useCallback, type KeyboardEvent } from "react";
import { EdgeRails } from "./EdgeRails";
import { FileChip } from "./FileChip";
import { StatusJourney } from "./StatusJourney";

// ─── Types ────────────────────────────────────────────────────────────────────

type SubNode = {
  id: string;
  sku: string;
  qty: number;
  ai?: boolean;
  pct?: number;
  err?: boolean;
  hint?: string;
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

// ─── Initial data ─────────────────────────────────────────────────────────────

const INITIAL_NODES: SpineNodeData[] = [
  { id: "po",       label: "PO number",    value: "PO-2026-008412",              pct: 99, mono: true,  editable: false, srcRef: "header",    outRef: "Order/@orderID"    },
  { id: "date",     label: "Order date",   value: "2026-01-12",                  pct: 95, mono: true,  editable: true,  srcRef: "header",    outRef: "Order/orderDate"   },
  { id: "buyer",    label: "Buyer",        value: "Heinrich Industries GmbH",    pct: 98, tone: "buyer",    editable: true, srcRef: "parties",   outRef: "BillTo/Contact"    },
  { id: "supplier", label: "Supplier",     value: "Acme Components Ltd.",        pct: 97, tone: "supplier", editable: false, srcRef: "parties",  outRef: "ShipFrom/Contact"  },
  { id: "currency", label: "Currency",     value: "EUR",                         pct: 99, mono: true,  editable: true,  srcRef: "terms",     outRef: "Total/@currency"   },
  { id: "incoterm", label: "Incoterm",     value: "DDP",                         pct: 88, mono: true,  editable: true,  srcRef: "terms",     outRef: "Shipping/@terms",   hint: "AI suggests DAP (76%)" },
  { id: "billTo",   label: "Bill to",      value: "Postfach 1042 · 70001 Stuttgart, DE", pct: 72, editable: true, srcRef: "parties", outRef: "BillTo/Address", hint: "Format differs from prior orders" },
  {
    id: "lines", label: "Lines", value: "14 items", pct: 92, editable: false, srcRef: "lines", outRef: "ItemOut[]",
    subnodes: [
      { id: "sn1", sku: "ACM-BLT-M8x40",     qty: 500 },
      { id: "sn2", sku: "ACM-PLT-200×200×4", qty: 24,  ai: true, pct: 84, hint: "AI mapped from HEI-PLT-09" },
      { id: "sn3", sku: "— unmapped —",       qty: -3,  err: true, hint: "Qty < 0 and SKU unmapped" },
    ],
  },
  { id: "totals", label: "Grand total", value: "€ 4,436.73", pct: 100, mono: true, big: true, editable: false, srcRef: "totals", outRef: "Total/@amount" },
];

const ANATOMY_ZONES = [
  { top: 14,  h: 38,  label: "Header zone",  conf: 99, fields: "PO # · Date",       ok: true  },
  { top: 70,  h: 58,  label: "Parties zone", conf: 84, fields: "Ship to · Bill to", ok: false },
  { top: 144, h: 38,  label: "Terms zone",   conf: 88, fields: "Currency · Incoterm",ok: false },
  { top: 200, h: 170, label: "Lines zone",   conf: 92, fields: "14 line items",      ok: true  },
  { top: 386, h: 36,  label: "Totals zone",  conf: 100,fields: "Grand total",        ok: true  },
];

// ─── ConfChip ────────────────────────────────────────────────────────────────

function ConfChip({ pct }: { pct: number }) {
  const { bg, color } =
    pct >= 90 ? { bg: "#E2F1E2", color: "#1E6D29" } :
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
}

function SpineNodeCard({
  node, idx,
  editingId, fieldValues,
  acceptedSubnodes, rejectedSubnodes,
  onStartEdit, onChangeValue, onCommitEdit,
  onAcceptSubnode, onRejectSubnode,
  onKeyDown, inputRef,
}: SpineNodeCardProps) {
  const isEditing = editingId === node.id;
  const displayVal = fieldValues[node.id] ?? node.value;
  const issue = node.pct < 90;
  const err   = node.pct < 75;
  const fieldBg = err ? "#FBE3E3" : issue ? "#FAEFD6" : "#FFFFFF";

  return (
    <div className="relative mb-2.5 pl-9">
      {/* Spine dot */}
      <div
        className="absolute rounded-full bg-white z-10"
        style={{ left: 17, top: 14, width: 13, height: 13, border: `2.5px solid ${idx < 4 ? "#1E66C9" : "#2E8E3A"}` }}
      />
      {/* Connector stubs */}
      <svg width={14} height={34} viewBox="0 0 14 34" className="absolute" style={{ left: -14, top: 8, pointerEvents: "none" }} aria-hidden>
        <path d="M 0 17 Q 7 17 14 17" stroke="#1E66C9" strokeWidth={1} fill="none" strokeDasharray="2 2" />
      </svg>
      <svg width={14} height={34} viewBox="0 0 14 34" className="absolute" style={{ right: -14, top: 8, pointerEvents: "none" }} aria-hidden>
        <path d="M 0 17 Q 7 17 14 17" stroke="#2E8E3A" strokeWidth={1} fill="none" strokeDasharray="2 2" />
      </svg>

      <div
        className="rounded-[6px] px-2.5 py-2"
        style={{ background: fieldBg, border: `1px solid ${err ? "#F0D2D2" : issue ? "#F0E0BD" : "#E2E6EE"}` }}
      >
        {/* Label row */}
        <div className="flex items-center gap-1.5 mb-1">
          {node.tone === "buyer"    && <div style={{ width: 5, height: 5, borderRadius: 1, background: "#1E66C9", flexShrink: 0 }} />}
          {node.tone === "supplier" && <div style={{ width: 5, height: 5, borderRadius: 1, background: "#2E8E3A", flexShrink: 0 }} />}
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#8A93A5", flex: 1 }}>
            {node.label}
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
              border: "1px solid #1E66C9",
              borderRadius: 4,
              padding: "3px 6px",
              fontSize: node.big ? 16 : 12.5,
              fontWeight: node.big ? 600 : 500,
              fontFamily: node.mono ? "'JetBrains Mono',monospace" : "inherit",
              outline: "none",
              background: "#EEF5FC",
              color: "#0B1A2F",
            }}
          />
        ) : (
          <div
            onClick={() => node.editable && onStartEdit(node.id)}
            style={{
              fontSize: node.big ? 16 : 12.5,
              fontWeight: node.big ? 600 : 500,
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

        {/* Subnodes */}
        {node.subnodes && (
          <div style={{ marginTop: 8, paddingTop: 6, borderTop: "1px dashed #E2E6EE", display: "flex", flexDirection: "column", gap: 3 }}>
            {node.subnodes.map((sn) => {
              const accepted = acceptedSubnodes.has(sn.id);
              const rejected = rejectedSubnodes.has(sn.id);
              const done = accepted || rejected;
              return (
                <div
                  key={sn.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    borderRadius: 4,
                    padding: "4px 6px",
                    background: accepted ? "#E2F1E2" : rejected ? "#FBE3E3" : sn.err ? "#FBE3E3" : sn.ai ? "#EEE7FB" : "transparent",
                    borderLeft: sn.ai && !done ? "2px solid #6F4FCE" : sn.err ? "2px solid #C53A3A" : "none",
                  }}
                >
                  <span style={{
                    fontFamily: "'JetBrains Mono',monospace",
                    fontSize: 10.5,
                    fontWeight: 600,
                    flex: 1,
                    color: accepted ? "#1E6D29" : rejected ? "#C53A3A" : sn.err ? "#C53A3A" : sn.ai ? "#6F4FCE" : "#1E6D29",
                    textDecoration: rejected ? "line-through" : "none",
                  }}>
                    {sn.sku}
                  </span>
                  <span style={{ fontSize: 10.5, fontFamily: "'JetBrains Mono',monospace", color: sn.err ? "#C53A3A" : "#56627A", fontWeight: sn.err ? 700 : 400 }}>
                    {sn.qty}
                  </span>
                  {sn.pct && !done && <span style={{ fontSize: 9, fontWeight: 700, color: "#6F4FCE" }}>{sn.pct}%</span>}
                  {accepted && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#1E6D29" }}>✓ Accepted</span>}
                  {rejected && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#C53A3A" }}>✗ Rejected</span>}
                  {/* AI accept / reject buttons */}
                  {sn.ai && !done && (
                    <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                      <button
                        onClick={() => onAcceptSubnode(sn.id)}
                        style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, border: "1px solid #2E8E3A", background: "#E2F1E2", color: "#1E6D29", cursor: "pointer" }}
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => onRejectSubnode(sn.id)}
                        style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 4, border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#8A93A5", cursor: "pointer" }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                  {sn.err && (
                    <span style={{ fontSize: 9.5, fontWeight: 700, color: "#C53A3A", flexShrink: 0 }}>Will be rejected</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Source → output refs */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, paddingTop: 6, borderTop: "1px dashed #E2E6EE", fontSize: 9.5, fontFamily: "'JetBrains Mono',monospace", fontWeight: 600 }}>
          <span style={{ color: "#1E66C9", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45%" }}>← {node.srcRef}</span>
          <span style={{ color: "#8A93A5", flexShrink: 0 }}>→</span>
          <span style={{ color: "#1E6D29", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, textAlign: "right" }}>{node.outRef}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Document Anatomy ─────────────────────────────────────────────────────────

function DocumentAnatomy({ highlightZone }: { highlightZone?: string }) {
  return (
    <div style={{ borderRadius: 8, padding: 10, background: "#F6F7FA", border: "1px solid #E2E6EE" }}>
      <div style={{ position: "relative", borderRadius: 6, background: "#FFFFFF", padding: "14px 16px", fontFamily: "'Times New Roman',serif", fontSize: 9.5, color: "#1a1a1a", boxShadow: "0 1px 4px rgba(0,0,0,0.08)", minHeight: 440 }}>
        {ANATOMY_ZONES.map((z, i) => {
          const c = z.ok ? "#2E8E3A" : "#C97A14";
          const active = highlightZone === z.label;
          return (
            <div key={i}>
              <div style={{ position: "absolute", left: -2, right: -2, top: z.top, height: z.h, border: `${active ? 2 : 1.5}px solid ${c}`, borderRadius: 4, background: active ? `${c}18` : `${c}0A`, pointerEvents: "none", transition: "all 150ms" }} />
              <div style={{ position: "absolute", right: 4, top: z.top - 10, padding: "2px 6px", background: "#FFFFFF", border: `1px solid ${c}`, borderRadius: 3, boxShadow: "0 1px 2px rgba(11,26,47,0.06)", display: "flex", alignItems: "center", gap: 4, zIndex: 2 }}>
                <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#0B1A2F" }}>{z.label}</span>
                <span style={{ fontSize: 8.5, color: "#8A93A5" }}>· {z.fields}</span>
                <span style={{ fontSize: 9, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: c }}>{z.conf}%</span>
              </div>
            </div>
          );
        })}
        {/* Simulated PDF */}
        <div style={{ display: "flex", justifyContent: "space-between", paddingBottom: 6, borderBottom: "2px solid #333" }}>
          <div style={{ fontFamily: "Inter,sans-serif", fontSize: 14, fontWeight: 800, letterSpacing: "0.08em" }}>HEINRICH</div>
          <div style={{ textAlign: "right" }}><div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>Purchase Order</div><div style={{ fontSize: 9 }}>PO-2026-008412 · 12.01.2026</div></div>
        </div>
        <div style={{ marginTop: 10, fontSize: 9 }}>Ship to: Wilhelmstrasse 412, 70173 Stuttgart, DE<br/>Bill to: Postfach 1042, 70001 Stuttgart, DE</div>
        <div style={{ marginTop: 8, fontSize: 9 }}>Currency: EUR · Incoterm: DDP · Payment: Net 30</div>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 8.5 }}>
          <thead><tr style={{ background: "#EEE" }}><th style={{ textAlign: "left", padding: "3px 4px" }}>#</th><th style={{ textAlign: "left" }}>Item</th><th style={{ textAlign: "left" }}>Desc.</th><th style={{ textAlign: "right" }}>Qty</th></tr></thead>
          <tbody>
            {[[1,"HEI-44-A12","Hex bolt M8×40",500],[2,"HEI-44-A18","Hex bolt M10×50",300],[3,"HEI-PLT-09","Steel plate",24],[4,"HEI-44-A99","Specialty fastener",-3]].map((r) => (
              <tr key={r[0] as number}><td style={{ padding: "2px 4px", borderBottom: "1px dotted #BBB" }}>{r[0]}</td><td style={{ fontFamily: "monospace" }}>{r[1]}</td><td>{r[2]}</td><td style={{ textAlign: "right" }}>{(r[3] as number) < 0 ? <span style={{ background: "#FBDADA", padding: "0 2px" }}>{r[3]}</span> : r[3]}</td></tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 10, textAlign: "right", fontSize: 9, fontWeight: 700 }}>Grand total: € 4,436.73</div>
      </div>
    </div>
  );
}

// ─── Output Preview ───────────────────────────────────────────────────────────

function OutputPreview({ acceptedSubnodes, rejectedSubnodes, crossed, fieldValues }: {
  acceptedSubnodes: Set<string>;
  rejectedSubnodes: Set<string>;
  crossed: boolean;
  fieldValues: Record<string, string>;
}) {
  const incoterm = fieldValues["incoterm"] ?? "DDP";
  const billTo = fieldValues["billTo"] ?? "Postfach 1042 · 70001 Stuttgart, DE";
  const sn2accepted = acceptedSubnodes.has("sn2");
  const sn2rejected = rejectedSubnodes.has("sn2");

  return (
    <div style={{ borderRadius: 8, padding: 10, background: "#F6F7FA", border: "1px solid #E2E6EE" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, padding: "3px 8px", background: "#EEE7FB", color: "#5E3DB0", borderRadius: 4 }}>cXML</span>
        <span style={{ fontSize: 10.5, color: "#8A93A5", padding: "3px 8px", border: "1px solid #E2E6EE", borderRadius: 4 }}>CSV</span>
        <span style={{ fontSize: 10.5, color: "#8A93A5", padding: "3px 8px", border: "1px solid #E2E6EE", borderRadius: 4 }}>JSON</span>
        <div style={{ flex: 1 }} />
        <button style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid #E2E6EE", borderRadius: 4, background: "#FFFFFF", cursor: "pointer", color: "#56627A" }}>Copy</button>
        <button style={{ fontSize: 10.5, padding: "3px 8px", border: "1px solid #E2E6EE", borderRadius: 4, background: "#FFFFFF", cursor: "pointer", color: "#56627A" }}>↓ Download</button>
      </div>

      <div style={{ position: "relative", borderRadius: 6, fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, lineHeight: 1.6, background: "#0B1A2F", color: "#C5D2E4", padding: "14px 16px", minHeight: 400 }}>
        {/* Status badge */}
        <div style={{ position: "absolute", top: 10, right: 12, fontSize: 9.5, fontWeight: 700, background: crossed ? "#E2F1E2" : "#E2F1E2", color: crossed ? "#1E6D29" : "#1E6D29", borderRadius: 4, padding: "2px 7px", fontFamily: "Inter,sans-serif" }}>
          {crossed ? "✓ SENT" : "WILL BE SENT"}
        </div>

        {crossed && (
          <div style={{ position: "absolute", inset: 0, borderRadius: 6, background: "rgba(46,142,58,0.08)", border: "2px solid #2E8E3A", pointerEvents: "none", transition: "all 300ms" }} />
        )}

        <div style={{ color: "#7C8DA6" }}>{'<?xml version="1.0" ?>'}</div>
        <div><span style={{ color: "#7FB37B" }}>{"<cXML>"}</span></div>
        <div style={{ paddingLeft: 12 }}><span style={{ color: "#7FB37B" }}>{"<Request>"}</span></div>
        <div style={{ paddingLeft: 24 }}>
          <span style={{ color: "#7FB37B" }}>{"<OrderRequest "}</span>
          <span style={{ color: "#8ABAEF" }}>orderID</span>{"="}
          <span style={{ color: "#E0A23A" }}>{'"PO-2026-008412"'}</span>
        </div>
        <div style={{ paddingLeft: 60 }}>
          <span style={{ color: "#8ABAEF" }}>orderDate</span>{"="}
          <span style={{ color: "#E0A23A" }}>{'"2026-01-12"'}</span>
          <span style={{ color: "#7FB37B" }}>{">"}</span>
        </div>
        <div style={{ paddingLeft: 32, marginTop: 4, background: "rgba(46,142,58,0.10)", borderLeft: "2px solid #2E8E3A", paddingTop: 2, paddingBottom: 2 }}>
          <span style={{ color: "#7FB37B" }}>{'<Total currency="EUR">€ 4,436.73</Total>'}</span>
        </div>
        <div style={{ paddingLeft: 32, marginTop: 4 }}>
          <span style={{ color: "#7FB37B" }}>{"<ShipFrom>"}</span>Acme Components Ltd.<span style={{ color: "#7FB37B" }}>{"</ShipFrom>"}</span>
        </div>
        <div style={{ paddingLeft: 32 }}>
          <span style={{ color: "#7FB37B" }}>{"<BillTo>"}</span>
          <span style={{ background: "rgba(232,175,35,0.15)", color: "#E0A23A", padding: "0 2px" }}>{billTo.split("·")[0].trim()}</span>
          <span style={{ color: "#7FB37B" }}>{"</BillTo>"}</span>
        </div>
        <div style={{ paddingLeft: 32 }}>
          <span style={{ color: "#7FB37B" }}>{`<Shipping terms="${incoterm}"/>`}</span>
          {incoterm !== "DDP" && <span style={{ marginLeft: 8, fontSize: 9, color: "#E0A23A" }}>← edited</span>}
        </div>
        <div style={{ paddingLeft: 32, marginTop: 6, color: "#7C8DA6" }}>{"<!-- ItemOut entries -->"}</div>
        {[
          { sku: "ACM-BLT-M8x40",     qty: 500, ai: false, err: false, id: "sn1" },
          { sku: "ACM-PLT-200×200×4", qty: 24,  ai: true,  err: false, id: "sn2" },
          { sku: "—",                 qty: -3,  ai: false, err: true,  id: "sn3" },
        ].map((item) => {
          const isRejected = item.id === "sn2" && sn2rejected;
          const isAccepted = item.id === "sn2" && sn2accepted;
          if (isRejected) return null;
          return (
            <div key={item.id} style={{ paddingLeft: 32, paddingTop: 2, paddingBottom: 2, background: item.err ? "rgba(197,58,58,0.15)" : isAccepted ? "rgba(46,142,58,0.12)" : item.ai ? "rgba(111,79,206,0.10)" : "transparent", borderLeft: item.err ? "2px solid #C53A3A" : isAccepted ? "2px solid #2E8E3A" : item.ai ? "2px solid #6F4FCE" : "none", transition: "all 200ms" }}>
              <span style={{ color: "#7FB37B" }}>{"<ItemOut "}</span>
              <span style={{ color: "#8ABAEF" }}>sku</span>{"="}
              <span style={{ color: item.err ? "#F0A0A0" : isAccepted ? "#7FB37B" : item.ai ? "#C4ABF0" : "#E0A23A" }}>"{item.sku}"</span>
              <span style={{ color: "#8ABAEF" }}> qty</span>{"="}
              <span style={{ color: item.err ? "#F0A0A0" : "#E0A23A" }}>"{item.qty}"</span>
              <span style={{ color: "#7FB37B" }}>{"/>"}</span>
              {item.ai && !isAccepted && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#C4ABF0" }}>← AI mapped 84%</span>}
              {isAccepted && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#7FB37B" }}>← accepted ✓</span>}
              {item.err && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, color: "#F0A0A0" }}>← will be rejected</span>}
            </div>
          );
        })}
        <div style={{ paddingLeft: 24, marginTop: 4 }}><span style={{ color: "#7FB37B" }}>{"</OrderRequest>"}</span></div>
        <div style={{ paddingLeft: 12 }}><span style={{ color: "#7FB37B" }}>{"</Request>"}</span></div>
        <div><span style={{ color: "#7FB37B" }}>{"</cXML>"}</span></div>
      </div>
    </div>
  );
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({ exceptionCount, onConfirm, onCancel }: {
  exceptionCount: number;
  onConfirm: () => void;
  onCancel: () => void;
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
          <div style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 18, fontWeight: 700, color: "#0B1A2F", marginBottom: 6 }}>Cross the bridge?</div>
          <p style={{ fontSize: 13, color: "#56627A", lineHeight: 1.55, margin: 0 }}>
            This will deliver the transformed cXML order to <strong style={{ color: "#0B1A2F" }}>Acme Components Ltd.</strong>
          </p>
        </div>

        {/* Summary */}
        <div style={{ margin: "16px 24px", padding: "12px 14px", background: "#F6F7FA", borderRadius: 8, border: "1px solid #E2E6EE" }}>
          <div style={{ display: "flex", gap: 20 }}>
            {[
              { label: "Grand total",    value: "€ 4,436.73" },
              { label: "Lines",          value: "14 items" },
              { label: "Exceptions",     value: `${exceptionCount}`, color: exceptionCount > 0 ? "#C97A14" : "#2E8E3A" },
              { label: "Template",       value: "Acme cXML v1.2" },
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
            style={{ marginTop: 2, width: 15, height: 15, accentColor: "#1E66C9", cursor: "pointer", flexShrink: 0 }}
          />
          <label htmlFor="confirm-check" style={{ fontSize: 13, color: "#0B1A2F", lineHeight: 1.5, cursor: "pointer" }}>
            I've reviewed the {exceptionCount} exception{exceptionCount !== 1 ? "s" : ""}. Send to Acme.
          </label>
        </div>

        {/* Retry note */}
        <div style={{ margin: "0 24px 20px", padding: "8px 12px", background: "#E3EDFB", borderRadius: 6, fontSize: 11.5, color: "#0F4FA8" }}>
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
            Cross the bridge →
            <span style={{ width: 10, height: 10, borderRadius: 2, background: "linear-gradient(90deg,#1E66C9,#2E8E3A)", display: "inline-block" }} />
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Success toast ────────────────────────────────────────────────────────────

function CrossedToast({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [onDismiss]);

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", background: "#0B1A2F", borderRadius: 10, boxShadow: "0 8px 24px rgba(11,26,47,0.25)", zIndex: 9992, animation: "fade-up 0.3s ease-out both" }}>
      <div style={{ width: 28, height: 28, borderRadius: 7, background: "#E2F1E2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✓</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#FFFFFF" }}>Crossed to Acme · accepted</div>
        <div style={{ fontSize: 11.5, color: "#7C8DA6", marginTop: 2 }}>1m 42s · PO-2026-008412 · 14 lines</div>
      </div>
      <button onClick={onDismiss} style={{ marginLeft: 8, background: "none", border: "none", color: "#7C8DA6", fontSize: 16, cursor: "pointer", padding: "0 2px" }}>✕</button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function SpineReview({ orderId }: { orderId: string }) {
  const router = useRouter();

  // ── State ──────────────────────────────────────────────────────────────────
  const [fieldValues, setFieldValues]             = useState<Record<string, string>>({});
  const [editingId, setEditingId]                 = useState<string | null>(null);
  const [acceptedSubnodes, setAcceptedSubnodes]   = useState<Set<string>>(new Set());
  const [rejectedSubnodes, setRejectedSubnodes]   = useState<Set<string>>(new Set());
  const [showConfirm, setShowConfirm]             = useState(false);
  const [crossed, setCrossed]                     = useState(false);
  const [showToast, setShowToast]                 = useState(false);
  const [highlightZone, setHighlightZone]         = useState<string | undefined>();

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Count remaining unresolved exceptions
  const exceptionCount = (() => {
    let n = 0;
    // incoterm hint (AI suggestion)
    if (!fieldValues["incoterm"] || fieldValues["incoterm"] === "DDP") n++; // still at AI-suggested state
    // billTo low confidence
    if (!fieldValues["billTo"]) n++;
    // sn3 error line always an exception
    n++;
    return Math.max(0, n - acceptedSubnodes.size);
  })();

  // ── Edit handlers ──────────────────────────────────────────────────────────
  const handleStartEdit = useCallback((id: string) => {
    const node = INITIAL_NODES.find(n => n.id === id);
    if (!node) return;
    setFieldValues(prev => ({ ...prev, [id]: prev[id] ?? node.value }));
    setEditingId(id);
    setTimeout(() => inputRefs.current[id]?.focus(), 0);
  }, []);

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
        const editables = INITIAL_NODES.filter(n => n.editable);
        const idx = editables.findIndex(n => n.id === id);
        const next = editables[idx + 1];
        if (next) setTimeout(() => handleStartEdit(next.id), 0);
      }
    }
    if (e.key === "Escape") {
      setEditingId(null);
      // Restore original value
      const node = INITIAL_NODES.find(n => n.id === id);
      if (node) setFieldValues(prev => ({ ...prev, [id]: node.value }));
    }
  }, [handleCommitEdit, handleStartEdit]);

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
  }, []);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>

      {/* Order header */}
      <div className="flex items-center gap-4 px-6 py-3 flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E2E6EE" }}>
        <button onClick={() => router.push("/inbox")} style={{ width: 30, height: 30, border: "1px solid #E2E6EE", borderRadius: 6, background: "#FFFFFF", color: "#56627A", cursor: "pointer", fontSize: 14, flexShrink: 0 }}>←</button>

        {/* Buyer */}
        <div style={{ flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#1E66C9" }}>From</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0B1A2F", marginTop: 2 }}>Heinrich Industries</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <FileChip type="PDF" />
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#56627A" }}>PO-2026-008412.pdf</span>
          </div>
        </div>

        {/* Stage bridge */}
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#8A93A5", marginBottom: 4 }}>
            {crossed ? "Stage 5 of 5 · Delivered" : "Stage 3 of 5 · Validating"}
          </div>
          <StatusJourney stage={crossed ? 4 : 2} />
        </div>

        {/* Supplier */}
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "#1E6D29" }}>To</div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#0B1A2F", marginTop: 2 }}>Acme Components Ltd.</div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, justifyContent: "flex-end" }}>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#56627A" }}>acme-1.2.cxml</span>
            <FileChip type="cXML" />
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button style={{ height: 32, padding: "0 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 500, background: "#FFFFFF", border: "1px solid #E2E6EE", color: "#0B1A2F", cursor: "pointer" }}>
            Save draft
          </button>
          <button
            onClick={() => !crossed && setShowConfirm(true)}
            style={{ height: 32, padding: "0 16px", borderRadius: 6, fontSize: 12.5, fontWeight: 600, background: crossed ? "#2E8E3A" : "#0B1A2F", color: "#FFFFFF", border: "none", cursor: crossed ? "default" : "pointer", display: "flex", alignItems: "center", gap: 8, transition: "background 200ms" }}
          >
            {crossed ? "✓ Crossed" : "Cross the bridge"}
            {!crossed && <span style={{ width: 10, height: 10, borderRadius: 2, background: "linear-gradient(90deg,#1E66C9,#2E8E3A)", display: "inline-block" }} />}
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <EdgeRails>
          <div style={{ height: "100%", overflowY: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 360px 1fr", alignItems: "start", padding: "20px 0" }}>

              {/* Left — Document Anatomy */}
              <div style={{ padding: "0 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8A93A5", marginBottom: 10 }}>📄 Source · What we received</div>
                <DocumentAnatomy highlightZone={highlightZone} />
              </div>

              {/* Center — Canonical Spine */}
              <div style={{ padding: "0 12px", position: "relative" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#0B1A2F", marginBottom: 10, textAlign: "center" }}>Canonical model · the bridge</div>
                {/* Spine line */}
                <div style={{ position: "absolute", top: 36, bottom: 0, left: "calc(12px + 22px)", width: 3, background: "linear-gradient(180deg,#1E66C9,#2E8E3A)", borderRadius: 2 }} />
                <div style={{ position: "relative", paddingTop: 4 }}>
                  {INITIAL_NODES.map((node, i) => (
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
                    />
                  ))}
                </div>
              </div>

              {/* Right — Output Preview */}
              <div style={{ padding: "0 12px" }}>
                <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#8A93A5", marginBottom: 10, textAlign: "right" }}>⤴ Output · What we send</div>
                <OutputPreview
                  acceptedSubnodes={acceptedSubnodes}
                  rejectedSubnodes={rejectedSubnodes}
                  crossed={crossed}
                  fieldValues={fieldValues}
                />
              </div>
            </div>
          </div>
        </EdgeRails>
      </div>

      {/* Sticky action bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 24px", background: "#FFFFFF", borderTop: "1px solid #E2E6EE", flexShrink: 0 }}>
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8A93A5", marginBottom: 2 }}>Grand total</div>
          <div style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 22, fontWeight: 600, color: "#0B1A2F", letterSpacing: "-0.02em" }}>€ 4,436.73</div>
        </div>
        <div style={{ width: 1, height: 36, background: "#E2E6EE" }} />
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#8A93A5", marginBottom: 2 }}>Output template</div>
          <div style={{ fontSize: 13, fontWeight: 500, color: "#0B1A2F" }}>Acme cXML v1.2</div>
        </div>
        <div style={{ flex: 1 }} />
        {!crossed && exceptionCount > 0 && (
          <span style={{ fontSize: 12, color: "#C97A14", fontWeight: 500 }}>⚠ {exceptionCount} exception{exceptionCount !== 1 ? "s" : ""} need review</span>
        )}
        {crossed && <span style={{ fontSize: 12, color: "#2E8E3A", fontWeight: 600 }}>✓ Delivered · 1m 42s</span>}
        <button
          style={{ height: 34, padding: "0 14px", borderRadius: 6, fontSize: 12.5, fontWeight: 500, background: "#FFFFFF", border: "1px solid #E2E6EE", color: "#0B1A2F", cursor: "pointer" }}
        >
          Save draft
        </button>
        <button
          onClick={() => !crossed && setShowConfirm(true)}
          style={{ height: 34, padding: "0 18px", borderRadius: 6, fontSize: 13, fontWeight: 600, background: crossed ? "#2E8E3A" : "#0B1A2F", color: "#FFFFFF", border: "none", cursor: crossed ? "default" : "pointer", transition: "background 200ms" }}
        >
          {crossed ? "✓ Crossed" : "Cross the bridge →"}
        </button>
      </div>

      {/* Modals */}
      {showConfirm && (
        <ConfirmDialog
          exceptionCount={exceptionCount}
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
        />
      )}
      {showToast && <CrossedToast onDismiss={() => setShowToast(false)} />}
    </div>
  );
}
