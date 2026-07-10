"use client";

// Mapping Editor — buyer↔supplier code translation table.
// Translated from Bridge_Mappings in v2-prototype.jsx.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient, isApiMockMode } from "@/lib/api-client";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import type { SupplierMapping } from "@/types/procurement";
import { PageShell } from "./layout/PageShell";
import { PageHeader } from "./layout/PageHeader";

// ─── Palette (sampled pixel-exact from the design render 2026-05-30) ───────────
// Topology semantics in this screen: the BUYER side is blue, the SUPPLIER side is
// green. The page-header primary action ("Add mapping") is buyer-blue; the in-modal
// commit action ("Save mapping") is green. AI provenance stays violet.
//
// Sampled values:
//   Add-mapping button fill ........ #1E66C9   (buyer-blue)
//   Buyer name link ................ #0F4FA8
//   Supplier name + supplier code .. #1E6D29   (supplier-green)
//   Card border / row divider ...... #E5E8EE
//   Modal eyebrow / info banner bg . #EAF0F8
const BLUE        = "#1E66C9"; // buyer-side primary (header button)
const BLUE_DEEP   = "#1A57AD"; // hover / active for blue button
const BLUE_LINK   = "#0F4FA8"; // buyer name link text
const BLUE_SOFT   = "#EAF0F8"; // light-blue tint: eyebrow square, info banner, Inherited badge
const GREEN       = "#2E8E3A"; // supplier-side commit accent (borders/focus) — canonical forest green
const GREEN_BTN   = "#297F34"; // solid fill under white text — ≈4.6:1 AA (2E8E3A was 4.16:1)
const GREEN_DEEP  = "#1E6D29"; // hover / active for green; also supplier name + supplier code text
const GREEN_SOFT  = "#E9F1EA"; // soft green tint for active chips / focus rings (brand-green-soft)
const GREEN_CODE  = "#1E6D29"; // supplier name + supplier code text (sampled)
const GREEN_CHIP  = "#E9F1EA"; // Imported badge fill (sampled, brand-green-soft)
const INK         = "#0B1A2F"; // buyer item code (near-black mono) + headings
const BORDER      = "#E5E8EE"; // card border + header rule + row divider (sampled)

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = "AI" | "Manual" | "Imported" | "Inherited";

type MappingRow = {
  id: string;
  buyer: string;        // buyer organisation name
  buyerCode: string;
  supplier: string;     // supplier organisation name
  supplierCode: string;
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
  AI:        { bg: "#F0EAFB", color: "#6F4FCE" },   // violet — AI provenance (sampled)
  Manual:    { bg: "#F1F3F7", color: "#5E6779" },   // neutral grey (sampled)
  Imported:  { bg: GREEN_CHIP, color: GREEN_CODE }, // green tint (sampled #E9F1EA/#1E6D29)
  Inherited: { bg: BLUE_SOFT,  color: BLUE_LINK },  // blue tint (sampled #EAF0F8/#0F4FA8)
};

function SourceTag({ src }: { src: Source }) {
  const s = SOURCE_STYLE[src];
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-[3px] text-[11.5px] font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      {src}
    </span>
  );
}

// ─── Mock rows (shown only in mock mode when no supplier is selected) ─────────

const MOCK_ROWS: MappingRow[] = [
  { id: "1",  buyer: "Heinrich Industries", buyerCode: "HX-4410", supplier: "Acme Components",  supplierCode: "ACM-PL-22",  source: "AI",        used: 41 },
  { id: "2",  buyer: "Heinrich Industries", buyerCode: "HX-4412", supplier: "Acme Components",  supplierCode: "ACM-FL-08",  source: "Manual",    used: 28 },
  { id: "3",  buyer: "Steelhouse Co.",      buyerCode: "ST-220",  supplier: "Acme Components",  supplierCode: "ACM-BR-55",  source: "Imported",  used: 17 },
  { id: "4",  buyer: "Nordmark Logistik",   buyerCode: "NM-9981", supplier: "BoltWorks BV",     supplierCode: "BLT-DV-20",  source: "AI",        used: 12 },
  { id: "5",  buyer: "Heinrich Industries", buyerCode: "HX-4411", supplier: "VanDerBerg Metaal",supplierCode: "VDB-88-2201",source: "Inherited", used:  9 },
  { id: "6",  buyer: "Centralis Pharma",    buyerCode: "CN-117",  supplier: "MedicaSupply",     supplierCode: "MED-AMP-5",  source: "Manual",    used:  6 },
  { id: "7",  buyer: "Heinrich Industries", buyerCode: "HX-4418", supplier: "Acme Components",  supplierCode: "ACM-NUT-M8", source: "AI",        used: 93 },
  { id: "8",  buyer: "Steelhouse Co.",      buyerCode: "ST-204",  supplier: "BoltWorks BV",     supplierCode: "BLT-RD-12",  source: "Manual",    used:  7 },
  { id: "9",  buyer: "Nordmark Logistik",   buyerCode: "NM-7750", supplier: "Acme Components",  supplierCode: "ACM-CS-50",  source: "Imported",  used: 11 },
  { id: "10", buyer: "Heinrich Industries", buyerCode: "HX-4490", supplier: "Acme Components",  supplierCode: "ACM-SCR-410",source: "AI",        used: 312 },
  { id: "11", buyer: "Centralis Pharma",    buyerCode: "CN-205",  supplier: "MedicaSupply",     supplierCode: "MED-BG-75",  source: "AI",        used: 55 },
  { id: "12", buyer: "Steelhouse Co.",      buyerCode: "ST-250",  supplier: "VanDerBerg Metaal",supplierCode: "VDB-ST-40",  source: "Inherited", used: 23 },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export function MappingEditor() {
  // Direction-aware copy: "Supplier" → "Customer" in inbound mode (route/types unchanged).
  const { labels } = useOrderDirection();
  const partyNoun = labels.counterpartyNoun;                       // "Supplier" | "Customer"
  const partyNounLower = partyNoun.toLowerCase();                  // "supplier" | "customer"
  const partyPluralLower = labels.counterpartyPlural.toLowerCase(); // "suppliers" | "customers"
  const allParties = `All ${partyPluralLower}`;                   // "All suppliers" | "All customers"

  const [search, setSearch]   = useState("");
  const [route, setRoute]     = useState(allParties);
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

  const { data: liveRows, isLoading: mappingsLoading, isError: mappingsError, refetch: refetchMappings } = useQuery({
    queryKey: ["supplier-mappings", selectedSupplierId],
    queryFn: () => apiClient.getSupplierMappings(selectedSupplierId!),
    enabled: !!selectedSupplierId && !isApiMockMode,
    staleTime: 30_000,
  });

  const selectedSupplierName =
    supplierList?.find((s) => s.id === selectedSupplierId)?.name ?? "";

  // In live mode the per-supplier mappings query only runs once a supplier is
  // chosen (mappings are stored per supplier, there is no cross-supplier list
  // endpoint). With the default "All suppliers" route the table would read as an
  // empty / "0 saved" account even when the org has mappings, so we instead
  // require an explicit supplier selection and show clear copy.
  const needsSupplierSelection = !isApiMockMode && !selectedSupplierId;

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
      m.supplierCode.toLowerCase().includes(q);
    const matchSrc = srcFilter === "All" || m.source === srcFilter;
    return matchSearch && matchSrc;
  });

  function openPanelForSupplier(kind: "import" | "export" | "add") {
    setNotice(null);

    // add / import / export all act on a single supplier. With the default
    // "All suppliers" route, fall back to the first supplier so the panel has a
    // concrete target (and never shows a misleading "choose a supplier" error).
    // In mock mode there are no real suppliers; the panel just shows a local notice.
    if (!isApiMockMode && !selectedSupplierId) {
      const firstSupplier = supplierList?.[0];
      if (!firstSupplier) {
        setNotice(
          kind === "export"
            ? `Add a ${partyNounLower} before exporting item-code mappings.`
            : `Add a ${partyNounLower} before saving item-code mappings.`,
        );
        return;
      }
      setSelectedSupplierId(firstSupplier.id);
      setRoute(firstSupplier.name);
    }

    setPanel({ kind });
  }

  return (
    <PageShell variant="wide" className="flex flex-col">
      {/* Page header — canonical PageHeader on the grey canvas */}
      <PageHeader
        title="Mappings"
        sub={
          needsSupplierSelection ? (
            `Buyer item codes (like HX-4410) are auto-translated to each ${partyNounLower}'s codes (like ACM-PL-22) on every order — set them up once and skip manual lookups. Pick a ${partyNounLower} above to start.`
          ) : (
            <>
              {isApiMockMode ? "Global buyer" : "Buyer"} → {partyNounLower} item code library ·{" "}
              <span style={{ color: "#0B1A2F", fontWeight: 600 }}>
                {allRows.length.toLocaleString()}
              </span>{" "}
              saved{isApiMockMode ? "" : selectedSupplierName ? ` for ${selectedSupplierName}` : ""}
            </>
          )
        }
        actions={
        <div className="grid w-full grid-cols-2 gap-2 lg:flex lg:w-auto">
          <button
            onClick={() => openPanelForSupplier("import")}
            className="flex h-10 items-center justify-center gap-1.5 rounded-[7px] px-3.5 text-[13px] font-medium transition-colors lg:h-[34px] lg:text-[12.5px]"
            style={{
              border: "1px solid #E5E8EE",
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
            onClick={() => openPanelForSupplier("add")}
            className="flex h-10 items-center justify-center gap-1.5 rounded-[7px] px-3.5 text-[13px] font-semibold transition-colors lg:h-[34px] lg:text-[12.5px]"
            title={`Map a buyer item code to a ${partyNounLower} item code`}
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
        }
      />

      {/* Result count + search — on the grey canvas, above the table card */}
      <div className="flex flex-col items-stretch gap-2 pb-3 lg:flex-row lg:items-center lg:gap-3 flex-shrink-0">
        <p className="text-[12.5px] flex-shrink-0" style={{ color: "#5E6779" }}>
          {needsSupplierSelection ? (
            <span style={{ color: "var(--ink-faint)" }}>No {partyNounLower} selected</span>
          ) : (
            <>
              Showing{" "}
              <span style={{ color: INK, fontWeight: 600 }}>{filtered.length}</span>{" "}
              of{" "}
              <span style={{ color: INK, fontWeight: 600 }}>
                {allRows.length.toLocaleString()}
              </span>
            </>
          )}
        </p>

        <div className="hidden flex-1 lg:block" />

        {/* Source filter chips — rounded-full pills, buyer-blue active (design v2) */}
        <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(["All", "AI", "Manual", "Imported", "Inherited"] as const).map((s) => {
            const active = srcFilter === s;
            return (
              <button
                key={s}
                onClick={() => setSrc(s)}
                className="h-9 flex-shrink-0 rounded-full px-3.5 text-[12.5px] font-semibold transition-colors lg:h-[28px] lg:px-3 lg:text-[11.5px]"
                style={{
                  border: `1px solid ${active ? BLUE : "#E5E8EE"}`,
                  background: active ? BLUE_SOFT : "#FFFFFF",
                  color: active ? BLUE_LINK : "#5E6779",
                }}
              >
                {s}
              </button>
            );
          })}
        </div>

        {/* Supplier route selector */}
        <select
          aria-label="Filter mappings by supplier"
          value={selectedSupplierId ?? ""}
          onChange={(e) => {
            const val = e.target.value;
            setSelectedSupplierId(val || null);
            setRoute(val ? (supplierList?.find(s => s.id === val)?.name ?? allParties) : allParties);
          }}
          className="h-10 w-full flex-shrink-0 appearance-none rounded-[7px] px-3 text-[13px] lg:h-[34px] lg:w-auto lg:text-[12.5px]"
          style={{
            border: "1px solid #E5E8EE",
            background: "#FFFFFF",
            color: INK,
          }}
        >
          <option value="">{allParties}</option>
          {(supplierList ?? []).map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>

        {/* Search */}
        <div className="relative w-full lg:w-[300px] flex-shrink-0">
          <span
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px]"
            style={{ color: "var(--ink-faint)" }}
          >
            ⌕
          </span>
          <input
            type="text"
            aria-label="Search mappings"
            placeholder={`Search buyer or ${partyNounLower} codes…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-[7px] pl-8 pr-3 text-[13px] transition-shadow lg:h-[34px] lg:text-[12.5px]"
            style={{
              border: "1px solid #E5E8EE",
              background: "#FFFFFF",
              color: INK,
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = GREEN;
              e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`;
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "#E5E8EE";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>

        {/* Export — kept reachable as a quiet ghost action (design header has none) */}
        <button
          onClick={() => openPanelForSupplier("export")}
          className="flex h-10 w-full flex-shrink-0 items-center justify-center gap-1 rounded-[7px] px-3 text-[13px] font-medium transition-colors lg:h-[34px] lg:w-auto lg:text-[12px]"
          style={{
            border: "1px solid #E5E8EE",
            background: "#FFFFFF",
            color: "#5E6779",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.background = "#F6F7FA")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.background = "#FFFFFF")}
        >
          Export
        </button>
      </div>

      {notice && (
        <div className="pb-3">
          <div className="rounded-[8px] px-3 py-2 text-[12px] leading-relaxed" style={{ border: "1px solid #BBD9BD", background: GREEN_SOFT, color: GREEN_DEEP }}>
            {notice}
          </div>
        </div>
      )}

      {/* Table card — white rounded card floating on the grey canvas (design v2: 12px radius, layered shadow) */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div
          className="overflow-hidden rounded-[12px]"
          style={{ background: "#FFFFFF", border: "1px solid #E5E8EE", boxShadow: "0 1px 3px rgba(11,26,47,0.05), 0 1px 2px rgba(11,26,47,0.04)" }}
        >

          {/* Live mode, no supplier chosen yet — prompt for selection instead of
              showing an empty / "0 saved" table (mappings are stored per supplier). */}
          {needsSupplierSelection && (
            <div
              className="flex flex-col items-center justify-center py-16 px-6 text-center"
              style={{ color: "var(--ink-faint)" }}
            >
              <span style={{ fontSize: 30, marginBottom: 10 }} aria-hidden="true">⇅</span>
              <p className="text-[13px] font-semibold" style={{ color: INK, marginBottom: 4 }}>
                Select a {partyNounLower} to view its mappings
              </p>
              <p className="text-[12.5px]" style={{ maxWidth: 380 }}>
                Item-code mappings are saved per {partyNounLower}. Choose a {partyNounLower} above to see
                its buyer → {partyNounLower} code library, or add a new mapping.
              </p>
            </div>
          )}

          {/* Loading skeleton when a supplier is selected and fetching */}
          {!isApiMockMode && selectedSupplierId && mappingsLoading && (
            <div className="px-5 py-4">
              {[1, 2, 3].map(i => (
                <div key={i} className="mb-3 h-9 rounded-[6px] animate-pulse" style={{ background: "#F0F2F6" }} />
              ))}
            </div>
          )}

          {/* Error state — a failed fetch must not read as an empty "0 saved" table */}
          {!isApiMockMode && selectedSupplierId && !mappingsLoading && mappingsError && (
            <div
              className="flex flex-col items-center justify-center py-16 px-6 text-center"
              style={{ color: "var(--ink-faint)" }}
            >
              <span style={{ fontSize: 30, marginBottom: 10 }} aria-hidden="true">⚠</span>
              <p className="text-[13px] font-semibold" style={{ color: "#B43838", marginBottom: 4 }}>
                Couldn't load mappings
              </p>
              <p className="text-[12.5px]" style={{ maxWidth: 380, marginBottom: 16 }}>
                Check your connection and try again.
              </p>
              <button
                onClick={() => refetchMappings()}
                className="flex h-9 items-center justify-center rounded-[7px] px-4 text-[12.5px] font-semibold"
                style={{ background: INK, color: "#FFFFFF", border: 0 }}
              >
                Retry
              </button>
            </div>
          )}

          {!needsSupplierSelection && !(!isApiMockMode && selectedSupplierId && mappingsLoading) && !(!isApiMockMode && selectedSupplierId && mappingsError) && (
            <>
              {/* Mobile card list — buyer (blue) → supplier (green) translation cards */}
              <div className="md:hidden" style={{ borderColor: BORDER }}>
                {filtered.map((row, idx) => (
                  <button
                    key={row.id}
                    onClick={() => { setNotice(null); setPanel({ kind: "edit", row }); }}
                    className="block w-full px-[18px] py-3.5 text-left active:bg-[#F1F3F7]"
                    style={{
                      background: "#FFFFFF",
                      border: "none",
                      borderTop: idx === 0 ? "none" : `1px solid #EEF0F4`,
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
                    {/* supplier name + used */}
                    <div className="flex items-center justify-between gap-3">
                      <p className="min-w-0 flex-1 truncate text-[12.5px]" style={{ color: "#5E6779" }}>
                        {row.supplier ? (
                          <span style={{ color: GREEN_CODE, fontWeight: 500 }}>{row.supplier}</span>
                        ) : (
                          "—"
                        )}
                      </p>
                      {row.used != null && (
                        <span className="flex-shrink-0 font-mono text-[11.5px]" style={{ color: "var(--ink-faint)" }}>
                          {row.used}×
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Desktop table — design v2: tinted header band, 9.5px caps labels, trailing chevron */}
              <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] border-collapse" style={{ fontSize: 12.5 }}>
                <thead
                  style={{
                    position: "sticky",
                    top: 0,
                    background: "#F1F3F7",
                    zIndex: 10,
                  }}
                >
                  <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {[
                      { label: "Buyer",              align: "left"  as const, title: undefined as string | undefined },
                      { label: "Buyer code",         align: "left"  as const, title: undefined as string | undefined },
                      { label: partyNoun,            align: "left"  as const, title: undefined as string | undefined },
                      { label: `${partyNoun} code`,  align: "left"  as const, title: undefined as string | undefined },
                      { label: "Source",             align: "left"  as const, title: `How the mapping was made — AI (ProcuLink suggested it), Manual (you typed it), Imported (from a file), Inherited (reused from another ${partyNounLower}). For AI: 90%+ is high confidence.` },
                      { label: "Used",               align: "right" as const, title: undefined as string | undefined },
                    ].map(({ label, align, title }, i) => (
                      <th
                        key={i}
                        className="px-[18px] py-[10px] text-[9.5px] font-bold uppercase tracking-[0.07em]"
                        style={{ color: "var(--ink-muted)", textAlign: align }}
                        title={title}
                      >
                        {label}
                        {title && (
                          <span
                            aria-hidden="true"
                            className="ml-1 inline-flex h-[13px] w-[13px] items-center justify-center rounded-full text-[9px] font-bold normal-case"
                            style={{ border: "1px solid #CBD0DA", color: "var(--ink-faint)", letterSpacing: 0 }}
                          >
                            i
                          </span>
                        )}
                      </th>
                    ))}
                    {/* trailing chevron column (design v2 — row affordance) */}
                    <th className="w-[40px] px-[18px] py-[10px]" aria-hidden="true" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, ri) => (
                    <tr
                      key={row.id}
                      className="group transition-colors cursor-pointer"
                      style={{ borderTop: ri ? `1px solid #EEF0F4` : "none" }}
                      onClick={() => { setNotice(null); setPanel({ kind: "edit", row }); }}
                      onMouseEnter={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "#F1F3F788")
                      }
                      onMouseLeave={(e) =>
                        ((e.currentTarget as HTMLElement).style.background = "transparent")
                      }
                    >
                      {/* Buyer name — buyer side is blue */}
                      <td className="px-[18px] py-3">
                        <span className="text-[12.5px] font-medium" style={{ color: BLUE_LINK }}>
                          {row.buyer || "—"}
                        </span>
                      </td>

                      {/* Buyer code — dark mono */}
                      <td className="px-[18px] py-3">
                        <span className="font-mono text-[12px] font-semibold tracking-[-0.01em]" style={{ color: INK }}>
                          {row.buyerCode}
                        </span>
                      </td>

                      {/* Supplier name — supplier side is green */}
                      <td className="px-[18px] py-3">
                        <span className="text-[12.5px] font-medium" style={{ color: GREEN_CODE }}>
                          {row.supplier || "—"}
                        </span>
                      </td>

                      {/* Supplier code — green mono */}
                      <td className="px-[18px] py-3">
                        <span className="font-mono text-[12px] font-semibold tracking-[-0.01em]" style={{ color: GREEN_CODE }}>
                          {row.supplierCode}
                        </span>
                      </td>

                      {/* Source */}
                      <td className="px-[18px] py-3">
                        <SourceTag src={row.source} />
                      </td>

                      {/* Used */}
                      <td
                        className="px-[18px] py-3 text-right font-mono text-[12px]"
                        style={{ color: "var(--ink-faint)" }}
                      >
                        {row.used != null ? `${row.used}×` : "—"}
                      </td>

                      {/* Trailing chevron — row-opens-editor affordance (design v2) */}
                      <td className="w-[40px] px-[18px] py-3 text-right">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" className="inline-block">
                          <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="#98A0AE" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>

              {filtered.length === 0 && allRows.length === 0 && (
                <div
                  className="flex flex-col items-center justify-center py-16"
                  style={{ color: "var(--ink-faint)" }}
                >
                  <span style={{ fontSize: 32, marginBottom: 8 }}>⊘</span>
                  <p className="text-[13px] font-semibold" style={{ color: INK, marginBottom: 4 }}>No item mappings yet</p>
                  <p className="text-[12.5px] text-center" style={{ maxWidth: 400 }}>
                    Add mappings to automatically translate your buyer item codes to {partyNounLower} item codes.
                  </p>
                </div>
              )}
              {filtered.length === 0 && allRows.length > 0 && (
                <div
                  className="flex flex-col items-center justify-center py-16"
                  style={{ color: "var(--ink-faint)" }}
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
          partyNoun={partyNoun}
          partyNounLower={partyNounLower}
          onClose={() => setPanel(null)}
          onDone={(message) => {
            setNotice(message);
            setPanel(null);
            void queryClient.invalidateQueries({ queryKey: ["supplier-mappings", selectedSupplierId] });
          }}
        />
      )}
    </PageShell>
  );
}

function MappingPanel({
  panel,
  route,
  supplierId,
  partyNoun,
  partyNounLower,
  onClose,
  onDone,
}: {
  panel: { kind: "import" | "export" | "add" | "edit"; row?: MappingRow };
  route: string;
  supplierId: string | null;
  partyNoun: string;        // "Supplier" | "Customer"
  partyNounLower: string;   // "supplier" | "customer"
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [buyerCode, setBuyerCode] = useState(panel.row?.buyerCode ?? "");
  const [supplierCode, setSupplierCode] = useState(panel.row?.supplierCode ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const queryClient = useQueryClient();

  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<Element | null>(null);

  // Capture the element that had focus when the modal opened, and restore it on close.
  useEffect(() => {
    triggerRef.current = document.activeElement;
    return () => {
      const el = triggerRef.current;
      if (el instanceof HTMLElement) el.focus();
    };
  }, []);

  // Autofocus the first field once the modal is mounted — prefer a form control,
  // falling back to the first focusable element (e.g. Close) if there is none.
  useEffect(() => {
    const root = dialogRef.current;
    if (!root) return;
    const field = root.querySelector<HTMLElement>("input:not([type='file']), select, textarea");
    const target =
      field ??
      root.querySelector<HTMLElement>(
        'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
      );
    target?.focus();
  }, []);

  // Escape to close + Tab focus trap within the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const nodes = Array.from(
        root.querySelectorAll<HTMLElement>(
          'input, select, textarea, button, [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled") && el.offsetParent !== null);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !root.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title =
    panel.kind === "import" ? "Import mappings" :
    panel.kind === "export" ? "Export mappings" :
    panel.kind === "add" ? "Add item code mapping" :
    "Edit item code mapping";

  const subtitle =
    panel.kind === "import" ? `Bulk upload a buyer → ${partyNounLower} code list` :
    panel.kind === "export" ? `Export this ${partyNounLower}'s mappings as CSV` :
    `Connect a buyer item code to a ${partyNounLower} code. Once saved, ProcuLink applies it automatically on every future order for this ${partyNounLower}.`;

  const isCodePanel = panel.kind === "add" || panel.kind === "edit";

  const handleAction = async () => {
    if (!supplierId) {
      setError(`Choose a ${partyNounLower} before saving mappings.`);
      return;
    }

    if (isApiMockMode) {
      // Demo mode: local-only notice
      const message =
        panel.kind === "export" ? `Export prepared for this ${partyNounLower}'s mappings.` :
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
      } else if (panel.kind === "import" && !importFile) {
        setError("Choose a CSV file first.");
        setSaving(false);
      } else {
        // Other edge case
        setSaving(false);
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end bg-[#0B1A2F66] p-0 sm:items-center sm:justify-center sm:p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mapping-panel-title"
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-auto rounded-t-[12px] bg-white shadow-2xl sm:max-w-[600px] sm:rounded-[12px]"
        style={{ border: `1px solid ${BORDER}` }}
      >
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
              <h2 id="mapping-panel-title" className="text-[18px] font-semibold leading-tight" style={{ color: INK }}>{title}</h2>
              <p className="mt-0.5 text-[12.5px]" style={{ color: "#5E6779" }}>{subtitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-[7px] text-[18px] leading-none transition-colors hover:bg-[#F6F7FA]"
            style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: "#5E6779" }}
          >
            ×
          </button>
        </div>

        {panel.kind === "import" && (
          <div className="grid gap-4 p-5">
            <div className="rounded-[8px] border border-dashed p-5 text-center" style={{ borderColor: "#BBD9BD", background: "#F2F9F3" }}>
              <div className="text-[13px] font-semibold" style={{ color: INK }}>Drop CSV here</div>
              <p className="mx-auto mt-1 max-w-[420px] text-[12px] leading-5" style={{ color: "#5E6779" }}>
                Two columns — your buyer code, then this {partyNounLower}&apos;s code. A header row is optional. Example:
              </p>
              <pre
                className="mx-auto mt-2 max-w-[420px] rounded-[6px] px-3 py-2 text-left font-mono text-[12px] leading-5"
                style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: INK }}
              >
                HX-4410,ACM-PL-22{"\n"}HX-4412,ACM-FL-08
              </pre>
              <p className="mx-auto mt-2 max-w-[420px] text-[12px] leading-5" style={{ color: "#5E6779" }}>
                CSV or Excel (XLSX, first sheet). UTF-8 recommended. Extra columns and blank lines are ignored. New codes are added; a repeated buyer code replaces its old {partyNounLower} code.
              </p>
              <label className="mt-4 inline-flex h-10 cursor-pointer items-center rounded-[7px] px-4 text-[13px] font-semibold" style={{ border: `1px solid ${BORDER}`, background: "#FFFFFF", color: INK }}>
                {importFile ? importFile.name : "Choose file"}
                <input type="file" accept=".csv" className="sr-only" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
            <div className="rounded-[7px] border border-[#E5E8EE] bg-[#F6F7FA] p-3 text-[12px] leading-5" style={{ color: "#5E6779" }}>
              {isApiMockMode || !supplierId
                ? "Import runs on the backend import endpoint. Connect an API session to upsert mappings from your CSV."
                : "Select a CSV file with buyer_code and supplier_code columns. Existing mappings will be updated; new codes will be added."}
            </div>
          </div>
        )}

        {panel.kind === "export" && (
          <div className="grid gap-3.5 p-5">
            {/* Supplier (context) — export always covers the selected supplier */}
            <Field label={partyNoun}>
              <div
                className="flex h-10 w-full items-center rounded-[7px] px-3 text-[13px]"
                style={{ border: `1px solid ${BORDER}`, background: "#F8FAFC", color: GREEN_CODE, fontWeight: 500 }}
              >
                {route}
              </div>
            </Field>
            <div
              className="flex items-start gap-2.5 rounded-[8px] px-3.5 py-3 text-[12.5px] leading-relaxed"
              style={{ background: BLUE_SOFT, color: BLUE_LINK }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="mt-px flex-shrink-0" aria-hidden="true">
                <circle cx="8" cy="8" r="6.4" stroke={BLUE_LINK} strokeWidth="1.3" />
                <path d="M8 7.2v3.6M8 5.2h.01" stroke={BLUE_LINK} strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span>Downloads this {partyNounLower}&apos;s mappings as a CSV (buyer_code, supplier_code).</span>
            </div>
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
            <Field label={partyNoun}>
              <div
                className="flex h-10 w-full items-center rounded-[7px] px-3 text-[13px]"
                style={{ border: `1px solid ${BORDER}`, background: "#F8FAFC", color: GREEN_CODE, fontWeight: 500 }}
              >
                {panel.row?.supplier?.trim() || route}
              </div>
            </Field>

            {/* Supplier item code — required, mono */}
            <RequiredField label={`${partyNoun} item code`}>
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

            {/* Info banner — blue, matches render */}
            <div
              className="mt-1 flex items-start gap-2.5 rounded-[8px] px-3.5 py-3 text-[12.5px] leading-relaxed"
              style={{ background: BLUE_SOFT, color: BLUE_LINK }}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="mt-px flex-shrink-0" aria-hidden="true">
                <circle cx="8" cy="8" r="6.4" stroke={BLUE_LINK} strokeWidth="1.3" />
                <path d="M8 7.2v3.6M8 5.2h.01" stroke={BLUE_LINK} strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <span>Saved mappings are reused automatically on every future order for this buyer → {partyNounLower} pair.</span>
            </div>
          </div>
        )}

        {error && (
          <div className="mx-5 mb-3 rounded-[7px] px-3 py-2 text-[12px]" style={{ border: "1px solid #F5B8B8", background: "#FBE3E3", color: "#B43838" }}>
            {error}
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 border-t bg-white px-5 py-4 sm:flex-row sm:justify-end" style={{ borderColor: BORDER }}>
          {panel.kind === "edit" && panel.row && (
            <button
              onClick={async () => {
                if (!panel.row) return;
                setSaving(true);
                setError(null);
                try {
                  await apiClient.deleteSupplierMapping(supplierId, panel.row.id);
                  await queryClient.invalidateQueries({ queryKey: ["supplier-mappings", supplierId] });
                  onDone("Mapping deleted.");
                } catch (e: unknown) {
                  setError(e instanceof Error ? e.message : "Delete failed");
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="flex h-10 items-center justify-center rounded-[7px] px-4 text-[13px] font-semibold transition-colors sm:mr-auto"
              style={{ border: "1px solid #F0C0C0", background: "#FFFFFF", color: "#B43838", opacity: saving ? 0.6 : 1 }}
            >
              Delete
            </button>
          )}
          <button
            onClick={onClose}
            className="flex h-10 items-center justify-center rounded-[7px] px-4 text-[13px] font-semibold transition-colors hover:bg-[#F6F7FA]"
            style={{ border: 0, background: "transparent", color: "#5E6779" }}
          >
            Cancel
          </button>
          <button
            onClick={handleAction}
            disabled={saving || (panel.kind === "import" && !importFile)}
            className="flex h-10 items-center justify-center gap-1.5 rounded-[7px] px-4 text-[13px] font-semibold transition-colors"
            style={{ border: 0, background: saving ? "var(--ink-faint)" : GREEN_BTN, color: "#FFFFFF" }}
            onMouseEnter={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.background = GREEN_DEEP; }}
            onMouseLeave={(e) => { if (!saving) (e.currentTarget as HTMLElement).style.background = GREEN_BTN; }}
          >
            {isCodePanel && (
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="flex-shrink-0">
                <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            {/* "Import mappings" (not "Validate import"): in a live API session this
                upserts the rows for real (Imported: X created, Y updated) — the label
                must match the write it performs, matching the panel title above. */}
            {panel.kind === "export" ? "Export CSV" : panel.kind === "import" ? "Import mappings" : "Save mapping"}
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
