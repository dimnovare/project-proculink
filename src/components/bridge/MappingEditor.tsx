"use client";

// Mapping Editor — buyer↔supplier code translation table.
// Translated from Bridge_Mappings in v2-prototype.jsx.

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { SupplierMapping } from "@/types/procurement";

// ─── Brand accent (post-recolor: primary accent is emerald green) ──────────────
// Source of truth: ds-tokens color.brand / globals.css --brand-green.
// Links + supplier-side codes use brand green; the buyer item code stays a deep
// navy mono (matches the design's near-black code); AI provenance stays violet.
const GREEN       = "#28C55E"; // primary accent
const GREEN_DEEP  = "#1DAF50"; // hover / active / supplier-code text
const GREEN_SOFT  = "#DCFCE7"; // soft tint for active chips, focus, hover rows
const INK         = "#0B1A2F"; // buyer item code (near-black mono)

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
// Pill colours sampled from the design: AI=violet, Manual=neutral grey,
// Imported=brand green, Inherited=blue. No decorative sparkle.

const SOURCE_STYLE: Record<Source, { bg: string; color: string }> = {
  AI:        { bg: "#EEE7FB", color: "#6F4FCE" },   // violet — AI provenance (canonical)
  Manual:    { bg: "#EFF2F7", color: "#56627A" },   // neutral grey
  Imported:  { bg: "#E2F1E2", color: "#1E6D29" },   // green tint
  Inherited: { bg: "#DCFCE7", color: "#1DAF50" },   // green tint
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
            className="flex items-center justify-center gap-1.5 rounded-[7px] px-3.5 text-[12.5px] font-medium transition-colors"
            style={{
              height: 34,
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
            className="flex items-center justify-center gap-1.5 rounded-[7px] px-3.5 text-[12.5px] font-semibold transition-colors"
            title="Map a buyer item code to a supplier item code"
            style={{
              height: 34,
              background: GREEN,
              color: "#FFFFFF",
              border: 0,
              boxShadow: "0 1px 2px rgba(11,26,47,0.08)",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = GREEN_DEEP)}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = GREEN)}
          >
            <span className="text-[15px] leading-none" style={{ marginTop: -1 }}>+</span>
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
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(["All", "AI", "Manual", "Imported", "Inherited"] as const).map((s) => {
            const active = srcFilter === s;
            return (
              <button
                key={s}
                onClick={() => setSrc(s)}
                className="rounded-[6px] px-2.5 text-[12px] font-medium transition-colors flex-shrink-0"
                style={{
                  height: 30,
                  border: `1px solid ${active ? "#28C55E55" : "#E2E6EE"}`,
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
          className="w-full rounded-[7px] px-3 text-[12.5px] appearance-none lg:w-auto flex-shrink-0"
          style={{
            height: 34,
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
            className="w-full rounded-[7px] pl-8 pr-3 text-[12.5px] transition-shadow"
            style={{
              height: 34,
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
          className="flex items-center justify-center gap-1 rounded-[7px] px-3 text-[12px] font-medium transition-colors flex-shrink-0"
          style={{
            height: 34,
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
          <div className="rounded-[8px] px-3 py-2 text-[12px] leading-relaxed" style={{ border: "1px solid #A7E3BC", background: GREEN_SOFT, color: GREEN_DEEP }}>
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
              {/* Mobile card list */}
              <div className="divide-y divide-[#F0F2F6] md:hidden">
                {filtered.map((row) => (
                  <button
                    key={row.id}
                    onClick={() => { setNotice(null); setPanel({ kind: "edit", row }); }}
                    className="block w-full px-4 py-3 text-left"
                    style={{ background: "#FFFFFF", border: "none" }}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="truncate text-[12.5px] font-medium" style={{ color: GREEN_DEEP }}>
                        {row.buyer || "—"}
                      </span>
                      <SourceTag src={row.source} />
                    </div>
                    <div className="mb-1.5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                      <span className="truncate font-mono text-[12px] font-semibold" style={{ color: INK }}>
                        {row.buyerCode}
                      </span>
                      <span className="h-px w-5" style={{ background: `linear-gradient(90deg, ${GREEN_DEEP}, ${GREEN})` }} />
                      <span className="truncate text-right font-mono text-[12px] font-semibold" style={{ color: GREEN_DEEP }}>
                        {row.supplierCode}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-[12.5px]" style={{ color: "#56627A" }}>{row.description}</p>
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
                  <tr style={{ borderBottom: "1px solid #E2E6EE" }}>
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
                        className="px-4 py-3 text-[10.5px] font-semibold uppercase tracking-[0.06em]"
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
                      style={{ borderBottom: "1px solid #F0F2F6" }}
                      onClick={() => { setNotice(null); setPanel({ kind: "edit", row }); }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "#FAFBFC")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "transparent")
                      }
                    >
                      {/* Buyer name */}
                      <td className="px-4 py-3.5">
                        <span className="text-[12.5px] font-medium" style={{ color: GREEN_DEEP }}>
                          {row.buyer || "—"}
                        </span>
                      </td>

                      {/* Buyer code */}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-[12px] font-semibold" style={{ color: INK }}>
                          {row.buyerCode}
                        </span>
                      </td>

                      {/* Supplier name */}
                      <td className="px-4 py-3.5">
                        <span className="text-[12.5px] font-medium" style={{ color: GREEN_DEEP }}>
                          {row.supplier || "—"}
                        </span>
                      </td>

                      {/* Supplier code */}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-[12px] font-semibold" style={{ color: GREEN_DEEP }}>
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
    panel.kind === "add" ? "Add mapping" :
    "Edit mapping";

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
      <div className="max-h-[92vh] w-full overflow-auto rounded-t-[10px] bg-white shadow-2xl sm:max-w-[620px] sm:rounded-[10px]" style={{ border: "1px solid #E2E6EE" }}>
        <div className="flex items-start justify-between gap-4 border-b border-[#E2E6EE] px-5 py-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: GREEN_DEEP }}>Buyer to supplier mapping</p>
            <h2 className="mt-1 text-[18px] font-semibold" style={{ color: INK }}>{title}</h2>
            <p className="mt-1 text-[12px]" style={{ color: "#56627A" }}>{route}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-[6px] text-[16px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>×</button>
        </div>

        {panel.kind === "import" && (
          <div className="grid gap-4 p-5">
            <div className="rounded-[8px] border border-dashed p-5 text-center" style={{ borderColor: "#A7E3BC", background: "#F3FCF6" }}>
              <div className="text-[13px] font-semibold" style={{ color: INK }}>Drop CSV here</div>
              <p className="mx-auto mt-1 max-w-[420px] text-[12px] leading-5" style={{ color: "#56627A" }}>
                Expected columns: buyer_code, supplier_code. Existing buyer codes are updated, new rows are added.
              </p>
              <label className="mt-4 inline-block cursor-pointer h-8 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: INK, lineHeight: "32px" }}>
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
          <div className="grid gap-4 p-5">
            <div className="grid gap-3 rounded-[8px] border border-[#E2E6EE] bg-[#FFFFFF] p-4">
              <Field label="Export scope">
                <select defaultValue="filtered" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
                  <option value="filtered">Current filters</option>
                  <option value="route">Selected route</option>
                  <option value="all">All mappings</option>
                </select>
              </Field>
              <Field label="Format">
                <select defaultValue="csv" className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
                  <option value="csv">CSV</option>
                  <option value="xlsx">XLSX</option>
                </select>
              </Field>
            </div>
          </div>
        )}

        {(panel.kind === "add" || panel.kind === "edit") && (
          <div className="grid gap-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Buyer code">
                <input
                  value={buyerCode}
                  onChange={(e) => setBuyerCode(e.target.value)}
                  placeholder="e.g. HX-4411"
                  className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2.5 font-mono text-[12px] text-[#0B1A2F] outline-none transition-shadow"
                  onFocus={(e) => { e.currentTarget.style.borderColor = GREEN; e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "#D5DAEA"; e.currentTarget.style.boxShadow = "none"; }}
                />
              </Field>
              <Field label="Supplier code">
                <input
                  value={supplierCode}
                  onChange={(e) => setSupplierCode(e.target.value)}
                  placeholder="e.g. ACM-PV-M20"
                  className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2.5 font-mono text-[12px] text-[#0B1A2F] outline-none transition-shadow"
                  onFocus={(e) => { e.currentTarget.style.borderColor = GREEN; e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "#D5DAEA"; e.currentTarget.style.boxShadow = "none"; }}
                />
              </Field>
            </div>
            <Field label="Description">
              <input defaultValue={panel.row?.description ?? ""} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Source">
                <select defaultValue={panel.row?.source ?? "Manual"} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]">
                  <option>Manual</option>
                  <option>Imported</option>
                  <option>Inherited</option>
                  <option>AI</option>
                </select>
              </Field>
              <Field label="Times used">
                <input defaultValue={panel.row?.used ?? 0} type="number" min={0} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
              </Field>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-5 mb-3 rounded-[7px] px-3 py-2 text-[12px]" style={{ border: "1px solid #F5B8B8", background: "#FBE3E3", color: "#C53A3A" }}>
            {error}
          </div>
        )}

        <div className="flex flex-col gap-2 border-t border-[#E2E6EE] bg-[#F6F7FA] px-5 py-4 sm:flex-row sm:justify-end">
          <button onClick={onClose} className="h-9 rounded-[6px] px-4 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>Cancel</button>
          <button
            onClick={handleAction}
            disabled={saving}
            className="h-9 rounded-[6px] px-4 text-[12px] font-semibold transition-colors"
            style={{ border: 0, background: saving ? "#8A93A5" : GREEN, color: "#FFFFFF" }}
            onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.background = GREEN_DEEP; }}
            onMouseLeave={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.background = GREEN; }}
          >
            {panel.kind === "export" ? "Prepare export" : panel.kind === "import" ? "Validate import" : "Save draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-[11px] font-semibold uppercase" style={{ color: "#8A93A5" }}>{label}</span>
      {children}
    </label>
  );
}
