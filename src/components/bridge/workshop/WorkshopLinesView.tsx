"use client";

// WorkshopLinesView — the "Lines" view of the workshop's middle column ("What
// we'll send"). One row per order line with the values that will actually go
// out, a per-line status chip, and an inline expand showing that line's
// source→output mapping. The Fields view (the existing mapper) is untouched —
// this is a sibling view behind the Fields|Lines segmented toggle rendered in
// the same column header (WorkshopLinesToggle).
//
// Resolution REUSES the workshop's existing server-truth actions (no new
// endpoints, no local resolution state):
//   • AI-suggestion accept  → onAcceptSuggestion  = useResolveActions.acceptSuggestion
//     (commitMappings → invalidate ["order", orderId] → refetch);
//   • catalog pick          → onCommitCode        = useResolveActions.confirmFlaggedLine
//     with the picked code — the SAME commitMappings path;
//   • bulk apply            → onBulkApply         = the EXISTING bulk accept
//     (POST /accept-ai-suggestions at minConfidence 0 — exactly the blocked
//     lines that carry a suggestion), behind the shared useConfirm dialog.
// The catalog picker searches SERVER-side through useCatalogCodeSearch; its
// empty-query entry is the SAME ["supplier-catalog-codes", supplierId] cache
// entry the review screen's CatalogHintCard probes, so opening the picker costs
// zero extra requests when that probe already ran.
//
// All numbers come from workshopLinesModel (pure, unit-tested) so the table,
// the footer reconcile chip, and the toggle badge can never disagree.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useCatalogCodeSearch } from "@/hooks/useCatalogCodeSearch";
import { hasAssignedSupplier, type CatalogPageClaim } from "@/lib/catalogCodes";
import { CatalogCodeResults } from "../catalog/CatalogCodeResults";
import type { SupplierProduct } from "@/lib/api/types";
import { useConfirm } from "@/components/ui/confirm";
import { formatMoney } from "../review/orderDisplay";
import type { Order, OrderLine } from "@/types/procurement";
import {
  blockedLineCount,
  bulkApplyEnabled,
  bulkApplySuggestionCount,
  currencyMark,
  formatAmount,
  lineAmountOf,
  lineChipStatus,
  linesToggleAlert,
  reconcileTotals,
  round2,
  RECONCILE_TOLERANCE,
  type LineChipStatus,
} from "./workshopLinesModel";

// ── Palette (mock-2-lines.html; matches the locked Bridge Layer canon) ────────
const C = {
  ink: "#0B1A2F",
  muted: "#566982",
  faint: "#8A93A6",
  border: "#E5E8EE",
  rowLine: "#F3F5F8",
  headBg: "#FAFBFC",
  blue: "#1E66C9",
  green: "#1E6D29",
  greenSoft: "#E3F2E4",
  red: "#B3362A",
  redSoft: "#FBE9E7",
  redRowBg: "#FDF6F5",
  amber: "#8A5310",
  amberSoft: "#FFF4DC",
  expandBg: "#F4F7FB",
  arrow: "#CBD0DA",
  mono: "'JetBrains Mono', ui-monospace, monospace",
};

const chipBase = {
  fontSize: 11,
  fontWeight: 700,
  padding: "3px 10px",
  borderRadius: 999,
  whiteSpace: "nowrap",
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
} as const;

// ── The Fields | Lines segmented toggle (rendered in the "What we'll send" header) ──
export function WorkshopLinesToggle({
  view,
  onView,
  lineCount,
  lines,
}: {
  view: "fields" | "lines";
  onView: (v: "fields" | "lines") => void;
  lineCount: number;
  lines: ReadonlyArray<Pick<OrderLine, "needsReview">>;
}) {
  const alert = linesToggleAlert(lines);
  const seg = (id: "fields" | "lines", label: ReactNode) => {
    const on = view === id;
    return (
      <button
        type="button"
        onClick={() => onView(id)}
        aria-pressed={on}
        style={{
          padding: "0 12px",
          height: "100%",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 11.5,
          fontWeight: 700,
          border: "none",
          cursor: "pointer",
          background: on ? C.ink : "transparent",
          color: on ? "#FFFFFF" : "#5E6779",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <span
      role="group"
      aria-label="Show the output as fields or as order lines"
      data-testid="lines-toggle"
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        overflow: "hidden",
        height: 28,
        flexShrink: 0,
        background: "#FFFFFF",
      }}
    >
      {seg("fields", "Fields")}
      <span aria-hidden style={{ width: 1, background: C.border }} />
      {seg(
        "lines",
        <>
          Lines · {lineCount}
          {alert && (
            <span
              data-testid="lines-toggle-alert"
              title="Some lines still need review"
              style={{ width: 6, height: 6, borderRadius: "50%", background: C.red, flexShrink: 0 }}
            />
          )}
        </>,
      )}
    </span>
  );
}

export interface WorkshopLinesViewProps {
  order: Order;
  /** Accept a line's AI suggestion — useResolveActions.acceptSuggestion (server commit → refetch). */
  onAcceptSuggestion: (lineId: string) => void;
  /**
   * Commit an arbitrary supplier code for a line (the catalog-pick path) —
   * useResolveActions.confirmFlaggedLine, the SAME commitMappings server path.
   */
  onCommitCode: (line: Pick<OrderLine, "id" | "lineNumber" | "supplierItemCode">) => void;
  /** The line id whose commit is in flight (drives Saving… / disable). */
  acceptingLineId: string | null;
  /** The EXISTING bulk accept (POST /accept-ai-suggestions at minConfidence 0). */
  onBulkApply?: () => void;
  bulkAccepting?: boolean;
  /** Bumped by an IssuesPanel line jump — expands + scrolls to that row. */
  jumpSignal?: { lineId: string; n: number } | null;
  /**
   * Called once the jump's scroll has actually run, so the host can clear the
   * signal — an uncleared signal replays the last jump every time this view is
   * remounted (leave Lines, re-enter Lines → scroll+flash to a stale row).
   */
  onJumpConsumed?: () => void;
}

export function WorkshopLinesView({
  order,
  onAcceptSuggestion,
  onCommitCode,
  acceptingLineId,
  onBulkApply,
  bulkAccepting,
  jumpSignal,
  onJumpConsumed,
}: WorkshopLinesViewProps) {
  const confirm = useConfirm();
  const lines = order.lines;
  const sym = currencyMark(order.currency);
  const hasSupplier = hasAssignedSupplier(order.supplierId);

  // Expanded rows (line ids). Only non-ready rows are expandable.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Which line's catalog picker is open + its search text.
  const [catalogFor, setCatalogFor] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");

  // Row elements for the jump-to-line scroll.
  const rowEls = useRef<Record<string, HTMLTableRowElement | null>>({});

  // An IssuesPanel line jump: expand the row, then scroll + flash it once it's rendered.
  useEffect(() => {
    if (!jumpSignal) return;
    const { lineId } = jumpSignal;
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(lineId);
      return next;
    });
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const el = rowEls.current[lineId];
        // prefers-reduced-motion → instant jump, no flash animation.
        const reduceMotion =
          typeof window !== "undefined" &&
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el?.scrollIntoView?.({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
        if (!reduceMotion) {
          el?.animate?.(
            [{ background: "#FFF6E0" }, { background: "transparent" }],
            { duration: 1100, easing: "ease-out" },
          );
        }
        // Consume the signal only AFTER the scroll ran — consuming synchronously
        // in the effect body would re-render with a null signal and cancel the
        // pending frame above before it ever scrolled.
        onJumpConsumed?.();
      }),
    );
    return () => cancelAnimationFrame(raf);
  }, [jumpSignal, onJumpConsumed]);

  // The catalog lookup — SERVER-side search (a real distributor catalog is 100k+
  // rows, so a client-side filter over one fetched page could only ever search
  // the part it loaded). Its empty-query entry is the SAME cache entry
  // CatalogHintCard probes. Never fired for an unrouted order (no supplier → no
  // catalog to ask about).
  const catalog = useCatalogCodeSearch({
    supplierId: order.supplierId,
    query: catalogQuery,
    enabled: catalogFor != null && hasSupplier,
  });

  // Footer derivations (pure model).
  const { sum, verdict } = useMemo(
    () => reconcileTotals(lines, order.grandTotal),
    [lines, order.grandTotal],
  );
  const blocked = blockedLineCount(lines);
  const bulkCount = bulkApplySuggestionCount(lines);
  const bulkOn = bulkApplyEnabled(lines) && !!onBulkApply;

  const onBulkClick = async () => {
    if (!bulkOn || bulkAccepting) return;
    const ok = await confirm({
      title: "Apply AI suggestions to all blocked lines?",
      description: `${bulkCount} blocked ${bulkCount === 1 ? "line has" : "lines have"} an AI-suggested supplier code. Each suggestion will be saved as that line's supplier code — you can still change any line afterwards.`,
      confirmLabel: `Apply ${bulkCount} suggestion${bulkCount === 1 ? "" : "s"}`,
    });
    if (ok) onBulkApply!();
  };

  return (
    <div data-testid="lines-view" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: "#FFFFFF" }}>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <Th style={{ width: 34 }}>#</Th>
              <Th>Your item code</Th>
              <Th>Supplier code</Th>
              <Th>Description</Th>
              <Th style={{ width: 46 }}>Qty</Th>
              <Th style={{ width: 82 }}>{`Unit ${sym}`.trim()}</Th>
              <Th style={{ width: 86 }}>{`Line ${sym}`.trim()}</Th>
              <Th style={{ width: 120 }}>Status</Th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const status = lineChipStatus(line);
              const expandable = status !== "ready";
              // `open` is DERIVED (expandable && in the expanded set), never stored:
              // when a line resolves, `expandable` flips false and its panel closes
              // in the same render — an expanded-set entry alone would leave the
              // panel stuck open with no collapse affordance. Deriving at render
              // also cannot leak across order switches (stale line ids of a
              // previous order simply never match).
              const open = expandable && expanded.has(line.id);
              const busy = acceptingLineId === line.id;
              return (
                <LineRow
                  key={line.id}
                  line={line}
                  status={status}
                  open={open}
                  expandable={expandable}
                  busy={busy}
                  catalogAvailable={hasSupplier}
                  rowRef={(el) => { rowEls.current[line.id] = el; }}
                  onToggle={() => expandable && toggle(line.id)}
                  onAccept={() => onAcceptSuggestion(line.id)}
                  catalogOpen={catalogFor === line.id}
                  onToggleCatalog={() => {
                    setCatalogQuery("");
                    setCatalogFor((cur) => (cur === line.id ? null : line.id));
                  }}
                  catalogPanel={
                    catalogFor === line.id ? (
                      <CatalogPickPanel
                        fetching={catalog.isFetching}
                        errored={catalog.isError}
                        onRetry={catalog.refetch}
                        claim={catalog.claim}
                        matches={catalog.items}
                        settledQuery={catalog.settledQuery}
                        query={catalogQuery}
                        onQuery={setCatalogQuery}
                        busy={busy}
                        onPick={(code) => {
                          onCommitCode({ id: line.id, lineNumber: line.lineNumber, supplierItemCode: code });
                          setCatalogFor(null);
                          setCatalogQuery("");
                        }}
                      />
                    ) : null
                  }
                />
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Footer: Σ reconcile + blocked count + bulk apply ─────────────────── */}
      <div
        data-testid="lines-footer"
        style={{
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 14px",
          borderTop: `1px solid ${C.rowLine}`,
          fontSize: 11.5,
          color: C.muted,
          flexWrap: "wrap",
        }}
      >
        {/* Footer amounts render through the header's own formatMoney ("EUR 1,469.00")
            so the two can never disagree on the same screen. Rendering only — the
            match/mismatch verdict compared raw decimals in reconcileTotals. */}
        {verdict === "match" && (
          <span style={{ ...chipBase, background: C.greenSoft, color: C.green }}>
            Σ lines {formatMoney(order.currency, sum)} = order total ✔
          </span>
        )}
        {verdict === "mismatch" && (
          <span style={{ ...chipBase, background: C.amberSoft, color: C.amber }}>
            Σ lines {formatMoney(order.currency, sum)} · order total {formatMoney(order.currency, order.grandTotal!)}
          </span>
        )}
        {/* No stated total → the Σ alone, no equality claim (never fake a total). */}
        {verdict === "no-total" && (
          <span style={{ ...chipBase, background: "#F1F3F7", color: C.muted }}>
            Σ lines {formatMoney(order.currency, sum)}
          </span>
        )}
        {blocked > 0 && (
          <span style={{ ...chipBase, background: C.redSoft, color: C.red }}>
            {blocked} {blocked === 1 ? "line" : "lines"} blocked
          </span>
        )}
        {blocked > 0 && (
          <button
            type="button"
            onClick={onBulkClick}
            disabled={!bulkOn || bulkAccepting}
            title={
              bulkOn
                ? "Save each blocked line's AI-suggested supplier code"
                : "None of the blocked lines has an AI suggestion to apply"
            }
            style={{
              marginLeft: "auto",
              border: `1px solid ${C.border}`,
              background: "#FFFFFF",
              color: !bulkOn || bulkAccepting ? "#AEB6C4" : "#5E6779",
              borderRadius: 7,
              fontSize: 11.5,
              fontWeight: 600,
              padding: "5px 11px",
              display: "inline-flex",
              gap: 6,
              alignItems: "center",
              cursor: !bulkOn || bulkAccepting ? "not-allowed" : "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {bulkAccepting ? "Applying…" : "Apply AI suggestions to all blocked lines"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── One line row (+ its expanded mapping panel) ───────────────────────────────
function LineRow({
  line,
  status,
  open,
  expandable,
  busy,
  catalogAvailable,
  rowRef,
  onToggle,
  onAccept,
  catalogOpen,
  onToggleCatalog,
  catalogPanel,
}: {
  line: OrderLine;
  status: LineChipStatus;
  open: boolean;
  expandable: boolean;
  busy: boolean;
  /** False for an unrouted order — no supplier means no catalog to pick from. */
  catalogAvailable: boolean;
  rowRef: (el: HTMLTableRowElement | null) => void;
  onToggle: () => void;
  onAccept: () => void;
  catalogOpen: boolean;
  onToggleCatalog: () => void;
  catalogPanel: ReactNode;
}) {
  const missingCode = !line.supplierItemCode;
  const blockedRow = status === "supplier-code";
  const amount = lineAmountOf(line);
  const computed = round2(Number(line.quantity) * Number(line.unitPrice));
  const statedMatches =
    line.lineAmount != null && Math.abs(line.lineAmount - computed) <= RECONCILE_TOLERANCE + 1e-9;
  const suggestion = line.aiSuggestion ?? null;
  const suggestionPct =
    suggestion && suggestion.confidence > 0 && suggestion.confidence <= 1
      ? Math.round(suggestion.confidence * 100)
      : null;
  const description = line.description || line.buyerItemCode;

  const td = (extra?: React.CSSProperties): React.CSSProperties => ({
    padding: "9px 12px",
    borderBottom: `1px solid ${C.rowLine}`,
    verticalAlign: "middle",
    ...extra,
  });

  return (
    <>
      <tr
        ref={rowRef}
        data-testid={`line-row-${line.lineNumber}`}
        data-line-row={line.id}
        onClick={onToggle}
        style={{
          background: blockedRow ? C.redRowBg : undefined,
          cursor: expandable ? "pointer" : "default",
        }}
      >
        <td style={td({
          color: C.faint,
          fontFamily: C.mono,
          fontSize: 11,
          borderLeft: blockedRow ? `3px solid ${C.red}` : "3px solid transparent",
        })}
        >
          {line.lineNumber}
        </td>
        <td style={td({ fontFamily: C.mono, fontSize: 11.5, color: C.ink })}>{line.buyerItemCode}</td>
        <td style={td({ fontFamily: C.mono, fontSize: 11.5, color: missingCode ? C.red : C.ink })}>
          {missingCode ? "— missing" : line.supplierItemCode}
        </td>
        <td
          title={description ?? undefined}
          style={td({
            color: C.ink,
            maxWidth: 220,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          })}
        >
          {description}
        </td>
        <td style={td({ fontFamily: C.mono, fontSize: 11.5, color: C.ink })}>{line.quantity}</td>
        <td style={td({ fontFamily: C.mono, fontSize: 11.5, color: C.ink })}>{formatAmount(line.unitPrice)}</td>
        <td style={td({ fontFamily: C.mono, fontSize: 11.5, color: C.ink })}>{formatAmount(amount)}</td>
        <td style={td()}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            {status === "ready" && (
              <span style={{ ...chipBase, background: C.greenSoft, color: C.green }}>✔ Ready</span>
            )}
            {status === "supplier-code" && (
              <span style={{ ...chipBase, background: C.redSoft, color: C.red }}>● Supplier code</span>
            )}
            {status === "review" && (
              <span style={{ ...chipBase, background: C.amberSoft, color: C.amber }}>● Review</span>
            )}
            {expandable && (
              <button
                type="button"
                aria-expanded={open}
                aria-label={`Line ${line.lineNumber} details`}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggle();
                }}
                style={{
                  border: "none",
                  background: "none",
                  cursor: "pointer",
                  color: C.faint,
                  fontSize: 11,
                  lineHeight: 1,
                  padding: "2px 3px",
                  display: "inline-flex",
                  transform: open ? "none" : "rotate(-90deg)",
                  transition: "transform 120ms",
                }}
              >
                ▾
              </button>
            )}
          </span>
        </td>
      </tr>

      {open && (
        <tr data-testid={`line-expand-${line.lineNumber}`} style={{ background: C.expandBg }}>
          <td style={{ borderBottom: `1px solid ${C.rowLine}` }} />
          <td colSpan={7} style={{ padding: "10px 14px", borderBottom: `1px solid ${C.rowLine}` }}>
            {/* This line's source→output mapping — the same wires model, scoped to the line. */}
            <MapRow
              src="line.item_code"
              dst={
                <>
                  SupplierItemCode <span style={{ color: C.red }}>*</span>
                </>
              }
            >
              {missingCode ? (
                <ValueChip tone="red">— missing</ValueChip>
              ) : (
                <ValueChip>{line.supplierItemCode}</ValueChip>
              )}
              {line.needsReview && suggestion?.supplierItemCode && (
                <button
                  type="button"
                  onClick={onAccept}
                  disabled={busy}
                  title={suggestion.reason || "Save the AI-suggested supplier code for this line"}
                  aria-label={`Accept AI suggestion ${suggestion.supplierItemCode} for line ${line.lineNumber}`}
                  style={{
                    border: "1px solid #BBD2F0",
                    background: "#FFFFFF",
                    color: C.blue,
                    borderRadius: 7,
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "5px 11px",
                    display: "inline-flex",
                    gap: 6,
                    alignItems: "center",
                    cursor: busy ? "wait" : "pointer",
                    opacity: busy ? 0.6 : 1,
                    whiteSpace: "nowrap",
                  }}
                >
                  {busy
                    ? "Saving…"
                    : `✨ AI suggestion: ${suggestion.supplierItemCode}${suggestionPct != null ? ` (${suggestionPct}%)` : ""}`}
                </button>
              )}
              {line.needsReview && (
                <button
                  type="button"
                  onClick={onToggleCatalog}
                  // An unrouted order has NO supplier — the affordance stays visible
                  // but honestly disabled instead of opening a panel that would talk
                  // about a supplier's catalog that cannot exist yet.
                  disabled={busy || !catalogAvailable}
                  title={catalogAvailable ? undefined : "Assign a supplier first — a catalog belongs to a supplier"}
                  aria-expanded={catalogOpen}
                  style={{
                    border: `1px solid ${C.border}`,
                    background: catalogOpen ? "#F1F3F7" : "#FFFFFF",
                    color: catalogAvailable ? "#5E6779" : "#AEB6C4",
                    borderRadius: 7,
                    fontSize: 11.5,
                    fontWeight: 600,
                    padding: "5px 11px",
                    display: "inline-flex",
                    gap: 6,
                    alignItems: "center",
                    cursor: busy ? "wait" : catalogAvailable ? "pointer" : "not-allowed",
                    whiteSpace: "nowrap",
                  }}
                >
                  Pick from catalog
                </button>
              )}
            </MapRow>
            {catalogPanel}
            <MapRow src="line.description" dst="Description">
              <ValueChip>{description}</ValueChip>
            </MapRow>
            <MapRow src="line.qty × line.unit_price" dst="LineTotal">
              {line.lineAmount == null ? (
                <ValueChip>{formatAmount(computed)}</ValueChip>
              ) : statedMatches ? (
                <ValueChip>{formatAmount(line.lineAmount)} ✔ matches</ValueChip>
              ) : (
                <ValueChip tone="amber">
                  stated {formatAmount(line.lineAmount)} · calculated {formatAmount(computed)}
                </ValueChip>
              )}
            </MapRow>
          </td>
        </tr>
      )}
    </>
  );
}

// ── The inline catalog picker (search the supplier's catalog, pick a code) ────
// Search is server-side; this panel is a pure view over the result. Every claim
// it makes comes from `claim` (catalogPageClaim), never from the item count.
function CatalogPickPanel({
  fetching,
  errored,
  onRetry,
  claim,
  matches,
  settledQuery,
  query,
  onQuery,
  busy,
  onPick,
}: {
  /** A request is in flight — the list below answers an older query, or nothing yet. */
  fetching: boolean;
  /** The catalog query FAILED — the panel must not claim the catalog is empty. */
  errored: boolean;
  onRetry: () => void;
  /** What the current page proves. `unknown` → the panel states nothing. */
  claim: CatalogPageClaim;
  matches: ReadonlyArray<Pick<SupplierProduct, "id" | "code" | "name">>;
  /** The query these matches answer (debounced) — may lag `query` by a keystroke. */
  settledQuery: string;
  query: string;
  onQuery: (v: string) => void;
  busy: boolean;
  onPick: (code: string) => void;
}) {
  return (
    <div
      data-testid="catalog-pick-panel"
      onClick={(e) => e.stopPropagation()}
      style={{
        margin: "4px 0 8px",
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        background: "#FFFFFF",
        padding: 8,
        maxWidth: 420,
      }}
    >
      <input
        type="text"
        autoFocus
        value={query}
        onChange={(e) => onQuery(e.target.value)}
        placeholder="Search the supplier catalog…"
        aria-label="Search the supplier catalog"
        style={{
          width: "100%",
          boxSizing: "border-box",
          padding: "5px 8px",
          borderRadius: 6,
          border: "1px solid #DCE0E8",
          fontSize: 11.5,
          color: C.ink,
        }}
      />
      <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 1, maxHeight: 240, overflowY: "auto" }}>
        <CatalogCodeResults
          items={matches}
          claim={claim}
          settledQuery={settledQuery}
          isFetching={fetching}
          isError={errored}
          onRetry={onRetry}
          busy={busy}
          onPick={onPick}
          listLabel="Catalog products"
          noCatalogNote={
            <span style={{ fontSize: 11, color: C.faint, padding: "4px 2px", lineHeight: 1.5 }}>
              No catalog for this supplier yet — import one on the supplier&rsquo;s Catalog tab, or
              type the code manually from the issue card.
            </span>
          }
        />
      </div>
    </div>
  );
}

// ── Tiny presentational pieces ────────────────────────────────────────────────
function Th({ children, style }: { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        textAlign: "left",
        fontSize: 10.5,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: C.faint,
        fontWeight: 700,
        padding: "8px 12px",
        borderBottom: `1px solid ${C.border}`,
        background: C.headBg,
        position: "sticky",
        top: 0,
        zIndex: 1,
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function MapRow({ src, dst, children }: { src: string; dst: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 11.5, padding: "5px 0", flexWrap: "wrap" }}>
      <span style={{ color: C.blue, fontWeight: 600, minWidth: 170, fontFamily: C.mono, fontSize: 11 }}>{src}</span>
      <span aria-hidden style={{ color: C.arrow }}>→</span>
      <span style={{ color: C.ink, fontWeight: 600, minWidth: 150 }}>{dst}</span>
      {children}
    </div>
  );
}

function ValueChip({ tone, children }: { tone?: "red" | "amber"; children: ReactNode }) {
  const colors =
    tone === "red"
      ? { border: "#F0CFCA", color: C.red }
      : tone === "amber"
        ? { border: "#F1E2BE", color: C.amber }
        : { border: C.border, color: C.muted };
  return (
    <span
      style={{
        fontFamily: C.mono,
        fontSize: 11,
        color: colors.color,
        background: "#FFFFFF",
        border: `1px solid ${colors.border}`,
        borderRadius: 5,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
