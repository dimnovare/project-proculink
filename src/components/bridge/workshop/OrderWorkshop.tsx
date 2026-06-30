"use client";

// OrderWorkshop — the unified order-review screen (Tasks 12). ONE collapsible
// surface: the IssuesPanel on top + the EXISTING MapperWorkbench enhanced (it is
// already the full 3-pane mapper, so we DO NOT compose separate
// ReceivedZone/OutputZone/MappingPanel wrappers — that would double its panes).
//
// Architecture (the corrected one, per the plan's "ARCHITECTURE CORRECTION"):
//   OrderWorkshop = IssuesPanel (issuesSlot) + <MapperWorkbench …enhanced/>
//     • collapse/focus of the mapper's incoming + preview panes, from useWorkshopLayout;
//     • attention-first default on the outgoing pane (collapse the AI-auto-mapped);
//     • onFocusField from the IssuesPanel → the mapper's existing ?field= deep-link.
//
// Data wiring REUSES the existing review hooks (useOrderReview / useResolveActions /
// useAcceptanceValidation / useSendFlow / useOrderDirection) so there is exactly ONE
// send path and ONE server-truth send guard — the workshop is a new VIEW over the same
// engine, not a second engine. Send is gated on issues.length === 0 && invariants.
//
// The drag mapper shows on a real laptop (lg, ≥1024) so a 13"/14" screen (or a split
// window down to 1024) keeps the full field mapper. Below lg we render <MobileTriage/>
// — an honest reduced REVIEW-AND-SEND surface (order summaries + the full issue list +
// one-click fixes + a sticky Send bar); field-by-field mapping stays on a wider screen.

import { useCallback, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { apiClient, getMappingOverride, previewMappingOverride } from "@/lib/api-client";
import { useQueriesEnabled } from "@/hooks/useQueriesEnabled";
import { useOrderDirection } from "@/hooks/useOrderDirection";
import type { OrderMappingOverride } from "@/lib/api/types";
import type { CalibrationSummary } from "@/types/procurement";
import { MapperWorkbench, type MapperWorkbenchLayout } from "../mapper/MapperWorkbench";
import { UnifiedStatusBadge } from "../UnifiedStatusBadge";
import { FailedPanel, ParseFailedPanel } from "../FailedPanels";
import { ConfirmDialog } from "../review/ConfirmDialog";
import { buildFixQueue, type FixQueueCard } from "../review/buildFixQueue";
import { formatMoney, resolvedGrandTotal, outputArtifactType, buyerLabel, orderDeliveryFormat } from "../review/orderDisplay";
import { useOrderReview } from "../review/hooks/useOrderReview";
import { useResolveActions } from "../review/hooks/useResolveActions";
import { useAcceptanceValidation } from "../review/hooks/useAcceptanceValidation";
import { useSendFlow } from "../review/hooks/useSendFlow";
import { useWorkshopLayout, type WorkshopFocus } from "./useWorkshopLayout";
import { IssuesPanel, type WorkshopIssue, type IssuesResolveApi } from "./IssuesPanel";
import { bulkAcceptCount, type BulkSelectableLine } from "../magicBulkAcceptSelection";
import { MobileTriage } from "./MobileTriage";
import { WorkshopStepper } from "./WorkshopStepper";
import { SendReadinessStrip, type BlockerChip } from "./SendReadinessStrip";
import { BridgeLoader, BridgePageLoader } from "../BridgeLoader";
import { OrderDetailsDrawer, type OrderDetailsTab } from "./OrderDetailsDrawer";

/** The default trust threshold when no calibration history exists (mirrors mappingListModel). */
const DEFAULT_TRUSTED_THRESHOLD = 0.85;

/**
 * The trust threshold for the attention-first split = the LOWEST trusted bucket's
 * lower bound (the smallest confidence the org's history says it can rely on). No
 * trusted bucket / cold start → the 0.85 default.
 */
export function deriveTrustedThreshold(calibration: CalibrationSummary | null | undefined): number {
  if (!calibration?.isActive) return DEFAULT_TRUSTED_THRESHOLD;
  const trusted = calibration.buckets.filter((b) => b.isTrusted);
  if (trusted.length === 0) return DEFAULT_TRUSTED_THRESHOLD;
  return Math.min(...trusted.map((b) => b.lowerInclusive));
}

/**
 * Map the server-truth Fix Queue onto the IssuesPanel's WorkshopIssue shape:
 *   • severity: a warning-level rule failure → "warning"; everything else blocks send.
 *   • ref:      the card's owning line id (deep-links the mapper) or its stable key.
 *   • title/why ← the card's title / detail.
 *   • fixAction: ONLY for AI-suggestion cards (a deterministic one-click accept).
 * Resolved (collapsed-in-place) cards are dropped — the panel shows open work only.
 */
export function fixQueueToIssues(queue: FixQueueCard[]): WorkshopIssue[] {
  return queue
    .filter((c) => !c.resolved)
    .map((c) => {
      // buildFixQueue encodes a warning rule-failure as severity 4 (rule base 3 + 1).
      const isWarning = c.kind === "rule-failure" && c.severity === 4;
      return {
        code: c.key,
        severity: isWarning ? "warning" : "blocking",
        ref: c.lineId ?? c.key,
        title: c.title,
        why: c.detail,
        // Only the AI-suggestion card has a deterministic one-click fix.
        fixAction: c.kind === "ai-suggestion" ? { label: "Accept suggestion" } : undefined,
        // Carry the kind + owning line so the IssuesPanel can render the right
        // inline resolution control (manual-code input / accept / confirm).
        kind: c.kind,
        lineId: c.lineId,
      } satisfies WorkshopIssue;
    });
}

/**
 * Phase 4 — amber pill shown when the document classifier detected an invoice
 * (these orders are force-held to pending_review server-side). Ported from the
 * legacy SpineReview so the *visible explanation* survives the workshop swap.
 * Renders nothing for non-invoice documents.
 */
function InvoiceBadge({ documentType }: { documentType?: string | null }) {
  if (documentType !== "invoice") return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full"
      title="Detected as an invoice and held for review."
      style={{ fontSize: 12, fontWeight: 600, padding: "3px 11px", background: "#FAF1DD", color: "#B36D14", whiteSpace: "nowrap" }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#B36D14", flexShrink: 0 }} />
      Looks like an invoice
    </span>
  );
}

export function OrderWorkshop({ orderId }: { orderId: string }) {
  const router = useRouter();
  const queryEnabled = useQueriesEnabled();
  const { labels } = useOrderDirection();

  // ── Live order + the same hooks the classic screen uses (ONE send path) ─────
  const { order, isLoading, isError, refetchOrder, exceptionCount } = useOrderReview(orderId);

  // ── Audit events — only fetched for a failed order, to seed the ParseFailedPanel
  //    error copy. Ported from the legacy SpineReview (same query key + gate). ──
  const { data: auditEvents = [] } = useQuery({
    queryKey: ["order-audit", orderId],
    queryFn: () => apiClient.getOrderAudit(orderId),
    enabled: queryEnabled && order?.status === "failed",
    retry: 1,
    staleTime: 60_000,
  });

  const {
    flowNotice, flowSeverity, setFlow,
    sendState, crossed, confirmSend,
    showConfirm, setShowConfirm,
  } = useSendFlow({ orderId, order, labels, refetchOrder });

  // Resolution actions — header/line nodes aren't needed here (the mapper owns the
  // canonical line nodes), so we pass an empty node list; acceptSuggestion is the
  // only action the IssuesPanel one-click fix uses.
  const resolve = useResolveActions({ orderId, order, nodes: [], labels, setFlow, refetchOrder });

  const validation = useAcceptanceValidation(orderId, { commitVersion: resolve.commitVersion });
  const { validationResult, failingRuleCount } = validation;

  // ── AI calibration → the trust threshold for the attention-first split ──────
  const { data: calibration } = useQuery<CalibrationSummary>({
    queryKey: ["ai-calibration"],
    queryFn: () => apiClient.getAiCalibration(),
    enabled: queryEnabled,
    staleTime: 5 * 60_000,
    retry: 1,
  });
  const trustedThreshold = useMemo(() => deriveTrustedThreshold(calibration), [calibration]);

  // ── The per-order mapping override (seed for the mapper, same as the classic) ─
  const { data: mappingOverride } = useQuery<OrderMappingOverride | null>({
    queryKey: ["mapping-override", orderId],
    queryFn: () => getMappingOverride(orderId),
    enabled: queryEnabled,
    staleTime: 10_000,
  });

  // ── The ONE issue list — derived from the SAME validator the send guard reads.
  //    Frozen against the previous queue so it never reshuffles under the cursor. ─
  const prevQueueRef = useRef<FixQueueCard[] | null>(null);
  const fixQueue = useMemo(() => {
    const next = order ? buildFixQueue(order, validationResult, prevQueueRef.current) : [];
    prevQueueRef.current = next;
    return next;
  }, [order, validationResult]);
  const issues = useMemo(() => fixQueueToIssues(fixQueue), [fixQueue]);

  // ── Mobile triage summary counts ("What we received") — distinct populated
  //    header fields + the per-line fields that carry a value, from the SAME order
  //    object. Never fabricated: a field counts only when it actually has data. ──
  const receivedFieldCount = useMemo(() => {
    if (!order) return 0;
    const headerFields = [
      order.poNumber, order.orderDate, order.buyerName, order.supplierName,
      order.currency, order.grandTotal, order.subTotal, order.taxTotal, order.paymentTerms,
    ];
    let count = headerFields.filter((v) => v !== null && v !== undefined && v !== "").length;
    for (const l of order.lines) {
      const lineFields = [l.buyerItemCode, l.supplierItemCode, l.description, l.quantity, l.unit, l.unitPrice];
      count += lineFields.filter((v) => v !== null && v !== undefined && v !== "").length;
    }
    return count;
  }, [order]);

  // ── Live "What we will send" preview for the mobile card — the SAME read-only
  //    render the desktop preview uses, seeded with the persisted override and the
  //    order's actual delivery format. Read-only; never changes delivery. ────────
  const mobilePreviewFormat = order ? orderDeliveryFormat(order) : null;
  const { data: mobilePreview } = useQuery({
    queryKey: ["mobile-send-preview", orderId, mobilePreviewFormat ?? "csv"],
    queryFn: () => previewMappingOverride(
      orderId,
      mappingOverride ?? { customFields: [] },
      mobilePreviewFormat ?? "csv",
      mobilePreviewFormat != null,
    ),
    enabled: queryEnabled && order != null,
    staleTime: 30_000,
    retry: 0,
  });
  const mobilePreviewContent = mobilePreview?.error ? null : (mobilePreview?.content ?? null);

  // ── Layout (collapse/focus) ─────────────────────────────────────────────────
  const lay = useWorkshopLayout();
  const mapperLayout = useMemo<MapperWorkbenchLayout>(() => ({
    incoming: lay.grid.left,
    preview: lay.grid.right,
    // The per-pane collapse carets drive the SAME focus the All/Mapping/Output tabs do, so the tab
    // highlight always matches what's on screen: collapse the preview → Mapping (received+output);
    // collapse received → Output (output+preview); expand either rail → All (all three).
    onExpandIncoming: () => lay.setFocus("all"),
    onExpandPreview: () => lay.setFocus("all"),
    onCollapseIncoming: () => lay.setFocus("output"),
    onCollapsePreview: () => lay.setFocus("mapping"),
  }), [lay]);

  // ── Focus a field in the mapper (IssuesPanel "Where →") — bumped signal so the
  //    same field can be re-focused on a repeat click. ─────────────────────────
  const [focusFieldId, setFocusFieldId] = useState<string | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const [sendTip, setSendTip] = useState(false);
  const onFocusField = useCallback((ref: string) => {
    setFocusFieldId(ref);
    setFocusSignal((n) => n + 1);
    // Always show the mapper columns when jumping to a field.
    lay.setFocus("all");
  }, [lay]);

  // ── Order details drawer (audit / standards / supplier response) ────────────
  //    Secondary, lower-frequency trust surfaces relocated from the old screen's
  //    Passport/Conformance/Response tabs. Opened from a quiet header trigger.
  //    detailsTab is seeded from the ?tab= query param so a deep link
  //    (e.g. ExceptionDetail's "Check conformance" → ?tab=conformance) opens the
  //    matching drawer tab on first paint.
  const searchParams = useSearchParams();
  const [detailsTab, setDetailsTab] = useState<OrderDetailsTab | null>(() => {
    const t = searchParams?.get("tab");
    return t === "passport" || t === "conformance" || t === "response" ? t : null;
  });
  // Read the live query string at call time (not the searchParams snapshot) so these
  // stay referentially stable — otherwise every ?tab= write would re-identify them and
  // needlessly re-attach the drawer's Esc/focus-trap listeners while it is open.
  const openDetails = useCallback((t: OrderDetailsTab) => {
    setDetailsTab(t);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", t);
    router.replace(`${window.location.pathname}?${params.toString()}`, { scroll: false });
  }, [router]);
  const closeDetails = useCallback(() => {
    setDetailsTab(null);
    const params = new URLSearchParams(window.location.search);
    params.delete("tab");
    const qs = params.toString();
    router.replace(qs ? `${window.location.pathname}?${qs}` : window.location.pathname, { scroll: false });
  }, [router]);

  // Seed the conformance profile from the supplier's delivered format when it maps to
  // a named standard (cXML / UBL / X12); otherwise leave it for the panel to default.
  const defaultConformanceFormat = useMemo<"cxml" | "ubl" | "x12" | undefined>(() => {
    const f = (order ? orderDeliveryFormat(order) : null)?.toLowerCase() ?? "";
    if (f.includes("cxml")) return "cxml";
    if (f.includes("ubl") || f === "peppol") return "ubl";
    if (f.includes("x12") || f.includes("850")) return "x12";
    return undefined;
  }, [order]);

  // ── One-click fix for an AI-suggestion issue → the real server-path accept ──
  const onFix = useCallback((issue: WorkshopIssue) => {
    // ref is the line id for line-scoped cards (acceptSuggestion resolves it).
    resolve.acceptSuggestion(issue.ref);
  }, [resolve]);

  // ── The inline per-line resolution subset handed to the IssuesPanel cards.
  //    SAME server-truth path (commit → refetch) as the classic screen — the
  //    panel never resolves a line in local state. ─────────────────────────────
  const issuesResolve = useMemo<IssuesResolveApi>(() => ({
    lineEditId: resolve.lineEditId,
    lineDraft: resolve.lineDraft,
    setLineDraft: resolve.setLineDraft,
    startLineEdit: resolve.startLineEdit,
    commitLineCode: resolve.commitLineCode,
    cancelLineEdit: resolve.cancelLineEdit,
    confirmFlaggedLine: resolve.confirmFlaggedLine,
    acceptingLineId: resolve.acceptingLineId,
    // Bulk-accept parity with the /upload/preview step — the same server endpoint
    // (POST /accept-ai-suggestions) the MagicMappingPreview bulk button uses.
    bulkAcceptSuggestions: resolve.bulkAcceptSuggestions,
    bulkAccepting: resolve.bulkAccepting,
  }), [
    resolve.lineEditId, resolve.lineDraft, resolve.setLineDraft, resolve.startLineEdit,
    resolve.commitLineCode, resolve.cancelLineEdit, resolve.confirmFlaggedLine, resolve.acceptingLineId,
    resolve.bulkAcceptSuggestions, resolve.bulkAccepting,
  ]);

  // ── Bulk-accept scope counts — derived from order.lines, mapped to the SAME
  //    BulkSelectableLine shape MagicMappingPreview feeds bulkAcceptCount, so the
  //    workshop's "Accept all"/"Accept ≥85%" badges match the preview's semantics
  //    exactly. A line is suggestable when it's still unresolved (needsReview) AND
  //    carries an AI-suggested supplier code; the ≥85% subset uses the suggestion's
  //    own confidence (falling back to the line confidence). The workshop has no
  //    local "rejected" set (useResolveActions removed it) → empty rejection set. ─
  const { suggestableCount, highConfCount } = useMemo(() => {
    const selectable: BulkSelectableLine[] = order
      ? order.lines.map((l) => ({
          lineNumber: l.lineNumber,
          status: l.needsReview ? "suggested" : "resolved",
          aiSuggestedSupplierCode: l.aiSuggestion?.supplierItemCode ?? null,
          confidence: l.aiSuggestion?.confidence ?? l.confidence ?? null,
        }))
      : [];
    const empty: ReadonlySet<number> = new Set();
    return {
      suggestableCount: bulkAcceptCount({ lines: selectable, minConfidence: 0, rejectedLineNumbers: empty }),
      highConfCount: bulkAcceptCount({ lines: selectable, minConfidence: 0.85, rejectedLineNumbers: empty }),
    };
  }, [order]);

  // The chip jump now targets the issue CARD (anchored data-issue-ref={code} in
  // the IssuesPanel) — that is where the fix lives — instead of the dead mapper
  // jump (the ref was a line GUID; the mapper keys rows by output path).
  const onJumpToIssueCard = useCallback((code: string) => {
    if (typeof document === "undefined") return;
    const el = document.querySelector(`[data-issue-ref="${CSS.escape(code)}"]`);
    if (el) {
      el.scrollIntoView?.({ behavior: "smooth", block: "center" });
      (el as HTMLElement).animate?.(
        [{ background: "#FFF6E0" }, { background: "transparent" }],
        { duration: 1100, easing: "ease-out" },
      );
    }
  }, []);

  // ── Send gate: zero issues AND server-truth exceptionCount clear. ───────────
  const blockingIssues = issues.filter((i) => i.severity === "blocking").length;
  const canSend = !crossed && sendState === "idle" && blockingIssues === 0 && exceptionCount === 0;
  const sendReady = blockingIssues === 0 && exceptionCount === 0;

  // ── v3 chrome derivations (pipeline stepper + send-readiness strip) ──────────
  // Parse + Normalize are always done (the order is parsed); the active stage walks
  // forward as work clears: needs-work → Validate, ready → Transform, sending →
  // Transform/Deliver, delivered → complete (5).
  const stepperStage = crossed ? 5 : sendState === "delivering" ? 4 : sendState === "transforming" ? 4 : sendReady ? 3 : 2;
  const stepperFailed = flowSeverity === "error";
  // The chip id is the issue CODE (the card's data-issue-ref anchor), so the strip
  // chip scrolls to the actionable card — not the dead line-GUID mapper jump.
  const blockerChips: BlockerChip[] = issues
    .filter((i) => i.severity === "blocking")
    .map((i) => ({ id: i.code, name: i.title }));
  const noteCount = issues.filter((i) => i.severity === "warning").length;

  // ── Display helpers for the header + confirm dialog ──────────────────────────
  const grandTotalLabel = order ? formatMoney(order.currency, resolvedGrandTotal(order)) : "";
  const outputFormatLabel = order ? outputArtifactType(order.artifacts) : "";
  // The supplier's ACTUAL delivery output format — used in the Send confirmation
  // modal so it always reflects what will be delivered, not whichever format the
  // user last previewed (exploratory previews set outputFormatLabel to that tab's
  // format, which caused the modal to say "XML" when the supplier receives CSV).
  const sendModalFormat = (order ? orderDeliveryFormat(order) : "") || outputFormatLabel;

  // ── Loading / error gates (after all hooks) ─────────────────────────────────
  if (!queryEnabled || isLoading || order === undefined)
    return (
      <BridgePageLoader
        label="Preparing your order…"
        sub="Parsing the document and matching the supplier's fields."
      />
    );
  if (isError || order === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3.5 px-6 text-center" style={{ background: "#F6F7FA" }}>
        <span style={{ width: 56, height: 56, borderRadius: "50%", background: "#FFFFFF", border: "1px solid #E5E8EE", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="9" stroke="#CBD0DA" strokeWidth="1.6" />
            <path d="M6 6 18 18" stroke="#CBD0DA" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
        <p className="text-[15px] font-semibold" style={{ color: "#0B1A2F" }}>
          {order === null ? "Order not found" : "Failed to load order"}
        </p>
        <p className="text-[12.5px]" style={{ color: "#5E6779", maxWidth: 340, lineHeight: 1.5 }}>
          {order === null
            ? "This order may have been delivered and archived, or the link is out of date."
            : "Something went wrong loading this order. Try again in a moment."}
        </p>
        <button
          type="button"
          onClick={() => router.push("/inbox")}
          className="rounded-[7px] px-4 text-[12.5px] font-semibold"
          style={{ height: 36, background: "#0B1A2F", color: "#FFFFFF", border: 0, marginTop: 4 }}
        >
          ← Back to inbox
        </button>
      </div>
    );
  }

  // ── Failure gates — render before the main mapper so a failed order shows the
  //    honest recovery panel (parse / transform / delivery) instead of falling
  //    through to the normal mapper. Ported from the legacy SpineReview; reuses
  //    the KEPT FailedPanels.tsx. All hooks above have already run. ────────────
  if (order.status === "failed") {
    return <ParseFailedPanel order={order} auditEvents={auditEvents} />;
  }
  if (order.status === "transform_failed") {
    return <FailedPanel order={order} stage="transform" />;
  }
  if (order.status === "delivery_failed") {
    return <FailedPanel order={order} stage="delivery" />;
  }

  // ── Parsing gate — the order page is opened the instant the upload redirects,
  //    while the document is still being read server-side. Until parsing finishes
  //    the header/lines are empty (zeros / blanks), so rendering the mapper +
  //    issues here would show a half-populated, confusing screen. Show a calm,
  //    dedicated "we're reading your order" state instead. useOrderReview already
  //    polls every 3s while status === "parsing", so this auto-advances to the
  //    real review the moment the parse completes — no manual refresh needed. ──
  if (order.status === "parsing") {
    return (
      <div
        className="flex flex-col items-center justify-center h-full gap-5 px-6 text-center"
        style={{ background: "#F6F7FA" }}
        data-testid="order-parsing"
      >
        <BridgeLoader size={92} fullScreen={false} />
        <div style={{ maxWidth: 400 }}>
          <p className="text-[16px] font-semibold" style={{ color: "#0B1A2F", letterSpacing: "-0.01em" }}>
            We&rsquo;re reading your order…
          </p>
          <p className="text-[13px]" style={{ color: "#5E6779", marginTop: 7, lineHeight: 1.55 }}>
            We&rsquo;re extracting the line items and matching them to {order.supplierName || "the supplier"}.
            This usually takes a few seconds — the page will update on its own when it&rsquo;s ready.
          </p>
          {order.poNumber && (
            <p
              className="text-[12px]"
              style={{ color: "#98A0AE", marginTop: 12, fontFamily: "'JetBrains Mono',monospace" }}
            >
              {order.poNumber}
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden" style={{ background: "#F6F7FA" }} data-testid="order-workshop">
      {/* ── Header: back · PO · status · buyer→supplier · focus control · Send ── */}
      <div className="flex-shrink-0" style={{ background: "#FFFFFF", borderBottom: "1px solid #E5E8EE" }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-2.5 pb-2.5 lg:px-6">
          <div className="flex min-w-0 items-center gap-3 flex-shrink-0">
            <button
              onClick={() => router.push("/inbox")}
              aria-label="Back to inbox"
              className="plk-back"
              style={{ width: 30, height: 30, minWidth: 44, minHeight: 44, padding: 0, marginInline: -7, border: 0, background: "transparent", color: "#5E6779", cursor: "pointer", fontSize: 14, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
            >
              <span
                aria-hidden
                className="plk-back-box"
                style={{ width: 30, height: 30, border: "1px solid #E5E8EE", borderRadius: 8, background: "#FFFFFF", display: "inline-flex", alignItems: "center", justifyContent: "center", transition: "border-color .12s, background .12s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#1E66C9"; e.currentTarget.style.background = "#EAF0F8"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E5E8EE"; e.currentTarget.style.background = "#FFFFFF"; }}
              >
                ←
              </span>
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 style={{ fontFamily: "'Bricolage Grotesque',Inter,sans-serif", fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#0B1A2F", lineHeight: 1.1, minWidth: 0, overflowWrap: "anywhere" }}>
                  {order.poNumber}
                </h1>
                <UnifiedStatusBadge size="md" status={crossed ? "delivered" : exceptionCount > 0 ? "pending_review" : order.status} />
                <InvoiceBadge documentType={order.documentType} />
                {order.status === "delivery_dead_letter" && (
                  <span
                    title="We tried delivering this several times automatically and it didn't go through. Open the order to resend it."
                    style={{ display: "inline-flex", alignItems: "center", padding: "3px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600, background: "var(--danger-soft)", color: "var(--danger)", whiteSpace: "nowrap" }}
                  >
                    ⚠ Delivery failed — automatic retries used up. Open to resend.
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center" style={{ minWidth: 0, fontSize: 12.5, columnGap: 7 }}>
                <span style={{ fontWeight: 600, color: "#1E66C9", minWidth: 0, overflowWrap: "anywhere" }}>{buyerLabel(order)}</span>
                <span aria-hidden style={{ flexShrink: 0, color: "#CBD0DA" }}>→</span>
                <span style={{ fontWeight: 600, color: "#2E8E3A", minWidth: 0, overflowWrap: "anywhere" }}>{order.supplierName}</span>
                <span aria-hidden style={{ flexShrink: 0, color: "#CBD0DA" }}>·</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "#566982", minWidth: 0, overflowWrap: "anywhere" }}>{grandTotalLabel}</span>
              </div>
            </div>
          </div>

          {/* Focus + Send — right-aligned. The pipeline stepper now lives at the right end of
              the ready-banner below (app.jsx structure), not the header center.
              flex-wrap so the Details/Focus/Send controls reflow instead of
              overflowing on the narrowest headers; no effect once they fit. */}
          <div className="flex flex-wrap items-center justify-end gap-3.5 flex-shrink-0 ml-auto">
            {/* Order details (audit · standards · response) — quiet secondary trigger
                that opens the relocated Passport/Conformance/Response surfaces.
                Desktop mapper (lg+): below lg the body is <MobileTriage> (review-and-send
                only), and these controls would only eat the header and clip Send. */}
            <div className="hidden lg:inline-flex">
              <button
                type="button"
                onClick={() => openDetails("passport")}
                aria-label="Order details — audit trail, standards check, and response"
                style={{ height: 33, padding: "0 13px", borderRadius: 8, border: "1px solid #E5E8EE", background: "#FFFFFF", color: "#5E6779", fontSize: 12.5, fontWeight: 600, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", flexShrink: 0, transition: "border-color .12s, color .12s" }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "#1E66C9"; e.currentTarget.style.color = "#0B1A2F"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "#E5E8EE"; e.currentTarget.style.color = "#5E6779"; }}
              >
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M3 4h10M3 8h10M3 12h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                Details
              </button>
            </div>

            {/* Focus: All / Mapping / Output — the progressive-disclosure control.
                Desktop mapper (lg+): the tabs drive the desktop MapperWorkbench, which
                is itself hidden below lg, so below that they would be inert AND overflow
                the header. Tied to the same lg gate as the mapper so the SAME toolset is
                available at 1024–1279. */}
            <div className="hidden lg:flex">
              <FocusControl focus={lay.focus} onFocus={lay.setFocus} />
            </div>

            {/* Send — gated by canSend (issues clear + server-truth exceptions clear). */}
            <div style={{ position: "relative" }} onMouseEnter={() => setSendTip(true)} onMouseLeave={() => setSendTip(false)}>
              <button
                type="button"
                onClick={() => canSend && setShowConfirm(true)}
                disabled={!canSend}
                aria-label={labels.primaryCta}
                style={{
                  height: 36, padding: "0 18px", borderRadius: 8, fontSize: 13, fontWeight: 700,
                  background: canSend ? "#2E8E3A" : "#5A7660", color: "#FFFFFF",
                  border: `1px solid ${canSend ? "#1E6D29" : "#5A7660"}`,
                  cursor: canSend ? "pointer" : "not-allowed", whiteSpace: "nowrap", flexShrink: 0,
                  display: "inline-flex", alignItems: "center", gap: 8, transition: "filter .12s",
                }}
                onMouseEnter={(e) => { if (canSend) e.currentTarget.style.filter = "brightness(1.07)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.filter = "none"; }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M14.5 1.5 7.2 8.8M14.5 1.5 9.8 14.5 7.2 8.8 1.5 6.2 14.5 1.5Z" stroke="#FFFFFF" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                {crossed
                  ? labels.doneLabel
                  : sendState === "transforming"
                    ? "Preparing the file…"
                    : sendState === "delivering"
                      ? labels.primaryCtaProgress
                      : blockingIssues > 0 || exceptionCount > 0
                        ? `Fix ${Math.max(blockingIssues, exceptionCount)} to send`
                        : labels.primaryCta}
              </button>
              {sendTip && !canSend && !crossed && sendState === "idle" && (blockingIssues > 0 || exceptionCount > 0) && (
                <div
                  role="tooltip"
                  style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 230, background: "#0B1A2F", color: "#FFFFFF", borderRadius: 8, padding: "9px 12px", fontSize: 11.5, lineHeight: 1.5, boxShadow: "0 12px 30px rgba(11,26,47,.28)", zIndex: 60 }}
                >
                  Fill {Math.max(blockingIssues, exceptionCount)} required field{Math.max(blockingIssues, exceptionCount) > 1 ? "s" : ""} below first — they&apos;re highlighted in <b>what we send</b>.
                  <span style={{ position: "absolute", top: -5, right: 24, width: 10, height: 10, background: "#0B1A2F", transform: "rotate(45deg)" }} />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Flow notice (send progress / errors) ─────────────────────────────── */}
      {flowNotice && (
        <div
          role="status"
          aria-live="polite"
          className="flex-shrink-0 px-4 lg:px-6"
          style={{
            padding: "8px 16px",
            background: flowSeverity === "error" ? "#FBE3E3" : flowSeverity === "success" ? "#E9F1EA" : "#EFF4FB",
            color: flowSeverity === "error" ? "#B43838" : flowSeverity === "success" ? "#1E6D29" : "#0F4FAB",
            fontSize: 12.5, fontWeight: 600,
            borderBottom: "1px solid #EEF0F4",
          }}
        >
          {flowNotice}
        </div>
      )}

      {/* ── Send-readiness strip — slim, full-width summary. Its chips now scroll to
          the actionable issue CARD below (data-issue-ref) — where the inline fix
          lives — not the dead line-GUID mapper jump. Pairs with the desktop mapper
          (lg+); below lg the MobileTriage view carries its own issue list. ── */}
      <div className="hidden lg:block flex-shrink-0">
        <SendReadinessStrip blockers={blockerChips} notes={noteCount} ready={sendReady} onJump={onJumpToIssueCard} pipeline={<WorkshopStepper stage={stepperStage} failed={stepperFailed} />} />
      </div>

      {/* ── Body ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {/* Desktop mapper (lg+, ≥1024): the enhanced MapperWorkbench with the
            IssuesPanel on top. No min-width clamp — the canvas tracks (incoming
            minmax + 56px gutter + flex outgoing) fit within ~1000px so a 13"/14"
            laptop at 1024 gets the full field mapper with no horizontal scroll;
            the docked preview wraps below it until ~1440 (2-pane canvas). */}
        <div className="hidden lg:block px-6 py-[18px]" style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden" }}>
          {/* The actionable issue list — inline supplier-code entry per line lives
              here (the strip above is only a summary that scrolls to these cards). */}
          {issues.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <IssuesPanel
                issues={issues}
                onFocusField={onFocusField}
                onFix={onFix}
                resolve={issuesResolve}
                lines={order.lines}
                suggestableCount={suggestableCount}
                highConfCount={highConfCount}
              />
            </div>
          )}
          <MapperWorkbench
            variant="order"
            orderId={orderId}
            supplierId={order.supplierId}
            supplierName={order.supplierName}
            initialOverride={mappingOverride}
            order={order}
            layout={mapperLayout}
            attentionFirstOutput
            mappingMode="picker"
            previewDefaultFormat={orderDeliveryFormat(order)}
            autoFilledFields={order}
            trustedThreshold={trustedThreshold}
            focusFieldId={focusFieldId}
            focusFieldSignal={focusSignal}
            onValidate={() => openDetails("conformance")}
            reviewSignal={order.lines.filter((l) => l.needsReview).length}
          />
        </div>

        {/* Below xl — the v3 reduced MOBILE TRIAGE: review summaries, clear issues
            with a one-click fix, and send. Field mapping stays on the desktop
            mapper (above); this is an honest review-and-send-only surface. */}
        <MobileTriage
          poNumber={order.poNumber}
          buyerName={buyerLabel(order)}
          supplierName={order.supplierName}
          grandTotalLabel={grandTotalLabel}
          status={order.status}
          receivedFieldCount={receivedFieldCount}
          lineCount={order.lines.length}
          outputFormatLabel={outputFormatLabel}
          previewContent={mobilePreviewContent}
          issues={issues}
          blockingIssues={blockingIssues}
          exceptionCount={exceptionCount}
          canSend={canSend}
          crossed={crossed}
          sendState={sendState}
          primaryCta={labels.primaryCta}
          primaryCtaProgress={labels.primaryCtaProgress}
          doneLabel={labels.doneLabel}
          onFix={onFix}
          onFocusField={onFocusField}
          onSend={() => setShowConfirm(true)}
          resolve={issuesResolve}
          lines={order.lines}
          suggestableCount={suggestableCount}
          highConfCount={highConfCount}
        />
      </div>

      {/* ── Confirm dialog — the SAME one the classic screen uses (one send path). */}
      {showConfirm && (
        <ConfirmDialog
          exceptionCount={exceptionCount}
          onConfirm={confirmSend}
          onCancel={() => setShowConfirm(false)}
          supplierName={order.supplierName}
          outputFormat={sendModalFormat}
          grandTotal={grandTotalLabel}
          lineCount={order.lines.length}
          labels={labels}
          failingRuleCount={failingRuleCount}
          validationStale={validation.isStale}
        />
      )}

      {/* ── Order details (audit · standards · response) — relocated from the old
           Passport/Conformance/Response tabs; deep-linkable via ?tab=. ───────── */}
      <OrderDetailsDrawer
        open={detailsTab !== null}
        onClose={closeDetails}
        tab={detailsTab ?? "passport"}
        onTab={openDetails}
        orderId={orderId}
        poNumber={order.poNumber}
        supplierName={order.supplierName}
        currency={order.currency}
        status={order.status}
        errorMessage={order.errorMessage}
        counterpartyNoun={labels.counterpartyNoun}
        defaultConformanceFormat={defaultConformanceFormat}
      />
    </div>
  );
}

// ── Focus: All / Mapping / Output segmented control ───────────────────────────
function FocusControl({ focus, onFocus }: { focus: WorkshopFocus; onFocus: (f: WorkshopFocus) => void }) {
  const items: { id: WorkshopFocus; label: string }[] = [
    { id: "all", label: "All" },
    { id: "mapping", label: "Mapping" },
    { id: "output", label: "Output" },
  ];
  return (
    <div role="group" aria-label="Focus" style={{ display: "inline-flex", borderRadius: 8, background: "#F1F3F7", padding: 2, gap: 2, flexShrink: 0 }}>
      {items.map((it) => {
        const active = focus === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onFocus(it.id)}
            aria-pressed={active}
            style={{
              fontSize: 12.5, fontWeight: active ? 600 : 500, padding: "6px 13px", borderRadius: 6,
              background: active ? "#FFFFFF" : "transparent", color: active ? "#0B1A2F" : "#5E6779",
              border: "none", cursor: "pointer", transition: "all .12s",
              boxShadow: active ? "0 1px 2px rgba(11,26,47,0.1)" : "none",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
