"use client";

// Supplier Docks — /library/suppliers
// List of all supplier dock configurations. Fetches live data from GET /api/suppliers.

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBillingStatus, apiClient } from "@/lib/api-client";

// Green accent (project primary). Prefer CSS var; hexes used only for inline styles.
const GREEN       = "#28C55E";
const GREEN_HOVER = "#1DAF50";
const GREEN_SOFT  = "#DCFCE7";
// Shared monospace stack for codes / numeric cells (matches the Buyers table).
const MONO        = "'JetBrains Mono', ui-monospace, monospace";

/** Two-letter monogram from the supplier name (badge fallback, unused when icon shows). */
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

/**
 * Short uppercase code shown under the supplier name — mirrors the design's
 * ACME / BOLT / VDBM line. Derived from the name so it stays human-readable
 * instead of surfacing a raw UUID fragment.
 */
function shortCode(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ]/g, "").trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "SUP";
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  return words.slice(0, 4).map((w) => w[0].toUpperCase()).join("");
}

/** Supplier glyph — matches the badge/header icon in the design reference. */
function SupplierGlyph({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h11v9H3z" />
      <path d="M14 10h4l3 3v3h-7" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17.5" cy="18" r="1.6" />
    </svg>
  );
}

export function SupplierDockList() {
  const router = useRouter();
  const qc = useQueryClient();
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);

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

  const limitReached = !billingError && billing && !billing.canAddSupplier;

  return (
    <div className="min-h-full" style={{ background: "#F6F7FA" }}>
      <div className="mx-auto w-full max-w-[1480px] px-4 pb-16 pt-6 sm:px-8">
        {/* Page header */}
        <div className="mb-5 flex flex-col items-start gap-3 sm:mb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div>
            <h1
              className="text-[28px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[30px]"
              style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: "#0B1A2F" }}
            >
              Suppliers
            </h1>
            <p className="mt-[5px] text-[13px]" style={{ color: "#56627A" }}>
              {isLoading
                ? "Loading…"
                : `${suppliers.length} active supplier${suppliers.length === 1 ? "" : "s"}`}
            </p>
          </div>

          {/* New supplier button — project accent is green */}
          <div className="w-full sm:w-auto">
            <button
              disabled={!canAddSupplier || createMutation.isPending}
              onClick={() => { setShowAddPanel(true); setAddError(null); }}
              className="inline-flex h-[34px] w-full items-center justify-center gap-[7px] rounded-[7px] px-4 text-[12.5px] font-semibold tracking-[-0.005em] transition-colors sm:w-auto"
              style={{
                background: limitReached ? "#EFF2F7" : "var(--brand-green, #28C55E)",
                color: limitReached ? "#8A93A5" : "#FFFFFF",
                border: "none",
                cursor: !canAddSupplier ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
                boxShadow: limitReached ? "none" : "0 1px 2px rgba(40,197,94,0.30)",
              }}
              onMouseEnter={(e) => { if (canAddSupplier) (e.currentTarget as HTMLButtonElement).style.background = GREEN_HOVER; }}
              onMouseLeave={(e) => { if (canAddSupplier) (e.currentTarget as HTMLButtonElement).style.background = GREEN; }}
            >
              {!limitReached && (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5v14" />
                </svg>
              )}
              {limitReached ? "Supplier limit reached" : "New supplier"}
            </button>
          </div>
        </div>

        {/* Billing limit banner */}
        {billing && !billing.canAddSupplier && (
          <div
            className="mb-4 rounded-[10px] px-4 py-3"
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
            className="mb-4 rounded-[10px] px-4 py-3 text-[12.5px]"
            style={{ border: "1px solid #F0D39A", background: "#FFF8EA", color: "#7A4D0B" }}
          >
            Supplier limits could not be checked because the billing API is unavailable.
          </div>
        )}

        {/* Add supplier panel */}
        {showAddPanel && canAddSupplier && (
          <div
            className="mb-4 overflow-hidden rounded-[10px]"
            style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
          >
            <div className="flex items-start justify-between gap-3 px-[18px] pt-[18px]">
              <div className="flex items-start gap-3">
                <div
                  className="flex flex-shrink-0 items-center justify-center"
                  style={{ width: 34, height: 34, borderRadius: 7, background: GREEN_SOFT }}
                >
                  <SupplierGlyph color={GREEN_HOVER} size={17} />
                </div>
                <div>
                  <p className="text-[15px] font-semibold tracking-[-0.01em]" style={{ color: "#0B1A2F" }}>New supplier</p>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: "#56627A" }}>Name the supplier. You can configure mappings and delivery after.</p>
                </div>
              </div>
              <button
                onClick={() => { setShowAddPanel(false); setNewName(""); setAddError(null); }}
                aria-label="Close add supplier panel"
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[6px]"
                style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", color: "#8A93A5" }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-2 px-[18px] pb-[18px] pt-3">
              <label className="text-[11.5px] font-semibold" style={{ color: "#56627A" }}>
                Supplier name <span style={{ color: "#C53A3A", marginLeft: 3 }}>*</span>
              </label>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  aria-label="Supplier name"
                  placeholder="e.g. Acme Components"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                  className="h-[34px] rounded-[6px] px-3 text-[12.5px]"
                  style={{ border: "1px solid #C6CDDA", color: "#0B1A2F", outline: "none", transition: "border-color 150ms, box-shadow 150ms" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = GREEN; e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "#C6CDDA"; e.currentTarget.style.boxShadow = "none"; }}
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={createMutation.isPending}
                  className="inline-flex h-[34px] items-center justify-center gap-[6px] rounded-[7px] px-4 text-[12.5px] font-semibold transition-colors"
                  style={{
                    border: "none",
                    background: "var(--brand-green, #28C55E)",
                    color: "#FFFFFF",
                    cursor: createMutation.isPending ? "not-allowed" : "pointer",
                    opacity: createMutation.isPending ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => { if (!createMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = GREEN_HOVER; }}
                  onMouseLeave={(e) => { if (!createMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = GREEN; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {createMutation.isPending ? "Saving…" : "Save supplier"}
                </button>
              </div>
              <div
                className="mt-1 flex items-start gap-2 rounded-[6px] px-3 py-2.5 text-[12px] leading-5"
                style={{ background: GREEN_SOFT, color: "#1E6D29" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                </svg>
                Auto-process stays off until you configure delivery and turn it on for this supplier.
              </div>
              {addError && (
                <p className="text-[12px]" style={{ color: "#C53A3A" }}>{addError}</p>
              )}
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div
            className="overflow-hidden rounded-[10px]"
            style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
          >
            <SupplierTableHeader />
            {[1, 2, 3, 4].map((i, idx) => (
              <div
                key={i}
                className="flex items-center gap-[13px] px-[18px] py-[14px]"
                style={{ borderTop: idx === 0 ? "none" : "1px solid #E2E6EE" }}
              >
                <div className="h-8 w-8 flex-shrink-0 rounded-[7px] animate-pulse" style={{ background: "#EFF2F7" }} />
                <div className="flex flex-col gap-1.5">
                  <div className="h-3.5 w-32 rounded animate-pulse" style={{ background: "#EFF2F7" }} />
                  <div className="h-2.5 w-14 rounded animate-pulse" style={{ background: "#F2F4F9" }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Fetch error */}
        {suppliersError && !isLoading && (
          <div
            className="rounded-[10px] px-4 py-3 text-[13px]"
            style={{ border: "1px solid #F1C9C9", background: "#FEF2F2", color: "#C53A3A" }}
          >
            Could not load suppliers. Check your connection and try refreshing.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !suppliersError && suppliers.length === 0 && (
          <div
            className="rounded-[10px] px-6 py-12 text-center"
            style={{ border: "1px dashed #C6CDDA", background: "#FFFFFF" }}
          >
            <div
              className="mx-auto mb-3 flex items-center justify-center"
              style={{ width: 40, height: 40, borderRadius: 9, background: GREEN_SOFT }}
            >
              <SupplierGlyph color={GREEN_HOVER} size={20} />
            </div>
            <p className="text-[14px] font-semibold" style={{ color: "#0B1A2F" }}>No suppliers configured</p>
            <p className="mx-auto mt-1 max-w-[360px] text-[12.5px] leading-5" style={{ color: "#56627A" }}>
              Add a supplier to start processing purchase orders into the format and channel it requires.
            </p>
            {canAddSupplier && (
              <button
                onClick={() => { setShowAddPanel(true); setAddError(null); }}
                className="mt-4 inline-flex h-[34px] items-center justify-center gap-[7px] rounded-[7px] px-4 text-[12.5px] font-semibold"
                style={{ border: "none", background: "var(--brand-green, #28C55E)", color: "#FFFFFF", boxShadow: "0 1px 2px rgba(40,197,94,0.30)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = GREEN_HOVER; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = GREEN; }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5v14" />
                </svg>
                New supplier
              </button>
            )}
          </div>
        )}

        {/* ── Desktop: single table card (sm and up) ─────────────────────── */}
        {!isLoading && !suppliersError && suppliers.length > 0 && (
          <div
            className="hidden overflow-hidden rounded-[10px] sm:block"
            style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
          >
            <SupplierTableHeader />

            {suppliers.map((s, idx) => {
              const isHover = hoverRow === s.id;
              return (
                <div
                  key={s.id}
                  onClick={() => router.push(`/library/suppliers/${s.id}`)}
                  onMouseEnter={() => setHoverRow(s.id)}
                  onMouseLeave={() => setHoverRow(null)}
                  title="View this supplier's delivery configuration and mappings"
                  className="group grid cursor-pointer grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_18px] items-center gap-4 px-[18px] py-[14px] transition-colors"
                  style={{
                    borderTop: idx === 0 ? "none" : "1px solid #E2E6EE",
                    background: isHover ? GREEN_SOFT : "transparent",
                  }}
                >
                  {/* Supplier — icon badge + name + code */}
                  <div className="flex min-w-0 items-center gap-[13px]">
                    <div
                      className="flex flex-shrink-0 items-center justify-center"
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 7,
                        background: isHover ? "#FFFFFF" : GREEN_SOFT,
                        transition: "background 150ms",
                      }}
                    >
                      <SupplierGlyph color={GREEN_HOVER} size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[13.5px] font-semibold leading-tight tracking-[-0.005em]" style={{ color: "#0B1A2F" }}>
                        {s.name}
                      </p>
                      <p
                        className="mt-[1px] truncate text-[10.5px] leading-tight tracking-[0.02em]"
                        style={{ color: "#8A93A5", fontFamily: MONO }}
                      >
                        {shortCode(s.name)}
                      </p>
                    </div>
                  </div>

                  {/* Format */}
                  <span className="truncate text-[12.5px]" style={{ color: "#A2AAB9" }}>—</span>

                  {/* Channel */}
                  <span className="truncate text-[12.5px]" style={{ color: "#A2AAB9" }}>—</span>

                  {/* Auto-process */}
                  <span>
                    <NotSetPill onHoverRow={isHover} />
                  </span>

                  {/* Orders */}
                  <span className="text-right text-[12.5px]" style={{ color: "#A2AAB9", fontFamily: MONO }}>—</span>

                  {/* Acceptance */}
                  <span className="text-right text-[12.5px]" style={{ color: "#A2AAB9", fontFamily: MONO }}>—</span>

                  {/* Chevron */}
                  <span className="flex items-center justify-end">
                    <svg
                      width="16" height="16" viewBox="0 0 24 24" fill="none"
                      stroke={isHover ? GREEN_HOVER : "#A4ADBD"} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                      style={{ transition: "stroke 120ms" }}
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* ── Mobile: one rounded card per supplier (below sm) ────────────── */}
        {!isLoading && !suppliersError && suppliers.length > 0 && (
          <ul className="flex list-none flex-col gap-3 p-0 sm:hidden">
            {suppliers.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => router.push(`/library/suppliers/${s.id}`)}
                  className="block w-full rounded-[12px] p-4 text-left transition-colors active:opacity-95"
                  style={{ border: "1px solid #E2E6EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
                >
                  {/* Card head: badge + name + code, chevron on the right */}
                  <div className="flex items-center gap-3">
                    <div
                      className="flex flex-shrink-0 items-center justify-center"
                      style={{ width: 40, height: 40, borderRadius: 9, background: GREEN_SOFT }}
                    >
                      <SupplierGlyph color={GREEN_HOVER} size={19} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[15px] font-semibold leading-tight tracking-[-0.005em]" style={{ color: "#0B1A2F" }}>
                        {s.name}
                      </p>
                      <p className="mt-[2px] truncate text-[11px] leading-tight tracking-[0.02em]" style={{ color: "#8A93A5", fontFamily: MONO }}>
                        {shortCode(s.name)}
                      </p>
                    </div>
                    <svg
                      width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="#A4ADBD" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
                      className="flex-shrink-0"
                    >
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                  </div>

                  {/* Card body: label / value rows */}
                  <dl
                    className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3.5"
                    style={{ borderColor: "#EEF1F6" }}
                  >
                    <MobileStat label="Format" value="—" />
                    <MobileStat label="Channel" value="—" />
                    <MobileStat label="Orders" value="—" mono />
                    <MobileStat label="Acceptance" value="—" mono />
                    <div className="col-span-2 flex items-center justify-between">
                      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#9AA3B2" }}>
                        Auto-process
                      </dt>
                      <dd className="m-0">
                        <NotSetPill onHoverRow={false} />
                      </dd>
                    </div>
                  </dl>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Column header row — mirrors the design's table head. Desktop only. */
function SupplierTableHeader() {
  const cls = "text-[10.5px] font-semibold uppercase tracking-[0.06em]";
  const color = "#8A93A5";
  return (
    <div
      className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)_18px] items-center gap-4 px-[18px] py-[11px] sm:grid"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #E2E6EE" }}
    >
      <span className={cls} style={{ color }}>Supplier</span>
      <span className={cls} style={{ color }}>Format</span>
      <span className={cls} style={{ color }}>Channel</span>
      <span className={cls} style={{ color }}>Auto-process</span>
      <span className={`${cls} text-right`} style={{ color }}>Orders</span>
      <span className={`${cls} text-right`} style={{ color }}>Acceptance</span>
      <span />
    </div>
  );
}

/**
 * Neutral "Not set" status pill — mirrors the design's grey scope/status pill
 * (bg #EFF2F7, text #8A93A5, leading dot). Turns its fill white on a hovered
 * desktop row so it reads against the green row tint.
 */
function NotSetPill({ onHoverRow }: { onHoverRow: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium"
      style={{ background: onHoverRow ? "#FFFFFF" : "#EFF2F7", color: "#8A93A5", transition: "background 150ms" }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#C6CDDA" }} />
      Not set
    </span>
  );
}

/**
 * One label/value stat inside a mobile supplier card. Stacks the uppercase
 * column label above its value so the card stays scannable at 390px.
 */
function MobileStat({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#9AA3B2" }}>
        {label}
      </dt>
      <dd className="m-0 text-[13px]" style={{ color: value === "—" ? "#A2AAB9" : "#0B1A2F", fontFamily: mono ? MONO : undefined }}>
        {value}
      </dd>
    </div>
  );
}
