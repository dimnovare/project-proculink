"use client";

// Exception Dashboard — all-orders-in-exception view.
// Lists every exception across orders, filterable by lifecycle state. Mirrors
// the Bridge Layer visual language from InboxView (grey canvas, floating white
// card, navy/blue palette).
//
// Resolution model (honest UX): the backend Reconcile pass is the source of
// truth — it auto-resolves an exception once the order's underlying cause is
// gone (mapping resolved, transform succeeds, delivery succeeds). Status-derived
// codes (unresolved_mapping / parse_failed / transform_failed / delivery_failed /
// supplier_rejected / dead_letter) can NOT be cleared from this list: a manual
// "Resolve" would only flip the row, and the next pipeline pass re-opens it. So
// for any exception tied to an order the primary action is "Open order" — fix the
// cause there and the exception clears on the next pass. "Ignore" remains for
// genuine dismissal. A real "Resolve" is only offered for a list-clearable
// exception (one with no owning order), if such ever appears.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo } from "react";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getExceptions, resolveException, ignoreException } from "@/lib/api-client";
import type { OrderException, ExceptionState } from "@/types/procurement";

// ─── Palette (mirrors InboxView / globals.css --brand-* tokens) ──────────────
const BLUE       = "#1E66C9";
const BLUE_DEEP  = "#0F4FA8";
const NAVY       = "#0B1A2F";
const INK        = NAVY;

// ─── Severity presentation ───────────────────────────────────────────────────
// Critical/error read in the alert-red family; warning amber; info blue-grey.
const SEVERITY_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  info:     { bg: "#E3EDFB", fg: "#0F4FA8", label: "Info" },
  warning:  { bg: "#FAEFD6", fg: "#9A6B0B", label: "Warning" },
  error:    { bg: "#FBE3E3", fg: "#C53A3A", label: "Error" },
  critical: { bg: "#F4D5D5", fg: "#8E1F1F", label: "Critical" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY_STYLE[severity] ?? { bg: "#EFF2F7", fg: "#56627A", label: severity };
  return (
    <span
      className="inline-flex items-center rounded-[4px] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.04em]"
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  );
}

// ─── Relative time ───────────────────────────────────────────────────────────
function relativeTime(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 1440) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

// ─── State filter tabs ───────────────────────────────────────────────────────
const STATE_TABS: Array<{ label: string; state?: ExceptionState }> = [
  { label: "All" },
  { label: "Open",     state: "open" },
  { label: "Resolved", state: "resolved" },
  { label: "Ignored",  state: "ignored" },
];

// The order-detail route in this app (see src/app/(app)/inbox/[orderId]).
function orderHref(orderId: string): string {
  return `/inbox/${orderId}`;
}

// Whether a manual "Resolve" actually clears this exception. Every status-derived
// code is re-opened by the backend Reconcile pass until the order's cause is
// fixed, so an exception that belongs to an order is NOT list-clearable — the
// honest action is "Open order". A real "Resolve" is reserved for exceptions
// with no owning order (none today, but kept defensive).
function canResolveFromList(exc: OrderException): boolean {
  return !exc.orderId;
}

export default function ExceptionsPage() {
  const router = useRouter();

  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const activeState = STATE_TABS[activeTab].state;

  // In mock mode (and live QA-bypass e2e) there is no Clerk session, so don't
  // gate the query on it — otherwise the page would hang on the loading
  // skeleton forever. See useQueriesEnabled.
  const queryEnabled = useQueriesEnabled();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["exceptions", activeState ?? "all"],
    queryFn: () => getExceptions(activeState),
    enabled: queryEnabled,
    staleTime: 15_000,
    retry: 1,
    retryDelay: 800,
  });

  const resolveMut = useMutation({
    mutationFn: (id: string) => resolveException(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exceptions"] }),
  });
  const ignoreMut = useMutation({
    mutationFn: (id: string) => ignoreException(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["exceptions"] }),
  });
  const pendingId =
    (resolveMut.isPending ? resolveMut.variables : undefined) ??
    (ignoreMut.isPending ? ignoreMut.variables : undefined);

  const exceptions = useMemo<OrderException[]>(() => data ?? [], [data]);

  // A disabled query reports undefined `data` with isLoading=true; treat the
  // not-yet-ready state as loading, never as an error (known repo gotcha).
  const showLoading = !queryEnabled || (isLoading && data === undefined);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }}>
      {/* Page header */}
      <div
        className="flex flex-col items-start gap-3 px-4 pt-5 pb-3 sm:px-6 lg:flex-row lg:items-center lg:gap-4 flex-shrink-0"
        style={{ background: "#F6F7FA" }}
      >
        <div className="flex-1">
          <h1
            className="text-[26px] font-semibold tracking-[-0.02em]"
            style={{ fontFamily: "'Bricolage Grotesque', Inter, sans-serif", color: INK }}
          >
            Exceptions
          </h1>
          <p className="text-[13px] mt-1" style={{ color: "#56627A" }}>
            Every order that needs a human decision before it can be sent.
            {!showLoading && !isError && (
              <span style={{ marginLeft: 6 }}>
                {exceptions.length.toLocaleString()} shown
              </span>
            )}
          </p>
          <p className="text-[12px] mt-1.5" style={{ color: "#8A93A5" }}>
            Open the order to fix the cause — the exception clears on the next pipeline pass. Use Ignore to dismiss one you don&apos;t plan to act on.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 lg:ml-auto lg:w-auto">
          <button
            className="flex items-center gap-1.5 rounded-[6px] px-3 text-[12.5px] font-medium transition-colors"
            style={{ height: 32, border: "1px solid #E2E6EE", background: "#FFFFFF", color: INK }}
            onClick={() => refetch()}
          >
            {isFetching ? "↻ Syncing…" : "↻ Sync"}
          </button>
        </div>
      </div>

      {/* State filter tabs */}
      <div
        className="flex flex-wrap items-center gap-1.5 px-4 pb-3 sm:px-6 flex-shrink-0"
        style={{ background: "#F6F7FA" }}
      >
        {STATE_TABS.map(({ label }, i) => {
          const active = i === activeTab;
          return (
            <button
              key={label}
              onClick={() => setActiveTab(i)}
              className="flex items-center rounded-[6px] px-3 text-[12px] font-medium transition-colors flex-shrink-0"
              style={{
                height: 28,
                border: `1px solid ${active ? INK : "#E2E6EE"}`,
                background: active ? INK : "#FFFFFF",
                color: active ? "#FFFFFF" : "#56627A",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Content card */}
      <div
        className="flex-1 min-h-0 overflow-auto mx-4 sm:mx-6 mb-4"
        style={{ background: "#FFFFFF", border: "1px solid #E2E6EE", borderRadius: 12 }}
      >
        {/* Loading skeleton */}
        {showLoading && (
          <div className="divide-y divide-[#F0F2F6]">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-5 py-4">
                <div className="h-5 w-16 rounded bg-[#E2E6EE] animate-pulse" />
                <div className="h-5 flex-1 rounded bg-[#EEF1F6] animate-pulse" />
                <div className="h-5 w-20 rounded bg-[#EEF1F6] animate-pulse" />
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {!showLoading && isError && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div
              style={{
                width: 46, height: 46, borderRadius: "50%", background: "#FBE3E3",
                display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
              }}
            >
              <span style={{ fontSize: "22px", color: "#C53A3A" }}>⚠</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: "16px", color: INK }}>
              Couldn&apos;t load exceptions
            </div>
            <div style={{ fontSize: "13px", maxWidth: 380, margin: "6px auto 14px", color: "#56627A" }}>
              The exception service didn&apos;t respond. Your orders are safe — this is usually transient.
            </div>
            <button
              onClick={() => refetch()}
              className="rounded-[6px] px-4 text-[12.5px] font-medium"
              style={{ height: 32, border: "1px solid #E2E6EE", background: "#FFFFFF", color: INK }}
            >
              ↻ Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!showLoading && !isError && exceptions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-2">
            <div style={{ fontSize: 32, color: "#2E8E3A" }}>✓</div>
            <p
              className="text-[20px] font-semibold"
              style={{ color: INK, fontFamily: "'Bricolage Grotesque', Inter, sans-serif" }}
            >
              No exceptions — all clear
            </p>
            <p className="text-[13px]" style={{ color: "#56627A", maxWidth: 380 }}>
              Nothing is blocked right now. Exceptions appear here when an order needs a
              decision before it can be sent to a supplier.
            </p>
          </div>
        )}

        {/* List — mobile cards */}
        {!showLoading && !isError && exceptions.length > 0 && (
          <>
            <div className="divide-y divide-[#F0F2F6] md:hidden">
              {exceptions.map((exc) => (
                <ExceptionCard
                  key={exc.id}
                  exc={exc}
                  busy={pendingId === exc.id}
                  onResolve={() => resolveMut.mutate(exc.id)}
                  onIgnore={() => ignoreMut.mutate(exc.id)}
                  onOpen={() => { if (exc.orderId) router.push(orderHref(exc.orderId)); }}
                />
              ))}
            </div>

            {/* List — desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table
                style={{ width: "100%", minWidth: 980, borderCollapse: "collapse", fontSize: 12.5, tableLayout: "fixed" }}
              >
                <colgroup>
                  <col style={{ width: 96 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 180 }} />
                  <col style={{ width: "auto" }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 176 }} />
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 4 }}>
                  <tr style={{ borderBottom: "1px solid #E2E6EE", background: "#FFFFFF" }}>
                    {["Severity", "Stage", "Code", "Message", "Raised", ""].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          padding: "11px 10px",
                          paddingLeft: i === 0 ? 16 : 10,
                          textAlign: i === 5 ? "right" : "left",
                          paddingRight: i === 5 ? 16 : 10,
                          fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em",
                          textTransform: "uppercase", color: "#8A93A5", whiteSpace: "nowrap",
                          background: "#FFFFFF",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {exceptions.map((exc) => {
                    const busy = pendingId === exc.id;
                    return (
                      <tr key={exc.id} style={{ borderBottom: "1px solid #F0F2F6", background: "#FFFFFF" }}>
                        <td style={{ padding: "11px 10px", paddingLeft: 16, verticalAlign: "middle" }}>
                          <SeverityBadge severity={String(exc.severity)} />
                        </td>
                        <td style={{ padding: "11px 10px", verticalAlign: "middle", color: "#56627A" }}>
                          {exc.stage ?? "—"}
                        </td>
                        <td style={{ padding: "11px 10px", verticalAlign: "middle" }}>
                          <span className="font-mono text-[11.5px]" style={{ color: INK }}>
                            {exc.code ?? "—"}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "11px 10px", verticalAlign: "middle", color: "#0B1A2F",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {exc.orderId ? (
                            <Link
                              href={`/inbox/${exc.orderId}`}
                              className="hover:underline"
                              style={{ color: INK }}
                            >
                              {exc.message}
                            </Link>
                          ) : (
                            exc.message
                          )}
                        </td>
                        <td style={{ padding: "11px 10px", verticalAlign: "middle", color: "#56627A", whiteSpace: "nowrap" }}>
                          {relativeTime(exc.createdAt)}
                        </td>
                        <td style={{ padding: "9px 10px", paddingRight: 16, verticalAlign: "middle", textAlign: "right", whiteSpace: "nowrap" }}>
                          {exc.state === "open" ? (
                            <div className="inline-flex items-center gap-1.5">
                              {canResolveFromList(exc) ? (
                                <button
                                  disabled={busy}
                                  onClick={() => resolveMut.mutate(exc.id)}
                                  className="rounded-[6px] px-2.5 text-[12px] font-semibold"
                                  style={{
                                    height: 28, background: BLUE, color: "#FFFFFF", border: 0,
                                    cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                                  }}
                                  onMouseEnter={(e) => { if (!busy) (e.currentTarget as HTMLElement).style.background = BLUE_DEEP; }}
                                  onMouseLeave={(e) => { if (!busy) (e.currentTarget as HTMLElement).style.background = BLUE; }}
                                >
                                  Resolve
                                </button>
                              ) : (
                                <button
                                  disabled={busy || !exc.orderId}
                                  onClick={() => { if (exc.orderId) router.push(orderHref(exc.orderId)); }}
                                  className="rounded-[6px] px-2.5 text-[12px] font-semibold"
                                  style={{
                                    height: 28, background: BLUE, color: "#FFFFFF", border: 0,
                                    cursor: busy || !exc.orderId ? "default" : "pointer", opacity: busy || !exc.orderId ? 0.6 : 1,
                                  }}
                                  onMouseEnter={(e) => { if (!busy && exc.orderId) (e.currentTarget as HTMLElement).style.background = BLUE_DEEP; }}
                                  onMouseLeave={(e) => { if (!busy && exc.orderId) (e.currentTarget as HTMLElement).style.background = BLUE; }}
                                >
                                  Open order
                                </button>
                              )}
                              <button
                                disabled={busy}
                                onClick={() => ignoreMut.mutate(exc.id)}
                                className="rounded-[6px] px-2.5 text-[12px] font-medium"
                                style={{
                                  height: 28, background: "#FFFFFF", color: "#56627A",
                                  border: "1px solid #E2E6EE", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1,
                                }}
                              >
                                Ignore
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11.5px] capitalize" style={{ color: "#8A93A5" }}>
                              {exc.state ?? "—"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Mobile card ─────────────────────────────────────────────────────────────
function ExceptionCard({
  exc, busy, onResolve, onIgnore, onOpen,
}: {
  exc: OrderException;
  busy: boolean;
  onResolve: () => void;
  onIgnore: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="mb-1.5 flex items-center gap-2">
        <SeverityBadge severity={String(exc.severity)} />
        {exc.stage && (
          <span className="text-[11.5px]" style={{ color: "#8A93A5" }}>{exc.stage}</span>
        )}
        <span className="ml-auto text-[11.5px]" style={{ color: "#8A93A5" }}>{relativeTime(exc.createdAt)}</span>
      </div>
      <p className="text-[13px] leading-snug" style={{ color: "#0B1A2F" }}>
        {exc.orderId ? (
          <Link href={`/inbox/${exc.orderId}`} className="hover:underline" style={{ color: INK }}>
            {exc.message}
          </Link>
        ) : (
          exc.message
        )}
      </p>
      {exc.code && (
        <p className="mt-1 font-mono text-[11px]" style={{ color: "#8A93A5" }}>{exc.code}</p>
      )}
      {exc.state === "open" ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          {canResolveFromList(exc) ? (
            <button
              disabled={busy}
              onClick={onResolve}
              className="rounded-[6px] px-3 text-[12px] font-semibold"
              style={{ height: 30, background: BLUE, color: "#FFFFFF", border: 0, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
            >
              Resolve
            </button>
          ) : (
            <button
              disabled={busy || !exc.orderId}
              onClick={onOpen}
              className="rounded-[6px] px-3 text-[12px] font-semibold"
              style={{ height: 30, background: BLUE, color: "#FFFFFF", border: 0, cursor: busy || !exc.orderId ? "default" : "pointer", opacity: busy || !exc.orderId ? 0.6 : 1 }}
            >
              Open order
            </button>
          )}
          <button
            disabled={busy}
            onClick={onIgnore}
            className="rounded-[6px] px-3 text-[12px] font-medium"
            style={{ height: 30, background: "#FFFFFF", color: "#56627A", border: "1px solid #E2E6EE", cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            Ignore
          </button>
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] capitalize" style={{ color: "#8A93A5" }}>{exc.state}</p>
      )}
    </div>
  );
}
