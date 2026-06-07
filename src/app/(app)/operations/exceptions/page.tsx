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
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { Button } from "@/components/bridge/DSPrimitives";

// ─── Severity presentation ───────────────────────────────────────────────────
// Critical/error read in the alert-red family; warning amber; info blue-grey.
// SeverityBadge is NON-order severity (info/warning/error/critical) — NOT
// replaced with UnifiedStatusBadge. Colors tokenized to CSS vars.
// Note: critical.fg #8E1F1F and critical.bg #F4D5D5 have no exact token
// match (darker than --danger/#C53A3A / --danger-soft/#FBE3E3); kept as-is.
const SEVERITY_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  info:     { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)", label: "Info" },
  warning:  { bg: "var(--amber-soft)",      fg: "var(--amber)",           label: "Warning" },
  error:    { bg: "var(--danger-soft)",     fg: "var(--danger)",          label: "Error" },
  critical: { bg: "#F4D5D5",               fg: "#8E1F1F",                label: "Critical" },
};

function SeverityBadge({ severity }: { severity: string }) {
  const s = SEVERITY_STYLE[severity] ?? { bg: "var(--surface-2)", fg: "var(--ink-muted)", label: severity };
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
    <PageShell variant="wide">
      {/* Page header */}
      <PageHeader
        title="Exceptions"
        sub={
          [
            "Every order that needs a human decision before it can be sent.",
            !showLoading && !isError ? `${exceptions.length.toLocaleString()} shown` : "",
          ]
            .filter(Boolean)
            .join("  ")
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
          >
            {isFetching ? "↻ Syncing…" : "↻ Sync"}
          </Button>
        }
      />

      {/* Instructional note */}
      <p className="text-[12px] mb-4 -mt-3" style={{ color: "var(--ink-faint)" }}>
        Open the order to fix the cause — the exception clears on the next pipeline pass. Use Ignore to dismiss one you don&apos;t plan to act on.
      </p>

      {/* State filter tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {STATE_TABS.map(({ label }, i) => {
          const active = i === activeTab;
          return (
            <button
              key={label}
              onClick={() => setActiveTab(i)}
              className="flex items-center rounded-[6px] px-3 text-[12px] font-medium transition-colors flex-shrink-0"
              style={{
                height: 28,
                border: `1px solid ${active ? "var(--ink)" : "var(--border)"}`,
                background: active ? "var(--ink)" : "var(--surface)",
                color: active ? "var(--surface)" : "var(--ink-muted)",
                cursor: "pointer",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Content card — uses raw div for flush-edge table layout (no inner padding).
          Card primitive adds 18px padding which breaks the full-bleed table colgroup
          alignment and sticky thead; replicate Card's chrome (surface/border/radius/shadow)
          without padding so table rows extend wall-to-wall, matching HEAD behaviour. */}
      <div
        className="flex-1 min-h-0 overflow-auto mb-4"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-card)",
        }}
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
                width: 46, height: 46, borderRadius: "50%", background: "var(--danger-soft)",
                display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px",
              }}
            >
              <span style={{ fontSize: "22px", color: "var(--danger)" }}>⚠</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: "16px", color: "var(--ink)" }}>
              Couldn&apos;t load exceptions
            </div>
            <div style={{ fontSize: "13px", maxWidth: 380, margin: "6px auto 14px", color: "var(--ink-muted)" }}>
              The exception service didn&apos;t respond. Your orders are safe — this is usually transient.
            </div>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              ↻ Retry
            </Button>
          </div>
        )}

        {/* Empty state */}
        {!showLoading && !isError && exceptions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-2">
            <div style={{ fontSize: 32, color: "var(--brand-green)" }}>✓</div>
            <p
              className="text-[20px] font-semibold"
              style={{ color: "var(--ink)", fontFamily: "'Bricolage Grotesque', Inter, sans-serif" }}
            >
              No exceptions — all clear
            </p>
            <p className="text-[13px]" style={{ color: "var(--ink-muted)", maxWidth: 380 }}>
              Nothing is blocked right now. Exceptions appear here when an order needs a
              decision before it can be sent to a supplier.
            </p>
          </div>
        )}

        {/* List — mobile cards */}
        {!showLoading && !isError && exceptions.length > 0 && (
          <>
            <div className="flex flex-col gap-2 p-3 md:hidden">
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
                  <tr style={{ borderBottom: "1px solid var(--border)", background: "var(--surface)" }}>
                    {["Severity", "Stage", "Code", "Message", "Raised", ""].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          padding: "11px 10px",
                          paddingLeft: i === 0 ? 16 : 10,
                          textAlign: i === 5 ? "right" : "left",
                          paddingRight: i === 5 ? 16 : 10,
                          fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em",
                          textTransform: "uppercase", color: "var(--ink-faint)", whiteSpace: "nowrap",
                          background: "var(--surface)",
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
                      <tr key={exc.id} style={{ borderBottom: "1px solid #F0F2F6", background: "var(--surface)" }}>
                        <td style={{ padding: "11px 10px", paddingLeft: 16, verticalAlign: "middle" }}>
                          <SeverityBadge severity={String(exc.severity)} />
                        </td>
                        <td style={{ padding: "11px 10px", verticalAlign: "middle", color: "var(--ink-muted)" }}>
                          {exc.stage ?? "—"}
                        </td>
                        <td style={{ padding: "11px 10px", verticalAlign: "middle" }}>
                          <span className="font-mono text-[11.5px]" style={{ color: "var(--ink)" }}>
                            {exc.code ?? "—"}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "11px 10px", verticalAlign: "middle", color: "var(--ink)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          {exc.orderId ? (
                            <Link
                              href={`/inbox/${exc.orderId}`}
                              className="hover:underline"
                              style={{ color: "var(--ink)" }}
                            >
                              {exc.message}
                            </Link>
                          ) : (
                            exc.message
                          )}
                        </td>
                        <td style={{ padding: "11px 10px", verticalAlign: "middle", color: "var(--ink-muted)", whiteSpace: "nowrap" }}>
                          {relativeTime(exc.createdAt)}
                        </td>
                        <td style={{ padding: "9px 10px", paddingRight: 16, verticalAlign: "middle", textAlign: "right", whiteSpace: "nowrap" }}>
                          {exc.state === "open" ? (
                            <div className="inline-flex items-center gap-1.5">
                              {canResolveFromList(exc) ? (
                                <Button
                                  variant="blue"
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => resolveMut.mutate(exc.id)}
                                >
                                  Resolve
                                </Button>
                              ) : (
                                <Button
                                  variant="blue"
                                  size="sm"
                                  disabled={busy || !exc.orderId}
                                  onClick={() => { if (exc.orderId) router.push(orderHref(exc.orderId)); }}
                                >
                                  Open order
                                </Button>
                              )}
                              <Button
                                variant="secondary"
                                size="sm"
                                disabled={busy}
                                onClick={() => ignoreMut.mutate(exc.id)}
                              >
                                Ignore
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[11.5px] capitalize" style={{ color: "var(--ink-faint)" }}>
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
    </PageShell>
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
    <MobileListRow>
      <div className="mb-1.5 flex items-center gap-2">
        <SeverityBadge severity={String(exc.severity)} />
        {exc.stage && (
          <span className="text-[11.5px]" style={{ color: "var(--ink-faint)" }}>{exc.stage}</span>
        )}
        <span className="ml-auto text-[11.5px]" style={{ color: "var(--ink-faint)" }}>{relativeTime(exc.createdAt)}</span>
      </div>
      <p className="text-[13px] leading-snug" style={{ color: "var(--ink)" }}>
        {exc.orderId ? (
          <Link href={`/inbox/${exc.orderId}`} className="hover:underline" style={{ color: "var(--ink)" }}>
            {exc.message}
          </Link>
        ) : (
          exc.message
        )}
      </p>
      {exc.code && (
        <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--ink-faint)" }}>{exc.code}</p>
      )}
      {exc.state === "open" ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          {canResolveFromList(exc) ? (
            <Button
              variant="blue"
              size="sm"
              disabled={busy}
              onClick={onResolve}
            >
              Resolve
            </Button>
          ) : (
            <Button
              variant="blue"
              size="sm"
              disabled={busy || !exc.orderId}
              onClick={onOpen}
            >
              Open order
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onIgnore}
          >
            Ignore
          </Button>
        </div>
      ) : (
        <p className="mt-2 text-[11.5px] capitalize" style={{ color: "var(--ink-faint)" }}>{exc.state}</p>
      )}
    </MobileListRow>
  );
}
