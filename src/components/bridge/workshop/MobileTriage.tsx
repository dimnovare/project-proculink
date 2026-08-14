"use client";

// MobileTriage — the v3 Order Workshop reduced view (below lg, < 1024px). The full
// drag-wire mapper renders on a laptop (lg+, ≥1024) so a 13"/14" screen keeps it;
// below lg there isn't room for the 2-column canvas, so we ship an honest
// REVIEW-AND-SEND surface (handoff §15): you can read what came in, see what will go
// out, clear the open issues that have a one-click fix, and send — but field-by-field
// mapping stays on a wider screen.
//
// This is a PURE PRESENTATIONAL component: every value (order summary, issues,
// preview, send state) arrives as a prop from OrderWorkshop. It does NO data
// fetching and never fabricates data — counts and the preview are passed down from
// the same hooks the desktop view uses, so there is ONE send path and ONE truth.
//
// ui-ux-pro-max applied: 44px+ touch targets with ≥8px spacing, 16px min body font,
// min-h via the parent's dvh shell, no horizontal scroll, a sticky safe-area-aware
// Send bar, focus-visible rings, semantic color tokens (navy/blue/green/amber/danger;
// AI violet is intentionally NOT used — this is the validator's voice), severity shown
// by icon+text (never color alone), progressive disclosure via collapsible cards,
// 150–250ms transitions that respect prefers-reduced-motion, and aria-labels on icon
// controls. Plain vocabulary only (no bridge/dock/lane words).

import { useState, type KeyboardEvent, type ReactNode } from "react";
import { UnifiedStatusBadge } from "../UnifiedStatusBadge";
import { sendBarLabel } from "./sendBarLabel";
import { orderProblemState } from "@/lib/orderStatusManifest";
// Both amber notes are the SAME sentences the desktop panel renders, owned in one
// place so the two breakpoints cannot drift apart.
import { STOPPED_ORDER_NOTE, UNVERIFIED_ORDER_NOTE } from "./acceptanceGateModel";
import type { WorkshopIssue, IssuesResolveApi } from "./IssuesPanel";
import type { OrderLine } from "@/types/procurement";

// ── Semantic color tokens (mirrors the rest of the workshop) ──────────────────
const NAVY = "#0B1A2F";
const INK = "#5E6779";
const INK_FAINT = "#8893A6";
const HAIRLINE = "#E5E8EE";
const BLUE = "#1E66C9";
const BLUE_DEEP = "#0F4FAB";
const BLUE_WASH = "#EFF4FB";
const BLUE_BORDER = "#CFE0F6";
const GREEN = "#2E8E3A";     // card accent / edges
const GREEN_BTN = "#297F34"; // solid fill under white text — ≈4.6:1 AA (2E8E3A was 4.16:1)
const GREEN_DEEP = "#1E6D29";
const GREEN_WASH = "#E9F1EA";
const GREEN_BORDER = "#BFE0C2";
const AMBER = "#B36D14";     // card edge / severity glyph only (non-text, 3:1 floor)
// Amber as TEXT: #8A5310 on #FAF1DD = 5.6206:1. NOT AMBER, which is 3.6547:1 here.
const AMBER_TEXT = "#8A5310";
const AMBER_WASH = "#FAF1DD";
const AMBER_BORDER = "#F1E2BE";
const DANGER = "#B43838";
const DANGER_WASH = "#FBE3E3";
const DANGER_BORDER = "#F0C8C8";

export interface MobileTriageProps {
  // ── Header summary ──
  poNumber: string;
  /** Resolved buyer/issuer display name (already direction-aware). */
  buyerName: string;
  /** Resolved supplier/recipient display name. */
  supplierName: string;
  /** Pre-formatted grand total, e.g. "€ 4,436.73". */
  grandTotalLabel: string;
  /** Raw status string for the UnifiedStatusBadge. */
  status: string;

  // ── Summary cards ──
  /** Count of fields captured from the source document ("What we received"). */
  receivedFieldCount: number;
  /** Number of order lines (shown in the received card). */
  lineCount: number;
  /**
   * Output format label, e.g. "JSON" / "cXML" ("What we will send") — or NULL when the
   * order holds no deliverable artifact yet and nothing has decided the format.
   *
   * Null is the normal pre-send state, not a rare one: the transform runs BECAUSE no
   * deliverable artifact exists. The caller derives this from `orderDeliveryFormat` via
   * `deliveryFormatLabel`, the same producer the send confirmation uses, so the badge here
   * and the format the modal names one tap later cannot disagree. Null → this view renders
   * no badge and names no format in its prose. Never substitute a placeholder: the previous
   * producer's hard-coded "XML" default is precisely the defect this type change closes.
   */
  outputFormatLabel: string | null;
  /** Live output preview text if it could be generated; null = none available yet. */
  previewContent?: string | null;

  // ── Issues + send gate ──
  issues: WorkshopIssue[];
  blockingIssues: number;
  exceptionCount: number;
  /**
   * The green all-clear bar's sentence, produced by `readyBarLabel` in the caller — the SAME
   * string the desktop rail's `<IssuesPanel readyLabel>` receives.
   *
   * REQUIRED, and required on purpose. This view used to hold its own literal —
   * "No open issues — ready to send." — so an order whose supplier rules failed and were
   * OVERRIDDEN read as entirely clean here while the desktop rail, for that same order, said
   * "No open issues, but 2 supplier rules did not pass and were overridden." A second string is
   * how the two diverged; an optional prop with a local fallback is how they would diverge
   * again, silently, the first time a caller forgot it. There is no default to fall back to.
   */
  readyLabel: string;
  /**
   * Supplier acceptance rules that did not pass but that the server's gate will not refuse —
   * i.e. an override is recorded (`blocked:false` with a non-empty `blockers` list).
   *
   * REQUIRED for the same reason as `readyLabel`: this view cannot derive it. `issues` carries
   * FIELD problems only, so counting warnings out of it — which is all this component used to
   * do — silently dropped every advisory rule, and the mobile send bar therefore never showed
   * the "· N optional" the desktop button showed for the identical order.
   */
  advisoryCount: number;
  canSend: boolean;
  crossed: boolean;
  sendState: "idle" | "transforming" | "delivering";

  // ── Direction-aware labels (from useOrderDirection) ──
  primaryCta: string;
  primaryCtaProgress: string;
  doneLabel: string;

  // ── Actions (the SAME server-truth handlers the desktop view uses) ──
  /** Apply the deterministic one-click fix for an AI-suggestion issue. */
  onFix: (issue: WorkshopIssue) => void;
  /** Point at the field this issue references (framed as "view on desktop" here). */
  onFocusField: (ref: string) => void;
  /** Open the send confirm dialog (→ setShowConfirm(true)). */
  onSend: () => void;
  /** Inline per-line resolution actions (same server-truth path as desktop). */
  resolve?: IssuesResolveApi;
  /** The order lines, to read each card's current code / AI suggestion by lineId. */
  lines?: OrderLine[];
  /**
   * Count of unresolved lines that carry an AI suggestion — the "Accept all AI
   * suggestions" scope (bulk-accept parity with the /upload/preview step). The
   * bulk control renders only when this is > 0 AND `resolve?.bulkAcceptSuggestions`
   * is present. Optional → callers without bulk support render no control.
   */
  suggestableCount?: number;
  /** The ≥0.85-confidence subset of `suggestableCount` ("Accept ≥85% only"). */
  highConfCount?: number;
  /**
   * Teaching content rendered directly above the issue list — today the catalog
   * hint. Kept a slot so this component stays purely presentational: the node
   * decides its own visibility, this view only decides where it sits.
   */
  hintSlot?: ReactNode;
  /**
   * The file this order arrived as, rendered by the caller. Placed in a collapsed card above
   * the summaries — the document is what the summaries are checked against, and a phone shows
   * a page of a PO perfectly well, so this screen is not exempt from having it. Absent → the
   * card is not rendered at all (no empty shell).
   */
  documentSlot?: ReactNode;
}

export function MobileTriage(props: MobileTriageProps) {
  const {
    poNumber, buyerName, supplierName, grandTotalLabel, status,
    receivedFieldCount, lineCount, outputFormatLabel, previewContent,
    issues, blockingIssues, exceptionCount, readyLabel, advisoryCount, canSend, crossed, sendState,
    primaryCta, primaryCtaProgress, doneLabel,
    onFix, onFocusField, onSend, resolve, lines,
    suggestableCount = 0, highConfCount = 0, hintSlot, documentSlot,
  } = props;

  const sendBlockCount = Math.max(blockingIssues, exceptionCount);

  // Three answers about the ORDER itself, kept separate from the count of FIELD issues:
  // only `"clear"` may draw the green "ready to send" bar. Read through
  // `orderProblemState` rather than `isProblemBucketStatus` so a status this build has
  // never heard of stays "unknown" instead of collapsing into "fine" — the same verdict
  // the desktop IssuesPanel and the Issues column head take, so the three cannot
  // contradict each other on one order.
  const orderVerdict = orderProblemState(status);

  // The button copy mirrors the desktop send button exactly — because it is
  // literally the same function now (WP-28). Two hand-written ladders is how the
  // same state came to read "Send · 2 blockers" on desktop and "Fix 2 to send"
  // here, and how neither surface had a word for the sendable-but-not-clean
  // case. This view is presentational, so it reassembles the label set from the
  // three direction-aware strings it is given rather than calling the hook.
  const sendCopy = sendBarLabel({
    labels: {
      primaryCta,
      primaryCtaProgress,
      doneLabel,
      // Not read by sendBarLabel; present so the shape type-checks.
      counterpartyNoun: "", counterpartyPlural: "", railHeader: "",
      deliveredLabel: doneLabel, unknownBuyer: "",
    },
    blockingIssues,
    exceptionCount,
    // `+ advisoryCount` mirrors OrderWorkshop's own `warningIssues` line character for
    // character, off the same two inputs. Without it this sum counted FIELD warnings only,
    // so the desktop button read "Send to supplier · 2 optional" on an overridden order and
    // the button directly beside it here read a plain "Send to supplier".
    warningIssues: issues.filter((i) => i.severity === "warning").length + advisoryCount,
    crossed,
    sendState,
  });
  const sendLabel = sendCopy.label;

  return (
    <div
      className="lg:hidden flex flex-col plk-mobile-triage"
      data-testid="mobile-triage"
      style={{ minHeight: "100%" }}
    >
      {/* Scoped styling — focus-visible rings, button hover, and reduced-motion
          neutralization for this component's inline transitions. */}
      <style>{`
        .plk-mobile-triage button:focus-visible {
          outline: 2px solid ${BLUE};
          outline-offset: 2px;
        }
        .plk-mobile-triage .plk-mobile-send:not(:disabled):hover,
        .plk-mobile-triage .plk-mobile-accept:hover {
          filter: brightness(1.07);
        }
        @media (prefers-reduced-motion: reduce) {
          .plk-mobile-triage .plk-mobile-send,
          .plk-mobile-triage .plk-mobile-accept,
          .plk-mobile-triage .plk-chevron {
            transition: none !important;
          }
        }
      `}</style>
      {/* Scroll region — the sticky Send bar sits below it. */}
      <div
        className="flex flex-col gap-3"
        style={{ flex: 1, padding: "14px 14px 14px", overflowX: "hidden" }}
      >
        {/* ── Compact header ─────────────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5" data-testid="mobile-triage-header">
          <div className="flex items-start justify-between gap-2.5">
            {/* h2, not h1: the OrderWorkshop header above ("Review and send this
                order") is the route's single h1 and stays mounted at this
                (sub-lg) width, so the PO number is a sub-heading under it —
                keeping exactly one h1 on the route (WCAG 1.3.1). Styles unchanged. */}
            <h2
              style={{
                fontFamily: "'Bricolage Grotesque',Inter,sans-serif",
                fontSize: 18,
                fontWeight: 700,
                letterSpacing: "-0.02em",
                color: NAVY,
                lineHeight: 1.15,
                margin: 0,
                minWidth: 0,
                wordBreak: "break-word",
              }}
            >
              {poNumber}
            </h2>
            <span style={{ flexShrink: 0, marginTop: 1 }}>
              <UnifiedStatusBadge size="sm" status={crossed ? "delivered" : exceptionCount > 0 ? "pending_review" : status} />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5" style={{ minWidth: 0, fontSize: 13 }}>
            <span style={{ fontWeight: 600, color: BLUE_DEEP, minWidth: 0, overflowWrap: "anywhere" }}>{buyerName}</span>
            <span aria-hidden style={{ flexShrink: 0, color: "#CBD0DA" }}>→</span>
            <span style={{ fontWeight: 600, color: GREEN_DEEP, minWidth: 0, overflowWrap: "anywhere" }}>{supplierName}</span>
            {/* Total slot renders ONLY when a real total is known — never a fake "€ 0.00". */}
            {grandTotalLabel && (
              <>
                <span aria-hidden style={{ flexShrink: 0, color: "#CBD0DA" }}>·</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", color: INK, minWidth: 0, overflowWrap: "anywhere" }}>{grandTotalLabel}</span>
              </>
            )}
          </div>
        </div>

        {/* ── Blue info note: full field-mapping needs a wider screen ─────── */}
        <div
          role="note"
          className="flex items-start gap-2.5"
          style={{
            borderRadius: 10,
            background: BLUE_WASH,
            border: `1px solid ${BLUE_BORDER}`,
            padding: "11px 13px",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0, marginTop: 1 }}>
            <circle cx="8" cy="8" r="6.5" stroke={BLUE} strokeWidth="1.3" />
            <path d="M8 7.2v3.6" stroke={BLUE} strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="5.1" r="0.9" fill={BLUE} />
          </svg>
          <p style={{ fontSize: 13, lineHeight: 1.5, color: BLUE_DEEP, margin: 0 }}>
            You can check and send the order here. For advanced editing (changing how data is sent to the supplier), open this on a laptop or desktop.
          </p>
        </div>

        {/* ── The original document ───────────────────────────────────────
            First, because it is the ground truth every card below is derived from: the values
            in "What we received" are only checkable against this. Collapsed by default so the
            landing screen keeps its height and no file is downloaded until it is asked for —
            SummaryCard mounts its body only when open. */}
        {documentSlot && (
          <SummaryCard
            testid="mobile-card-document"
            accent={BLUE}
            accentWash={BLUE_WASH}
            accentBorder={BLUE_BORDER}
            title="Original document"
            titleHint="The file this order arrived as"
            defaultOpen={false}
          >
            {documentSlot}
          </SummaryCard>
        )}

        {/* ── Two collapsible summary cards ──────────────────────────────── */}
        <SummaryCard
          testid="mobile-card-received"
          accent={BLUE}
          accentWash={BLUE_WASH}
          accentBorder={BLUE_BORDER}
          title="What we received"
          titleHint="From your file"
          badge={`${receivedFieldCount} ${receivedFieldCount === 1 ? "field" : "fields"}`}
          defaultOpen={false}
        >
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 7 }}>
            <SummaryRow label="Fields captured" value={String(receivedFieldCount)} />
            <SummaryRow label="Order lines" value={String(lineCount)} />
            <SummaryRow label="Buyer" value={buyerName} />
            <SummaryRow label="Total" value={grandTotalLabel || "—"} mono />
          </ul>
        </SummaryCard>

        <SummaryCard
          testid="mobile-card-send"
          accent={GREEN}
          accentWash={GREEN_WASH}
          accentBorder={GREEN_BORDER}
          title="What we will send"
          titleHint="To the supplier"
          /* Undefined, not a placeholder — SummaryCard omits the pill entirely. Nothing has
             chosen the delivery format until a deliverable artifact exists, so there is no
             honest badge to draw. */
          badge={outputFormatLabel ?? undefined}
          defaultOpen={false}
        >
          {previewContent && previewContent.trim().length > 0 ? (
            <pre
              data-testid="mobile-send-preview"
              style={{
                margin: 0,
                fontFamily: "'JetBrains Mono',monospace",
                fontSize: 12,
                lineHeight: 1.55,
                color: NAVY,
                background: "#F8FAFC",
                border: `1px solid ${HAIRLINE}`,
                borderRadius: 8,
                padding: "10px 11px",
                overflowX: "auto",
                whiteSpace: "pre",
                maxHeight: 260,
              }}
            >
              {previewContent}
            </pre>
          ) : (
            /* The format is named only when one is known. Same shape the send confirmation
               already uses for the identical value (`ConfirmDialog`'s `formatLabel ? … : ""`),
               so the two surfaces make the same claim or neither does. */
            <p style={{ fontSize: 13, lineHeight: 1.5, color: INK, margin: 0, overflowWrap: "anywhere" }}>
              {outputFormatLabel ? (
                <>
                  A <b>{outputFormatLabel}</b> file is generated for {supplierName} when you send.
                </>
              ) : (
                <>A file is generated for {supplierName} when you send.</>
              )}{" "}
              Open this order on a larger screen to see a live preview.
            </p>
          )}
        </SummaryCard>

        {/* Teaching hint above the issue list (the catalog cliff). Optional and
            self-hiding — the slot is empty on every screen that has nothing to
            teach, so nothing shifts. */}
        {hintSlot}

        {/* ── Issue list ─────────────────────────────────────────────────── */}
        {issues.length === 0 && orderVerdict !== "clear" ? (
          /* Zero FIELD problems, and the order itself is not known to be fine. Saying
             "ready to send" here is the mobile half of WP-39 §4.3 — see IssuesPanel's
             `orderStatus`. Two sentences, because "it stopped" and "we cannot read its
             state" are two different claims and only one of them was ever observed. */
          <div
            role="status"
            data-testid={orderVerdict === "problem" ? "mobile-triage-stopped" : "mobile-triage-unverified"}
            className="flex items-start gap-2.5"
            style={{
              borderRadius: 10,
              background: "#FAF1DD",
              border: "1px solid #B36D1433",
              color: "#8A5310",
              padding: "13px 14px",
            }}
          >
            <span
              aria-hidden
              style={{ flexShrink: 0, width: 18, height: 18, borderRadius: "50%", background: "#B36D14", color: "#FFFFFF", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, marginTop: 1 }}
            >
              !
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600 }}>
              <strong style={{ fontWeight: 700 }}>No field problems.</strong>{" "}
              {orderVerdict === "problem" ? STOPPED_ORDER_NOTE : UNVERIFIED_ORDER_NOTE}
            </span>
          </div>
        ) : issues.length === 0 ? (
          /* The all-clear. `readyLabel` arrives from the caller's `readyBarLabel` — the SAME
             sentence the desktop rail shows for this order — so an overridden supplier rule is
             named here too. items-start, not items-center: the sentence wraps to several lines
             on a phone and a centred glyph would float mid-paragraph. */
          <div
            role="status"
            data-testid="mobile-triage-ready"
            className="flex items-start gap-2.5"
            style={{
              borderRadius: 10,
              background: GREEN_WASH,
              border: `1px solid ${GREEN_BORDER}`,
              color: GREEN_DEEP,
              padding: "13px 14px",
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 1, display: "inline-flex" }}>
              <CheckIcon color={GREEN_DEEP} />
            </span>
            <span style={{ fontSize: 13.5, lineHeight: 1.45, overflowWrap: "anywhere" }}>
              <strong style={{ fontWeight: 700 }}>Ready to send.</strong>{" "}
              <span style={{ fontWeight: 500 }}>{readyLabel}</span>
            </span>
          </div>
        ) : (
          <section data-testid="mobile-issue-list" aria-label="Open issues" className="flex flex-col gap-2.5">
            <div className="flex items-baseline gap-2" style={{ marginTop: 2 }}>
              <h2 style={{ fontSize: 13, fontWeight: 700, color: NAVY, margin: 0, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Fix these to send
              </h2>
              {/* #5E6779 on the #F6F7FA work area = 5.3095:1. NOT INK_FAINT, which is 2.8952:1 here. */}
              <span role="status" aria-live="polite" style={{ fontSize: 12, color: INK }}>
                {issues.length} {issues.length === 1 ? "issue" : "issues"}
                {blockingIssues > 0 ? ` · ${blockingIssues} blocking` : ""}
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: INK, margin: 0, lineHeight: 1.4 }}>
              Tap each issue below to fix it.
            </p>

            {/* Bulk-accept parity with the /upload/preview "Confirm item codes" step
                (handoff: the workshop is a strict superset). Same server endpoint
                (POST /accept-ai-suggestions) as desktop; shown only when there's a
                bulk handler AND a suggestable line. Feedback flows through the
                parent's setFlow, so no separate notice here. */}
            {resolve?.bulkAcceptSuggestions && suggestableCount > 0 && (
              <div data-testid="mobile-bulk-accept" className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => resolve.bulkAcceptSuggestions!(0)}
                  disabled={resolve.bulkAccepting}
                  className="plk-mobile-accept"
                  style={{ ...mobilePrimaryBtn, width: "100%", justifyContent: "center", display: "inline-flex", alignItems: "center", gap: 8, opacity: resolve.bulkAccepting ? 0.6 : 1, cursor: resolve.bulkAccepting ? "wait" : "pointer" }}
                >
                  {resolve.bulkAccepting ? "Resolving…" : `Resolve all suggested (${suggestableCount})`}
                </button>
                {highConfCount > 0 && highConfCount < suggestableCount && (
                  <button
                    type="button"
                    onClick={() => resolve.bulkAcceptSuggestions!(0.85)}
                    disabled={resolve.bulkAccepting}
                    style={{ ...mobileGhostBtn, width: "100%", justifyContent: "center", display: "inline-flex", alignItems: "center", gap: 8, opacity: resolve.bulkAccepting ? 0.6 : 1, cursor: resolve.bulkAccepting ? "wait" : "pointer" }}
                  >
                    {resolve.bulkAccepting ? "Accepting…" : `Accept ≥85% only (${highConfCount})`}
                  </button>
                )}
              </div>
            )}

            {issues.map((issue) => (
              <IssueCard
                key={issue.code}
                issue={issue}
                onFix={onFix}
                onFocusField={onFocusField}
                resolve={resolve}
                line={issue.lineId && lines ? lines.find((l) => l.id === issue.lineId) : undefined}
              />
            ))}
          </section>
        )}
      </div>

      {/* ── Persistent bottom Send bar — sticky + safe-area-aware ─────────── */}
      <div
        data-testid="mobile-send-bar"
        style={{
          position: "sticky",
          // Lift above the fixed cookie-consent banner while it's visible
          // (--plk-bottom-inset), else pin to the bottom as before.
          bottom: "var(--plk-bottom-inset, 0px)",
          flexShrink: 0,
          background: "#FFFFFF",
          borderTop: `1px solid ${HAIRLINE}`,
          padding: "10px 14px calc(10px + env(safe-area-inset-bottom, 0px))",
          boxShadow: "0 -6px 18px rgba(11,26,47,.06)",
        }}
      >
        <button
          type="button"
          onClick={() => { if (canSend) onSend(); }}
          disabled={!canSend}
          aria-label={sendCopy.ariaLabel}
          className="plk-mobile-send"
          style={{
            width: "100%",
            minHeight: 48,
            borderRadius: 10,
            fontSize: 16,
            fontWeight: 700,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 9,
            background: canSend ? GREEN_BTN : "#5A7660",
            color: "#FFFFFF",
            border: `1px solid ${canSend ? GREEN_DEEP : "#5A7660"}`,
            cursor: canSend ? "pointer" : "not-allowed",
            transition: "filter 150ms ease",
          }}
        >
          {sendState === "idle" && !crossed && (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M14.5 1.5 7.2 8.8M14.5 1.5 9.8 14.5 7.2 8.8 1.5 6.2 14.5 1.5Z" stroke="#FFFFFF" strokeWidth="1.3" strokeLinejoin="round" />
            </svg>
          )}
          {sendLabel}
        </button>
      </div>
    </div>
  );
}

// ── Collapsible summary card (progressive disclosure) ─────────────────────────
function SummaryCard({
  testid, accent, accentWash, accentBorder, title, titleHint, badge, defaultOpen, children,
}: {
  testid: string;
  accent: string;
  accentWash: string;
  accentBorder: string;
  title: string;
  /** Optional plain-language framing shown as a hover tooltip (e.g. "From your file"). */
  titleHint?: string;
  /** Optional count/summary pill. Omitted when the card has no honest number to show. */
  badge?: string;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      data-testid={testid}
      style={{
        borderRadius: 10,
        background: "#FFFFFF",
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${accent}`,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        title={titleHint}
        className="flex items-center gap-2.5 w-full"
        style={{
          minHeight: 48,
          padding: "10px 13px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 700, color: NAVY, flex: 1, minWidth: 0 }}>{title}</span>
        {badge && (
          <span
            style={{
              fontSize: 11.5,
              fontWeight: 700,
              color: accent,
              background: accentWash,
              border: `1px solid ${accentBorder}`,
              borderRadius: 5,
              padding: "2px 8px",
              whiteSpace: "nowrap",
            }}
          >
            {badge}
          </span>
        )}
        <Chevron open={open} />
      </button>
      {open && (
        <div style={{ padding: "0 13px 13px", borderTop: `1px solid #F2F4F8` }}>
          <div style={{ paddingTop: 11 }}>{children}</div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <li className="flex items-baseline justify-between gap-3" style={{ fontSize: 13 }}>
      <span style={{ color: INK, flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: NAVY,
          fontWeight: 600,
          textAlign: "right",
          minWidth: 0,
          overflowWrap: "anywhere",
          wordBreak: "break-word",
          ...(mono ? { fontFamily: "'JetBrains Mono',monospace", fontWeight: 500 } : {}),
        }}
      >
        {value}
      </span>
    </li>
  );
}

// ── One issue card ────────────────────────────────────────────────────────────
function IssueCard({
  issue, onFix, onFocusField, resolve, line,
}: {
  issue: WorkshopIssue;
  onFix: (i: WorkshopIssue) => void;
  onFocusField: (ref: string) => void;
  resolve?: IssuesResolveApi;
  line?: OrderLine;
}) {
  const blocking = issue.severity === "blocking";
  // `edge` = the card edge + severity glyph (non-text, 3:1 floor); `text` = the tag
  // label. Named `edge`, not `color`, so the field says which floor it answers to.
  // #B43838 on #FBE3E3 = 4.8264:1 already passes, so blocking keeps one value.
  const tone = blocking
    ? { wash: DANGER_WASH, border: DANGER_BORDER, edge: DANGER, text: DANGER, label: "Blocking" }
    : { wash: AMBER_WASH, border: AMBER_BORDER, edge: AMBER, text: AMBER_TEXT, label: "Warning" };

  const lineId = issue.lineId;
  const canResolveLine = resolve != null && lineId != null && line != null;
  const editing = canResolveLine && resolve!.lineEditId === lineId;
  const busy = canResolveLine && resolve!.acceptingLineId === lineId;

  return (
    <div
      data-testid="mobile-issue-card"
      data-issue-ref={issue.code}
      style={{
        borderRadius: 10,
        background: "#FFFFFF",
        border: `1px solid ${HAIRLINE}`,
        borderLeft: `3px solid ${tone.edge}`,
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "12px 13px" }}>
        {/* Severity tag — icon + TEXT so severity is never color alone. */}
        <span
          className="inline-flex items-center gap-1"
          style={{
            fontSize: 11,
            fontWeight: 800,
            textTransform: "uppercase",
            letterSpacing: "0.03em",
            padding: "3px 8px",
            borderRadius: 5,
            background: tone.wash,
            // #8A5310 on #FAF1DD = 5.6206:1. NOT #B36D14, which is 3.6547:1 here.
            color: tone.text,
            border: `1px solid ${tone.border}`,
          }}
        >
          <SeverityIcon blocking={blocking} color={tone.edge} />
          {tone.label}
        </span>

        <div style={{ marginTop: 8, fontSize: 14, fontWeight: 600, color: NAVY, lineHeight: 1.35, overflowWrap: "anywhere" }}>
          {issue.title}
        </div>
        {issue.why && (
          <div style={{ marginTop: 3, fontSize: 13, color: INK, lineHeight: 1.45, overflowWrap: "anywhere" }}>{issue.why}</div>
        )}

        {/* Inline supplier-code editor (open) — the same server-truth path as
            desktop. On a phone this is the primary way to resolve a line. */}
        {editing ? (
          <MobileLineCodeInput
            title={issue.title}
            value={resolve!.lineDraft}
            busy={busy}
            onChange={resolve!.setLineDraft}
            onSave={() => resolve!.commitLineCode(lineId!)}
            onCancel={resolve!.cancelLineEdit}
          />
        ) : (
          <MobileIssueControls
            issue={issue}
            line={line}
            canResolveLine={canResolveLine}
            busy={busy}
            resolve={resolve}
            onFocusField={onFocusField}
          />
        )}
      </div>

      {/* Full-width Accept — only for AI-suggestion cards with a one-click fix and
          not while inline edit is open. */}
      {!editing && issue.fixAction && (
        <button
          type="button"
          onClick={() => onFix(issue)}
          disabled={busy}
          aria-label={`${issue.fixAction.label} for ${issue.title}`}
          className="plk-mobile-accept"
          style={{
            width: "100%",
            minHeight: 44,
            border: "none",
            borderTop: `1px solid ${HAIRLINE}`,
            background: GREEN_BTN,
            color: "#FFFFFF",
            fontSize: 15,
            fontWeight: 700,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.6 : 1,
            transition: "filter 150ms ease",
          }}
        >
          {busy ? "Saving…" : issue.fixAction.label}
        </button>
      )}
    </div>
  );
}

// ── Mobile inline controls (not-editing state) ────────────────────────────────
function MobileIssueControls({
  issue, line, canResolveLine, busy, resolve, onFocusField,
}: {
  issue: WorkshopIssue;
  line?: OrderLine;
  canResolveLine: boolean;
  busy: boolean;
  resolve?: IssuesResolveApi;
  onFocusField: (ref: string) => void;
}) {
  const lineId = issue.lineId;

  // No inline resolution (header rule-failure / missing API) → the honest
  // "view on a larger screen" affordance (unchanged).
  if (!canResolveLine || issue.kind === "rule-failure") {
    return (
      <button
        type="button"
        onClick={() => onFocusField(issue.ref)}
        aria-label={`Show ${issue.title} on a larger screen`}
        className="inline-flex items-center gap-1.5"
        style={{
          marginTop: 5,
          marginInline: -6,
          minHeight: 44,
          padding: "0 6px",
          fontSize: 12.5,
          // #5E6779 on the card's #FFFFFF = 5.6878:1. NOT INK_FAINT, which is 3.1015:1 here.
          color: INK,
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0 }}>
          <rect x="1.5" y="3" width="13" height="9.5" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5.5 14.5h5M8 12.5v2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
        Map this field on a larger screen
      </button>
    );
  }

  // review-flag → Confirm (re-commit existing code) + Change code.
  if (issue.kind === "review-flag") {
    return (
      <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
        <button
          type="button"
          onClick={() => resolve!.confirmFlaggedLine({ id: line!.id, lineNumber: line!.lineNumber, supplierItemCode: line!.supplierItemCode })}
          disabled={busy || !line!.supplierItemCode}
          className="plk-mobile-accept"
          style={{ ...mobilePrimaryBtn, opacity: busy || !line!.supplierItemCode ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
        >
          {busy ? "Saving…" : "Confirm"}
        </button>
        <button
          type="button"
          onClick={() => resolve!.startLineEdit(lineId!, line!.supplierItemCode ?? "")}
          disabled={busy}
          style={mobileGhostBtn}
        >
          Change code
        </button>
      </div>
    );
  }

  // ai-suggestion → "Enter manually" (the green Accept is rendered full-width below).
  if (issue.kind === "ai-suggestion") {
    return (
      <button
        type="button"
        onClick={() => resolve!.startLineEdit(lineId!, line!.aiSuggestion?.supplierItemCode ?? line!.supplierItemCode ?? "")}
        disabled={busy}
        style={{ ...mobileGhostBtn, marginTop: 10 }}
      >
        Enter manually
      </button>
    );
  }

  // manual-code (default) → open the inline code input.
  return (
    <button
      type="button"
      onClick={() => resolve!.startLineEdit(lineId!, line!.supplierItemCode ?? "")}
      disabled={busy}
      style={{ ...mobilePrimaryBtn, background: BLUE_DEEP, marginTop: 10, width: "auto", opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
    >
      {busy ? "Saving…" : "Enter code"}
    </button>
  );
}

// ── Mobile inline supplier-code editor ────────────────────────────────────────
function MobileLineCodeInput({
  title, value, busy, onChange, onSave, onCancel,
}: {
  title: string;
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSave();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <div className="flex items-center gap-2" style={{ marginTop: 10 }}>
      {/* autoFocus: the operator tapped to open this inline editor, so focusing it is the intent. */}
      <input
        type="text"
        autoFocus
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        aria-label={`Supplier code for ${title}`}
        placeholder="supplier code"
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 44,
          padding: "0 11px",
          borderRadius: 8,
          fontSize: 16, // 16px to avoid iOS zoom-on-focus
          fontFamily: "'JetBrains Mono',monospace",
          border: `1px solid ${BLUE_BORDER}`,
          background: busy ? "#F3F5F9" : "#FFFFFF",
          color: NAVY,
          outline: "none",
        }}
      />
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="plk-mobile-accept"
        style={{ ...mobilePrimaryBtn, opacity: busy ? 0.6 : 1, cursor: busy ? "wait" : "pointer" }}
      >
        {busy ? "Saving…" : "Save"}
      </button>
      <button type="button" onClick={onCancel} disabled={busy} aria-label="Cancel" style={mobileGhostBtn}>
        Cancel
      </button>
    </div>
  );
}

const mobilePrimaryBtn = {
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 8,
  border: "none",
  background: GREEN_BTN,
  color: "#FFFFFF",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
  flexShrink: 0,
  transition: "filter 150ms ease",
};
const mobileGhostBtn = {
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 8,
  border: `1px solid ${HAIRLINE}`,
  background: "#FFFFFF",
  color: INK,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  whiteSpace: "nowrap" as const,
  flexShrink: 0,
};

// ── Tiny inline icons ─────────────────────────────────────────────────────────
function SeverityIcon({ blocking, color }: { blocking: boolean; color: string }) {
  // Blocking → octagon-stop glyph; Warning → triangle. Shape differs so the two
  // severities are distinguishable without relying on color.
  return blocking ? (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M5.2 1.8h5.6L14.2 5.2v5.6l-3.4 3.4H5.2L1.8 10.8V5.2L5.2 1.8Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 4.6v4.2M8 11.2v.05" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M8 2 14.5 13.5H1.5L8 2Z" stroke={color} strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8 6.4v3M8 11.6v.05" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon({ color }: { color: string }) {
  return (
    <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="6.6" stroke={color} strokeWidth="1.3" />
      <path d="m5.2 8.2 1.9 1.9 3.7-4" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden
      className="plk-chevron"
      style={{ flexShrink: 0, color: INK_FAINT, transform: open ? "rotate(180deg)" : "none", transition: "transform 180ms ease" }}
    >
      <path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
