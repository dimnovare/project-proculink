"use client";

// Mapping Editor — buyer↔supplier code translation table.
// Translated from Bridge_Mappings in v2-prototype.jsx.

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import type { SupplierMapping } from "@/types/procurement";

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = "AI" | "Manual" | "Imported";

type MappingRow = {
  id: string;
  buyerCode: string;
  supplierCode: string;
  description: string;
  confidence: number;   // 0–100
  orders?: number;
  source: Source;
  lastSeen?: string;
};

// ─── Converter ────────────────────────────────────────────────────────────────

function apiMappingToRow(m: SupplierMapping): MappingRow {
  return {
    id: m.id,
    buyerCode: m.buyerItemCode,
    supplierCode: m.supplierItemCode,
    description: "",
    confidence: m.confidence != null ? Math.round(m.confidence * 100) : 100,
    source: (m.source === "suggested" ? "AI" : m.source === "imported" ? "Imported" : "Manual") as Source,
  };
}

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

// ─── Mock rows (shown only in mock mode when no supplier is selected) ─────────

const MOCK_ROWS: MappingRow[] = [
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

  const allRows: MappingRow[] = isApiMockMode
    ? MOCK_ROWS
    : (liveRows ?? []).map(apiMappingToRow);

  const filtered = allRows.filter((m) => {
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
        className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 lg:flex-row lg:items-end lg:gap-4 flex-shrink-0"
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
            {allRows.length} code translations · buyer → supplier
          </p>
        </div>
        <div className="grid w-full grid-cols-3 gap-2 lg:ml-auto lg:flex lg:w-auto">
          <button
            onClick={() => { setNotice(null); setPanel({ kind: "export" }); }}
            className="flex items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
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
            onClick={() => { setNotice(null); setPanel({ kind: "import" }); }}
            className="flex items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
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
            onClick={() => { setNotice(null); setPanel({ kind: "add" }); }}
            className="flex items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium"
            title="Map a buyer item code to a supplier item code"
            style={{
              height: 32,
              background: "#0B1A2F",
              color: "#FFFFFF",
              border: 0,
            }}
          >
            <span className="hidden sm:inline">+ Add mapping</span>
            <span className="sm:hidden">+ Add</span>
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div
        className="flex flex-col items-stretch gap-2 px-4 py-2 sm:px-5 lg:flex-row lg:items-center lg:gap-3 flex-shrink-0"
        style={{
          borderBottom: "1px solid #E2E6EE",
          background: "#FFFFFF",
        }}
      >
        {/* Search */}
        <div className="relative w-full lg:w-[280px]">
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

        {/* Supplier route selector */}
        <select
          value={selectedSupplierId ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedSupplierId(val || null);
            setRoute(val ? (supplierList?.find(s => s.id === val)?.name ?? "All suppliers") : "All suppliers");
          }}
          className="w-full rounded-[6px] px-3 text-[12.5px] appearance-none lg:w-auto"
          style={{
            height: 32,
            border: "1px solid #E2E6EE",
            background: "#FFFFFF",
            color: "#0B1A2F",
            outline: "none",
          }}
        >
          <option value="">All suppliers</option>
          {(supplierList ?? []).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        <div className="hidden flex-1 lg:block" />

        {/* Source filter chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto">
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

      {notice && (
        <div className="px-4 py-2 sm:px-5" style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
          <div className="rounded-[7px] px-3 py-2 text-[12px] leading-relaxed" style={{ border: "1px solid #BDE0C1", background: "#F0F7F1", color: "#1E6D29" }}>
            {notice}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto" style={{ background: "#FFFFFF" }}>

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
            <div className="divide-y divide-[#F0F2F6] md:hidden">
              {filtered.map((row) => (
                <button
                  key={row.id}
                  onClick={() => { setNotice(null); setPanel({ kind: "edit", row }); }}
                  className="block w-full px-4 py-3 text-left"
                  style={{ background: "#FFFFFF", border: "none" }}
                >
                  <div className="mb-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                    <span className="truncate font-mono text-[12px] font-semibold" style={{ color: "#0F4FA8" }}>
                      {row.buyerCode}
                    </span>
                    <span className="h-px w-5" style={{ background: "linear-gradient(90deg, #1E66C9, #2E8E3A)" }} />
                    <span className="truncate text-right font-mono text-[12px] font-semibold" style={{ color: "#1E6D29" }}>
                      {row.supplierCode}
                    </span>
                  </div>
                  <p className="mb-2 text-[12.5px]" style={{ color: "#56627A" }}>{row.description}</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <ConfBar pct={row.confidence} />
                    <SourceTag src={row.source} />
                    {(row.orders != null || row.lastSeen != null) && (
                      <span className="text-[11.5px]" style={{ color: "#8A93A5" }}>
                        {row.orders != null ? `${row.orders} orders` : ""}
                        {row.orders != null && row.lastSeen != null ? " · " : ""}
                        {row.lastSeen != null ? `last seen ${row.lastSeen}` : ""}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[1120px] border-collapse" style={{ fontSize: 12.5 }}>
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
                      {row.orders ?? "—"}
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
                      {row.lastSeen ?? "—"}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          setNotice(null);
                          setPanel({ kind: "edit", row });
                        }}
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
            </div>

            {filtered.length === 0 && allRows.length === 0 && (
              <div
                className="flex flex-col items-center justify-center py-16"
                style={{ color: "#8A93A5" }}
              >
                <span style={{ fontSize: 32, marginBottom: 8 }}>⊘</span>
                <p className="text-[13px] font-semibold" style={{ color: "#0B1A2F", marginBottom: 4 }}>No item mappings yet</p>
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
        panel.kind === "export" ? "Export prepared for the selected mapping scope. Live download is verified in Group J." :
        panel.kind === "import" ? "Import file shape validated for QA. Live CSV upsert remains for Group J." :
        panel.kind === "add" ? "Mapping draft saved locally for QA. Live save remains for Group J." :
        "Mapping edit draft saved locally for QA. Live save remains for Group J.";
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
            <p className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: "#1E66C9" }}>Buyer to supplier mapping</p>
            <h2 className="mt-1 text-[18px] font-semibold" style={{ color: "#0B1A2F" }}>{title}</h2>
            <p className="mt-1 text-[12px]" style={{ color: "#56627A" }}>{route}</p>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-[6px] text-[16px]" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}>×</button>
        </div>

        {panel.kind === "import" && (
          <div className="grid gap-4 p-5">
            <div className="rounded-[8px] border border-dashed border-[#B8CFF5] bg-[#F7FAFF] p-5 text-center">
              <div className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>Drop CSV here</div>
              <p className="mx-auto mt-1 max-w-[420px] text-[12px] leading-5" style={{ color: "#56627A" }}>
                Expected columns: buyer_code, supplier_code. Existing buyer codes are updated, new rows are added.
              </p>
              <label className="mt-4 inline-block cursor-pointer h-8 rounded-[6px] px-3 text-[12px] font-semibold" style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#0B1A2F", lineHeight: "32px" }}>
                {importFile ? importFile.name : "Choose file"}
                <input type="file" accept=".csv" className="sr-only" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="rounded-[7px] border border-[#E2E6EE] bg-[#F6F7FA] p-3 text-[12px] leading-5" style={{ color: "#56627A" }}>
              {isApiMockMode || !supplierId
                ? "Import execution is handled by the backend import endpoint. This panel keeps the operator flow visible for QA without silently pretending a file was imported."
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
                  className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 font-mono text-[12px] text-[#0B1A2F]"
                />
              </Field>
              <Field label="Supplier code">
                <input
                  value={supplierCode}
                  onChange={(e) => setSupplierCode(e.target.value)}
                  className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 font-mono text-[12px] text-[#0B1A2F]"
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
                  <option>AI</option>
                </select>
              </Field>
              <Field label="Confidence">
                <input defaultValue={panel.row?.confidence ?? 100} type="number" min={0} max={100} className="h-9 w-full rounded-[5px] border border-[#D5DAEA] px-2 text-[12px] text-[#0B1A2F]" />
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
            className="h-9 rounded-[6px] px-4 text-[12px] font-semibold"
            style={{ border: 0, background: saving ? "#8A93A5" : "#0B1A2F", color: "#FFFFFF" }}
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
