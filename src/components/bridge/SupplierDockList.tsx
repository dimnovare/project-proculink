"use client";

// Suppliers — /library/suppliers
// List of every supplier the buyer delivers orders to. Fetches live data from
// GET /api/suppliers, then enriches each visible row with its delivery config
// (GET /api/suppliers/{id}/delivery-config) so the Supplier / Format / Channel /
// Auto-process columns carry real data. A green supplier-entity accent (badge
// tile, hover band) and a blue primary "New supplier" action.
//
// Columns the design once showed but for which no real data source exists on
// either the supplier list or the delivery config — "Orders" and "Acceptance"
// (they'd need a per-supplier order/delivery-success aggregate the API doesn't
// expose here) — were DROPPED rather than rendered as permanent dashes, per the
// offer↔works rule. Format / Channel / Auto-process come from the delivery
// config and read "Not set" only when the supplier genuinely has no config yet.
//
// Performance: the delivery config is fetched PER ROW via a child component's own
// query, but bounded — only the first DELIVERY_FETCH_CAP rows fetch — so a large
// supplier book can't trigger an unbounded burst of requests. Each row's query
// has a long staleTime so navigating away and back doesn't re-hit the API.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getBillingStatus, apiClient, listConnections } from "@/lib/api-client";
import { getDeliveryConfig } from "@/lib/api/delivery";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import type { DeliveryConfig, DeliveryProtocol } from "@/lib/api/types";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import { PageHeader } from "./layout/PageHeader";
import { PageShell } from "./layout/PageShell";

// How many rows enrich themselves with a delivery-config fetch. Procurement
// books are typically 3–20 suppliers (the ICP), so this comfortably covers a
// real account while capping the request burst on the rare oversized list.
const DELIVERY_FETCH_CAP = 50;

// Friendly channel labels for the raw protocol ids (mirrors DeliveryConfigEditor).
const PROTOCOL_LABEL: Record<DeliveryProtocol, string> = {
  http: "HTTP",
  sftp: "SFTP",
  ftps: "FTPS",
  smtp: "Email",
  erp_erply: "Erply ERP",
  erp_directo: "Directo ERP",
};

function channelLabel(protocol: string): string {
  return PROTOCOL_LABEL[protocol as DeliveryProtocol] ?? protocol.toUpperCase();
}

function formatLabel(outputFormat?: string | null): string | null {
  if (!outputFormat) return null;
  return outputFormat.toUpperCase();
}

// ── Palette (CSS-var first; hexes mirror tokens for inline-only styles) ──────
// Supplier-green is the supplier ENTITY colour across the product (badge tile,
// hover row band, acceptance). Forest #2E8E3A reads crisp on white; deep #1E6D29
// is the icon stroke / accepted text; soft #E9F1EA is the tile / hover fill.
const GREEN        = "#2E8E3A"; // brand supplier green (markers, focus ring)
const GREEN_DEEP   = "#1E6D29"; // deep green — icon stroke, accepted text
const GREEN_SOFT   = "#E9F1EA"; // soft green — badge tile, hovered row band
// Blue is the primary-action colour (buttons), per the design source.
const BLUE         = "#1E66C9";
const BLUE_DEEP    = "#0F4FA8";
// Neutrals (sampled from the design render / tokens.css).
const INK          = "#0B1A2F"; // primary text
const TEXT_MUTED   = "#5E6779"; // subtitle / pill text
const TEXT_FAINT   = "var(--ink-faint)"; // header labels / codes
const PLACEHOLDER  = "#A2AAB9"; // faint "—" for not-yet-configured cells
const BORDER       = "#E5E8EE"; // card border + row dividers
const PILL_BG      = "#F1F3F7"; // neutral "Not set" pill fill
// Shared monospace stack for codes / numeric cells (matches the Buyers table).
const MONO         = "'JetBrains Mono', ui-monospace, monospace";

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

/** Supplier glyph — truck mark from the design icon set (stroke 1.75). */
function SupplierGlyph({ color, size = 16 }: { color: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 18V6a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h2" />
      <path d="M14 9h4l4 4v4a1 1 0 0 1-1 1h-1" />
      <circle cx="7.5" cy="18.5" r="1.5" />
      <circle cx="17.5" cy="18.5" r="1.5" />
    </svg>
  );
}

export function SupplierDockList() {
  const router = useRouter();
  const qc = useQueryClient();
  // Direction-aware copy: "Supplier" → "Customer" in inbound mode (route/types unchanged).
  const { labels } = useOrderDirection();
  const noun = labels.counterpartyNoun;       // "Supplier" | "Customer"
  const nounLower = noun.toLowerCase();        // "supplier" | "customer"
  const plural = labels.counterpartyPlural;    // "Suppliers" | "Customers"
  const pluralLower = plural.toLowerCase();     // "suppliers" | "customers"
  const queryEnabled = useQueriesEnabled();
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [hoverRow, setHoverRow] = useState<string | null>(null);

  // ── Billing check ──────────────────────────────────────────────────────────
  const { data: billing, isError: billingError } = useQuery({
    queryKey: ["billing-status"],
    queryFn: getBillingStatus,
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
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
    enabled: queryEnabled,
    retry: 1,
    retryDelay: 800,
  });

  // ── Versioned connections (one query for the whole list) ──────────────────
  // supplierId → connectionId, so each row can link to its Connection where one
  // exists. Rows without a connection simply show no link (a connection is
  // created the first time the supplier is configured).
  const { data: connections } = useQuery({
    queryKey: ["connections"],
    queryFn: listConnections,
    enabled: queryEnabled,
    staleTime: 5 * 60_000,
    retry: 1,
    retryDelay: 800,
  });
  const connectionIdBySupplier = useMemo(
    () => new Map((connections ?? []).map((c) => [c.supplierId, c.id] as const)),
    [connections],
  );

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
    if (!trimmed) { setAddError(`${noun} name is required.`); return; }
    setAddError(null);
    createMutation.mutate(trimmed);
  }

  const limitReached = !billingError && billing && !billing.canAddSupplier;
  const hasRows = !isLoading && !suppliersError && suppliers.length > 0;

  return (
    <PageShell variant="wide">
        {/* Page header — canonical PageHeader; New supplier = primary action (blue, per design source) */}
        <PageHeader
          title={plural}
          sub={
            isLoading
              ? "Loading…"
              : `Your ${pluralLower} directory — each one's versioned integration lives in Connections. ${suppliers.length} active ${nounLower}${suppliers.length === 1 ? "" : "s"}.`
          }
          actions={
            <div className="w-full sm:w-auto">
              <button
                disabled={!canAddSupplier || createMutation.isPending}
                onClick={() => { setShowAddPanel(true); setAddError(null); }}
                className="inline-flex h-[34px] w-full items-center justify-center gap-[7px] rounded-[7px] px-4 text-[12.5px] font-semibold tracking-[-0.005em] transition-colors sm:w-auto"
                style={{
                  background: limitReached ? "#F1F3F7" : BLUE,
                  color: limitReached ? "var(--ink-faint)" : "#FFFFFF",
                  border: "none",
                  cursor: !canAddSupplier ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  boxShadow: limitReached ? "none" : "0 1px 2px rgba(30,102,201,0.30)",
                }}
                onMouseEnter={(e) => { if (canAddSupplier && !limitReached) (e.currentTarget as HTMLButtonElement).style.background = BLUE_DEEP; }}
                onMouseLeave={(e) => { if (canAddSupplier && !limitReached) (e.currentTarget as HTMLButtonElement).style.background = BLUE; }}
              >
                {!limitReached && (
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12h14M12 5v14" />
                  </svg>
                )}
                {limitReached ? `${noun} limit reached` : `New ${nounLower}`}
              </button>
            </div>
          }
        />

        {/* Billing limit banner */}
        {billing && !billing.canAddSupplier && (
          <div
            className="mb-4 rounded-[10px] px-4 py-3"
            style={{ border: "1px solid #F0D39A", borderLeft: "3px solid #B36D14", background: "#FFF8EA" }}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-[13px] font-semibold" style={{ color: INK }}>
                  Your {billing.plan} plan includes {billing.supplierLimit} {nounLower}{billing.supplierLimit === 1 ? "" : "s"}.
                </p>
                <p className="mt-1 text-[12px] leading-5" style={{ color: "#7A4D0B" }}>
                  Existing {nounLower} flows remain viewable. Upgrade when you are ready to add another {nounLower} route.
                </p>
              </div>
              <button
                onClick={() => router.push("/settings")}
                className="h-8 rounded-[6px] px-3 text-[12px] font-semibold"
                style={{ border: "1px solid #B36D14", background: "#FFFFFF", color: "#9A5F0A" }}
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
            {noun} limits could not be checked because the billing API is unavailable.
          </div>
        )}

        {/* Add supplier panel */}
        {showAddPanel && canAddSupplier && (
          <div
            className="mb-4 overflow-hidden rounded-[10px]"
            style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
          >
            <div className="flex items-start justify-between gap-3 px-[18px] pt-[18px]">
              <div className="flex items-start gap-3">
                <div
                  className="flex flex-shrink-0 items-center justify-center"
                  style={{ width: 34, height: 34, borderRadius: 7, background: GREEN_SOFT }}
                >
                  <SupplierGlyph color={GREEN_DEEP} size={17} />
                </div>
                <div>
                  <p className="text-[15px] font-semibold tracking-[-0.01em]" style={{ color: INK }}>New {nounLower}</p>
                  <p className="mt-0.5 text-[12.5px]" style={{ color: TEXT_MUTED }}>Name the {nounLower}. You can configure mappings and delivery after.</p>
                </div>
              </div>
              <button
                onClick={() => { setShowAddPanel(false); setNewName(""); setAddError(null); }}
                aria-label="Close add supplier panel"
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-[6px]"
                style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", color: "var(--ink-faint)" }}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 10L10 2M2 2l8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="flex flex-col gap-2 px-[18px] pb-[18px] pt-3">
              <label className="text-[11.5px] font-semibold" style={{ color: TEXT_MUTED }}>
                {noun} name <span style={{ color: "#B43838", marginLeft: 3 }}>*</span>
              </label>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <input
                  aria-label={`${noun} name`}
                  placeholder="e.g. Acme Components"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
                  className="h-[34px] rounded-[6px] px-3 text-[12.5px]"
                  style={{ border: "1px solid #CBD0DA", color: INK, transition: "border-color 150ms, box-shadow 150ms" }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = GREEN; e.currentTarget.style.boxShadow = `0 0 0 3px ${GREEN_SOFT}`; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = "#CBD0DA"; e.currentTarget.style.boxShadow = "none"; }}
                  autoFocus
                />
                {/* Save — confirmation CTA stays green (matches design ctaVariant) */}
                <button
                  onClick={handleSave}
                  disabled={createMutation.isPending}
                  className="inline-flex h-[34px] items-center justify-center gap-[6px] rounded-[7px] px-4 text-[12.5px] font-semibold transition-colors"
                  style={{
                    border: "none",
                    background: GREEN,
                    color: "#FFFFFF",
                    cursor: createMutation.isPending ? "not-allowed" : "pointer",
                    opacity: createMutation.isPending ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                  onMouseEnter={(e) => { if (!createMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = GREEN_DEEP; }}
                  onMouseLeave={(e) => { if (!createMutation.isPending) (e.currentTarget as HTMLButtonElement).style.background = GREEN; }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                  {createMutation.isPending ? "Saving…" : `Save ${nounLower}`}
                </button>
              </div>
              <div
                className="mt-1 flex items-start gap-2 rounded-[6px] px-3 py-2.5 text-[12px] leading-5"
                style={{ background: GREEN_SOFT, color: GREEN_DEEP }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: 1, flexShrink: 0 }}>
                  <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
                </svg>
                Auto-process means orders are sent to this {nounLower} automatically once they pass checks. It stays off until you set up delivery and turn it on.
              </div>
              {addError && (
                <p className="text-[12px]" style={{ color: "#B43838" }}>{addError}</p>
              )}
            </div>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div
            className="overflow-hidden rounded-[10px]"
            style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
            role="status"
            aria-busy="true"
          >
            <span className="sr-only">Loading…</span>
            <SupplierTableHeader counterpartyNoun={noun} />
            {[1, 2, 3, 4].map((i, idx) => (
              <div
                key={i}
                className="flex items-center gap-[13px] px-[18px] py-[14px]"
                style={{ borderTop: idx === 0 ? "none" : "1px solid #E5E8EE" }}
              >
                <div className="h-8 w-8 flex-shrink-0 rounded-[7px] animate-pulse" style={{ background: "#F1F3F7" }} />
                <div className="flex flex-col gap-1.5">
                  <div className="h-3.5 w-32 rounded animate-pulse" style={{ background: "#F1F3F7" }} />
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
            style={{ border: "1px solid #F1C9C9", background: "#FEF2F2", color: "#B43838" }}
          >
            Could not load suppliers. Check your connection and try refreshing.
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !suppliersError && suppliers.length === 0 && (
          <div
            className="rounded-[10px] px-6 py-12 text-center"
            style={{ border: "1px dashed #CBD0DA", background: "#FFFFFF" }}
          >
            <div
              className="mx-auto mb-3 flex items-center justify-center"
              style={{ width: 40, height: 40, borderRadius: 9, background: GREEN_SOFT }}
            >
              <SupplierGlyph color={GREEN_DEEP} size={20} />
            </div>
            <p className="text-[14px] font-semibold" style={{ color: INK }}>No {pluralLower} configured</p>
            <p className="mx-auto mt-1 max-w-[360px] text-[12.5px] leading-5" style={{ color: TEXT_MUTED }}>
              Add a {nounLower} to start processing purchase orders into the format and channel it requires.
            </p>
            {canAddSupplier && (
              <button
                onClick={() => { setShowAddPanel(true); setAddError(null); }}
                className="mt-4 inline-flex h-[34px] items-center justify-center gap-[7px] rounded-[7px] px-4 text-[12.5px] font-semibold"
                style={{ border: "none", background: BLUE, color: "#FFFFFF", boxShadow: "0 1px 2px rgba(30,102,201,0.30)" }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BLUE_DEEP; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = BLUE; }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5v14" />
                </svg>
                New {nounLower}
              </button>
            )}
          </div>
        )}

        {/* ── Desktop: single table card (sm and up) ─────────────────────── */}
        {hasRows && (
          <div
            className="hidden overflow-hidden rounded-[10px] sm:block"
            style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <colgroup>
                <col />
                <col style={{ width: 160 }} />
                <col style={{ width: 160 }} />
                <col style={{ width: 170 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 44 }} />
              </colgroup>
              <thead>
                <tr>
                  {([
                    { label: noun,           align: "left"  },
                    { label: "Format",       align: "left"  },
                    { label: "Channel",      align: "left"  },
                    { label: "Auto-process", align: "left"  },
                    { label: "",             align: "right" },
                    { label: "",             align: "right" },
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
                {suppliers.map((s, idx) => (
                  <SupplierTableRow
                    key={s.id}
                    id={s.id}
                    name={s.name}
                    isHover={hoverRow === s.id}
                    isLast={idx === suppliers.length - 1}
                    fetchConfig={queryEnabled && idx < DELIVERY_FETCH_CAP}
                    nounLower={nounLower}
                    connectionId={connectionIdBySupplier.get(s.id) ?? null}
                    onEnter={() => setHoverRow(s.id)}
                    onLeave={() => setHoverRow(null)}
                    onOpen={() => router.push(`/library/suppliers/${s.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Mobile: one rounded card per supplier (below sm) ────────────── */}
        {hasRows && (
          <ul className="flex list-none flex-col gap-3 p-0 sm:hidden">
            {suppliers.map((s, idx) => (
              <SupplierMobileCard
                key={s.id}
                id={s.id}
                name={s.name}
                fetchConfig={queryEnabled && idx < DELIVERY_FETCH_CAP}
                connectionId={connectionIdBySupplier.get(s.id) ?? null}
                onOpen={() => router.push(`/library/suppliers/${s.id}`)}
              />
            ))}
          </ul>
        )}
    </PageShell>
  );
}

/** Column header row — used by the loading skeleton (desktop only). */
function SupplierTableHeader({ counterpartyNoun = "Supplier" }: { counterpartyNoun?: string }) {
  const cls = "text-[10.5px] font-semibold uppercase tracking-[0.06em]";
  const color = "var(--ink-faint)";
  return (
    <div
      className="hidden grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_18px] items-center gap-4 px-[18px] py-[11px] sm:grid"
      style={{ background: "#FFFFFF", borderBottom: "1px solid #E5E8EE" }}
    >
      <span className={cls} style={{ color }}>{counterpartyNoun}</span>
      <span className={cls} style={{ color }}>Format</span>
      <span className={cls} style={{ color }}>Channel</span>
      <span className={cls} style={{ color }}>Auto-process</span>
      <span />
    </div>
  );
}

/**
 * Per-row delivery-config query. Each visible supplier row owns its own fetch so
 * the list can render immediately while configs stream in. Bounded at the call
 * site (only the first DELIVERY_FETCH_CAP rows pass `enabled`), with a long
 * staleTime so the configs survive navigation without re-hitting the API.
 *
 * Returns null both when no config exists (backend 204 → null) and when the
 * fetch is disabled/still loading — callers distinguish via `isLoading`.
 */
function useSupplierDeliveryConfig(supplierId: string, enabled: boolean) {
  return useQuery<DeliveryConfig | null>({
    queryKey: ["supplier-delivery-config", supplierId],
    queryFn: () => getDeliveryConfig(supplierId),
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
    retryDelay: 800,
  });
}

/**
 * Auto-process status pill. ON = green (delivery is auto-fired), OFF = neutral
 * "Off", and "Not set" when the supplier has no delivery config yet (the honest
 * empty state — distinct from a configured-but-manual supplier).
 */
function AutoProcessPill({ state, onHoverRow }: { state: "on" | "off" | "unset"; onHoverRow: boolean }) {
  if (state === "unset") return <NotSetPill onHoverRow={onHoverRow} />;
  const isOn = state === "on";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium"
      style={{
        background: isOn ? GREEN_SOFT : (onHoverRow ? "#FFFFFF" : PILL_BG),
        color: isOn ? GREEN_DEEP : TEXT_MUTED,
        transition: "background 150ms",
      }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: isOn ? GREEN : "#CBD0DA" }} />
      {isOn ? "On" : "Off"}
    </span>
  );
}

/** Faint inline placeholder cell value (loading shimmer or honest "—"). */
function CellValue({
  isLoading,
  value,
}: {
  isLoading: boolean;
  value: string | null;
}) {
  if (isLoading) {
    return <span className="inline-block h-3 w-12 rounded animate-pulse align-middle" style={{ background: "#F1F3F7" }} />;
  }
  if (value == null) {
    return <span className="text-[12.5px]" style={{ color: PLACEHOLDER }}>—</span>;
  }
  return <span className="text-[12.5px]" style={{ color: INK }}>{value}</span>;
}

/**
 * One desktop table row, enriched with its delivery config. Format / Channel are
 * derived from the config (or a faint "—" when unconfigured); Auto-process is a
 * pill driven by `autoDeliver`.
 */
function SupplierTableRow({
  id,
  name,
  isHover,
  isLast,
  fetchConfig,
  nounLower,
  connectionId,
  onEnter,
  onLeave,
  onOpen,
}: {
  id: string;
  name: string;
  isHover: boolean;
  isLast: boolean;
  fetchConfig: boolean;
  nounLower: string;
  /** This supplier's versioned Connection id, or null when none exists yet. */
  connectionId: string | null;
  onEnter: () => void;
  onLeave: () => void;
  onOpen: () => void;
}) {
  const { data: config, isLoading } = useSupplierDeliveryConfig(id, fetchConfig);
  // Only show the loading shimmer while a fetch is genuinely in flight.
  const loading = fetchConfig && isLoading;
  const autoState: "on" | "off" | "unset" = !config ? "unset" : config.autoDeliver ? "on" : "off";
  const cellBorder = isLast ? "none" : `1px solid ${BORDER}`;

  return (
    <tr
      onClick={onOpen}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      title={`View this ${nounLower}'s delivery configuration and mappings`}
      style={{
        cursor: "pointer",
        transition: "background 150ms",
        background: isHover ? GREEN_SOFT : "transparent",
      }}
    >
      {/* Supplier — green tile + name + code */}
      <td style={{ padding: "14px 18px", borderBottom: cellBorder, verticalAlign: "middle" }}>
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
            <SupplierGlyph color={GREEN_DEEP} size={16} />
          </div>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-semibold leading-tight tracking-[-0.005em]" style={{ color: INK }}>
              {name}
            </p>
            <p className="mt-[1px] truncate text-[10.5px] leading-tight tracking-[0.02em]" style={{ color: TEXT_FAINT, fontFamily: MONO }}>
              {shortCode(name)}
            </p>
          </div>
        </div>
      </td>

      {/* Format — from delivery config outputFormat */}
      <td style={{ padding: "14px 18px", borderBottom: cellBorder, verticalAlign: "middle" }}>
        <CellValue isLoading={loading} value={config ? formatLabel(config.outputFormat) : null} />
      </td>

      {/* Channel — from delivery config protocol */}
      <td style={{ padding: "14px 18px", borderBottom: cellBorder, verticalAlign: "middle" }}>
        <CellValue isLoading={loading} value={config ? channelLabel(config.protocol) : null} />
      </td>

      {/* Auto-process — from delivery config autoDeliver */}
      <td style={{ padding: "14px 18px", borderBottom: cellBorder, verticalAlign: "middle" }}>
        {loading ? (
          <span className="inline-block h-4 w-14 rounded-full animate-pulse align-middle" style={{ background: "#F1F3F7" }} />
        ) : (
          <AutoProcessPill state={autoState} onHoverRow={isHover} />
        )}
      </td>

      {/* History — compact link to this supplier's version-history tab (hidden when
          no connection exists yet). STRUCT-1: the version history now lives on the
          supplier page (?tab=history), not the standalone /connections route. */}
      <td style={{ padding: "14px 8px", borderBottom: cellBorder, textAlign: "right", verticalAlign: "middle", whiteSpace: "nowrap" }}>
        {connectionId && (
          <Link
            href={`/library/suppliers/${id}?tab=history`}
            onClick={(e) => e.stopPropagation()}
            title={`Open this ${nounLower}'s version history`}
            className="text-[11.5px] font-medium"
            style={{ color: isHover ? GREEN_DEEP : TEXT_MUTED, textDecoration: "none", transition: "color 120ms" }}
          >
            History ›
          </Link>
        )}
      </td>

      {/* Chevron */}
      <td style={{ padding: "14px 14px", borderBottom: cellBorder, textAlign: "right", verticalAlign: "middle" }}>
        <svg
          width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke={isHover ? GREEN_DEEP : "#A4ADBD"} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
          style={{ transition: "stroke 120ms", display: "inline-block" }}
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </td>
    </tr>
  );
}

/** One mobile supplier card, enriched with its delivery config. */
function SupplierMobileCard({
  id,
  name,
  fetchConfig,
  connectionId,
  onOpen,
}: {
  id: string;
  name: string;
  fetchConfig: boolean;
  /** This supplier's versioned Connection id, or null when none exists yet. */
  connectionId: string | null;
  onOpen: () => void;
}) {
  const { data: config, isLoading } = useSupplierDeliveryConfig(id, fetchConfig);
  const loading = fetchConfig && isLoading;
  const autoState: "on" | "off" | "unset" = !config ? "unset" : config.autoDeliver ? "on" : "off";

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="block w-full rounded-[12px] p-4 text-left transition-colors active:opacity-95"
        style={{ border: "1px solid #E5E8EE", background: "#FFFFFF", boxShadow: "0 1px 2px rgba(11,26,47,0.04)" }}
      >
        {/* Card head: badge + name + code, chevron on the right */}
        <div className="flex items-center gap-3">
          <div
            className="flex flex-shrink-0 items-center justify-center"
            style={{ width: 40, height: 40, borderRadius: 9, background: GREEN_SOFT }}
          >
            <SupplierGlyph color={GREEN_DEEP} size={19} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight tracking-[-0.005em]" style={{ color: INK }}>
              {name}
            </p>
            <p className="mt-[2px] truncate text-[11px] leading-tight tracking-[0.02em]" style={{ color: TEXT_FAINT, fontFamily: MONO }}>
              {shortCode(name)}
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

        {/* Card body: label / value rows (Format · Channel · Auto-process) */}
        <dl
          className="mt-3.5 grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-3.5"
          style={{ borderColor: "#EEF1F6" }}
        >
          <MobileStat label="Format" loading={loading} value={config ? formatLabel(config.outputFormat) : null} />
          <MobileStat label="Channel" loading={loading} value={config ? channelLabel(config.protocol) : null} />
          <div className="col-span-2 flex items-center justify-between">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#9AA3B2" }}>
              Auto-process
            </dt>
            <dd className="m-0">
              {loading ? (
                <span className="inline-block h-4 w-14 rounded-full animate-pulse" style={{ background: "#F1F3F7" }} />
              ) : (
                <AutoProcessPill state={autoState} onHoverRow={false} />
              )}
            </dd>
          </div>
        </dl>
      </button>
      {/* Version-history link — sits OUTSIDE the card button (no nested
          interactive elements); hidden when no connection exists yet. STRUCT-1:
          the history view now lives on the supplier page (?tab=history). */}
      {connectionId && (
        <Link
          href={`/library/suppliers/${id}?tab=history`}
          className="mt-1.5 inline-flex items-center px-1 py-1 text-[12px] font-medium"
          style={{ color: TEXT_MUTED, textDecoration: "none" }}
        >
          History ›
        </Link>
      )}
    </li>
  );
}

/**
 * Neutral "Not set" status pill — mirrors the design's grey scope/status pill
 * (bg #F1F3F7, text #5E6779, leading dot). Turns its fill white on a hovered
 * desktop row so it reads against the green row tint.
 */
function NotSetPill({ onHoverRow }: { onHoverRow: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-medium"
      style={{ background: onHoverRow ? "#FFFFFF" : PILL_BG, color: TEXT_MUTED, transition: "background 150ms" }}
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: "#CBD0DA" }} />
      Not set
    </span>
  );
}

/**
 * One label/value stat inside a mobile supplier card. Stacks the uppercase
 * column label above its value so the card stays scannable at 390px. A null
 * value renders the honest faint "—"; `loading` shows a shimmer.
 */
function MobileStat({ label, value, loading = false }: { label: string; value: string | null; loading?: boolean }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#9AA3B2" }}>
        {label}
      </dt>
      <dd className="m-0 text-[13px]" style={{ color: value == null ? PLACEHOLDER : INK }}>
        {loading ? (
          <span className="inline-block h-3 w-12 rounded animate-pulse" style={{ background: "#F1F3F7" }} />
        ) : (
          value ?? "—"
        )}
      </dd>
    </div>
  );
}
