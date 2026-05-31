"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/bridge/EmptyState";
import { getBuyers, createBuyer, deleteBuyer, isApiMockMode } from "@/lib/api-client";
import type { BuyerDto } from "@/types/procurement";

// Green accent (project primary). Prefer CSS var; hexes used only for inline styles.
const GREEN       = "#28C55E";
const GREEN_HOVER = "#1DAF50";
const GREEN_SOFT  = "#DCFCE7";

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

function SuppliersDots({ count }: { count: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        {Array.from({ length: Math.min(count, 4) }).map((_, i) => (
          <span
            key={i}
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: GREEN,
              flexShrink: 0,
            }}
          />
        ))}
      </div>
      <span style={{ fontSize: 12.5, color: "#8A93A5", fontVariantNumeric: "tabular-nums" }}>
        {count}
      </span>
    </div>
  );
}

function SkeletonTrow() {
  const widths = [180, 90, 60, 70, 48, 16];
  return (
    <tr>
      {widths.map((w, i) => (
        <td key={i} style={{ padding: "14px 18px", borderBottom: "1px solid #E2E6EE", textAlign: i >= 4 ? "right" : "left" }}>
          <div
            className="animate-pulse rounded"
            style={{ background: "#EFF2F7", height: 14, width: w, marginLeft: i >= 4 ? "auto" : 0 }}
          />
        </td>
      ))}
    </tr>
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

  return (
    <div style={{ padding: "26px 34px 64px", maxWidth: 1480, margin: "0 auto" }}>
      {/* Page header */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "16px 24px",
          marginBottom: 22,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: "'Bricolage Grotesque', Inter, sans-serif",
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: "-0.025em",
              lineHeight: 1.1,
              margin: 0,
              color: "#0B1A2F",
              whiteSpace: "nowrap",
            }}
          >
            Buyers
          </h1>
          <div style={{ color: "#56627A", fontSize: 13, marginTop: 5 }}>
            {countLabel}
          </div>
        </div>

        {/* New buyer button — project accent is green */}
        <button
          onClick={() => { setAddOpen((v) => !v); setAddError(null); }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            height: 34,
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
            border: "1px solid #E2E6EE",
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
                color: "#0B1A2F",
              }}
            >
              New buyer
            </div>
            <div style={{ color: "#56627A", fontSize: 12.5 }}>
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
                  color: "#56627A",
                  marginBottom: 6,
                }}
              >
                Buyer name <span style={{ color: "#C53A3A", marginLeft: 3 }}>*</span>
              </label>
              <input
                style={{
                  height: 34,
                  width: "100%",
                  padding: "0 11px",
                  borderRadius: 6,
                  border: "1px solid #C6CDDA",
                  background: "#FFFFFF",
                  fontSize: 12.5,
                  color: "#0B1A2F",
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
            <div style={{ width: 120 }}>
              <label
                style={{
                  display: "block",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#56627A",
                  marginBottom: 6,
                }}
              >
                Short code <span style={{ color: "#C53A3A", marginLeft: 3 }}>*</span>
              </label>
              <input
                style={{
                  height: 34,
                  width: "100%",
                  padding: "0 11px",
                  borderRadius: 6,
                  border: "1px solid #C6CDDA",
                  background: "#FFFFFF",
                  fontSize: 12.5,
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  color: "#0B1A2F",
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
              style={{
                height: 34,
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
          border: "1px solid #E2E6EE",
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 1px 2px rgba(11,26,47,0.04)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
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
                    color: "#8A93A5",
                    padding: "11px 18px",
                    borderBottom: "1px solid #E2E6EE",
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
            {isLoading && !isApiMockMode && (
              <>
                <SkeletonTrow />
                <SkeletonTrow />
                <SkeletonTrow />
              </>
            )}

            {/* Error state in table */}
            {isError && !isApiMockMode && (
              <tr>
                <td
                  colSpan={6}
                  style={{ padding: "32px 16px", textAlign: "center" }}
                >
                  <span style={{ fontSize: 13, color: "#56627A" }}>
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
            {(!isLoading || isApiMockMode) && !isError && buyers.map((b, idx) => {
              const isHover = hoverRow === b.id;
              const lastRow = idx === buyers.length - 1;
              const cellBorder = lastRow ? "none" : "1px solid #E2E6EE";
              return (
                <tr
                  key={b.id}
                  onClick={() => router.push(`/inbox?buyer=${b.code}`)}
                  title="Filter inbox to orders from this buyer"
                  style={{
                    cursor: "pointer",
                    transition: "background 150ms",
                    background: isHover ? GREEN_SOFT : "transparent",
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
                      <div
                        style={{
                          width: 32,
                          height: 32,
                          borderRadius: 7,
                          background: isHover ? "#FFFFFF" : GREEN_SOFT,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          transition: "background 150ms",
                        }}
                      >
                        {/* building icon */}
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN_HOVER} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="4" y="2" width="16" height="20" rx="1" />
                          <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
                        </svg>
                      </div>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 13.5, color: "#0B1A2F", letterSpacing: "-0.005em" }}>{b.name}</div>
                        <div
                          style={{
                            fontSize: 10.5,
                            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                            color: "#8A93A5",
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
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        fontSize: 11,
                        fontWeight: 500,
                        letterSpacing: "0.01em",
                        // Render the label verbatim — acronyms (EMAIL/API/SFTP)
                        // are already uppercase, "cXML / webhook" keeps its case.
                        color: "#56627A",
                        background: isHover ? "#FFFFFF" : "#EFF2F7",
                        border: "none",
                        borderRadius: 6,
                        padding: "4px 10px",
                        whiteSpace: "nowrap",
                        transition: "background 150ms",
                      }}
                    >
                      {inboundChannel(b.formats)}
                    </span>
                  </td>

                  {/* Volume — weekly rate, monospace */}
                  <td
                    style={{
                      padding: "14px 18px",
                      borderBottom: cellBorder,
                      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                      fontWeight: 500,
                      fontSize: 12.5,
                      color: "#56627A",
                      verticalAlign: "middle",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {b.orderCount.toLocaleString()}<span style={{ color: "#8A93A5" }}>/wk</span>
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
                      color: "#0B1A2F",
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
                          border: "1px solid #E2E6EE",
                          background: "#FFFFFF",
                          color: "#8A93A5",
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
                        onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.color = "#8A93A5"; (e.currentTarget as HTMLButtonElement).style.borderColor = "#E2E6EE"; }}
                      >
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                          <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        </svg>
                      </button>
                      {/* Chevron */}
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={isHover ? GREEN_HOVER : "#A4ADBD"} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ transition: "stroke 120ms" }}>
                        <path d="m9 18 6-6-6-6" />
                      </svg>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Empty state */}
        {(!isLoading || isApiMockMode) && !isError && buyers.length === 0 && (
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
