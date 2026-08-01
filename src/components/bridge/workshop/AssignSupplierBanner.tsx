"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiHttpError, apiClient } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import type { Order, SupplierSuggestion } from "@/types/procurement";
import { SupplierPicker } from "../SupplierPicker";
import { confidenceTone } from "../ConfidenceChip";

/* =====================================================================
   AssignSupplierBanner — the resolver for an order parked `unrouted`.

   An order ingested on a content-routed channel (SFTP / S3 / IMAP) with no
   resolvable supplier is parsed and parked: its header and lines are persisted,
   but normalisation cannot start because there is no supplier to resolve item
   codes against. POST /orders/{id}/assign-supplier is the only way out — it
   pins the supplier, atomically claims the order `unrouted` → `parsing` and
   re-enqueues the parse, which then resolves the lines the normal way.

   Not a gate. The workshop body still renders underneath: the extracted header
   and lines are real and worth reading before choosing who the order is for,
   and WorkshopLinesView already handles a supplier-less order (the catalog pick
   stays visible but disabled). A full-screen panel would hide the very evidence
   the operator needs to answer the question the panel is asking.

   Amber, not red: nothing failed. This is a backlog item, matching the backend's
   own `unrouted_order` exception severity ("warning") and the inbox pill.
   ===================================================================== */

const T = {
  amber:     "#B36D14",
  // --amber is a DOT/BORDER/STROKE colour. On --amber-soft it is 3.65:1, below the
  // 4.5:1 AA floor for 13px/700 (large text = ≥18.66px bold, which this is not), so
  // amber TEXT uses --amber-text: 5.62:1 on the same background. This is what the
  // .pill-* CSS layer already does; the inline-styled banners were the offenders.
  amberText: "#8A5310",
  amberSoft: "#FAF1DD",
  amberLine: "#EBD7AE",
  navy:      "#0B1A2F",
  ink:       "#0B1A2F",
  inkMuted:  "#5E6779",
  danger:    "#B43838",
  dangerSoft:"#FBE3E3",
  green:     "#1E6D29",
  greenSoft: "#E9F1EA",
  surface:   "#FFFFFF",
};

/** What the operator is told after the POST settles, per outcome. */
type Outcome =
  | { kind: "assigned" }
  | { kind: "stale" }
  | { kind: "error"; message: string };

/**
 * At most three, best first. The backend already ranks and caps, but the cap is a
 * PRODUCT decision (three is what an operator will actually read) so the UI holds it
 * too rather than trusting the page it was handed.
 */
const MAX_SUGGESTIONS = 3;

export function AssignSupplierBanner({ order }: { order: Order }) {
  const queryClient = useQueryClient();
  const queryEnabled = useQueriesEnabled();
  const { labels } = useOrderDirection();
  const [supplierId, setSupplierId] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const suggestions = [...(order.supplierSuggestions ?? [])]
    .sort((a, b) => a.rank - b.rank)
    .slice(0, MAX_SUGGESTIONS);

  const { data: suppliers = [], isLoading: suppliersLoading } = useQuery({
    queryKey: ["suppliers"],
    queryFn: apiClient.getSuppliers,
    staleTime: 5 * 60 * 1000,
    enabled: queryEnabled,
    retry: 1,
  });

  const counterparty = labels.counterpartyNoun.toLowerCase();

  /**
   * `suggestionId` is present only when the supplier came from an accepted candidate.
   * It is what lets the backend record the routing as an ACCEPTED suggestion instead of
   * an unattributable manual pick — the difference between a heuristic that can be
   * measured and one that cannot.
   */
  async function handleAssign(chosenSupplierId: string, suggestionId?: string) {
    if (!chosenSupplierId || assigning) return;
    setAssigning(true);
    setOutcome(null);

    let settled: Outcome;
    try {
      // A manual pick is a genuinely manual decision and posts no suggestionId at all —
      // not `undefined` — so the request body stays exactly what it has always been.
      await (suggestionId
        ? apiClient.assignSupplier(order.id, chosenSupplierId, suggestionId)
        : apiClient.assignSupplier(order.id, chosenSupplierId));
      settled = { kind: "assigned" };
    } catch (err) {
      // 409 = the atomic claim matched no row: the order is no longer `unrouted`,
      // so another operator (or an ingress re-route) already handled it. Telling
      // the operator their click failed would be the opposite of what happened.
      settled = err instanceof ApiHttpError && err.status === 409
        ? { kind: "stale" }
        : { kind: "error", message: messageFor(err, counterparty) };
    }
    setOutcome(settled);
    setAssigning(false);

    // Success and 409 both mean this screen is holding a stale order — one because
    // we just moved it, the other because someone else did — and refetching is what
    // ends the disagreement (the order query's `parsing` poll takes over from there).
    // A rejected supplier (400) left the order exactly as it was, so refetching
    // would only re-render the same banner.
    if (settled.kind !== "error") {
      await queryClient.invalidateQueries({ queryKey: ["order", order.id] });
      await queryClient.invalidateQueries({ queryKey: ["orders"] });
    }
  }

  const noSuppliers = !suppliersLoading && suppliers.length === 0;
  const hasSuggestions = suggestions.length > 0;

  return (
    <div
      role="region"
      aria-label={`This order needs a ${counterparty}`}
      className="flex-shrink-0"
      data-testid="order-needs-supplier"
      style={{
        padding: "12px 16px",
        background: T.amberSoft,
        borderBottom: `1px solid ${T.amberLine}`,
      }}
    >
      <div className={hasSuggestions ? "flex flex-col gap-2.5" : "flex flex-col gap-2.5 lg:flex-row lg:items-center lg:gap-4"}>
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.amber} strokeWidth="2" aria-hidden style={{ flexShrink: 0, marginTop: 1 }}>
            <path d="M12 9v4" strokeLinecap="round" />
            <path d="M12 17h.01" strokeLinecap="round" />
            <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" strokeLinejoin="round" />
          </svg>
          <div className="min-w-0">
            <p className="text-[13px] font-bold" style={{ color: T.amberText, margin: 0 }}>
              This order needs a {counterparty}
            </p>
            <p className="text-[12.5px]" style={{ color: T.inkMuted, margin: "3px 0 0", lineHeight: 1.5 }}>
              {hasSuggestions ? (
                <>
                  We couldn&rsquo;t tell which {counterparty} this order is for. Going by what&rsquo;s on the
                  document, these are the closest matches — nothing has been assigned yet. Pick one and
                  we&rsquo;ll read the document again against their item codes.
                </>
              ) : (
                <>
                  We couldn&rsquo;t tell which {counterparty} this order is for, so it&rsquo;s waiting here.
                  Choose one and we&rsquo;ll read the document again against their item codes.
                </>
              )}
            </p>
          </div>
        </div>

        {hasSuggestions && (
          <SuggestionList
            suggestions={suggestions}
            busy={assigning}
            onAccept={(s) => handleAssign(s.supplierId, s.id)}
          />
        )}

        {hasSuggestions && !noSuppliers && (
          <p className="text-[12px] font-semibold" style={{ color: T.inkMuted, margin: 0 }}>
            None of these? Choose the {counterparty} yourself.
          </p>
        )}

        {noSuppliers ? (
          <Link
            href="/library/suppliers"
            className="text-[12.5px] font-semibold lg:flex-shrink-0"
            style={{ color: T.green }}
          >
            Add a {counterparty} →
          </Link>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center lg:flex-shrink-0">
            <div className="w-full sm:w-[240px]">
              <SupplierPicker
                suppliers={suppliers}
                value={supplierId}
                onChange={setSupplierId}
                counterpartyNoun={counterparty}
                counterpartyPlural={labels.counterpartyPlural}
                triggerId="assign-supplier"
              />
            </div>
            <button
              type="button"
              onClick={() => handleAssign(supplierId)}
              disabled={!supplierId || assigning}
              className="text-[13px] font-semibold"
              style={{
                // 40px, matching BillingHeldPanel's action — the shared picker above
                // is 36px because the upload route bar sizes it, but this button is
                // the one an operator taps on a phone.
                minHeight: 40,
                padding: "9px 16px",
                borderRadius: 7,
                border: "none",
                background: !supplierId || assigning ? "#C9CFDA" : T.navy,
                color: "#FFFFFF",
                cursor: !supplierId || assigning ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {assigning ? "Assigning…" : `Assign ${counterparty}`}
            </button>
          </div>
        )}
      </div>

      {outcome && (
        <div
          role="status"
          aria-live="polite"
          className="mt-2.5 text-[12.5px] font-semibold"
          style={{
            padding: "7px 10px",
            borderRadius: 6,
            background: outcome.kind === "error" ? T.dangerSoft : outcome.kind === "stale" ? T.surface : T.greenSoft,
            color: outcome.kind === "error" ? T.danger : outcome.kind === "stale" ? T.ink : T.green,
          }}
        >
          {outcome.kind === "assigned" &&
            `${labels.counterpartyNoun} assigned — reading the document again…`}
          {outcome.kind === "stale" &&
            `This order has already been routed — someone may have assigned a ${counterparty} while this page was open. Refreshing it now.`}
          {outcome.kind === "error" && outcome.message}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────────
   Ranked candidates.

   Deliberately NOT AI-branded: no violet `ai` token, no "AI" tag, no sparkle.
   These come from a scoring heuristic over identity numbers, sender domains,
   column layouts and catalog overlap — real evidence an operator can check —
   and dressing them as model output would misdescribe what they are AND put
   them under the accept/reject affordance AI suggestions own.

   Score colour reuses the ConfidenceChip ramp (one confidence language across
   the product), but the label says "match", because that is what it measures.
   ───────────────────────────────────────────────────────────────────────── */

/** Slug → short human label. Unknown slugs degrade to a de-slugged form rather than vanishing. */
const SIGNAL_LABELS: Record<string, string> = {
  identity:              "Identity match",
  sender_domain:         "Sender domain",
  sender_domain_history: "Past routing",
  layout_fingerprint:    "Document layout",
  catalog_overlap:       "Catalog match",
  supplier_name:         "Name on document",
};

function signalLabel(slug: string): string {
  return SIGNAL_LABELS[slug] ?? slug.replace(/_/g, " ").replace(/^./, c => c.toUpperCase());
}

function MatchScore({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const tone = confidenceTone(pct);
  return (
    <span
      aria-label={`${pct}% match`}
      style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontFamily: "'JetBrains Mono',monospace", fontWeight: 700,
        fontSize: 10, lineHeight: 1, padding: "3px 6px", borderRadius: 999,
        color: tone.fg, background: tone.bg, border: `1px solid ${tone.bd}`,
        flexShrink: 0, fontVariantNumeric: "tabular-nums",
      }}
    >
      {pct}%
    </span>
  );
}

function SuggestionList({
  suggestions,
  busy,
  onAccept,
}: {
  suggestions: SupplierSuggestion[];
  busy: boolean;
  onAccept: (s: SupplierSuggestion) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Closest matches"
      data-testid="supplier-suggestions"
      className="flex flex-col gap-2"
    >
      {suggestions.map(s => (
        <SuggestionRow key={s.id} suggestion={s} busy={busy} onAccept={() => onAccept(s)} />
      ))}
    </div>
  );
}

function SuggestionRow({
  suggestion,
  busy,
  onAccept,
}: {
  suggestion: SupplierSuggestion;
  busy: boolean;
  onAccept: () => void;
}) {
  const [showSignals, setShowSignals] = useState(false);

  return (
    <div
      data-testid={`supplier-suggestion-${suggestion.id}`}
      style={{
        background: T.surface,
        border: `1px solid ${T.amberLine}`,
        borderRadius: 8,
        padding: "10px 12px",
      }}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-semibold" style={{ color: T.ink }}>
              {suggestion.supplierName}
            </span>
            <MatchScore score={suggestion.score} />
          </div>
          <p className="text-[12.5px]" style={{ color: T.inkMuted, margin: "3px 0 0", lineHeight: 1.5 }}>
            {suggestion.reason}
          </p>
        </div>

        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setShowSignals(v => !v)}
            aria-expanded={showSignals}
            className="text-[12px] font-semibold"
            style={{
              minHeight: 34, padding: "6px 10px", borderRadius: 7,
              border: `1px solid ${T.amberLine}`, background: "transparent",
              color: T.inkMuted, cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            Why this match
          </button>
          <button
            type="button"
            onClick={onAccept}
            disabled={busy}
            aria-label={`Assign ${suggestion.supplierName}`}
            className="text-[12.5px] font-semibold"
            style={{
              minHeight: 34, padding: "7px 14px", borderRadius: 7, border: "none",
              background: busy ? "#C9CFDA" : T.navy, color: "#FFFFFF",
              cursor: busy ? "not-allowed" : "pointer", whiteSpace: "nowrap",
            }}
          >
            Assign
          </button>
        </div>
      </div>

      {showSignals && (
        <ul
          data-testid="supplier-suggestion-signals"
          className="mt-2.5 flex flex-col gap-1.5"
          style={{ listStyle: "none", margin: "10px 0 0", padding: "10px 0 0", borderTop: `1px solid ${T.amberLine}` }}
        >
          {suggestion.signals.map((sig, i) => (
            <li key={`${sig.signal}-${i}`} className="flex items-baseline gap-2">
              <span
                className="flex-shrink-0 text-[11px] font-semibold"
                style={{ color: T.inkMuted, minWidth: 108 }}
              >
                {signalLabel(sig.signal)}
              </span>
              <span className="min-w-0 flex-1 text-[12px]" style={{ color: T.ink, lineHeight: 1.5 }}>
                {sig.detail}
              </span>
              <span
                className="flex-shrink-0 text-[11px]"
                aria-label={`adds ${Math.round(sig.contribution * 100)} points to the score`}
                style={{ color: T.inkMuted, fontFamily: "'JetBrains Mono',monospace", fontVariantNumeric: "tabular-nums" }}
              >
                +{Math.round(sig.contribution * 100)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The backend's own words where it gave them (ApiHttpError carries the parsed body's
 * `error`, already folded into the message), so a rejected supplier reads as
 * "Supplier not found." rather than a generic failure the operator can't act on.
 */
function messageFor(err: unknown, counterparty: string): string {
  const raw = err instanceof Error ? err.message : "";
  const cleaned = raw.replace(/^assign-supplier failed:\s*/i, "").trim();
  return cleaned || `Couldn't assign that ${counterparty}. Try again in a moment.`;
}

export default AssignSupplierBanner;
