"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/bridge/EmptyState";
import { FileChip } from "@/components/bridge/FileChip";
import { getBuyers, createBuyer, deleteBuyer, isApiMockMode } from "@/lib/api-client";
import type { BuyerDto } from "@/types/procurement";

const MOCK_BUYERS: BuyerDto[] = [
  { id: "b1", name: "Heinrich Industries GmbH", code: "HEI", orderCount: 1820, lastOrderAge: "2m",  formats: ["PDF", "XLSX"] },
  { id: "b2", name: "Nordmark Logistics A/S",   code: "NRD", orderCount: 1104, lastOrderAge: "14m", formats: ["cXML", "EDI"] },
  { id: "b3", name: "Steelhouse Construction",  code: "SHC", orderCount: 812,  lastOrderAge: "1h",  formats: ["XLSX", "CSV"] },
];

function SkeletonTrow() {
  return (
    <tr>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <td key={i} style={{ padding: "11px 12px", borderBottom: "1px solid #E2E6EE" }}>
          <div
            className="animate-pulse rounded"
            style={{ background: "#EFF2F7", height: 14, width: i === 1 ? 180 : i === 2 ? 90 : 60 }}
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
    : `${buyers.length} buyer${buyers.length !== 1 ? "s" : ""} · the left side of every bridge`;

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
            Buyer docks
          </h1>
          <div style={{ color: "#56627A", fontSize: 13, marginTop: 5 }}>
            {countLabel}
          </div>
        </div>

        {/* New dock button — canonical: blue */}
        <button
          onClick={() => { setAddOpen((v) => !v); setAddError(null); }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 7,
            height: 32,
            padding: "0 14px",
            borderRadius: 6,
            fontSize: 12.5,
            fontWeight: 600,
            letterSpacing: "-0.005em",
            background: addOpen ? "#0F4FA8" : "#1E66C9",
            color: "#FFFFFF",
            border: "none",
            cursor: "pointer",
            transition: "background 150ms",
            whiteSpace: "nowrap",
          }}
        >
          {/* plus icon */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5v14" />
          </svg>
          {addOpen ? "Cancel" : "New dock"}
        </button>
      </div>

      {/* Create dock panel */}
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
              New buyer dock
            </div>
            <div style={{ color: "#56627A", fontSize: 12.5 }}>
              The left side of a new bridge
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
                  height: 32,
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
                  height: 32,
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
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveAdd(); }}
              />
            </div>

            <button
              onClick={handleSaveAdd}
              disabled={createMut.isPending}
              style={{
                height: 32,
                padding: "0 14px",
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 600,
                background: "#2E8E3A",
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
            >
              {/* check icon */}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
              {createMut.isPending ? "Creating…" : "Create dock"}
            </button>
          </div>

          {/* Intro note */}
          <div
            style={{
              marginTop: 14,
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              background: "#E3EDFB",
              color: "#0F4FA8",
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
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {(["Buyer", "Formats", "Volume", "Last order", ""] as const).map((col, i) => (
                <th
                  key={col}
                  style={{
                    textAlign: i >= 4 ? "right" : "left",
                    fontSize: 10.5,
                    fontWeight: 600,
                    letterSpacing: "0.05em",
                    textTransform: "uppercase",
                    color: "#8A93A5",
                    padding: "9px 12px",
                    borderBottom: "1px solid #E2E6EE",
                    whiteSpace: "nowrap",
                    width: i === 5 ? 30 : undefined,
                  }}
                >
                  {col}
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
                        color: "#1E66C9",
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
            {(!isLoading || isApiMockMode) && !isError && buyers.map((b, idx) => (
              <tr
                key={b.id}
                onClick={() => router.push(`/inbox?buyer=${b.code}`)}
                title="Filter inbox to orders from this buyer"
                style={{
                  cursor: "pointer",
                  transition: "background 150ms",
                  background: "transparent",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "#E3EDFB"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "transparent"; }}
              >
                {/* Buyer: code badge + name */}
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: idx < buyers.length - 1 ? "1px solid #E2E6EE" : "none",
                    fontSize: 12.5,
                    verticalAlign: "middle",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 6,
                        background: "#E3EDFB",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {/* building icon */}
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0F4FA8" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="2" width="16" height="20" rx="1" />
                        <path d="M9 22v-4h6v4M8 6h.01M16 6h.01M8 10h.01M16 10h.01M8 14h.01M16 14h.01" />
                      </svg>
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{b.name}</div>
                      <div
                        style={{
                          fontSize: 10.5,
                          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                          color: "#8A93A5",
                        }}
                      >
                        {b.code}
                      </div>
                    </div>
                  </div>
                </td>

                {/* Inbound formats (canonical: "Inbound channel") */}
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: idx < buyers.length - 1 ? "1px solid #E2E6EE" : "none",
                    verticalAlign: "middle",
                  }}
                >
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                    {b.formats.map((f) => (
                      <FileChip key={f} type={f} />
                    ))}
                  </div>
                </td>

                {/* Volume */}
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: idx < buyers.length - 1 ? "1px solid #E2E6EE" : "none",
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    fontWeight: 600,
                    fontSize: 12.5,
                    verticalAlign: "middle",
                  }}
                >
                  {b.orderCount.toLocaleString()}
                </td>

                {/* Last order age — mapped from lastOrderAge; no dedicated column in BuyerDto for supplier count */}
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: idx < buyers.length - 1 ? "1px solid #E2E6EE" : "none",
                    fontSize: 12.5,
                    color: "#56627A",
                    verticalAlign: "middle",
                  }}
                >
                  {b.lastOrderAge ? `${b.lastOrderAge} ago` : "—"}
                </td>

                {/* Chevron + delete */}
                <td
                  style={{
                    padding: "11px 12px",
                    borderBottom: idx < buyers.length - 1 ? "1px solid #E2E6EE" : "none",
                    width: 52,
                    verticalAlign: "middle",
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {/* Delete button */}
                    <button
                      onClick={(e) => handleDelete(e, b)}
                      disabled={deleteMut.isPending}
                      title="Delete buyer"
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 4,
                        border: "1px solid #E2E6EE",
                        background: "#FAFBFC",
                        color: "#8A93A5",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: deleteMut.isPending ? "not-allowed" : "pointer",
                        flexShrink: 0,
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      </svg>
                    </button>
                    {/* Chevron */}
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#8A93A5" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Empty state */}
        {(!isLoading || isApiMockMode) && !isError && buyers.length === 0 && (
          <EmptyState
            title="No buyer docks yet"
            sub="A buyer dock receives purchase orders from one buyer, in whatever format they send."
            action={{ label: "New dock", onClick: () => setAddOpen(true) }}
          />
        )}
      </div>
    </div>
  );
}
