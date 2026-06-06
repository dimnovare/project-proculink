"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/bridge/EmptyState";
import { getBuyers, createBuyer, deleteBuyer, isApiMockMode } from "@/lib/api-client";
import type { BuyerDto } from "@/types/procurement";

// ── Palette — ported verbatim from the design system (tokens.css / globals.css) ─
// The buyer entity is the PRIMARY / ACTIVE colour across ProcuLink: buyer-blue
// #1E66C9. The design source's create button is variant="blue", so every
// primary affordance on this screen (header CTA, create button, focus ring,
// active row band, icon tile) is blue — NOT the old green.
const BLUE        = "#1E66C9"; // --brand-blue   · primary / buyer / active
const BLUE_HOVER  = "#0F4FA8"; // --brand-blue-deep
const BLUE_SOFT   = "#E3EDFB"; // --brand-blue-soft · tile fill / active row band / focus ring
// Neutrals (all from the design token set).
const INK         = "#0B1A2F"; // --ink
const TEXT_MUTED  = "#56627A"; // --ink-muted · pill text / subtitle
const TEXT_FAINT  = "#8A93A5"; // --ink-faint · header labels / counts / em-dash
const CODE_GREY   = "#9196A5"; // buyer short-code
const BORDER      = "#E2E6EE"; // --border · card border + row dividers
const BORDER_STRONG = "#C6CDDA"; // --border-strong · input border
const SURFACE_2   = "#EFF2F7"; // --surface-2 · inbound-channel pill fill
const CHEVRON     = "#A4ADBD"; // resting chevron
const DANGER      = "#C53A3A"; // --danger · required asterisk / delete hover

const MOCK_BUYERS: BuyerDto[] = [
  { id: "b1", name: "Heinrich Industries GmbH", code: "HEI", orderCount: 1820, lastOrderAge: "2m",  formats: ["PDF", "XLSX"] },
  { id: "b2", name: "Nordmark Logistics A/S",   code: "NRD", orderCount: 1104, lastOrderAge: "14m", formats: ["cXML", "EDI"] },
  { id: "b3", name: "Steelhouse Construction",  code: "SHC", orderCount: 812,  lastOrderAge: "1h",  formats: ["XLSX", "CSV"] },
];

// ── Shared cell content (reused by desktop table + mobile cards) ──────────

function BuyerIcon() {
  // building / org glyph in a soft-blue tile — the buyer entity colour
  return (
    <div
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        background: BLUE_SOFT,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={BLUE_HOVER} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="1" />
        <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
      </svg>
    </div>
  );
}

function ChannelPill({ label }: { label: string }) {
  // .chip from the design system: surface-2 fill, ink-muted text.
  return (
    <span
      className="chip"
      style={{
        // Render the format label verbatim from the backend (CSV/XLSX/PDF/cXML/EDI/XML).
        color: TEXT_MUTED,
        background: SURFACE_2,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

function SkeletonTrow() {
  const widths = [180, 90, 64, 56, 16];
  return (
    <tr>
      {widths.map((w, i) => {
        // Columns: 0 Buyer (left), 1 Primary format (left), 2 Orders (right),
        // 3 Last order (right), 4 chevron (right).
        const right = i >= 2;
        return (
          <td key={i} style={{ padding: "14px 18px", borderBottom: `1px solid ${BORDER}`, textAlign: right ? "right" : "left" }}>
            <div
              className="animate-pulse rounded"
              style={{ background: SURFACE_2, height: 14, width: w, marginLeft: right ? "auto" : 0 }}
            />
          </td>
        );
      })}
    </tr>
  );
}

function SkeletonCard() {
  return (
    <div style={{ padding: "16px 16px", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div className="animate-pulse" style={{ width: 32, height: 32, borderRadius: 8, background: SURFACE_2, flexShrink: 0 }} />
        <div style={{ flex: 1 }}>
          <div className="animate-pulse rounded" style={{ background: SURFACE_2, height: 13, width: "60%" }} />
          <div className="animate-pulse rounded" style={{ background: SURFACE_2, height: 10, width: 48, marginTop: 7 }} />
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
              fontFamily: "var(--font-display, 'Bricolage Grotesque', Inter, sans-serif)",
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

        {/* New buyer button — primary accent is buyer-blue (design variant="blue") */}
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
            background: addOpen ? BLUE_HOVER : BLUE,
            color: "#FFFFFF",
            border: "none",
            cursor: "pointer",
            boxShadow: addOpen ? "none" : "0 1px 2px rgba(30,102,201,0.30)",
            transition: "background 150ms",
            whiteSpace: "nowrap",
          }}
          onMouseEnter={(e) => { if (!addOpen) (e.currentTarget as HTMLButtonElement).style.background = BLUE_HOVER; }}
          onMouseLeave={(e) => { if (!addOpen) (e.currentTarget as HTMLButtonElement).style.background = BLUE; }}
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
                Buyer name <span style={{ color: DANGER, marginLeft: 3 }}>*</span>
              </label>
              <input
                className="h-10 sm:h-[34px]"
                style={{
                  width: "100%",
                  padding: "0 11px",
                  borderRadius: 6,
                  border: `1px solid ${BORDER_STRONG}`,
                  background: "#FFFFFF",
                  fontSize: 13,
                  color: INK,
                  outline: "none",
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
                placeholder="e.g. Heinrich Industries"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                onFocus={(e) => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.boxShadow = `0 0 0 3px ${BLUE_SOFT}`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_STRONG; e.currentTarget.style.boxShadow = "none"; }}
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
                Short code <span style={{ color: DANGER, marginLeft: 3 }}>*</span>
              </label>
              <input
                className="h-10 sm:h-[34px]"
                style={{
                  width: "100%",
                  padding: "0 11px",
                  borderRadius: 6,
                  border: `1px solid ${BORDER_STRONG}`,
                  background: "#FFFFFF",
                  fontSize: 13,
                  fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                  color: INK,
                  outline: "none",
                  transition: "border-color 150ms, box-shadow 150ms",
                }}
                placeholder="HEIN"
                value={addCode}
                onChange={(e) => setAddCode(e.target.value.toUpperCase())}
                maxLength={10}
                onFocus={(e) => { e.currentTarget.style.borderColor = BLUE; e.currentTarget.style.boxShadow = `0 0 0 3px ${BLUE_SOFT}`; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = BORDER_STRONG; e.currentTarget.style.boxShadow = "none"; }}
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
                background: BLUE,
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
              onMouseEnter={(e) => { if (!createMut.isPending) (e.currentTarget as HTMLButtonElement).style.background = BLUE_HOVER; }}
              onMouseLeave={(e) => { if (!createMut.isPending) (e.currentTarget as HTMLButtonElement).style.background = BLUE; }}
            >
              {/* check icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {createMut.isPending ? "Creating…" : "Create buyer"}
            </button>
          </div>

          {/* Intro note — buyer-blue info callout, matching the design's note style */}
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              background: BLUE_SOFT,
              color: BLUE_HOVER,
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
            <p style={{ marginTop: 8, fontSize: 12, color: DANGER }}>{addError}</p>
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
            <col style={{ width: 170 }} />
            <col style={{ width: 150 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 44 }} />
          </colgroup>
          <thead>
            <tr>
              {([
                { label: "Buyer",            align: "left"  },
                { label: "Primary format",   align: "left"  },
                { label: "Orders (all time)", align: "right" },
                { label: "Last order",       align: "right" },
                { label: "",                 align: "right" },
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
                  colSpan={5}
                  style={{ padding: "32px 16px", textAlign: "center" }}
                >
                  <span style={{ fontSize: 13, color: TEXT_MUTED }}>
                    Failed to load buyers.{" "}
                    <button
                      onClick={() => refetch()}
                      style={{
                        color: BLUE,
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
                    background: isHover ? BLUE_SOFT : "transparent",
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
                            fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
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

                  {/* Primary format — first parsed format, or em-dash if unknown */}
                  <td
                    style={{
                      padding: "14px 18px",
                      borderBottom: cellBorder,
                      verticalAlign: "middle",
                    }}
                  >
                    {b.formats.length > 0
                      ? <ChannelPill label={b.formats[0]} />
                      : <span style={{ fontSize: 12.5, color: TEXT_FAINT }}>—</span>}
                  </td>

                  {/* Orders (all time) — real backend count, right-aligned */}
                  <td
                    style={{
                      padding: "14px 18px",
                      borderBottom: cellBorder,
                      textAlign: "right",
                      fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
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

                  {/* Last order — relative age from backend, or em-dash */}
                  <td
                    style={{
                      padding: "14px 18px",
                      borderBottom: cellBorder,
                      textAlign: "right",
                      fontSize: 12.5,
                      color: b.lastOrderAge ? TEXT_MUTED : TEXT_FAINT,
                      verticalAlign: "middle",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.lastOrderAge ?? "—"}
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
                        onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.color = DANGER; (e.currentTarget as HTMLButtonElement).style.borderColor = "#E7B3B3"; }}
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
                  style={{ color: BLUE, background: "none", border: "none", cursor: "pointer", fontWeight: 600, fontSize: 13, padding: 0 }}
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
                        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
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

                {/* Stats row: labelled fields in a 2-column grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "12px 16px",
                    marginTop: 14,
                    paddingLeft: 44, // align under the name, past the icon tile
                  }}
                >
                  <MobileField label="Primary format">
                    {b.formats.length > 0
                      ? <ChannelPill label={b.formats[0]} />
                      : <span style={{ fontSize: 13, color: TEXT_FAINT }}>—</span>}
                  </MobileField>
                  <MobileField label="Orders (all time)">
                    <span
                      style={{
                        fontFamily: "var(--font-mono, 'JetBrains Mono', ui-monospace, monospace)",
                        fontWeight: 600,
                        fontSize: 16,
                        color: INK,
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {b.orderCount.toLocaleString()}
                    </span>
                  </MobileField>
                  <MobileField label="Last order">
                    <span style={{ fontSize: 13, color: b.lastOrderAge ? TEXT_MUTED : TEXT_FAINT }}>
                      {b.lastOrderAge ?? "—"}
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
          color: TEXT_FAINT,
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      <div>{children}</div>
    </div>
  );
}
