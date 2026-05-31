"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/bridge/EmptyState";
import { getBuyers, createBuyer, deleteBuyer, isApiMockMode } from "@/lib/api-client";
import type { BuyerDto } from "@/types/procurement";

// ── Palette (sampled pixel-exact from the design render) ──────────────────
// Green accent (project primary) — interactive buttons + success surfaces.
const GREEN       = "#28C55E";
const GREEN_HOVER = "#1DAF50";
const GREEN_SOFT  = "#DCFCE7";
// Buyer-blue — the buyer entity is represented in blue across the product
// (icon tile, active-row band). Sampled from zoom_table.png: tile #E3EDFB,
// stroke #0F4FA8, active row band #E3EDFB.
const BUYER_TILE   = "#E3EDFB"; // icon-tile fill
const BUYER_STROKE = "#1E66C9"; // buyer-blue icon stroke (render reads #0F4FA8; brand buyer-blue)
const ROW_ACTIVE   = "#E3EDFB"; // hover / selected row band (pale blue, NOT green)
// Status dots use the render's deeper forest green (#2E8E3A), distinct from the
// brand button green so the small markers read crisp on white.
const DOT_GREEN    = "#2E8E3A";
// Neutrals
const INK          = "#0B1A2F"; // primary text
const INK_SLATE    = "#3F4A5C"; // dark-slate (volume digits)
const TEXT_MUTED   = "#56627A"; // pill text / subtitle
const TEXT_FAINT   = "#8A93A5"; // header labels / counts / /wk
const CODE_GREY    = "#9196A5"; // buyer short-code
const BORDER       = "#E2E6EE"; // card border + row dividers
const PILL_BG      = "#EFF2F7"; // inbound-channel pill fill
const CHEVRON      = "#A4ADBD"; // resting chevron

const MOCK_BUYERS: BuyerDto[] = [
  { id: "b1", name: "Heinrich Industries GmbH", code: "HEI", orderCount: 1820, lastOrderAge: "2m",  formats: ["PDF", "XLSX"] },
  { id: "b2", name: "Nordmark Logistics A/S",   code: "NRD", orderCount: 1104, lastOrderAge: "14m", formats: ["cXML", "EDI"] },
  { id: "b3", name: "Steelhouse Construction",  code: "SHC", orderCount: 812,  lastOrderAge: "1h",  formats: ["XLSX", "CSV"] },
];

// Map a buyer's primary inbound file format → a plain-language inbound-channel
// label, matching the single-channel column in the design. Labels are returned
// in their final display casing (the badge renders them verbatim — acronyms stay
// uppercase, "cXML / webhook" keeps its mixed case), so do NOT uppercase-transform
// the badge.
function inboundChannel(formats: string[]): string {
  const f = (formats[0] ?? "").toUpperCase();
  if (f === "CXML" || f === "JSON" || f === "API") return formats.length > 1 ? "cXML / webhook" : "API";
  if (f === "EDI")                                  return "SFTP";
  if (f === "PDF" || f === "EMAIL")                 return "EMAIL";
  if (f === "XLSX" || f === "CSV" || f === "XML")   return "EMAIL";
  return f || "EMAIL";
}

// Suppliers reached: BuyerDto has no dedicated field yet, so we derive a small
// count from the number of accepted formats as a stable visual proxy.
function suppliersReached(b: BuyerDto): number {
  return Math.max(1, Math.min(4, b.formats.length));
}

// ── Shared cell content (reused by desktop table + mobile cards) ──────────

function BuyerIcon() {
  // building / org glyph in a soft-blue tile — the buyer entity colour
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: BUYER_TILE,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BUYER_STROKE} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="1" />
        <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
      </svg>
    </div>
  );
}

function ChannelPill({ label }: { label: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.01em",
        // Render the label verbatim — acronyms (EMAIL/API/SFTP) are already
        // uppercase, "cXML / webhook" keeps its mixed case.
        color: TEXT_MUTED,
        background: PILL_BG,
        border: "none",
        borderRadius: 6,
        padding: "4px 10px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function SuppliersDots({ count }: { count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: DOT_GREEN,
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 12.5, color: TEXT_FAINT, fontVariantNumeric: "tabular-nums" }}>
        {count}
      </span>
    </div>
  );
}

function VolumeText({ value }: { value: number }) {
  return (
    <span
      style={{
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
        fontWeight: 500,
        fontSize: 12.5,
        color: INK_SLATE,
        whiteSpace: "nowrap",
      }}
    >
      {value.toLocaleString()}
      <span style={{ color: TEXT_FAINT }}>/wk</span>
    </span>
  );
}

function SkeletonTrow() {
  const widths = [180, 90, 60, 70, 48, 16];
  return (
    <tr>
      {widths.map((w, i) => (
        <td key={i} style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, textAlign: i >= 4 ? "right" : "left" }}>
          <div
            className="animate-pulse rounded"
            style={{ background: "#EFF2F7", height: 14, width: w, marginLeft: i >= 4 ? "auto" : 0 }}
          />
        </td>
      ))}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div style={{ padding: "16px 16px", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="animate-pulse" style={{ width: 32, height: 32, borderRadius: 8, background: "#EFF2F7", flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div className="animate-pulse rounded" style={{ background: "#EFF2F7", height: 13, width: "60%" }} />
          <div className="animate-pulse rounded" style={{ background: "#EFF2F7", height: 10, width: 48, marginTop: 7 }} />
        </div>
      </div>
    </div>
  );
}

export default function BuyersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [addOpen, setAddOpen]   = useState(false);
  const [addName, setAddName]   = useState("");
  const [addCode, setAddCode]   = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["buyers"],
    queryFn:  getBuyers,
    enabled:  !isApiMockMode,
  });

  const buyers: BuyerDto[] = isApiMockMode ? MOCK_BUYERS : (data ?? []);

  const createMut = useMutation({
    mutationFn: ({ name, code }: { name: string; code: string }) =>
      createBuyer(name, code),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
      setAddOpen(false);
      setAddName("");
      setAddCode("");
      setAddError(null);
    },
    onError: (err: Error) => {
      setAddError(err.message ?? "Failed to create buyer.");
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteBuyer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["buyers"] });
    },
  });

  function handleSaveAdd() {
    if (!addName.trim()) { setAddError("Name is required."); return; }
    if (!addCode.trim()) { setAddError("Code is required."); return; }
    setAddError(null);
    createMut.mutate({ name: addName.trim(), code: addCode.trim() });
  }

  function handleDelete(e: React.MouseEvent, buyer: BuyerDto) {
    e.stopPropagation();
    if (!window.confirm(`Delete buyer "${buyer.name}"? This cannot be undone.`)) return;
    deleteMut.mutate(buyer.id);
  }

  const countLabel = isLoading && !isApiMockMode
    ? "Loading…"
    : `${buyers.length} buyer${buyers.length !== 1 ? "s" : ""} · where every order starts`;

  const showSkeleton = isLoading && !isApiMockMode;
  const showError    = isError && !isApiMockMode;
  const showRows     = (!isLoading || isApiMockMode) && !isError;

  return (
    <div className="mx-auto max-w-[1480px] px-4 pb-16 pt-5 sm:px-6 md:px-[34px] sm:pt-[26px]">
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "14px 24px",
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            className="text-[26px] sm:text-[30px]"
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.1,
              margin: 0,
              color: INK,
            }}
          >
            Buyers
          </h1>
          <div style={{ color: TEXT_MUTED, fontSize: 13, marginTop: 5 }}>
            {countLabel}
          </div>
        </div>

        {/* New buyer button — project accent is green */}
        <button
          onClick={() => { setAddOpen((v) => !v); setAddError(null); }}
          className="h-9 sm:h-[34px]"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            padding: "0 16px",
            borderRadius: 7,
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            background: addOpen ? GREEN_HOVER : "var(--brand-green, #28C55E)",
            color: "#FFFFFF",
            border: "none",
            cursor: "pointer",
            boxShadow: addOpen ? "none" : "0 1px 2px rgba(40,197,94,0.30)",
            transition: "background 150ms",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { if (!addOpen) (e.currentTarget as HTMLButtonElement).style.background = GREEN_HOVER; }}
          onMouseLeave={(e) => { if (!addOpen) (e.currentTarget as HTMLButtonElement).style.background = GREEN; }}
        >
          {/* plus icon */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5v14" />
          </svg>
          {addOpen ? "Cancel" : "New buyer"}
        </button>
      </div>

      {/* Create buyer panel */}
      {addOpen && (
        <div
          style={{
            background: "#FFFFFF",
            border: `1px solid ${BORDER}`,
            borderRadius: 10,
            padding: 18,
            marginBottom: 18,
            boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
          }}
        >
          {/* Panel header */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontWeight: 600,
                fontSize: 15,
                letterSpacing: "-0.01em",
                color: INK,
              }}
            >
              New buyer
            </div>
            <div style={{ color: TEXT_MUTED, fontSize: 12.5 }}>
              A buyer that sends you purchase orders
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            {/* Buyer name */}
            <div style={{ flex: 1 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: TEXT_MUTED,
                  marginBottom: 6,
                }}
              >
                Buyer name <span style={{ color: "#C53A3A", marginLeft: 3 }}>*</span>
              </label>
              <input
                className="h-10 sm:h-[34px]"
                style={{
                  width: "100%",
                  padding: "0 11px",
                  borderRadius: 6,
                  border: "1px solid #C6CDDA",
                  background: "#FFFFFF",
                  fontSize: 13,
                  color: INK,
                  outline: "none",
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
                placeholder="e.g. Heinrich Industries"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onFocus={(e) => { e.currentTarget.style.borderColor = GREEN; e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "#C6CDDA"; e.currentTarget.style.boxShadow = "none"; }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveAdd(); }}
              />
            </div>

            {/* Short code */}
            <div className="w-full sm:w-[120px]">
              <label
                style={{
                  display: "block",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: TEXT_MUTED,
                  marginBottom: 6,
                }}
              >
                Short code <span style={{ color: "#C53A3A", marginLeft: 3 }}>*</span>
              </label>
              <input
                className="h-10 sm:h-[34px]"
                style={{
                  width: "100%",
                  padding: "0 11px",
                  borderRadius: 6,
                  border: "1px solid #C6CDDA",
                  background: "#FFFFFF",
                  fontSize: 13,
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  color: INK,
                  outline: "none",
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
                placeholder="HEIN"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.toUpperCase())}
                maxLength={10}
                onFocus={(e) => { e.currentTarget.style.borderColor = GREEN; e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = "#C6CDDA"; e.currentTarget.style.boxShadow = "none"; }}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveAdd(); }}
              />
            </div>

            <button
              onClick={handleSaveAdd}
              disabled={createMut.isPending}
              className="h-10 w-full sm:h-[34px] sm:w-auto"
              style={{
                padding: "0 16px",
                borderRadius: 7,
                fontSize: 12.5,
                fontWeight: 600,
                background: "var(--brand-green, #28C55E)",
                color: "#FFFFFF",
                border: "none",
                cursor: createMut.isPending ? "not-allowed" : "pointer",
                opacity: createMut.isPending ? 0.6 : 1,
                transition: "background 150ms",
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
              }}
              onMouseEnter={(e) => { if (!createMut.isPending) (e.currentTarget as HTMLButtonElement).style.background = GREEN_HOVER; }}
              onMouseLeave={(e) => { if (!createMut.isPending) (e.currentTarget as HTMLButtonElement).style.background = GREEN; }}
            >
              {/* check icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {createMut.isPending ? "Creating…" : "Create buyer"}
            </button>
          </div>

          {/* Intro note */}
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              background: GREEN_SOFT,
              color: "#1E6D29",
              borderRadius: 6,
              padding: "10px 12px",
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
              <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
            </svg>
            After creating, upload a sample PO and ProcuLink learns the buyer&apos;s layout automatically.
          </div>

          {addError && (
            <p style={{ marginTop: 8, fontSize: 12, color: "#C53A3A" }}>{addError}</p>
          )}
        </div>
      )}

      {/* Table card */}
      <div
        style={{
          background: "#FFFFFF",
          border: `1px solid ${BORDER}`,
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
        }}
      >
        {/* ── Desktop / tablet: data table (sm and up) ─────────────────── */}
        <table className="hidden sm:table" style={{ width: "100%", borderCollapse: "collapse" }}>
          <colgroup>
            <col />
            <col style={{ width: 200 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 190 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              {([
                { label: "Buyer",             align: "left"  },
                { label: "Inbound channel",   align: "left"  },
                { label: "Volume",            align: "left"  },
                { label: "Suppliers reached", align: "left"  },
                { label: "This week",         align: "right" },
                { label: "",                  align: "right" },
              ] as const).map((col, i) => (
                <th
                  key={i}
                  style={{
                    textAlign: col.align,
                    fontSize: 10.5,
                    fontWeight: 600,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    color: TEXT_FAINT,
                    padding: "11px 18px",
                    borderBottom: `1px solid ${BORDER}`,
                    whiteSpace: "nowrap",
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Skeleton rows while loading */}
            {showSkeleton && (
              <>
                <SkeletonTrow />
                <SkeletonTrow />
                <SkeletonTrow />
              </>
            )}

            {/* Error state in table */}
            {showError && (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: "32px 16px", textAlign: "center" }}
                >
                  <span style={{ fontSize: 13, color: TEXT_MUTED }}>
                    Failed to load buyers.{" "}
                    <button
                      onClick={() => refetch()}
                      style={{
                        color: GREEN_HOVER,
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        fontWeight: 600,
                        fontSize: 13,
                        padding: 0,
                      }}
                    >
                      Retry
                    </button>
                  </span>
                </td>
              </tr>
            )}

            {/* Buyer rows */}
            {showRows && buyers.map((b, idx) => {
              const isHover = hoverRow === b.id;
              const lastRow = idx === buyers.length - 1;
              const cellBorder = lastRow ? "none" : `1px solid ${BORDER}`;
              return (
                <tr
                  key={b.id}
                  onClick={() => router.push(`/inbox?buyer=${b.code}`)}
                  title="Filter inbox to orders from this buyer"
                  style={{
                    cursor: "pointer",
                    transition: "background 150ms",
                    background: isHover ? ROW_ACTIVE : "transparent",
                  }}
                  onMouseEnter={() => setHoverRow(b.id)}
                  onMouseLeave={() => setHoverRow(null)}
                >
                  {/* Buyer: icon tile + name + code */}
                  <td
                    style={{
                      padding: "14px 18px",
                      borderBottom: cellBorder,
                      fontSize: 12.5,
                      verticalAlign: "middle",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
                      <BuyerIcon />
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: INK, letterSpacing: "-0.005em" }}>{b.name}</div>
                        <div
                          style={{
                            fontSize: 10.5,
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            color: CODE_GREY,
                            marginTop: 1,
                            letterSpacing: "0.02em",
                          }}
                        >
                          {b.code}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Inbound channel — single plain label */}
                  <td
                    style={{
                      padding: "14px 18px",
                      borderBottom: cellBorder,
                      verticalAlign: "middle",
                    }}
                  >
                    <ChannelPill label={inboundChannel(b.formats)} />
                  </td>

                  {/* Volume — weekly rate, monospace */}
                  <td
                    style={{
                      padding: "14px 18px",
                      borderBottom: cellBorder,
                      verticalAlign: "middle",
                    }}
                  >
                    <VolumeText value={b.orderCount} />
                  </td>

                  {/* Suppliers reached — green dots + count */}
                  <td
                    style={{
                      padding: "14px 18px",
                      borderBottom: cellBorder,
                      verticalAlign: "middle",
                    }}
                  >
                    <SuppliersDots count={suppliersReached(b)} />
                  </td>

                  {/* This week — headline number, right-aligned */}
                  <td
                    style={{
                      padding: "14px 18px",
                      borderBottom: cellBorder,
                      textAlign: "right",
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      fontWeight: 600,
                      fontSize: 15,
                      color: INK,
                      verticalAlign: "middle",
                      letterSpacing: "-0.01em",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.orderCount.toLocaleString()}
                  </td>

                  {/* Chevron (delete revealed on row hover) */}
                  <td
                    style={{
                      padding: "14px 14px 14px 4px",
                      borderBottom: cellBorder,
                      textAlign: "right",
                      verticalAlign: "middle",
                      whiteSpace: "nowrap",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      {/* Delete button — only visible on row hover to keep the resting row clean */}
                      <button
                        onClick={(e) => handleDelete(e, b)}
                        disabled={deleteMut.isPending}
                        title="Delete buyer"
                        aria-label={`Delete ${b.name}`}
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: 5,
                          border: `1px solid ${BORDER}`,
                          background: "#FFFFFF",
                          color: TEXT_FAINT,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: deleteMut.isPending ? "not-allowed" : "pointer",
                          flexShrink: 0,
                          opacity: isHover ? 1 : 0,
                          pointerEvents: isHover ? "auto" : "none",
                          transition: "opacity 120ms, color 120ms, border-color 120ms",
                        }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#C53A3A"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#E7B3B3"; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = TEXT_FAINT; (e.currentTarget as HTMLButtonElement).style.borderColor = BORDER; }}
                      >
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                      {/* Chevron */}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={CHEVRON} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── Mobile: stacked row-cards (below sm) ──────────────────────── */}
        <div className="sm:hidden">
          {showSkeleton && (
            <>
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </>
          )}

          {showError && (
            <div style={{ padding: "28px 16px", textAlign: "center" }}>
              <span style={{ fontSize: 13, color: TEXT_MUTED }}>
                Failed to load buyers.{" "}
                <button
                  onClick={() => refetch()}
                  style={{ color: GREEN_HOVER, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, padding: 0 }}
                >
                  Retry
                </button>
              </span>
            </div>
          )}

          {showRows && buyers.map((b, idx) => {
            const lastRow = idx === buyers.length - 1;
            return (
              <div
                key={b.id}
                role="button"
                tabIndex={0}
                onClick={() => router.push(`/inbox?buyer=${b.code}`)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); router.push(`/inbox?buyer=${b.code}`); } }}
                title="Filter inbox to orders from this buyer"
                className="active:bg-[#E3EDFB]"
                style={{
                  display: "block",
                  padding: "15px 16px",
                  borderBottom: lastRow ? "none" : `1px solid ${BORDER}`,
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                {/* Top: identity + delete */}
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <BuyerIcon />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: INK, letterSpacing: "-0.005em", lineHeight: 1.25 }}>
                      {b.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        color: CODE_GREY,
                        marginTop: 2,
                        letterSpacing: "0.02em",
                      }}
                    >
                      {b.code}
                    </div>
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, b)}
                    disabled={deleteMut.isPending}
                    title="Delete buyer"
                    aria-label={`Delete ${b.name}`}
                    style={{
                      width: 40,
                      height: 40,
                      marginRight: -8,
                      borderRadius: 8,
                      border: "none",
                      background: "transparent",
                      color: TEXT_FAINT,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      cursor: deleteMut.isPending ? "not-allowed" : "pointer",
                      flexShrink: 0,
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 12 12" fill="none">
                      <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {/* Stats row: 2x2 grid of labelled fields */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px 16px",
                    marginTop: 14,
                    paddingLeft: 44, // align under the name, past the icon tile
                  }}
                >
                  <MobileField label="Inbound channel">
                    <ChannelPill label={inboundChannel(b.formats)} />
                  </MobileField>
                  <MobileField label="Volume">
                    <VolumeText value={b.orderCount} />
                  </MobileField>
                  <MobileField label="Suppliers reached">
                    <SuppliersDots count={suppliersReached(b)} />
                  </MobileField>
                  <MobileField label="This week">
                    <span
                      style={{
                        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                        fontWeight: 600,
                        fontSize: 16,
                        color: INK,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {b.orderCount.toLocaleString()}
                    </span>
                  </MobileField>
                </div>
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {showRows && buyers.length === 0 && (
          <EmptyState
            title="No buyers yet"
            sub="A buyer is an organization that sends you purchase orders, in whatever format they use."
            action={{ label: "New buyer", onClick: () => setAddOpen(true) }}
          />
        )}
      </div>
    </div>
  );
}

// Small labelled field used in the mobile stacked card 2x2 grid.
function MobileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#8A93A5",
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
