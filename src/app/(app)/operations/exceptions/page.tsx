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
//
// WHICH STATES EXIST, and what each owes the row, is NOT decided here — it lives
// in src/lib/exceptionStateManifest.ts, which src/test/backendMirror.test.ts
// diffs against the real C#. This file used to decide it with
// `exc.state === "open" ? … : …`, written twice (desktop cell and mobile card),
// so a state the frontend had never heard of took the else — the SETTLED branch,
// where `resolved` and `ignored` render — and a live, blocking exception read as
// already handled with all three controls stripped. A state this build cannot
// place now says so and keeps its controls; see ExceptionRowEnd below.

import { useRouter } from "next/navigation";
import { useState, useMemo, Fragment } from "react";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getExceptions, resolveException, ignoreException } from "@/lib/api-client";
import type { OrderException } from "@/types/procurement";
import {
  EXCEPTION_STATE_FACTS,
  exceptionRowPresentation,
  type ExceptionStateName,
} from "@/lib/exceptionStateManifest";
import { PageShell } from "@/components/bridge/layout/PageShell";
import { PageHeader } from "@/components/bridge/layout/PageHeader";
import { StatusNotice, type NoticeTone } from "@/components/bridge/layout/StatusNotice";
import { serverReason } from "@/lib/serverText";
import { MobileListRow } from "@/components/bridge/layout/MobileListRow";
import { Button } from "@/components/bridge/DSPrimitives";
import { ExceptionDetail } from "@/components/bridge/ExceptionDetail";
import { TV2, tv2HeaderCell } from "@/components/bridge/layout/listTableV2";
import { RefreshCw, AlertTriangle, CheckCircle2, ArrowLeft, ArrowRight } from "lucide-react";

// ─── Severity presentation ───────────────────────────────────────────────────
// Critical/error read in the alert-red family; warning amber; info blue-grey.
// SeverityBadge is NON-order severity (info/warning/error/critical) — NOT
// replaced with UnifiedStatusBadge. Colors tokenized to CSS vars.
// Note: critical.fg #8E1F1F and critical.bg #F4D5D5 have no exact token
// match (darker than --danger/#C53A3A / --danger-soft/#FBE3E3); kept as-is.
const SEVERITY_STYLE: Record<string, { bg: string; fg: string; label: string }> = {
  info:     { bg: "var(--brand-blue-soft)", fg: "var(--brand-blue-deep)", label: "Info" },
  warning:  { bg: "var(--amber-soft)",      fg: "var(--amber-text)",           label: "Warning" },
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
// Derived from the manifest, not hand-listed. `state` is the raw value because it goes
// straight into `GET /api/exceptions?state=`; `label` is what the operator reads. This
// used to be a fourth hand-typed copy of the same three strings.
const STATE_TABS: Array<{ label: string; state?: ExceptionStateName }> = [
  { label: "All" },
  ...EXCEPTION_STATE_FACTS.map((f) => ({ label: f.label, state: f.state })),
];

/**
 * What the empty state may say, given WHICH tab is empty.
 *
 * The page runs one query PER TAB — `getExceptions(activeState)`, keyed on `activeState`
 * — so `exceptions.length === 0` means "this filter returned nothing", never "this
 * account has no issues". The empty state read the second sentence off the first:
 * selecting Ignored on an account that has ignored nothing printed "No issues — all
 * clear. Nothing is blocked right now." while the Open tab, one click away, held live
 * blockers. The favourable account-wide verdict was being produced by an absent result
 * in a narrow filter.
 *
 * Only the All tab loads every state, so only the All tab is entitled to speak for the
 * account. Every other tab states its own scope and points at All rather than answering
 * for it.
 */
function emptyStateCopy(tab: { label: string; state?: ExceptionStateName }): {
  headline: string;
  body: string;
  allClear: boolean;
} {
  if (tab.state === undefined) {
    return {
      allClear: true,
      headline: "No issues — all clear",
      body:
        "Nothing is blocked right now. Issues appear here when an order needs a " +
        "decision before it can be sent to a supplier.",
    };
  }
  return {
    allClear: false,
    headline: `No ${tab.label.toLowerCase()} issues`,
    body:
      `Nothing matches the ${tab.label} filter. Other filters may still have issues — ` +
      "switch to All to see every issue on your orders.",
  };
}

// The order-detail route in this app (see src/app/(app)/inbox/[orderId]).
function orderHref(orderId: string): string {
  return `/inbox/${orderId}`;
}

// GET /api/exceptions returns the whole list (no server paging), so we paginate
// the already-loaded array client-side to keep the rendered table bounded.
const PAGE_SIZE = 25;

// Why "Open order" is disabled when an exception has no owning order. Shown as a
// tooltip on the disabled button so the dead control explains itself.
const NO_ORDER_TITLE =
  "This issue isn't tied to an order, so there's no order to open.";

// Whether a manual "Resolve" actually clears this exception. Every status-derived
// code is re-opened by the backend Reconcile pass until the order's cause is
// fixed, so an exception that belongs to an order is NOT list-clearable — the
// honest action is "Open order". A real "Resolve" is reserved for exceptions
// with no owning order (none today, but kept defensive).
function canResolveFromList(exc: OrderException): boolean {
  return !exc.orderId;
}

const RESOLVE_TITLE =
  "Mark this issue resolved. Only available when it isn't tied to an order — order-linked " +
  "issues clear automatically once you fix the cause.";

const OPEN_ORDER_TITLE =
  "Open the order to fix the cause. This exception clears itself on the next pipeline pass " +
  "once the cause is gone.";

/**
 * The right-hand end of a row: the controls, or the state word, or the honest notice.
 *
 * ONE function decides this for the desktop table cell AND the mobile card, because the
 * two used to carry the same `exc.state === "open" ? … : …` twice and would otherwise have
 * to be fixed twice. What each shape is, and why, lives in
 * src/lib/exceptionStateManifest.ts — the short version is that a state this build cannot
 * place keeps its controls and says so, instead of taking the settled branch and
 * disappearing from the operator's work list.
 */
function ExceptionRowEnd({
  exc, busy, layout, onResolve, onIgnore, onOpen,
}: {
  exc: OrderException;
  busy: boolean;
  layout: "desktop" | "mobile";
  onResolve: () => void;
  onIgnore: () => void;
  onOpen: () => void;
}) {
  const presentation = exceptionRowPresentation(exc.state);

  // Settled — a faint state word and no controls. Unchanged from what shipped.
  if (presentation.kind === "settled") {
    return layout === "desktop" ? (
      <span className="text-[11.5px] capitalize" style={{ color: "var(--ink-faint)" }}>
        {presentation.stateWord}
      </span>
    ) : (
      <p className="mt-2 text-[11.5px] capitalize" style={{ color: "var(--ink-faint)" }}>
        {presentation.stateWord}
      </p>
    );
  }

  const actions = (
    <div className="inline-flex items-center gap-1.5">
      {canResolveFromList(exc) ? (
        <Button variant="blue" size="sm" disabled={busy} onClick={onResolve} title={RESOLVE_TITLE}>
          Resolve
        </Button>
      ) : (
        // A disabled <button> swallows hover events, so a bare title= wouldn't surface.
        // Wrap in a span that carries the why-tooltip when there's no order to open.
        <span title={exc.orderId ? undefined : NO_ORDER_TITLE} style={{ display: "inline-flex" }}>
          <Button
            variant="blue"
            size="sm"
            disabled={busy || !exc.orderId}
            onClick={onOpen}
            title={exc.orderId ? OPEN_ORDER_TITLE : undefined}
          >
            Open order
          </Button>
        </span>
      )}
      <Button variant="secondary" size="sm" disabled={busy} onClick={onIgnore}>
        Ignore
      </Button>
    </div>
  );

  // Needs action — the controls alone. Unchanged from what shipped for `open`.
  if (presentation.kind === "needs_action") {
    return layout === "desktop" ? actions : <div className="mt-2.5">{actions}</div>;
  }

  // Unrecognised — say what arrived, admit we can't confirm it's handled, keep the way
  // forward. The notice sits ABOVE the controls and lets the row grow past its 44px:
  // a row we cannot place should look different from one we can.
  return (
    <div
      className={
        layout === "desktop"
          ? "inline-flex flex-col items-end gap-1 py-1.5"
          : "mt-2.5 flex flex-col items-start gap-1"
      }
    >
      <span
        title={presentation.detail}
        className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-semibold"
        style={{
          background: "var(--amber-soft)",
          color: "var(--amber-text)",
          whiteSpace: "normal",
          textAlign: layout === "desktop" ? "right" : "left",
        }}
      >
        <AlertTriangle size={11} aria-hidden style={{ flexShrink: 0 }} />
        {presentation.label}
      </span>
      {actions}
    </div>
  );
}

export default function ExceptionsPage() {
  const router = useRouter();

  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState(0);
  const activeState = STATE_TABS[activeTab].state;
  // 1-based client-side page index (the API returns the whole list at once).
  const [page, setPage] = useState(1);
  // Switching the state filter resets to the first page so the indicator never
  // points past the end of the now-shorter list.
  const selectTab = (i: number) => { setActiveTab(i); setPage(1); setExpandedId(null); };
  // Progressive disclosure: rows are collapsed by default; expanding one reveals
  // the what/why/how-to-fix/status breakdown (lazy-fetches the owning order).
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggleExpanded = (id: string) => setExpandedId((cur) => (cur === id ? null : id));

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

  // ONE notice carrying its own severity, the shape /operations/health settled on.
  // Both mutations below used to be `mutationFn` + `onSuccess` and nothing else,
  // so a 4xx/5xx from PATCH /api/exceptions/{id}/resolve threw, TanStack caught
  // it, `pendingId` cleared, the button re-enabled — and the row was unchanged
  // with not one word said. The operator's only signal that Resolve had failed
  // was that nothing happened, which is indistinguishable from not having
  // clicked. `StatusNotice` derives its ARIA from the tone, so a failure here
  // cannot be announced politely or painted in the success colour.
  const [notice, setNotice] = useState<{ tone: NoticeTone; text: string } | null>(null);

  const resolveMut = useMutation({
    mutationFn: (id: string) => resolveException(id),
    onSuccess: () => {
      setNotice({ tone: "success", text: "Issue marked resolved." });
      qc.invalidateQueries({ queryKey: ["exceptions"] });
    },
    // The server's own sentence is rendered VERBATIM where it has one — it is the
    // only text that knows why THIS request was refused, and paraphrasing it
    // would swap a specific reason for a generic one. Only the fallback, for an
    // error carrying no message at all, is ours to write. It says what did not
    // happen and that the issue is untouched, because the failure mode being
    // fixed is an operator believing a row was dealt with when it was not.
    onError: (err: Error) =>
      setNotice({
        tone: "error",
        text: serverReason(
          err.message,
          "We couldn't mark that issue resolved. It is unchanged — you can try again.",
        ),
      }),
  });
  const ignoreMut = useMutation({
    mutationFn: (id: string) => ignoreException(id),
    onSuccess: () => {
      setNotice({ tone: "success", text: "Issue ignored. It won't be reopened." });
      qc.invalidateQueries({ queryKey: ["exceptions"] });
    },
    onError: (err: Error) =>
      setNotice({
        tone: "error",
        text: serverReason(
          err.message,
          "We couldn't ignore that issue. It is unchanged — you can try again.",
        ),
      }),
  });
  const pendingId =
    (resolveMut.isPending ? resolveMut.variables : undefined) ??
    (ignoreMut.isPending ? ignoreMut.variables : undefined);

  const exceptions = useMemo<OrderException[]>(() => data ?? [], [data]);

  // Client-side pagination over the full list. currentPage is clamped so a
  // shrinking list (e.g. after resolving/ignoring rows) can't strand the view
  // on an empty page.
  const totalCount = exceptions.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pagedExceptions = useMemo(
    () => exceptions.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [exceptions, currentPage],
  );

  // A disabled query reports undefined `data` with isLoading=true; treat the
  // not-yet-ready state as loading, never as an error (known repo gotcha).
  const showLoading = !queryEnabled || (isLoading && data === undefined);

  // Scoped to the tab that came back empty — see emptyStateCopy.
  const emptyCopy = emptyStateCopy(STATE_TABS[activeTab]);

  return (
    <PageShell variant="wide">
      {/* Page header — titleHidden: the topbar hub tab "Issues" is the page
          name (sr-only h1 kept); the explainer + live "N shown" line stays. */}
      <PageHeader
        titleHidden
        title="Issues"
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
            <RefreshCw size={13} aria-hidden className={isFetching ? "animate-spin" : undefined} />
            {isFetching ? "Syncing…" : "Sync"}
          </Button>
        }
      />

      {/* Instructional note */}
      <p className="text-[12px] mb-4 -mt-3" style={{ color: "var(--ink-faint)" }}>
        Expand a row to see what&apos;s wrong, why, how to fix it, and its real delivery status. Fixing the cause clears the issue the next time the order is reprocessed.
      </p>

      {/* Outcome of the last Resolve / Ignore. Sits above the tabs and the list so
          it is in the reading path from the control that produced it, and stays
          put when the list re-renders underneath. */}
      {notice && (
        <div className="mb-4">
          <StatusNotice tone={notice.tone}>{notice.text}</StatusNotice>
        </div>
      )}

      {/* State filter tabs */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        {STATE_TABS.map(({ label }, i) => {
          const active = i === activeTab;
          return (
            <button
              key={label}
              onClick={() => selectTab(i)}
              /* Tap floor: 44px on a phone, the dense 28px from sm: up — the same
                 mobile-first shape DSPrimitives.BUTTON_SIZE uses, so the desktop
                 appearance is unchanged. These were a flat `height: 28` and were
                 relying entirely on the global `min-height: var(--tap-min)`
                 safety net in globals.css. That net does hold, but it is invisible
                 at the call site and applies only under `(pointer: coarse),
                 (max-width: 639px)`, so the control's own size was 28px at every
                 width it declared for itself. Declaring it here means the strip is
                 correct on its own terms rather than by rescue. */
              className="flex items-center justify-center rounded-[6px] px-3 text-[12px] font-medium transition-colors flex-shrink-0 h-[44px] sm:h-[28px]"
              style={{
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
              <AlertTriangle size={22} style={{ color: "var(--danger)" }} aria-hidden />
            </div>
            <div style={{ fontWeight: 600, fontSize: "16px", color: "var(--ink)" }}>
              Couldn&apos;t load issues
            </div>
            <div style={{ fontSize: "13px", maxWidth: 380, margin: "6px auto 14px", color: "var(--ink-muted)" }}>
              The issues service didn&apos;t respond. Your orders are safe — this is usually transient.
            </div>
            <Button variant="secondary" size="sm" onClick={() => refetch()}>
              <RefreshCw size={13} aria-hidden />
              Retry
            </Button>
          </div>
        )}

        {/* Empty state — scoped to the ACTIVE TAB, because that is all this query loaded.
            The green tick is the all-clear signal and rides with the all-clear sentence:
            a scoped tab gets the neutral one, so the colour cannot say what the words
            no longer do. */}
        {!showLoading && !isError && exceptions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center gap-2">
            <CheckCircle2
              size={32}
              style={{ color: emptyCopy.allClear ? "var(--brand-green)" : "var(--ink-faint)" }}
              aria-hidden
            />
            <p
              className="text-[20px] font-semibold"
              style={{ color: "var(--ink)", fontFamily: "'Bricolage Grotesque', Inter, sans-serif" }}
            >
              {emptyCopy.headline}
            </p>
            <p className="text-[13px]" style={{ color: "var(--ink-muted)", maxWidth: 380 }}>
              {emptyCopy.body}
            </p>
          </div>
        )}

        {/* List — mobile cards */}
        {!showLoading && !isError && exceptions.length > 0 && (
          <>
            <div className="flex flex-col gap-2 p-3 md:hidden">
              {pagedExceptions.map((exc) => (
                <ExceptionCard
                  key={exc.id}
                  exc={exc}
                  busy={pendingId === exc.id}
                  expanded={expandedId === exc.id}
                  onToggle={() => toggleExpanded(exc.id)}
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
                  <col style={{ width: 40 }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 110 }} />
                  <col style={{ width: 180 }} />
                  <col style={{ width: "auto" }} />
                  <col style={{ width: 96 }} />
                  <col style={{ width: 176 }} />
                </colgroup>
                <thead style={{ position: "sticky", top: 0, zIndex: 4 }}>
                  <tr>
                    {["", "Severity", "Stage", "Code", "Message", "Raised", ""].map((h, i) => (
                      <th
                        key={i}
                        style={{
                          // Unified listTableV2 tinted header band; first cell gets
                          // the 16px chevron gutter, last cell right-aligns the action.
                          ...tv2HeaderCell(i === 6 ? "right" : "left", i === 0),
                          paddingLeft: i === 0 ? 16 : 12,
                          paddingRight: i === 6 ? 16 : 12,
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedExceptions.map((exc) => {
                    const busy = pendingId === exc.id;
                    const expanded = expandedId === exc.id;
                    return (
                      <Fragment key={exc.id}>
                      {/* Collapsed row is a TRUE 44px single line: the tr's fixed
                          height governs; cells carry zero vertical padding so the
                          27px action buttons can't stretch the row. Expansion
                          behaviour below is unchanged. */}
                      <tr style={{ borderBottom: expanded ? "none" : `1px solid ${TV2.borderFaint}`, background: expanded ? "#FAFBFC" : "var(--surface)", height: 44 }}>
                        <td style={{ padding: "0 10px", paddingLeft: 16, verticalAlign: "middle" }}>
                          <button
                            type="button"
                            onClick={() => toggleExpanded(exc.id)}
                            aria-expanded={expanded}
                            aria-label={expanded ? "Collapse details" : "Expand details"}
                            className="inline-flex items-center justify-center rounded-[6px] transition-colors"
                            style={{ width: 24, height: 24, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--ink-muted)", cursor: "pointer" }}
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 120ms" }}><path d="m9 18 6-6-6-6" /></svg>
                          </button>
                        </td>
                        <td style={{ padding: "0 10px", verticalAlign: "middle" }}>
                          <SeverityBadge severity={String(exc.severity)} />
                        </td>
                        <td style={{ padding: "0 10px", verticalAlign: "middle", color: "var(--ink-muted)" }}>
                          {exc.stage ?? "—"}
                        </td>
                        <td style={{ padding: "0 10px", verticalAlign: "middle" }}>
                          <span className="font-mono text-[11.5px]" style={{ color: "var(--ink)" }}>
                            {exc.code ?? "—"}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: "0 10px", verticalAlign: "middle", color: "var(--ink)",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => toggleExpanded(exc.id)}
                            className="hover:underline"
                            style={{ background: "none", border: 0, padding: 0, color: "var(--ink)", cursor: "pointer", font: "inherit", textAlign: "left", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}
                          >
                            {exc.message}
                          </button>
                        </td>
                        <td style={{ padding: "0 10px", verticalAlign: "middle", color: "var(--ink-muted)", whiteSpace: "nowrap" }}>
                          {relativeTime(exc.createdAt)}
                        </td>
                        <td style={{ padding: "0 10px", paddingRight: 16, verticalAlign: "middle", textAlign: "right", whiteSpace: "nowrap" }}>
                          <ExceptionRowEnd
                            exc={exc}
                            busy={busy}
                            layout="desktop"
                            onResolve={() => resolveMut.mutate(exc.id)}
                            onIgnore={() => ignoreMut.mutate(exc.id)}
                            onOpen={() => { if (exc.orderId) router.push(orderHref(exc.orderId)); }}
                          />
                        </td>
                      </tr>
                      {expanded && (
                        <tr style={{ borderBottom: `1px solid ${TV2.borderFaint}`, background: "#FAFBFC" }}>
                          <td colSpan={7} style={{ padding: 0 }}>
                            <ExceptionDetail exc={exc} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {/* Footer: total + client-side pagination controls (the API returns the
          whole list at once, so paging is over the loaded array). */}
      {!showLoading && !isError && totalCount > 0 && (
        <div className="flex-shrink-0 flex flex-wrap items-center gap-3 pt-0.5">
          <span className="text-[11px]" style={{ color: "var(--ink-faint)" }}>
            {/* "issue", not "exception": the page is called Issues in the hub tab,
                the sr-only h1, the empty state and the error state. This footer was
                the one place still using the engine's word for the same thing. */}
            {totalCount.toLocaleString()} issue{totalCount !== 1 ? "s" : ""}
          </span>
          {totalPages > 1 && (
            /* Same tap floor as the state tabs above: 44px on a phone, dense 28px
               from sm: up. Both were flat `height: 28`. */
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage(Math.max(1, currentPage - 1))}
                disabled={currentPage <= 1}
                className="inline-flex items-center justify-center gap-1 rounded-[6px] px-2.5 text-[12px] font-medium h-[44px] sm:h-[28px]"
                style={{ border: "1px solid var(--border)", background: "var(--surface)", color: currentPage <= 1 ? "var(--ink-faint)" : "var(--ink)", cursor: currentPage <= 1 ? "default" : "pointer" }}
              >
                <ArrowLeft size={13} aria-hidden />
                Prev
              </button>
              <span className="text-[11px] font-mono" style={{ color: "var(--ink-muted)", minWidth: 92, textAlign: "center" }}>
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(currentPage + 1)}
                disabled={currentPage >= totalPages}
                className="inline-flex items-center justify-center gap-1 rounded-[6px] px-2.5 text-[12px] font-medium h-[44px] sm:h-[28px]"
                style={{ border: "1px solid var(--border)", background: "var(--surface)", color: currentPage >= totalPages ? "var(--ink-faint)" : "var(--ink)", cursor: currentPage >= totalPages ? "default" : "pointer" }}
              >
                Next
                <ArrowRight size={13} aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}
    </PageShell>
  );
}

// ─── Mobile card ─────────────────────────────────────────────────────────────
function ExceptionCard({
  exc, busy, expanded, onToggle, onResolve, onIgnore, onOpen,
}: {
  exc: OrderException;
  busy: boolean;
  expanded: boolean;
  onToggle: () => void;
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
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 text-left"
        style={{ background: "none", border: 0, padding: 0, cursor: "pointer" }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ color: "var(--ink-faint)", marginTop: 2, flexShrink: 0, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 120ms" }}><path d="m9 18 6-6-6-6" /></svg>
        <span className="text-[13px] leading-snug" style={{ color: "var(--ink)" }}>{exc.message}</span>
      </button>
      {exc.code && (
        // The human sentence above is primary. Keep the raw rule code for
        // support/debugging, but label it and de-emphasize it (lowercased,
        // 10.5px, faint) so it reads as a reference — not debug output on the
        // card face. The unmodified code stays in the expanded ExceptionDetail.
        <p className="mt-1 text-[10.5px]" style={{ color: "var(--ink-faint)" }}>
          <span>Reference: </span>
          <span className="font-mono lowercase" data-exception-code={exc.code}>{exc.code}</span>
        </p>
      )}
      {expanded && (
        <div className="mt-2 -mx-3.5 -mb-3.5 overflow-hidden rounded-b-[var(--radius-md)]">
          <ExceptionDetail exc={exc} />
        </div>
      )}
      <ExceptionRowEnd
        exc={exc}
        busy={busy}
        layout="mobile"
        onResolve={onResolve}
        onIgnore={onIgnore}
        onOpen={onOpen}
      />
    </MobileListRow>
  );
}
