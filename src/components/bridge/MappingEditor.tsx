"use client";

// Mapping Editor — buyer↔supplier code translation table.
// Translated from Bridge_Mappings in v2-prototype.jsx.

import { useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = "AI" | "Manual" | "Imported";

type MappingRow = {
  id: string;
  buyerCode: string;
  supplierCode: string;
  description: string;
  confidence: number;   // 0–100
  orders: number;
  source: Source;
  lastSeen: string;
};

// ─── Mock data ────────────────────────────────────────────────────────────────

const MAPPINGS: MappingRow[] = [
  { id: "1", buyerCode: "ACM-BOLT-M8",      supplierCode: "BWK-M8-HEX-ZN",     description: "M8 Hex bolt, zinc-plated",     confidence: 98, orders: 142, source: "AI",       lastSeen: "2m" },
  { id: "2", buyerCode: "ACM-WSHR-8",       supplierCode: "BWK-W8-FLAT-SS",     description: "M8 flat washer, stainless",    confidence: 94, orders:  88, source: "AI",       lastSeen: "2m" },
  { id: "3", buyerCode: "VDB-PLTE-6082",    supplierCode: "VDB-AL6082-T6-3MM",  description: "Aluminium plate 6082-T6 3mm",  confidence: 87, orders:  31, source: "Manual",   lastSeen: "1d" },
  { id: "4", buyerCode: "NDX-BRCKT-L90",    supplierCode: "NDX-BKT-90L-ZN",     description: "L-bracket 90° zinc",           confidence: 72, orders:  19, source: "Imported", lastSeen: "3d" },
  { id: "5", buyerCode: "MDS-SYRG-10ML",    supplierCode: "MDS-SY-10-STERILE",  description: "10ml sterile syringe",         confidence: 96, orders: 204, source: "AI",       lastSeen: "4m" },
  { id: "6", buyerCode: "MDS-GLOVE-L",      supplierCode: "MDS-GL-L-NITRILE",   description: "Nitrile glove, size L",        confidence: 91, orders: 177, source: "AI",       lastSeen: "4m" },
  { id: "7", buyerCode: "ACM-NUT-M8",       supplierCode: "BWK-N8-HEX-ZN",      description: "M8 hex nut, zinc-plated",      confidence: 97, orders:  93, source: "AI",       lastSeen: "2m" },
  { id: "8", buyerCode: "VDB-ROD-AL-12",    supplierCode: "VDB-AR12-6061",       description: "Aluminium rod 12mm 6061",      confidence: 65, orders:   7, source: "Manual",   lastSeen: "2w" },
  { id: "9", buyerCode: "NDX-CSNG-50",      supplierCode: "NDX-CS50-NEMA",       description: "50mm NEMA conduit sleeve",     confidence: 58, orders:  11, source: "Imported", lastSeen: "1w" },
  { id: "10",buyerCode: "ACM-SCREW-M4x10",  supplierCode: "BWK-CS-M4-10-ZN",    description: "M4×10 countersunk, zinc",      confidence: 99, orders: 312, source: "AI",       lastSeen: "1m" },
  { id: "11",buyerCode: "MDS-BANDG-75",     supplierCode: "MDS-BG-75-STR",       description: "75mm sterile bandage",         confidence: 83, orders:  55, source: "AI",       lastSeen: "6h" },
  { id: "12",buyerCode: "VDB-PIPE-D50",     supplierCode: "VDB-ST50-SCH40",      description: "Steel pipe 50mm SCH40",        confidence: 76, orders:  23, source: "Imported", lastSeen: "5d" },
];

const SUPPLIERS = [
  "All suppliers",
  "Acme Components → BoltWorks BV",
  "Nordmark → VanDerBerg Metaal",
  "Centralis Pharma → MedicaSupply OY",
  "Atlas Reseller → Nordix Distribution",
];

// ─── ConfidenceBar ────────────────────────────────────────────────────────────

function ConfBar({ pct }: { pct: number }) {
  const color =
    pct >= 90 ? "#2E8E3A" : pct >= 70 ? "#C97A14" : "#C53A3A";
  const bg =
    pct >= 90 ? "#E2F1E2" : pct >= 70 ? "#FAEFD6" : "#FBE3E3";
  return (
    <div className="flex items-center gap-2">
      <div
        style={{
          width: 72,
          height: 5,
          background: bg,
          borderRadius: 99,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 99,
          }}
        />
      </div>
      <span
        className="text-[11.5px] font-mono font-semibold"
        style={{ color, minWidth: 30 }}
      >
        {pct}%
      </span>
    </div>
  );
}

// ─── SourceTag ────────────────────────────────────────────────────────────────

const SOURCE_STYLE: Record<Source, { bg: string; color: string }> = {
  AI:       { bg: "#EEE7FB", color: "#6F4FCE" },
  Manual:   { bg: "#EFF2F7", color: "#56627A" },
  Imported: { bg: "#E2F1E2", color: "#1E6D29" },
};

function SourceTag({ src }: { src: Source }) {
  const s = SOURCE_STYLE[src];
  return (
    <span
      className="inline-flex items-center rounded px-1.5 py-0.5 text-[10.5px] font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {src === "AI" && "✦ "}
      {src}
    </span>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MappingEditor() {
  const [search, setSearch]   = useState("");
  const [route, setRoute]     = useState(SUPPLIERS[0]);
  const [srcFilter, setSrc]   = useState<Source | "All">("All");

  const filtered = MAPPINGS.filter((m) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      m.buyerCode.toLowerCase().includes(q) ||
      m.supplierCode.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q);
    const matchSrc = srcFilter === "All" || m.source === srcFilter;
    return matchSearch && matchSrc;
  });

  return (
    <div
      className="flex flex-col h-full min-h-0 overflow-hidden"
      style={{ background: "#F6F7FA" }}
    >
      {/* Page header */}
      <div
        className="flex items-end gap-4 px-6 py-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              color: "#0B1A2F",
            }}
          >
            Mapping Editor
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {MAPPINGS.length} code translations · buyer → supplier
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{
              height: 32,
              border: "1px solid #E2E6EE",
              background: "#FFFFFF",
              color: "#0B1A2F",
            }}
          >
            ↓ Export CSV
          </button>
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{
              height: 32,
              border: "1px solid #E2E6EE",
              background: "#FFFFFF",
              color: "#0B1A2F",
            }}
          >
            ↑ Import CSV
          </button>
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            style={{
              height: 32,
              background: "#0B1A2F",
              color: "#FFFFFF",
              border: 0,
            }}
          >
            + Add mapping
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex items-center gap-3 px-5 flex-shrink-0"
        style={{
          height: 50,
          borderBottom: "1px solid #E2E6EE",
          background: "#FFFFFF",
        }}
      >
        {/* Search */}
        <div className="relative" style={{ width: 280 }}>
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px]"
            style={{ color: "#8A93A5" }}
          >
            ⌕
          </span>
          <input
            type="text"
            placeholder="Search buyer or supplier code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-[6px] pl-8 pr-3 text-[12.5px]"
            style={{
              height: 32,
              border: "1px solid #E2E6EE",
              background: "#F6F7FA",
              color: "#0B1A2F",
              outline: "none",
            }}
          />
        </div>

        {/* Route selector */}
        <select
          value={route}
          onChange={(e) => setRoute(e.target.value)}
          className="rounded-[6px] px-3 text-[12.5px] appearance-none"
          style={{
            height: 32,
            border: "1px solid #E2E6EE",
            background: "#FFFFFF",
            color: "#0B1A2F",
            outline: "none",
          }}
        >
          {SUPPLIERS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>

        <div className="flex-1" />

        {/* Source filter chips */}
        <div className="flex items-center gap-1.5">
          {(["All", "AI", "Manual", "Imported"] as const).map((s) => {
            const active = srcFilter === s;
            return (
              <button
                key={s}
                onClick={() => setSrc(s)}
                className="rounded-[5px] px-2.5 text-[12px] font-medium transition-colors"
                style={{
                  height: 26,
                  border: `1px solid ${active ? "#1E66C933" : "#E2E6EE"}`,
                  background: active ? "#E3EDFB" : "#FFFFFF",
                  color: active ? "#0F4FA8" : "#0B1A2F",
                }}
              >
                {s === "AI" ? "✦ AI" : s}
              </button>
            );
          })}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto" style={{ background: "#FFFFFF" }}>
        <table className="w-full border-collapse" style={{ fontSize: 12.5 }}>
          <thead
            style={{
              position: "sticky",
              top: 0,
              background: "#FFFFFF",
              zIndex: 10,
            }}
          >
            <tr style={{ borderBottom: "2px solid #E2E6EE" }}>
              {[
                { label: "Buyer code",     width: "auto" },
                { label: "",               width: 32     },
                { label: "Supplier code",  width: "auto" },
                { label: "Description",    width: "auto" },
                { label: "Confidence",     width: 140    },
                { label: "Orders",         width: 80     },
                { label: "Source",         width: 100    },
                { label: "Last seen",      width: 80     },
                { label: "",               width: 48     },
              ].map(({ label, width }, i) => (
                <th
                  key={i}
                  className="px-4 py-2.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.06em]"
                  style={{ color: "#8A93A5", width }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr
                key={row.id}
                className="group transition-colors cursor-pointer"
                style={{ borderBottom: "1px solid #F0F2F6" }}
                onMouseEnter={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "#F6F7FA")
                }
                onMouseLeave={(e) =>
                  ((e.currentTarget as HTMLElement).style.background = "transparent")
                }
              >
                {/* Buyer code */}
                <td className="px-4 py-3">
                  <span
                    className="font-mono text-[12px] font-semibold"
                    style={{ color: "#0F4FA8" }}
                  >
                    {row.buyerCode}
                  </span>
                </td>

                {/* Arrow */}
                <td className="py-3 text-center">
                  <span
                    style={{
                      fontSize: 14,
                      background:
                        "linear-gradient(90deg, #1E66C9, #2E8E3A)",
                      WebkitBackgroundClip: "text",
                      WebkitTextFillColor: "transparent",
                    }}
                  >
                    →
                  </span>
                </td>

                {/* Supplier code */}
                <td className="px-4 py-3">
                  <span
                    className="font-mono text-[12px] font-semibold"
                    style={{ color: "#1E6D29" }}
                  >
                    {row.supplierCode}
                  </span>
                </td>

                {/* Description */}
                <td
                  className="px-4 py-3 text-[12.5px]"
                  style={{ color: "#56627A", maxWidth: 240 }}
                >
                  {row.description}
                </td>

                {/* Confidence bar */}
                <td className="px-4 py-3">
                  <ConfBar pct={row.confidence} />
                </td>

                {/* Orders */}
                <td
                  className="px-4 py-3 text-right font-mono text-[12px]"
                  style={{ color: "#0B1A2F" }}
                >
                  {row.orders}
                </td>

                {/* Source */}
                <td className="px-4 py-3">
                  <SourceTag src={row.source} />
                </td>

                {/* Last seen */}
                <td
                  className="px-4 py-3 text-[12px]"
                  style={{ color: "#8A93A5" }}
                >
                  {row.lastSeen}
                </td>

                {/* Actions */}
                <td className="px-4 py-3">
                  <button
                    className="opacity-0 group-hover:opacity-100 transition-opacity rounded px-2 py-1 text-[11.5px] font-medium"
                    style={{
                      border: "1px solid #E2E6EE",
                      background: "#FFFFFF",
                      color: "#56627A",
                    }}
                  >
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {filtered.length === 0 && (
          <div
            className="flex flex-col items-center justify-center py-16"
            style={{ color: "#8A93A5" }}
          >
            <span style={{ fontSize: 32, marginBottom: 8 }}>⊘</span>
            <p className="text-[13px]">No mappings match your filter</p>
          </div>
        )}
      </div>
    </div>
  );
}
