"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { EmptyState } from "@/components/bridge/EmptyState";
import { getBuyers, createBuyer, deleteBuyer, isApiMockMode } from "@/lib/api-client";
import type { BuyerDto } from "@/types/procurement";

const MOCK_BUYERS: BuyerDto[] = [
  { id: "b1", name: "Heinrich Industries GmbH", code: "HEI", orderCount: 1820, lastOrderAge: "2m",  formats: ["PDF", "XLSX"] },
  { id: "b2", name: "Nordmark Logistics A/S",   code: "NRD", orderCount: 1104, lastOrderAge: "14m", formats: ["cXML", "EDI"] },
  { id: "b3", name: "Steelhouse Construction",  code: "SHC", orderCount: 812,  lastOrderAge: "1h",  formats: ["XLSX", "CSV"] },
];

function SkeletonCard() {
  return (
    <div
      className="rounded-[8px] animate-pulse"
      style={{
        background: "#FFFFFF",
        border: "1px solid #E2E6EE",
        borderLeft: "3px solid #C6CDDA",
        height: 72,
      }}
    />
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

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Header */}
      <div
        className="flex flex-col items-start gap-3 px-4 py-4 sm:px-6 sm:flex-row sm:items-end sm:gap-4 flex-shrink-0"
        style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}
      >
        <div>
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
          >
            Buyers
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {isLoading ? "Loading…" : `${buyers.length} active buyer${buyers.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => { setAddOpen(v => !v); setAddError(null); }}
          className="flex w-full items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium sm:ml-auto sm:w-auto"
          style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
        >
          {addOpen ? "Cancel" : "+ Add buyer"}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-5">
        {/* Add buyer panel */}
        {addOpen && (
          <div
            className="mb-4 rounded-[8px] p-4"
            style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", boxShadow: "0 1px 3px rgba(11,26,47,0.06)" }}
          >
            <p className="text-[13px] font-semibold mb-3" style={{ color: "#0B1A2F" }}>New buyer</p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label className="block text-[11px] font-medium mb-1" style={{ color: "#56627A" }}>Name</label>
                <input
                  className="w-full rounded-[6px] px-3 text-[13px] outline-none"
                  style={{ height: 34, border: "1px solid #C6CDDA", color: "#0B1A2F", background: "#FAFBFC" }}
                  placeholder="e.g. Heinrich Industries GmbH"
                  value={addName}
                  onChange={e => setAddName(e.target.value)}
                />
              </div>
              <div style={{ width: 120 }}>
                <label className="block text-[11px] font-medium mb-1" style={{ color: "#56627A" }}>Code</label>
                <input
                  className="w-full rounded-[6px] px-3 text-[13px] outline-none"
                  style={{ height: 34, border: "1px solid #C6CDDA", color: "#0B1A2F", background: "#FAFBFC", fontFamily: "'JetBrains Mono', monospace" }}
                  placeholder="HEI"
                  value={addCode}
                  onChange={e => setAddCode(e.target.value.toUpperCase())}
                  maxLength={10}
                />
              </div>
              <button
                onClick={handleSaveAdd}
                disabled={createMut.isPending}
                className="rounded-[6px] px-4 text-[12.5px] font-medium"
                style={{ height: 34, background: "#1E66C9", color: "#FFFFFF", border: 0, opacity: createMut.isPending ? 0.6 : 1, cursor: createMut.isPending ? "not-allowed" : "pointer" }}
              >
                {createMut.isPending ? "Saving…" : "Save"}
              </button>
            </div>
            {addError && (
              <p className="mt-2 text-[12px]" style={{ color: "#C0392B" }}>{addError}</p>
            )}
          </div>
        )}

        {/* Loading skeletons */}
        {isLoading && !isApiMockMode && (
          <div className="flex flex-col gap-3">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        )}

        {/* Error state */}
        {isError && !isApiMockMode && (
          <div
            className="flex flex-col items-center justify-center gap-3 rounded-[8px] p-8"
            style={{ background: "#FFFFFF", border: "1px solid #E2E6EE" }}
          >
            <p className="text-[14px] font-medium" style={{ color: "#0B1A2F" }}>Failed to load buyers</p>
            <button
              onClick={() => refetch()}
              className="rounded-[6px] px-4 text-[12.5px] font-medium"
              style={{ height: 32, background: "#0B1A2F", color: "#FFFFFF", border: 0 }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && buyers.length === 0 && (
          <EmptyState
            icon="◎"
            title="No buyers yet"
            sub="Add your first buyer to start receiving and routing purchase orders."
            action={{ label: "+ Add buyer", onClick: () => setAddOpen(true) }}
          />
        )}

        {/* Buyer cards */}
        {!isLoading && !isError && buyers.length > 0 && (
          <div className="flex flex-col gap-3">
            {buyers.map((b) => (
              <div
                key={b.id}
                onClick={() => router.push(`/inbox?buyer=${b.code}`)}
                className="group cursor-pointer rounded-[8px]"
                style={{
                  background: "#FFFFFF",
                  border: "1px solid #E2E6EE",
                  boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
                  borderLeft: "3px solid #1E66C9",
                }}
              >
                <div className="grid gap-3 px-4 py-4 sm:grid-cols-[44px_minmax(0,1fr)_80px_80px_auto_auto] sm:items-center sm:gap-4">
                  {/* Code badge */}
                  <div
                    style={{
                      width: 44, height: 44, borderRadius: 10,
                      background: "#E3EDFB",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11, fontWeight: 800, color: "#1E66C9",
                      flexShrink: 0,
                    }}
                  >
                    {b.code}
                  </div>

                  {/* Name + format chips */}
                  <div className="min-w-0">
                    <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>{b.name}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {b.formats.map((f) => (
                        <span
                          key={f}
                          className="text-[10.5px] font-semibold rounded px-1.5 py-0.5"
                          style={{ background: "#EFF2F7", color: "#56627A" }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Order count */}
                  <div className="text-left sm:text-right">
                    <p style={{ fontFamily: "'Bricolage Grotesque', sans-serif", fontSize: 20, fontWeight: 700, color: "#0B1A2F", lineHeight: 1 }}>
                      {b.orderCount.toLocaleString()}
                    </p>
                    <p style={{ fontSize: 11, color: "#8A93A5", marginTop: 2 }}>total orders</p>
                  </div>

                  {/* Last order age */}
                  <div className="text-left sm:text-right" style={{ minWidth: 70 }}>
                    <p style={{ fontSize: 11, color: "#8A93A5" }}>last order</p>
                    <p style={{ fontSize: 12, fontWeight: 500, color: "#56627A" }}>
                      {b.lastOrderAge ? `${b.lastOrderAge} ago` : "—"}
                    </p>
                  </div>

                  {/* Arrow hint */}
                  <span
                    className="hidden opacity-0 group-hover:opacity-100 transition-opacity text-[14px] sm:inline"
                    style={{ color: "#C6CDDA" }}
                  >
                    →
                  </span>

                  {/* Delete button */}
                  <button
                    onClick={(e) => handleDelete(e, b)}
                    disabled={deleteMut.isPending}
                    className="flex items-center justify-center rounded-[4px] transition-colors"
                    style={{
                      width: 28, height: 28,
                      border: "1px solid #E2E6EE",
                      background: "#FAFBFC",
                      color: "#8A93A5",
                      cursor: deleteMut.isPending ? "not-allowed" : "pointer",
                      flexShrink: 0,
                    }}
                    title="Delete buyer"
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
