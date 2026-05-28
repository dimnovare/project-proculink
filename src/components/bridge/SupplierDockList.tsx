"use client";

// Supplier Docks — /library/suppliers
// List of all supplier dock configurations. Fetches live data from GET /api/suppliers.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBillingStatus, apiClient } from "@/lib/api-client";

function codeFromName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((w) => w[0].toUpperCase())
    .join("")
    .padEnd(2, "X")
    .slice(0, 4);
}

export function SupplierDockList() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // ── Billing check ──────────────────────────────────────────────────────────
  const { data: billing, isError: billingError } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    retry: false,
  });

  // When billing API is unavailable, optimistically allow adding (backend enforces the limit).
  const canAddSupplier = billingError ? true : (billing?.canAddSupplier ?? true);

  // ── Live supplier list ─────────────────────────────────────────────────────
  const {
    data: suppliers = [],
    isLoading,
    isError: suppliersError,
  } = useQuery({
    queryKey: ["suppliers"],
    queryFn: () => apiClient.getSuppliers(),
  });

  // ── Create supplier ────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (name: string) => apiClient.createSupplier({ name }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["suppliers"] });
      setShowAddPanel(false);
      setNewName("");
      setAddError(null);
    },
    onError: (err: Error) => {
      try {
        const parsed = JSON.parse(err.message);
        setAddError(parsed.error ?? err.message);
      } catch {
        setAddError(err.message);
      }
    },
  });

  function handleSave() {
    const trimmed = newName.trim();
    if (!trimmed) { setAddError("Supplier name is required."); return; }
    setAddError(null);
    createMutation.mutate(trimmed);
  }

  const addButtonLabel = !billingError && billing && !billing.canAddSupplier
    ? "Supplier limit reached"
    : "+ Add supplier";

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
            Suppliers
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            {isLoading ? "Loading…" : `${suppliers.length} active supplier${suppliers.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <div className="w-full sm:ml-auto sm:w-auto">
          <button
            disabled={!canAddSupplier || createMutation.isPending}
            onClick={() => { setShowAddPanel(true); setAddError(null); }}
            className="flex w-full items-center justify-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium sm:w-auto"
            style={{
              height: 32,
              background: canAddSupplier ? "#0B1A2F" : "#E2E6EE",
              color: canAddSupplier ? "#FFFFFF" : "#8A93A5",
              border: 0,
              cursor: canAddSupplier ? "pointer" : "not-allowed",
            }}
          >
            {addButtonLabel}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 sm:p-5">
        {/* Billing limit banner */}
        {billing && !billing.canAddSupplier && (
          <div
            className="mb-4 rounded-[8px] px-4 py-3"
            style={{ border: "1px solid #F0D39A", borderLeft: "3px solid #C97A14", background: "#FFF8EA" }}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>
                  Your {billing.plan} plan includes {billing.supplierLimit} supplier{billing.supplierLimit === 1 ? "" : "s"}.
                </p>
                <p className="mt-1 text-[12px] leading-5" style={{ color: "#7A4D0B" }}>
                  Existing supplier flows remain viewable. Upgrade when you are ready to add another supplier route.
                </p>
              </div>
              <button
                onClick={() => router.push("/settings")}
                className="h-8 rounded-[6px] px-3 text-[12px] font-semibold"
                style={{ border: "1px solid #C97A14", background: "#FFFFFF", color: "#9A5F0A" }}
              >
                View billing
              </button>
            </div>
          </div>
        )}

        {/* Billing API unavailable notice */}
        {billingError && (
          <div
            className="mb-4 rounded-[8px] px-4 py-3 text-[12.5px]"
            style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}
          >
            Supplier limits could not be checked because the billing API is unavailable.
          </div>
        )}

        {/* Add supplier panel */}
        {showAddPanel && canAddSupplier && (
          <div
            className="mb-4 overflow-hidden rounded-[8px]"
            style={{ border: "1px solid #D5DAEA", background: "#FFFFFF", boxShadow: "0 1px 3px rgba(11,26,47,0.04)" }}
          >
            <div className="flex items-start justify-between gap-3 px-4 py-3" style={{ borderBottom: "1px solid #E2E6EE", background: "#F6F7FA" }}>
              <div>
                <p className="text-[13px] font-semibold" style={{ color: "#0B1A2F" }}>New supplier</p>
                <p className="mt-1 text-[12px]" style={{ color: "#56627A" }}>Name the supplier. You can configure mappings and delivery after.</p>
              </div>
              <button
                onClick={() => { setShowAddPanel(false); setNewName(""); setAddError(null); }}
                className="rounded px-2 py-1 text-[12px]"
                style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#56627A" }}
              >
                Close
              </button>
            </div>
            <div className="flex flex-col gap-2 p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  aria-label="Supplier name"
                  placeholder="e.g. Acme Components"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                  className="h-9 rounded-[6px] px-3 text-[13px]"
                  style={{ border: "1px solid #D5DAEA", color: "#0B1A2F", outline: "none" }}
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={createMutation.isPending}
                  className="h-9 rounded-[6px] px-4 text-[12.5px] font-semibold"
                  style={{
                    border: "none",
                    background: createMutation.isPending ? "#D5DAEA" : "#0B1A2F",
                    color: createMutation.isPending ? "#8A93A5" : "#FFFFFF",
                    cursor: createMutation.isPending ? "not-allowed" : "pointer",
                  }}
                >
                  {createMutation.isPending ? "Saving…" : "Save"}
                </button>
              </div>
              {addError && (
                <p className="text-[12px]" style={{ color: "#C53A3A" }}>{addError}</p>
              )}
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col gap-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-[70px] rounded-[8px] animate-pulse"
                style={{ background: "#E2E6EE" }}
              />
            ))}
          </div>
        )}

        {/* Fetch error */}
        {suppliersError && !isLoading && (
          <div
            className="rounded-[8px] px-4 py-3 text-[13px]"
            style={{ border: "1px solid #F1C9C9", background: "#FEF2F2", color: "#C53A3A" }}
          >
            Could not load suppliers. Check your connection and try refreshing.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !suppliersError && suppliers.length === 0 && (
          <div
            className="rounded-[8px] px-6 py-10 text-center"
            style={{ border: "1px dashed #D5DAEA", background: "#FFFFFF" }}
          >
            <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>No suppliers yet</p>
            <p className="mt-1 text-[12.5px]" style={{ color: "#56627A" }}>
              Add your first supplier to start routing purchase orders.
            </p>
            {canAddSupplier && (
              <button
                onClick={() => { setShowAddPanel(true); setAddError(null); }}
                className="mt-4 h-9 rounded-[6px] px-4 text-[12.5px] font-semibold"
                style={{ border: "none", background: "#0B1A2F", color: "#FFFFFF" }}
              >
                + Add supplier
              </button>
            )}
          </div>
        )}

        {/* Supplier list */}
        {!isLoading && !suppliersError && suppliers.length > 0 && (
          <div className="flex flex-col gap-3">
            {suppliers.map((s) => {
              const code = codeFromName(s.name);
              const hc = "#2E8E3A";
              const hb = "#E2F1E2";
              return (
                <div
                  key={s.id}
                  onClick={() => router.push(`/library/suppliers/${s.id}`)}
                  className="group cursor-pointer rounded-[8px] overflow-hidden"
                  style={{
                    background: "#FFFFFF",
                    border: "1px solid #E2E6EE",
                    boxShadow: "0 1px 3px rgba(11,26,47,0.04)",
                    borderLeft: `3px solid ${hc}`,
                  }}
                >
                  <div className="grid gap-3 px-4 py-4 sm:grid-cols-[44px_minmax(0,1fr)_auto] sm:items-center sm:gap-4">
                    {/* Code badge */}
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: `${hc}18`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        fontWeight: 800,
                        color: hc,
                        flexShrink: 0,
                      }}
                    >
                      {code}
                    </div>

                    {/* Name */}
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>
                        {s.name}
                      </p>
                      <p className="mt-0.5 text-[11.5px]" style={{ color: "#8A93A5" }}>
                        Supplier dock · {s.id.slice(0, 8)}
                      </p>
                    </div>

                    {/* Arrow */}
                    <span
                      className="opacity-0 group-hover:opacity-100 transition-opacity text-[14px]"
                      style={{ color: "#C6CDDA" }}
                    >
                      →
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
