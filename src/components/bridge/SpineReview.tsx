"use client";

// Canonical Spine Review — the most important screen.
// 3-column ETL view: Source Anatomy | Canonical Spine | Output Preview
// Wrapped in EdgeRails.

import { useRouter } from "next/navigation";
import { EdgeRails } from "./EdgeRails";
import { FileChip } from "./FileChip";
import { StatusJourney } from "./StatusJourney";

// ─── Types ────────────────────────────────────────────────────────────────────

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
  subnodes?: Array<{
    sku: string;
    qty: number;
    ok?: boolean;
    ai?: boolean;
    pct?: number;
    err?: boolean;
    hint?: string;
  }>;
}

// ─── Mock data for PO-2026-008412 ────────────────────────────────────────────

const SPINE_NODES: SpineNodeData[] = [
  { id: "po",       label: "PO number",    value: "PO-2026-008412",              pct: 99, mono: true, srcRef: "header",    outRef: "Order/@orderID"    },
  { id: "date",     label: "Order date",   value: "2026-01-12",                  pct: 95, mono: true, srcRef: "header",    outRef: "Order/orderDate"   },
  { id: "buyer",    label: "Buyer",        value: "Heinrich Industries GmbH",    pct: 98, tone: "buyer",    srcRef: "parties",   outRef: "BillTo/Contact"    },
  { id: "supplier", label: "Supplier",     value: "Acme Components Ltd.",        pct: 97, tone: "supplier", srcRef: "parties",   outRef: "ShipFrom/Contact"  },
  { id: "currency", label: "Currency",     value: "EUR",                         pct: 99, mono: true, srcRef: "terms",     outRef: "Total/@currency"   },
  { id: "incoterm", label: "Incoterm",     value: "DDP",                         pct: 88, mono: true, srcRef: "terms",     outRef: "Shipping/@terms",    hint: "AI suggests DAP (76%)" },
  { id: "billTo",   label: "Bill to",      value: "Postfach 1042 · 70001 Stuttgart, DE", pct: 72, srcRef: "parties", outRef: "BillTo/Address",    hint: "Format differs from prior orders" },
  {
    id: "lines", label: "Lines", value: "14 items", pct: 92, srcRef: "lines", outRef: "ItemOut[]",
    subnodes: [
      { sku: "ACM-BLT-M8x40",       qty: 500, ok: true },
      { sku: "ACM-PLT-200×200×4",   qty: 24,  ai: true,  pct: 84, hint: "AI mapped" },
      { sku: "— unmapped —",         qty: -3,  err: true, hint: "Qty < 0 and SKU unmapped" },
    ],
  },
  { id: "totals", label: "Grand total", value: "€ 4,436.73", pct: 100, mono: true, big: true, srcRef: "totals", outRef: "Total/@amount" },
];

const ANATOMY_ZONES = [
  { top: 14,  h: 38,  label: "Header zone",  conf: 99, fields: "PO # · Date",       color: "green" },
  { top: 70,  h: 58,  label: "Parties zone", conf: 84, fields: "Ship to · Bill to", color: "amber" },
  { top: 144, h: 38,  label: "Terms zone",   conf: 88, fields: "Currency · Incoterm",color: "amber" },
  { top: 200, h: 170, label: "Lines zone",   conf: 92, fields: "14 line items",      color: "green" },
  { top: 386, h: 36,  label: "Totals zone",  conf: 100,fields: "Grand total",        color: "green" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function PaneHeader({
  title, subtitle, align = "left", icon,
}: { title: string; subtitle: string; align?: "left" | "center" | "right"; icon?: string }) {
  return (
    <div
      className="flex flex-col pb-3 mb-2"
      style={{
        alignItems: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        borderBottom: "1px solid #E2E6EE",
      }}
    >
      <div
        className="text-[10.5px] font-bold uppercase tracking-[0.08em] flex items-center gap-1.5"
        style={{ color: align === "center" ? "#0B1A2F" : "#8A93A5" }}
      >
        {icon && <span>{icon}</span>}
        {title}
      </div>
      <div className="text-[11.5px] mt-0.5 font-mono" style={{ color: "#56627A" }}>
        {subtitle}
      </div>
    </div>
  );
}

function ConfChip({ pct }: { pct: number }) {
  const { bg, color } =
    pct >= 90
      ? { bg: "#E2F1E2", color: "#1E6D29" }
      : pct >= 75
      ? { bg: "#FAEFD6", color: "#C97A14" }
      : { bg: "#FBE3E3", color: "#C53A3A" };
  return (
    <span
      className="text-[9.5px] font-bold rounded px-1 py-0.5 font-mono"
      style={{ background: bg, color }}
    >
      {pct}%
    </span>
  );
}

function SpineNodeCard({ node, idx }: { node: SpineNodeData; idx: number }) {
  const issue = node.pct < 90;
  const err   = node.pct < 75;
  const fieldBg = err ? "#FBE3E3" : issue ? "#FAEFD6" : "#FFFFFF";

  return (
    <div className="relative mb-2.5 pl-9">
      {/* Node dot on the spine */}
      <div
        className="absolute rounded-full bg-white z-10"
        style={{
          left: 17,
          top: 14,
          width: 13,
          height: 13,
          border: `2.5px solid ${idx < 4 ? "#1E66C9" : "#2E8E3A"}`,
        }}
      />

      {/* Connector stubs (visual only) */}
      <svg
        width={14} height={34} viewBox="0 0 14 34"
        className="absolute"
        style={{ left: -14, top: 8, pointerEvents: "none" }}
      >
        <path d="M 0 17 Q 7 17 14 17" stroke="#1E66C9" strokeWidth={1} fill="none" strokeDasharray="2 2" />
      </svg>
      <svg
        width={14} height={34} viewBox="0 0 14 34"
        className="absolute"
        style={{ right: -14, top: 8, pointerEvents: "none" }}
      >
        <path d="M 0 17 Q 7 17 14 17" stroke="#2E8E3A" strokeWidth={1} fill="none" strokeDasharray="2 2" />
      </svg>

      <div
        className="rounded-[6px] px-2.5 py-2"
        style={{
          background: fieldBg,
          border: `1px solid ${err ? "#F0D2D2" : issue ? "#F0E0BD" : "#E2E6EE"}`,
        }}
      >
        {/* Label row */}
        <div className="flex items-center gap-1.5 mb-1">
          {node.tone === "buyer"    && <div className="w-[5px] h-[5px] rounded-[1px] flex-shrink-0" style={{ background: "#1E66C9" }} />}
          {node.tone === "supplier" && <div className="w-[5px] h-[5px] rounded-[1px] flex-shrink-0" style={{ background: "#2E8E3A" }} />}
          <span className="text-[10px] font-bold uppercase tracking-[0.05em] flex-1" style={{ color: "#8A93A5" }}>
            {node.label}
          </span>
          <ConfChip pct={node.pct} />
        </div>

        {/* Value */}
        <div
          className={`${node.big ? "text-[16px] font-semibold" : "text-[12.5px] font-medium"}`}
          style={{
            fontFamily: node.mono
              ? "'JetBrains Mono', ui-monospace, monospace"
              : "'Inter', sans-serif",
            color: "#0B1A2F",
          }}
        >
          {node.value}
        </div>

        {/* Hint */}
        {node.hint && (
          <div className="text-[10.5px] mt-1" style={{ color: "#C97A14" }}>
            ⚠ {node.hint}
          </div>
        )}

        {/* Sub-nodes (line items) */}
        {node.subnodes && (
          <div className="mt-2 pt-2 flex flex-col gap-1" style={{ borderTop: "1px dashed #E2E6EE" }}>
            {node.subnodes.map((sn, i) => (
              <div
                key={i}
                className="flex items-center gap-2 rounded px-1.5 py-0.5 text-[10.5px]"
                style={{
                  background: sn.err ? "#FBE3E3" : sn.ai ? "#EEE7FB" : "transparent",
                }}
              >
                <span
                  className="flex-1 font-mono font-semibold"
                  style={{ color: sn.err ? "#C53A3A" : sn.ai ? "#6F4FCE" : "#1E6D29" }}
                >
                  {sn.sku}
                </span>
                <span
                  className="font-mono"
                  style={{ color: sn.err ? "#C53A3A" : "#56627A", fontWeight: sn.err ? 700 : 400 }}
                >
                  {sn.qty}
                </span>
                {sn.pct && (
                  <span className="text-[9px] font-bold" style={{ color: "#6F4FCE" }}>
                    {sn.pct}%
                  </span>
                )}
              </div>
            ))}
            <div className="text-[10.5px] mt-0.5" style={{ color: "#56627A" }}>
              Showing 3 of 14 ·{" "}
              <span className="font-medium" style={{ color: "#1E66C9" }}>
                view all
              </span>
            </div>
          </div>
        )}

        {/* Source → output refs */}
        <div
          className="flex items-center gap-1.5 mt-2 pt-1.5 text-[9.5px] font-mono font-semibold"
          style={{ borderTop: "1px dashed #E2E6EE" }}
        >
          <span
            className="truncate"
            style={{ color: "#1E66C9", maxWidth: "45%" }}
            title={node.srcRef}
          >
            ← {node.srcRef}
          </span>
          <span style={{ color: "#8A93A5", flexShrink: 0 }}>→</span>
          <span
            className="truncate flex-1 text-right"
            style={{ color: "#1E6D29" }}
            title={node.outRef}
          >
            {node.outRef}
          </span>
        </div>
      </div>
    </div>
  );
}

function DocumentAnatomy() {
  return (
    <div
      className="rounded-[8px] p-3"
      style={{ background: "#F6F7FA", border: "1px solid #E2E6EE" }}
    >
      <div
        className="relative rounded bg-white px-5 py-4"
        style={{
          fontFamily: "'Times New Roman', serif",
          fontSize: 9.5,
          color: "#1a1a1a",
          boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
          minHeight: 440,
        }}
      >
        {/* Zone overlays */}
        {ANATOMY_ZONES.map((z, i) => {
          const ok = z.color === "green";
          const borderC = ok ? "#2E8E3A" : "#C97A14";
          const bgC     = ok ? "#2E8E3A0A" : "#C97A140A";
          return (
            <div key={i}>
              <div
                className="absolute rounded pointer-events-none"
                style={{
                  left: -2,
                  right: -2,
                  top: z.top,
                  height: z.h,
                  border: `1.5px solid ${borderC}`,
                  background: bgC,
                }}
              />
              {/* Zone label */}
              <div
                className="absolute flex items-center gap-1 rounded-[3px] z-10"
                style={{
                  right: 4,
                  top: z.top - 9,
                  padding: "2px 6px",
                  background: "#FFFFFF",
                  border: `1px solid ${borderC}`,
                  boxShadow: "0 1px 2px rgba(11,26,47,0.06)",
                }}
              >
                <span
                  className="text-[9px] font-bold uppercase tracking-[0.04em]"
                  style={{ color: "#0B1A2F" }}
                >
                  {z.label}
                </span>
                <span className="text-[8.5px]" style={{ color: "#8A93A5" }}>
                  · {z.fields}
                </span>
                <span
                  className="text-[9px] font-bold font-mono"
                  style={{ color: ok ? "#1E6D29" : "#C97A14" }}
                >
                  {z.conf}%
                </span>
              </div>
            </div>
          );
        })}

        {/* Simulated PDF content */}
        <div className="flex justify-between pb-2" style={{ borderBottom: "2px solid #333" }}>
          <div
            style={{
              fontFamily: "Inter, sans-serif",
              fontSize: 14,
              fontWeight: 800,
              letterSpacing: "0.08em",
            }}
          >
            HEINRICH
          </div>
          <div className="text-right">
            <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase" }}>
              Purchase Order
            </div>
            <div style={{ fontSize: 9 }}>PO-2026-008412 · 12.01.2026</div>
          </div>
        </div>
        <div className="mt-3" style={{ fontSize: 9 }}>
          Ship to: Wilhelmstrasse 412, 70173 Stuttgart, DE
          <br />
          Bill to: Postfach 1042, 70001 Stuttgart, DE
        </div>
        <div className="mt-3" style={{ fontSize: 9 }}>
          Currency: EUR · Incoterm: DDP · Payment: Net 30
        </div>
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            marginTop: 12,
            fontSize: 8.5,
          }}
        >
          <thead>
            <tr style={{ background: "#EEE" }}>
              <th style={{ textAlign: "left", padding: "3px 4px" }}>#</th>
              <th style={{ textAlign: "left" }}>Item</th>
              <th style={{ textAlign: "left" }}>Description</th>
              <th style={{ textAlign: "right" }}>Qty</th>
            </tr>
          </thead>
          <tbody>
            {[
              [1, "HEI-44-A12", "Hex bolt M8 × 40", 500],
              [2, "HEI-44-A18", "Hex bolt M10 × 50", 300],
              [3, "HEI-44-A22", "Hex nut M10", 600],
              [4, "HEI-PLT-09", "Steel plate", 24],
              [5, "HEI-WSH-04", "Flat washer", 1000],
              [6, "HEI-PRF-L40","Angle profile", 12],
              [7, "HEI-44-A99", "Specialty fastener", -3],
            ].map((r) => (
              <tr key={r[0] as number}>
                <td style={{ padding: "2px 4px", borderBottom: "1px dotted #BBB" }}>{r[0]}</td>
                <td style={{ fontFamily: "monospace" }}>{r[1]}</td>
                <td>{r[2]}</td>
                <td style={{ textAlign: "right" }}>
                  {(r[3] as number) < 0 ? (
                    <span style={{ background: "#FBDADA", padding: "0 2px" }}>{r[3]}</span>
                  ) : (
                    r[3]
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 text-right" style={{ fontSize: 9, fontWeight: 700 }}>
          Grand total: € 4,436.73
        </div>
      </div>
    </div>
  );
}

function OutputPreview() {
  return (
    <div
      className="rounded-[8px] p-3"
      style={{ background: "#F6F7FA", border: "1px solid #E2E6EE" }}
    >
      <div
        className="rounded font-mono text-[10.5px] leading-relaxed relative"
        style={{
          background: "#0B1A2F",
          color: "#C5D2E4",
          padding: "14px 16px",
          minHeight: 440,
        }}
      >
        {/* WILL BE SENT badge */}
        <div
          className="absolute top-2.5 right-3 text-[9.5px] font-bold rounded px-1.5 py-0.5"
          style={{ background: "#E2F1E2", color: "#1E6D29", fontFamily: "Inter, sans-serif" }}
        >
          WILL BE SENT
        </div>

        <div style={{ color: "#7C8DA6" }}>{'<?xml version="1.0" ?>'}</div>
        <div><span style={{ color: "#7FB37B" }}>{"<cXML>"}</span></div>
        <div style={{ paddingLeft: 12 }}><span style={{ color: "#7FB37B" }}>{"<Request>"}</span></div>
        <div style={{ paddingLeft: 24 }}>
          <span style={{ color: "#7FB37B" }}>{"<OrderRequest "}</span>
          <span style={{ color: "#8ABAEF" }}>orderID</span>
          {"="}
          <span style={{ color: "#E0A23A" }}>{'"PO-2026-008412"'}</span>
        </div>
        <div style={{ paddingLeft: 60 }}>
          <span style={{ color: "#8ABAEF" }}>orderDate</span>
          {"="}
          <span style={{ color: "#E0A23A" }}>{'"2026-01-12"'}</span>
          <span style={{ color: "#7FB37B" }}>{">"}</span>
        </div>
        <div
          className="mt-1.5 rounded-[2px]"
          style={{
            paddingLeft: 32,
            paddingTop: 3,
            paddingBottom: 3,
            paddingRight: 8,
            background: "rgba(46,142,58,0.10)",
            borderLeft: "2px solid #2E8E3A",
          }}
        >
          <span style={{ color: "#7FB37B" }}>{'<Total currency="EUR">€ 4,436.73</Total>'}</span>
        </div>
        <div style={{ paddingLeft: 32, marginTop: 6 }}>
          <span style={{ color: "#7FB37B" }}>{"<ShipFrom>"}</span>
          <span>Acme Components Ltd.</span>
          <span style={{ color: "#7FB37B" }}>{"</ShipFrom>"}</span>
        </div>
        <div style={{ paddingLeft: 32 }}>
          <span style={{ color: "#7FB37B" }}>{"<BillTo>"}</span>
          <span>Heinrich Industries GmbH </span>
          <span style={{ background: "rgba(232,175,35,0.15)", color: "#E0A23A", padding: "0 2px" }}>
            Postfach 1042
          </span>
          <span style={{ color: "#7FB37B" }}>{"</BillTo>"}</span>
        </div>
        <div style={{ paddingLeft: 32 }}>
          <span style={{ color: "#7FB37B" }}>{'<Shipping terms="DDP"/>'}</span>
        </div>
        <div className="mt-2" style={{ paddingLeft: 32, color: "#7C8DA6" }}>
          {"<!-- 14 ItemOut entries -->"}
        </div>

        {[
          ["ACM-BLT-M8x40",      500, false, false],
          ["ACM-BLT-M10x50",     300, false, false],
          ["ACM-PLT-200×200×4",  24,  true,  false],
          ["—",                  -3,  false, true ],
        ].map(([sku, qty, ai, err], i) => (
          <div
            key={i}
            className="rounded-[2px]"
            style={{
              paddingLeft: 32,
              paddingTop: 2,
              paddingBottom: 2,
              background: err
                ? "rgba(197,58,58,0.15)"
                : ai
                ? "rgba(111,79,206,0.10)"
                : "transparent",
              borderLeft: err
                ? "2px solid #C53A3A"
                : ai
                ? "2px solid #6F4FCE"
                : "none",
            }}
          >
            <span style={{ color: "#7FB37B" }}>{"<ItemOut "}</span>
            <span style={{ color: "#8ABAEF" }}>sku</span>
            {"="}
            <span style={{ color: err ? "#F0A0A0" : ai ? "#C4ABF0" : "#E0A23A" }}>
              "{sku as string}"
            </span>
            <span style={{ color: "#8ABAEF" }}> qty</span>
            {"="}
            <span style={{ color: err ? "#F0A0A0" : "#E0A23A" }}>"{qty as number}"</span>
            <span style={{ color: "#7FB37B" }}>{"/>"}</span>
            {ai && (
              <span className="ml-1.5 text-[9px] font-bold" style={{ color: "#C4ABF0" }}>
                ← AI mapped 84%
              </span>
            )}
            {err && (
              <span className="ml-1.5 text-[9px] font-bold" style={{ color: "#F0A0A0" }}>
                ← will be rejected
              </span>
            )}
          </div>
        ))}

        <div style={{ paddingLeft: 24, marginTop: 6 }}>
          <span style={{ color: "#7FB37B" }}>{"</OrderRequest>"}</span>
        </div>
        <div style={{ paddingLeft: 12 }}>
          <span style={{ color: "#7FB37B" }}>{"</Request>"}</span>
        </div>
        <div><span style={{ color: "#7FB37B" }}>{"</cXML>"}</span></div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface SpineReviewProps {
  orderId: string;
}

export function SpineReview({ orderId }: SpineReviewProps) {
  const router = useRouter();

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Order header — above edge rails */}
      <div
        className="flex items-center gap-4 px-6 py-3 flex-shrink-0"
        style={{ background: "#FFFFFF", borderBottom: "1px solid #E2E6EE" }}
      >
        {/* Back */}
        <button
          onClick={() => router.push("/inbox")}
          className="flex items-center justify-center rounded-[6px] text-[14px] transition-colors flex-shrink-0"
          style={{
            width: 30,
            height: 30,
            background: "#FFFFFF",
            border: "1px solid #E2E6EE",
            color: "#56627A",
          }}
        >
          ←
        </button>

        {/* Buyer card */}
        <div className="flex-shrink-0">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "#1E66C9" }}
          >
            From
          </div>
          <div className="text-[15px] font-semibold mt-0.5" style={{ color: "#0B1A2F" }}>
            Heinrich Industries
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <FileChip type="PDF" />
            <span className="font-mono text-[11px]" style={{ color: "#56627A" }}>
              PO-2026-008412.pdf
            </span>
          </div>
        </div>

        {/* Stage bridge graphic */}
        <div className="flex-1 relative px-4">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.12em] text-center mb-1"
            style={{ color: "#8A93A5" }}
          >
            Stage 3 of 5 · Validating
          </div>
          <StatusJourney stage={2} />
        </div>

        {/* Supplier card */}
        <div className="text-right flex-shrink-0">
          <div
            className="text-[10px] font-bold uppercase tracking-[0.08em]"
            style={{ color: "#1E6D29" }}
          >
            To
          </div>
          <div className="text-[15px] font-semibold mt-0.5" style={{ color: "#0B1A2F" }}>
            Acme Components Ltd.
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 justify-end">
            <span className="font-mono text-[11px]" style={{ color: "#56627A" }}>
              acme-1.2.cxml
            </span>
            <FileChip type="cXML" />
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 flex-shrink-0">
          <button
            className="rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{
              height: 32,
              background: "#FFFFFF",
              border: "1px solid #E2E6EE",
              color: "#0B1A2F",
            }}
          >
            Save draft
          </button>
          <button
            className="flex items-center gap-2 rounded-[6px] px-3.5 text-[12.5px] font-medium"
            style={{
              height: 32,
              background: "#0B1A2F",
              color: "#FFFFFF",
              border: 0,
            }}
          >
            Cross the bridge
            <span
              className="w-3 h-3 rounded-[2px]"
              style={{
                background:
                  "linear-gradient(90deg, #1E66C9, #2E8E3A)",
                display: "inline-block",
              }}
            />
          </button>
        </div>
      </div>

      {/* Body — EdgeRails */}
      <div className="flex-1 relative overflow-hidden">
        <EdgeRails>
          <div className="h-full overflow-auto">
            <div
              className="grid"
              style={{
                gridTemplateColumns: "1fr 360px 1fr",
                gap: 0,
                alignItems: "start",
                padding: "20px 0",
              }}
            >
              {/* Left — Document Anatomy */}
              <div className="px-3">
                <PaneHeader title="Source · what we received" subtitle="anatomy view" icon="📄" />
                <DocumentAnatomy />
              </div>

              {/* Center — Canonical Spine */}
              <div className="px-3 relative">
                <PaneHeader
                  title="Canonical model"
                  subtitle="v2 schema · the bridge"
                  align="center"
                />
                {/* Vertical spine gradient line */}
                <div
                  className="absolute top-16 bottom-0 rounded-full"
                  style={{
                    left: "calc(12px + 22px)",
                    width: 3,
                    background: "linear-gradient(180deg, #1E66C9, #2E8E3A)",
                  }}
                />
                <div className="relative pt-2">
                  {SPINE_NODES.map((node, i) => (
                    <SpineNodeCard key={node.id} node={node} idx={i} />
                  ))}
                </div>
              </div>

              {/* Right — Output preview */}
              <div className="px-3">
                <PaneHeader
                  title="Output · what we send"
                  subtitle="acme-1.2.cxml"
                  align="right"
                  icon="⤴"
                />
                <OutputPreview />
              </div>
            </div>
          </div>
        </EdgeRails>
      </div>

      {/* Sticky action bar */}
      <div
        className="flex items-center gap-4 px-6 py-3 flex-shrink-0"
        style={{ background: "#FFFFFF", borderTop: "1px solid #E2E6EE" }}
      >
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] mb-0.5" style={{ color: "#8A93A5" }}>
            Grand total
          </div>
          <div
            className="monument text-[22px]"
            style={{ color: "#0B1A2F" }}
          >
            € 4,436.73
          </div>
        </div>
        <div className="mx-4" style={{ width: 1, height: 36, background: "#E2E6EE" }} />
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.06em] mb-0.5" style={{ color: "#8A93A5" }}>
            Output template
          </div>
          <div className="text-[13px] font-medium" style={{ color: "#0B1A2F" }}>
            Acme cXML v1.2
          </div>
        </div>
        <div className="flex-1" />
        <span className="text-[12px]" style={{ color: "#C97A14" }}>
          ⚠ 3 exceptions need review
        </span>
        <button
          className="rounded-[6px] px-3 text-[12.5px] font-medium"
          style={{
            height: 34,
            background: "#FFFFFF",
            border: "1px solid #E2E6EE",
            color: "#0B1A2F",
          }}
        >
          Save draft
        </button>
        <button
          className="flex items-center gap-2 rounded-[6px] px-4 text-[13px] font-semibold"
          style={{ height: 34, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
        >
          Cross the bridge →
        </button>
      </div>
    </div>
  );
}
