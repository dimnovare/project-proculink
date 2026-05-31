"use client";

// Mapping Editor — buyer↔supplier code translation table.
// Translated from Bridge_Mappings in v2-prototype.jsx.

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { SupplierMapping } from "@/types/procurement";

// ─── Palette (sampled pixel-exact from the design render 2026-05-30) ───────────
// Topology semantics in this screen: the BUYER side is blue, the SUPPLIER side is
// green. The page-header primary action ("Add mapping") is buyer-blue; the in-modal
// commit action ("Save mapping") is green. AI provenance stays violet.
//
// Sampled values:
//   Add-mapping button fill ........ #1E66C9   (buyer-blue)
//   Buyer name link ................ #0F4FA8
//   Supplier name + supplier code .. #1E6D29   (supplier-green)
//   Card border / row divider ...... #E2E6EE
//   Modal eyebrow / info banner bg . #E3EDFB
const BLUE        = "#1E66C9"; // buyer-side primary (header button)
const BLUE_DEEP   = "#1A57AD"; // hover / active for blue button
const BLUE_LINK   = "#0F4FA8"; // buyer name link text
const BLUE_SOFT   = "#E3EDFB"; // light-blue tint: eyebrow square, info banner, Inherited badge
const GREEN       = "#2E8E3A"; // supplier-side commit accent (modal Save) — canonical forest green
const GREEN_DEEP  = "#1E6D29"; // hover / active for green; also supplier name + supplier code text
const GREEN_SOFT  = "#E2F1E2"; // soft green tint for active chips / focus rings (brand-green-soft)
const GREEN_CODE  = "#1E6D29"; // supplier name + supplier code text (sampled)
const GREEN_CHIP  = "#E2F1E2"; // Imported badge fill (sampled, brand-green-soft)
const INK         = "#0B1A2F"; // buyer item code (near-black mono) + headings
const BORDER      = "#E2E6EE"; // card border + header rule + row divider (sampled)

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = "AI" | "Manual" | "Imported" | "Inherited";

type MappingRow = {
  id: string;
  buyer: string;        // buyer organisation name
  buyerCode: string;
  supplier: string;     // supplier organisation name
  supplierCode: string;
  description: string;
  source: Source;
  used?: number;        // times this translation has been applied
};

// ─── Converter ────────────────────────────────────────────────────────────────

function apiMappingToRow(m: SupplierMapping, supplierName: string): MappingRow {
  return {
    id: m.id,
    buyer: "",
    buyerCode: m.buyerItemCode,
    supplier: supplierName,
    supplierCode: m.supplierItemCode,
    description: "",
    source: (m.source === "suggested"
      ? "AI"
      : m.source === "imported"
      ? "Imported"
      : m.source === "inherited"
      ? "Inherited"
      : "Manual") as Source,
  };
}

// ─── SourceTag ────────────────────────────────────────────────────────────────
// Pill colours sampled pixel-exact from the design render: AI=violet,
// Manual=neutral grey, Imported=green tint, Inherited=blue tint. No sparkle.

const SOURCE_STYLE: Record<Source, { bg: string; color: string }> = {
  AI:        { bg: "#EEE7FB", color: "#6F4FCE" },   // violet — AI provenance (sampled)
  Manual:    { bg: "#EFF2F7", color: "#56627A" },   // neutral grey (sampled)
  Imported:  { bg: GREEN_CHIP, color: GREEN_CODE }, // green tint (sampled #E2F1E2/#1E6D29)
  Inherited: { bg: BLUE_SOFT,  color: BLUE_LINK },  // blue tint (sampled #E3EDFB/#0F4FA8)
};

function SourceTag({ src }: { src: Source }) {
  const s = SOURCE_STYLE[src];
  return (
    <span
      className="inline-flex items-center rounded-[6px] px-2 py-[3px] text-[11px] font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {src}
    </span>
  );
}

// ─── Mock rows (shown only in mock mode when no supplier is selected) ─────────

const MOCK_ROWS: MappingRow[] = [
  { id: "1",  buyer: "Heinrich Industries", buyerCode: "HX-4410", supplier: "Acme Components",  supplierCode: "ACM-PL-22",  description: "Hydraulic seal kit",    source: "AI",        used: 41 },
  { id: "2",  buyer: "Heinrich Industries", buyerCode: "HX-4412", supplier: "Acme Components",  supplierCode: "ACM-FL-08",  description: "Flange coupling 80mm",  source: "Manual",    used: 28 },
  { id: "3",  buyer: "Steelhouse Co.",      buyerCode: "ST-220",  supplier: "Acme Components",  supplierCode: "ACM-BR-55",  description: "Bracket assembly",      source: "Imported",  used: 17 },
  { id: "4",  buyer: "Nordmark Logistik",   buyerCode: "NM-9981", supplier: "BoltWorks BV",     supplierCode: "BLT-DV-20",  description: "Drive shaft 20mm",      source: "AI",        used: 12 },
  { id: "5",  buyer: "Heinrich Industries", buyerCode: "HX-4411", supplier: "VanDerBerg Metaal",supplierCode: "VDB-88-2201",description: "Pressure valve M20",    source: "Inherited", used:  9 },
  { id: "6",  buyer: "Centralis Pharma",    buyerCode: "CN-117",  supplier: "MedicaSupply",     supplierCode: "MED-AMP-5",  description: "Ampoule tray (5ml)",    source: "Manual",    used:  6 },
  { id: "7",  buyer: "Heinrich Industries", buyerCode: "HX-4418", supplier: "Acme Components",  supplierCode: "ACM-NUT-M8", description: "M8 hex nut, zinc-plated",source: "AI",       used: 93 },
  { id: "8",  buyer: "Steelhouse Co.",      buyerCode: "ST-204",  supplier: "BoltWorks BV",     supplierCode: "BLT-RD-12",  description: "Aluminium rod 12mm",    source: "Manual",    used:  7 },
  { id: "9",  buyer: "Nordmark Logistik",   buyerCode: "NM-7750", supplier: "Acme Components",  supplierCode: "ACM-CS-50",  description: "Conduit sleeve 50mm",   source: "Imported",  used: 11 },
  { id: "10", buyer: "Heinrich Industries", buyerCode: "HX-4490", supplier: "Acme Components",  supplierCode: "ACM-SCR-410",description: "M4×10 countersunk screw",source: "AI",       used: 312 },
  { id: "11", buyer: "Centralis Pharma",    buyerCode: "CN-205",  supplier: "MedicaSupply",     supplierCode: "MED-BG-75",  description: "75mm sterile bandage",  source: "AI",        used: 55 },
  { id: "12", buyer: "Steelhouse Co.",      buyerCode: "ST-250",  supplier: "VanDerBerg Metaal",supplierCode: "VDB-ST-40",  description: "Steel pipe 50mm SCH40", source: "Inherited", used: 23 },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export function MappingEditor() {
  const [search, setSearch]   = useState("");
  const [route, setRoute]     = useState("All suppliers");
  const [srcFilter, setSrc]   = useState<Source | "All">("All");
  const [panel, setPanel] = useState<{ kind: "import" | "export" | "add" | "edit"; row?: MappingRow } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: supplierList } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
    staleTime: 60_000,
  });

  const { data: liveRows, isLoading: mappingsLoading } = useQuery({
    queryKey: ["supplier-mappings", selectedSupplierId],
    queryFn: () => apiClient.getSupplierMappings(selectedSupplierId!),
    enabled: !!selectedSupplierId && !isApiMockMode,
    staleTime: 30_000,
  });

  const selectedSupplierName =
    supplierList?.find((s) => s.id === selectedSupplierId)?.name ?? "";

  const allRows: MappingRow[] = isApiMockMode
    ? MOCK_ROWS
    : (liveRows ?? []).map((m) => apiMappingToRow(m, selectedSupplierName));

  const filtered = allRows.filter((m) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      m.buyer.toLowerCase().includes(q) ||
      m.buyerCode.toLowerCase().includes(q) ||
      m.supplier.toLowerCase().includes(q) ||
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
      {/* Page header — sits directly on the grey canvas */}
      <div className="flex flex-col items-start gap-3 px-4 pt-5 pb-3 sm:px-6 lg:flex-row lg:items-start lg:gap-4 flex-shrink-0">
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              color: INK,
            }}
          >
            Mappings
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            Global buyer → supplier item code library ·{" "}
            <span style={{ color: "#0B1A2F", fontWeight: 600 }}>
              {allRows.length.toLocaleString()}
            </span>{" "}
            saved
          </p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 lg:ml-auto lg:flex lg:w-auto">
          <button
            onClick={() => { setNotice(null); setPanel({ kind: "import" }); }}
            className="flex h-10 items-center justify-center gap-1.5 rounded-[7px] px-3.5 text-[13px] font-medium transition-colors lg:h-[34px] lg:text-[12.5px]"
            style={{
              border: "1px solid #E2E6EE",
              background: "#FFFFFF",
              color: INK,
              boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#F6F7FA")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "#FFFFFF")}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M8 10.5V2.5M8 2.5L4.8 5.7M8 2.5l3.2 3.2M2.5 10v2.2A1.3 1.3 0 0 0 3.8 13.5h8.4a1.3 1.3 0 0 0 1.3-1.3V10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Import
          </button>
          <button
            onClick={() => { setNotice(null); setPanel({ kind: "add" }); }}
            className="flex h-10 items-center justify-center gap-1.5 rounded-[7px] px-3.5 text-[13px] font-semibold transition-colors lg:h-[34px] lg:text-[12.5px]"
            title="Map a buyer item code to a supplier item code"
            style={{
              background: BLUE,
              color: "#FFFFFF",
              border: 0,
              boxShadow: "0 1px 2px rgba(11,26,47,0.08)",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = BLUE_DEEP)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = BLUE)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
              <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">Add mapping</span>
            <span className="sm:hidden">Add</span>
          </button>
        </div>
      </div>

      {/* Result count + search — on the grey canvas, above the table card */}
      <div className="flex flex-col items-stretch gap-2 px-4 pb-3 sm:px-6 lg:flex-row lg:items-center lg:gap-3 flex-shrink-0">
        <p className="text-[12.5px] flex-shrink-0" style={{ color: "#56627A" }}>
          Showing{" "}
          <span style={{ color: INK, fontWeight: 600 }}>{filtered.length}</span>{" "}
          of{" "}
          <span style={{ color: INK, fontWeight: 600 }}>
            {allRows.length.toLocaleString()}
          </span>
        </p>

        <div className="hidden flex-1 lg:block" />

        {/* Source filter chips */}
        <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(["All", "AI", "Manual", "Imported", "Inherited"] as const).map((s) => {
            const active = srcFilter === s;
            return (
              <button
                key={s}
                onClick={() => setSrc(s)}
                className="h-9 flex-shrink-0 rounded-[7px] px-3 text-[12.5px] font-medium transition-colors lg:h-[30px] lg:px-2.5 lg:text-[12px]"
                style={{
                  border: `1px solid ${active ? "#2E8E3A55" : "#E2E6EE"}`,
                  background: active ? GREEN_SOFT : "#FFFFFF",
                  color: active ? GREEN_DEEP : "#56627A",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* Supplier route selector */}
        <select
          value={selectedSupplierId ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedSupplierId(val || null);
            setRoute(val ? (supplierList?.find(s => s.id === val)?.name ?? "All suppliers") : "All suppliers");
          }}
          className="h-10 w-full flex-shrink-0 appearance-none rounded-[7px] px-3 text-[13px] lg:h-[34px] lg:w-auto lg:text-[12.5px]"
          style={{
            border: "1px solid #E2E6EE",
            background: "#FFFFFF",
            color: INK,
            outline: "none",
          }}
        >
          <option value="">All suppliers</option>
          {(supplierList ?? []).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* Search */}
        <div className="relative w-full lg:w-[300px] flex-shrink-0">
          <span
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px]"
            style={{ color: "#8A93A5" }}
          >
            ⌕
          </span>
          <input
            type="text"
            placeholder="Search codes or descriptions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-[7px] pl-8 pr-3 text-[13px] transition-shadow lg:h-[34px] lg:text-[12.5px]"
            style={{
              border: "1px solid #E2E6EE",
              background: "#FFFFFF",
              color: INK,
              outline: "none",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = GREEN;
              e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#E2E6EE";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        {/* Export — kept reachable as a quiet ghost action (design header has none) */}
        <button
          onClick={() => { setNotice(null); setPanel({ kind: "export" }); }}
          className="flex h-10 w-full flex-shrink-0 items-center justify-center gap-1 rounded-[7px] px-3 text-[13px] font-medium transition-colors lg:h-[34px] lg:w-auto lg:text-[12px]"
          style={{
            border: "1px solid #E2E6EE",
            background: "#FFFFFF",
            color: "#56627A",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#F6F7FA")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "#FFFFFF")}
        >
          Export
        </button>
      </div>

      {notice && (
        <div className="px-4 pb-3 sm:px-6">
          <div className="rounded-[8px] px-3 py-2 text-[12px] leading-relaxed" style={{ border: "1px solid #BBD9BD", background: GREEN_SOFT, color: GREEN_DEEP }}>
            {notice}
          </div>
        </div>
      )}

      {/* Table card — white rounded card floating on the grey canvas */}
      <div className="flex-1 overflow-auto px-4 pb-5 sm:px-6">
        <div
          className="overflow-hidden rounded-[10px]"
          style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
        >

          {/* Loading skeleton when a supplier is selected and fetching */}
          {!isApiMockMode && selectedSupplierId && mappingsLoading && (
            <div className="px-5 py-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="mb-3 h-9 rounded-[6px]" style={{ background: "#F0F2F6" }} />
              ))}
            </div>
          )}

          {(!(!isApiMockMode && selectedSupplierId && mappingsLoading)) && (
            <>
              {/* Mobile card list — buyer (blue) → supplier (green) translation cards */}
              <div className="md:hidden" style={{ borderColor: BORDER }}>
                {filtered.map((row, idx) => (
                  <button
                    key={row.id}
                    onClick={() => { setNotice(null); setPanel({ kind: "edit", row }); }}
                    className="block w-full px-4 py-3.5 text-left active:bg-[#F7FAFD]"
                    style={{
                      background: "#FFFFFF",
                      border: "none",
                      borderTop: idx === 0 ? "none" : `1px solid ${BORDER}`,
                    }}
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium" style={{ color: BLUE_LINK }}>
                        {row.buyer || "—"}
                      </span>
                      <SourceTag src={row.source} />
                    </div>
                    {/* buyer code → supplier code, side by side */}
                    <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                      <span className="truncate font-mono text-[12.5px] font-semibold tracking-[-0.01em]" style={{ color: INK }}>
                        {row.buyerCode}
                      </span>
                      <svg width="16" height="9" viewBox="0 0 16 9" fill="none" aria-hidden="true" className="flex-shrink-0">
                        <path d="M1 4.5h12M10 1.5l3.2 3-3.2 3" stroke={GREEN_CODE} strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="truncate text-right font-mono text-[12.5px] font-semibold tracking-[-0.01em]" style={{ color: GREEN_CODE }}>
                        {row.supplierCode}
                      </span>
                    </div>
                    {/* supplier name + description + used */}
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "#56627A" }}>
                        {row.supplier ? (
                          <>
                            <span style={{ color: GREEN_CODE, fontWeight: 500 }}>{row.supplier}</span>
                            {row.description ? <span style={{ color: "#C2C9D6" }}> · </span> : null}
                            {row.description}
                          </>
                        ) : (
                          row.description || "—"
                        )}
                      </p>
                      {row.used != null && (
                        <span className="flex-shrink-0 font-mono text-[11.5px]" style={{ color: "#8A93A5" }}>
                          {row.used}×
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Desktop table */}
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[920px] border-collapse" style={{ fontSize: 12.5 }}>
                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#FFFFFF",
                    zIndex: 10,
                  }}
                >
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {[
                      { label: "Buyer",         align: "left"  as const },
                      { label: "Buyer code",    align: "left"  as const },
                      { label: "Supplier",      align: "left"  as const },
                      { label: "Supplier code", align: "left"  as const },
                      { label: "Description",   align: "left"  as const },
                      { label: "Source",        align: "left"  as const },
                      { label: "Used",          align: "right" as const },
                    ].map(({ label, align }, i) => (
                      <th
                        key={i}
                        className="px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.07em]"
                        style={{ color: "#8A93A5", textAlign: align }}
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
                      style={{ borderBottom: `1px solid ${BORDER}` }}
                      onClick={() => { setNotice(null); setPanel({ kind: "edit", row }); }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "#F7FAFD")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "transparent")
                      }
                    >
                      {/* Buyer name — buyer side is blue */}
                      <td className="px-4 py-3.5">
                        <span className="text-[12.5px] font-medium" style={{ color: BLUE_LINK }}>
                          {row.buyer || "—"}
                        </span>
                      </td>

                      {/* Buyer code — dark mono */}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-[12px] font-semibold tracking-[-0.01em]" style={{ color: INK }}>
                          {row.buyerCode}
                        </span>
                      </td>

                      {/* Supplier name — supplier side is green */}
                      <td className="px-4 py-3.5">
                        <span className="text-[12.5px] font-medium" style={{ color: GREEN_CODE }}>
                          {row.supplier || "—"}
                        </span>
                      </td>

                      {/* Supplier code — green mono */}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-[12px] font-semibold tracking-[-0.01em]" style={{ color: GREEN_CODE }}>
                          {row.supplierCode}
                        </span>
                      </td>

                      {/* Description */}
                      <td
                        className="px-4 py-3.5 text-[12.5px]"
                        style={{ color: INK, maxWidth: 260 }}
                      >
                        {row.description || "—"}
                      </td>

                      {/* Source */}
                      <td className="px-4 py-3.5">
                        <SourceTag src={row.source} />
                      </td>

                      {/* Used */}
                      <td
                        className="px-4 py-3.5 text-right font-mono text-[12px]"
                        style={{ color: "#8A93A5" }}
                      >
                        {row.used != null ? `${row.used}×` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              {filtered.length === 0 && allRows.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center py-16"
                  style={{ color: "#8A93A5" }}
                >
                  <span style={{ fontSize: 32, marginBottom: 8 }}>⊘</span>
                  <p className="text-[13px] font-semibold" style={{ color: INK, marginBottom: 4 }}>No item mappings yet</p>
                  <p className="text-[12.5px] text-center" style={{ maxWidth: 400 }}>
                    Add mappings to automatically translate your buyer item codes to supplier item codes.
                  </p>
                </div>
              )}
              {filtered.length === 0 && allRows.length > 0 && (
                <div
                  className="flex flex-col items-center justify-center py-16"
                  style={{ color: "#8A93A5" }}
                >
                  <span style={{ fontSize: 32, marginBottom: 8 }}>⊘</span>
                  <p className="text-[13px]">No mappings match your filter</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {panel && (
        <MappingPanel
          panel={panel}
          route={route}
          supplierId={selectedSupplierId}
          onClose={() => setPanel(null)}
          onDone={(message) => {
            setNotice(message);
            setPanel(null);
            void queryClient.invalidateQueries({ queryKey: ["supplier-mappings", selectedSupplierId] });
          }}
        />
      )}
    </div>
  );
}

function MappingPanel({
  panel,
  route,
  supplierId,
  onClose,
  onDone,
}: {
  panel: { kind: "import" | "export" | "add" | "edit"; row?: MappingRow };
  route: string;
  supplierId: string | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [buyerCode, setBuyerCode] = useState(panel.row?.buyerCode ?? "");
  const [supplierCode, setSupplierCode] = useState(panel.row?.supplierCode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const queryClient = useQueryClient();

  const title =
    panel.kind === "import" ? "Import mappings" :
    panel.kind === "export" ? "Export mappings" :
    panel.kind === "add" ? "Add SKU mapping" :
    "Edit SKU mapping";

  const subtitle =
    panel.kind === "import" ? "Bulk upload a buyer → supplier code list" :
    panel.kind === "export" ? "Download the current mapping library" :
    "Connect a buyer code to a supplier code";

  const isCodePanel = panel.kind === "add" || panel.kind === "edit";

  const handleAction = async () => {
    if (isApiMockMode || !supplierId) {
      // Demo mode: local-only notice
      const message =
        panel.kind === "export" ? "Export prepared for the selected mapping scope." :
        panel.kind === "import" ? "Import file validated. Connect an API session to upsert the mappings." :
        panel.kind === "add" ? "Mapping saved." :
        "Mapping updated.";
      onDone(message);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (panel.kind === "add") {
        await apiClient.createSupplierMapping(supplierId, { buyerItemCode: buyerCode, supplierItemCode: supplierCode });
        await queryClient.invalidateQueries({ queryKey: ["supplier-mappings", supplierId] });
        onDone("Mapping saved.");
      } else if (panel.kind === "edit" && panel.row) {
        await apiClient.updateSupplierMapping(supplierId, panel.row.id, { buyerItemCode: buyerCode, supplierItemCode: supplierCode });
        await queryClient.invalidateQueries({ queryKey: ["supplier-mappings", supplierId] });
        onDone("Mapping updated.");
      } else if (panel.kind === "import" && importFile) {
        const result = await apiClient.importSupplierMappings(supplierId, importFile);
        await queryClient.invalidateQueries({ queryKey: ["supplier-mappings", supplierId] });
        onDone(`Imported: ${result.created} created, ${result.updated} updated.`);
      } else if (panel.kind === "export") {
        const rows = await apiClient.getSupplierMappings(supplierId);
        const csv = ["buyer_code,supplier_code", ...rows.map(r => `${r.buyerItemCode},${r.supplierItemCode}`)].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = "mappings.csv"; a.click();
        URL.revokeObjectURL(url);
        onDone("Export downloaded.");
      } else {
        // No file selected for import, or other edge case
        setSaving(false);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6">
      <div className="max-h-[92vh] w-full overflow-auto rounded-t-[12px] bg-white shadow-2xl sm:max-w-[600px] sm:rounded-[12px]" style={{ border: `1px solid ${BORDER}` }}>
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4" style={{ borderColor: BORDER }}>
          <div className="flex items-start gap-3">
            {/* blue link-icon eyebrow square */}
            <span
              className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[8px]"
              style={{ background: BLUE_SOFT }}
              aria-hidden="true"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6.5 9.5 9.5 6.5M7 4.5l.7-.7a2.2 2.2 0 0 1 3.1 3.1l-.7.7M9 11.5l-.7.7a2.2 2.2 0 0 1-3.1-3.1l.7-.7" stroke={BLUE} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <h2 className="text-[18px] font-semibold leading-tight" style={{ color: INK }}>{title}</h2>
              <p className="mt-0.5 text-[12.5px]" style={{ color: "#56627A" }}>{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px] text-[18px] leading-none transition-colors hover:bg-[#F6F7FA]"
            style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: "#56627A" }}
          >
            ×
          </button>
        </div>

        {panel.kind === "import" && (
          <div className="grid gap-4 p-5">
            <div className="rounded-[8px] border border-dashed p-5 text-center" style={{ borderColor: "#BBD9BD", background: "#F2F9F3" }}>
              <div className="text-[13px] font-semibold" style={{ color: INK }}>Drop CSV here</div>
              <p className="mx-auto mt-1 max-w-[420px] text-[12px] leading-5" style={{ color: "#56627A" }}>
                Expected columns: buyer_code, supplier_code. Existing buyer codes are updated, new rows are added.
              </p>
              <label className="mt-4 inline-flex h-10 cursor-pointer items-center rounded-[7px] px-4 text-[13px] font-semibold" style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: INK }}>
                {importFile ? importFile.name : "Choose file"}
                <input type="file" accept=".csv" className="sr-only" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="rounded-[7px] border border-[#E2E6EE] bg-[#F6F7FA] p-3 text-[12px] leading-5" style={{ color: "#56627A" }}>
              {isApiMockMode || !supplierId
                ? "Import runs on the backend import endpoint. Connect an API session to upsert mappings from your CSV."
                : "Select a CSV file with buyer_code and supplier_code columns. Existing mappings will be updated; new codes will be added."}
            </div>
          </div>
        )}

        {panel.kind === "export" && (
          <div className="grid gap-3.5 p-5">
            <Field label="Export scope">
              <select defaultValue="filtered" className="h-10 w-full rounded-[7px] px-3 text-[13px]" style={{ border: `1px solid ${BORDER}`, color: INK }}>
                <option value="filtered">Current filters</option>
                <option value="route">Selected supplier</option>
                <option value="all">All mappings</option>
              </select>
            </Field>
            <Field label="Format">
              <select defaultValue="csv" className="h-10 w-full rounded-[7px] px-3 text-[13px]" style={{ border: `1px solid ${BORDER}`, color: INK }}>
                <option value="csv">CSV</option>
                <option value="xlsx">XLSX</option>
              </select>
            </Field>
          </div>
        )}

        {isCodePanel && (
          <div className="grid gap-3.5 p-5">
            {/* Buyer (context) */}
            <Field label="Buyer">
              <div
                className="flex h-10 w-full items-center rounded-[7px] px-3 text-[13px]"
                style={{ border: `1px solid ${BORDER}`, background: "#F8FAFC", color: BLUE_LINK, fontWeight: 500 }}
              >
                {panel.row?.buyer?.trim() || "All buyers"}
              </div>
            </Field>

            {/* Buyer item code — required, mono */}
            <RequiredField label="Buyer item code">
              <input
                value={buyerCode}
                onChange={(e) => setBuyerCode(e.target.value)}
                placeholder="HX-4411"
                className="h-10 w-full rounded-[7px] px-3 font-mono text-[13px] tracking-[-0.01em] outline-none transition-shadow"
                style={{ border: `1px solid ${BORDER}`, color: INK }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.boxShadow = `0 0 0 3px ${BLUE_SOFT}`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = "none"; }}
              />
            </RequiredField>

            {/* Supplier (context) */}
            <Field label="Supplier">
              <div
                className="flex h-10 w-full items-center rounded-[7px] px-3 text-[13px]"
                style={{ border: `1px solid ${BORDER}`, background: "#F8FAFC", color: GREEN_CODE, fontWeight: 500 }}
              >
                {panel.row?.supplier?.trim() || route}
              </div>
            </Field>

            {/* Supplier item code — required, mono */}
            <RequiredField label="Supplier item code">
              <input
                value={supplierCode}
                onChange={(e) => setSupplierCode(e.target.value)}
                placeholder="ACM-PV-M20"
                className="h-10 w-full rounded-[7px] px-3 font-mono text-[13px] tracking-[-0.01em] outline-none transition-shadow"
                style={{ border: `1px solid ${BORDER}`, color: GREEN_CODE }}
                onFocus={(e) => { e.currentTarget.style.borderColor = GREEN; e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = "none"; }}
              />
            </RequiredField>

            {/* Description */}
            <Field label="Description">
              <input
                defaultValue={panel.row?.description ?? ""}
                placeholder="Pressure valve M20"
                className="h-10 w-full rounded-[7px] px-3 text-[13px] outline-none transition-shadow"
                style={{ border: `1px solid ${BORDER}`, color: INK }}
                onFocus={(e) => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.boxShadow = `0 0 0 3px ${BLUE_SOFT}`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER; e.currentTarget.style.boxShadow = "none"; }}
              />
            </Field>

            {/* Info banner — blue, matches render */}
            <div
              className="mt-1 flex items-start gap-2.5 rounded-[8px] px-3.5 py-3 text-[12.5px] leading-relaxed"
              style={{ background: BLUE_SOFT, color: BLUE_LINK }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="mt-px flex-shrink-0" aria-hidden="true">
                <circle cx="8" cy="8" r="6.4" stroke={BLUE_LINK} strokeWidth="1.3" />
                <path d="M8 7.2v3.6M8 5.2h.01" stroke={BLUE_LINK} strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span>Saved mappings are reused automatically on every future order for this buyer → supplier pair.</span>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-5 mb-3 rounded-[7px] px-3 py-2 text-[12px]" style={{ border: "1px solid #F5B8B8", background: "#FBE3E3", color: "#C53A3A" }}>
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t bg-white px-5 py-4 sm:flex-row sm:justify-end" style={{ borderColor: BORDER }}>
          <button
            onClick={onClose}
            className="flex h-10 items-center justify-center rounded-[7px] px-4 text-[13px] font-semibold transition-colors hover:bg-[#F6F7FA]"
            style={{ border: 0, background: "transparent", color: "#56627A" }}
          >
            Cancel
          </button>
          <button
            onClick={handleAction}
            disabled={saving}
            className="flex h-10 items-center justify-center gap-1.5 rounded-[7px] px-4 text-[13px] font-semibold transition-colors"
            style={{ border: 0, background: saving ? "#8A93A5" : GREEN, color: "#FFFFFF" }}
            onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.background = GREEN_DEEP; }}
            onMouseLeave={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.background = GREEN; }}
          >
            {isCodePanel && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="flex-shrink-0">
                <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {panel.kind === "export" ? "Prepare export" : panel.kind === "import" ? "Validate import" : "Save mapping"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Field labels in the modal are dark sentence-case (sampled from the render),
// not uppercase grey. RequiredField appends a red asterisk.
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12.5px] font-semibold" style={{ color: "#3A4255" }}>{label}</span>
      {children}
    </label>
  );
}

function RequiredField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[12.5px] font-semibold" style={{ color: "#3A4255" }}>
        {label} <span style={{ color: "#E5484D" }}>*</span>
      </span>
      {children}
    </label>
  );
}
